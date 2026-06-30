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
  stripe_price_id_seat: string | null;
  stripe_price_id_seat_annual: string | null;
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

/** Shape of a Stripe subscription item, narrowed to the fields we read. */
export interface SubItem {
  price: { id: string | null } | null;
  quantity?: number | null;
}

/**
 * Sums the quantity of subscription items whose price id matches a known seat
 * price id (monthly or annual, across all plans). Returns 0 when no seat item
 * is present. Order-independent — iterates every item.
 *
 * `has_seat_item` is true iff ANY item's price.id matches a known seat price id,
 * REGARDLESS of quantity. This is presence-based, not quantity-based, so a seat
 * item with quantity 0 or null still sets `has_seat_item: true`.
 */
export function resolveSubscriptionSeats(
  subItems: SubItem[],
  plans: PlanPriceRow[],
): { purchased_seats: number; has_seat_item: boolean } {
  const seatPriceIds = new Set<string>();
  for (const p of plans) {
    if (p.stripe_price_id_seat) seatPriceIds.add(p.stripe_price_id_seat);
    if (p.stripe_price_id_seat_annual) seatPriceIds.add(p.stripe_price_id_seat_annual);
  }
  let purchased_seats = 0;
  let has_seat_item = false;
  for (const item of subItems) {
    const priceId = item.price?.id;
    if (priceId && seatPriceIds.has(priceId)) {
      has_seat_item = true;
      purchased_seats += item.quantity ?? 0;
    }
  }
  return { purchased_seats, has_seat_item };
}
