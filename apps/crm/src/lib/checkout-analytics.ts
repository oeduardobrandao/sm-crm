import { captureEvent } from './analytics';
import type { BillingInterval, CheckoutSource } from '@/services/billing';

/**
 * The single emitter for checkout_started. Both the onboarding step and the
 * billing page go through here so the analytics funnel and the checkout
 * request can never disagree about what `source` means.
 */
export function captureCheckoutStarted(
  planId: string,
  interval: BillingInterval,
  source: CheckoutSource,
  provider: 'stripe' | 'pagarme' = 'stripe',
): void {
  captureEvent(
    'checkout_started',
    { plan_id: planId, billing_interval: interval, source, provider },
    { sendInstantly: true },
  );
}
