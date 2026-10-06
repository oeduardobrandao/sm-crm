-- supabase/migrations/20261005000001_agenda_eventos.sql
-- Agenda (sub-projeto 1): eventos com recorrência materializada, privado/ocupado,
-- participantes com RSVP. Spec: docs/superpowers/specs/2026-10-05-agenda-eventos-core-design.md
-- Sections: (1) tables + guard + RLS, (2) date math + materialization + generator,
-- (3) read/create RPCs + notification types, (4) edit/delete/RSVP RPCs.

-- ============ (1) TABLES ============

-- agenda_eventos is the series; a one-off event is a series without a rule.
-- dtstart is the local wall clock (in tz) of the first occurrence.
CREATE TABLE public.agenda_eventos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conta_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  organizador_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  titulo text NOT NULL CHECK (char_length(btrim(titulo)) BETWEEN 1 AND 200),
  descricao text NULL CHECK (descricao IS NULL OR char_length(descricao) <= 5000),
  local text NULL CHECK (local IS NULL OR char_length(local) <= 300),
  link_reuniao text NULL CHECK (link_reuniao IS NULL OR (char_length(link_reuniao) <= 500 AND link_reuniao ~* '^https?://')),
  tipo text NOT NULL DEFAULT 'reuniao' CHECK (tipo IN ('reuniao','gravacao','captacao','apresentacao','interno','outro')),
  cor text NULL CHECK (cor IS NULL OR cor IN ('azul','rosa','laranja','roxo','verde','teal','cinza','amarelo')),
  cliente_id bigint NULL,
  privado boolean NOT NULL DEFAULT false,
  dia_inteiro boolean NOT NULL DEFAULT false,
  tz text NOT NULL DEFAULT 'America/Sao_Paulo',
  dtstart timestamp NOT NULL,
  duracao_min int NULL CHECK (duracao_min IS NULL OR duracao_min BETWEEN 1 AND 20160),
  duracao_dias int NULL CHECK (duracao_dias IS NULL OR duracao_dias BETWEEN 1 AND 31),
  freq text NULL CHECK (freq IS NULL OR freq IN ('daily','weekly','monthly','yearly')),
  intervalo int NOT NULL DEFAULT 1 CHECK (intervalo BETWEEN 1 AND 99),
  dias_semana int[] NULL,
  mensal_modo text NULL CHECK (mensal_modo IS NULL OR mensal_modo IN ('dia_mes','dia_semana')),
  mensal_ordinal int NULL CHECK (mensal_ordinal IS NULL OR mensal_ordinal IN (1,2,3,4,-1)),
  ate date NULL,
  contagem int NULL CHECK (contagem IS NULL OR contagem BETWEEN 1 AND 730),
  lembretes int[] NOT NULL DEFAULT '{}',
  serie_origem_id bigint NULL REFERENCES public.agenda_eventos(id) ON DELETE SET NULL,
  horizonte_ate date NULL,
  materializacao_completa boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agenda_eventos_id_conta_uq UNIQUE (id, conta_id),
  CONSTRAINT agenda_eventos_cliente_fk FOREIGN KEY (cliente_id, conta_id)
    REFERENCES public.clientes(id, conta_id) ON DELETE SET NULL (cliente_id),
  CONSTRAINT agenda_eventos_duracao_ck CHECK (
    (dia_inteiro AND duracao_dias IS NOT NULL AND duracao_min IS NULL AND dtstart::time = '00:00')
    OR (NOT dia_inteiro AND duracao_min IS NOT NULL AND duracao_dias IS NULL)),
  CONSTRAINT agenda_eventos_regra_vazia_ck CHECK (
    freq IS NOT NULL OR (dias_semana IS NULL AND mensal_modo IS NULL AND mensal_ordinal IS NULL AND ate IS NULL AND contagem IS NULL)),
  CONSTRAINT agenda_eventos_fim_ck CHECK (NOT (ate IS NOT NULL AND contagem IS NOT NULL)),
  CONSTRAINT agenda_eventos_ate_ck CHECK (ate IS NULL OR (ate >= dtstart::date AND ate <= (dtstart::date + interval '5 years')::date)),
  CONSTRAINT agenda_eventos_weekly_ck CHECK ((freq = 'weekly') = (dias_semana IS NOT NULL) AND (dias_semana IS NULL OR cardinality(dias_semana) BETWEEN 1 AND 7)),
  CONSTRAINT agenda_eventos_monthly_ck CHECK (
    (freq = 'monthly' AND mensal_modo IS NOT NULL AND ((mensal_modo = 'dia_semana') = (mensal_ordinal IS NOT NULL)))
    OR (freq IS DISTINCT FROM 'monthly' AND mensal_modo IS NULL AND mensal_ordinal IS NULL)),
  CONSTRAINT agenda_eventos_lembretes_ck CHECK (cardinality(lembretes) <= 5)
);
CREATE INDEX agenda_eventos_cliente_idx ON public.agenda_eventos (cliente_id) WHERE cliente_id IS NOT NULL;
CREATE INDEX agenda_eventos_organizador_idx ON public.agenda_eventos (organizador_id);
CREATE INDEX agenda_eventos_serie_origem_idx ON public.agenda_eventos (serie_origem_id) WHERE serie_origem_id IS NOT NULL;

-- One row per date the rule produced. (evento_id, data_original) is the stable
-- identity; a content override lists its fields in campos_sobrescritos (a
-- listed field uses the occurrence's value even when NULL).
CREATE TABLE public.agenda_ocorrencias (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conta_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  evento_id bigint NOT NULL,
  data_original date NOT NULL,
  inicio timestamptz NOT NULL,
  fim timestamptz NOT NULL,
  horario_alterado boolean NOT NULL DEFAULT false,
  titulo text NULL CHECK (titulo IS NULL OR char_length(btrim(titulo)) BETWEEN 1 AND 200),
  descricao text NULL CHECK (descricao IS NULL OR char_length(descricao) <= 5000),
  local text NULL CHECK (local IS NULL OR char_length(local) <= 300),
  link_reuniao text NULL CHECK (link_reuniao IS NULL OR (char_length(link_reuniao) <= 500 AND link_reuniao ~* '^https?://')),
  campos_sobrescritos text[] NOT NULL DEFAULT '{}' CHECK (campos_sobrescritos <@ ARRAY['titulo','descricao','local','link_reuniao']),
  cancelada boolean NOT NULL DEFAULT false,
  CONSTRAINT agenda_ocorrencias_id_conta_uq UNIQUE (id, conta_id),
  CONSTRAINT agenda_ocorrencias_evento_fk FOREIGN KEY (evento_id, conta_id)
    REFERENCES public.agenda_eventos(id, conta_id) ON DELETE CASCADE,
  CONSTRAINT agenda_ocorrencias_data_uq UNIQUE (evento_id, data_original),
  CONSTRAINT agenda_ocorrencias_fim_ck CHECK (fim > inicio)
);
CREATE INDEX agenda_ocorrencias_conta_inicio_idx ON public.agenda_ocorrencias (conta_id, inicio, fim) WHERE NOT cancelada;
CREATE INDEX agenda_ocorrencias_evento_inicio_idx ON public.agenda_ocorrencias (evento_id, inicio) WHERE NOT cancelada;

-- Per series. The organizer is a participant with resposta = 'sim'.
CREATE TABLE public.agenda_participantes (
  evento_id bigint NOT NULL,
  conta_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  resposta text NOT NULL DEFAULT 'pendente' CHECK (resposta IN ('pendente','sim','nao','talvez')),
  respondido_em timestamptz NULL,
  PRIMARY KEY (evento_id, user_id),
  CONSTRAINT agenda_participantes_evento_fk FOREIGN KEY (evento_id, conta_id)
    REFERENCES public.agenda_eventos(id, conta_id) ON DELETE CASCADE
);
CREATE INDEX agenda_participantes_user_idx ON public.agenda_participantes (user_id);

-- RSVP for one occurrence only. Effective answer =
-- coalesce(agenda_respostas.resposta, agenda_participantes.resposta).
CREATE TABLE public.agenda_respostas (
  ocorrencia_id bigint NOT NULL,
  conta_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  resposta text NOT NULL CHECK (resposta IN ('sim','nao','talvez')),
  respondido_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ocorrencia_id, user_id),
  CONSTRAINT agenda_respostas_ocorrencia_fk FOREIGN KEY (ocorrencia_id, conta_id)
    REFERENCES public.agenda_ocorrencias(id, conta_id) ON DELETE CASCADE
);
CREATE INDEX agenda_respostas_user_idx ON public.agenda_respostas (user_id);

-- ---- guard ----
-- Validates what a CHECK cannot (tz needs a lookup that may raise) and the
-- array element rules, and stamps updated_at. SECURITY INVOKER on purpose: it
-- reads nothing beyond NEW and never branches on current_user (same rationale
-- as tarefa_series_guard in 20260925000030_tarefa_series.sql). BEFORE triggers
-- run ahead of the table CHECKs, so NULL arrays are left to the CHECKs
-- (weekly without dias_semana fails there as check_violation).
CREATE OR REPLACE FUNCTION public.agenda_eventos_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.tz IS NOT NULL THEN
    BEGIN
      PERFORM '2000-01-01'::timestamp AT TIME ZONE NEW.tz;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'agenda: fuso horário inválido';
    END;
  END IF;

  IF NEW.dias_semana IS NOT NULL AND (
       coalesce(array_ndims(NEW.dias_semana), 1) <> 1
       OR EXISTS (SELECT 1 FROM unnest(NEW.dias_semana) AS d(v) WHERE d.v IS NULL OR d.v NOT BETWEEN 0 AND 6)
       OR cardinality(NEW.dias_semana) <> (SELECT count(DISTINCT d.v) FROM unnest(NEW.dias_semana) AS d(v))) THEN
    RAISE EXCEPTION 'agenda: dias da semana inválidos';
  END IF;

  IF NEW.lembretes IS NOT NULL AND (
       coalesce(array_ndims(NEW.lembretes), 1) <> 1
       OR EXISTS (SELECT 1 FROM unnest(NEW.lembretes) AS l(v) WHERE l.v IS NULL OR l.v NOT BETWEEN -1440 AND 40320)
       OR cardinality(NEW.lembretes) <> (SELECT count(DISTINCT l.v) FROM unnest(NEW.lembretes) AS l(v))) THEN
    RAISE EXCEPTION 'agenda: lembrete inválido';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agenda_eventos_guard
  BEFORE INSERT OR UPDATE ON public.agenda_eventos
  FOR EACH ROW EXECUTE FUNCTION public.agenda_eventos_guard();

-- ---- RLS ----
-- No policy recursion: a cross EXISTS agenda_eventos <-> agenda_participantes
-- would raise 42P17 (precedent: 20260612120000_fix_workspace_members_rls_recursion.sql).
-- agenda_eventos' policy reads agenda_participantes through this DEFINER helper
-- (owner postgres, so no RLS on that read); the child tables reach the parent
-- with a plain EXISTS (child -> parent only, no cycle). The helper is called
-- from an RLS policy, which evaluates as the querying role, so authenticated
-- keeps EXECUTE (invoker-context exception in suite 96).
CREATE OR REPLACE FUNCTION public.agenda_pode_ver_evento(p_evento_id bigint, p_privado boolean, p_organizador uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT p_privado
      OR p_organizador = auth.uid()
      OR EXISTS (SELECT 1 FROM public.agenda_participantes ap
                 WHERE ap.evento_id = p_evento_id AND ap.user_id = auth.uid());
$$;
REVOKE ALL ON FUNCTION public.agenda_pode_ver_evento(bigint, boolean, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agenda_pode_ver_evento(bigint, boolean, uuid) TO authenticated, service_role;

-- SELECT-only for tenants. There is deliberately no INSERT/UPDATE/DELETE
-- policy: every write goes through the SECURITY DEFINER RPCs (sections 3 and 4).
ALTER TABLE public.agenda_eventos ENABLE ROW LEVEL SECURITY;
CREATE POLICY agenda_eventos_select ON public.agenda_eventos FOR SELECT TO authenticated
  USING (conta_id IN (SELECT public.get_my_conta_id())
         AND (SELECT public.has_permission('calendario','ver'))
         AND public.agenda_pode_ver_evento(id, privado, organizador_id));
CREATE POLICY agenda_eventos_service_role_bypass ON public.agenda_eventos
  FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.agenda_ocorrencias ENABLE ROW LEVEL SECURITY;
CREATE POLICY agenda_ocorrencias_select ON public.agenda_ocorrencias FOR SELECT TO authenticated
  USING (conta_id IN (SELECT public.get_my_conta_id())
         AND EXISTS (SELECT 1 FROM public.agenda_eventos e WHERE e.id = agenda_ocorrencias.evento_id));
CREATE POLICY agenda_ocorrencias_service_role_bypass ON public.agenda_ocorrencias
  FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.agenda_participantes ENABLE ROW LEVEL SECURITY;
CREATE POLICY agenda_participantes_select ON public.agenda_participantes FOR SELECT TO authenticated
  USING (conta_id IN (SELECT public.get_my_conta_id())
         AND EXISTS (SELECT 1 FROM public.agenda_eventos e WHERE e.id = agenda_participantes.evento_id));
CREATE POLICY agenda_participantes_service_role_bypass ON public.agenda_participantes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.agenda_respostas ENABLE ROW LEVEL SECURITY;
CREATE POLICY agenda_respostas_select ON public.agenda_respostas FOR SELECT TO authenticated
  USING (conta_id IN (SELECT public.get_my_conta_id())
         AND EXISTS (SELECT 1 FROM public.agenda_ocorrencias o WHERE o.id = agenda_respostas.ocorrencia_id));
CREATE POLICY agenda_respostas_service_role_bypass ON public.agenda_respostas
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ---- grants ----
-- The hosted default ACL grants ALL on new tables. Revoking only
-- INSERT/UPDATE/DELETE would leave TRUNCATE/REFERENCES/TRIGGER with
-- authenticated (TRUNCATE ignores RLS), so revoke everything and re-grant
-- exactly what is needed (shape of 20260925000030_tarefa_series.sql; the
-- explicit service_role grants are what local/CI rely on, as they lack the
-- hosted default ACL).
REVOKE ALL ON TABLE public.agenda_eventos, public.agenda_ocorrencias,
  public.agenda_participantes, public.agenda_respostas FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.agenda_eventos, public.agenda_ocorrencias,
  public.agenda_participantes, public.agenda_respostas TO authenticated;
GRANT ALL ON TABLE public.agenda_eventos, public.agenda_ocorrencias,
  public.agenda_participantes, public.agenda_respostas TO service_role;
REVOKE ALL ON SEQUENCE public.agenda_eventos_id_seq, public.agenda_ocorrencias_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.agenda_eventos_id_seq, public.agenda_ocorrencias_id_seq TO service_role;

DO $$
DECLARE
  v_table text;
  v_extra text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['agenda_eventos','agenda_ocorrencias','agenda_participantes','agenda_respostas'] LOOP
    SELECT string_agg(privilege_type, ', ' ORDER BY privilege_type) INTO v_extra
      FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = v_table
       AND grantee = 'authenticated' AND privilege_type <> 'SELECT';
    IF v_extra IS NOT NULL THEN
      RAISE EXCEPTION '%: authenticated holds more than SELECT (%)', v_table, v_extra;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.role_table_grants
       WHERE table_schema = 'public' AND table_name = v_table
         AND grantee = 'authenticated' AND privilege_type = 'SELECT'
    ) THEN
      RAISE EXCEPTION '%: authenticated lost SELECT', v_table;
    END IF;
    IF EXISTS (
      SELECT 1 FROM information_schema.role_table_grants
       WHERE table_schema = 'public' AND table_name = v_table
         AND grantee = 'anon'
    ) THEN
      RAISE EXCEPTION '%: anon holds a privilege', v_table;
    END IF;
  END LOOP;
END
$$;

-- ============ (2) DATE MATH + MATERIALIZATION + GENERATOR ============

-- Pure date functions keep the default EXECUTE (like tarefa_next_date): they
-- read nothing but their arguments and the clock.

-- "Today" in a series' tz. app.agenda_hoje pins it for the SQL suites.
CREATE OR REPLACE FUNCTION public.agenda_hoje(p_tz text) RETURNS date
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce(NULLIF(current_setting('app.agenda_hoje', true), '')::date,
                  (now() AT TIME ZONE p_tz)::date);
$$;

-- Rule dates in [p_de, p_ate], honouring ate and contagem. Semantics (spec
-- "Semântica da regra", aligned with RFC 5545): dtstart is the first
-- occurrence; monthly dia_mes skips months without that day; yearly 29/02 only
-- in leap years; weekly intervalo counts Monday-to-Sunday weeks (WKST=MO);
-- contagem counts from dtstart (tombstones included, since they are rule dates).
-- Candidates are scanned day by day up to least(p_ate, ate). Without contagem
-- the scan starts at greatest(dtstart, p_de) (the rule formulas are anchored
-- on dtstart, not on the scan start), so it covers only the asked window; with
-- contagem it starts at dtstart, because numbering counts from dtstart
-- (contagem <= 730 bounds that scan by the rule's own length). Cutting the scan
-- at its end never changes the ordinal of an earlier date. Dates are cast to
-- timestamp (not timestamptz) so the result never depends on the session
-- TimeZone.
CREATE OR REPLACE FUNCTION public.agenda_datas_regra(p_e public.agenda_eventos, p_de date, p_ate date)
RETURNS SETOF date LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_ini date := p_e.dtstart::date;
  v_fim date := least(p_ate, coalesce(p_e.ate, p_ate));
  v_dow int := extract(dow FROM p_e.dtstart::date)::int;
  v_scan date := CASE WHEN p_e.contagem IS NULL THEN greatest(p_e.dtstart::date, p_de) ELSE p_e.dtstart::date END;
BEGIN
  IF p_e.freq IS NULL THEN
    IF v_ini BETWEEN p_de AND p_ate THEN RETURN NEXT v_ini; END IF;
    RETURN;
  END IF;
  IF v_fim IS NULL OR v_fim < v_ini OR v_fim < p_de THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH cand AS (
    SELECT g::date AS d FROM generate_series(v_scan::timestamp, v_fim::timestamp, interval '1 day') g
  ), regra AS (
    SELECT c.d FROM cand c
    WHERE CASE p_e.freq
      WHEN 'daily' THEN (c.d - v_ini) % p_e.intervalo = 0
      WHEN 'weekly' THEN extract(dow FROM c.d)::int = ANY (p_e.dias_semana)
           AND ((date_trunc('week', c.d::timestamp)::date - date_trunc('week', v_ini::timestamp)::date) / 7) % p_e.intervalo = 0
      WHEN 'monthly' THEN
           ((extract(year FROM c.d)::int * 12 + extract(month FROM c.d)::int)
            - (extract(year FROM v_ini)::int * 12 + extract(month FROM v_ini)::int)) % p_e.intervalo = 0
           AND CASE p_e.mensal_modo
             WHEN 'dia_mes' THEN extract(day FROM c.d) = extract(day FROM v_ini)
             WHEN 'dia_semana' THEN extract(dow FROM c.d)::int = v_dow AND (
               (p_e.mensal_ordinal > 0 AND (extract(day FROM c.d)::int - 1) / 7 + 1 = p_e.mensal_ordinal)
               OR (p_e.mensal_ordinal = -1
                   AND (c.d + 7) > ((date_trunc('month', c.d::timestamp) + interval '1 month')::date - 1)))
             ELSE false
           END
      WHEN 'yearly' THEN (extract(year FROM c.d)::int - extract(year FROM v_ini)::int) % p_e.intervalo = 0
           AND extract(month FROM c.d) = extract(month FROM v_ini)
           AND extract(day FROM c.d) = extract(day FROM v_ini)
      ELSE false
    END
  ), numeradas AS (
    SELECT r.d, row_number() OVER (ORDER BY r.d) AS n FROM regra r
  )
  SELECT n.d FROM numeradas n
  WHERE (p_e.contagem IS NULL OR n.n <= p_e.contagem)
    AND n.d BETWEEN p_de AND v_fim
  ORDER BY n.d;
END $$;

-- First rule date >= dtstart::date, at dtstart's wall-clock time. contagem is
-- ignored here (it counts from the normalized dtstart, so it cannot be applied
-- before normalizing). The scan stops at ate or at dtstart + 5 years (the ate
-- CHECK's own ceiling).
CREATE OR REPLACE FUNCTION public.agenda_normalizar_dtstart(p_e public.agenda_eventos)
RETURNS timestamp LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  v_e public.agenda_eventos := p_e;
  v_d date;
BEGIN
  v_e.contagem := NULL;
  SELECT min(d) INTO v_d
    FROM public.agenda_datas_regra(v_e, p_e.dtstart::date,
                                   coalesce(p_e.ate, (p_e.dtstart::date + interval '5 years')::date)) d;
  IF v_d IS NULL THEN
    RAISE EXCEPTION 'agenda: a repetição não gera nenhuma data';
  END IF;
  RETURN v_d + p_e.dtstart::time;
END $$;

-- inicio/fim of the occurrence on p_data (spec "Geração de inicio/fim"). Timed:
-- local wall clock -> instant, fim = inicio + elapsed minutes (like Google).
-- All-day: local-date arithmetic, then conversion (never + 24h), so a DST day
-- is 23 or 25 hours long.
CREATE OR REPLACE FUNCTION public.agenda_inicio_fim(p_e public.agenda_eventos, p_data date, OUT inicio timestamptz, OUT fim timestamptz)
LANGUAGE plpgsql STABLE SET search_path = public AS $$
BEGIN
  IF p_e.dia_inteiro THEN
    inicio := (p_data::timestamp) AT TIME ZONE p_e.tz;
    fim := ((p_data + p_e.duracao_dias)::timestamp) AT TIME ZONE p_e.tz;
  ELSE
    inicio := (p_data + p_e.dtstart::time) AT TIME ZONE p_e.tz;
    fim := inicio + make_interval(mins => p_e.duracao_min);
  END IF;
END $$;

-- Internal: materialize a series up to least(p_ate, today + 24 months).
-- Starts after the last materialized date (horizonte_ate + 1), so a date that
-- was removed on purpose is never resurrected; ON CONFLICT makes concurrent
-- runs harmless. The event row is locked so the cron and an RPC never race on
-- horizonte_ate. horizonte_ate never moves backwards. A one-off event dated
-- after the horizon gets no row yet and stays incomplete, so the generator
-- materializes it once "today" catches up (never complete with 0 rows).
CREATE OR REPLACE FUNCTION public.agenda_materializar(p_evento_id bigint, p_ate date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  e public.agenda_eventos;
  v_ate date;
  v_h date;
BEGIN
  SELECT * INTO e FROM public.agenda_eventos WHERE id = p_evento_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  v_ate := least(p_ate, (public.agenda_hoje(e.tz) + interval '24 months')::date);
  v_h := greatest(coalesce(e.horizonte_ate, v_ate), v_ate);

  INSERT INTO public.agenda_ocorrencias (conta_id, evento_id, data_original, inicio, fim)
  SELECT e.conta_id, e.id, d.d, f.inicio, f.fim
    FROM public.agenda_datas_regra(e, coalesce(e.horizonte_ate + 1, e.dtstart::date), v_ate) AS d(d)
    CROSS JOIN LATERAL public.agenda_inicio_fim(e, d.d) f
  ON CONFLICT (evento_id, data_original) DO NOTHING;

  UPDATE public.agenda_eventos ev
     SET horizonte_ate = v_h,
         materializacao_completa = (
           (e.freq IS NULL AND e.dtstart::date <= v_h)
           OR (e.ate IS NOT NULL AND e.ate <= v_h)
           OR (e.contagem IS NOT NULL
               AND (SELECT count(*) FROM public.agenda_datas_regra(e, e.dtstart::date, v_h)) >= e.contagem))
   WHERE ev.id = e.id;
END $$;

-- Internal: re-apply the (changed) rule, dtstart, duration or dia_inteiro of a
-- whole series (scope "todas", and the new series of a split). Occurrences
-- whose date left the rule are deleted with their exceptions and per-occurrence
-- RSVPs; surviving ones are recalculated unless horario_alterado (all of them,
-- flag cleared, when p_reset_horario: a timed exception makes no sense in an
-- all-day series and vice versa); tombstones on surviving dates stay; new dates
-- are inserted.
CREATE OR REPLACE FUNCTION public.agenda_regenerar(p_evento_id bigint, p_reset_horario boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  e public.agenda_eventos;
  v_h date;
  v_datas date[];
BEGIN
  SELECT * INTO e FROM public.agenda_eventos WHERE id = p_evento_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  v_h := (public.agenda_hoje(e.tz) + interval '24 months')::date;
  v_h := greatest(coalesce(e.horizonte_ate, v_h), v_h);
  v_datas := coalesce(ARRAY(SELECT d FROM public.agenda_datas_regra(e, e.dtstart::date, v_h) d), '{}');

  DELETE FROM public.agenda_ocorrencias o
   WHERE o.evento_id = e.id AND NOT (o.data_original = ANY (v_datas));

  UPDATE public.agenda_ocorrencias o
     SET inicio = f.inicio,
         fim = f.fim,
         horario_alterado = CASE WHEN p_reset_horario THEN false ELSE o.horario_alterado END
    FROM public.agenda_ocorrencias o2
    CROSS JOIN LATERAL public.agenda_inicio_fim(e, o2.data_original) f
   WHERE o.id = o2.id
     AND o.evento_id = e.id
     AND (p_reset_horario OR NOT o.horario_alterado)
     AND (o.inicio IS DISTINCT FROM f.inicio OR o.fim IS DISTINCT FROM f.fim OR (p_reset_horario AND o.horario_alterado));

  INSERT INTO public.agenda_ocorrencias (conta_id, evento_id, data_original, inicio, fim)
  SELECT e.conta_id, e.id, d.d, f.inicio, f.fim
    FROM unnest(v_datas) AS d(d)
    CROSS JOIN LATERAL public.agenda_inicio_fim(e, d.d) f
  ON CONFLICT (evento_id, data_original) DO NOTHING;

  UPDATE public.agenda_eventos ev
     SET horizonte_ate = v_h,
         materializacao_completa = (
           (e.freq IS NULL AND e.dtstart::date <= v_h)
           OR (e.ate IS NOT NULL AND e.ate <= v_h)
           OR (e.contagem IS NOT NULL AND cardinality(v_datas) >= e.contagem))
   WHERE ev.id = e.id;
END $$;

CREATE INDEX agenda_eventos_horizonte_idx ON public.agenda_eventos (horizonte_ate) WHERE NOT materializacao_completa;

-- Internal, run by pg_cron (SQL-only, like generate_recurring_tarefas): extend
-- every open series whose horizon is behind today + 24 months. SKIP LOCKED so a
-- series being edited is simply picked up on the next run; one failing series
-- is logged and skipped, never aborting the run. Returns the number of series
-- extended. (Migration B adds the 30-day ledger cleanup here.)

CREATE OR REPLACE FUNCTION public.agenda_gerar_horizonte()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  s record;
  v_n int := 0;
BEGIN
  FOR s IN
    SELECT ev.id, ev.tz FROM public.agenda_eventos ev
     WHERE NOT ev.materializacao_completa
       AND (ev.horizonte_ate IS NULL
            OR ev.horizonte_ate < (public.agenda_hoje(ev.tz) + interval '24 months')::date)
     ORDER BY ev.id
     FOR UPDATE SKIP LOCKED
  LOOP
    BEGIN
      PERFORM public.agenda_materializar(s.id, (public.agenda_hoje(s.tz) + interval '24 months')::date);
      v_n := v_n + 1;
    EXCEPTION WHEN others THEN
      RAISE WARNING 'agenda_gerar_horizonte: evento % falhou: %', s.id, SQLERRM;
    END;
  END LOOP;
  RETURN v_n;
END $$;

REVOKE ALL ON FUNCTION public.agenda_materializar(bigint, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_materializar(bigint, date) TO service_role;
REVOKE ALL ON FUNCTION public.agenda_regenerar(bigint, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_regenerar(bigint, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.agenda_gerar_horizonte() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_gerar_horizonte() TO service_role;

-- Daily at 04:23 UTC (01:23 in Sao Paulo), a free minute in the table of
-- 20260925110001_stagger_cron_schedules.sql. Daily is enough: the horizon is
-- 24 months ahead, so a missed run costs nothing visible.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'agenda-horizonte') THEN PERFORM cron.unschedule('agenda-horizonte'); END IF;
END $$;
SELECT cron.schedule('agenda-horizonte', '23 4 * * *', $$SELECT public.agenda_gerar_horizonte()$$);

-- ============ (3) READ/CREATE RPCs + NOTIFICATION TYPES ============

-- ---- notification types ----
-- Lists copied from the most recent definitions (notifications_type_check:
-- 20260815000004_instagram_automation_rpcs.sql, 22 values;
-- notification_inapp_prefs / notification_email_prefs: 20260903000001), only
-- APPENDING the agenda types. This file is now the most recent definition:
-- the next migration copies FROM HERE.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (
  type IN (
    'post_approved', 'post_correction', 'post_message',
    'idea_submitted', 'briefing_answered',
    'step_activated', 'step_completed', 'post_assigned',
    'workflow_completed', 'deadline_approaching',
    'invite_accepted', 'member_role_changed', 'member_removed',
    'post_edit_suggestion', 'task_assigned', 'client_message',
    'mention', 'post_status_automation',
    'instagram_connected_by_client',
    'post_publish_failed', 'storage_autoclean_report',
    'instagram_automation_failed',
    'event_invited', 'event_updated', 'event_cancelled', 'event_rsvp', 'event_reminder'
  )
);

ALTER TABLE public.notification_inapp_prefs DROP CONSTRAINT notification_inapp_prefs_type_check;
ALTER TABLE public.notification_inapp_prefs ADD CONSTRAINT notification_inapp_prefs_type_check CHECK (type IN (
  'post_approved','post_correction','post_message','post_edit_suggestion',
  'idea_submitted','briefing_answered','step_activated','step_completed',
  'post_assigned','task_assigned','workflow_completed','deadline_approaching',
  'invite_accepted','member_role_changed','member_removed','client_message',
  'mention','post_status_automation','instagram_connected_by_client',
  'post_publish_failed','storage_autoclean_report','instagram_automation_failed',
  'event_invited','event_updated','event_cancelled','event_rsvp','event_reminder',
  '__all__'
));

-- event_rsvp has no e-mail; event_reminder has its own e-mail path (migration B)
-- but is a user-facing e-mail preference, so it is accepted here.
ALTER TABLE public.notification_email_prefs DROP CONSTRAINT notification_email_prefs_type_check;
ALTER TABLE public.notification_email_prefs ADD CONSTRAINT notification_email_prefs_type_check CHECK (type IN (
  'post_approved','post_publish_failed','post_correction','post_message',
  'client_message','deadline_approaching','task_assigned','post_assigned',
  'mention',
  'event_invited','event_updated','event_cancelled','event_reminder',
  '__all__'
));

-- Recreated with the three digest agenda types (only change vs 20260903000001).
-- event_reminder is NOT here: reminder rows are written with emailed_at set and
-- mailed by their own path; event_rsvp has no e-mail.
create or replace function claim_notification_emails(
  p_settle_before timestamptz,
  p_after         timestamptz,
  p_limit         int
)
returns table (id uuid, user_id uuid, type text, metadata jsonb, link text, created_at timestamptz)
language sql
security definer
set search_path = public
as $$
  update notifications n
     set emailed_at = now()
   where n.id in (
     select n2.id from notifications n2
     where n2.type = any (array[
       'post_approved','post_publish_failed','post_correction','post_message',
       'client_message','deadline_approaching','task_assigned','post_assigned',
       'mention',
       'event_invited','event_updated','event_cancelled'
     ])
       and n2.read_at is null and n2.dismissed_at is null and n2.emailed_at is null
       and n2.created_at <= p_settle_before and n2.created_at >= p_after
       and exists (
         select 1 from workspace_members wm
         where wm.workspace_id = n2.workspace_id and wm.user_id = n2.user_id
       )
       and not exists (
         select 1 from notification_email_prefs p
         where p.user_id = n2.user_id and p.enabled = false
           and (p.type = n2.type or p.type = '__all__')
       )
     order by n2.created_at asc
     limit p_limit
     for update skip locked
   )
  returning n.id, n.user_id, n.type, n.metadata, n.link, n.created_at;
$$;

-- REVOKE FROM PUBLIC também derruba service_role nesta instância — re-grant.
revoke all on function claim_notification_emails(timestamptz, timestamptz, int)
  from public, anon, authenticated;
grant execute on function claim_notification_emails(timestamptz, timestamptz, int)
  to service_role;

-- ---- internal: notification fan-out ----
-- Filters the recipients to current members of p_conta BEFORE calling
-- insert_notification_batch (the helper does not filter), excluding the actor.
-- Metadata keys are a contract with the CRM display and the e-mail digest:
-- evento_id, ocorrencia_id, titulo (effective), inicio, fim, dia_inteiro,
-- data_local (yyyy-mm-dd in the series tz), recorrente, escopo, ator_nome,
-- merged with p_extra (motivo = 'removido', resposta, minutos come from there).
-- Link: /calendario?evento={ocorrencia_id}; cancelled, or no occurrence yet
-- (an event past the materialization horizon): /calendario?data={yyyy-mm-dd}.
CREATE OR REPLACE FUNCTION public.agenda_notificar(
  p_conta uuid, p_evento_id bigint, p_ocorrencia_id bigint, p_tipo text,
  p_destinatarios uuid[], p_ator uuid, p_extra jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  e public.agenda_eventos;
  o public.agenda_ocorrencias;
  v_filtrados uuid[];
  v_inicio timestamptz;
  v_fim timestamptz;
  v_titulo text;
  v_data_local date;
  v_link text;
  v_metadata jsonb;
BEGIN
  SELECT ARRAY(
    SELECT DISTINCT d.u FROM unnest(p_destinatarios) AS d(u)
      JOIN public.workspace_members wm ON wm.user_id = d.u AND wm.workspace_id = p_conta
     WHERE d.u IS NOT NULL AND d.u IS DISTINCT FROM p_ator)
    INTO v_filtrados;
  IF cardinality(v_filtrados) = 0 THEN RETURN; END IF;

  SELECT * INTO e FROM public.agenda_eventos ev WHERE ev.id = p_evento_id AND ev.conta_id = p_conta;
  IF NOT FOUND THEN RETURN; END IF;

  IF p_ocorrencia_id IS NOT NULL THEN
    SELECT * INTO o FROM public.agenda_ocorrencias oc
     WHERE oc.id = p_ocorrencia_id AND oc.evento_id = e.id AND oc.conta_id = p_conta;
  END IF;
  IF o.id IS NOT NULL THEN
    v_inicio := o.inicio;
    v_fim := o.fim;
    v_titulo := CASE WHEN 'titulo' = ANY (o.campos_sobrescritos) THEN o.titulo ELSE e.titulo END;
  ELSE
    SELECT f.inicio, f.fim INTO v_inicio, v_fim FROM public.agenda_inicio_fim(e, e.dtstart::date) f;
    v_titulo := e.titulo;
  END IF;
  v_data_local := (v_inicio AT TIME ZONE e.tz)::date;

  v_link := CASE WHEN p_tipo = 'event_cancelled' OR o.id IS NULL
                 THEN '/calendario?data=' || to_char(v_data_local, 'YYYY-MM-DD')
                 ELSE '/calendario?evento=' || o.id END;

  v_metadata := jsonb_build_object(
    'evento_id', e.id,
    'ocorrencia_id', o.id,
    'titulo', v_titulo,
    'inicio', v_inicio,
    'fim', v_fim,
    'dia_inteiro', e.dia_inteiro,
    'data_local', to_char(v_data_local, 'YYYY-MM-DD'),
    'recorrente', e.freq IS NOT NULL,
    'escopo', NULL,
    'ator_nome', (SELECT pr.nome FROM public.profiles pr WHERE pr.id = p_ator)
  ) || coalesce(p_extra, '{}'::jsonb);

  PERFORM public.insert_notification_batch(p_conta, v_filtrados, p_tipo, v_link, v_metadata, p_ator);
END $$;
REVOKE ALL ON FUNCTION public.agenda_notificar(uuid, bigint, bigint, text, uuid[], uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_notificar(uuid, bigint, bigint, text, uuid[], uuid, jsonb) TO service_role;

-- ---- internal: payload -> unsaved agenda_eventos row ----
-- Merge rule: a key absent from p_evento keeps p_base's value (with p_base NULL
-- a missing required key raises); a key present with JSON null sets NULL; tz is
-- read only on create (p_base NULL) and ignored on edit. inicio_local/fim_local
-- are local wall clocks in the series tz and must come together; they become
-- dtstart (the wall clock as sent: the edit RPC derives the series dtstart from
-- it) and duracao_min (elapsed minutes, as occurrences are generated) or
-- duracao_dias (exclusive end date - start date). The rule is always explicit:
-- keys that do not apply to its freq are cleared. Every raise is user-facing
-- pt-BR copy prefixed "agenda: ".
CREATE OR REPLACE FUNCTION public.agenda_validar_payload(p_conta uuid, p_evento jsonb, p_base public.agenda_eventos DEFAULT NULL)
RETURNS public.agenda_eventos LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v public.agenda_eventos;
  p jsonb := p_evento;
  r jsonb;
  v_ini timestamp;
  v_fim timestamp;
  v_txt text;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RAISE EXCEPTION 'agenda: dados do evento incompletos';
  END IF;

  IF p_base IS NULL THEN
    IF NOT (p ? 'titulo' AND p ? 'inicio_local' AND p ? 'fim_local') THEN
      RAISE EXCEPTION 'agenda: dados do evento incompletos';
    END IF;
    v.tipo := 'reuniao';
    v.privado := false;
    v.dia_inteiro := false;
    v.tz := 'America/Sao_Paulo';
    v.intervalo := 1;
    v.lembretes := '{}';
    v.materializacao_completa := false;
  ELSE
    v := p_base;
  END IF;
  v.conta_id := p_conta;

  -- ---- content ----
  IF p ? 'titulo' THEN
    IF jsonb_typeof(p->'titulo') NOT IN ('string', 'null') THEN RAISE EXCEPTION 'agenda: dados do evento inválidos'; END IF;
    v.titulo := btrim(p->>'titulo');
    IF v.titulo IS NULL OR v.titulo = '' THEN RAISE EXCEPTION 'agenda: informe um título'; END IF;
    IF char_length(v.titulo) > 200 THEN RAISE EXCEPTION 'agenda: o título pode ter no máximo 200 caracteres'; END IF;
  END IF;
  IF p ? 'descricao' THEN
    IF jsonb_typeof(p->'descricao') NOT IN ('string', 'null') THEN RAISE EXCEPTION 'agenda: dados do evento inválidos'; END IF;
    v.descricao := NULLIF(btrim(p->>'descricao'), '');
    IF char_length(v.descricao) > 5000 THEN RAISE EXCEPTION 'agenda: a descrição pode ter no máximo 5000 caracteres'; END IF;
  END IF;
  IF p ? 'local' THEN
    IF jsonb_typeof(p->'local') NOT IN ('string', 'null') THEN RAISE EXCEPTION 'agenda: dados do evento inválidos'; END IF;
    v.local := NULLIF(btrim(p->>'local'), '');
    IF char_length(v.local) > 300 THEN RAISE EXCEPTION 'agenda: o local pode ter no máximo 300 caracteres'; END IF;
  END IF;
  IF p ? 'link_reuniao' THEN
    IF jsonb_typeof(p->'link_reuniao') NOT IN ('string', 'null') THEN RAISE EXCEPTION 'agenda: link da reunião inválido'; END IF;
    v.link_reuniao := NULLIF(btrim(p->>'link_reuniao'), '');
    IF v.link_reuniao IS NOT NULL AND (v.link_reuniao !~* '^https?://' OR char_length(v.link_reuniao) > 500) THEN
      RAISE EXCEPTION 'agenda: link da reunião inválido';
    END IF;
  END IF;

  -- ---- classification ----
  IF p ? 'tipo' THEN
    v.tipo := p->>'tipo';
    IF jsonb_typeof(p->'tipo') <> 'string'
       OR v.tipo NOT IN ('reuniao','gravacao','captacao','apresentacao','interno','outro') THEN
      RAISE EXCEPTION 'agenda: dados do evento inválidos';
    END IF;
  END IF;
  IF p ? 'cor' THEN
    v.cor := p->>'cor';
    IF jsonb_typeof(p->'cor') NOT IN ('string', 'null')
       OR (v.cor IS NOT NULL AND v.cor NOT IN ('azul','rosa','laranja','roxo','verde','teal','cinza','amarelo')) THEN
      RAISE EXCEPTION 'agenda: dados do evento inválidos';
    END IF;
  END IF;
  IF p ? 'cliente_id' THEN
    IF jsonb_typeof(p->'cliente_id') = 'null' THEN
      v.cliente_id := NULL;
    ELSIF jsonb_typeof(p->'cliente_id') <> 'number' OR (p->>'cliente_id') !~ '^[0-9]{1,18}$' THEN
      RAISE EXCEPTION 'agenda: cliente não encontrado';
    ELSE
      v.cliente_id := (p->>'cliente_id')::bigint;
      IF NOT EXISTS (SELECT 1 FROM public.clientes c WHERE c.id = v.cliente_id AND c.conta_id = p_conta) THEN
        RAISE EXCEPTION 'agenda: cliente não encontrado';
      END IF;
    END IF;
  END IF;
  IF p ? 'privado' THEN
    IF jsonb_typeof(p->'privado') <> 'boolean' THEN RAISE EXCEPTION 'agenda: dados do evento inválidos'; END IF;
    v.privado := (p->>'privado')::boolean;
  END IF;
  IF p ? 'dia_inteiro' THEN
    IF jsonb_typeof(p->'dia_inteiro') <> 'boolean' THEN RAISE EXCEPTION 'agenda: dados do evento inválidos'; END IF;
    v.dia_inteiro := (p->>'dia_inteiro')::boolean;
  END IF;

  -- ---- tz (create only) ----
  IF p_base IS NULL AND p ? 'tz' THEN
    IF jsonb_typeof(p->'tz') <> 'string' THEN RAISE EXCEPTION 'agenda: fuso horário inválido'; END IF;
    v.tz := p->>'tz';
    BEGIN
      PERFORM '2000-01-01'::timestamp AT TIME ZONE v.tz;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'agenda: fuso horário inválido';
    END;
  END IF;

  -- ---- start / duration ----
  IF (p ? 'inicio_local') <> (p ? 'fim_local') THEN
    RAISE EXCEPTION 'agenda: dados do evento incompletos';
  END IF;
  IF p ? 'inicio_local' THEN
    IF jsonb_typeof(p->'inicio_local') <> 'string' OR jsonb_typeof(p->'fim_local') <> 'string' THEN
      RAISE EXCEPTION 'agenda: dados do evento inválidos';
    END IF;
    BEGIN
      v_ini := (p->>'inicio_local')::timestamp;
      v_fim := (p->>'fim_local')::timestamp;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'agenda: dados do evento inválidos';
    END;
    IF v_ini IS NULL OR v_fim IS NULL OR NOT isfinite(v_ini) OR NOT isfinite(v_fim) THEN
      RAISE EXCEPTION 'agenda: dados do evento inválidos';
    END IF;
    IF v.dia_inteiro THEN
      v.dtstart := v_ini::date::timestamp;
      v.duracao_min := NULL;
      v.duracao_dias := v_fim::date - v_ini::date;
      IF v.duracao_dias <= 0 THEN RAISE EXCEPTION 'agenda: o fim precisa ser depois do início'; END IF;
      IF v.duracao_dias > 31 THEN RAISE EXCEPTION 'agenda: o evento é longo demais'; END IF;
    ELSE
      v_ini := date_trunc('minute', v_ini);
      v_fim := date_trunc('minute', v_fim);
      IF v_fim <= v_ini THEN RAISE EXCEPTION 'agenda: o fim precisa ser depois do início'; END IF;
      v.dtstart := v_ini;
      v.duracao_dias := NULL;
      -- elapsed minutes between the two wall clocks in the series tz (a DST
      -- jump inside the event counts), never below one minute
      v.duracao_min := greatest(1, (extract(epoch FROM ((v_fim AT TIME ZONE v.tz) - (v_ini AT TIME ZONE v.tz))) / 60)::int);
      IF v.duracao_min > 20160 THEN RAISE EXCEPTION 'agenda: o evento é longo demais'; END IF;
    END IF;
  ELSIF p_base IS NOT NULL AND v.dia_inteiro IS DISTINCT FROM p_base.dia_inteiro THEN
    -- switching all-day on or off needs the new start and end
    RAISE EXCEPTION 'agenda: dados do evento incompletos';
  END IF;

  -- ---- reminders ----
  IF p ? 'lembretes' THEN
    IF jsonb_typeof(p->'lembretes') = 'null' THEN
      v.lembretes := '{}';
    ELSIF jsonb_typeof(p->'lembretes') <> 'array'
       OR jsonb_array_length(p->'lembretes') > 5
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(p->'lembretes') x(j)
                   WHERE jsonb_typeof(x.j) <> 'number' OR (x.j #>> '{}') !~ '^-?[0-9]{1,5}$'
                      OR (x.j #>> '{}')::int NOT BETWEEN -1440 AND 40320)
       OR (SELECT count(DISTINCT x.j) <> count(*) FROM jsonb_array_elements(p->'lembretes') x(j)) THEN
      RAISE EXCEPTION 'agenda: lembrete inválido';
    ELSE
      v.lembretes := ARRAY(SELECT (x.j #>> '{}')::int FROM jsonb_array_elements(p->'lembretes') WITH ORDINALITY x(j, n) ORDER BY x.n);
    END IF;
  END IF;

  -- ---- rule ----
  IF p ? 'regra' THEN
    r := p->'regra';
    IF jsonb_typeof(r) = 'null' THEN
      v.freq := NULL; v.intervalo := 1; v.dias_semana := NULL; v.mensal_modo := NULL;
      v.mensal_ordinal := NULL; v.ate := NULL; v.contagem := NULL;
    ELSIF jsonb_typeof(r) <> 'object' THEN
      RAISE EXCEPTION 'agenda: repetição inválida';
    ELSE
      v.freq := r->>'freq';
      IF jsonb_typeof(r->'freq') IS DISTINCT FROM 'string' OR v.freq NOT IN ('daily','weekly','monthly','yearly') THEN
        RAISE EXCEPTION 'agenda: repetição inválida';
      END IF;
      IF r ? 'intervalo' AND jsonb_typeof(r->'intervalo') <> 'null' THEN
        IF jsonb_typeof(r->'intervalo') <> 'number' OR (r->>'intervalo') !~ '^[0-9]{1,2}$' OR (r->>'intervalo')::int < 1 THEN
          RAISE EXCEPTION 'agenda: repetição inválida';
        END IF;
        v.intervalo := (r->>'intervalo')::int;
      ELSE
        v.intervalo := 1;
      END IF;

      v.dias_semana := NULL;
      IF v.freq = 'weekly' THEN
        IF jsonb_typeof(r->'dias_semana') IS DISTINCT FROM 'array'
           OR jsonb_array_length(r->'dias_semana') NOT BETWEEN 1 AND 7
           OR EXISTS (SELECT 1 FROM jsonb_array_elements(r->'dias_semana') x(j)
                       WHERE jsonb_typeof(x.j) <> 'number' OR (x.j #>> '{}') !~ '^[0-6]$')
           OR (SELECT count(DISTINCT x.j) <> count(*) FROM jsonb_array_elements(r->'dias_semana') x(j)) THEN
          RAISE EXCEPTION 'agenda: dias da semana inválidos';
        END IF;
        v.dias_semana := ARRAY(SELECT (x.j #>> '{}')::int FROM jsonb_array_elements(r->'dias_semana') x(j) ORDER BY 1);
      END IF;

      v.mensal_modo := NULL; v.mensal_ordinal := NULL;
      IF v.freq = 'monthly' THEN
        v.mensal_modo := r->>'mensal_modo';
        IF v.mensal_modo IS NULL OR v.mensal_modo NOT IN ('dia_mes','dia_semana') THEN
          RAISE EXCEPTION 'agenda: repetição inválida';
        END IF;
        IF v.mensal_modo = 'dia_semana' THEN
          IF jsonb_typeof(r->'mensal_ordinal') IS DISTINCT FROM 'number' OR (r->>'mensal_ordinal') NOT IN ('1','2','3','4','-1') THEN
            RAISE EXCEPTION 'agenda: repetição inválida';
          END IF;
          v.mensal_ordinal := (r->>'mensal_ordinal')::int;
        END IF;
      END IF;

      v.ate := NULL; v.contagem := NULL;
      IF jsonb_typeof(r->'ate') = 'string' THEN
        BEGIN
          v.ate := (r->>'ate')::date;
        EXCEPTION WHEN others THEN
          RAISE EXCEPTION 'agenda: repetição inválida';
        END;
      ELSIF r ? 'ate' AND jsonb_typeof(r->'ate') <> 'null' THEN
        RAISE EXCEPTION 'agenda: repetição inválida';
      END IF;
      IF jsonb_typeof(r->'contagem') = 'number' THEN
        IF (r->>'contagem') !~ '^[0-9]{1,3}$' OR (r->>'contagem')::int NOT BETWEEN 1 AND 730 THEN
          RAISE EXCEPTION 'agenda: repetição inválida';
        END IF;
        v.contagem := (r->>'contagem')::int;
      ELSIF r ? 'contagem' AND jsonb_typeof(r->'contagem') <> 'null' THEN
        RAISE EXCEPTION 'agenda: repetição inválida';
      END IF;
      IF v.ate IS NOT NULL AND v.contagem IS NOT NULL THEN
        RAISE EXCEPTION 'agenda: repetição inválida';
      END IF;
    END IF;
  END IF;

  IF v.titulo IS NULL OR v.dtstart IS NULL THEN
    RAISE EXCEPTION 'agenda: dados do evento incompletos';
  END IF;
  -- on edit (p_base not NULL) dtstart here is the edited occurrence's own start,
  -- which may sit past ate (an esta move of the last occurrence); the edit RPC
  -- checks the derived series dtstart (normalization raises when the rule
  -- generates nothing; the 5-year ceiling is re-checked there too)
  IF p_base IS NULL AND v.freq IS NOT NULL AND v.ate IS NOT NULL THEN
    IF v.ate < v.dtstart::date THEN
      RAISE EXCEPTION 'agenda: a repetição não gera nenhuma data';
    END IF;
    IF v.ate > (v.dtstart::date + interval '5 years')::date THEN
      RAISE EXCEPTION 'agenda: repetição inválida';
    END IF;
  END IF;

  IF v.dtstart::date < least(coalesce(p_base.dtstart::date, 'infinity'::date), public.agenda_hoje(v.tz) - 366) THEN
    RAISE EXCEPTION 'agenda: a data de início é antiga demais';
  END IF;

  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.agenda_validar_payload(uuid, jsonb, public.agenda_eventos) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_validar_payload(uuid, jsonb, public.agenda_eventos) TO service_role;

-- ---- client RPC: create ----
-- Returns the first occurrence and the normalized dtstart (the UI warns "A série
-- começa em {data}" when it differs from the chosen start). An event dated past
-- the 24-month materialization horizon has no occurrence yet: ocorrencia_id is
-- NULL and the generator materializes it when "today" catches up.
CREATE OR REPLACE FUNCTION public.agenda_evento_criar(p_evento jsonb, p_participantes uuid[])
RETURNS TABLE (evento_id bigint, ocorrencia_id bigint, dtstart timestamp)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  v_conta uuid;
  v_user uuid;
  v_e public.agenda_eventos;
  v_id bigint;
  v_oc bigint;
  v_parts uuid[];
BEGIN
  v_conta := get_my_conta_id(); v_user := auth.uid();
  IF v_conta IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'agenda: sessão sem workspace ativo'; END IF;
  IF NOT public.has_permission('calendario', 'editar') THEN
    RAISE EXCEPTION 'agenda: você não pode criar eventos';
  END IF;

  v_e := public.agenda_validar_payload(v_conta, p_evento, NULL);
  v_e.organizador_id := v_user;
  v_e.dtstart := public.agenda_normalizar_dtstart(v_e);

  v_parts := ARRAY(SELECT DISTINCT d.u FROM unnest(coalesce(p_participantes, '{}'::uuid[])) AS d(u)
                    WHERE d.u IS NOT NULL AND d.u <> v_user);
  IF cardinality(v_parts) > 50 THEN
    RAISE EXCEPTION 'agenda: no máximo 50 participantes';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_parts) AS d(u)
              WHERE NOT EXISTS (SELECT 1 FROM public.workspace_members wm
                                 WHERE wm.user_id = d.u AND wm.workspace_id = v_conta)) THEN
    RAISE EXCEPTION 'agenda: participante fora do workspace';
  END IF;

  INSERT INTO public.agenda_eventos (
    conta_id, organizador_id, titulo, descricao, local, link_reuniao, tipo, cor, cliente_id,
    privado, dia_inteiro, tz, dtstart, duracao_min, duracao_dias, freq, intervalo, dias_semana,
    mensal_modo, mensal_ordinal, ate, contagem, lembretes)
  VALUES (
    v_conta, v_user, v_e.titulo, v_e.descricao, v_e.local, v_e.link_reuniao, v_e.tipo, v_e.cor, v_e.cliente_id,
    v_e.privado, v_e.dia_inteiro, v_e.tz, v_e.dtstart, v_e.duracao_min, v_e.duracao_dias, v_e.freq, v_e.intervalo,
    v_e.dias_semana, v_e.mensal_modo, v_e.mensal_ordinal, v_e.ate, v_e.contagem, v_e.lembretes)
  RETURNING agenda_eventos.id INTO v_id;

  INSERT INTO public.agenda_participantes (evento_id, conta_id, user_id, resposta, respondido_em)
  VALUES (v_id, v_conta, v_user, 'sim', now());
  INSERT INTO public.agenda_participantes (evento_id, conta_id, user_id, resposta)
  SELECT v_id, v_conta, d.u, 'pendente' FROM unnest(v_parts) AS d(u);

  PERFORM public.agenda_materializar(v_id, (public.agenda_hoje(v_e.tz) + interval '24 months')::date);

  SELECT o.id INTO v_oc FROM public.agenda_ocorrencias o
   WHERE o.evento_id = v_id ORDER BY o.data_original LIMIT 1;

  PERFORM public.agenda_notificar(v_conta, v_id, v_oc, 'event_invited', v_parts, v_user, '{}'::jsonb);

  RETURN QUERY SELECT v_id, v_oc, v_e.dtstart;
END $$;
REVOKE ALL ON FUNCTION public.agenda_evento_criar(jsonb, uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agenda_evento_criar(jsonb, uuid[]) TO authenticated, service_role;

-- ---- client RPC: read ----
-- One row per visible, non-cancelled occurrence. With p_ocorrencia_id (deep
-- link) the range is ignored and only that occurrence comes back; otherwise both
-- bounds are required and span at most 100 days. inicio >= p_de - 31 days (the
-- longest event) lets the (conta_id, inicio, fim) index bound the scan on both
-- sides; the deep link reuses the same query with the occurrence's own bounds.
-- Masking ("ocupado"): a private event the viewer neither organizes nor
-- attends shows titulo 'Ocupado' and NULL content, rule and reminders, and its
-- participants without answers. pode_editar is the rule of agenda_pode_editar
-- (section 4, used by the edit/delete RPCs), inlined here. regra is jsonb_build_object over all seven keys
-- (explicit nulls, never stripped: the CRM compares them).
CREATE OR REPLACE FUNCTION public.agenda_listar(p_de timestamptz DEFAULT NULL, p_ate timestamptz DEFAULT NULL, p_ocorrencia_id bigint DEFAULT NULL)
RETURNS TABLE (
  ocorrencia_id bigint, evento_id bigint, data_original date,
  inicio timestamptz, fim timestamptz, dia_inteiro boolean,
  data_inicio_local date, data_fim_local date,
  titulo text, descricao text, local text, link_reuniao text,
  tipo text, cor text, cliente_id bigint, cliente_nome text,
  privado boolean, mascarado boolean, recorrente boolean,
  regra jsonb, lembretes int[], organizador_id uuid,
  participantes jsonb,
  minha_resposta text, pode_editar boolean, pode_responder boolean, tz text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE
  v_conta uuid;
  v_user uuid;
  v_editar boolean;
  v_role text;
  v_de timestamptz := p_de;
  v_ate timestamptz := p_ate;
BEGIN
  v_conta := get_my_conta_id(); v_user := auth.uid();
  IF v_conta IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'agenda: sessão sem workspace ativo'; END IF;
  IF NOT public.has_permission('calendario', 'ver') THEN
    RAISE EXCEPTION 'agenda: você não pode ver a agenda';
  END IF;

  IF p_ocorrencia_id IS NOT NULL THEN
    SELECT o.inicio, o.fim INTO v_de, v_ate FROM public.agenda_ocorrencias o
     WHERE o.id = p_ocorrencia_id AND o.conta_id = v_conta AND NOT o.cancelada;
    IF NOT FOUND THEN RETURN; END IF;
  ELSIF v_de IS NULL OR v_ate IS NULL OR v_ate <= v_de OR v_ate - v_de > interval '100 days' THEN
    RAISE EXCEPTION 'agenda: período inválido';
  END IF;

  -- pode_editar: the rule of agenda_pode_editar (section 4), evaluated inline
  -- from the caller's permission and role computed once, instead of a
  -- non-inlinable DEFINER call per row. Keep both in sync.
  v_editar := public.has_permission('calendario', 'editar');
  SELECT wm.role::text INTO v_role FROM public.workspace_members wm
   WHERE wm.workspace_id = v_conta AND wm.user_id = v_user;

  RETURN QUERY
  SELECT
    o.id, e.id, o.data_original,
    o.inicio, o.fim, e.dia_inteiro,
    (o.inicio AT TIME ZONE e.tz)::date,
    CASE WHEN e.dia_inteiro THEN (o.fim AT TIME ZONE e.tz)::date
         ELSE ((o.fim AT TIME ZONE e.tz) - interval '1 microsecond')::date + 1 END,
    CASE WHEN m.mascarado THEN 'Ocupado'
         WHEN 'titulo' = ANY (o.campos_sobrescritos) THEN o.titulo ELSE e.titulo END,
    CASE WHEN m.mascarado THEN NULL
         WHEN 'descricao' = ANY (o.campos_sobrescritos) THEN o.descricao ELSE e.descricao END,
    CASE WHEN m.mascarado THEN NULL
         WHEN 'local' = ANY (o.campos_sobrescritos) THEN o.local ELSE e.local END,
    CASE WHEN m.mascarado THEN NULL
         WHEN 'link_reuniao' = ANY (o.campos_sobrescritos) THEN o.link_reuniao ELSE e.link_reuniao END,
    CASE WHEN m.mascarado THEN NULL ELSE e.tipo END,
    CASE WHEN m.mascarado THEN NULL ELSE e.cor END,
    CASE WHEN m.mascarado THEN NULL ELSE e.cliente_id END,
    CASE WHEN m.mascarado THEN NULL ELSE c.nome END,
    e.privado, m.mascarado, e.freq IS NOT NULL,
    CASE WHEN m.mascarado OR e.freq IS NULL THEN NULL
         ELSE jsonb_build_object('freq', e.freq, 'intervalo', e.intervalo, 'dias_semana', e.dias_semana,
                                 'mensal_modo', e.mensal_modo, 'mensal_ordinal', e.mensal_ordinal,
                                 'ate', e.ate, 'contagem', e.contagem) END,
    CASE WHEN m.mascarado THEN NULL ELSE e.lembretes END,
    e.organizador_id,
    coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'user_id', ap.user_id,
               'resposta', CASE WHEN m.mascarado THEN NULL ELSE coalesce(ar.resposta, ap.resposta) END)
             ORDER BY ap.user_id)
        FROM public.agenda_participantes ap
        JOIN public.workspace_members wm ON wm.user_id = ap.user_id AND wm.workspace_id = v_conta
        LEFT JOIN public.agenda_respostas ar ON ar.ocorrencia_id = o.id AND ar.user_id = ap.user_id
       WHERE ap.evento_id = e.id), '[]'::jsonb),
    CASE WHEN eu.user_id IS NULL THEN NULL ELSE coalesce(mr.resposta, eu.resposta) END,
    coalesce(v_editar AND (e.organizador_id = v_user OR (v_role IN ('owner', 'admin') AND NOT e.privado)), false),
    eu.user_id IS NOT NULL AND e.organizador_id IS DISTINCT FROM v_user,
    e.tz
  FROM public.agenda_ocorrencias o
  JOIN public.agenda_eventos e ON e.id = o.evento_id AND e.conta_id = v_conta
  LEFT JOIN public.agenda_participantes eu ON eu.evento_id = e.id AND eu.user_id = v_user
  LEFT JOIN public.agenda_respostas mr ON mr.ocorrencia_id = o.id AND mr.user_id = v_user
  LEFT JOIN public.clientes c ON c.id = e.cliente_id AND c.conta_id = v_conta
  CROSS JOIN LATERAL (
    SELECT (e.privado AND e.organizador_id IS DISTINCT FROM v_user AND eu.user_id IS NULL) AS mascarado
  ) m
  WHERE o.conta_id = v_conta
    AND NOT o.cancelada
    AND o.inicio < v_ate AND o.fim > v_de AND o.inicio >= v_de - interval '31 days'
    AND (p_ocorrencia_id IS NULL OR o.id = p_ocorrencia_id)
  ORDER BY o.inicio, o.id;
END $$;
REVOKE ALL ON FUNCTION public.agenda_listar(timestamptz, timestamptz, bigint) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agenda_listar(timestamptz, timestamptz, bigint) TO authenticated, service_role;

-- ============ (4) EDIT / DELETE / RSVP RPCs ============
-- Lock order (spec "Ordem de travas"): the series row first (FOR UPDATE for
-- edits and deletes, FOR SHARE for RSVPs), only then occurrences by id. No
-- table trigger locks in the opposite order.

-- Internal: who may edit or delete a series. Calendar editar permission and
-- either the organizer, or an owner/admin when the event is not private. The
-- single definition for the edit/delete RPCs; agenda_listar evaluates the same
-- rule inline for pode_editar (section 3). Keep both in sync.
CREATE OR REPLACE FUNCTION public.agenda_pode_editar(p_e public.agenda_eventos, p_user uuid, p_conta uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(
    p_e.conta_id = p_conta
    AND public.has_permission_for(p_user, p_conta, 'calendario', 'editar')
    AND (p_e.organizador_id = p_user
         OR (NOT p_e.privado AND EXISTS (
               SELECT 1 FROM public.workspace_members wm
                WHERE wm.workspace_id = p_conta AND wm.user_id = p_user
                  AND wm.role::text IN ('owner', 'admin')))),
    false);
$$;
REVOKE ALL ON FUNCTION public.agenda_pode_editar(public.agenda_eventos, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_pode_editar(public.agenda_eventos, uuid, uuid) TO service_role;

-- Internal: replace the participant set of a series (the organizer is never
-- removed; a missing one is restored). Deduplicates, caps at 50 others,
-- requires workspace membership.
-- Removed participants lose their per-occurrence RSVPs on this series' rows;
-- added ones start pendente. Returns who was added and who was removed.
CREATE OR REPLACE FUNCTION public.agenda_definir_participantes(
  p_evento_id bigint, p_conta uuid, p_organizador uuid, p_novos uuid[],
  OUT adicionados uuid[], OUT removidos uuid[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_novos uuid[];
BEGIN
  v_novos := ARRAY(SELECT DISTINCT d.u FROM unnest(coalesce(p_novos, '{}'::uuid[])) AS d(u)
                    WHERE d.u IS NOT NULL AND d.u IS DISTINCT FROM p_organizador);
  IF cardinality(v_novos) > 50 THEN
    RAISE EXCEPTION 'agenda: no máximo 50 participantes';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_novos) AS d(u)
              WHERE NOT EXISTS (SELECT 1 FROM public.workspace_members wm
                                 WHERE wm.user_id = d.u AND wm.workspace_id = p_conta)) THEN
    RAISE EXCEPTION 'agenda: participante fora do workspace';
  END IF;

  removidos := ARRAY(SELECT ap.user_id FROM public.agenda_participantes ap
                      WHERE ap.evento_id = p_evento_id
                        AND ap.user_id IS DISTINCT FROM p_organizador
                        AND NOT (ap.user_id = ANY (v_novos)));
  adicionados := ARRAY(SELECT d.u FROM unnest(v_novos) AS d(u)
                        WHERE NOT EXISTS (SELECT 1 FROM public.agenda_participantes ap
                                           WHERE ap.evento_id = p_evento_id AND ap.user_id = d.u));

  DELETE FROM public.agenda_respostas ar
   USING public.agenda_ocorrencias o
   WHERE ar.ocorrencia_id = o.id AND o.evento_id = p_evento_id AND ar.user_id = ANY (removidos);
  DELETE FROM public.agenda_participantes ap
   WHERE ap.evento_id = p_evento_id AND ap.user_id = ANY (removidos);
  INSERT INTO public.agenda_participantes (evento_id, conta_id, user_id, resposta)
  SELECT p_evento_id, p_conta, d.u, 'pendente' FROM unnest(adicionados) AS d(u);
  -- the form sends the set without the organizer (as on create): the organizer
  -- always stays, answering sim
  IF p_organizador IS NOT NULL THEN
    INSERT INTO public.agenda_participantes (evento_id, conta_id, user_id, resposta, respondido_em)
    VALUES (p_evento_id, p_conta, p_organizador, 'sim', now())
    ON CONFLICT (evento_id, user_id) DO NOTHING;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.agenda_definir_participantes(bigint, uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_definir_participantes(bigint, uuid, uuid, uuid[]) TO service_role;

-- ---- client RPC: edit ----
-- p_escopo: 'esta' (exceptions on this occurrence), 'seguintes' (split the
-- series at this occurrence's data_original), 'todas' (the whole series). A
-- series without a rule ignores the scope (todas); 'seguintes' at the first live
-- occurrence is 'todas'. p_evento follows the merge rule of
-- agenda_validar_payload (an absent key keeps the stored value, so a drag sends
-- only inicio_local/fim_local). The form and the drag carry the start of THIS
-- occurrence; the series dtstart is derived with the date delta of this edit
-- (spec "Como o payload vira dtstart") and then normalized. Returns the
-- occurrence that represents the edited one: the same id, or (when its date
-- left the rule) the first live occurrence from that date on, else the series'
-- first, else NULL (a one-off moved past the materialization horizon has no
-- occurrence until the generator reaches it).
CREATE OR REPLACE FUNCTION public.agenda_evento_editar(p_ocorrencia_id bigint, p_escopo text, p_evento jsonb, p_participantes uuid[] DEFAULT NULL)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_conta uuid;
  v_user uuid;
  v_o public.agenda_ocorrencias;
  v_e public.agenda_eventos;
  v_base public.agenda_eventos;
  v_novo public.agenda_eventos;
  v_escopo text;
  v_primeira boolean;
  v_tem_horario boolean;
  v_delta int;
  v_hoje date;
  v_h date;
  v_c date;
  v_datas date[];
  v_alvo bigint;          -- series that ends up holding the edited occurrence
  v_ret bigint;
  v_regen boolean := false;
  v_reset boolean := false;
  v_notifica boolean := false;
  v_regra_igual boolean;
  v_contagem int;
  v_add uuid[] := '{}';
  v_rem uuid[] := '{}';
  v_atuais uuid[];
  v_pedidos uuid[];
  v_campos text[];
  v_ini timestamptz; v_fim timestamptz;
  v_gen_ini timestamptz; v_gen_fim timestamptz;
  v_old_titulo text; v_old_local text; v_old_link text;
  v_destinatarios uuid[];
BEGIN
  v_conta := get_my_conta_id(); v_user := auth.uid();
  IF v_conta IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'agenda: sessão sem workspace ativo'; END IF;
  IF p_escopo IS NULL OR p_escopo NOT IN ('esta', 'seguintes', 'todas') THEN
    RAISE EXCEPTION 'agenda: escopo inválido';
  END IF;
  IF p_evento IS NULL OR jsonb_typeof(p_evento) <> 'object' THEN
    RAISE EXCEPTION 'agenda: dados do evento incompletos';
  END IF;

  SELECT o.* INTO v_o FROM public.agenda_ocorrencias o
   WHERE o.id = p_ocorrencia_id AND o.conta_id = v_conta AND NOT o.cancelada;
  IF NOT FOUND THEN RAISE EXCEPTION 'agenda: este evento não existe mais'; END IF;
  SELECT e.* INTO v_e FROM public.agenda_eventos e
   WHERE e.id = v_o.evento_id AND e.conta_id = v_conta FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'agenda: este evento não existe mais'; END IF;
  IF NOT public.agenda_pode_editar(v_e, v_user, v_conta) THEN
    RAISE EXCEPTION 'agenda: você não pode editar este evento';
  END IF;
  -- re-read the occurrence after the series lock (it may have changed meanwhile)
  SELECT o.* INTO v_o FROM public.agenda_ocorrencias o
   WHERE o.id = p_ocorrencia_id AND o.evento_id = v_e.id AND NOT o.cancelada;
  IF NOT FOUND THEN RAISE EXCEPTION 'agenda: este evento não existe mais'; END IF;

  v_primeira := NOT EXISTS (SELECT 1 FROM public.agenda_ocorrencias o
                             WHERE o.evento_id = v_e.id AND NOT o.cancelada AND o.data_original < v_o.data_original);
  IF v_e.freq IS NULL OR (p_escopo = 'seguintes' AND v_primeira) THEN
    v_escopo := 'todas';
  ELSE
    v_escopo := p_escopo;
  END IF;

  v_tem_horario := p_evento ? 'inicio_local' OR p_evento ? 'fim_local';
  v_hoje := public.agenda_hoje(v_e.tz);
  v_c := v_o.data_original;
  v_old_titulo := CASE WHEN 'titulo' = ANY (v_o.campos_sobrescritos) THEN v_o.titulo ELSE v_e.titulo END;
  v_old_local := CASE WHEN 'local' = ANY (v_o.campos_sobrescritos) THEN v_o.local ELSE v_e.local END;
  v_old_link := CASE WHEN 'link_reuniao' = ANY (v_o.campos_sobrescritos) THEN v_o.link_reuniao ELSE v_e.link_reuniao END;
  -- current participants other than the organizer, still members (what the form shows)
  v_atuais := ARRAY(SELECT ap.user_id FROM public.agenda_participantes ap
                      JOIN public.workspace_members wm ON wm.user_id = ap.user_id AND wm.workspace_id = v_conta
                     WHERE ap.evento_id = v_e.id AND ap.user_id IS DISTINCT FROM v_e.organizador_id
                     ORDER BY ap.user_id);

  -- ======== esta ========
  IF v_escopo = 'esta' THEN
    -- base: the series with this occurrence's effective content, so a drag that
    -- sends only times keeps an existing content override
    v_base := v_e;
    v_base.titulo := v_old_titulo;
    v_base.descricao := CASE WHEN 'descricao' = ANY (v_o.campos_sobrescritos) THEN v_o.descricao ELSE v_e.descricao END;
    v_base.local := v_old_local;
    v_base.link_reuniao := v_old_link;
    v_novo := public.agenda_validar_payload(v_conta, p_evento, v_base);

    IF v_novo.tipo IS DISTINCT FROM v_e.tipo
       OR v_novo.cor IS DISTINCT FROM v_e.cor
       OR v_novo.cliente_id IS DISTINCT FROM v_e.cliente_id
       OR v_novo.privado IS DISTINCT FROM v_e.privado
       OR v_novo.dia_inteiro IS DISTINCT FROM v_e.dia_inteiro
       OR ARRAY(SELECT x FROM unnest(v_novo.lembretes) x ORDER BY x) IS DISTINCT FROM ARRAY(SELECT x FROM unnest(v_e.lembretes) x ORDER BY x)
       OR (v_novo.freq, v_novo.intervalo, v_novo.dias_semana, v_novo.mensal_modo, v_novo.mensal_ordinal, v_novo.ate, v_novo.contagem)
          IS DISTINCT FROM (v_e.freq, v_e.intervalo, v_e.dias_semana, v_e.mensal_modo, v_e.mensal_ordinal, v_e.ate, v_e.contagem) THEN
      RAISE EXCEPTION 'agenda: este campo vale para toda a série';
    END IF;
    IF p_participantes IS NOT NULL THEN
      v_pedidos := ARRAY(SELECT DISTINCT d.u FROM unnest(p_participantes) AS d(u)
                          WHERE d.u IS NOT NULL AND d.u IS DISTINCT FROM v_e.organizador_id ORDER BY d.u);
      IF v_pedidos IS DISTINCT FROM v_atuais THEN
        RAISE EXCEPTION 'agenda: este campo vale para toda a série';
      END IF;
    END IF;

    IF v_tem_horario THEN
      SELECT f.inicio, f.fim INTO v_ini, v_fim FROM public.agenda_inicio_fim(v_novo, v_novo.dtstart::date) f;
    ELSE
      v_ini := v_o.inicio; v_fim := v_o.fim;
    END IF;
    SELECT g.inicio, g.fim INTO v_gen_ini, v_gen_fim FROM public.agenda_inicio_fim(v_e, v_o.data_original) g;

    -- a field differing from the series is an override (even NULL); equal to
    -- the series value it is dropped from the list
    v_campos := ARRAY(SELECT c.campo FROM unnest(ARRAY['titulo', 'descricao', 'local', 'link_reuniao']) WITH ORDINALITY AS c(campo, n)
                       WHERE CASE c.campo
                               WHEN 'titulo' THEN v_novo.titulo IS DISTINCT FROM v_e.titulo
                               WHEN 'descricao' THEN v_novo.descricao IS DISTINCT FROM v_e.descricao
                               WHEN 'local' THEN v_novo.local IS DISTINCT FROM v_e.local
                               ELSE v_novo.link_reuniao IS DISTINCT FROM v_e.link_reuniao
                             END
                       ORDER BY c.n);

    UPDATE public.agenda_ocorrencias o
       SET titulo = CASE WHEN 'titulo' = ANY (v_campos) THEN v_novo.titulo END,
           descricao = CASE WHEN 'descricao' = ANY (v_campos) THEN v_novo.descricao END,
           local = CASE WHEN 'local' = ANY (v_campos) THEN v_novo.local END,
           link_reuniao = CASE WHEN 'link_reuniao' = ANY (v_campos) THEN v_novo.link_reuniao END,
           campos_sobrescritos = v_campos,
           inicio = v_ini,
           fim = v_fim,
           horario_alterado = (v_ini, v_fim) IS DISTINCT FROM (v_gen_ini, v_gen_fim)
     WHERE o.id = v_o.id;

    v_notifica := v_novo.titulo IS DISTINCT FROM v_old_titulo
               OR v_novo.local IS DISTINCT FROM v_old_local
               OR v_novo.link_reuniao IS DISTINCT FROM v_old_link
               OR (v_ini, v_fim) IS DISTINCT FROM (v_o.inicio, v_o.fim);
    v_alvo := v_e.id;
    v_ret := v_o.id;

  ELSE
    -- ======== todas / seguintes: derive the series dtstart ========
    v_novo := public.agenda_validar_payload(v_conta, p_evento, v_e);
    IF v_tem_horario THEN
      v_delta := v_novo.dtstart::date - (v_o.inicio AT TIME ZONE v_e.tz)::date;
      IF v_escopo = 'todas' THEN
        v_novo.dtstart := (v_e.dtstart::date + v_delta) + v_novo.dtstart::time;
      ELSE
        v_novo.dtstart := (v_c + v_delta) + v_novo.dtstart::time;
      END IF;
      -- a drag (no regra in the payload) of a weekly series moves its weekdays
      -- with it, like Google: Mon+Wed dragged one day later becomes Tue+Thu.
      -- Monthly and yearly rules already follow dtstart. An explicit regra (the
      -- form always sends one) is used as is.
      IF NOT (p_evento ? 'regra') AND v_e.freq = 'weekly' AND v_delta <> 0 THEN
        v_novo.dias_semana := ARRAY(SELECT DISTINCT (((d.d + v_delta) % 7) + 7) % 7
                                      FROM unnest(v_e.dias_semana) AS d(d) ORDER BY 1);
      END IF;
    ELSIF v_escopo = 'seguintes' THEN
      v_novo.dtstart := v_c + v_e.dtstart::time;
    END IF;

    IF v_escopo = 'seguintes' THEN
      -- contagem of the new series: a payload contagem equal to the stored one
      -- (or no regra at all, a drag) means "the end was not touched", whatever
      -- else the rule changed (the form re-derives dias_semana from a moved
      -- date), so the remaining count carries over (tombstones count). A
      -- different contagem is the user's new end and is taken as sent.
      v_regra_igual := NOT (p_evento ? 'regra')
        OR (v_novo.freq, v_novo.intervalo, v_novo.dias_semana, v_novo.mensal_modo, v_novo.mensal_ordinal, v_novo.ate, v_novo.contagem)
           IS NOT DISTINCT FROM (v_e.freq, v_e.intervalo, v_e.dias_semana, v_e.mensal_modo, v_e.mensal_ordinal, v_e.ate, v_e.contagem);
      IF v_e.contagem IS NOT NULL AND v_novo.contagem IS NOT DISTINCT FROM v_e.contagem THEN
        v_contagem := v_e.contagem - (SELECT count(*) FROM public.agenda_datas_regra(v_e, v_e.dtstart::date, v_c - 1));
        IF v_contagem <= 0 THEN RAISE EXCEPTION 'agenda: a repetição não gera nenhuma data'; END IF;
        v_novo.contagem := v_contagem;
      END IF;
    END IF;

    IF v_novo.dtstart::date < least(v_e.dtstart::date, v_hoje - 366) THEN
      RAISE EXCEPTION 'agenda: a data de início é antiga demais';
    END IF;
    IF v_novo.freq IS NOT NULL AND v_novo.ate IS NOT NULL
       AND v_novo.ate > (v_novo.dtstart::date + interval '5 years')::date THEN
      RAISE EXCEPTION 'agenda: repetição inválida';
    END IF;
    v_novo.dtstart := public.agenda_normalizar_dtstart(v_novo);
    v_reset := v_novo.dia_inteiro IS DISTINCT FROM v_e.dia_inteiro;

    IF v_escopo = 'todas' THEN
      v_regen := (v_novo.freq, v_novo.intervalo, v_novo.dias_semana, v_novo.mensal_modo, v_novo.mensal_ordinal, v_novo.ate, v_novo.contagem)
                   IS DISTINCT FROM (v_e.freq, v_e.intervalo, v_e.dias_semana, v_e.mensal_modo, v_e.mensal_ordinal, v_e.ate, v_e.contagem)
              OR v_novo.dtstart IS DISTINCT FROM v_e.dtstart
              OR v_novo.duracao_min IS DISTINCT FROM v_e.duracao_min
              OR v_novo.duracao_dias IS DISTINCT FROM v_e.duracao_dias
              OR v_reset;
      v_notifica := v_regen
                 OR v_novo.titulo IS DISTINCT FROM v_e.titulo
                 OR v_novo.local IS DISTINCT FROM v_e.local
                 OR v_novo.link_reuniao IS DISTINCT FROM v_e.link_reuniao;

      UPDATE public.agenda_eventos ev
         SET titulo = v_novo.titulo, descricao = v_novo.descricao, local = v_novo.local,
             link_reuniao = v_novo.link_reuniao, tipo = v_novo.tipo, cor = v_novo.cor,
             cliente_id = v_novo.cliente_id, privado = v_novo.privado, dia_inteiro = v_novo.dia_inteiro,
             dtstart = v_novo.dtstart, duracao_min = v_novo.duracao_min, duracao_dias = v_novo.duracao_dias,
             freq = v_novo.freq, intervalo = v_novo.intervalo, dias_semana = v_novo.dias_semana,
             mensal_modo = v_novo.mensal_modo, mensal_ordinal = v_novo.mensal_ordinal,
             ate = v_novo.ate, contagem = v_novo.contagem, lembretes = v_novo.lembretes
       WHERE ev.id = v_e.id;

      IF p_participantes IS NOT NULL THEN
        SELECT d.adicionados, d.removidos INTO v_add, v_rem
          FROM public.agenda_definir_participantes(v_e.id, v_conta, v_e.organizador_id, p_participantes) d;
      END IF;

      IF v_regen THEN
        -- a one-off keeps its single occurrence (id, RSVPs, deep links): move
        -- its identity date along before regenerating
        IF v_e.freq IS NULL AND v_novo.freq IS NULL THEN
          UPDATE public.agenda_ocorrencias o
             SET data_original = v_novo.dtstart::date
           WHERE o.evento_id = v_e.id;
        END IF;
        PERFORM public.agenda_regenerar(v_e.id, v_reset);
      END IF;
      v_alvo := v_e.id;

    ELSE
      -- ======== seguintes: split at v_c ========
      v_notifica := NOT v_regra_igual
                 OR v_novo.dtstart IS DISTINCT FROM (v_c + v_e.dtstart::time)
                 OR v_novo.duracao_min IS DISTINCT FROM v_e.duracao_min
                 OR v_novo.duracao_dias IS DISTINCT FROM v_e.duracao_dias
                 OR v_reset
                 OR v_novo.titulo IS DISTINCT FROM v_e.titulo
                 OR v_novo.local IS DISTINCT FROM v_e.local
                 OR v_novo.link_reuniao IS DISTINCT FROM v_e.link_reuniao;

      -- 1. the old series ends the day before the cut
      UPDATE public.agenda_eventos ev
         SET ate = v_c - 1, contagem = NULL, materializacao_completa = true
       WHERE ev.id = v_e.id;

      -- 2. the new series, with the participants (and their series answers) copied
      INSERT INTO public.agenda_eventos (
        conta_id, organizador_id, titulo, descricao, local, link_reuniao, tipo, cor, cliente_id,
        privado, dia_inteiro, tz, dtstart, duracao_min, duracao_dias, freq, intervalo, dias_semana,
        mensal_modo, mensal_ordinal, ate, contagem, lembretes, serie_origem_id)
      VALUES (
        v_conta, v_e.organizador_id, v_novo.titulo, v_novo.descricao, v_novo.local, v_novo.link_reuniao,
        v_novo.tipo, v_novo.cor, v_novo.cliente_id, v_novo.privado, v_novo.dia_inteiro, v_e.tz,
        v_novo.dtstart, v_novo.duracao_min, v_novo.duracao_dias, v_novo.freq, v_novo.intervalo,
        v_novo.dias_semana, v_novo.mensal_modo, v_novo.mensal_ordinal, v_novo.ate, v_novo.contagem,
        v_novo.lembretes, v_e.id)
      RETURNING id INTO v_alvo;
      SELECT * INTO v_novo FROM public.agenda_eventos ev WHERE ev.id = v_alvo;

      INSERT INTO public.agenda_participantes (evento_id, conta_id, user_id, resposta, respondido_em)
      SELECT v_alvo, v_conta, ap.user_id, ap.resposta, ap.respondido_em
        FROM public.agenda_participantes ap WHERE ap.evento_id = v_e.id;

      -- 3. old rows from the cut: those on the new rule move over (exceptions,
      --    tombstones and per-occurrence RSVPs preserved), the rest go
      v_h := (v_hoje + interval '24 months')::date;
      v_h := greatest(coalesce(v_e.horizonte_ate, v_h), v_h);
      v_datas := coalesce(ARRAY(SELECT d FROM public.agenda_datas_regra(v_novo, v_novo.dtstart::date, v_h) d), '{}');
      UPDATE public.agenda_ocorrencias o
         SET evento_id = v_alvo
       WHERE o.evento_id = v_e.id AND o.data_original >= v_c AND o.data_original = ANY (v_datas);
      DELETE FROM public.agenda_ocorrencias o
       WHERE o.evento_id = v_e.id AND o.data_original >= v_c;
      UPDATE public.agenda_ocorrencias o
         SET inicio = f.inicio,
             fim = f.fim,
             horario_alterado = CASE WHEN v_reset THEN false ELSE o.horario_alterado END
        FROM public.agenda_ocorrencias o2
        CROSS JOIN LATERAL public.agenda_inicio_fim(v_novo, o2.data_original) f
       WHERE o.id = o2.id AND o.evento_id = v_alvo
         AND (v_reset OR NOT o.horario_alterado);
      PERFORM public.agenda_materializar(v_alvo, v_h);

      -- participants left out lose their answers on the moved rows (helper)
      IF p_participantes IS NOT NULL THEN
        SELECT d.adicionados, d.removidos INTO v_add, v_rem
          FROM public.agenda_definir_participantes(v_alvo, v_conta, v_e.organizador_id, p_participantes) d;
      END IF;

      -- 4. an old series left without a live occurrence is deleted
      IF NOT EXISTS (SELECT 1 FROM public.agenda_ocorrencias o WHERE o.evento_id = v_e.id AND NOT o.cancelada) THEN
        DELETE FROM public.agenda_eventos ev WHERE ev.id = v_e.id;
      END IF;
    END IF;

    -- the edited occurrence takes the times of this edit even if it had been
    -- moved by hand before (other hand-moved occurrences keep theirs)
    IF v_tem_horario THEN
      SELECT * INTO v_novo FROM public.agenda_eventos ev WHERE ev.id = v_alvo;
      -- (its data_original as stored now: a one-off moved it along)
      UPDATE public.agenda_ocorrencias o
         SET inicio = f.inicio, fim = f.fim, horario_alterado = false
        FROM public.agenda_ocorrencias o2
        CROSS JOIN LATERAL public.agenda_inicio_fim(v_novo, o2.data_original) f
       WHERE o.id = o2.id AND o.id = v_o.id AND o.evento_id = v_alvo;
    END IF;

    SELECT o.id INTO v_ret FROM public.agenda_ocorrencias o
     WHERE o.evento_id = v_alvo AND NOT o.cancelada
     ORDER BY (o.id = v_o.id) DESC, (o.data_original >= v_c) DESC, o.data_original
     LIMIT 1;
  END IF;

  -- ---- notifications (the actor is excluded by agenda_notificar) ----
  IF v_notifica THEN
    v_destinatarios := ARRAY(SELECT ap.user_id FROM public.agenda_participantes ap
                              WHERE ap.evento_id = v_alvo AND NOT (ap.user_id = ANY (v_add)));
    PERFORM public.agenda_notificar(v_conta, v_alvo, v_ret, 'event_updated', v_destinatarios, v_user,
                                    jsonb_build_object('escopo', v_escopo));
  END IF;
  IF cardinality(v_add) > 0 THEN
    PERFORM public.agenda_notificar(v_conta, v_alvo, v_ret, 'event_invited', v_add, v_user,
                                    jsonb_build_object('escopo', v_escopo));
  END IF;
  IF cardinality(v_rem) > 0 THEN
    PERFORM public.agenda_notificar(v_conta, v_alvo, v_ret, 'event_cancelled', v_rem, v_user,
                                    jsonb_build_object('escopo', v_escopo, 'motivo', 'removido'));
  END IF;

  RETURN v_ret;
END $$;
REVOKE ALL ON FUNCTION public.agenda_evento_editar(bigint, text, jsonb, uuid[]) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agenda_evento_editar(bigint, text, jsonb, uuid[]) TO authenticated, service_role;

-- ---- client RPC: delete ----
-- 'esta' leaves a tombstone (EXDATE); 'seguintes' ends the series the day
-- before (and drops the rows from there); 'todas' deletes the series (cascade).
-- A series left without a live occurrence (and nothing more to materialize) is
-- deleted. Participants except the actor get event_cancelled BEFORE the delete,
-- so the notification still carries the title and date.
CREATE OR REPLACE FUNCTION public.agenda_evento_excluir(p_ocorrencia_id bigint, p_escopo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_conta uuid;
  v_user uuid;
  v_o public.agenda_ocorrencias;
  v_e public.agenda_eventos;
  v_escopo text;
  v_primeira boolean;
BEGIN
  v_conta := get_my_conta_id(); v_user := auth.uid();
  IF v_conta IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'agenda: sessão sem workspace ativo'; END IF;
  IF p_escopo IS NULL OR p_escopo NOT IN ('esta', 'seguintes', 'todas') THEN
    RAISE EXCEPTION 'agenda: escopo inválido';
  END IF;

  SELECT o.* INTO v_o FROM public.agenda_ocorrencias o
   WHERE o.id = p_ocorrencia_id AND o.conta_id = v_conta AND NOT o.cancelada;
  IF NOT FOUND THEN RAISE EXCEPTION 'agenda: este evento não existe mais'; END IF;
  SELECT e.* INTO v_e FROM public.agenda_eventos e
   WHERE e.id = v_o.evento_id AND e.conta_id = v_conta FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'agenda: este evento não existe mais'; END IF;
  IF NOT public.agenda_pode_editar(v_e, v_user, v_conta) THEN
    RAISE EXCEPTION 'agenda: você não pode editar este evento';
  END IF;
  SELECT o.* INTO v_o FROM public.agenda_ocorrencias o
   WHERE o.id = p_ocorrencia_id AND o.evento_id = v_e.id AND NOT o.cancelada;
  IF NOT FOUND THEN RAISE EXCEPTION 'agenda: este evento não existe mais'; END IF;

  v_primeira := NOT EXISTS (SELECT 1 FROM public.agenda_ocorrencias o
                             WHERE o.evento_id = v_e.id AND NOT o.cancelada AND o.data_original < v_o.data_original);
  IF v_e.freq IS NULL OR (p_escopo = 'seguintes' AND v_primeira) THEN
    v_escopo := 'todas';
  ELSE
    v_escopo := p_escopo;
  END IF;

  PERFORM public.agenda_notificar(
    v_conta, v_e.id, v_o.id, 'event_cancelled',
    ARRAY(SELECT ap.user_id FROM public.agenda_participantes ap WHERE ap.evento_id = v_e.id),
    v_user, jsonb_build_object('escopo', v_escopo));

  IF v_escopo = 'todas' THEN
    DELETE FROM public.agenda_eventos ev WHERE ev.id = v_e.id;
    RETURN;
  ELSIF v_escopo = 'esta' THEN
    UPDATE public.agenda_ocorrencias o SET cancelada = true WHERE o.id = v_o.id;
  ELSE
    UPDATE public.agenda_eventos ev
       SET ate = v_o.data_original - 1, contagem = NULL, materializacao_completa = true
     WHERE ev.id = v_e.id;
    DELETE FROM public.agenda_ocorrencias o
     WHERE o.evento_id = v_e.id AND o.data_original >= v_o.data_original;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.agenda_ocorrencias o WHERE o.evento_id = v_e.id AND NOT o.cancelada)
     AND EXISTS (SELECT 1 FROM public.agenda_eventos ev WHERE ev.id = v_e.id AND ev.materializacao_completa) THEN
    DELETE FROM public.agenda_eventos ev WHERE ev.id = v_e.id;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.agenda_evento_excluir(bigint, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agenda_evento_excluir(bigint, text) TO authenticated, service_role;

-- ---- client RPC: RSVP ----
-- 'todas' answers for the series and clears the user's per-occurrence answers
-- from now on (past ones stay as history); 'esta' upserts the answer for this
-- occurrence only. A series without a rule always answers at series level.
-- The series row is locked FOR SHARE: concurrent RSVPs proceed in parallel,
-- edits (FOR UPDATE) serialize with them. The organizer gets event_rsvp.
CREATE OR REPLACE FUNCTION public.agenda_responder(p_ocorrencia_id bigint, p_resposta text, p_escopo text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_conta uuid;
  v_user uuid;
  v_o public.agenda_ocorrencias;
  v_e public.agenda_eventos;
  v_escopo text;
BEGIN
  v_conta := get_my_conta_id(); v_user := auth.uid();
  IF v_conta IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'agenda: sessão sem workspace ativo'; END IF;
  IF NOT public.has_permission('calendario', 'ver') THEN
    RAISE EXCEPTION 'agenda: você não pode ver a agenda';
  END IF;
  IF p_resposta IS NULL OR p_resposta NOT IN ('sim', 'nao', 'talvez') THEN
    RAISE EXCEPTION 'agenda: resposta inválida';
  END IF;
  IF p_escopo IS NULL OR p_escopo NOT IN ('esta', 'todas') THEN
    RAISE EXCEPTION 'agenda: escopo inválido';
  END IF;

  SELECT o.* INTO v_o FROM public.agenda_ocorrencias o
   WHERE o.id = p_ocorrencia_id AND o.conta_id = v_conta AND NOT o.cancelada;
  IF NOT FOUND THEN RAISE EXCEPTION 'agenda: este evento não existe mais'; END IF;
  SELECT e.* INTO v_e FROM public.agenda_eventos e
   WHERE e.id = v_o.evento_id AND e.conta_id = v_conta FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'agenda: este evento não existe mais'; END IF;
  SELECT o.* INTO v_o FROM public.agenda_ocorrencias o
   WHERE o.id = p_ocorrencia_id AND o.evento_id = v_e.id AND NOT o.cancelada;
  IF NOT FOUND THEN RAISE EXCEPTION 'agenda: este evento não existe mais'; END IF;

  IF v_e.organizador_id = v_user THEN
    RAISE EXCEPTION 'agenda: o organizador não responde ao próprio evento';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.agenda_participantes ap WHERE ap.evento_id = v_e.id AND ap.user_id = v_user) THEN
    RAISE EXCEPTION 'agenda: você não participa deste evento';
  END IF;

  v_escopo := CASE WHEN v_e.freq IS NULL THEN 'todas' ELSE p_escopo END;
  IF v_escopo = 'todas' THEN
    UPDATE public.agenda_participantes ap
       SET resposta = p_resposta, respondido_em = now()
     WHERE ap.evento_id = v_e.id AND ap.user_id = v_user;
    DELETE FROM public.agenda_respostas ar
     USING public.agenda_ocorrencias o
     WHERE ar.ocorrencia_id = o.id AND o.evento_id = v_e.id AND ar.user_id = v_user AND o.inicio >= now();
  ELSE
    INSERT INTO public.agenda_respostas AS ar (ocorrencia_id, conta_id, user_id, resposta, respondido_em)
    VALUES (v_o.id, v_conta, v_user, p_resposta, now())
    ON CONFLICT (ocorrencia_id, user_id) DO UPDATE SET resposta = EXCLUDED.resposta, respondido_em = EXCLUDED.respondido_em;
  END IF;

  PERFORM public.agenda_notificar(v_conta, v_e.id, v_o.id, 'event_rsvp', ARRAY[v_e.organizador_id], v_user,
                                  jsonb_build_object('resposta', p_resposta, 'escopo', v_escopo));
END $$;
REVOKE ALL ON FUNCTION public.agenda_responder(bigint, text, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agenda_responder(bigint, text, text) TO authenticated, service_role;
