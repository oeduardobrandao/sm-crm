# IG-Aligned Ranking — Analytics UI (Project 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the IG-aligned engagement model (per-view rates + 0–100 `ig_score` + per-client baseline) from Project 1 (PR #158) in the CRM portfolio and per-client Analytics pages.

**Architecture:** Pure scoring math is **ported** from `supabase/functions/mcp/content.ts` into a new frontend module `apps/crm/src/lib/ig-rates.ts` (no Deno/Vite cross-import). The data layer (`services/analytics.ts`) computes per-view rates on fetched posts and, for the per-client page, an `ig_score` against the client's full-history distribution. The two Analytics pages add rate/score **sort options, columns, and a baseline card** — strictly additive; reach stays the default ranking everywhere.

**Tech Stack:** React 19, TanStack Query, TypeScript, Vitest. Supabase JS (RLS-filtered through the user session — no service-role). Mesaas design system (brand `#eab308`, DM Sans / Playfair / DM Mono).

**Spec:** `docs/superpowers/specs/2026-06-25-ig-aligned-ranking-analytics-ui-design.md`

## Global Constraints

- **Rates are raw fractions.** `computeRates` returns `0.04`, not `4`. Store fractions; format to `%` only at render via `formatRate`.
- **Weights (copied verbatim):** `share_rate 0.40 / like_rate 0.30 / save_rate 0.20 / comment_rate 0.10`. **`MIN_SAMPLE = 5`.**
- **`ig_score` is 0–100 or `null`** when no component has a `≥ MIN_SAMPLE` sample. Score band colors: `≥ 75` success, `40–74` neutral, `< 40` danger.
- **Additive only.** No existing default ordering changes; account-level `engagement_rate_avg` stays reach-based and is NOT touched.
- **No cross-boundary import.** Frontend must not import from `supabase/functions/**`. Port pure math with a source-of-truth header comment.
- **`unavailable_metrics` null-safety:** coerce `Array.isArray(x) ? x : []` before use (DB column can be `null`). A missing/non-array value → `[]` (rates compute normally); only missing/`≤0` `impressions` nulls all rates.
- **Tenant safety unchanged.** Every Supabase read stays RLS-filtered through the user session exactly as today. No new tenant surface.
- **Portuguese UI.** `sanitizeUrl()` for any external `href`. Typecheck with `npm run build`; run `npm run test` after changes.
- **Drift guard:** `apps/crm/src/lib/__tests__/ig-rates.test.ts` pins the same values as `supabase/functions/__tests__/mcp-content_test.ts`.

---

### Task 1: Pure scoring module `apps/crm/src/lib/ig-rates.ts` + drift-guard test

**Files:**
- Create: `apps/crm/src/lib/ig-rates.ts`
- Test: `apps/crm/src/lib/__tests__/ig-rates.test.ts`

**Interfaces:**
- Consumes: nothing (pure; no imports).
- Produces (later tasks rely on these exact signatures):
  - `type RateKey`, `type Rates = Record<RateKey, number|null>`, `const IG_RATE_WEIGHTS`, `const MIN_SAMPLE`
  - `function computeRates(counts: {shares;likes;saved;comments;impressions:number}, unavailable?: Iterable<string>): Rates`
  - `interface Quartiles`, `function quartiles(values:number[]): Quartiles|null`
  - `type PerformanceTier`, `function performanceTier(value, q): PerformanceTier|null`
  - `function percentileRank(value, sample): number|null`, `function igAlignedScore(rates, distributions): number|null`
  - `interface PostMetricRow`, `type DistBuckets`, `interface RateDistributions { overall: DistBuckets; byFormat: Record<string,DistBuckets> }`
  - `function buildRateDistributions(rows: PostMetricRow[]): RateDistributions`
  - `function selectRateSamples(format: string, dists: RateDistributions): Record<RateKey, number[]>`
  - `function scorePost(post: {media_type: string|null; rates: Rates}, dists: RateDistributions): number|null`
  - `interface Baseline`, `function buildBaseline(dists: RateDistributions, sampleSize: number): Baseline`
  - `function formatRate(value: number|null|undefined): string`
  - `function postRateSortValue(post: {rates: Rates; ig_score: number|null}, col: string): number|null`

- [ ] **Step 1: Write the failing test** — `apps/crm/src/lib/__tests__/ig-rates.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import {
  computeRates, percentileRank, igAlignedScore, quartiles, performanceTier,
  IG_RATE_WEIGHTS, MIN_SAMPLE,
  buildRateDistributions, selectRateSamples, scorePost, buildBaseline,
  formatRate, postRateSortValue,
  type PostMetricRow,
} from '../ig-rates';

// ---- ports: mirror supabase/functions/__tests__/mcp-content_test.ts ----
describe('computeRates', () => {
  it('0 is real, missing is null, views 0/missing -> null', () => {
    const r = computeRates({ shares: 0, likes: 0, saved: 4, comments: 2, impressions: 100 }, ['shares']);
    expect(r.like_rate).toBe(0);
    expect(r.save_rate).toBe(0.04);
    expect(r.comment_rate).toBe(0.02);
    expect(r.share_rate).toBeNull();
    expect(computeRates({ shares: 1, likes: 1, saved: 1, comments: 1, impressions: 0 }))
      .toEqual({ share_rate: null, like_rate: null, save_rate: null, comment_rate: null });
    expect(computeRates({ shares: 1, likes: 1, saved: 1, comments: 1, impressions: 50 }, ['impressions']).like_rate)
      .toBeNull();
  });
  it('missing/non-array unavailable normalizes to [] (rates compute normally)', () => {
    // computeRates default param; buildRateDistributions handles null rows (see below)
    const r = computeRates({ shares: 2, likes: 10, saved: 1, comments: 1, impressions: 100 });
    expect(r.share_rate).toBe(0.02);
    expect(r.like_rate).toBe(0.1);
  });
});

describe('percentileRank', () => {
  it('midrank for ties; null for empty/null', () => {
    expect(percentileRank(5, [])).toBeNull();
    expect(percentileRank(null, [1, 2, 3])).toBeNull();
    expect(percentileRank(10, [10, 10, 20, 30])).toBe(0.25);
    expect(percentileRank(30, [10, 10, 20, 30])).toBe(0.875);
  });
});

describe('igAlignedScore', () => {
  it('weights present components, renormalizes, small-sample excluded', () => {
    const big = Array.from({ length: 5 }, (_, i) => i / 100);
    const dist = { share_rate: big, like_rate: big, save_rate: big, comment_rate: big };
    expect(igAlignedScore({ share_rate: 0.05, like_rate: 0.05, save_rate: 0.05, comment_rate: 0.05 }, dist)).toBe(100);
    expect(igAlignedScore({ share_rate: null, like_rate: 0.05, save_rate: 0.05, comment_rate: 0.05 }, dist)).toBe(100);
    const tiny = { share_rate: [0.01], like_rate: [0.01], save_rate: [0.01], comment_rate: [0.01] };
    expect(igAlignedScore({ share_rate: 0.02, like_rate: 0.02, save_rate: 0.02, comment_rate: 0.02 }, tiny)).toBeNull();
    expect(MIN_SAMPLE).toBe(5);
    expect(IG_RATE_WEIGHTS).toEqual({ share_rate: 0.4, like_rate: 0.3, save_rate: 0.2, comment_rate: 0.1 });
  });
});

describe('quartiles + performanceTier', () => {
  it('matches the Deno test', () => {
    const q = quartiles([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(q).not.toBeNull();
    expect(q!.p50).toBeGreaterThanOrEqual(5);
    expect(q!.p50).toBeLessThanOrEqual(6);
    expect(quartiles([])).toBeNull();
    expect(performanceTier(null, q)).toBeNull();
    expect(performanceTier(100, q)).toBe('top_quartile');
    expect(performanceTier(1, q)).toBe('bottom_quartile');
  });
});

// ---- CRM glue ----
const rows: PostMetricRow[] = [
  { media_type: 'VIDEO', reach: 100, impressions: 100, saved: 4, shares: 2, likes: 10, comments: 1, unavailable_metrics: [] },
  // null unavailable_metrics must coerce to [] (DB can return null):
  { media_type: 'VIDEO', reach: 200, impressions: 200, saved: 6, shares: 4, likes: 30, comments: 3, unavailable_metrics: null as unknown as string[] },
  { media_type: 'IMAGE', reach: 50, impressions: 0, saved: 1, shares: 0, likes: 1, comments: 0, unavailable_metrics: [] }, // 0 views -> excluded
];

describe('buildRateDistributions', () => {
  it('coerces null unavailable, excludes null rates, keeps reach', () => {
    const d = buildRateDistributions(rows);
    // VIDEO share_rate: 0.02 and 0.02 (4/200) -> two values; IMAGE row has 0 views -> no rates
    expect(d.byFormat.VIDEO.share_rate).toEqual([0.02, 0.02]);
    expect(d.overall.like_rate).toEqual([0.1, 0.15]);
    expect(d.byFormat.IMAGE.share_rate).toEqual([]); // 0 views -> null -> excluded
    expect(d.overall.reach).toEqual([100, 200, 50]); // reach kept regardless of views
  });
});

describe('selectRateSamples', () => {
  it('uses format sample when >= MIN_SAMPLE else overall', () => {
    const overall: Record<string, number[]> = { share_rate: [1, 2, 3, 4, 5], like_rate: [], save_rate: [], comment_rate: [] };
    const fmt: Record<string, number[]> = { share_rate: [9], like_rate: [], save_rate: [], comment_rate: [] };
    const dists = { overall: { ...overall, reach: [] }, byFormat: { VIDEO: { ...fmt, reach: [] } } } as never;
    const out = selectRateSamples('VIDEO', dists);
    expect(out.share_rate).toEqual([1, 2, 3, 4, 5]); // fmt has 1 (<5) -> falls back to overall
  });
});

describe('buildBaseline', () => {
  it('mirrors MCP get_performance_baseline shape; quartiles gated by MIN_SAMPLE', () => {
    const d = buildRateDistributions(rows);
    const b = buildBaseline(d, rows.length);
    expect(b.sample_size).toBe(3);
    expect(b.weights).toEqual(IG_RATE_WEIGHTS);
    expect(typeof b.weights_note).toBe('string');
    expect(b.overall.share_rate.n).toBe(2);
    expect(b.overall.share_rate.quartiles).toBeNull(); // n=2 < 5
    expect(b.by_format.VIDEO.like_rate.n).toBe(2);
  });
});

describe('formatRate + postRateSortValue', () => {
  it('formats fractions as pt-BR % and dashes null', () => {
    expect(formatRate(null)).toBe('—');
    expect(formatRate(0.018)).toBe('1,8%');
    expect(formatRate(0)).toBe('0,0%');
  });
  it('reads rate keys + ig_score, null for unknown', () => {
    const post = { rates: { share_rate: 0.02, like_rate: null, save_rate: 0.01, comment_rate: 0 }, ig_score: 73 };
    expect(postRateSortValue(post, 'share_rate')).toBe(0.02);
    expect(postRateSortValue(post, 'like_rate')).toBeNull();
    expect(postRateSortValue(post, 'ig_score')).toBe(73);
    expect(postRateSortValue(post, 'reach')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test -- ig-rates`
Expected: FAIL — `Cannot find module '../ig-rates'`.

- [ ] **Step 3: Create `apps/crm/src/lib/ig-rates.ts`**

```ts
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
export function performanceTier(value: number | null | undefined, q: Quartiles | null): PerformanceTier | null {
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
export function igAlignedScore(rates: Rates, distributions: Record<RateKey, number[]>): number | null {
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
      { shares: p.shares ?? 0, likes: p.likes ?? 0, saved: p.saved ?? 0, comments: p.comments ?? 0, impressions: p.impressions ?? 0 },
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
export function selectRateSamples(format: string, dists: RateDistributions): Record<RateKey, number[]> {
  const fmt = dists.byFormat[format];
  const out = {} as Record<RateKey, number[]>;
  for (const key of Object.keys(IG_RATE_WEIGHTS) as RateKey[]) {
    const f = fmt?.[key] ?? [];
    out[key] = f.length >= MIN_SAMPLE ? f : (dists.overall[key] ?? []);
  }
  return out;
}

/** ig_score for a single post against its client's distributions. */
export function scorePost(post: { media_type: string | null; rates: Rates }, dists: RateDistributions): number | null {
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

const BASELINE_METRICS: MetricKey[] = ['share_rate', 'like_rate', 'save_rate', 'comment_rate', 'reach'];

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
  return (value * 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
}

const RATE_KEYS = new Set<string>(['share_rate', 'like_rate', 'save_rate', 'comment_rate']);

/** Numeric value for a rate/ig_score sort column; null for unknown columns (caller sinks nulls). */
export function postRateSortValue(post: { rates: Rates; ig_score: number | null }, col: string): number | null {
  if (col === 'ig_score') return post.ig_score;
  if (RATE_KEYS.has(col)) return post.rates[col as RateKey];
  return null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test -- ig-rates`
Expected: PASS (all cases green).

- [ ] **Step 5: Typecheck + commit**

Run: `npm run build`
Expected: tsc + vite build succeed.

```bash
git add apps/crm/src/lib/ig-rates.ts apps/crm/src/lib/__tests__/ig-rates.test.ts
git commit -m "feat(analytics): port IG-aligned rate/score math to frontend (ig-rates)"
```

---

### Task 2: Portfolio data layer — per-view rates on `getPortfolioSummary`

**Files:**
- Modify: `apps/crm/src/services/analytics.ts` (`PortfolioTopPost` ~158-172; `topPostsRaw` select ~394-403; `allRankedPosts` map ~411-423)
- Test: `apps/crm/src/services/__tests__/analytics.test.ts`

**Interfaces:**
- Consumes (Task 1): `computeRates`, `type Rates`.
- Produces: `PortfolioTopPost` gains `views: number`, `rates: Rates`, `unavailable_metrics: string[]`.

- [ ] **Step 1: Write the failing test** — add to `apps/crm/src/services/__tests__/analytics.test.ts` (follow the existing `__queueSupabaseResult` pattern; mirror the queued tables in the existing portfolio test). Add inside the `describe('analytics service', …)` block:

```ts
it('attaches per-view rates to portfolio ranked posts', async () => {
  mockedSupabase.__queueSupabaseResult('clientes', 'select', {
    data: [{ id: 1, nome: 'Clínica Aurora', sigla: 'CA', cor: '#db2777', especialidade: 'Derm', status: 'ativo' }],
    error: null,
  });
  mockedSupabase.__queueSupabaseResult('instagram_accounts', 'select', {
    data: [{ id: 10, client_id: 1, username: 'aurora', follower_count: 1000, reach_28d: 5000 }],
    error: null,
  });
  mockedSupabase.__queueSupabaseResult('instagram_posts', 'select', { data: [], error: null }); // allRecentPosts
  mockedSupabase.__queueSupabaseResult('instagram_follower_history', 'select', { data: [], error: null });
  mockedSupabase.__queueSupabaseResult('instagram_posts', 'select', { data: [], error: null }); // latestPosts
  mockedSupabase.__queueSupabaseResult('instagram_posts', 'select', {
    data: [
      { id: 100, instagram_account_id: 10, media_type: 'VIDEO', permalink: 'https://x', posted_at: '2026-06-20T00:00:00Z',
        likes: 30, comments: 3, reach: 180, saved: 6, shares: 4, impressions: 200, unavailable_metrics: [] },
      { id: 101, instagram_account_id: 10, media_type: 'CAROUSEL_ALBUM', permalink: 'https://y', posted_at: '2026-06-19T00:00:00Z',
        likes: 10, comments: 1, reach: 90, saved: 2, shares: 0, impressions: 100, unavailable_metrics: ['shares'] },
    ],
    error: null,
  });

  const summary = await getPortfolioSummary(28);
  const p100 = summary.allRankedPosts.find((p) => p.id === 100)!;
  expect(p100.views).toBe(200);
  expect(p100.rates.share_rate).toBe(0.02); // 4/200
  expect(p100.rates.like_rate).toBe(0.15);  // 30/200
  const p101 = summary.allRankedPosts.find((p) => p.id === 101)!;
  expect(p101.rates.share_rate).toBeNull(); // shares unavailable -> null, not 0
  expect(p101.rates.save_rate).toBe(0.02);  // 2/100
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- analytics.test`
Expected: FAIL — `rates`/`views` undefined on ranked posts.

- [ ] **Step 3: Implement.** In `apps/crm/src/services/analytics.ts`:

(a) Add the import at the top with the other imports:
```ts
import { computeRates, type Rates } from '../lib/ig-rates';
```

(b) Extend `PortfolioTopPost` (after `shares: number;` near line 168):
```ts
  shares: number;
  views: number;
  rates: Rates;
  unavailable_metrics: string[];
```

(c) Add the two columns to the `topPostsRaw` select (line ~397) — change the select string to include `impressions, unavailable_metrics`:
```ts
    .select(
      'id, instagram_account_id, thumbnail_url, media_type, permalink, posted_at, likes, comments, reach, saved, shares, impressions, unavailable_metrics',
    )
```

(d) In the `allRankedPosts` map (line ~411-423), compute rates + views:
```ts
  const allRankedPosts: PortfolioTopPost[] = (topPostsRaw || [])
    .map((p) => {
      const interactions = (p.likes || 0) + (p.comments || 0) + (p.saved || 0) + (p.shares || 0);
      const engagement_rate = p.reach > 0 ? Math.round((interactions / p.reach) * 10000) / 100 : 0;
      const info = accountToClient[p.instagram_account_id];
      const unavailable = Array.isArray(p.unavailable_metrics) ? p.unavailable_metrics : [];
      const rates = computeRates(
        { shares: p.shares ?? 0, likes: p.likes ?? 0, saved: p.saved ?? 0, comments: p.comments ?? 0, impressions: p.impressions ?? 0 },
        unavailable,
      );
      return {
        ...p,
        engagement_rate,
        views: p.impressions ?? 0,
        rates,
        unavailable_metrics: unavailable,
        client_name: info?.client_name || '',
        client_id: info?.client_id || 0,
      };
    })
    .sort((a, b) => b.reach - a.reach);
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm run test -- analytics.test` → PASS. Then `npm run build` → succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/services/analytics.ts apps/crm/src/services/__tests__/analytics.test.ts
git commit -m "feat(analytics): compute per-view rates on portfolio ranked posts"
```

---

### Task 3: Per-client data layer — `getClientRateBaseline` + rates/ig_score in `getPostsAnalytics`

**Files:**
- Modify: `apps/crm/src/services/analytics.ts` (`PostAnalytics` ~101-118; `getPostsAnalytics` ~571-650; add `getClientRateBaseline`)
- Test: `apps/crm/src/services/__tests__/analytics.test.ts`

**Interfaces:**
- Consumes (Task 1): `computeRates`, `scorePost`, `buildRateDistributions`, `buildBaseline`, `postRateSortValue`, types `Rates`, `RateDistributions`, `Baseline`, `PostMetricRow`.
- Produces:
  - `PostAnalytics` gains `views: number`, `rates: Rates`, `unavailable_metrics: string[]`, `ig_score: number | null`.
  - `getPostsAnalytics(clientId, days, sort, dir, dateRange?, dists?: RateDistributions)` — new optional trailing `dists`.
  - `getClientRateBaseline(clientId: number): Promise<{ sampleSize: number; dists: RateDistributions; baseline: Baseline }>`.

> **Scope note (intentional, documented):** `getClientRateBaseline` builds the distribution from the **single account** returned by `getAccountByClientId(clientId)` — the same account whose posts `getPostsAnalytics` shows — so `ig_score` is scored against exactly the distribution the page displays. This diverges from the MCP's all-accounts loader (the MCP is service-role + multi-account); the CRM per-client page is single-account-scoped. RLS through the user session is the tenant boundary (no `verifyClient` needed, unlike the MCP).

- [ ] **Step 1: Write the failing test** — add to `analytics.test.ts`:

```ts
it('getClientRateBaseline returns MCP-shaped baseline + dists from full history', async () => {
  mockedSupabase.__queueSupabaseResult('instagram_accounts', 'select', { data: [{ id: 10, client_id: 1, username: 'a' }], error: null }); // getAccountByClientId
  mockedSupabase.__queueSupabaseResult('instagram_posts', 'select', {
    data: Array.from({ length: 6 }, (_, i) => ({
      media_type: 'VIDEO', reach: 100 + i, impressions: 100, saved: i, shares: i, likes: 10 + i, comments: 1, unavailable_metrics: [],
    })),
    error: null,
  });
  const res = await getClientRateBaseline(1);
  expect(res.sampleSize).toBe(6);
  expect(res.baseline.weights).toEqual({ share_rate: 0.4, like_rate: 0.3, save_rate: 0.2, comment_rate: 0.1 });
  expect(res.baseline.overall.like_rate.n).toBe(6);
  expect(res.baseline.overall.like_rate.quartiles).not.toBeNull(); // n=6 >= 5
  expect(res.dists.byFormat.VIDEO.like_rate.length).toBe(6);
});

it('getPostsAnalytics computes rates, ig_score (with dists), and sorts ig_score nulls last', async () => {
  // dists where like_rate has a usable sample so ig_score is non-null for liked posts
  const dists = {
    overall: { share_rate: [], like_rate: [0.05, 0.06, 0.07, 0.08, 0.09], save_rate: [], comment_rate: [], reach: [] },
    byFormat: {},
  } as never;
  mockedSupabase.__queueSupabaseResult('instagram_accounts', 'select', { data: [{ id: 10, client_id: 1 }], error: null }); // getAccountByClientId
  mockedSupabase.__queueSupabaseResult('instagram_posts', 'select', {
    data: [
      { id: 1, instagram_account_id: 10, media_type: 'IMAGE', posted_at: '2026-06-20T00:00:00Z', likes: 8, comments: 0, reach: 90, saved: 1, shares: 0, impressions: 100, unavailable_metrics: [] },
      { id: 2, instagram_account_id: 10, media_type: 'IMAGE', posted_at: '2026-06-21T00:00:00Z', likes: 0, comments: 0, reach: 0, saved: 0, shares: 0, impressions: 0, unavailable_metrics: [] }, // 0 views -> rates null -> ig_score null
    ],
    error: null,
  });
  mockedSupabase.__queueSupabaseResult('instagram_post_tag_assignments', 'select', { data: [], error: null });
  const { posts } = await getPostsAnalytics(1, 30, 'ig_score', 'desc', undefined, dists);
  expect(posts[0].id).toBe(1);            // scored post first
  expect(posts[0].rates.like_rate).toBe(0.08);
  expect(posts[0].ig_score).not.toBeNull();
  expect(posts[1].ig_score).toBeNull();   // null sinks to bottom even desc
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- analytics.test`
Expected: FAIL — `getClientRateBaseline` not exported; `rates`/`ig_score` undefined.

- [ ] **Step 3: Implement.** In `apps/crm/src/services/analytics.ts`:

(a) Extend the import from Task 2:
```ts
import {
  computeRates, scorePost, buildRateDistributions, buildBaseline, postRateSortValue,
  type Rates, type RateDistributions, type Baseline, type PostMetricRow,
} from '../lib/ig-rates';
```

(b) Extend `PostAnalytics` (after `shares: number;` near line 113):
```ts
  shares: number;
  views: number;
  rates: Rates;
  unavailable_metrics: string[];
  ig_score: number | null;
```

(c) Change the `getPostsAnalytics` signature (line ~571) to add the trailing param:
```ts
export async function getPostsAnalytics(
  clientId: number,
  days = 30,
  sort = 'posted_at',
  dir = 'desc',
  dateRange?: { start: string; end: string },
  dists?: RateDistributions,
): Promise<{ posts: PostAnalytics[]; total: number }> {
```

(d) Replace the enrich + sort block (lines ~618-647) with:
```ts
  // Compute engagement + per-view rates + ig_score
  const enriched: PostAnalytics[] = allPosts.map((p) => {
    const interactions = (p.likes || 0) + (p.comments || 0) + (p.saved || 0) + (p.shares || 0);
    const engRate = p.reach > 0 ? (interactions / p.reach) * 100 : 0;
    const savesRate = p.reach > 0 ? ((p.saved || 0) / p.reach) * 100 : 0;
    const unavailable = Array.isArray(p.unavailable_metrics) ? p.unavailable_metrics : [];
    const rates = computeRates(
      { shares: p.shares ?? 0, likes: p.likes ?? 0, saved: p.saved ?? 0, comments: p.comments ?? 0, impressions: p.impressions ?? 0 },
      unavailable,
    );
    return {
      ...p,
      engagement_rate: Math.round(engRate * 100) / 100,
      saves_rate: Math.round(savesRate * 100) / 100,
      views: p.impressions ?? 0,
      rates,
      unavailable_metrics: unavailable,
      ig_score: dists ? scorePost({ media_type: p.media_type, rates }, dists) : null,
      tags: tagMap[p.id] || [],
    };
  });

  const validCols = [
    'posted_at', 'reach', 'impressions', 'engagement_rate', 'saves_rate', 'saved', 'likes', 'comments', 'shares',
  ];
  const derivedCols = new Set(['share_rate', 'like_rate', 'save_rate', 'comment_rate', 'ig_score']);
  const col = validCols.includes(sort) || derivedCols.has(sort) ? sort : 'posted_at';
  enriched.sort((a, b) => {
    if (derivedCols.has(col)) {
      const va = postRateSortValue(a, col);
      const vb = postRateSortValue(b, col);
      if (va === null && vb === null) return 0;
      if (va === null) return 1; // nulls always last, regardless of dir
      if (vb === null) return -1;
      return dir === 'asc' ? va - vb : vb - va;
    }
    const va = (a as any)[col] ?? 0;
    const vb = (b as any)[col] ?? 0;
    return dir === 'asc' ? (va > vb ? 1 : -1) : va < vb ? 1 : -1;
  });

  return { posts: enriched, total: enriched.length };
```

(e) Add `getClientRateBaseline` after `getPostsAnalytics` (after line ~650):
```ts
/**
 * Full-history per-view rate distributions + MCP-shaped baseline for a client.
 * Single-account scoped (matches getPostsAnalytics); RLS through the user
 * session is the tenant boundary. See ig-rates.ts for the math (mirrors the
 * MCP loadClientRateDistributions + getPerformanceBaseline).
 */
export async function getClientRateBaseline(
  clientId: number,
): Promise<{ sampleSize: number; dists: RateDistributions; baseline: Baseline }> {
  const account = await getAccountByClientId(clientId);
  const { data: posts } = await supabase
    .from('instagram_posts')
    .select('media_type, reach, impressions, saved, shares, likes, comments, unavailable_metrics')
    .eq('instagram_account_id', account.id);
  const rows = (posts ?? []) as PostMetricRow[];
  const dists = buildRateDistributions(rows);
  return { sampleSize: rows.length, dists, baseline: buildBaseline(dists, rows.length) };
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm run test -- analytics.test` → PASS. Then `npm run build` → succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/services/analytics.ts apps/crm/src/services/__tests__/analytics.test.ts
git commit -m "feat(analytics): getClientRateBaseline + rates/ig_score in getPostsAnalytics"
```

---

### Task 4: Portfolio UI — rate sorts in the posts drawer

**Files:**
- Modify: `apps/crm/src/pages/analytics/AnalyticsPage.tsx` (`drawerPosts` sort switch ~449-471; `SheetDescription` ~1616-1622; drawer "Ordenar por" Select ~1627-1639; drawer row ~1799-1849)
- Test: `apps/crm/src/pages/analytics/__tests__/AnalyticsPage.test.tsx`

**Interfaces:**
- Consumes (Task 2): `PortfolioTopPost.rates`, `.views`. (Task 1): `formatRate`.

- [ ] **Step 1: Update the typed fixture, then write the failing test** — `apps/crm/src/pages/analytics/__tests__/AnalyticsPage.test.tsx`.

(a) `makeRankedPost` returns a typed `PortfolioTopPost`, so Task 2's new required fields must be defaulted or the whole file fails to typecheck. Add them to the defaults object:
```ts
  return {
    thumbnail_url: null,
    media_type: 'IMAGE',
    permalink: `https://instagram.com/p/${overrides.id}`,
    posted_at: '2020-01-01T12:00:00.000Z',
    likes: 0,
    comments: 0,
    saved: 0,
    shares: 0,
    views: 0,
    rates: { share_rate: null, like_rate: null, save_rate: null, comment_rate: null },
    unavailable_metrics: [],
    ...overrides,
  };
```

(b) Add the test. Mirror the existing drawer test (the one that does `fireEvent.click(within(bestSection).getByText('Ver mais'))`) for the render helper and the select-interaction style used in this file (it changes selects via `fireEvent.change(select, { target: { value } })`):
```ts
it('offers per-view rate sort options and reorders the drawer by rate', () => {
  const summary = makeSummary(
    [
      makeAccount({
        client_id: 1, client_name: 'Alpha', client_sigla: 'AL', client_cor: '#000', client_especialidade: 'Derm',
        instagram_account_id: 1, username: 'alpha', profile_picture_url: '', follower_count: 1000, follower_delta: 0,
        reach_28d: 5000, impressions_28d: 6000, profile_views_28d: 0, website_clicks_28d: 0, media_count: 10,
        last_synced_at: '', last_post_at: '2026-06-20T00:00:00.000Z', posts_last_30d: 5, engagement_rate_avg: 2,
      }),
    ],
    [
      makeRankedPost({ id: 1, client_name: 'Alpha', client_id: 1, reach: 500, engagement_rate: 1, views: 500,
        rates: { share_rate: 0.01, like_rate: 0.1, save_rate: 0.01, comment_rate: 0 } }),
      makeRankedPost({ id: 2, client_name: 'Bravo', client_id: 2, reach: 100, engagement_rate: 5, views: 100,
        rates: { share_rate: 0.05, like_rate: 0.1, save_rate: 0.02, comment_rate: 0 } }),
      ...Array.from({ length: 5 }, (_, i) =>
        makeRankedPost({ id: 10 + i, client_name: `Fill ${i}`, client_id: 9, reach: 40 - i, engagement_rate: 1, views: 50,
          rates: { share_rate: 0.001, like_rate: 0.01, save_rate: 0.001, comment_rate: 0 } })),
    ],
  );
  // render via the file's existing helper + makeQueryResult(summary) (see the other drawer test)
  const bestSection = screen.getByText('Melhores Posts').closest('.card') as HTMLElement;
  fireEvent.click(within(bestSection).getByText('Ver mais'));
  const drawer = screen.getByText(/posts$/).closest('aside') as HTMLElement;
  expect(within(drawer).getByText('Compart./visualização')).toBeInTheDocument();
  // change the order <select> (first select in the drawer) to share_rate
  const orderSelect = within(drawer).getAllByRole('combobox')[0];
  fireEvent.change(orderSelect, { target: { value: 'share_rate' } });
  expect(within(drawer).getByText('Top 200 por alcance, reordenado por taxa')).toBeInTheDocument();
  expect(within(drawer).getByText('5,0%')).toBeInTheDocument(); // Bravo's share_rate 0.05 rendered
});
```
If this file's mocked `@/components/ui/select` doesn't expose `role="combobox"`, use the same selector the existing day/client-filter test uses to grab the select (e.g. `container.querySelectorAll('select')` or `getByDisplayValue`).

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- AnalyticsPage`
Expected: FAIL — the rate option is absent.

- [ ] **Step 3: Implement.** In `AnalyticsPage.tsx`:

(a) Extend the import line `import { sanitizeUrl } from '../../utils/security';` region — add:
```ts
import { formatRate } from '../../lib/ig-rates';
```

(b) In the `drawerPosts` `useMemo` sort `switch` (after the `case 'saved':` block, before `case 'reach':`), add:
```ts
      case 'share_rate':
      case 'like_rate':
      case 'save_rate':
      case 'comment_rate': {
        const key = drawerOrderBy as 'share_rate' | 'like_rate' | 'save_rate' | 'comment_rate';
        posts.sort((a, b) => {
          const va = a.rates[key];
          const vb = b.rates[key];
          if (va === null && vb === null) return 0;
          if (va === null) return 1; // nulls last regardless of dir
          if (vb === null) return -1;
          return (va - vb) * dir;
        });
        break;
      }
```

(c) Add the four options to the "Ordenar por" `SelectContent` (after `<SelectItem value="saved">Salvos</SelectItem>`, line ~1636):
```tsx
                  <SelectItem value="share_rate">Compart./visualização</SelectItem>
                  <SelectItem value="like_rate">Curt./visualização</SelectItem>
                  <SelectItem value="save_rate">Salvos/visualização</SelectItem>
                  <SelectItem value="comment_rate">Coment./visualização</SelectItem>
```

(d) Label the reach-cap when a rate sort is active. Replace the `<SheetDescription>` body (lines ~1616-1622) with:
```tsx
            <SheetDescription>
              {drawerPosts.length} de{' '}
              {drawerSort === 'worst'
                ? matureReachRankedPosts.length
                : (data?.allRankedPosts?.length ?? 0)}{' '}
              posts
              {['share_rate', 'like_rate', 'save_rate', 'comment_rate'].includes(drawerOrderBy) && (
                <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  Top 200 por alcance, reordenado por taxa
                </span>
              )}
            </SheetDescription>
```

(e) Show the active rate in each drawer row. In the metrics line (after the `Eng.` `<span>…</span>`, around line 1830), add:
```tsx
                    {['share_rate', 'like_rate', 'save_rate', 'comment_rate'].includes(drawerOrderBy) && (
                      <span>
                        {{ share_rate: 'Compart.', like_rate: 'Curt.', save_rate: 'Salvos', comment_rate: 'Coment.' }[drawerOrderBy]}
                        /view{' '}
                        <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-main)' }}>
                          {formatRate(post.rates[drawerOrderBy as 'share_rate' | 'like_rate' | 'save_rate' | 'comment_rate'])}
                        </strong>
                      </span>
                    )}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm run test -- AnalyticsPage` → PASS. Then `npm run build` → succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/analytics/AnalyticsPage.tsx apps/crm/src/pages/analytics/__tests__/AnalyticsPage.test.tsx
git commit -m "feat(analytics): per-view rate sorts in portfolio posts drawer"
```

---

### Task 5: Per-client UI — baseline card, ig_score column, rate/score sorts

**Files:**
- Modify: `apps/crm/src/pages/analytics-conta/AnalyticsContaPage.tsx` (baseline query wiring ~1036-1042; sync invalidate ~1180-1182; `RankedPostOrderBy` type ~393-400; ranked-drawer `switch` ~1104-1128; content-table header config ~1598-1607 + row ~1672-1682; ranked-drawer `<select>` ~2291-2297; new `BaselineCard` placed before "Desempenho por Tipo" ~1804)
- Test: `apps/crm/src/pages/analytics-conta/__tests__/AnalyticsContaPage.test.tsx`

**Interfaces:**
- Consumes (Task 3): `getClientRateBaseline`, `PostAnalytics.ig_score`/`.rates`. (Task 1): `formatRate`, `IG_RATE_WEIGHTS`, types `Baseline`, `Quartiles`, `RateKey`.

- [ ] **Step 1: Update mocks, then write the failing test** — `apps/crm/src/pages/analytics-conta/__tests__/AnalyticsContaPage.test.tsx`.

This file mocks `useQuery` to return `queryState[String(queryKey[0])]` and mocks the whole `../../../services/analytics` module; tests render by populating `queryState[...]` directly. So:

(a) Add `getClientRateBaseline: vi.fn()` to the `vi.mock('../../../services/analytics', () => ({ … }))` object (~line 81), add `getClientRateBaseline` to the import-from-analytics list (~line 231), and `const mockedGetClientRateBaseline = vi.mocked(getClientRateBaseline);` with the other mocked refs.

(b) In the shared default setup where `queryState` defaults are built (~line 260), add a benign default so existing tests are unaffected (card renders only when `baselineQuery.data` is truthy):
```ts
  queryState['client-rate-baseline'] = { data: undefined };
```

(c) Add the tests (use this file's existing render helper — the one the other `it(...)` blocks call):
```ts
it('renders the Baseline Instagram card and an ig_score badge', () => {
  const q = { p25: 0.01, p50: 0.02, p75: 0.03 };
  const bucket = {
    share_rate: { n: 6, quartiles: q }, like_rate: { n: 6, quartiles: q },
    save_rate: { n: 6, quartiles: q }, comment_rate: { n: 6, quartiles: q },
    reach: { n: 6, quartiles: { p25: 50, p50: 100, p75: 150 } },
  };
  queryState['client-rate-baseline'] = {
    data: {
      sampleSize: 6,
      dists: { overall: {}, byFormat: {} },
      baseline: {
        sample_size: 6,
        weights: { share_rate: 0.4, like_rate: 0.3, save_rate: 0.2, comment_rate: 0.1 },
        weights_note: 'Internal IG-aligned heuristic (shares>likes>saves>comments), not Instagram\'s published weights.',
        overall: bucket,
        by_format: { VIDEO: bucket },
      },
    },
  };
  queryState['analytics-posts'] = {
    data: {
      posts: [{
        id: 1, instagram_post_id: 'x', caption: '', media_type: 'VIDEO', permalink: 'https://x',
        posted_at: '2026-06-20T00:00:00Z', likes: 10, comments: 1, reach: 90, impressions: 100, saved: 2, shares: 3,
        thumbnail_url: null, engagement_rate: 5, saves_rate: 2, views: 100, unavailable_metrics: [],
        rates: { share_rate: 0.03, like_rate: 0.1, save_rate: 0.02, comment_rate: 0.01 }, ig_score: 80, tags: [],
      }],
    },
  };
  // render via the file's existing helper
  expect(screen.getByText('Baseline Instagram')).toBeInTheDocument();
  expect(screen.getByText(/não são os pesos oficiais/)).toBeInTheDocument();
  expect(screen.getByText('IG Score')).toBeInTheDocument();
  expect(screen.getByText('80')).toBeInTheDocument();
});

it('hides the Baseline Instagram card when there is no baseline data', () => {
  queryState['client-rate-baseline'] = { data: undefined };
  // render via the file's existing helper
  expect(screen.queryByText('Baseline Instagram')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test -- AnalyticsContaPage`
Expected: FAIL — no "Baseline Instagram", no "IG Score".

- [ ] **Step 3: Implement.** In `AnalyticsContaPage.tsx`:

(a) Add imports:
```ts
import { formatRate, IG_RATE_WEIGHTS, type Baseline, type Quartiles, type RateKey } from '../../lib/ig-rates';
import { getClientRateBaseline } from '../../services/analytics'; // add to the existing analytics import list
```

(b) Add the baseline query and thread dists into the posts query. Replace the posts `useQuery` (lines ~1040-1042) with:
```tsx
  const baselineQuery = useQuery({
    queryKey: ['client-rate-baseline', clientId],
    queryFn: () => getClientRateBaseline(clientId),
    retry: false, // non-critical: never block/delay the posts query
  });
  const { data: postsRes, isLoading: loadingPosts } = useQuery({
    queryKey: ['analytics-posts', clientId, days, sort.col, sort.dir, periodStart, periodEnd, baselineQuery.dataUpdatedAt],
    queryFn: () => getPostsAnalytics(clientId, days, sort.col, sort.dir, dateRange, baselineQuery.data?.dists),
    enabled: baselineQuery.isSuccess || baselineQuery.isError,
  });
```

(c) Add the baseline key to the sync handler's invalidation list (after line ~1182):
```ts
      qc.invalidateQueries({ queryKey: ['client-rate-baseline', clientId] });
```

(d) Extend `RankedPostOrderBy` (lines 393-400):
```ts
type RankedPostOrderBy =
  | 'engagement'
  | 'reach'
  | 'likes'
  | 'comments'
  | 'saved'
  | 'shares'
  | 'date'
  | 'ig_score'
  | 'share_rate'
  | 'like_rate'
  | 'save_rate'
  | 'comment_rate';
```

(e) Add cases to the ranked-drawer sort `switch` (after `case 'shares':` ~line 1122):
```ts
      case 'ig_score':
        next.sort((a, b) => {
          const va = a.ig_score;
          const vb = b.ig_score;
          if (va === null && vb === null) return 0;
          if (va === null) return 1;
          if (vb === null) return -1;
          return (va - vb) * dir;
        });
        break;
      case 'share_rate':
      case 'like_rate':
      case 'save_rate':
      case 'comment_rate': {
        const key = rankedOrderBy as RateKey;
        next.sort((a, b) => {
          const va = a.rates[key];
          const vb = b.rates[key];
          if (va === null && vb === null) return 0;
          if (va === null) return 1;
          if (vb === null) return -1;
          return (va - vb) * dir;
        });
        break;
      }
```

(f) Add options to the ranked-drawer `<select>` (after `<option value="shares">Compart.</option>` ~line 2296):
```tsx
                <option value="ig_score">IG Score</option>
                <option value="share_rate">Compart./view</option>
                <option value="like_rate">Curt./view</option>
                <option value="save_rate">Salvos/view</option>
                <option value="comment_rate">Coment./view</option>
```

(g) Add the IG Score column to the content table. In the header config array (lines ~1598-1607), insert after the `engagement_rate` entry:
```tsx
                    { col: 'ig_score', label: 'IG Score' },
```
And add the cell in the row, right after the `Eng.` `<td>` (after line ~1678):
```tsx
                      <td data-label="IG Score">
                        {p.ig_score === null ? (
                          <span title="amostra insuficiente (<5)" style={{ color: 'var(--text-muted)' }}>—</span>
                        ) : (
                          <span
                            className={`badge ${p.ig_score >= 75 ? 'badge-success' : p.ig_score >= 40 ? 'badge-neutral' : 'badge-danger'}`}
                          >
                            {p.ig_score}
                          </span>
                        )}
                      </td>
```

(h) Add the `BaselineCard` component near the other card components (e.g. after `TypeChart`, before the default export). It renders Variant B (rate strips), hides when `sampleSize === 0`:
```tsx
const RATE_STRIP_LABELS: Record<RateKey, string> = {
  share_rate: 'Compartilhamentos',
  like_rate: 'Curtidas',
  save_rate: 'Salvos',
  comment_rate: 'Comentários',
};
const FORMAT_LABELS: Record<string, string> = {
  VIDEO: 'Reels',
  CAROUSEL_ALBUM: 'Carrossel',
  IMAGE: 'Imagem',
};

function BaselineCard({ baseline }: { baseline: Baseline }) {
  if (baseline.sample_size === 0) return null;
  const strip = (key: RateKey) => {
    const stat = baseline.overall[key];
    const q: Quartiles | null = stat.quartiles;
    const scaleMax = q ? (q.p75 || 0) * 1.5 || 1 : 1;
    const pct = (v: number) => Math.max(0, Math.min(100, (v / scaleMax) * 100));
    const perFormat = Object.entries(baseline.by_format)
      .map(([fmt, m]) => {
        const fq = m[key].quartiles;
        return `${FORMAT_LABELS[fmt] ?? fmt} ${fq ? formatRate(fq.p50) : 'n<5'}`;
      })
      .join(' · ');
    return (
      <div key={key} style={{ marginBottom: '0.85rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: '0.78rem' }}>
          <span style={{ fontWeight: 600 }}>
            {RATE_STRIP_LABELS[key]}{' '}
            <span style={{ color: 'var(--primary-color)', fontSize: '0.62rem' }}>
              peso {Math.round(IG_RATE_WEIGHTS[key] * 100)}%
            </span>
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
            {q ? formatRate(q.p50) : '—'}{' '}
            <span style={{ color: 'var(--text-muted)', fontWeight: 400, fontSize: '0.65rem' }}>mediana</span>
          </span>
        </div>
        <div style={{ position: 'relative', height: 8, background: 'var(--surface-darker)', borderRadius: 4, marginTop: 5 }}>
          {q && (
            <>
              <div
                style={{
                  position: 'absolute',
                  left: `${pct(q.p25)}%`,
                  width: `${Math.max(0, pct(q.p75) - pct(q.p25))}%`,
                  top: 0,
                  bottom: 0,
                  background: 'rgba(234,179,8,0.33)',
                  borderRadius: 4,
                }}
              />
              <div style={{ position: 'absolute', left: `${pct(q.p50)}%`, top: -2, width: 3, height: 12, background: 'var(--primary-color)', borderRadius: 2 }} />
            </>
          )}
        </div>
        <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: 3, fontFamily: 'var(--font-mono)' }}>
          {q ? `p25 ${formatRate(q.p25)} · p75 ${formatRate(q.p75)} — ` : 'amostra insuficiente — '}
          {perFormat}
        </div>
      </div>
    );
  };
  return (
    <div className="card animate-up">
      <div className="dashboard-hub-card-header" style={{ marginBottom: '0.25rem' }}>
        <h3>Baseline Instagram</h3>
      </div>
      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
        Histórico completo · {baseline.sample_size} posts · por visualização · pontuado vs. histórico completo do
        cliente — igual ao que o agente vê.
      </div>
      {(['share_rate', 'like_rate', 'save_rate', 'comment_rate'] as RateKey[]).map(strip)}
      <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border-color)', paddingTop: '0.6rem', lineHeight: 1.5 }}>
        Heurística interna alinhada ao IG (compart.&gt;curt.&gt;salvos&gt;coment.) — não são os pesos oficiais do
        Instagram. Taxa de skip e repost não estão na API.
      </div>
    </div>
  );
}
```

(i) Render the card. Just before the "Desempenho por Tipo" card block (line ~1804, the `<div className="card">` whose header is `<h3>Desempenho por Tipo</h3>`), insert:
```tsx
      {baselineQuery.data && <BaselineCard baseline={baselineQuery.data.baseline} />}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npm run test -- AnalyticsContaPage` → PASS. Then `npm run build` → succeeds.

- [ ] **Step 5: Full suite + commit**

Run: `npm run test` (whole frontend suite) → PASS.

```bash
git add apps/crm/src/pages/analytics-conta/AnalyticsContaPage.tsx apps/crm/src/pages/analytics-conta/__tests__/AnalyticsContaPage.test.tsx
git commit -m "feat(analytics): per-client baseline card + ig_score column & sorts"
```

---

## Final verification (after all tasks)

- [ ] `npm run build` (tsc + vite) succeeds.
- [ ] `npm run test` full frontend suite green.
- [ ] Grep both app test suites for stale `PortfolioTopPost` / `PostAnalytics` fixtures missing the new fields and update any that break: `grep -rn "allRankedPosts\|PostAnalytics\|engagement_rate:" apps/crm/src/**/__tests__`.
- [ ] Deno suite unaffected (no edge-function changes) — no need to run `deno test`, and do NOT let any deno/deploy command run (would pollute `deno.lock`).

## Notes for the implementer

- **Do not touch** `scripts/mcp-local-seed.mjs` or `supabase/snippets/` (untracked parallel work).
- The branch is `feat/ig-aligned-ranking-analytics-ui` (based on `main` @ `6915f0a`). Stay on it.
- No CSS classes invented beyond existing ones (`card`, `badge`, `badge-success/neutral/danger/info`, `dashboard-hub-card-header`, `animate-up`) and CSS vars from the design system.
