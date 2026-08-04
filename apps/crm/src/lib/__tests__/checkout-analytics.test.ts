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
      { plan_id: 'pro', billing_interval: 'year', source: 'onboarding' },
      { sendInstantly: true },
    );
  });

  it('carries the billing source too', () => {
    captureCheckoutStarted('start', 'month', 'billing');
    expect(captureEvent).toHaveBeenCalledWith(
      'checkout_started',
      { plan_id: 'start', billing_interval: 'month', source: 'billing' },
      { sendInstantly: true },
    );
  });
});
