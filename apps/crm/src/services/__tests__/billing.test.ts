import { describe, it, expect, vi, beforeEach } from 'vitest';

const { from } = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'tok' } } }),
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
    },
    from,
  },
}));

import { supabase } from '../../lib/supabase';
import {
  listPublicPricingPlans,
  listActivePlans,
  startCheckout,
  openBillingPortal,
  getWorkspaceSubscription,
  startPagarmeCheckout,
  cancelPagarmeSubscription,
  updatePagarmeCard,
  BillingApiError,
  type PagarmeCheckoutPayload,
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
    const lifetime = {
      id: 'lifetime',
      name: 'Lifetime',
      price_brl: 0,
      price_brl_annual: 0,
      sort_order: -1,
      max_clients: null,
      max_team_members: null,
      max_workflow_templates: null,
      max_instagram_accounts: null,
      max_hub_tokens: null,
      storage_quota_bytes: null,
      feature_analytics_reports: true,
      feature_post_scheduling: true,
      feature_leads: true,
      feature_financial: true,
      feature_contracts: true,
      feature_brand_customization: true,
      feature_mcp: true,
      pagarme_12x_enabled: false,
      pagarme_installment_cents: null,
    };
    const start = {
      id: 'start',
      name: 'Start',
      price_brl: 9990,
      price_brl_annual: 95900,
      sort_order: 1,
      max_clients: 5,
      max_team_members: 2,
      max_workflow_templates: 3,
      max_instagram_accounts: 5,
      max_hub_tokens: 5,
      storage_quota_bytes: 5 * 1024 ** 3,
      feature_analytics_reports: true,
      feature_post_scheduling: true,
      feature_leads: true,
      feature_financial: true,
      feature_contracts: true,
      feature_brand_customization: true,
      feature_mcp: true,
      pagarme_12x_enabled: null,
      pagarme_installment_cents: 9490,
    };
    const order = vi.fn().mockResolvedValue({ data: [lifetime, start], error: null });
    const eq = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ eq });
    from.mockReturnValue({ select });

    await expect(listPublicPricingPlans()).resolves.toEqual([
      { ...start, pagarme_12x_enabled: false },
    ]);
    expect(from).toHaveBeenCalledWith('plans');
    expect(select).toHaveBeenCalledWith(
      'id, name, price_brl, price_brl_annual, sort_order, max_clients, max_team_members, max_workflow_templates, max_instagram_accounts, max_hub_tokens, storage_quota_bytes, feature_analytics_reports, feature_post_scheduling, feature_leads, feature_financial, feature_contracts, feature_brand_customization, feature_mcp, pagarme_12x_enabled, pagarme_installment_cents',
    );
    expect(eq).toHaveBeenCalledWith('is_active', true);
    expect(order).toHaveBeenCalledWith('sort_order', { ascending: true });
  });

  it('lists active plans with pagarme_12x_enabled coerced to boolean', async () => {
    const pro = {
      id: 'pro',
      name: 'Pro',
      price_brl: 19990,
      price_brl_annual: 191900,
      sort_order: 2,
      max_clients: 20,
      max_team_members: 5,
      storage_quota_bytes: 20 * 1024 ** 3,
      feature_hub_portal: true,
      feature_analytics_reports: true,
      feature_brand_customization: true,
      pagarme_12x_enabled: true,
      pagarme_installment_cents: 12990,
    };
    const order = vi.fn().mockResolvedValue({ data: [pro], error: null });
    const eq = vi.fn().mockReturnValue({ order });
    const select = vi.fn().mockReturnValue({ eq });
    from.mockReturnValue({ select });

    await expect(listActivePlans()).resolves.toEqual([pro]);
    expect(select).toHaveBeenCalledWith(
      'id, name, price_brl, price_brl_annual, sort_order, max_clients, max_team_members, storage_quota_bytes, feature_hub_portal, feature_analytics_reports, feature_brand_customization, pagarme_12x_enabled, pagarme_installment_cents',
    );
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
    expect(JSON.parse(opts.body)).toEqual({ plan_id: 'pro', interval: 'year', source: 'billing' });
    expect(opts.headers.Authorization).toBe('Bearer tok');
  });

  it('startCheckout sends the checkout source and never a promo code', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://checkout.stripe.com/abc' }),
    });
    await startCheckout('pro', 'month', 'onboarding');
    const [, opts] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({
      plan_id: 'pro',
      interval: 'month',
      source: 'onboarding',
    });
  });

  it('startCheckout defaults the source to billing', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ url: 'https://checkout.stripe.com/abc' }),
    });
    await startCheckout('pro', 'year');
    const [, opts] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(JSON.parse(opts.body)).toEqual({
      plan_id: 'pro',
      interval: 'year',
      source: 'billing',
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

  function mockSubscriptionRow(row: Record<string, unknown> | null) {
    const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
    const subEq = vi.fn().mockReturnValue({ maybeSingle });
    const subSelect = vi.fn().mockReturnValue({ eq: subEq });
    const profileSingle = vi.fn().mockResolvedValue({ data: { conta_id: 'ws-1' }, error: null });
    const profileEq = vi.fn().mockReturnValue({ single: profileSingle });
    const profileSelect = vi.fn().mockReturnValue({ eq: profileEq });
    vi.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: { id: 'user-1' } },
    } as never);
    from.mockImplementation((table: string) =>
      table === 'profiles' ? { select: profileSelect } : { select: subSelect },
    );
    return { subSelect };
  }

  const baseSubscriptionRow = {
    status: 'active',
    plan_id: 'pro',
    current_period_end: null,
    cancel_at_period_end: false,
    past_due_since: null,
    next_payment_attempt: null,
    provider: 'stripe',
    installments: null,
    stripe_subscription_id: null,
    pagarme_subscription_id: null,
    ever_subscribed_at: null,
  };

  it('derives hasEverSubscribed and hides the raw stripe id', async () => {
    const { subSelect } = mockSubscriptionRow({
      ...baseSubscriptionRow,
      stripe_subscription_id: 'sub_123',
    });
    const result = await getWorkspaceSubscription();
    expect(result?.hasEverSubscribed).toBe(true);
    expect(result).not.toHaveProperty('stripe_subscription_id');
    expect(result).not.toHaveProperty('pagarme_subscription_id');
    expect(result).not.toHaveProperty('ever_subscribed_at');
    expect(subSelect).toHaveBeenCalledWith(
      'status, plan_id, current_period_end, cancel_at_period_end, past_due_since, next_payment_attempt, provider, installments, stripe_subscription_id, pagarme_subscription_id, ever_subscribed_at',
    );
  });

  it('derives hasEverSubscribed true via a pagarme subscription id', async () => {
    mockSubscriptionRow({
      ...baseSubscriptionRow,
      provider: 'pagarme',
      installments: 12,
      pagarme_subscription_id: 'sub_pagarme_1',
    });
    const result = await getWorkspaceSubscription();
    expect(result?.hasEverSubscribed).toBe(true);
    expect(result?.provider).toBe('pagarme');
    expect(result?.installments).toBe(12);
  });

  it('derives hasEverSubscribed true via ever_subscribed_at alone', async () => {
    mockSubscriptionRow({
      ...baseSubscriptionRow,
      ever_subscribed_at: '2026-01-01T00:00:00Z',
    });
    const result = await getWorkspaceSubscription();
    expect(result?.hasEverSubscribed).toBe(true);
  });

  it('treats an abandoned-checkout row as never subscribed', async () => {
    mockSubscriptionRow({
      ...baseSubscriptionRow,
      status: null,
      plan_id: null,
      provider: null,
    });
    const result = await getWorkspaceSubscription();
    expect(result?.hasEverSubscribed).toBe(false);
    expect(result?.provider).toBeNull();
    expect(result?.installments).toBeNull();
  });

  describe('startPagarmeCheckout', () => {
    const payload: PagarmeCheckoutPayload = {
      plan_id: 'pro',
      card_token: 'tok_123',
      document: '12345678900',
      phone: { ddd: '11', number: '999998888' },
      billing_address: {
        cep: '01310-100',
        line_1: 'Av. Paulista, 1000',
        city: 'São Paulo',
        state: 'SP',
      },
      source: 'billing',
    };

    it('posts the exact body with interval/installments constants added', async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({
          status: 'trialing',
          trial_ends_at: null,
          next_charge_at: '2026-09-01T00:00:00Z',
          installment_amount_cents: 19990,
        }),
      });
      const result = await startPagarmeCheckout(payload);
      expect(result.status).toBe('trialing');
      const [calledUrl, opts] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(calledUrl).toContain('/functions/v1/pagarme-checkout');
      expect(JSON.parse(opts.body)).toEqual({ ...payload, interval: 'year', installments: 12 });
      expect(opts.headers.Authorization).toBe('Bearer tok');
    });

    it('surfaces the server error string and code on non-ok', async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Cartão recusado', code: 'card_declined' }),
      });
      await expect(startPagarmeCheckout(payload)).rejects.toMatchObject({
        message: 'Cartão recusado',
        code: 'card_declined',
      });
      await expect(startPagarmeCheckout(payload)).rejects.toBeInstanceOf(BillingApiError);
    });

    it('falls back to a generic message when the error body is unparseable', async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('not json');
        },
      });
      await expect(startPagarmeCheckout(payload)).rejects.toMatchObject({
        message: 'Erro ao processar o pagamento. Tente novamente.',
      });
    });
  });

  describe('cancelPagarmeSubscription', () => {
    it('posts the cancel action', async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'canceled', access_until: '2026-12-01T00:00:00Z' }),
      });
      const result = await cancelPagarmeSubscription();
      expect(result).toEqual({ status: 'canceled', access_until: '2026-12-01T00:00:00Z' });
      const [calledUrl, opts] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(calledUrl).toContain('/functions/v1/pagarme-subscription');
      expect(JSON.parse(opts.body)).toEqual({ action: 'cancel' });
    });

    it('throws BillingApiError on non-ok', async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Nenhuma assinatura ativa', code: 'not_found' }),
      });
      await expect(cancelPagarmeSubscription()).rejects.toMatchObject({
        message: 'Nenhuma assinatura ativa',
        code: 'not_found',
      });
    });
  });

  describe('updatePagarmeCard', () => {
    const billingAddress = {
      cep: '01310-100',
      line_1: 'Av. Paulista, 1000',
      city: 'São Paulo',
      state: 'SP',
    };

    it('posts the update_card action with card token and billing address', async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: async () => ({}),
      });
      await updatePagarmeCard('tok_456', billingAddress);
      const [calledUrl, opts] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(calledUrl).toContain('/functions/v1/pagarme-subscription');
      expect(JSON.parse(opts.body)).toEqual({
        action: 'update_card',
        card_token: 'tok_456',
        billing_address: billingAddress,
      });
    });

    it('throws BillingApiError on non-ok', async () => {
      (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Token inválido', code: 'invalid_token' }),
      });
      await expect(updatePagarmeCard('bad_tok', billingAddress)).rejects.toMatchObject({
        message: 'Token inválido',
        code: 'invalid_token',
      });
    });
  });
});
