-- Agenda (sub-project 2): personal iCal feed. Spec:
-- docs/superpowers/specs/2026-10-06-agenda-google-ics-feed-design.md ("Banco").
--
-- One secret token per (user, workspace). The CRM reads, creates/replaces and
-- removes it through three SECURITY DEFINER RPCs; no tenant role reads the
-- table. The edge function agenda-feed resolves the token with the service
-- role through agenda_feed_eventos(token), which returns the user's events
-- ("my events": organizer or participant, not declined) inside the window.
-- Everything is behind feature_agenda, like the rest of the agenda.

-- ============ (1) token table ============
-- Plain text on purpose (pattern of client_hub_tokens): the user can copy the
-- URL again at any time. A removed member keeps the row; the feed answers NULL
-- for them because has_permission_for fails (spec, accepted).
CREATE TABLE public.agenda_feed_tokens (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conta_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, conta_id)
);
CREATE INDEX agenda_feed_tokens_conta_idx ON public.agenda_feed_tokens (conta_id);
-- service_role and the RPCs below only (pattern of agenda_lembretes)
ALTER TABLE public.agenda_feed_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY agenda_feed_tokens_service_role_bypass ON public.agenda_feed_tokens
  FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON TABLE public.agenda_feed_tokens FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.agenda_feed_tokens TO service_role;

-- ============ (2) CRM RPCs ============
-- Internal: the preamble of agenda_listar, shared by the three RPCs. Returns
-- the session's (workspace, user) or raises. auth.uid() and get_my_conta_id()
-- read the request's JWT claims, which a nested DEFINER call does not change.
CREATE OR REPLACE FUNCTION public.agenda_feed_contexto(OUT v_conta uuid, OUT v_user uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  v_conta := get_my_conta_id(); v_user := auth.uid();
  IF v_conta IS NULL OR v_user IS NULL THEN RAISE EXCEPTION 'agenda: sessão sem workspace ativo'; END IF;
  IF NOT public.effective_plan_feature(v_conta, 'feature_agenda') THEN
    RAISE EXCEPTION 'feature_disabled:feature_agenda' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.has_permission('calendario', 'ver') THEN
    RAISE EXCEPTION 'agenda: você não pode ver a agenda';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.agenda_feed_contexto() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_feed_contexto() TO service_role;

-- The caller's current token in the active workspace, or NULL.
CREATE OR REPLACE FUNCTION public.agenda_feed_obter()
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE c record; v text;
BEGIN
  SELECT * INTO c FROM public.agenda_feed_contexto();
  SELECT t.token INTO v FROM public.agenda_feed_tokens t
   WHERE t.user_id = c.v_user AND t.conta_id = c.v_conta;
  RETURN v;
END $$;

-- Creates or replaces the caller's token and returns it. Replacing invalidates
-- the previous URL at once. 64 lowercase hex (two v4 uuids, ~244 random bits,
-- Postgres core only).
CREATE OR REPLACE FUNCTION public.agenda_feed_gerar()
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE c record; v text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
BEGIN
  SELECT * INTO c FROM public.agenda_feed_contexto();
  INSERT INTO public.agenda_feed_tokens (user_id, conta_id, token)
  VALUES (c.v_user, c.v_conta, v)
  ON CONFLICT (user_id, conta_id) DO UPDATE SET token = EXCLUDED.token, criado_em = now();
  RETURN v;
END $$;

-- Removes the caller's token (no-op when there is none).
CREATE OR REPLACE FUNCTION public.agenda_feed_desativar()
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE c record;
BEGIN
  SELECT * INTO c FROM public.agenda_feed_contexto();
  DELETE FROM public.agenda_feed_tokens t WHERE t.user_id = c.v_user AND t.conta_id = c.v_conta;
END $$;

REVOKE ALL ON FUNCTION public.agenda_feed_obter() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.agenda_feed_gerar() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.agenda_feed_desativar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agenda_feed_obter() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agenda_feed_gerar() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.agenda_feed_desativar() TO authenticated, service_role;

-- ============ (3) feed contents (service role only) ============
-- The token is the credential. Returns:
--   NULL: unknown token, or the user is no longer a member / lost calendario ver
--   {"estado":"desligado","workspace_nome":..,"eventos":[]}: flag off (the
--     function still serves a valid, empty calendar)
--   {"estado":"ok","workspace_nome":..,"eventos":[...]}: the non-cancelled
--     occurrences of events the user organizes or attends (the organizer is
--     always a participant with sim), minus effective answer nao, with inicio in
--     [now() - 30 days, now() + 12 months), ordered by inicio, at most 2000.
-- No masking: everything here has the user as organizer or participant, and
-- agenda_listar's mascarado requires NOT participant. Overridden fields and the
-- local dates (exclusive end) use agenda_listar's expressions; keep them in sync.
CREATE OR REPLACE FUNCTION public.agenda_feed_eventos(p_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_user uuid; v_conta uuid; v_nome text; v_eventos jsonb;
BEGIN
  SELECT t.user_id, t.conta_id INTO v_user, v_conta
    FROM public.agenda_feed_tokens t WHERE t.token = p_token;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF NOT public.has_permission_for(v_user, v_conta, 'calendario', 'ver') THEN RETURN NULL; END IF;
  SELECT w.name INTO v_nome FROM public.workspaces w WHERE w.id = v_conta;
  IF NOT public.effective_plan_feature(v_conta, 'feature_agenda') THEN
    RETURN jsonb_build_object('estado', 'desligado', 'workspace_nome', v_nome, 'eventos', '[]'::jsonb);
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.inicio, x.ocorrencia_id), '[]'::jsonb) INTO v_eventos
  FROM (
    SELECT o.id AS ocorrencia_id, e.id AS evento_id, o.data_original,
           o.inicio, o.fim, e.dia_inteiro,
           (o.inicio AT TIME ZONE e.tz)::date AS data_inicio_local,
           CASE WHEN e.dia_inteiro THEN (o.fim AT TIME ZONE e.tz)::date
                ELSE ((o.fim AT TIME ZONE e.tz) - interval '1 microsecond')::date + 1 END AS data_fim_local,
           CASE WHEN 'titulo' = ANY (o.campos_sobrescritos) THEN o.titulo ELSE e.titulo END AS titulo,
           CASE WHEN 'descricao' = ANY (o.campos_sobrescritos) THEN o.descricao ELSE e.descricao END AS descricao,
           CASE WHEN 'local' = ANY (o.campos_sobrescritos) THEN o.local ELSE e.local END AS local,
           CASE WHEN 'link_reuniao' = ANY (o.campos_sobrescritos) THEN o.link_reuniao ELSE e.link_reuniao END AS link_reuniao,
           e.tz
      FROM public.agenda_ocorrencias o
      JOIN public.agenda_eventos e ON e.id = o.evento_id AND e.conta_id = v_conta
      JOIN public.agenda_participantes ap ON ap.evento_id = e.id AND ap.user_id = v_user
      LEFT JOIN public.agenda_respostas ar ON ar.ocorrencia_id = o.id AND ar.user_id = v_user
     WHERE o.conta_id = v_conta
       AND NOT o.cancelada
       AND coalesce(ar.resposta, ap.resposta) IS DISTINCT FROM 'nao'
       AND o.inicio >= now() - interval '30 days'
       AND o.inicio <  now() + interval '12 months'
     ORDER BY o.inicio, o.id
     LIMIT 2000
  ) x;
  RETURN jsonb_build_object('estado', 'ok', 'workspace_nome', v_nome, 'eventos', v_eventos);
END $$;
REVOKE ALL ON FUNCTION public.agenda_feed_eventos(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_feed_eventos(text) TO service_role;
