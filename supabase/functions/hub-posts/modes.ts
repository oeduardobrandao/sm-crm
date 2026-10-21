// Read modes of the hub-posts GET.
// Spec: docs/superpowers/specs/2026-10-02-hub-posts-bounded-design.md

export const HISTORY_PAGE_SIZE = 30;
export const SHELL_WINDOW_DAYS = 90;
export const MAX_RANGE_DAYS = 45;

export interface Cursor {
  ts: string;
  id: number;
}

export type GetMode =
  | { kind: "shell" }
  | { kind: "history"; before: Cursor }
  | { kind: "range"; from: string; to: string }
  | { kind: "post"; postId: number };

// The cursor timestamp is interpolated into a PostgREST .or() string, so only ISO 8601
// characters pass: no comma, parenthesis or quote can add another condition.
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T[0-9:.]+(Z|[+-]\d{2}:\d{2})$/;

function isIsoTimestamp(value: string): boolean {
  return ISO_TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value));
}

export function parseCursor(raw: string): Cursor | null {
  const sep = raw.lastIndexOf("|");
  if (sep <= 0) return null;
  const ts = raw.slice(0, sep);
  const id = raw.slice(sep + 1);
  if (!isIsoTimestamp(ts) || !/^\d+$/.test(id)) return null;
  return { ts, id: Number(id) };
}

/** The row's cursor. published_at goes in exactly as PostgREST returned it: it carries
 * microseconds, and re-serializing through Date would truncate to milliseconds and make the
 * tie-break `published_at.eq.<ts>` skip rows. */
export function cursorOf(row: { published_at: string; id: number }): string {
  return `${row.published_at}|${row.id}`;
}

/** Start of the UTC day SHELL_WINDOW_DAYS back: stable for a whole day of refetches. */
export function shellCutoff(nowIso: string): string {
  const d = new Date(nowIso);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - SHELL_WINDOW_DAYS);
  return d.toISOString();
}

/** null means a 400: malformed values, or more than one mode at once. */
export function parseGetMode(params: URLSearchParams): GetMode | null {
  const before = params.get("before");
  const from = params.get("from");
  const to = params.get("to");
  const postId = params.get("post_id");
  const isRange = from !== null || to !== null;
  const given = [before !== null, isRange, postId !== null].filter(Boolean).length;
  if (given === 0) return { kind: "shell" };
  if (given > 1) return null;

  if (before !== null) {
    const cursor = parseCursor(before);
    return cursor ? { kind: "history", before: cursor } : null;
  }
  if (postId !== null) {
    return /^\d+$/.test(postId) ? { kind: "post", postId: Number(postId) } : null;
  }
  if (from === null || to === null || !isIsoTimestamp(from) || !isIsoTimestamp(to)) return null;
  const span = Date.parse(to) - Date.parse(from);
  if (span <= 0 || span > MAX_RANGE_DAYS * 86_400_000) return null;
  return { kind: "range", from, to };
}
