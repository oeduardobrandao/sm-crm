-- =====================================================================
-- 20260811000003_storage_autoclean_notification.sql
-- Notificação in-app do relatório da auto-limpeza de armazenamento.
-- =====================================================================

-- Lista copiada da definição MAIS RECENTE (20260807000003), acrescida de
-- 'storage_autoclean_report'. Este arquivo passa a ser a definição mais
-- recente; a próxima migration a tocar notifications_type_check deve copiar
-- daqui.
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
    'post_publish_failed',
    'storage_autoclean_report'
  )
);
