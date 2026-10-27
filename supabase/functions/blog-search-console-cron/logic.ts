// Pure logic for the daily Search Console sync (no network, no database). The handler that
// wires it to Google and Supabase lives next to this file.
import { BLOG_SLUG_RE } from "../_shared/blog-live.ts";

export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
/** URL Inspection's `inspectionResultLink` must point at Google before we store or link it. */
export const INDEX_LINK_RE = /^https:\/\/search\.google\.com\//;

const BLOG_HOSTS = new Set(["mesaas.com.br", "www.mesaas.com.br"]);
const DAY_MS = 86_400_000;
const CHUNK_DAYS = 30;
const HORIZON_DAYS = 486; // ~16 months of history
const REFRESH_DAYS = 10;
const RECENT_POST_DAYS = 3;

/** `https://[www.]mesaas.com.br/blog/<slug>[/]` -> slug. Query and fragment are ignored. */
export function slugFromPageUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (!BLOG_HOSTS.has(u.host)) return null; // `host` includes any port, so :8443 is rejected
  const m = /^\/blog\/([^/]+)\/?$/.exec(u.pathname);
  if (!m) return null;
  return BLOG_SLUG_RE.test(m[1]) ? m[1] : null; // percent-escapes never match the slug alphabet
}

export interface GscRow {
  keys: [string, string];
  clicks: number;
  impressions: number;
  position: number;
}
export interface DailyRow {
  slug: string;
  day: string;
  clicks: number;
  impressions: number;
  position: number;
}

/**
 * Folds Google's `[date, page]` rows into one row per (slug, day): the `mesaas.com.br` and
 * `www` hosts report separately. Clicks and impressions are summed; position is averaged
 * weighted by impressions. When the folded rows have zero impressions in total the weights are
 * all zero, so it falls back to the plain average of their positions. Rows whose URL is not a
 * blog post are dropped. Output is sorted by day, then slug.
 */
export function aggregateRows(rows: GscRow[]): DailyRow[] {
  const acc = new Map<string, { slug: string; day: string; clicks: number; impressions: number; weighted: number; sum: number; n: number }>();
  for (const r of rows) {
    const slug = slugFromPageUrl(r.keys[1]);
    if (!slug) continue;
    const day = r.keys[0];
    const k = `${day}\u0000${slug}`;
    const a = acc.get(k) ?? { slug, day, clicks: 0, impressions: 0, weighted: 0, sum: 0, n: 0 };
    a.clicks += r.clicks;
    a.impressions += r.impressions;
    a.weighted += r.position * r.impressions;
    a.sum += r.position;
    a.n += 1;
    acc.set(k, a);
  }
  return [...acc.values()]
    .map((a) => ({
      slug: a.slug,
      day: a.day,
      clicks: a.clicks,
      impressions: a.impressions,
      position: a.impressions > 0 ? a.weighted / a.impressions : a.sum / a.n,
    }))
    .sort((x, y) => (x.day < y.day ? -1 : x.day > y.day ? 1 : x.slug < y.slug ? -1 : x.slug > y.slug ? 1 : 0));
}

// Search Console reports days in Pacific time, so "today" is Pacific's, not UTC's.
const PACIFIC = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function pacificToday(now: Date): string {
  return PACIFIC.format(now); // en-CA -> YYYY-MM-DD
}

// Date-only arithmetic in UTC so a DST change can never move a day.
function parseDay(d: string): number {
  const [y, m, dd] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, dd);
}
function fmtDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
function addDays(d: string, n: number): string {
  return fmtDay(parseDay(d) + n * DAY_MS);
}

export function pacificYesterday(now: Date): string {
  return addDays(pacificToday(now), -1);
}

/** The last 10 days ending Pacific yesterday: Google keeps revising recent days. */
export function refreshWindow(now: Date): { from: string; to: string } {
  const to = pacificYesterday(now);
  return { from: addDays(to, -(REFRESH_DAYS - 1)), to };
}

/** The oldest day the backfill reaches: Pacific today minus 486 days (about 16 months). */
export function backfillHorizon(now: Date): string {
  return addDays(pacificToday(now), -HORIZON_DAYS);
}

/**
 * Up to `max` 30-day chunks walked newest to oldest, the first ending the day before
 * `backfillBefore` (the oldest day already backfilled). The last chunk is clipped at `horizon`;
 * once `backfillBefore` is at or before `horizon` there is nothing left.
 */
export function backfillChunks(backfillBefore: string, horizon: string, max = 4): Array<{ from: string; to: string }> {
  const chunks: Array<{ from: string; to: string }> = [];
  let to = addDays(backfillBefore, -1);
  while (chunks.length < max && to >= horizon) {
    const from = addDays(to, -(CHUNK_DAYS - 1));
    chunks.push({ from: from < horizon ? horizon : from, to });
    to = addDays(from, -1);
  }
  return chunks;
}

/**
 * Which slugs to URL-inspect this run (at most `cap`): posts published in the last 3 days
 * first (newest first), then posts never checked (input order), then the rest by oldest
 * `checked_at`. Slugs are deduped; `checked` entries for slugs no longer live are ignored.
 */
export function pickInspectionTargets(
  live: Array<{ slug: string; date: string | null }>,
  checked: Record<string, string>,
  now: Date,
  cap = 150,
): string[] {
  const seen = new Set<string>();
  const posts = live.filter((p) => (seen.has(p.slug) ? false : (seen.add(p.slug), true)));

  const ageMs = (date: string | null): number | null => {
    if (!date) return null;
    const t = Date.parse(date);
    return Number.isNaN(t) ? null : now.getTime() - t;
  };
  // A date-only value parses as UTC midnight; allow a day of negative age for a post dated
  // "today" in a timezone ahead of the clock.
  const isRecent = (p: { date: string | null }) => {
    const age = ageMs(p.date);
    return age !== null && age >= -DAY_MS && age <= RECENT_POST_DAYS * DAY_MS;
  };

  const recent = posts
    .filter(isRecent)
    .sort((a, b) => Date.parse(b.date!) - Date.parse(a.date!));
  const rest = posts.filter((p) => !isRecent(p));
  const never = rest.filter((p) => !checked[p.slug]);
  const stale = rest
    .filter((p) => !!checked[p.slug])
    .sort((a, b) => (checked[a.slug] < checked[b.slug] ? -1 : checked[a.slug] > checked[b.slug] ? 1 : 0));
  return [...recent, ...never, ...stale].slice(0, Math.max(0, cap)).map((p) => p.slug);
}
