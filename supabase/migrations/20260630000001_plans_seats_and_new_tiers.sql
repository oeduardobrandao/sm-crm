-- Slice 1: clients + seats hybrid. Additive & idempotent.
-- 1) Two shared seat-PRICE-ID columns (one seat Price object shared across tiers).
-- 2) Two seat DISPLAY-PRICE columns (centavos) that back the UI cost breakdown
--    (computeSeatCost / listActivePlans select) — seeded shared across tiers.
-- 3) Three new self-serve tiers (starter/agency/scale) as additive catalog rows.
-- Does NOT move is_default (stays on 'free') and does NOT flip old plans inactive (Slice 4).

alter table plans add column if not exists stripe_price_id_seat        text;
alter table plans add column if not exists stripe_price_id_seat_annual text;
-- Seat display price in centavos (monthly / annual). NULL on the legacy tiers; the
-- three Slice-1 tiers set them so the cost breakdown has centavos to render.
alter table plans add column if not exists seat_addon_brl        int;
alter table plans add column if not exists seat_addon_brl_annual  int;

-- "Everything included": EVERY live feature_* column is set TRUE explicitly.
-- Future ADD COLUMN feature_* migrations MUST
--   UPDATE plans SET <col> = true WHERE id IN ('starter','agency','scale');
-- otherwise the NOT NULL DEFAULT false silently re-gates a paid tier.
insert into plans (
  id, name, price_brl, price_brl_annual,
  stripe_price_id_seat, stripe_price_id_seat_annual,
  seat_addon_brl, seat_addon_brl_annual,
  max_clients, max_team_members, max_workflow_templates, max_active_workflows_per_client,
  max_instagram_accounts, max_leads, max_hub_tokens, storage_quota_bytes,
  max_custom_properties_per_template, max_posts_per_workflow, max_workspaces_per_user,
  max_mcp_keys,
  feature_instagram, feature_instagram_ai, feature_analytics_reports, feature_best_times,
  feature_audience_demographics, feature_hub_portal, feature_leads, feature_financial,
  feature_contracts, feature_ideas, feature_workflow_gantt, feature_workflow_recurrence,
  feature_csv_import, feature_custom_properties, feature_post_scheduling, feature_auto_sync_cron,
  feature_post_tagging, feature_brand_customization, feature_mcp,
  rate_instagram_syncs_per_day, rate_ai_analyses_per_month, rate_report_generations_per_month,
  sort_order, is_active, is_default
) values
  ('starter', 'Starter', 11000, 110000,
   null, null,
   2500, 25000,
   10, 2, null, null,
   null, null, null, null,
   null, null, null,
   null,
   true, true, true, true,
   true, true, true, true,
   true, true, true, true,
   true, true, true, true,
   true, true, true,
   null, 30, null,
   10, true, false),
  ('agency', 'Agency', 17900, 179000,
   null, null,
   2500, 25000,
   30, 5, null, null,
   null, null, null, null,
   null, null, null,
   null,
   true, true, true, true,
   true, true, true, true,
   true, true, true, true,
   true, true, true, true,
   true, true, true,
   null, 100, null,
   20, true, false),
  ('scale', 'Scale', 27900, 279000,
   null, null,
   2500, 25000,
   null, 10, null, null,
   null, null, null, null,
   null, null, null,
   null,
   true, true, true, true,
   true, true, true, true,
   true, true, true, true,
   true, true, true, true,
   true, true, true,
   null, 300, null,
   30, true, false)
on conflict (id) do update set
  name                        = excluded.name,
  price_brl                   = excluded.price_brl,
  price_brl_annual            = excluded.price_brl_annual,
  seat_addon_brl              = excluded.seat_addon_brl,
  seat_addon_brl_annual       = excluded.seat_addon_brl_annual,
  max_clients                 = excluded.max_clients,
  max_team_members            = excluded.max_team_members,
  max_workflow_templates      = excluded.max_workflow_templates,
  max_active_workflows_per_client = excluded.max_active_workflows_per_client,
  max_instagram_accounts      = excluded.max_instagram_accounts,
  max_leads                   = excluded.max_leads,
  max_hub_tokens              = excluded.max_hub_tokens,
  storage_quota_bytes         = excluded.storage_quota_bytes,
  max_custom_properties_per_template = excluded.max_custom_properties_per_template,
  max_posts_per_workflow      = excluded.max_posts_per_workflow,
  max_workspaces_per_user     = excluded.max_workspaces_per_user,
  max_mcp_keys                = excluded.max_mcp_keys,
  feature_instagram           = excluded.feature_instagram,
  feature_instagram_ai        = excluded.feature_instagram_ai,
  feature_analytics_reports   = excluded.feature_analytics_reports,
  feature_best_times          = excluded.feature_best_times,
  feature_audience_demographics = excluded.feature_audience_demographics,
  feature_hub_portal          = excluded.feature_hub_portal,
  feature_leads               = excluded.feature_leads,
  feature_financial           = excluded.feature_financial,
  feature_contracts           = excluded.feature_contracts,
  feature_ideas               = excluded.feature_ideas,
  feature_workflow_gantt      = excluded.feature_workflow_gantt,
  feature_workflow_recurrence = excluded.feature_workflow_recurrence,
  feature_csv_import          = excluded.feature_csv_import,
  feature_custom_properties   = excluded.feature_custom_properties,
  feature_post_scheduling     = excluded.feature_post_scheduling,
  feature_auto_sync_cron      = excluded.feature_auto_sync_cron,
  feature_post_tagging        = excluded.feature_post_tagging,
  feature_brand_customization = excluded.feature_brand_customization,
  feature_mcp                 = excluded.feature_mcp,
  rate_instagram_syncs_per_day = excluded.rate_instagram_syncs_per_day,
  rate_ai_analyses_per_month  = excluded.rate_ai_analyses_per_month,
  rate_report_generations_per_month = excluded.rate_report_generations_per_month,
  sort_order                  = excluded.sort_order,
  is_active                   = excluded.is_active;
-- NOTE: ON CONFLICT does NOT touch is_default (keeps the single-default invariant)
-- nor the stripe_price_id_seat* columns (operator pastes those via admin).
