# Paywall & Feature Gating — Design Spec

**Date:** 2026-06-11
**Status:** Draft for review
**Branch:** TBD (new slice; builds on the merged money-in loop)
**Related:** `2026-06-09-stripe-payments-money-in-design.md` (Slice 1 — money-in loop)

---

## 1. Context & motivation

The Stripe money-in loop (Slice 1) is live on prod: an owner can subscribe, the webhook writes `workspaces.plan_id` + `plan_source`, and `workspace-limits` computes the plan's limits/features. **But almost nothing is enforced.** Today, upgrading a plan only:

- unlocks 3 feature-gated routes (`/analytics`, `/post-express`, `/ideias`) via `ProtectedRoute`;
- has no effect on any resource count (limits are computed but never read for enforcement; the April `enforce_*` triggers were never deployed to prod);
- does not change the storage quota (enforced against `workspaces.storage_quota_bytes`, which nothing syncs from the plan).

A paying customer therefore gets a correct subscription + Billing Portal + 3 pages, and otherwise the same limits as Free. This slice builds the **paywall**: real, server-enforced differentiation so paid plans are worth paying for, before we charge real customers.

## 2. Goals

- **Server-side hard enforcement** of resource counts, feature access, and storage quota — not bypassable by hitting Supabase/edge functions directly.
- One **single source of truth**: a workspace's effective entitlements = its plan (`workspaces.plan_id` → `plans`) merged with admin overrides (`workspace_plan_overrides.resource_overrides` / `feature_overrides`).
- **Conversion-focused UX**: clear "limit reached" / "feature locked" states with an upgrade CTA, replacing today's silent redirect.
- **Humane policy**: never delete, hide, or lock existing data. Enforcement blocks only *new* creation while at/over limit — including after downgrade/cancellation.

## 3. Non-goals (deferred to later slices)

- **Rate limits / usage counters** (`rate_instagram_syncs_per_day`, `rate_ai_analyses_per_month`, `rate_report_generations_per_month`) — need per-period counter infrastructure; their own slice.
- **`max_workspaces_per_user`** — semantically per-user (not per-workspace); ambiguous which plan governs it, and multi-workspace is an edge case. Defer to the workspace-creation flow.
- **Grandfathering with per-workspace baselines** — explicitly rejected (see §4). Existing over-limit workspaces are simply blocked from *new* creation.
- Plan-comparison modals, contextual upsells, usage meters approaching limits ("full-polish upsell").

## 4. Key decisions (settled — do not re-litigate)

1. **Enforcement bar = server-side hard.** Counts via DB triggers; features via edge-function guards, a cron filter, and insert triggers; storage via the shared resolver in every quota path. Client UX is advisory only, never the security boundary.
2. **Scope = resource counts + feature flags + storage quota sync.** Rate limits deferred.
3. **Over-limit / downgrade policy = block new, keep existing.** Never delete/hide/lock existing data. Triggers reject only inserts while `count >= limit`. Uniform rule, no per-workspace grandfather state. Same on downgrade.
4. **Upgrade UX = conversion-focused essentials.** Clear blocked messaging + CTA to `/configuracao/cobranca`; locked routes show an "upgrade to unlock" screen (not a silent `/dashboard` redirect); key "add" buttons reflect an at-limit state.
5. **Premium write-features = hard insert-trigger gating** (block creating new premium objects when the flag is off; existing stays readable/editable).
6. **Hub portals stop serving when `feature_hub_portal` is off** (guard the public hub access path), while owners keep internal access to existing hub data.

## 5. Architecture & layering

Three layers, all reading the same effective entitlements:

1. **DB triggers — hard, for counts & direct-insert features.** `BEFORE INSERT` (and `BEFORE INSERT OR UPDATE` for brand) call a generic enforcement function that resolves the entitlement, counts/checks, and `RAISE`s a coded error.
2. **Edge-function guards — hard, for endpoint features & storage.** Path-aware `assertPlanFeature()` in feature functions; quota resolved from the plan in every storage path; cron filter for auto-sync.
3. **Frontend UX — soft, advisory only.** `useEntitlements` over `useWorkspaceLimits` + counts → at-limit/locked states, upgrade CTAs, generalized route gating, `<FeatureGate>`, upgrade-unlock screen.

**Resolver consistency.** Entitlement resolution exists in SQL (triggers/RPCs) and TS (functions/UX). To prevent drift: one SQL resolver `effective_plan_limit(...)` and the existing `workspace-limits` TS resolution extracted into `_shared/entitlements.ts`, reused by both `workspace-limits` and the new feature guards. Both small and tested.

## 6. Effective entitlement resolvers

### 6.1 SQL — `effective_plan_limit(ws_id uuid, limit_key text) returns bigint`

Resolution order:
1. Read `workspaces.plan_id` for `ws_id`. If the workspace row is missing → **fail-closed** (return `0`).
2. `effective_plan_id := COALESCE(plan_id, (SELECT id FROM plans WHERE is_default))`. If still null (no default plan) → **fail-closed** (`0`).
3. If `workspace_plan_overrides.resource_overrides ? limit_key` → return `(resource_overrides->>limit_key)::bigint`.
4. Else return `plans.<limit_key>` for `effective_plan_id`. If that plan row is missing → **fail-closed** (`0`).

**Semantics:** returns `bigint`. **`NULL` = unlimited** — only when a *resolved* plan legitimately has a null cap. **Fail-closed (`0`)** on genuinely invalid setup (no workspace / no resolvable plan / no default plan). A migration-time invariant test asserts exactly one `is_default` plan exists, so fail-closed never trips in healthy prod.

A parallel `effective_plan_feature(ws_id uuid, feature_key text) returns boolean` uses the same resolution against `feature_overrides` / `plans.feature_*`, defaulting to `false` (fail-closed) on invalid setup.

### 6.2 TS — `_shared/entitlements.ts`

Extract `workspace-limits`' current resolution (plan row + `resource_overrides`/`feature_overrides` merge + default fallback) into a shared module exporting `resolveEntitlements(svc, workspaceId)` → `{ planName, limits, features }`, plus `assertPlanFeature(svc, workspaceId, flag)` which throws a typed `FeatureDisabledError` (→ `403`). `workspace-limits` is refactored to use it (behavior unchanged).

## 7. Count enforcement (DB triggers)

### 7.1 Generic trigger — `enforce_plan_count_limit()`

`BEFORE INSERT`, configured per table via `TG_ARGV`: `limit_key`, `scope_column` (default `conta_id`), optional `status_predicate`. Logic:
1. `limit := effective_plan_limit(NEW.conta_id, limit_key)`.
2. If `limit IS NULL` → unlimited, allow.
3. Else `EXECUTE` `SELECT count(*) FROM <TG_TABLE_NAME> WHERE <scope_column> = NEW.<scope_column> [AND <status_predicate>]`.
4. If `count >= limit` → `RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='plan_limit_exceeded:'||resource`.

Existing rows are never touched; only the new insert is rejected.

### 7.2 Gated map

**Workspace-scoped (headline):**

| Resource | Table | `limit_key` | scope |
|---|---|---|---|
| Clients | `clientes` | `max_clients` | `conta_id` |
| Team seats | `membros` | `max_team_members` | `conta_id` |
| Leads | `leads` | `max_leads` | `conta_id` |
| Instagram accounts | `instagram_accounts` | `max_instagram_accounts` | `conta_id` |
| Hub tokens | `client_hub_tokens` | `max_hub_tokens` | `conta_id` |
| Workflow templates | `workflow_templates` | `max_workflow_templates` | `conta_id` |

**Sub-entity-scoped (granular):**

| Resource | Table | `limit_key` | scope | predicate |
|---|---|---|---|---|
| Active workflows / client | `workflows` | `max_active_workflows_per_client` | `cliente_id` | active status (**pin in planning**) |
| Custom properties / template | `template_property_definitions` | `max_custom_properties_per_template` | `template_id` | — |
| Posts / workflow | `workflow_posts` | `max_posts_per_workflow` | `workflow_id` | — |

`membros`: the trigger is the backstop; also add a friendly pre-check in the `invite-user` edge function so invites fail gracefully rather than with a raw DB error.

## 8. Feature gating

All read the effective `feature_*` flags. Mechanism by reach path:

### 8.1 Endpoint features — path-aware `assertPlanFeature` (hard)

`instagram-analytics` is path-routed and multi-capability, so it needs a **path→flag matrix**, not one top-level guard:

| Path | Flag |
|---|---|
| `/overview/:id`, `/posts-analytics/:id`, `/follower-history/:id`, `/portfolio` | `feature_instagram` |
| `/demographics/:id` | `feature_audience_demographics` |
| `/best-times/:id` | `feature_best_times` |
| `POST/DELETE /tags`, `POST/DELETE /posts/:id/tags` | `feature_post_tagging` |
| AI analysis endpoint (**pin exact path in planning**) | `feature_instagram_ai` |

Other endpoint guards:
- `feature_analytics_reports` → `instagram-report-generator(-v2)` guards; **and** `report-worker` (cron/internal, `x-cron-secret`) adds a `conta_id`-has-`feature_analytics_reports` filter to its candidate selection (or re-checks immediately after claim and marks `skipped` cleanly) so non-entitled reports are never generated.
- `feature_post_scheduling` → `instagram-publish`.
- `feature_instagram` → `instagram-integration` connect/sync (currently `true` on all plans, wired for future admin toggling).

### 8.2 Cron feature

`feature_auto_sync_cron`: the Instagram sync cron filters to workspaces whose effective plan enables it.

### 8.3 Direct-insert / write features — `enforce_plan_feature()` trigger (hard)

`BEFORE INSERT` (block creating new premium objects; existing readable/editable). For brand, `BEFORE INSERT OR UPDATE` (block edits, keep existing values):

| Flag | Table | Trigger |
|---|---|---|
| `feature_hub_portal` | `client_hub_tokens` | INSERT |
| `feature_custom_properties` | `template_property_definitions` | INSERT (also has count trigger) |
| `feature_financial` | `transacoes` | INSERT |
| `feature_contracts` | `contratos` | INSERT |
| `feature_ideas` | `ideias` | INSERT |
| `feature_brand_customization` | `hub_brand` (+ `hub_brand_files`) | INSERT OR UPDATE |

### 8.4 Hub public access guard

`feature_hub_portal`: add a feature check in the shared hub token-resolution path (`hub-*` functions / `portal-data`) so a downgraded workspace's public portals **stop serving**. Owners keep full *internal* access to existing hub data in the CRM.

### 8.5 Client UI gating (packaging + conversion; never the boundary)

- Generalize `ProtectedRoute`'s map: `/analytics`, `/analytics/:id`, `/analytics-fluxos` → `feature_analytics_reports`; `/leads` → `feature_leads`; `/financeiro` → `feature_financial`; `/contratos` → `feature_contracts`; `/ideias` → `feature_ideas`; `/post-express` → `feature_post_scheduling`.
- Replace the silent `/dashboard` redirect with an **upgrade-unlock screen** (feature name + CTA → `/configuracao/cobranca`).
- `<FeatureGate flag>` for embedded surfaces (dashboard cards, client-detail tabs, CSV-import buttons, gantt/recurrence/tagging/brand controls) → **inline upgrade nudge** rather than silently hiding, so gated data surfaces stay visible-but-locked. Whole feature areas route-gate; embedded sections `<FeatureGate>`.
- `feature_csv_import` → `<FeatureGate>` the import buttons in Clientes/Leads (per-row inserts still hit the count triggers).
- `feature_workflow_gantt`, `feature_workflow_recurrence` → `<FeatureGate>` the view/control (UI-only; recurrence is not in the hard write-trigger set).
- Sidebar reflects feature availability.

### 8.6 Feature treatment summary

| Feature | Mechanism |
|---|---|
| `feature_instagram` | fn guard (`instagram-integration`, IA base paths) |
| `feature_instagram_ai` | fn guard (AI path) |
| `feature_analytics_reports` | fn guard (generator) + `report-worker` selection filter + route-gate |
| `feature_best_times` | IA path guard + `<FeatureGate>` |
| `feature_audience_demographics` | IA path guard + `<FeatureGate>` |
| `feature_hub_portal` | insert trigger (`client_hub_tokens`) + public-access guard |
| `feature_leads` | route-gate + existing `max_leads` count trigger |
| `feature_financial` | insert trigger (`transacoes`) + route-gate |
| `feature_contracts` | insert trigger (`contratos`) + route-gate |
| `feature_ideas` | insert trigger (`ideias`) + route-gate |
| `feature_workflow_gantt` | `<FeatureGate>` (UI-only) |
| `feature_workflow_recurrence` | `<FeatureGate>` (UI-only) |
| `feature_csv_import` | `<FeatureGate>` import buttons |
| `feature_custom_properties` | insert trigger (`template_property_definitions`) + count trigger + `<FeatureGate>` |
| `feature_post_scheduling` | fn guard (`instagram-publish`) + route-gate |
| `feature_auto_sync_cron` | cron filter |
| `feature_post_tagging` | IA `/tags` path guard + `<FeatureGate>` |
| `feature_brand_customization` | insert/update trigger (`hub_brand`) + `<FeatureGate>` |

## 9. Storage quota — full enforcement surface

The plan becomes the single source of truth; every quota reader switches to `effective_plan_limit(conta_id, 'storage_quota_bytes')` so presign, finalize, copy, and display all agree:

1. **Presign:** `post-media-upload-url`, `file-upload-url`.
2. **Authoritative finalize RPCs:** swap the `SELECT storage_quota_bytes FROM workspaces` for the resolver in `post_media_insert_with_quota` (`20260412_post_media_quota_atomic.sql`) and `file_insert_with_quota` (`20260425000002_file_system_triggers.sql`). Keep `storage_used_bytes` reads/increments. Both already treat NULL as unlimited.
3. **`file-manage`:** copy/duplicate quota checks (`handler.ts` ~277, ~389) **and** the quota display (~171).

`storage_used_bytes` (the atomic usage counter) is unchanged — only the quota *source* changes. `workspaces.storage_quota_bytes` then has zero readers → deprecated (leave column, drop later). Downgrade: existing files stay; new uploads **and** copy/duplicate of existing files/folders return `quota_exceeded` until under quota.

## 10. Frontend UX & error handling

### 10.1 Error contract

| Origin | Shape |
|---|---|
| Count trigger | `RAISE plan_limit_exceeded:<resource>` (SQLSTATE `P0001`) → surfaced in `error.message` |
| Quota RPCs | `RAISE 'quota_exceeded'` — **standardize both RPCs to `ERRCODE='P0001'`** (today one uses `check_violation`, the other none) |
| Storage functions | `413 { error: "quota_exceeded", used, quota[, needed] }` (matches existing `file-manage` shape) |
| Feature guards | `403 { error: "feature_disabled", feature: "<flag>" }` |

A client `mapEntitlementError()` normalizes both the JSON bodies (functions) and the raised-message strings (PostgREST mutations) → `{ kind: 'limit' | 'feature' | 'quota', resource | feature, used?, quota? }` → friendly PT copy + a "Fazer upgrade" CTA → `/configuracao/cobranca`, shown from the mutation's `onError`.

### 10.2 Advisory at-limit UX

`useEntitlements` layers over `useWorkspaceLimits` (limits/features) + current counts → `isAtLimit(resource)` and `hasFeature(flag)`. "Adicionar" buttons render disabled-with-tooltip + upgrade nudge *before* the hard error. The DB trigger remains the backstop for the two-tabs-at-the-boundary race.

**Counts source (hybrid):** reuse already-loaded list lengths where present; a small `entitlement-usage` counts query only where no list is loaded (e.g., a dashboard button).

**Invalidation rule:** every create/delete on a gated resource invalidates **both** the resource's list query **and** `['workspace-limits']` + `['entitlement-usage', resource]`, via a shared invalidation helper — otherwise disabled buttons go stale after create/delete where counts are fetched separately.

### 10.3 Locked features

Generalized `ProtectedRoute` → upgrade-unlock screen; `<FeatureGate flag>` inline nudges for embedded sections; Sidebar reflects availability (see §8.5).

## 11. Testing

**DB:**
- Generic count trigger: at-limit blocks, under allows, NULL=unlimited allows, override raises limit, keep-existing on downgrade, per-entity scope (workflows/templates/posts), error code/message shape.
- `effective_plan_limit`: plan + override merge, default fallback, **fail-closed on invalid setup**, NULL=unlimited; invariant test that exactly one `is_default` plan exists.
- Finalize RPCs (`post_media_insert_with_quota`, `file_insert_with_quota`) resolve via `effective_plan_limit` (presign ↔ finalize agree); standardized error code.
- `enforce_plan_feature` triggers: insert blocked when off, existing editable, brand insert/update.

**Edge functions (Deno):**
- `instagram-analytics` path→flag matrix (each path over/under-blocks correctly).
- `report-worker` selection filter (non-entitled reports not generated/marked skipped).
- Hub public-access guard: downgraded token blocked; owner internal access allowed.
- Storage resolve-at-check-time across presign + `file-manage` copy/duplicate.
- Update `config-audit` if any new function is added.

**Frontend:**
- Generalized `ProtectedRoute` map + upgrade-unlock screen; `<FeatureGate>`; `mapEntitlementError` → upgrade prompt; at-limit button states; invalidation refreshes disabled state after create/delete. (Mirrors existing `ProtectedRoute.test.tsx`.)

**Acceptance criteria:**
- A free/over-limit workspace cannot create new clients/leads/etc. beyond its limit, but retains full access to existing ones.
- An over-quota workspace can neither **upload nor duplicate** files/folders.
- A workspace lacking a feature flag is blocked at the server (function/trigger) regardless of UI, and sees a clear upgrade path in the UI.
- A downgraded workspace's public hub portals stop serving; the owner still sees existing hub data internally.

## 12. Rollout & migration

**Sequence:** migrations (resolver functions, count triggers, feature triggers, RPC swaps) → edge-function deploys (guards, report-worker, hub access, storage paths) → frontend (route gating, `<FeatureGate>`, error mapper, `useEntitlements`).

**No backfill:** counts are keep-existing; storage resolves live from the plan. `workspaces.storage_quota_bytes` left in place, unread.

**Behavior change:** enforcement bites immediately on deploy for existing over-limit / over-feature / over-quota workspaces (new-creation only, per policy). **Comms:** notify affected free users in advance; explicitly state that beyond uploads, **duplicating existing files/folders** also fails when over quota.

**Rollback:** drop the new triggers + revert the function guards + revert the RPC/storage-path edits. Clean — no data migration to reverse.

## 13. Open items (pin during planning, not blocking)

- Exact "active" `workflows.status` value(s) for `max_active_workflows_per_client`.
- Exact `feature_instagram_ai` endpoint path in `instagram-analytics` (or report generator).
- Confirm `instagram_accounts.conta_id` column name (assumed; all other gated tables confirmed).
- Confirm the shared hub token-resolution entry point used by the `hub-*` functions for the access guard.
