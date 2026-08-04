# Impedir assinaturas de teste duplicadas no checkout

## Context

The trial-first signup flow shipped in #290. `billing-checkout` grants 30 free
days to any workspace that has never held a Stripe subscription, with no promo
code.

A post-merge review found a path that bills a workspace twice. It is real,
verified against merged `main`, and it is not closed by anything currently in
the function.

### The path

1. A workspace has never subscribed. Its `workspace_subscriptions` row is either
   absent or carries `status = null` and `stripe_subscription_id = null` (the
   latter is the normal shape after `billing-checkout` creates the Stripe
   customer but before any webhook arrives).
2. The user opens checkout twice with **different** parameters: two plans, two
   intervals, or one from `/comecar` and one from Plano e Cobrança.
3. Both requests pass the 409 guard at `billing-checkout/index.ts:74`, which
   only rejects `status` of `active` or `trialing`.
4. Both compute `resolveTrialDays(false)` at `index.ts:92`, because neither sees
   a `stripe_subscription_id`.
5. The idempotency key at `_shared/trial.ts:74` is
   `co_${workspaceId}_${planId}_${interval}_${source}_${bucket}`. Different
   plan, interval or source means **different keys**, so Stripe does not collapse
   them and returns two independently completable sessions.
6. The user completes both. Stripe creates two subscriptions on one customer,
   each with `trial_period_days: 30`, and bills both when the trials end.
7. `stripe-webhook` upserts `workspace_subscriptions` keyed on `workspace_id`,
   so the mirror keeps only the last one. The other subscription is live and
   invisible in our data.

### Why the existing guards miss it

- **The idempotency key was designed for a narrower case.** It collapses
  concurrent requests with an *identical* parameter set, which is the two-tabs
  same-plan scenario. It cannot collapse requests that legitimately differ.
- **Both the 409 guard and `hasEverSubscribed` read state that only exists after
  the webhook.** During the propagation window there is nothing local to read.

### What is NOT affected

- Same plan, interval and source concurrently: the key collapses them. Safe.
- Two concurrent first-ever checkouts creating two Stripe customers: Stripe
  rejects one on an idempotency parameter mismatch. The user sees an error, never
  a duplicate subscription.

An earlier note in `2026-08-03-free-trial-signup-flow-design.md` described the
whole residual as failing safe into an error. That is accurate for the customer
race above and **wrong for the case in this document**, where the outcome is a
duplicate charge. That spec should be corrected when this work lands.

## Options

### A. Ask Stripe before creating a session (recommended)

Before `checkout.sessions.create`, list the customer's subscriptions:

```ts
const existing = await stripe.subscriptions.list({
  customer: customerId,
  status: "all",
  limit: 1,
});
if (existing.data.length > 0) {
  return json({ error: "Este workspace já tem uma assinatura." }, 409, headers);
}
```

Stripe is the source of truth and knows a subscription exists the moment
checkout completes, without waiting for our webhook. This closes the realistic
shape of the bug: complete one checkout, then start another seconds later from
a different surface.

- No migration, no new state to expire or reconcile.
- Costs one extra Stripe API call per checkout attempt.
- Does not close a genuinely simultaneous race, where both requests query before
  either completes. That window is milliseconds rather than the seconds-long
  webhook window, and the idempotency key still covers the same-parameter case
  inside it.

### B. Short-lived reservation column

Add `pending_checkout_at timestamptz` to `workspace_subscriptions`, set it
before creating a session, and reject a new checkout while a reservation is
younger than N minutes.

- Closes the simultaneous race that A leaves open.
- Needs a migration, and it is user-hostile in the common case: a user who
  cancels in Stripe and immediately wants a different plan is blocked for the
  rest of the window. Clearing the reservation on the cancel return does not
  help, because that return is client-side and unreliable.

### C. Durable pending-checkout ledger

The option the original spec deferred: a table with session ids, expiry and
reconciliation. Correct and complete, and disproportionate to a race this
narrow.

**Recommendation: A.** It removes the seconds-long window that makes this
reachable in practice, needs no schema change, and keeps the failure mode as a
clear 409 rather than a silent second subscription. Revisit B only if duplicate
subscriptions actually appear.

## Design

In `supabase/functions/billing-checkout/index.ts`, after the customer is
resolved and before the session is created:

- Call `stripe.subscriptions.list({ customer: customerId, status: "all", limit: 1 })`.
- If any subscription exists, return 409 with a generic Portuguese message. Do
  not leak Stripe detail to the client; log internally.
- Keep the existing `status`-based 409 as a cheap local short-circuit that
  avoids the API call for the common already-subscribed case.
- Keep the idempotency key unchanged. It still covers same-parameter
  concurrency, which the Stripe lookup does not.

`status: "all"` is deliberate. A workspace whose only subscription is `canceled`
has still subscribed before, so it is not trial-eligible, which matches
`hasEverSubscribed` semantics elsewhere.

Extract the decision as a pure helper in `_shared/` so it is testable without a
live Stripe call, mirroring `resolveTrialDays`:

```ts
export function hasExistingSubscription(count: number): boolean {
  return count > 0;
}
```

## Tests

- Deno unit tests for the helper: zero subscriptions is eligible, one or more is
  not.
- Extend `supabase/functions/__tests__/trial_test.ts`.
- No frontend change, so the CRM suite is unaffected. `startCheckout` already
  surfaces a 409's message, so the existing error path renders it.

## Deploy

Edge function only. No migration.

```bash
npx supabase functions deploy billing-checkout --use-api --no-verify-jwt
```

Staging first. Check `supabase/.temp/project-ref` before each push, since the
link state flips between projects.

## Out of scope

- Reconciling subscriptions already duplicated before this ships. If any exist,
  they need finding in Stripe by customer and cancelling by hand; the mirror
  cannot show them.
- The webhook overwriting the mirror rather than detecting a conflict. Worth a
  separate look: a webhook that noticed an incoming `subscription.created` for a
  workspace that already has a different `stripe_subscription_id` could alert
  instead of silently overwriting.
