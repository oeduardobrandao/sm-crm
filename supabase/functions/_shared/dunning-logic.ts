// Pure helpers for the dunning episode. No Stripe/Supabase/env dependencies — unit-testable in
// isolation, mirroring billing-logic.ts.

export type DunningStage = "first" | "retry" | "final";

/**
 * Picks the escalation stage for a failed invoice.
 *
 * `nextPaymentAttempt === null` is Stripe stating it will not retry again. That, and not a
 * hardcoded attempt count, is the "final notice" signal: the retry schedule is configured in the
 * Stripe dashboard and can change without a deploy.
 */
export function selectDunningStage(
  attemptCount: number,
  nextPaymentAttempt: number | null,
): DunningStage {
  if (nextPaymentAttempt === null) return "final";
  if (attemptCount <= 1) return "first";
  return "retry";
}

export interface DunningEpisode {
  past_due_since: string | null;
  next_payment_attempt: string | null;
  failed_payment_count: number;
}

/**
 * Fields to write on invoice.payment_failed. `past_due_since` coalesces against its own prior
 * value so a redelivered webhook never restarts the episode clock.
 *
 * @param nextPaymentAttempt Stripe's unix seconds, or null when it will not retry again.
 */
export function buildFailureEpisode(
  existingPastDueSince: string | null,
  attemptCount: number,
  nextPaymentAttempt: number | null,
  now: Date,
): DunningEpisode {
  return {
    past_due_since: existingPastDueSince ?? now.toISOString(),
    next_payment_attempt:
      nextPaymentAttempt === null ? null : new Date(nextPaymentAttempt * 1000).toISOString(),
    failed_payment_count: attemptCount,
  };
}

/** Fields to write when Stripe reports the subscription healthy again. */
export function buildRecoveryEpisode(): DunningEpisode {
  return { past_due_since: null, next_payment_attempt: null, failed_payment_count: 0 };
}

/** Statuses that mean the dunning episode is over. */
export function isRecoveredStatus(status: string): boolean {
  return status === "active" || status === "trialing";
}
