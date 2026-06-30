import { describe, it, expect } from 'vitest';
import { planToForm, formToPayload } from '../PlansPage';
import type { Plan } from '../../lib/api';

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'agency',
    name: 'Agency',
    price_brl: 17900,
    price_brl_annual: 179000,
    stripe_product_id: 'prod_x',
    stripe_price_id: 'price_m',
    stripe_price_id_annual: 'price_y',
    stripe_price_id_seat: 'price_seat_m',
    stripe_price_id_seat_annual: 'price_seat_y',
    seat_addon_brl: 2500,
    seat_addon_brl_annual: 25000,
    max_clients: 30,
    max_team_members: 5,
    max_workflow_templates: null,
    max_active_workflows_per_client: null,
    max_instagram_accounts: null,
    max_leads: null,
    max_hub_tokens: null,
    storage_quota_bytes: null,
    max_custom_properties_per_template: null,
    max_posts_per_workflow: null,
    max_workspaces_per_user: null,
    max_mcp_keys: null,
    feature_instagram: true,
    feature_instagram_ai: true,
    feature_analytics_reports: true,
    feature_best_times: true,
    feature_audience_demographics: true,
    feature_hub_portal: true,
    feature_leads: true,
    feature_financial: true,
    feature_contracts: true,
    feature_ideas: true,
    feature_workflow_gantt: true,
    feature_workflow_recurrence: true,
    feature_csv_import: true,
    feature_custom_properties: true,
    feature_post_scheduling: true,
    feature_auto_sync_cron: true,
    feature_post_tagging: true,
    feature_brand_customization: true,
    feature_mcp: true,
    rate_instagram_syncs_per_day: null,
    rate_ai_analyses_per_month: 100,
    rate_report_generations_per_month: null,
    sort_order: 20,
    is_active: true,
    is_default: false,
    created_at: '',
    updated_at: '',
    workspace_count: 0,
    ...overrides,
  };
}

describe('PlansPage seat price-id mapping', () => {
  it('planToForm copies the seat price ids into the form', () => {
    const form = planToForm(makePlan());
    expect(form.stripe_price_id_seat).toBe('price_seat_m');
    expect(form.stripe_price_id_seat_annual).toBe('price_seat_y');
  });

  it('planToForm coerces null seat ids to empty strings', () => {
    const form = planToForm(
      makePlan({ stripe_price_id_seat: null, stripe_price_id_seat_annual: null }),
    );
    expect(form.stripe_price_id_seat).toBe('');
    expect(form.stripe_price_id_seat_annual).toBe('');
  });

  it('formToPayload sends the seat price ids when set', () => {
    const payload = formToPayload(planToForm(makePlan()));
    expect(payload.stripe_price_id_seat).toBe('price_seat_m');
    expect(payload.stripe_price_id_seat_annual).toBe('price_seat_y');
  });

  it('formToPayload coerces empty seat ids back to null', () => {
    const form = planToForm(
      makePlan({ stripe_price_id_seat: null, stripe_price_id_seat_annual: null }),
    );
    const payload = formToPayload(form);
    expect(payload.stripe_price_id_seat).toBeNull();
    expect(payload.stripe_price_id_seat_annual).toBeNull();
  });
});

describe('PlansPage seat display-price mapping', () => {
  it('planToForm copies the seat display prices (centavos) into the form', () => {
    const form = planToForm(makePlan());
    expect(form.seat_addon_brl).toBe(2500);
    expect(form.seat_addon_brl_annual).toBe(25000);
  });

  it('planToForm keeps null seat display prices as null', () => {
    const form = planToForm(makePlan({ seat_addon_brl: null, seat_addon_brl_annual: null }));
    expect(form.seat_addon_brl).toBeNull();
    expect(form.seat_addon_brl_annual).toBeNull();
  });

  it('formToPayload passes the seat display prices through unchanged', () => {
    const payload = formToPayload(planToForm(makePlan()));
    expect(payload.seat_addon_brl).toBe(2500);
    expect(payload.seat_addon_brl_annual).toBe(25000);
  });

  it('formToPayload passes null seat display prices through as null', () => {
    const payload = formToPayload(
      planToForm(makePlan({ seat_addon_brl: null, seat_addon_brl_annual: null })),
    );
    expect(payload.seat_addon_brl).toBeNull();
    expect(payload.seat_addon_brl_annual).toBeNull();
  });
});
