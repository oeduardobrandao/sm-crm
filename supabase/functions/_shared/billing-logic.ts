// Pure helpers for mapping Stripe subscription state to effective plans.
// No Stripe/Supabase/env dependencies — unit-testable in isolation.

import { SupabaseClient } from "npm:@supabase/supabase-js@2";

const DB_TIMEOUT_MS = 10_000;

/**
 * The plan a workspace falls back to when it loses its paid subscription. Throws on a read
 * ERROR (a transient failure must not silently downgrade someone to "free"); returns "free"
 * only when the query succeeds and no default plan exists.
 */
export async function getDefaultPlanId(db: SupabaseClient): Promise<string> {
  const { data, error } = await db
    .from("plans")
    .select("id")
    .eq("is_default", true)
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
    .maybeSingle();
  if (error) throw new Error(`default plan read failed: ${error.message}`);
  return (data?.id as string) ?? "free";
}

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

/**
 * Plan ids the Pagar.me 12x checkout flow (pagarme-checkout) actually accepts. Single source
 * of truth, shared by that function's own request-parsing gate and by plan-mutations'
 * `validatePagarme12x`: without the admin-side check mirroring this list, enabling
 * `pagarme_12x_enabled` on any other plan id (e.g. a comp/enterprise row) passes plan-mutations
 * validation and then every checkout for that plan 400s "Plano inválido." at the gateway.
 */
export const PAGARME_PAID_PLAN_IDS = ["start", "pro", "max"] as const;

/**
 * Fase 8: Stripe annual à vista now coexists with the Pagar.me 12x (the Fase 2 rejection of
 * `interval === 'year'` on a pagarme_12x_enabled plan is removed) — this decision moved from
 * "should the checkout even be attempted" to "is a Pagar.me attempt for this workspace mid-
 * flight right now."
 *
 * Cross-provider race narrower (accepted external finding): a bounded, best-effort read of
 * `pagarme_checkout_attempts` for the workspace immediately before opening a Stripe session.
 * A read ERROR fails OPEN (returns false, i.e. proceed) — availability wins over closing a
 * seconds-wide race window; the Fase 4 webhook deny+cancel hardening is the backstop for a
 * Stripe session that completes after a pagarme bind (unavoidable once a session is open,
 * since Stripe sessions live up to 24h).
 */
export function pendingPagarmeAttemptBlocksCheckout(
  hasPendingAttempt: boolean,
  readError: { message: string } | null | undefined,
): boolean {
  if (readError) return false;
  return hasPendingAttempt;
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

// ─── Invoice → subscription id ─────────────────────────────────────────────

export interface InvoiceSubscriptionSource {
  subscription?: string | { id?: string | null } | null;
  parent?: {
    subscription_details?: { subscription?: string | { id?: string | null } | null } | null;
  } | null;
}

/**
 * Extracts the subscription id from a Stripe invoice payload. Webhook payloads use the
 * ACCOUNT's API version regardless of the SDK pin: older versions (acacia) carry
 * `invoice.subscription` at the root, basil (2025-03-31+) moved it to
 * `invoice.parent.subscription_details.subscription`, and either shape may be an expanded
 * object instead of a string. Null means the invoice is not tied to a subscription.
 */
export function extractInvoiceSubscriptionId(invoice: InvoiceSubscriptionSource): string | null {
  const raw = invoice.subscription ?? invoice.parent?.subscription_details?.subscription ?? null;
  if (raw == null) return null;
  return typeof raw === "string" ? raw : (raw.id ?? null);
}
