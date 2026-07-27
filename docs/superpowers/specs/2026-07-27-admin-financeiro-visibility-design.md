# Per-admin financial visibility

**Date:** 2026-07-27
**Status:** Approved design, ready for implementation planning
**Branch:** `claude/mises-access-levels-c956a8`

## Problem

Workspace owners cannot restrict what admins see. Today `admin` is `owner` minus
billing and minus owner-management; everything financial — revenue, expenses,
contracts, salaries, client retainers — is fully visible to every admin.

Owners want per-admin control over financial data.

## Scope

An owner can grant or revoke financial access **per admin**, from the Membros
list. Revoking hides every financial value from that admin and prevents them
writing financial data.

**In scope:** `transacoes`, `contratos`, `membros.custo_mensal`,
`clientes.valor_mensal`, and every derived figure (dashboard KPIs, calendar
projections, portfolio summaries).

**Explicitly not in scope:**

- `leads` — agents lose it today, but it is pipeline data, not financial. Its
  gate stays `get_my_role() IS DISTINCT FROM 'agent'`.
- `/equipe` as a route. Restricted admins keep team management; only the money
  inside it is hidden. Agents remain blocked from the route entirely.
- Owner and agent behaviour. Owners always see financials; agents never do.
- The systemic `get_my_conta_id()` weakness (see Known Gaps).
- Running `test:db` in CI (see Known Gaps).

## Decisions

| Question | Decision |
|---|---|
| Scope of restriction | Everything an agent loses, minus `/leads` and minus the `/equipe` route |
| Granularity | Per-admin, on `workspace_members`, edited in the Membros list |
| Default | `true` for existing and new admins — opt-out model, zero-surprise deploy |
| Blocked UX | Nav items hidden; direct URL shows a restriction screen, not a silent redirect |
| Equipe | Page stays open to admins; cost KPI, cost column and salary field hidden |
| Read vs write | **Full** restriction — a restricted admin can neither read nor write financial data |
| Mechanism | Boolean column + SQL predicate, rejecting a fourth role and a generic permissions table |

### Why not a fourth role

`admin_restricted` would silently change the meaning of every existing
`role === 'admin'` check — including member management and MCP keys, which have
nothing to do with money. The enum also appears in a CHECK constraint, invite
validation, three edge functions and two dropdowns.

### Why not a generic permissions table

One boolean does not justify a join and an abstraction layer. Migrating to a
permissions table later is mechanical if a second toggle appears.

## Data model

```sql
ALTER TABLE workspace_members
  ADD COLUMN can_see_financials boolean NOT NULL DEFAULT true;
```

Meaningful only for admins; the predicate ignores it for owners and agents.

### Predicate

```sql
CREATE OR REPLACE FUNCTION public.can_see_financials()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE wm.role
    WHEN 'owner' THEN true
    WHEN 'admin' THEN wm.can_see_financials
    ELSE false
  END
  FROM public.workspace_members AS wm
  WHERE wm.user_id = auth.uid()
    AND wm.workspace_id = public.get_my_conta_id();
$$;

REVOKE ALL ON FUNCTION public.can_see_financials() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_see_financials() TO authenticated;
```

Properties:

- Reads `workspace_members`, not `profiles`, so it is correct per workspace and
  immune to the stale-`profiles.role` bug (see Known Gaps).
- Unknown future roles fall to `false`, not through to `true`.
- No membership returns `NULL`, which fails closed in an RLS `USING` clause.
- `UNIQUE(user_id, workspace_id)` on `workspace_members` guarantees a scalar.

### Membership helper

```sql
CREATE OR REPLACE FUNCTION public.is_member_of(p_conta_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.user_id = auth.uid() AND wm.workspace_id = p_conta_id
  );
$$;

REVOKE ALL ON FUNCTION public.is_member_of(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_member_of(uuid) TO authenticated;
```

Extracted so both views share one tested definition instead of duplicating the
predicate.

## Enforcement — database

### Tier 1: whole-row (`transacoes`, `contratos`)

`public.can_see_financials()` replaces the agent predicate on **all four**
policies. `UPDATE` carries it in both `USING` and `WITH CHECK`. `SELECT` RLS
alone would leave INSERT open, letting a restricted admin post entries they
cannot read.

### Tier 2: column-level (`membros.custo_mensal`, `clientes.valor_mensal`)

Rows stay readable; the financial column does not.

```sql
REVOKE SELECT ON public.membros FROM authenticated;
GRANT SELECT (id, user_id, conta_id, nome, cargo, tipo,
              avatar_url, data_pagamento, created_at, crm_user_id)
  ON public.membros TO authenticated;
```

A table-level `GRANT SELECT` permits **every** column; a column-level revoke does
not carve out of it. The table grant must be revoked first, then an explicit
allowlist re-granted. The allowlist is also what keeps `UPDATE … RETURNING`
working on write paths.

The same treatment applies to `clientes`, omitting `valor_mensal`.

### Read views

```sql
-- Projected columns are exactly the GRANT allowlist above, plus the guarded
-- financial column. Never `SELECT *` — a new base-table column would otherwise
-- appear in the view ungranted and unreviewed.
CREATE VIEW public.membros_v WITH (security_barrier = true) AS
  SELECT m.id, m.user_id, m.conta_id, m.nome, m.cargo, m.tipo,
         m.avatar_url, m.data_pagamento, m.created_at, m.crm_user_id,
         CASE WHEN public.can_see_financials()
              THEN m.custo_mensal ELSE NULL END AS custo_mensal
  FROM public.membros m
  WHERE m.conta_id = public.get_my_conta_id()
    AND public.is_member_of(m.conta_id);

REVOKE ALL ON public.membros_v FROM PUBLIC;
GRANT SELECT ON public.membros_v TO authenticated;
```

Design constraints, each load-bearing:

- **`security_invoker` is impossible here.** An invoker view evaluates the
  `CASE` with the caller's privileges, so the caller would need SELECT on the
  very column we revoked.
- **The view owner bypasses RLS**, so the explicit `WHERE` is the *only* tenant
  isolation on this path. It must never rely on base-table RLS.
- **`get_my_conta_id()` alone is insufficient.** It returns
  `profiles.active_workspace_id` and does not prove current membership; a stale
  pointer would expose non-financial rows. Hence the `is_member_of` conjunct,
  correlated on `m.conta_id` so it stays correct even if the first predicate is
  ever deleted.
- **Not granted to `service_role`.** Trusted callers would get masked values and
  zero rows, since they have no `auth.uid()`. Edge functions read base tables
  directly, where their existing grants are untouched — the revoke targets
  `authenticated` specifically, not `PUBLIC`.
- Views grant `SELECT` only. All writes go to base tables.

### Write guards

`BEFORE INSERT OR UPDATE` triggers on `membros` and `clientes`:

```sql
IF auth.role() = 'service_role'
   OR current_user IN ('postgres', 'supabase_admin') THEN
  RETURN NEW;
END IF;

IF financial_value_changed
   AND public.can_see_financials() IS NOT TRUE THEN
  RAISE EXCEPTION 'financial_access_denied';
END IF;
```

Rejects only an INSERT carrying a non-null financial value, or an UPDATE where
`NEW.<col> IS DISTINCT FROM OLD.<col>`. Non-financial edits pass untouched.

`auth.uid() IS NULL` is **not** a proxy for service role — it also covers
anonymous requests. Only named trusted roles bypass. `auth.role()` has working
precedent in this repo (`20260526000000`, `20260718000001`).

## Enforcement — client

`AuthContext` fetches the caller's `workspace_members` row for the active
workspace and exposes:

```ts
workspaceRole: 'owner' | 'admin' | 'agent' | null;  // from workspace_members
canSeeFinancials: boolean;                          // same 3-way logic as SQL
```

`role` remains profile-based for now. The owner-only toggle **must** gate on
`workspaceRole`, or `MembrosTab` could render a control that the setter then
correctly rejects — or the reverse.

| Layer | Change |
|---|---|
| `ProtectedRoute` | Two separate branches (below) |
| `nav-data.ts` | `getNavGroups` **and** `getMoreSheetGroups` take the capability; hide `financeiro`/`contratos`. Also fixes `equipe` remaining in the sidebar for agents who are route-blocked from it |
| `configTabs.ts` | Unchanged — Cobrança is already owner-only |
| `clienteDetalheNav.model.ts` | Separate `isAgent` and `canSeeFinancials` inputs: Relatório and Hub stay role-based, Financeiro becomes capability-based |
| Dashboard | KPI strip **and** recebimento/despesa events |
| `GlobalSearchTrigger` | Disable the `contratos`/`transacoes` queries and groups when access is absent |
| `formatBRL` | Replaced by `formatFinancialBRL(value, canSeeFinancials)` |
| Data layer | Reads move to views; writes stay on base tables |

### Route guard

Agents keep today's silent redirect; restricted admins get an explanation:

```tsx
if (role === 'agent' && isAgentBlockedPath) return <Navigate to="/dashboard" replace />;
if (role !== 'agent' && isFinancialPath && !canSeeFinancials) return <FinancialRestrictionScreen />;
```

`ProtectedRoute` wraps `AppLayout`, so anything returned from it replaces the
entire application shell. The financial guard therefore lives **inside** the
layout. `UpgradeLockedScreen` has this exact defect today — see Known Gaps.

### Why `formatBRL` is replaced

`export let currentUserRole` in `store/core.ts` is a mutable module global: not
reactive, and easy to leave stale after live revocation or sign-out. An explicit
parameter cannot go stale.

### Write payload shaping

Hiding inputs is insufficient. `ClientesPage` and `LeadsPage` send
`valor_mensal: values.valor ? Number(values.valor) : 0` — a literal `0` when the
field is blank. Without shaping, the trigger rejects **every** client edit a
restricted admin attempts, including changing a phone number; and if the guard
were loosened, that payload would silently zero the retainer.

For restricted callers:

- Omit the property from update payloads entirely.
- Insert it absent/NULL.
- Strip or reject the protected CSV import column with a clear message.
- Hide monthly-value sorting and the financial form inputs.

### Live revocation

The database blocks new reads immediately, but React Query holds previously
fetched values — `staleTime: 30_000`, and indefinitely while a tab stays open.
Because both permission states share query keys, a cache purge is mandatory.

`AuthContext` subscribes to the active membership row (or refetches on focus if
Realtime is unavailable). On `true → false`:

1. Set `canSeeFinancials` false immediately.
2. Remove and refetch `clientes`, `membros`, `transacoes`, `contratos`,
   `dashboardStats`, `portfolioSummary`.
3. Close or reset dialogs holding financial values in component state.
4. Navigate away from financial routes.

### Derived values

`computed.ts` branches on the explicit capability, never inferring from a
nullable financial value — a legitimately null retainer is indistinguishable
from a masked one. `Number(null)` is `0`, so inference would render phantom
`R$ 0` calendar entries.

## Setter

New `set-financial-access` action on `manage-workspace-user`:

- Resolves the caller from `workspace_members` for the active workspace — **not**
  `profiles`, which reproduces the staleness the predicate avoids.
- Requires `role = 'owner'`. Owner-only prevents two restricted admins
  reinstating each other.
- Scopes the target by the same `workspace_id`; rejects non-admin targets.
- Audits old → new values.
- Owner check, update and audit insert happen in one transaction via RPC.

## Query inventory

Client-side reads to move to views:

| Site | Note |
|---|---|
| `store/team.ts:16` `getMembros` | `select('*')` |
| `store/clients.ts:52` `getClientes` | `select('*')` |
| `services/analytics.ts:239` `getPortfolioSummary` | `select('*')` |
| `ClienteDetalhePage.tsx:2467,2480` | reads only — the update stays on the base table |
| `store/workflows.ts:456` | |
| `GlobalSearchTrigger.tsx:50-56` | gate rather than migrate |

Write-returns needing an explicit column list excluding the protected column
(`UPDATE … RETURNING` requires SELECT on returned columns; an authorized caller
needing the new value re-fetches through the view):

- `team.ts:29` `addMembro`, `team.ts:41` `updateMembro`
- `clients.ts:95` `updateCliente`

The ~13 `from('clientes')` sites in `supabase/functions/` are service-role and
bypass grants and RLS — no migration needed.

## Testing

### Database

All security assertions must genuinely impersonate the caller. Setting
`request.jwt.claims` while running as `postgres` proves nothing — the table owner
bypasses both RLS and column privileges:

```sql
PERFORM set_config('request.jwt.claims',
  json_build_object('sub', v_user_id, 'role', 'authenticated')::text, true);
SET LOCAL ROLE authenticated;
```

`RESET ROLE` for fixture setup and for verifying protected tables. Service-role
bypass is tested under `SET LOCAL ROLE service_role` with the matching claim.

Matrix:

- Predicate truth table: owner true regardless of flag; agent false regardless;
  admin follows flag; no membership `NULL`.
- `is_member_of()`: true, false, no-user, foreign-workspace.
- View tenant isolation: member of A cannot read B through either view.
- **Stale pointer:** membership deleted while `active_workspace_id` still points
  at the workspace → zero rows.
- Authorized owner/admin sees the real value; restricted admin and agent see
  `NULL`.
- `authenticated` cannot select the protected columns from base tables, and
  *can* still select every allowlisted column.
- Anonymous cannot select the views or execute the helpers.
- Views expose `SELECT` only; writes through them fail.
- `transacoes`/`contratos`: restricted admin blocked on all four verbs, **plus**
  positive CRUD cases confirming allowed users are not over-blocked.
- Write guards on both tables: restricted INSERT with NULL succeeds; restricted
  INSERT with a value fails; restricted UPDATE of a non-financial field
  succeeds; authorized admin/owner can change the value; anonymous does not get
  the trusted-role bypass.

For denied UPDATE/DELETE, assert **both** affected-row count and unchanged
underlying data — RLS yields zero affected rows rather than raising.

The unknown-role branch cannot be integration-tested as-is: the `CHECK (role IN
('owner','admin','agent'))` constraint rejects unknown roles before the predicate
sees them. Either drop/replace the constraint inside the rolled-back test
transaction, or treat that branch as a source-level contract and say so rather
than implying coverage.

**Runner.** `scripts/test-entitlements.sh` globs `[0-9]*.sql` under
`supabase/tests/entitlements/` only. Either place this suite there or expand the
runner to cover all database security suites. Expanding it will also pick up
`post_media_set_from_uploads.sql`, `tiktok_publishing_rpcs.sql` and
`user_has_password.sql`, which are currently never executed and may need
triage.

### Frontend (Vitest)

Predicate mirror matching the SQL truth table; nav hiding including the
`equipe`-for-agents fix; both route-guard branches; `formatFinancialBRL`;
payload shaping (a restricted admin's update omits `valor_mensal` rather than
sending `0`); `computed.ts` capability branching; cache purge on revocation.

### Edge functions (Deno)

The existing `manage-workspace-invite-contract_test.ts` is `Deno.readTextFile`
plus regexes — useful as a regression check on action names and request shape,
but it cannot establish owner-only behaviour. Extract the new action into a
dependency-injected handler and test behaviourally:

- Active-membership owner succeeds.
- `profiles.role = 'owner'` but membership role `admin` **fails**.
- Foreign-workspace and non-admin targets fail.
- No-op update semantics defined.
- Audit receives exact old/new values.
- Update-and-audit failure behaviour defined (atomic via RPC).

Per repo convention, grep both `apps/**/__tests__` and
`supabase/functions/__tests__` for the old action shape.

## Rollout

Expand/contract, because the revoke is breaking:

1. **Migration A (additive):** column, `can_see_financials()`, `is_member_of()`,
   both views. No base-table privilege is revoked and no policy changes — the
   only revokes are `FROM PUBLIC` on the newly created views and functions, which
   nothing depends on yet. The deployed client is unaffected.
2. **Deploy client:** reads via views, payloads shaped, capability plumbed
   through. Works against both schema states. The toggle ships behind a real
   launch flag or is omitted entirely — cosmetic hiding is insufficient while
   the setter is callable before Migration B.
3. **Migration B (breaking):** revoke base-table SELECT, grant column
   allowlists, swap RLS predicates, add triggers.
4. **Deploy edge function** with the setter.
5. **Reveal the toggle.**

### Risks

**Migration B is not behaviorally inert.** Default `true` preserves existing
*admins*. It newly blocks *agents* from financial DML and from direct
salary/retainer access they hold today. This is an intentional security fix and
should be announced as one.

**Stale-bundle blast radius is app-wide, not financial-only.** Old
`getClientes()` / `getMembros()` `select('*')` calls feed dashboard, deliveries,
analytics and search. Deploy Migration B at low traffic, monitor query errors,
and keep a rollback SQL script ready to restore the previous grants and
policies.

**Frontend rollback after Migration B is unsafe** — the old bundle's `select('*')`
calls no longer work. The runbook needs either a forward client fix or the SQL
restoring previous grants.

**Staging cannot take `npx supabase db push`** (an orphaned `130000` migration
aborts the run). Apply the exact checked-in SQL via the SQL editor, then
mark/repair both versions as applied — the SQL editor does not reconcile
migration history, and skipping this leaves permanent drift.

Migration filenames need unique timestamp prefixes or the CI version guard fails
the build.

**Gates.** The full 1–5 sequence runs against staging first, with
`npm run test:db` green there, before any step touches production. On
production, the suite runs again after step 4 and must pass before step 5
reveals the toggle. The suite can only pass once Migration B is applied, since
it asserts the revokes — so it cannot gate steps 1–3 and those rely on the
staging rehearsal instead.

## Known gaps (tracked separately, not fixed here)

1. **`get_my_conta_id()` proves no membership.** Every existing policy —
   `clientes_select`, `membros_select`, `transacoes_select` — is
   `conta_id IN (SELECT public.get_my_conta_id())`. The new views are hardened
   via `is_member_of`, making them stronger than the base tables. The systemic
   fix is a separate hardening pass.
2. **Workspace switching never updates `profiles.role`.** All three switch paths
   write only `active_workspace_id` and `conta_id`, so a user who is owner in A
   and agent in B keeps `owner` after switching. This feature sidesteps it by
   reading `workspace_members`; the bug itself remains.
3. **`UpgradeLockedScreen` destroys the app shell.** Returned from inside
   `ProtectedRoute`, which wraps `AppLayout`, so plan-gated routes lose sidebar
   and nav today.
4. **`test:db` does not run in CI.** It needs `supabase start` rather than a
   plain Postgres service container, since the migrations depend on `auth.uid()`
   and the `auth`/`storage` schemas. Sized separately.
5. **Column allowlists are a maintenance hazard.** Any column later added to
   `membros` or `clientes` is invisible to the CRM until granted, and the
   failure surfaces as a confusing missing-column error. Add to `CLAUDE.md`
   Gotchas.
