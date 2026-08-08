# Plan usage indicators — design

**Date:** 2026-08-08
**Status:** Approved

## Problem

Plan limits exist and are enforced (DB triggers, edge pre-checks, storage RPCs), but the
user has almost no visibility into where they stand until they hit a wall. Today:

- **Equipe** has a seat meter (`InviteSection.tsx` `SeatMeter`) and **Arquivos** has a
  storage bar (`ArquivosPage.tsx` sidebar + `MobileArquivosView.tsx` `StorageCard`) —
  two independently written meters with different styles and thresholds.
- **Clientes** and **Leads** only disable the create button at the limit, with a plain
  HTML `title="Limite do plano atingido"` tooltip. No visible counter.
- **Plano & Cobrança** shows the plan *catalog*, never the workspace's *usage*.
- Every other countable limit (hub tokens, templates, Instagram accounts, MCP keys)
  surfaces nowhere until an insert fails.

The paywall spec (`2026-06-11-paywall-feature-gating-design.md` §10.2) anticipated an
advisory at-limit UX with usage counts; it was never built.

## Decisions (approved)

1. **Surfaces: both.** A central "Uso do plano" panel on Configurações > Plano & Cobrança
   showing all workspace-wide limits vs usage, plus in-context meters on the relevant pages.
2. **Coverage: all in panel, core in-context.** The panel shows every workspace-wide
   countable limit + storage. In-context meters on Clientes, Equipe, Arquivos, and Leads
   (Leads already has the identical disabled-button pattern).
3. **Visibility: all roles see the in-context meters; upgrade CTA is owner-only.**
   The central panel lives on the billing page, which is and stays owner-only
   (`configTabs.ts` hides the tab, `CobrancaPage` renders an access-denied card) —
   non-owners get the in-context meters only. "Owner" is resolved for the **active
   workspace**: `(workspaceRole ?? role) === 'owner'`, the same test `CobrancaPage.tsx:73`
   uses; while `membershipResolved` is false, render no CTA.
4. **Usage source: new Postgres RPC for the panel; page-local data in context.**
   In-context meters use each page's already-loaded list where that count is exact
   (Clientes, Equipe); Leads needs an exact head-count query instead (see §5). Arquivos
   keeps its `file-manage` storage payload.

## Architecture

### 1. `workspace_usage()` RPC (new migration)

`SECURITY DEFINER`, `set search_path = public`. Grants follow the hardened pattern of
`20260730000008_admin_list_workspaces_rpc.sql:106-108`: `REVOKE ALL ... FROM PUBLIC`,
`FROM anon`, then `GRANT EXECUTE TO authenticated` **and re-grant `service_role`
explicitly** (default privileges grant new public-schema functions to anon/authenticated,
and revoking from PUBLIC strips service_role). A psql test asserts `anon` cannot execute.
Scoped to `public.get_my_conta_id()`; when that resolves NULL (no active workspace),
return an empty/zeroed jsonb rather than erroring — fail-safe, mirrors the RLS posture.

Returns one jsonb object whose count expressions **mirror the enforcement triggers
exactly** (`20260611130003_count_triggers.sql`, `20260622120001_mcp_api_keys.sql`):

| Field | Expression |
|---|---|
| `clients` | `count(*) from clientes where conta_id = ws` |
| `team_members` | `count(*) from workspace_members where workspace_id = ws` |
| `pending_invites` | `count(*) from invites where conta_id = ws and status = 'pending'` (separate field; seats display = members + pending, same as `_shared/invite-actions.ts`) — **raw pending, no expiry filter**, because that is exactly what the server seat pre-check counts: an expired-but-unprocessed invite still consumes a seat until revoked/replaced. Rule: usage displays mirror enforcement. |
| `leads` | `count(*) from leads where conta_id = ws` |
| `hub_tokens` | `count(*) from client_hub_tokens where conta_id = ws` (no predicate — the trigger counts all rows) |
| `workflow_templates` | `count(*) from workflow_templates where conta_id = ws` |
| `instagram_accounts` | `count(*) from instagram_accounts t join clientes c on c.id = t.client_id where c.conta_id = ws` |
| `mcp_keys` | `count(*) from mcp_api_keys where conta_id = ws and revoked_at is null` |
| `storage_used_bytes` | `workspaces.storage_used_bytes` (the maintained counter) |

Per-entity limits (`max_active_workflows_per_client`, `max_posts_per_workflow`,
`max_custom_properties_per_template`) and `max_workspaces_per_user` are **excluded** —
they are not workspace-wide numbers and don't fit a workspace usage panel.

### 2. `useWorkspaceUsage()` hook (new, `apps/crm/src/hooks/useWorkspaceUsage.ts`)

TanStack query over `supabase.rpc('workspace_usage')`, key
`['workspace-usage', workspaceId]` (workspaceId from `AuthContext`, same convention as
`useWorkspaceLimits`), short `staleTime` (~30s). Consumed only by the Cobrança panel, so
no cross-page invalidation wiring is needed; the panel refetches on mount/stale.

### 3. `UsageMeter` shared component (new, `apps/crm/src/components/usage/UsageMeter.tsx`)

Unifies the seat meter and the storage bar. Props:

- `label`, `used: number`, `limit: number | null` (`null` = unlimited)
- `format?: (n: number) => string` — count formatter by default, bytes formatter for storage
- `size?: 'compact' | 'full'` — compact for page headers, full for the panel
- optional `children`/slot for extras (the invite preview line)

An exported pure helper owns the threshold logic (single source for all meters):

- `ok` → bar in `--success`
- `warning` when `remaining <= 1` **or** `used/limit >= 0.8` → `--warning`
  (the `<= 1` arm covers tiny limits like 2 clients where 80% never triggers)
- `danger` when `used >= limit` → `--danger`
- `limit === 0` (fail-closed "blocked" sentinel, e.g. free plan's `max_hub_tokens`) →
  distinct **blocked** state: no bar, no division, "Não incluído no plano" text, owner
  CTA. Never renders as "0 de 0" danger.
- `limit === null` → no bar; count + "Ilimitado" badge

`UsageMeter` is purely presentational: it renders only when the caller hands it a
**resolved** limit. Unknown/unavailable limits are the caller's job — Equipe keeps its
`computeSeatState` wrapper (whose `unavailable` state disables inviting and must not be
conflated with unlimited), and Clientes/Leads/panel render nothing while
`limits === null`. Loading renders a subtle skeleton at the call sites that expect a
meter; if `useWorkspaceLimits().isUnlimited` (server resolved **no plan** — not
"unlimited plan"), meters don't render at all, the same skip `ProtectedRoute` does.

Owner-only CTA: when state is `warning`/`danger`/`blocked` and the **active-workspace**
role is owner (`(workspaceRole ?? role) === 'owner'`, as `CobrancaPage.tsx:73`; no CTA
while `membershipResolved` is false), render a "Fazer upgrade" link to
`/configuracao/cobranca`. Non-owners get no CTA.

### 4. Central panel — "Uso do plano" (CobrancaPage)

New section above the plan catalog on `apps/crm/src/pages/configuracao/cobranca/CobrancaPage.tsx`:
a responsive grid of `full`-size meters combining `useWorkspaceLimits()` (limits) +
`useWorkspaceUsage()` (counts): clientes, vagas de equipe (members + pending, with
pending shown in the sublabel), armazenamento, leads, tokens do Hub, templates de
workflow, contas de Instagram, chaves MCP. Limits the plan doesn't cap render as
Ilimitado with the current count. Labels reuse the PT wording from
`apps/crm/src/lib/entitlement-errors.ts` `LIMIT_LABELS` where applicable.

### 5. In-context meters

- **Clientes** (`ClientesPage.tsx`): compact meter in the page header ("3 de 5
  clientes" + bar) fed by the loaded list length and `useWorkspaceLimits()` — replacing
  the invisible tooltip-only affordance. Button stays disabled at the limit (unchanged);
  the meter adds the visible explanation and the owner-only CTA.
- **Leads** (`LeadsPage.tsx`): same visual treatment, **different count source**:
  `getLeads()` is a single unpaged select subject to the server max-rows cap, so list
  length can understate usage. The meter (and the existing `leadsAtLimit` check) uses a
  dedicated exact head-count query (`{ count: 'exact', head: true }`) instead. The list
  truncation itself is a pre-existing issue, out of scope. (Clientes is fine:
  `getClientes()` pages exhaustively, so its length is exact.)
- **Equipe** (`InviteSection.tsx`): `SeatMeter` refactored onto `UsageMeter`, preserving
  its behaviors — the live "vagas após este convite" preview and `computeSeatState`'s
  `loading | unavailable | unlimited | ok | full` handling. One deliberate alignment:
  the pending count fed to the seat meter becomes the **raw** `status='pending'` count
  (matching the server pre-check), while the invite *list* keeps hiding locally-expired
  invites via `computeEffectiveInviteStatus`. Today the meter can claim a free seat that
  the server will refuse because an expired invite still counts — that gap closes.
- **Arquivos** (`ArquivosPage.tsx` sidebar + `MobileArquivosView.tsx` `StorageCard`):
  refactored onto `UsageMeter` with the bytes formatter. Data source stays the
  `file-manage` `storage: { used_bytes, quota_bytes }` payload. **Keep the documented
  sentinel: `quota_bytes: 0` from `file-manage` means "unlimited/unknown" for display**
  (`handler.ts:184–186`) — do not align it with the resolver's `0 = blocked`.
  Deliberate change: the storage warning threshold moves from ≥90% (current inline
  logic) to the unified helper's ≥80%, so all meters warn at the same point.

### 6. Copy

PT-BR, no em-dashes. Patterns: "{used} de {limit} {noun}", "Ilimitado",
"{n} restantes", "Fazer upgrade". Bytes via the existing `formatStorage`-style helper
(GB/MB, pt-BR locale).

## Error handling

- RPC failure / `useWorkspaceUsage` error: panel section renders a quiet fallback
  ("Não foi possível carregar o uso do plano"), never blocks the rest of the page.
- `limits === null` from `useWorkspaceLimits` is ambiguous (loading/error/no plan) —
  meters render nothing rather than a wrong number (same caution as
  `inviteSupport.ts:12–18`).
- No enforcement changes anywhere: meters are advisory; triggers and edge checks remain
  the boundary.

## Testing

- **Vitest:** threshold helper (ok/warning at ≤1 remaining/warning at 80%/danger/
  unlimited/zero-limit); `UsageMeter` render states incl. owner vs non-owner CTA;
  ClientesPage header meter (extend `ClientesPage.atlimit.test.tsx`); Equipe seat-meter
  behavior preserved (existing `inviteSupport`/InviteSection tests keep passing).
- **psql (entitlements suite, `supabase/tests/entitlements/`):** `workspace_usage()`
  returns counts matching the trigger expressions (revoked MCP key freed, Instagram
  counted via clientes join, pending invite counted separately, NULL conta returns
  empty), is executable by `authenticated` but **not** by `anon`, keeps `service_role`
  execute, and is scoped to the caller's workspace.

## Out of scope (YAGNI)

- No proactive nudges (emails, toasts on approach).
- No changes to enforcement, Hub, or admin portal.
- No meters for per-entity scoped limits or `max_workspaces_per_user`.
- No `['workspace-limits']` invalidation rework; the panel's own query key handles freshness.

## References

- `supabase/functions/_shared/entitlements.ts` — entitlement resolution
- `supabase/migrations/20260611130002/3` — count enforcement
- `docs/superpowers/specs/2026-06-11-paywall-feature-gating-design.md` §10.2
- `docs/superpowers/specs/2026-07-31-membro-workspace-invite-design.md` — seat meter UX
- `apps/crm/src/hooks/useWorkspaceLimits.ts`, `useEntitlements.ts`
- `apps/crm/src/lib/entitlement-errors.ts` — PT labels
