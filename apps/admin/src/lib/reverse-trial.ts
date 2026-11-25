/**
 * Reverse trial (14 dias do Pro sem cartão) in the Admin: badge copy, dates in
 * America/Sao_Paulo and the extend-date math. Pure, so the timezone rules are unit-tested.
 *
 * Brazil abolished daylight saving time in 2019, so São Paulo is a fixed UTC-3 and plain
 * offset arithmetic is exact (same rule as supabase/functions/_shared/sao-paulo-date.ts).
 */

const SP_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

/** Longest a reverse trial may run, counted from its start. Mirrors platform-admin. */
export const MAX_TRIAL_DAYS = 30;

export type ReverseTrialOutcome = 'converted' | 'downgraded' | 'ended_by_admin';

export const OUTCOME_LABELS: Record<ReverseTrialOutcome, string> = {
  converted: 'virou pagante',
  downgraded: 'voltou ao Free',
  ended_by_admin: 'encerrado pelo admin',
};

export function isReverseTrial(planSource: string | null | undefined): boolean {
  return planSource === 'trial';
}

/** Calendar date (YYYY-MM-DD) in São Paulo at the given instant. */
export function spDate(iso: string | Date): string {
  const t = typeof iso === 'string' ? new Date(iso).getTime() : iso.getTime();
  return new Date(t - SP_OFFSET_MS).toISOString().slice(0, 10);
}

/** "2026-12-15" → "15/12/2026". */
export function formatDay(day: string): string {
  const [y, m, d] = day.split('-');
  return `${d}/${m}/${y}`;
}

/** "15/12/2026", the São Paulo calendar date of the instant. */
export function formatSpDate(iso: string): string {
  return formatDay(spDate(iso));
}

/** "Teste Pro sem cartão até 15/12/2026" (no date when the end is unknown). */
export function reverseTrialBadgeLabel(endsAt: string | null | undefined): string {
  return endsAt ? `Teste Pro sem cartão até ${formatSpDate(endsAt)}` : 'Teste Pro sem cartão';
}

/** "Teste sem cartão: voltou ao Free" for a trial that already ended; null otherwise. */
export function reverseTrialOutcomeLabel(outcome: string | null | undefined): string | null {
  if (!outcome || !(outcome in OUTCOME_LABELS)) return null;
  return `Teste sem cartão: ${OUTCOME_LABELS[outcome as ReverseTrialOutcome]}`;
}

/**
 * The new end instant for a picked São Paulo date: same wall-clock time as the current end,
 * so the countdown keeps its hour and day 30 lands exactly on the start + 30 days bound.
 */
export function extendEndsAt(pickedDate: string, currentEndsAt: string): string {
  const [y, m, d] = pickedDate.split('-').map(Number);
  const currentLocal = new Date(currentEndsAt).getTime() - SP_OFFSET_MS;
  const timeOfDay = ((currentLocal % DAY_MS) + DAY_MS) % DAY_MS;
  return new Date(Date.UTC(y, m - 1, d) + timeOfDay + SP_OFFSET_MS).toISOString();
}

/** Selectable São Paulo dates for the extend picker: tomorrow up to start + 30 days. */
export function extendDateBounds(startedAt: string, now: Date): { min: string; max: string } {
  return {
    min: spDate(new Date(now.getTime() + DAY_MS)),
    max: spDate(new Date(new Date(startedAt).getTime() + MAX_TRIAL_DAYS * DAY_MS)),
  };
}
