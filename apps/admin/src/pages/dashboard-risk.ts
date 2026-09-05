/**
 * Pure helpers behind the Dashboard "Atenção" card. `now` is always injected so the
 * selectors and labels are deterministic in tests.
 */
const DAY_MS = 86_400_000;

export const TRIAL_ENDING_SOON_DAYS = 3;

/** Calendar-day distance from `now` to `date` in the viewer's local zone; negative when in the past. */
function calendarDays(date: Date, now: Date): number {
  const local = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((local(date) - local(now)) / DAY_MS);
}

export function selectTrialsEndingSoon<T extends { trial_ends_at: string | null }>(
  trials: T[],
  now: Date,
  days: number = TRIAL_ENDING_SOON_DAYS,
): T[] {
  const from = now.getTime();
  const to = from + days * DAY_MS;
  return trials
    .filter((t): t is T & { trial_ends_at: string } => t.trial_ends_at !== null)
    .map((t) => ({ t, ends: new Date(t.trial_ends_at).getTime() }))
    .filter(({ ends }) => Number.isFinite(ends) && ends >= from && ends <= to)
    .sort((a, b) => a.ends - b.ends)
    .map(({ t }) => t);
}

export function trialDeadlineLabel(trialEndsAt: string, now: Date): string {
  const days = calendarDays(new Date(trialEndsAt), now);
  if (days <= 0) return 'hoje';
  if (days === 1) return 'amanhã';
  return `em ${days} dias`;
}

export function pendingLabel(
  sub:
    | { failed_payment_count?: number | null; current_period_end?: string | null }
    | null
    | undefined,
  now: Date,
): string {
  if (!sub) return '—';
  const attempts = sub.failed_payment_count ?? 0;
  if (attempts > 0) return `${attempts}ª tentativa`;
  if (!sub.current_period_end) return '—';
  const days = calendarDays(new Date(sub.current_period_end), now);
  if (days === 0) return 'vence hoje';
  if (days > 0) return `vence em ${days} ${days === 1 ? 'dia' : 'dias'}`;
  const ago = -days;
  return `venceu há ${ago} ${ago === 1 ? 'dia' : 'dias'}`;
}
