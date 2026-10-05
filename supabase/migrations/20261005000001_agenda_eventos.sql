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
