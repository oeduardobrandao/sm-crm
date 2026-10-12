import type { Plan } from '../../lib/api';

function makePlan(overrides: Partial<Plan>): Plan {
  return {
    id: 'p',
    name: 'Plano',
    price_brl: null,
    price_brl_annual: null,
    stripe_product_id: null,
    stripe_price_id: null,
    stripe_price_id_annual: null,
    pagarme_12x_enabled: false,
    pagarme_plan_id_annual: null,
    pagarme_installment_cents: null,
    max_clients: 5,
    max_team_members: 2,
    max_instagram_accounts: 5,
    storage_quota_bytes: 2147483648,
    is_default: false,
    is_active: true,
    sort_order: 0,
    workspace_count: 0,
    ...overrides,
  } as Plan;
}

/** Shared by PlansPage.test.tsx and PlansPage.phone.test.tsx. */
export const PLANS_FIXTURE: Plan[] = [
  makePlan({
    id: 'free',
    name: 'Free',
    price_brl: 0,
    max_clients: 2,
    max_team_members: 1,
    max_instagram_accounts: 1,
    storage_quota_bytes: 524288000,
    is_default: true,
    workspace_count: 52,
    feature_instagram: true,
  }),
  makePlan({
    id: 'starter',
    name: 'Starter',
    price_brl: 9700,
    price_brl_annual: 97000,
    workspace_count: 31,
    feature_instagram: true,
    feature_leads: true,
  }),
  makePlan({
    id: 'pro',
    name: 'Pro',
    price_brl: 29700,
    price_brl_annual: 297000,
    pagarme_12x_enabled: true,
    max_clients: null,
    workspace_count: 1,
  }),
  makePlan({ id: 'lifetime', name: 'Lifetime', is_active: false, workspace_count: 0 }),
];
