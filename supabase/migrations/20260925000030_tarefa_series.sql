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
