# Per-admin financial visibility

**Date:** 2026-07-27 (last revised 2026-07-28)
**Status:** Approved design, ready for implementation planning
**Branch:** `claude/mises-access-levels-c956a8`

Load-bearing claims in this document were re-verified against source on
2026-07-28 — policy names and shapes, `get_my_conta_id()`'s current definition,
the read/embed inventory, `get_client_health_aggregates()`'s column set, and
production's migration state. Where a line reference is cited it was checked, not
remembered. Anything not re-checkable from the repo is marked as needing
verification at implementation time rather than asserted.

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
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
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
- **Every relation is schema-qualified, and `pg_temp` is named last.** Both are
  required, and this deliberately departs from the repo's existing convention —
  see Known Gap 7. If `pg_temp` is not listed in a function's `search_path`,
  PostgreSQL searches the session's temporary schema *first* for relation names,
  so a caller able to execute `CREATE TEMP TABLE workspace_members (…)` could
  shadow the real table and dictate this function's answer. Naming `pg_temp`
  explicitly at the end moves it to last place; qualifying `public.workspace_members`
  makes the point moot for this body. Both, because the belt and the braces cost
  nothing.

**The flag is readable by co-members.** `wm_select_same_workspace` lets every
member of a workspace — agents included — read every other member's
`workspace_members` row, so an agent can observe which admins are restricted.
This is accepted, not overlooked: it is metadata about a permission, not
financial data, and the CRM already exposes each member's role to everyone in the
workspace. Recorded so it is a decision rather than a later surprise.

### ~~Membership helper~~ — DO NOT BUILD

An earlier draft defined `public.is_member_of(uuid)` here and used it in the
views' `WHERE` clauses. **It has been struck from this design.** Its sole
justification was a belief that `get_my_conta_id()` did not prove membership,
which is false: `20260713000001_secure_workspace_invites.sql` hardened it to
require

```sql
AND EXISTS (SELECT 1 FROM workspace_members wm
            WHERE wm.user_id = auth.uid() AND wm.workspace_id = p.active_workspace_id)
```

and `20260720000004` re-delivered that body to production. No later migration
changes it.

`public.get_my_conta_id()` alone is therefore sufficient everywhere this design
uses it, and already fails closed on a stale or foreign active-workspace
pointer. Building a second helper would add a SECURITY DEFINER function, its
ACL, and its test matrix for no gain.

The definition is removed rather than left struck-through because a code block
in a spec gets copied; a retraction three sections later does not travel with
it.

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
    AND (SELECT public.can_see_financials())
  );

DROP POLICY IF EXISTS "transacoes_insert" ON transacoes;
CREATE POLICY "transacoes_insert" ON transacoes
  FOR INSERT WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND (SELECT public.can_see_financials())
  );

DROP POLICY IF EXISTS "transacoes_update" ON transacoes;
CREATE POLICY "transacoes_update" ON transacoes
  FOR UPDATE USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND (SELECT public.can_see_financials())
  ) WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND (SELECT public.can_see_financials())
  );

DROP POLICY IF EXISTS "transacoes_delete" ON transacoes;
CREATE POLICY "transacoes_delete" ON transacoes
  FOR DELETE USING (
    conta_id IN (SELECT public.get_my_conta_id())
    AND (SELECT public.can_see_financials())
  );
```

`contratos` receives the identical four. `SELECT` RLS alone would leave INSERT
open, letting a restricted admin post entries they cannot read.

**The `(SELECT …)` wrapper around the capability call is deliberate.** A bare
`STABLE` function reference in a policy can be evaluated per row; wrapped as a
scalar sub-select it is hoisted to an InitPlan and evaluated once per query.
The tenant conjunct already uses that idiom — `transacoes` is the largest table
here, and the capability answer is identical for every row by construction. The
existing `20260404` agent predicate is unwrapped, so this corrects the precedent
rather than following it.

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

#### Authoritative allowlists — RESOLVED 2026-07-27

The drift blocker below is cleared. `clientes` and `membros` now agree exactly
between production and staging (20 and 11 columns, zero difference in either
direction), and staging's shape is produced by the migrations plus
`20260727000001_reconcile_adopt_client_tables.sql`. See
[the drift audit](2026-07-27-schema-drift-audit.md).

```sql
GRANT SELECT (
  id, user_id, conta_id, nome, sigla, cor, plano, email, telefone, status,
  created_at, notion_page_url, data_pagamento, especialidade, data_aniversario,
  dia_entrega, auto_publish_on_approval, send_report_email, include_ai_analysis
) ON public.clientes TO authenticated;   -- 19 of 20; omits valor_mensal

GRANT SELECT (
  id, user_id, conta_id, nome, cargo, tipo, avatar_url, data_pagamento,
  created_at, crm_user_id
) ON public.membros TO authenticated;     -- 10 of 11; omits custo_mensal
```

These lists are **generated from the reconciled schema, not hand-typed**, and
must be regenerated rather than edited if either table changes. The
implementation plan should regenerate and diff them immediately before writing
Migration B, since any column added between now and then would otherwise vanish
from the CRM.

#### Silent dependants of the allowlist

Three categories of existing SQL read `clientes`/`membros` under the *caller's*
column privileges and therefore break the moment a column they touch falls
outside the allowlist. All three survive Migration B today, but only by
coincidence of which columns they happen to read — nothing pins that, so each
gets a pgTAP assertion (see Testing) rather than a comment.

1. **Other tables' RLS policies.** Ten tables carry policy expressions with a
   sub-select on `clientes`: `instagram_accounts`, `instagram_posts`,
   `instagram_follower_history`, `instagram_analytics_cache`,
   `instagram_post_tag_assignments`, `hub_brand`, `hub_brand_files` and the three
   `tiktok_*` tables. Policy expressions run with the querying user's privileges,
   so a revoked column referenced in one of them would fail every query against
   the *dependent* table, not against `clientes`. Verified: across all of them
   the referenced columns are `id`, `conta_id` and `status` — all allowlisted.
2. **`get_client_health_aggregates(int)`** (`20260625130000`) — the repo's one
   `SECURITY INVOKER` function reading `clientes`, granted to `authenticated`.
   Its body reads `id`, `nome`, `sigla`, `cor`, `status`, `conta_id`: all
   allowlisted.
3. **PostgREST embedded selects** (see Query inventory).

A future allowlist regeneration that drops any of `id`, `conta_id`, `status`,
`nome`, `sigla`, `cor` takes all three down with it.

#### Original blocker (retained for context)

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
  WHERE m.conta_id = public.get_my_conta_id();

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

The same enumerated revoke applies to `clientes_v` and to the helper function:

```sql
REVOKE ALL ON FUNCTION public.can_see_financials()  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_see_financials() TO authenticated;
```

Without this the spec's "anonymous cannot execute the helper" assertion fails.

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
- **`get_my_conta_id()` already proves membership.** An earlier version of this
  spec claimed it did not, based on the superseded `20260315` definition. It was
  hardened in `20260713000001_secure_workspace_invites.sql` to require
  `EXISTS (SELECT 1 FROM workspace_members WHERE user_id = auth.uid()
   AND workspace_id = p.active_workspace_id)`, and `20260720000004` re-delivered
  that body to production. No later migration redefines it.

  **Consequence: the `is_member_of()` helper has been struck from this design**
  — its definition, its use in the views' `WHERE` clauses, its ACL block, its
  test-matrix entry and its mention in the rollout are all removed. Its entire
  justification was a gap that does not exist.
  `WHERE m.conta_id = public.get_my_conta_id()` is sufficient and already fails
  closed on a stale or foreign active-workspace pointer.
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

**The trigger function MUST be `SECURITY INVOKER`. Making it `SECURITY DEFINER`
silently disables the entire guard.** This is not a style preference and it is
easy to get wrong, because `SECURITY DEFINER` + `SET search_path` is the correct
reflex for almost every other function in this design — but this one's logic
*reads* `current_user`, so changing whose identity that reports destroys it.
Verified empirically against a live database:

```
SECURITY DEFINER  current_user = postgres        -> bypass fires: TRUE
SECURITY INVOKER  current_user = authenticated   -> bypass fires: FALSE
```

Owned by `postgres`, a `SECURITY DEFINER` guard evaluates
`current_user IN ('postgres','supabase_admin')` as true **for every caller**,
returns `NEW` unconditionally, and blocks nothing at all. The implementation
plan specified `SECURITY DEFINER` here and it took an implementer probing the
running database to catch it; a reviewer reading the SQL would not obviously see
that the function had become a no-op.

**The `current_user` bypass is wider than it reads.** A `SECURITY DEFINER`
function owned by `postgres` executes with `current_user = 'postgres'`, so every
such function is exempt from these guards — not only direct superuser sessions.
That is acceptable today: the only SECURITY DEFINER path writing these tables is
`set_membro_crm_user`, which touches `crm_user_id` alone. It is stated here so a
future SECURITY DEFINER write path does not silently inherit a bypass nobody
chose. Any new one that can write a financial column must call
`can_see_financials()` itself.

## Enforcement — client

`AuthContext` fetches the caller's `workspace_members` row for the active
workspace and exposes:

```ts
workspaceRole: 'owner' | 'admin' | 'agent' | null;   // from workspace_members
canSeeFinancials: boolean | 'unknown';               // never a bare optimistic boolean
```

`role` remains profile-based for now.

**Hydration contract.** `AuthContext` sets `loading` true at
`AuthContext.tsx:108`, fetches the profile, `await`s `initStoreRole()` at `:126`,
and clears `loading` in the `finally` at `:133` — all under one
`profileRequestId` generation guard. The membership request joins that same
flow: it participates in `loading`, reuses the generation guard keyed to the
active workspace, and on error resolves to `'unknown'` — never to a boolean.
The existing `initStoreRole()` await is a ready-made sibling, so this is adding a
second call to a sequence that already exists rather than restructuring the
hydration. A bare boolean is unsafe in both
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
outcomes. `ProtectedRoute` wraps `AppLayout` (`App.tsx:141-147`), so anything it
returns replaces the entire application shell — acceptable for a redirect,
wrong for a restriction screen that should keep sidebar and nav. The agent
redirect and its blocked-path set live in
`components/layout/ProtectedRoute.tsx:8,39-41`, not in `App.tsx`.

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
`MembroDetalhePage.tsx:119` always includes it from form state.

There is a third client-side site, in the CSV path: `ClientesPage.tsx:271` sends
`valor_mensal: row.valor_mensal ? Number(row.valor_mensal) : 0` per imported row
(the form paths are `:214` and `:227`).

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

**"Fails as a whole" is a claim about *when* the check runs.** Both importers
loop `addCliente` / `addMembro` one row at a time
(`ClientesPage.tsx:258`, `EquipePage.tsx:212`) with no transaction around the
loop, so a check that fires on the offending *row* would leave every preceding
row committed — the partial import this rule exists to prevent. The column check
must therefore run **on the parsed header, before the first insert**, and abort
without writing anything. This is a requirement on the implementation, not a
property that falls out of the trigger.

**Cross-initiative: the planned `data-import` edge function bypasses all of
this.** The competitor-migration wizard on its own branch (see
`2026-07-27-data-import-migration` spec) writes via service role, which bypasses
column grants, RLS *and* the write-guard triggers. Every protection in this
design is client- and database-side; a service-role import path must enforce the
capability itself, in its own code. Flagged here so the two initiatives do not
each assume the other covers it.

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
| `services/analytics.ts:236-239` `getPortfolioSummary` | `select('*')` must change to survive the grant — but see note below |
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

**Embedded selects are a second read surface, and the grep for them is
different.** A PostgREST embed such as `workflows!inner(…, clientes!inner(nome))`
never mentions `from('clientes')` — it resolves against the base table under the
caller's column privileges all the same. Six exist today:

| Site | Embed |
|---|---|
| `store/workflows.ts:250` | `clientes!inner(nome)` |
| `store/workflows.ts:276` | `clientes!inner(nome)` |
| `store/posts.ts:154` | `clientes!inner(nome)` |
| `store/ideias.ts:38` | `clientes(nome)` |
| `store/ideias.ts:40` | `membros(nome)` |
| `configuracao/tabs/WorkspaceTab.tsx:117` | `clientes!inner(conta_id)` |

Every one reads a single allowlisted column, so none breaks under Migration B and
none needs migrating to a view. The property that must hold — and be re-checked
when the plan is written, since embeds are added casually — is **no embed selects
`*` or a financial column from either table**. The implementation plan runs this
grep alongside the direct-read inventory.

The 23 `from('clientes')` sites in `supabase/functions/` are service-role and
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
- View tenant isolation: member of A cannot read B through either view.
- **Stale pointer:** membership deleted while `active_workspace_id` still points
  at the workspace → zero rows.
- Authorized owner/admin sees the real value; restricted admin and agent see
  `NULL`.
- `authenticated` cannot select the protected columns from base tables, and
  *can* still select every allowlisted column.
- Anonymous cannot select the views or execute `can_see_financials()`.
- **ACL assertions read `relacl` / `proacl` directly** for both views and for
  `can_see_financials()`, confirming the exact final grant set. `has_table_privilege`
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
- **Allowlist dependants still work** (see "Silent dependants of the allowlist").
  These fail on the *dependent* object, not on `clientes`, so nothing else in
  this matrix would catch a regression:
  - an `authenticated` caller can still `SELECT` from `instagram_accounts` and
    `hub_brand`, whose RLS policies sub-select `clientes`;
  - an `authenticated` caller can still execute
    `get_client_health_aggregates(28)` and get rows.
  Both assertions run as a restricted admin *and* as an authorized one — the
  point is that the allowlist keeps them working for everybody, since the
  columns they touch are not financial.

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

1. **Migration A (additive):** column, `can_see_financials()`, both views. No base-table privilege is revoked and no policy changes — the
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
prior `SELECT` and DML policies, and re-grant table-level `SELECT` to
`authenticated`. It is written and rehearsed on staging during the step 1–5
rehearsal, not authored under incident pressure.

**The rollback script must NOT drop the views.** Rolling back Migration B happens
while the *step-2 bundle is still deployed*, and that bundle reads `membros_v`
and `clientes_v` — dropping them would break the very client the rollback is
meant to stabilise, trading one outage for a worse one. The views are harmless
once table grants are restored: the `CASE` mask keeps evaluating and simply stops
masking, because everyone who can reach them can now read the base column
anyway. View teardown belongs to a **separate full-teardown script**, run only
when the frontend is also being rolled back to a pre-view bundle. Two scripts,
two triggers to run them:

| Script | Undoes | Safe while step-2 bundle is live |
|---|---|---|
| `rollback-migration-b.sql` | triggers, policies, grants | yes |
| `teardown-financial-visibility.sql` | the above **plus** views, helper, column | no — pair with a frontend rollback |

**Staging's `npx supabase db push` history is unreliable — re-test it, do not
assume either answer.** The known blocker is an orphaned `130000` migration that
aborts the run. If it still bites, apply the exact checked-in SQL via the SQL
editor and then mark/repair both versions as applied — the SQL editor does not
reconcile migration history, and skipping the repair leaves permanent drift.

Two facts to re-check at implementation time rather than inherit from this
document, since both moved during the reconciliation work:

- **Production's migration chain is clear.** Verified 2026-07-28 via
  `supabase migration list --linked`: every local migration through
  `20260727000008` is applied remotely. An earlier draft of this section warned
  that `20260727000008` would block all future pushes to production; that was
  true only while its guard was refusing, and it no longer is.
- **Staging is missing `20260727000004`** (the `file_enqueue_delete` fix), which
  was authored after staging's last push. Reconcile that before the first
  Migration A rehearsal, or the rehearsal runs against a schema production does
  not have.

Migration filenames need unique timestamp prefixes or the CI version guard fails
the build.

**Gates.** The full 1–5 sequence runs against staging first, with
`npm run test:db` green there, before any step touches production. On
production, the suite runs again after step 4 and must pass before step 5
reveals the toggle. The suite can only pass once Migration B is applied, since
it asserts the revokes — so it cannot gate steps 1–3 and those rely on the
staging rehearsal instead.

## Known gaps (tracked separately, not fixed here)

1. ~~**`get_my_conta_id()` proves no membership.**~~ **WITHDRAWN — this gap does
   not exist.** The claim came from the superseded `20260315` definition without
   checking for later redefinitions. `20260713000001` hardened the function to
   require an `EXISTS` membership check, and `20260720000004` re-delivered that
   body to production; no later migration changes it. Every policy using
   `conta_id IN (SELECT public.get_my_conta_id())` therefore already fails
   closed on a stale or foreign active-workspace pointer. **No systemic
   hardening pass is needed, and `is_member_of()` should not be built.**
   Recorded rather than deleted so nobody re-derives the same wrong conclusion
   from the same old migration.
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
   Gotchas. The hazard extends past direct reads: an allowlist regeneration also
   has to keep the six PostgREST embeds, the ten dependent RLS policies and
   `get_client_health_aggregates()` working — none of which mention `clientes`
   in a way the obvious grep finds. The property to preserve is **no embed
   selects `*` or a financial column** from either table.
6. **`clientes` schema drift** — `data_aniversario` exists in production but in
   no migration. Unlike the others this is *not* deferred: it blocks the
   allowlist and is fixed by a prerequisite reconciling migration sequenced
   before Migration A. Listed here because the underlying question — what else
   has drifted across all tables — is broader than this feature and deserves its
   own audit. **Resolved** — see [the drift audit](2026-07-27-schema-drift-audit.md).

7. **Every `SECURITY DEFINER` function in this repo omits `pg_temp` from its
   `search_path`.** All 102 occurrences across `supabase/migrations/` are
   `SET search_path = public`; none names `pg_temp`. PostgreSQL searches the
   session's temporary schema *first* for relation names when `pg_temp` is
   absent from the path, so any such function referencing a table by unqualified
   name can be pointed at a caller-created temp table of the same name. The
   consequential instance is **not** a financial one: `get_my_conta_id()` is
   `SECURITY DEFINER`, reads `profiles` and `workspace_members` unqualified, and
   is the sole tenant predicate in essentially every RLS policy in the schema —
   shadowing both tables would forge membership in an arbitrary workspace.

   **Not currently exploitable through the product.** The attack needs
   `CREATE TEMP TABLE` executed as `authenticated`, and PostgREST issues no DDL
   on a caller's behalf; there is no arbitrary-SQL surface exposed to the role.
   So this is hardening of a linchpin, not an open hole — but it is a one-token
   fix per function and the linchpin deserves it.

   Out of scope here beyond this design's own function, which uses
   `SET search_path = public, pg_temp` and schema-qualifies every relation.
   A repo-wide pass is its own migration and its own decision.
