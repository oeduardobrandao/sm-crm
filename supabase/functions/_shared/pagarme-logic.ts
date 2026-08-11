// Pure helpers for Pagar.me subscription/webhook state. No network/env/Supabase dependencies —
// unit-testable in isolation, mirroring billing-logic.ts and dunning-logic.ts.
//
// Pagar.me's documented statuses are future | active | canceled. `failed` is an undocumented
// fourth status observed when a subscription's first charge fails — no plan was ever granted in
// that case, so treating it as canceled is safe.

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
 * True only when the incoming charge+attempt key differs from the last one recorded — a real
 * retry advances the dunning stage; a redelivery of the same charge+attempt does not.
 */
export function shouldAdvanceDunning(
  lastKey: string | null | undefined,
  incomingKey: string,
): boolean {
  return lastKey !== incomingKey;
}
