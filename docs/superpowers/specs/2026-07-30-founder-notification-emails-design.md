# Founder notification emails (signup + subscription)

**Date:** 2026-07-30
**Status:** Approved for implementation
**Follows:** 2026-07-29-lifecycle-emails-design.md (PR #268)

## Goal

Eduardo receives an internal email in his personal inbox (the same one that
already gets cron-failure alerts) every time:

1. a new self-serve user signs up (same boundary as the welcome email:
   confirmed email, owner of a workspace they created, not invited), and
2. a workspace starts a paid subscription (same boundary as the thank-you
   email: `workspace_subscriptions.status` in `trialing | active`; a trial
   start counts, and the notice labels trial vs active).

## Approach: piggyback on the lifecycle-email cron

The `lifecycle-email-cron` sweep (every 15 min) already detects exactly these
two events to send the user-facing welcome / thank-you emails. The founder
notice is sent in the same per-candidate loop, so it reuses the candidate
RPCs, the `lifecycle_emails` ledger, the stale-claim retry protocol, and the
Resend idempotency machinery. No new ledger rows, no new cron, no webhook
changes.

Per candidate the order becomes:

```
claim upsert
send user-facing email   (Idempotency-Key: welcome/<user_id> etc.)
send founder notice      (Idempotency-Key: founder_signup/<user_id> /
                          founder_subscription/<workspace_id>)
mark delivered
```

A founder-notice failure throws before `delivered_at` is set, so the claim
goes stale and the next eligible run retries BOTH sends; Resend dedupes the
user-facing email by its unchanged idempotency key (24h window). The same
residual risk accepted in the lifecycle-emails spec applies: retries beyond
24h can duplicate.

Accepted residuals inherited from the shared ledger (same semantics the
user-facing emails already have, accepted in PR #268):

- If the subscription status leaves `trialing|active` (or the 30-attempt cap
  is hit) before a stale retry succeeds, the pending notice is dropped, the
  same way the pending thank-you would be.
- The ledger is unique per `(email_type, workspace_id)` and terminal after
  delivery: a workspace that cancels and later re-subscribes produces no
  second thank-you and no second founder notice. The notice is per FIRST
  subscription per workspace. A true per-subscription-event ledger would need
  webhook-driven event rows and is out of scope for an internal FYI email.

- **Recipient:** `ALERT_EMAIL` env (already set on prod; routes to the
  personal inbox).
- **Sender:** `Mesaas Alerts <alertas@mesaas.com.br>` (matches cron alerts;
  the user-facing emails keep the founder sender).
- **Unset `ALERT_EMAIL`** (e.g. staging): the notice is skipped silently and
  never blocks or fails the user-facing email path.

## Notice content

Plain internal emails (small HTML, everything escaped, no em-dashes). No
body timestamp: the email's own Date header is within one cron interval
(15 min) of the event.

- **Signup:** subject `[Mesaas] Novo cadastro: <email>`; body with nome and
  email. Missing nome renders `(sem nome)`.
- **Subscription:** subject `[Mesaas] Nova assinatura: <workspace> (<plano>)`;
  body with workspace, plan, net value, status, billing interval, owner nome
  and email. Fallbacks: plan name coalesces to the raw `plan_id` in SQL and to
  `(plano desconhecido)` when both are null; status renders `trialing` as
  `Trial`, `active` as `Ativa`, anything else raw (or `(desconhecido)` when
  null); interval renders `month` as `Mensal`, `year` as `Anual`, anything
  else raw, and the row is omitted when null.

### Net value (Valor row)

What the workspace ACTUALLY pays, net of coupons, priced live from Stripe at
send time (the local mirror only knows catalog prices; discounts live in
Stripe). The pricing logic is the same one the admin trials-MRR view uses,
extracted to `_shared/stripe-amount.ts` (`fetchStripeAmount`: first item's
`unit_amount * quantity`, minus the active coupon's `percent_off`/`amount_off`,
handling both `discounts[]` and legacy `discount`).

Rendering: `R$ 119,20/mês (após o trial) · cupom LANC20 −20%, de R$ 149,00` —
the trial suffix appears when status is `trialing` (Stripe reports the
post-trial price; the workspace pays R$ 0 during the trial), and the coupon
segment shows the label plus the pre-discount price. No coupon: just
`R$ 149,00/mês`. Non-BRL currencies render generically (`5,00 USD/week`).

Best-effort: the Stripe lookup (SDK timeout 5s) failing for ANY reason —
missing `STRIPE_SECRET_KEY`, Stripe down, missing subscription id — renders
`(indisponível)` instead of failing the send; a Stripe outage must not strand
the claim and re-retry the already-sent user-facing email.

Subject values are user-controlled (workspace/plan names): interpolations
are sanitized — control characters and newlines stripped, whitespace
collapsed, value truncated — so a malformed name cannot make Resend reject
the send (which would strand the claim and re-retry the already-sent
user-facing email).

## Migration

`get_thankyou_email_candidates` gains four output columns: `plan_name`
(`plans.name`, falling back to `plan_id`), `sub_status`, `billing_interval`,
and `stripe_subscription_id` (for the live Stripe pricing). A return-type
change requires `drop function` + `create`, then re-granting execute to
`service_role` only (repo gotcha: plain `REVOKE FROM PUBLIC` also strips
service_role).

Deploy-order safety: the handler treats the new fields as optional and falls
back to a generic label, so the function can deploy before or after the
migration lands.

## Code changes

- `supabase/functions/_shared/lifecycle-emails.ts`: builders + senders for
  the two notices (`sendFounderSignupNotice`, `sendFounderSubscriptionNotice`),
  including the value-line rendering and the best-effort Stripe lookup.
- `supabase/functions/_shared/stripe-amount.ts`: `fetchStripeAmount` +
  coupon helpers, extracted from `platform-admin/index.ts` (which now imports
  them; behavior unchanged, no redeploy urgency).
- `supabase/functions/lifecycle-email-cron/handler.ts`: two new injected
  deps, called between the user-facing send and `markDelivered`; extended
  `ThankCandidate` shape.
- `supabase/functions/lifecycle-email-cron/index.ts`: wiring.
- `supabase/migrations/20260730000003_thankyou_candidates_plan_info.sql`.
- Tests extended in `__tests__/lifecycle-emails_test.ts` and
  `__tests__/lifecycle-email-cron_test.ts`; new `__tests__/stripe-amount_test.ts`.

## Non-goals

- No notice for invited team members joining an existing workspace.
- No backfill notices for past signups/subscriptions (existing delivered
  ledger rows stay terminal).
- No digest mode; one email per event.
- No per-subscription-event ledger: cancel-and-resubscribe does not notify
  again (see accepted residuals above).
