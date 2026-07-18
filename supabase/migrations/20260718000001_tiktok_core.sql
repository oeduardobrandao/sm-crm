-- 20260718000001_tiktok_core.sql
-- TikTok integration core tables (spec: docs/superpowers/specs/2026-07-17-tiktok-integration-design.md)

CREATE TABLE tiktok_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id bigint NOT NULL UNIQUE REFERENCES clientes(id) ON DELETE CASCADE,
  tiktok_open_id text NOT NULL,
  username text,
  display_name text,
  avatar_url text,
  profile_deep_link text,
  follower_count int,
  following_count int,
  likes_count bigint,
  video_count int,
  encrypted_access_token text,
  encrypted_refresh_token text,
  access_token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  refresh_lock_at timestamptz,
  scopes text[],
  authorization_status text NOT NULL DEFAULT 'active'
    CHECK (authorization_status IN ('active','revoked','disconnected','expired')),
  auto_sync_enabled boolean NOT NULL DEFAULT true,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tiktok_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tiktok_account_id uuid NOT NULL REFERENCES tiktok_accounts(id) ON DELETE CASCADE,
  tiktok_video_id text NOT NULL UNIQUE,
  title text,
  video_description text,
  duration int,
  height int,
  width int,
  share_url text,
  embed_link text,
  cover_image_url text,
  posted_at timestamptz,
  views bigint,
  likes int,
  comments int,
  shares int,
  synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_tiktok_posts_account ON tiktok_posts(tiktok_account_id, posted_at DESC);

CREATE TABLE tiktok_follower_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tiktok_account_id uuid NOT NULL REFERENCES tiktok_accounts(id) ON DELETE CASCADE,
  date date NOT NULL,                      -- deliberate fix: real date type (IG's is text)
  follower_count int NOT NULL,
  source text NOT NULL DEFAULT 'api' CHECK (source IN ('api','manual')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tiktok_account_id, date)
);

CREATE TABLE tiktok_account_metrics_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tiktok_account_id uuid NOT NULL REFERENCES tiktok_accounts(id) ON DELETE CASCADE,
  snapshot_date date NOT NULL,
  follower_count int,
  following_count int,
  likes_count bigint,
  video_count int,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tiktok_account_id, snapshot_date)
);

-- Webhook durability (service-role only; no client RLS exposure)
CREATE TABLE tiktok_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event text NOT NULL,
  user_openid text,
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);
CREATE INDEX idx_tiktok_webhook_events_unprocessed
  ON tiktok_webhook_events(received_at) WHERE processed_at IS NULL;

ALTER TABLE oauth_states
  ADD COLUMN provider text NOT NULL DEFAULT 'instagram'
  CHECK (provider IN ('instagram','tiktok'));

-- RLS: mirrors supabase/migrations/20260310_instagram_rls.sql policy-for-policy,
-- swapping instagram_accounts -> tiktok_accounts (client_id join to clientes.conta_id)
-- and instagram_posts -> tiktok_posts (join via tiktok_accounts). Same USING
-- expressions (FOR ALL with no explicit WITH CHECK defaults WITH CHECK to USING,
-- same as the Instagram policies). tiktok_follower_history gets the same account-join
-- policy as tiktok_posts. tiktok_account_metrics_daily uses service-role-only access
-- (mirroring instagram_account_metrics_daily for system crons only).
ALTER TABLE tiktok_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiktok_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiktok_follower_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiktok_account_metrics_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiktok_webhook_events ENABLE ROW LEVEL SECURITY;  -- no policies: service-role only

CREATE POLICY "tiktok_accounts_conta" ON tiktok_accounts
  FOR ALL USING (client_id IN (
    SELECT c.id FROM clientes c
    WHERE c.conta_id IN (SELECT conta_id FROM profiles WHERE id = auth.uid())
  ));

CREATE POLICY "tiktok_posts_via_account" ON tiktok_posts
  FOR ALL USING (tiktok_account_id IN (
    SELECT ta.id FROM tiktok_accounts ta
    JOIN clientes c ON c.id = ta.client_id
    WHERE c.conta_id IN (SELECT conta_id FROM profiles WHERE id = auth.uid())
  ));

CREATE POLICY "tiktok_follower_history_via_account" ON tiktok_follower_history
  FOR ALL USING (tiktok_account_id IN (
    SELECT ta.id FROM tiktok_accounts ta
    JOIN clientes c ON c.id = ta.client_id
    WHERE c.conta_id IN (SELECT conta_id FROM profiles WHERE id = auth.uid())
  ));

-- Service role full access only (metrics snapshots are system-generated, never queried by clients)
CREATE POLICY "Service role full access" ON tiktok_account_metrics_daily
  FOR ALL USING (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS idx_tiktok_metrics_daily_account_date
  ON tiktok_account_metrics_daily(tiktok_account_id, snapshot_date DESC);

-- Storage bucket for TikTok video cover/thumbnail caching, analogous in
-- purpose to the `instagram-posts` bucket used by
-- supabase/functions/_shared/instagram-thumbnail-cache.ts. That bucket has
-- no migration (created via dashboard, like the original instagram_accounts/
-- instagram_posts tables noted in 20260310_instagram_rls.sql), so this
-- mirrors the more recent, safer `kb-images` bucket pattern instead
-- (supabase/migrations/20260717000001_kb_images_bucket.sql): public read
-- only, no write policy because edge functions write with the service role
-- key, which bypasses RLS entirely.
INSERT INTO storage.buckets (id, name, public)
VALUES ('tiktok-posts', 'tiktok-posts', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "tiktok_posts_public_read" ON storage.objects;
CREATE POLICY "tiktok_posts_public_read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'tiktok-posts');
