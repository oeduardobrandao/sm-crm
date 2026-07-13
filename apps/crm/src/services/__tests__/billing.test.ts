import { describe, it, expect, vi, beforeEach } from 'vitest';

const { from } = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }),
    },
    from,
  },
}));

import { supabase } from '../../lib/supabase';
import {
  listPublicPricingPlans,
  startCheckout,
  openBillingPortal,
} from '../billing';

describe('billing service', () => {
  beforeEach(() => {
    // The global afterEach runs vi.restoreAllMocks(), so re-establish the
    // session mock implementation before every test.
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: { access_token: 'tok' } },
    } as never);
    from.mockReset();
    vi.stubGlobal('fetch', vi.fn());
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  });

  it('lists only active public pricing fields in Admin order and hides Lifetime', async () => {
    const order = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'lifetime',
          name: 'Lifetime',
          price_brl: 0,
          price_brl_annual: 0,
          sort_order: -1,
          max_clients: null,
          max_team_members: null,
        },
        {
          id: 'start',
          name: 'Start',
          price_brl: 9990,
          price_brl_annual: 95900,
          sort_order: 1,
          max_clients: 5,
          max_team_members: 2,
        },
      ],
      error: null,
    });
    const eq = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ eq });
    from.mockReturnValue({ select });

    await expect(listPublicPricingPlans()).resolves.toEqual([
      {
        id: 'start',
        name: 'Start',
        price_brl: 9990,
        price_brl_annual: 95900,
        sort_order: 1,
        max_clients: 5,
        max_team_members: 2,
      },
    ]);
    expect(from).toHaveBeenCalledWith('plans');
    expect(select).toHaveBeenCalledWith(
      'id, name, price_brl, price_brl_annual, sort_order, max_clients, max_team_members',
    );
    expect(eq).toHaveBeenCalledWith('is_active', true);
    expect(order).toHaveBeenCalledWith('sort_order', { ascending: true });
  });

  it('surfaces public pricing catalog errors', async () => {
    const order = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'catalog unavailable' },
    });
    const eq = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ eq });
    from.mockReturnValue({ select });

    await expect(listPublicPricingPlans()).rejects.toThrow('catalog unavailable');
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
