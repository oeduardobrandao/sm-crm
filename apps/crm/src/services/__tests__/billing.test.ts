import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }),
    },
  },
}));

import { supabase } from '../../lib/supabase';
import { startCheckout, openBillingPortal, computeSeatCost, type BillingPlan } from '../billing';

describe('billing service', () => {
  beforeEach(() => {
    // The global afterEach runs vi.restoreAllMocks(), so re-establish the
    // session mock implementation before every test.
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { access_token: 'tok' } },
    } as never);
    vi.stubGlobal('fetch', vi.fn());
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  });

  it('startCheckout posts plan+interval and returns the url', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://checkout.stripe.com/abc' }),
    });
    const url = await startCheckout('pro', 'year');
    expect(url).toBe('https://checkout.stripe.com/abc');
    const [calledUrl, opts] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(calledUrl).toContain('/functions/v1/billing-checkout');
    expect(JSON.parse(opts.body)).toEqual({ plan_id: 'pro', interval: 'year' });
    expect(opts.headers.Authorization).toBe('Bearer tok');
  });

  it('startCheckout includes promo_code only when provided', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://checkout.stripe.com/abc' }),
    });
    await startCheckout('pro', 'month', 'BEMVINDO');
    const [, opts] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({
      plan_id: 'pro',
      interval: 'month',
      promo_code: 'BEMVINDO',
    });
  });

  it('startCheckout throws the server error message on non-ok', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Plan price not configured' }),
    });
    await expect(startCheckout('pro', 'month')).rejects.toThrow('Plan price not configured');
  });

  it('openBillingPortal returns the portal url', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://billing.stripe.com/xyz' }),
    });
    expect(await openBillingPortal()).toBe('https://billing.stripe.com/xyz');
  });
});

function makeBillingPlan(overrides: Partial<BillingPlan> = {}): BillingPlan {
  return {
    id: 'agency',
    name: 'Agency',
    price_brl: 17900,
    price_brl_annual: 179000,
    seat_addon_brl: 2500,
    seat_addon_brl_annual: 25000,
    sort_order: 20,
    max_clients: 30,
    max_team_members: 5,
    storage_quota_bytes: null,
    feature_hub_portal: true,
    feature_analytics_reports: true,
    feature_brand_customization: true,
    ...overrides,
  };
}

describe('computeSeatCost', () => {
  it('uses the monthly seat price for the month interval', () => {
    expect(computeSeatCost(makeBillingPlan(), 'month', 3)).toBe(7500);
  });

  it('uses the annual seat price for the year interval', () => {
    expect(computeSeatCost(makeBillingPlan(), 'year', 2)).toBe(50000);
  });

  it('treats a null seat price as zero', () => {
    const plan = makeBillingPlan({ seat_addon_brl: null, seat_addon_brl_annual: null });
    expect(computeSeatCost(plan, 'month', 4)).toBe(0);
    expect(computeSeatCost(plan, 'year', 4)).toBe(0);
  });
});
