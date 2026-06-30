# Pricing migration — Slice 1: Core seats + clients model

**Date:** 2026-06-29
**Status:** Draft for review (brainstormed → multi-agent design + adversarial-verify pass)
**Branch:** `docs/pricing-seats-clients-spec` (spec); implementation lands on `feat/pricing-seats-clients` off `main`
**Related:** [`2026-06-09-stripe-payments-money-in-design.md`](2026-06-09-stripe-payments-money-in-design.md) (money-in loop) · [`2026-06-11-paywall-feature-gating-design.md`](2026-06-11-paywall-feature-gating-design.md) (paywall enforcement)

> **This is Slice 1 of 5** in the migration from feature-gated tiers to a clients + seats hybrid. Roadmap: **Slice 1** core money model (this spec) · **Slice 2** smooth-meter UX (one-click add-seat / upgrade-tier) · **Slice 3** 14-day no-card trial · **Slice 4** grandfather + sunset old plans · **Slice 5** retire feature-gating. Each slice is its own spec → plan → build.

## 1. Context & goal

Mesaas CRM bills via a paywall that is **already live in production**. The current catalog is feature-gated/limited tiers (`free`, `start`, `pro`, `max` + comp-only `lifetime`). We are migrating to a **clients + seats hybrid**: "everything included", priced by team size (seats) and book size (clients).

Slice 1 ships the **money model only**: the three new self-serve tiers as additive catalog rows, **Stripe quantity-based seats** (checkout + webhook + entitlement wiring + a seat selector in the billing UI). It is strictly additive and must not change entitlements for any existing or new user. The trial funnel (Slice 3), grandfather sunset (Slice 4), smooth-meter UX (Slice 2), and feature-gate retirement (Slice 5) are out of scope.

**Goal of this spec:** be the single source of truth a developer builds Slice 1 from, with every blocker/high adversarial finding folded into the design.

## 2. The pricing model

### Tiers (illustrative BRL — final numbers TBD in a willingness-to-pay pass)

| Tier (new id) | Price/mo | Price/yr | Clients | Seats incl. | AI cap/mo | Other limits | Features |
|---|---|---|---|---|---|---|---|
| `starter` | R$110 (`11000`¢) | R$1100 (`110000`¢) | 10 | 2 | 30 | all `max_*` NULL (unlimited) | all `feature_*` = TRUE |
| `agency` | R$179 (`17900`¢) | R$1790 (`179000`¢) | 30 | 5 | 100 | all `max_*` NULL | all `feature_*` = TRUE |
| `scale` | R$279 (`27900`¢) | R$2790 (`279000`¢) | **unlimited** (NULL) | 10 | 300 | all `max_*` NULL | all `feature_*` = TRUE |
| Seat add-on | ~R$25 (`2500`¢) | ~R$250 (`25000`¢) | — | +1 per qty | — | Stripe quantity line item | — |

> Prices are in **centavos** (`11000` = R$110,00). Annual ≈ 10× monthly (2 months free) — applies to tiers **and** the seat add-on.

### What "everything included" means
- **ALL `feature_*` columns = TRUE** on the three new tiers, set **explicitly by enumerating the live column list** in the migration (do not rely on INSERT/column defaults — the `feature_mcp boolean NOT NULL DEFAULT false` pattern means an unlisted flag silently ships `false` and re-gates a paid tier).
- Structural `max_*` limits removed (NULL = unlimited) **except** `max_clients` (10 / 30 / NULL) and `max_team_members` (2 / 5 / 10).

### AI-only fair-use cap
- The **only** retained rate cap is `rate_ai_analyses_per_month`, scaled per tier (30 / 100 / 300).
- `rate_instagram_syncs_per_day = NULL`, `rate_report_generations_per_month = NULL`, `storage_quota_bytes = NULL` (uncapped). A light storage **abuse** ceiling is a separate out-of-band guard, **not** a plan column and **not** in Slice 1.

### Seats = a Stripe quantity add-on
- Seats are a **separate Stripe Price** (one shared seat price object across all three tiers) attached as a **second line item** with `quantity = N`.
- **N = EXTRA seats beyond the tier-included base** (NOT total). `total_seats = plan.max_team_members + N`, `N >= 0`. The included seats are already priced into the tier, so `N = total` would double-bill the base.
- Checkout, webhook, and the entitlement SQL must all agree on **EXTRA**.

### Clients = tier-bump only
No client packs, no usage-overage billing. More clients = upgrade to the next tier (Scale = unlimited). The seat line item never touches clients.

## 3. Scope of Slice 1

### In-scope
- **Catalog:** add `starter` / `agency` / `scale` rows (additive); add two seat-price-id columns to `plans`.
- **Stripe products/prices:** 3 tiers × {monthly, annual} + seat add-on × {monthly, annual} = **8 Price objects** created in Stripe (dashboard/API, not repo).
- **Checkout** (`billing-checkout`): accept new tier ids; append a seat line item when `extra_seats > 0`.
- **Webhook** (`stripe-webhook`): **multi-item, order-independent** classification; persist purchased seats; never downgrade on unresolved tier.
- **Entitlement:** new `workspace_subscriptions.purchased_seats` column; make `effective_plan_limit('max_team_members')` additive.
- **In-app seat change:** new owner-only `billing-seats` edge function (validated Stripe `subscriptions.update` with proration).
- **Billing UI** (`CobrancaPage`): seat selector + cost breakdown at checkout; current seat usage; in-app add/remove seats.
- **Admin UI** (`PlansPage`): two seat-price-id text fields.
- **`platform-admin` amount calc:** sum across items (currently reads `data[0]`).
- **`PAID_PLANS`:** updated to the new tier ids (DB-driven check recommended).

### Explicitly deferred
| Item | Slice |
|---|---|
| Flip `free`/`start`/`pro`/`max` to `is_active=false`; grandfather-display generalization in `plan-display.ts` | **Slice 4** |
| One-click add-seat / upgrade-tier when `plan_limit_exceeded` fires (contextual upsell) | **Slice 2** |
| 14-day no-card trial; moving `is_default` off `free` | **Slice 3** (BEMVINDO 30-day promo stays byte-for-byte untouched) |
| Retiring feature-gating / removing the 24 `FeatureGate` call-sites | **Slice 5** (only flip `feature_*` TRUE on new rows here) |
| AI cap scaling beyond setting the column values; storage abuse ceiling | catalog data / separate guard, not Stripe plumbing |
| Willingness-to-pay price tuning | later pass (numbers here are placeholders) |

> **Decision (scope-boundary finding):** Slice 1 is **additive only** — it does **not** flip old plans inactive. Old `start`/`pro`/`max` stay `is_active=true` and purchasable until Slice 4, which avoids a grandfathered-subscriber UI regression (their `is_active=true`-filtered current-plan card would otherwise vanish) and any purchase gap.

## 4. Technical design

### 4.1 Stripe checkout — `supabase/functions/billing-checkout/index.ts`

- **`PAID_PLANS` (line 8):** replace the hardcoded `["start","pro","max"]`. **Recommended:** drop the constant and validate against the DB — the plan must exist, be `is_active=true`, and have a `stripe_price_id`. This makes the catalog the single source of truth so Slice 4's `is_active` flip automatically removes old tiers from purchase. (Interim acceptable: add `starter`/`agency`/`scale` to the array and keep the old ids until Slice 4.)
- **Plans select (line ~44):** add `stripe_price_id_seat, stripe_price_id_seat_annual`.
- **Seat input:** read `body.extra_seats`, clamp to a non-negative integer (default 0).
- **Seat price pick:** `seatPriceId = interval === "year" ? plan.stripe_price_id_seat_annual : plan.stripe_price_id_seat`.
- **Line items:** start `[{ price: priceId, quantity: 1 }]`; when `extra_seats > 0`, push `{ price: seatPriceId, quantity: extra_seats }`.
- **Guards (Stripe-correctness finding):** if `extra_seats > 0` and `seatPriceId` is falsy → return `400 "Seat price not configured for this interval"` **before** any Stripe call. This prevents attaching a monthly seat price to an annual subscription (Stripe rejects mixed intervals). The seat Price objects must be created with `recurring.interval` matching the tier and `currency = brl`.
- **Metadata:** add `seats: String(extra_seats)` to `subscription_data.metadata` for **audit only**. **Hard rule:** metadata is client-influenced and must **never** be read as an entitlement source.
- **Trial:** leave the `LAUNCH_PROMO` / `trial_period_days` / `payment_method_collection` logic **byte-for-byte unchanged**. The seat item is just another `line_items` entry; it does not touch `subscription_data.trial_period_days`.

### 4.2 Stripe webhook — `supabase/functions/stripe-webhook/index.ts`

The current `syncSubscription` reads `sub.items?.data?.[0]?.price?.id` for **both** plan resolution **and** the `current_period_end` basil fallback. With a second (seat) line item, array order is **non-deterministic** — this is a **blocker**.

- **Classify by price_id, never by index.** Iterate **all** `sub.items`:
  - Resolve the **tier** item via `resolvePlanFromPriceId` (tier-only matching).
  - Compute purchased seats via the new `resolveSubscriptionSeats` helper (the seat item's `quantity`, `0` if none).
- **`current_period_end`:** prefer the subscription-root value; for the basil fallback read the period end from the **resolved tier item**, never `data[0]`.
- **Never silently downgrade (blocker).** Today, an unresolved `priceId` falls back to `defaultPlanId` → a paying customer's `plan_id` is written to `free`. Change the contract: **if no item resolves to a known TIER price, leave `workspaces.plan_id` unchanged** (skip `writeWorkspacePlan`, matching `past_due`/`incomplete` null semantics). On an **active** sub with a seat item but **no resolvable tier**, log an internal error and **throw** (return 5xx) so Stripe redelivers and it's investigated — never write the default. (A shared seat price cannot identify a tier, so a seat-only fallback cannot recover it.)
- **Preserve existing plan_id on unresolved (low finding):** when no tier resolves, do **not** overwrite `workspace_subscriptions.plan_id` with `null` — read the current row and keep the prior `plan_id`.
- **`loadPlanPriceRows` (line ~173):** extend the select to include `stripe_price_id_seat, stripe_price_id_seat_annual`. **Deploy ordering is load-bearing:** the plans column migration must be applied **before** this deploy, or the select errors on a missing column and **every** webhook (including existing renewals) returns 500.
- **Persist seats, status-aware (blocker — cancel bypass).** Write `purchased_seats` to the `workspace_subscriptions` upsert, but derive it from status: persist the Stripe quantity **only** when `status ∈ ('active','trialing')`; for `canceled`/`unpaid`/`incomplete_expired`/`paused` write `0`. Otherwise a canceled sub keeps its last seat count and `effective_plan_limit` grants `free_base + stale_seats` forever — a billing bypass. (Belt-and-suspenders: the SQL also gates on status, §4.4.)
- **Idempotency / out-of-order (medium):** dedup by `event_id` is unchanged. For `customer.subscription.updated/.deleted`, the handler uses the event payload snapshot; rapid seat ping-pong can deliver out of order. Acceptable for Slice 1; covered by a regression test asserting final stored seats match the latest state (consider re-`retrieve`ing the sub if flakiness appears).

**New pure helpers in `supabase/functions/_shared/billing-logic.ts`** (no Stripe/Supabase/env deps, Deno-unit-testable):
- Extend `PlanPriceRow` with `stripe_price_id_seat: string | null` and `stripe_price_id_seat_annual: string | null`.
- `resolveSubscriptionSeats(subItems, plans): { purchased_seats: number }` — sum the quantity of any item whose `price.id` matches a known seat price id; `0` if none; order-independent.
- `resolvePlanFromPriceId` keeps matching **only tier** prices (a seat price resolves to **null-as-tier**) so the webhook never mis-sets `plan_id` to a seat "plan".

### 4.3 Plan catalog & migration

**New migration `supabase/migrations/20260630000001_plans_seats_and_new_tiers.sql`** (additive, idempotent):
1. `ALTER TABLE plans ADD COLUMN IF NOT EXISTS stripe_price_id_seat text; ADD COLUMN IF NOT EXISTS stripe_price_id_seat_annual text;`
2. `INSERT INTO plans (...) VALUES (...) ON CONFLICT (id) DO UPDATE SET ...` for `starter`/`agency`/`scale` with the §2 values: `max_clients` 10/30/NULL, `max_team_members` 2/5/10, **every** `feature_*` = TRUE (enumerate live columns), `rate_ai_analyses_per_month` 30/100/300, all other `rate_*` and `storage_quota_bytes` NULL, `is_active=true`, `is_default=false`, `sort_order` 10/20/30. Stripe price-id columns left NULL (pasted via admin after Stripe objects exist).
3. **Do NOT** touch `is_default` (stays on `free`) and **do NOT** flip old plans inactive (deferred to Slice 4).

> **`plans_single_default` guard:** a partial UNIQUE index (`where is_default = true`) allows exactly one default. Slice 1 doesn't move it. If ever moved (Slice 3), do it atomically: `UPDATE plans SET is_default=false WHERE is_default=true;` then `UPDATE ... SET is_default=true WHERE id='<new>';` in one transaction.

**`supabase/seed.sql`:** add the three new rows mirroring the migration (Stripe ids omitted), keep `is_default=true` on `free`, so `supabase db reset` stays consistent.

**Why this is non-behavioral:** `effective_plan_limit`/`effective_plan_feature` only fall back to `is_default` when `workspaces.plan_id IS NULL`; migration 20260611130000 backfilled every workspace to an explicit `plan_id`. Adding rows and not moving `is_default` cannot change any existing or new user's entitlements.

**Admin — `apps/admin/src/lib/api.ts` + `apps/admin/src/pages/PlansPage.tsx`:** add `stripe_price_id_seat` / `stripe_price_id_seat_annual` to the `Plan` interface and two text fields ("Seat Price ID (monthly)" / "Seat Price ID (annual)") wired through `FormState`/`planToForm`/`formToPayload` exactly like `stripe_price_id`. This is where the operator pastes the seat price ids.

### 4.4 Seat entitlement & enforcement

**Storage decision (resolves a cross-area conflict — blocker):** purchased seats live in a **dedicated `workspace_subscriptions.purchased_seats int NOT NULL DEFAULT 0`** column (EXTRA seats). **Reject** writing to `workspace_plan_overrides.resource_overrides->>'max_team_members'`: that key is the admin-comp channel (`plan_source='manual'`, **replacement** semantics, read first by the RPC); a webhook write there would clobber comps and corrupt admin overrides. `workspace_subscriptions` is the Stripe mirror the webhook already owns; its existing owner-read + service-role RLS already covers the new column (no policy change needed).

**New migration: add the column** — `ALTER TABLE workspace_subscriptions ADD COLUMN IF NOT EXISTS purchased_seats int NOT NULL DEFAULT 0;`

**New migration: `CREATE OR REPLACE FUNCTION effective_plan_limit`** (never edit the historical 20260611130001 file in place). Change **only** the `max_team_members` key; all other keys byte-identical. Required ordering inside the function:
1. Resolve base (admin override if present, else `plans.max_team_members`).
2. **If base IS NULL → return NULL immediately** (unlimited; Scale stays unlimited — do **not** `coalesce(base,0)+seats`, which would cap an unlimited tier).
3. **If an admin `resource_overrides.max_team_members` override is present → return it outright, do NOT add seats** (comp is authoritative/replacement; matches existing contract). Decided policy: comps are not stacked with purchased seats.
4. Otherwise (`limit_key='max_team_members'`, base from the plan column, non-NULL): return `base + COALESCE((SELECT purchased_seats FROM workspace_subscriptions WHERE workspace_id = ws_id AND status IN ('active','trialing')), 0)`.
5. Fail-closed unchanged: `0` for unknown ws / unknown key / malformed override / missing plan; a missing subscription row coalesces to `+0`, never errors.

The subquery is an indexed PK lookup (cheap under the trigger's `pg_advisory_xact_lock`).

**Both enforcement layers consume this RPC and need NO change:**
- `invite-user/index.ts:139` (`effectivePlanLimit(... 'max_team_members')` → `seatsAvailable`).
- `trg_limit_seats` BEFORE INSERT on `workspace_members` → `enforce_plan_count_limit('max_team_members', ...)`.
- `seats.ts` `seatsAvailable({limit, members, pendingInvites})` signature unchanged.

**`workspace-limits` edge fn + `useWorkspaceLimits`:** add an optional server-computed `seats` block so the selector floors correctly, keeping existing fields intact (FeatureGate/useEntitlements untouched). Add to the response:
```
seats: { included: number|null, purchased: number, effective: number|null, used: number }
```
where `included = plans.max_team_members`, `purchased = workspace_subscriptions.purchased_seats`, `effective = effective_plan_limit(...)`, `used = count(workspace_members where workspace_id) + count(invites where status='pending')`. Compute server-side (matches enforcement, which counts members + pending). Leave `_shared/entitlements.ts` pure (do not add seats there). Mirror the optional `seats` field in `useWorkspaceLimits.ts`; invalidate `['workspace-limits', workspaceId]` after a seat change.

### 4.5 In-app seat change — NEW `supabase/functions/billing-seats/index.ts`

Owner-only (mirror `billing-checkout` auth: service-role `getUser`, `profile.role==='owner'`, `conta_id`). Deploy with standard JWT verify. Body `{ extra_seats: int >= 0 }`.

- Load `workspace_subscriptions.stripe_subscription_id` + plan base `max_team_members`.
- **Validate decrease (blocker — over-cap):** requested total `(base + extra_seats) >= occupied` where `occupied = members + pending invites`; else `409 "Reduza usuários antes de remover assentos"`. Wrap the read-and-decide in the same `pg_advisory_xact_lock(hashtext(ws||':max_team_members'))` the trigger uses, to close the TOCTOU vs a concurrent invite. (Note: the trigger only blocks **new** inserts — existing members are never evicted; over-cap is self-healing.)
- **Stripe `subscriptions.update` (Stripe-correctness finding) — branch on (seatItemExists, N):**
  - exists & `N>0` → `items:[{ id: seatItemId, quantity: N }]`
  - exists & `N==0` → `items:[{ id: seatItemId, deleted: true }]` (**never `quantity:0`** — Stripe rejects it)
  - !exists & `N>0` → `items:[{ price: seatPriceId, quantity: N }]`
  - !exists & `N==0` → no-op
  - always `proration_behavior: 'create_prorations'`.
- **Single writer:** `billing-seats` does **NOT** write `workspace_subscriptions.purchased_seats`. The resulting `customer.subscription.updated` webhook is the only writer (no double source). UI refetches.
- **Trial copy (low):** if sub `status === 'trialing'`, the confirm copy reads "ajuste aplicado, sem cobrança durante o teste" (no proration charge during trial).

`billing-portal/index.ts`: **no functional change** — keep it for cancel/payment-method/invoice history. Add a comment that seat changes go through `billing-seats`. **Deploy-checklist (medium):** confirm the Stripe billing portal configuration does **not** allow quantity edits on the seat product, so `billing-seats` is the single validated writer.

### 4.6 Billing UI

**`apps/crm/src/services/billing.ts`:**
- `BillingPlan`: add `included_seats: number | null` (from `max_team_members`) and a seat add-on per-seat centavos field for the breakdown; add to the `listActivePlans` select string (column must exist first).
- `WorkspaceSubscription`: add `seats: number` (or consume the `workspace-limits` `seats` block).
- `startCheckout(planId, interval, promoCode?, extraSeats?)`: include `extra_seats` in the body **only when `> 0`** (mirror the `promo_code` pattern).
- `changeSeats(extraSeats)`: POST to `/functions/v1/billing-seats`.
- Current seat usage comes from the extended `workspace-limits` `seats.used` (preferred — no second round-trip). Any new owner-scoped read must be gated `enabled: isOwner`.

**`apps/crm/src/pages/configuracao/cobranca/CobrancaPage.tsx`:**
- `planFeatures()`: surface "Tudo incluído" + "N clientes (ilimitado no Scale)" + "M usuários incluídos" + "+R$25/usuário extra" instead of per-feature bullets.
- **Seat selector** (stepper) on the eligible upgrade card: min = `max(included_seats, currentSeatCount)`, no hard max for Scale. State default = `included_seats`.
- **Cost breakdown** under the price: base + "X usuários extras × R$25 = R$Y" + total (annual = 10× monthly).
- `handleUpgrade`: `extraSeats = max(0, selectedSeats - included_seats)` → `startCheckout(planId, interval, promo, extraSeats)`.
- For an active subscriber: show current total seats + an add/remove control calling `changeSeats()` with a proration confirm. (Standalone "add seats" affordance for subscribers stays minimal here; smooth-meter is Slice 2.)
- **`RECOMMENDED_ID` (line 18):** change `'pro'` → `'agency'` so the "Recomendado" badge renders on the new mid tier.

**New pure helper `apps/crm/src/pages/configuracao/cobranca/seat-pricing.ts`:** `computeSeatCost({ basePriceCentavos, includedSeats, selectedSeats, seatAddonCentavos, interval })` → `{ extraSeats, extraCostCentavos, totalCentavos }` (annual = monthly × 10); `clampSeats(selected, includedSeats, currentSeats)` → floors at `max(included, current)`. Unit-tested.

**`apps/crm/src/pages/configuracao/cobranca/cobranca.css`:** add `.seat-selector` (stepper, ± buttons, DM Mono readout) and `.plan-cost-breakdown` styles within the existing card layout.

**`plan-display.ts`:** **no change in Slice 1** (old plans stay `is_active=true`, so grandfathered cards still render and `INTERNAL_PLAN_IDS = {'lifetime'}` is correct). The `INTERNAL_PLAN_IDS` → non-self-serve/retiring generalization moves to **Slice 4** alongside the `is_active` flip.

### 4.7 Admin amount calc — `supabase/functions/platform-admin/index.ts`

Line 636 `const item = s.items?.data?.[0]` computes the displayed subscription amount from the first item. After multi-item it can read the seat price as the whole amount and omits seat revenue. **Sum across all items:** `gross = Σ (unit_amount × quantity)` over `s.items.data`, then apply the coupon to the summed gross. (Cosmetic/MRR-reporting, not customer-facing, but ships with this slice.)

## 5. Data & migration plan

### Prod-safe ordering (no purchase gap, no silent downgrade)
1. **Stripe:** create 8 Price objects (3 tiers × {monthly, annual} + seat add-on × {monthly, annual}); seat prices `recurring.interval` matched, `currency=brl`, annual ≈ 10× monthly.
2. **DB migrations** (apply via SQL editor on prod, record the version row — db push to prod is reliable again post-PR #173, but verify `--dry-run` lists only the intended files first):
   - `plans` seat-price-id columns + 3 new tier rows (`is_active=true`); **leave old plans `is_active=true`**.
   - `workspace_subscriptions.purchased_seats` column.
   - `CREATE OR REPLACE effective_plan_limit` (additive seats).
3. **Edge functions** (order matters): deploy **`stripe-webhook` first** (multi-item, order-independent, status-aware seats — backward-compatible with single-item subs), then **`billing-checkout`** (emits the seat item), then `billing-seats`, then `platform-admin`.
4. **Admin:** paste all tier + seat price ids via `PlansPage`.
5. **Verify on staging:** end-to-end checkout of a new tier with extra seats; webhook writes `purchased_seats`; `effective_plan_limit` raises the invite cap; entitlements SQL suite green.
6. **Frontend:** deploy CRM with the seat selector + `RECOMMENDED_ID='agency'`.
7. **(Slice 4, later):** flip old plans `is_active=false` with the `plan-display` generalization.

### Reversibility (forward-only columns)
The additive columns are reversible **only while no deployed code reads them**. Once webhook/checkout/frontend reference them, a DB drop breaks running functions. Rollback order = inverse of deploy: frontend → edge functions (back to single-item `data[0]` versions) → leave columns in place (inert when unread); drop columns last, if ever. All `ADD COLUMN IF NOT EXISTS` for idempotent re-apply.

## 6. Backward compatibility (grandfathered single-item subscriptions)

Existing live subs have **one** line item, so order is moot and `purchased_seats` defaults `0` → `effective_plan_limit('max_team_members') = base`, identical to today. This holds **only if**:
- The webhook classifies by `price_id` (never index 0) and **leaves `plan_id` unchanged when no tier resolves** (so an unrecognized grandfathered price can never silently downgrade to `free` — this fixes a latent bug present in current code, not just the new path).
- **Pre-flight before any `is_active` flip (Slice 4):** query distinct `price_id`s on live subscriptions and confirm each resolves in `plans`. (Slice 1 doesn't flip `is_active`, so no grandfathered card disappears.)
- The `plans` seat-column migration is applied **before** the webhook deploy (else the extended select 500s every sync, including renewals).
- `purchased_seats` is `NOT NULL DEFAULT 0`; the SQL coalesces a missing sub row to `+0`.
- `writeWorkspacePlan`'s `plan_source='manual'` guard is unchanged; comps are not stacked with seats (§4.4 step 3).

## 7. Risks & mitigations

| Sev | Risk | Mitigation |
|---|---|---|
| **Blocker** | Webhook `data[0]` plan resolution + `current_period_end` non-deterministic once a seat item exists → paid customer silently downgraded to `free`. | Classify all items by `price_id`; resolve tier via `resolvePlanFromPriceId`; period-end from the tier item; **leave `plan_id` unchanged when no tier resolves**; on active-sub-with-seat-but-no-tier, throw (5xx) for redelivery. Regression test with `[seat, tier]` order. |
| **Blocker** | Cross-area conflict on seat storage; `resource_overrides` path clobbers admin comps. | Locked: dedicated `workspace_subscriptions.purchased_seats`, additive in the RPC. Drop the `resource_overrides` approach entirely. |
| **Blocker** | Canceled/downgraded sub keeps stale `purchased_seats` → free workspace retains paid seat ceiling (billing bypass). | Status-aware persistence (write `0` unless `active`/`trialing`) **and** SQL gates the additive term on `status IN ('active','trialing')`. |
| **Blocker** | `PAID_PLANS` rejects new tier ids → new model dead on arrival. | DB-driven validation (exists + `is_active` + has `stripe_price_id`). |
| **High** | Annual tier + monthly seat price → Stripe rejects mixed intervals. | Separate monthly/annual seat prices; checkout 400s if the interval-matched seat price is missing, before any Stripe call. |
| **High** | `quantity:0` to remove a seat item → Stripe error; lingering $0 seat line. | `billing-seats` uses `{ deleted: true }` to remove; four-way branch on (exists, N). |
| **High** | `effective_plan_limit` rewrite (fail-closed, read by every count trigger) caps unlimited or blocks all inserts. | Short-circuit `NULL` base before adding; comp override returns outright; ship as new `CREATE OR REPLACE`; SQL tests for additive / NULL-unlimited / missing-sub / malformed. |
| **High** | Extended `loadPlanPriceRows` select 500s if the seat columns don't exist → stalls **all** syncs. | Apply the `plans` column migration before the webhook deploy. |
| **High** | "Everything included" silently breaks if a `feature_*` ships `false`. | Enumerate every live `feature_*` = TRUE in the migration; guard with `07_catalog_slice1.sql`; document the rule that future `ADD COLUMN feature_*` must `UPDATE plans SET <col>=true WHERE id IN ('starter','agency','scale')`. |
| **High** | Seat-decrease has no DB floor; can strand over-cap. | `billing-seats` validates `(base+extra) >= occupied` under the advisory lock; trigger never evicts existing members (graceful). |
| **High** | Comp + purchased seats inflate a comp ceiling. | RPC returns the admin override outright, does not add seats. |
| **Medium** | `platform-admin` amount calc reads `data[0]` → misreports MRR for seat subs. | Sum across items. |
| **Medium** | Out-of-order `subscription.updated` writes a stale seat count. | Event-snapshot sync; regression test; optionally re-`retrieve` if flaky. |
| **Medium** | Stripe portal exposes an unvalidated quantity lever bypassing `billing-seats`. | Deploy-checklist: disable quantity edits in portal config. |
| **Medium** | New tier rows with NULL `stripe_price_id` while old plans hidden → no purchasable plan. | Prod-safe ordering; old plans stay `is_active=true`; seat-price 400 guard. |
| **Low** | Forged `metadata.seats`. | Entitlement reads seats only from the Stripe item quantity via the webhook; never from body/metadata. |
| **Low** | `RECOMMENDED_ID='pro'` dangling. | Change to `'agency'`. |
| **Low** | Unresolved sub overwrites mirror `plan_id` with NULL → admin/UI loses plan name. | Preserve existing `workspace_subscriptions.plan_id` when no tier resolves. |
| **Low** | New column RLS over-exposure. | Inherits existing owner-read + service-role policies; add no new policy; UI read gated `enabled:isOwner`. |

## 8. Test plan

### Existing tests to update
- `supabase/functions/__tests__/billing-logic_test.ts` — assert a **seat price resolves to null-as-tier** (never to a `plan_id`); add `resolveSubscriptionSeats` cases (tier+seat, tier-only `=0`, **both item orders**). `statusToPlanId` tests unchanged.
- `supabase/functions/__tests__/invite-user-seats_test.ts` — `seatsAvailable` signature unchanged; add cases where `limit = included + purchased` (included=2, purchased=1 → 3rd member allowed; purchased=0 → floor blocks).
- `supabase/tests/entitlements/01_effective_plan_limit.sql` — `max_team_members = base + purchased_seats`; NULL base + seats → NULL; missing sub row → base; malformed override → 0; **canceled status + seats → base** (no add).
- `supabase/tests/entitlements/03_workspace_scoped.sql` — floor case survives; add: `purchased_seats=1` makes the 2nd member succeed and the 3rd block.
- `supabase/tests/entitlements/_helpers.sql` — helper/param to seed `workspace_subscriptions.purchased_seats` (+ status) inside the rolled-back tx.
- `apps/crm/src/services/__tests__/billing.test.ts` — `startCheckout` includes `extra_seats` when `>0`, omits otherwise; use a real new tier id.
- `apps/crm/src/pages/configuracao/cobranca/__tests__/plan-display.test.ts` — update fixtures to new ids; `lifetime`/`free` rules unchanged (no logic change in Slice 1).

### New tests to add
- `supabase/functions/__tests__/stripe-webhook-seats_test.ts` — `resolveSubscriptionSeats`: tier+seat → seats; tier-only → 0; **order-independent**; canceled status → seats forced to 0.
- `supabase/functions/__tests__/billing-checkout-lineitems_test.ts` — `buildLineItems`: 0 seats → single item; N → two items; **never a qty-0 seat line**; annual + extra_seats with no annual seat price → 400 (no Stripe call); `PAID_PLANS`/DB-validation accepts new tier ids, rejects unknown.
- `supabase/tests/entitlements/07_catalog_slice1.sql` — the 3 tiers exist, `is_active=true`, `max_clients` 10/30/NULL, `max_team_members` 2/5/10, **every `feature_*` TRUE**, `rate_ai_analyses_per_month` set/scaled (not NULL), seat price classified as non-tier. (Guards the "everything included" invariant — React FeatureGate tests mock the data layer and cannot catch a false flag. Must **not** assert old plans inactive.)
- `apps/crm/src/pages/configuracao/cobranca/__tests__/seat-pricing.test.ts` — `computeSeatCost` (monthly vs annual=10×, extra clamping, current-seats floor) and `clampSeats`.
- `billing-seats` four-transition test (add / increase / remove-via-deleted / no-op) + concurrent decrease+invite under the lock.

### Unchanged (per NEUTRALIZE)
`FeatureGate.test.tsx`, `useEntitlements.test.tsx`, `entitlement-errors.test.ts`, `entitlements-shared_test.ts` — flag/limit-shape agnostic; flipping flags TRUE is the already-covered "enabled" path. The 24 FeatureGate call-sites and their tests stay.

**CI gates:** run `npm run build` (tsc), `npm run test`, `deno test supabase/functions/`, the entitlements SQL suite, plus the repo's eslint + prettier `format:check` + coverage ratchet before pushing.

## 9. Open questions for the user

1. **Seat price scope:** one shared seat Price across all three tiers (assumed — keeps proration simple and `resolveSubscriptionSeats` tier-agnostic), or per-tier seat prices?
2. **Annual seat price:** 10× monthly (2 months free, mirrors the tier rule — recommended) or full 12×?
3. **Scale seat add-ons:** Scale has unlimited clients but base 10 seats — confirm a Scale customer can buy seat 11+ (assumed yes; affects no math since base is finite).
4. **Tier downgrade with held extra seats** (e.g. Agency base 5 → Starter base 2 with extras): Slice 1 keeps `extra_seats` unchanged (total drops by 3). Confirm, or product wants auto-re-leveling.
5. **Comp + purchased seats:** confirmed policy is **comp override wins outright, seats not stacked**. Confirm this is the intended product behavior for comped workspaces that also hold a Stripe sub.
6. **`used` definition for the selector:** server computes `used = members + pending invites` (matches the invite gate). Confirm the selector floors on members+pending, not members-only.
7. **`PAID_PLANS` approach:** DB-driven validation (recommended — Slice 4's `is_active` flip auto-removes old tiers) vs keeping a hardcoded array.
8. **Final BRL numbers:** `11000`/`17900`/`27900` + `2500` seat are placeholders pending the willingness-to-pay pass — OK to ship as illustrative and re-tune later?

---

**Key file references (all verified against the working tree):** `supabase/functions/billing-checkout/index.ts`, `supabase/functions/stripe-webhook/index.ts` (reads `sub.items?.data?.[0]` for both plan + `current_period_end`), `supabase/functions/_shared/billing-logic.ts`, `supabase/functions/billing-portal/index.ts`, `supabase/functions/workspace-limits/index.ts`, `supabase/functions/invite-user/{index.ts,seats.ts}`, `supabase/functions/platform-admin/index.ts:636` (confirmed `data?.[0]`), `supabase/migrations/20260611130001_effective_plan_limit.sql`, `supabase/migrations/20260611130003_count_triggers.sql`, `supabase/migrations/20260609120003_workspace_subscriptions.sql`, `apps/crm/src/services/billing.ts`, `apps/crm/src/pages/configuracao/cobranca/{CobrancaPage.tsx,plan-display.ts}` (`RECOMMENDED_ID='pro'` at line 18, `INTERNAL_PLAN_IDS={'lifetime'}`), `apps/crm/src/hooks/useWorkspaceLimits.ts`, `apps/admin/src/{lib/api.ts,pages/PlansPage.tsx}`. The dup-timestamp prod-db-push blocker is resolved (`20260625000003` is now unique, PR #173).
