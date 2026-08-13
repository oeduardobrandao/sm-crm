// Pure helpers for Pagar.me subscription/webhook state. No network/env/Supabase dependencies —
// unit-testable in isolation, mirroring billing-logic.ts and dunning-logic.ts.
//
// Pagar.me's documented statuses are future | active | canceled. `failed` is an undocumented
// fourth status observed when a subscription's first charge fails — no plan was ever granted in
// that case, so treating it as canceled is safe.

import { PagarmeApiError } from "./pagarme.ts";

/** Maps a raw Pagar.me subscription status to our internal status, or null for an unknown value
 * (the caller logs and does not write). `future` (a subscription with a future start_at) is our
 * trial state — we never persist the literal "future". */
export function normalizePagarmeStatus(
  remote: string,
): "trialing" | "active" | "canceled" | null {
  switch (remote) {
    case "future":
      return "trialing";
    case "active":
      return "active";
    case "canceled":
    case "failed":
      return "canceled";
    default:
      return null;
  }
}

/** Statuses that mean the subscription currently grants access. */
export function isInForce(status: string | null | undefined): boolean {
  return status === "active" || status === "trialing" || status === "past_due";
}

/**
 * A canceled subscriber who already paid through the current period keeps access until it ends
 * (e.g. a 12x installment subscriber who canceled after paying the full year). The eventual
 * downgrade at period end is the cron's job, not the webhook's.
 */
export function isPaidThrough(
  row: {
    status?: string | null;
    cancel_at_period_end?: boolean | null;
    current_period_end?: string | null;
  },
  now: Date,
): boolean {
  if (row.status !== "canceled") return false;
  if (!row.cancel_at_period_end) return false;
  if (!row.current_period_end) return false;
  return new Date(row.current_period_end).getTime() > now.getTime();
}

/**
 * Central ownership rule: a webhook never switches the provider a row belongs to. Rebinding
 * (first bind, or reclaiming a row after a churn) only ever happens on an authorized checkout
 * event (`isAuthorizedBind`) — and only a Stripe checkout can perform that rebind. Pagar.me
 * binds its rows synchronously during checkout, not via webhook, so a webhook arriving for a
 * row Pagar.me has not already bound is either a checkout-write race (resolved by a retry) or a
 * subscription this workspace does not own (dies after Pagar.me's retry budget is exhausted).
 */
export function canWebhookWrite(
  existing: {
    provider?: string | null;
    stripe_subscription_id?: string | null;
    pagarme_subscription_id?: string | null;
    status?: string | null;
    cancel_at_period_end?: boolean | null;
    current_period_end?: string | null;
  } | null,
  incoming: { provider: "stripe" | "pagarme"; subscriptionId: string; isAuthorizedBind?: boolean },
  now: Date,
): boolean {
  if (existing === null) {
    return incoming.provider === "stripe" && incoming.isAuthorizedBind === true;
  }

  const sameProvider = existing.provider === incoming.provider;

  if (!sameProvider) {
    // The row's current owner still has (or already paid through) access under its own
    // provider — a late/foreign event from the other provider must never touch it.
    if (isInForce(existing.status) || isPaidThrough(existing, now)) return false;
    // Owner churned with nothing owed: only an authorized Stripe checkout may reclaim the row.
    return incoming.provider === "stripe" && incoming.isAuthorizedBind === true;
  }

  const registeredId = incoming.provider === "stripe"
    ? existing.stripe_subscription_id
    : existing.pagarme_subscription_id;

  if (registeredId == null) {
    return incoming.isAuthorizedBind === true; // first bind for this provider
  }

  if (registeredId === incoming.subscriptionId) return true;

  return incoming.isAuthorizedBind === true; // rebind (e.g. a new subscription after churn)
}

/**
 * Whether an existing subscription row owned by the OTHER provider blocks opening a new
 * checkout with `requestingProvider`. Symmetric guard used by billing-checkout (stripe) and
 * pagarme-checkout (pagarme): while the row's owner is in force (active/trialing/past_due)
 * or canceled-but-paid-through, completing a checkout with the other provider would create a
 * subscription whose webhook bind canWebhookWrite must then DENY (cross-provider in-force or
 * paid-through beats isAuthorizedBind), stranding a paid subscription with no plan granted.
 * Refusing up front is the only safe answer. Rows without a provider predate the column and
 * belong to Stripe. The caller keeps its own same-provider status rules; this function only
 * answers the cross-provider question.
 */
export function crossProviderCheckoutBlocked(
  requestingProvider: "stripe" | "pagarme",
  row:
    | {
      provider?: string | null;
      status?: string | null;
      cancel_at_period_end?: boolean | null;
      current_period_end?: string | null;
    }
    | null
    | undefined,
  now: Date,
): boolean {
  if (!row) return false;
  if ((row.provider ?? "stripe") === requestingProvider) return false;
  return isInForce(row.status) || isPaidThrough(row, now);
}

/**
 * Resolves the effective plan for a normalized Pagar.me status, mirroring the semantics of
 * `statusToPlanId` in billing-logic.ts. Returns null to mean "leave plan_id unchanged".
 */
export function resolvePagarmePlanTarget(
  status: "trialing" | "active" | "canceled" | "past_due",
  subscribedPlanId: string,
  defaultPlanId: string,
  row: { cancel_at_period_end?: boolean | null; current_period_end?: string | null },
  now: Date,
): string | null {
  switch (status) {
    case "trialing":
    case "active":
      return subscribedPlanId;
    case "past_due":
      return null; // grace, like statusToPlanId
    case "canceled":
      return isPaidThrough({ ...row, status }, now) ? null : defaultPlanId;
  }
}

/**
 * Maps a raw Pagar.me subscription payload to the fields we mirror locally. `current_period_end`
 * for a `future` subscription is `start_at` — the boundary of our trial is its first charge.
 * Sandbox observation: a `future` subscription carries neither `next_billing_at` nor
 * `current_cycle`, so `active` is the only status that reads them.
 * Callers must never overwrite a stored current_period_end with this null on cancellation: paid-through detection (isPaidThrough) depends on the retained value.
 */
export function mapPagarmeTemporalFields(sub: {
  status: string;
  start_at?: string | null;
  next_billing_at?: string | null;
  current_cycle?: { end_at?: string | null } | null;
}): { current_period_end: string | null } {
  if (sub.status === "future") {
    return { current_period_end: sub.start_at ?? null };
  }
  if (sub.status === "active") {
    return { current_period_end: sub.current_cycle?.end_at ?? sub.next_billing_at ?? null };
  }
  return { current_period_end: null };
}

/**
 * Dedup key for a charge-failure dunning advance. Sandbox never produces a failure payload, so
 * the key is built only from what is stable across a redelivery: the charge id and the attempt
 * number (when Pagar.me reports one).
 */
export function buildChargeDunningKey(chargeId: string, attempt: number | null | undefined): string {
  return `${chargeId}:${attempt ?? "na"}`;
}

/**
 * True only when the incoming charge+attempt key should advance the dunning stage. A repeated
 * key is a redelivery and never advances. When both keys carry the SAME charge id and numeric
 * attempts, only a HIGHER attempt advances: an out-of-order delivery of attempt 1 arriving
 * after attempt 2 must not regress the stored key (a later redelivery of attempt 2 would then
 * advance and e-mail again). Different charge ids or non-numeric attempts ("na") cannot be
 * ordered and keep the plain inequality rule.
 */
export function shouldAdvanceDunning(
  lastKey: string | null | undefined,
  incomingKey: string,
): boolean {
  if (lastKey === incomingKey) return false;
  if (!lastKey) return true;
  const lastSep = lastKey.lastIndexOf(":");
  const inSep = incomingKey.lastIndexOf(":");
  if (lastSep === -1 || inSep === -1) return true;
  if (lastKey.slice(0, lastSep) !== incomingKey.slice(0, inSep)) return true;
  const lastAttempt = Number(lastKey.slice(lastSep + 1));
  const inAttempt = Number(incomingKey.slice(inSep + 1));
  if (!Number.isFinite(lastAttempt) || !Number.isFinite(inAttempt)) return true;
  return inAttempt > lastAttempt;
}

/**
 * Enforcement arm of the cross-provider guard, for the ONE event where deny is not enough:
 * checkout.session.completed. With a session present, canWebhookWrite(..., isAuthorizedBind:
 * true) only returns false on the cross-provider in-force/paid-through branch — meaning the
 * customer just PAID for a brand-new Stripe subscription that will never be bound (a Stripe
 * Checkout Session lives 24h, so serializing checkout STARTS cannot prevent this completion).
 * The just-created subscription must be canceled, not acked. A terminal remote status like
 * `canceled` or `incomplete_expired` means there is nothing left to cancel: ack instead.
 */
// Stripe statuses a subscription can no longer be canceled FROM — it is already terminal.
// A denied checkout redelivered after Stripe expired the unpaid sub (incomplete -> ~23h ->
// incomplete_expired) or after our own earlier cancel (canceled) has nothing left to cancel;
// calling subscriptions.cancel on it throws and would 5xx-loop the webhook forever. Ack instead.
const RESOLVED_STRIPE_STATUSES = new Set(["canceled", "incomplete_expired"]);

export function shouldCancelDeniedCheckoutSub(
  hasSession: boolean,
  remoteStatus: string,
): boolean {
  return hasSession && !RESOLVED_STRIPE_STATUSES.has(remoteStatus);
}

/**
 * True when a gateway error is a DEFINITIVE 4xx statement about the target resource —
 * i.e. a DELETE that failed because the subscription is already canceled/gone. 401/403
 * (our credentials) and 429 (throttled) say nothing about the resource and are NOT
 * definitive; neither are 5xx/network/timeout errors.
 */
export function isDefinitiveGatewayReject(err: unknown): boolean {
  return err instanceof PagarmeApiError &&
    err.status >= 400 && err.status < 500 &&
    err.status !== 401 && err.status !== 403 && err.status !== 429;
}

/** A remote subscription younger than this is never swept: it may be a checkout mid-flight. */
export const SWEEP_MIN_AGE_MS = 60 * 60 * 1000;

export type SweepVerdict =
  | "cancel"
  | "skip_linked"
  | "skip_pending_attempt"
  | "skip_young"
  | "skip_unrecognized";

/**
 * Decides the fate of one remote Pagar.me subscription during the orphan sweep.
 * - linked locally (any workspace_subscriptions row, any provider) -> skip_linked
 * - referenced by a PENDING checkout attempt -> skip_pending_attempt (mid-recovery; the
 *   checkout self-heal or the stale-attempt leg owns it)
 * - created less than SWEEP_MIN_AGE_MS ago -> skip_young (racing an in-flight checkout)
 * - no metadata.workspace_id -> skip_unrecognized (not created by our checkout; a manual
 *   dashboard subscription is not ours to cancel — logged loudly, never touched)
 * - otherwise -> cancel (an orphan our checkout created but never bound)
 */
export function shouldSweepRemoteSubscription(
  sub: {
    id: string;
    created_at?: string | null;
    metadata?: { workspace_id?: string | null } | null;
  },
  linkedSubIds: ReadonlySet<string>,
  pendingAttemptSubIds: ReadonlySet<string>,
  now: Date,
): SweepVerdict {
  if (linkedSubIds.has(sub.id)) return "skip_linked";
  if (pendingAttemptSubIds.has(sub.id)) return "skip_pending_attempt";
  const created = sub.created_at ? Date.parse(sub.created_at) : NaN;
  if (Number.isNaN(created) || now.getTime() - created < SWEEP_MIN_AGE_MS) {
    // An unparseable created_at is treated as young: never cancel on missing evidence.
    return "skip_young";
  }
  if (!sub.metadata?.workspace_id) return "skip_unrecognized";
  return "cancel";
}
