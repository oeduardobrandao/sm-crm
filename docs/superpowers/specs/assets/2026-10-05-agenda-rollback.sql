-- Agenda (sub-projeto 1): rollback runbook.
-- Não aplicar por migration. Rodar à mão só depois de reverter o PR do frontend.
--
-- Spec: docs/superpowers/specs/2026-10-05-agenda-eventos-core-design.md ("Rollout").
-- Migrations undone: 20261005000001_agenda_eventos.sql (A) and
-- 20261005000002_agenda_lembretes.sql (B).
--
-- Reminders only (partial rollback): run just
--   SELECT cron.unschedule('agenda-lembretes');
-- and stop. Nothing else changes.
--
-- Full rollback: run this whole file in ONE transaction, e.g.
--   psql "$DB_URL" -v ON_ERROR_STOP=1 -1 -f docs/superpowers/specs/assets/2026-10-05-agenda-rollback.sql
-- The file has no BEGIN/COMMIT on purpose (99_agenda_lembretes.sql runs it inside
-- its own transaction and rolls it back).
--
-- The notification CHECKs and claim_notification_emails are NOT restored from a
-- historical copy: another PR may have appended types after this one. The DO
-- block reads the CURRENT definitions, removes only the five agenda literals,
-- and fails if any of them is not found exactly where expected. Restoring the
-- CHECKs is optional in a partial rollback: the extra types are harmless.

-- ---- 1. stop the jobs ----
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'agenda-lembretes') THEN PERFORM cron.unschedule('agenda-lembretes'); END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'agenda-horizonte') THEN PERFORM cron.unschedule('agenda-horizonte'); END IF;
END $$;

-- ---- 2. rows that would violate the narrowed CHECKs ----
DELETE FROM public.notifications
 WHERE type IN ('event_invited','event_updated','event_cancelled','event_rsvp','event_reminder');
DELETE FROM public.notification_inapp_prefs
 WHERE type IN ('event_invited','event_updated','event_cancelled','event_rsvp','event_reminder');
DELETE FROM public.notification_email_prefs
 WHERE type IN ('event_invited','event_updated','event_cancelled','event_rsvp','event_reminder');

-- ---- 3. remove the five literals from the current CHECKs and the digest claim ----
DO $$
DECLARE
  c record;
  v_def text;
  v_new text;
  v_n int;
BEGIN
  FOR c IN
    SELECT * FROM (VALUES
      ('public.notifications'::regclass, 'notifications_type_check', 5),
      ('public.notification_inapp_prefs'::regclass, 'notification_inapp_prefs_type_check', 5),
      ('public.notification_email_prefs'::regclass, 'notification_email_prefs_type_check', 4)
    ) AS t(rel, conname, esperado)
  LOOP
    SELECT pg_get_constraintdef(pc.oid) INTO v_def
      FROM pg_constraint pc WHERE pc.conrelid = c.rel AND pc.conname = c.conname;
    IF v_def IS NULL THEN
      RAISE EXCEPTION 'agenda rollback: constraint % not found', c.conname;
    END IF;
    SELECT count(*) INTO v_n
      FROM regexp_matches(v_def, '''event_(invited|updated|cancelled|rsvp|reminder)''::text', 'g');
    IF v_n <> c.esperado THEN
      RAISE EXCEPTION 'agenda rollback: % has % agenda literals, expected %', c.conname, v_n, c.esperado;
    END IF;
    v_new := regexp_replace(v_def, ',\s*''event_(invited|updated|cancelled|rsvp|reminder)''::text', '', 'g');
    IF v_new ~ 'event_(invited|updated|cancelled|rsvp|reminder)' THEN
      RAISE EXCEPTION 'agenda rollback: % still lists an agenda type after the edit', c.conname;
    END IF;
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I, ADD CONSTRAINT %I %s', c.rel, c.conname, c.conname, v_new);
  END LOOP;

  v_def := pg_get_functiondef('public.claim_notification_emails(timestamptz, timestamptz, int)'::regprocedure);
  SELECT count(*) INTO v_n FROM regexp_matches(v_def, '''event_(invited|updated|cancelled)''', 'g');
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'agenda rollback: claim_notification_emails has % agenda literals, expected 3', v_n;
  END IF;
  v_new := regexp_replace(v_def, ',\s*''event_(invited|updated|cancelled)''', '', 'g');
  IF v_new ~ 'event_(invited|updated|cancelled|rsvp|reminder)' THEN
    RAISE EXCEPTION 'agenda rollback: claim_notification_emails still lists an agenda type after the edit';
  END IF;
  -- CREATE OR REPLACE keeps the existing grants (service_role only)
  EXECUTE v_new;
END $$;

-- ---- 4. drop the agenda objects (functions first: several take agenda_eventos rows) ----
DROP FUNCTION IF EXISTS
  public.agenda_tick_lembretes(timestamptz, boolean),
  public.agenda_claim_emails_lembrete(int),
  public.agenda_marcar_email_lembrete(bigint, uuid, int, timestamptz, boolean),
  public.agenda_responder(bigint, text, text),
  public.agenda_evento_excluir(bigint, text),
  public.agenda_evento_editar(bigint, text, jsonb, uuid[]),
  public.agenda_definir_participantes(bigint, uuid, uuid, uuid[]),
  public.agenda_pode_editar(public.agenda_eventos, uuid, uuid),
  public.agenda_listar(timestamptz, timestamptz, bigint),
  public.agenda_evento_criar(jsonb, uuid[]),
  public.agenda_validar_payload(uuid, jsonb, public.agenda_eventos),
  public.agenda_notificar(uuid, bigint, bigint, text, uuid[], uuid, jsonb),
  public.agenda_gerar_horizonte(),
  public.agenda_regenerar(bigint, boolean),
  public.agenda_materializar(bigint, date),
  public.agenda_inicio_fim(public.agenda_eventos, date),
  public.agenda_normalizar_dtstart(public.agenda_eventos),
  public.agenda_datas_regra(public.agenda_eventos, date, date);

-- children first; each table drop also removes its policies, indexes and triggers
DROP TABLE IF EXISTS public.agenda_lembretes;
DROP TABLE IF EXISTS public.agenda_respostas;
DROP TABLE IF EXISTS public.agenda_participantes;
DROP TABLE IF EXISTS public.agenda_ocorrencias;
DROP TABLE IF EXISTS public.agenda_eventos;

-- referenced by the dropped RLS policy and trigger only
DROP FUNCTION IF EXISTS
  public.agenda_pode_ver_evento(bigint, boolean, uuid),
  public.agenda_eventos_guard(),
  public.agenda_hoje(text);
