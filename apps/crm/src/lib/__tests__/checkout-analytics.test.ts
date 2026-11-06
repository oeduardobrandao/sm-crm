import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../analytics', () => ({ captureEvent: vi.fn() }));

import { captureEvent } from '../analytics';
import { captureCheckoutStarted } from '../checkout-analytics';

beforeEach(() => {
  vi.mocked(captureEvent).mockClear();
});

describe('captureCheckoutStarted', () => {
  it('emits checkout_started with the same source the request carries', () => {
    captureCheckoutStarted('pro', 'year', 'onboarding');
    expect(captureEvent).toHaveBeenCalledWith(
      'checkout_started',
      { plan_id: 'pro', billing_interval: 'year', source: 'onboarding', provider: 'stripe' },
      { sendInstantly: true },
    );
  });

  it('carries the billing source too', () => {
    captureCheckoutStarted('start', 'month', 'billing');
    expect(captureEvent).toHaveBeenCalledWith(
      'checkout_started',
      { plan_id: 'start', billing_interval: 'month', source: 'billing', provider: 'stripe' },
      { sendInstantly: true },
    );
  });

  it('defaults the provider to stripe when omitted', () => {
    captureCheckoutStarted('pro', 'year', 'billing');
    expect(captureEvent).toHaveBeenCalledWith(
      'checkout_started',
      expect.objectContaining({ provider: 'stripe' }),
      { sendInstantly: true },
    );
  });

  it('carries an explicit pagarme provider', () => {
    captureCheckoutStarted('pro', 'year', 'billing', 'pagarme');
    expect(captureEvent).toHaveBeenCalledWith(
      'checkout_started',
      { plan_id: 'pro', billing_interval: 'year', source: 'billing', provider: 'pagarme' },
      { sendInstantly: true },
    );
  });

  it('merges the recommendation context into the props', () => {
    captureCheckoutStarted('start', 'month', 'onboarding', 'stripe', {
      recommended_plan_id: 'pro',
      accepted_recommendation: false,
    });
    expect(captureEvent).toHaveBeenCalledWith(
      'checkout_started',
      {
        plan_id: 'start',
        billing_interval: 'month',
        source: 'onboarding',
        provider: 'stripe',
        recommended_plan_id: 'pro',
        accepted_recommendation: false,
      },
      { sendInstantly: true },
    );
  });
});
