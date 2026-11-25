// Pure logic of the reverse-trial funnel card on the Admin dashboard (spec Part 8). The
// database is the source of truth: the reverse_trial_* columns give started, card added,
// paid and outcome for every workspace; clientes and workflow_posts give activation.

export const ACTIVATION_DAYS = 7;
const DAY_MS = 86_400_000;

export interface FunnelTrialRow {
  id: string;
  is_internal: boolean | null;
  demo_created_at: string | null;
  plan_source: string | null;
  reverse_trial_started_at: string;
  reverse_trial_ended_at: string | null;
  reverse_trial_outcome: string | null;
  reverse_trial_card_added_at: string | null;
  reverse_trial_first_paid_at: string | null;
}

export interface CreatedRow {
  conta_id: string;
  created_at: string;
}

export interface ReverseTrialFunnel {
  /** Every reverse trial ever started (internal and demo workspaces excluded). */
  started: number;
  /** Still in the trial right now (plan_source = 'trial'). */
  running: number;
  /** Started at least ACTIVATION_DAYS ago: the fair denominator for activation. */
  matured_d7: number;
  /**
   * At least one client and one post created within ACTIVATION_DAYS of the start. A trial
   * younger than that counts as soon as it has both; one that has neither yet does not count.
   */
  activated_d7: number;
  card_added: number;
  /** Paid after the first charge (reverse_trial_first_paid_at). */
  paid: number;
  downgraded: number;
  ended_by_admin: number;
}

/** Internal (seeded) and demo workspaces never count. */
export function isFunnelExcluded(row: Pick<FunnelTrialRow, "is_internal" | "demo_created_at" | "plan_source">): boolean {
  return row.is_internal === true || row.demo_created_at != null || row.plan_source === "demo";
}

/** The last instant that still counts as "by day 7" for a trial started at `startedAt`. */
export function activationCutoff(startedAt: string): number {
  return new Date(startedAt).getTime() + ACTIVATION_DAYS * DAY_MS;
}

function earliestByWorkspace(rows: CreatedRow[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of rows) {
    const t = new Date(r.created_at).getTime();
    if (Number.isNaN(t)) continue;
    const prev = out.get(r.conta_id);
    if (prev === undefined || t < prev) out.set(r.conta_id, t);
  }
  return out;
}

export function computeReverseTrialFunnel(
  trials: FunnelTrialRow[],
  clients: CreatedRow[],
  posts: CreatedRow[],
  now: Date,
): ReverseTrialFunnel {
  const firstClient = earliestByWorkspace(clients);
  const firstPost = earliestByWorkspace(posts);
  const f: ReverseTrialFunnel = {
    started: 0,
    running: 0,
    matured_d7: 0,
    activated_d7: 0,
    card_added: 0,
    paid: 0,
    downgraded: 0,
    ended_by_admin: 0,
  };
  for (const t of trials) {
    if (isFunnelExcluded(t)) continue;
    f.started++;
    if (t.plan_source === "trial" && !t.reverse_trial_ended_at) f.running++;
    const cutoff = activationCutoff(t.reverse_trial_started_at);
    if (now.getTime() >= cutoff) f.matured_d7++;
    const c = firstClient.get(t.id);
    const p = firstPost.get(t.id);
    if (c !== undefined && p !== undefined && c <= cutoff && p <= cutoff) f.activated_d7++;
    if (t.reverse_trial_card_added_at) f.card_added++;
    if (t.reverse_trial_first_paid_at) f.paid++;
    if (t.reverse_trial_outcome === "downgraded") f.downgraded++;
    if (t.reverse_trial_outcome === "ended_by_admin") f.ended_by_admin++;
  }
  return f;
}
