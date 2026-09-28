import { addMinutes, isBefore } from 'date-fns';
import type { BestPostingTimes } from '../../services/analytics';

/** Same floor as DateTimePicker's `futureOnly`: a suggestion earlier than this would land on a
 * disabled option in the picker. */
export const SUGGESTION_MIN_LEAD_MINUTES = 15;

/** Same threshold the Analytics page uses before it trusts the heatmap. */
export const SUGGESTION_MIN_POSTS = 5;

export interface BestTimeSlot {
  /** Monday = 0 … Sunday = 6, as returned by instagram-analytics /best-times. */
  day: number;
  hour: number;
  value: number;
  postCount: number;
}

export interface TimeSuggestion {
  date: Date;
  slot: BestTimeSlot;
}

/*
 * Slot math runs on "wall" Dates: a Date whose UTC fields read the São Paulo wall clock (see
 * toSaoPauloWall). UTC has no DST, so days are always 24h and every hour exists, whatever zone
 * the browser is in. Never use local-time date-fns helpers (startOfDay, setHours) on them.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Midnight of the wall date's day. */
function wallStartOfDay(wall: Date): Date {
  return new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate()));
}

/** Monday = 0 … Sunday = 6 (the endpoint's convention) of a wall date. */
export function mondayBasedWeekday(wall: Date): number {
  return (wall.getUTCDay() + 6) % 7;
}

/** First wall time at `slot.hour`:00 on `slot.day` that is not before `from`. */
export function nextOccurrence(slot: Pick<BestTimeSlot, 'day' | 'hour'>, from: Date): Date {
  const base = wallStartOfDay(from).getTime() + slot.hour * HOUR_MS;
  for (let i = 0; i <= 7; i++) {
    const candidate = new Date(base + i * DAY_MS);
    if (mondayBasedWeekday(candidate) === slot.day && !isBefore(candidate, from)) {
      return candidate;
    }
  }
  // Unreachable for a valid slot: 8 consecutive days always contain the weekday once after `from`.
  return new Date(base + 7 * DAY_MS);
}

/** Highest-engagement hour on `weekday`, considering only hours that actually had posts. */
export function bestSlotOnWeekday(data: BestPostingTimes, weekday: number): BestTimeSlot | null {
  const values = data.heatmap[weekday];
  const counts = data.counts[weekday];
  if (!values || !counts) return null;
  let best: BestTimeSlot | null = null;
  for (let hour = 0; hour < counts.length; hour++) {
    if (!(counts[hour] > 0)) continue;
    const value = values[hour] ?? 0;
    if (!best || value > best.value) best = { day: weekday, hour, value, postCount: counts[hour] };
  }
  return best;
}

export function hasEnoughData(data: BestPostingTimes | null | undefined): data is BestPostingTimes {
  return !!data && data.totalPosts >= SUGGESTION_MIN_POSTS && data.topSlots.length > 0;
}

/** America/Sao_Paulo is a fixed UTC-3 (no DST since 2019). */
const SAO_PAULO_OFFSET_MS = 3 * HOUR_MS;

/** Instant → wall Date whose UTC fields read the São Paulo clock. */
export function toSaoPauloWall(instant: Date): Date {
  return new Date(instant.getTime() - SAO_PAULO_OFFSET_MS);
}

/** Wall Date → the real instant to persist. */
export function fromSaoPauloWall(wall: Date): Date {
  return new Date(wall.getTime() + SAO_PAULO_OFFSET_MS);
}

/**
 * Suggestions for the scheduler on wall Dates (see `suggestTimes` for real instants):
 * - `sameDay`: the best hour on the already-selected day, when that weekday has data and the
 *   hour is still schedulable.
 * - `upcoming`: each of the top slots at its next schedulable occurrence, soonest first.
 */
export function buildTimeSuggestions(
  data: BestPostingTimes,
  selected: Date | undefined,
  now: Date,
): { sameDay: TimeSuggestion | null; upcoming: TimeSuggestion[] } {
  const from = addMinutes(now, SUGGESTION_MIN_LEAD_MINUTES);

  let sameDay: TimeSuggestion | null = null;
  if (selected) {
    const slot = bestSlotOnWeekday(data, mondayBasedWeekday(selected));
    if (slot) {
      const date = new Date(wallStartOfDay(selected).getTime() + slot.hour * HOUR_MS);
      if (!isBefore(date, from)) sameDay = { date, slot };
    }
  }

  const upcoming = data.topSlots
    .map((slot) => ({ date: nextOccurrence(slot, from), slot }))
    // Already offered as the same-day row.
    .filter((s) => s.date.getTime() !== sameDay?.date.getTime())
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  return { sameDay, upcoming };
}

/** `buildTimeSuggestions` on the São Paulo wall clock, returning real instants to persist. */
export function suggestTimes(
  data: BestPostingTimes,
  selected: Date | undefined,
  now: Date,
): { sameDay: TimeSuggestion | null; upcoming: TimeSuggestion[] } {
  const wall = buildTimeSuggestions(
    data,
    selected && toSaoPauloWall(selected),
    toSaoPauloWall(now),
  );
  const toInstant = (s: TimeSuggestion): TimeSuggestion => ({
    ...s,
    date: fromSaoPauloWall(s.date),
  });
  return {
    sameDay: wall.sameDay && toInstant(wall.sameDay),
    upcoming: wall.upcoming.map(toInstant),
  };
}
