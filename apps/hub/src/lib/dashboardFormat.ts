const DASH = '—';

/** Full number with grouping: 12480 -> "12.480" (pt-BR). null -> "—". */
export function formatCount(n: number | null | undefined, locale: string): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  return new Intl.NumberFormat(locale).format(n);
}

/** Compact from 1000 up, one decimal: 48200 -> "48,2 mil", 214 -> "214". null -> "—". */
export function formatCompact(n: number | null | undefined, locale: string): string {
  if (n == null || !Number.isFinite(n)) return DASH;
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

const BARE_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** "dd/mm" in pt-BR, the locale's day+month order otherwise. Accepts an ISO instant or a YYYY-MM-DD day. */
export function formatDayMonth(iso: string, locale: string): string {
  const m = BARE_DAY.exec(iso);
  // A bare day is a calendar day, not UTC midnight: build it in local time so it never shifts.
  const date = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso);
  if (Number.isNaN(date.getTime())) return DASH;
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit' }).format(date);
}

export type SyncAge =
  | { kind: 'minutes'; n: number }
  | { kind: 'hours'; n: number }
  | { kind: 'date'; iso: string }
  | { kind: 'never' };

export function syncAge(lastSyncedAt: string | null, now: Date): SyncAge {
  if (!lastSyncedAt) return { kind: 'never' };
  const at = new Date(lastSyncedAt).getTime();
  if (Number.isNaN(at)) return { kind: 'never' };
  const minutes = Math.floor((now.getTime() - at) / 60_000);
  if (minutes < 60) return { kind: 'minutes', n: Math.max(1, minutes) };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { kind: 'hours', n: hours };
  return { kind: 'date', iso: lastSyncedAt };
}

/** Seconds -> "0:42", "1:05". null -> null. */
export function formatDuration(seconds: number | null): string | null {
  if (seconds == null || !Number.isFinite(seconds)) return null;
  const total = Math.max(0, Math.round(seconds));
  const s = total % 60;
  return `${Math.floor(total / 60)}:${String(s).padStart(2, '0')}`;
}
