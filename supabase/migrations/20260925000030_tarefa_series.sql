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

-- jsonb array of numbers -> int[]; NULL when p is NULL or not an array. A
-- non-numeric element RAISES 22P02 (and 1.0 does too), so callers validate the
-- shape first: the RPCs go through tarefa_serie_parse_dias_semana().
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
-- (cascade order between tarefas and tarefa_series is unspecified); (b) modo is
-- read WITHOUT a lock and anything but ao_concluir returns (this also covers a
-- series that is already gone). Same pre-check as the completion trigger:
-- garantir_aberta locks the series row before it looks at modo, so without it a
-- delete of a calendario occurrence would wait on the generator's scan (and
-- could deadlock with it on the same (serie_id, data_limite)).
CREATE OR REPLACE FUNCTION public.tarefas_serie_ao_excluir_fn() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_modo text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM workspaces WHERE id = OLD.conta_id) THEN RETURN NULL; END IF;
  SELECT modo INTO v_modo FROM tarefa_series WHERE id = OLD.serie_id;
  IF v_modo IS DISTINCT FROM 'ao_concluir' THEN RETURN NULL; END IF;
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
  -- garantir_aberta floors p_after at greatest(p_after, today), so any value <= today
  -- is equivalent here: resuming an ao_concluir series creates the FOLLOWING rule date.
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
GRANT EXECUTE ON FUNCTION public.tarefas_serie_ao_concluir_fn() TO service_role;
REVOKE ALL ON FUNCTION public.tarefas_serie_ao_excluir_fn() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tarefas_serie_ao_excluir_fn() TO service_role;
REVOKE ALL ON FUNCTION public.tarefa_series_apos_retomar_fn() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tarefa_series_apos_retomar_fn() TO service_role;

-- ============ (4) CLIENT-FACING RPCs ============

-- Payload validation for a client-supplied dias_semana (jsonb). The RPCs own
-- the shape check: tarefa_serie_jsonb_int_array() raises 22P02 on a non-numeric
-- element and lets `"1"` / `[null]` / `[7]` through to the table CHECK, so it
-- is only called after this has accepted the payload. Returns NULL for SQL NULL
-- or a JSON null (freq other than weekly); otherwise an array of 0..6 integers
-- (distinctness / 1..7 length stay with the table CHECK).
CREATE OR REPLACE FUNCTION public.tarefa_serie_parse_dias_semana(p jsonb) RETURNS int[]
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF p IS NULL OR jsonb_typeof(p) = 'null' THEN RETURN NULL; END IF;
  IF jsonb_typeof(p) <> 'array' OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(p) e
    WHERE jsonb_typeof(e) <> 'number' OR (e #>> '{}') !~ '^[0-6]$'
  ) THEN
    RAISE EXCEPTION 'Dias da semana inválidos.' USING ERRCODE = '22023';
  END IF;
  RETURN tarefa_serie_jsonb_int_array(p);
END;
$$;
REVOKE ALL ON FUNCTION public.tarefa_serie_parse_dias_semana(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tarefa_serie_parse_dias_semana(jsonb) TO service_role;

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
  v_dias int[];
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
  v_dias := tarefa_serie_parse_dias_semana(p_serie->'dias_semana');

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
          v_dias,
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
  v_dias int[];
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
    v_dias := tarefa_serie_parse_dias_semana(p_regra->'dias_semana');
    IF v_fim IS NOT NULL AND v_fim < v_data THEN
      RAISE EXCEPTION 'A data final precisa ser igual ou depois do prazo.';
    END IF;
    UPDATE tarefa_series
       SET freq = p_regra->>'freq',
           intervalo = coalesce((p_regra->>'intervalo')::int, 1),
           dias_semana = v_dias,
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

  -- (4) an ao_concluir series whose last occurrence is already completed and
  -- whose rule / fim / modo just changed would otherwise stay dormant: the
  -- completion trigger only fires on the status transition. No-op when an open
  -- occurrence exists, the series is paused or ended, or the next date is past fim.
  IF NOT p_encerrar THEN
    PERFORM tarefa_serie_garantir_aberta(v_t.serie_id, v_data);
  END IF;
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
