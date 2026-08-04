# Impedir assinaturas de teste duplicadas no checkout

> **Revisão 3.** Duas revisões externas derrubaram desenhos anteriores. O que
> cada uma errou está em "O que as revisões anteriores erraram" — vale ler antes
> de propor uma alternativa, porque as armadilhas se repetem.

## Context

The trial-first signup flow shipped in #290. `billing-checkout` grants 30 free
days to any workspace that has never held a Stripe subscription.

A post-merge review found a path that bills a workspace twice, verified against
merged `main`.

### The path

1. A workspace has never subscribed: `workspace_subscriptions` is absent, or has
   `status = null` and `stripe_subscription_id = null` (the normal shape after
   the customer is created but before any webhook).
2. Checkout is opened twice with **different** parameters: two plans, two
   intervals, or one from `/comecar` and one from Plano e Cobrança.
3. Both pass the 409 guard (`index.ts:74`), which only rejects `active` and
   `trialing`.
4. Both compute `resolveTrialDays(false)` (`index.ts:92`): no
   `stripe_subscription_id` yet.
5. The idempotency key (`_shared/trial.ts:74`) includes plan, interval, source
   and an hour bucket, so different parameters mean different keys and Stripe
   returns two independently completable sessions.
6. Completing both creates two subscriptions, each with `trial_period_days: 30`.
7. `stripe-webhook` upserts on `workspace_id`, so the mirror keeps only the last.
   The other subscription is live and invisible to us.

### Second variant: two customers

`stripe.customers.create` (`index.ts:80`) has **no idempotency key**. Two
concurrent first-ever requests create two Stripe customers; the later upsert
overwrites the id. Each request then operates on its own customer, so any
per-customer check is blind to the other.

## O que as revisões anteriores erraram

### Revisão 1: "consultar o Stripe antes de criar a sessão"

- A subscription does not exist until Checkout is **completed**. Two sessions
  created before either completes both see an empty list, however far apart.
  Querying Stripe only covers the post-completion webhook-lag window.
- Called the residual "milissegundos". Wrong: sessions can be created hours
  apart and completed later.
- Called the two-customer race safe. Only when both requests share an
  idempotency key, i.e. identical plan, interval, source *and* hour bucket.
- Called "same plan, interval and source" safe. Not across an hour boundary:
  `Math.floor(now / 3_600_000)` puts those on different keys.
- Proposed `status: "all"` as the block. That strands every canceled customer:
  resubscribing is deliberate, and `CobrancaPage.test.tsx:89` pins it.

### Revisão 2: reserva de 15 minutos com um timestamp

- **A janela era menor que a vida da sessão.** Checkout Sessions live up to 24h
  by default and this code never sets `expires_at`. After 15 minutes a second
  reservation could be claimed while the first session was still completable,
  producing exactly the duplication it was meant to stop.
- **Um timestamp não identifica a sessão.** Session A stays open, B claims the
  reservation, A completes late and clears B's reservation, and a third session
  becomes possible. The reservation needs a session identifier and every clear
  must be conditional on it.
- **Leitura de status fora da reivindicação.** Status was read before the claim,
  so a webhook flipping the row to `active` in between still allowed the claim.
  The claim must condition on blocking status in the same statement.
- **`paused` faltando** no conjunto bloqueante, despite the stated rule being
  "live or recoverable".
- **Eventos que o dispatcher não tem.** It assumed `customer.subscription.created`
  and `checkout.session.expired`; `stripe-webhook` handles only
  `checkout.session.completed`, `customer.subscription.updated`, `.deleted` and
  `invoice.payment_failed`.

## Two rules that were conflated

- **No second trial, ever.** Permanent, per workspace. Correct today as
  `Boolean(stripe_subscription_id)`, durable because the webhook only writes
  that column.
- **No second *concurrent* subscription.** Temporal, and the one that is broken.

## Design

### 1. Bound the session's lifetime

Set `expires_at` explicitly when creating the session. Stripe's minimum is 30
minutes from creation; use exactly that:

```ts
expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
```

This is what makes a reservation window meaningful. Everything below assumes the
reservation and the session die together.

### 2. Idempotency key on customer creation

```ts
stripe.customers.create({ … }, { idempotencyKey: `cus_${workspaceId}` })
```

Scope note, correcting revision 2: Stripe retains idempotency keys for about
24h, so this does **not** guarantee one customer forever. It closes the
concurrent window; the persisted `stripe_customer_id` is the durable guarantee.
The upsert that writes it must be error-checked, since a silent failure returns
the code to the two-customer path on the next request.

### 3. Explicit blocking-status set

```ts
const BLOCKING = new Set([
  "active", "trialing", "past_due", "unpaid", "incomplete", "paused",
]);
export function blocksNewSubscription(status: string | null | undefined): boolean {
  return status != null && BLOCKING.has(status);
}
```

`paused` blocks: it is recoverable, matching the stated rule. `canceled` and
`incomplete_expired` are terminal and deliberately absent, preserving the
resubscribe path.

**UI must move with it.** `CobrancaPage` computes `hasActiveSub` from `active`
and `trialing` only. Left alone, a `past_due`, `unpaid`, `incomplete` or
`paused` workspace would still be shown a checkout CTA that now 409s. Export the
same predicate to the frontend, or mirror it, and cover those statuses in
`CobrancaPage.test.tsx` rather than only `canceled`.

### 4. Session-scoped atomic reservation

```sql
alter table workspace_subscriptions
  add column if not exists pending_checkout_session_id text,
  add column if not exists pending_checkout_expires_at timestamptz;
```

Claim in **one** statement that also enforces the status rule, so nothing can
change between the check and the claim:

```sql
update workspace_subscriptions
   set pending_checkout_expires_at = $2   -- the session's expires_at
 where workspace_id = $1
   and (pending_checkout_expires_at is null or pending_checkout_expires_at < now())
   and (status is null or status not in
        ('active','trialing','past_due','unpaid','incomplete','paused'))
returning workspace_id;
```

Zero rows means either a checkout is in flight or the workspace already has a
blocking subscription: return 409, generic message, no Stripe call.

Ordering, which matters:

1. Claim the reservation with a provisional expiry.
2. If a previous `pending_checkout_session_id` is present and not yet known
   dead, call `stripe.checkout.sessions.expire(oldId)` and ignore an error
   saying it is already expired or completed. This is what stops a stale session
   outliving its reservation if clocks or expiry disagree.
3. Create the session.
4. Write back the real `pending_checkout_session_id` and its `expires_at`.
5. If session creation throws, release the reservation, or the workspace is
   wedged for 30 minutes.

**Releasing**, always conditional on the session id:

```sql
update workspace_subscriptions
   set pending_checkout_session_id = null, pending_checkout_expires_at = null
 where workspace_id = $1 and pending_checkout_session_id = $2;
```

- `checkout.session.completed`: already dispatched; add the conditional clear.
- `checkout.session.expired`: **new case in the dispatcher.** Both events carry
  the session object, so the workspace comes from `client_reference_id` (already
  set on creation) and the identifier from `session.id`. Validate both before
  writing.
- `pending_checkout_expires_at` is the backstop for a lost webhook.
- The `cancel_url` return may clear best-effort, never relied on: a closed tab
  never fires it.

**Tradeoff, stated plainly:** abandoning Checkout and immediately wanting a
different plan blocks for up to 30 minutes, unless `checkout.session.expired`
arrives sooner. Thirty minutes is Stripe's floor for `expires_at`, so it cannot
be tightened without giving up the session/reservation equivalence that makes
this correct.

## Tests

- `blocksNewSubscription`: each live status blocks; `canceled`,
  `incomplete_expired`, `null` and unknown strings do not; `paused` blocks.
- Reservation SQL in `supabase/tests/entitlements/` (gated by CI via the
  `entitlement-tests` job): two claims in one transaction, second returns zero
  rows; an expired reservation is reclaimable; a blocking status refuses the
  claim even with no reservation; the conditional clear is a no-op when the
  session id does not match.
- Edge-function behaviour the helpers do not cover: the claim happens after
  customer resolution and before session creation; a failed claim returns 409
  without calling Stripe; a Stripe failure after a successful claim releases the
  reservation; a stale previous session is expired before a new one is created.
- CRM: `CobrancaPage` for `past_due`, `unpaid`, `incomplete` and `paused` as
  well as `canceled`, so the UI and the server agree on who gets a CTA.

## Deploy

Migration plus edge function plus webhook, all **before** any frontend merge,
staging first. Check `supabase/.temp/project-ref` before each push. Number the
migration above `origin/main`'s tail at PR-open time, not at authoring time.

**Sessions already open at deploy time stay completable** for up to 24h, since
they were created without `expires_at` and without a reservation. Two of them
can still both be completed after this ships. Either sweep them — list open
Checkout Sessions per customer and expire them as part of the rollout — or
accept the window explicitly and watch for it. A silent assumption that the fix
is effective the moment it deploys would be wrong.

## Out of scope

- Reconciling subscriptions already duplicated. #290 is live, so check before
  starting: they must be found in Stripe by customer and cancelled by hand,
  because the mirror cannot show them.
- `stripe-webhook` overwriting the mirror when a second `stripe_subscription_id`
  arrives for a workspace, instead of alerting. That is the detection half of
  this problem and deserves its own change.
