// IG-aligned engagement rates + score — FRONTEND PORT.
//
// Mirror of the pure helpers in supabase/functions/mcp/content.ts. Keep in
// sync: we cannot import across the Deno/Vite boundary (see
// apps/crm/src/lib/mcp-scopes.ts for the same pattern). The drift-guard test
// apps/crm/src/lib/__tests__/ig-rates.test.ts pins the same values as the Deno
// test supabase/functions/__tests__/mcp-content_test.ts.
//
// The buildRateDistributions / selectRateSamples / buildBaseline glue mirrors
// loadClientRateDistributions + getPerformanceBaseline in
// supabase/functions/mcp/queries.ts. `Baseline` intentionally matches the MCP
// get_performance_baseline output so a CRM number equals what an agent sees.

export interface Quartiles {
  p25: number;
  p50: number;
  p75: number;
}

/** Linear-interpolated quartiles. Returns null for an empty sample. */
export function quartiles(values: number[]): Quartiles | null {
  const xs = values.filter((v) => typeof v === 'number' && !Number.isNaN(v)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const at = (p: number): number => {
    const idx = (xs.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return xs[lo];
    return xs[lo] + (xs[hi] - xs[lo]) * (idx - lo);
  };
  return { p25: at(0.25), p50: at(0.5), p75: at(0.75) };
}

export type PerformanceTier = 'top_quartile' | 'above_median' | 'below_median' | 'bottom_quartile';

/** Bucket a metric value against a quartile baseline. Null when value or baseline is missing. */
export function performanceTier(
  value: number | null | undefined,
  q: Quartiles | null,
): PerformanceTier | null {
  if (q === null || value === null || value === undefined || Number.isNaN(value)) return null;
  if (value >= q.p75) return 'top_quartile';
  if (value >= q.p50) return 'above_median';
  if (value >= q.p25) return 'below_median';
  return 'bottom_quartile';
}

export type RateKey = 'share_rate' | 'like_rate' | 'save_rate' | 'comment_rate';
export type Rates = Record<RateKey, number | null>;

export const IG_RATE_WEIGHTS: Record<RateKey, number> = {
  share_rate: 0.4,
  like_rate: 0.3,
  save_rate: 0.2,
  comment_rate: 0.1,
};

/** Minimum non-null sample for a usable distribution (percentile / quartiles). */
export const MIN_SAMPLE = 5;

const RATE_NUMERATOR: Record<RateKey, 'shares' | 'likes' | 'saved' | 'comments'> = {
  share_rate: 'shares',
  like_rate: 'likes',
  save_rate: 'saved',
  comment_rate: 'comments',
};

/** Per-view rates. `0` is a real rate; an unavailable numerator (or views unavailable/0) yields `null`. */
export function computeRates(
  counts: { shares: number; likes: number; saved: number; comments: number; impressions: number },
  unavailable: Iterable<string> = [],
): Rates {
  const u = new Set(unavailable);
  const views = counts.impressions;
  const viewsOk = !u.has('impressions') && typeof views === 'number' && views > 0;
  const out = {} as Rates;
  for (const key of Object.keys(IG_RATE_WEIGHTS) as RateKey[]) {
    const token = RATE_NUMERATOR[key];
    const num = counts[token];
    out[key] =
      !viewsOk || u.has(token) || typeof num !== 'number' || Number.isNaN(num) ? null : num / views;
  }
  return out;
}

/** Midrank percentile of `value` within `sample` (0..1). null if sample empty or value null. */
export function percentileRank(value: number | null | undefined, sample: number[]): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const xs = sample.filter((v) => typeof v === 'number' && !Number.isNaN(v));
  if (xs.length === 0) return null;
  let less = 0;
  let equal = 0;
  for (const x of xs) {
    if (x < value) less++;
    else if (x === value) equal++;
  }
  return (less + 0.5 * equal) / xs.length;
}

/** Composite 0–100 score: each non-null rate placed at its percentile, weighted, renormalized. */
export function igAlignedScore(
  rates: Rates,
  distributions: Record<RateKey, number[]>,
): number | null {
  let acc = 0;
  let wsum = 0;
  for (const key of Object.keys(IG_RATE_WEIGHTS) as RateKey[]) {
    const v = rates[key];
    if (v === null || v === undefined) continue;
    const sample = distributions[key] ?? [];
    if (sample.length < MIN_SAMPLE) continue;
    const pct = percentileRank(v, sample);
    if (pct === null) continue;
    acc += IG_RATE_WEIGHTS[key] * pct;
    wsum += IG_RATE_WEIGHTS[key];
  }
  if (wsum === 0) return null;
  return Math.round((acc / wsum) * 100);
}

// ---- CRM-side glue (mirrors queries.ts loadClientRateDistributions / getPerformanceBaseline) ----

export interface PostMetricRow {
  media_type: string | null;
  reach: number;
  impressions: number;
  saved: number;
  shares: number;
  likes: number;
  comments: number;
  unavailable_metrics: string[] | null;
}

export type DistBuckets = Record<RateKey, number[]> & { reach: number[] };

function emptyBuckets(): DistBuckets {
  return { share_rate: [], like_rate: [], save_rate: [], comment_rate: [], reach: [] };
}

export interface RateDistributions {
  overall: DistBuckets;
  byFormat: Record<string, DistBuckets>;
}

/** Group per-view rates into overall + per-format buckets. Mirrors queries.ts:514-540. */
export function buildRateDistributions(rows: PostMetricRow[]): RateDistributions {
  const overall = emptyBuckets();
  const byFormat: Record<string, DistBuckets> = {};
  for (const p of rows) {
    const unavailable = Array.isArray(p.unavailable_metrics) ? p.unavailable_metrics : [];
    const rates = computeRates(
      {
        shares: p.shares ?? 0,
        likes: p.likes ?? 0,
        saved: p.saved ?? 0,
        comments: p.comments ?? 0,
        impressions: p.impressions ?? 0,
      },
      unavailable,
    );
    const fmt = p.media_type ?? 'UNKNOWN';
    byFormat[fmt] ??= emptyBuckets();
    for (const key of Object.keys(IG_RATE_WEIGHTS) as RateKey[]) {
      const v = rates[key];
      if (v !== null) {
        overall[key].push(v);
        byFormat[fmt][key].push(v);
      }
    }
    if (!unavailable.includes('reach') && typeof p.reach === 'number') {
      overall.reach.push(p.reach);
      byFormat[fmt].reach.push(p.reach);
    }
  }
  return { overall, byFormat };
}

/** Per rate, use the format sample if it has >= MIN_SAMPLE, else the overall sample. */
export function selectRateSamples(
  format: string,
  dists: RateDistributions,
): Record<RateKey, number[]> {
  const fmt = dists.byFormat[format];
  const out = {} as Record<RateKey, number[]>;
  for (const key of Object.keys(IG_RATE_WEIGHTS) as RateKey[]) {
    const f = fmt?.[key] ?? [];
    out[key] = f.length >= MIN_SAMPLE ? f : (dists.overall[key] ?? []);
  }
  return out;
}

/** ig_score for a single post against its client's distributions. */
export function scorePost(
  post: { media_type: string | null; rates: Rates },
  dists: RateDistributions,
): number | null {
  return igAlignedScore(post.rates, selectRateSamples(post.media_type ?? 'UNKNOWN', dists));
}

export type MetricKey = RateKey | 'reach';
export interface BucketStat {
  n: number;
  quartiles: Quartiles | null;
}
export interface Baseline {
  sample_size: number;
  weights: Record<RateKey, number>;
  weights_note: string;
  overall: Record<MetricKey, BucketStat>;
  by_format: Record<string, Record<MetricKey, BucketStat>>;
}

export const WEIGHTS_NOTE =
  "Internal IG-aligned heuristic (shares>likes>saves>comments), not Instagram's published weights.";

const BASELINE_METRICS: MetricKey[] = [
  'share_rate',
  'like_rate',
  'save_rate',
  'comment_rate',
  'reach',
];

function bucketStats(b: DistBuckets): Record<MetricKey, BucketStat> {
  const out = {} as Record<MetricKey, BucketStat>;
  for (const m of BASELINE_METRICS) {
    const xs = b[m] ?? [];
    out[m] = { n: xs.length, quartiles: xs.length >= MIN_SAMPLE ? quartiles(xs) : null };
  }
  return out;
}

/** MCP-shaped baseline (mirrors getPerformanceBaseline, queries.ts:464-490). */
export function buildBaseline(dists: RateDistributions, sampleSize: number): Baseline {
  const by_format: Record<string, Record<MetricKey, BucketStat>> = {};
  for (const [fmt, b] of Object.entries(dists.byFormat)) by_format[fmt] = bucketStats(b);
  return {
    sample_size: sampleSize,
    weights: IG_RATE_WEIGHTS,
    weights_note: WEIGHTS_NOTE,
    overall: bucketStats(dists.overall),
    by_format,
  };
}

/** Format a raw fraction as a pt-BR percentage of views; null -> em dash. */
export function formatRate(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return (
    (value * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) +
    '%'
  );
}

const RATE_KEYS = new Set<string>(['share_rate', 'like_rate', 'save_rate', 'comment_rate']);

/** Numeric value for a rate/ig_score sort column; null for unknown columns (caller sinks nulls). */
export function postRateSortValue(
  post: { rates: Rates; ig_score: number | null },
  col: string,
): number | null {
  if (col === 'ig_score') return post.ig_score;
  if (RATE_KEYS.has(col)) return post.rates[col as RateKey];
  return null;
}
