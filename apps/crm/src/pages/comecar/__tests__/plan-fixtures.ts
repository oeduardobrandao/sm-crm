/**
 * Production-shaped plan rows shared by the /comecar tests. Prices are in centavos,
 * like `plans.price_brl` (9990 = R$ 99,90).
 */
import type { BillingPlan } from '@/services/billing';

export const base: BillingPlan = {
  id: 'x',
  name: 'X',
  price_brl: 0,
  price_brl_annual: null,
  sort_order: 0,
  max_clients: 2,
  max_team_members: 1,
  storage_quota_bytes: null,
  feature_hub_portal: false,
  feature_analytics_reports: false,
  feature_brand_customization: false,
  max_hub_tokens: 0,
  rate_report_generations_per_month: 0,
  feature_instagram_ai: false,
  feature_auto_sync_cron: false,
  feature_leads: false,
  feature_financial: false,
  feature_contracts: false,
  feature_agenda: true,
  feature_mensagens: false,
  feature_team_chat: false,
  feature_instagram_automation: false,
  feature_briefing_audio: false,
  pagarme_12x_enabled: false,
  pagarme_installment_cents: null,
};

export const allOn = {
  feature_instagram_ai: true,
  feature_auto_sync_cron: true,
  feature_leads: true,
  feature_financial: true,
  feature_contracts: true,
  feature_agenda: true,
  feature_mensagens: true,
  feature_team_chat: true,
};

export const free: BillingPlan = { ...base, id: 'free', name: 'Free', sort_order: 0 };
export const start: BillingPlan = {
  ...base,
  ...allOn,
  id: 'start',
  name: 'Start',
  price_brl: 9990,
  sort_order: 1,
  max_clients: 5,
  max_team_members: 2,
  max_hub_tokens: 5,
  rate_report_generations_per_month: 5,
};
export const pro: BillingPlan = {
  ...base,
  ...allOn,
  id: 'pro',
  name: 'Pro',
  price_brl: 13990,
  sort_order: 2,
  max_clients: 15,
  max_team_members: 5,
  max_hub_tokens: 15,
  rate_report_generations_per_month: 15,
  feature_instagram_automation: true,
  feature_briefing_audio: true,
};
export const max: BillingPlan = {
  ...base,
  ...allOn,
  id: 'max',
  name: 'Max',
  price_brl: 19990,
  sort_order: 3,
  max_clients: null,
  max_team_members: null,
  max_hub_tokens: null,
  rate_report_generations_per_month: null,
  feature_instagram_automation: true,
  feature_briefing_audio: true,
};
export const lifetime: BillingPlan = { ...base, id: 'lifetime', name: 'Lifetime', sort_order: 9 };

export const catalog = [lifetime, max, free, pro, start];
