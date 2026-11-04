# Acesso por cliente Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the workspace owner restrict any non-owner member to a chosen list of clients, enforced in the database and in every service-role path.

**Architecture:** A per-member flag (`workspace_members.client_scope`) plus an assignment table feed one SQL predicate (`can_access_cliente`). Every client-linked table, view and SECURITY DEFINER reader composes it with the existing module check. A sister predicate (`can_see_cliente_context`) unlocks only the context an assigned item needs. Edge functions and the MCP call the service-role variant. The CRM reads the scope through `getMyMembership()` and rides the existing live-revocation path.

**Tech Stack:** Postgres RLS + SECURITY DEFINER RPCs (Supabase), Deno edge functions, React 19 + TanStack Query, Vitest, psql entitlement suites, `deno test`.

**Spec:** `docs/superpowers/specs/2026-11-03-acesso-por-cliente-design.md`

## Global Constraints

- Migration versions start at `20261115000001` and increase by 1; re-check main's tail before `gh pr create` and renumber above it if needed (the `migration-version-guard` CI job fails duplicates).
- Scope values are exactly `'todos'` and `'atribuidos'`; default `'todos'`. Restricted with zero rows = zero clients, never "all".
- Any `workspace_members.role = 'owner'` is always unrestricted; the predicate checks role first.
- Policies call only functions with EXECUTE for `authenticated` (`has_permission(module, action)`, `can_access_cliente(bigint)`, `can_see_cliente_context(bigint)`, `my_membro_ids()`, `my_client_scope_all()`, `workflow_in_active_conta(bigint)`, `workflow_has_own_item(bigint)`, `cliente_in_active_conta(bigint)`, `tarefa_serie_in_active_conta(bigint)`, `folder_cliente_id(bigint)`, `folder_row_cliente_id(text, bigint, bigint)`, `file_linked_to_visible_post(bigint)`). `has_permission_for` and `can_access_cliente(uuid, uuid, bigint)` are `service_role` only.
- Writes (INSERT / UPDATE of `cliente_id`) check `can_access_cliente` with **no** "é dele" exception.
- The predicate never reads the feature flag (fails closed). The flag only gates moving someone **into** `atribuidos` and the UI.
- New SECURITY DEFINER functions: `SET search_path = public`, `REVOKE ALL ... FROM PUBLIC, anon, authenticated` and then name grantees explicitly (`REVOKE FROM PUBLIC` alone leaves `anon`/`authenticated` untouched).
- Edge functions: `buildCorsHeaders(req)`, generic pt-BR errors to the client, details only in logs.
- UI copy pt-BR, sentence case, no em-dashes. Exact strings: "Clientes" (column), "Todos os clientes", "Só os clientes selecionados", "Acesso a clientes · {nome}", "{n} de {total} selecionados", "Selecionar todos", "Limpar", "{nome} não vai ver nenhum cliente.", "Itens atribuídos a {nome} ou criados por ele(a) continuam visíveis, mesmo de outros clientes.", "Você vê os clientes atribuídos a você.", "Valores dos seus clientes", "Liberar todos os clientes".
- RLS changes only **add** the scope clause to each table's existing qual: `<existing qual> AND (my_client_scope_all() OR can_access_cliente(key) OR <é dele>)`. Never add a module check (`has_permission`) to a policy that doesn't have one today: module permissions are mostly enforced in the frontend, and a new RLS module check would change access for custom roles on deploy.
- `auth.uid() IS NULL` (pg_cron, service-role calls) counts as **unrestricted** in the `authenticated`-side helpers. Service-role paths carry their own filter (`loadClientScope`, Task 12).
- Running one suite: `psql "${SUPABASE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}" -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/<file>.sql`. `npm run test:db` takes no filter and runs every `supabase/tests/entitlements/[0-9]*.sql`.
- Suites that put a member into `atribuidos` set `client_scope` / insert assignment rows directly as superuser. Only the RPC cases set `workspace_plan_overrides.feature_overrides = {"feature_acesso_por_cliente": true}`, because the flag defaults to false.
- Before pushing: `npm run lint`, `npm run format:check`, the five `tsc` commands from CLAUDE.md, `npm run test`, `npm run check:functions`, `npm run test:functions`; `npm run test:db` locally (colima).

## Review Focus

1. **A new table with `cliente_id` added later** silently bypasses the scope. Pinned by Task 2's structural catalog test, which fails on any client-linked table without a policy referencing the predicate.
2. **Unrestricted members on big lists** (posts, files, calendar) must not get slower. Pinned by Task 4a's EXPLAIN check that the `todos` branch short-circuits through the initplan.
3. **Assignment list changes with no scope change** (owner ticks one more client) must still purge the restricted member's open tabs live. Pinned by Task 9's revocation test on a `client_scope_rev`-only change.
4. **A restricted member moving their own post to a hidden client**: UPDATE of `cliente_id` must fail even though they are the author. Pinned by Task 4a's suite case `move_own_post_to_hidden_client_denied`.
5. **Owner demoted to admin while restricted rows exist** (or admin promoted to owner): promotion clears scope; demotion leaves `todos`. Pinned by Task 1's trigger cases.

---

## Phase 1: database and CRM

### Task 1: Scope schema, predicates and the owner RPC

**Files:**
- Create: `supabase/migrations/20261115000001_acesso_por_cliente_a_schema.sql`
- Create: `supabase/tests/entitlements/99_acesso_por_cliente_schema.sql`

**Interfaces:**
- Produces (SQL):
  - `workspace_members.client_scope text NOT NULL DEFAULT 'todos' CHECK (client_scope IN ('todos','atribuidos'))`
  - `workspace_members.client_scope_rev bigint NOT NULL DEFAULT 0`
  - table `workspace_member_clientes(workspace_id uuid, user_id uuid, cliente_id bigint, created_at timestamptz, created_by uuid)`, PK `(workspace_id, user_id, cliente_id)`, FKs exactly as the spec's "Modelo de dados" block, cascade on both
  - `can_access_cliente(p_user uuid, p_conta uuid, p_cliente_id bigint) RETURNS boolean`: STABLE, DEFINER, `service_role` only
  - `can_access_cliente(p_cliente_id bigint) RETURNS boolean`: wrapper on `auth.uid()` + `get_my_conta_id()`, `authenticated`
  - `my_client_scope_all() RETURNS boolean`: true when `auth.uid() IS NULL`, for owner, or for `todos` in the active workspace; false otherwise (including an authenticated user with no membership), `authenticated`. `can_access_cliente(bigint)` likewise returns true when `auth.uid() IS NULL`
  - `my_membro_ids() RETURNS bigint[]`: `membros.id` where `crm_user_id = auth.uid() AND conta_id = get_my_conta_id()`, `authenticated`
  - `can_see_cliente_context(p_cliente_id bigint) RETURNS boolean`: `can_access_cliente(p_cliente_id)` OR an "é dele" row in that client exists in `workflow_posts`, `workflow_etapas` or `tarefas` (columns from Task 2's inventory; start with these three), `authenticated`
  - `set_member_client_scope(p_actor uuid, p_workspace uuid, p_user uuid, p_scope text, p_cliente_ids bigint[]) RETURNS jsonb` → `{"changed": bool}`, `service_role` only. Raises `not_owner`, `target_is_owner`, `target_not_member`, `invalid_scope`, `cliente_not_in_workspace`, `feature_disabled` (only when moving into `atribuidos` and `effective_plan_feature(p_workspace,'feature_acesso_por_cliente')` is false). Replaces rows, bumps `client_scope_rev`, inserts `audit_log` (action `member_client_scope_set`, details = scope + count, never names)
  - trigger `trg_workspace_members_owner_clears_scope` BEFORE UPDATE OF role: when NEW.role = 'owner', set `client_scope='todos'`, bump rev, delete the user's rows
  - `plans.feature_acesso_por_cliente boolean NOT NULL DEFAULT false`
  - `notifications.cliente_id bigint NULL` (no FK; client deletion leaves the id, harmless), index `(workspace_id, cliente_id)`, one-time backfill from `metadata->>'post_id'` (via `workflow_posts.cliente_id`) and `metadata->>'workflow_id'` (via `workflows.cliente_id`). The column is `metadata`, not `payload`
  - RLS on `workspace_member_clientes`: SELECT own rows, or all rows of the workspace for an owner; `GRANT SELECT` to `authenticated`, no write grants

- [ ] **Step 1: Write the failing suite** `99_acesso_por_cliente_schema.sql` (pattern of `99_workspace_member_emails.sql`: `_helpers.sql`, `et_grant_hosted_parity()`, `et_make_workspace`). Cases, each an `assert`:
  - `owner_always_true`: owner with `client_scope` forced to `atribuidos` → `can_access_cliente` true
  - `todos_true`, `atribuidos_assigned_true`, `atribuidos_unassigned_false`, `atribuidos_zero_rows_false`, `null_cliente_false`, `non_member_false`, `other_workspace_false`
  - `rpc_not_owner_raises` (admin actor), `rpc_target_owner_raises`, `rpc_foreign_cliente_raises`, `rpc_feature_off_blocks_atribuidos`, `rpc_feature_off_allows_todos`
  - `rpc_bumps_rev`: rev +1 after a call that only changes the list
  - `promote_to_owner_clears`: scope `todos`, rows gone
  - `cascade_cliente_delete`, `cascade_member_remove`
  - `select_own_rows_only`: restricted member sees only their rows; owner sees all; `INSERT` as `authenticated` raises `42501`
  - `null_uid_unrestricted`: with no JWT claims, `my_client_scope_all()` and `can_access_cliente(id)` are true
  - `notifications_backfill`: a seeded `post_assigned` notification gets the post's `cliente_id`

- [ ] **Step 2: Run it, expect failure**
  Run: the single-suite `psql` command from Global Constraints on `99_acesso_por_cliente_schema.sql`
  Expected: FAIL (`function can_access_cliente does not exist`)

- [ ] **Step 3: Write the migration** with the objects above. Finish with a `DO` block that asserts the ACLs (pattern at the end of `20260903000002_workspace_roles_a_additive.sql`).

- [ ] **Step 4: Run it, expect pass** (same command). Expected: all asserts pass.

- [ ] **Step 5: Commit** `feat(db): escopo de clientes por membro (schema e predicados)`

### Task 2: Catalog inventory and drift guard

**Files:**
- Create: `docs/superpowers/plans/2026-11-03-acesso-por-cliente-inventario.md`
- Create: `supabase/tests/entitlements/pending_acesso_por_cliente_drift.sql` (no leading digit, so `test:db` skips it until Task 4e renames it to `99_acesso_por_cliente_drift.sql`)

**Interfaces:**
- Consumes: Task 1's function names.
- Produces: the inventory tables below, consumed by Tasks 3 to 6 (including 4a–4e) and 12 to 14. Keep it as tables with these columns: `table | client key (own column or parent path) | "é dele" columns (uuid / membros bigint) | read policy | write policy`, then `view | security_invoker? | filter`, then `definer function | reads which tables | called by`.

- [ ] **Step 1: Generate the inventory on a local DB with all migrations applied**, using catalog queries only:
  - `information_schema.columns WHERE table_schema='public' AND column_name IN ('cliente_id','client_id')`
  - child tables: `pg_constraint` FKs (contype `f`) pointing at those tables, recursively
  - `pg_views` / `pg_class.reloptions` for views over them
  - `pg_proc WHERE prosecdef AND prosrc ~ '<table names>'` (also check PR #539's list if it's merged)
  - edge functions: `grep -rln "cliente_id\|client_id" supabase/functions/*/index.ts supabase/functions/*/*.ts`
  Mark each table `scoped` or `exempt` with a one-line reason. Expected exemptions: `clientes_hub_tokens`-style Hub-only tables read only by service role, the Hub's own paths, `financeiro_*` (handled in Task 6).

- [ ] **Step 2: Write the drift suite.** One `assert` per catalog rule:
  - `every_client_table_scoped`: every table from the step-1 query not in an explicit `exempt` array has at least one SELECT policy whose `qual` mentions `can_access_cliente` or `can_see_cliente_context`
  - `every_client_table_write_checked`: same, for `with_check` on INSERT and UPDATE policies
  - `every_client_view_filtered`: each view over a scoped table either has `security_invoker=true` or its definition mentions the predicate
  - `context_fn_covers_own_tables`: every table the inventory marks with an "é dele" column appears in `pg_get_functiondef('can_see_cliente_context(bigint)'::regprocedure)`
  The exempt array lives at the top of the suite, each entry with a comment naming why.

- [ ] **Step 3: Run it with the single-suite `psql` command, expect failure** listing the unscoped tables. Tasks 3 and 4a–4e turn it green.

- [ ] **Step 4: Commit** the inventory and the red suite (CI skips it by filename). Message: `test(db): inventário e guarda de deriva do acesso por cliente`

### Task 3: Clients, views and client creation

**Files:**
- Create: `supabase/migrations/20261115000002_acesso_por_cliente_b_clientes.sql`
- Create: `supabase/tests/entitlements/99_acesso_por_cliente_clientes.sql`

**Interfaces:**
- Consumes: Task 1 helpers; Task 2's view list.
- Produces: `clientes_v` and the other client views from the inventory filtered by `(my_client_scope_all() OR can_access_cliente(c.id))`; `clientes` SELECT/UPDATE/DELETE policies with the same predicate; `clientes` INSERT policy `WITH CHECK (my_client_scope_all())`; RPC `get_cliente_contexto(p_cliente_id bigint) RETURNS TABLE(id bigint, nome text, sigla text, cor text, foto_url text)` that returns a row only when `can_see_cliente_context(p_cliente_id)`. Recreate `clientes_v` with the current column list from `20261010100001_board_platforms.sql` (re-check later migrations for a newer definition first).

- [ ] **Step 1: Write the failing suite.** Cases: `restricted_sees_assigned_in_view`, `restricted_hidden_not_in_view`, `restricted_hidden_not_in_table`, `restricted_insert_cliente_denied`, `todos_sees_all`, `context_rpc_with_own_post_returns_row`, `context_rpc_without_own_item_empty`, `context_does_not_add_to_view` (an own post in a hidden client keeps that client out of `clientes_v`), and `get_client_health_aggregates_only_assigned`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Write the migration.** Also gate the client-creating definer paths from the inventory (CSV import, lead conversion RPC) on `my_client_scope_all()`, raising `client_scope_restricted`.
- [ ] **Step 4: Run, expect PASS**, plus the existing suites: `npm run test:db`.
- [ ] **Step 5: Commit** `feat(db): clientes e clientes_v respeitam o escopo do membro`

### Task 4a–4e: Content tables (read with "é dele", write strict)

Five tasks, one per domain, each with its own migration and suite so a reviewer can gate them separately. All share this rule set.

**Shared rules (all of 4a–4e):**
- Each policy's qual becomes `<existing qual> AND (my_client_scope_all() OR can_access_cliente(<client key>) OR <é dele>)`; nothing else added (see Global Constraints).
- INSERT / UPDATE `WITH CHECK` becomes `<existing check> AND (my_client_scope_all() OR can_access_cliente(<client key>))`. A NULL client key on write is allowed only when `my_client_scope_all()`.
- `<é dele>` = `created_by = auth.uid()` and/or `responsavel_id = ANY(my_membro_ids())`, per the inventory. Rows with NULL client key show only through `<é dele>`.
- Item children (media links, slides, comments, feedback, versions) use the parent's visibility through an `EXISTS` on the parent row.
- One `DROP POLICY IF EXISTS` / `CREATE POLICY` pair per policy. Re-read the current definition in the latest migration that touched the table (`pg_policies` on the local DB is the truth).
- Every suite seeds one restricted agent assigned to client A, client B hidden, and one `todos` agent. Every suite also has `todos_counts_unchanged`: the `todos` agent's row count per touched table equals the count from before the migration (captured in the suite by running the same select as superuser filtered by `conta_id`).
- Run each suite with the single-suite `psql` command, then `npm run test:db` before committing.

| Task | Migration | Suite | Tables (confirm with the inventory) | Extra cases |
|---|---|---|---|---|
| 4a | `20261115000003_acesso_por_cliente_c1_posts.sql` | `99_acesso_por_cliente_posts.sql` | `workflows`, `workflow_etapas`, `workflow_posts` and children, `post_edit_suggestions`, `post_references`, `post_content_versions`, `post_discussao_participantes` | `post_in_a_visible`, `post_in_b_hidden`, `own_post_in_b_visible` (via `responsavel_id` → `membros.crm_user_id`), `own_post_in_b_media_visible`, `other_post_in_b_of_same_workflow_hidden`, `avulso_post_no_workflow_uses_own_cliente_id`, `insert_post_into_b_denied`, `move_own_post_to_hidden_client_denied`, `non_restricted_member_can_assign_restricted_to_b_post`, `post_discussao_of_hidden_post_hidden`, `explain_todos_short_circuits` (`EXPLAIN (FORMAT JSON)` of `select * from workflow_posts` as the `todos` agent shows `my_client_scope_all` as an InitPlan and no per-row `can_access_cliente` SubPlan) |
| 4b | `20261115000004_acesso_por_cliente_c2_tarefas_ideias.sql` | `99_acesso_por_cliente_tarefas.sql` | `tarefas` and comments/history, `ideias` and media, `linha_editorial_*`, briefing tables, brand profile tables (read via `can_see_cliente_context`) | `task_without_client_hidden`, `own_task_without_client_visible`, `insert_task_null_client_denied_for_restricted`, `brand_profile_of_b_visible_with_own_post`, `brand_profile_of_b_hidden_without_own_item` |
| 4c | `20261115000005_acesso_por_cliente_c3_arquivos.sql` | `99_acesso_por_cliente_arquivos.sql` | `files`, `folders`, `post_file_links`, `file_deletions` readers | `file_in_b_hidden`, `file_linked_to_own_b_post_visible`, `upload_into_b_folder_denied` |
| 4d | `20261115000006_acesso_por_cliente_c4_agenda_analytics.sql` | `99_acesso_por_cliente_agenda.sql` | agenda events, Instagram/TikTok/YouTube/GBP account and history tables, `report_documents`, Hub token tables, `instagram_comment_*` | `ig_metrics_of_b_hidden`, `report_of_b_hidden`, `agenda_event_own_without_client_visible` |
| 4e | `20261115000007_acesso_por_cliente_c5_notif_membros.sql` | `99_acesso_por_cliente_notificacoes_leitura.sql`; rename `pending_acesso_por_cliente_drift.sql` → `99_acesso_por_cliente_drift.sql` | `notifications` read: `<existing qual> AND (cliente_id IS NULL OR my_client_scope_all() OR can_see_cliente_context(cliente_id))`. Trigger `trg_membros_crm_user_scope_lock` on `membros`: an UPDATE of `crm_user_id` where the old or new value is a user with `client_scope='atribuidos'` in that `conta_id` raises `client_scope_owner_only` unless `auth.uid()` is an owner there. `equipe_conversas` and children unchanged | `notification_about_b_hidden`, `notification_about_own_b_post_visible`, `chat_room_member_visible`, `relink_crm_user_id_of_restricted_by_admin_denied`, `relink_by_owner_ok`; the drift suite passes |

Steps for each of 4a–4e:

- [ ] **Step 1: Write the failing suite** with the shared and extra cases.
- [ ] **Step 2: Run it, expect FAIL.**
- [ ] **Step 3: Write the migration.** If the inventory adds an "é dele" table in this domain, also `CREATE OR REPLACE can_see_cliente_context` to include it (the drift case `context_fn_covers_own_tables` enforces this).
- [ ] **Step 4: Run** the suite and then `npm run test:db`. Expected: PASS (4e: drift suite PASS too).
- [ ] **Step 5: Commit** `feat(db): <domínio> respeita o escopo do membro`

### Task 5: SECURITY DEFINER readers

**Files:**
- Create: `supabase/migrations/20261115000008_acesso_por_cliente_d_definer.sql`
- Create: `supabase/tests/entitlements/99_acesso_por_cliente_definer.sql`

**Interfaces:**
- Consumes: Task 2's definer list (dashboard KPIs, search, `duplicate_post`/`duplicate_workflow`, workflow analytics, calendar readers, agenda readers).
- Produces: each listed reader filters rows by `my_client_scope_all() OR can_access_cliente(<key>) OR <é dele>` the same way as Task 4; each writer/duplicator refuses a hidden source or target with `client_scope_restricted`.

- [ ] **Step 1: Failing suite**, one case per function: restricted caller gets only assigned-client rows; `todos` caller unchanged versus a snapshot taken before the migration (same counts).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Migration** (`CREATE OR REPLACE` each one, same signature and grants).
- [ ] **Step 4: Run** the suite, then `npm run test:db`, expect PASS.
- [ ] **Step 5: Commit** `feat(db): leitores SECURITY DEFINER respeitam o escopo`

### Task 6: Financeiro over the member's clients

**Files:**
- Create: `supabase/migrations/20261115000009_acesso_por_cliente_e_financeiro.sql`
- Create: `supabase/tests/entitlements/99_acesso_por_cliente_financeiro.sql`

**Interfaces:**
- Consumes: Task 1 helpers.
- Produces: `_financeiro_calcular` stays **untouched** (it is the single rateio and `financeiro_rolar_periodos` snapshots run through it under pg_cron). The filter goes in the read layer: `_financeiro_rentabilidade_core` and the listing RPCs gain `p_cliente_ids bigint[] DEFAULT NULL` (NULL = all), and the `authenticated` wrappers pass `NULL` when `my_client_scope_all()`, else the caller's assigned ids. The same applies to contratos readers and the financial dashboard KPIs from the inventory. For restricted callers, member costs and expenses with no client are excluded; only the share prorated to their clients counts. Every `financeiro_*_salvar` (not `_as`) refuses a row of a hidden client with `client_scope_restricted`. The `_as` (MCP) variants get the service-role check in Task 12. Legacy readers (`transacoes`, `contratos` tables) get the Task 4 read/write predicates.

- [ ] **Step 1: Failing suite.** Cases: `rolar_periodos_snapshot_unchanged` (run `financeiro_rolar_periodos` with no JWT; the snapshot equals the pre-migration result), `restricted_rentabilidade_only_assigned`, `restricted_total_excludes_unassigned_revenue`, `restricted_excludes_unallocated_costs`, `todos_totals_unchanged` (snapshot before/after), `restricted_save_hidden_client_denied`.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Migration.** **Step 4: Run** the suite, then `npm run test:db`, PASS.
- [ ] **Step 5: Commit** `feat(db): financeiro do membro restrito só sobre os clientes dele`

### Task 7: `set-client-scope` action

**Files:**
- Create: `supabase/functions/manage-workspace-user/setClientScope.ts`
- Modify: `supabase/functions/manage-workspace-user/index.ts` (new branch next to `set-financial-access`, same workspace resolution)
- Test: `supabase/functions/__tests__/set_client_scope_test.ts`

**Interfaces:**
- Consumes: RPC `set_member_client_scope` (Task 1).
- Produces: `handleSetClientScope(client: RpcClient, input: { actorUserId: string; targetUserId: string; workspaceId: string; scope: 'todos' | 'atribuidos'; clienteIds: number[] }): Promise<{ status: number; message: string; changed: boolean }>`. Request body `{ action: 'set-client-scope', targetUserId, scope, clienteIds }`. Validation: `scope` in the two values, `clienteIds` an array of positive integers of at most 2000 items, else 400.
  Error map: `not_owner` → 403 "Apenas o proprietário pode alterar esse acesso."; `target_is_owner` → 400 "O proprietário sempre vê todos os clientes."; `target_not_member` → 404 "Membro não encontrado neste workspace."; `cliente_not_in_workspace` → 400 "Algum cliente selecionado não pertence a este workspace."; `feature_disabled` → 403 "Recurso indisponível no seu plano."; else 500 "Não foi possível salvar o acesso."

- [ ] **Step 1: Failing Deno test** (pattern of `set_financial_access_test.ts`): RPC args passthrough (`p_actor`, `p_workspace`, `p_user`, `p_scope`, `p_cliente_ids`), each error mapping above, a raw error never echoed, and 400 for a bad `scope` / non-integer id.
- [ ] **Step 2: Run** `deno test --no-check supabase/functions/__tests__/set_client_scope_test.ts`, expect FAIL.
- [ ] **Step 3: Implement** the handler and the branch.
- [ ] **Step 4: Run** the test plus `npm run check:functions`, expect PASS.
- [ ] **Step 5: Commit** `feat(fn): ação set-client-scope no manage-workspace-user`

### Task 8: Feature flag plumbing

**Files:**
- Modify: `supabase/functions/_shared/entitlements.ts` (add `"feature_acesso_por_cliente"` to the feature list at line 23)
- Modify: `supabase/functions/workspace-limits/index.ts`, `apps/crm/src/hooks/useWorkspaceLimits.ts` (`feature_acesso_por_cliente?: boolean`, read as `features?.feature_acesso_por_cliente === true`, same as `feature_linha_editorial`)
- Modify: `apps/admin/src/lib/api.ts` and the plan editor's feature list (mirror `feature_linha_editorial`)
- Test: the existing entitlements parity tests (grep `feature_linha_editorial` in both `__tests__` trees and add the new key where that one appears)

**Interfaces:**
- Produces: `useWorkspaceLimits().features.feature_acesso_por_cliente: boolean | undefined`.

- [ ] **Step 1: Update the parity tests to expect the new key, run** `npm run test` and `npm run test:functions`, expect FAIL.
- [ ] **Step 2: Add the key everywhere** listed above.
- [ ] **Step 3: Run** both suites, expect PASS.
- [ ] **Step 4: Commit** `feat: flag feature_acesso_por_cliente`

### Task 9: Membership, permissions and live revocation in the CRM

**Files:**
- Modify: `apps/crm/src/store/workspace.ts` (`MyMembership`, `getMyMembership`, new `setWorkspaceUserClientScope`, `getWorkspaceUsers` projects `client_scope`)
- Modify: `apps/crm/src/lib/permissions.ts`
- Modify: `apps/crm/src/context/AuthContext.tsx` (`applyMembership`)
- Test: `apps/crm/src/lib/__tests__/permissions.test.ts`, `apps/crm/src/context/__tests__/revocation.test.ts`, `apps/crm/src/store/__tests__/membership.test.ts`

**Interfaces:**
- Consumes: Task 1 columns and table; Task 7 action.
- Produces:
  - `MyMembership` gains `client_scope: 'todos' | 'atribuidos'`, `client_scope_rev: number`, `cliente_ids: number[]` (from an embed `workspace_member_clientes(cliente_id)`; when the embed is missing or errors while `client_scope === 'atribuidos'`, `cliente_ids = []`, never a fallback to "all"). The pre-migration fallback in `getMyMembership` returns `client_scope: 'todos'`, rev 0, `[]`.
  - `isClientScoped(m: MyMembership | null): boolean` (true only for non-owner with `'atribuidos'`).
  - `computePermissionTransitions` adds `clientes`, `entregas`, `calendario`, `aprovacoes`, `arquivos`, `ideias`, `tarefas`, `analytics`, `financeiro`, `contratos` to `downgraded` when `client_scope` or `client_scope_rev` changed, or when `cliente_ids` lost an id.
  - `setWorkspaceUserClientScope(userId: string, scope: 'todos' | 'atribuidos', clienteIds: number[]): Promise<void>` via `callManageWorkspaceUser('set-client-scope', userId, { scope, clienteIds })`.

- [ ] **Step 1: Failing tests:**
  - `isClientScoped` true/false table (owner + atribuidos → false)
  - `transitions_rev_only_change_downgrades_client_modules`
  - `transitions_lost_id_downgrades`, `transitions_added_id_only_is_not_downgrade`
  - `membership_embed_error_with_atribuidos_yields_empty_ids`
  - revocation: a realtime UPDATE carrying only a new `client_scope_rev` triggers the purge of the client query keys
- [ ] **Step 2: Run** `npm run test -- permissions revocation membership`, expect FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same, expect PASS.
- [ ] **Step 5: Commit** `feat(crm): escopo de clientes na membership e revogação ao vivo`

### Task 10: Owner UI: Clientes column, dialog, phone sheet

**Files:**
- Create: `apps/crm/src/pages/configuracao/tabs/ClientAccessDialog.tsx`
- Modify: `apps/crm/src/pages/configuracao/tabs/MembrosTab.tsx` (column after Financeiro)
- Modify: `apps/crm/src/pages/configuracao/tabs/phone/MembrosPhone.tsx` (row line "Clientes: {n}" + Sheet using the same body)
- Modify: the i18n file holding `membros.*` keys
- Test: `apps/crm/src/pages/configuracao/tabs/__tests__/ClientAccessDialog.test.tsx`, existing `MembrosTab` tests

**Interfaces:**
- Consumes: `setWorkspaceUserClientScope`, `getWorkspaceUsers().client_scope`, `useWorkspaceLimits().features.feature_acesso_por_cliente`, the client list query used by `ClientesPage`.
- Produces: `ClientAccessDialog({ open, onOpenChange, member: { user_id: string; nome: string; client_scope: 'todos' | 'atribuidos' }, initialIds: number[] })`, laid out as artboard 2 of the mockups canvas (https://claude.ai/artifact/9yzR2UjLMSyxaPpR9BkdKM): two radio cards, search, select all / clear, counter, warning badge at zero, info note, Cancelar/Salvar. Uses `confirmClose` when dirty. The owner needs every assignment of a member: read `workspace_member_clientes` filtered by `user_id` (owner RLS allows it).

Column rules: owner row "Todos" with no action; non-owner viewer sees text only; owner sees a button ("Todos os clientes" or a lock icon + "{n} clientes"/"1 cliente"). The flag off hides the column unless that member is already `atribuidos`; then the dialog shows only "Liberar todos os clientes".

- [ ] **Step 1: Failing tests:** `renders_scope_choice_and_list`, `counter_updates_on_toggle`, `zero_selected_shows_warning`, `save_calls_store_with_ids`, `cancel_when_dirty_asks_confirm`, `column_hidden_for_flag_off_and_todos`, `flag_off_restricted_shows_only_liberar`, `admin_viewer_sees_text_not_button`, `owner_row_has_no_action`.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement.** **Step 4: Run, expect PASS.**
- [ ] **Step 5: Verify in the Browser pane** (`npm run dev:env`, seed login per memory `reference_seed_login_browser_verification`): desktop ≥1101px and phone 375px; screenshot both.
- [ ] **Step 6: Commit** `feat(crm): acesso a clientes por membro em Configuração > Membros`

### Task 11: What the restricted member sees

**Files:**
- Modify: `apps/crm/src/pages/clientes/ClientesPage.tsx` and its phone variant (hide "Novo cliente" and import; show the badge "Você vê os clientes atribuídos a você.")
- Modify: lead-to-client conversion entry point and client CSV import entry (hide when `isClientScoped`)
- Modify: `apps/crm/src/pages/financeiro/v2/` page header (badge "Valores dos seus clientes")
- Modify: the post/task detail that shows client name/brand: fall back to `get_cliente_contexto` RPC (new store fn `getClienteContexto(id: number)` in `apps/crm/src/store/clients.ts`) when the client isn't in the visible list
- Test: `apps/crm/src/pages/clientes/__tests__/ClientesPage.test.tsx` and phone test, financeiro header test

- [ ] **Step 1: Failing tests:** `restricted_hides_novo_cliente`, `restricted_shows_badge`, `todos_unchanged`, `financeiro_badge_when_restricted`, `post_detail_uses_context_rpc_for_hidden_client`.
- [ ] **Step 2: Run, FAIL. Step 3: Implement. Step 4: Run, PASS.**
- [ ] **Step 5: Browser check** as a restricted seed member: list, `/clientes/<hidden id>` shows "Cliente não encontrado", own post in a hidden client shows the client name.
- [ ] **Step 6: Commit** `feat(crm): experiência do membro restrito`

---

## Phase 2: service-role paths (required before the flag goes on anywhere)

### Task 12: MCP

**Files:**
- Create: `supabase/functions/_shared/client-scope.ts`
- Modify: `supabase/functions/mcp/` tool handlers that list or read clients, posts, tasks, ideas, calendar, financeiro (`*_as` RPC callers), and `create_client`
- Test: `supabase/functions/__tests__/client-scope_test.ts`, the MCP tool tests that cover those tools

**Interfaces:**
- Produces: `loadClientScope(svc, userId: string, workspaceId: string): Promise<{ all: boolean; ids: Set<number> }>` (owner or `todos` → `all: true`; read errors throw, never `all: true`), `assertClientAccess(scope, clienteId: number | null, isOwnItem: boolean): void` throwing `ClientScopeError`. `financeiro_*_as` RPCs get a `p_actor` scope check in SQL instead (new migration `20261115000010_acesso_por_cliente_g_financeiro_as.sql`).
- MCP tools filter lists with `scope.ids`; get/update of a hidden client returns the same "not found" the tool already returns; `create_client` for a restricted key returns `client_scope_restricted` mapped to "Seu acesso é limitado aos clientes atribuídos.". `auditArgs` unchanged (no ids lists).

- [ ] **Step 1: Failing tests** for `loadClientScope` (owner, todos, atribuidos, read error throws) and one test per touched tool (restricted key sees only assigned; hidden get → not found; create refused).
- [ ] **Step 2: Run** `npm run test:functions`, FAIL. **Step 3: Implement.** **Step 4: Run** `npm run check:functions && npm run test:functions`, PASS.
- [ ] **Step 5: Commit** `feat(mcp): ferramentas respeitam o escopo de clientes`

### Task 13: Edge functions that read client data for a user

**Files:**
- Modify: each function in Task 2's edge list that serves a CRM user (expected: `instagram-analytics`, `instagram-integration`, `tiktok-analytics`, `youtube-analytics`, `gbp-analytics`, `report-docs`, `instagram-report-generator-v2`, `file-manage`, `post-references`), calling `loadClientScope` + `assertClientAccess` after the existing `conta_id` check
- Test: one case per function in its existing `__tests__` file

- [ ] **Step 1: Failing tests:** restricted user on a hidden client → the function's existing 403/404 with generic copy; assigned client → unchanged.
- [ ] **Step 2: Run, FAIL. Step 3: Implement. Step 4:** `npm run check:functions && npm run test:functions`, PASS.
- [ ] **Step 5: Commit** `feat(fn): edge functions respeitam o escopo de clientes`

### Task 14: Notification targeting and e-mail crons

**Files:**
- Create: `supabase/migrations/20261115000011_acesso_por_cliente_f_notificacoes.sql`
- Modify: the notification/e-mail crons from the inventory that pick recipients themselves (`notification-email-cron`, `notification-deadline-cron`, `client-event-email-cron`)
- Test: `supabase/tests/entitlements/99_acesso_por_cliente_notificacoes.sql`, the crons' Deno tests

**Interfaces:**
- Produces: `resolve_notification_targets(conta, responsavel, ...)` drops restricted users for whom the event's client is hidden and the item is not theirs. New optional `p_cliente_id bigint DEFAULT NULL` parameter; every trigger that calls it passes the client, and `insert_notification_batch` writes it to `notifications.cliente_id` (Task 1 column). Crons filter recipients with `loadClientScope`.

- [ ] **Step 1: Failing cases:** `restricted_not_targeted_for_hidden_client`, `restricted_targeted_when_responsavel`, `todos_targets_unchanged`; cron test: hidden-client digest excluded.
- [ ] **Step 2: Run, FAIL. Step 3: Implement. Step 4: Run, PASS.**
- [ ] **Step 5: Commit** `feat: notificações respeitam o escopo de clientes`

### Task 15: Deploy order and docs

**Files:**
- Modify: `CLAUDE.md` (new Gotchas entry)

- [ ] **Step 1: Add the Gotchas entry** with: spec path; the predicate rule (never read the flag; owner first; writes without "é dele"); the drift suite as the gate for new client tables; deploy order:
  1. migrations `…01`..`…11`;
  2. `manage-workspace-user`, `mcp`, the Task 13 functions, the crons, and the eight importers of `_shared/entitlements.ts` (`automation-media`, `data-import`, `equipe-chat-media`, `mcp-keys`, `mcp-oauth-consent`, `paywall-report`, `platform-admin`, `workspace-limits`);
  3. merge;
  4. turn the flag on per workspace via override.
  Rollback: set everyone to `todos` before reverting any policy.
- [ ] **Step 2: Run** the full pre-push list from Global Constraints. Expected: all green.
- [ ] **Step 3: Commit** `docs: acesso por cliente no CLAUDE.md`
