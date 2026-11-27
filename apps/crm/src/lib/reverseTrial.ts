/**
 * Pure helpers for the reverse trial (14 days of Pro without a card). Spec:
 * docs/superpowers/specs/2026-11-24-reverse-trial-design.md, Parts 3 and 5.
 *
 * Days left are whole São Paulo calendar days between today and the end date, so the number
 * only goes down as time passes and `last_day` is exactly "the end is today in São Paulo".
 */

import { getIntlLocale } from '@mesaas/i18n';

export type ReverseTrialOutcome = 'converted' | 'downgraded' | 'ended_by_admin';

export interface ReverseTrialState {
  startedAt: string | null;
  endsAt: string | null;
  endedAt: string | null;
  outcome: ReverseTrialOutcome | null;
  cardAddedAt: string | null;
  firstPaidAt: string | null;
}

export type ReverseTrialPhase = 'normal' | 'ending' | 'last_day' | 'ended';

export const REVERSE_TRIAL_TIME_ZONE = 'America/Sao_Paulo';
export const HUB_PAUSE_DAYS = 7;
export const ADD_CARD_PATH = '/comecar?recomendado=pro';

const DAY_MS = 86_400_000;

const dateKeyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: REVERSE_TRIAL_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Calendar date in São Paulo as a UTC-midnight timestamp, for whole-day arithmetic. */
function saoPauloDayStamp(date: Date): number {
  const parts = dateKeyFormatter.formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(get('year'), get('month') - 1, get('day'));
}

export function reverseTrialPhase(
  now: Date,
  endsAt: string,
): { phase: ReverseTrialPhase; daysLeft: number } {
  const end = new Date(endsAt);
  if (Number.isNaN(end.getTime()) || now.getTime() >= end.getTime()) {
    return { phase: 'ended', daysLeft: 0 };
  }
  const daysLeft = Math.max(
    0,
    Math.round((saoPauloDayStamp(end) - saoPauloDayStamp(now)) / DAY_MS),
  );
  if (daysLeft === 0) return { phase: 'last_day', daysLeft };
  if (daysLeft <= 3) return { phase: 'ending', daysLeft };
  return { phase: 'normal', daysLeft };
}

/** Hub links of an ex-trial workspace pause this long after the trial ended. */
export function hubPauseDate(endedAt: string): Date {
  return new Date(new Date(endedAt).getTime() + HUB_PAUSE_DAYS * DAY_MS);
}

export function daysLeftLabel(n: number): string {
  return n === 1 ? '1 dia' : `${n} dias`;
}

/** "8 de dezembro" (pt) / "December 8" (en), in São Paulo. Built per call so it follows the UI language. */
export function formatTrialDate(value: string | Date): string {
  return new Intl.DateTimeFormat(getIntlLocale(), {
    timeZone: REVERSE_TRIAL_TIME_ZONE,
    day: 'numeric',
    month: 'long',
  }).format(typeof value === 'string' ? new Date(value) : value);
}

const hourFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: REVERSE_TRIAL_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** "14h" or "14h30", in São Paulo. */
export function formatTrialHour(value: string | Date): string {
  const parts = hourFormatter.formatToParts(typeof value === 'string' ? new Date(value) : value);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return minute === '00' ? `${hour}h` : `${hour}h${minute}`;
}

interface PlanLike {
  planId: string | null;
  planSource: string | null;
  reverseTrial?: ReverseTrialState | null;
}

/** The workspace is in a running reverse trial (`plan_source = 'trial'`). */
export function isReverseTrialRunning(plan: PlanLike | null | undefined): boolean {
  return Boolean(plan && plan.planSource === 'trial' && plan.reverseTrial?.endsAt);
}

/** The reverse trial ended by downgrade and the workspace is still on Free. */
export function isExReverseTrial(plan: PlanLike | null | undefined): boolean {
  if (!plan || plan.reverseTrial?.outcome !== 'downgraded') return false;
  if (plan.planSource === 'trial') return false;
  return (plan.planId ?? 'free') === 'free';
}
