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

/**
 * Permanent trial-eligibility flag, provider-agnostic: a workspace that has ever had a paid
 * subscription with EITHER provider (or carries the explicit `ever_subscribed_at` marker) never
 * gets a second trial, regardless of which provider it is checking out with now.
 */
export function hasEverSubscribed(
  row:
    | {
      ever_subscribed_at?: string | null;
      stripe_subscription_id?: string | null;
      pagarme_subscription_id?: string | null;
    }
    | null
    | undefined,
): boolean {
  return Boolean(
    row?.ever_subscribed_at || row?.stripe_subscription_id || row?.pagarme_subscription_id,
  );
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

/**
 * Statuses that count toward MRR: an in-force paid subscription that owes money.
 * `trialing` is excluded — a trial pays nothing yet. Terminal states (canceled/unpaid/
 * incomplete_expired/paused) and `incomplete` (never charged) are excluded too. `past_due`
 * is kept: the subscription still exists and Stripe is retrying, so the revenue is in-force.
 */
export const MRR_STATUSES = new Set(["active", "past_due"]);

export function isMrrStatus(status: string | null | undefined): boolean {
  return !!status && MRR_STATUSES.has(status);
}

/**
 * Normalizes a per-interval charge (centavos) to a monthly figure: an annual price is divided
 * by 12 and rounded to the nearest centavo. Returns null for a non-positive/absent amount, so a
 * $0 or unpriced subscription contributes nothing and is not counted as "paying".
 */
export function toMonthlyCents(
  interval: string | null | undefined,
  amountCents: number | null | undefined,
): number | null {
  if (amountCents == null || amountCents <= 0) return null;
  return interval === "year" ? Math.round(amountCents / 12) : amountCents;
}

export interface MrrRow {
  status: string | null;
  /** Billing interval the amount is charged over ("month" | "year"). */
  interval: string | null;
  /** The charge for one `interval`, in centavos — e.g. live from Stripe, net of coupons. */
  amount_cents: number | null;
}

/**
 * Aggregates monthly recurring revenue from already-priced subscription rows. Rows come from the
 * Stripe subscription mirror (comps have no row, so they never appear). Each qualifying row is
 * normalized to a monthly figure; the total is the exact sum of those per-row monthly amounts, so
 * it always reconciles with a per-workspace breakdown built from `priced`.
 */
export function aggregateMrr<T extends MrrRow>(
  rows: T[],
): { mrr_cents: number; paying_count: number; priced: Array<T & { monthly_cents: number }> } {
  let mrr_cents = 0;
  const priced: Array<T & { monthly_cents: number }> = [];
  for (const r of rows) {
    if (!isMrrStatus(r.status)) continue;
    const monthly = toMonthlyCents(r.interval, r.amount_cents);
    if (monthly == null) continue;
    mrr_cents += monthly;
    priced.push({ ...r, monthly_cents: monthly });
  }
  return { mrr_cents, paying_count: priced.length, priced };
}
