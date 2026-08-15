-- RPCs da automação de comentário -> DM. Todas SECURITY DEFINER, service_role only
-- (REVOKE FROM PUBLIC também tira o service_role: re-conceder explicitamente,
-- gotcha documentado em 20260806000002).

-- Claim atômico do envio. Advisory lock transacional sobre (automation, commenter):
-- dois comentários SIMULTÂNEOS do mesmo usuário têm comment_id distintos e o
-- UNIQUE sozinho não os serializa; o lock força o segundo a esperar o commit do
-- primeiro e aí o cooldown (revalidado NA MESMA transação) o pega.
CREATE OR REPLACE FUNCTION claim_automation_send(
  p_comment_id text,
  p_automation_id uuid,
  p_conta_id uuid,
  p_media_id text,
  p_commenter_id text,
  p_commenter_username text,
  p_comment_text text,
  p_comment_created_at timestamptz,
  p_cooldown_hours int DEFAULT 24
) RETURNS TABLE (send_id uuid, outcome text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtext('instagram_automation_sends'),
    hashtext(p_automation_id::text || ':' || coalesce(p_commenter_id, ''))
  );

  -- Um envio em voo (processing/retry) reserva o cooldown; se ele falhar no fim,
  -- perdemos um DM do segundo comentário, o que é preferível a DM duplicada.
  IF p_commenter_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM instagram_automation_sends s
    WHERE s.automation_id = p_automation_id
      AND s.commenter_id = p_commenter_id
      AND s.comment_id <> p_comment_id
      AND (s.dm_status = 'sent' OR s.status IN ('processing', 'retry'))
      AND s.created_at > now() - make_interval(hours => p_cooldown_hours)
  ) THEN
    INSERT INTO instagram_automation_sends
      (comment_id, automation_id, conta_id, media_id, commenter_id,
       commenter_username, comment_text, comment_created_at, status, skip_reason)
    VALUES
      (p_comment_id, p_automation_id, p_conta_id, p_media_id, p_commenter_id,
       p_commenter_username, p_comment_text, p_comment_created_at, 'skipped', 'cooldown')
    ON CONFLICT (comment_id) DO NOTHING;
    RETURN QUERY SELECT NULL::uuid, 'cooldown'::text;
    RETURN;
  END IF;

  INSERT INTO instagram_automation_sends
    (comment_id, automation_id, conta_id, media_id, commenter_id,
     commenter_username, comment_text, comment_created_at, status, processing_at)
  VALUES
    (p_comment_id, p_automation_id, p_conta_id, p_media_id, p_commenter_id,
     p_commenter_username, p_comment_text, p_comment_created_at, 'processing', now())
  ON CONFLICT (comment_id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, 'duplicate'::text;
  ELSE
    RETURN QUERY SELECT v_id, 'claimed'::text;
  END IF;
END $$;

REVOKE ALL ON FUNCTION claim_automation_send(text, uuid, uuid, text, text, text, text, timestamptz, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_automation_send(text, uuid, uuid, text, text, text, text, timestamptz, int) TO service_role;

-- Claim do cron sobre ENVIOS retryable (não sobre eventos): retry vencido ou
-- processing órfão (janela de 10 min, padrão claim_posts_for_publishing).
-- O join EXIGE conta apta: backlog de conta que perdeu permissão/assinatura
-- não é claimado aqui; fail_ineligible_automation_sends o encerra.
CREATE OR REPLACE FUNCTION claim_retryable_automation_sends(p_limit int DEFAULT 25)
RETURNS TABLE (
  send_id uuid,
  comment_id text,
  automation_id uuid,
  conta_id uuid,
  media_id text,
  commenter_id text,
  comment_created_at timestamptz,
  dm_status text,
  public_reply_status text,
  attempts int,
  encrypted_access_token text,
  instagram_user_id text
) LANGUAGE sql SECURITY DEFINER AS $$
  WITH claimed AS (
    SELECT s.id
    FROM instagram_automation_sends s
    JOIN instagram_comment_automations a ON a.id = s.automation_id
    JOIN instagram_accounts ia ON ia.client_id = a.client_id
      AND ia.authorization_status = 'active'
      AND ia.comments_subscribed_at IS NOT NULL
      AND 'instagram_business_manage_comments' = ANY (ia.permissions)
    WHERE ((s.status = 'retry' AND s.next_attempt_at <= now())
        OR (s.status = 'processing' AND s.processing_at < now() - interval '10 minutes'))
      AND s.comment_created_at > now() - interval '7 days'
    FOR UPDATE OF s SKIP LOCKED
    LIMIT p_limit
  ),
  updated AS (
    UPDATE instagram_automation_sends
    SET status = 'processing', processing_at = now()
    WHERE id IN (SELECT id FROM claimed)
    RETURNING *
  )
  SELECT
    u.id, u.comment_id, u.automation_id, u.conta_id, u.media_id, u.commenter_id,
    u.comment_created_at, u.dm_status, u.public_reply_status, u.attempts,
    ia.encrypted_access_token, ia.instagram_user_id
  FROM updated u
  JOIN instagram_comment_automations a ON a.id = u.automation_id
  JOIN instagram_accounts ia ON ia.client_id = a.client_id;
$$;

REVOKE ALL ON FUNCTION claim_retryable_automation_sends(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_retryable_automation_sends(int) TO service_role;

-- Encerra envios que nunca mais serão elegíveis: janela de 7 dias vencida ou
-- conta que perdeu a aptidão (permissão/assinatura/status). Roda no cron antes
-- do claim.
CREATE OR REPLACE FUNCTION fail_ineligible_automation_sends()
RETURNS int LANGUAGE sql SECURITY DEFINER AS $$
  WITH failed AS (
    UPDATE instagram_automation_sends s
    SET status = 'failed',
        error_code = CASE
          WHEN s.comment_created_at <= now() - interval '7 days' THEN 'reply_window_expired'
          ELSE 'account_unauthorized'
        END
    WHERE ((s.status = 'retry' AND s.next_attempt_at <= now())
        OR (s.status = 'processing' AND s.processing_at < now() - interval '10 minutes'))
      AND (
        s.comment_created_at <= now() - interval '7 days'
        OR NOT EXISTS (
          SELECT 1
          FROM instagram_comment_automations a
          JOIN instagram_accounts ia ON ia.client_id = a.client_id
          WHERE a.id = s.automation_id
            AND ia.authorization_status = 'active'
            AND ia.comments_subscribed_at IS NOT NULL
            AND 'instagram_business_manage_comments' = ANY (ia.permissions)
        )
      )
    RETURNING 1
  )
  SELECT count(*)::int FROM failed;
$$;

REVOKE ALL ON FUNCTION fail_ineligible_automation_sends() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fail_ineligible_automation_sends() TO service_role;

-- Transição atômica dm_status -> 'sent' + contador. O incremento acontece
-- EXATAMENTE na transição (condicional, mesma transação): DM enviada conta
-- mesmo que a resposta pública falhe depois (sent_partial); crash não perde
-- nem duplica contador; retry/redelivery caem no IS DISTINCT FROM e não
-- incrementam de novo.
CREATE OR REPLACE FUNCTION mark_automation_dm_sent(p_send_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_automation uuid;
BEGIN
  UPDATE instagram_automation_sends
     SET dm_status = 'sent'
   WHERE id = p_send_id AND dm_status IS DISTINCT FROM 'sent'
  RETURNING automation_id INTO v_automation;

  IF v_automation IS NULL THEN
    RETURN false;
  END IF;

  UPDATE instagram_comment_automations
     SET dms_sent_count = dms_sent_count + 1, last_triggered_at = now()
   WHERE id = v_automation;

  RETURN true;
END $$;

REVOKE ALL ON FUNCTION mark_automation_dm_sent(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_automation_dm_sent(uuid) TO service_role;

-- ---------- notifications_type_check ---------------------------------
-- ATENÇÃO: copiar a lista da definição MAIS RECENTE no momento de escrever
-- (hoje 20260811000003_storage_autoclean_notification.sql, 21 valores) e
-- apenas ACRESCENTAR 'instagram_automation_failed'. Este arquivo passa a ser
-- a definição mais recente: a próxima migration copia DAQUI.
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
    'instagram_automation_failed'
  )
);
