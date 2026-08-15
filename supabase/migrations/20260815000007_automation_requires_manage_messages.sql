-- supabase/migrations/20260815000007_automation_requires_manage_messages.sql
-- Teste real em staging (2026-08-15): a doc de private replies da Meta lista
-- só instagram_business_manage_comments, mas o POST /<IG_ID>/messages devolve
-- 403 code 10 ("Application does not have permission for this action") sem
-- instagram_business_manage_messages no token. A elegibilidade passa a exigir
-- os DOIS escopos nas duas RPCs que a codificam em SQL (espelha o mesmo ajuste
-- em process.ts e no canAutomate do CRM). Sem isto, conta só com o escopo de
-- comentários seria claimada e falharia toda DM permanentemente.

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
      AND 'instagram_business_manage_messages' = ANY (ia.permissions)
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

-- REVOKE tira também do service_role; re-grant explícito (gotcha conhecido).
REVOKE ALL ON FUNCTION claim_retryable_automation_sends(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_retryable_automation_sends(int) TO service_role;

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
            AND 'instagram_business_manage_messages' = ANY (ia.permissions)
        )
      )
    RETURNING 1
  )
  SELECT count(*)::int FROM failed;
$$;

REVOKE ALL ON FUNCTION fail_ineligible_automation_sends() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fail_ineligible_automation_sends() TO service_role;
