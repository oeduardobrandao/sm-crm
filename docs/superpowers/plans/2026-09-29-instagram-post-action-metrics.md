# Instagram Post Action Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fetch, store and show four per-post Instagram metrics (reposts, profile visits, new followers, bio link taps) on the CRM's Analytics da conta page.

**Architecture:** The shared Deno helper `_shared/instagram-metrics.ts` gains two extra, isolated insights requests per post; three sync sites persist four new nullable columns on `instagram_posts`. The CRM reads them through `getPostsAnalytics` (already `select('*')`), normalises missing values to `null`, and renders them in the posts table, its expanded row, the "Ver mais" drawer and the ranked cards.

**Tech Stack:** Deno edge functions, Postgres migration, React 19 + Vitest in `apps/crm`.

Spec: `docs/superpowers/specs/2026-09-29-instagram-post-action-metrics-design.md`
Mockups: https://claude.ai/artifact/49HycgcaWpHk8ZZnYbM8mx

## Global Constraints

- Worktree root: `/Users/eduardosouza/projects/sm-crm/.claude/worktrees/instagram-api-post-metrics-35e730`. Run every command from there. Check `pwd` and `git branch --show-current` (`claude/instagram-api-post-metrics-35e730`) before the first edit of each task.
- New columns are nullable; `null` means "no data" and renders as "—", never 0.
- Reposts do NOT enter `engagement_rate`, `saves_rate`, `rates` or `ig_score`. Don't touch those formulas.
- Don't touch `apps/crm/src/lib/ig-rates.ts` (it mirrors `supabase/functions/mcp/content.ts` with a drift-guard test).
- Every insights request carries `signal: AbortSignal.timeout(10_000)`.
- UI copy is Portuguese; no em-dashes in user-facing copy (the "—" placeholder for a missing value is fine).
- Nulls sort last in both directions.
- Icons: `lucide-react` only.
- Deno runs can pollute `node_modules` and dirty `deno.lock`. After any `deno test`, run `git status --short deno.lock` and `git checkout deno.lock` if it changed; if `ls node_modules/.deno` exists, run `npm ci`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Shared insights fetch + metric fields (Deno)

**Files:**
- Modify: `supabase/functions/_shared/instagram-metrics.ts` (whole file)
- Test: `supabase/functions/__tests__/instagram-metrics_test.ts`

**Interfaces:**
- Produces:
  - `type InsightValue = { reach?: number; impressions?: number; saved?: number; shares?: number; reposts?: number; profile_visits?: number; follows?: number; bio_link_clicks?: number }`
  - `fetchPostInsights(fetchFn: typeof fetch, mediaId: string, token: string): Promise<{ values: InsightValue; returned: Set<string> }>` (signature unchanged)
  - `parseBioLinkClicks(data: unknown): number | undefined`
  - `buildMetricFields(existing, insights, mediaNode)` now also returns `reposts`, `profile_visits`, `follows`, `bio_link_clicks: number | null`, and lists missed new tokens in `unavailable_metrics`.

- [ ] **Step 1: Replace the test file with the extended suite**

Replace the whole content of `supabase/functions/__tests__/instagram-metrics_test.ts` with:

```ts
import { assert, assertEquals } from "./assert.ts";
import {
  buildMetricFields,
  fetchPostInsights,
  parseBioLinkClicks,
} from "../_shared/instagram-metrics.ts";

const ok = (data: unknown) => Promise.resolve({ json: () => Promise.resolve({ data }) } as Response);
const errBody = (msg: string, code = 100) =>
  Promise.resolve({ json: () => Promise.resolve({ error: { message: msg, code } }) } as Response);

const CORE = [
  { name: "reach", values: [{ value: 100 }] },
  { name: "views", values: [{ value: 200 }] },
  { name: "saved", values: [{ value: 5 }] },
  { name: "shares", values: [{ value: 3 }] },
];
const ACTIONS = [
  { name: "reposts", values: [{ value: 335 }] },
  { name: "follows", values: [{ value: 75 }] },
  { name: "profile_visits", values: [{ value: 328 }] },
];
const BIO = [{
  name: "profile_activity",
  total_value: {
    value: 3,
    breakdowns: [{
      dimension_keys: ["action_type"],
      results: [
        { dimension_values: ["BIO_LINK_CLICKED"], value: 1 },
        { dimension_values: ["email"], value: 2 },
      ],
    }],
  },
}];

const isCore = (u: string) => u.includes("metric=reach");
const isActions = (u: string) => u.includes("metric=reposts");
const isBio = (u: string) => u.includes("metric=profile_activity");

/** Routes each of the three per-post requests to its own handler. */
function router(h: {
  core?: (u: string) => Promise<Response>;
  actions?: (u: string) => Promise<Response>;
  bio?: (u: string) => Promise<Response>;
}) {
  const urls: string[] = [];
  const inits: (RequestInit | undefined)[] = [];
  const fetchFn = ((u: string, init?: RequestInit) => {
    urls.push(u);
    inits.push(init);
    if (isCore(u)) return (h.core ?? (() => ok(CORE)))(u);
    if (isActions(u)) return (h.actions ?? (() => ok(ACTIONS)))(u);
    if (isBio(u)) return (h.bio ?? (() => ok(BIO)))(u);
    throw new Error(`unexpected url ${u}`);
  }) as typeof fetch;
  return { fetchFn, urls, inits };
}

Deno.test("fetchPostInsights: parses all three calls", async () => {
  const { fetchFn } = router({});
  const r = await fetchPostInsights(fetchFn, "m1", "tok");
  assertEquals(r.values, {
    reach: 100, impressions: 200, saved: 5, shares: 3,
    reposts: 335, follows: 75, profile_visits: 328, bio_link_clicks: 1,
  });
  for (const t of ["reach", "impressions", "saved", "shares", "reposts", "follows", "profile_visits", "bio_link_clicks"]) {
    assert(r.returned.has(t), t);
  }
});

Deno.test("fetchPostInsights: every request carries an abort signal", async () => {
  const { fetchFn, inits } = router({});
  await fetchPostInsights(fetchFn, "m1", "tok");
  assertEquals(inits.length, 3);
  for (const init of inits) assert(init?.signal instanceof AbortSignal);
});

Deno.test("fetchPostInsights: shares rejection -> core retried without shares", async () => {
  let coreCalls = 0;
  const { fetchFn } = router({
    core: (u) => {
      coreCalls++;
      if (u.includes("shares")) return errBody("shares is not supported for this media product type");
      return ok(CORE.filter((m) => m.name !== "shares"));
    },
  });
  const r = await fetchPostInsights(fetchFn, "m2", "tok");
  assertEquals(coreCalls, 2);
  assertEquals(r.values.reach, 100);
  assert(!r.returned.has("shares"));
  assert(r.returned.has("reposts"));
});

Deno.test("fetchPostInsights: unsupported actions -> retry with reposts only", async () => {
  const actionUrls: string[] = [];
  const { fetchFn } = router({
    actions: (u) => {
      actionUrls.push(u);
      if (u.includes("follows")) return errBody("metric follows not supported for REELS", 100);
      return ok([{ name: "reposts", values: [{ value: 12 }] }]);
    },
  });
  const r = await fetchPostInsights(fetchFn, "m3", "tok");
  assertEquals(actionUrls.length, 2);
  assert(actionUrls[1].includes("metric=reposts&"));
  assertEquals(r.values.reposts, 12);
  assert(!r.returned.has("follows"));
  assert(!r.returned.has("profile_visits"));
  assertEquals(r.values.reach, 100); // core untouched
});

Deno.test("fetchPostInsights: transient/auth action errors are not retried", async () => {
  for (const code of [4, 17, 32, 613, 190]) {
    let actionCalls = 0;
    const { fetchFn } = router({
      actions: () => {
        actionCalls++;
        return errBody("Application request limit reached", code);
      },
    });
    const r = await fetchPostInsights(fetchFn, "m4", "tok");
    assertEquals(actionCalls, 1, `code ${code}`);
    assert(!r.returned.has("reposts"));
    assertEquals(r.values.reach, 100);
  }
});

Deno.test("fetchPostInsights: a throwing actions/bio call never removes core values", async () => {
  const { fetchFn } = router({
    actions: () => Promise.reject(new DOMException("timed out", "TimeoutError")),
    bio: () => Promise.reject(new Error("network")),
  });
  const r = await fetchPostInsights(fetchFn, "m5", "tok");
  assertEquals(r.values, { reach: 100, impressions: 200, saved: 5, shares: 3 });
  assert(!r.returned.has("bio_link_clicks"));
});

Deno.test("fetchPostInsights: a throwing core call never removes action values", async () => {
  const { fetchFn } = router({ core: () => Promise.reject(new Error("network")) });
  const r = await fetchPostInsights(fetchFn, "m6", "tok");
  assert(!r.returned.has("reach"));
  assertEquals(r.values.follows, 75);
  assertEquals(r.values.bio_link_clicks, 1);
});

Deno.test("fetchPostInsights: action metrics also accept total_value.value", async () => {
  const { fetchFn } = router({
    actions: () => ok([{ name: "follows", total_value: { value: 9 } }]),
  });
  const r = await fetchPostInsights(fetchFn, "m7", "tok");
  assertEquals(r.values.follows, 9);
});

Deno.test("parseBioLinkClicks: case-insensitive match, 0 when absent, undefined when malformed", () => {
  assertEquals(parseBioLinkClicks(BIO), 1);
  const lower = [{ name: "profile_activity", total_value: { value: 4, breakdowns: [{ results: [{ dimension_values: ["bio_link_clicked"], value: 4 }] }] } }];
  assertEquals(parseBioLinkClicks(lower), 4);
  const none = [{ name: "profile_activity", total_value: { value: 2, breakdowns: [{ results: [{ dimension_values: ["email"], value: 2 }] }] } }];
  assertEquals(parseBioLinkClicks(none), 0);
  const noBreakdowns = [{ name: "profile_activity", total_value: { value: 0 } }];
  assertEquals(parseBioLinkClicks(noBreakdowns), 0);
  assertEquals(parseBioLinkClicks(undefined), undefined);
  assertEquals(parseBioLinkClicks([]), undefined);
  assertEquals(parseBioLinkClicks([{ name: "profile_activity" }]), undefined);
});

Deno.test("fetchPostInsights: bio error body -> absent", async () => {
  const { fetchFn } = router({ bio: () => errBody("breakdown not supported") });
  const r = await fetchPostInsights(fetchFn, "m8", "tok");
  assert(!r.returned.has("bio_link_clicks"));
  assertEquals(r.values.follows, 75);
});

Deno.test("buildMetricFields: preserve previous on conflict, 0 on new row, mark unavailable", () => {
  const upd = buildMetricFields(
    { reach: 9, impressions: 90, saved: 2, shares: 7, likes: 4, comments: 1 },
    { values: { reach: 11, impressions: 110, saved: 3 }, returned: new Set(["reach", "impressions", "saved"]) },
    { like_count: 5, comments_count: 1 },
  );
  assertEquals(upd.reach, 11);
  assertEquals(upd.shares, 7);
  assertEquals(upd.likes, 5);
  assert(upd.unavailable_metrics.includes("shares"));
  assert(!upd.unavailable_metrics.includes("reach"));

  const ins = buildMetricFields(
    null,
    { values: { reach: 1, impressions: 2, saved: 0 }, returned: new Set(["reach", "impressions", "saved"]) },
    { like_count: 0, comments_count: 0 },
  );
  assertEquals(ins.shares, 0);
  assert(ins.unavailable_metrics.includes("shares"));
  assertEquals(ins.likes, 0);
  assert(!ins.unavailable_metrics.includes("likes"));
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

Deno.test("buildMetricFields: action metrics fresh, preserved, or null (never 0)", () => {
  const fresh = buildMetricFields(
    null,
    {
      values: { reach: 1, impressions: 1, saved: 0, shares: 0, reposts: 0, follows: 75, profile_visits: 328, bio_link_clicks: 1 },
      returned: new Set(["reach", "impressions", "saved", "shares", "reposts", "follows", "profile_visits", "bio_link_clicks"]),
    },
    { like_count: 1, comments_count: 1 },
  );
  assertEquals(fresh.reposts, 0); // a real 0 is kept
  assertEquals(fresh.follows, 75);
  assertEquals(fresh.profile_visits, 328);
  assertEquals(fresh.bio_link_clicks, 1);
  assertEquals(fresh.unavailable_metrics, []);

  const preserved = buildMetricFields(
    { reach: 1, impressions: 1, saved: 0, shares: 0, likes: 1, comments: 1, reposts: 5, follows: 7, profile_visits: 9, bio_link_clicks: null },
    { values: { reach: 2, impressions: 2, saved: 0, shares: 0 }, returned: new Set(["reach", "impressions", "saved", "shares"]) },
    { like_count: 1, comments_count: 1 },
  );
  assertEquals(preserved.reposts, 5);
  assertEquals(preserved.follows, 7);
  assertEquals(preserved.profile_visits, 9);
  assertEquals(preserved.bio_link_clicks, null);
  for (const t of ["reposts", "follows", "profile_visits", "bio_link_clicks"]) {
    assert(preserved.unavailable_metrics.includes(t), t);
  }

  const brandNew = buildMetricFields(
    null,
    { values: { reach: 1, impressions: 1, saved: 0, shares: 0 }, returned: new Set(["reach", "impressions", "saved", "shares"]) },
    { like_count: 1, comments_count: 1 },
  );
  assertEquals(brandNew.reposts, null);
  assertEquals(brandNew.follows, null);
  assertEquals(brandNew.profile_visits, null);
  assertEquals(brandNew.bio_link_clicks, null);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `deno test --no-check --allow-env --allow-read --allow-net supabase/functions/__tests__/instagram-metrics_test.ts`
Expected: FAIL (`parseBioLinkClicks` is not exported; new assertions fail).

- [ ] **Step 3: Replace the helper**

Replace the whole content of `supabase/functions/_shared/instagram-metrics.ts` with:

```ts
// Shared Instagram per-post metric helpers, used by every sync site
// (instagram-integration connect + refresh, instagram-sync-cron). Pure /
// fetch-injectable so the preservation + availability logic is unit-tested.
//
// Three insights requests per post, run concurrently and isolated from each
// other: a failure in one never removes values another returned.
//   1. core:    reach,views,saved,shares (retried without shares)
//   2. actions: reposts,follows,profile_visits (retried with reposts alone on a
//               non-transient error; Meta documents follows/profile_visits for
//               FEED and STORY only)
//   3. bio:     profile_activity&breakdown=action_type -> bio_link_clicked. Its
//               own request: Meta errors when a breakdown is mixed with metrics
//               that don't support it.

type InsightValue = {
  reach?: number;
  impressions?: number;
  saved?: number;
  shares?: number;
  reposts?: number;
  profile_visits?: number;
  follows?: number;
  bio_link_clicks?: number;
};
type ApiToken = "reach" | "views" | "saved" | "shares" | "reposts" | "follows" | "profile_visits";
// API metric name -> our column token. `views` is stored as `impressions`.
const API_TO_COL: Record<ApiToken, keyof InsightValue> = {
  reach: "reach",
  views: "impressions",
  saved: "saved",
  shares: "shares",
  reposts: "reposts",
  follows: "follows",
  profile_visits: "profile_visits",
};

// The edge runtime kills isolates that hang on I/O; bound every request.
const INSIGHT_TIMEOUT_MS = 10_000;
// Graph error codes that mean "try later" (throttling, temporary) or "bad
// token". Retrying with fewer metrics can't fix these.
const TRANSIENT_OR_AUTH_CODES = new Set([1, 2, 4, 9, 17, 32, 613, 190]);

function metricNumber(insight: any): number | undefined {
  const v = insight?.values?.[0]?.value;
  if (typeof v === "number") return v;
  const t = insight?.total_value?.value;
  return typeof t === "number" ? t : undefined;
}

function parseInto(data: any[], values: InsightValue, returned: Set<string>): void {
  for (const insight of data ?? []) {
    const col = API_TO_COL[insight?.name as ApiToken];
    const v = metricNumber(insight);
    if (col && typeof v === "number") {
      values[col] = v;
      returned.add(col);
    }
  }
}

/**
 * Bio link taps from a `profile_activity` + `breakdown=action_type` response.
 * A valid response without a bio_link_clicked result means 0 taps; a missing
 * or malformed `total_value` means absent (undefined).
 */
export function parseBioLinkClicks(data: unknown): number | undefined {
  if (!Array.isArray(data)) return undefined;
  const insight = data.find((i: any) => i?.name === "profile_activity");
  const total = insight?.total_value;
  if (!total || typeof total !== "object") return undefined;
  const results = total.breakdowns?.[0]?.results;
  if (!Array.isArray(results)) return 0;
  const hit = results.find(
    (r: any) => String(r?.dimension_values?.[0] ?? "").toLowerCase() === "bio_link_clicked",
  );
  return typeof hit?.value === "number" ? hit.value : 0;
}

async function getJson(fetchFn: typeof fetch, url: string): Promise<any> {
  const res = await fetchFn(url, { signal: AbortSignal.timeout(INSIGHT_TIMEOUT_MS) });
  return await res.json();
}

async function fetchCore(fetchFn: typeof fetch, url: (q: string) => string): Promise<any[]> {
  try {
    const body = await getJson(fetchFn, url("metric=reach,views,saved,shares"));
    if (Array.isArray(body?.data)) return body.data;
    const msg = String(body?.error?.message ?? "");
    if (/share/i.test(msg)) {
      const body2 = await getJson(fetchFn, url("metric=reach,views,saved"));
      if (Array.isArray(body2?.data)) return body2.data;
    }
  } catch (_) { /* absent */ }
  return [];
}

async function fetchActions(fetchFn: typeof fetch, url: (q: string) => string): Promise<any[]> {
  try {
    const body = await getJson(fetchFn, url("metric=reposts,follows,profile_visits"));
    if (Array.isArray(body?.data)) return body.data;
    const code = body?.error?.code;
    if (typeof code === "number" && TRANSIENT_OR_AUTH_CODES.has(code)) return [];
    const body2 = await getJson(fetchFn, url("metric=reposts"));
    if (Array.isArray(body2?.data)) return body2.data;
  } catch (_) { /* absent */ }
  return [];
}

async function fetchBioLinkClicks(
  fetchFn: typeof fetch,
  url: (q: string) => string,
): Promise<number | undefined> {
  try {
    const body = await getJson(fetchFn, url("metric=profile_activity&breakdown=action_type"));
    return parseBioLinkClicks(body?.data);
  } catch (_) {
    return undefined;
  }
}

/**
 * Fetch per-post insights (three concurrent, isolated requests; see top of
 * file). Anything not returned is simply absent from `values`/`returned`.
 */
export async function fetchPostInsights(
  fetchFn: typeof fetch,
  mediaId: string,
  token: string,
): Promise<{ values: InsightValue; returned: Set<string> }> {
  const url = (query: string) =>
    `https://graph.instagram.com/${mediaId}/insights?${query}&access_token=${token}`;
  const [core, actions, bio] = await Promise.all([
    fetchCore(fetchFn, url),
    fetchActions(fetchFn, url),
    fetchBioLinkClicks(fetchFn, url),
  ]);
  const values: InsightValue = {};
  const returned = new Set<string>();
  parseInto(core, values, returned);
  parseInto(actions, values, returned);
  if (typeof bio === "number") {
    values.bio_link_clicks = bio;
    returned.add("bio_link_clicks");
  }
  return { values, returned };
}

type Counts = { reach: number; impressions: number; saved: number; shares: number; likes: number; comments: number };
type ActionCounts = {
  reposts: number | null;
  profile_visits: number | null;
  follows: number | null;
  bio_link_clicks: number | null;
};

/**
 * Build a COMPLETE payload for the metric columns (no omitted keys, so
 * PostgREST bulk upserts can't fill them with null/default). For each metric:
 * use the freshly-fetched value when returned, else preserve the previous value,
 * else 0 for the original counts / null for the action metrics (null = no data,
 * rendered as "—"). `unavailable_metrics` lists everything not freshly returned.
 */
export function buildMetricFields(
  existing: (Partial<Counts> & Partial<ActionCounts>) | null,
  insights: { values: InsightValue; returned: Set<string> },
  mediaNode: { like_count?: number; comments_count?: number },
): Counts & ActionCounts & { unavailable_metrics: string[] } {
  const unavailable: string[] = [];
  const pick = (token: keyof Counts, fresh: number | undefined, present: boolean): number => {
    if (present && typeof fresh === "number") return fresh;
    unavailable.push(token);
    return existing?.[token] ?? 0;
  };
  const pickNullable = (token: keyof ActionCounts): number | null => {
    const fresh = insights.values[token];
    if (insights.returned.has(token) && typeof fresh === "number") return fresh;
    unavailable.push(token);
    return existing?.[token] ?? null;
  };
  return {
    reach: pick("reach", insights.values.reach, insights.returned.has("reach")),
    impressions: pick("impressions", insights.values.impressions, insights.returned.has("impressions")),
    saved: pick("saved", insights.values.saved, insights.returned.has("saved")),
    shares: pick("shares", insights.values.shares, insights.returned.has("shares")),
    likes: pick("likes", mediaNode.like_count, typeof mediaNode.like_count === "number"),
    comments: pick("comments", mediaNode.comments_count, typeof mediaNode.comments_count === "number"),
    reposts: pickNullable("reposts"),
    profile_visits: pickNullable("profile_visits"),
    follows: pickNullable("follows"),
    bio_link_clicks: pickNullable("bio_link_clicks"),
    unavailable_metrics: unavailable,
  };
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `deno test --no-check --allow-env --allow-read --allow-net supabase/functions/__tests__/instagram-metrics_test.ts`
Expected: all tests PASS.

Run: `deno check --node-modules-dir=auto supabase/functions/_shared/instagram-metrics.ts`
Expected: no errors.

Then: `git status --short deno.lock` (restore with `git checkout deno.lock` if dirty) and `ls node_modules/.deno 2>/dev/null && npm ci`.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/instagram-metrics.ts supabase/functions/__tests__/instagram-metrics_test.ts
git commit -m "feat(instagram): buscar reposts, visitas, seguidores e toques no link por post

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Migration + persist in the three sync sites

**Files:**
- Create: `supabase/migrations/20260929000001_instagram_post_action_metrics.sql`
- Modify: `supabase/functions/instagram-integration/index.ts` (connect ~L476-511, refresh ~L796-843)
- Modify: `supabase/functions/instagram-sync-cron/index.ts` (~L287-331)

**Interfaces:**
- Consumes: `buildMetricFields(...)` from Task 1, returning `reposts`, `profile_visits`, `follows`, `bio_link_clicks`.
- Produces: `instagram_posts.reposts`, `.profile_visits`, `.follows`, `.bio_link_clicks` (integer, nullable).

- [ ] **Step 1: Check the migration version is free and above main's tail**

Run: `git fetch -q origin main && git ls-tree --name-only origin/main supabase/migrations/ | tail -3 && ls supabase/migrations | grep '^20260929000001' || true`
Expected: main's tail is below `20260929000001` and no existing file uses that prefix. If either fails, pick the next free `YYYYMMDDHHMMSS` above main's tail and use it everywhere below.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20260929000001_instagram_post_action_metrics.sql`:

```sql
-- Per-post "ações após a visualização" metrics from the Instagram media insights
-- endpoint (see docs/superpowers/specs/2026-09-29-instagram-post-action-metrics-design.md).
-- Nullable on purpose: NULL = no data (never fetched, or Instagram didn't return
-- it, e.g. follows/profile_visits on Reels). The CRM renders NULL as "—"; a 0
-- would read as "this post brought no one". No backfill.
ALTER TABLE instagram_posts
  ADD COLUMN IF NOT EXISTS reposts integer,
  ADD COLUMN IF NOT EXISTS profile_visits integer,
  ADD COLUMN IF NOT EXISTS follows integer,
  ADD COLUMN IF NOT EXISTS bio_link_clicks integer;
```

- [ ] **Step 3: Extend the three `existingByPostId` selects**

In each of these three places, the select string is
`'instagram_post_id, thumbnail_url, reach, impressions, saved, shares, likes, comments'`:

- `supabase/functions/instagram-integration/index.ts` (connect, ~L479)
- `supabase/functions/instagram-integration/index.ts` (refresh, ~L800)
- `supabase/functions/instagram-sync-cron/index.ts` (~L290)

Replace it in all three with:

```ts
'instagram_post_id, thumbnail_url, reach, impressions, saved, shares, likes, comments, reposts, profile_visits, follows, bio_link_clicks'
```

Run: `grep -rn "saved, shares, likes, comments'" supabase/functions/instagram-integration/index.ts supabase/functions/instagram-sync-cron/index.ts`
Expected: no output (all three replaced).

- [ ] **Step 4: Add the four fields to the three upsert payloads**

In each of the same three places, the payload contains this line (indentation differs per site; keep each site's own indentation):

```ts
reach: m.reach, impressions: m.impressions, saved: m.saved, shares: m.shares,
```

Directly after it, add:

```ts
reposts: m.reposts, profile_visits: m.profile_visits, follows: m.follows, bio_link_clicks: m.bio_link_clicks,
```

Run: `grep -rn "bio_link_clicks: m.bio_link_clicks" supabase/functions/instagram-integration/index.ts supabase/functions/instagram-sync-cron/index.ts | wc -l`
Expected: `3`.

- [ ] **Step 5: Type-check and run the edge-function suite for these functions**

Run: `deno check --node-modules-dir=auto supabase/functions/instagram-integration/index.ts supabase/functions/instagram-sync-cron/index.ts supabase/functions/_shared/instagram-metrics.ts`
Expected: no errors.

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/instagram-metrics_test.ts supabase/functions/__tests__/instagram-sync-collect_test.ts supabase/functions/__tests__/instagram-sync-select_test.ts supabase/functions/__tests__/instagram-sync-cron-daily.test.ts supabase/functions/__tests__/instagram-sync-cron-backfill.test.ts supabase/functions/__tests__/instagram-connect-link-gate_test.ts supabase/functions/instagram-sync-cron/__tests__/`
Expected: all PASS.

Then restore `deno.lock` if dirty and `npm ci` if `node_modules/.deno` exists (Global Constraints).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260929000001_instagram_post_action_metrics.sql supabase/functions/instagram-integration/index.ts supabase/functions/instagram-sync-cron/index.ts
git commit -m "feat(instagram): persistir métricas de ação por post nas três sincronizações

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: CRM helpers + `getPostsAnalytics` mapping and sorting

**Files:**
- Create: `apps/crm/src/lib/post-action-metrics.ts`
- Create: `apps/crm/src/lib/__tests__/post-action-metrics.test.ts`
- Modify: `apps/crm/src/services/analytics.ts` (`PostAnalytics` ~L121-142, `getPostsAnalytics` ~L762-817)
- Test: `apps/crm/src/services/__tests__/analytics.test.ts`

**Interfaces:**
- Produces (from `apps/crm/src/lib/post-action-metrics.ts`):
  - `type ActionMetricKey = 'reposts' | 'profile_visits' | 'follows' | 'bio_link_clicks'`
  - `type ActionSortKey = ActionMetricKey | 'follows_per_mil_reach'`
  - `const ACTION_SORT_KEYS: readonly ActionSortKey[]`
  - `toNullableCount(v: unknown): number | null`
  - `followsPerMilReach(follows: number | null, reach: number | null | undefined): number | null`
  - `compareNullableNumber(a: number | null | undefined, b: number | null | undefined, dir: 'asc' | 'desc'): number`
  - `missingActionMetricTitle(metric: ActionMetricKey, unavailable: readonly string[] | null | undefined): string`
- Produces (on `PostAnalytics`): `reposts`, `profile_visits`, `follows`, `bio_link_clicks`, `follows_per_mil_reach`, all `number | null`.

- [ ] **Step 1: Write the helper tests**

Create `apps/crm/src/lib/__tests__/post-action-metrics.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  ACTION_SORT_KEYS,
  compareNullableNumber,
  followsPerMilReach,
  missingActionMetricTitle,
  toNullableCount,
} from '../post-action-metrics';

describe('post-action-metrics', () => {
  it('toNullableCount keeps finite numbers (0 included) and maps everything else to null', () => {
    expect(toNullableCount(0)).toBe(0);
    expect(toNullableCount(75)).toBe(75);
    expect(toNullableCount(null)).toBeNull();
    expect(toNullableCount(undefined)).toBeNull();
    expect(toNullableCount('5')).toBeNull();
    expect(toNullableCount(Number.NaN)).toBeNull();
  });

  it('followsPerMilReach divides by reach per thousand and is null-safe', () => {
    expect(followsPerMilReach(75, 37600)).toBeCloseTo(1.9947, 3);
    expect(followsPerMilReach(0, 1000)).toBe(0);
    expect(followsPerMilReach(null, 1000)).toBeNull();
    expect(followsPerMilReach(5, 0)).toBeNull();
    expect(followsPerMilReach(5, null)).toBeNull();
  });

  it('compareNullableNumber sorts nulls last in both directions', () => {
    const values = [5, null, 20, undefined, 1];
    const desc = [...values].sort((a, b) => compareNullableNumber(a, b, 'desc'));
    expect(desc.slice(0, 3)).toEqual([20, 5, 1]);
    expect(desc.slice(3).every((v) => v == null)).toBe(true);
    const asc = [...values].sort((a, b) => compareNullableNumber(a, b, 'asc'));
    expect(asc.slice(0, 3)).toEqual([1, 5, 20]);
    expect(asc.slice(3).every((v) => v == null)).toBe(true);
  });

  it('missingActionMetricTitle distinguishes "not returned" from "never fetched"', () => {
    expect(missingActionMetricTitle('follows', ['follows'])).toBe(
      'O Instagram não retornou este dado na última sincronização',
    );
    expect(missingActionMetricTitle('follows', ['reposts'])).toBe('Sem dado para este post');
    expect(missingActionMetricTitle('follows', undefined)).toBe('Sem dado para este post');
  });

  it('exposes the sortable keys', () => {
    expect(ACTION_SORT_KEYS).toEqual([
      'reposts',
      'profile_visits',
      'follows',
      'bio_link_clicks',
      'follows_per_mil_reach',
    ]);
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run apps/crm/src/lib/__tests__/post-action-metrics.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the helper**

Create `apps/crm/src/lib/post-action-metrics.ts`:

```ts
// Per-post "ações" metrics from Instagram media insights: reposts, profile
// visits, new followers (follows) and bio link taps. `null` means no data
// (never fetched, or Instagram didn't return it) and renders as "—", never 0.
// Spec: docs/superpowers/specs/2026-09-29-instagram-post-action-metrics-design.md

export type ActionMetricKey = 'reposts' | 'profile_visits' | 'follows' | 'bio_link_clicks';
export type ActionSortKey = ActionMetricKey | 'follows_per_mil_reach';

export const ACTION_SORT_KEYS: readonly ActionSortKey[] = [
  'reposts',
  'profile_visits',
  'follows',
  'bio_link_clicks',
  'follows_per_mil_reach',
];

export function toNullableCount(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** New followers per 1.000 accounts reached. Reach, not views: both count people. */
export function followsPerMilReach(
  follows: number | null,
  reach: number | null | undefined,
): number | null {
  if (follows === null || typeof reach !== 'number' || reach <= 0) return null;
  return (follows / reach) * 1000;
}

/** Numeric comparator that always puts null/undefined last, whatever the direction. */
export function compareNullableNumber(
  a: number | null | undefined,
  b: number | null | undefined,
  dir: 'asc' | 'desc',
): number {
  const aMissing = a === null || a === undefined;
  const bMissing = b === null || b === undefined;
  if (aMissing && bMissing) return 0;
  if (aMissing) return 1;
  if (bMissing) return -1;
  return dir === 'asc' ? a - b : b - a;
}

/** Tooltip for a "—": did the last sync ask and get nothing, or was it never fetched? */
export function missingActionMetricTitle(
  metric: ActionMetricKey,
  unavailable: readonly string[] | null | undefined,
): string {
  return unavailable?.includes(metric)
    ? 'O Instagram não retornou este dado na última sincronização'
    : 'Sem dado para este post';
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx vitest run apps/crm/src/lib/__tests__/post-action-metrics.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the service tests**

In `apps/crm/src/services/__tests__/analytics.test.ts`, inside `describe('analytics service', ...)`, directly after the test `'getPostsAnalytics computes rates, ig_score (with dists), and sorts ig_score nulls last'`, add:

```ts
  it('getPostsAnalytics maps action metrics to number|null and sorts them nulls last', async () => {
    const base = {
      instagram_account_id: 10,
      media_type: 'CAROUSEL_ALBUM',
      likes: 1,
      comments: 0,
      saved: 0,
      shares: 0,
      impressions: 100,
      unavailable_metrics: [],
    };
    const rows = [
      { ...base, id: 1, posted_at: '2026-09-01T00:00:00Z', reach: 1000, follows: 5, reposts: 0 },
      // pre-migration row: the four columns are simply absent
      { ...base, id: 2, posted_at: '2026-09-02T00:00:00Z', reach: 1000 },
      { ...base, id: 3, posted_at: '2026-09-03T00:00:00Z', reach: 37600, follows: 75, reposts: 335, profile_visits: 328, bio_link_clicks: 1 },
      { ...base, id: 4, posted_at: '2026-09-04T00:00:00Z', reach: 0, follows: 2, reposts: null },
    ];
    const queue = () => {
      mockedSupabase.__queueSupabaseResult('instagram_accounts', 'select', {
        data: [{ id: 10, client_id: 1 }],
        error: null,
      });
      mockedSupabase.__queueSupabaseResult('instagram_posts', 'select', { data: rows, error: null });
      mockedSupabase.__queueSupabaseResult('instagram_post_tag_assignments', 'select', {
        data: [],
        error: null,
      });
    };

    queue();
    const desc = await getPostsAnalytics(1, 30, 'follows', 'desc');
    expect(desc.posts.map((p) => p.id)).toEqual([3, 1, 4, 2]);
    const pre = desc.posts.find((p) => p.id === 2)!;
    expect(pre.follows).toBeNull();
    expect(pre.reposts).toBeNull();
    expect(pre.profile_visits).toBeNull();
    expect(pre.bio_link_clicks).toBeNull();
    const top = desc.posts[0];
    expect(top.reposts).toBe(335);
    expect(top.bio_link_clicks).toBe(1);
    expect(top.follows_per_mil_reach).toBeCloseTo(1.9947, 3);
    expect(desc.posts.find((p) => p.id === 1)!.reposts).toBe(0); // real 0 kept
    expect(desc.posts.find((p) => p.id === 4)!.follows_per_mil_reach).toBeNull(); // reach 0

    queue();
    const asc = await getPostsAnalytics(1, 30, 'follows', 'asc');
    expect(asc.posts.map((p) => p.id)).toEqual([4, 1, 3, 2]);

    queue();
    const rate = await getPostsAnalytics(1, 30, 'follows_per_mil_reach', 'desc');
    expect(rate.posts.map((p) => p.id).slice(0, 2)).toEqual([1, 3]); // 5/1000 > 75/37600
    expect(rate.posts.map((p) => p.id).slice(2).sort()).toEqual([2, 4]);
  });
```

- [ ] **Step 6: Run and confirm failure**

Run: `npx vitest run apps/crm/src/services/__tests__/analytics.test.ts -t "action metrics"`
Expected: FAIL (`follows` sort falls back to `posted_at`; fields undefined).

- [ ] **Step 7: Extend `PostAnalytics`**

In `apps/crm/src/services/analytics.ts`, add at the top with the other `../lib` imports:

```ts
import {
  ACTION_SORT_KEYS,
  compareNullableNumber,
  followsPerMilReach,
  toNullableCount,
  type ActionSortKey,
} from '../lib/post-action-metrics';
```

In `interface PostAnalytics`, after `views: number;`, add:

```ts
  /** Action metrics: null = no data (never fetched, or Instagram didn't return it). */
  reposts: number | null;
  profile_visits: number | null;
  follows: number | null;
  bio_link_clicks: number | null;
  /** follows per 1.000 accounts reached; null when follows is null or reach is 0. */
  follows_per_mil_reach: number | null;
```

- [ ] **Step 8: Map and sort in `getPostsAnalytics`**

In the `allPosts.map((p) => { ... })` of `getPostsAnalytics`, change the returned object from:

```ts
    return {
      ...p,
      engagement_rate: Math.round(engRate * 100) / 100,
      saves_rate: Math.round(savesRate * 100) / 100,
      views: p.impressions ?? 0,
```

to:

```ts
    const follows = toNullableCount(p.follows);
    return {
      ...p,
      engagement_rate: Math.round(engRate * 100) / 100,
      saves_rate: Math.round(savesRate * 100) / 100,
      views: p.impressions ?? 0,
      reposts: toNullableCount(p.reposts),
      profile_visits: toNullableCount(p.profile_visits),
      follows,
      bio_link_clicks: toNullableCount(p.bio_link_clicks),
      follows_per_mil_reach: followsPerMilReach(follows, p.reach),
```

Then replace the sort block, from `const derivedCols = new Set([...]);` through the end of `enriched.sort(...)`, with:

```ts
  const derivedCols = new Set(['share_rate', 'like_rate', 'save_rate', 'comment_rate', 'ig_score']);
  const actionCols = new Set<string>(ACTION_SORT_KEYS);
  const col =
    validCols.includes(sort) || derivedCols.has(sort) || actionCols.has(sort) ? sort : 'posted_at';
  const nullableDir = dir === 'asc' ? 'asc' : 'desc';
  enriched.sort((a, b) => {
    if (derivedCols.has(col)) {
      return compareNullableNumber(
        postRateSortValue(a, col),
        postRateSortValue(b, col),
        nullableDir,
      );
    }
    if (actionCols.has(col)) {
      const key = col as ActionSortKey;
      return compareNullableNumber(a[key], b[key], nullableDir);
    }
    const va = (a as any)[col] ?? 0;
    const vb = (b as any)[col] ?? 0;
    return dir === 'asc' ? (va > vb ? 1 : -1) : va < vb ? 1 : -1;
  });
```

- [ ] **Step 9: Run and confirm pass**

Run: `npx vitest run apps/crm/src/services/__tests__/analytics.test.ts apps/crm/src/lib/__tests__/post-action-metrics.test.ts apps/crm/src/lib/__tests__/ig-rates.test.ts`
Expected: all PASS (including the existing ig_score nulls-last test).

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add apps/crm/src/lib/post-action-metrics.ts apps/crm/src/lib/__tests__/post-action-metrics.test.ts apps/crm/src/services/analytics.ts apps/crm/src/services/__tests__/analytics.test.ts
git commit -m "feat(analytics): expor métricas de ação por post com ordenação nulls-last

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Expanded row insights panel (A) + "Novos seg." column (B)

**Files:**
- Create: `apps/crm/src/pages/analytics-conta/components/PostInsightsDetail.tsx`
- Create: `apps/crm/src/pages/analytics-conta/components/__tests__/PostInsightsDetail.test.tsx`
- Modify: `apps/crm/src/pages/analytics-conta/AnalyticsContaPage.tsx` (table header ~L1778-1790, row cells ~L1876-1879, expanded row ~L1929-1966)
- Test: `apps/crm/src/pages/analytics-conta/__tests__/AnalyticsContaPage.test.tsx`

**Interfaces:**
- Consumes: `PostAnalytics` fields and `missingActionMetricTitle`, `ActionMetricKey` from Task 3.
- Produces: `PostInsightsDetail({ post }: { post: PostAnalytics })` and a nested `ActionMetricValue` used inside the page's table cell.

Note: page fixtures in the existing page test don't carry the new fields (they're `undefined`), so every render path must treat `undefined` like `null`.

- [ ] **Step 1: Write the component test**

Create `apps/crm/src/pages/analytics-conta/components/__tests__/PostInsightsDetail.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { PostAnalytics } from '../../../../services/analytics';
import { PostInsightsDetail } from '../PostInsightsDetail';

function post(over: Partial<PostAnalytics> = {}): PostAnalytics {
  return {
    id: 1,
    instagram_post_id: 'ig1',
    caption: 'Dá preguiça. Dá medo.',
    media_type: 'CAROUSEL_ALBUM',
    permalink: 'https://instagram.com/p/1',
    posted_at: '2026-09-23T12:00:00Z',
    likes: 4512,
    comments: 17,
    reach: 37600,
    impressions: 66656,
    saved: 630,
    shares: 1502,
    views: 66656,
    rates: { share_rate: null, like_rate: null, save_rate: null, comment_rate: null },
    unavailable_metrics: [],
    ig_score: null,
    thumbnail_url: null,
    engagement_rate: 18.4,
    saves_rate: 1.7,
    tags: [],
    reposts: 335,
    profile_visits: 328,
    follows: 75,
    bio_link_clicks: 1,
    follows_per_mil_reach: 1.99,
    ...over,
  };
}

describe('PostInsightsDetail', () => {
  it('renders both groups with the values', () => {
    render(<PostInsightsDetail post={post()} />);
    expect(screen.getByText('Interações')).toBeInTheDocument();
    expect(screen.getByText('Ações após a visualização')).toBeInTheDocument();
    expect(screen.getByText('Reposts').nextSibling).toHaveTextContent('335');
    expect(screen.getByText('Visitas ao perfil').nextSibling).toHaveTextContent('328');
    expect(screen.getByText('Novos seguidores').nextSibling).toHaveTextContent('75');
    expect(screen.getByText('Toques no link da bio').nextSibling).toHaveTextContent('1');
    expect(screen.getByText('Curtidas').nextSibling).toHaveTextContent('4.512');
    expect(
      screen.getByText('1 novo seguidor a cada 501 contas alcançadas'),
    ).toBeInTheDocument();
  });

  it('renders "—" with a metric-specific tooltip for missing values, and no conversion line', () => {
    render(
      <PostInsightsDetail
        post={post({
          follows: null,
          profile_visits: null,
          bio_link_clicks: null,
          follows_per_mil_reach: null,
          unavailable_metrics: ['follows', 'profile_visits'],
        })}
      />,
    );
    const follows = screen.getByText('Novos seguidores').nextSibling as HTMLElement;
    expect(follows).toHaveTextContent('—');
    expect(follows).toHaveAttribute('title', 'O Instagram não retornou este dado na última sincronização');
    const bio = screen.getByText('Toques no link da bio').nextSibling as HTMLElement;
    expect(bio).toHaveAttribute('title', 'Sem dado para este post');
    expect(screen.queryByText(/novo seguidor a cada/)).not.toBeInTheDocument();
  });

  it('treats undefined (pre-migration rows) like null', () => {
    const p = post();
    delete (p as Partial<PostAnalytics>).reposts;
    render(<PostInsightsDetail post={p} />);
    expect(screen.getByText('Reposts').nextSibling).toHaveTextContent('—');
  });
});
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run apps/crm/src/pages/analytics-conta/components/__tests__/PostInsightsDetail.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the component**

Create `apps/crm/src/pages/analytics-conta/components/PostInsightsDetail.tsx`:

```tsx
import type { CSSProperties } from 'react';

import type { PostAnalytics } from '../../../services/analytics';
import { missingActionMetricTitle, type ActionMetricKey } from '../../../lib/post-action-metrics';

const groupStyle: CSSProperties = {
  background: 'var(--card-bg)',
  border: '1px solid var(--border-color)',
  borderRadius: 10,
  padding: '0.75rem 0.9rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
  minWidth: 0,
};

const headingStyle: CSSProperties = {
  margin: '0 0 0.25rem',
  fontSize: '0.72rem',
  fontWeight: 600,
  letterSpacing: '0.05em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
};

const rowStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: '0.75rem',
  fontSize: '0.84rem',
  fontVariantNumeric: 'tabular-nums',
};

/** A post's action-metric value, or "—" with a tooltip explaining why it's missing. */
export function ActionMetricValue({
  post,
  metric,
}: {
  post: PostAnalytics;
  metric: ActionMetricKey;
}) {
  const value = post[metric];
  if (typeof value === 'number') return <strong>{value.toLocaleString('pt-BR')}</strong>;
  return (
    <strong
      title={missingActionMetricTitle(metric, post.unavailable_metrics)}
      style={{ color: 'var(--text-muted)', fontWeight: 400 }}
    >
      —
    </strong>
  );
}

function CountRow({ label, value }: { label: string; value: number }) {
  return (
    <div style={rowStyle}>
      <span>{label}</span>
      <strong>{value.toLocaleString('pt-BR')}</strong>
    </div>
  );
}

function ActionRow({
  label,
  post,
  metric,
}: {
  label: string;
  post: PostAnalytics;
  metric: ActionMetricKey;
}) {
  return (
    <div style={rowStyle}>
      <span>{label}</span>
      <ActionMetricValue post={post} metric={metric} />
    </div>
  );
}

/** Expanded-row panel of the posts table, grouped like Instagram's own "Post insights". */
export function PostInsightsDetail({ post }: { post: PostAnalytics }) {
  const follows = post.follows;
  const reachPerFollower =
    typeof follows === 'number' && follows > 0 && post.reach > 0
      ? Math.max(1, Math.round(post.reach / follows))
      : null;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: '0.75rem',
        marginTop: '0.75rem',
      }}
    >
      <div style={groupStyle}>
        <h4 style={headingStyle}>Interações</h4>
        <CountRow label="Curtidas" value={post.likes ?? 0} />
        <CountRow label="Comentários" value={post.comments ?? 0} />
        <ActionRow label="Reposts" post={post} metric="reposts" />
        <CountRow label="Compartilhamentos" value={post.shares ?? 0} />
        <CountRow label="Salvamentos" value={post.saved ?? 0} />
      </div>
      <div style={groupStyle}>
        <h4 style={headingStyle}>Ações após a visualização</h4>
        <ActionRow label="Visitas ao perfil" post={post} metric="profile_visits" />
        <ActionRow label="Novos seguidores" post={post} metric="follows" />
        <ActionRow label="Toques no link da bio" post={post} metric="bio_link_clicks" />
        {reachPerFollower !== null && (
          <span style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
            1 novo seguidor a cada {reachPerFollower.toLocaleString('pt-BR')} contas alcançadas
          </span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run and confirm pass**

Run: `npx vitest run apps/crm/src/pages/analytics-conta/components/__tests__/PostInsightsDetail.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write the page test for the column and the expanded row**

In `apps/crm/src/pages/analytics-conta/__tests__/AnalyticsContaPage.test.tsx`, inside `describe('AnalyticsContaPage', ...)`, after the test `'hides the Baseline Instagram card when there is no baseline data'`, add:

```tsx
  it('shows the "Novos seg." column and the insights panel in the expanded row', () => {
    seedCommonAnalyticsData();
    const base = {
      instagram_post_id: 'x',
      permalink: 'https://instagram.com/p/x',
      likes: 4512,
      comments: 17,
      impressions: 66656,
      views: 66656,
      saved: 630,
      shares: 1502,
      thumbnail_url: null,
      engagement_rate: 18.4,
      saves_rate: 1.7,
      rates: { share_rate: null, like_rate: null, save_rate: null, comment_rate: null },
      ig_score: null,
      tags: [],
    };
    queryState['analytics-posts'] = {
      data: {
        posts: [
          {
            ...base,
            id: 1,
            caption: 'Dá preguiça. Dá medo.',
            media_type: 'CAROUSEL_ALBUM',
            posted_at: '2026-09-23T12:00:00Z',
            reach: 37600,
            reposts: 335,
            profile_visits: 328,
            follows: 75,
            bio_link_clicks: 1,
            follows_per_mil_reach: 1.99,
            unavailable_metrics: [],
          },
          {
            ...base,
            id: 2,
            caption: 'Reel sem dados de ação',
            media_type: 'VIDEO',
            posted_at: '2026-09-19T12:00:00Z',
            reach: 9214,
            reposts: 12,
            profile_visits: null,
            follows: null,
            bio_link_clicks: null,
            follows_per_mil_reach: null,
            unavailable_metrics: ['follows', 'profile_visits', 'bio_link_clicks'],
          },
        ],
      },
    };

    const { container } = render(<AnalyticsContaPage />);
    const table = container.querySelector('#posts-table') as HTMLTableElement;
    expect(within(table).getByText('Novos seg.')).toBeInTheDocument();

    const cells = table.querySelectorAll('td[data-label="Novos seg."]');
    expect(cells[0]).toHaveTextContent('75');
    expect(cells[1]).toHaveTextContent('—');
    expect(cells[1].querySelector('[title]')).toHaveAttribute(
      'title',
      'O Instagram não retornou este dado na última sincronização',
    );

    fireEvent.click(table.querySelector('tbody tr') as HTMLTableRowElement);
    const detail = table.querySelector('tr.post-detail-row') as HTMLTableRowElement;
    expect(detail.querySelector('td')).toHaveAttribute('colspan', '12');
    expect(within(detail).getByText('Ações após a visualização')).toBeInTheDocument();
    expect(within(detail).getByText('Novos seguidores').nextSibling).toHaveTextContent('75');
    expect(within(detail).getByText('Reposts').nextSibling).toHaveTextContent('335');
  });
```

- [ ] **Step 6: Run and confirm failure**

Run: `npx vitest run apps/crm/src/pages/analytics-conta/__tests__/AnalyticsContaPage.test.tsx -t "Novos seg"`
Expected: FAIL (no "Novos seg." header).

- [ ] **Step 7: Wire the column and the panel into the page**

In `apps/crm/src/pages/analytics-conta/AnalyticsContaPage.tsx`:

1. Add next to the existing `import { NewReportDialog } from './components/NewReportDialog';`:

```tsx
import { ActionMetricValue, PostInsightsDetail } from './components/PostInsightsDetail';
```

2. In the table header array, change:

```tsx
                    { col: 'shares', label: 'Compart.' },
                    { col: null, label: 'Tags' },
```

to:

```tsx
                    { col: 'shares', label: 'Compart.' },
                    { col: 'follows', label: 'Novos seg.' },
                    { col: null, label: 'Tags' },
```

3. In the row cells, change:

```tsx
                      <td data-label="Compart.">{p.shares}</td>
```

to:

```tsx
                      <td data-label="Compart.">{p.shares}</td>
                      <td data-label="Novos seg.">
                        <ActionMetricValue post={p} metric="follows" />
                      </td>
```

4. Replace the expanded row body. Change:

```tsx
                        <td colSpan={10} style={{ padding: '1rem', background: 'var(--card-bg)' }}>
```

to:

```tsx
                        <td colSpan={12} style={{ padding: '1rem', background: 'var(--card-bg)' }}>
```

and, inside that same `<td>`, delete these two spans (keep the `↗ Ver no Instagram` link and its wrapping div):

```tsx
                            <span style={{ color: 'var(--text-muted)' }}>
                              Visualizações: {p.views.toLocaleString('pt-BR')}
                            </span>
                            <span style={{ color: 'var(--text-muted)' }}>
                              Curtidas: {p.likes.toLocaleString('pt-BR')}
                            </span>
```

then add `<PostInsightsDetail post={p} />` directly after the closing `</div>` of that link row, before `</td>`.

- [ ] **Step 8: Run and confirm pass**

Run: `npx vitest run apps/crm/src/pages/analytics-conta/`
Expected: all PASS (new and existing tests).

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add apps/crm/src/pages/analytics-conta/components/PostInsightsDetail.tsx apps/crm/src/pages/analytics-conta/components/__tests__/PostInsightsDetail.test.tsx apps/crm/src/pages/analytics-conta/AnalyticsContaPage.tsx apps/crm/src/pages/analytics-conta/__tests__/AnalyticsContaPage.test.tsx
git commit -m "feat(analytics): painel de insights na linha expandida e coluna Novos seg.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: "Ver mais" drawer sorts (C) + followers chip (D)

**Files:**
- Modify: `apps/crm/src/pages/analytics-conta/AnalyticsContaPage.tsx` (lucide import ~L10-27, `RankedPostOrderBy` ~L404-417, `RankedPostCard` chips ~L350-366, `rankedDrawerPosts` switch ~L1149-1199, drawer `<select>` ~L2584-2598, drawer item chips ~L2798-2805)
- Test: `apps/crm/src/pages/analytics-conta/__tests__/AnalyticsContaPage.test.tsx`

**Interfaces:**
- Consumes: `compareNullableNumber` and `ActionSortKey` from `apps/crm/src/lib/post-action-metrics.ts` (Task 3); `PostAnalytics.follows` etc.

- [ ] **Step 1: Write the page tests**

In `apps/crm/src/pages/analytics-conta/__tests__/AnalyticsContaPage.test.tsx`, directly after the test `'opens the reach-ranked posts drawer using only this client account posts'`, add:

```tsx
  it('sorts the "Ver mais" drawer by Novos seguidores with missing values last', () => {
    seedCommonAnalyticsData();
    const follows = [5, null, 20, null, 1, 8];
    queryState['analytics-posts'] = {
      data: {
        posts: follows.map((f, index) => ({
          id: index + 1,
          posted_at: `2020-01-${String(index + 1).padStart(2, '0')}T12:00:00Z`,
          media_type: 'IMAGE',
          reach: 1000,
          impressions: 1400,
          views: 1400,
          engagement_rate: 5,
          likes: 10,
          saved: 1,
          saves_rate: 1,
          comments: 1,
          shares: 1,
          follows: f,
          caption: `Post ranqueado ${index + 1}`,
          thumbnail_url: `https://example.com/ranked-${index + 1}.jpg`,
          permalink: `https://instagram.com/p/ranked-${index + 1}`,
          unavailable_metrics: [],
          tags: [],
        })),
      },
    };

    render(<AnalyticsContaPage />);
    fireEvent.click(screen.getAllByText('Ver mais')[0]);
    const drawer = screen.getByText('6 de 6 posts de @clinicaaurora').closest('aside')!;
    fireEvent.change(within(drawer).getByLabelText('Ordenar posts'), {
      target: { value: 'follows' },
    });

    const order = within(drawer)
      .getAllByText(/Post ranqueado/)
      .map((el) => el.textContent);
    expect(order.slice(0, 4)).toEqual([
      'Post ranqueado 3',
      'Post ranqueado 6',
      'Post ranqueado 1',
      'Post ranqueado 5',
    ]);
    expect(order.slice(4).sort()).toEqual(['Post ranqueado 2', 'Post ranqueado 4']);
  });

  it('shows the followers chip on ranked cards only when the value exists', () => {
    seedCommonAnalyticsData();
    queryState['analytics-posts'] = {
      data: {
        posts: [75, null].map((f, index) => ({
          id: index + 1,
          posted_at: `2020-01-0${index + 1}T12:00:00Z`,
          media_type: 'IMAGE',
          reach: 1000,
          impressions: 1400,
          views: 1400,
          engagement_rate: 5,
          likes: 10,
          saved: 1,
          saves_rate: 1,
          comments: 1,
          shares: 1,
          follows: f,
          caption: `Chip ${index + 1}`,
          thumbnail_url: null,
          permalink: `https://instagram.com/p/chip-${index + 1}`,
          unavailable_metrics: [],
          tags: [],
        })),
      },
    };

    render(<AnalyticsContaPage />);
    const chips = screen.getAllByTitle('Novos seguidores');
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) expect(chip).toHaveTextContent('75');
  });
```

- [ ] **Step 2: Run and confirm failure**

Run: `npx vitest run apps/crm/src/pages/analytics-conta/__tests__/AnalyticsContaPage.test.tsx -t "Novos seguidores|followers chip"`
Expected: FAIL (no `follows` option; no chip).

- [ ] **Step 3: Imports and the order-by type**

In `apps/crm/src/pages/analytics-conta/AnalyticsContaPage.tsx`:

1. In the `lucide-react` import list, add `UserPlus,` before `type LucideIcon,`.
2. Add with the other `../../lib` imports:

```tsx
import { compareNullableNumber, type ActionSortKey } from '../../lib/post-action-metrics';
```

3. Change the `RankedPostOrderBy` type's last member from:

```ts
  | 'comment_rate';
```

to:

```ts
  | 'comment_rate'
  | ActionSortKey;
```

- [ ] **Step 4: Drawer sort cases**

In the `rankedDrawerPosts` `switch (rankedOrderBy)`, replace the `case 'ig_score': { ... }` block and the `case 'share_rate': case 'like_rate': case 'save_rate': case 'comment_rate': { ... }` block with:

```tsx
      case 'ig_score':
        next.sort((a, b) =>
          compareNullableNumber(
            (a as PostAnalytics).ig_score,
            (b as PostAnalytics).ig_score,
            rankedAsc ? 'asc' : 'desc',
          ),
        );
        break;
      case 'share_rate':
      case 'like_rate':
      case 'save_rate':
      case 'comment_rate': {
        const key = rankedOrderBy as RateKey;
        next.sort((a, b) =>
          compareNullableNumber(
            (a as PostAnalytics).rates[key],
            (b as PostAnalytics).rates[key],
            rankedAsc ? 'asc' : 'desc',
          ),
        );
        break;
      }
      case 'reposts':
      case 'profile_visits':
      case 'follows':
      case 'bio_link_clicks':
      case 'follows_per_mil_reach': {
        const key = rankedOrderBy;
        next.sort((a, b) =>
          compareNullableNumber(
            (a as PostAnalytics)[key],
            (b as PostAnalytics)[key],
            rankedAsc ? 'asc' : 'desc',
          ),
        );
        break;
      }
```

- [ ] **Step 5: Drawer select options**

In the drawer `<select aria-label="Ordenar posts">`, change:

```tsx
                <option value="shares">Compart.</option>
```

to:

```tsx
                <option value="shares">Compart.</option>
                <option value="reposts">Reposts</option>
                <option value="profile_visits">Visitas ao perfil</option>
                <option value="follows">Novos seguidores</option>
```

and change:

```tsx
                <option value="comment_rate">Coment./visualização</option>
```

to:

```tsx
                <option value="comment_rate">Coment./visualização</option>
                <option value="follows_per_mil_reach">Seguidores/mil alcançados</option>
```

- [ ] **Step 6: Followers chip on `RankedPostCard`**

In `RankedPostCard`, after the `<span ...>` that contains `<Bookmark className="h-3 w-3" />` and `{formatNumber(post.saved)}` (the last chip, followed by `</div>`), add:

```tsx
          {typeof post.follows === 'number' && (
            <span
              title="Novos seguidores"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 3,
                fontSize: '0.65rem',
                color: 'var(--text-muted)',
              }}
            >
              <UserPlus className="h-3 w-3" />{' '}
              <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-main)' }}>
                {formatNumber(post.follows)}
              </strong>
            </span>
          )}
```

- [ ] **Step 7: Followers chip on drawer items**

In the drawer item, after the `<span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>` that contains `<Bookmark className="h-3 w-3" />` and `{formatNumber(post.saved)}`, add:

```tsx
                      {typeof post.follows === 'number' && (
                        <span
                          title="Novos seguidores"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}
                        >
                          <UserPlus className="h-3 w-3" />{' '}
                          <strong
                            style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-main)' }}
                          >
                            {formatNumber(post.follows)}
                          </strong>
                        </span>
                      )}
```

- [ ] **Step 8: Run and confirm pass**

Run: `npx vitest run apps/crm/src/pages/analytics-conta/`
Expected: all PASS.

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add apps/crm/src/pages/analytics-conta/AnalyticsContaPage.tsx apps/crm/src/pages/analytics-conta/__tests__/AnalyticsContaPage.test.tsx
git commit -m "feat(analytics): ordenar Ver mais por métricas de ação e chip de novos seguidores

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Full gate + browser check

**Files:** none new (fix-ups only if a gate fails).

- [ ] **Step 1: Run every CI gate locally**

```bash
npm run lint
npm run format:check
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
npm run check:functions
npm run test:functions
```

Expected: all pass. If `format:check` fails, run `npm run format` and commit. After the Deno runs, restore `deno.lock` if dirty and run `npm ci` if `node_modules/.deno` exists.

- [ ] **Step 2: Browser check**

Start the CRM with `preview_start` (config running `npm run dev:env`; add it to `.claude/launch.json` if missing, port 5173). Open `/analytics/<clientId>` (or the route that renders `AnalyticsContaPage`) for a client with a connected account. Before the migration is deployed the new fields are absent, so expect:
- the "Novos seg." header, every cell "—";
- clicking a row shows "Interações" and "Ações após a visualização", with "—" for reposts and the three action metrics;
- the "Ver mais" drawer lists the four new sort options, and choosing "Novos seguidores" doesn't crash;
- no ranked-card chip for followers;
- no console errors.

Check at 1280px wide and at 375px (`resize_window` mobile), then reset to desktop. Take one screenshot of the expanded row.

- [ ] **Step 3: Commit any fix-ups**

```bash
git add -A apps supabase
git commit -m "chore: ajustes de lint/format das métricas de ação

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Skip if nothing changed.)

---

## Deploy (needs the user's explicit go-ahead; not part of task execution)

Order matters: the sync functions select and upsert the new columns, so deploying them before the migration (or with it rolled back) makes their `existingByPostId` select error and every `instagram_posts` upsert fail, stopping metric syncing for every account. Migration first is mandatory. After `db push`, confirm PostgREST sees the columns (e.g. a REST `select=reposts&limit=1` on `instagram_posts`) before deploying the functions, on staging and prod. (The frontend alone tolerates missing columns.)

1. Migration on staging, then prod: `npx supabase db push --linked` (check `supabase/.temp/project-ref` first; staging `wlyzhyfondykzpsiqsce`, prod `skjzpekeqefvlojenfsw`).
2. Functions, each env: `npx supabase functions deploy instagram-integration --use-api --no-verify-jwt --project-ref <ref>` and the same for `instagram-sync-cron`. Deploy from a checkout whose branch contains current `origin/main` (rebase first) so nothing on main regresses.
3. Open the PR, let CI and the Codex review run, then merge (Vercel ships the CRM on merge).
4. On prod, click "Sincronizar Dados" for a real account with feed posts and Reels; query `select media_type, reposts, profile_visits, follows, bio_link_clicks, unavailable_metrics from instagram_posts where instagram_account_id = '<id>' order by posted_at desc limit 20;` and compare one carousel against the Instagram app. Record whether Reels return follows/profile_visits (spec decision 3).
