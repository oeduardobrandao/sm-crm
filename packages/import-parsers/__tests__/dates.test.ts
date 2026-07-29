import { describe, expect, test } from 'vitest';
import { isIsoCalendarValid } from '../src/dates';

describe('isIsoCalendarValid', () => {
  test.each(['2026-02-31', '2026-04-31', '2026-02-29'])(
    'rejects the calendar-invalid ISO date %s',
    (value) => {
      expect(isIsoCalendarValid(value)).toBe(false);
    },
  );

  test('accepts a real leap day (2028-02-29)', () => {
    expect(isIsoCalendarValid('2028-02-29')).toBe(true);
  });

  test('accepts an ordinary date-only string', () => {
    expect(isIsoCalendarValid('2026-08-03')).toBe(true);
  });

  test('accepts a valid full ISO timestamp', () => {
    expect(isIsoCalendarValid('2026-08-03T12:00:00Z')).toBe(true);
  });

  test('rejects a calendar-invalid full ISO timestamp', () => {
    expect(isIsoCalendarValid('2026-02-31T12:00:00Z')).toBe(false);
  });

  test('is indifferent to timezone offset (validates the written digits, not the resolved UTC instant)', () => {
    // A machine west of UTC reading this with local-getter validation would
    // see the previous calendar day and could wrongly reject a valid date;
    // this function never touches Date getters, so it isn't exposed to that.
    expect(isIsoCalendarValid('2026-08-03T01:00:00+03:00')).toBe(true);
  });

  test("leaves non-ISO-shaped input alone (true = not this function's concern)", () => {
    expect(isIsoCalendarValid('not-a-real-date')).toBe(true);
    expect(isIsoCalendarValid('05/08/2026')).toBe(true);
    expect(isIsoCalendarValid('')).toBe(true);
  });
});
