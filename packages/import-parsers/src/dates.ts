// Shared calendar-overflow guard for ISO-shaped date strings.
//
// `new Date(...)` NORMALIZES an impossible calendar date instead of failing:
// `new Date('2026-02-31')` silently becomes 3 March 2026. Two import paths
// feed user-supplied strings straight into `Date` (the wizard's ISO fallback
// in apps/crm/src/pages/importar/buildCommitRows.ts, and the ClickUp CSV
// parser's `toIso` below) and both need to reject a cell like "2026-02-31"
// rather than silently scheduling something the user never wrote.
//
// This validates the year/month/day exactly as WRITTEN in the string, via
// plain Gregorian-calendar arithmetic -- it never round-trips through `Date`
// getters. Getters would require picking UTC vs. local depending on the
// string's shape: a date-only string ("2026-08-03") is parsed by JS as UTC
// midnight, a bare date-time with no offset ("2026-08-03T12:00:00") is parsed
// as LOCAL time per spec, and a date-time WITH an explicit offset/Z is parsed
// as that instant -- whose UTC-rendered calendar day can differ from what's
// written whenever the offset crosses a day boundary. Matching the wrong
// getters to the wrong shape is exactly the class of bug this function exists
// to avoid (e.g. validating a UTC-parsed date-only string with local getters
// makes a machine west of UTC see the previous day and reject valid dates),
// so it sidesteps `Date` entirely for the validity check.

const ISO_DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isRealCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12) return false;
  const max = month === 2 && isLeapYear(year) ? 29 : DAYS_IN_MONTH[month - 1];
  return day >= 1 && day <= max;
}

/**
 * True when `value` is either not ISO-date-shaped (nothing for this function
 * to say -- whatever consumes it decides) or IS ISO-shaped and names a real
 * calendar day. False only for an ISO-shaped string naming an impossible day
 * ("2026-02-31", "2026-04-31", a Feb 29 outside a leap year).
 *
 * Covers both date-only ("2026-08-03") and full-timestamp
 * ("2026-08-03T12:00:00Z") shapes -- both normalize overflow identically in
 * `Date`, so both need the guard.
 */
export function isIsoCalendarValid(value: string): boolean {
  const match = ISO_DATE_ONLY.exec(value) ?? ISO_TIMESTAMP.exec(value);
  if (!match) return true;
  return isRealCalendarDate(Number(match[1]), Number(match[2]), Number(match[3]));
}
