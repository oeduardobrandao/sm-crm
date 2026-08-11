import { isPaidThrough } from "../_shared/pagarme-logic.ts";

/**
 * Decides the workspace state when un-comping (clearing plan_source='manual').
 * Any LIVE subscription (active, trialing, past_due, unpaid — still provider-managed,
 * possibly in dunning) hands control back to whichever provider's webhook/checkout owns the
 * row (Stripe or Pagar.me), with the subscription's plan; a canceled-but-paid-through row
 * (e.g. a 12x installment plan already paid for the year) is treated the same way, since the
 * customer keeps access until period end and un-comping must not downgrade them to free early
 * — that downgrade is the cron/webhook's job at period end. Otherwise fall back to the default
 * (free) plan as an unmanaged 'system' workspace.
 * The webhook writes provider-derived statuses with no CHECK constraint, so gate on the
 * known-dead set rather than a live allowlist.
 */
const DEAD_STATUSES = new Set(["canceled", "incomplete", "incomplete_expired"]);

export function revertPlanTarget(
  sub: {
    status?: string | null;
    plan_id?: string | null;
    provider?: string | null;
    cancel_at_period_end?: boolean | null;
    current_period_end?: string | null;
  } | null,
  defaultPlanId: string,
  now: Date,
): { plan_source: "stripe" | "pagarme" | "system"; plan_id: string } {
  if (sub?.plan_id) {
    const isLive = sub.status && !DEAD_STATUSES.has(sub.status);
    if (isLive || isPaidThrough(sub, now)) {
      return { plan_source: sub.provider === "pagarme" ? "pagarme" : "stripe", plan_id: sub.plan_id };
    }
  }
  return { plan_source: "system", plan_id: defaultPlanId };
}
