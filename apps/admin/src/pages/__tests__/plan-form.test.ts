import { describe, it, expect } from 'vitest';
import {
  planToForm,
  formToPayload,
  emptyFormState,
  centavosToReais,
  reaisToCentavos,
  parseIntInput,
} from '../plan-form';
import type { Plan } from '../../lib/api';

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'pro',
    name: 'Pro',
    price_brl: 13990,
    price_brl_annual: 134300,
    stripe_product_id: null,
    stripe_price_id: null,
    stripe_price_id_annual: null,
    max_clients: 15,
    max_team_members: 3,
    max_workflow_templates: 8,
    max_active_workflows_per_client: 10,
    max_instagram_accounts: 15,
    max_leads: 200,
    max_hub_tokens: 15,
    storage_quota_bytes: 10737418240,
    max_custom_properties_per_template: 15,
    max_posts_per_workflow: null,
    max_workspaces_per_user: 1,
    max_mcp_keys: 5,
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
    feature_mcp: false,
    rate_instagram_syncs_per_day: 15,
    rate_ai_analyses_per_month: 15,
    rate_report_generations_per_month: 15,
    sort_order: 2,
    is_active: true,
    is_default: false,
    created_at: 't',
    updated_at: 't',
    workspace_count: 0,
    ...overrides,
  };
}

describe('plan-form mapping', () => {
  it('formToPayload sends price_brl, price_brl_annual and sort_order', () => {
    const payload = formToPayload(
      planToForm(makePlan({ price_brl: 13990, price_brl_annual: 134300, sort_order: 2 })),
    );
    expect(payload.price_brl).toBe(13990);
    expect(payload.price_brl_annual).toBe(134300);
    expect(payload.sort_order).toBe(2);
  });

  it('planToForm exposes price as editable reais strings and sort_order as-is', () => {
    const form = planToForm(makePlan({ price_brl: 9990, price_brl_annual: 95900, sort_order: 1 }));
    expect(form.price_brl_input).toBe('99.90');
    expect(form.price_brl_annual_input).toBe('959.00');
    expect(form.sort_order).toBe(1);
  });

  it('preserves existing behavior: name, limits, features still round-trip', () => {
    const payload = formToPayload(planToForm(makePlan({ max_clients: 15, feature_mcp: false })));
    expect(payload.name).toBe('Pro');
    expect(payload.max_clients).toBe(15);
    expect(payload.feature_mcp).toBe(false);
  });

  it('omits sort_order when null so create uses the DB default (sort_order is NOT NULL)', () => {
    const payload = formToPayload(emptyFormState());
    expect('sort_order' in payload).toBe(false);
  });

  it('null price survives as null and sort_order 0 is preserved (not dropped)', () => {
    const payload = formToPayload(
      planToForm(makePlan({ price_brl: null, price_brl_annual: null, sort_order: 0 })),
    );
    expect(payload.price_brl).toBeNull();
    expect(payload.price_brl_annual).toBeNull();
    expect(payload.sort_order).toBe(0);
  });
});

describe('price converters (reais <-> centavos)', () => {
  it('centavosToReais formats centavos as reais', () => {
    expect(centavosToReais(9990)).toBe('99.90');
    expect(centavosToReais(0)).toBe('0.00');
    expect(centavosToReais(null)).toBe('');
    expect(centavosToReais(undefined)).toBe('');
  });

  it('reaisToCentavos parses reais to integer centavos with no float drift', () => {
    expect(reaisToCentavos('99.90')).toBe(9990);
    expect(reaisToCentavos('149,90')).toBe(14990); // accepts comma decimal
    expect(reaisToCentavos('0')).toBe(0);
    expect(reaisToCentavos('')).toBeNull();
    expect(reaisToCentavos('  ')).toBeNull();
    expect(reaisToCentavos('abc')).toBeNull();
    expect(reaisToCentavos('-5')).toBeNull();
  });

  it('round-trips centavos -> reais -> centavos', () => {
    expect(reaisToCentavos(centavosToReais(13990))).toBe(13990);
    expect(reaisToCentavos(centavosToReais(19990))).toBe(19990);
  });
});

describe('parseIntInput (sort_order guard — never NaN)', () => {
  it('parses valid integers', () => {
    expect(parseIntInput('0')).toBe(0);
    expect(parseIntInput('3')).toBe(3);
  });

  it('returns null for empty/blank input', () => {
    expect(parseIntInput('')).toBeNull();
    expect(parseIntInput('   ')).toBeNull();
  });

  it('never returns NaN for non-numeric input', () => {
    expect(parseIntInput('abc')).toBeNull();
    expect(parseIntInput('-')).toBeNull();
    expect(parseIntInput('e')).toBeNull();
  });

  it('truncates decimals to an integer', () => {
    expect(parseIntInput('1.5')).toBe(1);
  });
});
