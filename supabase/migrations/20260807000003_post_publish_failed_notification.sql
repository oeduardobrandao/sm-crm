-- =====================================================================
-- 20260807000003_post_publish_failed_notification.sql
-- Notificação in-app quando a falha de publicação exige ação humana.
-- =====================================================================

-- ---------- notifications: add 'post_publish_failed' ao type CHECK ----
-- Lista copiada da definição MAIS RECENTE (20260805000002_post_status_automations.sql).
-- Este arquivo passa a ser a definição mais recente; a próxima migration a
-- tocar notifications_type_check deve copiar daqui.
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
    'post_publish_failed'
  )
);

-- ---------- Trigger -----------------------------------------------------
-- Observa status E publish_retry_count: nas falhas repetidas do auto-retry o
-- status permanece 'falha_publicacao' (só o contador sobe), então um trigger
-- apenas de transição de status jamais dispararia no esgotamento dos retries.
-- Anti-spam:
--   (a) transição para falha com código não-retryable -> notifica já (o cron
--       não vai resolver; a fase retry pula esses códigos, então a transição
--       ocorre uma única vez por ciclo);
--   (b) contador cruzando 3 -> auto-retries esgotados (cruza uma única vez;
--       o "Tentar novamente" manual zera o contador e permite novo ciclo);
--   (c) publish_error_code reclassificado para não-retryable enquanto o post
--       já está em falha (ex.: 1ª tentativa IG_TRANSIENT, retry seguinte
--       MEDIA_UNSUPPORTED) -> sem essa condição o status não muda, o contador
--       fica < 3, nenhuma notificação dispara e o claim do retry (20260807000002)
--       passa a pular o post para sempre, deixando a ação humana necessária
--       invisível.
-- Padrão trg_notify_*: SECURITY DEFINER + EXCEPTION WHEN OTHERS para nunca
-- reverter a operação de negócio.
CREATE OR REPLACE FUNCTION trg_notify_post_publish_failed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_client_name text;
  v_targets     uuid[];
  v_notify      boolean := false;
BEGIN
  BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status
       AND NEW.publish_error_code IN
         ('TOKEN_EXPIRED','MEDIA_TOO_LARGE','CAROUSEL_LIMIT','NO_MEDIA','MEDIA_UNSUPPORTED') THEN
      v_notify := true;
    ELSIF COALESCE(OLD.publish_retry_count, 0) < 3
       AND COALESCE(NEW.publish_retry_count, 0) >= 3 THEN
      v_notify := true;
    ELSIF OLD.publish_error_code IS DISTINCT FROM NEW.publish_error_code
       AND NEW.publish_error_code IN
         ('TOKEN_EXPIRED','MEDIA_TOO_LARGE','CAROUSEL_LIMIT','NO_MEDIA','MEDIA_UNSUPPORTED') THEN
      v_notify := true;
    END IF;

    IF v_notify THEN
      SELECT c.nome INTO v_client_name
        FROM workflows w
        JOIN clientes c ON c.id = w.cliente_id
       WHERE w.id = NEW.workflow_id;

      v_targets := resolve_notification_targets(NEW.conta_id, NEW.responsavel_id, ARRAY['owner','admin']);

      PERFORM insert_notification_batch(
        NEW.conta_id,
        v_targets,
        'post_publish_failed',
        '/entregas?drawer=' || NEW.workflow_id || '&post=' || NEW.id,
        jsonb_build_object(
          'post_id',            NEW.id,
          'workflow_id',        NEW.workflow_id,
          'post_title',         NEW.titulo,
          'client_name',        v_client_name,
          'publish_error_code', NEW.publish_error_code
        ),
        NULL
      );
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'trg_notify_post_publish_failed failed: % %', SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notify_post_publish_failed ON workflow_posts;
CREATE TRIGGER notify_post_publish_failed
  AFTER UPDATE OF status, publish_retry_count, publish_error_code ON workflow_posts
  FOR EACH ROW
  WHEN (NEW.status = 'falha_publicacao')
  EXECUTE FUNCTION trg_notify_post_publish_failed();
