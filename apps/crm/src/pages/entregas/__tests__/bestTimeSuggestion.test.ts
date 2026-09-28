import { describe, expect, it } from 'vitest';
import type { BestPostingTimes } from '../../../services/analytics';
import {
  bestSlotOnWeekday,
  buildTimeSuggestions,
  fromSaoPauloWall,
  hasEnoughData,
  mondayBasedWeekday,
  nextOccurrence,
  suggestTimes,
  toSaoPauloWall,
} from '../bestTimeSuggestion';

function grid(): number[][] {
  return Array.from({ length: 7 }, () => Array(24).fill(0));
}

function makeData(
  cells: { day: number; hour: number; value: number; count: number }[],
): BestPostingTimes {
  const heatmap = grid();
  const counts = grid();
  for (const c of cells) {
    heatmap[c.day][c.hour] = c.value;
    counts[c.day][c.hour] = c.count;
  }
  const topSlots = [...cells]
    .sort((a, b) => b.value - a.value)
    .slice(0, 3)
    .map((c) => ({ day: c.day, hour: c.hour, value: c.value, postCount: c.count }));
  return {
    heatmap,
    counts,
    topSlots,
    totalPosts: cells.reduce((n, c) => n + c.count, 0),
    labels_days: ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sab', 'Dom'],
    labels_hours: Array.from({ length: 24 }, (_, i) => `${i}h`),
  };
}

// 2026-09-30 is a Wednesday (Monday-based weekday 2).
const WED_10AM = new Date(2026, 8, 30, 10, 0);

describe('mondayBasedWeekday', () => {
  it('maps Monday to 0 and Sunday to 6', () => {
    expect(mondayBasedWeekday(new Date(2026, 8, 28))).toBe(0);
    expect(mondayBasedWeekday(new Date(2026, 9, 4))).toBe(6);
  });
});

describe('nextOccurrence', () => {
  it('returns later the same day when the hour is still ahead', () => {
    expect(nextOccurrence({ day: 2, hour: 18 }, WED_10AM)).toEqual(new Date(2026, 8, 30, 18));
  });

  it('rolls to next week when the hour already passed today', () => {
    expect(nextOccurrence({ day: 2, hour: 9 }, WED_10AM)).toEqual(new Date(2026, 9, 7, 9));
  });

  it('accepts an instant exactly on the hour', () => {
    expect(nextOccurrence({ day: 2, hour: 10 }, WED_10AM)).toEqual(WED_10AM);
  });

  it('finds a later weekday in the same week', () => {
    expect(nextOccurrence({ day: 4, hour: 12 }, WED_10AM)).toEqual(new Date(2026, 9, 2, 12));
  });

  it('crosses into next week for an earlier weekday', () => {
    expect(nextOccurrence({ day: 0, hour: 8 }, WED_10AM)).toEqual(new Date(2026, 9, 5, 8));
  });
});

describe('bestSlotOnWeekday', () => {
  it('ignores hours without posts even when the value is higher', () => {
    const data = makeData([
      { day: 2, hour: 9, value: 3, count: 2 },
      { day: 2, hour: 20, value: 7, count: 1 },
    ]);
    data.heatmap[2][12] = 99; // no posts at 12h, must not win
    expect(bestSlotOnWeekday(data, 2)).toEqual({ day: 2, hour: 20, value: 7, postCount: 1 });
  });

  it('returns null for a weekday with no posts', () => {
    expect(bestSlotOnWeekday(makeData([{ day: 2, hour: 9, value: 3, count: 5 }]), 5)).toBeNull();
  });
});

describe('hasEnoughData', () => {
  it('requires at least 5 posts', () => {
    expect(hasEnoughData(makeData([{ day: 1, hour: 9, value: 3, count: 4 }]))).toBe(false);
    expect(hasEnoughData(makeData([{ day: 1, hour: 9, value: 3, count: 5 }]))).toBe(true);
    expect(hasEnoughData(null)).toBe(false);
  });
});

describe('buildTimeSuggestions', () => {
  const data = makeData([
    { day: 2, hour: 18, value: 6, count: 3 },
    { day: 4, hour: 12, value: 5, count: 2 },
    { day: 0, hour: 8, value: 4, count: 2 },
  ]);

  it('orders the top slots by their next occurrence', () => {
    const { upcoming } = buildTimeSuggestions(data, undefined, WED_10AM);
    expect(upcoming.map((s) => s.date)).toEqual([
      new Date(2026, 8, 30, 18),
      new Date(2026, 9, 2, 12),
      new Date(2026, 9, 5, 8),
    ]);
  });

  it('skips an occurrence inside the 15-minute lead window', () => {
    const { upcoming } = buildTimeSuggestions(data, undefined, new Date(2026, 8, 30, 17, 50));
    expect(upcoming[upcoming.length - 1].date).toEqual(new Date(2026, 9, 7, 18));
  });

  it('suggests the best hour on the selected day', () => {
    const { sameDay } = buildTimeSuggestions(data, new Date(2026, 9, 7, 9, 30), WED_10AM);
    expect(sameDay?.date).toEqual(new Date(2026, 9, 7, 18));
  });

  it('omits the same-day suggestion when that hour already passed', () => {
    const { sameDay } = buildTimeSuggestions(data, WED_10AM, new Date(2026, 8, 30, 19));
    expect(sameDay).toBeNull();
  });

  it('omits the same-day suggestion for a weekday without data', () => {
    const { sameDay } = buildTimeSuggestions(data, new Date(2026, 9, 3), WED_10AM);
    expect(sameDay).toBeNull();
  });

  it('does not repeat the same-day suggestion among the upcoming ones', () => {
    const { sameDay, upcoming } = buildTimeSuggestions(data, WED_10AM, WED_10AM);
    expect(sameDay?.date).toEqual(new Date(2026, 8, 30, 18));
    expect(upcoming.map((s) => s.date)).toEqual([
      new Date(2026, 9, 2, 12),
      new Date(2026, 9, 5, 8),
    ]);
  });
});

describe('São Paulo wall clock conversion', () => {
  // 2026-09-30 21:00Z is 18:00 in São Paulo.
  const instant = new Date('2026-09-30T21:00:00Z');

  it('is a no-op for a browser already on UTC-3', () => {
    expect(toSaoPauloWall(instant, 180)).toEqual(instant);
    expect(fromSaoPauloWall(instant, 180)).toEqual(instant);
  });

  it('round-trips for a browser on UTC-4 (Manaus)', () => {
    const wall = toSaoPauloWall(instant, 240);
    // On a UTC-4 browser, local 18:00 is 22:00Z.
    expect(wall.toISOString()).toBe('2026-09-30T22:00:00.000Z');
    expect(fromSaoPauloWall(wall, 240)).toEqual(instant);
  });

  it('persists an 18h São Paulo slot as 21:00Z from a UTC-4 browser', () => {
    // Local-18:00 wall date on a UTC-4 browser is 22:00Z.
    const wall18 = new Date('2026-09-30T22:00:00Z');
    expect(fromSaoPauloWall(wall18, 240).toISOString()).toBe('2026-09-30T21:00:00.000Z');
  });
});

describe('suggestTimes', () => {
  it('returns the São Paulo instant whatever the machine time zone', () => {
    const data = makeData([{ day: 2, hour: 18, value: 6, count: 5 }]);
    // Wednesday 10:00 in São Paulo.
    const { upcoming } = suggestTimes(data, undefined, new Date('2026-09-30T13:00:00Z'));
    expect(upcoming[0].date.toISOString()).toBe('2026-09-30T21:00:00.000Z');
  });
});
