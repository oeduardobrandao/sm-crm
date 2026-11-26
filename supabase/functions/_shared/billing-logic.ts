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
  // An ex-demo workspace (Admin-created demo that was later converted) never gets a trial,
  // and neither does one that already had a reverse trial (14 days of Pro without a card):
  // that was its trial, so a later checkout charges at once.
  workspace?: { demo_created_at?: string | null; reverse_trial_started_at?: string | null } | null,
): boolean {
  return Boolean(
    row?.ever_subscribed_at || row?.stripe_subscription_id || row?.pagarme_subscription_id ||
      workspace?.demo_created_at || workspace?.reverse_trial_started_at,
  );
}

/**
 * Stripe Checkout's `subscription_data.trial_end` "has to be at least 48 hours in the future"
 * (https://docs.stripe.com/api/checkout/sessions/create, subscription_data.trial_end). Stripe
 * measures it when the request arrives, so the floor carries a 10-minute margin over the 48h:
 * a value computed as exactly now + 48h would already be under it by request time.
 */
export const STRIPE_MIN_TRIAL_END_MS = 48 * 3600 * 1000 + 10 * 60 * 1000;

/** Card trial length for a workspace that never had any trial (landing intent path). */
const CARD_TRIAL_DAYS = 30;

export type CheckoutTrial =
  | { kind: "reverse"; trialEnd: Date }
  | { kind: "days"; days: number }
  | { kind: "none" };

/**
 * Trial for a new checkout (spec 2026-11-24-reverse-trial-design.md, Part 4):
 *   - running reverse trial (plan_source 'trial'): no second trial on top; the first charge is
 *     on the trial end date, floored to Stripe's minimum (a last-day card gets up to ~2 extra
 *     days of Pro, accepted by the spec; see the floor comment for the extra hour);
 *   - reverse trial already used, or any previous subscription / ex-demo: no trial;
 *   - never had one: the 30-day card trial.
 */
export function resolveCheckoutTrial(
  ws: {
    plan_source?: string | null;
    reverse_trial_ends_at?: string | null;
    reverse_trial_started_at?: string | null;
    demo_created_at?: string | null;
  } | null | undefined,
  sub: Parameters<typeof hasEverSubscribed>[0],
  now: Date,
): CheckoutTrial {
  if (ws?.plan_source === "trial" && ws.reverse_trial_ends_at) {
    const ends = new Date(ws.reverse_trial_ends_at);
    // The floor is anchored to the END of the current hour, not to `now`: billing-checkout's
    // idempotency key is bucketed per hour, and reusing a key with a different trial_end is an
    // idempotency_error at Stripe. So within one hour two requests send the same value, always
    // at least STRIPE_MIN_TRIAL_END_MS (and at most one hour more) after `now`.
    const hourEnd = (Math.floor(now.getTime() / 3_600_000) + 1) * 3_600_000;
    const floor = new Date(hourEnd + STRIPE_MIN_TRIAL_END_MS);
    return { kind: "reverse", trialEnd: ends.getTime() > floor.getTime() ? ends : floor };
  }
  if (hasEverSubscribed(sub, ws)) return { kind: "none" };
  return { kind: "days", days: CARD_TRIAL_DAYS };
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

/**
 * Gate de quarentena (spec do switch, decisao 10): uma attempt `quarantined` marca uma
 * cobranca possivelmente NAO estornada em revisao manual. Diferente do gate de pending
 * acima (fail-open: pending expira sozinho em 15min), este FALHA FECHADO: um erro de
 * leitura bloqueia o checkout, porque liberar poderia cobrar o usuario de novo antes da
 * revisao.
 */
export function quarantinedAttemptBlocksCheckout(
  found: boolean,
  readError: { message: string } | null | undefined,
): boolean {
  if (readError) return true;
  return found;
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
 * Statuses that count toward MRR: only `active` — revenue actually being collected.
 * `trialing` is excluded — a trial pays nothing yet. Terminal states (canceled/unpaid/
 * incomplete_expired/paused) and `incomplete` (never charged) are excluded too. `past_due`
 * is excluded as well: the last charge FAILED, so until the provider's retries recover it
 * the revenue is not realized and would overstate MRR. Note the Crisp sync's `pagante`
 * segment (migration 20260804000011) deliberately still counts past_due — a delinquent
 * customer is still a customer to support — so it no longer mirrors this set.
 */
export const MRR_STATUSES = new Set(["active"]);

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

// ---------------------------------------------------------------------------
// USD billing: checkout pins the workspace currency
// ---------------------------------------------------------------------------

/** Billing currency of a workspace (workspaces.billing_currency). */
export type BillingCurrency = "brl" | "usd";

/** Narrows a DB/RPC value to BillingCurrency; anything else is null (callers fail closed). */
export function parseBillingCurrency(value: unknown): BillingCurrency | null {
  return value === "brl" || value === "usd" ? value : null;
}

/**
 * billing-checkout runs every refusal with the currency it READ, and only then locks it. True
 * when the lock returned anything other than that value (a concurrent change between the read
 * and the lock, or an unknown value): the checkout must stop before creating anything.
 */
export function lockedCurrencyMismatch(read: BillingCurrency, locked: unknown): boolean {
  return parseBillingCurrency(locked) !== read;
}

/** True when the plan has a positive USD amount (cents) for the chosen interval. */
export function usdPriceConfigured(
  plan: { price_usd: number | null; price_usd_annual: number | null },
  interval: "month" | "year",
): boolean {
  const cents = interval === "year" ? plan.price_usd_annual : plan.price_usd;
  return typeof cents === "number" && cents > 0;
}

/**
 * A Stripe customer gets a fixed currency on its first subscription/invoice and can never be
 * billed in another one. True when the customer already has a currency and it is not the
 * workspace's (a customer without a currency yet takes whatever this checkout pins).
 */
export function customerCurrencyConflict(
  customerCurrency: string | null | undefined,
  workspaceCurrency: BillingCurrency,
): boolean {
  if (!customerCurrency) return false;
  return customerCurrency.toLowerCase() !== workspaceCurrency;
}

/** Checkout page language: English for USD workspaces, Portuguese for BRL. */
export function checkoutLocale(currency: BillingCurrency): "en" | "pt-BR" {
  return currency === "usd" ? "en" : "pt-BR";
}

/**
 * Stripe Checkout session parameters for billing-checkout. `currency` is ALWAYS sent: once the
 * live prices carry a USD currency_options entry, Checkout would otherwise pick the currency
 * from the buyer's location (a Brazilian workspace could be billed in USD and vice versa).
 */
export function buildCheckoutSessionParams(args: {
  customerId: string;
  workspaceId: string;
  planId: string;
  priceId: string;
  trial: CheckoutTrial;
  currency: BillingCurrency;
  successUrl: string;
  cancelUrl: string;
}) {
  const { trial } = args;
  return {
    mode: "subscription" as const,
    customer: args.customerId,
    client_reference_id: args.workspaceId,
    line_items: [{ price: args.priceId, quantity: 1 }],
    subscription_data: {
      metadata: { workspace_id: args.workspaceId, plan_id: args.planId },
      ...(trial.kind === "reverse"
        ? { trial_end: Math.floor(trial.trialEnd.getTime() / 1000) }
        : trial.kind === "days"
        ? { trial_period_days: trial.days }
        : {}),
    },
    // Stripe's own promo box stays open for any real future coupon.
    allow_promotion_codes: true,
    // Always collect the card: a trial has to convert on day 30.
    payment_method_collection: "always" as const,
    success_url: args.successUrl,
    cancel_url: args.cancelUrl,
    currency: args.currency,
    locale: checkoutLocale(args.currency),
  };
}
