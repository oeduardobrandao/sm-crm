-- Agenda (sub-projeto 1): rollback runbook.
-- Não aplicar por migration. Rodar à mão só depois de reverter o PR do frontend.
--
-- Spec: docs/superpowers/specs/2026-10-05-agenda-eventos-core-design.md ("Rollout").
-- Migrations undone: 20261005000001_agenda_eventos.sql (A) and
-- 20261005000002_agenda_lembretes.sql (B), including A's plans.feature_agenda
-- column (step 5). Also undoes sub-projeto 2's 20261006000001_agenda_feed.sql
-- (step 4a); undeploy the agenda-feed edge function before running it. And
-- sub-projeto 3's 20261007000001_agenda_hub.sql (step 4b, which also documents
-- the Hub-only partial rollback); undeploy hub-agenda and agenda-cliente-email
-- before running it.
--
-- Before step 5 runs in a real environment, "feature_agenda" must already be gone
-- from FEATURE_COLUMNS (supabase/functions/_shared/entitlements.ts) and
-- workspace-limits + platform-admin redeployed: platform-admin's plan mutations
-- write every FEATURE_COLUMNS column, so a deployed copy that still lists it
-- fails on the dropped column.
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
-- block reads the CURRENT definitions, removes only the seven agenda literals
-- (five from sub-projeto 1, event_client_rsvp and event_reschedule_requested
-- from sub-projeto 3), and fails if any of them is not found exactly where
-- expected. Restoring the
-- CHECKs is optional in a partial rollback: the extra types are harmless.

-- ---- 1. stop the jobs ----
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'agenda-lembretes') THEN PERFORM cron.unschedule('agenda-lembretes'); END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'agenda-horizonte') THEN PERFORM cron.unschedule('agenda-horizonte'); END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'agenda-cliente-email') THEN PERFORM cron.unschedule('agenda-cliente-email'); END IF;
END $$;

-- ---- 2. rows that would violate the narrowed CHECKs ----
DELETE FROM public.notifications
 WHERE type IN ('event_invited','event_updated','event_cancelled','event_rsvp','event_reminder',
                'event_client_rsvp','event_reschedule_requested');
DELETE FROM public.notification_inapp_prefs
 WHERE type IN ('event_invited','event_updated','event_cancelled','event_rsvp','event_reminder',
                'event_client_rsvp','event_reschedule_requested');
DELETE FROM public.notification_email_prefs
 WHERE type IN ('event_invited','event_updated','event_cancelled','event_rsvp','event_reminder',
                'event_client_rsvp','event_reschedule_requested');

-- ---- 3. remove the seven literals from the current CHECKs and the digest claim ----
DO $$
DECLARE
  c record;
  v_def text;
  v_new text;
  v_n int;
BEGIN
  FOR c IN
    SELECT * FROM (VALUES
      ('public.notifications'::regclass, 'notifications_type_check', 7),
      ('public.notification_inapp_prefs'::regclass, 'notification_inapp_prefs_type_check', 7),
      ('public.notification_email_prefs'::regclass, 'notification_email_prefs_type_check', 6)
    ) AS t(rel, conname, esperado)
  LOOP
    SELECT pg_get_constraintdef(pc.oid) INTO v_def
      FROM pg_constraint pc WHERE pc.conrelid = c.rel AND pc.conname = c.conname;
    IF v_def IS NULL THEN
      RAISE EXCEPTION 'agenda rollback: constraint % not found', c.conname;
    END IF;
    SELECT count(*) INTO v_n
      FROM regexp_matches(v_def, '''event_(invited|updated|cancelled|rsvp|reminder|client_rsvp|reschedule_requested)''::text', 'g');
    IF v_n <> c.esperado THEN
      RAISE EXCEPTION 'agenda rollback: % has % agenda literals, expected %', c.conname, v_n, c.esperado;
    END IF;
    v_new := regexp_replace(v_def, ',\s*''event_(invited|updated|cancelled|rsvp|reminder|client_rsvp|reschedule_requested)''::text', '', 'g');
    IF v_new ~ 'event_(invited|updated|cancelled|rsvp|reminder|client_rsvp|reschedule_requested)' THEN
      RAISE EXCEPTION 'agenda rollback: % still lists an agenda type after the edit', c.conname;
    END IF;
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I, ADD CONSTRAINT %I %s', c.rel, c.conname, c.conname, v_new);
  END LOOP;

  v_def := pg_get_functiondef('public.claim_notification_emails(timestamptz, timestamptz, int)'::regprocedure);
  SELECT count(*) INTO v_n FROM regexp_matches(v_def, '''event_(invited|updated|cancelled|client_rsvp|reschedule_requested)''', 'g');
  IF v_n <> 5 THEN
    RAISE EXCEPTION 'agenda rollback: claim_notification_emails has % agenda literals, expected 5', v_n;
  END IF;
  v_new := regexp_replace(v_def, ',\s*''event_(invited|updated|cancelled|client_rsvp|reschedule_requested)''', '', 'g');
  IF v_new ~ 'event_(invited|updated|cancelled|rsvp|reminder|client_rsvp|reschedule_requested)' THEN
    RAISE EXCEPTION 'agenda rollback: claim_notification_emails still lists an agenda type after the edit';
  END IF;
  -- CREATE OR REPLACE keeps the existing grants (service_role only)
  EXECUTE v_new;
END $$;

-- ---- 4a. sub-projeto 2: personal iCal feed (20261006000001_agenda_feed.sql) ----
-- Feed only (partial rollback): first revert the CRM UI (or turn feature_agenda
-- off), since the merged CRM calls these RPCs; then undeploy the agenda-feed
-- edge function, run just this step and stop. IF EXISTS keeps the full rollback valid in an
-- environment that never received the feed migration.
DROP FUNCTION IF EXISTS
  public.agenda_feed_eventos(text),
  public.agenda_feed_desativar(),
  public.agenda_feed_gerar(),
  public.agenda_feed_obter(),
  public.agenda_feed_contexto();
DROP TABLE IF EXISTS public.agenda_feed_tokens;

-- ---- 4b. sub-projeto 3: Agenda in the Hub (20261007000001_agenda_hub.sql) ----
-- Hub only (partial rollback): first revert the frontend PR (CRM share switch
-- and Hub Agenda page), undeploy hub-agenda and agenda-cliente-email, and
-- redeploy the previous hub-bootstrap, client-event-email-cron, agenda-feed and
-- notification-email-cron (they read the objects removed here); then run just
-- this step and stop. Those four redeploys are hygiene, not a gate: each one
-- degrades cleanly without these objects (reminders fetch falls back to [],
-- sequencia is optional, the bootstrap flag lookup catches, the digest cases
-- go dead), so never hold a rollback on them. Only 4b.1 and the drops matter. In the full rollback it runs after steps 2-3 already
-- removed every agenda notification type, so its literal edit finds nothing
-- to remove and skips; and after 4a dropped agenda_feed_eventos, so the
-- feed restore is skipped too.
--
-- 4b.1 stop the queue cron
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'agenda-cliente-email') THEN PERFORM cron.unschedule('agenda-cliente-email'); END IF;
END $$;

-- 4b.2 the pre-migration definitions of every replaced function, pasted (not
-- referenced) from 20261005000001_agenda_eventos.sql and
-- 20261006000001_agenda_feed.sql, so the rollback never depends on re-applying
-- migrations. They reference none of the objects dropped below.
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
  IF NOT public.effective_plan_feature(v_conta, 'feature_agenda') THEN
    RAISE EXCEPTION 'feature_disabled:feature_agenda' USING ERRCODE = 'P0001';
  END IF;
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
  IF NOT public.effective_plan_feature(v_conta, 'feature_agenda') THEN
    RAISE EXCEPTION 'feature_disabled:feature_agenda' USING ERRCODE = 'P0001';
  END IF;
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
      -- Moving a recurring series to another day needs an explicit regra (the
      -- form always sends one): a stored rule cannot follow a shifted date in
      -- general (biweekly sets crossing a week boundary, monthly ordinals,
      -- ate). The UI sends date-changing drags of a recurring event as esta,
      -- so this is a backstop. A same-day time change (delta 0) keeps working.
      IF v_e.freq IS NOT NULL AND NOT (p_evento ? 'regra') AND v_delta <> 0 THEN
        RAISE EXCEPTION 'agenda: para mudar o dia da repetição, edite o evento';
      END IF;
      IF v_escopo = 'todas' THEN
        v_novo.dtstart := (v_e.dtstart::date + v_delta) + v_novo.dtstart::time;
      ELSE
        v_novo.dtstart := (v_c + v_delta) + v_novo.dtstart::time;
      END IF;
    ELSIF v_escopo = 'seguintes' THEN
      v_novo.dtstart := v_c + v_e.dtstart::time;
    END IF;

    IF v_escopo = 'seguintes' THEN
      -- contagem of the new series: a payload contagem equal to the stored one
      -- (or no regra at all, a same-day drag) means "the end was not touched", whatever
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
  IF NOT public.effective_plan_feature(v_conta, 'feature_agenda') THEN
    RAISE EXCEPTION 'feature_disabled:feature_agenda' USING ERRCODE = 'P0001';
  END IF;
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

-- agenda_listar: the return type changed, so DROP + CREATE the old shape (grants re-stated below it).
DROP FUNCTION IF EXISTS public.agenda_listar(timestamptz, timestamptz, bigint);
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
CREATE FUNCTION public.agenda_listar(p_de timestamptz DEFAULT NULL, p_ate timestamptz DEFAULT NULL, p_ocorrencia_id bigint DEFAULT NULL)
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
  -- flag off: no rows, no raise (stale clients and prefetches stay quiet)
  IF NOT public.effective_plan_feature(v_conta, 'feature_agenda') THEN RETURN; END IF;
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

-- agenda_feed_eventos without "sequencia", only when it still exists (step 4a
-- of a full rollback dropped it already).
DO $rb$
BEGIN
  IF to_regprocedure('public.agenda_feed_eventos(text)') IS NULL THEN RETURN; END IF;
  EXECUTE $def$
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
  $def$;
  REVOKE ALL ON FUNCTION public.agenda_feed_eventos(text) FROM PUBLIC, anon, authenticated;
  GRANT EXECUTE ON FUNCTION public.agenda_feed_eventos(text) TO service_role;
END $rb$;

-- 4b.3 the new functions
DROP FUNCTION IF EXISTS
  public.agenda_cliente_lembretes_marcar(uuid, bigint, jsonb),
  public.agenda_cliente_lembretes_pendentes(uuid, bigint, timestamptz),
  public.agenda_cliente_tick(),
  public.agenda_cliente_marcar_email(bigint, int, boolean, text),
  public.agenda_cliente_liberar_emails(bigint[]),
  public.agenda_cliente_claim_emails(int),
  public.agenda_remarcacao_resolver(bigint, boolean, text),
  public.agenda_hub_cancelar_remarcacao(uuid, bigint, bigint),
  public.agenda_hub_remarcar(uuid, bigint, bigint, date, time, text),
  public.agenda_hub_responder(uuid, bigint, bigint, text, timestamptz),
  public.agenda_hub_ocorrencia(uuid, bigint, bigint),
  public.agenda_hub_listar(uuid, bigint, timestamptz, bigint, int),
  public.agenda_hub_item(uuid, bigint, bigint),
  public.agenda_hub_cliente(uuid, bigint),
  public.agenda_cliente_destinatarios(uuid, uuid),
  public.agenda_cliente_substituir_pedidos(bigint, bigint, date),
  public.agenda_cliente_enfileirar(uuid, bigint, bigint, text, jsonb, jsonb),
  public.agenda_cliente_entrada_igual(jsonb, jsonb),
  public.agenda_cliente_diff(jsonb, jsonb),
  public.agenda_cliente_ocorrencias_snapshot(bigint, text, bigint, date);

-- 4b.4 the two client notification types: rows first (in notifications and
-- in both preference tables), then the literals out of the current CHECKs and
-- the digest claim. Read from the CURRENT definitions, like step 3: each
-- CHECK must list both literals (or neither, after step 3 of a full
-- rollback); anything else raises.
DELETE FROM public.notifications WHERE type IN ('event_client_rsvp','event_reschedule_requested');
DELETE FROM public.notification_inapp_prefs WHERE type IN ('event_client_rsvp','event_reschedule_requested');
DELETE FROM public.notification_email_prefs WHERE type IN ('event_client_rsvp','event_reschedule_requested');
DO $$
DECLARE
  c record;
  v_def text;
  v_new text;
  v_n int;
BEGIN
  FOR c IN
    SELECT * FROM (VALUES
      ('public.notifications'::regclass, 'notifications_type_check'),
      ('public.notification_inapp_prefs'::regclass, 'notification_inapp_prefs_type_check'),
      ('public.notification_email_prefs'::regclass, 'notification_email_prefs_type_check')
    ) AS t(rel, conname)
  LOOP
    SELECT pg_get_constraintdef(pc.oid) INTO v_def
      FROM pg_constraint pc WHERE pc.conrelid = c.rel AND pc.conname = c.conname;
    IF v_def IS NULL THEN
      RAISE EXCEPTION 'agenda hub rollback: constraint % not found', c.conname;
    END IF;
    SELECT count(*) INTO v_n
      FROM regexp_matches(v_def, '''event_(client_rsvp|reschedule_requested)''::text', 'g');
    IF v_n = 0 THEN CONTINUE; END IF;
    IF v_n <> 2 THEN
      RAISE EXCEPTION 'agenda hub rollback: % has % client literals, expected 2', c.conname, v_n;
    END IF;
    v_new := regexp_replace(v_def, ',\s*''event_(client_rsvp|reschedule_requested)''::text', '', 'g');
    IF v_new ~ 'event_(client_rsvp|reschedule_requested)' THEN
      RAISE EXCEPTION 'agenda hub rollback: % still lists a client type after the edit', c.conname;
    END IF;
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I, ADD CONSTRAINT %I %s', c.rel, c.conname, c.conname, v_new);
  END LOOP;

  v_def := pg_get_functiondef('public.claim_notification_emails(timestamptz, timestamptz, int)'::regprocedure);
  SELECT count(*) INTO v_n FROM regexp_matches(v_def, '''event_(client_rsvp|reschedule_requested)''', 'g');
  IF v_n = 2 THEN
    v_new := regexp_replace(v_def, ',\s*''event_(client_rsvp|reschedule_requested)''', '', 'g');
    IF v_new ~ 'event_(client_rsvp|reschedule_requested)' THEN
      RAISE EXCEPTION 'agenda hub rollback: claim_notification_emails still lists a client type after the edit';
    END IF;
    -- CREATE OR REPLACE keeps the existing grants (service_role only)
    EXECUTE v_new;
  ELSIF v_n <> 0 THEN
    RAISE EXCEPTION 'agenda hub rollback: claim_notification_emails has % client literals, expected 2', v_n;
  END IF;
END $$;

-- 4b.5 the new tables, then the two columns (and the CHECK on the first)
DROP TABLE IF EXISTS public.agenda_emails_cliente;
DROP TABLE IF EXISTS public.agenda_remarcacoes;
DROP TABLE IF EXISTS public.agenda_respostas_cliente;
ALTER TABLE public.agenda_eventos DROP CONSTRAINT IF EXISTS agenda_eventos_compartilhado_ck;
ALTER TABLE public.agenda_eventos DROP COLUMN IF EXISTS compartilhado_cliente;
ALTER TABLE public.agenda_ocorrencias DROP COLUMN IF EXISTS sequencia;

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

-- ---- 5. the rollout flag (see the header: edge functions first) ----
UPDATE public.workspace_plan_overrides
   SET feature_overrides = feature_overrides - 'feature_agenda'
 WHERE feature_overrides ? 'feature_agenda';
ALTER TABLE public.plans DROP COLUMN IF EXISTS feature_agenda;
