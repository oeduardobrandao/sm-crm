import { addDays, addMinutes, isBefore, setHours, startOfDay } from 'date-fns';
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

/** JS `getDay()` (Sunday = 0) → the endpoint's Monday = 0 convention. */
export function mondayBasedWeekday(date: Date): number {
  return (date.getDay() + 6) % 7;
}

/** First instant at `slot.hour`:00 on `slot.day` that is not before `from`. */
export function nextOccurrence(slot: Pick<BestTimeSlot, 'day' | 'hour'>, from: Date): Date {
  const base = startOfDay(from);
  for (let i = 0; i <= 7; i++) {
    const candidate = setHours(addDays(base, i), slot.hour);
    if (mondayBasedWeekday(candidate) === slot.day && !isBefore(candidate, from)) {
      return candidate;
    }
  }
  // Unreachable for a valid slot: 8 consecutive days always contain the weekday once after `from`.
  return setHours(addDays(base, 7), slot.hour);
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

/** America/Sao_Paulo is a fixed UTC-3 (no DST since 2019), in getTimezoneOffset() units. */
const SAO_PAULO_TZ_OFFSET_MINUTES = 180;

/**
 * The best-times grid is bucketed on the São Paulo wall clock (instagram-analytics), but the
 * browser may sit in another zone. These map an instant to a Date whose *local* getters read the
 * São Paulo wall clock, and back, so the slot math can stay in plain date-fns local arithmetic.
 * `tzOffset` is the browser's getTimezoneOffset(); a parameter only so tests can pin it.
 */
export function toSaoPauloWall(instant: Date, tzOffset = instant.getTimezoneOffset()): Date {
  return addMinutes(instant, tzOffset - SAO_PAULO_TZ_OFFSET_MINUTES);
}

export function fromSaoPauloWall(wall: Date, tzOffset = wall.getTimezoneOffset()): Date {
  return addMinutes(wall, SAO_PAULO_TZ_OFFSET_MINUTES - tzOffset);
}

/**
 * Suggestions for the scheduler, computed on a wall clock (see `suggestTimes` for real instants):
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
      const date = setHours(startOfDay(selected), slot.hour);
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
