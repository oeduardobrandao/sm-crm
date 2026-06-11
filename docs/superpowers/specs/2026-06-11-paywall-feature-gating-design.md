# Paywall & Feature Gating — Design Spec

**Date:** 2026-06-11
**Status:** Draft for review (rev. 2 — incorporates agent-verified codebase review)
**Branch:** `feat/paywall-feature-gating` (off the money-in branch; rebases onto `main` once #106 merges)
**Related:** `2026-06-09-stripe-payments-money-in-design.md` (Slice 1 — money-in loop)

---

## 1. Context & motivation

The Stripe money-in loop (Slice 1) is live on prod: an owner can subscribe, the webhook writes `workspaces.plan_id` + `plan_source`, and `workspace-limits` computes the plan's limits/features. **But almost nothing is enforced.** Today, upgrading a plan only:

- unlocks 3 feature-gated routes (`/analytics`, `/post-express`, `/ideias`) via `ProtectedRoute`;
- has no effect on any resource count (limits are computed but never read for enforcement; **no reusable `enforce_*` SQL exists in the current migrations** — it lives only on the abandoned `ebs/feat-stripe-integration` branch, never merged);
- does not change the storage quota (enforced against `workspaces.storage_quota_bytes`, which nothing syncs from the plan).

A paying customer therefore gets a correct subscription + Billing Portal + 3 pages, and otherwise the same limits as Free. This slice builds the **paywall**: real, server-enforced differentiation, before we charge real customers.

## 2. Goals

- **Server-side hard enforcement** of resource counts, feature access, and storage quota — not bypassable by hitting Supabase/edge functions directly.
- One **single source of truth**: effective entitlements = plan (`workspaces.plan_id` → `plans`) merged with admin overrides (`workspace_plan_overrides.resource_overrides` / `feature_overrides`).
- **Conversion-focused UX**: clear "limit reached" / "feature locked" states with an upgrade CTA, replacing today's silent redirect.
- **Humane policy**: never delete, hide, or lock existing data. Enforcement blocks only *new* creation while at/over limit — including after downgrade/cancellation.
- **Retire the legacy portal** (`portal_tokens` path) as part of consolidating client-portal gating onto `feature_hub_portal`.

## 3. Non-goals (deferred to later slices)

- **Rate limits / usage counters** (`rate_*`) — need per-period counter infrastructure; their own slice.
- **`max_workspaces_per_user`** — semantically per-user; defer to the workspace-creation flow.
- **Per-workspace grandfather baselines** — rejected (§4). Existing over-limit workspaces are simply blocked from *new* creation.
- Plan-comparison modals, contextual upsells, usage meters ("full-polish upsell").
- **Dropping the legacy `portal_tokens`/`portal_approvals` tables** — the *access surface* is removed in this slice (functions, route, store), but the physical table DROP is gated on confirming zero active legacy portals (§12), to avoid data loss.

## 4. Key decisions (settled — do not re-litigate)

1. **Enforcement bar = server-side hard.** Counts via DB triggers; features via edge-function guards, a cron filter, and insert triggers; storage via the shared resolver in every quota path. Client UX is advisory only.
2. **Scope = resource counts + feature flags + storage quota sync + legacy-portal retirement.** Rate limits deferred.
3. **Over-limit / downgrade policy = block new, keep existing.** Uniform trigger rule, no per-workspace state. Same on downgrade.
4. **Upgrade UX = conversion-focused essentials.** Locked routes → "upgrade to unlock" screen (not silent `/dashboard` redirect); at-limit "add" buttons reflect state. **Role-locked ≠ plan-locked** (§10.3).
5. **Premium write-features = hard insert-trigger gating** (block new, keep existing) — **including `feature_leads`**.
6. **`feature_hub_portal`** gates the Hub access path (downgraded portals stop serving; owners keep internal access). The **legacy `portal_tokens` path is retired**, not gated.
7. **`max_team_members` = login seats** (`workspace_members`/invites), **not** the `membros` Equipe roster.
8. **Automated/service-role writes are enforced too** (no bypass-via-automation); system writers catch `plan_limit_exceeded` and skip cleanly.
9. **Admin comps flow through the resolver** (no separate bypass — §6.3). Add an **un-comp admin action** to revert sticky `plan_source='manual'`; **stop dual-writing** the deprecated `workspace_plan_overrides.plan_id`.

## 5. Architecture & layering

Three layers, all reading the same effective entitlements:

1. **DB triggers — hard, for counts & direct-insert features.** `BEFORE INSERT` (and `BEFORE INSERT OR UPDATE` for brand) call generic enforcement functions that resolve the entitlement, lock, count/check, and `RAISE` a coded error.
2. **Edge-function guards — hard, for endpoint features & storage.** Path-aware `assertPlanFeature()`; quota resolved from the plan in every storage path; cron filter for auto-sync.
3. **Frontend UX — soft, advisory only.** `useEntitlements` over `useWorkspaceLimits` + counts → at-limit/locked states, upgrade CTAs, generalized route gating, `<FeatureGate>`, upgrade-unlock screen.

**Resolver consistency.** Resolution exists in SQL (triggers/RPCs) and TS (functions/UX). To prevent drift: SQL resolvers `effective_plan_limit` / `effective_plan_feature`, and the existing `workspace-limits` TS resolution extracted into `_shared/entitlements.ts`, reused by `workspace-limits` and the new feature guards.

## 6. Effective entitlement resolvers

### 6.1 SQL — `effective_plan_limit(ws_id uuid, limit_key text) returns bigint`

1. Read `workspaces.plan_id` for `ws_id`; if the workspace row is missing → **fail-closed** (`0`).
2. `effective_plan_id := COALESCE(plan_id, (SELECT id FROM plans WHERE is_default))`; if still null → **fail-closed** (`0`).
3. If `resource_overrides ? limit_key` → return `(resource_overrides->>limit_key)::bigint`.
4. Else return `plans.<limit_key>` for `effective_plan_id`; if that plan row is missing → **fail-closed** (`0`).

**Semantics (apply uniformly to every reader): `NULL` = unlimited; `0` = blocked.** `NULL` only when a *resolved* plan legitimately has a null cap; `0` (fail-closed) on genuinely invalid setup. A migration-time invariant test asserts exactly one `is_default` plan exists, so fail-closed never trips in healthy prod. `effective_plan_feature(ws_id, feature_key) returns boolean` mirrors this against `feature_overrides`/`plans.feature_*`, defaulting `false`.

### 6.2 TS — `_shared/entitlements.ts`

Extract `workspace-limits`' resolution (plan row + override merge + default fallback) into `resolveEntitlements(svc, workspaceId)` → `{ planName, limits, features }`, plus `assertPlanFeature(svc, workspaceId, flag)` throwing a typed `FeatureDisabledError` (→ `403`). `workspace-limits` refactored to use it (behavior unchanged).

### 6.3 Admin-controlled plans & comps (the resolver's inputs)

The admin portal (`platform-admin`) already writes exactly what the resolver reads, so admin control flows into enforcement **with no separate bypass**:

- **`set-workspace-plan`** → `workspaces.plan_id` + `plan_source='manual'`. The resolver returns that plan's limits/features.
- **`set-workspace-overrides`** → `resource_overrides` / `feature_overrides` JSON. The resolver applies these *over* the plan, **in both directions** — an admin can grant or revoke a specific limit/feature regardless of the plan.
- **`clear-workspace-overrides`** → back to the pure plan.

Consequences:
- **Comps are honored everywhere** — count triggers, feature triggers, endpoint guards, and storage all resolve through the same path, so a comped/overridden workspace is enforced exactly as the admin intends. This matches `workspace-limits`' existing TS merge, so SQL and TS agree.
- **Admin downgrade = block-new / keep-existing**, identical to a Stripe downgrade.
- **Ordering caveat:** `set-workspace-plan` clears granular overrides, so admins assign the plan first, then apply overrides.

Changes this slice makes to `platform-admin`:
- **New `unset-workspace-plan` (un-comp) action.** `plan_source='manual'` is sticky and the Stripe webhook never overrides it — so a comped workspace that later subscribes stays stuck on the comp. The new action reverts `plan_source` to `'stripe'` when an active `workspace_subscriptions` row exists, else `'system'`, returning the workspace to normal Stripe-driven billing (and resets `plan_id` accordingly).
- **Stop dual-writing the deprecated `workspace_plan_overrides.plan_id`** in `set-workspace-plan` (`workspaces.plan_id` is the source of truth; the resolver ignores the old column). Column left in place; the override row still carries the JSON overrides.

## 7. Count enforcement (DB triggers)

### 7.1 Generic trigger — `enforce_plan_count_limit()`

`BEFORE INSERT`, configured per table via `TG_ARGV`: `limit_key`, `workspace_mode` (`direct` = a column on the row holds the workspace id; `via_clientes` = derive workspace by joining the row's client FK → `clientes.conta_id`), `workspace_column` (e.g. `conta_id`, `workspace_id`, or the client FK used for the join), `scope_column`, optional `status_predicate`. Logic:

1. Resolve `ws_id` from `NEW` per `workspace_mode`/`workspace_column` (direct read, or `clientes` lookup).
2. `pg_advisory_xact_lock(hashtext(ws_id::text || limit_key))` — serializes concurrent inserts for the same (workspace, resource) so two tabs can't both pass at `limit-1`.
3. `limit := effective_plan_limit(ws_id, limit_key)`; if `NULL` → allow.
4. `EXECUTE` `SELECT count(*)` over the resource in the right scope (`scope_column = NEW.<scope>` directly, or via the `clientes` join for client-derived tables) `[AND status_predicate]`.
5. If `count >= limit` → `RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='plan_limit_exceeded:'||resource`.

Existing rows untouched; only the new insert is rejected. Service-role/automated writes are subject to it too (§12).

### 7.2 Gated map

| Resource | Table | `limit_key` | workspace resolution | count scope / predicate |
|---|---|---|---|---|
| Clients | `clientes` | `max_clients` | `conta_id` (direct) | per `conta_id` |
| Login seats | `workspace_members` (seat table — confirm exact in planning) | `max_team_members` | `conta_id` (direct) | per `conta_id`; `invite-user` pre-checks seats + pending invites |
| Leads | `leads` | `max_leads` | `conta_id` (direct) | per `conta_id` (also feature-gated, §8.3) |
| Instagram accounts | `instagram_accounts` | `max_instagram_accounts` | **via `clientes`** (`client_id`→`clientes.conta_id`) | count across workspace via the `clientes` join (no `conta_id` on table) |
| Hub tokens | `client_hub_tokens` | `max_hub_tokens` | `conta_id` (direct) | per `conta_id` |
| Workflow templates | `workflow_templates` | `max_workflow_templates` | `conta_id` (direct) | per `conta_id` |
| Active workflows / client | `workflows` | `max_active_workflows_per_client` | `conta_id` (direct) | per `cliente_id`, `status='ativo'` |
| Custom properties / template | `template_property_definitions` | `max_custom_properties_per_template` | `conta_id` (direct) | per `template_id` |
| Posts / workflow | `workflow_posts` | `max_posts_per_workflow` | `conta_id` (direct) | per `workflow_id` |

## 8. Feature gating

### 8.1 Endpoint features — path-aware `assertPlanFeature` (hard)

`instagram-analytics` is path-routed; needs a **path→flag matrix**:

| Path | Flag |
|---|---|
| `/overview/:id`, `/posts-analytics/:id`, `/follower-history/:id`, `/portfolio` | `feature_instagram` |
| `/demographics/:id` | `feature_audience_demographics` |
| `/best-times/:id` | `feature_best_times` |
| `POST/DELETE /tags`, `POST/DELETE /posts/:id/tags` | `feature_post_tagging` |
| `POST /ai-analysis/:clientId`, `POST /ai-analysis-portfolio` | `feature_instagram_ai` |
| `POST /generate-report/:clientId`, `GET /reports/:clientId`, `GET /report-download/:reportId`, `POST /send-report-email` | `feature_analytics_reports` |

Other endpoint guards:
- `feature_analytics_reports`: also guard `instagram-report-generator-v2` (the only generator `report-worker` invokes, via `X-Internal-Token`). `report-worker` (cron/internal, `x-cron-secret`) adds a `conta_id`-has-`feature_analytics_reports` filter to candidate selection (or re-checks after claim and marks `skipped`). `-generator` v1 is retired/ignored in this slice (confirm no other caller).
- `feature_post_scheduling` → `instagram-publish`.
- `feature_instagram` → `instagram-integration` connect/sync (currently `true` on all plans; wired for future toggling).

### 8.2 Cron feature

`feature_auto_sync_cron`: `instagram-sync-cron`'s candidate query selects `instagram_accounts` only (no `conta_id`), so the filter joins through `clientes` (or pre-fetches an allowed-workspace set). Interacts with the pending `2026-05-25-instagram-sync-cron-perf` plan — coordinate.

### 8.3 Direct-insert / write features — `enforce_plan_feature()` trigger (hard)

Block creating new premium objects when the flag is off (existing readable/editable). For brand, `BEFORE INSERT OR UPDATE`. Same `workspace_mode` mechanism as §7.1 (some tables resolve the workspace via `clientes`):

| Flag | Table | workspace resolution | trigger |
|---|---|---|---|
| `feature_hub_portal` | `client_hub_tokens` | `conta_id` | INSERT |
| `feature_custom_properties` | `template_property_definitions` | `conta_id` | INSERT (also count trigger) |
| `feature_financial` | `transacoes` | `conta_id` | INSERT |
| `feature_contracts` | `contratos` | `conta_id` | INSERT |
| `feature_ideas` | `ideias` | **`workspace_id`** (not `conta_id`) | INSERT |
| `feature_leads` | `leads` | `conta_id` | INSERT (also count trigger) |
| `feature_brand_customization` | `hub_brand` (+ `hub_brand_files`) | **via `clientes`** (`cliente_id`→`clientes.conta_id`) | INSERT OR UPDATE |

### 8.4 Hub access guard + legacy-portal retirement

- **Hub:** no shared token resolver exists today — it's duplicated inline across `hub-bootstrap`, `hub-posts`, `hub-reports`, etc. (e.g. `hub-bootstrap/handler.ts:38-44`). First extract `_shared/hub-token.ts`; the `feature_hub_portal` guard composes with the existing `conta.hub_enabled` check. Downgraded workspaces' Hub portals stop serving; owners keep internal CRM access to existing hub data.
- **Legacy portal retirement:** remove the `portal_tokens` access surface — edge functions `portal-data` + `portal-approve`, the `/portal/:token` route in `App.tsx`, and `store/portal.ts`. Physical DROP of `portal_tokens`/`portal_approvals` deferred until confirmed zero active legacy portals (§12).

### 8.5 Client UI gating (packaging + conversion; never the boundary)

- Generalize `ProtectedRoute`'s map: `/analytics`, `/analytics/:id`, `/analytics-fluxos` → `feature_analytics_reports`; `/leads` → `feature_leads`; `/financeiro` → `feature_financial`; `/contratos` → `feature_contracts`; `/ideias` → `feature_ideas`; `/post-express` → `feature_post_scheduling`. **Preserve the existing agent role-gating** (`/financeiro`, `/contratos`, `/leads`, `/equipe`).
- Replace the silent `/dashboard` redirect with an **upgrade-unlock screen** (§10.3).
- `<FeatureGate flag>` for embedded surfaces (dashboard cards, client-detail tabs, CSV-import buttons, gantt/recurrence/tagging/brand controls) → inline upgrade nudge, not silent hiding.
- `feature_csv_import` → `<FeatureGate>` import buttons (per-row inserts via `addCliente` still hit the count triggers).
- `feature_workflow_gantt`, `feature_workflow_recurrence` → `<FeatureGate>` (UI-only).
- Sidebar reflects feature availability.

### 8.6 Feature treatment summary

| Feature | Mechanism |
|---|---|
| `feature_instagram` | fn guard (`instagram-integration`, IA base paths) |
| `feature_instagram_ai` | IA `/ai-analysis*` path guards |
| `feature_analytics_reports` | IA report paths + `-generator-v2` guard + `report-worker` filter + route-gate |
| `feature_best_times` / `feature_audience_demographics` | IA path guards + `<FeatureGate>` |
| `feature_hub_portal` | insert trigger (`client_hub_tokens`) + Hub access guard (legacy portal retired) |
| `feature_leads` | **insert trigger (`leads`)** + count trigger + route-gate |
| `feature_financial` | insert trigger (`transacoes`) + route-gate |
| `feature_contracts` | insert trigger (`contratos`) + route-gate |
| `feature_ideas` | insert trigger (`ideias`, `workspace_id`) + route-gate |
| `feature_workflow_gantt` / `feature_workflow_recurrence` | `<FeatureGate>` (UI-only) |
| `feature_csv_import` | `<FeatureGate>` import buttons |
| `feature_custom_properties` | insert trigger + count trigger + `<FeatureGate>` |
| `feature_post_scheduling` | fn guard (`instagram-publish`) + route-gate |
| `feature_auto_sync_cron` | cron filter (via `clientes` join) |
| `feature_post_tagging` | IA `/tags` path guards + `<FeatureGate>` |
| `feature_brand_customization` | insert/update trigger (`hub_brand`, via `clientes`) + `<FeatureGate>` |

## 9. Storage quota — full enforcement surface

Every quota reader resolves from the plan via `effective_plan_limit(conta_id, 'storage_quota_bytes')`, and **all readers normalize to `NULL` = unlimited, `0` = blocked** (today `file-manage` treats `quota > 0` as the gate — i.e. `0` = unlimited — which is backwards vs the resolver and must be fixed):

1. **Presign:** `post-media-upload-url`, `file-upload-url`.
2. **Authoritative finalize RPCs:** swap the `SELECT storage_quota_bytes FROM workspaces` for the resolver in `post_media_insert_with_quota` (`20260412_post_media_quota_atomic.sql`) and `file_insert_with_quota` (`20260425000002_file_system_triggers.sql`); keep `storage_used_bytes`. Standardize both to `RAISE 'quota_exceeded' USING ERRCODE='P0001'` (today one uses `check_violation`, the other none).
3. **`file-manage`:** copy/duplicate checks (`handler.ts` ~277, ~389) **and** quota display (~171) — switch to the resolver and the normalized comparison.

`workspaces.storage_quota_bytes` then has zero readers → deprecated. Downgrade: existing files stay; new uploads **and** copy/duplicate of existing files/folders return `quota_exceeded` until under quota.

## 10. Frontend UX & error handling

### 10.1 Error contract

| Origin | Shape |
|---|---|
| Count triggers | `RAISE plan_limit_exceeded:<resource>` (`P0001`) → `error.message` |
| Quota RPCs | `RAISE 'quota_exceeded'` (standardized `ERRCODE='P0001'`) → `error.message` |
| Storage functions | `413 { error:"quota_exceeded", used, quota[, copy_bytes] }` (existing `file-manage` shape) |
| Feature guards | `403 { error:"feature_disabled", feature:"<flag>" }` |

`mapEntitlementError()` normalizes both JSON bodies and raised-message strings → `{ kind:'limit'|'feature'|'quota', resource|feature, used?, quota? }` → friendly PT copy + CTA, shown from the mutation's `onError`.

### 10.2 Advisory at-limit UX

`useEntitlements` over `useWorkspaceLimits` + counts → `isAtLimit(resource)` / `hasFeature(flag)`; "Adicionar" buttons render disabled-with-tooltip before the hard error. The trigger (with advisory lock) is the backstop.

**Counts source (hybrid):** reuse loaded list lengths; a small `entitlement-usage` query only where no list is loaded. **Invalidation:** every create/delete on a gated resource invalidates the list query **and** `['workspace-limits']` + `['entitlement-usage', resource]` via a shared helper, so disabled states don't go stale.

### 10.3 Locked features — role vs plan must diverge

- **Plan-locked:** upgrade-unlock screen with feature name + "Fazer upgrade" CTA → `/configuracao/cobranca`.
- **Role-locked / non-owner:** `/configuracao/cobranca` is **owner-only**, so agents/non-owners must **not** see an upgrade CTA — show "fale com o dono do workspace" copy instead. `ProtectedRoute` keeps role-gating distinct from plan-gating.

## 11. Testing

**DB:**
- Generic count trigger: at-limit blocks, under allows, `NULL`=unlimited, `0`=blocked, override raises limit, keep-existing on downgrade, per-entity scope, **`via_clientes` resolution** (instagram_accounts/hub_brand), **advisory-lock concurrency** (two concurrent inserts at `limit-1` → exactly one succeeds), error message shape.
- `effective_plan_limit`/`effective_plan_feature`: merge, default fallback, fail-closed, `is_default` invariant.
- Finalize RPCs resolve via the resolver (presign ↔ finalize agree); standardized error code.
- `enforce_plan_feature` triggers incl. `leads`, `ideias` (`workspace_id`), brand insert/update.

**Edge functions (Deno):**
- `instagram-analytics` full path→flag matrix (incl. AI + report paths).
- `report-worker` selection filter; `instagram-report-generator-v2` guard.
- Hub access guard (downgraded token blocked; owner internal access allowed); `_shared/hub-token.ts`.
- Legacy portal removal (no `portal-data`/`portal-approve`; `/portal/:token` gone).
- Storage resolve-at-check-time across presign + `file-manage` copy/duplicate.
- System-writer paths skip cleanly on `plan_limit_exceeded` (don't crash the batch).
- `platform-admin`: `set-workspace-plan` no longer writes the deprecated `plan_id`; new `unset-workspace-plan` reverts `plan_source` (→ `'stripe'` with an active subscription, else `'system'`); a comped/overridden workspace resolves to the intended limits/features (overrides honored both directions).
- Update `__tests__/config-audit_test.ts`'s `REQUIRED_FUNCTIONS` list for any added/removed function.

**Frontend:**
- Generalized `ProtectedRoute` map + role-vs-plan divergence + non-owner copy; upgrade-unlock screen; `<FeatureGate>`; `mapEntitlementError` → prompt; at-limit states; invalidation refreshes disabled state. (Mirrors `ProtectedRoute.test.tsx`.)

**Acceptance criteria:**
- Over-limit workspace cannot create new gated resources beyond its limit; existing fully accessible.
- Over-quota workspace can neither **upload nor duplicate** files/folders.
- Feature-off workspace is blocked at the server regardless of UI; sees a clear upgrade path (owner) or "contact owner" (non-owner).
- Downgraded workspace's Hub portals stop serving; legacy portals no longer reachable; owner still sees existing hub data internally.
- Concurrent creation at the boundary cannot overshoot the limit.

## 12. Rollout & migration

**Sequence:** migrations (resolvers, count triggers w/ advisory lock, feature triggers, RPC swaps) → edge-function deploys (guards, `report-worker`, `_shared/hub-token.ts` + Hub guard, storage paths, legacy-portal removal, `platform-admin` un-comp action + drop deprecated dual-write) → frontend (route gating, `<FeatureGate>`, error mapper, `useEntitlements`, `/portal/:token` removal).

**System write paths — enumerate before coding** (decision 8: enforce + skip): every server-side inserter into the 9 gated tables — workflow recurrence (`workflows`/`workflow_posts`), hub approval flows, any cron/import — must catch `plan_limit_exceeded` and skip cleanly rather than crash. Planning produces this inventory.

**No backfill:** counts keep-existing; storage resolves live. `workspaces.storage_quota_bytes` left unread.

**Behavior change:** enforcement bites immediately for existing over-limit/over-feature/over-quota workspaces (new-creation only). **Comms** to affected free users; explicitly note that beyond uploads, **duplicating files/folders** also fails when over quota.

**Legacy portal:** remove access surface in this slice; **confirm zero active legacy portals** (query `portal_tokens` usage / recent `portal-data` traffic) before a later migration drops the tables.

**Rollback:** drop the new triggers + revert function guards + revert RPC/storage edits. Restoring the legacy portal means reverting its removal commits. No data migration to reverse (tables not dropped).

## 13. Open items (pin during planning, not blocking)

- Exact login-seat table/semantics for `max_team_members` (`workspace_members` vs `invites`; whether pending invites count).
- Confirm `instagram-report-generator` v1 has no remaining callers before retiring its guard.
- Produce the **system-writer inventory** (§12) for the 9 gated tables.
- Confirm zero active legacy portals before scheduling the `portal_tokens`/`portal_approvals` table DROP.
- Coordinate the `feature_auto_sync_cron` `clientes`-join filter with the `2026-05-25-instagram-sync-cron-perf` plan.
