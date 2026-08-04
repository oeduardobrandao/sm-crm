# Impedir assinaturas de teste duplicadas no checkout

> **Revisão 5.** Quatro desenhos anteriores foram derrubados por revisão externa.
> O histórico está em "Armadilhas já encontradas": leia antes de propor uma
> alternativa, porque elas se repetem. O tamanho dessa lista é o próprio recado
> desta spec: isto não é um ajuste pequeno.

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
3. Both pass the 409 guard (`index.ts:74`), which only rejects `active`/`trialing`.
4. Both compute `resolveTrialDays(false)` (`index.ts:92`).
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
per-customer check is blind to the other, and our DB retains only one of them.

## Armadilhas já encontradas

Each was a proposed design, and each was wrong.

1. **"Consultar o Stripe antes de criar a sessão."** A subscription does not
   exist until Checkout is *completed*, so two sessions created beforehand both
   see an empty list, however far apart. Covers only webhook lag.
2. **"O resíduo é de milissegundos."** Sessions can be created hours apart and
   completed later.
3. **"A corrida de dois customers falha para o lado seguro."** Only when both
   requests share an idempotency key: identical plan, interval, source *and*
   hour bucket.
4. **"Mesmo plano, intervalo e origem é seguro."** Not across an hour boundary.
5. **`status: "all"` como bloqueio.** Strands every canceled customer;
   resubscribing is deliberate and `CobrancaPage.test.tsx:89` pins it.
6. **Reserva de 15 minutos.** Shorter than the session's 24h default lifetime,
   so a second reservation could be claimed while the first session was still
   completable.
7. **Um timestamp como reserva.** Does not identify the session: a late
   completion clears somebody else's reservation.
8. **Status lido fora da reivindicação.** A webhook flipping the row between the
   read and the claim still allowed the claim.
9. **Eventos inexistentes.** `stripe-webhook` dispatches only
   `checkout.session.completed`, `customer.subscription.updated`, `.deleted` and
   `invoice.payment_failed`.
10. **Escrever o `session.id` sem guarda.** If a stalled request writes its
    session id after another has reclaimed the lease, it silently steals the
    reservation back and both sessions become completable.
11. **SQL que o cliente não consegue executar.** `billing-checkout` speaks
    PostgREST, which cannot express `gen_random_uuid()`, `now()`, a compound
    `WHERE`, or `RETURNING` of pre-update values. Written as `.update()` the
    "atomic claim" degrades into read-then-write and reopens the race.
12. **`RETURNING` do valor anterior.** A post-update `RETURNING` yields the new
    value, so it cannot hand back the previous `session_id` that step 2 needs to
    expire. Requires a CTE with `FOR UPDATE`.
13. **RPC sem privilégios.** A new `public` function is executable by `PUBLIC`,
    so an RPC taking `workspace_id` would let any authenticated user lock another
    tenant's checkout.
14. **Ler silêncio como sucesso.** PostgREST's `.update()` does not report rows
    affected without `.select()`, and the whole design turns on telling "wrote
    it" from "lease was taken".
15. **Block-list de status.** Fails open on any status Stripe adds or returns
    that we do not know. The allow-list of terminal statuses fails closed.

## Two rules that were conflated

- **No second trial, ever.** Permanent, per workspace. Correct today as
  `Boolean(stripe_subscription_id)`, durable because the webhook only writes
  that column.
- **No second *concurrent* subscription.** Temporal, and the broken one.

## Design

### 1. Bound the session's lifetime

Set `expires_at` when creating the session. Stripe requires it 30 minutes to 24
hours **after creation**, evaluated server-side, so a bare `now + 1800` fails
intermittently once request latency is counted. Send a margin:

```ts
expires_at: Math.floor(Date.now() / 1000) + 35 * 60,
```

Then use the `expires_at` Stripe **returns** as the lease deadline, never the
value sent. The two differ, and the returned one is what governs whether the
session is still completable.

### 2. Idempotency key on customer creation

```ts
stripe.customers.create({ … }, { idempotencyKey: `cus_${workspaceId}` })
```

Stripe retains idempotency keys about 24h, so this closes the concurrent window,
not "forever". The persisted `stripe_customer_id` is the durable guarantee, and
its upsert must be error-checked: a silent failure returns the next request to
the two-customer path.

### 3. Explicit blocking-status set

Expressed as an **allow-list of terminal statuses**, so it fails closed:

```ts
const TERMINAL = new Set(["canceled", "incomplete_expired"]);
export function blocksNewSubscription(status: string | null | undefined): boolean {
  if (status == null) return false;          // no subscription yet
  if (TERMINAL.has(status)) return false;    // finished, may resubscribe
  return true;                                // live, recoverable, or UNKNOWN
}
```

A block-list of live statuses would fail **open**: if Stripe ever adds or
returns a status we do not know, an unknown value would sail through and allow a
second subscription, which is the exact thing this spec exists to prevent. The
terminal set is small and stable, so allow-listing it is both safer and less
likely to drift. An unknown status must also be logged, because it means the
allow-list needs review.

This covers `paused` without naming it, along with anything Stripe adds later.

**The UI change must be specified per status, not delegated.** In
`CobrancaPage.tsx`, `hasActiveSub` currently gates *two* things: whether a plan
CTA renders, and whether the "Gerenciar assinatura" card renders (`:134`).
Swapping it for the blocking predicate wholesale would newly show a generic
"Ativo" management card to `unpaid`, `incomplete` and `paused` workspaces, which
is wrong. Required behaviour:

| status | plan CTA | management card | badge |
|---|---|---|---|
| `active`, `trialing` | hidden | shown | as today |
| `past_due` | hidden | shown | "Pagamento pendente" (exists) |
| `unpaid`, `incomplete`, `paused` | hidden | shown, portal link only | status-specific label |
| `canceled`, `incomplete_expired`, null | shown | hidden | none |

So: CTA visibility follows the blocking predicate; card visibility follows "has
a Stripe subscription at all". They are no longer the same boolean and must stop
sharing one.

"Plan CTA hidden" means the actionable button only. `renderCta()` returns a
static "Plano atual" marker for the workspace's current plan before it ever
consults `hasActiveSub`, and that marker **stays** in every blocking status. Two
implementers would otherwise read the table differently.

### 4. Lease-based atomic reservation

```sql
alter table workspace_subscriptions
  add column if not exists pending_checkout_lease uuid,
  add column if not exists pending_checkout_session_id text,
  add column if not exists pending_checkout_expires_at timestamptz;
```

**This must be a Postgres RPC, not a PostgREST update.** `billing-checkout`
talks to the database through supabase-js/PostgREST, which cannot express
`gen_random_uuid()`, `now()`, a compound `WHERE` like the one below, or
`RETURNING` of pre-update values. Writing it as `.update()` would silently
degrade into read-then-write and reopen the very race this closes.

The claim also has to capture the **previous** session id, which a plain
`RETURNING` cannot do because it yields post-update values. Lock the row and
read it first in a CTE:

```sql
create or replace function claim_checkout_lease(p_workspace uuid)
returns table (
  lease uuid,
  previous_session_id text,
  stripe_subscription_id text,
  stripe_customer_id text
)
language sql
security definer
set search_path = public
as $$
  with locked as (
    select workspace_id, pending_checkout_session_id, status,
           pending_checkout_expires_at
      from workspace_subscriptions
     where workspace_id = p_workspace
     for update
  ), claimed as (
    update workspace_subscriptions ws
       set pending_checkout_lease = gen_random_uuid(),
           pending_checkout_expires_at = now() + interval '40 minutes',
           pending_checkout_session_id = null
      from locked l
     where ws.workspace_id = l.workspace_id
       and (l.pending_checkout_expires_at is null
            or l.pending_checkout_expires_at < now())
       and (l.status is null or l.status in ('canceled','incomplete_expired'))
    returning ws.pending_checkout_lease, l.pending_checkout_session_id,
              ws.stripe_subscription_id, ws.stripe_customer_id
  )
  select * from claimed;
$$;
```

Zero rows means a checkout is in flight or a blocking subscription exists:
409, generic message, no Stripe call.

**Privileges are load-bearing.** A new function in `public` is executable by
`PUBLIC` by default, so as written any authenticated user could pass another
tenant's `workspace_id` and lock their checkout. Follow the pattern in
`20260729000001_switch_workspace_rpc.sql`:

```sql
revoke all on function claim_checkout_lease(uuid) from public, anon, authenticated, service_role;
grant execute on function claim_checkout_lease(uuid) to service_role;
```

Enumerate the roles explicitly: `REVOKE ... FROM PUBLIC` alone leaves the
Supabase default grants to `anon`/`authenticated`/`service_role` intact, and
revoking from `PUBLIC` also strips `service_role`, which is why it is re-granted
after. The same treatment applies to the release/write-back RPCs below.

**Trial eligibility must come from this statement's returned
`stripe_subscription_id`, not the earlier `subRow` read at `index.ts:66`.**
Otherwise a webhook can establish subscription history between the read and the
session creation, and the new session still gets a trial.

**Every subsequent write carries the lease**, which is what closes trap 10, and
each must report whether it actually matched:

```sql
update workspace_subscriptions
   set pending_checkout_session_id = $2, pending_checkout_expires_at = $3
 where workspace_id = $1 and pending_checkout_lease = $lease;
```

PostgREST's `.update()` does **not** tell the caller how many rows it touched
unless `.select()` is chained. Since the whole design turns on distinguishing
"wrote it" from "lease was taken", either chain `.select()` and check the array
length, or expose these as RPCs returning a boolean. Silence must never be read
as success.

Ordering:

1. Claim; keep the lease token.
2. If a previous `pending_checkout_session_id` was present, call
   `stripe.checkout.sessions.expire(oldId)`, ignoring "already expired or
   completed" errors. This stops a stale session outliving its reservation.
3. Create the session.
4. Write back `session.id` and Stripe's returned `expires_at`, **conditional on
   the lease**. If that update reports zero rows, another request has taken the
   lease: expire the session just created and return 409.
5. If session creation throws, release the lease (also conditional) or the
   workspace is wedged.

**Releasing**, always conditional on lease *and* session id:

- `checkout.session.completed`: already dispatched. **The mirror upsert must
  succeed before the reservation is cleared.** Today `stripe-webhook/index.ts:138`
  ignores the upsert's `{ error }` entirely; that must be fixed here, because
  clearing after a silently failed write releases the lock while the row still
  shows no blocking status, which is precisely the duplicate path reopening.
- `checkout.session.expired`: **new case in the dispatcher.** Both events carry
  the session, so the workspace comes from `client_reference_id` (already set)
  and the identifier from `session.id`. Validate both before writing.
- `pending_checkout_expires_at` is the backstop for a lost webhook.
- The `cancel_url` return may clear best-effort, never relied on.

**Tradeoff:** abandoning Checkout and immediately wanting a different plan blocks
for up to ~35 minutes unless `checkout.session.expired` arrives sooner. Stripe's
30-minute floor on `expires_at` means this cannot be tightened without giving up
the session/lease equivalence that makes the design correct.

## Tests

- `blocksNewSubscription`: `null` and the two terminal statuses allow;
  every live status blocks, `paused` included; **an unknown string blocks**,
  which is the fail-closed behaviour and the one most likely to be broken by a
  well-meaning refactor back to a block-list.
- RPC privileges, in the psql suite: `authenticated` cannot execute
  `claim_checkout_lease`, `service_role` can. A tenant must not be able to lock
  another tenant's checkout.
- The claim returns the **previous** session id, not null, when one was set.
- Reservation SQL in `supabase/tests/entitlements/` (gated by CI via the
  `entitlement-tests` job): two claims in one transaction, second returns zero
  rows; an expired lease is reclaimable; a blocking status refuses the claim;
  a write-back with a stale lease affects zero rows; the conditional clear is a
  no-op on a mismatched session id.
- Edge function: claim after customer resolution and before session creation;
  a failed claim returns 409 without calling Stripe; a Stripe failure after a
  successful claim releases the lease; a stale previous session is expired
  first; trial eligibility uses the claim's returned `stripe_subscription_id`
  rather than the earlier read.
- Webhook: the reservation is cleared only after a successful mirror upsert, and
  an upsert error leaves it held.
- CRM: the full status table in section 3, not only `canceled`.

## Deploy

Migration, edge function and webhook, all **before** any frontend merge, staging
first. Check `supabase/.temp/project-ref` before each push. Number the migration
above `origin/main`'s tail at PR-open time.

**Sessions already open at deploy stay completable** for up to 24h: they were
created without `expires_at` and without a lease, so two can still both be
completed after this ships.

A sweep is harder than "list sessions per customer". The two-customer race means
`workspace_subscriptions.stripe_customer_id` retains only one id, so an orphaned
customer is invisible to our data. A real reconciliation has to go the other
way: page through Stripe customers filtered on `metadata.workspace_id` (already
set at creation, `index.ts:80`), then page their open sessions. If that is not
done, the deployment window must be **explicitly accepted and monitored**, not
assumed closed.

## Out of scope

- Reconciling subscriptions already duplicated. #290 is live, so check before
  starting: they must be found in Stripe and cancelled by hand.
- `stripe-webhook` overwriting the mirror when a second `stripe_subscription_id`
  arrives, instead of alerting. That is the detection half and deserves its own
  change.
