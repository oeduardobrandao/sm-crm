-- ============================================================
-- Instagram Publishing: new columns, status, RPC
-- ============================================================

-- 1. New columns on workflow_posts
ALTER TABLE workflow_posts
  ADD COLUMN IF NOT EXISTS ig_caption text,
  ADD COLUMN IF NOT EXISTS instagram_permalink text,
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS publish_error text,
  ADD COLUMN IF NOT EXISTS publish_retry_count smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS publish_processing_at timestamptz;

-- 2. Update status check constraint to include falha_publicacao
ALTER TABLE workflow_posts DROP CONSTRAINT IF EXISTS workflow_posts_status_check;
ALTER TABLE workflow_posts
  ADD CONSTRAINT workflow_posts_status_check
  CHECK (status IN (
    'rascunho',
    'revisao_interna',
    'aprovado_interno',
    'enviado_cliente',
    'aprovado_cliente',
    'correcao_cliente',
    'agendado',
    'postado',
    'falha_publicacao'
  ));

-- 3. Index for cron queries
CREATE INDEX IF NOT EXISTS idx_workflow_posts_publish_cron
  ON workflow_posts (status, scheduled_at)
  WHERE status IN ('agendado', 'falha_publicacao');

-- 4. New column on clientes
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS auto_publish_on_approval boolean NOT NULL DEFAULT false;

-- 5. RPC for atomic claim (used by cron)
CREATE OR REPLACE FUNCTION claim_posts_for_publishing(
  p_phase text,
  p_limit int DEFAULT 25
)
RETURNS TABLE (
  post_id bigint,
  workflow_id bigint,
  ig_caption text,
  scheduled_at timestamptz,
  instagram_container_id text,
  instagram_media_id text,
  publish_retry_count smallint,
  tipo text,
  encrypted_access_token text,
  instagram_user_id text,
  client_id bigint
) LANGUAGE sql SECURITY DEFINER AS $$
  WITH claimed AS (
    SELECT wp.id
    FROM workflow_posts wp
    WHERE
      CASE p_phase
        WHEN 'container' THEN
          wp.status = 'agendado'
          AND wp.scheduled_at <= now() + interval '1 hour'
          AND wp.instagram_container_id IS NULL
        WHEN 'publish' THEN
          wp.status = 'agendado'
          AND wp.instagram_container_id IS NOT NULL
          AND wp.scheduled_at <= now()
        WHEN 'retry' THEN
          wp.status = 'falha_publicacao'
          AND wp.publish_retry_count < 3
      END
      AND (wp.publish_processing_at IS NULL
           OR wp.publish_processing_at < now() - interval '10 minutes')
    FOR UPDATE OF wp SKIP LOCKED
    LIMIT p_limit
  ),
  updated AS (
    UPDATE workflow_posts
    SET publish_processing_at = now()
    WHERE id IN (SELECT id FROM claimed)
    RETURNING *
  )
  SELECT
    u.id AS post_id,
    u.workflow_id,
    u.ig_caption,
    u.scheduled_at,
    u.instagram_container_id,
    u.instagram_media_id,
    u.publish_retry_count,
    u.tipo,
    ia.encrypted_access_token,
    ia.instagram_user_id,
    c.id AS client_id
  FROM updated u
  JOIN workflows w ON w.id = u.workflow_id
  JOIN clientes c ON c.id = w.cliente_id
  JOIN instagram_accounts ia ON ia.client_id = c.id;
$$;
