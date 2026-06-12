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
