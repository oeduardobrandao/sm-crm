# USD Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a workspace whose billing currency is USD buy Start/Pro/Max through Stripe in dollars, with every amount recorded, shown and summed in its own currency.

**Architecture:** One `workspaces.billing_currency` (`brl` | `usd`) fixed before the first checkout (lock RPC). The six existing Stripe prices get a USD `currency_options` entry; checkout pins `currency`. The amount helper reads `subscription.currency` and the matching currency option. Metrics, MRR, churn and deposits partition rows by currency and run the existing logic once per currency; nothing sums across currencies.

**Tech Stack:** Postgres migrations + psql entitlement suites, Deno edge functions (`deno test`), React 19 CRM and Admin (Vitest).

**Spec:** `docs/superpowers/specs/2026-11-25-usd-billing-design.md`

## Global Constraints

- USD prices (cents): Start 2900 / 27900, Pro 4900 / 46900, Max 7900 / 75900 (monthly / annual).
- Currency codes are lowercase `brl` / `usd` everywhere in the DB and edge code; `Intl` uses `BRL` / `USD`.
- New migrations use fresh unique versions above main's tail (`20261130000002`): this plan uses `20261205000001` and `20261205000002`. Re-check main's tail right before opening the PR and renumber if needed.
- Never edit an applied migration. Redefine functions with `CREATE OR REPLACE` in the new files, copying the latest definition first.
- Edge functions never return raw errors to clients; generic messages, details in logs.
- `billing-checkout` with the pinned currency deploys to prod and staging before any Stripe `currency_options` exist.
- No em-dashes in user-facing copy.
- BRL behaviour must be byte-identical: every existing test keeps passing unchanged unless a task says otherwise.
- API refinement over the spec, for deploy safety: Admin/MCP responses keep their current top-level BRL fields (now BRL-only) and add a `usd` block, instead of replacing them with `totals: {brl, usd}`. Old Admin bundles keep working during the edge-first deploy.

## Review Focus

1. A checkout is started (currency locked) and abandoned, then an admin tries to flip the currency: must be refused with `currency_locked`. (Task 1 test.)
2. A USD workspace reuses a Stripe customer whose existing subscription is BRL: checkout must 409, never open a session. (Task 3 test.)
3. A USD subscription with a 100% `percent_off` coupon: mirror records 0 cents `usd`, snapshot classifies it as not paying, same as BRL today. (Task 2 test.)
4. A USD subscription carrying a BRL `amount_off` coupon with no USD option: discount ignored (gross kept), logged, currency still `usd`. (Task 2 test.)
5. A USD workspace on a plan with `price_usd_annual` null asks for annual: 400 "Plan price not configured", no Stripe call. (Task 3 test.)

---

### Task 1: Schema, guard and currency lock

**Files:**
- Create: `supabase/migrations/20261205000001_usd_billing_schema.sql`
- Create: `supabase/tests/entitlements/99_usd_billing_currency.sql`
- Modify: `supabase/tests/entitlements/99_workspace_billing_column_guard.sql` (add the two new columns to its cases)

**Interfaces:**
- Produces (SQL, all `SECURITY DEFINER`, `search_path = ''`, `EXECUTE` granted to `service_role` only, revoked from `PUBLIC, anon, authenticated` by name):
  - `public.billing_currency_lock(p_workspace_id uuid) returns text`: `update workspaces set billing_currency_locked_at = coalesce(billing_currency_locked_at, now()) where id = p_workspace_id returning billing_currency`; raises `workspace_not_found` when no row.
  - `public.billing_currency_set(p_workspace_id uuid, p_currency text) returns boolean`: true when updated; false when `billing_currency_locked_at is not null`; raises on a currency outside `('brl','usd')`.
- Produces (columns): `workspaces.billing_currency text not null default 'brl' check in ('brl','usd')`, `workspaces.billing_currency_locked_at timestamptz null`, `plans.price_usd integer null`, `plans.price_usd_annual integer null` (both `check (>= 0)`), `workspace_subscription_snapshots.currency text not null default 'brl' check in ('brl','usd')`.
- Produces (trigger): `on_auth_user_created_zz_billing_market` AFTER INSERT on `auth.users`, function `public.handle_new_user_billing_market()` (DEFINER): when `NEW.raw_user_meta_data ->> 'market' = 'us'` and the user is not an invitee (`raw_user_meta_data ->> 'conta_id'` empty), `update workspaces set billing_currency = 'usd' where created_by = NEW.id`. Name sorts after `on_auth_user_created_workspace` so the workspace exists (same ordering rule as the affiliate trigger in CLAUDE.md).

- [ ] **Step 1: Write the failing psql suite** `99_usd_billing_currency.sql`, in the style of `99_workspace_billing_column_guard.sql`:
  - `authenticated` owner updating `billing_currency` or `billing_currency_locked_at` → `42501 workspace_billing_columns_read_only`.
  - Signup with metadata `{"market":"us"}` → workspace `billing_currency = 'usd'`; without it → `'brl'`; invitee with `market: us` → the host workspace is unchanged.
  - `billing_currency_set(ws,'usd')` on an unlocked workspace → true and value `usd`; after `billing_currency_lock(ws)` → `billing_currency_set` returns false and the value is unchanged; `billing_currency_lock` returns the current currency and keeps the first `locked_at` on a second call.
  - `authenticated` cannot `EXECUTE` either RPC.
  - `billing_currency_set(ws,'eur')` raises.
- [ ] **Step 2: Run** `npm run test:db` (needs Docker; otherwise rely on CI `entitlement-tests`). Expected: FAIL, functions/columns missing.
- [ ] **Step 3: Write the migration.** Redefine `workspaces_guard_billing_columns()` from `20261129000002` adding `billing_currency` and `billing_currency_locked_at` to the IS DISTINCT FROM list; update its header comment list. Add the columns, RPCs and trigger above. Comment block at the top in Portuguese, same style as the guard migration.
- [ ] **Step 4: Run** `npm run test:db`. Expected: PASS, including the existing guard suite.
- [ ] **Step 5: Commit** `feat(db): moeda de cobrança do workspace e trava antes do checkout`.

### Task 2: Currency-aware Stripe amount

**Files:**
- Modify: `supabase/functions/_shared/stripe-amount.ts`
- Modify: `supabase/functions/platform-admin/metrics-backfill.ts:145`
- Test: `supabase/functions/__tests__/stripe-amount_test.ts` (create if absent; else extend the existing amount tests)

**Interfaces:**
- Produces: `stripeAmountFromSubscription(sub, fallbackInterval)` unchanged signature; now reads `sub.currency` and `price.currency_options[currency].unit_amount`. `CouponLike` gains `currency?: string | null; currency_options?: Record<string, { amount_off?: number | null }> | null`.
- Produces: `export const STRIPE_AMOUNT_EXPAND = ["items.data.price", "items.data.price.currency_options", "discounts"]` used by `fetchStripeAmount` (its fallback retry keeps `items.data.price.currency_options`).
- Produces: `export const STRIPE_LIST_AMOUNT_EXPAND = ["data.discounts", "data.items.data.price.currency_options"]` used by `metrics-backfill.ts` in place of `["data.discounts"]`, including any retry path.

- [ ] **Step 1: Write failing tests**
  - `usd subscription uses the currency option`: sub `{currency:'usd', items:[{quantity:1, price:{unit_amount:9990, currency:'brl', currency_options:{brl:{unit_amount:9990}, usd:{unit_amount:2900}}}}]}` → `amount_cents 2900`, `currency 'usd'`, `gross_cents null`.
  - `brl subscription unchanged`: same price, `currency:'brl'` → `9990`, `'brl'`.
  - `usd with 100% percent coupon` → `amount_cents 0`, `gross_cents 2900`, `currency 'usd'`.
  - `usd with brl amount_off coupon is ignored`: coupon `{id:'X', amount_off:1000, currency:'brl'}` → `amount_cents 2900`, `discount_label null`.
  - `usd with amount_off currency option`: coupon `{amount_off:1000, currency:'brl', currency_options:{usd:{amount_off:500}}}` → `2400`.
  - `missing sub.currency falls back to price.currency` (old fixtures) → `brl`.
  - `fetchStripeAmount requests currency_options` (fake client records the expand list).
- [ ] **Step 2: Run** `deno test --no-check supabase/functions/__tests__/stripe-amount_test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** in `stripe-amount.ts`; `console.warn` once when an `amount_off` coupon is skipped for currency mismatch (no amounts of personal data in the log). Update `metrics-backfill.ts` to use `STRIPE_LIST_AMOUNT_EXPAND`.
- [ ] **Step 4: Run** the test file plus `deno test --no-check supabase/functions/__tests__/platform-admin-metrics-backfill_test.ts supabase/functions/__tests__/billing-logic_test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `fix(billing): valor da assinatura lê a moeda da própria assinatura`.

### Task 3: Checkout pins the workspace currency

**Files:**
- Modify: `supabase/functions/billing-checkout/index.ts`
- Modify: `supabase/functions/_shared/billing-logic.ts` (pure helpers)
- Modify: `supabase/functions/_shared/trial.ts` (`buildCheckoutIdempotencyKey` takes the currency)
- Test: `supabase/functions/__tests__/billing-logic_test.ts`, `supabase/functions/__tests__/billing-checkout_test.ts` (extend if it exists; otherwise cover through the pure helpers)

**Interfaces:**
- Consumes: `billing_currency_lock` (Task 1), `plans.price_usd*`.
- Produces in `billing-logic.ts`:
  - `type BillingCurrency = "brl" | "usd"`.
  - `usdPriceConfigured(plan: { price_usd: number | null; price_usd_annual: number | null }, interval: "month" | "year"): boolean` (positive amount for that interval).
  - `customerCurrencyConflict(customerCurrency: string | null | undefined, workspaceCurrency: BillingCurrency): boolean` (true when the customer has a currency and it differs).
  - `checkoutLocale(currency: BillingCurrency): "en" | "pt-BR"`.
- Produces: `buildCheckoutIdempotencyKey(..., currency: BillingCurrency)` with the currency inside the key.

- [ ] **Step 1: Write failing tests** for the three helpers and the key (`usd` vs `brl` keys differ; same inputs same key). If a handler-level test harness exists for `billing-checkout`, add: USD workspace + plan without `price_usd_annual` + `interval: 'year'` → 400 `Plan price not configured` and no Stripe call; reused customer with `currency: 'brl'` on a USD workspace → 409 and no session; session params contain `currency: 'usd'` and `locale: 'en'`.
- [ ] **Step 2: Run** `deno test --no-check supabase/functions/__tests__/billing-logic_test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Order in the handler: after the owner check and plan read, call `billing_currency_lock(workspaceId)` (error → 500 generic). Select `price_usd, price_usd_annual` with the plan. For USD: refuse when `!usdPriceConfigured`, then `stripe.prices.retrieve(priceId, { expand: ["currency_options"] })` and refuse with the same 400 when `currency_options.usd` is absent. When reusing a customer, retrieve it and refuse 409 (generic Portuguese message, same tone as the existing 409s) when `customerCurrencyConflict(customer.currency, currency)`. Pass `currency` and `locale: checkoutLocale(currency)` to `checkout.sessions.create`, and the currency into the idempotency key. BRL path makes no extra Stripe calls besides passing `currency: 'brl'`.
- [ ] **Step 4: Run** the tests plus `npm run check:functions`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(billing): checkout fixa a moeda do workspace`.

### Task 4: Pagar.me refuses USD

**Files:**
- Modify: `supabase/functions/pagarme-checkout/logic.ts`, `supabase/functions/pagarme-checkout/handler.ts`
- Modify: `apps/crm/src/lib/pagarme-gate.ts`
- Test: `supabase/functions/__tests__/pagarme-checkout-logic_test.ts` (existing pagarme logic tests), `apps/crm/src/lib/__tests__/pagarme-gate.test.ts`

**Interfaces:**
- Produces: `stripeSwitchSourceEligible(row)` row type gains `currency: string | null`; returns false when `currency` is set and not `brl`.
- Produces: `isPagarme12xEnabled(plan, workspaceCurrency?: 'brl' | 'usd')`; false when `workspaceCurrency === 'usd'`. Default keeps today's behaviour.

- [ ] **Step 1: Write failing tests**: switch source with `currency:'usd'` → false; `currency:'brl'` or null → today's result. Gate with `'usd'` → false. Handler: USD workspace → 409 before any Pagar.me call (normal and switch path).
- [ ] **Step 2: Run** the two test files. Expected: FAIL.
- [ ] **Step 3: Implement**; the handler reads `workspaces.billing_currency` with its existing workspace read and refuses USD with a generic 409.
- [ ] **Step 4: Run** tests. Expected: PASS.
- [ ] **Step 5: Commit** `fix(pagarme): parcelado só para workspace em reais`.

### Task 5: No affiliate commission on non-BRL invoices

**Files:**
- Modify: `supabase/functions/_shared/affiliate-commission.ts` (`recordInvoiceCommission`)
- Test: `supabase/functions/__tests__/affiliate-commission_test.ts`

**Interfaces:**
- Produces: `CommissionOutcome` gains the variant `{ kind: "skipped"; reason: "non_brl_currency" }` (match the existing union's style).

- [ ] **Step 1: Failing test**: invoice `currency:'usd'` with a referred workspace → outcome `non_brl_currency`, no insert called on the deps fake. BRL invoice → unchanged.
- [ ] **Step 2: Run** the file. Expected: FAIL.
- [ ] **Step 3: Implement** the early return before any DB write, with a log line.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `fix(afiliados): fatura em USD não gera comissão`.

### Task 6: Snapshots and metrics history per currency

**Files:**
- Create: `supabase/migrations/20261205000002_usd_billing_rpcs.sql` (this task owns the snapshot RPC part; Task 9 adds to the same file)
- Modify: `supabase/functions/_shared/metrics-snapshot.ts`, `supabase/functions/metrics-snapshot-cron/index.ts`, `supabase/functions/platform-admin/pricing.ts`, `supabase/functions/platform-admin/metrics-logic.ts`, `supabase/functions/platform-admin/metrics-history.ts`, `supabase/functions/platform-admin/metrics-backfill-logic.ts`
- Test: `supabase/functions/__tests__/metrics-snapshot_test.ts`, `platform-admin-metrics-logic_test.ts`, `platform-admin-metrics-backfill-logic_test.ts` (existing names; extend)

**Interfaces:**
- Produces: `SnapshotRow`, `PricedSnapshotSource`, `SnapshotRecord` gain `currency: "brl" | "usd"`; `toSnapshotRows` copies it (null → `brl`).
- Produces: `admin_metrics_write_snapshot` (redefined in the new migration from its latest definition) persists `currency` from each row (missing key → `brl`).
- Produces: `resolveMirrorAmount(sub, plan)`: `PriceableSub` gains `currency: string | null` and `workspace_currency: "brl" | "usd"`; `PlanMeta` gains `price_usd`, `price_usd_annual`. Catalog fallback uses the USD columns for a USD workspace and returns `currency` alongside the amount.
- Produces: `get-metrics-history` response `{ months: MetricsMonth[] /* BRL only */, months_usd: MetricsMonth[] }`, built by `buildMonths` over rows filtered by currency (no change inside `buildMonths`).

- [ ] **Step 1: Failing tests**: `toSnapshotRows` keeps `usd`; history with one BRL paying row (13990) and one USD paying row (4900) → `months[i].mrr_cents === 13990`, `months_usd[i].mrr_cents === 4900`; `resolveMirrorAmount` for a USD workspace with no mirror amount on monthly Pro → `{ cents: 4900, currency: 'usd', source: 'catalog' }` (match the function's existing return shape plus `currency`).
- [ ] **Step 2: Run** the three files. Expected: FAIL.
- [ ] **Step 3: Implement.** The cron selects `workspaces.billing_currency` for the workspaces it prices and `price_usd*` from plans; the backfill keeps the currency from `stripeAmountFromSubscription`.
- [ ] **Step 4: Run** tests and `npm run check:functions`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(metricas): histórico separado por moeda`.

### Task 7: MRR, churn, workspace detail and MCP admin per currency

**Files:**
- Modify: `supabase/functions/platform-admin/mrr.ts`, `churn.ts`, `workspace-detail.ts`, `supabase/functions/_shared/billing-logic.ts` (`aggregateMrr`), `supabase/functions/mcp-admin/queries.ts`
- Test: existing `platform-admin-mrr_test.ts`, `platform-admin-churn_test.ts`, `billing-logic_test.ts`, `mcp-admin` queries test (extend)

**Interfaces:**
- Consumes: `resolveMirrorAmount` with currency (Task 6).
- Produces: `get-mrr` → `{ mrr_cents, paying_count, currency: "brl", workspaces, usd: { mrr_cents, paying_count } }`; top-level totals are BRL-only; every workspace row gains `currency`. `get-trials` the same pattern (`trial_mrr_cents` BRL-only, `usd: { trial_mrr_cents, trial_count }`). `get-churned` → existing fields BRL-only plus `usd: { lost_mrr_cents, churn_count }`, rows gain `currency`.
- Produces: MCP `get_dashboard` → `mrr` gains `usd: { mrr_cents, paying_count }`, `trials` gains `usd`.

- [ ] **Step 1: Failing tests**: one BRL and one USD paying row → top-level `mrr_cents` equals the BRL row only, `usd.mrr_cents` the USD row, both rows listed with their `currency`. Same for churn `lost_mrr_cents`. MCP dashboard exposes `usd`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** by partitioning priced rows by currency and calling `aggregateMrr` per partition. `workspace-detail.ts` catalog fallback uses the workspace currency.
- [ ] **Step 4: Run** tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(admin): MRR e churn separados por moeda`.

### Task 8: Deposits per currency

**Files:**
- Modify: `supabase/functions/platform-admin/deposits-logic.ts`, `deposits.ts`
- Test: existing `platform-admin-deposits-logic_test.ts`

**Interfaces:**
- Produces: `buildStripeDeposits(raw, today, currency: "brl" | "usd" = "brl")`; `ProviderDeposits.balance.currency` widens to `"brl" | "usd"`.
- Produces: `get-deposits` response gains `stripe_usd: ProviderDeposits | null`, null when `raw` has no USD balance entry, payout or pending transaction. `summarize` stays BRL-only.

- [ ] **Step 1: Failing tests**: raw with a USD pending transaction and a USD payout → `buildStripeDeposits(raw, today, 'usd')` contains them and the BRL build excludes them; raw with no USD → `stripe_usd` null.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** (`pickBrlAmount` becomes `pickAmount(entries, currency)`).
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(admin): depósitos Stripe em USD à parte`.

### Task 9: Admin actions, plan USD prices and email candidates

**Files:**
- Modify: `supabase/migrations/20261205000002_usd_billing_rpcs.sql` (add redefinitions of `get_trial_reminder_candidates`, `get_reverse_trial_email_candidates`, `admin_list_workspaces` from `20261130000001`)
- Modify: `supabase/functions/platform-admin/index.ts`, `plan-mutations.ts`, new `supabase/functions/platform-admin/workspace-currency.ts`
- Modify: `supabase/functions/_shared/lifecycle-emails.ts`, `supabase/functions/lifecycle-email-cron/*`
- Test: `platform-admin-plan-mutations_test.ts`, new `platform-admin-workspace-currency_test.ts`, `lifecycle-emails_test.ts` (existing names; extend)

**Interfaces:**
- Consumes: `billing_currency_set` (Task 1).
- Produces: action `set-workspace-currency` body `{ workspace_id: string, currency: "brl" | "usd" }` → 200 `{ ok: true }`; 409 `{ error: "currency_locked" }` when the RPC returns false; 400 on bad input; audited with `insertAuditLog`.
- Produces: plan save accepts `price_usd`, `price_usd_annual` (non-negative integers or null), same validation as the BRL fields.
- Produces: the two candidate RPCs return `currency text` and the matching price (`price_usd*` for USD workspaces); `admin_list_workspaces` fallback uses the workspace currency.
- Produces: `FirstChargeInput` gains `currency: string`; `formatFirstCharge` and the reverse-trial ending email use `formatMoney(cents, currency)`.

- [ ] **Step 1: Failing tests**: currency action happy path, locked → 409, bad currency → 400; plan save round-trips `price_usd`; `formatFirstCharge({ cents: 2900, currency: 'usd', ... })` contains `US$ 29,00` (pt-BR formatting of USD, since email language is part 3).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** tests, `npm run check:functions`, `npm run test:db`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(admin): moeda do workspace e preços em USD dos planos`.

### Task 10: CRM shows and reports the workspace currency

**Files:**
- Create: `apps/crm/src/lib/planPrice.ts`
- Modify: `apps/crm/src/services/billing.ts`, `apps/crm/src/pages/configuracao/cobranca/CobrancaPage.tsx`, `plan-display.ts`, `apps/crm/src/components/billing/ReverseTrialBanner.tsx`, `ReverseTrialEndDialog.tsx`, `apps/crm/src/pages/comecar/ComecarPage.tsx`, `TrialPlanPicker.tsx`, `recommend.ts`, `apps/crm/src/lib/googleAdsLoader.ts`
- Test: `apps/crm/src/lib/__tests__/planPrice.test.ts`, existing tests of the touched screens and `googleAdsLoader`

**Interfaces:**
- Produces in `planPrice.ts`:
  - `type BillingCurrency = 'brl' | 'usd'`.
  - `formatPlanPrice(cents: number, currency: BillingCurrency): string` (`Intl.NumberFormat`, `pt-BR`/`BRL` or `en-US`/`USD`; zero renders as the formatted zero).
  - `planMonthlyCents(plan, currency)`, `planAnnualCents(plan, currency)`: read `price_brl*` or `price_usd*`.
- Produces: `BillingPlan` gains `price_usd`, `price_usd_annual`; the workspace read returns `billingCurrency: BillingCurrency`; the subscription read returns `currency: string | null`.
- Produces: `rememberCheckoutValue(cents, currency: BillingCurrency = 'brl')` stores both; `reportPurchaseConversion` sends the stored currency (uppercase) to Google, Meta and OpenAI.

- [ ] **Step 1: Failing tests**: `formatPlanPrice(2900,'usd') === '$29.00'`, `formatPlanPrice(9990,'brl')` matches today's `R$ 99,90` output (normalize the NBSP like existing tests do); a USD workspace on Cobrança shows `$49.00` for Pro monthly and no 12x text; `reportPurchaseConversion` after `rememberCheckoutValue(4900,'usd')` sends `currency: 'USD'` to all three.
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/lib/__tests__/planPrice.test.ts` and the touched screen tests. Expected: FAIL.
- [ ] **Step 3: Implement**; replace local `formatBRL`/`formatCentavosBRL` copies on these screens with `formatPlanPrice`; pass the workspace currency to `isPagarme12xEnabled`. Copy and i18n keys unchanged. `PricingSection` and `jsonld.ts` untouched.
- [ ] **Step 4: Run** `npm run test`, the five `tsc` commands from CLAUDE.md, `npm run lint`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(cobranca): preços e conversões na moeda do workspace`.

### Task 11: Admin UI

**Files:**
- Modify: `apps/admin/src/pages/plans/PlanFormFields.tsx`, `apps/admin/src/pages/plan-form.ts`, `apps/admin/src/lib/api.ts`, `apps/admin/src/pages/MetricasPage.tsx` (and its `metricas/` components), `apps/admin/src/pages/WorkspaceDetailPage.tsx`, the deposits card under `metricas/`
- Test: `apps/admin/src/pages/__tests__/plan-form.test.ts` and the metrics/workspace-detail tests (extend)

**Interfaces:**
- Consumes: responses from Tasks 6-9.
- Produces: plan form fields "Preço mensal (USD)" / "Preço anual (USD)" next to the BRL ones; Métricas shows a USD block (MRR, pagantes, histórico, churn, depósitos) only when any USD figure is non-zero or `stripe_usd` is non-null; Workspace detail shows "Moeda de cobrança" with a BRL/USD switch calling `set-workspace-currency`, disabled with the hint "Travada após o primeiro checkout" on 409.

- [ ] **Step 1: Failing tests**: plan form serializes the USD fields; Métricas hides the USD block for all-zero `usd`, shows `US$ 49,00` when present (Admin copy is Portuguese); currency switch shows the locked hint on 409.
- [ ] **Step 2: Run** the admin tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run test`, `npx tsc -p apps/admin/tsconfig.json --noEmit`, `npm run lint`, `npm run format:check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(admin): preços USD, métricas e moeda do workspace`.

### Task 12: Runbook and project notes

**Files:**
- Create: `docs/usd-billing-runbook.md`
- Modify: `CLAUDE.md` (one Gotchas bullet)

- [ ] **Step 1: Write the runbook**: deploy order from the spec (migrations → `billing-checkout` on prod and staging → other functions incl. the eight `_shared/entitlements.ts` importers → merge → Stripe `currency_options` → Admin `price_usd*` → real purchase + refund on an internal workspace); the Stripe CLI commands to add the USD option to each of the six live price IDs (from the spec's Prices table and `plans.stripe_price_id*`), with `tax_behavior` copied when set, run only with the user's approval; portal configuration audit; percent-off-only promos for USD; manual SQL to unlock a currency (`update workspaces set billing_currency_locked_at = null ...`) and when it is safe (no Stripe customer); rollback notes.
- [ ] **Step 2: Add the CLAUDE.md bullet**: USD billing spec/runbook paths; `billing_currency` is guarded and locked at first checkout; checkout must always pass `currency`; never sum `monthly_cents`/`amount_cents` across currencies; deploy order.
- [ ] **Step 3: Run** `npm run format:check`. Expected: PASS.
- [ ] **Step 4: Commit** `docs: runbook da cobrança em USD`.

---

Final gate before the PR: `npm run lint`, `npm run format:check`, the five `tsc` commands, `npm run test`, `npm run check:functions`, `npm run test:functions`; renumber migrations if main's tail moved.
