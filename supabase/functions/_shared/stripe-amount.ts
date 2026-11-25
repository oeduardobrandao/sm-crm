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
  currency?: string | null;
  currency_options?: Record<string, { amount_off?: number | null }> | null;
};

export const STRIPE_AMOUNT_EXPAND = [
  "items.data.price",
  "items.data.price.currency_options",
  "discounts",
];
export const STRIPE_LIST_AMOUNT_EXPAND = [
  "data.discounts",
  "data.items.data.price.currency_options",
];

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
 * The mirror columns reset to "not priced yet". Used when a refresh fails on an
 * event that may have changed the price: a kept stale amount would read as
 * authoritative forever (readers skip live fetches for priced rows), while a
 * cleared row is re-priced and written back on the next admin read.
 */
export function clearedAmountColumns() {
  return {
    amount_cents: null,
    gross_cents: null,
    currency: null,
    amount_interval: null,
    discount_label: null,
    amount_refreshed_at: null,
  };
}

/**
 * Pure: what a subscription object charges per interval, net of its active coupon. Shared by
 * fetchStripeAmount (live retrieve) and the metrics backfill (subscriptions.list pages).
 */
export function stripeAmountFromSubscription(
  sub: unknown,
  fallbackInterval: string | null,
): StripeAmount {
  const s = sub as {
    livemode?: boolean;
    currency?: string | null;
    items?: {
      data?: Array<{
        quantity?: number;
        price?: {
          unit_amount?: number | null;
          currency?: string;
          currency_options?: Record<string, { unit_amount?: number | null }> | null;
          recurring?: { interval?: string };
        };
      }>;
    };
  };
  const item = s.items?.data?.[0];
  const qty = item?.quantity ?? 1;
  const currency = (s.currency ?? item?.price?.currency ?? "brl").toLowerCase();
  const optionAmount = item?.price?.currency_options?.[currency]?.unit_amount;
  const unit =
    typeof optionAmount === "number"
      ? optionAmount
      : currency === (item?.price?.currency ?? "brl").toLowerCase()
        ? (item?.price?.unit_amount ?? 0)
        : 0;
  const gross = unit * qty;
  const coupon = extractCoupon(sub);
  let net = gross;
  let discountLabel: string | null = null;
  if (coupon) {
    if (typeof coupon.percent_off === "number" && coupon.percent_off > 0) {
      net = Math.round(gross * (1 - coupon.percent_off / 100));
      discountLabel = `${coupon.name ?? coupon.id} −${trimPercent(coupon.percent_off)}%`;
    } else {
      // amount_off is denominated in the coupon's currency (or a per-currency option).
      const option = coupon.currency_options?.[currency]?.amount_off;
      const off =
        typeof option === "number"
          ? option
          : !coupon.currency || coupon.currency.toLowerCase() === currency
            ? coupon.amount_off
            : null;
      if (typeof off === "number" && off > 0) {
        net = Math.max(0, gross - off);
        discountLabel = coupon.name ?? coupon.id;
      } else if (typeof coupon.amount_off === "number" && coupon.amount_off > 0) {
        console.warn("[stripe-amount] amount_off coupon skipped: currency mismatch");
      }
    }
  }
  return {
    amount_cents: net,
    gross_cents: net !== gross ? gross : null,
    currency,
    interval: item?.price?.recurring?.interval ?? fallbackInterval,
    discount_label: discountLabel,
    livemode: s.livemode ?? true,
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
      { expand: STRIPE_AMOUNT_EXPAND },
      { timeout: STRIPE_TIMEOUT_MS },
    );
  } catch (_e) {
    // Some API versions reject expanding `discounts`; retry with price only.
    sub = await stripe.subscriptions.retrieve(
      subscriptionId,
      { expand: ["items.data.price", "items.data.price.currency_options"] },
      { timeout: STRIPE_TIMEOUT_MS },
    );
  }
  return stripeAmountFromSubscription(sub, fallbackInterval);
}
