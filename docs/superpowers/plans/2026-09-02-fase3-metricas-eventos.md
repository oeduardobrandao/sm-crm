# Fase 3: Métricas de eventos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the event-derived metrics to Analytics de Fluxos: client-approval latency (the headline), rework, member activity, agent-vs-human origin, per-source data horizon — plus the Fase 2 fast-follows (duration clamps, pontualidade delta base, print period echo).

**Architecture:** One migration (`CREATE OR REPLACE` of `get_workflow_analytics` extending the jsonb payload as a SUPERSET — every existing key unchanged) + service type extension + new/extended page sections. Ground truth pinned by recon (see the spec's Fase 3 section, updated 2026-09-02): status keys are canonical in `post_status_events.from_status/to_status` (customs normalize via `behaves_as`); cycle close classification uses `source='client' OR post_approval_id IS NOT NULL`; `workflow_events.source='client'` is NEVER written (do not filter on it); `metadata.voltou_de` is an etapa NAME (absent when no later etapa); every CRM status change writes `source='workspace_user'` events.

**Tech Stack:** Postgres (Supabase migration + psql test suite), React 19 + TS, react-chartjs-2, vitest.

## Global Constraints

- Migration prefix `20260903000030` (> the branch's `20260903000020`); RE-VERIFY origin/main's tail at PR-open (`git ls-tree origin/main:supabase/migrations | tail`) and the dup-prefix check must stay empty.
- The RPC redefinition is a strict SUPERSET: signature unchanged; every existing jsonb key/field byte-identical in name and semantics (Fase 2's service and tests keep passing untouched except where this plan explicitly extends them). After `CREATE OR REPLACE`, RE-RUN the grants triple (REVOKE ALL FROM PUBLIC / GRANT EXECUTE TO authenticated, service_role / REVOKE EXECUTE FROM anon) — the Supabase default-ACL gotcha re-applies on every replace.
- Tenancy: every new source relation filters `conta_id = guard.conta_id` explicitly; `workflow_etapas` and `workflow_posts` scope via joins to already-guarded CTEs. Never `SELECT *` from `membros`/`clientes`; the activity mapping may select ONLY `membros.id, membros.crm_user_id` and ONLY after Task 1 Step 0 verifies both columns are in the column-grant allowlist of migration `20260728000002` (if `crm_user_id` is NOT granted, return activity keyed by `actor_user_id` uuid instead and let the frontend map via its `membros` cache — decide by evidence, document which path was taken).
- Cycle algorithm exactly as the spec's refined version (open: `to_status='enviado_cliente' AND from IS DISTINCT FROM to`, in-window; close: first later same-post event `from_status='enviado_cliente' AND from IS DISTINCT FROM to`, searched WITHOUT p_to bound; classify pelo_cliente = `source='client' OR post_approval_id IS NOT NULL`).
- pt-BR copy, NO em-dashes; no color literals outside chartTheme.ts; charts role="img"; tests colocated; SQL suite number 74 (verify free).
- Commits per task; end each body with: Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>

---

### Task 1: Migration `20260903000030_workflow_analytics_events.sql`

**Files:**
- Create: `supabase/migrations/20260903000030_workflow_analytics_events.sql`

**Interfaces:**
- Consumes: the committed `20260903000020_workflow_analytics_rpc.sql` body (copy it as the base — it is the verified source of truth; do NOT retype from this plan).
- Produces (binding for Tasks 3-4): the extended jsonb contract:

```
kpis: (existing 8 fields) + retrabalho_pct int|null, retrabalho_prev int|null, etapas_avaliadas_prev int
horizonte: { workflow_events_since: timestamptz|null, post_events_since: timestamptz|null }   // min(created_at) per source for the conta, unwindowed
aprovacao_cliente: {
  mediana_horas: numeric|null, amostras: int, pendentes: int, resolvidos_internamente: int,
  buckets: [ {faixa: '<4h'|'4-24h'|'1-3d'|'3-7d'|'7d+', quantidade: int} ],   // ALWAYS all 5, in this order
  por_cliente: [ {cliente_id: bigint, mediana_horas: numeric|null, amostras: int, pendentes: int} ],  // ORDER BY mediana_horas DESC NULLS LAST
  etapas: { amostras: int, mediana_horas: numeric|null }    // complemento: fluxos SEM posts
}
origem: [ {origem: text, concluidos: int, tempo_medio_dias: numeric|null} ]   // group concluidos by created_via
etapas[]: + retrabalho_pct int|null
equipe[]: + retrabalho int, atividade int
```

- [ ] **Step 0: Evidence checks (write findings in the migration's header comment)**
1. `grep -n "crm_user_id\|user_id" supabase/migrations/20260728000002_financial_visibility_b_enforcement.sql` — is `crm_user_id` (and `id`) in the membros column GRANT? Decide the activity-mapping path per the Global Constraint.
2. Confirm which membros column holds the auth uuid: grep how `crm_user_id` is populated (invites/team migrations, `p_crm_user_id` RPC in `store/team.ts:67`) vs `user_id`. The activity join must use the column that equals `auth.uid()` = `workflow_events.actor_user_id`.
3. Check the index on `post_status_events(post_id, created_at)` exists (migration 20260606000001); if absent, ADD it in this migration (the close-LATERAL depends on it).
4. `ls supabase/tests/entitlements/` — next free suite number (expect 74).

- [ ] **Step 1: Write the migration**

Start from the FULL committed body of `get_workflow_analytics` in `20260903000020` and apply exactly these edits:

(a) **Clamps (Fase 2 fast-follow):** wrap the four duration expressions in `GREATEST(0, ...)`: `dur`/`dur_prev` (`extract(epoch FROM ...) / 86400.0`) and the two `avg(extract(epoch FROM concluido_em - iniciado_em) / 86400.0)` sites (`etapas_agg`, `equipe`).

(b) **`etapas_avaliadas_prev`:** add to `kpis`: `(SELECT count(*) FILTER (WHERE deadline IS NOT NULL) FROM et_done_prev)`.

(c) **New CTEs**, appended after `equipe` (all inside the same WITH; `guard`/`wf` already exist):

```sql
pse AS (  -- eventos de status de post com transição real, no escopo do tenant e dos filtros
  SELECT e.id, e.post_id, e.conta_id, e.created_at, e.from_status, e.to_status,
         e.source, e.post_approval_id, p.cliente_id, p.workflow_id
  FROM post_status_events e
  JOIN guard g ON e.conta_id = g.conta_id
  JOIN workflow_posts p ON p.id = e.post_id
  WHERE e.from_status IS DISTINCT FROM e.to_status
    AND (p_cliente_id IS NULL OR p.cliente_id = p_cliente_id)
    AND (p_template_id IS NULL OR (p.workflow_id IS NOT NULL AND p.workflow_id IN (SELECT id FROM wf)))
),
ciclos AS (  -- um ciclo por envio ao cliente aberto na janela; fechamento buscado SEM limite de p_to
  SELECT env.post_id, env.cliente_id, env.created_at AS enviado_em,
         fech.created_at AS fechado_em,
         (fech.source = 'client' OR fech.post_approval_id IS NOT NULL) AS pelo_cliente
  FROM pse env
  LEFT JOIN LATERAL (
    SELECT f.created_at, f.source, f.post_approval_id
    FROM post_status_events f
    WHERE f.conta_id = env.conta_id
      AND f.post_id = env.post_id
      AND f.created_at > env.created_at
      AND f.from_status = 'enviado_cliente'
      AND f.from_status IS DISTINCT FROM f.to_status
    ORDER BY f.created_at ASC
    LIMIT 1
  ) fech ON true
  WHERE env.to_status = 'enviado_cliente'
    AND env.created_at >= p_from AND env.created_at < p_to
),
latencias AS (  -- só ciclos fechados PELO CLIENTE entram na distribuição
  SELECT cliente_id,
         GREATEST(0, extract(epoch FROM fechado_em - enviado_em)) / 3600.0 AS horas
  FROM ciclos WHERE fechado_em IS NOT NULL AND pelo_cliente
),
aprov_etapas AS (  -- complemento: fluxos sem nenhum post
  SELECT GREATEST(0, extract(epoch FROM e.concluido_em - e.iniciado_em)) / 3600.0 AS horas
  FROM workflow_etapas e
  JOIN wf w ON w.id = e.workflow_id
  WHERE e.tipo = 'aprovacao_cliente' AND e.status = 'concluido'
    AND e.iniciado_em IS NOT NULL
    AND e.concluido_em >= p_from AND e.concluido_em < p_to
    AND NOT EXISTS (SELECT 1 FROM workflow_posts p WHERE p.workflow_id = e.workflow_id)
),
ev_win AS (
  SELECT ev.* FROM workflow_events ev
  JOIN guard g ON ev.conta_id = g.conta_id
  WHERE ev.created_at >= p_from AND ev.created_at < p_to
    AND ev.workflow_id IN (SELECT id FROM wf)
),
ev_prev AS (
  SELECT ev.* FROM workflow_events ev
  JOIN guard g ON ev.conta_id = g.conta_id
  WHERE ev.created_at >= p_from - (p_to - p_from) AND ev.created_at < p_from
    AND ev.workflow_id IN (SELECT id FROM wf)
),
retrab_etapa AS (  -- atribuído à etapa que DEVOLVEU (voltou_de), fallback etapa do evento
  SELECT COALESCE(r.metadata->>'voltou_de', r.etapa_nome) AS nome,
         count(*) AS reverts
  FROM ev_win r WHERE r.event_type = 'etapa_revertida'
  GROUP BY 1
),
conclu_etapa AS (
  SELECT etapa_nome AS nome, count(*) AS conclusoes
  FROM ev_win WHERE event_type = 'etapa_concluida'
  GROUP BY 1
),
retrab_membro AS (
  SELECT et.responsavel_id AS membro_id, count(*) AS retrabalho
  FROM ev_win r
  JOIN workflow_etapas et ON et.id = (r.metadata->>'voltou_de_etapa_id')::bigint
  WHERE r.event_type = 'etapa_revertida' AND r.metadata ? 'voltou_de_etapa_id'
    AND et.responsavel_id IS NOT NULL
  GROUP BY et.responsavel_id
),
atividade AS (  -- Step 0 decide: via membros(id, crm_user_id) OU keyed por actor_user_id
  SELECT m.id AS membro_id, count(*) AS atividade
  FROM ev_win e
  JOIN membros m ON m.crm_user_id = e.actor_user_id
  WHERE e.event_type IN ('etapa_iniciada', 'etapa_concluida') AND e.actor_user_id IS NOT NULL
  GROUP BY m.id
),
origem_agg AS (
  SELECT c.created_via AS origem, count(*) AS concluidos,
         round(avg(GREATEST(0, extract(epoch FROM c.concluido_em - COALESCE(i.iniciado_em, c.created_at))) / 86400.0)::numeric, 2) AS tempo_medio_dias
  FROM concluidos c LEFT JOIN inicio i ON i.workflow_id = c.id
  GROUP BY c.created_via
)
```

(d) **jsonb tail additions** (inside the existing `jsonb_build_object`, keeping every current key):

```sql
'horizonte', jsonb_build_object(
  'workflow_events_since', (SELECT min(ev.created_at) FROM workflow_events ev JOIN guard g ON ev.conta_id = g.conta_id),
  'post_events_since',     (SELECT min(pe.created_at) FROM post_status_events pe JOIN guard g ON pe.conta_id = g.conta_id)
),
'aprovacao_cliente', jsonb_build_object(
  'mediana_horas', (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY horas)::numeric, 1) FROM latencias),
  'amostras', (SELECT count(*) FROM latencias),
  'pendentes', (SELECT count(*) FROM ciclos WHERE fechado_em IS NULL),
  'resolvidos_internamente', (SELECT count(*) FROM ciclos WHERE fechado_em IS NOT NULL AND NOT pelo_cliente),
  'buckets', (SELECT jsonb_agg(jsonb_build_object('faixa', b.faixa, 'quantidade',
                (SELECT count(*) FROM latencias l WHERE l.horas >= b.lo AND (b.hi IS NULL OR l.horas < b.hi))) ORDER BY b.ord)
              FROM (VALUES ('<4h', 0.0, 4.0, 1), ('4-24h', 4.0, 24.0, 2), ('1-3d', 24.0, 72.0, 3),
                           ('3-7d', 72.0, 168.0, 4), ('7d+', 168.0, NULL::float8, 5)) AS b(faixa, lo, hi, ord)),
  'por_cliente', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                    'cliente_id', s.cliente_id, 'mediana_horas', s.mediana, 'amostras', s.amostras, 'pendentes', s.pendentes)
                  ORDER BY s.mediana DESC NULLS LAST)
                  FROM (SELECT c.cliente_id,
                               round(percentile_cont(0.5) WITHIN GROUP (ORDER BY l.horas)::numeric, 1) AS mediana,
                               count(l.horas) AS amostras,
                               count(*) FILTER (WHERE c.fechado_em IS NULL) AS pendentes
                        FROM ciclos c LEFT JOIN latencias l ON false  -- placeholder: see note below
                        GROUP BY c.cliente_id) s), '[]'::jsonb),
  'etapas', jsonb_build_object(
    'amostras', (SELECT count(*) FROM aprov_etapas),
    'mediana_horas', (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY horas)::numeric, 1) FROM aprov_etapas))
),
'origem', COALESCE((SELECT jsonb_agg(jsonb_build_object('origem', origem, 'concluidos', concluidos,
              'tempo_medio_dias', tempo_medio_dias) ORDER BY concluidos DESC) FROM origem_agg), '[]'::jsonb)
```

**NOTE on `por_cliente` (the one place this plan does not hand you final SQL):** the sketch above marks a placeholder — compute per-cliente stats from ONE pass over `ciclos`: mediana over `GREATEST(0, extract(epoch FROM fechado_em - enviado_em))/3600.0` FILTERED to `fechado_em IS NOT NULL AND pelo_cliente` (use `percentile_cont(0.5) WITHIN GROUP (ORDER BY ...) FILTER (WHERE ...)`), `amostras` = same filter count, `pendentes` = `count(*) FILTER (WHERE fechado_em IS NULL)`. Write it cleanly; do not join `latencias`.

Also extend the existing keys:
- `kpis` + `'retrabalho_pct', (SELECT round(100.0 * count(DISTINCT workflow_id) FILTER (WHERE event_type='etapa_revertida') / NULLIF(count(DISTINCT workflow_id), 0)) FROM ev_win)` and `'retrabalho_prev'` (same over `ev_prev`), + `etapas_avaliadas_prev` from (b).
- `etapas` array: each element gains `'retrabalho_pct', <round(100.0 * re.reverts / NULLIF(ce.conclusoes, 0)) via LEFT JOINs of etapas_agg to retrab_etapa/conclu_etapa by nome>` (null when no conclusions in window).
- `equipe` array: each element gains `'retrabalho', COALESCE(rm.retrabalho, 0)` and `'atividade', COALESCE(at.atividade, 0)` via LEFT JOINs by membro_id.

(e) Close with the grants triple re-run for `get_workflow_analytics` (copy the three lines + their comment from 20260903000020).

- [ ] **Step 2: Execute in a scratch Postgres** (the Task 2/Fase 2 method: stand-in schema + both prior migrations + this one): verify (1) cycle open/close/classify against a hand-built fixture set covering: repeat send (from=to filtered), close by client, close by workspace_user (resolvido internamente), never closed (pendente), custom-status event with from=to (ignored), re-send after correction (2 cycles); (2) buckets always 5; (3) retrabalho attribution to voltou_de with fallback; (4) horizonte min per source; (5) every EXISTING field byte-identical for a fixture that exercised Fase 2 (superset check).
- [ ] **Step 3: dup-prefix check empty; commit** `feat(analytics): métricas de eventos no RPC (aprovação do cliente, retrabalho, origem, horizonte)`.

---

### Task 2: SQL suite `74_workflow_analytics_events.sql`

**Files:** Create `supabase/tests/entitlements/74_workflow_analytics_events.sql` (mirror suite 73's harness conventions).

Coverage (each a real, mutation-catchable assertion):
1. Cycle pairing end-to-end through the REAL trigger: drive `workflow_posts.status` updates as different actors (JWT user → workspace_user; `record_client_approval` path or `set_config('app.event_source','client')` + approval row → client) and assert mediana/amostras/pendentes/resolvidos_internamente.
2. from=to events (custom-only moves) do not open cycles.
3. Re-send after correction yields 2 cycles.
4. `aprovacao_cliente.etapas` counts only post-less workflows.
5. Retrabalho: revert with a later etapa → attributed to `voltou_de` name; revert of the last etapa (no metadata) → falls back to event's etapa_nome; kpis.retrabalho_pct math.
6. `horizonte` per-source minima; tenant-isolated.
7. Superset: every Fase 2 field still present and correct on the same fixtures (spot-check kpis + etapas + equipe).
8. Grants still locked after CREATE OR REPLACE (`has_function_privilege('anon', ...)` false).

Execute at the same level as suite 73 (scratch DB with the three migrations); commit `test(analytics): suite 74 das métricas de eventos`.

---

### Task 3: service extension

**Files:** Modify `apps/crm/src/services/workflowAnalytics.ts` + its test.

Add interfaces mirroring the new contract verbatim (`WorkflowAnalyticsHorizonte`, `AprovacaoCliente` with `buckets: {faixa, quantidade}[]` / `por_cliente: {cliente_id, mediana_horas, amostras, pendentes}[]` / `etapas: {amostras, mediana_horas}`, `OrigemAgg`, extend `WorkflowAnalyticsKpis`/`EtapaAgg`/`EquipeAgg`). Extend the pass-through test fixture; existing tests untouched. Commit `feat(analytics): tipos das métricas de eventos no service`.

---

### Task 4: page sections

**Files:**
- Create: `apps/crm/src/pages/analytics-fluxos/sections/AprovacaoSection.tsx` (+ test)
- Create: `apps/crm/src/pages/analytics-fluxos/sections/OrigemCard.tsx` (small; may live inside AprovacaoSection's row — implementer's layout call, mockup governs)
- Modify: `KpiRow.tsx` (5th card Retrabalho, `StatCardGrid maxCols={5}`, delta from retrabalho_prev with `invertDelta` — LESS rework is good; pontualidade delta upgraded to pp using etapas_avaliadas_prev per format.ts helper), `GargalosTable.tsx` (+ coluna Retrabalho, null → "·"), `EquipeTable.tsx` (+ colunas Retrabalho e Atividade), `AnalyticsFluxosPage.tsx` (mount sections; horizon captions), `csv.ts` (new sections in the export), `format.ts` (helpers: formatHoras — "1d 4h" from hours; pp delta builder), `useFluxosFilters` untouched.
- Print echo (Fase 2 fast-follow): a print-only line under the header showing `Período: {periodo} · Cliente: {nome|todos} · Template: {nome|todos}` (hidden on screen via the existing scoped print block's inverse — add a `.print-only` rule inside `body:has(.analytics-fluxos-page)` media print).

**AprovacaoSection** (mockup `docs/superpowers/specs/assets/2026-09-02-mockup-analytics-fluxos.html`, seção "Tempo de resposta do cliente" + "Clientes mais lentos para aprovar"): two-card grid; left = vertical Bar histogram of the 5 buckets (theme colors: first three `--teal`-ish categorical, 3-7d warning, 7d+ danger — resolve via getChartTheme, NO literals), footer `Mediana: {formatHoras} · {amostras} respostas` + muted line `{pendentes} aguardando · {resolvidos_internamente} resolvidos internamente`; right = ranked list (top 8) resolving cliente names/avatars from the page's clientes cache (fallback "Cliente removido"), each row linking to `/clientes/{id}/entregas`, value = mediana formatted, muted `{amostras} respostas`. Horizon caption on BOTH cards: `Registrado desde {dd/MM/yyyy}` from `horizonte.post_events_since` (and the etapa complement inline when `aprovacao_cliente.etapas.amostras > 0`: `+{n} aprovações por etapa (mediana {..})`). Empty state: `Sem aprovações de cliente no período.`

Retrabalho/Atividade columns get the `horizonte.workflow_events_since` tooltip. Tests: KPI Retrabalho render + invertDelta good-direction, AprovacaoSection buckets/ranking/empty/links, CSV includes the new sections, print-echo line exists in DOM.

Commit `feat(analytics): seções de aprovação do cliente, retrabalho e origem`.

---

### Task 5: full gate

`npm run lint`, `npm run format:check`, 4× tsc, `npm run test`, dup-prefix check. Commit anything the gate fixes (`chore(analytics): ajustes do gate da fase 3`) or no commit if clean.

## Deploy notes (controller)

Staging `db push` of `20260903000030` + DDL verification + superset smoke via `db query` BEFORE merge. PR stacked on the Fase 2 branch (base `worktree-entregas-analytics-fase2`); after the chain merges, prod push order: 000030 rides with the earlier two.
