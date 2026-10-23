# MCP do Financeiro (somente donos) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owner-only MCP tools that read and configure the whole Financeiro section (lançamentos, recorrentes, cobrança, Financeiro v2).

**Architecture:** SQL: every Financeiro v2 RPC gets a service-role-only `_core(p_conta, p_user, ...)` holding its body, a thin public wrapper (unchanged behaviour) and a service-role-only `_as(p_conta, p_user, ...)` that checks owner; two new atomic RPCs cover confirmar agendamento and criar recorrente. Edge: `McpKeyContext.role` resolved per request, `register(..., { ownerOnly, feature })` gate, new `financeiro*.ts` modules in `supabase/functions/mcp`. Issuance: `financeiro:*` scopes refused for non-owners in `mcp-keys`, `mcp-oauth-consent` and the CRM pickers.

**Tech Stack:** Postgres/plpgsql (Supabase), Deno edge function + `@modelcontextprotocol/sdk` + zod 3, React 19 CRM (Vitest).

**Spec:** `docs/superpowers/specs/2026-10-23-mcp-financeiro-design.md` (read it in full; its "Regras de implementação" section is binding).

## Global Constraints

- Worktree `/Users/eduardosouza/projects/sm-crm/.claude/worktrees/mesas-financial-redesign-e2ff1f`, branch `claude/mcp-financeiro`. Run every command from there. Never commit `supabase/config.toml` or any `.env*`; commit with explicit pathspecs only (`git commit -- <files>`).
- Formatters only on your own files (`npx prettier --write <paths>`), never repo-wide.
- Migrations: `20261029000002_financeiro_v2_rpc_as.sql`, `20261029000003_financeiro_mcp_lancamentos.sql`. No other new version prefixes.
- Local DB: `postgresql://postgres:postgres@127.0.0.1:54522/postgres`; CLI `SB=/Users/eduardosouza/.npm/_npx/0e23c24576954b26/node_modules/@supabase/cli-darwin-arm64/bin/supabase`; reset with `$SB db reset`; entitlement suites with `SUPABASE_DB_URL=postgresql://postgres:postgres@127.0.0.1:54522/postgres bash scripts/test-entitlements.sh` (single file: `psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f <file>`). New suites call `select et_grant_hosted_parity();` inside their `begin`.
- Deno tests: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/<file>`; type gate `npm run check:functions`. Never pass `--filter` expecting a file match. After any Deno run, `git status` must not show `deno.lock` changes; revert them with `git checkout -- deno.lock` if it does.
- User-facing copy in Portuguese, no em dashes (use period or colon).
- Owner = `workspace_members.role = 'owner'` for the key/grant workspace (`ctx.conta_id`), never `profiles.role`, never `active_workspace_id`.
- Tool audit metadata: ids, `mes`/`vale_desde`/`inicio`, counts. Never valores, nomes, descrições or acordo jsonb.
- Error copy for owner gate: `Permission denied: somente o dono do workspace pode usar as ferramentas do Financeiro.`
- "Mês corrente" and "mês anterior" are computed in `America/Sao_Paulo`.

## Review Focus

1. Multi-workspace owner whose `active_workspace_id` points to another workspace: every write lands in `ctx.conta_id` (Task 1 suite `rpc_as_ignores_active_workspace`, Task 5 test `writes use ctx.conta_id`).
2. A key created by an owner who was later demoted to admin: financeiro tools refuse on the next call (Task 3 test `demoted creator loses access`).
3. Foreign ids (cliente/lançamento/recorrente of another workspace): refused before any write (Task 5 test `foreign cliente_id refused`).
4. Repeating `confirmar_agendamento` for the same origem in the same month: second call gets `ja_confirmado`, no second row (Task 2 suite `confirmar_twice`).
5. Agent omitting optional fields on `set_cobranca_cliente` with v2: current version values kept, status never null (Task 5 test `cobranca keeps omitted fields`).

---

### Task 1: `_core` / `_as` / wrapper refactor of the v2 RPCs

**Files:**
- Create: `supabase/migrations/20261029000002_financeiro_v2_rpc_as.sql`
- Create: `docs/superpowers/rollbacks/20261029000002_financeiro_v2_rpc_as.down.sql`
- Create: `supabase/tests/entitlements/99_financeiro_v2_rpc_as.sql`

**Interfaces:**
- Produces (all `SECURITY DEFINER`, `SET search_path = public, pg_temp`, EXECUTE only for `service_role`), same return types as the public ones:
  - `financeiro_config_salvar_as(p_conta uuid, p_user uuid, p_periodo_dia int, p_meta_margem numeric) → void`
  - `financeiro_funcao_salvar_as(p_conta uuid, p_user uuid, p_id bigint, p_nome text, p_ordem int) → bigint`
  - `financeiro_funcao_excluir_as(p_conta uuid, p_user uuid, p_id bigint) → void`
  - `financeiro_cliente_salvar_as(p_conta uuid, p_user uuid, p_cliente_id bigint, p_vale_desde date, p_valor_mensal numeric, p_dia_pagamento int, p_status text) → void`
  - `financeiro_acordo_salvar_as(p_conta uuid, p_user uuid, p_membro_id bigint, p_vale_desde date, p_acordo jsonb) → void`
  - `financeiro_atribuicoes_salvar_as(p_conta uuid, p_user uuid, p_vale_desde date, p_mudancas jsonb) → void`
  - `financeiro_entregas_salvar_as(p_conta uuid, p_user uuid, p_inicio date, p_membro_id bigint, p_itens jsonb) → void`
  - `financeiro_seed_as(p_conta uuid, p_user uuid, p_periodo_dia int) → jsonb`
  - `financeiro_periodo_reabrir_as(p_conta uuid, p_user uuid, p_inicio date) → void`
  - `financeiro_periodo_fechar_as(p_conta uuid, p_user uuid, p_inicio date) → void`
  - `financeiro_rentabilidade_as(p_conta uuid, p_user uuid, p_inicio date DEFAULT NULL) → jsonb`
  - `financeiro_periodos_listar_as(p_conta uuid, p_user uuid) → jsonb`
  - `financeiro_periodos_editaveis_as(p_conta uuid, p_user uuid) → jsonb`
  - Helper `_financeiro_exigir_dono(p_conta uuid, p_user uuid) → void`: raises `owner_only` (ERRCODE 42501) unless `workspace_members` has `(p_user, p_conta, role='owner')`.
  - Cores named `_<public name>_core(p_conta uuid, p_user uuid, <params>)`, same EXECUTE rule.

- [ ] **Step 1: Write the failing suite `99_financeiro_v2_rpc_as.sql`** with PASS blocks (model the helpers on `99_transacoes_recorrentes.sql` and the v2 suites' fixtures; use a `max` workspace with `feature_financeiro_v2` set via `workspace_plan_overrides.feature_overrides` the same way `99_financeiro_v2_escrita.sql` does):
  - `grants_service_role_only`: for every `_as` and `_core` above, `has_function_privilege('authenticated', …, 'EXECUTE')` is false and `service_role` true; `anon` false.
  - `owner_as_works`: as postgres (service role equivalent, no JWT claims), `financeiro_seed_as(ws, dono, 1)` then `financeiro_funcao_salvar_as(ws, dono, null, 'Design', null)` returns an id; `financeiro_cliente_salvar_as` writes a version with `created_by = dono`.
  - `admin_as_denied`: an `admin` with `financeiro: editar` gets an error with SQLSTATE `42501` and message `owner_only` from `financeiro_config_salvar_as`.
  - `rpc_as_ignores_active_workspace`: owner of workspaces A and B with `profiles.active_workspace_id = B`; `financeiro_funcao_salvar_as(A, dono, …)` creates the row in A, none in B.
  - `flags_before_owner`: workspace without `feature_financeiro_v2`, called by a non-owner, raises `feature_disabled:feature_financeiro_v2` (not `owner_only`).
  - `reabrir_audit_actor`: `financeiro_periodo_fechar_as` then `_reabrir_as` write `audit_log` rows whose actor column equals `dono` (not NULL).
  - `rentabilidade_as_explicit_period`: `financeiro_rentabilidade_as(A, dono, <editable inicio>)` returns `seeded = true` while active workspace is B.
- [ ] **Step 2: Run it, expect failure** (`42883` undefined function).
- [ ] **Step 3: Write the migration.** For each RPC, take the LAST definition (000004: config, funcao_salvar/excluir, acordo, atribuicoes, entregas; 000005: cliente_salvar, seed; 000006: reabrir, fechar, rentabilidade; 000003: periodos_listar, periodos_editaveis) and:
  - `_core`: body with `v_conta := p_conta`, every `auth.uid()` → `p_user`, nested `financeiro_periodos_editaveis()` → `_financeiro_periodos_editaveis_core(p_conta, p_user)`, flag/permission/role checks removed (they move to the callers); keeps lock, `seeded`, editable-period and `not_found` logic.
  - public: `CREATE OR REPLACE` with the SAME signature, defaults and grants; resolves `get_my_conta_id()`/`auth.uid()`, runs today's checks in today's order (flags, then `has_permission`/`can_see_financials`, then for reabrir/fechar the existing `owner`/`admin` role check), then `RETURN`/`PERFORM` the core.
  - `_as`: flags (`effective_plan_feature(p_conta, …)`), then `_financeiro_exigir_dono`, then the core.
  - Grants: `REVOKE ALL … FROM PUBLIC, anon, authenticated; GRANT EXECUTE … TO service_role` for `_as`/`_core`/helper. Self-check `DO` block at the end like `20261027000004:620-640`, covering both groups. Final comment `-- Rollback: docs/superpowers/rollbacks/20261029000002_financeiro_v2_rpc_as.down.sql`.
- [ ] **Step 4: Write the rollback file**: the original public definitions copied verbatim from their last migration (with their REVOKE/GRANT lines), then `DROP FUNCTION` for every `_as`, `_core` and the helper.
- [ ] **Step 5: Verify.** `$SB db reset`, run the new suite (all PASS lines), then the full entitlement script (every existing `99_financeiro_v2_*.sql` unchanged and passing). Then apply the rollback (`psql -f docs/superpowers/rollbacks/...down.sql`), rerun the existing `99_financeiro_v2_*.sql` suites (pass) and confirm `\df *_as` is empty. `$SB db reset` again to leave the migration applied.
- [ ] **Step 6: Commit** the three files.

### Task 2: Atomic lançamento RPCs

**Files:**
- Create: `supabase/migrations/20261029000003_financeiro_mcp_lancamentos.sql`
- Create: `supabase/tests/entitlements/99_financeiro_mcp_lancamentos.sql`

**Interfaces:**
- Consumes: `_financeiro_exigir_dono(uuid, uuid)` from Task 1.
- Produces (service_role only):
  - `financeiro_agendamento_confirmar_as(p_conta uuid, p_user uuid, p_origem text, p_id bigint) → jsonb` (the inserted `transacoes` row: id, data, descricao, detalhe, categoria, tipo, valor, status, referencia_agendamento)
  - `financeiro_recorrente_criar_as(p_conta uuid, p_user uuid, p_tipo text, p_descricao text, p_categoria text, p_valor numeric, p_dia int, p_inicio date, p_registrar_primeiro_pago boolean, p_data_primeiro date) → jsonb` (`{ "recorrente": {id, tipo, descricao, categoria, valor, dia, inicio, fim}, "lancamento": {…} | null }`)
  - New error codes: `origem_invalida`, `nao_agendado` (origem not eligible this month), `ja_confirmado`, `valor_indefinido`.

- [ ] **Step 1: Write the failing suite** (PASS blocks):
  - `confirmar_cliente`: active client with `data_pagamento = 31`, `valor_mensal = 1000`; in a month with 30 days the row's `data` is the 30th; `referencia_agendamento = 'cliente_<id>_<yyyy>_<mm>'`, `detalhe 'Agendamento automático'`, `categoria 'Agendamento'`, `tipo 'entrada'`, `status 'pago'`, `user_id = dono`. (Compute the expected month from `now() AT TIME ZONE 'America/Sao_Paulo'`.)
  - `confirmar_membro`: `tipo 'saida'`, ref `membro_<id>_…`, valor = `custo_mensal`.
  - `confirmar_recorrente`: template active this month → ref `recorrente_<id>_<yyyy>_<mm>`, `detalhe 'Recorrente'`, categoria from the template.
  - `confirmar_twice`: second call raises `ja_confirmado`; exactly one row with that ref.
  - `not_eligible`: paused client → `nao_agendado`; recorrente with `inicio` next month → `nao_agendado`; membro with `custo_mensal` NULL → `valor_indefinido`.
  - `foreign_origin`: client id of another workspace → `not_found`.
  - `non_owner_denied`: admin → `owner_only`.
  - `criar_recorrente_atomic`: with `p_registrar_primeiro_pago = true` both rows exist and the lançamento ref is `recorrente_<new id>_<yyyy>_<mm>` of `p_data_primeiro`; with a CHECK-violating `p_dia = 32` neither row exists.
  - `free_plan_denied`: workspace on `free` → `feature_disabled:feature_financial`.
- [ ] **Step 2: Run, expect failure.**
- [ ] **Step 3: Write the migration.** Confirm: flags (`feature_financial`), owner, origem lookup filtered by `conta_id = p_conta` (`not_found` otherwise), eligibility rules and day clamp from spec "Confirmar agendamento", `pg_advisory_xact_lock(hashtextextended('agendamento:' || p_conta || ':' || v_ref, 0))`, existence check → `ja_confirmado`, insert. Criar: flags, owner, insert template, optional paid row (`detalhe 'Recorrente'`, `inicio`/`data` from params) in the same function. Grants + self-check block as Task 1.
- [ ] **Step 4: Verify** suite passes; full entitlement script passes.
- [ ] **Step 5: Commit.**

### Task 3: Role in context + owner gate + existing tools

**Files:**
- Modify: `supabase/functions/_shared/mcp-token.ts` (McpKeyContext, McpOwnerError, resolveMcpKey)
- Modify: `supabase/functions/_shared/mcp-oauth.ts` (isWorkspaceMember → also role; resolveOAuthCtx)
- Modify: `supabase/functions/mcp/tools.ts` (register options, errorResult, audit resource_id, create_client/create_member)
- Test: `supabase/functions/__tests__/mcp-financeiro-gate_test.ts` (new); update `mcp-token_test.ts`, `mcp-oauth_test.ts` where they assert resolver output

**Interfaces:**
- Produces:
  - `McpKeyContext.role?: string | null`
  - `export class McpOwnerError extends Error` (message `owner_only`)
  - `export function requireOwner(ctx: McpKeyContext): void`
  - `memberRole(db, userId, contaId): Promise<string | null>` in `mcp-oauth.ts` (used by both resolvers; `isWorkspaceMember` becomes `(await memberRole(...)) !== null`)
  - `register(server, deps, name, scope, description, shape, run, auditArgs?, opts?: { ownerOnly?: boolean; feature?: "feature_financial" | "feature_financeiro_v2" })`. With `ownerOnly`: `requireScope`, then `requireOwner`, then `effective_plan_feature` for `feature_financial` and, when `opts.feature === 'feature_financeiro_v2'`, that too (`McpInputError` with the mapped message), then `run`.
  - `export const REGISTERED: Array<{ name: string; scope: string; ownerOnly: boolean }>` (populated by `register`, reset at the start of `registerTools`) for the structural test.
  - Test helper `fakeServer()` (records `tool(name, desc, shape, handler)`) in `supabase/functions/__tests__/mcp-financeiro-helpers.ts`, reused by Tasks 4 to 6.

- [ ] **Step 1: Failing tests** in `mcp-financeiro-gate_test.ts`:
  - `owner passes, admin and agent refused`: register a dummy `financeiro:read` tool with `ownerOnly`; role `owner` → `run` called; `admin`/`agent`/`undefined` → result `isError`, text contains `somente o dono do workspace`, `run` not called.
  - `demoted creator loses access`: `resolveMcpKey` with a fake db where `workspace_members` returns `role: 'admin'` → `ctx.role === 'admin'`.
  - `oauth resolver fills role`.
  - `feature_financial off refuses before run`.
  - `create_client: valor_mensal from non-owner refused`, `create_member: custo_mensal/data_pagamento from non-owner refused`, and both accepted for owner (existing behaviour otherwise unchanged).
  - `audit resource_id from lancamento_id/recorrente_id/membro_id/cliente_id/funcao_id/inicio`.
- [ ] **Step 2: Run, expect failures.**
- [ ] **Step 3: Implement.** Role lookup in `resolveMcpKey` uses `ctx.created_by` + `conta_id`; a missing membership yields `role: null` (the key still resolves for non-financeiro tools, matching today).
- [ ] **Step 4: Run** new + all `mcp-*_test.ts` files; `npm run check:functions`.
- [ ] **Step 5: Commit.**

### Task 4: Error table + read tools

**Files:**
- Create: `supabase/functions/mcp/financeiro-errors.ts`
- Create: `supabase/functions/mcp/financeiro.ts` (queries; reads in this task, writes appended in Tasks 5 and 6)
- Create: `supabase/functions/mcp/financeiro-tools.ts` (`registerFinanceiroTools(server, deps)`, called at the end of `registerTools`)
- Test: `supabase/functions/__tests__/mcp-financeiro-read_test.ts`, `supabase/functions/__tests__/mcp-financeiro-errors_test.ts`

**Interfaces:**
- Consumes: `register` opts and `McpOwnerError` (Task 3); `_as` RPC names (Task 1).
- Produces:
  - `FINANCEIRO_ERROS: Record<string, string>` and `mapFinanceiroError(e: unknown): McpInputError | null` (matches PostgREST error `message` exactly against the keys; also SQLSTATE `23514` → `Valor fora do permitido.` and `23503` → `Registro relacionado não encontrado.`). Keys: every code listed in the spec plus Task 2's (`origem_invalida`, `nao_agendado`, `ja_confirmado`, `valor_indefinido`).
  - `export const CATEGORIAS_FINANCEIRO = ['Mensalidade','Produção','Tráfego','Salário','Imposto','Ferramenta','Outro','Agendamento','Recorrente'] as const` (the CRM list plus the two projection categories).
  - Read functions in `financeiro.ts`, each `(deps: Deps, args) => Promise<…>`: `listLancamentos`, `listRecorrentes`, `getCobrancas`, `getFinanceiroV2`, `getRentabilidade`, `getClienteVersoes`, `getAcordoVersoes`.
- Tool schemas (zod), all `financeiro:read`, `ownerOnly`:
  - `list_lancamentos { mes?: /^\d{4}-\d{2}$/, tipo?: 'entrada'|'saida', status?: 'pago'|'agendado', limit?: int 1..500 = 100 }` → `{ lancamentos: [...] }`, order `data desc`. Description says projected agendados are not included and points to `get_cobrancas` + `list_recorrentes`.
  - `list_recorrentes { incluir_encerrados?: boolean = false }` (active = `fim` null or `>=` this month's 1st).
  - `get_cobrancas {}` → `{ clientes: [{id,nome,status,valor_mensal,data_pagamento}], membros: [{id,nome,custo_mensal,data_pagamento}] }`.
  - `get_financeiro_v2 {}` (`feature: 'feature_financeiro_v2'`) → `{ config: {periodo_dia, meta_margem, seeded}, funcoes: [{id,nome,ordem}], periodos, editaveis }`.
  - `get_rentabilidade { inicio?: DATE_ONLY }` (v2).
  - `get_cliente_versoes { cliente_id: int }`, `get_acordo_versoes { membro_id: int }` (v2): fields per spec, `limit 50`, `tem_contrato = arquivo_path != null`, no `created_by`, no `arquivo_path`; the id is checked to belong to `ctx.conta_id` first (`not_found`).
- [ ] **Step 1: Failing tests**: `errors table covers every RAISE` (reads `supabase/migrations/20261027*.sql` and `20261029*.sql`, regex `RAISE EXCEPTION '([a-z_:0-9]+)'`, asserts each code is a key); `mapFinanceiroError` for a P0001 code, a 23514 and an unknown error (null); for each read tool, one test asserting the `conta_id` filter (`eq('conta_id', 'workspace-A')`), the output allowlist (no extra keys) and `_as` RPC args `{ p_conta: 'workspace-A', p_user: 'user-1', … }`; `all financeiro tools are ownerOnly` (iterates `REGISTERED`; also re-run in Tasks 5 and 6 automatically).
- [ ] **Step 2: Run, expect failures.** **Step 3: Implement.** **Step 4: Run** + `npm run check:functions`. **Step 5: Commit.**

### Task 5: Write tools for lançamentos, recorrentes and cobrança

**Files:**
- Modify: `supabase/functions/mcp/financeiro.ts`, `supabase/functions/mcp/financeiro-tools.ts`
- Test: `supabase/functions/__tests__/mcp-financeiro-write_test.ts`

**Interfaces:**
- Consumes: Task 2 RPCs, Task 4 helpers.
- Tool schemas, all `financeiro:write`, `ownerOnly`:
  - `create_lancamento { tipo, descricao: string 1..200, valor: number > 0, data: DATE_ONLY, categoria: enum CATEGORIAS_FINANCEIRO, status?: 'pago'|'agendado' = 'pago', detalhe?: string ≤ 200, cliente_id?: int }` → inserted row (allowlisted fields). `user_id = ctx.created_by`, `conta_id = ctx.conta_id`, `referencia_agendamento` null. `cliente_id` checked against `clientes` with `conta_id`.
  - `update_lancamento { lancamento_id: int, …same fields optional }` (at least one) → updated row; `.eq('id').eq('conta_id')`, zero rows → `not_found`. Does not change `referencia_agendamento`.
  - `delete_lancamento { lancamento_id: int }` → `{ ok: true }`.
  - `confirmar_agendamento { origem: 'cliente'|'membro'|'recorrente', id: int }` → RPC result.
  - `create_recorrente { tipo, descricao, valor > 0, dia: int 1..31, categoria: enum, inicio_mes: /^\d{4}-\d{2}$/ (default mês corrente), registrar_primeiro_pago?: boolean = false, data_primeiro?: DATE_ONLY (required when registrar_primeiro_pago; must fall in inicio_mes) }`.
  - `update_recorrente { recorrente_id, descricao?, valor?, dia?, categoria? }`; `encerrar_recorrente { recorrente_id }` → `{ acao: 'removido' | 'encerrado', fim?: 'YYYY-MM-01' }` (rule from spec).
  - `set_cobranca_cliente { cliente_id, valor_mensal?: number ≥ 0, dia_pagamento?: int 1..31 | null, status?: 'ativo'|'pausado'|'encerrado', vale_desde?: DATE_ONLY }`: seeded workspace → read the current version (latest `vale_desde <= target`) to fill omitted fields, default `vale_desde` per spec, call `financeiro_cliente_salvar_as`; never seeded → update `clientes` legacy columns (`.eq('conta_id')`).
  - `set_custo_membro { membro_id, custo_mensal?: number ≥ 0, dia_pagamento?: int 1..31 | null }`: `feature_financeiro_v2` on → `McpInputError('Com o Financeiro v2 ligado, o custo vem do acordo. Use save_acordo.')`; else legacy columns.
- [ ] **Step 1: Failing tests**: `writes use ctx.conta_id and user_id = created_by` (create_lancamento insert payload); `foreign cliente_id refused` (clientes lookup returns null → `not_found`, no insert call); `update_lancamento zero rows → not_found`; `confirmar passes origem/id to RPC and maps ja_confirmado`; `create_recorrente requires data_primeiro when registrar_primeiro_pago`; `encerrar_recorrente removes when inicio is this month` and `ends on previous month otherwise` (fix the clock via `deps.now`); `cobranca keeps omitted fields` (seeded; current version `{valor 1000, dia 10, status 'ativo'}`, call with only `valor_mensal: 1200` → RPC args `p_dia_pagamento 10, p_status 'ativo'`); `cobranca legacy when never seeded`; `custo_membro refused with v2 on`; `audit has no valor/descricao` (inspect the `audit_log` insert metadata).
- [ ] **Step 2–4: Run fail, implement, run pass** (+ `check:functions`). **Step 5: Commit.**

### Task 6: Write tools for Financeiro v2

**Files:**
- Modify: `supabase/functions/mcp/financeiro.ts`, `supabase/functions/mcp/financeiro-tools.ts`
- Test: `supabase/functions/__tests__/mcp-financeiro-v2_test.ts`

**Interfaces:**
- Consumes: Task 1 `_as` RPCs. All `financeiro:write`, `ownerOnly`, `feature: 'feature_financeiro_v2'` except `seed_financeiro_v2` (also v2).
- Tool schemas:
  - `seed_financeiro_v2 { periodo_dia: int 1..28 }` → RPC jsonb.
  - `save_financeiro_config { periodo_dia?: int 1..28, meta_margem?: number 0..100 }` (at least one).
  - `save_funcao { funcao_id?: int, nome: string 1..60, ordem?: int ≥ 0 }` → `{ funcao_id }`; `delete_funcao { funcao_id }`.
  - `save_acordo { membro_id, vale_desde?: DATE_ONLY, funcao_id?: int | null, modelo: 'mensal_meta'|'mensal_limite'|'por_entrega', valor: number ≥ 0, unidade?: string | null, meta_quantidade?: int | null, meta_periodo?: 'dia_util'|'semana'|'mes' | null, limite_clientes?: int | null, dia_pagamento?: int 1..31 | null, vigencia_inicio?: DATE_ONLY | null, vigencia_fim?: DATE_ONLY | null }`. Builds the full `AcordoInput` object (every key present; omitted → `null`) and carries `arquivo_path` over from the current version (so a linked contract stays). `vale_desde` default as in `set_cobranca_cliente`.
  - `save_atribuicoes { vale_desde?: DATE_ONLY, mudancas: [{ membro_id, cliente_id, ativo: boolean }] (1..200) }`.
  - `save_entregas { inicio: DATE_ONLY, membro_id, itens: [{ cliente_id, quantidade: number ≥ 0 | null }] (1..200) }`.
  - `fechar_periodo { inicio }`, `reabrir_periodo { inicio }`.
- [ ] **Step 1: Failing tests**: each tool calls its `_as` with `p_conta`/`p_user` from ctx and the mapped params; `save_acordo fills omitted keys with null and keeps arquivo_path`; `v2 off refuses before RPC`; `periodo_fechado maps to Portuguese message`.
- [ ] **Step 2–4.** **Step 5: Commit.**

### Task 7: Scopes and issuance (edge + CRM)

**Files:**
- Modify: `supabase/functions/_shared/mcp-token.ts` (`MCP_ALLOWED_SCOPES` + `export const OWNER_ONLY_SCOPES = ['financeiro:read','financeiro:write']`)
- Modify: `supabase/functions/mcp-keys/index.ts`, `supabase/functions/mcp-oauth-consent/index.ts`
- Modify: `apps/crm/src/lib/mcp-scopes.ts`, `apps/crm/src/pages/oauth/ConsentPage.tsx`, `apps/crm/src/pages/configuracao/mcp/IntegracoesClaudePage.tsx`, `apps/crm/src/pages/configuracao/mcp/IntegracoesClaudePhone.tsx`
- Modify: `CLAUDE.md` (the `mcp` bullet under Edge functions: financeiro scopes are owner-only; scope change = redeploy `mcp`, `mcp-keys`, `mcp-oauth-consent` + CRM)
- Test: `supabase/functions/__tests__/mcp-keys-authz_test.ts`, `mcp-oauth-consent-authz_test.ts` (extend); `apps/crm/src/lib/__tests__/mcp-scopes.test.ts`, `apps/crm/src/pages/oauth/__tests__/ConsentPage.test.tsx`, `apps/crm/src/pages/configuracao/mcp/__tests__/IntegracoesClaudePage.test.tsx` (extend)

**Interfaces:**
- CRM: `SCOPE_OPTIONS` gains `{ value: 'financeiro:read', label: 'Financeiro (leitura, só donos)', ownerOnly: true }` and `{ value: 'financeiro:write', label: 'Financeiro (escrita, só donos)', ownerOnly: true }`; other options get no `ownerOnly`. Not added to `AGENT_PRESET`. Pickers render owner-only options disabled with helper text `Somente o dono do workspace` when the user is not owner of the target workspace (ConsentPage: role from `eligible-workspaces` of the selected workspace; Integracoes pages: role from `useAuth`/membership as those pages already read it).
- Edge: `mcp-keys` create → if scopes intersect `OWNER_ONLY_SCOPES` and the caller's role in `contaId` is not `owner` → 400 `{ error: 'owner_only_scope' }`. `mcp-oauth-consent` grant save (workspace target) → same check on the chosen `conta_id`.
- [ ] **Step 1: Failing tests**: edge `admin creating key with financeiro:read → 400 owner_only_scope`, `owner → 200`; consent same; CRM `non-owner sees financeiro scopes disabled`, `owner can tick them`, `AGENT_PRESET has no financeiro scope`; `mcp-scopes mirror` test (existing) updated to the new list.
- [ ] **Step 2–4.** Run the four `tsc` projects, `npm run lint`, prettier on touched files, the touched Vitest files and Deno files. **Step 5: Commit.**

### Task 8: Final gates

- [ ] Run: four `tsc`, `npm run lint`, `npm run format:check`, `npm run test`, `npm run check:functions`, `npm run test:functions`, full entitlement script after `$SB db reset`. All green; `deno.lock` unchanged.
- [ ] Whole-branch review (most capable model), fix round, then commit.
