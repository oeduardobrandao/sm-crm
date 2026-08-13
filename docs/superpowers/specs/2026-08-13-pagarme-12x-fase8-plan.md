# Pagar.me 12x — Fase 8: preço próprio do 12x + coexistência com o anual à vista

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the pricing structure the user approved: the annual plan keeps its discounted price for one-shot payment (Stripe checkout, existing), and the 12x gets its OWN, higher price with the financing embedded. Prices closed by the user: Start 12x de R$ 94,90 · Pro R$ 129,90 · Max R$ 184,90 (5% off the monthly price; totals 1.138,80 / 1.558,80 / 2.218,80, all under the 12×monthly ceiling). The à vista price stays `price_brl_annual` (959 / 1.343 / 1.919).

**Architecture:** New column `plans.pagarme_installment_cents` (the per-installment price the admin types; total charged = ×12 — the Pagar.me PLAN OBJECT's price is the total, so live/sandbox plan objects must be (re)created at the new totals at deploy time, outside this plan). The Fase 2 year-guard in `billing-checkout` is REMOVED: Stripe annual à vista and Pagar.me 12x now coexist; every other guard (cross-provider 409s, in-force/paid-through blocks) is unchanged. Frontend surfaces show both prices side by side; the dialog stays the 12x path and gains an "à vista" escape hatch.

**Tech Stack:** unchanged (Deno edge functions, React 19, Vitest + Deno tests).

## Global Constraints

- PT-BR copy, NO em-dashes, sentence case. "sem juros" stays on the 12x (true for the customer: fixed installments, no issuer interest) and the à vista price is ALWAYS visible beside it.
- Approved prices are DATA (plans rows), never hard-coded in app code. Tests use fixtures with these values.
- Contract changes break both suites: grep `apps/**/__tests__` + `supabase/functions/__tests__` for the old shapes (`installmentAmountCents`, `annualCheckoutBlocked`, checkout response fields) and update within the new semantics.
- Every DB call in edge functions carries `.abortSignal(AbortSignal.timeout(10_000))`.
- The ceiling rule is enforced server-side: enabling 12x requires `pagarme_installment_cents > 0` AND `pagarme_installment_cents < price_brl` (the monthly price in cents; strict less-than — equal gives the customer no reason to choose 12x).
- Commit trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Deno tests: `npm run test:functions` then `git checkout -- deno.lock`.

---

### Task 1: Migration + plan-mutations validation + admin threading

**Files:**
- Create: `supabase/migrations/20260815000001_pagarme_installment_price.sql` (verify prefix vs `git ls-tree origin/main:supabase/migrations | tail` at PR time; bump above the tail)
- Modify: `supabase/functions/platform-admin/plan-mutations.ts`, `apps/admin/src/lib/api.ts`, `apps/admin/src/pages/plan-form.ts`, `apps/admin/src/pages/PlansPage.tsx`
- Test: extend `supabase/functions/__tests__/platform-admin-plan-mutations_test.ts`, `apps/admin/src/pages/__tests__/plan-form.test.ts`

**Interfaces:**
- Produces: `plans.pagarme_installment_cents int` (nullable); `Plan`/`FormState` field `pagarme_installment_cents`; validation reachable by Task 2's checkout read.

- [ ] **Step 1: migration**

```sql
-- Per-installment price of the 12x annual (in cents). The à vista annual keeps
-- price_brl_annual; the 12x has its own, higher price with the financing embedded.
-- Total charged by the gateway = pagarme_installment_cents * 12 (the Pagar.me plan
-- object must be created at that total).
alter table plans add column pagarme_installment_cents int;

comment on column plans.pagarme_installment_cents is
  'Parcela do 12x em centavos; total = x12. Null = plano sem 12x configurado.';
```

- [ ] **Step 2: plan-mutations.** Thread `pagarme_installment_cents` through `allowedScalar` AND `handleCreatePlan`'s explicit whitelist (both, same trap as before). Extend `validatePagarme12x` (which already receives merged values; add the two fields to the merge/read logic it uses): enabling requires, in addition to the existing checks, `pagarme_installment_cents > 0` and `pagarme_installment_cents < price_brl` (monthly cents; read `price_brl` through the same merge-over-current-row path used for `price_brl_annual`). New 400 message: `pagarme_12x_enabled requires 0 < pagarme_installment_cents < price_brl (mensal)`.
- [ ] **Step 3: admin frontend.** `Plan` interface, `FormState`/`emptyFormState`/`planToForm`/`formToPayload` (input in REAIS in the form: field label `Parcela 12x (R$)`, form keeps a string, payload converts to cents like the existing price fields do — READ how `price_brl` is handled and mirror it), `PlansPage.tsx` input next to the Pagar.me plan id field.
- [ ] **Step 4: tests.** plan-mutations: enable with parcela 0 → 400; parcela == price_brl → 400; parcela < price_brl and > 0 with the rest configured → ok; boolean-only flip on a fully-configured row → ok (merge-read covers the new fields); plan-form round-trips reais↔cents both directions.
- [ ] **Step 5:** `npm run test:functions` (+ revert deno.lock) + admin tsc + `npm run test`; commit `feat(billing): pagarme_installment_cents + validação e threading no admin`.

---

### Task 2: Backend — checkout charges the 12x price; year-guard removed

**Files:**
- Modify: `supabase/functions/pagarme-checkout/handler.ts` (+ `logic.ts` if `installmentAmountCents` lives there), `supabase/functions/billing-checkout/index.ts` (remove the year rejection), `supabase/functions/_shared/billing-logic.ts` (only if `annualCheckoutBlocked` lives there — find it first)
- Test: `supabase/functions/__tests__/pagarme-checkout-handler_test.ts`, billing-checkout tests (find the file that asserts the year rejection)

**Interfaces:**
- Consumes: `plans.pagarme_installment_cents` (Task 1).
- Produces: checkout response `installment_amount_cents` = the column value; amount mirror = column×12.

- [ ] **Step 1: pagarme-checkout.** The plan read (find the select that already fetches `pagarme_12x_enabled, pagarme_plan_id_annual, price_brl_annual`) also selects `pagarme_installment_cents`. Gate: 12x not configured (null/<=0 column) → the existing `plan_not_configured`-style 400 path. The subscription is still created on the Pagar.me plan object (`pagarme_plan_id_annual`) — the GATEWAY charges that object's price, so add a defensive cross-check: after the create, if the remote subscription's item pricing (`items[0].pricing_scheme.price`, present in the create response) differs from `pagarme_installment_cents * 12`, log CRITICAL (`price drift between plans row and gateway plan object`) but do NOT fail the checkout (the gateway already charged; ops fixes the object). Amount mirror: `amount_cents = pagarme_installment_cents * 12` (replaces `price_brl_annual` as the 12x contract value; `amount_interval` stays `year`). Response `installment_amount_cents = pagarme_installment_cents` (replace the `annual/12` derivation; delete `installmentAmountCents()` if now unused, updating its tests).
- [ ] **Step 2: billing-checkout.** REMOVE the Fase 2 year rejection (the branch that 400s `interval === 'year'` when the plan has `pagarme_12x_enabled` — locate via grep for the PT-BR message or `annualCheckoutBlocked`). Stripe annual à vista is now always allowed (all other 409 guards untouched). Delete the now-dead helper + its direct tests; update any test asserting the rejection to assert the allowance.
- [ ] **Step 3: tests.** pagarme-checkout: mirror uses parcela×12; response carries the column value; unconfigured parcela → 400 before any remote call; price-drift logs but returns 200 (fixture with mismatched item price). billing-checkout: year + gated plan now proceeds to Stripe session creation.
- [ ] **Step 4:** `npm run test:functions` (+ revert deno.lock); commit `feat(billing): checkout 12x cobra preço próprio; anual à vista coexiste`.

---

### Task 3: Frontend — service, dialog and the three surfaces

**Files:**
- Modify: `apps/crm/src/services/billing.ts`, `apps/crm/src/components/billing/PagarmeCheckoutDialog.tsx`, `apps/crm/src/pages/configuracao/cobranca/CobrancaPage.tsx` (+ `plan-display.ts` if the lead logic lives there), `apps/crm/src/pages/comecar/ComecarPage.tsx`, `apps/crm/src/pages/landing/PricingSection.tsx`, `apps/crm/src/lib/pagarme-gate.ts`
- Test: the co-located test files of each

**Interfaces:**
- Consumes: `pagarme_installment_cents` exposed by the service.
- Produces: `BillingPlan`/`PublicPricingPlan` += `pagarme_installment_cents: number | null` (in both select strings); `isPagarme12xEnabled(plan)` additionally requires `(plan.pagarme_installment_cents ?? 0) > 0`; dialog prop `plan` gains `pagarme_installment_cents` and optional `onPayUpfront?: () => void`.

- [ ] **Step 1: service + gate.** Both plan types/selects gain the column; `isPagarme12xEnabled` requires column boolean AND env key AND positive parcela (a misconfigured plan falls back to today's Stripe-only behavior everywhere).
- [ ] **Step 2: dialog.** Summary uses the real parcela: `12x de {formatBRL(parcela)} sem juros` + `total {formatBRL(parcela*12)}/ano`. Below it, when `onPayUpfront` is provided (checkout mode only): a quiet secondary line `À vista sai por {formatBRL(price_brl_annual)}. <button>Pagar à vista</button>` — the button calls `onPayUpfront()` (parent closes the dialog and starts the Stripe annual checkout). Keep `price_brl_annual` in the plan prop for this line.
- [ ] **Step 3: CobrancaPage.** Year view of a gated plan: lead shows `em 12x de` with the PARCELA (not annual/12) and, under the CTA, a secondary action `Assinar à vista ({formatBRL(price_brl_annual)})` calling the existing Stripe `handleUpgrade` path (bypassing the dialog branch — extract a `startStripeUpgrade(planId)` from the current else-branch so both callers share it). Dialog mount passes `onPayUpfront` wired to the same function. Non-gated plans unchanged.
- [ ] **Step 4: ComecarPage + PricingSection.** Comecar year+gate copy: `depois 12x de {parcela} no cartão ou {avista} à vista`; the dialog gets `onPayUpfront` wired to `startAndRedirect(planId, 'year')`. PricingSection year+gate: `12x de {parcela} no cartão, sem juros · ou {avista} à vista ({X}% off)` where X = round((1 − avista/(12×mensal))×100). Non-gated copy unchanged.
- [ ] **Step 5: tests.** Update fixtures to carry `pagarme_installment_cents` (9490/12990/18490); dialog shows the parcela price and the à vista line, and `onPayUpfront` fires from the button; gate returns false when parcela missing (surfaces fall back to Stripe, asserted on CobrancaPage year upgrade); CobrancaPage secondary à vista CTA calls startCheckout; PricingSection renders both prices.
- [ ] **Step 6:** `npm run test` + 4× tsc + lint + format; commit `feat(billing): superfícies com 12x a preço próprio + à vista coexistente`.

---

### Task 4: Full CI battery + staging data prep script

**Files:**
- Create: `docs/superpowers/specs/2026-08-13-pagarme-12x-fase8-deploy.md` (the deploy/flip runbook delta)

- [ ] **Step 1:** Full battery (lint, format:check, 4× tsc, `npm run test`, `npm run test:functions`, revert deno.lock, npm-ci if polluted, clean git status).
- [ ] **Step 2: runbook file** with the deploy-order delta (executed later, on user order): (1) migration db push (additive, safe before functions); (2) deploy `platform-admin`, `pagarme-checkout`, `billing-checkout` in both envs; (3) STAGING: create NEW sandbox plan objects at the new totals (113880/155880/221880, `interval year, installments [1,12]`) via API using the sandbox key file, update `plans` rows (`pagarme_plan_id_annual` = new ids, `pagarme_installment_cents` = 9490/12990/18490); re-run the staging E2E checkout once; (4) PROD flip: same plan-object creation with the LIVE key at flip time. Include the exact curl/API shapes from the spike script.
- [ ] **Step 3:** commit `docs(billing): fase 8 deploy runbook`.

## Riscos aceitos

- The gateway charges the PLAN OBJECT's price; the plans row is the mirror. The price-drift CRITICAL log (Task 2) is the alarm if they diverge; creating/updating the objects is an ops step in the runbook.
- Mensal→12x switching still requires cancel-then-resubscribe (unchanged v1 stance).
