# IG-Aligned Ranking — Foundation + MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rank Instagram posts by per-view engagement *rates* in Instagram's order of importance (an internal heuristic), expose it through the MCP tools (rate-based baseline, `list_posts`, `get_post`, `ig_score`), and sync the data needed to feed it.

**Architecture:** A pure scoring model in `mcp/content.ts` (rates, weights, percentile, composite score); a shared, testable sync helper in `_shared/instagram-metrics.ts` that fetches `shares` for all media types and preserves previous values; one migration adding an availability-marker column + a historical backfill; and MCP query wiring that computes rates/score relative to each client's own distribution.

**Tech Stack:** Deno edge functions (TypeScript), Supabase Postgres (PostgREST), Vitest/Deno test.

## Global Constraints

- Rates = numerator ÷ **views** (the `impressions` column). `0` is a real rate; a metric **not returned by the API** ⇒ that rate component is `null` (never `0`). `views` unavailable or `0` ⇒ all rates `null`.
- Weights are an **internal IG-aligned heuristic, NOT Instagram's published weights** (Meta publishes none). Label them as such in code and payloads. Values: `share_rate 0.40 · like_rate 0.30 · save_rate 0.20 · comment_rate 0.10`.
- `ig_score` is percentile-normalized against the client's own distribution; quartile **tiers** stay for human-readable labels.
- `MIN_SAMPLE = 5`. Distribution per rate: client+format if it has ≥5 non-null values, else client-wide (all formats) if ≥5, else that component is excluded; if no component usable ⇒ `ig_score: null`.
- `unavailable_metrics` tokens use the DB column names: `reach`, `impressions`, `saved`, `shares`, `likes`, `comments`. Count columns stay numeric (never write `NULL`); the marker column is the single source of truth for availability.
- `ig_score` sort **requires `client_id`** → else `McpInputError("ig_score sort requires client_id")` (no raw-rate fallback).
- Derived-metric sorts (rates, `ig_score`) fetch up to `DERIVED_SORT_CAP = 500`, sort, then slice to `limit`; surface truncation, never silently cap.
- Sync writes **complete payloads** (no omitted columns) to avoid PostgREST bulk-upsert `defaultToNull` ambiguity; an unavailable metric preserves the previous value, else `0` for a new row.
- Deno tests run via `npm run test:functions` (`deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/`). After any `deno`/deploy command, restore `deno.lock` + `supabase/functions/deno.lock` and run `npm ci`.
- All commits end with the standard `Co-Authored-By` + `Claude-Session` trailer.

---

### Task 1: Scoring model — pure helpers in `content.ts`

**Files:**
- Modify: `supabase/functions/mcp/content.ts` (append after `performanceTier`, ~line 74)
- Test: `supabase/functions/__tests__/mcp-content_test.ts`

**Interfaces:**
- Produces: `RateKey`, `Rates`, `IG_RATE_WEIGHTS`, `MIN_SAMPLE`, `computeRates(counts, unavailable?) -> Rates`, `percentileRank(value, sample) -> number|null`, `igAlignedScore(rates, distributions) -> number|null`. Consumes existing `quartiles`, `performanceTier`, `Quartiles`.

- [ ] **Step 1: Write the failing tests** — add to `mcp-content_test.ts` (import the new symbols at the top alongside the existing imports):

```ts
import {
  computeRates, percentileRank, igAlignedScore, IG_RATE_WEIGHTS, MIN_SAMPLE,
} from "../mcp/content.ts";

Deno.test("computeRates: 0 is real, missing is null, views 0/missing -> null", () => {
  // views>0, likes 0 returned -> like_rate 0; shares not returned -> null
  const r = computeRates(
    { shares: 0, likes: 0, saved: 4, comments: 2, impressions: 100 },
    ["shares"],
  );
  assertEquals(r.like_rate, 0);          // returned 0 => real 0
  assertEquals(r.save_rate, 0.04);
  assertEquals(r.comment_rate, 0.02);
  assertEquals(r.share_rate, null);      // unavailable => null, not 0
  // views == 0 -> all null
  const z = computeRates({ shares: 1, likes: 1, saved: 1, comments: 1, impressions: 0 });
  assertEquals(z, { share_rate: null, like_rate: null, save_rate: null, comment_rate: null });
  // views unavailable -> all null even if numerators returned
  const v = computeRates({ shares: 1, likes: 1, saved: 1, comments: 1, impressions: 50 }, ["impressions"]);
  assertEquals(v.like_rate, null);
});

Deno.test("percentileRank: midrank for ties; null for empty/null", () => {
  assertEquals(percentileRank(5, []), null);
  assertEquals(percentileRank(null, [1, 2, 3]), null);
  // sample [10,10,20,30], value 10 -> (0 + 0.5*2)/4 = 0.125 (midrank)
  assertEquals(percentileRank(10, [10, 10, 20, 30]), 0.125);
  // value above all -> (3 + 0.5*1)/4? value 30: less=3, equal=1 -> 3.5/4 = 0.875
  assertEquals(percentileRank(30, [10, 10, 20, 30]), 0.875);
});

Deno.test("igAlignedScore: weights present components, renormalizes, small-sample excluded", () => {
  const big = Array.from({ length: 5 }, (_, i) => i / 100); // 5 values 0..0.04
  // all four rates present, each at top of its sample -> score 100
  const dist = { share_rate: big, like_rate: big, save_rate: big, comment_rate: big };
  const top = igAlignedScore(
    { share_rate: 0.05, like_rate: 0.05, save_rate: 0.05, comment_rate: 0.05 }, dist,
  );
  assertEquals(top, 100);
  // share_rate null -> dropped, others renormalize (still 100 at top)
  const noShare = igAlignedScore(
    { share_rate: null, like_rate: 0.05, save_rate: 0.05, comment_rate: 0.05 }, dist,
  );
  assertEquals(noShare, 100);
  // sample under MIN_SAMPLE -> that component excluded; no usable -> null
  const tiny = { share_rate: [0.01], like_rate: [0.01], save_rate: [0.01], comment_rate: [0.01] };
  assertEquals(
    igAlignedScore({ share_rate: 0.02, like_rate: 0.02, save_rate: 0.02, comment_rate: 0.02 }, tiny),
    null,
  );
  assertEquals(MIN_SAMPLE, 5);
});
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `npm run test:functions -- --filter "computeRates"`
Expected: FAIL (computeRates not exported). (Restore `deno.lock` + `npm ci` after — see Global Constraints.)

- [ ] **Step 3: Implement the helpers** — append to `supabase/functions/mcp/content.ts` after `performanceTier` (line 74):

```ts
// ---- IG-aligned engagement rates & score -------------------------------------
// Rank posts by per-view engagement rates in Instagram's order of importance.
// The weights below are an INTERNAL heuristic informed by public guidance that
// emphasizes shares/sends — NOT Instagram's published weights (Meta publishes none).

export type RateKey = "share_rate" | "like_rate" | "save_rate" | "comment_rate";
export type Rates = Record<RateKey, number | null>;

export const IG_RATE_WEIGHTS: Record<RateKey, number> = {
  share_rate: 0.40,
  like_rate: 0.30,
  save_rate: 0.20,
  comment_rate: 0.10,
};

/** Minimum non-null sample for a usable distribution (percentile / quartiles). */
export const MIN_SAMPLE = 5;

// Each rate's numerator maps to a DB-column token; views is the `impressions` column.
const RATE_NUMERATOR: Record<RateKey, "shares" | "likes" | "saved" | "comments"> = {
  share_rate: "shares",
  like_rate: "likes",
  save_rate: "saved",
  comment_rate: "comments",
};

/**
 * Per-view rates. `0` is a real rate; a numerator listed in `unavailable` (or
 * `views`/`impressions` unavailable or 0) yields `null`, never `0`.
 */
export function computeRates(
  counts: { shares: number; likes: number; saved: number; comments: number; impressions: number },
  unavailable: Iterable<string> = [],
): Rates {
  const u = new Set(unavailable);
  const views = counts.impressions;
  const viewsOk = !u.has("impressions") && typeof views === "number" && views > 0;
  const out = {} as Rates;
  for (const key of Object.keys(IG_RATE_WEIGHTS) as RateKey[]) {
    const token = RATE_NUMERATOR[key];
    const num = counts[token];
    out[key] = !viewsOk || u.has(token) || typeof num !== "number" || Number.isNaN(num)
      ? null
      : num / views;
  }
  return out;
}

/** Midrank percentile of `value` within `sample` (0..1). null if sample empty or value null. */
export function percentileRank(value: number | null | undefined, sample: number[]): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const xs = sample.filter((v) => typeof v === "number" && !Number.isNaN(v));
  if (xs.length === 0) return null;
  let less = 0, equal = 0;
  for (const x of xs) {
    if (x < value) less++;
    else if (x === value) equal++;
  }
  return (less + 0.5 * equal) / xs.length;
}

/**
 * Composite 0–100 score: each non-null rate is placed at its percentile within
 * its (already format-or-overall selected) distribution, weighted by the IG
 * heuristic. Components whose sample is < MIN_SAMPLE are excluded; weights
 * renormalize over what's present. null when no component is usable.
 */
export function igAlignedScore(
  rates: Rates,
  distributions: Record<RateKey, number[]>,
): number | null {
  let acc = 0, wsum = 0;
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
```

- [ ] **Step 4: Run the tests** — `npm run test:functions -- --filter "computeRates"` then `--filter "percentileRank"` and `--filter "igAlignedScore"`. Expected: PASS. Restore `deno.lock` + `npm ci`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/mcp/content.ts supabase/functions/__tests__/mcp-content_test.ts
git commit -m "feat(mcp): IG-aligned rate/score scoring helpers"
```

---

### Task 2: Migration — `unavailable_metrics` column + historical shares backfill

**Files:**
- Create: `supabase/migrations/20260625000001_instagram_unavailable_metrics.sql`

**Interfaces:**
- Produces: `instagram_posts.unavailable_metrics text[] NOT NULL DEFAULT '{}'`, with historical non-video rows marked `shares`-unavailable.

- [ ] **Step 1: Write the migration** — create the file with exactly:

```sql
-- Track which Instagram metrics the API did not return at last sync, so the MCP
-- rate layer can tell a real 0 from a missing value. Count columns stay numeric.
ALTER TABLE instagram_posts
  ADD COLUMN IF NOT EXISTS unavailable_metrics text[] NOT NULL DEFAULT '{}';

-- Backfill: the old sync fetched `shares` only for media_type = 'VIDEO'
-- (instagram-integration/index.ts), so historical image/carousel rows carry a
-- real-looking shares = 0 that would poison share-rate baselines. Mark them.
UPDATE instagram_posts
   SET unavailable_metrics = array_append(unavailable_metrics, 'shares')
 WHERE media_type <> 'VIDEO'
   AND NOT ('shares' = ANY(unavailable_metrics));
```

- [ ] **Step 2: Structural sanity check**

```bash
cd /Users/eduardosouza/Projects/sm-crm
grep -c "ADD COLUMN IF NOT EXISTS unavailable_metrics" supabase/migrations/20260625000001_instagram_unavailable_metrics.sql   # expect 1
grep -c "array_append(unavailable_metrics, 'shares')" supabase/migrations/20260625000001_instagram_unavailable_metrics.sql   # expect 1
```
Expected: both print `1`. (DB application is a deploy step; no local DB test harness for migrations.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260625000001_instagram_unavailable_metrics.sql
git commit -m "feat(instagram): unavailable_metrics column + historical shares backfill"
```

---

### Task 3: Shared sync helper `_shared/instagram-metrics.ts` (pure/injectable) + tests

**Files:**
- Create: `supabase/functions/_shared/instagram-metrics.ts`
- Test: `supabase/functions/__tests__/instagram-metrics_test.ts`

**Interfaces:**
- Produces:
  - `fetchPostInsights(fetchFn, mediaId, token) -> Promise<{ values: Partial<Record<"reach"|"impressions"|"saved"|"shares", number>>, returned: Set<string> }>` — tries `reach,views,saved,shares`; on a shares-only rejection retries `reach,views,saved`.
  - `buildMetricFields(existing, insights, mediaNode) -> { reach, impressions, saved, shares, likes, comments, unavailable_metrics }` — complete numeric payload preserving previous values for unavailable metrics.
- Consumes: nothing app-specific (fetch injected for tests).

- [ ] **Step 1: Write the failing tests** — `supabase/functions/__tests__/instagram-metrics_test.ts`:

```ts
import { assert, assertEquals } from "./assert.ts";
import { buildMetricFields, fetchPostInsights } from "../_shared/instagram-metrics.ts";

const ok = (data: unknown) => Promise.resolve({ json: () => Promise.resolve({ data }) } as Response);
const errBody = (msg: string) =>
  Promise.resolve({ json: () => Promise.resolve({ error: { message: msg } }) } as Response);

Deno.test("fetchPostInsights: parses returned metrics, marks the rest absent", async () => {
  const fetchFn = ((_u: string) => ok([
    { name: "reach", values: [{ value: 100 }] },
    { name: "views", values: [{ value: 200 }] },
    { name: "saved", values: [{ value: 5 }] },
    { name: "shares", values: [{ value: 3 }] },
  ])) as typeof fetch;
  const r = await fetchPostInsights(fetchFn, "m1", "tok");
  assertEquals(r.values, { reach: 100, impressions: 200, saved: 5, shares: 3 });
  assert(r.returned.has("shares"));
});

Deno.test("fetchPostInsights: shares rejection -> retry without shares, only shares absent", async () => {
  let calls = 0;
  const fetchFn = ((url: string) => {
    calls++;
    if (url.includes("shares")) return errBody("shares is not supported for this media product type");
    return ok([
      { name: "reach", values: [{ value: 10 }] },
      { name: "views", values: [{ value: 20 }] },
      { name: "saved", values: [{ value: 1 }] },
    ]);
  }) as typeof fetch;
  const r = await fetchPostInsights(fetchFn, "m2", "tok");
  assertEquals(calls, 2);
  assertEquals(r.values.reach, 10);
  assertEquals(r.values.impressions, 20);
  assert(!r.returned.has("shares"));
  assert(r.returned.has("reach"));
});

Deno.test("buildMetricFields: preserve previous on conflict, 0 on new row, mark unavailable", () => {
  // existing row, shares not returned this sync -> preserve previous 7, mark unavailable
  const upd = buildMetricFields(
    { reach: 9, impressions: 90, saved: 2, shares: 7, likes: 4, comments: 1 },
    { values: { reach: 11, impressions: 110, saved: 3 }, returned: new Set(["reach", "impressions", "saved"]) },
    { like_count: 5, comments_count: 1 },
  );
  assertEquals(upd.reach, 11);
  assertEquals(upd.shares, 7);                 // preserved, not 0
  assertEquals(upd.likes, 5);
  assert(upd.unavailable_metrics.includes("shares"));
  assert(!upd.unavailable_metrics.includes("reach"));

  // brand-new row (no existing), shares unavailable -> 0 + marked
  const ins = buildMetricFields(
    null,
    { values: { reach: 1, impressions: 2, saved: 0 }, returned: new Set(["reach", "impressions", "saved"]) },
    { like_count: 0, comments_count: 0 },
  );
  assertEquals(ins.shares, 0);
  assert(ins.unavailable_metrics.includes("shares"));
  assertEquals(ins.likes, 0);
  assert(!ins.unavailable_metrics.includes("likes"));   // like_count present (0) => available
});

Deno.test("buildMetricFields: missing media-node likes/comments are marked unavailable", () => {
  const r = buildMetricFields(
    null,
    { values: { reach: 1, impressions: 2, saved: 0, shares: 0 }, returned: new Set(["reach", "impressions", "saved", "shares"]) },
    {},
  );
  assert(r.unavailable_metrics.includes("likes"));
  assert(r.unavailable_metrics.includes("comments"));
});
```

- [ ] **Step 2: Run to confirm failure** — `npm run test:functions -- --filter "fetchPostInsights"`. Expected: FAIL (module missing). Restore locks + `npm ci`.

- [ ] **Step 3: Implement** — `supabase/functions/_shared/instagram-metrics.ts`:

```ts
// Shared Instagram per-post metric helpers, used by every sync site
// (instagram-integration connect + refresh, instagram-sync-cron). Pure /
// fetch-injectable so the preservation + availability logic is unit-tested.

type InsightValue = { reach?: number; impressions?: number; saved?: number; shares?: number };
type ApiToken = "reach" | "views" | "saved" | "shares";
// API metric name -> our column token. `views` is stored as `impressions`.
const API_TO_COL: Record<ApiToken, "reach" | "impressions" | "saved" | "shares"> = {
  reach: "reach", views: "impressions", saved: "saved", shares: "shares",
};

function parseInsights(data: any[]): { values: InsightValue; returned: Set<string> } {
  const values: InsightValue = {};
  const returned = new Set<string>();
  for (const insight of data ?? []) {
    const col = API_TO_COL[insight?.name as ApiToken];
    const v = insight?.values?.[0]?.value;
    if (col && typeof v === "number") {
      values[col] = v;
      returned.add(col);
    }
  }
  return { values, returned };
}

/**
 * Fetch per-post insights. Tries reach,views,saved,shares; if the response is an
 * error mentioning `shares` (unsupported for some media types), retries without
 * shares so reach/views/saved are never lost to a shares-only rejection.
 * Any total failure yields an empty result (all metrics treated as absent).
 */
export async function fetchPostInsights(
  fetchFn: typeof fetch,
  mediaId: string,
  token: string,
): Promise<{ values: InsightValue; returned: Set<string> }> {
  const url = (metrics: string) =>
    `https://graph.instagram.com/${mediaId}/insights?metric=${metrics}&access_token=${token}`;
  try {
    const res = await fetchFn(url("reach,views,saved,shares"));
    const body = await res.json();
    if (Array.isArray(body?.data)) return parseInsights(body.data);
    const msg = String(body?.error?.message ?? "");
    if (/share/i.test(msg)) {
      const res2 = await fetchFn(url("reach,views,saved"));
      const body2 = await res2.json();
      if (Array.isArray(body2?.data)) return parseInsights(body2.data);
    }
  } catch (_) { /* fall through to empty */ }
  return { values: {}, returned: new Set() };
}

type Counts = { reach: number; impressions: number; saved: number; shares: number; likes: number; comments: number };

/**
 * Build a COMPLETE numeric payload for the metric columns (no omitted keys, so
 * PostgREST bulk upserts can't fill them with null/default). For each metric:
 * use the freshly-fetched value when returned, else preserve the previous value,
 * else 0 (new row). `unavailable_metrics` lists everything not freshly returned.
 */
export function buildMetricFields(
  existing: Partial<Counts> | null,
  insights: { values: InsightValue; returned: Set<string> },
  mediaNode: { like_count?: number; comments_count?: number },
): Counts & { unavailable_metrics: string[] } {
  const unavailable: string[] = [];
  const pick = (token: keyof Counts, fresh: number | undefined, present: boolean): number => {
    if (present && typeof fresh === "number") return fresh;
    unavailable.push(token);
    return existing?.[token] ?? 0;
  };
  return {
    reach: pick("reach", insights.values.reach, insights.returned.has("reach")),
    impressions: pick("impressions", insights.values.impressions, insights.returned.has("impressions")),
    saved: pick("saved", insights.values.saved, insights.returned.has("saved")),
    shares: pick("shares", insights.values.shares, insights.returned.has("shares")),
    likes: pick("likes", mediaNode.like_count, typeof mediaNode.like_count === "number"),
    comments: pick("comments", mediaNode.comments_count, typeof mediaNode.comments_count === "number"),
    unavailable_metrics: unavailable,
  };
}
```

- [ ] **Step 4: Run tests** — `npm run test:functions -- --filter "fetchPostInsights"` and `--filter "buildMetricFields"`. Expected: PASS. Restore locks + `npm ci`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/instagram-metrics.ts supabase/functions/__tests__/instagram-metrics_test.ts
git commit -m "feat(instagram): shared per-post metric helper (shares-all-types + preserve)"
```

---

### Task 4: Wire the three sync sites to the helper

**Files:**
- Modify: `supabase/functions/instagram-integration/index.ts:352-382` (connect) and `:570-610` (refresh)
- Modify: `supabase/functions/instagram-sync-cron/index.ts:233-271`

**Interfaces:**
- Consumes: `fetchPostInsights`, `buildMetricFields` (Task 3).

Each site currently sets `let reach=0,…` then fetches `reach,views,saved`(+`shares` for VIDEO), parses inline, and writes `reach, impressions, saved, shares` into the upsert object. Replace that with: read existing rows once per account, then per post use the helper.

- [ ] **Step 1: Add the import** to all three files (top, with the other `_shared` imports):

```ts
import { buildMetricFields, fetchPostInsights } from "../_shared/instagram-metrics.ts";
```

- [ ] **Step 2: Connect path (`instagram-integration/index.ts`, ~352-382).** Before the `for (const post of mediaData.data)` loop, read existing rows:

```ts
const existingByPostId = new Map<string, any>();
{
  const ids = (mediaData.data ?? []).map((p: any) => p.id);
  if (ids.length) {
    const { data: existingRows } = await serviceClient
      .from('instagram_posts')
      .select('instagram_post_id, reach, impressions, saved, shares, likes, comments')
      .in('instagram_post_id', ids);
    for (const r of existingRows ?? []) existingByPostId.set(r.instagram_post_id, r);
  }
}
```

Replace the per-post metric block (the `let reach=0,…` through the `catch`) and the `reach, impressions, saved, shares` fields in the upsert with:

```ts
const insights = await fetchPostInsights(fetch, post.id, longLivedToken);
const m = buildMetricFields(existingByPostId.get(post.id) ?? null, insights, post);
```
and in the `.upsert({ … })` object replace `likes: post.like_count || 0, comments: post.comments_count || 0, reach, impressions, saved, shares,` with:
```ts
likes: m.likes, comments: m.comments,
reach: m.reach, impressions: m.impressions, saved: m.saved, shares: m.shares,
unavailable_metrics: m.unavailable_metrics,
```

- [ ] **Step 3: Refresh path (`instagram-integration/index.ts`, ~564-611).** Before `const allPostData: any[] = [];`, add the same existing-rows read (using `serviceClient` and `mediaData.data`). Inside `batch.map(async (post) => { … })`, replace the `let reach=0,…` block with:

```ts
const insights = await fetchPostInsights(fetch, post.id, accessToken);
const m = buildMetricFields(existingByPostId.get(post.id) ?? null, insights, post);
```
and in the returned object replace `likes: post.like_count || 0, comments: post.comments_count || 0, reach, impressions, saved, shares,` with the same six-field + `unavailable_metrics` block as Step 2.

- [ ] **Step 4: Cron (`instagram-sync-cron/index.ts`, ~228-273).** Before `const allPostData: any[] = [];`, read existing rows for `recentPosts` ids (using `supabase` as the client):

```ts
const existingByPostId = new Map<string, any>();
{
  const ids = recentPosts.map((p: any) => p.id);
  if (ids.length) {
    const { data: existingRows } = await supabase
      .from('instagram_posts')
      .select('instagram_post_id, reach, impressions, saved, shares, likes, comments')
      .in('instagram_post_id', ids);
    for (const r of existingRows ?? []) existingByPostId.set(r.instagram_post_id, r);
  }
}
```
Replace the per-post `let reach=0,…` block with the `fetchPostInsights`/`buildMetricFields` pair (token = `accessToken`) and the returned object's metric fields with the six-field + `unavailable_metrics` block as in Step 2.

- [ ] **Step 5: Typecheck**

Run: `deno check --node-modules-dir=auto supabase/functions/instagram-integration/index.ts supabase/functions/instagram-sync-cron/index.ts`
Expected: clean (exit 0). Restore `deno.lock` + `supabase/functions/deno.lock` + `npm ci`.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/instagram-integration/index.ts supabase/functions/instagram-sync-cron/index.ts
git commit -m "feat(instagram): fetch shares for all media types; preserve + mark unavailable"
```

---

### Task 5: MCP read foundation — `loadMetrics` + `loadClientRateDistributions` + rates on rows

**Files:**
- Modify: `supabase/functions/mcp/queries.ts` (`loadMetrics` ~169-213, `listPosts` ~230-294, `getPost` ~296-356, add helpers)
- Test: `supabase/functions/__tests__/mcp-metrics_test.ts`

**Interfaces:**
- Produces: `PostMetricRow` (counts + `impressions` + `unavailable: string[]`); `loadClientRateDistributions(d, clientId) -> Promise<{ sampleSize, overall: DistBuckets, byFormat: Record<string, DistBuckets> }>`; `selectRateSamples(format, dists) -> Record<RateKey, number[]>`. `DistBuckets = Record<RateKey, number[]> & { reach: number[] }`.
- Consumes: `computeRates`, `RateKey`, `IG_RATE_WEIGHTS` (Task 1).

- [ ] **Step 1: Extend `loadMetrics`** to carry impressions + availability. Update the imports from `./content.ts` to add `computeRates, IG_RATE_WEIGHTS, percentileRank, igAlignedScore, MIN_SAMPLE, type RateKey, type Rates`. Change the `Metrics` type and the `loadMetrics` select/collect:

```ts
export interface PostMetricRow {
  reach: number; saved: number; shares: number; comments: number; likes: number;
  impressions: number; unavailable: string[];
}
```
In `loadMetrics`, change `cols` to add `impressions, unavailable_metrics` and the `collect` to build `PostMetricRow` (keeping the existing two-key map by media id + permalink and the `instagram_accounts!inner(clientes!inner(conta_id))` join + `.eq("instagram_accounts.clientes.conta_id", d.ctx.conta_id)` filter from the current code):

```ts
const cols =
  "instagram_post_id, permalink, reach, saved, shares, comments, likes, impressions, unavailable_metrics, " +
  "instagram_accounts!inner(clientes!inner(conta_id))";
const collect = (rows: any[]) => {
  for (const r of rows ?? []) {
    const m: PostMetricRow = {
      reach: r.reach ?? 0, saved: r.saved ?? 0, shares: r.shares ?? 0,
      comments: r.comments ?? 0, likes: r.likes ?? 0, impressions: r.impressions ?? 0,
      unavailable: Array.isArray(r.unavailable_metrics) ? r.unavailable_metrics : [],
    };
    if (r.instagram_post_id) byMediaId.set(r.instagram_post_id, m);
    if (r.permalink) byPermalink.set(r.permalink, m);
  }
};
```
Update the `Map<string, Metrics>` types and `metricsFor` return type to `PostMetricRow`. (Leave the existing `Metrics` raw-count map shape in the row output for back-compat — see Step 3.)

- [ ] **Step 2: Add the distributions helpers** (after `getPerformanceBaseline`, ~line 392):

```ts
export type DistBuckets = Record<RateKey, number[]> & { reach: number[] };

function emptyBuckets(): DistBuckets {
  return { share_rate: [], like_rate: [], save_rate: [], comment_rate: [], reach: [] };
}

/** Load a client's per-format and overall rate (+raw reach) distributions. */
export async function loadClientRateDistributions(
  d: Deps,
  clientId: number,
): Promise<{ sampleSize: number; overall: DistBuckets; byFormat: Record<string, DistBuckets> }> {
  const { data: accounts } = await d.db
    .from("instagram_accounts").select("id").eq("client_id", clientId);
  const accountIds = (accounts ?? []).map((a: any) => a.id);
  const overall = emptyBuckets();
  const byFormat: Record<string, DistBuckets> = {};
  if (accountIds.length === 0) return { sampleSize: 0, overall, byFormat };

  const { data: posts } = await d.db
    .from("instagram_posts")
    .select("media_type, reach, impressions, saved, shares, likes, comments, unavailable_metrics")
    .in("instagram_account_id", accountIds);
  const rows = (posts ?? []) as any[];

  for (const p of rows) {
    const unavailable = Array.isArray(p.unavailable_metrics) ? p.unavailable_metrics : [];
    const rates = computeRates(
      { shares: p.shares ?? 0, likes: p.likes ?? 0, saved: p.saved ?? 0, comments: p.comments ?? 0, impressions: p.impressions ?? 0 },
      unavailable,
    );
    const fmt = p.media_type ?? "UNKNOWN";
    byFormat[fmt] ??= emptyBuckets();
    for (const key of Object.keys(IG_RATE_WEIGHTS) as RateKey[]) {
      const v = rates[key];
      if (v !== null) { overall[key].push(v); byFormat[fmt][key].push(v); }
    }
    if (!unavailable.includes("reach") && typeof p.reach === "number") {
      overall.reach.push(p.reach); byFormat[fmt].reach.push(p.reach);
    }
  }
  return { sampleSize: rows.length, overall, byFormat };
}

/** Pick, per rate, the format sample if it has >= MIN_SAMPLE, else the overall sample. */
export function selectRateSamples(
  format: string,
  dists: { overall: DistBuckets; byFormat: Record<string, DistBuckets> },
): Record<RateKey, number[]> {
  const fmt = dists.byFormat[format];
  const out = {} as Record<RateKey, number[]>;
  for (const key of Object.keys(IG_RATE_WEIGHTS) as RateKey[]) {
    const f = fmt?.[key] ?? [];
    out[key] = f.length >= MIN_SAMPLE ? f : (dists.overall[key] ?? []);
  }
  return out;
}
```
(`tipo` on a post is the CRM format `feed|reels|stories|carrossel`; instagram_posts `media_type` is `IMAGE|VIDEO|CAROUSEL_ALBUM`. `ig_score` for a post uses the post's instagram `media_type` — available on the metric row only via the IG post. For `list_posts`/`get_post` we key the distribution on the IG `media_type` of the matched metric row; add `media_type` to the `loadMetrics` select and `PostMetricRow` so the format is known. Update Step 1's `cols` to also select `media_type` and add `media_type: r.media_type ?? "UNKNOWN"` to `PostMetricRow`/`collect`.)

- [ ] **Step 3: Surface `views` + rates on `list_posts`/`get_post` rows.** In `listPosts`'s `.map`, after `const metrics = metricsFor(p, metricMaps);` compute and add:

```ts
const rates = metrics
  ? computeRates(metrics, metrics.unavailable)
  : { share_rate: null, like_rate: null, save_rate: null, comment_rate: null };
```
and in the returned row add `views: metrics?.impressions ?? null, ...rates, ig_score: null` (ig_score filled in Task 7), keeping the existing `metrics` field. Do the same additive change in `getPost`'s return object. (Back-compat: `metrics` still carries the five raw counts — the `PostMetricRow` superset is shape-compatible for those keys.)

- [ ] **Step 4: Tests** — extend `mcp-metrics_test.ts`: assert a row exposes `views` and the four rates; missing-metric (`unavailable: ["shares"]`) → `share_rate: null` while `like_rate` is numeric; `loadClientRateDistributions` buckets non-null rates per `media_type` and overall. (Reuse the existing fake-db harness; seed `instagram_posts` rows with `impressions`, `unavailable_metrics`, `media_type`.)

- [ ] **Step 5: Run + typecheck** — `npm run test:functions -- --filter "list_posts"` and `--filter "distributions"`; `deno check --node-modules-dir=auto supabase/functions/mcp/queries.ts`. Restore locks + `npm ci`.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/mcp/queries.ts supabase/functions/__tests__/mcp-metrics_test.ts
git commit -m "feat(mcp): rate-aware metric rows + client rate distributions"
```

---

### Task 6: `get_performance_baseline` → rate `{ n, quartiles }`

**Files:**
- Modify: `supabase/functions/mcp/queries.ts` (`getPerformanceBaseline` ~360-392)
- Test: `supabase/functions/__tests__/mcp-metrics_test.ts`

**Interfaces:**
- Consumes: `loadClientRateDistributions` (Task 5), `quartiles`, `MIN_SAMPLE`, `IG_RATE_WEIGHTS`.

- [ ] **Step 1: Rewrite `getPerformanceBaseline`** to report rate quartiles as `{ n, quartiles }`:

```ts
export async function getPerformanceBaseline(d: Deps, args: { client_id: number }): Promise<any | null> {
  const client = await verifyClient(d, args.client_id);
  if (!client) return null;

  const dists = await loadClientRateDistributions(d, args.client_id);
  const METRICS: (RateKey | "reach")[] = ["share_rate", "like_rate", "save_rate", "comment_rate", "reach"];
  const bucketStats = (b: DistBuckets) => {
    const out: Record<string, { n: number; quartiles: ReturnType<typeof quartiles> }> = {};
    for (const m of METRICS) {
      const xs = b[m] ?? [];
      out[m] = { n: xs.length, quartiles: xs.length >= MIN_SAMPLE ? quartiles(xs) : null };
    }
    return out;
  };
  const by_format: Record<string, ReturnType<typeof bucketStats>> = {};
  for (const [fmt, b] of Object.entries(dists.byFormat)) by_format[fmt] = bucketStats(b);

  return {
    sample_size: dists.sampleSize,
    weights: IG_RATE_WEIGHTS,
    weights_note: "Internal IG-aligned heuristic (shares>likes>saves>comments), not Instagram's published weights.",
    overall: bucketStats(dists.overall),
    by_format,
  };
}
```

- [ ] **Step 2: Test** — in `mcp-metrics_test.ts`, seed a client whose carousel posts give ≥5 non-null `like_rate` values and <5 `share_rate` values; assert `overall.like_rate = { n: >=5, quartiles: {p25,p50,p75} }` and `overall.share_rate.quartiles === null` with its `n` reported; assert `weights` present and `sample_size` correct.

- [ ] **Step 3: Run + typecheck** — `npm run test:functions -- --filter "baseline"`; `deno check …/mcp/queries.ts`. Restore locks + `npm ci`.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/mcp/queries.ts supabase/functions/__tests__/mcp-metrics_test.ts
git commit -m "feat(mcp): rate-based performance baseline with {n,quartiles}"
```

---

### Task 7: `ig_score` + tiers in `get_post`/`list_posts`; sort options; reject without `client_id`

**Files:**
- Modify: `supabase/functions/mcp/queries.ts` (`getPost`, `listPosts`)
- Modify: `supabase/functions/mcp/tools.ts` (`METRIC` enum ~78, descriptions)
- Test: `supabase/functions/__tests__/mcp-metrics_test.ts`

**Interfaces:**
- Consumes: `loadClientRateDistributions`, `selectRateSamples`, `igAlignedScore`, `performanceTier`, `quartiles`, `McpInputError`.

- [ ] **Step 1: `tools.ts` — extend the sort enum + descriptions.** Replace `METRIC` (line 78):

```ts
const METRIC = z.enum([
  "reach", "saved", "shares", "comments", "likes",
  "share_rate", "like_rate", "save_rate", "comment_rate", "ig_score",
]);
```
Update the `list_posts` description to mention rates/`ig_score` and that `ig_score` sorting requires `client_id`; update `get_post` description to mention rates + `ig_score` + tiers.

- [ ] **Step 2: `get_post` — score + tiers.** After resolving the post, resolve its client via its workflow and score it. Add, before the return:

```ts
let ig_score: number | null = null;
let tiers: Record<RateKey, ReturnType<typeof performanceTier>> | null = null;
const mrow = metricsFor(p, metricMaps);
const rates = mrow
  ? computeRates(mrow, mrow.unavailable)
  : { share_rate: null, like_rate: null, save_rate: null, comment_rate: null };
{
  const { data: wf } = await d.db.from("workflows")
    .select("cliente_id").eq("conta_id", d.ctx.conta_id).eq("id", p.workflow_id).maybeSingle();
  const clientId = (wf as any)?.cliente_id;
  if (clientId && mrow) {
    const dists = await loadClientRateDistributions(d, clientId);
    const samples = selectRateSamples(mrow.media_type, dists);
    ig_score = igAlignedScore(rates, samples);
    tiers = {} as any;
    for (const key of Object.keys(IG_RATE_WEIGHTS) as RateKey[]) {
      const s = samples[key];
      tiers[key] = s.length >= MIN_SAMPLE ? performanceTier(rates[key], quartiles(s)) : null;
    }
  }
}
```
Add `views: mrow?.impressions ?? null, ...rates, ig_score, tiers,` to the return object.

- [ ] **Step 3: `listPosts` — derived sort cap + per-row score + reject without client_id.** Add `const DERIVED_SORT_CAP = 500;` near the top of `queries.ts`. In `listPosts`:
  - Detect derived sort: `const derived = args.sort_by_metric && ["share_rate","like_rate","save_rate","comment_rate","ig_score"].includes(args.sort_by_metric);`
  - If `args.sort_by_metric === "ig_score" && args.client_id === undefined` → `throw new McpInputError("ig_score sort requires client_id");`
  - When `derived`, skip the early `.order("published_at").limit(limit)`; instead `.limit(DERIVED_SORT_CAP)` (still `conta_id`/client/format filtered), set `const truncated = rows.length >= DERIVED_SORT_CAP;`.
  - When `client_id` is provided, `const dists = await loadClientRateDistributions(d, args.client_id);` once; per row compute `ig_score = mrow ? igAlignedScore(rates, selectRateSamples(mrow.media_type, dists)) : null`.
  - Sort: for raw-count keys use `metrics?.[k]`; for rate keys use the row's rate; for `ig_score` use the row's `ig_score`; all descending with `null`/missing → `-Infinity` last. Then `result = result.slice(0, limit)`.
  - When `truncated`, include a sentinel row-set note: return `{ posts: result, truncated: true, cap: DERIVED_SORT_CAP }` **only for derived sorts**; keep the bare-array return for the existing/default path to preserve back-compat. (Update `mcp-metrics_test.ts` + the `list_posts` description accordingly.)

- [ ] **Step 4: Tests** — `mcp-metrics_test.ts`:
  - `get_post` returns `ig_score` (0–100) + `tiers` when the client has a ≥5 sample; `null` when sparse.
  - `list_posts` `sort_by_metric: "ig_score"` **without** `client_id` → the tool/`listPosts` throws `McpInputError`.
  - derived sort orders by the rate and slices after sorting (seed >limit posts where the newest-by-`published_at` is NOT the top-by-rate; assert the top-by-rate is returned).

- [ ] **Step 5: Run + typecheck** — `npm run test:functions -- --filter "ig_score"` and `--filter "get_post"`; `deno check …/mcp/queries.ts …/mcp/tools.ts`. Restore locks + `npm ci`.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/mcp/queries.ts supabase/functions/mcp/tools.ts supabase/functions/__tests__/mcp-metrics_test.ts
git commit -m "feat(mcp): ig_score + tiers, rate/ig_score sorting (client-scoped)"
```

---

### Task 8: Update MCP help article #2

**Files:**
- Create: `supabase/migrations/20260625000002_kb_mcp_article_rates.sql`

**Interfaces:**
- Consumes: existing `kb_articles` + the `_kb_*` builder pattern from `20260520000001_expand_kb_help_center.sql`.

- [ ] **Step 1: Write an idempotent upsert** that re-renders article `o-que-o-agente-pode-fazer` (slug) so its "Leitura" / "Escrita" copy mentions per-view **rates** (share/like/save/comment), the `ig_score` (an internal IG-aligned heuristic, not Instagram's weights), and that the baseline is now rate-based. Follow the exact `_kb_mcp2_*` helper-function pattern (text/p/h/ul/doc/plain + an `ON CONFLICT (slug) DO UPDATE` upsert), dropping the helpers at the end — mirror `supabase/migrations/20260624000002_seed_kb_mcp_articles.sql`. Keep the same `id`/`slug`/`category`/`display_order` (`bbbbbbbb-0002-4000-b000-000000000002`, `o-que-o-agente-pode-fazer`, `claude-e-ia`, 6).

- [ ] **Step 2: Sanity check** — `grep -c "DO UPDATE" …20260625000002….sql` ≥ 1; `grep -c "DROP FUNCTION" …` equals the number of helpers defined.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260625000002_kb_mcp_article_rates.sql
git commit -m "docs(ajuda): MCP help article covers rates + ig_score"
```

---

## Deploy (after all tasks, at finishing)

1. Apply migrations: `20260625000001` (column + backfill) and `20260625000002` (help article). **Prod** via `db push --linked` (clean history); **staging** via the SQL editor (history drift — see memory). Re-runnable.
2. Deploy `mcp`, `instagram-integration`, `instagram-sync-cron` with `--use-api` (Docker bundler broken on CLI 2.108.0); `mcp` keeps `--no-verify-jwt`; the two sync fns keep their existing flags. Prod + staging. Restore `deno.lock` + `supabase/functions/deno.lock` + `npm ci`.
3. Live check via prod MCP tools: `get_performance_baseline` returns `{ n, quartiles }` rate buckets; `list_posts sort_by_metric=ig_score` (with `client_id`) ranks; `get_post` returns rates + `ig_score` + tiers. (A freshly-synced carousel should now have a non-null `share_rate`.)

## Self-Review

**Spec coverage:** rates/weights/score/percentile/MIN_SAMPLE → Task 1; column + backfill → Task 2; shares-all-types + retry/fallback + preserve → Tasks 3–4; baseline `{n,quartiles}` → Task 6; rates on rows + distributions → Task 5; `ig_score`/tiers/sort/limit-after/reject-without-client_id → Task 7; help article → Task 8. All spec sections mapped.

**Placeholder scan:** complete code given for all pure helpers, the sync helper, baseline, and distributions; wiring tasks show the exact replacement blocks + line ranges. No TBD/TODO.

**Type consistency:** `RateKey`/`Rates`/`IG_RATE_WEIGHTS`/`MIN_SAMPLE` defined in Task 1 and used identically in Tasks 5–7; `PostMetricRow` (with `impressions`, `unavailable`, `media_type`) defined in Task 5 and consumed in 6–7; `DistBuckets`/`loadClientRateDistributions`/`selectRateSamples` signatures consistent across 5–7; `unavailable_metrics` tokens are DB column names throughout.
