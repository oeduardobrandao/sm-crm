/**
 * Live subscription pricing from Stripe: what the customer ACTUALLY pays,
 * with any active coupon applied. Extracted from platform-admin (trials MRR
 * work) so the lifecycle founder notices can reuse it. The local mirror
 * (workspace_subscriptions/plans) only knows catalog prices; discounts live
 * exclusively in Stripe.
 */

export type CouponLike = {
  id: string;
  name?: string | null;
  percent_off?: number | null;
  amount_off?: number | null;
};

/** Reads the active coupon off a subscription (handles both `discounts[]` and legacy `discount`). */
export function extractCoupon(sub: unknown): CouponLike | null {
  const s = sub as { discounts?: unknown; discount?: unknown };
  const d = Array.isArray(s.discounts) && s.discounts.length ? s.discounts[0] : s.discount;
  if (!d || typeof d === "string") return null;
  return (d as { coupon?: CouponLike }).coupon ?? null;
}

export function trimPercent(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(2)));
}

// The SDK's per-request `timeout` aborts the underlying fetch, so a stalled
// Stripe call can't run an edge isolate to its kill. Callers that fan out may
// additionally backstop the await (platform-admin's withTimeout).
export const STRIPE_TIMEOUT_MS = 5000;

export type StripeClient = {
  subscriptions: {
    retrieve: (
      id: string,
      params: { expand: string[] },
      options?: { timeout?: number },
    ) => Promise<unknown>;
  };
};

export type StripeAmount = {
  amount_cents: number;
  gross_cents: number | null;
  currency: string;
  interval: string | null;
  discount_label: string | null;
  livemode: boolean;
};

/**
 * Maps a live Stripe amount onto the workspace_subscriptions mirror columns
 * (migration 20260730000007), so admin reads price from the mirror instead of
 * calling Stripe on every page load.
 */
export function buildAmountColumns(amt: StripeAmount) {
  return {
    amount_cents: amt.amount_cents,
    gross_cents: amt.gross_cents,
    currency: amt.currency,
    amount_interval: amt.interval,
    discount_label: amt.discount_label,
    amount_refreshed_at: new Date().toISOString(),
  };
}

/**
 * Retrieves a subscription's current price from Stripe and applies any active coupon,
 * so the returned amount is what the customer actually pays. `fallbackInterval` is the
 * mirror's billing_interval, used when the price object doesn't carry a recurring interval.
 */
export async function fetchStripeAmount(
  stripe: StripeClient,
  subscriptionId: string,
  fallbackInterval: string | null,
): Promise<StripeAmount> {
  let sub: unknown;
  try {
    sub = await stripe.subscriptions.retrieve(
      subscriptionId,
      { expand: ["items.data.price", "discounts"] },
      { timeout: STRIPE_TIMEOUT_MS },
    );
  } catch (_e) {
    // Some API versions reject expanding `discounts`; retry with price only.
    sub = await stripe.subscriptions.retrieve(
      subscriptionId,
      { expand: ["items.data.price"] },
      { timeout: STRIPE_TIMEOUT_MS },
    );
  }
  const s = sub as {
    livemode?: boolean;
    items?: {
      data?: Array<{
        quantity?: number;
        price?: { unit_amount?: number | null; currency?: string; recurring?: { interval?: string } };
      }>;
    };
  };
  const item = s.items?.data?.[0];
  const qty = item?.quantity ?? 1;
  const gross = (item?.price?.unit_amount ?? 0) * qty;
  const coupon = extractCoupon(sub);
  let net = gross;
  let discountLabel: string | null = null;
  if (coupon) {
    if (typeof coupon.percent_off === "number" && coupon.percent_off > 0) {
      net = Math.round(gross * (1 - coupon.percent_off / 100));
      discountLabel = `${coupon.name ?? coupon.id} −${trimPercent(coupon.percent_off)}%`;
    } else if (typeof coupon.amount_off === "number" && coupon.amount_off > 0) {
      net = Math.max(0, gross - coupon.amount_off);
      discountLabel = coupon.name ?? coupon.id;
    }
  }
  return {
    amount_cents: net,
    gross_cents: net !== gross ? gross : null,
    currency: item?.price?.currency ?? "brl",
    interval: item?.price?.recurring?.interval ?? fallbackInterval,
    discount_label: discountLabel,
    livemode: s.livemode ?? true,
  };
}
