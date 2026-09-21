# Tarefas Recorrentes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a CRM user turn a task into a repeating series (daily / weekly / monthly / yearly, "every N", optional end date) whose occurrences the database materializes either when the current one is completed (`ao_concluir`) or on every rule date (`calendario`).

**Architecture:** One new table `tarefa_series` (rule + template) plus `tarefas.serie_id`. All date math, materialization and generation live in Postgres (closed-form `tarefa_next_date`/`tarefa_prev_date`, SECURITY DEFINER helpers, triggers on `tarefas`, an hourly pg_cron job). The client never writes `tarefa_series` directly: four SECURITY DEFINER RPCs (`tarefa_serie_criar`, `tarefa_serie_aplicar_edicao`, `tarefa_serie_definir_estado`, `tarefa_serie_excluir`) are the whole write surface, wrapped by plain async store functions and a "Repetir" section in `TarefaFormDialog`.

**Tech Stack:** Postgres (plpgsql, pg_cron, RLS), Supabase CLI local stack (`npx supabase db reset`, psql entitlement suites), React 19 + TypeScript, TanStack Query, react-hook-form + zod, shadcn/ui (Select, DatePicker, ToggleGroup, AlertDialog, Checkbox), lucide-react, sonner, Vitest + Testing Library, Deno (MCP edge function).

Spec: `docs/superpowers/specs/2026-09-21-tarefas-recorrentes-design.md` (read it once before starting; every task below cites the section it implements).

## Global Constraints

- Migration files need a unique timestamp prefix **above main's tail**. Main's tail at plan time is `20260925000023`; this plan uses `20260925000030` and `20260925000031`. Before opening the PR run `git fetch origin main && ls supabase/migrations | tail -3` and renumber above the tail if anything newer landed (two files sharing a prefix collide in `schema_migrations`; the `migration-version-guard` CI job fails the build on duplicates).
- All user-facing copy is pt-BR and **never contains an em-dash** (use a period or a colon instead). Copy strings in this plan are final; copy them verbatim.
- Toasts: `toast()` from `sonner`, never the legacy `showToast()`.
- Icons: `lucide-react` only.
- UI primitives: shadcn components from `apps/crm/src/components/ui/`.
- Path alias `@/` maps to `apps/crm/src/`.
- Store functions are plain async functions in `apps/crm/src/store/*.ts`; components wrap them with `useQuery`/`useMutation` or call them inside handlers and invalidate `['tarefas']`.
- SECURITY DEFINER function grants follow the house pattern: `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated, service_role; GRANT EXECUTE ON FUNCTION ... TO authenticated, service_role;` for client-facing RPCs, and `REVOKE ALL ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role;` for internal helpers (`REVOKE FROM PUBLIC` alone does not strip `service_role`; roles must be named). Every function uses `SET search_path = public`.
- Never use `useBlocker` in the apps (React Router honours only the last registered blocker and `installSilentUpdate` already registers one).
- `tarefas` has **no** column-level GRANT allowlist (verified: no `GRANT ... ON tarefas` in migrations). New `tarefas` columns need no grant work. `tarefa_series` gets an explicit `REVOKE INSERT, UPDATE, DELETE ... FROM anon, authenticated`.
- CI gates before pushing: `npm run lint`, `npm run format:check` (`npm run format` auto-fixes), the four typecheck runs (`npx tsc -p apps/crm/tsconfig.json --noEmit`, `npx tsc -p apps/hub/tsconfig.json --noEmit`, `npx tsc -p apps/admin/tsconfig.json --noEmit`, `npx tsc -p tsconfig.scripts.json`), `npm run test`, `npm run check:functions`, and `npm run test:functions` if anything under `supabase/functions/` changes. Entitlement suites (`bash scripts/test-entitlements.sh`) need Docker/colima locally; CI runs them regardless.
- Migrations deploy **before** the frontend merges (merge deploys the frontend immediately). Staging first, then production.
- Commit after every task with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. Do not push unless told to.

## Local database workflow (used by Tasks 1 to 5)

Tasks 1 to 5 all append sections to the same migration file `supabase/migrations/20260925000030_tarefa_series.sql` and each adds or extends one psql suite. Apply and test like this:

```bash
# once: start the local stack (colima must be running; see reference_local_supabase_colima in memory)
npx supabase start
# after every migration edit: rebuild the local DB from all migrations
npx supabase db reset
# run one suite (the harness runs every supabase/tests/entitlements/[0-9]*.sql in order)
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 \
  -f supabase/tests/entitlements/99_tarefa_next_date.sql
# run everything the CI job runs
bash scripts/test-entitlements.sh
```

A passing suite prints `NOTICE:  PASS <suite name>` and exits 0. A failing `assert` prints `ERROR:  <your message>` and exits 1. Every suite starts with `\set ON_ERROR_STOP on` and `\i supabase/tests/entitlements/_helpers.sql`, wraps everything in `begin; ... rollback;`, and creates its workspaces with `et_make_workspace('start')`.

"Today" in every suite is pinned with `perform set_config('app.tarefa_hoje', '2026-01-05', true);` (transaction-local), which `tarefa_hoje_sp()` honours.

## File structure

Database (new):
- `supabase/migrations/20260925000030_tarefa_series.sql`: everything schema-side, in five sections appended by Tasks 1 to 5 (date functions; table + `tarefas` changes + guards; materialization + triggers; RPCs; generator).
- `supabase/migrations/20260925000031_schedule_tarefas_recorrentes_cron.sql`: the pg_cron schedule (Task 5).
- `supabase/tests/entitlements/99_tarefa_next_date.sql` (Task 1), `99_tarefa_series_rls.sql` (Tasks 2 and 4), `99_tarefa_series_geracao.sql` (Tasks 3, 4 and 5).
- `supabase/tests/entitlements/96_lockdown_definer_function_grants.sql`: four names added to the array (Task 5).

CRM:
- `apps/crm/src/store/tarefas.ts`: types, embed, five RPC wrappers, `isSerieDateConflict` (Task 6).
- `apps/crm/src/pages/tarefas/recorrenciaLogic.ts` (new, pure): `describeRecorrencia`, `serieEstado`, `serieEstadoLabel`, `modoLabel`, `regraFromForm`, `regraIgual` (Task 7).
- `apps/crm/src/pages/tarefas/components/tarefaFormSchema.ts` (new): the zod schema shared by the dialog and the Repetir section (Task 7).
- `apps/crm/src/pages/tarefas/components/RecorrenciaFields.tsx` (new): the Repetir section (Task 8).
- `apps/crm/src/pages/tarefas/components/TarefaFormDialog.tsx`: section wiring, create-via-RPC, promotion, scope dialog (Tasks 8 and 9).
- `apps/crm/src/pages/tarefas/components/EscopoEdicaoDialog.tsx` (new): "Aplicar a quais tarefas?" (Task 9).
- `apps/crm/src/pages/tarefas/components/TarefaCard.tsx`, `TarefaDetailSheet.tsx`, `views/BoardView.tsx`, `views/CalendarView.tsx` (Task 10).
- Tests under `apps/crm/src/pages/tarefas/__tests__/` and the dashboard fixtures (Tasks 6 to 10).

MCP:
- `supabase/functions/mcp/task-errors.ts` (new) + `supabase/functions/__tests__/mcp-task-errors_test.ts` (new), `supabase/functions/mcp/queries.ts` (Task 11).

---

### Task 1: Date math (`tarefa_hoje_sp`, `tarefa_next_date`, `tarefa_prev_date`) with the 33-case suite

Spec: "Generation: entirely in the database", "`tarefa_next_date(...)`", the 28-case table.

**Files:**
- Create: `supabase/migrations/20260925000030_tarefa_series.sql` (section 1)
- Create: `supabase/tests/entitlements/99_tarefa_next_date.sql`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `public.tarefa_hoje_sp() RETURNS date` (STABLE; honours GUC `app.tarefa_hoje`).
  - `public.tarefa_month_landing(p_month_index int, p_dia int) RETURNS date` (IMMUTABLE; `p_month_index = year*12 + month`, clamps to the month's last day).
  - `public.tarefa_next_date(p_freq text, p_intervalo int, p_dias_semana int[], p_dia_mes int, p_mes int, p_inicio date, p_after date) RETURNS date` (IMMUTABLE; smallest rule date strictly greater than `p_after`).
  - `public.tarefa_prev_date(p_freq text, p_intervalo int, p_dias_semana int[], p_dia_mes int, p_mes int, p_inicio date, p_on_or_before date) RETURNS date` (IMMUTABLE; largest rule date `<= p_on_or_before` and `>= p_inicio`, or NULL).
  - All four keep the default PUBLIC EXECUTE (pure functions; the INVOKER guard trigger of Task 2 must be able to call them as any role).

- [ ] **Step 1: Write the failing suite**

Create `supabase/tests/entitlements/99_tarefa_next_date.sql`:

```sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Closed-form date math for tarefa_series. Cases 1 to 28 mirror the table in
-- docs/superpowers/specs/2026-09-21-tarefas-recorrentes-design.md. Cases 21 to
-- 25 exist to catch a regression to a stepping search: they must stay fast.

begin;

do $$
declare
  v_raised boolean;
  v_t0 timestamptz;
  v_ms numeric;
  v_hoje date;
begin
  -- tarefa_hoje_sp: honours the transaction-local override, else Sao Paulo today.
  perform set_config('app.tarefa_hoje', '2026-01-27', true);
  assert public.tarefa_hoje_sp() = date '2026-01-27', 'hoje_sp: override ignored';
  perform set_config('app.tarefa_hoje', '', true);
  v_hoje := public.tarefa_hoje_sp();
  assert v_hoje = (now() at time zone 'America/Sao_Paulo')::date, 'hoje_sp: default is not Sao Paulo today';

  -- daily
  assert public.tarefa_next_date('daily', 1, null, null, null, '2026-01-01', '2026-01-01') = '2026-01-02', 'case 1';
  assert public.tarefa_next_date('daily', 3, null, null, null, '2026-01-01', '2026-01-02') = '2026-01-04', 'case 2';
  assert public.tarefa_next_date('daily', 3, null, null, null, '2026-01-01', '2026-01-04') = '2026-01-07', 'case 3';
  -- weekly (0 = Sunday ... 6 = Saturday)
  assert public.tarefa_next_date('weekly', 1, '{1}', null, null, '2026-01-05', '2026-01-05') = '2026-01-12', 'case 4';
  assert public.tarefa_next_date('weekly', 1, '{1,3}', null, null, '2026-01-05', '2026-01-05') = '2026-01-07', 'case 5';
  assert public.tarefa_next_date('weekly', 2, '{1,3}', null, null, '2026-01-05', '2026-01-07') = '2026-01-19', 'case 6';
  assert public.tarefa_next_date('weekly', 1, '{0}', null, null, '2026-01-05', '2026-01-05') = '2026-01-11', 'case 7';
  assert public.tarefa_next_date('weekly', 2, '{1}', null, null, '2026-01-07', '2026-01-07') = '2026-01-19', 'case 8';
  -- monthly
  assert public.tarefa_next_date('monthly', 1, null, 31, null, '2026-01-31', '2026-01-31') = '2026-02-28', 'case 9';
  assert public.tarefa_next_date('monthly', 1, null, 31, null, '2026-01-31', '2026-02-28') = '2026-03-31', 'case 10';
  assert public.tarefa_next_date('monthly', 3, null, 15, null, '2026-01-15', '2026-02-01') = '2026-04-15', 'case 11';
  assert public.tarefa_next_date('monthly', 1, null, 30, null, '2028-01-30', '2028-01-30') = '2028-02-29', 'case 12';
  -- yearly (mes, dia_mes)
  assert public.tarefa_next_date('yearly', 1, null, 29, 2, '2024-02-29', '2024-02-29') = '2025-02-28', 'case 13';
  assert public.tarefa_next_date('yearly', 1, null, 29, 2, '2024-02-29', '2027-02-28') = '2028-02-29', 'case 14';
  assert public.tarefa_next_date('yearly', 2, null, 10, 3, '2026-03-10', '2026-03-10') = '2028-03-10', 'case 15';
  -- after before inicio
  assert public.tarefa_next_date('daily', 1, null, null, null, '2026-01-10', '2026-01-01') = '2026-01-10', 'case 16';
  assert public.tarefa_next_date('weekly', 1, '{1}', null, null, '2026-01-07', '2026-01-01') = '2026-01-12', 'case 17';
  -- invalid freq raises
  v_raised := false;
  begin
    perform public.tarefa_next_date('hourly', 1, null, null, null, '2026-01-01', '2026-01-01');
  exception when others then v_raised := true; end;
  assert v_raised, 'case 18: freq hourly did not raise';
  -- re-anchoring on a clamped date keeps the landing day
  assert public.tarefa_next_date('monthly', 1, null, 31, null, '2026-02-28', '2026-02-28') = '2026-03-31', 'case 19';
  assert public.tarefa_next_date('yearly', 1, null, 29, 2, '2027-02-28', '2027-02-28') = '2028-02-29', 'case 20';
  -- old series: closed form, no stepping
  v_t0 := clock_timestamp();
  assert public.tarefa_next_date('daily', 1, null, null, null, '2015-01-01', '2026-09-21') = '2026-09-22', 'case 21';
  v_ms := extract(epoch from clock_timestamp() - v_t0) * 1000;
  assert v_ms < 10, format('case 21: took %s ms (stepping search?)', v_ms);
  assert public.tarefa_next_date('daily', 3, null, null, null, '2015-01-01', '2026-09-21') = '2026-09-24', 'case 22';
  assert public.tarefa_next_date('weekly', 2, '{1}', null, null, '2021-09-20', '2026-09-21') = '2026-09-28', 'case 23';
  assert public.tarefa_next_date('monthly', 1, null, 31, null, '2018-01-31', '2026-09-21') = '2026-09-30', 'case 24';
  assert public.tarefa_next_date('yearly', 1, null, 29, 2, '2000-02-29', '2026-09-21') = '2027-02-28', 'case 25';
  -- prev_date sibling
  assert public.tarefa_prev_date('daily', 3, null, null, null, '2015-01-01', '2026-09-22') = '2026-09-21', 'case 26';
  assert public.tarefa_prev_date('weekly', 1, '{1,3}', null, null, '2026-01-05', '2026-01-06') = '2026-01-05', 'case 27';
  assert public.tarefa_prev_date('monthly', 1, null, 31, null, '2026-01-31', '2026-01-30') is null, 'case 28';
  -- prev_date extras the generator relies on
  assert public.tarefa_prev_date('weekly', 2, '{1}', null, null, '2026-01-05', '2026-01-25') = '2026-01-19', 'prev weekly interval';
  assert public.tarefa_prev_date('yearly', 1, null, 29, 2, '2024-02-29', '2026-09-21') = '2026-02-28', 'prev yearly clamp';
  assert public.tarefa_prev_date('daily', 1, null, null, null, '2026-01-10', '2026-01-09') is null, 'prev before inicio';
  -- floor division (SQL integer division truncates toward zero: (-1)/3 = 0 would return inicio + 3)
  assert public.tarefa_next_date('daily', 3, null, null, null, '2026-01-10', '2026-01-01') = '2026-01-10', 'case 29';
  assert public.tarefa_next_date('daily', 3, null, null, null, '2026-01-10', '2026-01-09') = '2026-01-10', 'case 30';
  assert public.tarefa_prev_date('daily', 3, null, null, null, '2026-01-10', '2026-01-12') = '2026-01-10', 'case 31';
  -- landing day before the anchor day in the first period: candidate 2
  assert public.tarefa_next_date('monthly', 1, null, 15, null, '2026-01-20', '2026-01-01') = '2026-02-15', 'case 32';
  assert public.tarefa_next_date('yearly', 1, null, 10, 3, '2026-06-20', '2026-01-01') = '2027-03-10', 'case 33';

  raise notice 'PASS 99_tarefa_next_date (33 cases + prev extras)';
end $$;

rollback;
```

- [ ] **Step 2: Run the suite to verify it fails**

Run: `npx supabase db reset && psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/99_tarefa_next_date.sql`
Expected: `ERROR:  function public.tarefa_hoje_sp() does not exist`

- [ ] **Step 3: Write section 1 of the migration**

Create `supabase/migrations/20260925000030_tarefa_series.sql` with this content (later tasks append below it):

```sql
-- supabase/migrations/20260925000030_tarefa_series.sql
-- Tarefas recorrentes: task series generated in the database.
-- Spec: docs/superpowers/specs/2026-09-21-tarefas-recorrentes-design.md
--
-- Sections: (1) date math, (2) tarefa_series + tarefas changes + guards,
-- (3) materialization + triggers, (4) client-facing RPCs, (5) generator.

-- ============ (1) DATE MATH ============

-- "Today" for every series decision. pg_cron runs in UTC; Brazil has no DST
-- since 2019, so America/Sao_Paulo is a fixed UTC-3. The GUC override exists
-- for the psql suites (nothing sets it in production).
CREATE OR REPLACE FUNCTION public.tarefa_hoje_sp() RETURNS date
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT coalesce(
    NULLIF(current_setting('app.tarefa_hoje', true), '')::date,
    (now() AT TIME ZONE 'America/Sao_Paulo')::date
  );
$$;

-- month_index = year*12 + month (month 1..12). Lands on p_dia, clamped to the
-- month's last day. The clamp does not stick: the next month reads p_dia again.
CREATE OR REPLACE FUNCTION public.tarefa_month_landing(p_month_index int, p_dia int) RETURNS date
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT make_date(
    (p_month_index - 1) / 12,
    (p_month_index - 1) % 12 + 1,
    least(
      p_dia,
      extract(day FROM (make_date((p_month_index - 1) / 12, (p_month_index - 1) % 12 + 1, 1)
                        + interval '1 month - 1 day'))::int
    )
  );
$$;

-- Smallest rule date strictly greater than p_after. Closed form: integer
-- arithmetic on the day/week/month/year index anchored on p_inicio, at most
-- two candidate periods. Never a forward walk from p_inicio.
-- Weeks are Mon..Sun (date_trunc('week')); dias_semana uses 0 = Sunday .. 6 =
-- Saturday, so a weekday iterated as isodow d (1..7) matches when d % 7 is in
-- the array.
CREATE OR REPLACE FUNCTION public.tarefa_next_date(
  p_freq text, p_intervalo int, p_dias_semana int[], p_dia_mes int, p_mes int,
  p_inicio date, p_after date
) RETURNS date
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_after date := greatest(p_after, p_inicio - 1);
  v_k int;
  v_week0 date;
  v_wa int;
  v_w1 int;
  v_week_start date;
  v_d int;
  v_cand date;
  v_base int;
  v_ma int;
  v_m1 int;
  v_ya int;
  v_y1 int;
BEGIN
  IF p_intervalo IS NULL OR p_intervalo < 1 THEN
    RAISE EXCEPTION 'tarefa_next_date: intervalo invalido (%)', p_intervalo;
  END IF;

  IF p_freq = 'daily' THEN
    v_k := floor((v_after - p_inicio)::numeric / p_intervalo)::int + 1;
    RETURN p_inicio + v_k * p_intervalo;

  ELSIF p_freq = 'weekly' THEN
    IF p_dias_semana IS NULL OR cardinality(p_dias_semana) = 0 THEN
      RAISE EXCEPTION 'tarefa_next_date: weekly exige dias_semana';
    END IF;
    v_week0 := date_trunc('week', p_inicio)::date;
    v_wa := (date_trunc('week', v_after)::date - v_week0) / 7;
    v_w1 := ceil(v_wa::numeric / p_intervalo)::int * p_intervalo;
    -- candidate week 1: first rule weekday strictly after v_after
    v_week_start := v_week0 + v_w1 * 7;
    FOR v_d IN 1..7 LOOP
      IF (v_d % 7) = ANY (p_dias_semana) THEN
        v_cand := v_week_start + (v_d - 1);
        IF v_cand > v_after THEN RETURN v_cand; END IF;
      END IF;
    END LOOP;
    -- candidate week 2: first rule weekday of the next eligible week
    v_week_start := v_week0 + (v_w1 + p_intervalo) * 7;
    FOR v_d IN 1..7 LOOP
      IF (v_d % 7) = ANY (p_dias_semana) THEN
        RETURN v_week_start + (v_d - 1);
      END IF;
    END LOOP;
    RAISE EXCEPTION 'tarefa_next_date: weekly sem candidato (bug)';

  ELSIF p_freq = 'monthly' THEN
    IF p_dia_mes IS NULL THEN RAISE EXCEPTION 'tarefa_next_date: monthly exige dia_mes'; END IF;
    v_base := extract(year FROM p_inicio)::int * 12 + extract(month FROM p_inicio)::int;
    v_ma := (extract(year FROM v_after)::int * 12 + extract(month FROM v_after)::int) - v_base;
    v_m1 := ceil(v_ma::numeric / p_intervalo)::int * p_intervalo;
    v_cand := tarefa_month_landing(v_base + v_m1, p_dia_mes);
    IF v_cand > v_after THEN RETURN v_cand; END IF;
    RETURN tarefa_month_landing(v_base + v_m1 + p_intervalo, p_dia_mes);

  ELSIF p_freq = 'yearly' THEN
    IF p_dia_mes IS NULL OR p_mes IS NULL THEN
      RAISE EXCEPTION 'tarefa_next_date: yearly exige dia_mes e mes';
    END IF;
    v_ya := extract(year FROM v_after)::int - extract(year FROM p_inicio)::int;
    v_y1 := extract(year FROM p_inicio)::int + ceil(v_ya::numeric / p_intervalo)::int * p_intervalo;
    v_cand := tarefa_month_landing(v_y1 * 12 + p_mes, p_dia_mes);
    IF v_cand > v_after THEN RETURN v_cand; END IF;
    RETURN tarefa_month_landing((v_y1 + p_intervalo) * 12 + p_mes, p_dia_mes);

  ELSE
    RAISE EXCEPTION 'tarefa_next_date: freq invalida (%)', p_freq;
  END IF;
END;
$$;

-- Largest rule date <= p_on_or_before and >= p_inicio, or NULL. Mirror of
-- tarefa_next_date with floor instead of ceil. Used by the calendario
-- catch-up ("the most recent due date") without stepping.
CREATE OR REPLACE FUNCTION public.tarefa_prev_date(
  p_freq text, p_intervalo int, p_dias_semana int[], p_dia_mes int, p_mes int,
  p_inicio date, p_on_or_before date
) RETURNS date
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_k int;
  v_week0 date;
  v_wa int;
  v_w1 int;
  v_week_start date;
  v_d int;
  v_cand date;
  v_base int;
  v_ma int;
  v_m1 int;
  v_ya int;
  v_y1 int;
BEGIN
  IF p_intervalo IS NULL OR p_intervalo < 1 THEN
    RAISE EXCEPTION 'tarefa_prev_date: intervalo invalido (%)', p_intervalo;
  END IF;
  IF p_on_or_before < p_inicio THEN RETURN NULL; END IF;

  IF p_freq = 'daily' THEN
    v_k := floor((p_on_or_before - p_inicio)::numeric / p_intervalo)::int;
    RETURN p_inicio + v_k * p_intervalo;

  ELSIF p_freq = 'weekly' THEN
    IF p_dias_semana IS NULL OR cardinality(p_dias_semana) = 0 THEN
      RAISE EXCEPTION 'tarefa_prev_date: weekly exige dias_semana';
    END IF;
    v_week0 := date_trunc('week', p_inicio)::date;
    v_wa := (date_trunc('week', p_on_or_before)::date - v_week0) / 7;
    v_w1 := floor(v_wa::numeric / p_intervalo)::int * p_intervalo;
    v_week_start := v_week0 + v_w1 * 7;
    FOR v_d IN REVERSE 7..1 LOOP
      IF (v_d % 7) = ANY (p_dias_semana) THEN
        v_cand := v_week_start + (v_d - 1);
        IF v_cand <= p_on_or_before THEN
          RETURN CASE WHEN v_cand >= p_inicio THEN v_cand ELSE NULL END;
        END IF;
      END IF;
    END LOOP;
    v_week_start := v_week0 + (v_w1 - p_intervalo) * 7;
    FOR v_d IN REVERSE 7..1 LOOP
      IF (v_d % 7) = ANY (p_dias_semana) THEN
        v_cand := v_week_start + (v_d - 1);
        RETURN CASE WHEN v_cand >= p_inicio THEN v_cand ELSE NULL END;
      END IF;
    END LOOP;
    RAISE EXCEPTION 'tarefa_prev_date: weekly sem candidato (bug)';

  ELSIF p_freq = 'monthly' THEN
    IF p_dia_mes IS NULL THEN RAISE EXCEPTION 'tarefa_prev_date: monthly exige dia_mes'; END IF;
    v_base := extract(year FROM p_inicio)::int * 12 + extract(month FROM p_inicio)::int;
    v_ma := (extract(year FROM p_on_or_before)::int * 12 + extract(month FROM p_on_or_before)::int) - v_base;
    v_m1 := floor(v_ma::numeric / p_intervalo)::int * p_intervalo;
    v_cand := tarefa_month_landing(v_base + v_m1, p_dia_mes);
    IF v_cand > p_on_or_before THEN
      v_cand := tarefa_month_landing(v_base + v_m1 - p_intervalo, p_dia_mes);
    END IF;
    RETURN CASE WHEN v_cand >= p_inicio THEN v_cand ELSE NULL END;

  ELSIF p_freq = 'yearly' THEN
    IF p_dia_mes IS NULL OR p_mes IS NULL THEN
      RAISE EXCEPTION 'tarefa_prev_date: yearly exige dia_mes e mes';
    END IF;
    v_ya := extract(year FROM p_on_or_before)::int - extract(year FROM p_inicio)::int;
    v_y1 := extract(year FROM p_inicio)::int + floor(v_ya::numeric / p_intervalo)::int * p_intervalo;
    v_cand := tarefa_month_landing(v_y1 * 12 + p_mes, p_dia_mes);
    IF v_cand > p_on_or_before THEN
      v_cand := tarefa_month_landing((v_y1 - p_intervalo) * 12 + p_mes, p_dia_mes);
    END IF;
    RETURN CASE WHEN v_cand >= p_inicio THEN v_cand ELSE NULL END;

  ELSE
    RAISE EXCEPTION 'tarefa_prev_date: freq invalida (%)', p_freq;
  END IF;
END;
$$;
```

- [ ] **Step 4: Run the suite to verify it passes**

Run: `npx supabase db reset && psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/99_tarefa_next_date.sql`
Expected: last lines `NOTICE:  PASS 99_tarefa_next_date (33 cases + prev extras)` then `ROLLBACK`, exit 0.

Every division of a possibly negative numerator in both functions is written `floor(x::numeric / n)::int` on purpose (cases 29 to 31): Postgres integer `/` truncates toward zero, and `after` can be `inicio - 1` after normalization.

If a case fails, the message names it (`case 23`); fix the arithmetic, never the expected value (the expected values were verified independently with a JS script during spec review).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260925000030_tarefa_series.sql supabase/tests/entitlements/99_tarefa_next_date.sql
git commit -m "feat(tarefas): closed-form date math for task series

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `tarefa_series` table, template validators, `tarefas.serie_id`, RLS and the two guards

Spec: "Data model" (`tarefa_series`, `tarefas` changes), "`proxima_data` is DB-owned", "Security and grants".

**Files:**
- Modify: `supabase/migrations/20260925000030_tarefa_series.sql` (append section 2)
- Create: `supabase/tests/entitlements/99_tarefa_series_rls.sql`

**Interfaces:**
- Consumes: `tarefa_hoje_sp()`, `tarefa_next_date(...)` from Task 1.
- Produces:
  - Table `public.tarefa_series` (columns exactly as the spec table: `id, conta_id, user_id, freq, intervalo, dias_semana, dia_mes, mes, modo, inicio, fim, pausada, encerrada_em, proxima_data, titulo, descricao, descricao_rich, responsavel_id, cliente_id, tag_ids, subtarefas, created_at, updated_at`).
  - `public.tarefas.serie_id bigint` + constraints `tarefas_serie_data_uq UNIQUE (serie_id, data_limite)` and `tarefas_serie_exige_prazo CHECK (serie_id IS NULL OR data_limite IS NOT NULL)`.
  - `public.tarefa_serie_subtarefas_validas(jsonb) RETURNS boolean`, `public.tarefa_serie_dias_semana_validos(int[]) RETURNS boolean`, `public.tarefa_serie_jsonb_int_array(jsonb) RETURNS int[]` (all IMMUTABLE, PUBLIC execute).
  - Trigger functions `public.tarefas_serie_id_guard()` (INVOKER) and `public.tarefa_series_guard()` (INVOKER) and `public.set_tarefa_series_updated_at()`.
  - GUC contract: `current_setting('app.tarefa_cursor_writer', true) = 'on'` lets an UPDATE keep a new `proxima_data`; only Task 5's generator sets it.

- [ ] **Step 1: Write the failing suite (schema and guard part)**

Create `supabase/tests/entitlements/99_tarefa_series_rls.sql`. Task 4 appends the RPC-scoping block at the marker comment near the end.

```sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- tarefa_series: SELECT-only for authenticated, writes are RPC-only; the
-- guards on tarefas.serie_id and on the cursor. Pattern of 98_cliente_links_rls.
-- tarefa_series is excluded from the parity helper so this suite asserts the
-- migration's REVOKE instead of undoing it.

begin;
select et_grant_hosted_parity(array['tarefa_series']);
-- Hosted projects grant SELECT (and ALL to service_role) through the default
-- ACL; locally we grant exactly that by hand so the REVOKE is what is tested.
grant select on public.tarefa_series to anon, authenticated;
grant all on public.tarefa_series to service_role;

do $$
declare
  v_ws_a uuid; v_ws_b uuid;
  v_user uuid := gen_random_uuid();
  v_membro_a bigint; v_membro_b bigint;
  v_cli_a bigint; v_cli_b bigint;
  v_serie_a bigint; v_serie_b bigint;
  v_tarefa_a bigint; v_tarefa_a2 bigint;
  v_seen bigint;
  v_rejected boolean;
  v_state text;
  v_proxima date;
begin
  perform set_config('app.tarefa_hoje', '2026-01-05', true);

  v_ws_a := et_make_workspace('start');
  v_ws_b := et_make_workspace('start');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role)
    values (v_user, v_ws_a, 'owner'), (v_user, v_ws_b, 'owner');
  update profiles set conta_id = v_ws_a, active_workspace_id = v_ws_a where id = v_user;

  insert into membros (user_id, conta_id, nome) values (v_user, v_ws_a, 'MA') returning id into v_membro_a;
  insert into membros (user_id, conta_id, nome) values (v_user, v_ws_b, 'MB') returning id into v_membro_b;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_user, v_ws_a, 'A', 'A', '#000') returning id into v_cli_a;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_user, v_ws_b, 'B', 'B', '#000') returning id into v_cli_b;

  -- ---- as owner: template CHECKs ----
  v_rejected := false;
  begin
    insert into tarefa_series (conta_id, user_id, freq, modo, inicio, titulo, subtarefas)
      values (v_ws_a, v_user, 'daily', 'calendario', '2026-01-05', 'x', '{}'::jsonb);
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'subtarefas {} aceito';

  v_rejected := false;
  begin
    insert into tarefa_series (conta_id, user_id, freq, modo, inicio, titulo, subtarefas)
      values (v_ws_a, v_user, 'daily', 'calendario', '2026-01-05', 'x', '[1]'::jsonb);
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'subtarefas [1] aceito';

  v_rejected := false;
  begin
    insert into tarefa_series (conta_id, user_id, freq, modo, inicio, titulo, subtarefas)
      values (v_ws_a, v_user, 'daily', 'calendario', '2026-01-05', 'x', '[""]'::jsonb);
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'subtarefas [""] aceito';

  v_rejected := false;
  begin
    insert into tarefa_series (conta_id, user_id, freq, modo, inicio, titulo, subtarefas)
      values (v_ws_a, v_user, 'daily', 'calendario', '2026-01-05', 'x',
              (select jsonb_agg(to_jsonb('s' || g::text)) from generate_series(1, 51) g));
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'subtarefas com 51 itens aceito';

  v_rejected := false;
  begin
    insert into tarefa_series (conta_id, user_id, freq, modo, inicio, titulo, tag_ids)
      values (v_ws_a, v_user, 'daily', 'calendario', '2026-01-05', 'x', array[1, null]::bigint[]);
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'tag_ids com NULL aceito';

  v_rejected := false;
  begin
    insert into tarefa_series (conta_id, user_id, freq, modo, inicio, titulo)
      values (v_ws_a, v_user, 'daily', 'calendario', '2026-01-05', '   ');
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'titulo em branco aceito';

  v_rejected := false;
  begin
    insert into tarefa_series (conta_id, user_id, freq, modo, inicio, titulo, descricao_rich)
      values (v_ws_a, v_user, 'daily', 'calendario', '2026-01-05', 'x', '[]'::jsonb);
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'descricao_rich [] aceito';

  v_rejected := false;
  begin
    insert into tarefa_series (conta_id, user_id, freq, modo, inicio, titulo)
      values (v_ws_a, v_user, 'weekly', 'calendario', '2026-01-05', 'x');
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'weekly sem dias_semana aceito';

  v_rejected := false;
  begin
    insert into tarefa_series (conta_id, user_id, freq, dias_semana, modo, inicio, titulo)
      values (v_ws_a, v_user, 'weekly', '{1,1}', 'calendario', '2026-01-05', 'x');
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'weekly com dia repetido aceito';

  v_rejected := false;
  begin
    insert into tarefa_series (conta_id, user_id, freq, dia_mes, modo, inicio, titulo)
      values (v_ws_a, v_user, 'daily', 15, 'calendario', '2026-01-05', 'x');
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'daily com dia_mes aceito';

  v_rejected := false;
  begin
    insert into tarefa_series (conta_id, user_id, freq, modo, inicio, titulo)
      values (v_ws_a, v_user, 'monthly', 'calendario', '2026-01-05', 'x');
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'monthly sem dia_mes aceito';

  -- ---- as owner: valid rows, cursor derived on INSERT (forged value ignored) ----
  insert into tarefa_series (conta_id, user_id, freq, dias_semana, modo, inicio, titulo, proxima_data)
    values (v_ws_a, v_user, 'weekly', '{1}', 'calendario', '2026-01-05', 'Serie A', '1999-01-01')
    returning id, proxima_data into v_serie_a, v_proxima;
  assert v_proxima = '2026-01-12', format('INSERT derived proxima_data expected 2026-01-12, got %s', v_proxima);
  insert into tarefa_series (conta_id, user_id, freq, modo, inicio, titulo)
    values (v_ws_b, v_user, 'daily', 'ao_concluir', '2026-01-05', 'Serie B CONFIDENTIAL')
    returning id into v_serie_b;
  select proxima_data into v_proxima from tarefa_series where id = v_serie_b;
  assert v_proxima is null, 'ao_concluir must have NULL proxima_data';

  -- past fim on INSERT -> NULL cursor
  insert into tarefa_series (conta_id, user_id, freq, modo, inicio, fim, titulo)
    values (v_ws_a, v_user, 'daily', 'calendario', '2026-01-05', '2026-01-05', 'ends today')
    returning proxima_data into v_proxima;
  assert v_proxima is null, 'cursor past fim must be NULL on INSERT';

  -- occurrences as owner (serie_id allowed for the owner)
  insert into tarefas (conta_id, user_id, titulo, status, data_limite, serie_id)
    values (v_ws_a, v_user, 'A1', 'pendente', '2026-01-05', v_serie_a) returning id into v_tarefa_a;
  insert into tarefas (conta_id, user_id, titulo, status, data_limite)
    values (v_ws_a, v_user, 'A standalone', 'pendente', '2026-01-06') returning id into v_tarefa_a2;

  -- tarefas_serie_exige_prazo and tarefas_serie_data_uq
  v_rejected := false;
  begin
    insert into tarefas (conta_id, user_id, titulo, status, serie_id)
      values (v_ws_a, v_user, 'no date', 'pendente', v_serie_a);
  exception when check_violation then v_rejected := true; end;
  assert v_rejected, 'occurrence without data_limite accepted';
  v_rejected := false;
  begin
    insert into tarefas (conta_id, user_id, titulo, status, data_limite, serie_id)
      values (v_ws_a, v_user, 'dup', 'pendente', '2026-01-05', v_serie_a);
  exception when unique_violation then v_rejected := true; end;
  assert v_rejected, 'duplicate (serie_id, data_limite) accepted';

  -- ---- guard as service_role (direct writer besides the owner) ----
  execute 'set local role service_role';
  update tarefa_series set titulo = 'Serie A renamed', proxima_data = '2030-01-01' where id = v_serie_a;
  select proxima_data into v_proxima from tarefa_series where id = v_serie_a;
  assert v_proxima = '2026-01-12', format('unrelated UPDATE moved the cursor to %s', v_proxima);

  -- cursor writer flag: the cron path
  perform set_config('app.tarefa_cursor_writer', 'on', true);
  update tarefa_series set proxima_data = '2026-01-19' where id = v_serie_a;
  perform set_config('app.tarefa_cursor_writer', '', true);
  select proxima_data into v_proxima from tarefa_series where id = v_serie_a;
  assert v_proxima = '2026-01-19', 'flagged cursor UPDATE was not kept';

  -- rule change recomputes from greatest(inicio, today = 2026-01-05)
  update tarefa_series set dias_semana = '{3}' where id = v_serie_a;
  select proxima_data into v_proxima from tarefa_series where id = v_serie_a;
  assert v_proxima = '2026-01-07', format('rule change: expected 2026-01-07, got %s', v_proxima);

  -- pause keeps, resume recomputes from greatest(inicio, today - 1) so today counts
  perform set_config('app.tarefa_hoje', '2026-01-14', true);
  update tarefa_series set pausada = true where id = v_serie_a;
  select proxima_data into v_proxima from tarefa_series where id = v_serie_a;
  assert v_proxima = '2026-01-07', 'pausing moved the cursor';
  update tarefa_series set pausada = false where id = v_serie_a;
  select proxima_data into v_proxima from tarefa_series where id = v_serie_a;
  assert v_proxima = '2026-01-14', format('resume: expected 2026-01-14 (today, Wed), got %s', v_proxima);
  perform set_config('app.tarefa_hoje', '2026-01-05', true);

  -- modo -> ao_concluir clears the cursor
  update tarefa_series set modo = 'ao_concluir' where id = v_serie_a;
  select proxima_data into v_proxima from tarefa_series where id = v_serie_a;
  assert v_proxima is null, 'modo ao_concluir must clear proxima_data';
  update tarefa_series set modo = 'calendario' where id = v_serie_a;
  select proxima_data into v_proxima from tarefa_series where id = v_serie_a;
  assert v_proxima = '2026-01-07', format('modo back to calendario: expected 2026-01-07, got %s', v_proxima);

  -- cursor normalization against fim (a cursor past fim is never stored)
  update tarefa_series set fim = '2026-01-06' where id = v_serie_a;        -- shorten below the cursor (01-07)
  select proxima_data into v_proxima from tarefa_series where id = v_serie_a;
  assert v_proxima is null, 'shortening fim below the cursor did not null it';
  update tarefa_series set fim = '2026-12-31' where id = v_serie_a;        -- extend: revives
  select proxima_data into v_proxima from tarefa_series where id = v_serie_a;
  assert v_proxima = '2026-01-07', format('extending fim did not revive the cursor, got %s', v_proxima);
  update tarefa_series set dias_semana = '{1}', fim = '2026-01-10' where id = v_serie_a; -- rule edit whose next (01-12) passes fim
  select proxima_data into v_proxima from tarefa_series where id = v_serie_a;
  assert v_proxima is null, 'rule edit past fim did not null the cursor';
  update tarefa_series set pausada = true where id = v_serie_a;
  update tarefa_series set pausada = false where id = v_serie_a;           -- resume past fim stays NULL
  select proxima_data into v_proxima from tarefa_series where id = v_serie_a;
  assert v_proxima is null, 'resume past fim revived the cursor';
  update tarefa_series set fim = null where id = v_serie_a;
  select proxima_data into v_proxima from tarefa_series where id = v_serie_a;
  assert v_proxima = '2026-01-12', format('fim cleared: expected 2026-01-12, got %s', v_proxima);

  -- encerrada_em is one-way
  update tarefa_series set encerrada_em = now() where id = v_serie_b;
  v_rejected := false;
  begin
    update tarefa_series set encerrada_em = null where id = v_serie_b;
  exception when others then v_rejected := true; end;
  assert v_rejected, 'clearing encerrada_em accepted';
  v_rejected := false;
  begin
    update tarefa_series set encerrada_em = now() - interval '1 day' where id = v_serie_b;
  exception when others then v_rejected := true; end;
  assert v_rejected, 'moving encerrada_em back accepted';

  -- identity is immutable
  v_rejected := false;
  begin
    update tarefa_series set conta_id = v_ws_a where id = v_serie_b;
  exception when others then v_rejected := true; end;
  assert v_rejected, 'conta_id change accepted';
  v_rejected := false;
  begin
    update tarefa_series set user_id = gen_random_uuid() where id = v_serie_b;
  exception when others then v_rejected := true; end;
  assert v_rejected, 'user_id change accepted';
  execute 'reset role';

  -- ---- as authenticated: SELECT-only, writes are permission denied ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  select count(*) into v_seen from tarefa_series;
  assert v_seen = 2, format('authenticated: expected 2 visible series, got %s', v_seen);
  select count(*) into v_seen from tarefa_series where titulo like '%CONFIDENTIAL%';
  assert v_seen = 0, 'series of another workspace visible';

  v_rejected := false;
  begin
    insert into tarefa_series (conta_id, user_id, freq, modo, inicio, titulo)
      values (v_ws_a, v_user, 'daily', 'calendario', '2026-01-05', 'direct');
  exception when insufficient_privilege then v_rejected := true; end;
  assert v_rejected, 'direct INSERT on tarefa_series was not permission denied';

  v_rejected := false;
  begin
    update tarefa_series set proxima_data = '2030-01-01' where id = v_serie_a;
  exception when insufficient_privilege then v_rejected := true; end;
  assert v_rejected, 'direct UPDATE on tarefa_series was not permission denied';

  v_rejected := false;
  begin
    delete from tarefa_series where id = v_serie_a;
  exception when insufficient_privilege then v_rejected := true; end;
  assert v_rejected, 'direct DELETE on tarefa_series was not permission denied';

  -- tarefas.serie_id guard: link, relink, unlink all raise for authenticated
  v_rejected := false;
  begin
    update tarefas set serie_id = v_serie_a where id = v_tarefa_a2;
  exception when others then v_rejected := true; end;
  assert v_rejected, 'authenticated linked a task to a series directly';
  v_rejected := false;
  begin
    insert into tarefas (conta_id, user_id, titulo, status, data_limite, serie_id)
      values (v_ws_a, v_user, 'forged', 'pendente', '2026-02-01', v_serie_a);
  exception when others then v_rejected := true; end;
  assert v_rejected, 'authenticated inserted a task with serie_id directly';
  v_rejected := false;
  begin
    update tarefas set serie_id = null where id = v_tarefa_a;
  exception when others then v_rejected := true; end;
  assert v_rejected, 'authenticated unlinked an occurrence directly';
  -- ...but an ordinary write to an occurrence still works
  update tarefas set titulo = 'A1 renamed' where id = v_tarefa_a;
  get diagnostics v_seen = row_count;
  assert v_seen = 1, 'authenticated could not update its own occurrence';

  execute 'reset role';

  -- ---- anon reads nothing ----
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
  select count(*) into v_seen from tarefa_series;
  assert v_seen = 0, 'anon can read tarefa_series';
  execute 'reset role';

  -- RPC_SCOPING_BLOCK (Task 4 appends here)

  raise notice 'PASS 99_tarefa_series_rls';
end $$;

rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx supabase db reset && psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/99_tarefa_series_rls.sql`
Expected: `ERROR:  relation "public.tarefa_series" does not exist`

- [ ] **Step 3: Append section 2 to the migration**

Append to `supabase/migrations/20260925000030_tarefa_series.sql`:

```sql
-- ============ (2) TAREFA_SERIES + TAREFAS CHANGES + GUARDS ============

-- Template shape is enforced at the row (CHECK), never at generation time:
-- the cron is all-or-nothing per run, so one malformed template would make
-- generate_recurring_tarefas() raise for every series.
CREATE OR REPLACE FUNCTION public.tarefa_serie_subtarefas_validas(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p IS NULL OR jsonb_typeof(p) <> 'array' THEN false
    ELSE jsonb_array_length(p) <= 50
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(p) e
       WHERE jsonb_typeof(e) <> 'string'
          OR btrim(e #>> '{}') = ''
          OR length(e #>> '{}') > 200
     )
  END;
$$;

-- weekly: 1..7 distinct values in 0..6, no NULLs.
CREATE OR REPLACE FUNCTION public.tarefa_serie_dias_semana_validos(p int[]) RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p IS NULL OR cardinality(p) NOT BETWEEN 1 AND 7 OR array_position(p, NULL) IS NOT NULL THEN false
    ELSE (SELECT count(DISTINCT d) = cardinality(p) AND bool_and(d BETWEEN 0 AND 6) FROM unnest(p) d)
  END;
$$;

-- jsonb array of numbers -> int[]; NULL for anything else. Used by the RPCs.
CREATE OR REPLACE FUNCTION public.tarefa_serie_jsonb_int_array(p jsonb) RETURNS int[]
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p IS NULL OR jsonb_typeof(p) <> 'array' THEN NULL
    ELSE (SELECT coalesce(array_agg(e::int ORDER BY ord), '{}') FROM jsonb_array_elements_text(p) WITH ORDINALITY AS t(e, ord))
  END;
$$;

CREATE TABLE public.tarefa_series (
  id             bigserial PRIMARY KEY,
  conta_id       uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL,
  freq           text NOT NULL,
  intervalo      int  NOT NULL DEFAULT 1,
  dias_semana    int[],
  dia_mes        int,
  mes            int,
  modo           text NOT NULL,
  inicio         date NOT NULL,
  fim            date,
  pausada        boolean NOT NULL DEFAULT false,
  encerrada_em   timestamptz,
  proxima_data   date,
  titulo         text NOT NULL,
  descricao      text,
  descricao_rich jsonb,
  responsavel_id bigint REFERENCES public.membros(id)  ON DELETE SET NULL,
  cliente_id     bigint REFERENCES public.clientes(id) ON DELETE SET NULL,
  tag_ids        bigint[] NOT NULL DEFAULT '{}',
  subtarefas     jsonb NOT NULL DEFAULT '[]',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tarefa_series_id_conta_uq UNIQUE (id, conta_id),
  CONSTRAINT tarefa_series_freq_chk CHECK (freq IN ('daily', 'weekly', 'monthly', 'yearly')),
  CONSTRAINT tarefa_series_intervalo_chk CHECK (intervalo BETWEEN 1 AND 99),
  CONSTRAINT tarefa_series_dias_semana_chk CHECK (
    CASE WHEN freq = 'weekly' THEN public.tarefa_serie_dias_semana_validos(dias_semana)
         ELSE dias_semana IS NULL END),
  CONSTRAINT tarefa_series_dia_mes_chk CHECK (
    CASE WHEN freq IN ('monthly', 'yearly') THEN dia_mes IS NOT NULL AND dia_mes BETWEEN 1 AND 31
         ELSE dia_mes IS NULL END),
  CONSTRAINT tarefa_series_mes_chk CHECK (
    CASE WHEN freq = 'yearly' THEN mes IS NOT NULL AND mes BETWEEN 1 AND 12
         ELSE mes IS NULL END),
  CONSTRAINT tarefa_series_modo_chk CHECK (modo IN ('ao_concluir', 'calendario')),
  CONSTRAINT tarefa_series_fim_chk CHECK (fim IS NULL OR fim >= inicio),
  CONSTRAINT tarefa_series_titulo_chk CHECK (btrim(titulo) <> '' AND length(titulo) <= 200),
  CONSTRAINT tarefa_series_descricao_rich_chk CHECK (descricao_rich IS NULL OR jsonb_typeof(descricao_rich) = 'object'),
  CONSTRAINT tarefa_series_tag_ids_chk CHECK (array_position(tag_ids, NULL) IS NULL AND cardinality(tag_ids) <= 50),
  CONSTRAINT tarefa_series_subtarefas_chk CHECK (public.tarefa_serie_subtarefas_validas(subtarefas))
);

CREATE INDEX tarefa_series_conta_idx ON public.tarefa_series (conta_id);
CREATE INDEX tarefa_series_cron_idx ON public.tarefa_series (proxima_data)
  WHERE modo = 'calendario' AND NOT pausada AND encerrada_em IS NULL AND proxima_data IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_tarefa_series_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_tarefa_series_updated_at
  BEFORE UPDATE ON public.tarefa_series
  FOR EACH ROW EXECUTE FUNCTION public.set_tarefa_series_updated_at();

-- proxima_data is DB-owned. The primary barrier is privileges (REVOKE below);
-- this guard is identity-free defence in depth for service_role, the owner
-- and future RPC paths. It is SECURITY INVOKER on purpose (no data access
-- beyond NEW/OLD) and NEVER branches on current_user: inside a SECURITY
-- DEFINER chain current_user is the owner for every caller
-- (20260817000001_cliente_foto_manual_upload.sql, lines ~105-155).
CREATE OR REPLACE FUNCTION public.tarefa_series_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_hoje date := public.tarefa_hoje_sp();
  v_after date;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_after := NEW.inicio;
  ELSE
    IF NEW.conta_id IS DISTINCT FROM OLD.conta_id OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'tarefa_series: conta_id e user_id sao imutaveis';
    END IF;
    IF OLD.encerrada_em IS NOT NULL
       AND (NEW.encerrada_em IS NULL OR NEW.encerrada_em < OLD.encerrada_em) THEN
      RAISE EXCEPTION 'tarefa_series: encerrada_em nao pode ser limpo nem recuar';
    END IF;
    IF NEW.freq IS DISTINCT FROM OLD.freq
       OR NEW.intervalo IS DISTINCT FROM OLD.intervalo
       OR NEW.dias_semana IS DISTINCT FROM OLD.dias_semana
       OR NEW.dia_mes IS DISTINCT FROM OLD.dia_mes
       OR NEW.mes IS DISTINCT FROM OLD.mes
       OR NEW.inicio IS DISTINCT FROM OLD.inicio
       OR NEW.modo IS DISTINCT FROM OLD.modo
       OR NEW.fim IS DISTINCT FROM OLD.fim THEN
      -- rule changed: nothing in the past is generated
      v_after := greatest(NEW.inicio, v_hoje);
    ELSIF OLD.pausada AND NOT NEW.pausada THEN
      -- resumed: today counts, missed dates during the pause are skipped
      v_after := greatest(NEW.inicio, v_hoje - 1);
    END IF;
  END IF;

  IF v_after IS NOT NULL THEN
    IF NEW.modo = 'calendario' THEN
      NEW.proxima_data := public.tarefa_next_date(
        NEW.freq, NEW.intervalo, NEW.dias_semana, NEW.dia_mes, NEW.mes, NEW.inicio, v_after);
      IF NEW.fim IS NOT NULL AND NEW.proxima_data > NEW.fim THEN
        NEW.proxima_data := NULL;
      END IF;
    ELSE
      NEW.proxima_data := NULL;
    END IF;
  ELSIF coalesce(current_setting('app.tarefa_cursor_writer', true), '') <> 'on' THEN
    -- any other UPDATE retains the cursor; only generate_recurring_tarefas()
    -- sets the flag (transaction-local) right before its cursor UPDATE
    NEW.proxima_data := OLD.proxima_data;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tarefa_series_guard
  BEFORE INSERT OR UPDATE ON public.tarefa_series
  FOR EACH ROW EXECUTE FUNCTION public.tarefa_series_guard();

ALTER TABLE public.tarefa_series ENABLE ROW LEVEL SECURITY;

-- SELECT-only for tenants. There is deliberately no INSERT/UPDATE/DELETE
-- policy: every write goes through the SECURITY DEFINER RPCs in section 4.
CREATE POLICY tarefa_series_tenant_select ON public.tarefa_series
  FOR SELECT USING (conta_id IN (SELECT public.get_my_conta_id()));

CREATE POLICY tarefa_series_service_role_bypass ON public.tarefa_series
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- The hosted default ACL grants ALL on new tables; without this REVOKE a
-- missing policy would deny by filtering (0 rows) instead of raising.
REVOKE INSERT, UPDATE, DELETE ON public.tarefa_series FROM anon, authenticated;

-- ---- tarefas ----
ALTER TABLE public.tarefas
  ADD COLUMN serie_id bigint REFERENCES public.tarefa_series(id) ON DELETE SET NULL;
-- Simple FK on purpose: a composite (serie_id, conta_id) ON DELETE SET NULL
-- would null the NOT NULL conta_id. The WITH CHECK EXISTS below is the
-- tenant tie instead.
ALTER TABLE public.tarefas
  ADD CONSTRAINT tarefas_serie_data_uq UNIQUE (serie_id, data_limite),
  ADD CONSTRAINT tarefas_serie_exige_prazo CHECK (serie_id IS NULL OR data_limite IS NOT NULL);
CREATE INDEX tarefas_serie_idx ON public.tarefas (serie_id) WHERE serie_id IS NOT NULL;

-- serie_id is linked/unlinked only by the RPCs. SECURITY INVOKER in the exact
-- shape of guard_financial_write() (20260728000002): current_user is the real
-- caller here, while a write issued from inside a SECURITY DEFINER RPC runs
-- as the owner and passes. Never make this DEFINER, never use session_user.
CREATE OR REPLACE FUNCTION public.tarefas_serie_id_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF (TG_OP = 'INSERT' AND NEW.serie_id IS NOT NULL)
       OR (TG_OP = 'UPDATE' AND NEW.serie_id IS DISTINCT FROM OLD.serie_id) THEN
      RAISE EXCEPTION 'serie_id so pode ser alterado pelas RPCs de serie'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER tarefas_serie_id_guard
  BEFORE INSERT OR UPDATE OF serie_id ON public.tarefas
  FOR EACH ROW EXECUTE FUNCTION public.tarefas_serie_id_guard();

-- Second barrier: WITH CHECK ties serie_id to the row's own workspace, same
-- pattern as responsavel_id/cliente_id. Policy text repeated in full.
DROP POLICY tarefas_tenant_all ON public.tarefas;
CREATE POLICY tarefas_tenant_all ON public.tarefas
  FOR ALL USING (conta_id IN (SELECT public.get_my_conta_id()))
  WITH CHECK (
    conta_id IN (SELECT public.get_my_conta_id())
    AND (
      responsavel_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.membros m
        WHERE m.id = tarefas.responsavel_id AND m.conta_id = tarefas.conta_id
      )
    )
    AND (
      cliente_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.clientes c
        WHERE c.id = tarefas.cliente_id AND c.conta_id = tarefas.conta_id
      )
    )
    AND (
      serie_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.tarefa_series s
        WHERE s.id = tarefas.serie_id AND s.conta_id = tarefas.conta_id
      )
    )
  );
```

- [ ] **Step 4: Run the suite to verify it passes**

Run: `npx supabase db reset && psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/99_tarefa_series_rls.sql`
Expected: `NOTICE:  PASS 99_tarefa_series_rls`, exit 0. Also re-run Task 1's suite and `psql ... -f supabase/tests/entitlements/96_lockdown_definer_function_grants.sql` to confirm nothing regressed.

Note on the `fim` recompute event: the spec's event table lists rule columns and `pausada`; this guard also treats a change of `fim` as a rule event so that extending `fim` on an exhausted series (cursor NULL) revives the cursor. Harmless for every other path (`tarefa_serie_aplicar_edicao` always re-anchors `inicio` anyway).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260925000030_tarefa_series.sql supabase/tests/entitlements/99_tarefa_series_rls.sql
git commit -m "feat(tarefas): tarefa_series table, serie_id on tarefas, RLS and guards

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Materialization, `ao_concluir` helper and the three generation triggers

Spec: "Shared materialization", "`ao_concluir` mode", trigger `tarefa_series_apos_retomar`, "Notifications".

**Files:**
- Modify: `supabase/migrations/20260925000030_tarefa_series.sql` (append section 3)
- Create: `supabase/tests/entitlements/99_tarefa_series_geracao.sql`

**Interfaces:**
- Consumes: `tarefa_series`, `tarefas.serie_id`, `tarefa_next_date`, `tarefa_hoje_sp` (Tasks 1 and 2).
- Produces:
  - `public.tarefa_serie_materializar(p_serie_id bigint, p_data date) RETURNS bigint` (DEFINER; NULL when the occurrence already existed).
  - `public.tarefa_serie_garantir_aberta(p_serie_id bigint, p_after date) RETURNS bigint` (DEFINER; the `ao_concluir` "exactly one open occurrence" helper).
  - Triggers `tarefas_serie_ao_concluir` (AFTER UPDATE OF status ON tarefas), `tarefas_serie_ao_excluir` (AFTER DELETE ON tarefas), `tarefa_series_apos_retomar` (AFTER UPDATE OF pausada ON tarefa_series), with functions `tarefas_serie_ao_concluir_fn()`, `tarefas_serie_ao_excluir_fn()`, `tarefa_series_apos_retomar_fn()`.
  - Firing order note: `sync_ideia_from_tarefa` (20260730000009) and `tarefas_serie_ao_concluir` are both AFTER UPDATE OF status; Postgres fires them alphabetically (`sync_...` first). Neither depends on the other; keep the names.

- [ ] **Step 1: Write the failing suite (generation part)**

Create `supabase/tests/entitlements/99_tarefa_series_geracao.sql`. Series are inserted as the owner in this task (the RPC arrives in Task 4, which appends its own block at the marker); completions run as `authenticated`, which proves the DEFINER trigger fires without EXECUTE for the caller.

```sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- Generation of occurrences: ao_concluir triggers, delete trigger, resume
-- trigger, calendario generator, RPCs. Spec section "Testing", suite (c).

begin;
select et_grant_hosted_parity(array['tarefa_series']);
grant select on public.tarefa_series to anon, authenticated;
grant all on public.tarefa_series to service_role;

-- helper: count open occurrences of a series
create or replace function pg_temp.et_abertas(p_serie bigint) returns bigint language sql as $$
  select count(*) from public.tarefas where serie_id = p_serie and status <> 'concluida';
$$;

do $$
declare
  v_ws uuid;
  v_user uuid := gen_random_uuid();
  v_membro bigint; v_cli bigint;
  v_tag1 bigint; v_tag2 bigint;
  v_serie bigint; v_t1 bigint; v_t2 bigint; v_t3 bigint;
  v_n bigint; v_date date; v_status text;
  v_rejected boolean;
begin
  perform set_config('app.tarefa_hoje', '2026-01-05', true);

  v_ws := et_make_workspace('start');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user;
  insert into membros (user_id, conta_id, nome) values (v_user, v_ws, 'M') returning id into v_membro;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_user, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into tarefa_tags (conta_id, nome) values (v_ws, 't1') returning id into v_tag1;
  insert into tarefa_tags (conta_id, nome) values (v_ws, 't2') returning id into v_tag2;

  -- weekly Monday, ao_concluir, template with tags, subtasks, responsavel, cliente
  insert into tarefa_series (conta_id, user_id, freq, dias_semana, modo, inicio, titulo, descricao,
                             responsavel_id, cliente_id, tag_ids, subtarefas)
    values (v_ws, v_user, 'weekly', '{1}', 'ao_concluir', '2026-01-05', 'Relatorio semanal', 'desc',
            v_membro, v_cli, array[v_tag1, v_tag2], '["Coletar dados", "Escrever"]'::jsonb)
    returning id into v_serie;
  insert into tarefas (conta_id, user_id, titulo, status, data_limite, serie_id, responsavel_id, cliente_id)
    values (v_ws, v_user, 'Relatorio semanal', 'pendente', '2026-01-05', v_serie, v_membro, v_cli)
    returning id into v_t1;

  -- ---- act as the user ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- (b) completing creates the next one from the template
  update tarefas set status = 'concluida' where id = v_t1;
  select id, data_limite into v_t2, v_date from tarefas where serie_id = v_serie and status <> 'concluida';
  assert v_t2 is not null, '(b) next occurrence not created';
  assert v_date = '2026-01-12', format('(b) next expected 2026-01-12, got %s', v_date);
  select count(*) into v_n from subtarefas where tarefa_id = v_t2 and concluida = false;
  assert v_n = 2, format('(b) expected 2 unchecked subtasks, got %s', v_n);
  select count(*) into v_n from tarefa_tag_links where tarefa_id = v_t2;
  assert v_n = 2, format('(b) expected 2 tag links, got %s', v_n);
  perform 1 from tarefas where id = v_t2 and responsavel_id = v_membro and cliente_id = v_cli and status = 'pendente';
  assert found, '(b) template responsavel/cliente/status not copied';

  -- (c) reopen + re-complete does not duplicate
  update tarefas set status = 'pendente' where id = v_t1;
  update tarefas set status = 'concluida' where id = v_t1;
  assert pg_temp.et_abertas(v_serie) = 1, '(c) reopen + re-complete duplicated';

  -- (d) reopen + re-complete with today advanced: open-occurrence guard, no branch
  perform set_config('app.tarefa_hoje', '2026-01-20', true);
  update tarefas set status = 'pendente' where id = v_t1;
  update tarefas set status = 'concluida' where id = v_t1;
  assert pg_temp.et_abertas(v_serie) = 1, '(d) branch created with today advanced';
  perform set_config('app.tarefa_hoje', '2026-01-05', true);

  -- (d2) next occurrence dragged earlier than its predecessor, then predecessor completed
  update tarefas set status = 'pendente' where id = v_t1;              -- t1 open again (01-05)
  update tarefas set data_limite = '2026-01-02' where id = v_t2;       -- t2 dragged before t1
  update tarefas set status = 'concluida' where id = v_t1;
  assert pg_temp.et_abertas(v_serie) = 1, '(d2) more than one open occurrence';
  update tarefas set data_limite = '2026-01-12' where id = v_t2;

  -- (e) late completion yields a future date: occurrence 01-12 completed on 01-27 -> 02-02
  perform set_config('app.tarefa_hoje', '2026-01-27', true);
  update tarefas set status = 'concluida' where id = v_t2;
  select id, data_limite into v_t3, v_date from tarefas where serie_id = v_serie and status <> 'concluida';
  assert v_date = '2026-02-02', format('(e) expected 2026-02-02, got %s', v_date);

  -- (g) fim cuts off: series ends 2026-02-02, completing the 02-02 occurrence creates nothing
  execute 'reset role';
  update tarefa_series set fim = '2026-02-02' where id = v_serie;
  execute 'set local role authenticated';
  update tarefas set status = 'concluida' where id = v_t3;
  assert pg_temp.et_abertas(v_serie) = 0, '(g) occurrence created past fim';

  -- (f) paused series does not generate; resuming an ao_concluir series with no open occurrence generates
  execute 'reset role';
  update tarefa_series set fim = null, pausada = true where id = v_serie;
  execute 'set local role authenticated';
  update tarefas set status = 'pendente' where id = v_t3;
  update tarefas set status = 'concluida' where id = v_t3;
  assert pg_temp.et_abertas(v_serie) = 0, '(f) paused series generated';
  execute 'reset role';
  perform set_config('app.tarefa_hoje', '2026-02-09', true);   -- a Monday
  update tarefa_series set pausada = false where id = v_serie;
  select data_limite into v_date from tarefas where serie_id = v_serie and status <> 'concluida';
  assert v_date = '2026-02-16', format('(f) resume expected 2026-02-16, got %s', v_date);

  -- (h) deleted tag and deleted responsavel before generation do not break it
  delete from tarefa_tags where id = v_tag2;
  delete from membros where id = v_membro;
  execute 'set local role authenticated';
  update tarefas set status = 'concluida' where serie_id = v_serie and status <> 'concluida';
  select id into v_t1 from tarefas where serie_id = v_serie and status <> 'concluida';
  assert v_t1 is not null, '(h) generation broke after deletions';
  select count(*) into v_n from tarefa_tag_links where tarefa_id = v_t1;
  assert v_n = 1, format('(h) expected 1 tag link, got %s', v_n);
  perform 1 from tarefas where id = v_t1 and responsavel_id is null;
  assert found, '(h) responsavel should be NULL after membro deletion';

  -- (j) "Somente esta" delete of the only open occurrence spawns the next;
  --     deleting a completed historical occurrence spawns nothing
  select data_limite into v_date from tarefas where id = v_t1;
  delete from tarefas where id = v_t1;
  assert pg_temp.et_abertas(v_serie) = 1, '(j) delete of the only open occurrence left the series dormant';
  select id into v_t2 from tarefas where serie_id = v_serie and status <> 'concluida';
  perform 1 from tarefas where id = v_t2 and data_limite > v_date;
  assert found, '(j) spawned occurrence is not after the deleted one';
  select id into v_t3 from tarefas where serie_id = v_serie and status = 'concluida' limit 1;
  delete from tarefas where id = v_t3;
  assert pg_temp.et_abertas(v_serie) = 1, '(j) deleting a completed occurrence spawned something';

  -- (e2) very late completion of an ao_concluir daily series dated 1200+ days ago
  execute 'reset role';
  insert into tarefa_series (conta_id, user_id, freq, modo, inicio, titulo)
    values (v_ws, v_user, 'daily', 'ao_concluir', '2022-01-01', 'Old daily') returning id into v_serie;
  insert into tarefas (conta_id, user_id, titulo, status, data_limite, serie_id)
    values (v_ws, v_user, 'Old daily', 'pendente', '2022-01-01', v_serie) returning id into v_t1;
  perform set_config('app.tarefa_hoje', '2026-09-21', true);
  execute 'set local role authenticated';
  update tarefas set status = 'concluida' where id = v_t1;
  select data_limite into v_date from tarefas where serie_id = v_serie and status <> 'concluida';
  assert v_date = '2026-09-22', format('(e2) expected 2026-09-22, got %s', v_date);
  execute 'reset role';

  -- (k) DELETE FROM workspaces with a series + open occurrence does not fail
  delete from workspaces where id = v_ws;
  select count(*) into v_n from tarefa_series where conta_id = v_ws;
  assert v_n = 0, '(k) series survived the workspace delete';

  -- RPC_BLOCK (Task 4 appends here)
  -- CALENDARIO_BLOCK (Task 5 appends here)

  raise notice 'PASS 99_tarefa_series_geracao';
end $$;

rollback;
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx supabase db reset && psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/99_tarefa_series_geracao.sql`
Expected: `ERROR:  (b) next occurrence not created`

- [ ] **Step 3: Append section 3 to the migration**

```sql
-- ============ (3) MATERIALIZATION + TRIGGERS ============

-- The only writer of GENERATED occurrences. Takes a bare series id, so it is
-- revoked from authenticated (it would let any user write into any series).
CREATE OR REPLACE FUNCTION public.tarefa_serie_materializar(p_serie_id bigint, p_data date) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s record;
  v_id bigint;
BEGIN
  SELECT * INTO s FROM tarefa_series WHERE id = p_serie_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  INSERT INTO tarefas (conta_id, user_id, titulo, descricao, descricao_rich, status,
                       responsavel_id, cliente_id, data_limite, serie_id)
  VALUES (s.conta_id, s.user_id, s.titulo, s.descricao, s.descricao_rich, 'pendente',
          s.responsavel_id, s.cliente_id, p_data, s.id)
  ON CONFLICT ON CONSTRAINT tarefas_serie_data_uq DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN NULL; END IF;   -- already existed: children untouched

  INSERT INTO subtarefas (tarefa_id, conta_id, titulo, concluida, ordem)
  SELECT v_id, s.conta_id, e.value, false, (e.ordinality - 1)::int
    FROM jsonb_array_elements_text(s.subtarefas) WITH ORDINALITY AS e(value, ordinality);

  -- deleted or foreign tag ids simply produce no link
  INSERT INTO tarefa_tag_links (tarefa_id, tag_id, conta_id)
  SELECT v_id, t.id, s.conta_id
    FROM tarefa_tags t
   WHERE t.id = ANY (s.tag_ids) AND t.conta_id = s.conta_id;

  RETURN v_id;
END;
$$;

-- ao_concluir: "make sure the series has exactly one open occurrence".
CREATE OR REPLACE FUNCTION public.tarefa_serie_garantir_aberta(p_serie_id bigint, p_after date) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s record;
  v_next date;
BEGIN
  SELECT * INTO s FROM tarefa_series WHERE id = p_serie_id FOR UPDATE;
  IF NOT FOUND OR s.modo <> 'ao_concluir' OR s.pausada OR s.encerrada_em IS NOT NULL THEN
    RETURN NULL;
  END IF;
  -- any open occurrence, whatever its date, is "the next"
  IF EXISTS (SELECT 1 FROM tarefas WHERE serie_id = p_serie_id AND status <> 'concluida') THEN
    RETURN NULL;
  END IF;
  v_next := tarefa_next_date(s.freq, s.intervalo, s.dias_semana, s.dia_mes, s.mes, s.inicio,
                             greatest(p_after, tarefa_hoje_sp()));
  IF v_next IS NULL OR (s.fim IS NOT NULL AND v_next > s.fim) THEN
    RETURN NULL;
  END IF;
  RETURN tarefa_serie_materializar(p_serie_id, v_next);
END;
$$;

-- Completion trigger. Reads modo without a lock first so completing a
-- calendario occurrence never waits on the cron's scan.
CREATE OR REPLACE FUNCTION public.tarefas_serie_ao_concluir_fn() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_modo text;
BEGIN
  SELECT modo INTO v_modo FROM tarefa_series WHERE id = NEW.serie_id;
  IF v_modo IS DISTINCT FROM 'ao_concluir' THEN RETURN NULL; END IF;
  PERFORM tarefa_serie_garantir_aberta(NEW.serie_id, NEW.data_limite);
  RETURN NULL;
END;
$$;

CREATE TRIGGER tarefas_serie_ao_concluir
  AFTER UPDATE OF status ON public.tarefas
  FOR EACH ROW
  WHEN (NEW.serie_id IS NOT NULL AND NEW.status = 'concluida' AND OLD.status IS DISTINCT FROM 'concluida')
  EXECUTE FUNCTION public.tarefas_serie_ao_concluir_fn();

-- "Somente esta" delete of an OPEN occurrence means "skip this one": the next
-- is created immediately. Two early returns: (a) the workspace is mid-deletion
-- (cascade order between tarefas and tarefa_series is unspecified); (b) the
-- series is already gone or ended (tarefa_serie_excluir ends it first).
CREATE OR REPLACE FUNCTION public.tarefas_serie_ao_excluir_fn() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM workspaces WHERE id = OLD.conta_id) THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM tarefa_series WHERE id = OLD.serie_id) THEN RETURN NULL; END IF;
  PERFORM tarefa_serie_garantir_aberta(OLD.serie_id, OLD.data_limite);
  RETURN NULL;
END;
$$;

CREATE TRIGGER tarefas_serie_ao_excluir
  AFTER DELETE ON public.tarefas
  FOR EACH ROW
  WHEN (OLD.serie_id IS NOT NULL AND OLD.status <> 'concluida')
  EXECUTE FUNCTION public.tarefas_serie_ao_excluir_fn();

-- Resume of an ao_concluir series whose last occurrence was completed while
-- paused: without this it would stay dormant forever.
CREATE OR REPLACE FUNCTION public.tarefa_series_apos_retomar_fn() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM tarefa_serie_garantir_aberta(NEW.id, tarefa_hoje_sp() - 1);
  RETURN NULL;
END;
$$;

CREATE TRIGGER tarefa_series_apos_retomar
  AFTER UPDATE OF pausada ON public.tarefa_series
  FOR EACH ROW
  WHEN (OLD.pausada AND NOT NEW.pausada AND NEW.modo = 'ao_concluir')
  EXECUTE FUNCTION public.tarefa_series_apos_retomar_fn();

-- Internal helpers: service_role only. Triggers fire without an EXECUTE check
-- at fire time (the suite proves it by completing as authenticated).
REVOKE ALL ON FUNCTION public.tarefa_serie_materializar(bigint, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tarefa_serie_materializar(bigint, date) TO service_role;
REVOKE ALL ON FUNCTION public.tarefa_serie_garantir_aberta(bigint, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tarefa_serie_garantir_aberta(bigint, date) TO service_role;
REVOKE ALL ON FUNCTION public.tarefas_serie_ao_concluir_fn() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tarefas_serie_ao_excluir_fn() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tarefa_series_apos_retomar_fn() FROM PUBLIC, anon, authenticated;
```

- [ ] **Step 4: Run the suite to verify it passes**

Run: `npx supabase db reset && psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/99_tarefa_series_geracao.sql`
Expected: `NOTICE:  PASS 99_tarefa_series_geracao`, exit 0. Re-run the two earlier suites as well.

Case (f) walkthrough, so the expected date is not a mystery: the series (weekly Monday, `inicio` 2026-01-05) resumes on 2026-02-09 (a Monday) with no open occurrence. `tarefa_series_apos_retomar` calls the helper with `p_after = today - 1`, the helper computes strictly after `greatest(p_after, today) = 02-09`, so the next Monday is **02-16**. The spec's "resume: `greatest(inicio, today - 1)` so today counts" is the **calendario cursor** rule (Task 2's guard, tested there with 2026-01-14): the cursor means "generate at or after", and the generator materializes dates `<= today`. In `ao_concluir` the helper is always "strictly after today", so a resume on a rule day yields the following rule date. Mention this one-line clarification in the PR description; nothing the owner approved depends on it.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260925000030_tarefa_series.sql supabase/tests/entitlements/99_tarefa_series_geracao.sql
git commit -m "feat(tarefas): materialize series occurrences on completion, delete and resume

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The four client-facing RPCs

Spec: "Create: one atomic RPC", "Edit, pause, resume, end", "Delete", "Security and grants".

**Files:**
- Modify: `supabase/migrations/20260925000030_tarefa_series.sql` (append section 4)
- Modify: `supabase/tests/entitlements/99_tarefa_series_rls.sql` (replace the `-- RPC_SCOPING_BLOCK` marker)
- Modify: `supabase/tests/entitlements/99_tarefa_series_geracao.sql` (replace the `-- RPC_BLOCK` marker)

**Interfaces:**
- Consumes: everything from Tasks 1 to 3; `public.get_my_conta_id()` (existing, SECURITY DEFINER: `SELECT active_workspace_id FROM profiles WHERE id = auth.uid()`).
- Produces (all `SECURITY DEFINER SET search_path = public`, EXECUTE for `authenticated, service_role` only):
  - `public.tarefa_serie_validar_refs(p_conta uuid, p_responsavel_id bigint, p_cliente_id bigint) RETURNS void` (internal, service_role only).
  - `public.tarefa_serie_criar(p_serie jsonb, p_tarefa jsonb, p_tag_ids bigint[], p_subtarefas text[], p_tarefa_id bigint DEFAULT NULL) RETURNS TABLE (serie_id bigint, tarefa_id bigint)`.
  - `public.tarefa_serie_aplicar_edicao(p_tarefa_id bigint, p_tarefa jsonb, p_tag_ids bigint[], p_regra jsonb, p_encerrar boolean DEFAULT false) RETURNS void`.
  - `public.tarefa_serie_definir_estado(p_serie_id bigint, p_estado text) RETURNS void` with `p_estado IN ('pausar', 'retomar', 'encerrar')`.
  - `public.tarefa_serie_excluir(p_serie_id bigint) RETURNS void`.
  - JSON contracts (the store in Task 6 sends exactly these keys):
    - `p_serie` / `p_regra`: `{ "freq": "daily|weekly|monthly|yearly", "intervalo": 1, "dias_semana": [1,3] | null, "dia_mes": 15 | null, "mes": 3 | null, "modo": "ao_concluir|calendario", "fim": "YYYY-MM-DD" | null }`.
    - `p_tarefa`: `{ "titulo": string, "descricao": string | null, "descricao_rich": object | null, "status": "pendente|em_andamento|concluida", "responsavel_id": number | null, "cliente_id": number | null, "data_limite": "YYYY-MM-DD" | null }`.
  - Error messages raised (pt-BR, surfaced verbatim by PostgREST as `error.message`): `Sessao sem workspace ativo.`, `Tarefas de uma série precisam de prazo.`, `Para repetir, o prazo precisa ser hoje ou depois.`, `A data final precisa ser igual ou depois do prazo.`, `Responsável não encontrado neste workspace.`, `Cliente não encontrado neste workspace.`, `Tarefa não encontrada neste workspace.`, `Esta tarefa já pertence a uma série.`, `Reabra a tarefa para torná-la recorrente.`, `Esta tarefa não pertence a uma série.`, `Série não encontrada neste workspace.`, `Esta série já foi encerrada.`, `Estado inválido.`

- [ ] **Step 1: Extend both suites (failing)**

In `99_tarefa_series_rls.sql`, replace the line `  -- RPC_SCOPING_BLOCK (Task 4 appends here)` with:

```sql
  -- ---- RPC grants ----
  foreach v_state in array array[
    'public.tarefa_serie_criar(jsonb, jsonb, bigint[], text[], bigint)',
    'public.tarefa_serie_aplicar_edicao(bigint, jsonb, bigint[], jsonb, boolean)',
    'public.tarefa_serie_definir_estado(bigint, text)',
    'public.tarefa_serie_excluir(bigint)'
  ] loop
    assert has_function_privilege('authenticated', v_state, 'EXECUTE'), format('authenticated must execute %s', v_state);
    assert has_function_privilege('anon', v_state, 'EXECUTE') = false, format('anon must not execute %s', v_state);
  end loop;
  foreach v_state in array array[
    'public.tarefa_serie_materializar(bigint, date)',
    'public.tarefa_serie_garantir_aberta(bigint, date)',
    'public.tarefa_serie_validar_refs(uuid, bigint, bigint)'
  ] loop
    assert has_function_privilege('authenticated', v_state, 'EXECUTE') = false, format('authenticated must not execute %s', v_state);
    assert has_function_privilege('anon', v_state, 'EXECUTE') = false, format('anon must not execute %s', v_state);
    assert has_function_privilege('service_role', v_state, 'EXECUTE'), format('service_role must execute %s', v_state);
  end loop;

  -- ---- RPC tenant scoping, as authenticated (active workspace = A) ----
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- foreign responsavel raises
  v_rejected := false;
  begin
    perform public.tarefa_serie_criar(
      '{"freq":"daily","intervalo":1,"dias_semana":null,"dia_mes":null,"mes":null,"modo":"ao_concluir","fim":null}'::jsonb,
      jsonb_build_object('titulo', 'x', 'descricao', null, 'descricao_rich', null, 'status', 'pendente',
                         'responsavel_id', v_membro_b, 'cliente_id', null, 'data_limite', '2026-01-05'),
      '{}'::bigint[], '{}'::text[]);
  exception when others then v_rejected := true; end;
  assert v_rejected, 'criar accepted a responsavel from another workspace';

  -- foreign cliente raises
  v_rejected := false;
  begin
    perform public.tarefa_serie_criar(
      '{"freq":"daily","intervalo":1,"dias_semana":null,"dia_mes":null,"mes":null,"modo":"ao_concluir","fim":null}'::jsonb,
      jsonb_build_object('titulo', 'x', 'descricao', null, 'descricao_rich', null, 'status', 'pendente',
                         'responsavel_id', null, 'cliente_id', v_cli_b, 'data_limite', '2026-01-05'),
      '{}'::bigint[], '{}'::text[]);
  exception when others then v_rejected := true; end;
  assert v_rejected, 'criar accepted a cliente from another workspace';

  -- past inicio raises
  v_rejected := false;
  begin
    perform public.tarefa_serie_criar(
      '{"freq":"daily","intervalo":1,"dias_semana":null,"dia_mes":null,"mes":null,"modo":"ao_concluir","fim":null}'::jsonb,
      jsonb_build_object('titulo', 'x', 'descricao', null, 'descricao_rich', null, 'status', 'pendente',
                         'responsavel_id', null, 'cliente_id', null, 'data_limite', '2026-01-04'),
      '{}'::bigint[], '{}'::text[]);
  exception when others then v_rejected := true; end;
  assert v_rejected, 'criar accepted a past inicio';

  -- other workspace's rows are "not found" for edit / state / delete
  v_rejected := false;
  begin
    perform public.tarefa_serie_definir_estado(v_serie_b, 'pausar');
  exception when others then v_rejected := true; end;
  assert v_rejected, 'definir_estado touched another workspace''s series';
  v_rejected := false;
  begin
    perform public.tarefa_serie_excluir(v_serie_b);
  exception when others then v_rejected := true; end;
  assert v_rejected, 'excluir touched another workspace''s series';
  v_rejected := false;
  begin
    perform public.tarefa_serie_aplicar_edicao(v_tarefa_a2,
      jsonb_build_object('titulo', 'x', 'descricao', null, 'descricao_rich', null, 'status', 'pendente',
                         'responsavel_id', null, 'cliente_id', null, 'data_limite', '2026-01-06'),
      '{}'::bigint[],
      '{"freq":"daily","intervalo":1,"dias_semana":null,"dia_mes":null,"mes":null,"modo":"ao_concluir","fim":null}'::jsonb,
      false);
  exception when others then v_rejected := true; end;
  assert v_rejected, 'aplicar_edicao accepted a standalone task';

  -- a write to tarefas.serie_id from inside a DEFINER RPC passes the guard
  -- (promotion of the standalone task), while the same as authenticated raised above
  perform public.tarefa_serie_criar(
    '{"freq":"daily","intervalo":1,"dias_semana":null,"dia_mes":null,"mes":null,"modo":"ao_concluir","fim":null}'::jsonb,
    jsonb_build_object('titulo', 'A standalone', 'descricao', null, 'descricao_rich', null, 'status', 'pendente',
                       'responsavel_id', null, 'cliente_id', null, 'data_limite', '2026-01-06'),
    '{}'::bigint[], '{}'::text[], v_tarefa_a2);
  perform 1 from tarefas where id = v_tarefa_a2 and serie_id is not null;
  assert found, 'promotion through the RPC did not link the task';
  execute 'reset role';

  -- a session with no workspace raises
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_rejected := false;
  begin
    perform public.tarefa_serie_definir_estado(v_serie_a, 'pausar');
  exception when others then v_rejected := true; end;
  assert v_rejected, 'RPC ran without an active workspace';
  execute 'reset role';
```

In `99_tarefa_series_geracao.sql`, replace the line `  -- RPC_BLOCK (Task 4 appends here)` with:

```sql
  -- ---- RPCs (fresh workspace: the previous one was deleted in (k)) ----
  v_ws := et_make_workspace('start');
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user;
  insert into membros (user_id, conta_id, nome) values (v_user, v_ws, 'M2') returning id into v_membro;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_user, v_ws, 'C2', 'C2', '#000') returning id into v_cli;
  insert into tarefa_tags (conta_id, nome) values (v_ws, 'u1') returning id into v_tag1;
  insert into tarefa_tags (conta_id, nome) values (v_ws, 'u2') returning id into v_tag2;
  perform set_config('app.tarefa_hoje', '2026-01-05', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  -- (a) criar: series + first occurrence with tags and subtasks in one call
  select serie_id, tarefa_id into v_serie, v_t1 from public.tarefa_serie_criar(
    '{"freq":"weekly","intervalo":1,"dias_semana":[1],"dia_mes":null,"mes":null,"modo":"ao_concluir","fim":null}'::jsonb,
    jsonb_build_object('titulo', 'Semanal', 'descricao', 'd', 'descricao_rich', null, 'status', 'pendente',
                       'responsavel_id', v_membro, 'cliente_id', v_cli, 'data_limite', '2026-01-05'),
    array[v_tag1, v_tag2], array['Passo 1', 'Passo 2']);
  assert v_serie is not null and v_t1 is not null, '(a) criar returned nulls';
  perform 1 from tarefas where id = v_t1 and serie_id = v_serie and data_limite = '2026-01-05' and status = 'pendente';
  assert found, '(a) first occurrence not linked or wrong date';
  select count(*) into v_n from subtarefas where tarefa_id = v_t1; assert v_n = 2, '(a) subtasks not created';
  select count(*) into v_n from tarefa_tag_links where tarefa_id = v_t1; assert v_n = 2, '(a) tag links not created';
  perform 1 from tarefa_series where id = v_serie and subtarefas = '["Passo 1", "Passo 2"]'::jsonb and tag_ids = array[v_tag1, v_tag2];
  assert found, '(a) template not stored';

  -- (a) promotion links an existing open standalone task and snapshots its subtasks
  insert into tarefas (conta_id, user_id, titulo, status, data_limite) values (v_ws, v_user, 'Solta', 'pendente', '2026-01-06') returning id into v_t2;
  insert into subtarefas (tarefa_id, conta_id, titulo, ordem) values (v_t2, v_ws, 'Existente', 0);
  select serie_id into v_n from public.tarefa_serie_criar(
    '{"freq":"daily","intervalo":2,"dias_semana":null,"dia_mes":null,"mes":null,"modo":"calendario","fim":null}'::jsonb,
    jsonb_build_object('titulo', 'Solta', 'descricao', null, 'descricao_rich', null, 'status', 'pendente',
                       'responsavel_id', null, 'cliente_id', null, 'data_limite', '2026-01-06'),
    '{}'::bigint[], '{}'::text[], v_t2);
  perform 1 from tarefas where id = v_t2 and serie_id = v_n;
  assert found, '(a) promotion did not link';
  perform 1 from tarefa_series where id = v_n and subtarefas = '["Existente"]'::jsonb and inicio = '2026-01-06' and proxima_data = '2026-01-08';
  assert found, '(a) promotion did not snapshot subtasks / cursor';

  -- (a) promotion rejects a concluida task and a task already in a series
  insert into tarefas (conta_id, user_id, titulo, status, data_limite) values (v_ws, v_user, 'Feita', 'concluida', '2026-01-06') returning id into v_t3;
  v_rejected := false;
  begin
    perform public.tarefa_serie_criar(
      '{"freq":"daily","intervalo":1,"dias_semana":null,"dia_mes":null,"mes":null,"modo":"ao_concluir","fim":null}'::jsonb,
      jsonb_build_object('titulo', 'Feita', 'descricao', null, 'descricao_rich', null, 'status', 'concluida',
                         'responsavel_id', null, 'cliente_id', null, 'data_limite', '2026-01-06'),
      '{}'::bigint[], '{}'::text[], v_t3);
  exception when others then v_rejected := true; end;
  assert v_rejected, '(a) promotion accepted a concluida task';
  v_rejected := false;
  begin
    perform public.tarefa_serie_criar(
      '{"freq":"daily","intervalo":1,"dias_semana":null,"dia_mes":null,"mes":null,"modo":"ao_concluir","fim":null}'::jsonb,
      jsonb_build_object('titulo', 'Solta', 'descricao', null, 'descricao_rich', null, 'status', 'pendente',
                         'responsavel_id', null, 'cliente_id', null, 'data_limite', '2026-01-06'),
      '{}'::bigint[], '{}'::text[], v_t2);
  exception when others then v_rejected := true; end;
  assert v_rejected, '(a) promotion accepted a task that is already an occurrence';

  -- (n) aplicar_edicao that completes and changes the template creates the next from the NEW template
  perform public.tarefa_serie_aplicar_edicao(v_t1,
    jsonb_build_object('titulo', 'Semanal v2', 'descricao', null, 'descricao_rich', null, 'status', 'concluida',
                       'responsavel_id', null, 'cliente_id', null, 'data_limite', '2026-01-05'),
    array[v_tag1],
    '{"freq":"weekly","intervalo":1,"dias_semana":[1],"dia_mes":null,"mes":null,"modo":"ao_concluir","fim":null}'::jsonb,
    false);
  select id, data_limite into v_t3, v_date from tarefas where serie_id = v_serie and status <> 'concluida';
  assert v_date = '2026-01-12', format('(n) expected next 2026-01-12, got %s', v_date);
  perform 1 from tarefas where id = v_t3 and titulo = 'Semanal v2' and responsavel_id is null;
  assert found, '(n) next occurrence not built from the new template';
  select count(*) into v_n from tarefa_tag_links where tarefa_id = v_t3; assert v_n = 1, '(n) new tag set not applied';

  -- (n) "Somente esta" change (direct update) then aplicar_edicao promotes that state
  update tarefas set titulo = 'Semanal v3' where id = v_t3;
  perform public.tarefa_serie_aplicar_edicao(v_t3,
    jsonb_build_object('titulo', 'Semanal v3', 'descricao', null, 'descricao_rich', null, 'status', 'pendente',
                       'responsavel_id', null, 'cliente_id', null, 'data_limite', '2026-01-12'),
    array[v_tag1],
    '{"freq":"weekly","intervalo":1,"dias_semana":[1],"dia_mes":null,"mes":null,"modo":"ao_concluir","fim":null}'::jsonb,
    false);
  perform 1 from tarefa_series where id = v_serie and titulo = 'Semanal v3';
  assert found, '(n) template did not take the occurrence state';

  -- (n) moving the due date re-anchors inicio; fim before it is rejected
  perform public.tarefa_serie_aplicar_edicao(v_t3,
    jsonb_build_object('titulo', 'Semanal v3', 'descricao', null, 'descricao_rich', null, 'status', 'pendente',
                       'responsavel_id', null, 'cliente_id', null, 'data_limite', '2026-01-14'),
    array[v_tag1],
    '{"freq":"weekly","intervalo":1,"dias_semana":[1],"dia_mes":null,"mes":null,"modo":"ao_concluir","fim":null}'::jsonb,
    false);
  perform 1 from tarefa_series where id = v_serie and inicio = '2026-01-14';
  assert found, '(n) inicio not re-anchored on the new due date';
  v_rejected := false;
  begin
    perform public.tarefa_serie_aplicar_edicao(v_t3,
      jsonb_build_object('titulo', 'Semanal v3', 'descricao', null, 'descricao_rich', null, 'status', 'pendente',
                         'responsavel_id', null, 'cliente_id', null, 'data_limite', '2026-01-14'),
      array[v_tag1],
      '{"freq":"weekly","intervalo":1,"dias_semana":[1],"dia_mes":null,"mes":null,"modo":"ao_concluir","fim":"2026-01-13"}'::jsonb,
      false);
  exception when others then v_rejected := true; end;
  assert v_rejected, '(n) fim before the due date accepted';

  -- (o) re-anchoring on a clamped date keeps dia_mes/mes (cases 19/20 end to end)
  select serie_id, tarefa_id into v_n, v_t2 from public.tarefa_serie_criar(
    '{"freq":"monthly","intervalo":1,"dias_semana":null,"dia_mes":31,"mes":null,"modo":"ao_concluir","fim":null}'::jsonb,
    jsonb_build_object('titulo', 'Fechamento', 'descricao', null, 'descricao_rich', null, 'status', 'pendente',
                       'responsavel_id', null, 'cliente_id', null, 'data_limite', '2026-01-31'),
    '{}'::bigint[], '{}'::text[]);
  update tarefas set status = 'concluida' where id = v_t2;            -- spawns 2026-02-28
  select id, data_limite into v_t3, v_date from tarefas where serie_id = v_n and status <> 'concluida';
  assert v_date = '2026-02-28', format('(o) expected 2026-02-28, got %s', v_date);
  perform public.tarefa_serie_aplicar_edicao(v_t3,
    jsonb_build_object('titulo', 'Fechamento', 'descricao', null, 'descricao_rich', null, 'status', 'concluida',
                       'responsavel_id', null, 'cliente_id', null, 'data_limite', '2026-02-28'),
    '{}'::bigint[],
    '{"freq":"monthly","intervalo":1,"dias_semana":null,"dia_mes":31,"mes":null,"modo":"ao_concluir","fim":null}'::jsonb,
    false);
  select data_limite into v_date from tarefas where serie_id = v_n and status <> 'concluida';
  assert v_date = '2026-03-31', format('(o) expected 2026-03-31 after re-anchoring on 02-28, got %s', v_date);

  -- (n) completing with p_encerrar creates nothing and detaches the occurrence.
  -- v_t3 (the 02-28 occurrence) is concluida from (o): reopen it first through
  -- the same RPC, then complete it with p_encerrar.
  perform public.tarefa_serie_aplicar_edicao(v_t3,
    jsonb_build_object('titulo', 'Fechamento', 'descricao', null, 'descricao_rich', null, 'status', 'pendente',
                       'responsavel_id', null, 'cliente_id', null, 'data_limite', '2026-02-28'),
    '{}'::bigint[],
    '{"freq":"monthly","intervalo":1,"dias_semana":null,"dia_mes":31,"mes":null,"modo":"ao_concluir","fim":null}'::jsonb,
    false);
  select serie_id into v_serie from tarefas where id = v_t3;
  perform public.tarefa_serie_aplicar_edicao(v_t3,
    jsonb_build_object('titulo', 'Fechamento', 'descricao', null, 'descricao_rich', null, 'status', 'concluida',
                       'responsavel_id', null, 'cliente_id', null, 'data_limite', '2026-02-28'),
    '{}'::bigint[],
    '{"freq":"monthly","intervalo":1,"dias_semana":null,"dia_mes":31,"mes":null,"modo":"ao_concluir","fim":null}'::jsonb,
    true);
  perform 1 from tarefas where id = v_t3 and serie_id is null and status = 'concluida';
  assert found, '(n) p_encerrar did not detach the occurrence';
  perform 1 from tarefa_series where id = v_serie and encerrada_em is not null;
  assert found, '(n) p_encerrar did not end the series';
  select count(*) into v_n from tarefas where serie_id = v_serie and status <> 'concluida' and data_limite > '2026-03-31';
  assert v_n = 0, '(n) p_encerrar spawned an occurrence';

  -- (n2) definir_estado per the states table; encerrar twice raises
  select serie_id, tarefa_id into v_serie, v_t1 from public.tarefa_serie_criar(
    '{"freq":"daily","intervalo":1,"dias_semana":null,"dia_mes":null,"mes":null,"modo":"ao_concluir","fim":null}'::jsonb,
    jsonb_build_object('titulo', 'Diaria', 'descricao', null, 'descricao_rich', null, 'status', 'pendente',
                       'responsavel_id', null, 'cliente_id', null, 'data_limite', '2026-01-05'),
    '{}'::bigint[], '{}'::text[]);
  perform public.tarefa_serie_definir_estado(v_serie, 'pausar');
  perform 1 from tarefa_series where id = v_serie and pausada; assert found, '(n2) pausar failed';
  update tarefas set status = 'concluida' where id = v_t1;
  assert pg_temp.et_abertas(v_serie) = 0, '(n2) paused series generated';
  perform public.tarefa_serie_definir_estado(v_serie, 'retomar');
  assert pg_temp.et_abertas(v_serie) = 1, '(n2) resume did not generate';
  perform public.tarefa_serie_definir_estado(v_serie, 'encerrar');
  perform 1 from tarefa_series where id = v_serie and encerrada_em is not null; assert found, '(n2) encerrar failed';
  v_rejected := false;
  begin
    perform public.tarefa_serie_definir_estado(v_serie, 'encerrar');
  exception when others then v_rejected := true; end;
  assert v_rejected, '(n2) encerrar twice did not raise';

  -- (j) excluir deletes open occurrences, keeps completed ones unlinked, spawns nothing
  select serie_id, tarefa_id into v_serie, v_t1 from public.tarefa_serie_criar(
    '{"freq":"daily","intervalo":1,"dias_semana":null,"dia_mes":null,"mes":null,"modo":"ao_concluir","fim":null}'::jsonb,
    jsonb_build_object('titulo', 'Apagar', 'descricao', null, 'descricao_rich', null, 'status', 'pendente',
                       'responsavel_id', null, 'cliente_id', null, 'data_limite', '2026-01-05'),
    '{}'::bigint[], '{}'::text[]);
  update tarefas set status = 'concluida' where id = v_t1;            -- spawns 01-06
  perform public.tarefa_serie_excluir(v_serie);
  select count(*) into v_n from tarefas where serie_id = v_serie; assert v_n = 0, '(j) rows still linked after excluir';
  perform 1 from tarefas where id = v_t1 and serie_id is null and status = 'concluida';
  assert found, '(j) completed occurrence was deleted or stayed linked';
  select count(*) into v_n from tarefas where titulo = 'Apagar' and status <> 'concluida'; assert v_n = 0, '(j) open occurrence survived excluir';
  perform 1 from tarefa_series where id = v_serie; assert not found, '(j) series row survived excluir';

  execute 'reset role';
```

Run both suites; expected first error: `ERROR:  function public.tarefa_serie_criar(jsonb, jsonb, bigint[], text[], bigint) does not exist`.

- [ ] **Step 2: Append section 4 to the migration**

```sql
-- ============ (4) CLIENT-FACING RPCs ============

-- Tenant validation shared by the RPCs: responsavel/cliente must live in the
-- caller's workspace (resolve_notification_targets reads membros by id
-- without a conta_id check, and generated occurrences inherit the template).
CREATE OR REPLACE FUNCTION public.tarefa_serie_validar_refs(p_conta uuid, p_responsavel_id bigint, p_cliente_id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_responsavel_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM membros WHERE id = p_responsavel_id AND conta_id = p_conta) THEN
    RAISE EXCEPTION 'Responsável não encontrado neste workspace.';
  END IF;
  IF p_cliente_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM clientes WHERE id = p_cliente_id AND conta_id = p_conta) THEN
    RAISE EXCEPTION 'Cliente não encontrado neste workspace.';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.tarefa_serie_validar_refs(uuid, bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tarefa_serie_validar_refs(uuid, bigint, bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.tarefa_serie_criar(
  p_serie jsonb, p_tarefa jsonb, p_tag_ids bigint[], p_subtarefas text[], p_tarefa_id bigint DEFAULT NULL
) RETURNS TABLE (serie_id bigint, tarefa_id bigint)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta uuid := get_my_conta_id();
  v_user uuid := auth.uid();
  v_hoje date := tarefa_hoje_sp();
  v_inicio date;
  v_fim date;
  v_resp bigint;
  v_cli bigint;
  v_tags bigint[];
  v_subs text[];
  v_titulo text;
  v_descricao text;
  v_rich jsonb;
  v_existing record;
  v_serie_id bigint;
  v_tarefa_id bigint;
BEGIN
  IF v_conta IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'Sessao sem workspace ativo.'; END IF;

  v_inicio := (p_tarefa->>'data_limite')::date;
  IF v_inicio IS NULL THEN RAISE EXCEPTION 'Tarefas de uma série precisam de prazo.'; END IF;
  IF v_inicio < v_hoje THEN RAISE EXCEPTION 'Para repetir, o prazo precisa ser hoje ou depois.'; END IF;
  v_fim := (p_serie->>'fim')::date;
  IF v_fim IS NOT NULL AND v_fim < v_inicio THEN
    RAISE EXCEPTION 'A data final precisa ser igual ou depois do prazo.';
  END IF;

  v_resp := (p_tarefa->>'responsavel_id')::bigint;
  v_cli := (p_tarefa->>'cliente_id')::bigint;
  PERFORM tarefa_serie_validar_refs(v_conta, v_resp, v_cli);
  SELECT coalesce(array_agg(t.id ORDER BY t.id), '{}') INTO v_tags
    FROM tarefa_tags t WHERE t.id = ANY (coalesce(p_tag_ids, '{}')) AND t.conta_id = v_conta;
  v_subs := coalesce(p_subtarefas, '{}');
  v_titulo := btrim(coalesce(p_tarefa->>'titulo', ''));
  v_descricao := NULLIF(btrim(coalesce(p_tarefa->>'descricao', '')), '');
  v_rich := NULLIF(p_tarefa->'descricao_rich', 'null'::jsonb);

  -- RETURNS TABLE (serie_id, tarefa_id) makes `serie_id` and `tarefa_id`
  -- plpgsql variables, and plpgsql.variable_conflict defaults to `error`.
  -- Every bare column reference to those names below is therefore
  -- table-qualified (t.serie_id, st.tarefa_id, l.tarefa_id); the aliases are
  -- load-bearing, not style.
  IF p_tarefa_id IS NOT NULL THEN
    -- promotion: lock first, then validate
    SELECT t.id, t.serie_id, t.status INTO v_existing
      FROM tarefas t WHERE t.id = p_tarefa_id AND t.conta_id = v_conta FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Tarefa não encontrada neste workspace.'; END IF;
    IF v_existing.serie_id IS NOT NULL THEN RAISE EXCEPTION 'Esta tarefa já pertence a uma série.'; END IF;
    IF v_existing.status = 'concluida' THEN RAISE EXCEPTION 'Reabra a tarefa para torná-la recorrente.'; END IF;
    SELECT coalesce(array_agg(st.titulo ORDER BY st.ordem, st.id), '{}') INTO v_subs
      FROM subtarefas st WHERE st.tarefa_id = p_tarefa_id AND btrim(st.titulo) <> '';
  END IF;

  INSERT INTO tarefa_series (conta_id, user_id, freq, intervalo, dias_semana, dia_mes, mes, modo, inicio, fim,
                             titulo, descricao, descricao_rich, responsavel_id, cliente_id, tag_ids, subtarefas)
  VALUES (v_conta, v_user, p_serie->>'freq', coalesce((p_serie->>'intervalo')::int, 1),
          tarefa_serie_jsonb_int_array(p_serie->'dias_semana'),
          (p_serie->>'dia_mes')::int, (p_serie->>'mes')::int, p_serie->>'modo', v_inicio, v_fim,
          v_titulo, v_descricao, v_rich, v_resp, v_cli, v_tags, to_jsonb(v_subs))
  RETURNING id INTO v_serie_id;

  IF p_tarefa_id IS NULL THEN
    INSERT INTO tarefas (conta_id, user_id, titulo, descricao, descricao_rich, status,
                         responsavel_id, cliente_id, data_limite, serie_id)
    VALUES (v_conta, v_user, v_titulo, v_descricao, v_rich, 'pendente', v_resp, v_cli, v_inicio, v_serie_id)
    RETURNING id INTO v_tarefa_id;
    INSERT INTO subtarefas (tarefa_id, conta_id, titulo, concluida, ordem)
    SELECT v_tarefa_id, v_conta, s.t, false, (s.o - 1)::int
      FROM unnest(v_subs) WITH ORDINALITY AS s(t, o);
  ELSE
    v_tarefa_id := p_tarefa_id;
    UPDATE tarefas t
       SET titulo = v_titulo, descricao = v_descricao, descricao_rich = v_rich,
           status = coalesce(p_tarefa->>'status', t.status),
           responsavel_id = v_resp, cliente_id = v_cli, data_limite = v_inicio, serie_id = v_serie_id
     WHERE t.id = p_tarefa_id;
    DELETE FROM tarefa_tag_links l WHERE l.tarefa_id = p_tarefa_id;
  END IF;

  INSERT INTO tarefa_tag_links (tarefa_id, tag_id, conta_id)
  SELECT v_tarefa_id, tg, v_conta FROM unnest(v_tags) tg;

  -- plpgsql assignments to the OUT columns (not SQL): unaffected by the rule above
  serie_id := v_serie_id;
  tarefa_id := v_tarefa_id;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.tarefa_serie_aplicar_edicao(
  p_tarefa_id bigint, p_tarefa jsonb, p_tag_ids bigint[], p_regra jsonb, p_encerrar boolean DEFAULT false
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta uuid := get_my_conta_id();
  v_user uuid := auth.uid();
  v_t record;
  v_data date;
  v_fim date;
  v_resp bigint;
  v_cli bigint;
  v_tags bigint[];
  v_subs text[];
  v_titulo text;
  v_descricao text;
  v_rich jsonb;
BEGIN
  IF v_conta IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'Sessao sem workspace ativo.'; END IF;

  -- (0) lock the occurrence and the series; effective due date up front
  SELECT id, serie_id, data_limite INTO v_t
    FROM tarefas WHERE id = p_tarefa_id AND conta_id = v_conta FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tarefa não encontrada neste workspace.'; END IF;
  IF v_t.serie_id IS NULL THEN RAISE EXCEPTION 'Esta tarefa não pertence a uma série.'; END IF;
  PERFORM 1 FROM tarefa_series WHERE id = v_t.serie_id AND conta_id = v_conta FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Série não encontrada neste workspace.'; END IF;
  v_data := coalesce((p_tarefa->>'data_limite')::date, v_t.data_limite);
  IF v_data IS NULL THEN RAISE EXCEPTION 'Tarefas de uma série precisam de prazo.'; END IF;

  v_resp := (p_tarefa->>'responsavel_id')::bigint;
  v_cli := (p_tarefa->>'cliente_id')::bigint;
  PERFORM tarefa_serie_validar_refs(v_conta, v_resp, v_cli);
  SELECT coalesce(array_agg(t.id ORDER BY t.id), '{}') INTO v_tags
    FROM tarefa_tags t WHERE t.id = ANY (coalesce(p_tag_ids, '{}')) AND t.conta_id = v_conta;
  SELECT coalesce(array_agg(titulo ORDER BY ordem, id), '{}') INTO v_subs
    FROM subtarefas WHERE tarefa_id = p_tarefa_id AND btrim(titulo) <> '';
  v_titulo := btrim(coalesce(p_tarefa->>'titulo', ''));
  v_descricao := NULLIF(btrim(coalesce(p_tarefa->>'descricao', '')), '');
  v_rich := NULLIF(p_tarefa->'descricao_rich', 'null'::jsonb);

  -- (1) series first, so the completion trigger in (2) sees the new template / closed series
  IF p_encerrar THEN
    UPDATE tarefa_series SET encerrada_em = coalesce(encerrada_em, now()) WHERE id = v_t.serie_id;
  ELSE
    v_fim := (p_regra->>'fim')::date;
    IF v_fim IS NOT NULL AND v_fim < v_data THEN
      RAISE EXCEPTION 'A data final precisa ser igual ou depois do prazo.';
    END IF;
    UPDATE tarefa_series
       SET freq = p_regra->>'freq',
           intervalo = coalesce((p_regra->>'intervalo')::int, 1),
           dias_semana = tarefa_serie_jsonb_int_array(p_regra->'dias_semana'),
           dia_mes = (p_regra->>'dia_mes')::int,
           mes = (p_regra->>'mes')::int,
           modo = p_regra->>'modo',
           inicio = v_data,          -- re-anchors the phase; dia_mes/mes come from p_regra
           fim = v_fim,
           titulo = v_titulo, descricao = v_descricao, descricao_rich = v_rich,
           responsavel_id = v_resp, cliente_id = v_cli,
           tag_ids = v_tags, subtarefas = to_jsonb(v_subs)
     WHERE id = v_t.serie_id;
  END IF;

  -- (2) the occurrence (status included: the completion trigger fires here)
  UPDATE tarefas
     SET titulo = v_titulo, descricao = v_descricao, descricao_rich = v_rich,
         status = coalesce(p_tarefa->>'status', status),
         responsavel_id = v_resp, cliente_id = v_cli, data_limite = v_data,
         serie_id = CASE WHEN p_encerrar THEN NULL ELSE serie_id END
   WHERE id = p_tarefa_id;

  -- (3) tags of this occurrence; its subtasks are untouched
  DELETE FROM tarefa_tag_links WHERE tarefa_id = p_tarefa_id;
  INSERT INTO tarefa_tag_links (tarefa_id, tag_id, conta_id)
  SELECT p_tarefa_id, t, v_conta FROM unnest(v_tags) t;
END;
$$;

CREATE OR REPLACE FUNCTION public.tarefa_serie_definir_estado(p_serie_id bigint, p_estado text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta uuid := get_my_conta_id();
  v_user uuid := auth.uid();
  v_encerrada timestamptz;
BEGIN
  IF v_conta IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'Sessao sem workspace ativo.'; END IF;
  IF p_estado NOT IN ('pausar', 'retomar', 'encerrar') THEN RAISE EXCEPTION 'Estado inválido.'; END IF;
  SELECT encerrada_em INTO v_encerrada
    FROM tarefa_series WHERE id = p_serie_id AND conta_id = v_conta FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Série não encontrada neste workspace.'; END IF;
  IF v_encerrada IS NOT NULL THEN RAISE EXCEPTION 'Esta série já foi encerrada.'; END IF;
  IF p_estado = 'pausar' THEN
    UPDATE tarefa_series SET pausada = true WHERE id = p_serie_id;
  ELSIF p_estado = 'retomar' THEN
    UPDATE tarefa_series SET pausada = false WHERE id = p_serie_id;   -- guard + apos_retomar do the rest
  ELSE
    UPDATE tarefa_series SET encerrada_em = now() WHERE id = p_serie_id;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.tarefa_serie_excluir(p_serie_id bigint) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conta uuid := get_my_conta_id();
  v_user uuid := auth.uid();
BEGIN
  IF v_conta IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'Sessao sem workspace ativo.'; END IF;
  PERFORM 1 FROM tarefa_series WHERE id = p_serie_id AND conta_id = v_conta FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Série não encontrada neste workspace.'; END IF;
  -- mandatory order: end (disarms the delete trigger) -> delete open -> delete series
  UPDATE tarefa_series SET encerrada_em = coalesce(encerrada_em, now()) WHERE id = p_serie_id;
  DELETE FROM tarefas WHERE serie_id = p_serie_id AND status <> 'concluida';
  DELETE FROM tarefa_series WHERE id = p_serie_id;   -- FK SET NULL unlinks the completed ones
END;
$$;

REVOKE ALL ON FUNCTION public.tarefa_serie_criar(jsonb, jsonb, bigint[], text[], bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tarefa_serie_criar(jsonb, jsonb, bigint[], text[], bigint) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.tarefa_serie_aplicar_edicao(bigint, jsonb, bigint[], jsonb, boolean) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tarefa_serie_aplicar_edicao(bigint, jsonb, bigint[], jsonb, boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.tarefa_serie_definir_estado(bigint, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tarefa_serie_definir_estado(bigint, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.tarefa_serie_excluir(bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tarefa_serie_excluir(bigint) TO authenticated, service_role;
```

- [ ] **Step 3: Run both suites**

Run: `npx supabase db reset && for f in 99_tarefa_series_rls 99_tarefa_series_geracao; do psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -v ON_ERROR_STOP=1 -f supabase/tests/entitlements/$f.sql || break; done`
Expected: `NOTICE:  PASS 99_tarefa_series_rls` and `NOTICE:  PASS 99_tarefa_series_geracao`.

Two things to expect while making (n)/(o) pass: `get_my_conta_id()` reads `profiles.active_workspace_id`, so the `update profiles ...` line in the block is what makes the RPC find the workspace; and in (o) the second occurrence is completed through `aplicar_edicao` with `data_limite = 2026-02-28`, so `inicio` becomes 02-28 while `dia_mes` stays 31, and the trigger computes `tarefa_next_date('monthly', 1, NULL, 31, NULL, '2026-02-28', greatest('2026-02-28', today))`. `today` is still 2026-01-05 at that moment, so the result is 2026-03-31 (case 19).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260925000030_tarefa_series.sql supabase/tests/entitlements/99_tarefa_series_rls.sql supabase/tests/entitlements/99_tarefa_series_geracao.sql
git commit -m "feat(tarefas): series RPCs (criar, aplicar_edicao, definir_estado, excluir)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `generate_recurring_tarefas()`, the cron schedule, rollback notes and the 96_ lockdown list

Spec: "`calendario` mode" (including the owner-confirmed latest-only catch-up and the `fim` cap), "Schedule", "Rollback", "Security and grants".

**Files:**
- Modify: `supabase/migrations/20260925000030_tarefa_series.sql` (append section 5)
- Create: `supabase/migrations/20260925000031_schedule_tarefas_recorrentes_cron.sql`
- Modify: `supabase/tests/entitlements/99_tarefa_series_geracao.sql` (replace the `-- CALENDARIO_BLOCK` marker)
- Modify: `supabase/tests/entitlements/96_lockdown_definer_function_grants.sql:58` (array tail)

**Interfaces:**
- Consumes: `tarefa_prev_date`, `tarefa_next_date`, `tarefa_hoje_sp`, `tarefa_serie_materializar`, the guard's `app.tarefa_cursor_writer` contract.
- Produces: `public.generate_recurring_tarefas() RETURNS TABLE (series_processadas int, ocorrencias_criadas int)` (DEFINER, service_role only) and pg_cron job `tarefas-recorrentes-generate` (`7 * * * *`).

- [ ] **Step 1: Extend the generation suite (failing)**

Replace the line `  -- CALENDARIO_BLOCK (Task 5 appends here)` in `99_tarefa_series_geracao.sql` with:

```sql
  -- ---- calendario generator (as the owner: the job runs as postgres) ----
  perform set_config('app.tarefa_hoje', '2026-01-05', true);

  -- (i) cursor on INSERT strictly after inicio
  insert into tarefa_series (conta_id, user_id, freq, modo, inicio, titulo)
    values (v_ws, v_user, 'daily', 'calendario', '2026-01-05', 'Cal daily') returning id into v_serie;
  select proxima_data into v_date from tarefa_series where id = v_serie;
  assert v_date = '2026-01-06', format('(i) cursor expected 2026-01-06, got %s', v_date);

  -- (i) cursor 10 days back: only the most recent due date, cursor moves past today.
  -- Assertions count per series: the promoted "Solta" calendario series from (a)
  -- is also due on this run, so the function's total is not what is under test.
  perform set_config('app.tarefa_hoje', '2026-01-16', true);
  perform public.generate_recurring_tarefas();
  select count(*) into v_n from tarefas where serie_id = v_serie;
  assert v_n = 1, format('(i) expected 1 occurrence, got %s', v_n);
  select data_limite into v_date from tarefas where serie_id = v_serie;
  assert v_date = '2026-01-16', format('(i) expected the occurrence on 2026-01-16, got %s', v_date);
  select proxima_data into v_date from tarefa_series where id = v_serie;
  assert v_date = '2026-01-17', format('(i) cursor expected 2026-01-17, got %s', v_date);
  -- second call creates 0
  select ocorrencias_criadas into v_n from public.generate_recurring_tarefas();
  assert v_n = 0, format('(i) second run created %s', v_n);

  -- (i) cursor 3 years back (daily): exactly one occurrence, instantly
  insert into tarefa_series (conta_id, user_id, freq, modo, inicio, titulo)
    values (v_ws, v_user, 'daily', 'calendario', '2023-01-01', 'Old cal') returning id into v_serie;
  perform public.generate_recurring_tarefas();
  select count(*) into v_n from tarefas where serie_id = v_serie; assert v_n = 1, format('(i) 3-year catch-up expected 1, got %s', v_n);
  select data_limite into v_date from tarefas where serie_id = v_serie; assert v_date = '2026-01-16', '(i) 3-year catch-up wrong date';

  -- (i) fim -> proxima_data NULL after the last eligible date
  insert into tarefa_series (conta_id, user_id, freq, modo, inicio, fim, titulo)
    values (v_ws, v_user, 'daily', 'calendario', '2026-01-16', '2026-01-17', 'Ends soon') returning id into v_serie;
  perform set_config('app.tarefa_hoje', '2026-01-17', true);
  perform public.generate_recurring_tarefas();
  select proxima_data into v_date from tarefa_series where id = v_serie;
  assert v_date is null, format('(i) cursor should be NULL past fim, got %s', v_date);
  select count(*) into v_n from tarefas where serie_id = v_serie and data_limite = '2026-01-17'; assert v_n = 1, '(i) last date before fim missing';

  -- (i) recovery after fim: daily, fim 01-31, cursor 01-25, first run on 02-02 -> exactly 01-31, cursor NULL
  perform set_config('app.tarefa_hoje', '2026-01-24', true);
  insert into tarefa_series (conta_id, user_id, freq, modo, inicio, fim, titulo)
    values (v_ws, v_user, 'daily', 'calendario', '2026-01-24', '2026-01-31', 'Recover') returning id into v_serie;
  select proxima_data into v_date from tarefa_series where id = v_serie; assert v_date = '2026-01-25', '(i) recover: cursor setup';
  perform set_config('app.tarefa_hoje', '2026-02-02', true);
  select ocorrencias_criadas into v_n from public.generate_recurring_tarefas();
  select count(*) into v_n from tarefas where serie_id = v_serie; assert v_n = 1, format('(i) recover: expected 1 occurrence, got %s', v_n);
  select data_limite into v_date from tarefas where serie_id = v_serie; assert v_date = '2026-01-31', format('(i) recover: expected 2026-01-31, got %s', v_date);
  select proxima_data into v_date from tarefa_series where id = v_serie; assert v_date is null, '(i) recover: cursor not NULL';
  select ocorrencias_criadas into v_n from public.generate_recurring_tarefas();
  select count(*) into v_n from tarefas where serie_id = v_serie; assert v_n = 1, '(i) recover: second run created more';

  -- (i) recovery after fim, weekly Monday with fim between rule dates: last rule date <= fim
  perform set_config('app.tarefa_hoje', '2026-01-05', true);
  insert into tarefa_series (conta_id, user_id, freq, dias_semana, modo, inicio, fim, titulo)
    values (v_ws, v_user, 'weekly', '{1}', 'calendario', '2026-01-05', '2026-01-21', 'Recover weekly') returning id into v_serie;
  perform set_config('app.tarefa_hoje', '2026-02-10', true);
  perform public.generate_recurring_tarefas();
  select count(*) into v_n from tarefas where serie_id = v_serie; assert v_n = 1, '(i) recover weekly: expected 1';
  select data_limite into v_date from tarefas where serie_id = v_serie; assert v_date = '2026-01-19', format('(i) recover weekly: expected 2026-01-19, got %s', v_date);
  select proxima_data into v_date from tarefa_series where id = v_serie; assert v_date is null, '(i) recover weekly: cursor not NULL';

  -- (i) fim before the run day but cursor == fim still materializes it
  perform set_config('app.tarefa_hoje', '2026-01-05', true);
  insert into tarefa_series (conta_id, user_id, freq, modo, inicio, fim, titulo)
    values (v_ws, v_user, 'daily', 'calendario', '2026-01-05', '2026-01-06', 'Cursor is fim') returning id into v_serie;
  select proxima_data into v_date from tarefa_series where id = v_serie; assert v_date = '2026-01-06', '(i) cursor==fim setup';
  perform set_config('app.tarefa_hoje', '2026-01-09', true);
  perform public.generate_recurring_tarefas();
  select count(*) into v_n from tarefas where serie_id = v_serie and data_limite = '2026-01-06'; assert v_n = 1, '(i) cursor==fim not materialized';
  select proxima_data into v_date from tarefa_series where id = v_serie; assert v_date is null, '(i) cursor==fim: cursor not NULL';

  -- (i) a hand-forced bad row (cursor past fim, written with the cron flag as the
  -- owner) is exhausted without raising, and another due series in the same run
  -- is still processed
  perform set_config('app.tarefa_hoje', '2026-03-01', true);
  insert into tarefa_series (conta_id, user_id, freq, modo, inicio, fim, titulo)
    values (v_ws, v_user, 'daily', 'calendario', '2026-03-01', '2026-03-03', 'Bad row') returning id into v_serie;
  perform set_config('app.tarefa_cursor_writer', 'on', true);
  update tarefa_series set proxima_data = '2026-03-08' where id = v_serie;   -- > fim, bypasses normalization on purpose
  perform set_config('app.tarefa_cursor_writer', '', true);
  select proxima_data into v_date from tarefa_series where id = v_serie; assert v_date = '2026-03-08', '(i) bad row setup';
  insert into tarefa_series (conta_id, user_id, freq, modo, inicio, titulo)
    values (v_ws, v_user, 'daily', 'calendario', '2026-03-01', 'Good row') returning id into v_n;
  perform set_config('app.tarefa_hoje', '2026-03-10', true);
  perform public.generate_recurring_tarefas();                                -- must not raise
  select proxima_data into v_date from tarefa_series where id = v_serie; assert v_date is null, '(i) bad row not exhausted';
  select count(*) into v_n from tarefas where serie_id = v_n; assert v_n = 1, '(i) good row not processed in the same run as the bad row';

  -- (l) cursor recompute on pause/resume/rule change and (m) the tarefas CHECK
  -- and UNIQUE are covered in 99_tarefa_series_rls.
```

Run: `psql ... -f supabase/tests/entitlements/99_tarefa_series_geracao.sql`
Expected: `ERROR:  function public.generate_recurring_tarefas() does not exist`

- [ ] **Step 2: Append section 5 to the migration**

```sql
-- ============ (5) CALENDARIO GENERATOR ============

-- Hourly job body. Catch-up creates ONLY the most recent missed date (owner
-- decision, spec "Product decision"). No per-series EXCEPTION block: a
-- failure marks the run failed and cron-health alerts within 70 min.
CREATE OR REPLACE FUNCTION public.generate_recurring_tarefas()
RETURNS TABLE (series_processadas int, ocorrencias_criadas int)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hoje date := tarefa_hoje_sp();
  s record;
  v_d date;
  v_next date;
  v_id bigint;
  v_proc int := 0;
  v_created int := 0;
BEGIN
  -- the only place that may move the cursor through the guard (transaction-local)
  PERFORM set_config('app.tarefa_cursor_writer', 'on', true);

  FOR s IN
    SELECT * FROM tarefa_series
     WHERE modo = 'calendario' AND NOT pausada AND encerrada_em IS NULL
       AND proxima_data IS NOT NULL AND proxima_data <= v_hoje
     FOR UPDATE SKIP LOCKED
  LOOP
    v_proc := v_proc + 1;
    -- most recent rule date <= today AND <= fim. proxima_data is a rule date
    -- <= today and <= fim (the cursor is NULL once it would pass fim), so
    -- v_d >= proxima_data always holds: never skip, always materialize.
    v_d := tarefa_prev_date(s.freq, s.intervalo, s.dias_semana, s.dia_mes, s.mes, s.inicio,
                            least(v_hoje, coalesce(s.fim, v_hoje)));
    IF v_d IS NULL OR v_d < s.proxima_data THEN
      -- A row the guard did not produce (hand-edited cursor past fim, or a
      -- rule changed underneath it). Exhausted is a defined state, not an
      -- error: never materialize with a NULL date, never abort the run.
      UPDATE tarefa_series SET proxima_data = NULL WHERE id = s.id;
      CONTINUE;
    END IF;

    v_id := tarefa_serie_materializar(s.id, v_d);
    IF v_id IS NOT NULL THEN v_created := v_created + 1; END IF;

    v_next := tarefa_next_date(s.freq, s.intervalo, s.dias_semana, s.dia_mes, s.mes, s.inicio, v_d);
    IF s.fim IS NOT NULL AND v_next > s.fim THEN v_next := NULL; END IF;
    UPDATE tarefa_series SET proxima_data = v_next WHERE id = s.id;
  END LOOP;

  PERFORM set_config('app.tarefa_cursor_writer', '', true);
  series_processadas := v_proc;
  ocorrencias_criadas := v_created;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_recurring_tarefas() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_recurring_tarefas() TO service_role;
```

Create `supabase/migrations/20260925000031_schedule_tarefas_recorrentes_cron.sql`:

```sql
-- Hourly generation of calendario occurrences (spec: "Schedule"). Hourly, not
-- daily: idempotent, partial-index scan, bounds the wait after a failed run
-- to 1h, and today's occurrence appears on the first run after midnight in
-- Sao Paulo (00:07). Pattern of 20260831000001_schedule_rate_limit_cleanup.
-- No cron-health registration exists or is needed: a failed run shows up in
-- cron.job_run_details and recent_cron_failures() alerts on it.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'tarefas-recorrentes-generate') THEN
    PERFORM cron.unschedule('tarefas-recorrentes-generate');
  END IF;
END $$;

SELECT cron.schedule('tarefas-recorrentes-generate', '7 * * * *', $$SELECT public.generate_recurring_tarefas()$$);

-- Rollback (run by hand, in this order, so the job never calls a dropped object):
--   SELECT cron.unschedule('tarefas-recorrentes-generate');
--   DROP TRIGGER tarefas_serie_ao_concluir ON tarefas; DROP TRIGGER tarefas_serie_ao_excluir ON tarefas;
--   DROP TRIGGER tarefas_serie_id_guard ON tarefas;
--   DROP TRIGGER tarefa_series_guard ON tarefa_series; DROP TRIGGER tarefa_series_apos_retomar ON tarefa_series;
--   DROP TRIGGER set_tarefa_series_updated_at ON tarefa_series;
--   DROP FUNCTION tarefa_serie_criar(jsonb, jsonb, bigint[], text[], bigint), tarefa_serie_aplicar_edicao(bigint, jsonb, bigint[], jsonb, boolean),
--     tarefa_serie_definir_estado(bigint, text), tarefa_serie_excluir(bigint), generate_recurring_tarefas(),
--     tarefa_serie_garantir_aberta(bigint, date), tarefa_serie_materializar(bigint, date), tarefa_serie_validar_refs(uuid, bigint, bigint),
--     tarefas_serie_ao_concluir_fn(), tarefas_serie_ao_excluir_fn(), tarefa_series_apos_retomar_fn(), tarefas_serie_id_guard(),
--     tarefa_series_guard(), set_tarefa_series_updated_at(), tarefa_serie_subtarefas_validas(jsonb), tarefa_serie_dias_semana_validos(int[]),
--     tarefa_serie_jsonb_int_array(jsonb), tarefa_next_date(text, int, int[], int, int, date, date),
--     tarefa_prev_date(text, int, int[], int, int, date, date), tarefa_month_landing(int, int), tarefa_hoje_sp();
--   ALTER TABLE tarefas DROP CONSTRAINT tarefas_serie_data_uq, DROP CONSTRAINT tarefas_serie_exige_prazo, DROP COLUMN serie_id;
--   (recreate tarefas_tenant_all without the serie_id EXISTS: copy the policy text from 20260730000005_tarefas.sql)
--   DROP TABLE tarefa_series;
--   Then revert the frontend merge.
```

Append the four internal DEFINER names to the array in `96_lockdown_definer_function_grants.sql` (the line `    'public.expire_and_cleanup_invites()'` becomes the four lines below, keeping the last entry without a trailing comma):

```sql
    'public.expire_and_cleanup_invites()',
    'public.tarefa_serie_materializar(bigint, date)',
    'public.tarefa_serie_garantir_aberta(bigint, date)',
    'public.tarefa_serie_validar_refs(uuid, bigint, bigint)',
    'public.generate_recurring_tarefas()'
```

- [ ] **Step 3: Run the full local suite**

Run: `npx supabase db reset && bash scripts/test-entitlements.sh`
Expected: every suite prints its `PASS` line, including `PASS 96_lockdown_definer_function_grants (N functions)` with N four higher than before, `PASS 99_tarefa_next_date ...`, `PASS 99_tarefa_series_rls`, `PASS 99_tarefa_series_geracao`; exit 0.

Then verify the schedule locally:

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'tarefas-recorrentes-generate'"
```
Expected: one row, `7 * * * *`, `active = t`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260925000030_tarefa_series.sql supabase/migrations/20260925000031_schedule_tarefas_recorrentes_cron.sql supabase/tests/entitlements/99_tarefa_series_geracao.sql supabase/tests/entitlements/96_lockdown_definer_function_grants.sql
git commit -m "feat(tarefas): calendario generator with hourly pg_cron schedule

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Store layer (`apps/crm/src/store/tarefas.ts`) with Vitest

Spec: "Frontend (CRM) > Store".

**Files:**
- Modify: `apps/crm/src/store/tarefas.ts` (types near line 14-58; `getTarefas` lines 66-88; new functions appended after `setTarefaTags`)
- Create: `apps/crm/src/store/__tests__/tarefaSeries.test.ts`
- Modify (fixtures, `serie: null`): `apps/crm/src/pages/tarefas/__tests__/BoardView.test.tsx`, `TarefaCard.test.tsx`, `TarefasPage.test.tsx`, `tarefasLogic.test.ts`, `apps/crm/src/pages/dashboard/components/__tests__/TodayCard.test.tsx`, `AgentPendingSection.test.tsx`, `apps/crm/src/pages/dashboard/__tests__/todayAgenda.test.ts`

**Interfaces:**
- Consumes: the RPC contracts of Task 4; `supabase.rpc` from `./core`; `syncMentions` from `./mentions` (already best-effort: it catches and logs, never throws).
- Produces (all exported through `apps/crm/src/store/index.ts`, which already does `export * from './tarefas'`):

```ts
export type TarefaSerieFreq = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type TarefaSerieModo = 'ao_concluir' | 'calendario';
export interface TarefaSerieRegra {
  freq: TarefaSerieFreq;
  intervalo: number;
  dias_semana: number[] | null;   // 0 = Sunday .. 6 = Saturday, weekly only
  dia_mes: number | null;         // monthly + yearly
  mes: number | null;             // yearly
  modo: TarefaSerieModo;
  fim: string | null;             // 'YYYY-MM-DD'
}
export interface TarefaSerieResumo extends TarefaSerieRegra {
  id: number;
  inicio: string;
  pausada: boolean;
  encerrada_em: string | null;
  proxima_data: string | null;
}
export type TarefaSeriePayload = Pick<Tarefa, 'titulo' | 'descricao' | 'descricao_rich' | 'status' | 'responsavel_id' | 'cliente_id' | 'data_limite'>;
export type TarefaSerieEstadoVerbo = 'pausar' | 'retomar' | 'encerrar';
// Tarefa gains `serie_id?: number | null`; TarefaWithRelations gains `serie: TarefaSerieResumo | null`.
export async function criarTarefaSerie(regra: TarefaSerieRegra, tarefa: TarefaSeriePayload, tagIds: number[], subtarefas: string[], tarefaId?: number): Promise<{ serie_id: number; tarefa_id: number }>;
export async function aplicarEdicaoSerie(tarefaId: number, tarefa: TarefaSeriePayload, tagIds: number[], regra: TarefaSerieRegra, encerrar: boolean): Promise<void>;
export async function definirEstadoSerie(serieId: number, verbo: TarefaSerieEstadoVerbo): Promise<void>;
export async function deleteTarefaSerieCompleta(serieId: number): Promise<void>;
export function isSerieDateConflict(e: unknown): boolean;
export function isSerieSemPrazo(e: unknown): boolean;
```

Deviation from the spec's store list: `getTarefaSerie(id)` is not added. The `tarefa_series(...)` embed on `getTarefas()` already carries the whole rule (`TarefaSerieResumo`), which is all the edit form needs; the template columns are never edited from the form (the RPC snapshots them from the occurrence). Nothing else in the spec consumes `getTarefaSerie`.

- [ ] **Step 1: Write the failing store test**

Create `apps/crm/src/store/__tests__/tarefaSeries.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRpc, mockFrom, mockGetContaId, mockGetUserId, mockSyncMentions } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockFrom: vi.fn(),
  mockGetContaId: vi.fn(),
  mockGetUserId: vi.fn(),
  mockSyncMentions: vi.fn(),
}));

vi.mock('../core', () => ({
  supabase: { rpc: mockRpc, from: mockFrom },
  getUserId: mockGetUserId,
  getContaId: mockGetContaId,
  getCurrentProfile: vi.fn(),
  clearProfileCache: vi.fn(),
}));
vi.mock('../mentions', () => ({ syncMentions: mockSyncMentions }));

import {
  aplicarEdicaoSerie,
  criarTarefaSerie,
  definirEstadoSerie,
  deleteTarefaSerieCompleta,
  getTarefas,
  isSerieDateConflict,
  isSerieSemPrazo,
  type TarefaSerieRegra,
} from '../tarefas';

const REGRA: TarefaSerieRegra = {
  freq: 'weekly',
  intervalo: 1,
  dias_semana: [1],
  dia_mes: null,
  mes: null,
  modo: 'ao_concluir',
  fim: null,
};
const PAYLOAD = {
  titulo: 'Relatório',
  descricao: 'oi @[membro:7]',
  descricao_rich: null,
  status: 'pendente' as const,
  responsavel_id: 3,
  cliente_id: null,
  data_limite: '2026-01-05',
};

describe('tarefa series store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSyncMentions.mockResolvedValue(undefined);
  });

  it('criarTarefaSerie calls the RPC with the exact JSON contract and returns the ids', async () => {
    mockRpc.mockResolvedValue({ data: [{ serie_id: 10, tarefa_id: 20 }], error: null });
    const out = await criarTarefaSerie(REGRA, PAYLOAD, [1, 2], ['a', 'b']);
    expect(mockRpc).toHaveBeenCalledWith('tarefa_serie_criar', {
      p_serie: REGRA,
      p_tarefa: PAYLOAD,
      p_tag_ids: [1, 2],
      p_subtarefas: ['a', 'b'],
      p_tarefa_id: null,
    });
    expect(out).toEqual({ serie_id: 10, tarefa_id: 20 });
  });

  it('criarTarefaSerie passes p_tarefa_id for a promotion and syncs mentions after the RPC', async () => {
    mockRpc.mockResolvedValue({ data: [{ serie_id: 10, tarefa_id: 42 }], error: null });
    await criarTarefaSerie(REGRA, PAYLOAD, [], [], 42);
    expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_tarefa_id: 42 });
    expect(mockSyncMentions).toHaveBeenCalledWith('tarefa', 42, [7]);
  });

  it('criarTarefaSerie throws the RPC error (message and code preserved)', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'Para repetir, o prazo precisa ser hoje ou depois.' },
    });
    await expect(criarTarefaSerie(REGRA, PAYLOAD, [], [])).rejects.toMatchObject({
      code: 'P0001',
      message: 'Para repetir, o prazo precisa ser hoje ou depois.',
    });
    expect(mockSyncMentions).not.toHaveBeenCalled();
  });

  it('aplicarEdicaoSerie sends the full payload, full tag set, whole rule and the encerrar flag', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await aplicarEdicaoSerie(42, PAYLOAD, [5], REGRA, true);
    expect(mockRpc).toHaveBeenCalledWith('tarefa_serie_aplicar_edicao', {
      p_tarefa_id: 42,
      p_tarefa: PAYLOAD,
      p_tag_ids: [5],
      p_regra: REGRA,
      p_encerrar: true,
    });
    expect(mockSyncMentions).toHaveBeenCalledWith('tarefa', 42, [7]);
  });

  it('definirEstadoSerie and deleteTarefaSerieCompleta call their RPCs', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await definirEstadoSerie(10, 'pausar');
    expect(mockRpc).toHaveBeenCalledWith('tarefa_serie_definir_estado', { p_serie_id: 10, p_estado: 'pausar' });
    await deleteTarefaSerieCompleta(10);
    expect(mockRpc).toHaveBeenCalledWith('tarefa_serie_excluir', { p_serie_id: 10 });
  });

  it('getTarefas embeds tarefa_series and flattens it into serie', async () => {
    const order = vi.fn().mockResolvedValue({
      data: [
        {
          id: 1,
          titulo: 'x',
          status: 'pendente',
          clientes: null,
          tarefa_tag_links: [],
          subtarefas: [],
          tarefa_series: { id: 9, freq: 'daily', intervalo: 1, dias_semana: null, dia_mes: null, mes: null,
            modo: 'calendario', inicio: '2026-01-05', fim: null, pausada: false, encerrada_em: null, proxima_data: '2026-01-06' },
        },
        { id: 2, titulo: 'y', status: 'pendente', clientes: null, tarefa_tag_links: [], subtarefas: [], tarefa_series: null },
      ],
      error: null,
    });
    const select = vi.fn().mockReturnValue({ order });
    mockFrom.mockReturnValue({ select });
    const rows = await getTarefas();
    expect(select.mock.calls[0][0]).toContain(
      'tarefa_series(id, freq, intervalo, dias_semana, dia_mes, mes, modo, inicio, fim, pausada, encerrada_em, proxima_data)',
    );
    expect(rows[0].serie?.id).toBe(9);
    expect(rows[1].serie).toBeNull();
    expect('tarefa_series' in rows[0]).toBe(false);
  });

  it('isSerieDateConflict / isSerieSemPrazo match the constraint names', () => {
    expect(isSerieDateConflict({ code: '23505', message: 'duplicate key value violates unique constraint "tarefas_serie_data_uq"' })).toBe(true);
    expect(isSerieDateConflict({ code: '23505', message: 'other' })).toBe(false);
    expect(isSerieDateConflict(new Error('x'))).toBe(false);
    expect(isSerieSemPrazo({ code: '23514', message: 'new row violates check constraint "tarefas_serie_exige_prazo"' })).toBe(true);
    expect(isSerieSemPrazo(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run apps/crm/src/store/__tests__/tarefaSeries.test.ts`
Expected: FAIL, `criarTarefaSerie` is not exported (TypeScript/ESM import error).

- [ ] **Step 3: Implement the store changes**

In `apps/crm/src/store/tarefas.ts`:

Add to `Tarefa` (after `concluida_em`):

```ts
  /** Series this occurrence belongs to. Linked/unlinked only by the series RPCs. */
  serie_id?: number | null;
```

Add after the `TarefaTag` interface:

```ts
export type TarefaSerieFreq = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type TarefaSerieModo = 'ao_concluir' | 'calendario';

/** The repeat rule as the RPCs receive it (p_serie / p_regra). */
export interface TarefaSerieRegra {
  freq: TarefaSerieFreq;
  intervalo: number;
  /** 0 = Sunday .. 6 = Saturday. Weekly only, else null. */
  dias_semana: number[] | null;
  /** Landing day (monthly, yearly), else null. Never derived from `inicio`. */
  dia_mes: number | null;
  /** Landing month (yearly), else null. */
  mes: number | null;
  modo: TarefaSerieModo;
  /** 'YYYY-MM-DD', inclusive, or null = never ends. */
  fim: string | null;
}

/** What getTarefas() embeds per occurrence. */
export interface TarefaSerieResumo extends TarefaSerieRegra {
  id: number;
  inicio: string;
  pausada: boolean;
  encerrada_em: string | null;
  proxima_data: string | null;
}

export type TarefaSeriePayload = Pick<
  Tarefa,
  'titulo' | 'descricao' | 'descricao_rich' | 'status' | 'responsavel_id' | 'cliente_id' | 'data_limite'
>;

export type TarefaSerieEstadoVerbo = 'pausar' | 'retomar' | 'encerrar';
```

Change `TarefaWithRelations` and `TarefaRow`:

```ts
export interface TarefaWithRelations extends Tarefa {
  tags: TarefaTag[];
  subtarefas_total: number;
  subtarefas_concluidas: number;
  cliente_nome: string | null;
  cliente_cor: string | null;
  serie: TarefaSerieResumo | null;
}

interface TarefaRow extends Tarefa {
  clientes: { nome: string; cor: string } | null;
  tarefa_tag_links: { tarefa_tags: TarefaTag | null }[] | null;
  subtarefas: { id: number; concluida: boolean }[] | null;
  tarefa_series: TarefaSerieResumo | null;
}
```

Change `getTarefas()`:

```ts
export async function getTarefas(): Promise<TarefaWithRelations[]> {
  const { data, error } = await supabase
    .from('tarefas')
    .select(
      '*, clientes(nome, cor), tarefa_tag_links(tarefa_tags(id, nome, cor)), subtarefas(id, concluida), ' +
        'tarefa_series(id, freq, intervalo, dias_semana, dia_mes, mes, modo, inicio, fim, pausada, encerrada_em, proxima_data)',
    )
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ((data as TarefaRow[]) || []).map((row) => {
    const { clientes, tarefa_tag_links, subtarefas, tarefa_series, ...tarefa } = row;
    const subs = subtarefas || [];
    return {
      ...tarefa,
      tags: (tarefa_tag_links || [])
        .map((l) => l.tarefa_tags)
        .filter((t): t is TarefaTag => t != null),
      subtarefas_total: subs.length,
      subtarefas_concluidas: subs.filter((s) => s.concluida).length,
      cliente_nome: clientes?.nome ?? null,
      cliente_cor: clientes?.cor ?? null,
      serie: tarefa_series ?? null,
    };
  });
}
```

Append after `setTarefaTags`:

```ts
// ---- Series (tarefas recorrentes) ----
// Every write goes through a SECURITY DEFINER RPC; the store never touches
// tarefa_series directly (the table is SELECT-only for authenticated).

/** Creates a series and its first occurrence atomically. With `tarefaId`, promotes
 *  that standalone open task instead (its subtasks are snapshotted server-side).
 *  Mentions are synced best-effort AFTER the RPC (syncMentions never throws). */
export async function criarTarefaSerie(
  regra: TarefaSerieRegra,
  tarefa: TarefaSeriePayload,
  tagIds: number[],
  subtarefas: string[],
  tarefaId?: number,
): Promise<{ serie_id: number; tarefa_id: number }> {
  const { data, error } = await supabase.rpc('tarefa_serie_criar', {
    p_serie: regra,
    p_tarefa: tarefa,
    p_tag_ids: tagIds,
    p_subtarefas: subtarefas,
    p_tarefa_id: tarefaId ?? null,
  });
  if (error) throw error;
  const row = (data as { serie_id: number; tarefa_id: number }[])[0];
  await syncMentions('tarefa', row.tarefa_id, membroMentionIds(tarefa.descricao ?? '', tarefa.descricao_rich));
  return row;
}

/** "Esta e as próximas": full occurrence payload + full tag set + whole rule, no diffing.
 *  `encerrar = true` is "Não repete": ends the series and detaches this occurrence. */
export async function aplicarEdicaoSerie(
  tarefaId: number,
  tarefa: TarefaSeriePayload,
  tagIds: number[],
  regra: TarefaSerieRegra,
  encerrar: boolean,
): Promise<void> {
  const { error } = await supabase.rpc('tarefa_serie_aplicar_edicao', {
    p_tarefa_id: tarefaId,
    p_tarefa: tarefa,
    p_tag_ids: tagIds,
    p_regra: regra,
    p_encerrar: encerrar,
  });
  if (error) throw error;
  await syncMentions('tarefa', tarefaId, membroMentionIds(tarefa.descricao ?? '', tarefa.descricao_rich));
}

export async function definirEstadoSerie(serieId: number, verbo: TarefaSerieEstadoVerbo): Promise<void> {
  const { error } = await supabase.rpc('tarefa_serie_definir_estado', {
    p_serie_id: serieId,
    p_estado: verbo,
  });
  if (error) throw error;
}

/** "Toda a série": ends, deletes open occurrences, deletes the series; completed ones stay as standalone tasks. */
export async function deleteTarefaSerieCompleta(serieId: number): Promise<void> {
  const { error } = await supabase.rpc('tarefa_serie_excluir', { p_serie_id: serieId });
  if (error) throw error;
}

function pgErrorMatches(e: unknown, code: string, constraint: string): boolean {
  if (!e || typeof e !== 'object') return false;
  const { code: c, message } = e as { code?: unknown; message?: unknown };
  return c === code && typeof message === 'string' && message.includes(constraint);
}

/** 23505 on tarefas_serie_data_uq: another occurrence of the same series already has that date. */
export function isSerieDateConflict(e: unknown): boolean {
  return pgErrorMatches(e, '23505', 'tarefas_serie_data_uq');
}

/** 23514 on tarefas_serie_exige_prazo: an occurrence cannot lose its due date. */
export function isSerieSemPrazo(e: unknown): boolean {
  return pgErrorMatches(e, '23514', 'tarefas_serie_exige_prazo');
}
```

- [ ] **Step 4: Add `serie: null` to every `TarefaWithRelations` fixture**

`npx tsc -p apps/crm/tsconfig.json --noEmit` now lists every fixture missing the field. In each of the seven files listed under **Files**, add `serie: null,` right after `cliente_cor: null,` (or wherever `cliente_cor` is set) in the `makeTarefa`/fixture object. Example for `BoardView.test.tsx` line ~61:

```ts
    cliente_nome: null,
    cliente_cor: null,
    serie: null,
    ...overrides,
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `npx vitest run apps/crm/src/store/__tests__/tarefaSeries.test.ts && npx tsc -p apps/crm/tsconfig.json --noEmit && npx vitest run apps/crm/src/pages/tarefas apps/crm/src/pages/dashboard`
Expected: all green, tsc silent.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/store/tarefas.ts apps/crm/src/store/__tests__/tarefaSeries.test.ts apps/crm/src/pages/tarefas/__tests__ apps/crm/src/pages/dashboard
git commit -m "feat(tarefas): series types, embed and RPC wrappers in the store

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: `recorrenciaLogic.ts` (pure) and the shared zod schema

Spec: "`TarefaFormDialog`: Repetir section" (summary strings, validation rules), "Series states".

**Files:**
- Create: `apps/crm/src/pages/tarefas/recorrenciaLogic.ts`
- Create: `apps/crm/src/pages/tarefas/components/tarefaFormSchema.ts`
- Create: `apps/crm/src/pages/tarefas/__tests__/recorrenciaLogic.test.ts`

**Interfaces:**
- Consumes: `TarefaSerieRegra`, `TarefaSerieResumo`, `TarefaSerieFreq`, `TarefaSerieModo` (Task 6); `parseDateOnly`, `toDateOnlyString` from `../tarefasLogic`.
- Produces:

```ts
// recorrenciaLogic.ts
export type RepetirValor = 'never' | TarefaSerieFreq;
export const REPETIR_LABELS: Record<RepetirValor, string>;      // 'Não repete', 'Diariamente', 'Semanalmente', 'Mensalmente', 'Anualmente'
export const WEEKDAY_CHIPS: readonly string[];                    // ['D','S','T','Q','Q','S','S'] indexed by dias_semana value
export const WEEKDAY_NAMES: readonly string[];                    // ['domingo','segunda',...,'sábado']
export function unidadeIntervalo(freq: TarefaSerieFreq, n: number): string; // 'dia(s)' | 'semana(s)' | 'mês/meses' | 'ano(s)'
export function describeRecorrencia(regra: TarefaSerieRegra): string;
export function modoLabel(modo: TarefaSerieModo): string;         // 'cria a próxima ao concluir' | 'cria em toda data da regra'
export type SerieEstado = 'ativa' | 'pausada' | 'encerrada' | 'concluida';
export function serieEstado(serie: TarefaSerieResumo, today: Date): SerieEstado;
export function serieEstadoLabel(serie: TarefaSerieResumo, today: Date): string | null; // pill text or null when Ativa without fim
export function regraFromForm(values: RecorrenciaFormValues, dataLimite: Date, landing: { dia_mes: number | null; mes: number | null } | null): TarefaSerieRegra | null;
export function regraIgual(a: TarefaSerieRegra, b: TarefaSerieRegra): boolean;

// tarefaFormSchema.ts
export const tarefaFormSchema: z.ZodType<...>;                     // see code
export type TarefaFormValues = z.infer<typeof tarefaFormSchema>;
export type RecorrenciaFormValues = Pick<TarefaFormValues, 'repetir' | 'intervalo' | 'dias_semana' | 'fim' | 'modo' | 'serie_nova'>;
export const BLANK_TAREFA_FORM: TarefaFormValues;
```

- [ ] **Step 1: Write the failing tests**

Create `apps/crm/src/pages/tarefas/__tests__/recorrenciaLogic.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { TarefaSerieRegra, TarefaSerieResumo } from '../../../store';
import {
  describeRecorrencia,
  modoLabel,
  regraFromForm,
  regraIgual,
  serieEstado,
  serieEstadoLabel,
  unidadeIntervalo,
} from '../recorrenciaLogic';
import { tarefaFormSchema, BLANK_TAREFA_FORM } from '../components/tarefaFormSchema';

const base: TarefaSerieRegra = {
  freq: 'daily', intervalo: 1, dias_semana: null, dia_mes: null, mes: null, modo: 'ao_concluir', fim: null,
};
const serie = (over: Partial<TarefaSerieResumo> = {}): TarefaSerieResumo => ({
  ...base, id: 1, inicio: '2026-01-05', pausada: false, encerrada_em: null, proxima_data: null, ...over,
});
const TODAY = new Date(2026, 0, 5);

describe('describeRecorrencia', () => {
  it('daily', () => {
    expect(describeRecorrencia(base)).toBe('Todo dia');
    expect(describeRecorrencia({ ...base, intervalo: 3 })).toBe('A cada 3 dias');
  });
  it('weekly orders days Mon..Sun and uses "e" before the last', () => {
    expect(describeRecorrencia({ ...base, freq: 'weekly', dias_semana: [3, 1] })).toBe('Toda segunda e quarta');
    expect(describeRecorrencia({ ...base, freq: 'weekly', intervalo: 2, dias_semana: [5] })).toBe('A cada 2 semanas, na sexta');
    expect(describeRecorrencia({ ...base, freq: 'weekly', dias_semana: [0, 1, 3] })).toBe('Toda segunda, quarta e domingo');
  });
  it('monthly, with the last-day hint for days above 28', () => {
    expect(describeRecorrencia({ ...base, freq: 'monthly', dia_mes: 15 })).toBe('Todo dia 15');
    expect(describeRecorrencia({ ...base, freq: 'monthly', intervalo: 3, dia_mes: 31 })).toBe('A cada 3 meses, no dia 31 (ou último dia)');
  });
  it('yearly and the end suffix', () => {
    expect(describeRecorrencia({ ...base, freq: 'yearly', dia_mes: 10, mes: 3 })).toBe('Todo ano em 10/03');
    expect(describeRecorrencia({ ...base, freq: 'yearly', intervalo: 2, dia_mes: 10, mes: 3 })).toBe('A cada 2 anos, em 10/03');
    expect(describeRecorrencia({ ...base, fim: '2026-12-31' })).toBe('Todo dia até 31/12/2026');
  });
});

describe('labels and states', () => {
  it('unidadeIntervalo', () => {
    expect(unidadeIntervalo('daily', 1)).toBe('dia');
    expect(unidadeIntervalo('daily', 2)).toBe('dias');
    expect(unidadeIntervalo('monthly', 1)).toBe('mês');
    expect(unidadeIntervalo('monthly', 2)).toBe('meses');
  });
  it('modoLabel', () => {
    expect(modoLabel('ao_concluir')).toBe('cria a próxima ao concluir');
    expect(modoLabel('calendario')).toBe('cria em toda data da regra');
  });
  it('serieEstado follows the states table with precedence Encerrada > Concluída > Pausada > Ativa', () => {
    expect(serieEstado(serie(), TODAY)).toBe('ativa');
    expect(serieEstado(serie({ pausada: true }), TODAY)).toBe('pausada');
    // encerrada wins over everything
    expect(serieEstado(serie({ pausada: true, encerrada_em: '2026-01-01T00:00:00Z' }), TODAY)).toBe('encerrada');
    expect(serieEstado(serie({ fim: '2026-01-04', encerrada_em: '2026-01-01T00:00:00Z' }), TODAY)).toBe('encerrada');
    // concluida wins over pausada
    expect(serieEstado(serie({ fim: '2026-01-04' }), TODAY)).toBe('concluida');
    expect(serieEstado(serie({ fim: '2026-01-04', pausada: true }), TODAY)).toBe('concluida');
    expect(serieEstado(serie({ modo: 'calendario', proxima_data: null, pausada: true }), TODAY)).toBe('concluida');
    // fim today is still active; calendario with a cursor is active
    expect(serieEstado(serie({ fim: '2026-01-05' }), TODAY)).toBe('ativa');
    expect(serieEstado(serie({ modo: 'calendario', proxima_data: '2026-01-06' }), TODAY)).toBe('ativa');
    // ao_concluir never reads proxima_data
    expect(serieEstado(serie({ modo: 'ao_concluir', proxima_data: null }), TODAY)).toBe('ativa');
  });
  it('serieEstadoLabel', () => {
    expect(serieEstadoLabel(serie(), TODAY)).toBeNull();
    expect(serieEstadoLabel(serie({ fim: '2026-12-31' }), TODAY)).toBe('Termina em 31/12/2026');
    expect(serieEstadoLabel(serie({ pausada: true }), TODAY)).toBe('Pausada');
    expect(serieEstadoLabel(serie({ encerrada_em: 'x' }), TODAY)).toBe('Encerrada');
    expect(serieEstadoLabel(serie({ fim: '2026-01-04' }), TODAY)).toBe('Concluída');
  });
});

describe('regraFromForm / regraIgual', () => {
  const values = { ...BLANK_TAREFA_FORM, repetir: 'monthly' as const, intervalo: '2', dias_semana: [], fim: undefined, modo: 'calendario' as const };
  it('returns null for "never"', () => {
    expect(regraFromForm({ ...values, repetir: 'never' }, new Date(2026, 0, 31), null)).toBeNull();
  });
  it('derives the landing day/month from the due date when landing is null (new series)', () => {
    expect(regraFromForm(values, new Date(2026, 0, 31), null)).toEqual({
      freq: 'monthly', intervalo: 2, dias_semana: null, dia_mes: 31, mes: null, modo: 'calendario', fim: null,
    });
    expect(regraFromForm({ ...values, repetir: 'yearly' }, new Date(2026, 2, 10), null)).toMatchObject({ dia_mes: 10, mes: 3 });
  });
  it('keeps the series landing when editing (Prazo change does not move dia_mes)', () => {
    expect(regraFromForm(values, new Date(2026, 1, 28), { dia_mes: 31, mes: null })).toMatchObject({ dia_mes: 31 });
  });
  it('weekly sorts the days and formats fim', () => {
    expect(regraFromForm({ ...values, repetir: 'weekly', dias_semana: [3, 1], fim: new Date(2026, 11, 31) }, TODAY, null))
      .toEqual({ freq: 'weekly', intervalo: 2, dias_semana: [1, 3], dia_mes: null, mes: null, modo: 'calendario', fim: '2026-12-31' });
  });
  it('regraIgual ignores day order', () => {
    expect(regraIgual({ ...base, freq: 'weekly', dias_semana: [1, 3] }, { ...base, freq: 'weekly', dias_semana: [3, 1] })).toBe(true);
    expect(regraIgual(base, { ...base, intervalo: 2 })).toBe(false);
  });
});

describe('tarefaFormSchema', () => {
  const ok = { ...BLANK_TAREFA_FORM, titulo: 'x', data_limite: new Date(2099, 0, 1) };
  it('rule requires a due date', () => {
    const r = tarefaFormSchema.safeParse({ ...ok, data_limite: undefined, repetir: 'daily' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]).toMatchObject({ path: ['data_limite'], message: 'Defina um prazo: ele será a primeira ocorrência.' });
  });
  it('a NEW series requires today or later', () => {
    const r = tarefaFormSchema.safeParse({ ...ok, repetir: 'daily', serie_nova: true, data_limite: new Date(2000, 0, 1) });
    expect(r.error?.issues[0]).toMatchObject({ path: ['data_limite'], message: 'Para repetir, o prazo precisa ser hoje ou depois.' });
    expect(tarefaFormSchema.safeParse({ ...ok, repetir: 'daily', serie_nova: false, data_limite: new Date(2000, 0, 1) }).success).toBe(true);
  });
  it('weekly needs a day, intervalo 1..99, fim after the due date', () => {
    expect(tarefaFormSchema.safeParse({ ...ok, repetir: 'weekly', dias_semana: [] }).error?.issues[0])
      .toMatchObject({ path: ['dias_semana'], message: 'Escolha ao menos um dia da semana.' });
    expect(tarefaFormSchema.safeParse({ ...ok, repetir: 'daily', intervalo: '0' }).error?.issues[0])
      .toMatchObject({ path: ['intervalo'], message: 'Use um número de 1 a 99.' });
    expect(tarefaFormSchema.safeParse({ ...ok, repetir: 'daily', intervalo: '1.5' }).success).toBe(false);
    expect(tarefaFormSchema.safeParse({ ...ok, repetir: 'daily', fim: new Date(2098, 0, 1) }).error?.issues[0])
      .toMatchObject({ path: ['fim'], message: 'A data final precisa ser igual ou depois do prazo.' });
  });
  it('"never" ignores the rule fields', () => {
    expect(tarefaFormSchema.safeParse({ ...ok, repetir: 'never', intervalo: '0', dias_semana: [] }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run apps/crm/src/pages/tarefas/__tests__/recorrenciaLogic.test.ts`
Expected: FAIL, cannot resolve `../recorrenciaLogic`.

- [ ] **Step 3: Write `tarefaFormSchema.ts`**

```ts
import { z } from 'zod';
import { toDateOnlyString } from '../tarefasLogic';

// Shared by TarefaFormDialog and RecorrenciaFields. Rule fields are validated
// only when `repetir` is not 'never'. `serie_nova` is a hidden form value the
// dialog sets on reset (true for create mode and for a standalone task being
// edited; false when editing an existing occurrence), because a NEW series
// must start today or later while an existing occurrence may sit in the past.
export const tarefaFormSchema = z
  .object({
    titulo: z.string().trim().min(1, 'Informe o título da tarefa'),
    descricao: z.string(),
    responsavel_id: z.string(),
    cliente_id: z.string(),
    data_limite: z.date().optional(),
    status: z.enum(['pendente', 'em_andamento', 'concluida']),
    repetir: z.enum(['never', 'daily', 'weekly', 'monthly', 'yearly']),
    /** Kept as the raw input string; parsed in superRefine so the message is ours. */
    intervalo: z.string(),
    dias_semana: z.array(z.number().int().min(0).max(6)),
    fim: z.date().optional(),
    modo: z.enum(['ao_concluir', 'calendario']),
    serie_nova: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.repetir === 'never') return;
    if (!v.data_limite) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['data_limite'], message: 'Defina um prazo: ele será a primeira ocorrência.' });
      return;
    }
    if (v.serie_nova && toDateOnlyString(v.data_limite) < toDateOnlyString(new Date())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['data_limite'], message: 'Para repetir, o prazo precisa ser hoje ou depois.' });
    }
    if (v.repetir === 'weekly' && v.dias_semana.length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dias_semana'], message: 'Escolha ao menos um dia da semana.' });
    }
    if (!/^\d{1,2}$/.test(v.intervalo.trim()) || Number(v.intervalo) < 1 || Number(v.intervalo) > 99) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['intervalo'], message: 'Use um número de 1 a 99.' });
    }
    if (v.fim && toDateOnlyString(v.fim) < toDateOnlyString(v.data_limite)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fim'], message: 'A data final precisa ser igual ou depois do prazo.' });
    }
  });

export type TarefaFormValues = z.infer<typeof tarefaFormSchema>;
export type RecorrenciaFormValues = Pick<
  TarefaFormValues,
  'repetir' | 'intervalo' | 'dias_semana' | 'fim' | 'modo' | 'serie_nova'
>;

export const BLANK_TAREFA_FORM: TarefaFormValues = {
  titulo: '',
  descricao: '',
  responsavel_id: 'none',
  cliente_id: 'none',
  data_limite: undefined,
  status: 'pendente',
  repetir: 'never',
  intervalo: '1',
  dias_semana: [],
  fim: undefined,
  modo: 'ao_concluir',
  serie_nova: true,
};
```

- [ ] **Step 4: Write `recorrenciaLogic.ts`**

```ts
import { format } from 'date-fns';
import type {
  TarefaSerieFreq,
  TarefaSerieModo,
  TarefaSerieRegra,
  TarefaSerieResumo,
} from '../../store';
import { parseDateOnly, toDateOnlyString } from './tarefasLogic';
import type { RecorrenciaFormValues } from './components/tarefaFormSchema';

// Pure helpers for tarefas recorrentes. No next-date computation on the
// client: the database owns the date math (tarefa_next_date).

export type RepetirValor = 'never' | TarefaSerieFreq;

export const REPETIR_LABELS: Record<RepetirValor, string> = {
  never: 'Não repete',
  daily: 'Diariamente',
  weekly: 'Semanalmente',
  monthly: 'Mensalmente',
  yearly: 'Anualmente',
};

/** Chip letters indexed by dias_semana value (0 = domingo). */
export const WEEKDAY_CHIPS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'] as const;
export const WEEKDAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'] as const;

export function unidadeIntervalo(freq: TarefaSerieFreq, n: number): string {
  const plural = n !== 1;
  switch (freq) {
    case 'daily':
      return plural ? 'dias' : 'dia';
    case 'weekly':
      return plural ? 'semanas' : 'semana';
    case 'monthly':
      return plural ? 'meses' : 'mês';
    case 'yearly':
      return plural ? 'anos' : 'ano';
  }
}

/** Mon..Sun order (Sunday last), matching the DB's date_trunc('week') weeks. */
function sortWeekdays(days: number[]): number[] {
  return [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));
}

function joinNomes(days: number[]): string {
  const names = sortWeekdays(days).map((d) => WEEKDAY_NAMES[d]);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
}

function fmtDia(dia_mes: number): string {
  return dia_mes > 28 ? `dia ${dia_mes} (ou último dia)` : `dia ${dia_mes}`;
}

export function describeRecorrencia(regra: TarefaSerieRegra): string {
  const n = regra.intervalo;
  let base: string;
  switch (regra.freq) {
    case 'daily':
      base = n === 1 ? 'Todo dia' : `A cada ${n} dias`;
      break;
    case 'weekly': {
      const nomes = joinNomes(regra.dias_semana ?? []);
      base = n === 1 ? `Toda ${nomes}` : `A cada ${n} semanas, na ${nomes}`;
      break;
    }
    case 'monthly': {
      const dia = fmtDia(regra.dia_mes ?? 1);
      base = n === 1 ? `Todo ${dia}` : `A cada ${n} meses, no ${dia}`;
      break;
    }
    case 'yearly': {
      const dm = `${String(regra.dia_mes ?? 1).padStart(2, '0')}/${String(regra.mes ?? 1).padStart(2, '0')}`;
      base = n === 1 ? `Todo ano em ${dm}` : `A cada ${n} anos, em ${dm}`;
      break;
    }
  }
  return regra.fim ? `${base} até ${format(parseDateOnly(regra.fim), 'dd/MM/yyyy')}` : base;
}

export function modoLabel(modo: TarefaSerieModo): string {
  return modo === 'ao_concluir' ? 'cria a próxima ao concluir' : 'cria em toda data da regra';
}

export type SerieEstado = 'ativa' | 'pausada' | 'encerrada' | 'concluida';

/** Derived state, spec "Series states" table. The ONLY place this is derived;
 *  the card and the sheet call it. Mutually exclusive by precedence:
 *  Encerrada > Concluída > Pausada > Ativa (a paused-but-exhausted series is
 *  Concluída, not Pausada). */
export function serieEstado(serie: TarefaSerieResumo, today: Date): SerieEstado {
  if (serie.encerrada_em) return 'encerrada';
  const hoje = toDateOnlyString(today);
  const concluida =
    (serie.fim !== null && serie.fim < hoje) ||
    (serie.modo === 'calendario' && serie.proxima_data === null);
  if (concluida) return 'concluida';
  if (serie.pausada) return 'pausada';
  return 'ativa';
}

/** Pill text: null when the series is simply active with no end. */
export function serieEstadoLabel(serie: TarefaSerieResumo, today: Date): string | null {
  switch (serieEstado(serie, today)) {
    case 'encerrada':
      return 'Encerrada';
    case 'pausada':
      return 'Pausada';
    case 'concluida':
      return 'Concluída';
    case 'ativa':
      return serie.fim ? `Termina em ${format(parseDateOnly(serie.fim), 'dd/MM/yyyy')}` : null;
  }
}

/** Builds the RPC rule from the form. `landing` is the series' stored
 *  dia_mes/mes when editing an occurrence (Prazo never moves them); null for a
 *  new series or a promotion, where they derive from the due date. */
export function regraFromForm(
  values: RecorrenciaFormValues,
  dataLimite: Date,
  landing: { dia_mes: number | null; mes: number | null } | null,
): TarefaSerieRegra | null {
  if (values.repetir === 'never') return null;
  const freq = values.repetir;
  const fromDate = { dia_mes: dataLimite.getDate(), mes: dataLimite.getMonth() + 1 };
  const land = landing ?? fromDate;
  return {
    freq,
    intervalo: parseInt(values.intervalo, 10),
    dias_semana: freq === 'weekly' ? sortWeekdays(values.dias_semana) : null,
    dia_mes: freq === 'monthly' || freq === 'yearly' ? (land.dia_mes ?? fromDate.dia_mes) : null,
    mes: freq === 'yearly' ? (land.mes ?? fromDate.mes) : null,
    modo: values.modo,
    fim: values.fim ? toDateOnlyString(values.fim) : null,
  };
}

export function regraIgual(a: TarefaSerieRegra, b: TarefaSerieRegra): boolean {
  const days = (r: TarefaSerieRegra) => (r.dias_semana ? sortWeekdays(r.dias_semana).join(',') : '');
  return (
    a.freq === b.freq &&
    a.intervalo === b.intervalo &&
    days(a) === days(b) &&
    a.dia_mes === b.dia_mes &&
    a.mes === b.mes &&
    a.modo === b.modo &&
    a.fim === b.fim
  );
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run apps/crm/src/pages/tarefas/__tests__/recorrenciaLogic.test.ts && npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/pages/tarefas/recorrenciaLogic.ts apps/crm/src/pages/tarefas/components/tarefaFormSchema.ts apps/crm/src/pages/tarefas/__tests__/recorrenciaLogic.test.ts
git commit -m "feat(tarefas): recurrence summary, state and form schema helpers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: The "Repetir" section (`RecorrenciaFields`) and series creation / promotion from the form

Spec: "`TarefaFormDialog`: Repetir section", "Create: one atomic RPC", "Rule chosen while editing a standalone task".

**Files:**
- Create: `apps/crm/src/pages/tarefas/components/RecorrenciaFields.tsx`
- Modify: `apps/crm/src/pages/tarefas/components/TarefaFormDialog.tsx` (schema import lines 52-70; reset effect lines 143-176; `onSubmit` lines 186-220; JSX between the Prazo/Status grid and Tags, lines 375-384)
- Modify: `apps/crm/src/pages/tarefas/__tests__/TarefaFormDialog.test.tsx` (store mock lines 33-41; new tests appended)

**Interfaces:**
- Consumes: `tarefaFormSchema`, `TarefaFormValues`, `BLANK_TAREFA_FORM` (Task 7); `regraFromForm`, `describeRecorrencia`, `REPETIR_LABELS`, `WEEKDAY_CHIPS`, `WEEKDAY_NAMES`, `unidadeIntervalo` (Task 7); `criarTarefaSerie`, `isSerieDateConflict`, `TarefaSerieRegra` (Task 6); shadcn `Select`, `Input`, `DatePicker` (already `clearable` with an X, so the "Nunca" placeholder is the whole "never" affordance), `ToggleGroup`/`ToggleGroupItem`, `FormField`/`FormItem`/`FormLabel`/`FormControl`/`FormMessage`.
- Produces:

```tsx
export interface RecorrenciaFieldsProps {
  form: UseFormReturn<TarefaFormValues>;
  /** Series landing day/month when editing an occurrence; null derives from Prazo. */
  landing: { dia_mes: number | null; mes: number | null } | null;
  disabled?: boolean;
  /** Shown under the select when disabled. */
  disabledHint?: string;
}
export function RecorrenciaFields(props: RecorrenciaFieldsProps): JSX.Element;
```

Task 9 adds the occurrence-edit branch (scope dialog) on top of the `onSubmit` written here; this task's `onSubmit` treats "editing an occurrence" as a plain update so the file compiles and existing tests pass in between.

- [ ] **Step 1: Extend the dialog test (failing)**

In `apps/crm/src/pages/tarefas/__tests__/TarefaFormDialog.test.tsx`, add `criarTarefaSerieMock` to the `vi.hoisted` block (`criarTarefaSerieMock: vi.fn()`) and extend the store mock:

```ts
vi.mock('../../../store', () => ({
  addTarefa: addTarefaMock,
  updateTarefa: vi.fn(),
  setTarefaTags: vi.fn(),
  addTarefaTag: vi.fn(),
  getMembros: getMembrosMock,
  getClientes: getClientesMock,
  getTarefas: getTarefasMock,
  criarTarefaSerie: criarTarefaSerieMock,
  aplicarEdicaoSerie: vi.fn(),
  definirEstadoSerie: vi.fn(),
  deleteTarefaSerieCompleta: vi.fn(),
  isSerieDateConflict: () => false,
  isSerieSemPrazo: () => false,
}));
```

Add, next to the other `vi.mock` calls, a native stand-in for Radix Select (jsdom cannot drive the real one; same reasoning as the dropdown-menu mock in `TarefaCard.test.tsx`):

```tsx
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value?: string;
    onValueChange?: (v: string) => void;
    disabled?: boolean;
    children: React.ReactNode;
  }) => (
    <select value={value} disabled={disabled} onChange={(e) => onValueChange?.(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));
```

Add `within` to the `@testing-library/react` import and this helper after `renderDialog`:

```ts
/** The <select> that owns an option with this label (the Select mock renders native selects). */
function selectWithOption(label: string): HTMLSelectElement {
  const match = screen
    .getAllByRole('combobox')
    .find((el) => within(el).queryByRole('option', { name: label }));
  if (!match) throw new Error(`no select with option ${label}`);
  return match as HTMLSelectElement;
}

function makeEditing(overrides: Partial<TarefaWithRelations> = {}): TarefaWithRelations {
  return {
    id: 42,
    titulo: 'Tarefa',
    descricao: null,
    descricao_rich: null,
    status: 'pendente',
    responsavel_id: null,
    cliente_id: null,
    data_limite: '2099-01-05',
    concluida_em: null,
    created_at: '2026-07-01T10:00:00',
    tags: [],
    subtarefas_total: 0,
    subtarefas_concluidas: 0,
    cliente_nome: null,
    cliente_cor: null,
    serie: null,
    ...overrides,
  };
}
```

(`import type { TarefaWithRelations } from '../../../store';` at the top; `type` imports survive the module mock.)

Append a new `describe`:

```tsx
describe('TarefaFormDialog Repetir', () => {
  const baseProps = {
    open: true,
    onClose: () => {},
    membros: [],
    clientes: CLIENTES,
    tags: [],
    onSaved: () => {},
    onTagCreated: () => {},
  };

  it('is hidden in conversion mode (onCreate)', () => {
    renderDialog(<TarefaFormDialog {...baseProps} editing={null} onCreate={vi.fn()} />);
    expect(screen.queryByText('Repetir')).not.toBeInTheDocument();
  });

  it('creates a series through criarTarefaSerie (not addTarefa) with the rule derived from Prazo', async () => {
    criarTarefaSerieMock.mockResolvedValue({ serie_id: 1, tarefa_id: 2 });
    const onSaved = vi.fn();
    renderDialog(
      <TarefaFormDialog
        {...baseProps}
        editing={null}
        onSaved={onSaved}
        initialValues={{ titulo: 'Fechamento', data_limite: '2099-01-31' }}
      />,
    );
    fireEvent.change(selectWithOption('Mensalmente'), { target: { value: 'monthly' } });
    expect(await screen.findByText('Todo dia 31 (ou último dia)')).toBeInTheDocument();
    // ToggleGroup type="single" renders its items with role="radio" (Radix)
    fireEvent.click(screen.getByRole('radio', { name: 'Criar em toda data da regra' }));
    fireEvent.click(screen.getByRole('button', { name: 'Criar tarefa' }));
    await waitFor(() => expect(criarTarefaSerieMock).toHaveBeenCalledTimes(1));
    const [regra, payload, tagIds, subtarefas, tarefaId] = criarTarefaSerieMock.mock.calls[0];
    expect(regra).toEqual({
      freq: 'monthly', intervalo: 1, dias_semana: null, dia_mes: 31, mes: null, modo: 'calendario', fim: null,
    });
    expect(payload).toMatchObject({ titulo: 'Fechamento', data_limite: '2099-01-31', status: 'pendente' });
    expect(tagIds).toEqual([]);
    expect(subtarefas).toEqual([]);
    expect(tarefaId).toBeUndefined();
    expect(addTarefaMock).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalled();
  });

  it('validates: weekly needs a day, rule needs a due date', async () => {
    renderDialog(<TarefaFormDialog {...baseProps} editing={null} initialValues={{ titulo: 'x' }} />);
    fireEvent.change(selectWithOption('Semanalmente'), { target: { value: 'weekly' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar tarefa' }));
    expect(await screen.findByText('Defina um prazo: ele será a primeira ocorrência.')).toBeInTheDocument();
    expect(criarTarefaSerieMock).not.toHaveBeenCalled();
  });

  it('promotes a standalone task: criarTarefaSerie receives the task id and no scope dialog opens', async () => {
    criarTarefaSerieMock.mockResolvedValue({ serie_id: 1, tarefa_id: 42 });
    renderDialog(<TarefaFormDialog {...baseProps} editing={makeEditing()} />);
    fireEvent.change(selectWithOption('Diariamente'), { target: { value: 'daily' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(criarTarefaSerieMock).toHaveBeenCalledTimes(1));
    expect(criarTarefaSerieMock.mock.calls[0][4]).toBe(42);
    expect(screen.queryByText('Aplicar a quais tarefas?')).not.toBeInTheDocument();
  });

  it('disables Repetir with a hint when editing a concluida standalone task', () => {
    renderDialog(<TarefaFormDialog {...baseProps} editing={makeEditing({ status: 'concluida' })} />);
    expect(selectWithOption('Diariamente')).toBeDisabled();
    expect(screen.getByText('Reabra a tarefa para torná-la recorrente.')).toBeInTheDocument();
  });

  it('keeps the series landing day when Prazo changes in edit mode', async () => {
    renderDialog(
      <TarefaFormDialog
        {...baseProps}
        editing={makeEditing({
          data_limite: '2026-02-28',
          serie: {
            id: 9, freq: 'monthly', intervalo: 1, dias_semana: null, dia_mes: 31, mes: null,
            modo: 'ao_concluir', fim: null, inicio: '2026-01-31', pausada: false, encerrada_em: null, proxima_data: null,
          },
        })}
      />,
    );
    expect(await screen.findByText('Todo dia 31 (ou último dia)')).toBeInTheDocument();
  });
});
```

Run: `npx vitest run apps/crm/src/pages/tarefas/__tests__/TarefaFormDialog.test.tsx`
Expected: the six new tests FAIL (no "Repetir" section, `criarTarefaSerie` never called); the three existing ones still pass.

- [ ] **Step 2: Write `RecorrenciaFields.tsx`**

```tsx
import type { UseFormReturn } from 'react-hook-form';
import { Input } from '@/components/ui/input';
import { DatePicker } from '@/components/ui/date-picker';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import {
  describeRecorrencia,
  regraFromForm,
  REPETIR_LABELS,
  unidadeIntervalo,
  WEEKDAY_CHIPS,
  WEEKDAY_NAMES,
  type RepetirValor,
} from '../recorrenciaLogic';
import type { TarefaFormValues } from './tarefaFormSchema';

export interface RecorrenciaFieldsProps {
  form: UseFormReturn<TarefaFormValues>;
  /** Series landing day/month when editing an occurrence; null derives from Prazo. */
  landing: { dia_mes: number | null; mes: number | null } | null;
  disabled?: boolean;
  /** Shown under the select when disabled. */
  disabledHint?: string;
}

const REPETIR_ORDER: RepetirValor[] = ['never', 'daily', 'weekly', 'monthly', 'yearly'];

/** The "Repetir" section of TarefaFormDialog. Pure form UI: the rule is read
 *  back with regraFromForm() at submit time; no next-date math on the client. */
export function RecorrenciaFields({ form, landing, disabled, disabledHint }: RecorrenciaFieldsProps) {
  const repetir = form.watch('repetir');
  const intervalo = form.watch('intervalo');
  const diasSemana = form.watch('dias_semana');
  const fim = form.watch('fim');
  const modo = form.watch('modo');
  const dataLimite = form.watch('data_limite');
  const serieNova = form.watch('serie_nova');

  const regra = regraFromForm(
    { repetir, intervalo, dias_semana: diasSemana, fim, modo, serie_nova: serieNova },
    dataLimite ?? new Date(),
    landing,
  );
  const n = parseInt(intervalo, 10);
  const nValido = Number.isInteger(n) && n >= 1 && n <= 99;

  return (
    <div className="flex flex-col gap-3">
      <FormField
        control={form.control}
        name="repetir"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Repetir</FormLabel>
            <Select value={field.value} onValueChange={field.onChange} disabled={disabled}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {REPETIR_ORDER.map((v) => (
                  <SelectItem key={v} value={v}>
                    {REPETIR_LABELS[v]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {disabled && disabledHint && (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {disabledHint}
              </p>
            )}
            <FormMessage />
          </FormItem>
        )}
      />

      {repetir !== 'never' && (
        <>
          <FormField
            control={form.control}
            name="intervalo"
            render={({ field }) => (
              <FormItem>
                <div className="flex items-center gap-2 text-sm">
                  <span>a cada</span>
                  <FormControl>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={99}
                      className="w-16 h-8"
                      aria-label="Intervalo"
                      {...field}
                    />
                  </FormControl>
                  <span>{unidadeIntervalo(repetir, nValido ? n : 2)}</span>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />

          {repetir === 'weekly' && (
            <FormField
              control={form.control}
              name="dias_semana"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <ToggleGroup
                      type="multiple"
                      className="justify-start"
                      value={field.value.map(String)}
                      onValueChange={(vals: string[]) => field.onChange(vals.map(Number))}
                    >
                      {WEEKDAY_CHIPS.map((letter, day) => (
                        <ToggleGroupItem
                          key={day}
                          value={String(day)}
                          aria-label={WEEKDAY_NAMES[day]}
                          className="h-8 w-8 rounded-full text-xs"
                        >
                          {letter}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}

          {(repetir === 'monthly' || repetir === 'yearly') && regra && (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {repetir === 'monthly'
                ? `Todo dia ${regra.dia_mes}${(regra.dia_mes ?? 0) > 28 ? ' (ou último dia)' : ''}`
                : `Todo ano em ${String(regra.dia_mes).padStart(2, '0')}/${String(regra.mes).padStart(2, '0')}`}
            </p>
          )}

          <FormField
            control={form.control}
            name="fim"
            render={({ field }) => (
              <FormItem className="flex flex-col">
                <FormLabel>Termina em</FormLabel>
                <FormControl>
                  <DatePicker value={field.value} onChange={field.onChange} placeholder="Nunca" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="modo"
            render={({ field }) => (
              <FormItem>
                <FormControl>
                  <ToggleGroup
                    type="single"
                    className="grid grid-cols-2 gap-2"
                    value={field.value}
                    onValueChange={(v: string) => {
                      if (v) field.onChange(v);
                    }}
                  >
                    <ToggleGroupItem value="ao_concluir" className="h-9">
                      Criar a próxima ao concluir
                    </ToggleGroupItem>
                    <ToggleGroupItem value="calendario" className="h-9">
                      Criar em toda data da regra
                    </ToggleGroupItem>
                  </ToggleGroup>
                </FormControl>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Ao concluir: a próxima tarefa só aparece quando esta for concluída. Toda data: a
                  tarefa aparece na data, mesmo com a anterior aberta.
                </p>
              </FormItem>
            )}
          />

          {regra && nValido && (
            <p className="text-sm font-medium" data-testid="recorrencia-resumo">
              {describeRecorrencia(regra)}
              {' · '}
              {modo === 'ao_concluir' ? 'cria a próxima ao concluir' : 'cria em toda data da regra'}
            </p>
          )}
        </>
      )}
    </div>
  );
}
```

Note: `regra.dia_mes` above is the monthly summary text ("Todo dia {dia_mes}") the spec asks for next to the interval; the bottom line is the full `describeRecorrencia` summary with the mode suffix, like the owner's mock ("Toda segunda · cria a próxima ao concluir").

- [ ] **Step 3: Wire the dialog**

In `TarefaFormDialog.tsx`:

1. Replace the local `tarefaSchema`, `TarefaFormValues` and `BLANK` (lines 52-70) with imports and keep the `TarefaFormPayload` type:

```ts
import { tarefaFormSchema, BLANK_TAREFA_FORM, type TarefaFormValues } from './tarefaFormSchema';
import { RecorrenciaFields } from './RecorrenciaFields';
import { regraFromForm } from '../recorrenciaLogic';
import {
  addTarefa,
  criarTarefaSerie,
  isSerieDateConflict,
  updateTarefa,
  setTarefaTags,
  type Cliente,
  type Membro,
  type TarefaTag,
  type TarefaWithRelations,
} from '../../../store';
```

and `useForm<TarefaFormValues>({ resolver: zodResolver(tarefaFormSchema), defaultValues: BLANK_TAREFA_FORM })`.

2. In the reset effect, the `editing` branch becomes:

```ts
      const serie = editing.serie;
      form.reset({
        titulo: editing.titulo,
        descricao: editing.descricao ?? '',
        responsavel_id: editing.responsavel_id != null ? String(editing.responsavel_id) : 'none',
        cliente_id: editing.cliente_id != null ? String(editing.cliente_id) : 'none',
        data_limite: editing.data_limite ? parseDateOnly(editing.data_limite) : undefined,
        status: editing.status,
        repetir: serie ? serie.freq : 'never',
        intervalo: serie ? String(serie.intervalo) : '1',
        dias_semana: serie?.dias_semana ?? [],
        fim: serie?.fim ? parseDateOnly(serie.fim) : undefined,
        modo: serie?.modo ?? 'ao_concluir',
        serie_nova: !serie,
      });
```

and the create branch spreads `BLANK_TAREFA_FORM` instead of `BLANK` (it already carries `repetir: 'never'`, `serie_nova: true`).

3. Derived flags after `sortedMembros`:

```ts
  const isOcorrencia = !!editing?.serie;
  const repetirBloqueado = !!editing && !editing.serie && editing.status === 'concluida';
  const landing = editing?.serie ? { dia_mes: editing.serie.dia_mes, mes: editing.serie.mes } : null;
```

4. `onSubmit` (Task 9 replaces the `editing && isOcorrencia` branch; write it as a plain update for now):

```ts
  const onSubmit = async (values: TarefaFormValues) => {
    if (imageUploading) return;
    setSaving(true);
    const sanitizedDescription = sanitizeTarefaDescriptionDoc(descriptionDoc);
    const payload: TarefaFormPayload = {
      titulo: values.titulo.trim(),
      descricao: values.descricao.trim() || null,
      descricao_rich: isTarefaDescriptionEmpty(sanitizedDescription) ? null : sanitizedDescription,
      status: values.status,
      responsavel_id: values.responsavel_id === 'none' ? null : parseInt(values.responsavel_id, 10),
      cliente_id: values.cliente_id === 'none' ? null : parseInt(values.cliente_id, 10),
      data_limite: values.data_limite ? toDateOnlyString(values.data_limite) : null,
    };
    const regra = values.data_limite ? regraFromForm(values, values.data_limite, landing) : null;
    try {
      if (editing && isOcorrencia) {
        await updateTarefa(editing.id!, payload);
        await setTarefaTags(editing.id!, tagIds);
        toast.success('Tarefa atualizada!');
      } else if (editing && regra) {
        // standalone task promoted to a series: no scope dialog
        await criarTarefaSerie(regra, payload, tagIds, [], editing.id!);
        toast.success('Tarefa atualizada!');
      } else if (editing) {
        await updateTarefa(editing.id!, payload);
        await setTarefaTags(editing.id!, tagIds);
        toast.success('Tarefa atualizada!');
      } else if (onCreate) {
        await onCreate(payload, tagIds);
      } else if (regra) {
        await criarTarefaSerie(regra, payload, tagIds, []);
        captureEvent('task_created', { status: values.status, recorrente: true });
        toast.success('Tarefa criada!');
      } else {
        await addTarefa(payload, tagIds);
        captureEvent('task_created', { status: values.status });
        toast.success('Tarefa criada!');
      }
      onSaved();
      onClose();
    } catch (e) {
      toast.error(mensagemErro(e, editing ? 'Erro ao atualizar tarefa' : 'Erro ao criar tarefa', !!onCreate));
    } finally {
      setSaving(false);
    }
  };
```

with this module-level helper above the component:

```ts
/** RPC failures carry a pt-BR RAISE message worth showing; PostgREST table
 *  errors do not. `serieRpc` errors (from criarTarefaSerie/aplicarEdicaoSerie)
 *  are PostgrestError objects whose message is the RAISE text. */
function mensagemErro(e: unknown, fallback: string, fromOnCreate: boolean): string {
  if (isSerieDateConflict(e)) return 'Já existe uma ocorrência desta série nesse dia.';
  const msg = e && typeof e === 'object' && 'message' in e ? String((e as { message: unknown }).message) : '';
  const conhecida =
    msg.startsWith('Para repetir') ||
    msg.startsWith('Tarefas de uma série') ||
    msg.startsWith('A data final') ||
    msg.startsWith('Reabra a tarefa') ||
    msg.startsWith('Esta tarefa já pertence') ||
    msg.startsWith('Responsável não encontrado') ||
    msg.startsWith('Cliente não encontrado');
  if (conhecida || (fromOnCreate && msg)) return msg;
  return fallback;
}
```

5. JSX: after the Prazo/Status grid `</div>` (line 375) and before the Tags block, add:

```tsx
            {!onCreate && (
              <RecorrenciaFields
                form={form}
                landing={landing}
                disabled={repetirBloqueado}
                disabledHint={repetirBloqueado ? 'Reabra a tarefa para torná-la recorrente.' : undefined}
              />
            )}
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run apps/crm/src/pages/tarefas && npx tsc -p apps/crm/tsconfig.json --noEmit && npm run lint`
Expected: all green.

Then verify in the browser (`npm run dev:env`, log in, Tarefas > Nova tarefa): the Repetir select, "a cada N", weekday chips for Semanalmente, "Termina em" with the "Nunca" placeholder, the two mode buttons with the help line and the summary line. Creating a weekly series shows the card with the repeat icon after Task 10.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/tarefas/components/RecorrenciaFields.tsx apps/crm/src/pages/tarefas/components/TarefaFormDialog.tsx apps/crm/src/pages/tarefas/__tests__/TarefaFormDialog.test.tsx
git commit -m "feat(tarefas): Repetir section, series creation and promotion from the form

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Edit scope dialog ("Somente esta / Esta e as próximas") and the `aplicar_edicao` flow

Spec: "Edit, pause, resume, end", "Scope dialogs > Edit", "Flows per write path" (Editar form row).

**Files:**
- Create: `apps/crm/src/pages/tarefas/components/EscopoEdicaoDialog.tsx`
- Modify: `apps/crm/src/pages/tarefas/components/TarefaFormDialog.tsx` (the `editing && isOcorrencia` branch of `onSubmit` from Task 8; new state + dialog JSX)
- Modify: `apps/crm/src/pages/tarefas/__tests__/TarefaFormDialog.test.tsx`

**Interfaces:**
- Consumes: `aplicarEdicaoSerie`, `updateTarefa`, `setTarefaTags` (Task 6); `regraFromForm`, `regraIgual` (Task 7); shadcn `AlertDialog*`.
- Produces:

```tsx
export interface EscopoEdicaoDialogProps {
  open: boolean;
  /** "Somente esta" is disabled when the rule section changed. */
  regraAlterada: boolean;
  saving: boolean;
  onSomenteEsta: () => void;
  onEstaEProximas: () => void;
  onCancel: () => void;
}
export function EscopoEdicaoDialog(props: EscopoEdicaoDialogProps): JSX.Element;
```

Decision table implemented by `onSubmit` for an occurrence (`editing.serie != null`):

| Form state | What happens |
|---|---|
| Repetir = Não repete | no dialog; `aplicarEdicaoSerie(id, payload, tagIds, editing.serie rule, encerrar = true)` |
| Repetir != Não repete | scope dialog; "Somente esta" (disabled if `!regraIgual(regraForm, regraAtual)`) = `updateTarefa` + `setTarefaTags`; "Esta e as próximas" = `aplicarEdicaoSerie(id, payload, tagIds, regraForm, false)` |

- [ ] **Step 1: Extend the dialog test (failing)**

Add `aplicarEdicaoSerieMock: vi.fn()` and `updateTarefaMock: vi.fn()` to the hoisted block, wire them in the store mock (`aplicarEdicaoSerie: aplicarEdicaoSerieMock`, `updateTarefa: updateTarefaMock`), and append inside `describe('TarefaFormDialog Repetir')`:

```tsx
  const SERIE = {
    id: 9, freq: 'weekly' as const, intervalo: 1, dias_semana: [1], dia_mes: null, mes: null,
    modo: 'ao_concluir' as const, fim: null, inicio: '2026-01-05', pausada: false, encerrada_em: null, proxima_data: null,
  };

  it('editing an occurrence opens the scope dialog; "Esta e as próximas" sends the full payload, tags and whole rule', async () => {
    aplicarEdicaoSerieMock.mockResolvedValue(undefined);
    renderDialog(
      <TarefaFormDialog
        {...baseProps}
        editing={makeEditing({ data_limite: '2026-01-12', serie: SERIE, tags: [{ id: 3, nome: 't', cor: '#000' }] })}
      />,
    );
    fireEvent.change(screen.getByLabelText('Título'), { target: { value: 'Novo título' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(await screen.findByText('Aplicar a quais tarefas?')).toBeInTheDocument();
    expect(
      screen.getByText('As próximas tarefas criadas usarão estas alterações. Tarefas que já existem não mudam.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Somente esta' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Esta e as próximas' }));
    await waitFor(() => expect(aplicarEdicaoSerieMock).toHaveBeenCalledTimes(1));
    const [id, payload, tagIds, regra, encerrar] = aplicarEdicaoSerieMock.mock.calls[0];
    expect(id).toBe(42);
    expect(payload).toEqual({
      titulo: 'Novo título', descricao: null, descricao_rich: null, status: 'pendente',
      responsavel_id: null, cliente_id: null, data_limite: '2026-01-12',
    });
    expect(tagIds).toEqual([3]);
    expect(regra).toEqual({ freq: 'weekly', intervalo: 1, dias_semana: [1], dia_mes: null, mes: null, modo: 'ao_concluir', fim: null });
    expect(encerrar).toBe(false);
    expect(updateTarefaMock).not.toHaveBeenCalled();
  });

  it('"Somente esta" is disabled with the helper when the rule changed, enabled otherwise and uses updateTarefa', async () => {
    updateTarefaMock.mockResolvedValue({});
    renderDialog(<TarefaFormDialog {...baseProps} editing={makeEditing({ data_limite: '2026-01-12', serie: SERIE })} />);
    fireEvent.change(screen.getByLabelText('Intervalo'), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await screen.findByText('Aplicar a quais tarefas?');
    expect(screen.getByRole('button', { name: 'Somente esta' })).toBeDisabled();
    expect(screen.getByText('A regra de repetição vale para toda a série.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByText('Aplicar a quais tarefas?')).not.toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Intervalo'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await screen.findByText('Aplicar a quais tarefas?');
    fireEvent.click(screen.getByRole('button', { name: 'Somente esta' }));
    await waitFor(() => expect(updateTarefaMock).toHaveBeenCalledWith(42, expect.objectContaining({ titulo: 'Tarefa' })));
    expect(aplicarEdicaoSerieMock).not.toHaveBeenCalled();
  });

  it('"Não repete" on an occurrence skips the dialog and ends the series (encerrar = true)', async () => {
    aplicarEdicaoSerieMock.mockResolvedValue(undefined);
    renderDialog(<TarefaFormDialog {...baseProps} editing={makeEditing({ data_limite: '2026-01-12', serie: SERIE })} />);
    fireEvent.change(selectWithOption('Não repete'), { target: { value: 'never' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() => expect(aplicarEdicaoSerieMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Aplicar a quais tarefas?')).not.toBeInTheDocument();
    expect(aplicarEdicaoSerieMock.mock.calls[0][4]).toBe(true);
  });
```

Run: `npx vitest run apps/crm/src/pages/tarefas/__tests__/TarefaFormDialog.test.tsx`
Expected: the three new tests FAIL (no dialog; `updateTarefa` called instead).

- [ ] **Step 2: Write `EscopoEdicaoDialog.tsx`**

```tsx
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export interface EscopoEdicaoDialogProps {
  open: boolean;
  /** "Somente esta" is disabled when the rule section changed. */
  regraAlterada: boolean;
  saving: boolean;
  onSomenteEsta: () => void;
  onEstaEProximas: () => void;
  onCancel: () => void;
}

/** "Aplicar a quais tarefas?" (spec: Scope dialogs > Edit). Triggered only by
 *  saving the Editar form of an occurrence; inline actions never prompt. */
export function EscopoEdicaoDialog({
  open,
  regraAlterada,
  saving,
  onSomenteEsta,
  onEstaEProximas,
  onCancel,
}: EscopoEdicaoDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && !saving && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Aplicar a quais tarefas?</AlertDialogTitle>
          <AlertDialogDescription>
            As próximas tarefas criadas usarão estas alterações. Tarefas que já existem não mudam.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {regraAlterada && (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            A regra de repetição vale para toda a série.
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={saving}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onSomenteEsta();
            }}
            disabled={regraAlterada || saving}
          >
            Somente esta
          </AlertDialogAction>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              onEstaEProximas();
            }}
            disabled={saving}
          >
            Esta e as próximas
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

(`e.preventDefault()` keeps Radix from auto-closing before the async save resolves; the parent closes it.)

- [ ] **Step 3: Wire the dialog into `TarefaFormDialog`**

Add imports (`EscopoEdicaoDialog`, `aplicarEdicaoSerie`, `regraIgual`) and state:

```ts
  const [escopo, setEscopo] = useState<{
    payload: TarefaFormPayload;
    regra: TarefaSerieRegra;
    regraAlterada: boolean;
  } | null>(null);
```

(`import type { TarefaSerieRegra } from '../../../store'`.)

Replace the `if (editing && isOcorrencia) { ... }` branch in `onSubmit` with:

```ts
      if (editing && isOcorrencia) {
        const serieAtual = editing.serie!;
        const regraAtual: TarefaSerieRegra = {
          freq: serieAtual.freq, intervalo: serieAtual.intervalo, dias_semana: serieAtual.dias_semana,
          dia_mes: serieAtual.dia_mes, mes: serieAtual.mes, modo: serieAtual.modo, fim: serieAtual.fim,
        };
        if (!regra) {
          // "Não repete": always "Esta e as próximas" by construction
          await aplicarEdicaoSerie(editing.id!, payload, tagIds, regraAtual, true);
          toast.success('Tarefa atualizada!');
        } else {
          setEscopo({ payload, regra, regraAlterada: !regraIgual(regra, regraAtual) });
          setSaving(false);
          return; // the dialog's handlers finish the save
        }
      } else if (editing && regra) {
```

Add the two dialog handlers after `onSubmit`:

```ts
  const finalizar = async (run: () => Promise<void>) => {
    if (!editing) return;
    setSaving(true);
    try {
      await run();
      toast.success('Tarefa atualizada!');
      setEscopo(null);
      onSaved();
      onClose();
    } catch (e) {
      toast.error(mensagemErro(e, 'Erro ao atualizar tarefa', false));
    } finally {
      setSaving(false);
    }
  };

  const salvarSomenteEsta = () =>
    finalizar(async () => {
      await updateTarefa(editing!.id!, escopo!.payload);
      await setTarefaTags(editing!.id!, tagIds);
    });

  const salvarEstaEProximas = () =>
    finalizar(() => aplicarEdicaoSerie(editing!.id!, escopo!.payload, tagIds, escopo!.regra, false));
```

Render the dialog as a sibling of `<Dialog>` (wrap the return in a fragment):

```tsx
      <EscopoEdicaoDialog
        open={escopo !== null}
        regraAlterada={escopo?.regraAlterada ?? false}
        saving={saving}
        onSomenteEsta={salvarSomenteEsta}
        onEstaEProximas={salvarEstaEProximas}
        onCancel={() => setEscopo(null)}
      />
```

- [ ] **Step 4: Run tests, typecheck, lint**

Run: `npx vitest run apps/crm/src/pages/tarefas && npx tsc -p apps/crm/tsconfig.json --noEmit && npm run lint`
Expected: green.

Browser check: edit an occurrence, change the title, Salvar: the dialog shows both options enabled; change "a cada" to 2: "Somente esta" is disabled with the helper. Choose "Esta e as próximas": toast "Tarefa atualizada!" and the list refetches.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/tarefas/components/EscopoEdicaoDialog.tsx apps/crm/src/pages/tarefas/components/TarefaFormDialog.tsx apps/crm/src/pages/tarefas/__tests__/TarefaFormDialog.test.tsx
git commit -m "feat(tarefas): edit scope dialog and Esta e as proximas flow

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Card icon, detail sheet (Repetição row, series actions, delete dialog), Board/Calendar guards

Spec: "Card and sheet", "Scope dialogs > Delete", "Flows per write path" (Board/Calendar rows), "Encerrar série copy".

**Files:**
- Modify: `apps/crm/src/pages/tarefas/components/TarefaCard.tsx:2,79-90`
- Modify: `apps/crm/src/pages/tarefas/components/TarefaDetailSheet.tsx` (imports; state; handlers; meta rows after Prazo lines 282-295; Subtarefas header lines 322-331; actions lines 391-405; delete AlertDialog lines 408-427)
- Modify: `apps/crm/src/pages/tarefas/views/BoardView.tsx:51-64`, `apps/crm/src/pages/tarefas/views/CalendarView.tsx:234-253`
- Create: `apps/crm/src/pages/tarefas/__tests__/TarefaDetailSheet.test.tsx`
- Modify: `apps/crm/src/pages/tarefas/__tests__/TarefaCard.test.tsx`, `BoardView.test.tsx`

**Interfaces:**
- Consumes: `describeRecorrencia`, `modoLabel`, `serieEstado`, `serieEstadoLabel` (Task 7); `definirEstadoSerie`, `deleteTarefaSerieCompleta`, `isSerieDateConflict` (Task 6); lucide `Repeat`, `Pause`, `Play`, `Ban`.
- Produces: no new exports. Behaviour contracts tested below.

- [ ] **Step 1: Write the failing tests**

`TarefaCard.test.tsx`: add `serie: null` already done in Task 6; append one test to the existing `describe` (reuse its `makeTarefa`/render helpers):

```tsx
  it('shows the repeat icon with the rule summary for an occurrence', () => {
    render(
      <TarefaCard
        tarefa={makeTarefa({
          serie: { id: 1, freq: 'weekly', intervalo: 1, dias_semana: [1], dia_mes: null, mes: null,
            modo: 'ao_concluir', fim: null, inicio: '2026-01-05', pausada: false, encerrada_em: null, proxima_data: null },
        })}
        membro={null}
        now={new Date()}
        onClick={() => {}}
        membros={[]}
        onRefresh={() => {}}
      />,
    );
    expect(screen.getByRole('img', { name: 'Tarefa recorrente' })).toHaveAttribute('title', 'Toda segunda');
  });
```

`BoardView.test.tsx`: append to the existing `describe` (uses `renderBoard`, `getCapturedOnDropCard`, `makeTarefa`):

```tsx
  it('refuses to drop a series occurrence on "Sem data" and shows the toast', async () => {
    renderBoard({
      tarefas: [makeTarefa({ data_limite: '2026-07-30', serie: { id: 1, freq: 'daily', intervalo: 1, dias_semana: null,
        dia_mes: null, mes: null, modo: 'calendario', fim: null, inicio: '2026-07-30', pausada: false, encerrada_em: null, proxima_data: '2026-07-31' } })],
    });
    const onDrop = getCapturedOnDropCard();
    const tarefa = getCapturedColumns().flatMap((c) => c.tarefas)[0];
    await act(async () => {
      await onDrop(tarefa, buildDropId({ kind: 'day', date: null }));
    });
    expect(updateTarefaMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith('Tarefas de uma série precisam de prazo.');
  });

  it('maps 23505 on tarefas_serie_data_uq to the specific toast', async () => {
    updateTarefaMock.mockRejectedValueOnce({ code: '23505', message: 'duplicate key value violates unique constraint "tarefas_serie_data_uq"' });
    renderBoard({ tarefas: [makeTarefa({ data_limite: '2026-07-30' })] });
    const tarefa = getCapturedColumns().flatMap((c) => c.tarefas)[0];
    await act(async () => {
      await getCapturedOnDropCard()(tarefa, buildDropId({ kind: 'day', date: '2026-07-31' }));
    });
    expect(toastErrorMock).toHaveBeenCalledWith('Já existe uma ocorrência desta série nesse dia.');
  });
```

Add `import { buildDropId } from '../tarefasLogic';` to the test (it is the same builder `BoardView` uses for its column ids, so the test never hard-codes the id format).

Create `apps/crm/src/pages/tarefas/__tests__/TarefaDetailSheet.test.tsx`:

```tsx
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { TarefaWithRelations } from '../../../store';

const { deleteTarefaMock, deleteSerieMock, definirEstadoMock, getSubtarefasMock, toastSuccessMock, toastErrorMock } =
  vi.hoisted(() => ({
    deleteTarefaMock: vi.fn(),
    deleteSerieMock: vi.fn(),
    definirEstadoMock: vi.fn(),
    getSubtarefasMock: vi.fn(),
    toastSuccessMock: vi.fn(),
    toastErrorMock: vi.fn(),
  }));

vi.mock('../../../store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../store')>();
  return {
    ...actual,
    deleteTarefa: deleteTarefaMock,
    deleteTarefaSerieCompleta: deleteSerieMock,
    definirEstadoSerie: definirEstadoMock,
    getSubtarefas: getSubtarefasMock,
    updateTarefa: vi.fn(),
  };
});
vi.mock('sonner', () => ({ toast: { success: toastSuccessMock, error: toastErrorMock } }));
// Same reasoning as TarefaCard.test.tsx: Radix DropdownMenu does not open under jsdom.
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
}));

import { TarefaDetailSheet } from '../components/TarefaDetailSheet';

const SERIE = {
  id: 9, freq: 'weekly' as const, intervalo: 1, dias_semana: [1], dia_mes: null, mes: null,
  modo: 'ao_concluir' as const, fim: null, inicio: '2026-01-05', pausada: false, encerrada_em: null, proxima_data: null,
};

function makeTarefa(overrides: Partial<TarefaWithRelations> = {}): TarefaWithRelations {
  return {
    id: 42, titulo: 'Relatório', descricao: null, descricao_rich: null, status: 'pendente',
    responsavel_id: null, cliente_id: null, data_limite: '2026-01-12', concluida_em: null,
    created_at: '2026-01-01T10:00:00', tags: [], subtarefas_total: 0, subtarefas_concluidas: 0,
    cliente_nome: null, cliente_cor: null, serie: null, ...overrides,
  };
}

function renderSheet(tarefa: TarefaWithRelations, onRefresh = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={qc}>
      <TarefaDetailSheet tarefa={tarefa} membros={[]} onClose={() => {}} onEdit={() => {}} onRefresh={onRefresh} />
    </QueryClientProvider>,
  );
  return onRefresh;
}

beforeEach(() => {
  vi.clearAllMocks();
  getSubtarefasMock.mockResolvedValue([]);
  deleteTarefaMock.mockResolvedValue(undefined);
  deleteSerieMock.mockResolvedValue(undefined);
  definirEstadoMock.mockResolvedValue(undefined);
});

describe('TarefaDetailSheet series', () => {
  it('shows the Repetição row with summary, mode and hint under Subtarefas', async () => {
    renderSheet(makeTarefa({ serie: { ...SERIE, fim: '2026-12-31' } }));
    expect(screen.getByText('Repete: Toda segunda até 31/12/2026 · cria a próxima ao concluir')).toBeInTheDocument();
    expect(screen.getByText('Termina em 31/12/2026')).toBeInTheDocument();
    expect(
      screen.getByText('As próximas ocorrências usam a lista da série. Para mudar, edite a tarefa e escolha Esta e as próximas.'),
    ).toBeInTheDocument();
  });

  it('offers Pausar/Encerrar when active and Retomar/Encerrar when paused, calling definirEstadoSerie', async () => {
    const onRefresh = renderSheet(makeTarefa({ serie: SERIE }));
    fireEvent.click(screen.getByRole('button', { name: 'Pausar série' }));
    await waitFor(() => expect(definirEstadoMock).toHaveBeenCalledWith(9, 'pausar'));
    expect(onRefresh).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Retomar série' })).not.toBeInTheDocument();
  });

  it('paused: Retomar calls retomar; Encerrar asks for confirmation first', async () => {
    renderSheet(makeTarefa({ serie: { ...SERIE, pausada: true } }));
    expect(screen.getByText('Pausada')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retomar série' }));
    await waitFor(() => expect(definirEstadoMock).toHaveBeenCalledWith(9, 'retomar'));
    fireEvent.click(screen.getByRole('button', { name: 'Encerrar série' }));
    expect(await screen.findByText('Encerrar série?')).toBeInTheDocument();
    expect(screen.getByText('As ocorrências já criadas continuam como estão. Nenhuma nova será criada.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Encerrar' }));
    await waitFor(() => expect(definirEstadoMock).toHaveBeenCalledWith(9, 'encerrar'));
  });

  it('ended or concluded series shows no actions', () => {
    renderSheet(makeTarefa({ serie: { ...SERIE, encerrada_em: '2026-01-01T00:00:00Z' } }));
    expect(screen.getByText('Encerrada')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pausar série' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Encerrar série' })).not.toBeInTheDocument();
  });

  it('delete dialog for an occurrence: "Somente esta" deletes the task, "Toda a série" calls the RPC', async () => {
    renderSheet(makeTarefa({ serie: SERIE }));
    fireEvent.click(screen.getByRole('button', { name: /Excluir/ }));
    expect(await screen.findByText('Excluir tarefa recorrente?')).toBeInTheDocument();
    expect(screen.getByText('A próxima ocorrência será criada normalmente.')).toBeInTheDocument();
    expect(screen.getByText('Remove a série e as ocorrências abertas. As concluídas ficam.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Somente esta' }));
    await waitFor(() => expect(deleteTarefaMock).toHaveBeenCalledWith(42));
    expect(deleteSerieMock).not.toHaveBeenCalled();
  });

  it('"Toda a série" calls deleteTarefaSerieCompleta with the series id', async () => {
    renderSheet(makeTarefa({ serie: SERIE }));
    fireEvent.click(screen.getByRole('button', { name: /Excluir/ }));
    await screen.findByText('Excluir tarefa recorrente?');
    fireEvent.click(screen.getByRole('button', { name: 'Toda a série' }));
    await waitFor(() => expect(deleteSerieMock).toHaveBeenCalledWith(9));
    expect(toastSuccessMock).toHaveBeenCalledWith('Série excluída!');
  });

  it('standalone task keeps the current delete dialog', async () => {
    renderSheet(makeTarefa());
    fireEvent.click(screen.getByRole('button', { name: /Excluir/ }));
    expect(await screen.findByText('Excluir tarefa?')).toBeInTheDocument();
    expect(screen.queryByText('Toda a série')).not.toBeInTheDocument();
  });
});
```

Run: `npx vitest run apps/crm/src/pages/tarefas`
Expected: the new tests FAIL (no icon, no Repetição row, no series dialog, no toast guard).

- [ ] **Step 2: `TarefaCard.tsx`**

Import `Repeat` from `lucide-react` and `describeRecorrencia` from `'../recorrenciaLogic'`. Replace the title `<div>` (lines 79-90) with:

```tsx
        <div
          style={{
            fontSize: '0.82rem',
            fontWeight: 600,
            color: 'var(--text-main)',
            lineHeight: 1.35,
            textDecoration: tarefa.status === 'concluida' ? 'line-through' : undefined,
            opacity: tarefa.status === 'concluida' ? 0.6 : 1,
            display: 'flex',
            alignItems: 'center',
            gap: '0.3rem',
          }}
        >
          {tarefa.serie && (
            <span
              role="img"
              aria-label="Tarefa recorrente"
              title={describeRecorrencia(tarefa.serie)}
              style={{ display: 'inline-flex', color: 'var(--text-muted)', flexShrink: 0 }}
            >
              <Repeat className="h-3 w-3" />
            </span>
          )}
          <span>{tarefa.titulo}</span>
        </div>
```

- [ ] **Step 3: `TarefaDetailSheet.tsx`**

Imports: add `Ban, Pause, Play, Repeat` to the lucide import; `definirEstadoSerie, deleteTarefaSerieCompleta` to the store import; `import { describeRecorrencia, modoLabel, serieEstado, serieEstadoLabel } from '../recorrenciaLogic';`.

State and derived values (after `const badge = ...`):

```ts
  const [confirmEncerrar, setConfirmEncerrar] = useState(false);
  const [serieBusy, setSerieBusy] = useState(false);
  const serie = tarefa.serie;
  const estado = serie ? serieEstado(serie, now) : null;
  const estadoLabel = serie ? serieEstadoLabel(serie, now) : null;
```

Handlers (after `handleDeleteTarefa`):

```ts
  const handleSerieEstado = async (verbo: 'pausar' | 'retomar' | 'encerrar') => {
    if (!serie) return;
    setSerieBusy(true);
    try {
      await definirEstadoSerie(serie.id, verbo);
      toast.success(
        verbo === 'pausar' ? 'Série pausada!' : verbo === 'retomar' ? 'Série retomada!' : 'Série encerrada!',
      );
      setConfirmEncerrar(false);
      onRefresh();
    } catch {
      toast.error('Erro ao atualizar a série');
    } finally {
      setSerieBusy(false);
    }
  };

  const handleDeleteSerie = async () => {
    if (!serie) return;
    try {
      await deleteTarefaSerieCompleta(serie.id);
      toast.success('Série excluída!');
      setConfirmDelete(false);
      onClose();
      onRefresh();
    } catch {
      toast.error('Erro ao excluir a série');
    }
  };
```

Meta row, inserted right after the Prazo row (line 295) and before the Cliente row:

```tsx
            {serie && estado && (
              <div className="flex items-start gap-2">
                <span className="text-xs w-24 shrink-0 pt-0.5" style={{ color: 'var(--text-muted)' }}>
                  Repetição
                </span>
                <div className="flex flex-col gap-1.5 text-sm">
                  <span className="inline-flex items-center gap-2 flex-wrap">
                    <Repeat className="h-3.5 w-3.5" style={{ color: 'var(--text-muted)' }} />
                    <span>
                      Repete: {describeRecorrencia(serie)} · {modoLabel(serie.modo)}
                    </span>
                    {estadoLabel && (
                      <span
                        className="text-xs px-1.5 py-0.5 rounded-md"
                        style={{ background: 'var(--surface-hover)', color: 'var(--text-muted)' }}
                      >
                        {estadoLabel}
                      </span>
                    )}
                  </span>
                  {(estado === 'ativa' || estado === 'pausada') && (
                    <div className="flex gap-1.5">
                      {estado === 'ativa' ? (
                        <Button type="button" size="sm" variant="outline" className="h-7 text-xs"
                          disabled={serieBusy} onClick={() => handleSerieEstado('pausar')}>
                          <Pause className="h-3 w-3 mr-1" /> Pausar série
                        </Button>
                      ) : (
                        <Button type="button" size="sm" variant="outline" className="h-7 text-xs"
                          disabled={serieBusy} onClick={() => handleSerieEstado('retomar')}>
                          <Play className="h-3 w-3 mr-1" /> Retomar série
                        </Button>
                      )}
                      <Button type="button" size="sm" variant="ghost" className="h-7 text-xs"
                        disabled={serieBusy} onClick={() => setConfirmEncerrar(true)}>
                        <Ban className="h-3 w-3 mr-1" /> Encerrar série
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}
```

(The spec says "a series actions menu"; two inline buttons under the row read better inside a 440px sheet and are what the tests drive. Keep the button labels exactly `Pausar série`, `Retomar série`, `Encerrar série`.)

Subtarefas hint, right after the `Subtarefas ...` header `<div>` (line 331):

```tsx
            {serie && (
              <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
                As próximas ocorrências usam a lista da série. Para mudar, edite a tarefa e escolha Esta e as
                próximas.
              </p>
            )}
```

Encerrar confirmation, after the existing delete `<AlertDialog>`:

```tsx
        <AlertDialog open={confirmEncerrar} onOpenChange={setConfirmEncerrar}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Encerrar série?</AlertDialogTitle>
              <AlertDialogDescription>
                As ocorrências já criadas continuam como estão. Nenhuma nova será criada.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  handleSerieEstado('encerrar');
                }}
              >
                Encerrar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
```

Delete dialog: replace the existing `<AlertDialog open={confirmDelete} ...>` block with a conditional on `serie`:

```tsx
        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            {serie ? (
              <>
                <AlertDialogHeader>
                  <AlertDialogTitle>Excluir tarefa recorrente?</AlertDialogTitle>
                  <AlertDialogDescription>
                    A tarefa &quot;{tarefa.titulo}&quot; faz parte de uma série.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="flex flex-col gap-3 text-sm">
                  <div>
                    <Button type="button" variant="outline" className="w-full" onClick={handleDeleteTarefa}>
                      Somente esta
                    </Button>
                    {tarefa.status !== 'concluida' && serie.modo === 'ao_concluir' && (
                      <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                        A próxima ocorrência será criada normalmente.
                      </p>
                    )}
                  </div>
                  <div>
                    <Button
                      type="button"
                      className="w-full bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90"
                      onClick={handleDeleteSerie}
                    >
                      Toda a série
                    </Button>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                      Remove a série e as ocorrências abertas. As concluídas ficam.
                    </p>
                  </div>
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                </AlertDialogFooter>
              </>
            ) : (
              <>
                <AlertDialogHeader>
                  <AlertDialogTitle>Excluir tarefa?</AlertDialogTitle>
                  <AlertDialogDescription>
                    A tarefa &quot;{tarefa.titulo}&quot; e suas subtarefas serão excluídas. Essa ação não pode
                    ser desfeita.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90"
                    onClick={handleDeleteTarefa}
                  >
                    Excluir tarefa
                  </AlertDialogAction>
                </AlertDialogFooter>
              </>
            )}
          </AlertDialogContent>
        </AlertDialog>
```

- [ ] **Step 4: `BoardView.tsx` and `CalendarView.tsx`**

`BoardView.tsx` `handleDrop` becomes (import `isSerieDateConflict` from the store):

```ts
  const handleDrop = async (tarefa: TarefaWithRelations, dropId: string) => {
    const target = parseDropId(dropId);
    if (!target || target.kind !== 'day') return;
    if (tarefa.data_limite === target.date) return;
    if (target.date === null && tarefa.serie) {
      toast.error('Tarefas de uma série precisam de prazo.');
      return;
    }
    applyOverride(tarefa.id!, { data_limite: target.date });
    try {
      await updateTarefa(tarefa.id!, { data_limite: target.date });
      toast.success(target.date ? 'Prazo atualizado!' : 'Prazo removido!');
      onRefresh();
    } catch (e) {
      clearOverride(tarefa.id!);
      toast.error(
        isSerieDateConflict(e) ? 'Já existe uma ocorrência desta série nesse dia.' : 'Erro ao atualizar prazo',
      );
    }
  };
```

`CalendarView.tsx` `handleDragEnd` (lines 234-253) becomes (import `isSerieDateConflict` from the store there too):

```ts
  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveTarefa(null);
    const { active, over } = event;
    if (!over) return;
    const tarefa = merged.find((t) => String(t.id) === String(active.id));
    if (!tarefa) return;
    const target = parseDropId(String(over.id));
    if (!target || target.kind !== 'day') return;
    if (tarefa.data_limite === target.date || (!tarefa.data_limite && target.date === null)) return;
    if (target.date === null && tarefa.serie) {
      toast.error('Tarefas de uma série precisam de prazo.');
      return;
    }
    applyOverride(tarefa.id!, { data_limite: target.date });
    try {
      await updateTarefa(tarefa.id!, { data_limite: target.date });
      toast.success(target.date ? 'Prazo atualizado!' : 'Prazo removido!');
      onRefresh();
    } catch (e) {
      clearOverride(tarefa.id!);
      toast.error(
        isSerieDateConflict(e) ? 'Já existe uma ocorrência desta série nesse dia.' : 'Erro ao atualizar prazo',
      );
    }
  };
```

- [ ] **Step 5: Run everything**

Run: `npx vitest run apps/crm/src/pages/tarefas && npx tsc -p apps/crm/tsconfig.json --noEmit && npm run lint && npm run format:check`
Expected: green (run `npm run format` if prettier complains, then re-check).

Browser check: the card of an occurrence shows the repeat icon with the summary tooltip; the sheet shows the Repetição row with the pill and the Pausar/Encerrar buttons; Excluir on an occurrence shows the two-option dialog; dragging an occurrence to "Sem data" in the Board shows the toast and does not move the card.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/pages/tarefas
git commit -m "feat(tarefas): series in card, detail sheet, delete dialog and date-drop guards

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: MCP error mapping and `serie_id` projection

Spec: "MCP".

**Files:**
- Create: `supabase/functions/mcp/task-errors.ts`
- Create: `supabase/functions/__tests__/mcp-task-errors_test.ts`
- Modify: `supabase/functions/mcp/queries.ts:790-791` (`TASK_SELECT`), `:893-900` (`updateTask` error handling)

**Interfaces:**
- Consumes: `McpInputError` from `supabase/functions/_shared/mcp-token.ts` (line 92, `export class McpInputError extends Error {}`).
- Produces: `export function throwTaskWriteError(error: { code?: string; message?: string }): never` in `mcp/task-errors.ts`.

`check:functions` runs `deno check` over `*/index.ts` and `_shared/**`, so `mcp/task-errors.ts` is type-checked through `mcp/index.ts` -> `queries.ts` -> `task-errors.ts`. `test:functions` runs `--no-check`.

- [ ] **Step 1: Write the failing Deno test**

Create `supabase/functions/__tests__/mcp-task-errors_test.ts`:

```ts
import { assert, assertEquals } from "./assert.ts";
import { McpInputError } from "../_shared/mcp-token.ts";
import { throwTaskWriteError } from "../mcp/task-errors.ts";

function capture(fn: () => never): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return undefined;
}

Deno.test("throwTaskWriteError: 23514 on tarefas_serie_exige_prazo -> McpInputError pt-BR", () => {
  const e = capture(() =>
    throwTaskWriteError({ code: "23514", message: 'new row for relation "tarefas" violates check constraint "tarefas_serie_exige_prazo"' })
  );
  assert(e instanceof McpInputError);
  assertEquals((e as Error).message, "Tarefas de uma série precisam de prazo.");
});

Deno.test("throwTaskWriteError: 23505 on tarefas_serie_data_uq -> McpInputError pt-BR", () => {
  const e = capture(() =>
    throwTaskWriteError({ code: "23505", message: 'duplicate key value violates unique constraint "tarefas_serie_data_uq"' })
  );
  assert(e instanceof McpInputError);
  assertEquals((e as Error).message, "Já existe uma ocorrência desta série nessa data.");
});

Deno.test("throwTaskWriteError: anything else is rethrown untouched", () => {
  const original = { code: "23505", message: "other unique" };
  const e = capture(() => throwTaskWriteError(original));
  assert(!(e instanceof McpInputError));
  assertEquals(e, original);
});
```

Run: `npm run test:functions -- --filter "throwTaskWriteError"`
Expected: FAIL, module `../mcp/task-errors.ts` not found. (`--filter` matches test names; it reaches the import error first.)

- [ ] **Step 2: Write `task-errors.ts` and wire it**

`supabase/functions/mcp/task-errors.ts`:

```ts
import { McpInputError } from "../_shared/mcp-token.ts";

/** Maps the two constraint failures a task write can hit because of series
 *  occurrences to agent-readable pt-BR errors; rethrows everything else.
 *  Generic messages only: never leak raw Postgres details to the client. */
export function throwTaskWriteError(error: { code?: string; message?: string }): never {
  const msg = error.message ?? "";
  if (error.code === "23514" && msg.includes("tarefas_serie_exige_prazo")) {
    throw new McpInputError("Tarefas de uma série precisam de prazo.");
  }
  if (error.code === "23505" && msg.includes("tarefas_serie_data_uq")) {
    throw new McpInputError("Já existe uma ocorrência desta série nessa data.");
  }
  throw error;
}
```

In `queries.ts`: `import { throwTaskWriteError } from "./task-errors.ts";`; change `TASK_SELECT` to

```ts
const TASK_SELECT =
  "id, titulo, descricao, status, responsavel_id, cliente_id, data_limite, concluida_em, serie_id, created_at, updated_at";
```

and in `updateTask` replace `if (error) throw error;` (the one after the `.update(payload)` chain, line ~900) with `if (error) throwTaskWriteError(error);`. `createTask` is untouched (it never sets `serie_id`, so neither constraint can fire).

- [ ] **Step 3: Run the gates**

Run: `npm run check:functions && npm run test:functions -- --filter "throwTaskWriteError"`
Expected: `deno check` silent; 3 passed.

Then `npm ci` if `node_modules/.deno` appeared (memory: Deno runs pollute node_modules), and `git checkout deno.lock` if `test:functions` dirtied it.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/mcp/task-errors.ts supabase/functions/mcp/queries.ts supabase/functions/__tests__/mcp-task-errors_test.ts
git commit -m "feat(mcp): map series constraint errors on update_task, expose serie_id

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: Staging rollout, browser E2E checklist, PR

Spec: "Rollout", "Cron-health", "Rollback".

**Files:** none new. This task is verification and deployment.

**Interfaces:**
- Consumes: everything above.
- Produces: migrations applied to staging (then production, before merge), a green PR.

- [ ] **Step 1: Full local gate**

```bash
npm run lint && npm run format:check
npx tsc -p apps/crm/tsconfig.json --noEmit && npx tsc -p apps/hub/tsconfig.json --noEmit && npx tsc -p apps/admin/tsconfig.json --noEmit && npx tsc -p tsconfig.scripts.json
npm run test
npm run check:functions && npm run test:functions
npx supabase db reset && bash scripts/test-entitlements.sh
```
Expected: all green. Then `npm ci` (Deno pollutes `node_modules`) and `git status` clean except your commits.

- [ ] **Step 2: Migration prefix re-check**

```bash
git fetch origin main && git ls-tree --name-only origin/main supabase/migrations/ | sort | tail -3
```
Expected: the last name is below `20260925000030`. If not, rename both files (and the `-- supabase/migrations/...` header comment in the first) to prefixes above the new tail; `git mv` and amend the last commit.

- [ ] **Step 3: Staging**

Project ref for staging is in memory (`reference_supabase_project_refs`); check `supabase/.temp/project-ref` first.

```bash
npx supabase db push --linked        # or out of band per reference_staging_ops_management_api
```

Then, through `supabase db query` (memory: `reference_supabase_db_query_cli`, `--linked`):

```sql
SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'tarefas-recorrentes-generate';
SELECT * FROM public.generate_recurring_tarefas();
```
Expected: one active job; the function returns `(0, 0)` on an empty staging.

Browser-pane E2E against staging (`npm run dev:staging`; memory: worktrees lack `.env.staging`, copy it from the main checkout first; `reference_seed_login_browser_verification` for login):

1. Nova tarefa "Relatório semanal", Prazo = next Monday, Repetir = Semanalmente, chip S(egunda), mode "Criar a próxima ao concluir", one tag, Criar tarefa. Expect: card with the repeat icon; sheet shows "Repete: Toda segunda · cria a próxima ao concluir".
2. Complete it from the kanban. Expect after refetch: a new pending occurrence dated the following Monday, same tag, subtasks unchecked.
3. Nova tarefa "Diária", Prazo = today, Repetir = Diariamente, mode "Criar em toda data da regra". In `supabase db query`: `SELECT proxima_data FROM tarefa_series ORDER BY id DESC LIMIT 1` = tomorrow. Run `SELECT * FROM public.generate_recurring_tarefas()` = `(0, 0)` (cursor is tomorrow). `UPDATE` nothing by hand; instead wait for the next hourly run after midnight or set `app.tarefa_hoje` in a session: `BEGIN; SELECT set_config('app.tarefa_hoje', (current_date + 1)::text, true); SELECT * FROM public.generate_recurring_tarefas(); ROLLBACK;` = `(1, 1)`.
4. Edit the weekly occurrence, change the title, Salvar, "Esta e as próximas". Expect toast and, after completing it, the next occurrence carries the new title.
5. Edit it again, "a cada" = 2: "Somente esta" disabled with the helper.
6. Sheet: Pausar série (pill "Pausada"), Retomar série, Encerrar série (confirm dialog, pill "Encerrada", no buttons).
7. Board view: drag an occurrence to "Sem data": toast "Tarefas de uma série precisam de prazo.", card does not move.
8. Sheet Excluir on an occurrence: two-option dialog; "Toda a série": completed occurrences remain without the icon, open ones disappear.
9. Nova tarefa with Repetir = Semanalmente and no chip: "Escolha ao menos um dia da semana."; with Prazo yesterday: "Para repetir, o prazo precisa ser hoje ou depois."
10. Ideias > convert a solicitação into a task: the form has no Repetir section.
11. cron-health: next hour, `SELECT status FROM cron.job_run_details WHERE jobid = (SELECT jobid FROM cron.job WHERE jobname = 'tarefas-recorrentes-generate') ORDER BY start_time DESC LIMIT 1` = `succeeded`.

- [ ] **Step 4: Production migrations BEFORE merge**

Merge deploys the frontend immediately, and the new frontend embeds `tarefa_series` and calls the RPCs. Push the two migrations to production first (same `db push` against the prod ref), verify the job row and one `generate_recurring_tarefas()` call, then merge. No edge function deploy is required; redeploying `mcp` (for `serie_id` in `list_tasks` and the error mapping) is optional and non-blocking: `npx supabase functions deploy mcp --no-verify-jwt --use-api --project-ref <ref>`.

- [ ] **Step 5: PR**

```bash
git push -u origin claude/recurring-tasks-ed0e07
gh pr create --title "feat(tarefas): tarefas recorrentes (series geradas no banco)" --body "$(cat <<'EOF'
## Summary
- `tarefa_series` + `tarefas.serie_id`; date math, materialization, triggers and the hourly `tarefas-recorrentes-generate` pg_cron job live in Postgres (migrations 20260925000030/31)
- Four SECURITY DEFINER RPCs are the whole write surface; the table is SELECT-only for `authenticated`
- CRM: "Repetir" section in the task form, scope dialogs (Somente esta / Esta e as próximas, Somente esta / Toda a série), card icon, sheet row with Pausar/Retomar/Encerrar
- MCP: `update_task` maps the two new constraint errors; `list_tasks` exposes `serie_id`

Spec: docs/superpowers/specs/2026-09-21-tarefas-recorrentes-design.md
Plan: docs/superpowers/plans/2026-09-21-tarefas-recorrentes.md

Clarification recorded during implementation: in `ao_concluir`, resuming a paused series on a rule day creates the following rule date (the helper is always "strictly after today"); the "today counts" rule applies to the `calendario` cursor.

## Rollout
- [ ] staging migrations + E2E checklist (plan Task 12)
- [ ] production migrations applied BEFORE merge
- [ ] cron-health shows `tarefas-recorrentes-generate` succeeded

## Test plan
- psql suites 99_tarefa_next_date, 99_tarefa_series_rls, 99_tarefa_series_geracao; 96_ lockdown list extended
- Vitest: store, recorrenciaLogic, TarefaFormDialog, TarefaDetailSheet, TarefaCard, BoardView
- Deno: mcp-task-errors_test

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expect an external Codex review on the PR (memory: every PR gets one; it may land after a fast merge, so read it either way).

---

## Self-Review

**1. Spec coverage** (section -> task):

- Data model `tarefa_series` (columns, CHECKs, validators, indexes, `updated_at`) -> Task 2. `tarefas` changes (simple FK, UNIQUE, CHECK, index, WITH CHECK EXISTS, `tarefas_serie_id_guard`) -> Task 2. Deleted tags / responsavel -> Task 3 (JOIN filter, FK SET NULL).
- Generation: `tarefa_hoje_sp` + GUC, closed-form `tarefa_next_date`/`tarefa_prev_date`, floor division, 33-case table -> Task 1. Materialization + `garantir_aberta` -> Task 3. `ao_concluir` trigger, delete trigger (both early returns), resume trigger -> Task 3. `calendario` generator (latest-only catch-up, `fim` cap, defensive exhaust, no per-series EXCEPTION, cursor flag) + schedule migration + rollback order -> Task 5. `proxima_data` DB-owned (identity-free guard, INSERT/recompute/resume/`fim` events, normalization against `fim`, one-way `encerrada_em`, immutable identity) -> Task 2.
- Series states (exclusive precedence, one pure function) -> Task 7 (`serieEstado`), consumed only by Task 10.
- Create RPC (new + promotion with lock and rejections), `aplicar_edicao` (order 0-3, whole-state copy, `p_encerrar`), `definir_estado`, `excluir` (mandatory order), grants pattern, tenant scoping -> Task 4.
- Notifications: no code (verified behaviour of the existing trigger); `syncMentions` best-effort after the RPC -> Task 6.
- Security and grants: table REVOKE + SELECT-only policy -> Task 2; internal helpers service_role only -> Tasks 3, 4, 5; 96_ list -> Task 5; pure date functions keep PUBLIC execute -> Task 1.
- Store (types, embed, RPC wrappers, `isSerieDateConflict`, fixtures) -> Task 6.
- Form: Repetir section, hidden under `onCreate`, disabled for a `concluida` standalone task, landing day kept in edit mode, validation copy, summary, no client date math -> Tasks 7 and 8. Scope dialog and the four edit flows -> Task 9.
- Card icon, sheet row + actions + subtask hint, delete dialog, Board/Calendar "Sem data" and 23505 toasts -> Task 10.
- MCP mapping + `serie_id` projection -> Task 11.
- Testing: three psql suites (cases a to o plus the `fim` recovery and bad-row cases) -> Tasks 1 to 5; Vitest files named in the spec -> Tasks 6 to 10; cron-health rollout checks -> Task 12.
- Rollout / rollback -> Tasks 5 (rollback comment) and 12.

Gaps (deliberate, recorded): `getTarefaSerie` is not implemented (embed carries the rule; Task 6 note). The toast "Tarefa criada, mas as menções não foram registradas." is unreachable because `syncMentions` already swallows its own failure (verified in `store/mentions.ts`), so it is not implemented. The spec's "series actions menu" is two inline buttons in the sheet (Task 10 note). The `fim` recompute event and the generator's defensive exhaust were added by Codex rounds and are in both spec and plan.

**2. Placeholder scan:** no "TBD"/"TODO"/"implement later"/"similar to Task N"; every code step has its code; every test step has its assertions; every run step has its command and expected output.

**3. Type consistency:** `TarefaSerieRegra`/`TarefaSerieResumo`/`TarefaSeriePayload`/`TarefaSerieEstadoVerbo` are defined in Task 6 and used with those names in Tasks 7 to 10; `criarTarefaSerie(regra, tarefa, tagIds, subtarefas, tarefaId?)` has the same argument order in the store (6), the form (8), the promotion test (8) and the RPC contract (4); `aplicarEdicaoSerie(tarefaId, tarefa, tagIds, regra, encerrar)` matches Tasks 6 and 9; `serieEstado`/`serieEstadoLabel`/`describeRecorrencia`/`modoLabel`/`regraFromForm`/`regraIgual` are named identically in Tasks 7, 8, 9, 10; SQL signatures in Task 4's `REVOKE`/`GRANT`, the 96_ array and the RLS suite's `has_function_privilege` strings match the `CREATE FUNCTION` parameter lists; trigger names in Task 3 match the rollback list in Task 5; the JSON keys the store sends (`p_serie`, `p_tarefa`, `p_tag_ids`, `p_subtarefas`, `p_tarefa_id`, `p_regra`, `p_encerrar`, `p_serie_id`, `p_estado`) match the RPC parameter names.
