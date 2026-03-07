-- Analytics Module - Database Schema
-- Migration: 2026-03-06

-- 1. Add especialidade to clientes (for specialty segmentation)
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS especialidade text DEFAULT '';

-- 2. Analytics cache (6-hour TTL for API responses)
CREATE TABLE IF NOT EXISTS instagram_analytics_cache (
  id bigserial PRIMARY KEY,
  instagram_account_id bigint REFERENCES instagram_accounts(id) ON DELETE CASCADE,
  cache_key text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}',
  fetched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(instagram_account_id, cache_key)
);

-- 3. Post topic tags (workspace-scoped)
CREATE TABLE IF NOT EXISTS instagram_post_tags (
  id bigserial PRIMARY KEY,
  conta_id uuid NOT NULL,
  tag_name text NOT NULL,
  color text NOT NULL DEFAULT '#c8f542',
  UNIQUE(conta_id, tag_name)
);

CREATE TABLE IF NOT EXISTS instagram_post_tag_assignments (
  id bigserial PRIMARY KEY,
  post_id bigint REFERENCES instagram_posts(id) ON DELETE CASCADE,
  tag_id bigint REFERENCES instagram_post_tags(id) ON DELETE CASCADE,
  UNIQUE(post_id, tag_id)
);

-- 4. Monthly PDF reports
CREATE TABLE IF NOT EXISTS analytics_reports (
  id bigserial PRIMARY KEY,
  conta_id uuid NOT NULL,
  client_id bigint REFERENCES clientes(id) ON DELETE CASCADE,
  instagram_account_id bigint REFERENCES instagram_accounts(id) ON DELETE CASCADE,
  report_month text NOT NULL,
  report_url text,
  storage_path text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending',
  UNIQUE(instagram_account_id, report_month)
);

-- 5. Indexes
CREATE INDEX IF NOT EXISTS idx_ig_posts_account_posted ON instagram_posts(instagram_account_id, posted_at DESC);
CREATE INDEX IF NOT EXISTS idx_ig_cache_account_key ON instagram_analytics_cache(instagram_account_id, cache_key);
CREATE INDEX IF NOT EXISTS idx_ig_follower_hist_date ON instagram_follower_history(instagram_account_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_reports_client ON analytics_reports(client_id, report_month);

-- 6. RLS
ALTER TABLE instagram_analytics_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE instagram_post_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE instagram_post_tag_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE analytics_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tags_conta" ON instagram_post_tags
  FOR ALL USING (conta_id IN (SELECT conta_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "tag_assignments_via_tags" ON instagram_post_tag_assignments
  FOR ALL USING (tag_id IN (
    SELECT id FROM instagram_post_tags
    WHERE conta_id IN (SELECT conta_id FROM profiles WHERE id = auth.uid())
  ));

CREATE POLICY "reports_conta" ON analytics_reports
  FOR ALL USING (conta_id IN (SELECT conta_id FROM profiles WHERE id = auth.uid()));

CREATE POLICY "cache_via_account" ON instagram_analytics_cache
  FOR ALL USING (instagram_account_id IN (
    SELECT ia.id FROM instagram_accounts ia
    JOIN clientes c ON c.id = ia.client_id
    WHERE c.conta_id IN (SELECT conta_id FROM profiles WHERE id = auth.uid())
  ));
