-- supabase/migrations/20261005000002_agenda_lembretes.sql
-- Agenda (sub-projeto 1), migration B: reminders. A ledger with one row per
-- (occurrence, user, reminder minutes, target start), a per-minute pg_cron tick
-- that claims due reminders (in-app notification + e-mail queue), and the
-- lease-based claim/mark pair used by the agenda-lembretes-email edge function.
-- Spec: docs/superpowers/specs/2026-10-05-agenda-eventos-core-design.md
-- ("agenda_lembretes", "Lembretes (migration B)"). Rollback runbook:
-- docs/superpowers/specs/assets/2026-10-05-agenda-rollback.sql.

-- ============ ledger ============
-- inicio_alvo is part of the key: moving an event changes the target, so the
-- reminder fires again for the new time; changing lembretes creates new keys;
-- re-saving without changes never re-sends.
CREATE TABLE public.agenda_lembretes (
  ocorrencia_id bigint NOT NULL,
  conta_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  minutos int NOT NULL,
  inicio_alvo timestamptz NOT NULL,
  notification_id uuid NULL,
  email_status text NOT NULL CHECK (email_status IN ('nao','pendente','enviando','enviado','falhou')),
  email_tentativas int NOT NULL DEFAULT 0,
  email_lease_ate timestamptz NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ocorrencia_id, user_id, minutos, inicio_alvo),
  CONSTRAINT agenda_lembretes_ocorrencia_fk FOREIGN KEY (ocorrencia_id, conta_id)
    REFERENCES public.agenda_ocorrencias(id, conta_id) ON DELETE CASCADE
);
CREATE INDEX agenda_lembretes_email_idx ON public.agenda_lembretes (email_lease_ate)
  WHERE email_status IN ('pendente', 'enviando');
CREATE INDEX agenda_lembretes_user_idx ON public.agenda_lembretes (user_id);
CREATE INDEX agenda_lembretes_criado_idx ON public.agenda_lembretes (criado_em);

-- The tick is driven by the series with reminders that can still have an
-- occurrence in the window (see agenda_tick_lembretes): one-offs by dtstart,
-- recurring series by ate (NULL ate, no end, as 'infinity' so the range stays
-- sargable). Occurrences moved by hand out of a finished series are found
-- through the third index.
CREATE INDEX agenda_eventos_lembretes_avulso_idx ON public.agenda_eventos (dtstart)
  WHERE cardinality(lembretes) > 0 AND freq IS NULL;
CREATE INDEX agenda_eventos_lembretes_serie_idx ON public.agenda_eventos ((coalesce(ate, 'infinity'::date)))
  WHERE cardinality(lembretes) > 0 AND freq IS NOT NULL;
CREATE INDEX agenda_ocorrencias_movidas_idx ON public.agenda_ocorrencias (inicio)
  WHERE horario_alterado AND NOT cancelada;

-- service_role only: no tenant ever reads the ledger
ALTER TABLE public.agenda_lembretes ENABLE ROW LEVEL SECURITY;
CREATE POLICY agenda_lembretes_service_role_bypass ON public.agenda_lembretes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON TABLE public.agenda_lembretes FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.agenda_lembretes TO service_role;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.role_table_grants
     WHERE table_schema = 'public' AND table_name = 'agenda_lembretes'
       AND grantee IN ('anon', 'authenticated')
  ) THEN
    RAISE EXCEPTION 'agenda_lembretes: anon/authenticated hold a privilege';
  END IF;
END
$$;

-- ============ per-minute tick ============
-- Internal (pg_cron, service_role). For every series with reminders and every
-- reminder minute m, the live occurrences with inicio in (p_now - 15 min + m,
-- p_now + m] are due: a reminder more than 15 minutes late (database down) is
-- dropped. Candidates are read FOR KEY SHARE SKIP LOCKED, skipping rows in the
-- middle of a delete instead of waiting. Recipients are participants whose
-- effective answer is not 'nao' and who are still workspace members. The
-- ledger INSERT ... ON CONFLICT DO NOTHING is the claim (at most once per
-- key). Each claim gets an in-app event_reminder written with emailed_at set,
-- so the digest never takes it; the e-mail goes through the ledger
-- (email_status 'pendente', or 'nao' when the user turned reminder e-mails or
-- all e-mails off). When anything is waiting for e-mail, the edge function is
-- kicked through pg_net in a guarded block: a failure there never discards the
-- claims (the next tick retries through pendente / an expired lease).
-- Returns the number of claims created.
CREATE OR REPLACE FUNCTION public.agenda_tick_lembretes(p_now timestamptz DEFAULT now(), p_chamar_email boolean DEFAULT true)
RETURNS int LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  v_n int := 0;
  v_notif uuid;
  v_url text;
  v_secret text;
BEGIN
  FOR r IN
    -- Candidate series: a reminder is due when inicio is in (p_now - 15 min + m,
    -- p_now + m] and m >= -1440, so no occurrence starting before
    -- p_now - 1 day 15 min can be due. A series is "live" when it can still have
    -- such an occurrence: a one-off whose dtstart is at most 2 local days old,
    -- or a recurring series with no ate or an ate at most 2 local days old (a
    -- contagem series has no ate and stays live). The exact test is per series
    -- tz; the coarse UTC bound in front of it (3 days covers any tz offset) is
    -- the sargable superset the partial indexes serve. An occurrence moved by
    -- hand past its series' ate is the one thing the bound misses, so the second
    -- branch reads moved occurrences in the window through their own index, for
    -- series that are NOT live (the two branches never overlap).
    WITH cand AS (
      SELECT o.id AS ocorrencia_id, o.conta_id, o.inicio, o.fim, o.data_original,
             CASE WHEN 'titulo' = ANY (o.campos_sobrescritos) THEN o.titulo ELSE e.titulo END AS titulo,
             e.id AS evento_id, e.tz, e.dia_inteiro, m.m AS minutos
        FROM public.agenda_eventos e
       CROSS JOIN LATERAL unnest(e.lembretes) AS m(m)
        JOIN LATERAL (
          SELECT oc.* FROM public.agenda_ocorrencias oc
           WHERE oc.evento_id = e.id AND NOT oc.cancelada
             AND oc.inicio >  p_now - interval '15 minutes' + make_interval(mins => m.m)
             AND oc.inicio <= p_now + make_interval(mins => m.m)
             FOR KEY SHARE SKIP LOCKED
        ) o ON true
       WHERE cardinality(e.lembretes) > 0
         AND ((e.freq IS NULL AND e.dtstart >= (p_now AT TIME ZONE 'UTC') - interval '3 days')
              OR (e.freq IS NOT NULL AND coalesce(e.ate, 'infinity'::date) >= ((p_now AT TIME ZONE 'UTC') - interval '3 days')::date))
         AND CASE WHEN e.freq IS NULL THEN e.dtstart >= (p_now AT TIME ZONE e.tz) - interval '2 days'
                  ELSE e.ate IS NULL OR e.ate >= ((p_now AT TIME ZONE e.tz) - interval '2 days')::date END
      UNION ALL
      SELECT o.id, o.conta_id, o.inicio, o.fim, o.data_original,
             CASE WHEN 'titulo' = ANY (o.campos_sobrescritos) THEN o.titulo ELSE e.titulo END,
             e.id, e.tz, e.dia_inteiro, m.m
        FROM (
          SELECT oc.* FROM public.agenda_ocorrencias oc
           WHERE oc.horario_alterado AND NOT oc.cancelada
             AND oc.inicio >  p_now - interval '1 day 15 minutes'
             AND oc.inicio <= p_now + interval '28 days'
             FOR KEY SHARE SKIP LOCKED
        ) o
        JOIN public.agenda_eventos e ON e.id = o.evento_id
       CROSS JOIN LATERAL unnest(e.lembretes) AS m(m)
       WHERE cardinality(e.lembretes) > 0
         AND o.inicio >  p_now - interval '15 minutes' + make_interval(mins => m.m)
         AND o.inicio <= p_now + make_interval(mins => m.m)
         AND NOT CASE WHEN e.freq IS NULL THEN e.dtstart >= (p_now AT TIME ZONE e.tz) - interval '2 days'
                      ELSE e.ate IS NULL OR e.ate >= ((p_now AT TIME ZONE e.tz) - interval '2 days')::date END
    ), dest AS (
      SELECT c.*, ap.user_id
        FROM cand c
        JOIN public.agenda_participantes ap ON ap.evento_id = c.evento_id
        JOIN public.workspace_members wm ON wm.workspace_id = c.conta_id AND wm.user_id = ap.user_id
        LEFT JOIN public.agenda_respostas ar ON ar.ocorrencia_id = c.ocorrencia_id AND ar.user_id = ap.user_id
       WHERE coalesce(ar.resposta, ap.resposta) <> 'nao'
    ), ins AS (
      INSERT INTO public.agenda_lembretes (ocorrencia_id, conta_id, user_id, minutos, inicio_alvo, email_status)
      SELECT d.ocorrencia_id, d.conta_id, d.user_id, d.minutos, d.inicio,
             CASE WHEN EXISTS (SELECT 1 FROM public.notification_email_prefs p
                                WHERE p.user_id = d.user_id AND p.enabled = false
                                  AND p.type IN ('event_reminder', '__all__'))
                  THEN 'nao' ELSE 'pendente' END
        FROM dest d
      ON CONFLICT DO NOTHING
      RETURNING agenda_lembretes.ocorrencia_id, agenda_lembretes.user_id, agenda_lembretes.minutos, agenda_lembretes.inicio_alvo
    )
    SELECT i.ocorrencia_id, i.user_id, i.minutos, i.inicio_alvo,
           d.conta_id, d.evento_id, d.titulo, d.inicio, d.fim, d.dia_inteiro, d.tz
      FROM ins i
      JOIN dest d ON d.ocorrencia_id = i.ocorrencia_id AND d.user_id = i.user_id AND d.minutos = i.minutos
  LOOP
    INSERT INTO public.notifications (workspace_id, user_id, type, metadata, link, emailed_at)
    VALUES (
      r.conta_id, r.user_id, 'event_reminder',
      jsonb_build_object(
        'evento_id', r.evento_id,
        'ocorrencia_id', r.ocorrencia_id,
        'titulo', r.titulo,
        'inicio', r.inicio,
        'fim', r.fim,
        'dia_inteiro', r.dia_inteiro,
        'data_local', to_char((r.inicio AT TIME ZONE r.tz)::date, 'YYYY-MM-DD'),
        'minutos', r.minutos),
      '/calendario?evento=' || r.ocorrencia_id,
      now())
    RETURNING id INTO v_notif;

    UPDATE public.agenda_lembretes l
       SET notification_id = v_notif
     WHERE l.ocorrencia_id = r.ocorrencia_id AND l.user_id = r.user_id
       AND l.minutos = r.minutos AND l.inicio_alvo = r.inicio_alvo;
    v_n := v_n + 1;
  END LOOP;

  IF p_chamar_email AND EXISTS (
       SELECT 1 FROM public.agenda_lembretes l
        WHERE l.email_status = 'pendente'
           OR (l.email_status = 'enviando' AND l.email_lease_ate < now())) THEN
    BEGIN
      SELECT (SELECT ds.decrypted_secret FROM vault.decrypted_secrets ds WHERE ds.name = 'project_url'),
             (SELECT ds.decrypted_secret FROM vault.decrypted_secrets ds WHERE ds.name = 'cron_secret')
        INTO v_url, v_secret;
      IF v_url IS NOT NULL AND v_secret IS NOT NULL THEN
        PERFORM net.http_post(
          url := v_url || '/functions/v1/agenda-lembretes-email',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
          body := '{}'::jsonb);
      ELSE
        RAISE WARNING 'agenda_tick_lembretes: vault secrets missing, e-mail skipped';
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'agenda_tick_lembretes: http_post failed: %', SQLERRM;
    END;
  END IF;

  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.agenda_tick_lembretes(timestamptz, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_tick_lembretes(timestamptz, boolean) TO service_role;

-- ============ e-mail claim / mark (agenda-lembretes-email) ============
-- Internal (service_role). Lease-based: claimed rows become 'enviando' with a
-- 2-minute lease and one more attempt. A row the function never settled (its
-- 50 s deadline skips the rest of the batch without marking) is re-claimed once
-- the lease expires, up to 3 attempts; one still unsettled at the cap becomes
-- 'falhou' instead of being re-claimed forever. Before claiming, rows that must
-- no longer be e-mailed are settled as 'nao': the occurrence was cancelled,
-- moved (inicio <> inicio_alvo: the move created its own reminder), or already
-- ended. Returns the event data the e-mail needs (effective title, place and
-- link; tz for formatting).
CREATE OR REPLACE FUNCTION public.agenda_claim_emails_lembrete(p_limit int DEFAULT 100)
RETURNS TABLE (ocorrencia_id bigint, user_id uuid, minutos int, inicio_alvo timestamptz, notification_id uuid,
               titulo text, inicio timestamptz, fim timestamptz, dia_inteiro boolean, local text, link_reuniao text,
               tz text, tentativas int)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
BEGIN
  UPDATE public.agenda_lembretes l
     SET email_status = 'falhou', email_lease_ate = NULL
   WHERE l.email_status = 'enviando' AND l.email_lease_ate < now() AND l.email_tentativas >= 3;

  UPDATE public.agenda_lembretes l
     SET email_status = 'nao', email_lease_ate = NULL
    FROM public.agenda_ocorrencias o
   WHERE o.id = l.ocorrencia_id
     AND (l.email_status = 'pendente' OR (l.email_status = 'enviando' AND l.email_lease_ate < now()))
     AND (o.cancelada OR o.inicio <> l.inicio_alvo OR o.fim < now());

  RETURN QUERY
  WITH alvo AS (
    SELECT l.ocorrencia_id, l.user_id, l.minutos, l.inicio_alvo
      FROM public.agenda_lembretes l
     WHERE (l.email_status = 'pendente' OR (l.email_status = 'enviando' AND l.email_lease_ate < now()))
       AND l.email_tentativas < 3
     ORDER BY l.criado_em, l.ocorrencia_id, l.user_id
     LIMIT greatest(coalesce(p_limit, 100), 0)
     FOR UPDATE OF l SKIP LOCKED
  ), upd AS (
    UPDATE public.agenda_lembretes l
       SET email_status = 'enviando',
           email_lease_ate = now() + interval '2 minutes',
           email_tentativas = l.email_tentativas + 1
      FROM alvo a
     WHERE l.ocorrencia_id = a.ocorrencia_id AND l.user_id = a.user_id
       AND l.minutos = a.minutos AND l.inicio_alvo = a.inicio_alvo
    RETURNING l.ocorrencia_id, l.user_id, l.minutos, l.inicio_alvo, l.notification_id, l.email_tentativas
  )
  SELECT u.ocorrencia_id, u.user_id, u.minutos, u.inicio_alvo, u.notification_id,
         CASE WHEN 'titulo' = ANY (o.campos_sobrescritos) THEN o.titulo ELSE e.titulo END,
         o.inicio, o.fim, e.dia_inteiro,
         CASE WHEN 'local' = ANY (o.campos_sobrescritos) THEN o.local ELSE e.local END,
         CASE WHEN 'link_reuniao' = ANY (o.campos_sobrescritos) THEN o.link_reuniao ELSE e.link_reuniao END,
         e.tz, u.email_tentativas
    FROM upd u
    JOIN public.agenda_ocorrencias o ON o.id = u.ocorrencia_id
    JOIN public.agenda_eventos e ON e.id = o.evento_id
   ORDER BY o.inicio, u.ocorrencia_id, u.user_id;
END $$;
REVOKE ALL ON FUNCTION public.agenda_claim_emails_lembrete(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_claim_emails_lembrete(int) TO service_role;

-- Internal (service_role). Settles one claimed row: ok -> 'enviado'; failure ->
-- back to 'pendente' while email_tentativas < 3, else 'falhou'. Only a row that
-- is 'enviando' changes, so a repeated mark is a no-op, and only while its
-- lease ended at most 5 minutes ago, so a send that outlived its 2-minute lease
-- by more than that cannot settle the row. Limitation: the mark carries no
-- claim token (the handler's 5 arguments are fixed), so a late mark that lands
-- after another run re-claimed the row (fresh lease) still settles that newer
-- claim. The fence only stops very stale marks.
CREATE OR REPLACE FUNCTION public.agenda_marcar_email_lembrete(
  p_ocorrencia_id bigint, p_user_id uuid, p_minutos int, p_inicio_alvo timestamptz, p_ok boolean)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.agenda_lembretes l
     SET email_status = CASE WHEN p_ok THEN 'enviado'
                             WHEN l.email_tentativas >= 3 THEN 'falhou'
                             ELSE 'pendente' END,
         email_lease_ate = NULL
   WHERE l.ocorrencia_id = p_ocorrencia_id AND l.user_id = p_user_id
     AND l.minutos = p_minutos AND l.inicio_alvo = p_inicio_alvo
     AND l.email_status = 'enviando'
     AND l.email_lease_ate >= now() - interval '5 minutes';
$$;
REVOKE ALL ON FUNCTION public.agenda_marcar_email_lembrete(bigint, uuid, int, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agenda_marcar_email_lembrete(bigint, uuid, int, timestamptz, boolean) TO service_role;

-- ============ daily generator: + ledger cleanup ============
-- Same body as migration A, plus the 30-day ledger cleanup (spec "Gerador
-- diário"). The grants survive CREATE OR REPLACE.
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

  DELETE FROM public.agenda_lembretes l WHERE l.criado_em < now() - interval '30 days';

  RETURN v_n;
END $$;

-- ============ cron ============
-- Every minute (the fourth per-minute job; SQL-only and short, the e-mail kick
-- only when something is waiting). A run lost to a connection failure is
-- recovered the next minute by the 15-minute window.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'agenda-lembretes') THEN PERFORM cron.unschedule('agenda-lembretes'); END IF;
END $$;
SELECT cron.schedule('agenda-lembretes', '* * * * *', $$SELECT public.agenda_tick_lembretes()$$);
