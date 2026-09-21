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
    -- BEFORE triggers run ahead of the table CHECKs. A malformed rule must
    -- reach them and fail there as check_violation, not raise from inside
    -- tarefa_next_date(); so only derive the cursor for a well-formed rule
    -- (this mirrors the freq/intervalo/dias_semana/dia_mes/mes CHECKs).
    IF NEW.inicio IS NULL
       OR NEW.freq IS NULL OR NEW.freq NOT IN ('daily', 'weekly', 'monthly', 'yearly')
       OR NEW.intervalo IS NULL OR NEW.intervalo NOT BETWEEN 1 AND 99
       OR (NEW.freq = 'weekly' AND NOT coalesce(public.tarefa_serie_dias_semana_validos(NEW.dias_semana), false))
       OR (NEW.freq IN ('monthly', 'yearly') AND (NEW.dia_mes IS NULL OR NEW.dia_mes NOT BETWEEN 1 AND 31))
       OR (NEW.freq = 'yearly' AND (NEW.mes IS NULL OR NEW.mes NOT BETWEEN 1 AND 12)) THEN
      NEW.proxima_data := NULL;
      RETURN NEW;
    END IF;
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
