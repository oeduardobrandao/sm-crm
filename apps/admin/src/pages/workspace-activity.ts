/**
 * How recently a workspace was actually used, for the Workspaces list.
 *
 * "Activity" is the newest entry in audit_log for the workspace — real work (approvals,
 * edits, deletions, MCP, Estúdio), not sign-ins. Sign-in time would misinform here: Supabase
 * only updates it on an actual sign-in, so a workspace used daily on a persistent session
 * would read as months idle.
 */

export type ActivityTone = 'active' | 'cooling' | 'dormant';

/** Text colour per tone, shared by every list that renders an activity cell. */
export const ACTIVITY_TONE_CLASS: Record<ActivityTone, string> = {
  active: 'text-foreground',
  cooling: 'text-muted-foreground',
  dormant: 'text-warning',
};

export interface ActivityDescription {
  label: string;
  tone: ActivityTone;
  /** Exact timestamp behind the relative label, for the hover tooltip. */
  title: string;
}

const DAY_MS = 86_400_000;
const ACTIVE_MAX_DAYS = 7;
const COOLING_MAX_DAYS = 30;

const relative = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });

// No timeZone is pinned: the exact date is rendered in the viewer's own zone, which is what
// an admin reading it expects.
const exact = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: 'long',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function wholeDaysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

function relativeLabel(days: number): string {
  // Counted in days through the dormant cutoff so the label changes exactly where the tone
  // does. Rounding to months any earlier printed the same text ("mês passado") for both a
  // cooling and a dormant row, leaving the colour as the only difference.
  if (days <= COOLING_MAX_DAYS) return relative.format(-days, 'day');
  if (days < 365) return relative.format(-Math.floor(days / 30), 'month');
  return relative.format(-Math.floor(days / 365), 'year');
}

/**
 * @param lastActivityAt newest audit_log entry for the workspace, or null if it never acted
 * @param createdAt      when the workspace itself was created
 * @param now            injected so callers stay deterministic and testable
 */
export function describeActivity(
  lastActivityAt: string | null,
  createdAt: string,
  now: Date,
): ActivityDescription {
  if (lastActivityAt === null) {
    // A workspace created moments ago has not had a chance to be used, so it is unproven
    // rather than abandoned. It is still never "active" — nothing has happened in it.
    const age = wholeDaysBetween(new Date(createdAt), now);
    return {
      label: 'Nunca',
      tone: age > COOLING_MAX_DAYS ? 'dormant' : 'cooling',
      title: 'Nenhuma atividade registrada',
    };
  }

  const at = new Date(lastActivityAt);
  const days = wholeDaysBetween(at, now);
  const tone: ActivityTone =
    days <= ACTIVE_MAX_DAYS ? 'active' : days <= COOLING_MAX_DAYS ? 'cooling' : 'dormant';

  return { label: relativeLabel(days), tone, title: exact.format(at) };
}
