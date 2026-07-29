// Pure helpers for mapping Stripe subscription state to effective plans.
// No Stripe/Supabase/env dependencies — unit-testable in isolation.

/**
 * Maps a Stripe subscription status to the value workspaces.plan_id should take.
 * Returns null to mean "leave plan_id unchanged".
 */
export function statusToPlanId(
  status: string,
  subscribedPlanId: string,
  defaultPlanId: string,
): string | null {
  switch (status) {
    case "active":
    case "trialing":
      return subscribedPlanId;
    case "past_due":
    case "incomplete":
      return null; // grace / not yet paid
    case "canceled":
    case "unpaid":
    case "incomplete_expired":
    case "paused":
      return defaultPlanId;
    default:
      return null;
  }
}

export interface PlanPriceRow {
  id: string;
  stripe_price_id: string | null;
  stripe_price_id_annual: string | null;
}

/** Resolves a Stripe price id to a plan id + billing interval, or null if unknown. */
export function resolvePlanFromPriceId(
  priceId: string,
  plans: PlanPriceRow[],
): { plan_id: string; interval: "month" | "year" } | null {
  for (const p of plans) {
    if (p.stripe_price_id === priceId) return { plan_id: p.id, interval: "month" };
    if (p.stripe_price_id_annual === priceId) return { plan_id: p.id, interval: "year" };
  }
  return null;
}

// ─── MRR ───────────────────────────────────────────────────────────────────

export interface MrrSubRow {
  status: string | null;
  plan_id: string | null;
  billing_interval: string | null;
}

export interface MrrPlanRow {
  id: string;
  price_brl: number | null;
  price_brl_annual: number | null;
}

/**
 * Statuses that count toward MRR: an in-force paid subscription that owes money.
 * `trialing` is excluded — a trial pays nothing yet. Terminal states (canceled/unpaid/
 * incomplete_expired/paused) and `incomplete` (never charged) are excluded too. `past_due`
 * is kept: the subscription still exists and Stripe is retrying, so the revenue is in-force.
 */
const MRR_STATUSES = new Set(["active", "past_due"]);

/**
 * Monthly recurring revenue, in centavos, from the Stripe subscription mirror — NOT from plan
 * assignment counts, so complimentary/manual plan grants (which have no subscription row) never
 * inflate it. Each paying subscription is priced from its plan's catalog price by billing
 * interval, with annual normalized to a monthly figure (price_brl_annual / 12). This is gross
 * MRR: per-customer Stripe coupons/discounts are not applied.
 */
export function computeMrrCents(
  subs: MrrSubRow[],
  plans: MrrPlanRow[],
): { mrr_cents: number; paying_count: number } {
  const priceById = new Map(plans.map((p) => [p.id, p]));
  let mrr_cents = 0;
  let paying_count = 0;
  for (const s of subs) {
    if (!s.status || !MRR_STATUSES.has(s.status) || !s.plan_id) continue;
    const plan = priceById.get(s.plan_id);
    if (!plan) continue;
    const cents =
      s.billing_interval === "year"
        ? plan.price_brl_annual != null
          ? Math.round(plan.price_brl_annual / 12)
          : null
        : plan.price_brl;
    // A $0/absent price is not revenue and its subscriber is not "paying".
    if (cents == null || cents <= 0) continue;
    mrr_cents += cents;
    paying_count += 1;
  }
  return { mrr_cents, paying_count };
}
