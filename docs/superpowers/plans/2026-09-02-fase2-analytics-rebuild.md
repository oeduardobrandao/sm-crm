# Fase 2: Analytics de Fluxos rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give /analytics-fluxos correct numbers computed server-side (durable completion timestamp + one aggregate RPC) and rebuild the page as a weekly management report with deltas, URL state and export.

**Architecture:** Two migrations (durable `workflows.concluido_em` + `get_workflow_analytics` jsonb RPC, SECURITY INVOKER, entitlement-guarded), a typed service module, and a page rebuild in submodules consuming the RPC via TanStack Query + react-chartjs-2 + `chartTheme.ts` (Fase 1). Design source: `docs/superpowers/specs/2026-09-02-entregas-analytics-revamp-design.md` (Fase 2 section) + approved mockup `docs/superpowers/specs/assets/2026-09-02-mockup-analytics-fluxos.html` (the "Criados" series renders as a LINE in the real Chart.js combo; Retrabalho KPI and Aprovação do cliente section are Fase 3 — NOT in this plan).

**Tech Stack:** Postgres (Supabase migrations, psql entitlement tests), React 19 + TS, TanStack Query, react-chartjs-2, vitest.

## Global Constraints

- Migration version prefixes MUST be unique and greater than origin/main's tail (`20260902000021` at plan time): use `20260903000010` and `20260903000020`. RE-VERIFY the tail at PR-open time (`git ls-tree origin/main:supabase/migrations | tail`).
- The RPC NEVER selects from `membros` or `clientes` (column-grant allowlists, migration 20260728000002, would break SECURITY INVOKER). Return `membro_id`/`cliente_id`; the frontend resolves names from its caches.
- Multi-tenancy contract: one non-null workspace id from `get_my_conta_id()` (returns `uuid`, NULL when no active workspace), used for BOTH the entitlement check and as an explicit `conta_id` filter on every source relation that has one. `workflow_etapas` has no `conta_id` — reach it ONLY via JOIN on the already-filtered `workflows` CTE.
- Entitlement guard: `effective_plan_feature(conta_id, 'feature_analytics_reports')` (signature `(ws_id uuid, feature_key text) RETURNS boolean`, fail-closed). No entitlement or NULL conta → the RPC returns `NULL` jsonb; the service maps that to a typed `not_entitled` error.
- Grants: `GRANT EXECUTE ... TO authenticated` ONLY (pattern: footer of `supabase/migrations/20260625130000_client_health_aggregates.sql`). `SECURITY INVOKER`, `SET search_path = public`, `STABLE`.
- Timezone: canonical fixed `'America/Sao_Paulo'` (`p_tz` default; the service always passes the constant). America/Sao_Paulo has no DST since 2019, so day arithmetic is stable.
- Every completion metric requires `concluido_em ∈ [from, to)` AND (`status = 'concluido'` OR `status = 'arquivado' AND concluido_em IS NOT NULL`) — ruling from Task 2's review: archiving a finished flow must not shrink past numbers; never-concluded archived flows stay excluded (the Task 1 trigger guarantees concluido_em survives concluido→arquivado, is cleared on reopen, and never exists otherwise).
- Frontend: pt-BR copy, NO em-dashes in user-facing strings; no color literals outside `apps/crm/src/lib/chartTheme.ts`; `StatCard` (with `delta`/`invertDelta`) + `StatCardGrid` for KPIs; charts via react-chartjs-2 components (never raw `new Chart()` in useEffect); all derived data in `useMemo`.
- CSV export: UTF-8 BOM + formula neutralization (any text field starting with `=`, `+`, `-`, `@` gets a leading apostrophe).
- Tests colocated under `__tests__/`; SQL tests in `supabase/tests/entitlements/` (next free number: **73**), mirroring the harness conventions of the existing numbered suites (read `72_move_posts_between_flows.sql` and `_helpers.sql` first).
- Commit after each task; end each commit body with: Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

---

### Task 1: Migration A — durable `workflows.concluido_em`

**Files:**
- Create: `supabase/migrations/20260903000010_workflows_concluido_em.sql`
- Modify: `apps/crm/src/store/workflows.ts` (add `concluido_em?: string | null;` to the `Workflow` interface, after `etapa_atual`)

**Interfaces:**
- Produces: `workflows.concluido_em timestamptz` maintained by trigger; indexes used by Task 2's RPC.

- [ ] **Step 1: Write the migration** (full content):

```sql
-- Durable workflow completion timestamp.
-- Why: completion was reconstructed as max(workflow_etapas.concluido_em), which
-- revertEtapa/reopenWorkflow null out, and the period filter used created_at.
-- The trigger covers BOTH directions: -> 'concluido' stamps now();
-- 'concluido' -> 'ativo' (reopenWorkflow) clears it. 'concluido' -> 'arquivado'
-- keeps the stamp: archiving a finished flow does not un-finish it.

ALTER TABLE workflows ADD COLUMN IF NOT EXISTS concluido_em timestamptz;

CREATE OR REPLACE FUNCTION set_workflow_concluido_em()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF old.status IS DISTINCT FROM new.status THEN
    IF new.status = 'concluido' THEN
      new.concluido_em := now();
    ELSIF old.status = 'concluido' AND new.status = 'ativo' THEN
      new.concluido_em := NULL;
    END IF;
  END IF;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS workflows_set_concluido_em ON workflows;
CREATE TRIGGER workflows_set_concluido_em
  BEFORE UPDATE ON workflows
  FOR EACH ROW EXECUTE FUNCTION set_workflow_concluido_em();

-- Backfill: durable event wins over the lossy etapa timestamp.
-- suppress_workflow_events is belt-and-braces; the update trigger's watched
-- column list (20260826000001) does not include concluido_em, and the BEFORE
-- trigger above no-ops because status does not change.
SET LOCAL app.suppress_workflow_events = '1';
UPDATE workflows w
SET concluido_em = COALESCE(
  (SELECT max(ev.created_at) FROM workflow_events ev
    WHERE ev.workflow_id = w.id AND ev.event_type = 'fluxo_concluido'),
  (SELECT max(e.concluido_em) FROM workflow_etapas e WHERE e.workflow_id = w.id)
)
WHERE w.status = 'concluido' AND w.concluido_em IS NULL;

-- Workspace-wide indexes for the analytics RPC (and Fase 3's event feeds).
CREATE INDEX IF NOT EXISTS idx_workflows_conta_status_concluido
  ON workflows (conta_id, status, concluido_em);
CREATE INDEX IF NOT EXISTS idx_workflow_events_conta_created
  ON workflow_events (conta_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_post_status_events_conta_created
  ON post_status_events (conta_id, created_at);
```

- [ ] **Step 2: Sanity-check against the event triggers**

Read `supabase/migrations/20260826000001_workflow_events.sql`: confirm the `record_workflow_updated_event` watched-column list does NOT include `concluido_em` (do not add it), and confirm the suppression GUC name is exactly `app.suppress_workflow_events`. If either differs, adjust the migration to match reality and note it in your report.

- [ ] **Step 3: Add the column to the frontend type**

`apps/crm/src/store/workflows.ts`, `Workflow` interface: add `concluido_em?: string | null;`. No behavior change; `select('*')` already returns it once the migration applies.

- [ ] **Step 4: Verify + commit**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit` and `npx vitest run apps/crm/src/store` — PASS. Also run the migration-version-guard logic by hand: `ls supabase/migrations | grep -o '^[0-9]*' | sort | uniq -d` must print nothing.

```bash
git add supabase/migrations/20260903000010_workflows_concluido_em.sql apps/crm/src/store/workflows.ts
git commit -m "feat(analytics): workflows.concluido_em durável com trigger e backfill"
```

---

### Task 2: Migration B — deadline helpers + `get_workflow_analytics` RPC

**Files:**
- Create: `supabase/migrations/20260903000020_workflow_analytics_rpc.sql`

**Interfaces:**
- Consumes: `workflows.concluido_em` (Task 1), `get_my_conta_id()`, `effective_plan_feature(uuid, text)`.
- Produces (Task 4 consumes): `get_workflow_analytics(p_from timestamptz, p_to timestamptz, p_tz text, p_cliente_id bigint, p_template_id bigint, p_membro_id bigint) RETURNS jsonb` with the exact shape documented below; helpers `add_business_days(timestamptz, int, text)` and `etapa_deadline(date, timestamptz, int, text, text)`.

- [ ] **Step 1: Write the migration** (full content; the jsonb contract is binding for Task 4):

```sql
-- Deadline math mirrored from the frontend (getDeadlineInfo / etapaDeadlineDateOf):
-- data_limite wins and means "até o fim do dia local"; otherwise iniciado_em +
-- prazo_dias (dias úteis = seg-sex, sem feriados). Weekday checks use p_tz so a
-- 22h BRT start does not flip to the next UTC day.

CREATE OR REPLACE FUNCTION add_business_days(p_start timestamptz, p_days int, p_tz text)
RETURNS timestamptz
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  remaining int := p_days;
  cursor_ts timestamptz := p_start;
BEGIN
  WHILE remaining > 0 LOOP
    cursor_ts := cursor_ts + interval '1 day';
    IF extract(isodow FROM cursor_ts AT TIME ZONE p_tz) < 6 THEN
      remaining := remaining - 1;
    END IF;
  END LOOP;
  RETURN cursor_ts;
END;
$$;

CREATE OR REPLACE FUNCTION etapa_deadline(
  p_data_limite date,
  p_iniciado_em timestamptz,
  p_prazo_dias int,
  p_tipo_prazo text,
  p_tz text
) RETURNS timestamptz
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_data_limite IS NOT NULL
      THEN ((p_data_limite + 1)::timestamp AT TIME ZONE p_tz)
    WHEN p_iniciado_em IS NULL THEN NULL
    WHEN p_tipo_prazo = 'uteis'
      THEN add_business_days(p_iniciado_em, p_prazo_dias, p_tz)
    ELSE p_iniciado_em + make_interval(days => p_prazo_dias)
  END;
$$;

-- Workspace analytics aggregate. SECURITY INVOKER + explicit conta_id filter on
-- every relation that has one; workflow_etapas (no conta_id) only via the wf join.
-- Returns NULL when there is no active workspace or the plan lacks
-- feature_analytics_reports (fail-closed; the service maps NULL -> not_entitled).
CREATE OR REPLACE FUNCTION get_workflow_analytics(
  p_from timestamptz,
  p_to timestamptz,
  p_tz text DEFAULT 'America/Sao_Paulo',
  p_cliente_id bigint DEFAULT NULL,
  p_template_id bigint DEFAULT NULL,
  p_membro_id bigint DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
AS $$
WITH guard AS (
  SELECT c.conta_id
  FROM (SELECT get_my_conta_id() AS conta_id) c
  WHERE c.conta_id IS NOT NULL
    AND effective_plan_feature(c.conta_id, 'feature_analytics_reports')
),
wf AS (
  SELECT w.*
  FROM workflows w
  JOIN guard g ON w.conta_id = g.conta_id
  WHERE w.status <> 'arquivado'
    AND (p_cliente_id IS NULL OR w.cliente_id = p_cliente_id)
    AND (p_template_id IS NULL OR w.template_id = p_template_id)
),
concluidos AS (
  SELECT * FROM wf
  WHERE status = 'concluido' AND concluido_em >= p_from AND concluido_em < p_to
),
concluidos_prev AS (
  SELECT * FROM wf
  WHERE status = 'concluido'
    AND concluido_em >= p_from - (p_to - p_from) AND concluido_em < p_from
),
inicio AS (
  SELECT e.workflow_id, min(e.iniciado_em) AS iniciado_em
  FROM workflow_etapas e
  JOIN wf w ON w.id = e.workflow_id
  GROUP BY e.workflow_id
),
dur AS (
  SELECT extract(epoch FROM c.concluido_em - COALESCE(i.iniciado_em, c.created_at)) / 86400.0 AS dias
  FROM concluidos c LEFT JOIN inicio i ON i.workflow_id = c.id
),
dur_prev AS (
  SELECT extract(epoch FROM c.concluido_em - COALESCE(i.iniciado_em, c.created_at)) / 86400.0 AS dias
  FROM concluidos_prev c LEFT JOIN inicio i ON i.workflow_id = c.id
),
et_done AS (
  SELECT e.*,
         etapa_deadline(e.data_limite::date, e.iniciado_em, e.prazo_dias, e.tipo_prazo, p_tz) AS deadline
  FROM workflow_etapas e
  JOIN wf w ON w.id = e.workflow_id
  WHERE e.status = 'concluido'
    AND e.concluido_em >= p_from AND e.concluido_em < p_to
    AND (p_membro_id IS NULL OR e.responsavel_id = p_membro_id)
),
et_done_prev AS (
  SELECT e.*,
         etapa_deadline(e.data_limite::date, e.iniciado_em, e.prazo_dias, e.tipo_prazo, p_tz) AS deadline
  FROM workflow_etapas e
  JOIN wf w ON w.id = e.workflow_id
  WHERE e.status = 'concluido'
    AND e.concluido_em >= p_from - (p_to - p_from) AND e.concluido_em < p_from
    AND (p_membro_id IS NULL OR e.responsavel_id = p_membro_id)
),
etapas_agg AS (
  SELECT nome,
         avg(extract(epoch FROM concluido_em - iniciado_em) / 86400.0)
           FILTER (WHERE iniciado_em IS NOT NULL) AS media_dias,
         count(*) AS amostras,
         round(100.0 * count(*) FILTER (WHERE deadline IS NOT NULL AND concluido_em > deadline)
               / NULLIF(count(*) FILTER (WHERE deadline IS NOT NULL), 0)) AS atraso_pct
  FROM et_done
  GROUP BY nome
),
semanas AS (
  SELECT to_char(date_trunc('week', concluido_em AT TIME ZONE p_tz), 'YYYY-MM-DD') AS semana,
         count(*) AS concluidos
  FROM concluidos GROUP BY 1
),
semanas_criados AS (
  SELECT to_char(date_trunc('week', created_at AT TIME ZONE p_tz), 'YYYY-MM-DD') AS semana,
         count(*) AS criados
  FROM wf
  WHERE created_at >= p_from AND created_at < p_to
  GROUP BY 1
),
equipe AS (
  SELECT responsavel_id AS membro_id,
         count(*) AS concluidas,
         avg(extract(epoch FROM concluido_em - iniciado_em) / 86400.0)
           FILTER (WHERE iniciado_em IS NOT NULL) AS media_dias,
         count(*) FILTER (WHERE deadline IS NOT NULL AND concluido_em <= deadline) AS no_prazo,
         count(*) FILTER (WHERE deadline IS NOT NULL AND concluido_em > deadline) AS atrasadas,
         count(*) FILTER (WHERE deadline IS NOT NULL) AS avaliadas
  FROM et_done
  WHERE responsavel_id IS NOT NULL
  GROUP BY responsavel_id
)
SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM guard) THEN NULL ELSE jsonb_build_object(
  'kpis', jsonb_build_object(
    'concluidos',        (SELECT count(*) FROM concluidos),
    'concluidos_prev',   (SELECT count(*) FROM concluidos_prev),
    'ativos',            (SELECT count(*) FROM wf WHERE status = 'ativo'),
    'tempo_medio_dias',  (SELECT round(avg(dias)::numeric, 2) FROM dur),
    'tempo_medio_prev',  (SELECT round(avg(dias)::numeric, 2) FROM dur_prev),
    'pontualidade_pct',  (SELECT round(100.0 * count(*) FILTER (WHERE concluido_em <= deadline)
                                 / NULLIF(count(*) FILTER (WHERE deadline IS NOT NULL), 0))
                            FROM et_done),
    'pontualidade_prev', (SELECT round(100.0 * count(*) FILTER (WHERE concluido_em <= deadline)
                                 / NULLIF(count(*) FILTER (WHERE deadline IS NOT NULL), 0))
                            FROM et_done_prev),
    'etapas_avaliadas',  (SELECT count(*) FILTER (WHERE deadline IS NOT NULL) FROM et_done)
  ),
  'etapas', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'nome', nome,
                'media_dias', round(media_dias::numeric, 2),
                'amostras', amostras,
                'atraso_pct', atraso_pct)
              ORDER BY media_dias DESC NULLS LAST) FROM etapas_agg), '[]'::jsonb),
  'semanas', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'semana', s.semana,
                'concluidos', s.concluidos,
                'criados', COALESCE(sc.criados, 0))
              ORDER BY s.semana)
              FROM semanas s LEFT JOIN semanas_criados sc ON sc.semana = s.semana), '[]'::jsonb),
  'semanas_criados_sem_conclusao', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'semana', sc.semana, 'criados', sc.criados) ORDER BY sc.semana)
              FROM semanas_criados sc
              WHERE NOT EXISTS (SELECT 1 FROM semanas s WHERE s.semana = sc.semana)), '[]'::jsonb),
  'equipe', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                'membro_id', membro_id,
                'concluidas', concluidas,
                'media_dias', round(media_dias::numeric, 2),
                'no_prazo', no_prazo,
                'atrasadas', atrasadas,
                'avaliadas', avaliadas)
              ORDER BY concluidas DESC) FROM equipe), '[]'::jsonb)
) END;
$$;

GRANT EXECUTE ON FUNCTION get_workflow_analytics(timestamptz, timestamptz, text, bigint, bigint, bigint) TO authenticated;
```

- [ ] **Step 2: Lint the SQL mentally against the constraints**

Walk the checklist: no `membros`/`clientes` reads; every relation with `conta_id` filtered through `guard`; `workflow_etapas` only via `wf` join; NULL-safe divisions (`NULLIF`); `status='concluido' AND concluido_em` together everywhere. Fix anything that drifted while writing.

- [ ] **Step 3: Verify + commit**

`ls supabase/migrations | grep -o '^[0-9]*' | sort | uniq -d` → empty.

```bash
git add supabase/migrations/20260903000020_workflow_analytics_rpc.sql
git commit -m "feat(analytics): RPC get_workflow_analytics + helpers de prazo em SQL"
```

---

### Task 3: SQL tests — entitlement guard + deadline parity

**Files:**
- Create: `supabase/tests/entitlements/73_workflow_analytics.sql`

**Interfaces:**
- Consumes: the two migrations; the harness conventions of `supabase/tests/entitlements/_helpers.sql` and the most recent suite (`72_move_posts_between_flows.sql`) — READ BOTH FIRST and mirror their structure (how they create users/workspaces, set JWT claims, assert).

Coverage required:
1. **Entitlement fail-closed:** a workspace whose plan has `feature_analytics_reports = false` gets `NULL` from `get_workflow_analytics(now() - interval '30 days', now())`; a workspace with the feature true gets a non-NULL jsonb.
2. **Tenant isolation:** user A's call must not count user B's workflows (create one concluded workflow in each workspace; A's `kpis->>'concluidos'` = 1).
3. **Trigger behavior:** UPDATE a workflow to `concluido` → `concluido_em IS NOT NULL`; back to `ativo` → NULL again; to `concluido` then `arquivado` → timestamp preserved.
4. **Deadline parity with the frontend** (fixtures transcribed from `apps/crm/src/pages/entregas/__tests__/etapaPrazo.test.ts` — read it and pick 4 representative cases): data_limite date → end of local day (assert `etapa_deadline('2026-07-20', NULL, 3, 'corridos', 'America/Sao_Paulo') = '2026-07-21T00:00:00' AT TIME ZONE local`, i.e. `((date '2026-07-20' + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo')`); corridos → start + N days exact; uteis crossing a weekend (e.g. Friday start + 2 dias úteis lands Tuesday); NULL iniciado_em + NULL data_limite → NULL.
5. **Semanas key includes year:** a workflow concluded in a known week yields `semana` = that week's Monday as `YYYY-MM-DD`.

- [ ] **Step 1: Read the harness, write the suite** following the exact patterns of the newest existing test.
- [ ] **Step 2: Try to run locally**: `bash scripts/test-entitlements.sh` needs a local Supabase (Docker/colima; ports may be held by other worktrees). If the environment blocks it, do a careful static dry-run of the SQL (psql syntax check if possible) and state PROMINENTLY in your report that local execution was not possible and CI's `entitlement-tests` job is the gate.
- [ ] **Step 3: Commit**

```bash
git add supabase/tests/entitlements/73_workflow_analytics.sql
git commit -m "test(analytics): suite de entitlement e paridade de prazo do RPC"
```

---

### Task 4: service module `workflowAnalytics.ts`

**Files:**
- Create: `apps/crm/src/services/workflowAnalytics.ts`
- Create: `apps/crm/src/services/workflowAnalytics.test.ts` (services tests live flat in `services/`, see `analytics.test.ts`)

**Interfaces:**
- Consumes: the RPC jsonb contract from Task 2 (field names verbatim).
- Produces (Task 5 consumes):

```ts
export const ANALYTICS_TZ = 'America/Sao_Paulo';

export interface WorkflowAnalyticsKpis {
  concluidos: number; concluidos_prev: number; ativos: number;
  tempo_medio_dias: number | null; tempo_medio_prev: number | null;
  pontualidade_pct: number | null; pontualidade_prev: number | null;
  etapas_avaliadas: number;
}
export interface EtapaAgg { nome: string; media_dias: number | null; amostras: number; atraso_pct: number | null; }
export interface SemanaAgg { semana: string; concluidos: number; criados: number; }
export interface EquipeAgg { membro_id: number; concluidas: number; media_dias: number | null; no_prazo: number; atrasadas: number; avaliadas: number; }
export interface WorkflowAnalytics {
  kpis: WorkflowAnalyticsKpis;
  etapas: EtapaAgg[];
  semanas: SemanaAgg[];
  semanas_criados_sem_conclusao: { semana: string; criados: number }[];
  equipe: EquipeAgg[];
}
export class NotEntitledError extends Error {}

export interface WorkflowAnalyticsParams {
  from: Date; to: Date; clienteId?: number | null; templateId?: number | null; membroId?: number | null;
}
export async function getWorkflowAnalytics(params: WorkflowAnalyticsParams): Promise<WorkflowAnalytics>;
// calls supabase.rpc('get_workflow_analytics', { p_from: from.toISOString(), p_to: to.toISOString(),
//   p_tz: ANALYTICS_TZ, p_cliente_id: clienteId ?? null, p_template_id: templateId ?? null,
//   p_membro_id: membroId ?? null });
// throws on error; throws NotEntitledError when data === null.
```

- [ ] **Step 1: Write failing tests** (mock `supabase.rpc` the way `apps/crm/src/services/analytics.test.ts` mocks the client): (a) maps a full jsonb payload through unchanged; (b) `null` data → rejects with `NotEntitledError`; (c) supabase error → rejects; (d) params are converted to the exact `p_*` names with `ANALYTICS_TZ`.
- [ ] **Step 2: Implement, run** `npx vitest run apps/crm/src/services/workflowAnalytics.test.ts` — PASS.
- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/services/workflowAnalytics.ts apps/crm/src/services/workflowAnalytics.test.ts
git commit -m "feat(analytics): service tipado do RPC get_workflow_analytics"
```

---

### Task 5: page rebuild

**Files:**
- Rewrite: `apps/crm/src/pages/analytics-fluxos/AnalyticsFluxosPage.tsx` (shell only, target < 250 lines)
- Create: `apps/crm/src/pages/analytics-fluxos/useFluxosFilters.ts` (URL state)
- Create: `apps/crm/src/pages/analytics-fluxos/csv.ts` (export builder)
- Create: `apps/crm/src/pages/analytics-fluxos/sections/KpiRow.tsx`, `sections/RitmoChart.tsx`, `sections/GargalosTable.tsx`, `sections/EquipeTable.tsx`
- Create: `apps/crm/src/components/QueryErrorCard.tsx` (shared)
- Rewrite: `apps/crm/src/pages/analytics-fluxos/__tests__/AnalyticsFluxosPage.test.tsx` + new `__tests__/csv.test.ts`, `__tests__/useFluxosFilters.test.ts`
- Modify: `apps/crm/style.css` (only if a small `@media print` block is needed; hide `.sidebar`/topbar/toolbar buttons when printing this page)

**Interfaces:**
- Consumes: `getWorkflowAnalytics`/`NotEntitledError`/types (Task 4); `useIsDark`/`getChartTheme` (`@/lib/chartTheme`); `StatCard` (`delta`, `invertDelta`, `sub`) + `StatCardGrid`; `getClientes`/`getWorkflowTemplates`/`getMembros` (filter selects + name resolution ONLY — metric data comes exclusively from the RPC).
- **Deletes:** the whole client-side `computeMetrics` machinery and the page's use of `getAllEtapasWithWorkflow` (the store function itself is removed in Task 6).

**Page structure (mockup: `docs/superpowers/specs/assets/2026-09-02-mockup-analytics-fluxos.html`; Aprovação do cliente + Retrabalho are Fase 3 — do not build them):**

1. **Header**: h1 "Analytics de Fluxos"; caption `Fluxos concluídos no período` with `data-tooltip="O período filtra pela data de conclusão. Ativos são sempre o retrato atual."`; right-aligned `Exportar CSV` (Download icon) and `Imprimir` (Printer icon) outline buttons. `document.title = 'Analytics de Fluxos | Mesaas'` via useEffect.
2. **Toolbar**: period tabs `7d | 30d | 90d | Tudo` (role=tablist/tab/aria-selected) + the existing Cliente/Template selects moved into `useFluxosFilters`.
3. **KPI row** (`StatCardGrid maxCols={4}`): Concluídos (delta vs prev), Ativos agora (`sub: 'retrato atual'`, no delta), Tempo médio (formatted `Xd Yh` from `tempo_medio_dias`; delta with `invertDelta`), Pontualidade (`XX%` or `'Sem dados'` when null; delta only when both windows have samples). Delta = percent change computed client-side from the `_prev` fields; direction 'stable' when prev is 0/null.
4. **"Ritmo de entrega"** (full-width card): react-chartjs-2 combo — `Bar` dataset "Concluídos" (theme.semantic.success) + `line`-type dataset "Criados" (a categorical color from `getChartTheme`), labels from the union of `semanas` + `semanas_criados_sem_conclusao` sorted by `semana` key, label rendered pt-BR `dd/MM` with the year in the tooltip.
5. **"Gargalos por etapa"** (full-width card): ONE table (no chart duplicate): Etapa | Tempo médio (inline CSS bar, width % of max, plus `X,Xd` text) | Atraso (Badge: success ≤20, warning ≤50, danger otherwise) | Amostras. Top 10 + "Mostrar todas" toggle. Keep the existing mobile card fallback pattern (`fluxos-bottleneck-*` classes).
6. **"Desempenho da equipe"**: table Membro (resolved from `getMembros` cache by `membro_id`, avatar + nome; unknown id → "Membro removido") | Concluídas | Tempo médio | Pontualidade (`avaliadas < 3` → secondary Badge "Poucos dados" with tooltip "Menos de 3 etapas avaliadas no período"; else % badge success ≥80 / warning ≥50 / danger). Sorted by Concluídas desc.

**Behaviors:**
- `useFluxosFilters`: state in the URL (`?periodo=7d|30d|90d|tudo&cliente=<id>&template=<id>`), defaults omitted (periodo default `30d`); returns `{ periodo, clienteId, templateId, from, to, set... }` where `from`/`to` derive from `periodo` (`tudo` → from = new Date(2020, 0, 1)); memoized so the query key is stable.
- One `useQuery({ queryKey: ['workflow-analytics', periodo, clienteId, templateId], queryFn: () => getWorkflowAnalytics(...), placeholderData: keepPreviousData })`.
- Error states: `NotEntitledError` → the page's existing entitlement-gate UX (check how `ProtectedRoute` handles `feature_analytics_reports` — the route gate normally prevents this; render `QueryErrorCard` with a plan-upgrade message as fallback); other errors → `QueryErrorCard` ("Não foi possível carregar os dados." + "Tentar novamente" wired to `refetch`). Loading → skeletons preserving layout (`components/ui/skeleton.tsx`). Genuinely empty workspace (`kpis.concluidos === 0 && kpis.ativos === 0` with no filters) → existing empty-state copy; zero-match WITH filters → KPIs render zeros with `sub: 'nenhum fluxo no filtro'`.
- `QueryErrorCard` (shared component): card with `AlertTriangle` in `var(--danger-text)`, title "Não foi possível carregar os dados.", muted line "Verifique sua conexão e tente novamente.", `Button variant="outline"` "Tentar novamente" → `onRetry`.
- `csv.ts`: `buildAnalyticsCsv(data, membrosById): string` — sections for KPIs, Gargalos, Equipe; `;`-separated? NO: comma-separated, UTF-8 BOM prefix `﻿`, quote fields containing commas/quotes/newlines, and neutralize formulas (leading `=`, `+`, `-`, `@` → prefix `'`). Download via Blob + anchor click, filename `analytics-fluxos-{periodo}-{yyyy-MM-dd}.csv`. Imprimir = `window.print()`.
- Charts and tables get their data via `useMemo`. Canvas `role="img"` + aria-label pt-BR.

**Tests** (rewrite the page suite; mock `getWorkflowAnalytics` and the three list fetches):
- renders KPIs with deltas from a fixture payload (up + down + invertDelta case asserted via `data-good`);
- `Poucos dados` badge when `avaliadas < 3`;
- period tab click updates the URL param and refires the query with new dates;
- error → QueryErrorCard with working retry;
- csv.test.ts: BOM present, formula neutralization (`=SUM(A1)` → `'=SUM(A1)`), quoting;
- useFluxosFilters.test.ts: URL round-trip, defaults omitted.

- [ ] Implement with tests-first per section where practical; run `npx vitest run apps/crm/src/pages/analytics-fluxos apps/crm/src/components`; `npx tsc -p apps/crm/tsconfig.json --noEmit`.
- [ ] Commit:

```bash
git add apps/crm/src/pages/analytics-fluxos apps/crm/src/components/QueryErrorCard.tsx apps/crm/style.css
git commit -m "feat(analytics): rebuild do Analytics de Fluxos sobre o RPC (deltas, URL, export)"
```

---

### Task 6: retire `getAllEtapasWithWorkflow` + full gate

**Files:**
- Modify: `apps/crm/src/store/workflows.ts` (delete `getAllEtapasWithWorkflow`)
- Modify: `apps/crm/src/store/index.ts` or wherever it re-exports (grep `getAllEtapasWithWorkflow` across apps/)
- Modify/delete: any test that referenced it

- [ ] **Step 1:** `grep -rn "getAllEtapasWithWorkflow" apps/ packages/` — after Task 5 the only hits must be the store definition, its re-export and stale tests. Remove all. If ANY other live consumer appears, STOP and report BLOCKED.
- [ ] **Step 2: Full verification gate**

```bash
npm run lint
npm run format:check
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
ls supabase/migrations | grep -o '^[0-9]*' | sort | uniq -d   # must be empty
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor(store): aposenta getAllEtapasWithWorkflow (substituído pelo RPC)"
```

---

## Deploy notes (controller, not a task)

Order: staging `npx supabase db push --linked` (check `cat supabase/.temp/project-ref` first — worktrees start unlinked and the link FLIPS; STAGING=`wlyzhyfondykzpsiqsce`) BEFORE merging the frontend. Prod push at rollout after merge. The PR description must state this order. Browser verification against the dev server (porta 5174, CORS) with the E2E account happens after the final review, exercising: períodos, deltas, URL compartilhável, CSV baixado, estado de erro (offline), dark+light.
