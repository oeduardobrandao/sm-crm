/**
 * Decides the workspace state when un-comping (clearing plan_source='manual').
 * Any LIVE Stripe subscription (active, trialing, past_due, unpaid — still Stripe-managed,
 * possibly in dunning) hands control back to the webhook with the subscription's plan;
 * otherwise fall back to the default (free) plan as an unmanaged 'system' workspace.
 * The webhook writes Stripe-derived statuses with no CHECK constraint, so gate on the
 * known-dead set rather than a live allowlist.
 */
const DEAD_STATUSES = new Set(["canceled", "incomplete", "incomplete_expired"]);

export function revertPlanTarget(
  sub: { status?: string | null; plan_id?: string | null } | null,
  defaultPlanId: string,
): { plan_source: "stripe" | "system"; plan_id: string } {
  if (sub?.status && !DEAD_STATUSES.has(sub.status) && sub.plan_id) {
    return { plan_source: "stripe", plan_id: sub.plan_id };
  }
  return { plan_source: "system", plan_id: defaultPlanId };
}
