// Pure bucketing for the weekly retention radar. No Supabase/env dependencies.
//
// THRESHOLDS ARE MIRRORED FROM apps/admin/src/pages/workspace-activity.ts (describeActivity).
// They cannot be imported — that module is browser code using Intl for its labels, and this runs
// in Deno — so if you change one, change the other. The radar and the admin Workspaces list
// disagreeing about who is dormant would make both untrustworthy.

const DAY_MS = 86_400_000;
const ACTIVE_MAX_DAYS = 7;
const COOLING_MAX_DAYS = 30;
const TRIAL_ENDING_DAYS = 7;

export type RadarBucket = "past_due" | "trial_ending" | "dormant" | "cooling";

export interface RadarInput {
  status: string | null;
  currentPeriodEnd: string | null;
  lastActivityAt: string | null;
  createdAt: string;
}

function wholeDaysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

/**
 * The single worst signal for a workspace, or null when it looks healthy.
 *
 * Precedence is most-urgent-first so a workspace appears exactly once in the digest: a past_due
 * workspace that is also dormant is a billing problem first.
 */
export function bucketWorkspace(row: RadarInput, now: Date): RadarBucket | null {
  if (row.status === "past_due") return "past_due";

  if (row.status === "trialing" && row.currentPeriodEnd) {
    const daysLeft = wholeDaysBetween(now, new Date(row.currentPeriodEnd));
    if (daysLeft <= TRIAL_ENDING_DAYS) return "trial_ending";
  }

  if (row.lastActivityAt === null) {
    const age = wholeDaysBetween(new Date(row.createdAt), now);
    return age > COOLING_MAX_DAYS ? "dormant" : "cooling";
  }

  const days = wholeDaysBetween(new Date(row.lastActivityAt), now);
  if (days <= ACTIVE_MAX_DAYS) return null;
  if (days <= COOLING_MAX_DAYS) return "cooling";
  return "dormant";
}
