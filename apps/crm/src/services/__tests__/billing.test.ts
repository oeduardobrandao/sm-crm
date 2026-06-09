import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }),
    },
  },
}));

import { supabase } from '../../lib/supabase';
import { startCheckout, openBillingPortal } from '../billing';

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
