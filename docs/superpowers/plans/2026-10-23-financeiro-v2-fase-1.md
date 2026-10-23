# Financeiro v2, phase 1 (core): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Behind the `feature_financeiro_v2` flag, Mesaas computes per-client profitability from effective-dated client fees, team agreements (acordos) and member-to-client assignments, freezes each financial period as a snapshot, and shows it in Financeiro › Rentabilidade, an assignment matrix, Custos da equipe, the member's Acordo and the client's Financeiro tab.

**Architecture:** All money math lives in one Postgres function, `_financeiro_calcular(conta, inicio)`, with no auth calls so pg_cron can run it. A DEFINER wrapper RPC checks both flags plus financial visibility and either returns the stored snapshot (closed period) or the live result. Every write is a DEFINER RPC that stores an effective-dated version and writes the current value through to the legacy columns (`clientes.valor_mensal`, `membros.custo_mensal`, `data_pagamento`). An AFTER trigger turns legacy writes from old screens and the MCP into versions, compare-and-skip so the two never loop. The CRM is a thin client: one store module, nested routes under `/financeiro`, and save-per-toggle with a refetch, so allocation math is never duplicated in TypeScript.

**Tech Stack:** Postgres/plpgsql (Supabase), pg_cron, Supabase Storage (first private bucket), psql entitlement suites, React 19 + React Router v7 + TanStack Query, shadcn/ui, Vitest + Testing Library, Deno test.

**Spec:** `docs/superpowers/specs/2026-10-23-financeiro-rentabilidade-design.md`. Mockups: https://claude.ai/artifact/4UYPydavKfJwzVBMaT3UWv

**Scope:** spec phase 1 only. Phase 2 (mensalidade records, avulsos, fixed costs, Visão geral) and phase 3 (delivery helper) get their own plans. One deviation from the spec's phasing: `meta_margem` moves into phase 1, because the Rentabilidade screen's "Abaixo da meta" badge needs it. Also deferred to phase 2: moving the member page's transactions under a "Pagamentos" tab (cosmetic; the cards in Task 13 sit on the existing page).

## Global Constraints

- UI copy pt-BR, sentence case, **no em dash (—)** in visible text; use a period or colon. Toasts via `toast()` from `sonner`; icons `lucide-react` only.
- Money in the CRM is always rendered with `formatFinancialBRL(value, canSeeFinancials)` (`apps/crm/src/lib/financialAccess.ts`); it fails closed.
- Every v2 RPC: `SECURITY DEFINER`, `SET search_path = public, pg_temp`, workspace from `public.get_my_conta_id()`, every query filtered by that `conta_id`. First lines check, in this order: `effective_plan_feature(v_conta,'feature_financial')` → `RAISE EXCEPTION 'feature_disabled:feature_financial' USING ERRCODE='P0001'`; the same for `feature_financeiro_v2`; then `can_see_financials()` for reads or `has_permission('financeiro','editar')` for writes, else `RAISE EXCEPTION 'financial_access_denied' USING ERRCODE='42501'`. Grants: `REVOKE ALL ... FROM PUBLIC, anon` + `GRANT EXECUTE ... TO authenticated, service_role`. Internal functions (`_financeiro_*`, `financeiro_rolar_periodos`) are `REVOKE ALL ... FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE ... TO service_role` and are listed in `supabase/tests/entitlements/96_lockdown_definer_function_grants.sql`.
- New tables: `REVOKE ALL ... FROM PUBLIC, anon, authenticated`; `GRANT SELECT ... TO authenticated`; `GRANT ALL ... TO service_role`; sequences to `service_role` only. No INSERT/UPDATE/DELETE policies (writes only via RPC). Every SELECT policy, subselect form: `conta_id IN (SELECT public.get_my_conta_id()) AND (SELECT public.effective_plan_feature(conta_id,'feature_financial')) AND (SELECT public.effective_plan_feature(conta_id,'feature_financeiro_v2')) AND (SELECT public.can_see_financials())`.
- Tenant integrity: every reference to `clientes`, `membros` or a v2 table is a composite FK `(x_id, conta_id) REFERENCES t(id, conta_id)` (`clientes_id_conta_uq` and `membros_id_conta_uq` already exist). Every v2 table with an `id` gets `UNIQUE (id, conta_id)`.
- Period values, verbatim from the spec: `periodo_dia` 1 to 28, default 1; period length one month; labels `out 2026` (start day 1, full month) or `15 out a 14 nov`; periods close at 00:00 America/Sao_Paulo; transition period pro-rata = days in period ÷ days in the month starting at `inicio`. `meta_margem` default 55 (percent).
- Even split: a monthly member's `valor` ÷ number of their assigned **ativo** clients in the period. Assigned to zero active clients, or no função: the cost goes to `custo_sem_cliente`. Pausado: receita 0, margem `null`, out of every split. Encerrado: not listed, out of every split, assignments end at its `vale_desde`. Por entrega: `quantidade × valor` per client; no quantity → 0 plus `a_informar`.
- Snapshots embed `nome` for clientes, membros and funções, so a closed period renders after a deletion.
- Routing: `ProtectedRoute` (`startsWith`), `AppLayout` `FINANCIAL_PATHS` (prefix), `routePermissions.ts` (prefix) and `vercel.json` (`financeiro(/.*)?`) already cover `/financeiro/*`. Do not add entries.
- Query keys follow the short convention, no contaId: `['financeiro-v2', ...]`. Writes are async handlers with try/catch + `qc.invalidateQueries`, matching `FinanceiroPage.tsx`; on error call `handleEntitlementMutationError(e, profile?.conta_id ?? null)` before a generic `toast.error`.
- Migrations: prefixes from `20261025000001` upward, files `YYYYMMDDNNNNNN_snake_case.sql`, each starting `SET LOCAL lock_timeout = '5s';`. Right before `gh pr create`, renumber above `origin/main`'s newest prefix.
- Before each commit, `npx prettier --write` on the touched files only. Never `useBlocker`. Editors outside modals with unsaved state call `useUnsavedWork`.
- Pre-push gate: `npm run lint`, `npm run format:check`, the four `tsc` commands, `npm run test`, `npm run check:functions`, `npm run test:functions`. Entitlement suites run with `bash scripts/test-entitlements.sh` (needs Docker/colima locally; CI runs it regardless).

## Review Focus

1. **A legacy write while v2 is seeded** (old client form, CSV import, lead conversion, MCP `update_client`): it must become a version for the current period, and v2's own write-through must not create a duplicate version. Pinned in Task 6 (`legacy_update_creates_version`, `v2_write_through_no_loop`).
2. **Close job runs late, twice, or fails for one workspace**: periods close in order exactly once, and one workspace's error does not stop the others. Pinned in Task 7 (`rolar_late_closes_two_in_order`, `rolar_twice_noop`, `rolar_isolates_failures`).
3. **Viewer without financial visibility, or flag off, calls an RPC or selects a v2 table directly through PostgREST**: the RPC raises, the select returns zero rows. Pinned in Task 2 and Task 4.
4. **A member is unticked from their last client, or every member lacks a função**: no division by zero; the cost moves to `custo_sem_cliente` and totals still reconcile. Pinned in Task 4 (`zero_clients_goes_sem_cliente`, `all_sem_funcao`).
5. **"Vale a partir de" pointing at a closed period, or a cross-workspace member/client id**: rejected. Pinned in Task 5 (`closed_period_rejected`, `cross_tenant_rejected`).

---

## File structure

**Database** (`supabase/migrations/`)
- `20261025000001_feature_financeiro_v2.sql`: flag column.
- `20261025000002_financeiro_v2_schema.sql`: tables, RLS, grants.
- `20261025000003_financeiro_v2_calculo.sql`: period helpers, `_financeiro_calcular`, read RPCs.
- `20261025000004_financeiro_v2_escrita.sql`: write RPCs.
- `20261025000005_financeiro_v2_seed_legado.sql`: seed RPC, legacy triggers.
- `20261025000006_financeiro_v2_periodos_job.sql`: close job, reopen/close RPCs, cron.
- `20261025000007_financeiro_v2_arquivos.sql`: private bucket for contract files.

**Tests** (`supabase/tests/entitlements/`): `99_financeiro_v2_flag.sql`, `99_financeiro_v2_calculo.sql`, `99_financeiro_v2_escrita.sql`, `99_financeiro_v2_seed_legado.sql`, `99_financeiro_v2_periodos.sql`, `99_financeiro_v2_arquivos.sql`; edit `96_lockdown_definer_function_grants.sql`. Deno: `supabase/functions/__tests__/entitlements_feature_financeiro_v2_test.ts`.

**CRM** (`apps/crm/src/`)
- `store/financeiroV2.ts` (+ `store/index.ts` re-export): types and RPC wrappers.
- `hooks/useFinanceiroV2.ts`: flag hook.
- `pages/financeiro/v2/format.ts`: pure display helpers.
- `pages/financeiro/v2/FinanceiroGate.tsx`, `FinanceiroV2Layout.tsx`, `OnboardingCard.tsx`, `ConfigSheet.tsx`, `PeriodoSelect.tsx`.
- `pages/financeiro/v2/RentabilidadePage.tsx`, `RentabilidadeDetalhe.tsx`, `RentabilidadePhone.tsx`.
- `pages/financeiro/v2/AtribuicaoPage.tsx`.
- `pages/financeiro/v2/CustosEquipePage.tsx`.
- `pages/membro-detalhe/AcordoCard.tsx`, `AcordoDialog.tsx`, `EntregasManuaisCard.tsx`.
- `pages/cliente-detalhe/tabs/EquipeNoClienteCard.tsx`, `ClienteMensalidadeDialog.tsx`.
- Modify: `App.tsx`, `hooks/useWorkspaceLimits.ts`, `pages/membro-detalhe/MembroDetalhePage.tsx`, `pages/cliente-detalhe/tabs/FinanceiroTab.tsx`, `pages/cliente-detalhe/ClienteEditDialog.tsx`, `pages/equipe/MembroFormDialog.tsx`.

**Admin / functions**: `supabase/functions/_shared/entitlements.ts`, `apps/admin/src/lib/api.ts`, `apps/admin/src/pages/plan-form.ts` (only if a default needs listing; v2 stays off).

---

### Task 1: Feature flag plumbing

**Files:**
- Create: `supabase/migrations/20261025000001_feature_financeiro_v2.sql`, `supabase/tests/entitlements/99_financeiro_v2_flag.sql`, `supabase/functions/__tests__/entitlements_feature_financeiro_v2_test.ts`
- Modify: `supabase/functions/_shared/entitlements.ts` (`FEATURE_COLUMNS`), `apps/crm/src/hooks/useWorkspaceLimits.ts` (`FeatureFlags`), `apps/admin/src/lib/api.ts` (type at ~113, key list at ~264, label map at ~296)

**Interfaces:**
- Produces: plan column `feature_financeiro_v2 boolean NOT NULL DEFAULT false`; `FeatureFlags.feature_financeiro_v2?: boolean`; Admin label `'Financeiro v2 (rentabilidade)'`.

- [ ] **Step 1: Write the failing tests.** SQL suite `99_financeiro_v2_flag.sql` (skeleton of `99_hub_pauta_flag.sql`): assert the column exists as `boolean NOT NULL DEFAULT false`; `not exists (select 1 from plans where feature_financeiro_v2)`; `effective_plan_feature(ws,'feature_financeiro_v2')` is false without an override and true with `{"feature_financeiro_v2": true}`. Deno test copying `entitlements_feature_crm_vidro_test.ts`: `FEATURE_COLUMNS` includes `"feature_financeiro_v2"` and `resolveEntitlements` honours the override.
- [ ] **Step 2: Run them, expect FAIL.** `deno test supabase/functions/__tests__/entitlements_feature_financeiro_v2_test.ts` → missing key; `bash scripts/test-entitlements.sh` → column missing.
- [ ] **Step 3: Implement.** Migration with a header comment in the style of `20261017000001_feature_crm_vidro.sql`: born off on every plan, enabled per workspace via `workspace_plan_overrides.feature_overrides`; it **does** block writes (v2 RPCs raise without it); deploy order is this migration (staging then prod) → redeploy `workspace-limits`, `platform-admin`, `paywall-report` → merge → pilot override; it is a hard prerequisite of the `platform-admin` redeploy (Admin plan saves 400 without the column). Then `ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS feature_financeiro_v2 boolean NOT NULL DEFAULT false;`. Add the key to the three TS spots.
- [ ] **Step 4: Run the tests, expect PASS**, plus `npx tsc -p apps/admin/tsconfig.json --noEmit` and the CRM `tsc`.
- [ ] **Step 5: Commit** `feat(financeiro): feature_financeiro_v2 plan flag`.

### Task 2: Schema, RLS and grants

**Files:**
- Create: `supabase/migrations/20261025000002_financeiro_v2_schema.sql`
- Test: append to `supabase/tests/entitlements/99_financeiro_v2_flag.sql`

**Interfaces:** Produces these tables (all with `conta_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE`, `created_at timestamptz NOT NULL DEFAULT now()`):

| Table | Columns | Keys and checks |
|---|---|---|
| `financeiro_config` | `periodo_dia smallint NOT NULL DEFAULT 1`, `meta_margem numeric(5,2) NOT NULL DEFAULT 55`, `seeded_at timestamptz`, `updated_at timestamptz` | PK `conta_id`; `periodo_dia BETWEEN 1 AND 28`; `meta_margem BETWEEN 0 AND 100` |
| `financeiro_funcoes` | `id bigserial`, `nome text NOT NULL`, `ordem int NOT NULL DEFAULT 0` | `UNIQUE (id, conta_id)`; unique index `(conta_id, lower(nome))`; `length(trim(nome)) BETWEEN 1 AND 60` |
| `financeiro_cliente_versoes` | `id bigserial`, `cliente_id bigint NOT NULL`, `vale_desde date NOT NULL`, `valor_mensal numeric(12,2) NOT NULL`, `dia_pagamento smallint`, `status text NOT NULL`, `created_by uuid` | FK `(cliente_id, conta_id)` → clientes CASCADE; `UNIQUE (cliente_id, vale_desde)`; `valor_mensal >= 0`; `status IN ('ativo','pausado','encerrado')`; `dia_pagamento BETWEEN 1 AND 31` |
| `financeiro_acordo_versoes` | `id bigserial`, `membro_id bigint NOT NULL`, `vale_desde date NOT NULL`, `funcao_id bigint`, `modelo text NOT NULL`, `valor numeric(12,2) NOT NULL`, `unidade text`, `meta_quantidade int`, `meta_periodo text`, `limite_clientes int`, `dia_pagamento smallint`, `vigencia_inicio date`, `vigencia_fim date`, `arquivo_path text`, `created_by uuid` | FK `(membro_id, conta_id)` → membros CASCADE; FK `(funcao_id, conta_id)` → funcoes `ON DELETE SET NULL (funcao_id)`; `UNIQUE (membro_id, vale_desde)`; `modelo IN ('mensal_meta','mensal_limite','por_entrega')`; `meta_periodo IN ('dia_util','semana','mes')`; `valor >= 0`; `limite_clientes > 0`; `meta_quantidade > 0` |
| `financeiro_atribuicoes` | `id bigserial`, `membro_id bigint NOT NULL`, `cliente_id bigint NOT NULL`, `desde date NOT NULL`, `ate date` | composite FKs CASCADE; `ate IS NULL OR ate > desde`; partial unique index `(membro_id, cliente_id) WHERE ate IS NULL` |
| `financeiro_entregas_manuais` | `periodo_inicio date NOT NULL`, `membro_id bigint NOT NULL`, `cliente_id bigint NOT NULL`, `quantidade int NOT NULL` | PK `(membro_id, cliente_id, periodo_inicio)`; composite FKs CASCADE; `quantidade >= 0` |
| `financeiro_periodos` | `inicio date NOT NULL`, `fim date NOT NULL`, `status text NOT NULL DEFAULT 'aberto'`, `transicao boolean NOT NULL DEFAULT false`, `snapshot jsonb`, `fechado_em timestamptz` | PK `(conta_id, inicio)`; `fim > inicio`; `status IN ('aberto','fechado','reaberto')`; `status <> 'fechado' OR snapshot IS NOT NULL` |

Unit vocabulary (`unidade`) is free text in phase 1; the UI offers `arte`, `vídeo`, `gravação`, `post`.

- [ ] **Step 1: Write failing tests** in `99_financeiro_v2_flag.sql`: `select_zero_rows_when_flag_off` (owner, data inserted as service_role, override off → `select count(*) from financeiro_funcoes` = 0); `select_zero_rows_without_financials` (flag on, `workspace_members.can_see_financials = false` → 0); `select_visible_when_allowed` (flag on, owner → rows visible); `no_direct_insert` (authenticated insert raises `insufficient_privilege`); `cross_tenant_fk_rejected` (service_role insert of an atribuição whose `cliente_id` belongs to another workspace → `foreign_key_violation`). Use `et_grant_hosted_parity(array[<the seven tables>])` and mirror the grants explicitly.
- [ ] **Step 2: Run, expect FAIL** (tables missing).
- [ ] **Step 3: Implement the migration** per the table above, the Global Constraints SELECT policy on each table, the grants, and a closing `DO $$` that asserts the grants (as `20261005000001_agenda_eventos.sql` does).
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(financeiro): v2 schema with fail-closed RLS`.

### Task 3: Period helpers

**Files:**
- Create: first section of `supabase/migrations/20261025000003_financeiro_v2_calculo.sql`, `supabase/tests/entitlements/99_financeiro_v2_calculo.sql`

**Interfaces:** Produces (all `IMMUTABLE`, `LANGUAGE sql` or plpgsql, granted to `authenticated, service_role`):
- `financeiro_periodo_fim(p_inicio date, p_dia int) RETURNS date`: if `extract(day from p_inicio) = p_dia` then `p_inicio + 1 month`, else the first date after `p_inicio` whose day is `p_dia`.
- `financeiro_periodo_inicio_de(p_data date, p_dia int) RETURNS date`: the latest date `<= p_data` whose day is `p_dia`.
- `financeiro_periodo_rotulo(p_inicio date, p_fim date) RETURNS text`: `'out 2026'` when day 1 and `p_fim = p_inicio + 1 month`; otherwise `'15 out a 14 nov'` (last day is `p_fim - 1`). Month abbreviations `jan fev mar abr mai jun jul ago set out nov dez`; append the year to both sides only when the two dates fall in different years (`'15 dez 2026 a 14 jan 2027'`).
- `financeiro_periodo_fator(p_inicio date, p_fim date) RETURNS numeric`: `(p_fim - p_inicio) / ((p_inicio + 1 month) - p_inicio)`, which is 1 for a full period.

- [ ] **Step 1: Write failing tests:** `fim('2026-10-01',1) = '2026-11-01'`; `fim('2026-10-15',15) = '2026-11-15'`; `fim('2026-02-28',28) = '2026-03-28'`; transition `fim('2026-11-01',15) = '2026-11-15'`; `inicio_de('2026-10-10',15) = '2026-09-15'`; `inicio_de('2026-10-15',15) = '2026-10-15'`; `rotulo('2026-10-01','2026-11-01') = 'out 2026'`; `rotulo('2026-10-15','2026-11-15') = '15 out a 14 nov'`; `rotulo('2026-11-01','2026-11-15') = '1 nov a 14 nov'`; `rotulo('2026-12-15','2027-01-15') = '15 dez 2026 a 14 jan 2027'`; `fator('2026-10-01','2026-11-01') = 1`; `round(fator('2026-11-01','2026-11-15'),4) = round(14/30.0,4)`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement the four functions.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(financeiro): period helpers`.

### Task 4: Allocation core and read RPCs

**Files:**
- Modify: `supabase/migrations/20261025000003_financeiro_v2_calculo.sql` (append)
- Test: `supabase/tests/entitlements/99_financeiro_v2_calculo.sql`, `96_lockdown_definer_function_grants.sql`

**Interfaces:**
- Consumes: Task 2 tables, Task 3 helpers.
- Produces:
  - `_financeiro_calcular(p_conta uuid, p_inicio date) RETURNS jsonb`: internal, no auth calls. `fim`/`transicao` come from the `financeiro_periodos` row when one exists, else `financeiro_periodo_fim(p_inicio, config.periodo_dia)`. The effective version of anything at a period = the row with the greatest `vale_desde <= p_inicio`. An assignment is active when `desde <= p_inicio AND (ate IS NULL OR ate > p_inicio)`. Fees and monthly costs are multiplied by `financeiro_periodo_fator`. Money is rounded to 2 decimals per cell.
  - `financeiro_rentabilidade(p_inicio date DEFAULT NULL) RETURNS jsonb`: wrapper with the Global Constraints checks. Returns `{"seeded": false}` when `financeiro_config.seeded_at` is null. `p_inicio` null means the latest period whose status is not `fechado`, else the latest. A `fechado` period returns `snapshot`; otherwise `_financeiro_calcular`. A `p_inicio` that is neither an existing period row nor one of the projected starts from `financeiro_periodos_editaveis()` raises `RAISE EXCEPTION 'periodo_invalido' USING ERRCODE='P0001'` (test `rpc_invalid_period`).
  - `financeiro_periodos_listar() RETURNS jsonb`: `[{inicio, fim, rotulo, status, transicao}]` newest first.
  - `financeiro_periodos_editaveis() RETURNS jsonb`: same shape; every `reaberto` period, the current `aberto` one, and the next 2 projected starts (`status: 'futuro'`).
- **The JSON contract** (live result and snapshot alike; the CRM types in Task 8 mirror it exactly):

```json
{
  "seeded": true,
  "periodo": {"inicio": "2026-10-01", "fim": "2026-11-01", "rotulo": "out 2026", "status": "aberto", "transicao": false, "fator": 1},
  "meta_margem": 55,
  "funcoes": [{"id": 1, "nome": "Videomaker", "ordem": 0}],
  "clientes": [{
    "cliente_id": 9, "nome": "Talitha", "status": "ativo",
    "receita": 2500, "custo": 1180, "lucro": 1320, "margem": 0.528, "a_informar": false,
    "por_funcao": {"1": 550, "2": 260, "3": 210, "4": 160},
    "pessoas": [{"membro_id": 2, "nome": "Lia", "funcao_id": 1, "regra": "exclusivo", "valor": 550, "total": 550, "n_clientes": 1, "quantidade": null, "valor_unitario": null}]
  }],
  "membros": [{"membro_id": 3, "nome": "Ana", "funcao_id": 2, "modelo": "mensal_meta", "custo": 3900, "n_clientes": 15, "limite_clientes": null, "por_cliente": 260, "a_informar": false}],
  "totais": {"receita": 30600, "custo_clientes": 12310, "custo_sem_cliente": 0, "custo_total": 12310, "lucro": 18290, "margem": 0.5977, "por_funcao": {"1": 2860}},
  "incompleto": false
}
```

`regra` is one of `rateio | exclusivo | entrega`. `margem` is `null` when `receita = 0`. `lucro = receita - custo_total`. Clients listed are status `ativo` or `pausado`, ordered by `nome`; `encerrado` clients are omitted. Members listed: every member with an acordo version effective at the period. `incompleto` is true when any `a_informar` is true.

- [ ] **Step 1: Write failing tests.** Fixture `pg_temp.fixture_planilha(ws)`: funções Videomaker/Design/Edição de vídeo/Gestão de projetos/Copy; the spreadsheet's 15 clients and fees (Cinara 2000, Roberta 2000, Tyciana 1500, Gabriel 2100, Maria Paula 2000, Yasmin 2000, Vanessa 2200, Crícia 1500, Talitha 2500, Matheus 2000, Beatriz 2000, Marina 2000, Richelle 2200, Deborah 2300, Larissa 2300); members Caio Videomaker 2310, Lia Videomaker 550, Ana Design 3900, Bruno Edição 3150, Duda Gestão 2400 `mensal_limite` 20; everyone on every client, except Caio not on Talitha and Lia only on Talitha; one open period `2026-10-01`. Tests:
  - `planilha_talitha`: receita 2500, custo 1180, lucro 1320, `round(margem,3) = 0.528`, a `pessoas` entry for Lia with `regra = 'exclusivo'`.
  - `planilha_rateio`: Ana `por_cliente = 260`, `n_clientes = 15`; Caio `por_cliente = 165`, `n_clientes = 14`; Cinara `por_funcao` Design = 260, custo 795.
  - `planilha_totais`: receita 30600, custo_total 12310, lucro 18290.
  - `zero_clients_goes_sem_cliente`: end all of Bruno's assignments → `custo_sem_cliente = 3150`, `custo_total` unchanged, Cinara custo 585.
  - `all_sem_funcao`: null every acordo's `funcao_id` → every client custo 0, `custo_sem_cliente = 12310`, no error.
  - `pausado_excluded`: Tyciana pausado → receita 0, margem null, Ana `n_clientes = 14`, `por_cliente = 278.57`.
  - `por_entrega_a_informar`: Ana `por_entrega` valor 45, quantities only for Cinara (10) → Cinara Design 450, other clients Design 0 with `a_informar`, `incompleto = true`.
  - `transicao_prorata`: period row `2026-11-01`..`2026-11-15` with `transicao` → Talitha receita `round(2500*14/30,2)`.
  - `rpc_flag_off`: override off → `financeiro_rentabilidade()` raises `P0001:feature_disabled:feature_financeiro_v2`.
  - `rpc_no_financials`: `can_see_financials=false` → raises `42501:financial_access_denied`.
  - `rpc_unseeded`: no config row → `{"seeded": false}`.
  - `rpc_closed_returns_snapshot`: period `fechado` with snapshot `{"x":1}` → the RPC returns `{"x":1}`.
  Add `_financeiro_calcular` to `96_lockdown_definer_function_grants.sql`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `_financeiro_calcular` and the three RPCs.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(financeiro): allocation core and rentabilidade RPC`.

### Task 5: Write RPCs

**Files:**
- Create: `supabase/migrations/20261025000004_financeiro_v2_escrita.sql`
- Test: `supabase/tests/entitlements/99_financeiro_v2_escrita.sql`

**Interfaces:**
- Consumes: `financeiro_periodos_editaveis()` (validity of `vale_desde`).
- Produces (all return `void` unless noted, all with the write checks):
  - `_financeiro_sincronizar_legado(p_conta uuid, p_inicio date) RETURNS void` (internal): writes the versions effective at `p_inicio` into `clientes.valor_mensal`, `clientes.data_pagamento`, `clientes.status`, `membros.custo_mensal` (= `valor` for `mensal_*`, `NULL` for `por_entrega`) and `membros.data_pagamento`, updating only rows whose values differ.
  - `financeiro_config_salvar(p_periodo_dia int, p_meta_margem numeric)`: a new `periodo_dia` applies from the next period (Task 7 builds it); the current period's `fim` is untouched.
  - `financeiro_funcao_salvar(p_id bigint, p_nome text, p_ordem int) RETURNS bigint` (`p_id` null inserts), `financeiro_funcao_excluir(p_id bigint)`.
  - `financeiro_cliente_salvar(p_cliente_id bigint, p_vale_desde date, p_valor_mensal numeric, p_dia_pagamento int, p_status text)`: upserts the version on `(cliente_id, vale_desde)`. When `p_status = 'encerrado'`, open assignments get `ate = p_vale_desde`, and assignments with `desde >= p_vale_desde` are deleted. Then `_financeiro_sincronizar_legado(conta, current open inicio)`.
  - `financeiro_acordo_salvar(p_membro_id bigint, p_vale_desde date, p_acordo jsonb)`: keys `funcao_id, modelo, valor, unidade, meta_quantidade, meta_periodo, limite_clientes, dia_pagamento, vigencia_inicio, vigencia_fim, arquivo_path`. Upsert, then sync.
  - `financeiro_atribuicoes_salvar(p_vale_desde date, p_mudancas jsonb)`: `[{membro_id, cliente_id, ativo}]`. Ativo with no open interval inserts `desde = p_vale_desde`. Inativo with an open interval sets `ate = p_vale_desde`, or deletes the row when `desde = p_vale_desde`. All changes in one transaction.
  - `financeiro_entregas_salvar(p_inicio date, p_membro_id bigint, p_itens jsonb)`: `[{cliente_id, quantidade}]` upsert; `quantidade` null deletes.
  - Every function validates that `p_vale_desde` (or `p_inicio`) is one of `financeiro_periodos_editaveis()` → else `RAISE EXCEPTION 'periodo_fechado' USING ERRCODE='P0001'`. Every id is checked against `conta_id = v_conta` → else `RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'`.

- [ ] **Step 1: Write failing tests:**
  - `cliente_versao_and_legado`: save Talitha 2800 from the current period → version row exists and `clientes.valor_mensal = 2800`.
  - `future_version_no_legado_yet`: save from the next projected start → legacy still 2500 and `financeiro_rentabilidade(next)` shows 2800.
  - `closed_period_rejected`: `vale_desde` = a `fechado` period → `P0001:periodo_fechado`.
  - `cross_tenant_rejected`: a client id from another workspace → `P0002:not_found`.
  - `encerrado_ends_assignments`: encerrado from the current period → no assignment of that client active at the current inicio, and Ana `n_clientes` drops by 1.
  - `atribuicao_toggle_same_period_deletes`: on then off from the same `vale_desde` → no row left.
  - `atribuicao_toggle_later_sets_ate`: off from the next period → `ate` = next inicio and the current period is unchanged.
  - `acordo_por_entrega_legacy_null`: switch Ana to `por_entrega` → `membros.custo_mensal IS NULL`.
  - `write_requires_editar`: a member with `financeiro/ver` but not `editar` → `42501:financial_access_denied`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(financeiro): v2 write RPCs with effective dates`.

### Task 6: Seed and legacy triggers

**Files:**
- Create: `supabase/migrations/20261025000005_financeiro_v2_seed_legado.sql`
- Test: `supabase/tests/entitlements/99_financeiro_v2_seed_legado.sql`

**Interfaces:**
- Produces:
  - `financeiro_seed(p_periodo_dia int) RETURNS jsonb` → `{"seeded": true, "ja_existia": bool}`. It runs as one statement-level transaction, so it either fully applies or not at all. It is a no-op returning `ja_existia: true` when `seeded_at` is set. It creates: the config row; the five default funções (Videomaker, Design, Edição de vídeo, Copy, Gestão de projetos, `ordem` 0..4); for each client a version (`valor_mensal` = coalesce 0, `data_pagamento`, `status`); for each member an acordo `mensal_meta` with `valor` = coalesce(`custo_mensal`,0), `data_pagamento`, and `funcao_id` matched from `cargo` by exact equality of `_financeiro_normalizar(cargo) = _financeiro_normalizar(funcao.nome)`, or null. `_financeiro_normalizar(text) RETURNS text` (internal, IMMUTABLE) = `lower(trim(translate(x, 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')))`; the first period row (`inicio = financeiro_periodo_inicio_de(today in America/Sao_Paulo, p_dia)`, `fim = inicio + 1 month`). Every `vale_desde` is that `inicio`. No assignments are created.
  - Triggers `trg_financeiro_v2_clientes_legado` (AFTER INSERT OR UPDATE OF valor_mensal, data_pagamento, status ON clientes) and `trg_financeiro_v2_membros_legado` (AFTER INSERT OR UPDATE OF custo_mensal, data_pagamento ON membros). Function `_financeiro_v2_legado_trigger()`, DEFINER. When the workspace is seeded (whatever the flag), compare NEW against the version effective at the current open period; if any value differs, upsert a version at that period's `inicio` (for membros, keep the current acordo's other fields and change only `valor`/`dia_pagamento`; a new member gets a fresh `mensal_meta` acordo with `funcao_id` from `cargo`). Equal values do nothing: that is the loop guard.

- [ ] **Step 1: Write failing tests:** `seed_creates_everything` (counts and Talitha's version 2500); `seed_idempotent` (second call `ja_existia = true`, counts unchanged); `seed_matches_cargo` (`cargo = 'designer'` → no match → null; `'Design'` → Design; `'edição de vídeo'` → Edição de vídeo); `legacy_update_creates_version` (service_role `update clientes set valor_mensal = 2600` → a version at the current inicio with 2600); `legacy_insert_new_client` (new client after seed → version exists, status ativo); `v2_write_through_no_loop` (`financeiro_cliente_salvar` → exactly one version row for that `(cliente, vale_desde)` and no extra row); `unseeded_trigger_noop` (workspace without config → no version rows).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(financeiro): seed from existing data and legacy write capture`.

### Task 7: Period close job, reopen and close

**Files:**
- Create: `supabase/migrations/20261025000006_financeiro_v2_periodos_job.sql`
- Test: `supabase/tests/entitlements/99_financeiro_v2_periodos.sql`, `96_lockdown_definer_function_grants.sql`

**Interfaces:**
- Produces:
  - `financeiro_rolar_periodos(p_hoje date DEFAULT NULL) RETURNS void` (internal; `p_hoje` defaults to `(now() AT TIME ZONE 'America/Sao_Paulo')::date` and exists for tests). For each seeded workspace, inside its own `BEGIN ... EXCEPTION WHEN OTHERS` block (logs with `RAISE WARNING` and continues), loop: take the latest period; if `status = 'aberto'` and `p_hoje >= fim`, set `snapshot = _financeiro_calcular`, `status = 'fechado'`, `fechado_em = now()`. Whenever the latest period has ended, insert the next one: `inicio` = previous `fim`, `fim = financeiro_periodo_fim(inicio, config.periodo_dia)`, `transicao = extract(day from inicio) <> periodo_dia`. Then `_financeiro_sincronizar_legado(conta, new inicio)`. Repeat until the latest period has not ended. `reaberto` periods are never closed here.
  - `financeiro_periodo_reabrir(p_inicio date)`: write checks plus the caller's `workspace_members.role IN ('owner','admin')`, else `42501:financial_access_denied`. Allowed only from `fechado` → `reaberto`, keeping `snapshot` until re-close. Writes `audit_log(action 'financeiro-periodo-reabrir', resource_type 'financeiro_periodo', resource_id p_inicio::text)`.
  - `financeiro_periodo_fechar(p_inicio date)`: same role rule; only from `reaberto` → `fechado` with a fresh snapshot; audit action `'financeiro-periodo-fechar'`.
  - Cron: `cron.schedule('financeiro-v2-rolar-periodos', '<free minute> * * * *', $$SELECT public.financeiro_rolar_periodos()$$)`, using the unschedule-if-exists pattern from `20260925000031_schedule_tarefas_recorrentes_cron.sql`. Pick a minute no other job uses: check the table in `20260925110001_stagger_cron_schedules.sql` and every later `cron.schedule` in migrations.

- [ ] **Step 1: Write failing tests:**
  - `rolar_closes_and_opens_next`: `p_hoje = '2026-11-01'` → Oct `fechado` with Talitha in the snapshot, Nov `aberto`.
  - `rolar_twice_noop`: run again → still one Nov row and Oct `fechado_em` unchanged.
  - `rolar_late_closes_two_in_order`: start at Sep open, `p_hoje = '2026-11-02'` → Sep and Oct `fechado`, Nov `aberto`.
  - `rolar_applies_future_version`: a Talitha version from Nov → after the roll `clientes.valor_mensal` is the Nov value.
  - `rolar_transicao_after_day_change`: config 1 → 15 during Oct, roll at Nov 1 → Nov row `2026-11-01..2026-11-15` with `transicao`; roll at Nov 15 → `2026-11-15..2026-12-15` with no `transicao`.
  - `rolar_isolates_failures`: two seeded workspaces A and B; inside the test transaction add `ALTER TABLE financeiro_periodos ADD CONSTRAINT t_block CHECK (conta_id <> '<B>' OR status <> 'fechado') NOT VALID` → after the roll, B's period is still `aberto` and A's is `fechado` (the suite's final `rollback` drops the constraint).
  - `snapshot_keeps_names`: close Oct, delete Talitha → `financeiro_rentabilidade('2026-10-01')` still contains `"nome": "Talitha"`.
  - `reabrir_fechar_cycle`: reopen Oct as owner → `reaberto`; fix Ana's valor from Oct → Oct live recomputes; Nov (if `fechado`) keeps its snapshot; close Oct → fresh snapshot with the new value.
  - `reabrir_agent_denied`: role agent → `42501`.
  - `job_skips_reaberto`: reopen Oct, roll → Oct stays `reaberto`.
  Add `financeiro_rolar_periodos` to the lockdown suite.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(financeiro): automatic period close with snapshots`.

### Task 8: CRM store, types and helpers

**Files:**
- Create: `apps/crm/src/store/financeiroV2.ts`, `apps/crm/src/hooks/useFinanceiroV2.ts`, `apps/crm/src/pages/financeiro/v2/format.ts`
- Modify: `apps/crm/src/store/index.ts` (`export * from './financeiroV2'`)
- Test: `apps/crm/src/pages/financeiro/v2/__tests__/format.test.ts`, `apps/crm/src/store/__tests__/financeiroV2.test.ts`

**Interfaces:**
- Produces types mirroring Task 4's JSON exactly: `PeriodoFinanceiro`, `FuncaoFinanceira`, `PessoaRentabilidade`, `ClienteRentabilidade`, `MembroRentabilidade`, `TotaisRentabilidade`, `Rentabilidade = { seeded: true; periodo; meta_margem; funcoes; clientes; membros; totais; incompleto } | { seeded: false }`. Also `AcordoVersao` and `ClienteVersao` (row shapes from Task 2), `ModeloAcordo = 'mensal_meta' | 'mensal_limite' | 'por_entrega'`, `FinanceiroConfig`.
- Store functions, plain `async`, `if (error) throw error`:
  - `getRentabilidade(inicio?: string): Promise<Rentabilidade>`, `getPeriodos(): Promise<PeriodoFinanceiro[]>`, `getPeriodosEditaveis(): Promise<PeriodoFinanceiro[]>`
  - `getFinanceiroConfig(): Promise<FinanceiroConfig | null>`, `getFuncoes(): Promise<FuncaoFinanceira[]>`
  - `getAcordoVersoes(membroId: number): Promise<AcordoVersao[]>`, `getClienteVersoes(clienteId: number): Promise<ClienteVersao[]>`
  - `getEntregasManuais(inicio: string, membroId: number): Promise<{cliente_id: number; quantidade: number}[]>`
  - `seedFinanceiro(periodoDia: number)`, `salvarConfig(periodoDia: number, metaMargem: number)`, `salvarFuncao(id: number | null, nome: string, ordem: number): Promise<number>`, `excluirFuncao(id: number)`, `salvarCliente(clienteId, valeDesde, valorMensal, diaPagamento, status)`, `salvarAcordo(membroId, valeDesde, acordo: AcordoInput)`, `salvarAtribuicoes(valeDesde, mudancas: {membro_id: number; cliente_id: number; ativo: boolean}[])`, `salvarEntregas(inicio, membroId, itens: {cliente_id: number; quantidade: number | null}[])`, `reabrirPeriodo(inicio)`, `fecharPeriodo(inicio)`
- `useFinanceiroV2(): { ativo: boolean; isLoading: boolean }`: `ativo` = `features?.feature_financial !== false && features?.feature_financeiro_v2 === true`.
- Query keys: `['financeiro-v2','rentabilidade', inicio ?? 'atual']`, `['financeiro-v2','periodos']`, `['financeiro-v2','editaveis']`, `['financeiro-v2','config']`, `['financeiro-v2','funcoes']`, `['financeiro-v2','acordo', membroId]`, `['financeiro-v2','cliente', clienteId]`, `['financeiro-v2','entregas', inicio, membroId]`. After any write: `qc.invalidateQueries({ queryKey: ['financeiro-v2'] })`, plus `['clientes']` / `['membros']` when legacy values may change.
- `format.ts`:
  - `formatMargem(m: number | null): string` → `'52,8%'`, `null` → `'-'`.
  - `regraTexto(p: PessoaRentabilidade, access: FinancialAccess): string` → `'R$ 3.900,00 ÷ 15 clientes'` (rateio), `'Só este cliente: R$ 550,00 por mês'` (exclusivo), `'10 artes × R$ 45,00'` (entrega), `'A informar'` (entrega without quantity). Money goes through `formatFinancialBRL`.
  - `abaixoDaMeta(m: number | null, metaPct: number): boolean` → `m !== null && m * 100 < metaPct`.
  - `anualizar(v: number, anual: boolean): number`.

- [ ] **Step 1: Write failing tests:** format cases above, including `formatMargem(0.6025) === '60,3%'`, `abaixoDaMeta(0.47, 55) === true`, `abaixoDaMeta(null, 55) === false`, masked output when access is `false`. Store test: `getRentabilidade('2026-10-01')` calls `supabase.rpc('financeiro_rentabilidade', { p_inicio: '2026-10-01' })` and throws on error (mock `./core`).
- [ ] **Step 2: Run** `npx vitest run apps/crm/src/pages/financeiro/v2 apps/crm/src/store/__tests__/financeiroV2.test.ts`, **expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS**; CRM `tsc`.
- [ ] **Step 5: Commit** `feat(financeiro): v2 store, types and display helpers`.

### Task 9: Routing gate, layout, onboarding and settings

**Files:**
- Create: `pages/financeiro/v2/FinanceiroGate.tsx`, `FinanceiroV2Layout.tsx`, `OnboardingCard.tsx`, `ConfigSheet.tsx`, `PeriodoSelect.tsx`
- Modify: `apps/crm/src/App.tsx` (the `/financeiro` route at ~290)
- Test: `pages/financeiro/v2/__tests__/FinanceiroGate.test.tsx`, `OnboardingCard.test.tsx`

**Interfaces:**
- Routes: `<Route path="/financeiro" element={<FinanceiroGate />}>` with children `index`, `rentabilidade`, `equipe`, `atribuicao`, `lancamentos`.
  - Flag off: `index` renders today's `FinanceiroPage`, and any child path `<Navigate to="/financeiro" replace />`.
  - Flag on: `FinanceiroV2Layout` with an `<Outlet/>`. `index` → `<Navigate to="rentabilidade" replace />`; `lancamentos` renders `FinanceiroPage` unchanged.
  - While `useFinanceiroV2().isLoading`, render nothing (the AppLayout guard already shows loading).
- `FinanceiroV2Layout`: `<h1>Financeiro</h1>` (or `usePageToolbar`, like `FinanceiroPage`), a `NavLink` tab bar in the `ClienteDetalheNav` style with "Rentabilidade", "Custos da equipe", "Lançamentos" (`aria-current` on the active one), and a "Configurar" button that opens `ConfigSheet` for users with `financeiro/editar`. When `getRentabilidade()` returns `seeded: false`, render `OnboardingCard` in place of the Outlet, except on `lancamentos`.
- `OnboardingCard`: title "Montar o financeiro a partir dos dados atuais"; body "Vamos usar a mensalidade de cada cliente e o custo de cada pessoa da equipe. Nada é apagado."; a select "O período financeiro começa no dia" with 1..28, default 1; button "Montar a partir dos dados atuais" → `seedFinanceiro(dia)`, then invalidate `['financeiro-v2']`.
- `ConfigSheet` (shadcn `Sheet`): start day select (help "Vale a partir do próximo período"), meta de margem as an integer percent input, and the funções list (rename, reorder up/down, add, delete with an AlertDialog "Excluir função?" whose body says people with this função become "Sem função").
- `PeriodoSelect({ value, onChange, periodos })`: a shadcn `Select` of `rotulo`, with a "Fechado" badge for closed periods.

- [ ] **Step 1: Write failing tests:** `flag_off_renders_ledger` (mock `useFinanceiroV2` → `ativo: false`; `/financeiro` shows the existing page heading and `/financeiro/rentabilidade` redirects to it); `flag_on_redirects_to_rentabilidade`; `tabs_have_aria_current`; `unseeded_shows_onboarding`; `onboarding_calls_seed_with_day` (pick 15, click → `seedFinanceiro(15)`); `config_sheet_saves` (day 15, meta 60 → `salvarConfig(15, 60)`); `configurar_hidden_without_editar`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(financeiro): v2 routes, onboarding and settings`.

### Task 10: Rentabilidade page

**Files:**
- Create: `pages/financeiro/v2/RentabilidadePage.tsx`, `RentabilidadeDetalhe.tsx`, `RentabilidadePhone.tsx`
- Test: `pages/financeiro/v2/__tests__/RentabilidadePage.test.tsx`

**Interfaces:**
- Consumes: `getRentabilidade`, `getPeriodos`, `format.ts`, `PeriodoSelect`.
- Desktop (mockup board 1):
  - `StatCardGrid` with five `StatCard`s: "Receita recorrente" (sub `15 clientes · ARR R$ …`), "Custo da equipe" (sub `N pessoas · X% da receita`), "Lucro recorrente" (sub `LL anual R$ …`), "Margem média" (sub `Meta: 55%`), "Sem cliente" (shown only when `custo_sem_cliente > 0`, sub "Pessoas sem cliente ou sem função"). The phase 2 "Avulsos" card is not in this plan.
  - Toolbar: `PeriodoSelect`; segmented `Mensal | Anual` (two `<button aria-pressed>`) which multiplies the table's money columns by 12 and swaps the headers to ARR / Custo anual / LL anual; "Atribuir equipe" link to `atribuicao`; "Exportar CSV".
  - Table: Cliente, MRR, Custo mensal, Lucro, Margem, then one column per `funcoes[]` in `ordem`, under a group header "Custo por função". Sorted by margem ascending, nulls last. Pausado rows are greyed with a "Pausado" badge. Rows `abaixoDaMeta` show a warning `Badge` "Abaixo da meta". `a_informar` cells show "A informar". A totals footer row.
  - Clicking the client name (a `<button>`) selects it. `RentabilidadeDetalhe` shows Mensalidade/Custo/Lucro, a stacked bar "Para onde vai a mensalidade" (one segment per função + lucro, `role="img"` with an `aria-label` listing the percentages, plus a text legend), and "Quem atende este cliente" with `regraTexto` per pessoa and a "Função: ninguém atribuído" row for each função with zero cost.
  - Closed periods show a "Fechado" badge next to the selector. Owner/admin also get "Reabrir período", with an AlertDialog "Reabrir período?" whose body is "Os números deste período voltam a ser calculados até você fechar de novo." A reopened period shows "Fechar período".
  - When `incompleto`, an inline notice "Há entregas a informar neste período." links to `equipe`.
- Phone (`!useIsDesktop(768)`, as `FinanceiroPage` does): `RentabilidadePhone`, as mockup board 5: a three-cell summary, the Mensal/Anual segment, and a list of `<button>` rows with name, margin badge, lucro and a cost/profit bar.
- CSV: columns `Cliente;MRR;Custo;Lucro;Margem;<função…>` with pt-BR numbers, file `rentabilidade-<rotulo>.csv`, built from the rendered rows (honours Anual).

- [ ] **Step 1: Write failing tests** with a fixture equal to Task 4's spreadsheet result (money strings must match what `formatFinancialBRL` actually prints; adjust the literals below if it omits cents): `renders_kpis` ("R$ 30.600,00", "59,8%"); `sorted_by_margin_first_is_tyciana_or_cricia`; `talitha_abaixo_da_meta` (with meta 55); `anual_toggle_multiplies` (Talitha shows "R$ 30.000,00" and header "ARR"); `select_client_shows_regra` (click Talitha → "Só este cliente: R$ 550,00 por mês"); `masked_without_financials` (`canSeeFinancials: false` → no "R$ 2.500" text); `reabrir_visible_only_for_owner`; `phone_renders_list`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(financeiro): rentabilidade por cliente`.

### Task 11: Equipe por cliente matrix

**Files:**
- Create: `pages/financeiro/v2/AtribuicaoPage.tsx`
- Test: `pages/financeiro/v2/__tests__/AtribuicaoPage.test.tsx`

**Interfaces:**
- Consumes: `getPeriodosEditaveis`, `getRentabilidade(valeDesde)`, `salvarAtribuicoes`.
- Header copy: title "Equipe por cliente"; text "Marque quem atende cada cliente. O custo mensal de cada pessoa é dividido igualmente entre os clientes marcados." A select "Alterações valem a partir de" lists the editable periods (default the current one), with a help line "Os períodos seguintes já fechados não mudam" when a reopened period is chosen.
- Grid: rows are `clientes` (pausado rows disabled with a "Pausado" badge); columns are `membros` grouped under their função's name in `funcoes` order. Members without a função are not columns: a banner "N pessoas sem função não entram no rateio" lists them, each name linking to `/equipe/:id` where the Acordo sets the função. Each cell is a real `<input type="checkbox">` labelled "`<membro>` atende `<cliente>`", checked when the client's `pessoas` contains that `membro_id`.
- **Save per toggle**: on change, call `salvarAtribuicoes(valeDesde, [{membro_id, cliente_id, ativo}])` and invalidate `['financeiro-v2']`. Use an optimistic checked state until the refetch lands, and roll back with `toast.error('Não foi possível salvar')` on failure. There is no "Salvar" button; this replaces the mockup's.
- Column header: avatar, name, `formatFinancialBRL(custo)` "por mês", and a "Marcar todos" button that sends one `salvarAtribuicoes` with every active client for that member.
- Footer rows: "Clientes" (`n_clientes`, or `15 de 20` with a `Progress` for `mensal_limite`; over the limit adds a warning `Badge` "Acima do limite", with no block) and "Por cliente" (`por_cliente`, "-" when 0 clients). The right columns are the client's "Custo" and "Margem" from the refetched result.
- Phone: the same table in an `overflow-x: auto` box, with a sticky first column if the `overflow-x` trap allows it (see DESIGN_SYSTEM.md); otherwise plain.

- [ ] **Step 1: Write failing tests:** `checkbox_reflects_pessoas` (Caio unchecked for Talitha, Lia checked); `toggle_calls_rpc_once` (untick Ana/Cinara → `salvarAtribuicoes('2026-10-01', [{membro_id: 3, cliente_id: 1, ativo: false}])`); `toggle_failure_rolls_back`; `marcar_todos_sends_all_active`; `limite_badge_over_20`; `sem_funcao_banner`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(financeiro): equipe por cliente matrix`.

### Task 12: Custos da equipe page

**Files:**
- Create: `pages/financeiro/v2/CustosEquipePage.tsx`
- Test: `pages/financeiro/v2/__tests__/CustosEquipePage.test.tsx`

**Interfaces:**
- Consumes: `getRentabilidade`, `PeriodoSelect`.
- Table: Pessoa (link to `/equipe/:id`), Função (or a "Sem função" badge), Modelo ("Mensal com meta" | "Mensal com limite" | "Por entrega"), Custo no período, Clientes, Por cliente. Footer total = `totais.custo_total`. Por-entrega members with `a_informar` show "Entregas a informar" linking to their page.

- [ ] **Step 1: Write failing tests:** `lists_members_with_model_labels`; `total_matches_custo_total`; `sem_funcao_badge`; `a_informar_link`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(financeiro): custos da equipe`.

### Task 13: Member Acordo card, dialog and manual deliveries

**Files:**
- Create: `pages/membro-detalhe/AcordoCard.tsx`, `AcordoDialog.tsx`, `EntregasManuaisCard.tsx`
- Modify: `pages/membro-detalhe/MembroDetalhePage.tsx` (render the cards after the KPI grid when `useFinanceiroV2().ativo && canSeeFinancials === true`), `pages/equipe/MembroFormDialog.tsx`
- Test: `pages/membro-detalhe/__tests__/AcordoDialog.test.tsx`, `EntregasManuaisCard.test.tsx`, `pages/equipe/__tests__/MembroFormDialog.v2.test.tsx`

**Interfaces:**
- Consumes: `getAcordoVersoes`, `getFuncoes`, `getPeriodosEditaveis`, `getRentabilidade` (client list and shares), `getEntregasManuais`, `salvarAcordo`, `salvarEntregas`.
- `AcordoCard`: the current version (effective at the current period) shown as Função, Modelo, Valor, Dia de pagamento, Meta ("8 artes por dia útil, cerca de 176 por mês") or Limite ("até 20 clientes"), Vigência, Contrato (Task 15 wires the file); "Clientes atendidos" with each client's share from the member's `pessoas` entries; "Histórico" lists earlier versions as `vale_desde` label + valor. "Editar acordo" opens `AcordoDialog` (requires `financeiro/editar`).
- `AcordoDialog` (form with `react-hook-form` + `zod`, `DialogContent` with `confirmClose`):
  - Model cards "Como essa pessoa é paga?": `<button aria-pressed>` × 3 with titles "Mensal com meta" / "Mensal com limite" / "Por entrega" and the mockup's descriptions.
  - Fields by model: Função (select of `getFuncoes` + "Sem função"); valor (label "Valor mensal", or "Valor por entrega" for por entrega); dia de pagamento 1..31; for mensal_meta, meta quantidade + unidade (`arte|vídeo|gravação|post`) + período (`dia útil|semana|mês`) with a computed hint "Cerca de N por mês" (22 dias úteis, 4,3 semanas); for mensal_limite, limite de clientes; vigência início/fim.
  - "Vale a partir de" select (editable periods). zod: valor ≥ 0, limite > 0 when that model, meta > 0 when that model, `vigencia_fim >= vigencia_inicio`.
  - Submit → `salvarAcordo`, then invalidate `['financeiro-v2']` and `['membros']`.
- `EntregasManuaisCard` (only for `por_entrega`): a period select, then one row per assigned client with a numeric input "Entregas" and the computed amount; "Salvar entregas" → `salvarEntregas`. Copy: "Informe quantas entregas cada cliente recebeu neste período."
- `MembroFormDialog`: when v2 is active, hide `custo_mensal` and `data_pagamento` and show the line "O custo agora fica no acordo da pessoa." with a link to `/equipe/:id` (edit mode only).

- [ ] **Step 1: Write failing tests:** `model_switch_changes_fields` (Por entrega hides Limite and Meta, shows "Valor por entrega"); `meta_hint_176` (8 per dia útil → "Cerca de 176 por mês"); `submit_calls_salvarAcordo_with_payload`; `zod_rejects_limite_zero`; `entregas_save_payload` (quantity 10 for Cinara → `salvarEntregas(inicio, 3, [{cliente_id: 1, quantidade: 10}])`); `membro_form_hides_custo_when_v2`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(financeiro): acordo de trabalho do membro`.

### Task 14: Client Financeiro tab

**Files:**
- Create: `pages/cliente-detalhe/tabs/EquipeNoClienteCard.tsx`, `ClienteMensalidadeDialog.tsx`
- Modify: `pages/cliente-detalhe/tabs/FinanceiroTab.tsx`, `pages/cliente-detalhe/ClienteEditDialog.tsx`
- Test: `pages/cliente-detalhe/tabs/__tests__/EquipeNoClienteCard.test.tsx`, `ClienteMensalidadeDialog.test.tsx`, `pages/cliente-detalhe/__tests__/ClienteEditDialog.v2.test.tsx`

**Interfaces:**
- Consumes: `getRentabilidade`, `getClienteVersoes`, `getPeriodosEditaveis`, `salvarAtribuicoes`, `salvarCliente`.
- `FinanceiroTab` with v2 active: replace its KPIs with four `StatCard`s from this client's entry: "Mensalidade" (sub "Vence todo dia N"), "Custo da equipe" (sub "N pessoas atendem"), "Lucro mensal" (sub "LL anual …"), "Margem" (sub "Meta da agência: 55%"). Then `EquipeNoClienteCard`; the existing Contratos and Transações sections stay as they are. Flag off: the tab is unchanged.
- `EquipeNoClienteCard`: one row per função in order: avatar, name, `regraTexto`, a "Só este cliente" `Badge` when `regra = 'exclusivo'`, the value, and a "Trocar" select listing members of that função (choosing sends `[{old, ativo:false},{new, ativo:true}]` in one `salvarAtribuicoes` from the current period). A função with nobody gets "+ Escolher pessoa". Header total "Custo total".
- `ClienteMensalidadeDialog` (opened from the Mensalidade card, `financeiro/editar`): valor mensal, dia de pagamento, status (`Ativo | Pausado | Encerrado`), "Vale a partir de". Choosing Encerrado shows "As atribuições da equipe terminam neste período." Submit → `salvarCliente`.
- `ClienteEditDialog`: when v2 is active, hide `valor_mensal` / `data_pagamento` and show "A mensalidade agora fica na aba Financeiro." linking to `/clientes/:id/financeiro`.

- [ ] **Step 1: Write failing tests:** `rows_per_funcao_with_copy_empty` ("+ Escolher pessoa" under Copy); `trocar_sends_swap_in_one_call`; `exclusivo_badge_for_lia`; `mensalidade_dialog_encerrado_warning`; `mensalidade_submit_payload`; `edit_dialog_hides_valor_when_v2`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(financeiro): equipe e mensalidade na aba do cliente`.

### Task 15: Contract files (private bucket)

**Files:**
- Create: `supabase/migrations/20261025000007_financeiro_v2_arquivos.sql`, `supabase/tests/entitlements/99_financeiro_v2_arquivos.sql`
- Modify: `store/financeiroV2.ts` (add the two functions), `AcordoDialog.tsx`, `AcordoCard.tsx`
- Test: extend `AcordoDialog.test.tsx`

**Interfaces:**
- Bucket `financeiro-acordos`: `public = false`, `file_size_limit = 10485760`, `allowed_mime_types = '{application/pdf,image/png,image/jpeg}'`. This is the repo's first private bucket.
- Object path: `<conta_id>/<membro_id>/<uuid>.<ext>`.
- Policies on `storage.objects` for `bucket_id = 'financeiro-acordos'`:
  - SELECT: `(storage.foldername(name))[1]::uuid = get_my_conta_id() AND can_see_financials() AND effective_plan_feature(get_my_conta_id(),'feature_financeiro_v2')`.
  - INSERT: same, with `has_permission('financeiro','editar')` in place of `can_see_financials()`.
  - No UPDATE/DELETE: replacing uploads a new object, and the old acordo version keeps its `arquivo_path`.
- `uploadContratoAcordo(membroId: number, file: File): Promise<string>`: returns the path and is wrapped in `trackUnsavedWork`.
- `urlContratoAcordo(path: string): Promise<string>`: `createSignedUrl(path, 300)`.
- UI: the dialog's "Contrato assinado" field (upload / "Trocar arquivo") puts the path into `arquivo_path`. The card shows the file name with an "Abrir" button that opens the signed URL in a new tab. Over 10 MB or a wrong type: "Envie um PDF ou imagem de até 10 MB."

- [ ] **Step 1: Write failing tests:** SQL `owner_can_insert_and_read_own_prefix`, `other_workspace_prefix_denied`, `no_financials_read_denied`, `flag_off_denied` (insert into `storage.objects` as authenticated with `request.jwt.claims`); Vitest `rejects_large_file_with_message`, `upload_sets_arquivo_path`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(financeiro): contrato do acordo em bucket privado`.

### Task 16: Full verification and rollout notes

**Files:**
- Modify: `CLAUDE.md` (Gotchas: one bullet on Financeiro v2: legacy columns are written through, the triggers capture legacy writes, never edit `financeiro_*` tables directly, `financeiro_rolar_periodos` is the close job)

- [ ] **Step 1: Run the pre-push gate** from Global Constraints. All green; the entitlement suites print `PASS` for every `99_financeiro_v2_*` file.
- [ ] **Step 2: Browser check** with `npm run dev:env` and a workspace override on staging data (or the seed-login recipe): flag off, `/financeiro` is unchanged; flag on, run the onboarding, tick the matrix, see the margins move, open a client tab and a member Acordo, toggle dark mode, check phone width.
- [ ] **Step 3: Write the rollout order into the PR body:** migrations 1–7 to staging → redeploy `workspace-limits`, `platform-admin`, `paywall-report` → verify on staging with an override → migrations to prod → the same redeploys → merge (the frontend deploys on merge) → pilot override `{"feature_financeiro_v2": true}` for the owner's workspace.
- [ ] **Step 4: Commit** `docs: Financeiro v2 gotcha` and push. Before `gh pr create`, renumber migrations above `origin/main`'s newest prefix.
