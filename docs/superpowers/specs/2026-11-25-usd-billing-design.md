# USD billing (US launch, part 1 of 3)

Status: draft for approval · 2026-11-25

## Intent

Mesaas will be advertised in the US. A US agency that signs up from the English landing page
(`/en`, next spec) must see prices in dollars and pay in dollars through Stripe. Today every
price, mirror, metric and commission assumes reais.

This spec covers only the billing side. It ships **dark**: no workspace becomes USD until the
`/en` signup (part 2) exists, except workspaces a platform admin flips by hand to test.

The three parts of the US launch:

1. **USD billing** (this spec).
2. `/en` landing, English legal pages (GDPR + US state privacy rights), English cookie banner,
   signup from `/en` that creates a USD workspace and an English UI. Separate spec, with a
   mockups artifact.
3. English gaps inside the app (Instagram analytics, report editor, Contratos, Importar,
   Afiliados, Ajuda, `/comecar`, lifecycle and notification emails). Separate spec.

## Goals

- Start / Pro / Max can be bought in USD, monthly or annual, through Stripe Checkout.
- A workspace has exactly one billing currency, decided before its first checkout, never
  chosen by the buyer's location.
- Every place that records, shows or sums a subscription amount knows its currency.
- Brazilian billing behaves exactly as today.

## Non-goals

- Pagar.me in USD (it is Brazil-only). USD workspaces never see the 12x offer.
- FX conversion. Admin metrics report BRL and USD side by side, never one converted total.
- Affiliate commissions on USD invoices (v1 records nothing for them, see §6).
- Stripe Tax / US sales tax. Not configured today; out of scope, revisit before volume.
- Switching an existing workspace between currencies after its first checkout.
- Any English copy (parts 2 and 3).

## Anti-goals

- A BR customer ever being charged in USD, or a US customer in BRL, because of where their IP is.
- A USD amount stored or summed as if it were reais (MRR, mirror, commissions, payouts).
- A client being able to change its own workspace currency after creation.

## Prices

| Plan  | Monthly | Annual (~20% off, same ratio as BRL) |
| ----- | ------- | ------------------------------------ |
| Start | $29     | $279                                 |
| Pro   | $49     | $469                                 |
| Max   | $79     | $759                                 |

Chosen by the user (2026-11-25).

## Approaches considered

- **A. USD as `currency_options` on the existing Stripe prices (chosen by the user).** One
  Price carries BRL (default) and USD. Price IDs do not change, so the webhook's price→plan
  match (`stripe-webhook/index.ts:202-206, :432-436`) is untouched. Checkout passes
  `currency`. Less code on the plan-resolution path.
- B. Separate USD Price objects and two new price-ID columns per plan. Every price-ID reader
  (webhook, plan mutations, metrics backfill, affiliate plan lookup) learns the new IDs.
  Rejected: more code on the most sensitive path, same currency-awareness work everywhere else.

Consequence of A that drives most of this spec: with `currency_options`, `price.unit_amount`
and `price.currency` stay the BRL defaults. Anything that prices a subscription from
`item.price` gets the wrong number for USD. The real figures are `subscription.currency` and
`price.currency_options[currency].unit_amount` (needs the `currency_options` expand), or the
invoice amounts.

## Design

### 1. Workspace currency (schema)

- `workspaces.billing_currency text not null default 'brl' check (billing_currency in ('brl','usd'))`.
- Added to the IS DISTINCT FROM list of `workspaces_guard_billing_columns()` by redefining
  that function in a **new** migration with a fresh, unique version above main's tail (the
  original `20261129000002` and the reverse-trial `20261130000001` are already applied; editing
  them does nothing and reusing their prefix is silently skipped). Same for every RPC this spec
  changes. So `anon`/`authenticated` can never change it. Test added to
  `99_workspace_billing_column_guard.sql`.
- Set at creation by `handle_new_user_workspace()` (latest definition in
  `20260928000001_workspace_slug_unaccent.sql`) from signup metadata `market = 'us'` → `'usd'`,
  anything else → `'brl'`. Invited users join an existing workspace and never set it.
  Part 2 sends `market: 'us'` from `/en`; until then nobody sends it.
- Known and accepted: signup metadata is client-controlled, so anyone can sign up as US or BR.
  Both price lists are public; choosing a market at signup is not a privilege. The guard only
  prevents changing it **after** creation.
- `workspaces.billing_currency_locked_at timestamptz null`, also guarded. Two service-role
  RPCs serialize on the workspace row, since checkout cannot hold a lock across Stripe calls:
  - `billing_currency_lock(ws)`: `update ... set billing_currency_locked_at =
    coalesce(billing_currency_locked_at, now()) returning billing_currency`. `billing-checkout`
    calls it **before** creating or reusing the Stripe customer and uses the returned currency
    for the session. Failure → 500, no session.
  - `billing_currency_set(ws, currency)`: `update ... set billing_currency = $2 where id = $1
    and billing_currency_locked_at is null`; zero rows → refuse (`currency_locked`). Called by
    the new `platform-admin` action `set-workspace-currency` (testing and support).
  - Once any checkout has started, the currency never changes, even if that checkout is
    abandoned. Unlocking is a manual SQL fix, documented in the runbook.
- Stripe ties a customer to its first subscription's currency, so the currency is effectively
  locked from the first checkout. `billing-checkout` refuses (409, generic message) when the
  reused Stripe customer already has a currency different from the workspace's.

### 2. Plan prices (schema)

- `plans.price_usd integer null`, `plans.price_usd_annual integer null` (cents), display
  prices for USD mirroring `price_brl*`. Null = plan not sold in USD (checkout refuses).
- Edited in the Admin plan form next to the BRL fields (`plan-mutations.ts`,
  `PlanFormFields.tsx`, `plan-form.ts`). As with BRL today, Admin does not push amounts to
  Stripe; the Stripe `currency_options` are set once by hand (§8) and must match.
- `platform-admin` and the other importers select `plans.*` through `_shared/entitlements.ts`;
  per that rule the migration goes first, then the redeploys (Deploy order).

### 3. Checkout and portal

`billing-checkout`:
- Reads `workspaces.billing_currency` and passes `currency` on `checkout.sessions.create`.
  **This ships and is deployed to prod and staging before any `currency_options` exist in
  Stripe**: without it, Checkout localizes by buyer location as soon as USD is on the price
  (Stripe docs: when no currency is passed, Checkout picks the presentment currency itself).
- Refuses with 400 "Plan price not configured" when the workspace is USD and the plan has no
  `price_usd` (monthly) / `price_usd_annual` (annual).
- For USD, retrieves the price (expand `currency_options`) and refuses with the same 400 when
  it has no `usd` option, so a plan repointed in Admin to a price without USD fails loudly
  instead of charging BRL. (Writer's call.)
- The currency goes into the checkout idempotency key. (Writer's call.)
- Passes `locale: 'en'` for USD workspaces, `'pt-BR'` for BRL.
- `allow_promotion_codes` stays. Existing `amount_off` coupons are BRL and won't apply to USD
  sessions; USD promos in v1 are `percent_off` only (runbook note).

`billing-portal`: no code change. Portal plan switching stays within the subscription's
currency. The runbook audits the Stripe portal configuration: every price it offers for plan
switching must be one of the six that get a USD option, or be removed from the list.
(Writer's call.)

### 4. Subscription amount mirror

`_shared/stripe-amount.ts` (used by the webhook, metrics backfill and the Pagar.me switch undo):
- Expand `items.data.price.currency_options` alongside the current expands (`:141`).
- `currency = subscription.currency`, never `item.price.currency` (`:120`).
- Gross = `price.currency_options[currency].unit_amount`, or `price.unit_amount` only when
  `currency === price.currency`, × quantity (`:104`).
- `amount_off` discounts (`:112-113`): subtract only when the coupon's currency matches, or
  from `coupon.currency_options[currency].amount_off`; otherwise ignore and log.
- Result: `workspace_subscriptions.amount_cents/gross_cents/currency` are right for USD.
- Every caller that fetches subscriptions itself must request the same expansion. In
  particular `platform-admin/metrics-backfill.ts:145` lists subscriptions with
  `expand: ["data.discounts"]` only; it becomes
  `["data.discounts", "data.items.data.price.currency_options"]`, kept in any retry path.

### 5. Metrics (Admin)

No FX anywhere: every money figure carries its currency, and totals are always per currency.

- **Snapshots.** History lives in per-workspace rows of `workspace_subscription_snapshots`
  (one `monthly_cents` each). Add `currency text not null default 'brl'` to each row
  (existing rows are BRL, which is true today). `metrics-snapshot-cron`,
  `_shared/metrics-snapshot.ts` and the backfill write it.
- **Aggregation.** `metrics-logic.ts` (history, movements, churn, provider and plan
  breakdowns), `_shared/billing-logic.ts aggregateMrr`, `pricing.ts resolveMirrorAmount`
  (fallback uses `price_usd*` for USD) and `workspace-detail.ts` group by currency; nothing
  sums `monthly_cents` across currencies.
- **API contracts.** `platform-admin` MRR, churn and history responses replace the single
  `currency: "brl"` total with `totals: { brl: {...}, usd: {...} }` (same fields per
  currency; `usd` present even when zero) and every workspace row gains `currency`.
  Movements (new, expansion, churn) are per currency the same way.
- **Consumers.** Admin Métricas renders BRL as today plus a USD block hidden while all USD
  figures are zero. `mcp-admin/queries.ts` (`get_dashboard`) returns both currencies.
- **Deposits.** Stripe balance (available and pending), pending balance transactions /
  money in transit, forecast, recent payouts and the summary are all keyed by currency
  (`{ brl: ..., usd: ... }`); today's BRL filters in `deposits-logic.ts` (~`:353-391`) become
  a group-by. The Admin card shows a USD row when any USD figure is non-zero. If the Stripe
  account settles USD into BRL (see Open question), the USD side is simply always empty.
- `metrics-backfill(-logic).ts` uses the fixed `stripe-amount` helper and keeps the currency.
- `admin_list_workspaces` (migration `20261130000001`): price fallback uses the workspace's
  currency.

### 6. Affiliates

v1: USD invoices produce **no commission row** (`affiliate-commission.ts` skips when
`invoice.currency !== 'brl'`, with a log line). Reason: payouts are BRL transfers
(`affiliate-connect.ts:138`) and the balance RPC sums across currencies, so recording USD
would pay USD cents as reais. Revisit if a US affiliate channel appears.

### 7. Pagar.me guards

- `pagarme-checkout` (normal path and the Stripe→12x switch) refuses USD workspaces (409).
- `stripeSwitchSourceEligible` returns false for non-BRL subscriptions.
- Frontend: `isPagarme12xEnabled` also requires a BRL workspace, so the 12x UI is unreachable
  from a USD workspace.

### 8. Stripe setup (manual, one time, live account shared by prod and staging)

Only after the `billing-checkout` change is live on **both** prod and staging:
- Add `currency_options.usd.unit_amount` to the six existing prices:
  Start 2900 / 27900, Pro 4900 / 46900, Max 7900 / 75900.
- If any of those prices has a `tax_behavior`, give the USD option the same one.
- Rehearse on test-mode copies first: `currency: 'usd'` shows the USD amount; `currency:
  'brl'` still shows BRL from a US IP/VPN.
- Done by the user or with explicit approval, never as a side effect of a deploy. Steps in
  `docs/usd-billing-runbook.md`.

### 9. Frontend (CRM)

Money shown from plans or the subscription uses the workspace currency:
- `services/billing.ts`: select `price_usd*`, `workspaces.billing_currency` and the mirror's
  `currency`; one `formatPlanPrice(cents, currency)` helper (`Intl.NumberFormat`, `en-US`/`USD`
  or `pt-BR`/`BRL`) replaces the local `formatBRL` copies.
- `CobrancaPage`, `plan-display.ts`, `ReverseTrialBanner`, `ReverseTrialEndDialog`, `/comecar`
  (`ComecarPage`, `TrialPlanPicker`, `recommend.ts`): helper plus the right price columns; no
  12x text for USD; "R$ 0 hoje" becomes the formatted zero.
- `lib/googleAdsLoader.ts` (`reportPurchaseConversion`, `rememberCheckoutValue`): remember and
  send the real currency to Google, Meta and OpenAI.
- `PricingSection` and `jsonld.ts` stay BRL here; the `/en` versions come in part 2.
- Copy language is unchanged; English wording for these screens is part 2/3.

### 10. Lifecycle emails

`_shared/lifecycle-emails.ts` formats with the row's currency (`formatMoney` already supports
it; callers stop hard-coding `"brl"`). `get_trial_reminder_candidates` and
`get_reverse_trial_email_candidates` return the currency and the matching price column. Email
language is part 3.

## Deploy order

1. Migration: `workspaces.billing_currency` + guard + signup trigger, `plans.price_usd*`,
   snapshot columns, RPC updates. All additive; BR behaviour unchanged.
2. Edge: `billing-checkout` (currency pinned) first, on prod and staging. Then
   `stripe-webhook`, `pagarme-checkout`, `pagarme-subscription`, `metrics-snapshot-cron`,
   `lifecycle-email-cron`, the functions bundling `affiliate-commission.ts`, and the eight
   `_shared/entitlements.ts` importers (`platform-admin` included).
3. Merge (frontend + Admin).
4. Stripe `currency_options` (§8), with approval.
5. Set the six `price_usd*` values in Admin.
6. End-to-end with one **real** USD purchase (user's decision, 2026-11-25): an internal
   workspace (`is_internal`) flipped to USD by the admin action buys Start monthly; check the
   webhook mirror, Cobrança page, Admin metrics (internal excluded as today) and portal; then
   refund in Stripe and cancel the subscription.

## Stripe account capability (checked 2026-11-25)

The Mesaas account is registered in Brazil. In **test mode** it accepted a BRL price with
`currency_options.usd` and opened a subscription Checkout with `currency: 'usd'`
(`amount_total: 2900`, `currency: usd`); the probe product was archived afterwards. So no
second account or US entity is needed for v1.

Consequences:
- USD charges settle **converted to BRL** (Stripe's default for the account's settlement
  currency). The deposits USD side will normally be empty; the per-currency shape stays so
  nothing is summed wrongly if that ever changes.
- US cards are international cards for a BR account: Stripe BR pricing adds about 2% on top of
  the domestic rate, plus currency conversion. Accepted cost for v1; a US entity/account can
  come later without changing this design beyond account routing.
- Live mode is confirmed by the real purchase in Deploy order step 6.

Rollback: frontend first; edge functions can stay (BRL behaves as today). Removing
`currency_options` from Stripe is safe only while no USD subscription exists.

## Left to the builder

- Exact snapshot column names and which money totals get a USD twin.
- Admin layout of the USD figures.
- Where `set-workspace-currency` lives in the Admin (workspace detail vs overrides panel).
