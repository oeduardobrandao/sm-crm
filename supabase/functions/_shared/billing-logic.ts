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

/** Coerces an untrusted seat input to a non-negative integer (default 0). */
export function clampExtraSeats(input: unknown): number {
  const n = typeof input === "number" ? input : Number(input);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

/**
 * Builds Stripe checkout line items for a tier + optional seat add-on.
 * - extraSeats <= 0 → just the tier item (never a quantity-0 seat line).
 * - extraSeats > 0  → tier item plus a seat item { price: seatPriceId, quantity: extraSeats }.
 * - extraSeats > 0 with a falsy seatPriceId → error (caller must 400 before any Stripe call,
 *   because a missing interval-matched seat price means Stripe would get mixed intervals).
 */
export function buildLineItems(args: {
  tierPriceId: string;
  seatPriceId: string | null;
  extraSeats: number;
}):
  | { ok: true; lineItems: Array<{ price: string; quantity: number }> }
  | { ok: false; error: string } {
  const lineItems: Array<{ price: string; quantity: number }> = [
    { price: args.tierPriceId, quantity: 1 },
  ];
  if (args.extraSeats > 0) {
    if (!args.seatPriceId) {
      return { ok: false, error: "Seat price not configured for this interval" };
    }
    lineItems.push({ price: args.seatPriceId, quantity: args.extraSeats });
  }
  return { ok: true, lineItems };
}

/**
 * DB-driven paid-plan check: the plan must exist, be active, and have an
 * interval-matched tier price id. Replaces the hardcoded PAID_PLANS allowlist so
 * the catalog is the single source of truth.
 */
export function validatePaidPlan(
  plan: { is_active?: boolean | null; tierPriceId?: string | null } | null,
): boolean {
  return !!plan && plan.is_active === true && typeof plan.tierPriceId === "string" &&
    plan.tierPriceId.length > 0;
}

/** Shape of a Stripe subscription item, narrowed to the fields we read. */
export interface SubItem {
  price?: { id?: string | null } | null;
  quantity?: number | null;
  current_period_end?: number | null;
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

/** Stripe `subscriptions.update` `items` payload for an in-app seat change. */
export type SeatItemUpdate =
  | { kind: "noop" }
  | { kind: "update"; items: [{ id: string; quantity: number }] }
  | { kind: "remove"; items: [{ id: string; deleted: true }] }
  | { kind: "add"; items: [{ price: string; quantity: number }] };

/**
 * Four-way branch on (seatItemExists, N=extraSeats) for `subscriptions.update`.
 * Hard rule: never emit `quantity: 0` — Stripe rejects it; removal uses `{ deleted: true }`.
 *   exists & N>0  → update quantity
 *   exists & N==0 → remove via deleted:true
 *   !exists & N>0 → add the seat price line
 *   !exists & N==0 → no-op
 */
export function decideSeatItemUpdate(args: {
  seatItemId: string | null;
  seatPriceId: string | null;
  extraSeats: number;
}): SeatItemUpdate {
  const n = Math.max(0, Math.trunc(args.extraSeats));
  if (args.seatItemId) {
    return n > 0
      ? { kind: "update", items: [{ id: args.seatItemId, quantity: n }] }
      : { kind: "remove", items: [{ id: args.seatItemId, deleted: true }] };
  }
  return n > 0
    ? { kind: "add", items: [{ price: args.seatPriceId as string, quantity: n }] }
    : { kind: "noop" };
}

/**
 * Pure decision logic for syncSubscription. Classifies all subscription items
 * by price_id (never by array index), resolves the tier item, computes purchased
 * seats, and derives the period-end from the resolved tier item.
 *
 *  - `planIdToWrite`: value for statusToPlanId's subscribedPlanId path — null means
 *    "no tier resolved, leave workspaces.plan_id unchanged" (kills the silent default fallback).
 *  - `mirrorPlanId`: value for workspace_subscriptions.plan_id — the resolved tier, or the
 *    prior mirror value when nothing resolves (never overwritten with null).
 *  - `purchasedSeats`: Stripe seat quantity, forced to 0 unless status is active/trialing.
 *  - `periodEndUnix`: current_period_end from the resolved tier item (basil fallback), or null.
 *  - `mustThrow`: true when an ACTIVE/TRIALING sub has a seat item but no resolvable tier —
 *    the caller must throw 5xx so Stripe redelivers (a shared seat price cannot identify a tier).
 */
export function resolveSyncTarget(args: {
  items: SubItem[];
  status: string;
  plans: PlanPriceRow[];
  priorPlanId: string | null;
}): {
  planIdToWrite: string | null;
  mirrorPlanId: string | null;
  billingInterval: "month" | "year" | null;
  purchasedSeats: number;
  periodEndUnix: number | null;
  mustThrow: boolean;
} {
  const { items, status, plans, priorPlanId } = args;

  // 1. Resolve the TIER item by scanning every item (order-independent).
  let resolved: { plan_id: string; interval: "month" | "year" } | null = null;
  let tierItem: SubItem | null = null;
  for (const it of items) {
    const pid = it?.price?.id ?? null;
    if (!pid) continue;
    const r = resolvePlanFromPriceId(pid, plans);
    if (r) {
      resolved = r;
      tierItem = it;
      break;
    }
  }

  // 2. Purchased seats from the seat item(s), status-aware.
  const seats = resolveSubscriptionSeats(items, plans);
  const seatsLive = status === "active" || status === "trialing";
  const purchasedSeats = seatsLive ? seats.purchased_seats : 0;

  // 3. Did a seat item exist at all? Presence-based (independent of quantity).
  const hasSeatItem = seats.has_seat_item;

  // 4. Active/trialing sub with a seat item but no tier -> unrecoverable; force redelivery.
  const mustThrow = seatsLive && tierItem === null && hasSeatItem;

  // 5. period-end: prefer the resolved tier item; else fall back to the first item present.
  const periodEndUnix = (tierItem?.current_period_end ?? items?.[0]?.current_period_end) ?? null;

  return {
    planIdToWrite: resolved?.plan_id ?? null,
    mirrorPlanId: resolved?.plan_id ?? priorPlanId ?? null,
    billingInterval: resolved?.interval ?? null,
    purchasedSeats,
    periodEndUnix,
    mustThrow,
  };
}
