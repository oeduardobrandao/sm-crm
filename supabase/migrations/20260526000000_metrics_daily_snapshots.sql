-- Daily snapshots of instagram account metrics for month-over-month report deltas
CREATE TABLE IF NOT EXISTS instagram_account_metrics_daily (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  instagram_account_id uuid NOT NULL REFERENCES instagram_accounts(id) ON DELETE CASCADE,
  snapshot_date date NOT NULL,
  followers_count integer,
  reach_28d integer,
  impressions_28d integer,
  profile_views_28d integer,
  website_clicks_28d integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(instagram_account_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_metrics_daily_account_date
  ON instagram_account_metrics_daily(instagram_account_id, snapshot_date DESC);

ALTER TABLE instagram_account_metrics_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON instagram_account_metrics_daily
  FOR ALL USING (auth.role() = 'service_role');
