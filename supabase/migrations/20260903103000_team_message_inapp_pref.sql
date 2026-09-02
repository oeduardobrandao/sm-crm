-- supabase/migrations/20260903103000_team_message_inapp_pref.sql
-- Fecha duas lacunas do fix-wave de revisao do chat de equipe (branch
-- claude/group-chats-team-c8f94a):
-- (a) notification_inapp_prefs_type_check (20260903000001) foi criada ANTES
--     de 'team_message' existir (20260903100000 e posterior). Sem esta
--     migration, tentar silenciar/preferir esse tipo (INSERT/UPDATE em
--     notification_inapp_prefs) falha com violacao de CHECK.
-- (b) trg_notify_team_message (20260903100000) gravava o preview cru --
--     tokens de mencao "@[Label](tipo:id)" vazavam pro card de notificacao
--     em vez de renderizar como "@Label". CREATE OR REPLACE troca o preview
--     por uma versao com os tokens ja substituidos, antes do left(...,280).
-- Spec: docs/superpowers/specs/2026-09-02-team-group-chats-design.md

-- ============ (a) notification_inapp_prefs_type_check +team_message =======
-- ATENCAO: lista copiada da definicao MAIS RECENTE no momento de escrever
-- (20260903000001_notification_center_phase1.sql, 22 valores + '__all__') e
-- apenas ACRESCENTA 'team_message'. Este arquivo passa a ser a definicao
-- mais recente: a proxima migration copia DAQUI.
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
    'team_message',
    '__all__'
  ));

-- ============ (b) preview sem tokens de mencao crus ========================
-- Mesma definicao de 20260903100000_equipe_chat_core.sql (mesmo DECLARE,
-- mesmo BEGIN/EXCEPTION, mesmo INSERT/ON CONFLICT) -- so o campo 'preview'
-- muda: regexp_replace troca "@[Label](tipo:id)" por "@Label" antes do
-- left(...,280). Mesma forma de token que MENTION_TOKEN_RE no frontend
-- (apps/crm/src/components/mentions/mentionTokens.ts), com o terceiro grupo
-- (id do post/workflow) simplificado para [0-9:]+ -- o preview so precisa
-- remover o token, nao precisa capturar/validar cada segmento.
CREATE OR REPLACE FUNCTION trg_notify_team_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conversa_nome text;
  v_author_name   text;
BEGIN
  BEGIN
    SELECT ec.nome INTO v_conversa_nome
      FROM equipe_conversas ec WHERE ec.id = NEW.conversa_id;

    SELECT COALESCE(mb.nome, p.nome, 'Equipe') INTO v_author_name
      FROM auth.users u
      LEFT JOIN membros mb ON mb.crm_user_id = NEW.author_user_id
                          AND mb.conta_id = NEW.conta_id
      LEFT JOIN profiles p ON p.id = NEW.author_user_id
     WHERE u.id = NEW.author_user_id;

    INSERT INTO notifications (workspace_id, user_id, type, metadata, link)
    SELECT NEW.conta_id,
           pt.user_id,
           'team_message',
           jsonb_build_object(
             'conversa_id',   NEW.conversa_id::text,
             'conversa_nome', v_conversa_nome,
             'author_name',   v_author_name,
             'preview',       left(
               regexp_replace(
                 NEW.content,
                 '@\[([^\]]+)\]\((membro|post|cliente|tarefa):[0-9:]+\)',
                 '@\1',
                 'g'
               ),
               280
             )
           ),
           '/mensagens/equipe/' || NEW.conversa_id
      FROM equipe_conversa_participantes pt
     WHERE pt.conversa_id = NEW.conversa_id
       AND pt.user_id <> NEW.author_user_id
    ON CONFLICT (user_id, ((metadata->>'conversa_id')))
      WHERE type = 'team_message' AND read_at IS NULL AND dismissed_at IS NULL
      DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_notify_team_message failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$;
