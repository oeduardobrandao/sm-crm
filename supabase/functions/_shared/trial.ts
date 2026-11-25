// Pure decisions for the trial-first checkout flow. No Stripe/Supabase/env
// dependencies — unit-testable in isolation, mirroring dunning-logic.ts.

export const TRIAL_DAYS = 30;

export type CheckoutSource = "onboarding" | "billing";

export interface ReturnPaths {
  success: string;
  cancel: string;
}

const RETURN_PATHS: Record<CheckoutSource, ReturnPaths> = {
  onboarding: {
    success: "/dashboard?trial=started",
    cancel: "/dashboard?trial=skipped",
  },
  billing: {
    success: "/configuracao/cobranca?status=success",
    cancel: "/configuracao/cobranca?status=cancelled",
  },
};

/**
 * Trial days for a checkout session, or undefined once the workspace has
 * subscribed before. Eligibility is per workspace and permanent: the webhook
 * only ever writes stripe_subscription_id and never clears it, so cancelling
 * does not buy a second trial.
 */
export function resolveTrialDays(hasPriorSubscription: boolean): number | undefined {
  return hasPriorSubscription ? undefined : TRIAL_DAYS;
}

/**
 * Normalises the request body's `source` to one of the two known values.
 * Anything unrecognised becomes "billing". Both the return paths and the
 * idempotency key are derived from THIS value, never from the raw body: keeping
 * them in lockstep is what stops a hostile body from minting an unbounded number
 * of distinct idempotency keys and defeating the duplicate-session guard.
 */
export function resolveCheckoutSource(source: unknown): CheckoutSource {
  return source === "onboarding" ? "onboarding" : "billing";
}

/**
 * Where Stripe returns the user. The caller supplies a SOURCE, never a URL, and
 * anything unrecognised falls back to billing — so a hostile request body cannot
 * turn this into an open redirect.
 */
export function resolveReturnPaths(source: unknown): ReturnPaths {
  return RETURN_PATHS[resolveCheckoutSource(source)];
}

/**
 * Idempotency key for checkout session creation. Two tabs racing inside the same
 * hour get the SAME Stripe session back rather than two separately completable
 * ones. The hour bucket stops a legitimate later retry from being pinned to a
 * stale session (Stripe retains keys for 24h).
 *
 * `source` is part of the key because it changes the request parameters: the
 * success/cancel URLs come from resolveReturnPaths(source). Stripe rejects a
 * reused key whose parameters differ (idempotency_error), so without this a user
 * who starts checkout from /comecar, cancels, then retries the same plan from
 * Plano e Cobrança would be hard-blocked for the rest of the hour.
 */
export function buildCheckoutIdempotencyKey(
  workspaceId: string,
  planId: string,
  interval: string,
  source: string,
  nowMs: number,
  // Trial state (checkoutTrialTag). It changes the request too (trial_end, trial_period_days
  // or nothing), and it can change inside the hour (reverse-trial cron, Admin end-now or
  // extension): without it the same key would carry different parameters and Stripe would
  // answer idempotency_error for the rest of the hour.
  trialTag = "",
): string {
  const bucket = Math.floor(nowMs / 3_600_000);
  const base = `co_${workspaceId}_${planId}_${interval}_${source}_${bucket}`;
  return trialTag ? `${base}_${trialTag}` : base;
}

/** Short, stable tag of a checkout's trial parameters, for buildCheckoutIdempotencyKey. */
export function checkoutTrialTag(
  trial: { kind: "reverse"; trialEnd: Date } | { kind: "days"; days: number } | { kind: "none" },
): string {
  if (trial.kind === "reverse") return `r${Math.floor(trial.trialEnd.getTime() / 1000)}`;
  if (trial.kind === "days") return `d${trial.days}`;
  return "n";
}
