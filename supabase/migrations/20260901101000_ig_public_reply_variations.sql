-- Variações de resposta pública na automação comentário -> DM.
-- Spec: docs/superpowers/specs/2026-08-31-automacoes-dm-midia-e-variacoes-design.md
--
-- public_reply (coluna legada) FICA: entre esta migration e o redeploy das
-- functions, o código antigo ainda a lê. O CRM novo grava as duas
-- (public_reply = primeira variação). DROP fica para um ciclo futuro.

-- CASE (não AND) para o type-guard: mesmo racional do validate_ig_dm_buttons
-- (20260819000001) -- Postgres não garante ordem entre operandos de AND.
CREATE FUNCTION validate_ig_public_replies(r jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN jsonb_typeof(r) <> 'array' THEN false
    WHEN jsonb_array_length(r) > 5 THEN false
    ELSE coalesce((
      SELECT bool_and(CASE
        WHEN jsonb_typeof(item) <> 'string' THEN false
        ELSE coalesce(char_length(btrim(item #>> '{}')) BETWEEN 1 AND 500, false)
      END)
      FROM jsonb_array_elements(r) AS item
    ), true)
  END
$$;

ALTER TABLE instagram_comment_automations
  ADD COLUMN public_replies jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Backfill ANTES do CHECK. O CHECK legado de public_reply (1..500 sem btrim)
-- aceita string só de espaços; um valor desses viraria array inválido para o
-- validador novo -- filtra para '[]'.
UPDATE instagram_comment_automations
   SET public_replies = jsonb_build_array(public_reply)
 WHERE public_reply IS NOT NULL AND btrim(public_reply) <> '';

ALTER TABLE instagram_comment_automations
  ADD CONSTRAINT ica_public_replies_valid CHECK (validate_ig_public_replies(public_replies));

-- Snapshot do texto sorteado, gravado junto com o estado em voo 'unknown'.
-- Sem CHECK de conteúdo: é snapshot, não entrada de usuário.
ALTER TABLE instagram_automation_sends
  ADD COLUMN public_reply_text text;

-- A lista de colunas do RETURNS TABLE muda -> DROP + CREATE (OR REPLACE não
-- pode mudar o tipo de retorno). Precedente: 20260819000001. Entre a migration
-- e o redeploy, o cron antigo ignora a coluna extra sem quebrar.
DROP FUNCTION claim_retryable_automation_sends(int);

CREATE FUNCTION claim_retryable_automation_sends(p_limit int DEFAULT 25)
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
  public_reply_text text,
  attempts int,
  encrypted_access_token text,
  instagram_user_id text
) LANGUAGE sql SECURITY DEFINER AS $$
  WITH claimed AS (
    SELECT s.id
      FROM instagram_automation_sends s
      JOIN instagram_comment_automations a ON a.id = s.automation_id
      JOIN instagram_accounts ia
        ON ia.client_id = a.client_id
       AND ia.authorization_status = 'active'
       AND ia.comments_subscribed_at IS NOT NULL
       AND 'instagram_business_manage_comments' = ANY (ia.permissions)
       AND 'instagram_business_manage_messages' = ANY (ia.permissions)
     WHERE ((s.status = 'retry' AND s.next_attempt_at <= now())
         OR (s.status = 'processing' AND s.processing_at < now() - interval '10 minutes'))
       AND s.comment_created_at > now() - interval '7 days'
       FOR UPDATE OF s SKIP LOCKED
     LIMIT p_limit
  ), updated AS (
    UPDATE instagram_automation_sends
       SET status = 'processing', processing_at = now()
     WHERE id IN (SELECT id FROM claimed)
    RETURNING *
  )
  SELECT u.id, u.comment_id, u.automation_id, u.conta_id, u.media_id,
         u.commenter_id, u.comment_created_at, u.dm_status,
         u.public_reply_status, u.public_reply_text, u.attempts,
         ia.encrypted_access_token, ia.instagram_user_id
    FROM updated u
    JOIN instagram_comment_automations a ON a.id = u.automation_id
    JOIN instagram_accounts ia ON ia.client_id = a.client_id
$$;

REVOKE ALL ON FUNCTION claim_retryable_automation_sends(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_retryable_automation_sends(int) TO service_role;
