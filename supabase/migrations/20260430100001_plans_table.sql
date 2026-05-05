-- Plans table — subscription plans for the platform.
-- Originally created via dashboard; this migration ensures it exists
-- for fresh database setups (e.g. staging).

CREATE TABLE IF NOT EXISTS plans (
  id text PRIMARY KEY,
  name text NOT NULL,
  price_brl numeric,
  price_brl_annual numeric,
  stripe_product_id text,
  stripe_price_id text,
  stripe_price_id_annual text,
  max_clients int,
  max_team_members int,
  max_workflow_templates int,
  max_active_workflows_per_client int,
  max_instagram_accounts int,
  max_leads int,
  max_hub_tokens int,
  storage_quota_bytes bigint,
  max_custom_properties_per_template int,
  max_posts_per_workflow int,
  max_workspaces_per_user int,
  feature_instagram boolean NOT NULL DEFAULT false,
  feature_instagram_ai boolean NOT NULL DEFAULT false,
  feature_analytics_reports boolean NOT NULL DEFAULT false,
  feature_best_times boolean NOT NULL DEFAULT false,
  feature_audience_demographics boolean NOT NULL DEFAULT false,
  feature_hub_portal boolean NOT NULL DEFAULT false,
  feature_leads boolean NOT NULL DEFAULT false,
  feature_financial boolean NOT NULL DEFAULT false,
  feature_contracts boolean NOT NULL DEFAULT false,
  feature_ideas boolean NOT NULL DEFAULT false,
  feature_workflow_gantt boolean NOT NULL DEFAULT false,
  feature_workflow_recurrence boolean NOT NULL DEFAULT false,
  feature_csv_import boolean NOT NULL DEFAULT false,
  feature_custom_properties boolean NOT NULL DEFAULT false,
  feature_post_scheduling boolean NOT NULL DEFAULT false,
  feature_auto_sync_cron boolean NOT NULL DEFAULT false,
  feature_post_tagging boolean NOT NULL DEFAULT false,
  feature_brand_customization boolean NOT NULL DEFAULT false,
  rate_instagram_syncs_per_day int,
  rate_ai_analyses_per_month int,
  rate_report_generations_per_month int,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "plans_public_read" ON plans
  FOR SELECT USING (true);

CREATE POLICY "plans_service_role" ON plans
  FOR ALL TO service_role USING (true) WITH CHECK (true);
