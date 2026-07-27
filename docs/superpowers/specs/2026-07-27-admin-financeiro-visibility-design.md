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
- Owner behaviour. Owners always see financials.
- The systemic `get_my_conta_id()` weakness (see Known Gaps).
- Running `test:db` in CI (see Known Gaps).

**In scope by consequence — agent hardening.** Agents are masked in the UI today
but retain database access to `membros.custo_mensal`, `clientes.valor_mensal`,
and financial DML on `transacoes`/`contratos`. Migration B closes all of it,
because `can_see_financials()` returns `false` for agents on the same policies
and triggers. This is a deliberate security fix shipping in this release, not a
side effect: it carries its own acceptance tests (see Testing) and must be
announced. The "default `true` is inert" property applies to **admins only**.

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

-- See "Read views" for why named roles must be enumerated, not just PUBLIC.
REVOKE ALL ON FUNCTION public.can_see_financials() FROM PUBLIC, anon, authenticated, service_role;
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

REVOKE ALL ON FUNCTION public.is_member_of(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_member_of(uuid) TO authenticated;
```

Extracted so both views share one tested definition instead of duplicating the
predicate.

## Enforcement — database

### Tier 1: whole-row (`transacoes`, `contratos`)

The capability is **conjoined with** the existing tenant check — never
substituted for it. `can_see_financials()` does not authorize a target row's
`conta_id`, so replacing a `USING` expression with it alone would expose every
workspace's rows. Only `SELECT` currently carries an agent predicate
(`20260404`); `INSERT`, `UPDATE` and `DELETE` carry tenant checks only
(`20260315`). Each policy is therefore rewritten in full:

```sql
DROP POLICY IF EXISTS "transacoes_select" ON transacoes;
CREATE POLICY "transacoes_select" ON transacoes
  FOR SELECT USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND public.can_see_financials()
  );

DROP POLICY IF EXISTS "transacoes_insert" ON transacoes;
CREATE POLICY "transacoes_insert" ON transacoes
  FOR INSERT WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND public.can_see_financials()
  );

DROP POLICY IF EXISTS "transacoes_update" ON transacoes;
CREATE POLICY "transacoes_update" ON transacoes
  FOR UPDATE USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND public.can_see_financials()
  ) WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND public.can_see_financials()
  );

DROP POLICY IF EXISTS "transacoes_delete" ON transacoes;
CREATE POLICY "transacoes_delete" ON transacoes
  FOR DELETE USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND public.can_see_financials()
  );
```

`contratos` receives the identical four. `SELECT` RLS alone would leave INSERT
open, letting a restricted admin post entries they cannot read.

The pgTAP matrix includes a cross-tenant case on every one of these eight
policies specifically to catch a regression where the tenant conjunct is
dropped.

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

#### Blocker: the `clientes` allowlist cannot be authored from migrations

The allowlist is an exhaustive enumeration, so an omitted column silently
disappears from the CRM. `clientes` has drifted from its migration history:
`data_aniversario` is read **and written** by the app
(`ClienteDetalhePage.tsx:750,784,1060`, `CalendarioPage.tsx:897`) yet no
checked-in migration creates it. A database built from `supabase/migrations`
therefore has a different shape from production.

**This must be resolved before the allowlist is written.** Required first step
of implementation:

1. Dump the live `clientes` and `membros` column lists from production *and*
   staging (`information_schema.columns`).
2. Diff against a database built purely from checked-in migrations.
3. Add a reconciling migration for every drifted column — following the
   precedent of `20260720000004_reconcile_prod_missing_functions.sql` — so
   migration history and production agree.
4. Only then author the allowlists, generated from the reconciled schema rather
   than hand-typed.

Until step 3 lands, any allowlist written here would be wrong on one
environment or the other. Reconciliation is a prerequisite migration, sequenced
before Migration A.

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

-- PUBLIC alone is NOT sufficient: Supabase's default privileges grant new
-- objects in `public` directly to anon, authenticated and service_role, and a
-- revoke from PUBLIC leaves those intact.
REVOKE ALL ON public.membros_v FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.membros_v TO authenticated;
```

**Why the enumerated revoke is security-critical, not tidiness.** The view is
auto-updatable on its simple columns, its owner bypasses base-table RLS, and it
carries no `CHECK OPTION`. Left with the default `authenticated` write grants, a
caller could INSERT a row with an arbitrary `conta_id`, or UPDATE an existing
row's `conta_id` into another workspace — writing straight past every policy
this design relies on. `WITH CHECK OPTION` is added as belt-and-braces, but the
ACL is the actual control.

The same enumerated revoke applies to `clientes_v` and to both helper functions:

```sql
REVOKE ALL ON FUNCTION public.can_see_financials()  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_member_of(uuid)    FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_see_financials() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_member_of(uuid)   TO authenticated;
```

Without this the spec's "anonymous cannot execute the helpers" assertion fails.

**Both failure directions are live in this repo, so neither may be assumed.**
Named roles may hold grants you never intended (this finding), *and* they may
depend on a PUBLIC grant you are about to remove — a `REVOKE … FROM PUBLIC` on a
SECURITY DEFINER function previously broke edge-function calls here because
`service_role` had no direct grant of its own. Every object this design creates
or alters therefore gets its final ACL **asserted** in pgTAP by reading
`relacl` / `proacl` directly. `has_table_privilege` and `has_function_privilege`
are not acceptable evidence: they collapse PUBLIC-derived and role-derived
access into one boolean, which is precisely the distinction that matters here.

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
workspaceRole: 'owner' | 'admin' | 'agent' | null;   // from workspace_members
canSeeFinancials: boolean | 'unknown';               // never a bare optimistic boolean
```

`role` remains profile-based for now.

**Hydration contract.** `AuthContext` currently clears `loading` after the
profile request alone (`AuthContext.tsx:96-140`). The membership request must
join that same guarded flow: it participates in `loading`, reuses the
`profileRequestId` generation guard keyed to the active workspace, and on error
resolves to `'unknown'` — never to a boolean. A bare boolean is unsafe in both
directions: defaulting `true` briefly exposes restricted cached values,
defaulting `false` renders restriction UI at owners. Consumers treat `'unknown'`
as "not yet decided" and render neither financial values nor the restriction
screen until it resolves; `formatFinancialBRL` masks on anything that is not
literal `true`.

**The toggle is not the only surface needing `workspaceRole`.** The route to it
is gated by profile role today — `ConfiguracaoLayout.tsx:31` builds the tab
strip and guards direct URLs from `role`, and `MembrosTab.tsx:52` disables its
member query from the same value. A genuine owner whose stale `profiles.role`
reads `agent` cannot reach the toggle at all, so gating only the control is
insufficient. The Membros **route, query and member-management actions** move to
`workspaceRole`.

| Layer | Change |
|---|---|
| `ProtectedRoute` | Agent redirect branch only (below) |
| `AppLayout` | Hosts the financial route guard so the shell survives (below) |
| `nav-data.ts` | `getNavGroups` **and** `getMoreSheetGroups` take the capability; hide `financeiro`/`contratos`. Also fixes `equipe` remaining in the sidebar for agents who are route-blocked from it |
| `configTabs.ts` | Route/query/actions move to `workspaceRole` (see above) |
| `clienteDetalheNav.model.ts` | Separate `isAgent` and `canSeeFinancials` inputs: Relatório and Hub stay role-based, Financeiro becomes capability-based |
| `ClienteDetalhePage.tsx:1793` | The finance section render gate and its edit field are `!isAgent` today — the nav model alone does not hide them. Becomes capability-based |
| `MembroDetalhePage.tsx` | Salary display, salary edit field, edit action gate (`:140`) and transaction history all become capability-based |
| `CalendarioPage.tsx:870-989` | Income/expense projection, day cells and payment confirmation live in the page, **not** `computed.ts`. Each needs its own capability gate |
| `EquipePage.tsx` | Cost KPI and cost column |
| Dashboard | KPI strip **and** recebimento/despesa events |
| `GlobalSearchTrigger` | Disable the `contratos`/`transacoes` queries and groups when access is absent |
| `formatBRL` | Replaced by `formatFinancialBRL(value, canSeeFinancials)` |
| Data layer | Reads move to views; writes stay on base tables |

### Route guard

The two branches live in **different components**, because they need different
outcomes. `ProtectedRoute` wraps `AppLayout` (`App.tsx:119-121`), so anything it
returns replaces the entire application shell — acceptable for a redirect,
wrong for a restriction screen that should keep sidebar and nav.

`ProtectedRoute` — agents only, unchanged behaviour, redirect:

```tsx
if (role === 'agent' && isAgentBlockedPath) return <Navigate to="/dashboard" replace />;
```

`AppLayout`, wrapping its `<Outlet />` — restricted admins, shell preserved:

```tsx
if (isFinancialPath && canSeeFinancials === 'unknown') return <FinancialRouteLoading />;
if (isFinancialPath && canSeeFinancials === false)     return <FinancialRestrictionScreen />;
```

**`'unknown'` is deliberately excluded from the denial branch.** Writing this as
`!== true` would show an owner the restriction screen during hydration or a
transient membership-lookup failure, contradicting the hydration contract above.
The two states need opposite handling and the distinction is easy to collapse by
accident:

- **Values** fail closed — `formatFinancialBRL` masks on anything that is not
  literal `true`, because rendering a real figure to someone who may be
  restricted is the harm.
- **The route screen** fails neutral — a denial screen is only correct on an
  explicit `false`, because falsely telling an owner they lack access is the
  harm, and the loading state leaks nothing (route content is unrendered either
  way, and the data layer denies regardless).

Vitest covers all three capability states against both branches.

Agents never reach the second guard for `/financeiro` and `/contratos` because
those paths stay in the agent redirect set, preserving today's behaviour exactly.
Splitting the branches across the two components is required, not stylistic: a
single implementation in `ProtectedRoute` would destroy the shell, and a single
implementation in `AppLayout` would change agent UX.

`UpgradeLockedScreen` has this exact shell defect today — see Known Gaps.

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

The same defect exists on the member side: `EquipePage.tsx:174` sends
`custo_mensal: values.custo ? Number(values.custo) : null` and
`MembroDetalhePage.tsx:107` always includes it from form state.

For restricted callers:

- Omit the property from update payloads entirely.
- Insert it absent/NULL.
- Hide monthly-value sorting and the financial form inputs.

**CSV imports — reject, do not strip.** If a restricted admin uploads a file
containing the protected column, the import fails as a whole with a message
naming the offending column, for both client and member imports. Silent
stripping is rejected: it reports success while discarding exactly the data the
admin believed they were importing, and leaves no signal that the records are
incomplete. Whole-file rejection rather than per-row skipping, so a partially
imported file never needs reconciling. *(Product decision — reversible if you
prefer silent stripping.)*

### Live revocation

The database blocks new reads immediately, but React Query holds previously
fetched values — `staleTime: 30_000`, and indefinitely while a tab stays open.
Because both permission states share query keys, a cache purge is mandatory.

**Severity, stated precisely:** this is a correctness and UX concern, not a
disclosure boundary. The database denies the read regardless of what the client
believes, so a stale cache cannot survive a refetch and no new financial data
can be obtained. The subscription is defence-in-depth over values already in
memory — it must not be described, or relied upon, as the enforcement boundary.

**Realtime is not currently deployable from this repo.** No migration adds
`workspace_members` to the `supabase_realtime` publication. Migration A must
enable and verify it, or the subscription silently never fires.

`AuthContext` subscribes to the active membership row. The fallback when
Realtime is unavailable is **bounded polling with retry**, not refetch-on-focus
alone — focus events never fire for the tab that stays foregrounded, which is
precisely the indefinite-cache case this section exists to address. On
`true → false`:

1. Set `canSeeFinancials` false immediately.
2. Remove and refetch `clientes`, `membros`, `transacoes`, `contratos`,
   `dashboardStats`. (`portfolioSummary` is excluded — it holds no financial
   data.)
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

**No-op semantics.** Setting the flag to its current value succeeds with a 200
and writes **no** audit row. Auditing no-ops would let anyone with the toggle
pad the trail with entries that record no change.

**Role transitions: the flag is preserved, never auto-reset.** An admin set to
`false`, demoted to agent, then promoted back to admin returns *restricted*. The
alternative — resetting to the `true` default on role change — would silently
restore access an owner deliberately revoked, which is the one transition that
must not fail open. The asymmetry Codex identified is intentional and
documented: a *newly* promoted agent who never had the flag set defaults to
`true`, because they have no prior revocation to preserve. Since the setter
rejects non-admin targets, an owner cannot pre-set the flag before promotion;
they set it afterwards. *(Product decision — reversible.)*

## Query inventory

Client-side reads to move to views:

| Site | Note |
|---|---|
| `store/team.ts:16` `getMembros` | `select('*')` |
| `store/clients.ts:52` `getClientes` | `select('*')` |
| `services/analytics.ts:239` `getPortfolioSummary` | `select('*')` must change to survive the grant — but see note below |
| `ClienteDetalhePage.tsx:2467,2480` | reads only — the update stays on the base table |
| `store/workflows.ts:456` | |
| `GlobalSearchTrigger.tsx:50-56` | gate rather than migrate |

**`getPortfolioSummary` is not financial.** Its contract is Instagram accounts,
top/worst posts and growth counters (`analytics.ts:192`) — no monetary field.
Its client lookup must stop using `select('*')` so it survives the grant change,
but the summary itself is **not** capability-gated and is **not** part of the
revocation cache purge.

Write-returns needing an explicit column list excluding the protected column
(`INSERT`/`UPDATE … RETURNING` requires SELECT on returned columns; an
authorized caller needing the new value re-fetches through the view):

- `team.ts:29` `addMembro`, `team.ts:41` `updateMembro`
- `clients.ts:95` `updateCliente`
- `clients.ts:65` `addCliente` — `.insert(…).select()` is `RETURNING *`. Without
  this, a restricted admin's otherwise-valid NULL-valued insert fails and rolls
  back, so client creation breaks entirely rather than degrading.

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
- **ACL assertions read `relacl` / `proacl` directly** for both views and both
  helper functions, confirming the exact final grant set. `has_table_privilege`
  and `has_function_privilege` are not acceptable evidence — they cannot
  distinguish PUBLIC-derived from role-derived access, which is the whole
  question.
- **Writes through the views fail for `authenticated`** — INSERT, UPDATE and
  DELETE each rejected, including the specific attempts to insert a foreign
  `conta_id` and to move an existing row's `conta_id` to another workspace. This
  is the regression test for the auto-updatable-view escape path.
- `transacoes`/`contratos`: restricted admin blocked on all four verbs, **plus**
  positive CRUD cases confirming allowed users are not over-blocked.
- **Cross-tenant regression on all eight rewritten policies:** a user with
  financial access in workspace A cannot read or write workspace B's rows. This
  is the guard against a future edit dropping the `conta_id` conjunct and
  turning a capability check into a tenant-wide exposure.
- **Agent hardening acceptance** (this release changes agent behaviour): an
  agent cannot select `custo_mensal` or `valor_mensal`, and cannot INSERT,
  UPDATE or DELETE `transacoes`/`contratos` — all of which they can do today.
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

**Restoring grants and policies is not a complete rollback.** The two write-guard
triggers survive a grant/policy restore, so the old bundle's `0`/`null` payloads
would keep rejecting ordinary client and member edits for restricted admins —
a rollback that leaves the app broken in a new way. The checked-in rollback
script must, in order: drop both triggers and their functions, restore the exact
prior `SELECT` and DML policies, re-grant table-level `SELECT` to
`authenticated`, and drop the views. It is written and rehearsed on staging
during the step 1–5 rehearsal, not authored under incident pressure.

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
6. **`clientes` schema drift** — `data_aniversario` exists in production but in
   no migration. Unlike the others this is *not* deferred: it blocks the
   allowlist and is fixed by a prerequisite reconciling migration sequenced
   before Migration A. Listed here because the underlying question — what else
   has drifted across all tables — is broader than this feature and deserves its
   own audit.
