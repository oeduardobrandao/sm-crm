import type { BillingInterval } from '@/services/billing';

/** Plans a visitor can pick for themselves. Mirrors PAID_PLANS in billing-checkout. */
const SELECTABLE_PLAN_IDS = new Set(['start', 'pro', 'max']);

export interface PlanIntent {
  planId: string;
  interval: BillingInterval;
}

/**
 * Reads the plan choice carried from the landing page through signup.
 *
 * This runs on a URL the user can edit, so nothing unrecognised is passed
 * through. It is not the security boundary — billing-checkout validates the
 * plan id again server-side — but failing here keeps a tampered link from
 * rendering a nonsense page or firing a doomed checkout.
 */
export function parsePlanIntent(search: string): PlanIntent | null {
  const params = new URLSearchParams(search);
  const planId = params.get('plan');
  if (!planId || !SELECTABLE_PLAN_IDS.has(planId)) return null;
  const interval: BillingInterval = params.get('interval') === 'year' ? 'year' : 'month';
  return { planId, interval };
}

/** The query string half of a plan intent, without the leading `?`. */
export function buildPlanIntentQuery(planId: string, interval: BillingInterval): string {
  return new URLSearchParams({ plan: planId, interval }).toString();
}
