-- Linha editorial: Hub decision/comment RPCs and the two notification types
-- (spec docs/superpowers/specs/2026-10-26-linha-editorial-design.md, sections 5.2 and 6.5).
--
-- record_linha_decision / record_linha_comment are called only by the edge function
-- hub-linha-editorial with the service-role key. p_conta_id and p_cliente_id always come from
-- resolveHubToken(), never from the request body, and BOTH scope the linha lookup, so a valid
-- token of client A can never act on client B's linha, even in the same conta and with a
-- guessed id. Errors are P0001 with the bare messages the function maps:
-- feature_disabled:feature_linha_editorial (403), nao_encontrada (404), status_invalido (409),
-- comentario_obrigatorio (422); acao_invalida is a caller bug.
--
-- create_linha_notification runs AFTER the decision commits (the edge function calls it
-- separately, as hub-approve does), so a notification failure never rolls back the client's
-- decision. Comments notify nobody: the decision carries the count.
--
-- A "client comment" counted for ajustes and for metadata.comentarios is a resposta of the
-- linha's current rodada with is_workspace_user = false and a non-blank comentario (the
-- decision row's own comment included).

SET LOCAL lock_timeout = '5s';

-- ============ (1) NOTIFICATION TYPES ============
-- ATENCAO: lists copied verbatim from the latest definitions at the time of writing
-- (notifications_type_check and notification_inapp_prefs_type_check:
-- 20261025000002_post_discussao_participantes.sql; notification_email_prefs_type_check and
-- claim_notification_emails: 20261008000002_agenda_convidados.sql), only APPENDING
-- 'linha_editorial_aprovada' and 'linha_editorial_ajustes'. This file is now the latest
-- definition: the next migration copies FROM HERE.
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check CHECK (
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
    'event_invited', 'event_updated', 'event_cancelled', 'event_rsvp', 'event_reminder',
    'event_client_rsvp', 'event_reschedule_requested', 'event_guest_rsvp',
    'post_client_reference',
    'team_message',
    'post_discussion',
    'linha_editorial_aprovada', 'linha_editorial_ajustes'
  )
);

alter table notification_inapp_prefs
  drop constraint notification_inapp_prefs_type_check;
alter table notification_inapp_prefs
  add constraint notification_inapp_prefs_type_check check (type in (
    'post_approved','post_correction','post_message','post_edit_suggestion',
    'idea_submitted','briefing_answered','step_activated','step_completed',
    'post_assigned','task_assigned','workflow_completed','deadline_approaching',
    'invite_accepted','member_role_changed','member_removed','client_message',
    'mention','post_status_automation','instagram_connected_by_client',
    'post_publish_failed','storage_autoclean_report','instagram_automation_failed',
    'event_invited','event_updated','event_cancelled','event_rsvp','event_reminder',
    'event_client_rsvp','event_reschedule_requested','event_guest_rsvp',
    'post_client_reference',
    'team_message',
    'post_discussion',
    'linha_editorial_aprovada','linha_editorial_ajustes',
    '__all__'
  ));

ALTER TABLE public.notification_email_prefs DROP CONSTRAINT notification_email_prefs_type_check;
ALTER TABLE public.notification_email_prefs ADD CONSTRAINT notification_email_prefs_type_check CHECK (type IN (
  'post_approved','post_publish_failed','post_correction','post_message',
  'client_message','deadline_approaching','task_assigned','post_assigned',
  'mention',
  'event_invited','event_updated','event_cancelled','event_reminder',
  'event_client_rsvp','event_reschedule_requested','event_guest_rsvp',
  'linha_editorial_aprovada','linha_editorial_ajustes',
  '__all__'
));

-- Body copied verbatim from 20261008000002_agenda_convidados.sql; the only change is
-- linha_editorial_aprovada and linha_editorial_ajustes appended to the array (team digest).
-- Without them the digest silently skips the two types.
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
       'event_invited','event_updated','event_cancelled',
       'event_client_rsvp','event_reschedule_requested','event_guest_rsvp',
       'linha_editorial_aprovada','linha_editorial_ajustes'
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

-- ============ (2) record_linha_decision ============
-- enviada -> aprovada | ajustes. Inserts the decision resposta (item_id null: the general
-- comment travels on it; rodada stamped by linha_resposta_guard) and sets decidida_at.
-- ajustes needs a comment unless the rodada already has client comments.
-- Returns {status, comentarios}.
CREATE OR REPLACE FUNCTION public.record_linha_decision(
  p_linha_id   uuid,
  p_conta_id   uuid,
  p_cliente_id bigint,
  p_token      text,
  p_acao       text,
  p_comentario text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status     text;
  v_rodada     integer;
  v_comentario text := nullif(btrim(p_comentario), '');
  v_novo       text;
  v_total      integer;
BEGIN
  IF p_conta_id IS NULL OR NOT public.effective_plan_feature(p_conta_id, 'feature_linha_editorial') THEN
    RAISE EXCEPTION 'feature_disabled:feature_linha_editorial' USING ERRCODE = 'P0001';
  END IF;
  IF p_acao IS NULL OR p_acao NOT IN ('aprovado', 'ajustes') THEN
    RAISE EXCEPTION 'acao_invalida' USING ERRCODE = 'P0001';
  END IF;

  SELECT l.status, l.rodada INTO v_status, v_rodada
    FROM public.linhas_editoriais l
   WHERE l.id = p_linha_id AND l.conta_id = p_conta_id AND l.cliente_id = p_cliente_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'nao_encontrada' USING ERRCODE = 'P0001';
  END IF;
  IF v_status <> 'enviada' THEN
    RAISE EXCEPTION 'status_invalido' USING ERRCODE = 'P0001';
  END IF;

  IF p_acao = 'ajustes' AND v_comentario IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.linha_editorial_respostas r
                      WHERE r.linha_id = p_linha_id AND r.rodada = v_rodada
                        AND NOT r.is_workspace_user AND nullif(btrim(r.comentario), '') IS NOT NULL) THEN
    RAISE EXCEPTION 'comentario_obrigatorio' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.linha_editorial_respostas
    (conta_id, linha_id, item_id, acao, comentario, is_workspace_user, author_user_id, token)
  VALUES (p_conta_id, p_linha_id, NULL, p_acao, v_comentario, false, NULL, p_token);

  v_novo := CASE p_acao WHEN 'aprovado' THEN 'aprovada' ELSE 'ajustes' END;
  UPDATE public.linhas_editoriais SET status = v_novo, decidida_at = now() WHERE id = p_linha_id;

  SELECT count(*) INTO v_total FROM public.linha_editorial_respostas r
   WHERE r.linha_id = p_linha_id AND r.rodada = v_rodada
     AND NOT r.is_workspace_user AND nullif(btrim(r.comentario), '') IS NOT NULL;

  RETURN jsonb_build_object('status', v_novo, 'comentarios', v_total);
END;
$$;

-- ============ (3) record_linha_comment ============
-- A client comment on the whole linha (p_item_id null) or on one of its items, while enviada.
CREATE OR REPLACE FUNCTION public.record_linha_comment(
  p_linha_id   uuid,
  p_item_id    uuid,
  p_conta_id   uuid,
  p_cliente_id bigint,
  p_token      text,
  p_comentario text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status     text;
  v_comentario text := nullif(btrim(p_comentario), '');
  v_id         uuid;
BEGIN
  IF p_conta_id IS NULL OR NOT public.effective_plan_feature(p_conta_id, 'feature_linha_editorial') THEN
    RAISE EXCEPTION 'feature_disabled:feature_linha_editorial' USING ERRCODE = 'P0001';
  END IF;

  -- FOR SHARE: comments run in parallel, but wait for a decision in flight.
  SELECT l.status INTO v_status
    FROM public.linhas_editoriais l
   WHERE l.id = p_linha_id AND l.conta_id = p_conta_id AND l.cliente_id = p_cliente_id
   FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'nao_encontrada' USING ERRCODE = 'P0001';
  END IF;
  IF p_item_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.linha_editorial_itens i WHERE i.id = p_item_id AND i.linha_id = p_linha_id) THEN
    RAISE EXCEPTION 'nao_encontrada' USING ERRCODE = 'P0001';
  END IF;
  IF v_status <> 'enviada' THEN
    RAISE EXCEPTION 'status_invalido' USING ERRCODE = 'P0001';
  END IF;
  IF v_comentario IS NULL THEN
    RAISE EXCEPTION 'comentario_obrigatorio' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.linha_editorial_respostas
    (conta_id, linha_id, item_id, acao, comentario, is_workspace_user, author_user_id, token)
  VALUES (p_conta_id, p_linha_id, p_item_id, 'comentario', v_comentario, false, NULL, p_token)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ============ (4) create_linha_notification ============
-- Owners and admins, plus whoever sent the linha while still a member of the conta, once
-- each (insert_notification_batch does not dedupe). resolve_notification_targets' second
-- argument is a membros.id, not a user id, so it gets NULL. An unknown acao or linha
-- notifies nobody.
CREATE OR REPLACE FUNCTION public.create_linha_notification(p_linha_id uuid, p_acao text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type    text;
  v_l       public.linhas_editoriais;
  v_nome    text;
  v_targets uuid[];
  v_total   integer;
BEGIN
  v_type := CASE p_acao
    WHEN 'aprovado' THEN 'linha_editorial_aprovada'
    WHEN 'ajustes'  THEN 'linha_editorial_ajustes'
    ELSE NULL
  END;
  IF v_type IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_l FROM public.linhas_editoriais WHERE id = p_linha_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  SELECT c.nome INTO v_nome FROM public.clientes c WHERE c.id = v_l.cliente_id;

  SELECT coalesce(array_agg(DISTINCT u), '{}') INTO v_targets
    FROM (
      SELECT unnest(public.resolve_notification_targets(v_l.conta_id, NULL, ARRAY['owner', 'admin'])) AS u
      UNION
      SELECT wm.user_id FROM public.workspace_members wm
       WHERE wm.workspace_id = v_l.conta_id AND wm.user_id = v_l.enviada_por
    ) t
   WHERE u IS NOT NULL;

  SELECT count(*) INTO v_total FROM public.linha_editorial_respostas r
   WHERE r.linha_id = p_linha_id AND r.rodada = v_l.rodada
     AND NOT r.is_workspace_user AND nullif(btrim(r.comentario), '') IS NOT NULL;

  PERFORM public.insert_notification_batch(
    v_l.conta_id,
    v_targets,
    v_type,
    '/entregas?view=linha&clientes=' || v_l.cliente_id || '&mes=' || to_char(v_l.periodo, 'YYYY-MM'),
    jsonb_build_object(
      'linha_id',     v_l.id,
      'cliente_id',   v_l.cliente_id,
      'cliente_nome', v_nome,
      'periodo',      to_char(v_l.periodo, 'YYYY-MM-DD'),
      'comentarios',  v_total
    ),
    NULL
  );
END;
$$;

-- ============ (5) GRANTS: service_role only ============
-- Per 20260925000001_lockdown_definer_function_grants.sql: name every role, then re-grant
-- service_role (REVOKE FROM PUBLIC alone leaves hosted's per-role grants in place).
REVOKE ALL ON FUNCTION public.record_linha_decision(uuid, uuid, bigint, text, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_linha_comment(uuid, uuid, uuid, bigint, text, text) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_linha_notification(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_linha_decision(uuid, uuid, bigint, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_linha_comment(uuid, uuid, uuid, bigint, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_linha_notification(uuid, text) TO service_role;
