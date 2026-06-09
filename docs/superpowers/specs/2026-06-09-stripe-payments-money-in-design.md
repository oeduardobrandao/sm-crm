# Mesaas — Stripe Payments (Slice 1: Money-In Loop) — Design

**Date:** 2026-06-09
**Status:** Approved design, pending implementation plan
**Source spec:** `~/Downloads/mesaas_planos_specs.md` (§ "Implementação de Pagamentos", Fase 1)

---

## 1. Goal & scope boundary

Let a workspace **owner** choose a paid plan, pay by card via Stripe, have their
workspace upgraded automatically, and self-manage the subscription. Nothing more.

**In scope (Slice 1):**

- Stripe-hosted Checkout for upgrading to a paid plan (monthly **and** annual).
- A `stripe-webhook` edge function that syncs subscription state into the app.
- Stripe Billing Portal for self-service (cancel, update card, switch plan).
- A single, consistent **plan source of truth** so all effective-plan readers agree.
- An owner-only **Plano & Cobrança** page in the CRM.
- Admin ability to set each plan's Stripe product/price IDs (currently missing).

**Out of scope (each becomes its own later slice/spec):**

- Feature-gating / paywall enforcement (limits are *resolved* today but not *enforced*).
- Focus NFe nota-fiscal issuance.
- Resend dunning / upgrade / onboarding emails.
- Usage banners ("X de N clientes").
- Pagar.me / PIX / boleto (spec Fase 2, gated on 100+ paying subscribers).

---

## 2. Decisions locked

From the source spec and the brainstorming session:

- **Provider:** Stripe, cards only. Checkout is **Stripe-hosted** (redirect), not embedded.
- **Self-service:** native Stripe **Billing Portal**.
- **Plans:** `free`, `starter`, `pro`, `scale`. One Stripe price per paid plan **per interval**
  (`stripe_price_id` monthly, `stripe_price_id_annual` annual).
- **Webhooks consumed:** `checkout.session.completed`, `customer.subscription.updated`,
  `customer.subscription.deleted`, `invoice.payment_failed`.
- **Downgrade-on-failure:** driven by **final subscription status**. Stripe is configured
  (dashboard) to retry a fixed 3 times then **cancel**; the app reacts to the resulting
  `canceled`/`unpaid` status. The "3 attempts" lives in Stripe config, not app code.
- **Behaviour:** limits enforced server-side (existing `workspace-limits`); upgrade instant;
  downgrade effective when Stripe transitions the subscription; "Free" = the plan with
  `is_default = true`.
- **Billing access:** **owner only** (UI route guard + edge-function role check). `admin`/`agent`
  do not see billing.
- **No frontend Stripe key needed** — hosted Checkout means the client only redirects to a
  returned URL; no Stripe.js, no new `VITE_` vars.

---

## 3. Architecture & data flow

```
Owner clicks "Fazer upgrade" on Plano & Cobrança (interval: month|year)
   → billing-checkout (edge fn, JWT, owner-only)
        • find/create Stripe Customer, metadata { workspace_id }
        • create Checkout Session (mode=subscription, price_id for plan+interval,
          client_reference_id + subscription metadata { workspace_id, plan_id })
        • returns { url }
   → browser redirects to Stripe-hosted Checkout
   → pays → Stripe redirects to /configuracao/cobranca?status=success
                                   │
   Stripe ──async, at-least-once──▶ stripe-webhook (edge fn, NO jwt, signature-verified)
        • checkout.session.completed        → upsert subscription, set workspaces.plan_id
        • customer.subscription.updated      → resync status/plan/period, set plan_id
        • customer.subscription.deleted      → status canceled, plan_id → free
        • invoice.payment_failed             → mark past_due, increment counter
                                   │
   workspace-limits (existing)  ──reads──▶ workspaces.plan_id  (unchanged consumer)
   resolve_workspace_plan() SQL ──reads──▶ workspaces.plan_id  (rewritten — see §4)

Self-service: "Gerenciar assinatura"
   → billing-portal (edge fn, JWT, owner-only) → Billing Portal session → redirect
   → all mutations there flow back through the same webhook
```

**Key seam:** the webhook writes `workspaces.plan_id` — the exact column `workspace-limits`
already resolves from — so limit resolution needs zero changes; it simply begins seeing real
plans.

---

## 4. Plan source of truth (keystone)

**Problem found during review:** two resolvers disagree on where the effective plan comes from.

- `workspace-limits` edge fn (`supabase/functions/workspace-limits/index.ts:85-114`)
  reads **`workspaces.plan_id`** (then applies override JSON).
- `resolve_workspace_plan(ws_id)` SQL function
  (`supabase/migrations/20260502000001_global_banners.sql:9-12`) reads
  **`workspace_plan_overrides.plan_id`**, and is baked into the global-banner RLS policy (line 84).

If the Stripe webhook only writes `workspaces.plan_id`, plan-targeted banners would mis-classify
paid customers (stale or default-to-free).

**Decision: `workspaces.plan_id` is the single source of truth.** All readers use it.

1. Rewrite `resolve_workspace_plan` (migration) to read `workspaces.plan_id`:

   ```sql
   create or replace function resolve_workspace_plan(ws_id uuid)
   returns text language sql security definer stable as $$
     select coalesce(
       (select plan_id from workspaces where id = ws_id),
       (select id from plans where is_default = true limit 1)
     );
   $$;
   ```

2. `workspace_plan_overrides` is **demoted to overrides-only** — it keeps
   `resource_overrides` / `feature_overrides` / `notes` (admin comp metadata). Its `plan_id`
   column is **retired as a source of truth**: no reader consults it after this change. Because
   the column is currently `NOT NULL` (`platform-admin_tables:21`), an override-only row can no
   longer be inserted without a plan — so **Migration F** (§5) drops the `NOT NULL` and marks the
   column deprecated via `comment on column`.

3. Admin `set-workspace-plan` (`platform-admin/index.ts:472-513`) is updated to write
   `workspaces.plan_id` + `workspaces.plan_source = 'manual'` and still upsert the override row
   for its JSON overrides (it may omit `plan_id` now that the column is nullable). It no longer
   relies on `workspace_plan_overrides.plan_id` for the effective plan. `set-workspace-plan`
   remains the single admin action that sets plan + overrides together; an overrides-only admin
   action is not needed for this slice.

4. The Stripe webhook writes `workspaces.plan_id` + `workspaces.plan_source = 'stripe'`, **only
   when** the workspace is not admin-comped (see `plan_source` guard in §5).

**"Free" definition (single):** the plan where `is_default = true` (id `'free'` by the spec's
naming convention). Downgrade target and ultimate fallback both resolve to it. No new env var.

---

## 5. Data model

All migrations are idempotent where they touch existing tables.

**Migration A — guarantee `workspaces.plan_id` exists.** It is read/written across the codebase
but never migrated (created "via dashboard", like `plans`); fresh/staging DBs would break.

```sql
alter table workspaces
  add column if not exists plan_id text references plans(id) on delete set null;
```

**Migration B — `workspaces.plan_source` (comp vs Stripe ownership).**

```sql
alter table workspaces
  add column if not exists plan_source text not null default 'system'
  check (plan_source in ('system', 'stripe', 'manual'));
```

- `system` — default/unmanaged (free). Webhook may take ownership on first checkout.
- `stripe`  — plan owned by an active Stripe subscription. Webhook owns `plan_id`.
- `manual`  — admin comp/enterprise. **Webhook never touches `plan_id`.**

Webhook write guard: update `plan_id` only when `plan_source IN ('system','stripe')`; on a
successful subscription it sets `plan_source = 'stripe'`. Admin comp sets `plan_source = 'manual'`.

(Note: deviates from the review's suggested `default 'manual'` — a brand-new free workspace must
default to `'system'` so its *first* upgrade can take ownership; `'manual'` would block it.)

**Migration C — rewrite `resolve_workspace_plan`** (see §4).

**Migration D — `workspace_subscriptions` (the Stripe mirror, one row per workspace).**

```sql
create table workspace_subscriptions (
  workspace_id           uuid primary key references workspaces(id) on delete cascade,
  stripe_customer_id     text unique,
  stripe_subscription_id text unique,
  status                 text,         -- active | trialing | past_due | unpaid | canceled | ...
  plan_id                text references plans(id),
  billing_interval       text,         -- 'month' | 'year'
  current_period_end     timestamptz,
  cancel_at_period_end   boolean not null default false,
  failed_payment_count   int not null default 0,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
alter table workspace_subscriptions enable row level security;
-- service_role: ALL. owner: SELECT own workspace row (read-only status display).
```

**Migration E — `stripe_webhook_events` (dedup ledger, written post-success).**

```sql
create table stripe_webhook_events (
  event_id     text primary key,
  type         text,
  processed_at timestamptz not null default now()
);
```

**Migration F — retire `workspace_plan_overrides.plan_id` as a source of truth** (it is `NOT NULL`
today, which blocks override-only rows once assignment moves to `workspaces.plan_id`).

```sql
alter table workspace_plan_overrides alter column plan_id drop not null;
comment on column workspace_plan_overrides.plan_id is
  'Deprecated: effective plan now lives in workspaces.plan_id; retained for back-compat, not read.';
```

---

## 6. Edge functions

Three new Deno functions under `supabase/functions/`. Stripe SDK via `npm:stripe@^17`,
constructed with `Stripe.createFetchHttpClient()`. JWT verification follows the project pattern
(service-role client + `getUser(token)`, then load `profiles.conta_id` + role) — never the anon
client. CORS via `buildCorsHeaders(req)`. Client-facing errors are generic; details logged
internally.

The CRM base URL for redirect/return URLs comes from the existing **`OAUTH_REDIRECT_BASE`** env
var (reused; no new var). Below, `<app>` denotes that base.

### 6a. `billing-checkout` — JWT, **owner-only** (403 otherwise)

- Input: `{ plan_id: 'starter'|'pro'|'scale', interval: 'month'|'year' }`.
- Load plan; pick `stripe_price_id` (month) or `stripe_price_id_annual` (year). 400 if the
  required price ID is unset.
- Find-or-create Stripe Customer (Customer `metadata: { workspace_id }`); upsert
  `workspace_subscriptions.stripe_customer_id`.
- Create Checkout Session: `mode: 'subscription'`, the chosen price, `client_reference_id =
  workspace_id`, `subscription_data.metadata = { workspace_id, plan_id }`,
  `success_url = <app>/configuracao/cobranca?status=success`,
  `cancel_url = <app>/configuracao/cobranca?status=cancelled`.
- Return `{ url }`.

### 6b. `stripe-webhook` — **no JWT** (deploy `--no-verify-jwt`), Stripe-signature verified

- Verify signature with `STRIPE_WEBHOOK_SECRET` using **`constructEventAsync`** (Deno Web Crypto
  is async; the sync `constructEvent` throws).
- **Dedup (failure-safe):** look up `event_id` in `stripe_webhook_events`; if present, return 200
  (already done). Otherwise process, and **insert `event_id` only after** the handler succeeds.
  On any handler error, return **5xx without recording** so Stripe redelivers. **Every handler
  write must be idempotent so that concurrent duplicate deliveries converge** (the post-success
  ledger does not serialize concurrent processing): upserts keyed by `workspace_id`, plan-id
  *assignments* (never read-modify-write), and the failed-payment counter set by **assignment from
  Stripe's authoritative `invoice.attempt_count`** — never `++` (see below). *(Stronger optional
  variant if you want hard serialization: a `status` column `processing|processed|failed` with an
  atomic claim. Not required given assignment-only writes.)*
- **Workspace resolution order** (handles event races, e.g. `subscription.updated` arriving
  around `checkout.session.completed`):
  1. event's subscription/session `metadata.workspace_id`,
  2. Customer `metadata.workspace_id`,
  3. `workspace_subscriptions` by `stripe_customer_id`,
  4. else return 5xx to force Stripe retry.
  Because `billing-checkout` stamps `workspace_id` on the Customer at creation, path 2 resolves
  even when events arrive out of order.
- **Price → plan mapping:** query `plans` matching `stripe_price_id` or `stripe_price_id_annual`
  (no hardcoded map). `billing_interval` derived from which column matched.
- **Event handling:**
  - `checkout.session.completed` → retrieve subscription → upsert `workspace_subscriptions`
    (customer, sub id, status, plan_id, interval, period_end, cancel_at_period_end) → set
    `workspaces.plan_id` + `plan_source='stripe'` (subject to guard).
  - `customer.subscription.updated` → resync all fields; apply status mapping (below).
  - `customer.subscription.deleted` → status `canceled`; `workspaces.plan_id` → default/free.
  - `invoice.payment_failed` → `failed_payment_count = invoice.attempt_count` (idempotent
    assignment from Stripe's own retry counter, not `++`), status `past_due`; **no** plan change.
- **`plan_source` guard:** all `workspaces.plan_id` writes are skipped when
  `plan_source = 'manual'` (the `workspace_subscriptions` mirror is still updated for visibility).

**Status → effective plan mapping:**

| Stripe subscription status                       | `workspaces.plan_id`              |
|--------------------------------------------------|-----------------------------------|
| `active`, `trialing`                             | set to subscribed plan            |
| `past_due`                                       | unchanged (grace; Stripe retrying)|
| `incomplete`                                     | unchanged (initial payment unconfirmed) |
| `canceled`, `unpaid`, `incomplete_expired`, `paused` | downgrade to default (`free`) |

### 6c. `billing-portal` — JWT, **owner-only**

- Load `workspace_subscriptions.stripe_customer_id`; 400 if none. Create a Billing Portal session
  with `return_url = <app>/configuracao/cobranca`. Return `{ url }`.

**New env vars** (add to `CLAUDE.md` env section and `.env.example`; never commit values):

- `STRIPE_SECRET_KEY` — REQUIRED, throw if missing (mirrors `TOKEN_ENCRYPTION_KEY`).
- `STRIPE_WEBHOOK_SECRET` — REQUIRED by `stripe-webhook`, throw if missing.

### 6d. Function registration (`config.toml` + audit test)

This repo registers **every** edge function in `supabase/config.toml` with `verify_jwt = false`
(the manual-auth pattern), and `supabase/functions/__tests__/config-audit_test.ts` enforces it via
a `REQUIRED_FUNCTIONS` allowlist (line 20-59). All three new functions handle their own auth, so:

- Add `[functions.billing-checkout]`, `[functions.billing-portal]`, and `[functions.stripe-webhook]`
  blocks — each with `verify_jwt = false` — to `config.toml`.
- Add the same three names to `REQUIRED_FUNCTIONS` in `config-audit_test.ts` (else the audit test
  fails / they go unverified).
- Deploy all three with `--no-verify-jwt`.

`billing-checkout` and `billing-portal` verify the **user** JWT manually via `getUser(token)`
(exactly like `workspace-limits`); `stripe-webhook` authenticates via **Stripe signature**. None
rely on Supabase's gateway JWT check — hence `verify_jwt = false` for all three.

---

## 7. Admin: editable Stripe product/price IDs

The DB columns and the `Plan` type exist, but there is **no write path** today — for **either
create or update**: `FormState` (`apps/admin/src/pages/PlansPage.tsx:44-51`) omits the stripe
fields, `formToPayload` (70-79) doesn't send them (and feeds *both* the create and update
mutations), `handleUpdatePlan`'s `allowedScalar` (`platform-admin/index.ts:413`) excludes them,
and `handleCreatePlan`'s `insert` builder (`platform-admin/index.ts:377-385`) excludes them.

Tasks:

- Add `stripe_product_id`, `stripe_price_id`, `stripe_price_id_annual` to `FormState`,
  `planToForm`, `formToPayload`, and the form UI (3 text inputs). Because `formToPayload` feeds
  both mutations, this single form change covers create and update on the client.
- Accept the three keys server-side in **both** `handleUpdatePlan` (add to `allowedScalar`) **and**
  `handleCreatePlan` (add to the `insert` builder).

This is how the Stripe price IDs created in the dashboard get into `plans` — owner/admin pastes
them per plan. (Free plan has no price IDs.)

---

## 8. Frontend (CRM)

- **New owner-only page `Plano & Cobrança`** at `/configuracao/cobranca`. Route + nav entry guarded
  by `AuthContext` role === `owner`; non-owners are redirected. Follows existing `configuracao`
  page patterns.
- **Plan cards** (Free / Starter / Pro / Scale) with a **monthly/annual toggle**; prices read from
  `plans` (public-read RLS already allows it).
- Not subscribed → **"Fazer upgrade"** → `billing-checkout(plan_id, interval)` → redirect to
  returned URL. Subscribed → **"Gerenciar assinatura"** → `billing-portal` → redirect.
- `?status=success` → `sonner` toast + refetch current plan. The webhook may lag a beat, so poll
  subscription status briefly until `plan_id` reflects the new plan. `?status=cancelled` → neutral
  toast, no change.
- **Service module** `apps/crm/src/services/billing.ts` (mirrors `services/instagram.ts`) wrapping
  the two endpoint calls.

---

## 9. Stripe dashboard configuration (deployment prerequisite)

These are required configuration, not code:

1. **Products & prices:** create one Product per paid plan; one recurring Price per interval
   (BRL, monthly + annual). Paste the product/price IDs into each plan via the admin portal (§7).
2. **Billing retries / dunning:** configure Subscriptions → revenue recovery to retry a **fixed 3
   times** then **cancel** the subscription (this is what drives the app's downgrade-to-Free).
3. **Webhook endpoint:** register the deployed `stripe-webhook` URL; subscribe to
   `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`,
   `invoice.payment_failed`. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
4. **Billing Portal:** enable it; allow cancel, update payment method, and plan switching among the
   paid plans.

Build and validate against **Stripe test mode** first.

---

## 10. Testing

- **Deno tests** (`deno test supabase/functions/`): owner-guard 403s; price→plan mapping;
  webhook signature verification; each event's DB effect via fake signed payloads (sign with a
  test secret); dedup (post-success record + 5xx-on-error redelivery); status-mapping transitions;
  `plan_source='manual'` guard skips plan writes; workspace resolution order/fallback.
- **Vitest** (`npm test`): `services/billing.ts` and the owner-only route guard.
- **Manual** (Stripe test mode + `stripe listen --forward-to`): cards `4242…` (success) and
  `4000 0000 0000 0341` (failed payment) to verify `plan_id` transitions and the past_due→cancel→
  free path.
- **Pre-push:** format + lint + `npm test` + deno tests (CI gates).

---

## 11. Build sequence

1. Migrations A–F (+ `resolve_workspace_plan` rewrite) → push to **staging** first (dry-run).
2. Admin Stripe-ID edit path — create *and* update (§7).
3. `billing-checkout` + `billing-portal` (+ deno tests); register both in `config.toml` +
   `config-audit_test.ts` (§6d).
4. `stripe-webhook` (+ deno tests) — register in `config.toml` + `config-audit_test.ts` (§6d);
   deploy all three `--no-verify-jwt`; register endpoint + retry settings in Stripe (§9).
5. CRM `Plano & Cobrança` page + `services/billing.ts`.
6. Create products/prices in Stripe test mode; paste IDs via admin; end-to-end test.
7. Update `CLAUDE.md` + `.env.example` with the new env vars.

---

## 12. Future slices (explicitly deferred)

Feature-gating/paywall enforcement · Focus NFe issuance · Resend dunning/upgrade emails ·
usage banners · Pagar.me (PIX/boleto, Fase 2).
