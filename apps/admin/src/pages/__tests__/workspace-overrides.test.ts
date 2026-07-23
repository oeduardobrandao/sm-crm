import { describe, it, expect } from 'vitest';
import { computeOverridesPayload } from '../workspace-overrides';
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

describe('computeOverridesPayload', () => {
  it('regression: turning an override back OFF to match the plan default yields an explicit empty object, not a dropped key', () => {
    // feature_mcp is dark on this plan; this workspace has it force-enabled via a
    // prior override. Admin flips the toggle back to OFF (= the plan default).
    const plan = makePlan({ feature_mcp: false });
    const featureEdits = { feature_mcp: false }; // toggled off in the UI

    const { feature_overrides } = computeOverridesPayload(plan, {}, featureEdits);

    // Must be an empty OBJECT (so the caller sends `{}` and the server clears
    // the stale override), never `undefined`/omitted.
    expect(feature_overrides).toEqual({});
    expect(feature_overrides).not.toBeUndefined();
  });

  it('includes a feature key when the edit still differs from the plan default', () => {
    const plan = makePlan({ feature_mcp: false });
    const featureEdits = { feature_mcp: true };

    const { feature_overrides } = computeOverridesPayload(plan, {}, featureEdits);

    expect(feature_overrides).toEqual({ feature_mcp: true });
  });

  it('resource_overrides: matches plan default -> empty object (clears stale override, not omitted)', () => {
    const plan = makePlan({ max_clients: 15 });
    const resourceEdits = { max_clients: '15' };

    const { resource_overrides } = computeOverridesPayload(plan, resourceEdits, {});

    expect(resource_overrides).toEqual({});
  });

  it('resource_overrides: differs from plan default -> included in the diff', () => {
    const plan = makePlan({ max_clients: 15 });
    const resourceEdits = { max_clients: '50' };

    const { resource_overrides } = computeOverridesPayload(plan, resourceEdits, {});

    expect(resource_overrides).toEqual({ max_clients: 50 });
  });

  it('ignores unparsable resource edits (NaN) rather than overriding with garbage', () => {
    const plan = makePlan({ max_clients: 15 });
    const resourceEdits = { max_clients: '' };

    const { resource_overrides } = computeOverridesPayload(plan, resourceEdits, {});

    expect(resource_overrides).toEqual({});
  });
});
