import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }),
    },
  },
}));

import { supabase } from '../../lib/supabase';
import { startCheckout, openBillingPortal, changeSeats, getWorkspaceSeats } from '../billing';

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
    const url = await startCheckout('agency', 'year');
    expect(url).toBe('https://checkout.stripe.com/abc');
    const [calledUrl, opts] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(calledUrl).toContain('/functions/v1/billing-checkout');
    expect(JSON.parse(opts.body)).toEqual({ plan_id: 'agency', interval: 'year' });
    expect(opts.headers.Authorization).toBe('Bearer tok');
  });

  it('startCheckout includes extra_seats only when > 0', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://checkout.stripe.com/abc' }),
    });
    await startCheckout('agency', 'month', undefined, 3);
    const [, opts] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({
      plan_id: 'agency',
      interval: 'month',
      extra_seats: 3,
    });
  });

  it('startCheckout omits extra_seats when 0', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://checkout.stripe.com/abc' }),
    });
    await startCheckout('agency', 'month', undefined, 0);
    const [, opts] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({ plan_id: 'agency', interval: 'month' });
  });

  it('startCheckout includes promo_code only when provided', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://checkout.stripe.com/abc' }),
    });
    await startCheckout('agency', 'month', 'BEMVINDO');
    const [, opts] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({
      plan_id: 'agency',
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
    await expect(startCheckout('agency', 'month')).rejects.toThrow('Plan price not configured');
  });

  it('openBillingPortal returns the portal url', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://billing.stripe.com/xyz' }),
    });
    expect(await openBillingPortal()).toBe('https://billing.stripe.com/xyz');
  });

  it('changeSeats posts extra_seats to billing-seats and resolves on ok', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    await changeSeats(2);
    const [calledUrl, opts] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(calledUrl).toContain('/functions/v1/billing-seats');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toEqual({ extra_seats: 2 });
    expect(opts.headers.Authorization).toBe('Bearer tok');
  });

  it('changeSeats throws the server error message on non-ok', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: 'Reduza usuários antes de remover assentos' }),
    });
    await expect(changeSeats(0)).rejects.toThrow('Reduza usuários antes de remover assentos');
  });

  it('getWorkspaceSeats returns the workspace-limits seats block', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        plan_name: 'Agency',
        limits: {},
        features: {},
        seats: { included: 5, purchased: 2, effective: 7, used: 4 },
      }),
    });
    const seats = await getWorkspaceSeats();
    const [calledUrl, opts] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(calledUrl).toContain('/functions/v1/workspace-limits');
    expect(opts.method).toBe('GET');
    expect(seats).toEqual({ included: 5, purchased: 2, effective: 7, used: 4 });
  });

  it('getWorkspaceSeats returns null when the response has no seats block', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ plan_name: 'Free', limits: {}, features: {} }),
    });
    expect(await getWorkspaceSeats()).toBeNull();
  });
});
