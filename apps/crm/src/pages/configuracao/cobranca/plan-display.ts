/**
 * Pure decision logic for the Plano & Cobrança pricing grid. Kept out of the
 * component so it can be unit-tested without rendering.
 */

/**
 * Plans that are assigned only by an admin (comp / internal arrangements) and are
 * never offered for self-serve purchase. Today that's just `lifetime`: the user
 * reaches out, an admin sets it in the admin portal, and there is no Stripe price.
 */
export const INTERNAL_PLAN_IDS = new Set<string>(['lifetime']);

export function isInternalPlan(planId: string | null | undefined): boolean {
  return planId != null && INTERNAL_PLAN_IDS.has(planId);
}

/**
 * The plan the workspace is actually on. The effective plan (`workspaces.plan_id`,
 * which includes admin/comp overrides like Lifetime) is the source of truth; fall
 * back to the Stripe subscription's plan, then Free. Without this, a Lifetime/comp
 * workspace — which has no Stripe subscription — would read as Free.
 */
export function resolveCurrentPlanId(
  effectivePlanId: string | null | undefined,
  subscriptionPlanId: string | null | undefined,
): string {
  return effectivePlanId ?? subscriptionPlanId ?? 'free';
}

/**
 * Internal plans (e.g. Lifetime) appear in the grid only to the workspace that is
 * already on them — so a Lifetime user sees their "Plano atual" card, but it's never
 * presented as a selectable option to anyone else.
 */
export function isPlanVisible(planId: string, currentPlanId: string): boolean {
  return !INTERNAL_PLAN_IDS.has(planId) || planId === currentPlanId;
}

/**
 * Whether a plan card should offer "Fazer upgrade". A workspace on an internal/comp
 * plan (e.g. Lifetime) can't self-serve switch — changes go through support — so no
 * card offers an upgrade. Otherwise a paid plan is purchasable when there's no active
 * Stripe subscription (an active subscriber changes plans via the billing portal).
 */
export function canUpgradeTo(
  planId: string,
  currentPlanId: string,
  hasActiveSub: boolean,
): boolean {
  if (planId === currentPlanId) return false;
  if (isInternalPlan(currentPlanId)) return false;
  return !hasActiveSub && planId !== 'free';
}

/**
 * Mirrors the backend's checkout-block predicate — `pagarmeCheckoutBlocked` in
 * `supabase/functions/pagarme-checkout/logic.ts` and the equivalent inline gate in
 * `billing-checkout/index.ts` — so the CTA never offers an upgrade the server will 409 on
 * (after the user has typed full card data into the Pagar.me dialog). It is provider-agnostic
 * on purpose: a workspace has one `workspace_subscriptions` row regardless of which provider
 * owns it, and the backend's gate reads `status` alone. In force (active/trialing/past_due) or
 * Stripe-terminal-dunning (unpaid) blocks outright; a canceled row still blocks while it is
 * "paid through" — canceled with `cancel_at_period_end` and a `current_period_end` still in
 * the future (e.g. a 12x subscriber who canceled after the full year was already charged).
 */
export function checkoutBlocked(
  subscription:
    | {
        status?: string | null;
        cancel_at_period_end?: boolean | null;
        current_period_end?: string | null;
      }
    | null
    | undefined,
  now: Date,
): boolean {
  if (!subscription) return false;
  const { status } = subscription;
  if (
    status === 'active' ||
    status === 'trialing' ||
    status === 'past_due' ||
    status === 'unpaid'
  ) {
    return true;
  }
  if (status !== 'canceled') return false;
  if (!subscription.cancel_at_period_end) return false;
  if (!subscription.current_period_end) return false;
  const end = new Date(subscription.current_period_end).getTime();
  if (Number.isNaN(end)) return false;
  return end > now.getTime();
}

/**
 * Plans offered as a trial on the /comecar step. `isPlanVisible` is NOT a
 * substitute: it only filters internal plans, so Free would still render a card
 * even though declining is a secondary link there, not a plan choice. The
 * price check is belt-and-braces — a future zero-priced catalog entry must not
 * silently become something you can start a trial on. Accepts a plan priced on
 * either the monthly or annual interval, so an annual-only plan is not hidden
 * from the trial step while the landing page offers it.
 */
export function isSelectableTrialPlan(plan: {
  id: string;
  price_brl: number | null;
  price_brl_annual: number | null;
}): boolean {
  return (
    plan.id !== 'free' &&
    !isInternalPlan(plan.id) &&
    ((plan.price_brl ?? 0) > 0 || (plan.price_brl_annual ?? 0) > 0)
  );
}
