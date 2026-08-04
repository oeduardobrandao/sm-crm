# Impedir assinaturas de teste duplicadas no checkout

> **Revisão 2.** A primeira versão desta spec recomendava consultar o Stripe
> antes de criar a sessão e classificava o resíduo como uma janela de
> milissegundos. Isso estava errado, e uma revisão externa derrubou o argumento
> ponto a ponto. As correções estão em "O que a revisão 1 errou".

## Context

The trial-first signup flow shipped in #290. `billing-checkout` grants 30 free
days to any workspace that has never held a Stripe subscription, with no promo
code.

A post-merge review found a path that bills a workspace twice, verified against
merged `main`.

### The path

1. A workspace has never subscribed: `workspace_subscriptions` is absent, or
   carries `status = null` and `stripe_subscription_id = null` (the normal shape
   after the Stripe customer is created but before any webhook arrives).
2. The user opens checkout twice with **different** parameters: two plans, two
   intervals, or one from `/comecar` and one from Plano e Cobrança.
3. Both pass the 409 guard at `index.ts:74`, which only rejects `active` and
   `trialing`.
4. Both compute `resolveTrialDays(false)` at `index.ts:92`, since neither sees a
   `stripe_subscription_id`.
5. The idempotency key at `_shared/trial.ts:74` is
   `co_${workspaceId}_${planId}_${interval}_${source}_${bucket}`. Different
   parameters mean different keys, so Stripe returns two independently
   completable sessions.
6. The user completes both. Two subscriptions, each with `trial_period_days: 30`.
7. `stripe-webhook` upserts on `workspace_id`, so the mirror keeps only the last.
   The other subscription is live and invisible to us.

### The second variant: two customers

`stripe.customers.create` at `index.ts:80` carries **no idempotency key**. Two
concurrent first-ever requests therefore create two distinct Stripe customers,
and the later DB upsert simply overwrites the customer id. Each request then
operates on its own customer, so any per-customer check is blind to the other.

## O que a revisão 1 errou

Recorded because the same mistakes are easy to repeat.

1. **"Consultar o Stripe antes de criar a sessão resolve."** It does not. A
   subscription does not exist until Checkout is *completed*. Two sessions
   created before either completes both see an empty subscription list, however
   far apart they are. Querying Stripe only helps when one checkout has already
   completed, which is the webhook-lag window, not the general case.
2. **"O resíduo é uma janela de milissegundos."** Wrong. The sessions can be
   created minutes or hours apart and completed later. There is no narrow window.
3. **"A corrida de dois customers falha para o lado seguro."** Only when the two
   requests share an idempotency key, i.e. identical plan, interval, source and
   hour bucket. Otherwise there is no collision to catch and both sessions live.
4. **"Mesmo plano, intervalo e origem é seguro."** Not across an hour boundary:
   `Math.floor(now / 3_600_000)` puts those two requests in different buckets and
   therefore on different keys.
5. **`status: "all"` como bloqueio.** This would break a working flow. A
   workspace whose subscription is `canceled` is deliberately allowed to
   resubscribe: the server only blocks `active`/`trialing` (`index.ts:74`), and
   `CobrancaPage.test.tsx:89` asserts the CTA still renders for exactly that
   case, with a comment saying so. Blocking every historical subscription would
   strand every canceled customer.

## Two rules that were conflated

The bug and the fix both get clearer once these are separated.

- **No second trial, ever.** Permanent, per workspace. Correctly implemented
  today as `Boolean(stripe_subscription_id)` via `resolveTrialDays`, and durable
  because the webhook only ever writes that column.
- **No second *concurrent* subscription.** Temporal. Currently implemented as
  "status is not `active`/`trialing`", which is both too narrow (it ignores
  `past_due`, `unpaid`, `incomplete`) and unenforceable during the window before
  any status exists.

Only the second rule is broken. Conflating them is what produced the
`status: "all"` mistake.

## Design

Three parts. The first two are cheap and independent; the third is the actual
fix.

### 1. Idempotency key on customer creation

```ts
const customer = await stripe.customers.create(
  { email: user.email ?? undefined, metadata: { workspace_id: workspaceId } },
  { idempotencyKey: `cus_${workspaceId}` },
);
```

No time bucket: a workspace should have exactly one customer, forever. This
alone removes the two-customer variant and makes every per-customer check
meaningful.

### 2. An explicit blocking-status set

Replace the inline `active`/`trialing` comparison with a named helper in
`_shared/`, blocking the statuses that represent a live or recoverable
subscription and allowing the terminal ones:

```ts
const BLOCKING = new Set(["active", "trialing", "past_due", "unpaid", "incomplete"]);
export function blocksNewSubscription(status: string | null | undefined): boolean {
  return status != null && BLOCKING.has(status);
}
```

`canceled` and `incomplete_expired` are deliberately absent, preserving the
resubscribe path that `CobrancaPage.test.tsx:89` pins. This is a small
correctness fix in its own right, independent of the race.

### 3. An atomic checkout reservation

This is what actually prevents two completable sessions. Migration adds one
column:

```sql
alter table workspace_subscriptions
  add column if not exists pending_checkout_at timestamptz;
```

Before creating a session, claim the reservation with a single conditional
UPDATE. Concurrent writers serialize on the row, so exactly one wins:

```sql
update workspace_subscriptions
   set pending_checkout_at = now()
 where workspace_id = $1
   and (pending_checkout_at is null
        or pending_checkout_at < now() - interval '15 minutes')
returning workspace_id;
```

Zero rows returned means a checkout is already in flight: return 409 with a
generic Portuguese message. The row must exist first, which it already does
after the customer find-or-create.

**Releasing the reservation**, in order of reliability:

- `stripe-webhook` clears it on `customer.subscription.created` and on
  `checkout.session.expired`. This is the authoritative path.
- The 15-minute expiry is the backstop, so a lost webhook cannot wedge a
  workspace permanently.
- The `cancel_url` return may clear it best-effort, but must never be relied on:
  it is client-side and a closed tab never fires it.

**The tradeoff, stated plainly:** a user who abandons Stripe Checkout and
immediately wants a different plan is blocked for up to 15 minutes. That is the
cost of the guarantee. Shortening the window trades safety for convenience; the
webhook-driven release is what keeps the common abandon-then-retry case fast,
since `checkout.session.expired` fires well before the timeout in practice.

### Rejected: query Stripe before creating the session

Revision 1's recommendation. It closes only the post-completion window and is
blind to the pre-completion case that is the actual bug. Not worth an API call
per checkout for that.

## Tests

The pure helpers are the easy part and are not sufficient on their own.

- `blocksNewSubscription`: blocks each live status, allows `canceled`,
  `incomplete_expired`, `null` and unknown strings.
- Reservation SQL, in the psql suite at `supabase/tests/entitlements/`
  (which **is** gated by CI via the `entitlement-tests` job): two sequential
  claims inside one transaction, the second returning zero rows; a claim older
  than the window succeeding; a claim newer than the window failing.
- Edge-function behaviour that the helpers do not cover, and that revision 1
  wrongly called adequate: the reservation is claimed **after** customer
  resolution and **before** session creation; a failed claim returns 409 without
  calling Stripe; a Stripe error after a successful claim releases it rather
  than wedging the workspace.
- **CRM tests are affected**, contrary to revision 1. Any change to blocking
  statuses must be checked against `CobrancaPage.test.tsx:89`, which asserts a
  canceled subscriber still gets a checkout CTA.

## Deploy

Migration plus edge function, so both go out **before** any frontend merge, and
staging first. Check `supabase/.temp/project-ref` before each push, since the
link state flips between projects. Number the migration above `origin/main`'s
tail at PR-open time, not at authoring time.

## Out of scope

- Reconciling subscriptions already duplicated before this ships. If any exist
  they must be found in Stripe by customer and cancelled by hand; the mirror
  cannot show them. Worth checking before this work starts, since #290 is
  already live.
- `stripe-webhook` silently overwriting the mirror when a second
  `stripe_subscription_id` arrives for a workspace. It could alert instead. That
  is the detection half of this problem and deserves its own change.
