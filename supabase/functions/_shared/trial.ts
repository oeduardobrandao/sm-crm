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
 * Where Stripe returns the user. The caller supplies a SOURCE, never a URL, and
 * anything unrecognised falls back to billing — so a hostile request body cannot
 * turn this into an open redirect.
 */
export function resolveReturnPaths(source: unknown): ReturnPaths {
  return source === "onboarding" ? RETURN_PATHS.onboarding : RETURN_PATHS.billing;
}

/**
 * Idempotency key for checkout session creation. Two tabs racing inside the same
 * hour get the SAME Stripe session back rather than two separately completable
 * ones. The hour bucket stops a legitimate later retry from being pinned to a
 * stale session (Stripe retains keys for 24h).
 */
export function buildCheckoutIdempotencyKey(
  workspaceId: string,
  planId: string,
  interval: string,
  nowMs: number,
): string {
  const bucket = Math.floor(nowMs / 3_600_000);
  return `co_${workspaceId}_${planId}_${interval}_${bucket}`;
}
