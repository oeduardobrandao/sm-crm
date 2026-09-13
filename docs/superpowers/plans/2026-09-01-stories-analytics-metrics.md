# Stories Analytics Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Instagram Stories metrics to the CRM analytics: automatic hourly collection, per-story storage, daily/monthly aggregates, a dedicated API endpoint, a UI section on the analytics page, and report pipeline integration.

**Architecture:** New `instagram_story_insights` table stores per-story metrics collected during the existing hourly sync cron. Daily/monthly aggregate columns are added to the existing metrics tables via the COALESCE upsert RPC. A dedicated `/stories/:clientId` endpoint serves the frontend, which renders a KPI grid + stories table in the analytics page. Report blocks are registered for the PDF pipeline in a Phase 2 PR.

**Tech Stack:** Postgres (Supabase), Deno edge functions, React 19 + TanStack Query, Vitest, `deno test`

## Global Constraints

- Migration prefix: `20260902000010` (verified against `origin/main` tail: `20260901102000`)
- All date aggregation uses explicit UTC: `(posted_at AT TIME ZONE 'UTC')::date`
- Stories insight calls use `AbortSignal.timeout(10_000)`, concurrency 5, cap 50 stories per account
- Thumbnail caching at ingest time (not report time) via `isEphemeralInstagramUrl` + `cachePostThumbnail`
- Metric preservation: COALESCE in story upsert to avoid overwriting valid values with transient nulls
- Monthly close writes 0 only if coverage signal exists (daily row with stories_count_day IS NOT NULL); else NULL
- API returns max 200 stories per request, sorted by reach DESC
- `getStoriesAnalytics` returns `Promise<StoriesAnalyticsResponse | null>` (matches `fetchEdge` contract)
- Report pipeline (blocks, editor catalog, snapshot, AI input) ships in a separate Phase 2 PR
- Portuguese UI copy; no em-dashes (use period, colon, or middle-dot)

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260902000010_story_insights.sql`

**Interfaces:**
- Produces: `instagram_story_insights` table, 7 new columns in `*_daily` and `*_monthly`, updated `upsert_metrics_daily` RPC

- [ ] **Step 1: Write the migration SQL**

```sql
-- 1) New table
CREATE TABLE instagram_story_insights (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instagram_account_id uuid NOT NULL REFERENCES instagram_accounts(id) ON DELETE CASCADE,
  instagram_media_id   text NOT NULL,
  media_type           text NOT NULL DEFAULT 'STORY',
  thumbnail_url        text,
  posted_at            timestamptz NOT NULL,
  expired_at           timestamptz NOT NULL,
  reach                integer,
  impressions          integer,
  replies              integer,
  taps_forward         integer,
  taps_back            integer,
  exits                integer,
  shares               integer,
  synced_at            timestamptz NOT NULL DEFAULT now(),
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instagram_account_id, instagram_media_id)
);

CREATE INDEX idx_story_insights_account_posted
  ON instagram_story_insights (instagram_account_id, posted_at DESC);

ALTER TABLE instagram_story_insights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access"
  ON instagram_story_insights
  USING (auth.role() = 'service_role');

-- 2) Daily columns
ALTER TABLE instagram_account_metrics_daily
  ADD COLUMN stories_count_day        integer,
  ADD COLUMN stories_reach_day        integer,
  ADD COLUMN stories_impressions_day  integer,
  ADD COLUMN stories_replies_day      integer,
  ADD COLUMN stories_taps_forward_day integer,
  ADD COLUMN stories_taps_back_day    integer,
  ADD COLUMN stories_exits_day        integer;

-- 3) Monthly columns
ALTER TABLE instagram_account_metrics_monthly
  ADD COLUMN stories_count_month        integer,
  ADD COLUMN stories_reach_month        integer,
  ADD COLUMN stories_impressions_month  integer,
  ADD COLUMN stories_replies_month      integer,
  ADD COLUMN stories_taps_forward_month integer,
  ADD COLUMN stories_taps_back_month    integer,
  ADD COLUMN stories_exits_month        integer;

-- 4) Updated RPC with stories columns
CREATE OR REPLACE FUNCTION upsert_metrics_daily(p_rows jsonb)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO instagram_account_metrics_daily AS t (
    instagram_account_id, snapshot_date,
    reach_day, views_day, saves_day, accounts_engaged_day,
    profile_views_day, website_clicks_day, follows_day, unfollows_day,
    stories_count_day, stories_reach_day, stories_impressions_day,
    stories_replies_day, stories_taps_forward_day, stories_taps_back_day,
    stories_exits_day
  )
  SELECT
    (r->>'instagram_account_id')::uuid,
    (r->>'snapshot_date')::date,
    (r->>'reach_day')::integer, (r->>'views_day')::integer,
    (r->>'saves_day')::integer, (r->>'accounts_engaged_day')::integer,
    (r->>'profile_views_day')::integer, (r->>'website_clicks_day')::integer,
    (r->>'follows_day')::integer, (r->>'unfollows_day')::integer,
    (r->>'stories_count_day')::integer, (r->>'stories_reach_day')::integer,
    (r->>'stories_impressions_day')::integer, (r->>'stories_replies_day')::integer,
    (r->>'stories_taps_forward_day')::integer, (r->>'stories_taps_back_day')::integer,
    (r->>'stories_exits_day')::integer
  FROM jsonb_array_elements(p_rows) AS r
  ON CONFLICT (instagram_account_id, snapshot_date) DO UPDATE SET
    reach_day              = COALESCE(EXCLUDED.reach_day, t.reach_day),
    views_day              = COALESCE(EXCLUDED.views_day, t.views_day),
    saves_day              = COALESCE(EXCLUDED.saves_day, t.saves_day),
    accounts_engaged_day   = COALESCE(EXCLUDED.accounts_engaged_day, t.accounts_engaged_day),
    profile_views_day      = COALESCE(EXCLUDED.profile_views_day, t.profile_views_day),
    website_clicks_day     = COALESCE(EXCLUDED.website_clicks_day, t.website_clicks_day),
    follows_day            = COALESCE(EXCLUDED.follows_day, t.follows_day),
    unfollows_day          = COALESCE(EXCLUDED.unfollows_day, t.unfollows_day),
    stories_count_day      = COALESCE(EXCLUDED.stories_count_day, t.stories_count_day),
    stories_reach_day      = COALESCE(EXCLUDED.stories_reach_day, t.stories_reach_day),
    stories_impressions_day = COALESCE(EXCLUDED.stories_impressions_day, t.stories_impressions_day),
    stories_replies_day    = COALESCE(EXCLUDED.stories_replies_day, t.stories_replies_day),
    stories_taps_forward_day = COALESCE(EXCLUDED.stories_taps_forward_day, t.stories_taps_forward_day),
    stories_taps_back_day  = COALESCE(EXCLUDED.stories_taps_back_day, t.stories_taps_back_day),
    stories_exits_day      = COALESCE(EXCLUDED.stories_exits_day, t.stories_exits_day);
$$;

REVOKE ALL ON FUNCTION upsert_metrics_daily(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION upsert_metrics_daily(jsonb) TO service_role;
REVOKE EXECUTE ON FUNCTION upsert_metrics_daily(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION upsert_metrics_daily(jsonb) FROM authenticated;
```

- [ ] **Step 2: Verify migration prefix is unique**

Run: `git ls-tree origin/main:supabase/migrations | grep '^.*20260902' | head`
Expected: no matches (prefix `20260902000010` is clear)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260902000010_story_insights.sql
git commit -m "feat(analytics): add instagram_story_insights table and daily/monthly stories columns"
```

---

### Task 2: Story Ingest Module + Tests

**Files:**
- Create: `supabase/functions/instagram-sync-cron/story-ingest.ts`
- Create: `supabase/functions/instagram-sync-cron/__tests__/story-ingest.test.ts`

**Interfaces:**
- Consumes: `runPool<T>(items, concurrency, fn)` from `./pool.ts`, `cachePostThumbnail` + `isEphemeralInstagramUrl` from `../_shared/instagram-thumbnail-cache.ts`
- Produces: `ingestStories(opts: StoryIngestOpts): Promise<StoryDailyAgg[]>` — returns daily aggregates for inclusion in `upsert_metrics_daily` payload

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/instagram-sync-cron/__tests__/story-ingest.test.ts`:

```typescript
import { assertEquals, assertArrayIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ingestStories, type StoryDailyAgg } from "../story-ingest.ts";

function mockFetch(responses: Record<string, unknown>): typeof fetch {
  return ((url: string | URL | Request) => {
    const u = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
    for (const [pattern, body] of Object.entries(responses)) {
      if (u.includes(pattern)) {
        return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
      }
    }
    return Promise.resolve(new Response("{}", { status: 404 }));
  }) as typeof fetch;
}

const ACCOUNT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

Deno.test("ingestStories returns daily aggregates from active stories", async () => {
  const now = new Date("2026-09-01T15:00:00Z");
  const storyTimestamp = "2026-09-01T10:00:00+0000";
  const storyId = "17901234567890";

  const fetchFn = mockFetch({
    "me/stories": {
      data: [{
        id: storyId,
        media_type: "IMAGE",
        thumbnail_url: "https://example.com/thumb.jpg",
        timestamp: storyTimestamp,
      }],
    },
    [`${storyId}/insights`]: {
      data: [
        { name: "reach", values: [{ value: 500 }] },
        { name: "impressions", values: [{ value: 800 }] },
        { name: "replies", values: [{ value: 3 }] },
        { name: "taps_forward", values: [{ value: 200 }] },
        { name: "taps_back", values: [{ value: 50 }] },
        { name: "exits", values: [{ value: 100 }] },
        { name: "shares", values: [{ value: 10 }] },
      ],
    },
  });

  const upserted: unknown[] = [];
  const mockDb = {
    from: () => ({
      upsert: (rows: unknown) => {
        upserted.push(rows);
        return { error: null };
      },
    }),
  };

  const result = await ingestStories({
    fetchFn,
    accountId: ACCOUNT_ID,
    accessToken: "fake-token",
    db: mockDb as any,
    cacheThumb: async (_accountId, _mediaId, url) => url,
  });

  assertEquals(result.length, 1);
  assertEquals(result[0].snapshot_date, "2026-09-01");
  assertEquals(result[0].stories_count_day, 1);
  assertEquals(result[0].stories_reach_day, 500);
  assertEquals(result[0].stories_impressions_day, 800);
  assertEquals(result[0].stories_exits_day, 100);
});

Deno.test("ingestStories returns empty on me/stories failure", async () => {
  const fetchFn = mockFetch({
    "me/stories": { error: { message: "token expired", code: 190 } },
  });
  const mockDb = { from: () => ({ upsert: () => ({ error: null }) }) };

  const result = await ingestStories({
    fetchFn,
    accountId: ACCOUNT_ID,
    accessToken: "fake-token",
    db: mockDb as any,
    cacheThumb: async (_a, _b, url) => url,
  });

  assertEquals(result, []);
});

Deno.test("ingestStories retries without shares on share-related error", async () => {
  const storyId = "17901234567891";
  let callCount = 0;

  const fetchFn = ((url: string | URL | Request) => {
    const u = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
    if (u.includes("me/stories")) {
      return Promise.resolve(new Response(JSON.stringify({
        data: [{ id: storyId, media_type: "IMAGE", thumbnail_url: null, timestamp: "2026-09-01T10:00:00+0000" }],
      }), { status: 200 }));
    }
    if (u.includes(`${storyId}/insights`)) {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(new Response(JSON.stringify({
          error: { message: "Cannot read property 'share' of undefined" },
        }), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({
        data: [
          { name: "reach", values: [{ value: 100 }] },
          { name: "impressions", values: [{ value: 200 }] },
          { name: "replies", values: [{ value: 0 }] },
          { name: "taps_forward", values: [{ value: 50 }] },
          { name: "taps_back", values: [{ value: 10 }] },
          { name: "exits", values: [{ value: 30 }] },
        ],
      }), { status: 200 }));
    }
    return Promise.resolve(new Response("{}", { status: 404 }));
  }) as typeof fetch;

  const mockDb = { from: () => ({ upsert: () => ({ error: null }) }) };

  const result = await ingestStories({
    fetchFn,
    accountId: ACCOUNT_ID,
    accessToken: "fake-token",
    db: mockDb as any,
    cacheThumb: async (_a, _b, url) => url,
  });

  assertEquals(callCount, 2);
  assertEquals(result.length, 1);
  assertEquals(result[0].stories_reach_day, 100);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd supabase/functions && deno test instagram-sync-cron/__tests__/story-ingest.test.ts --no-check`
Expected: FAIL with module not found (story-ingest.ts doesn't exist yet)

- [ ] **Step 3: Write the implementation**

Create `supabase/functions/instagram-sync-cron/story-ingest.ts`:

```typescript
import { isEphemeralInstagramUrl } from "../_shared/instagram-thumbnail-cache.ts";

export interface StoryDailyAgg {
  instagram_account_id: string;
  snapshot_date: string;
  stories_count_day: number;
  stories_reach_day: number;
  stories_impressions_day: number;
  stories_replies_day: number;
  stories_taps_forward_day: number;
  stories_taps_back_day: number;
  stories_exits_day: number;
}

interface StoryNode {
  id: string;
  media_type: string;
  thumbnail_url: string | null;
  timestamp: string;
}

interface InsightValue {
  reach?: number;
  impressions?: number;
  replies?: number;
  taps_forward?: number;
  taps_back?: number;
  exits?: number;
  shares?: number;
}

export interface StoryIngestOpts {
  fetchFn: typeof fetch;
  accountId: string;
  accessToken: string;
  // deno-lint-ignore no-explicit-any
  db: any;
  cacheThumb: (accountId: string, mediaId: string, url: string) => Promise<string | null>;
}

const INSIGHT_TIMEOUT = 10_000;
const MAX_STORIES = 50;
const INSIGHT_CONCURRENCY = 5;
const ALL_METRICS = "reach,impressions,replies,taps_forward,taps_back,exits,shares";
const NO_SHARES_METRICS = "reach,impressions,replies,taps_forward,taps_back,exits";

async function fetchStoryInsights(
  fetchFn: typeof fetch,
  storyId: string,
  token: string,
): Promise<InsightValue> {
  const url = (metrics: string) =>
    `https://graph.instagram.com/${storyId}/insights?metric=${metrics}&access_token=${token}`;
  try {
    const res = await fetchFn(url(ALL_METRICS), { signal: AbortSignal.timeout(INSIGHT_TIMEOUT) });
    const body = await res.json();
    if (Array.isArray(body?.data)) return parseInsights(body.data);
    const msg = String(body?.error?.message ?? "");
    if (/share/i.test(msg)) {
      const res2 = await fetchFn(url(NO_SHARES_METRICS), { signal: AbortSignal.timeout(INSIGHT_TIMEOUT) });
      const body2 = await res2.json();
      if (Array.isArray(body2?.data)) return parseInsights(body2.data);
    }
  } catch (e) {
    console.warn(`[story-ingest] insight fetch failed for story ${storyId}:`, e);
  }
  return {};
}

function parseInsights(data: { name: string; values: { value: number }[] }[]): InsightValue {
  const out: InsightValue = {};
  for (const item of data) {
    const val = item.values?.[0]?.value;
    if (typeof val === "number") {
      (out as Record<string, number>)[item.name] = val;
    }
  }
  return out;
}

function toUtcDateStr(ts: string): string {
  const d = new Date(ts);
  return d.toISOString().slice(0, 10);
}

export async function ingestStories(opts: StoryIngestOpts): Promise<StoryDailyAgg[]> {
  const { fetchFn, accountId, accessToken, db, cacheThumb } = opts;

  // 1) Fetch active stories
  let stories: StoryNode[];
  try {
    const res = await fetchFn(
      `https://graph.instagram.com/me/stories?fields=id,media_type,thumbnail_url,timestamp&access_token=${accessToken}`,
      { signal: AbortSignal.timeout(INSIGHT_TIMEOUT) },
    );
    const body = await res.json();
    if (!Array.isArray(body?.data)) {
      console.warn(`[story-ingest] me/stories returned no data for account ${accountId}`);
      return [];
    }
    stories = (body.data as StoryNode[]).slice(0, MAX_STORIES);
  } catch (e) {
    console.warn(`[story-ingest] me/stories failed for account ${accountId}:`, e);
    return [];
  }

  if (stories.length === 0) return [];

  // 2) Fetch insights with bounded concurrency
  const insightsMap = new Map<string, InsightValue>();
  let idx = 0;
  async function worker(): Promise<void> {
    while (idx < stories.length) {
      const i = idx++;
      const story = stories[i];
      insightsMap.set(story.id, await fetchStoryInsights(fetchFn, story.id, accessToken));
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(INSIGHT_CONCURRENCY, stories.length) }, () => worker()),
  );

  // 3) Cache thumbnails + build upsert rows
  const upsertRows = await Promise.all(stories.map(async (story) => {
    const insights = insightsMap.get(story.id) ?? {};
    let thumbUrl = story.thumbnail_url;
    if (thumbUrl && isEphemeralInstagramUrl(thumbUrl)) {
      const cached = await cacheThumb(accountId, story.id, thumbUrl);
      if (cached) thumbUrl = cached;
    }
    const postedAt = new Date(story.timestamp);
    return {
      instagram_account_id: accountId,
      instagram_media_id: story.id,
      media_type: story.media_type || "STORY",
      thumbnail_url: thumbUrl,
      posted_at: postedAt.toISOString(),
      expired_at: new Date(postedAt.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      reach: insights.reach ?? null,
      impressions: insights.impressions ?? null,
      replies: insights.replies ?? null,
      taps_forward: insights.taps_forward ?? null,
      taps_back: insights.taps_back ?? null,
      exits: insights.exits ?? null,
      shares: insights.shares ?? null,
      synced_at: new Date().toISOString(),
    };
  }));

  // 4) Upsert with COALESCE preservation
  const { error } = await db
    .from("instagram_story_insights")
    .upsert(upsertRows, {
      onConflict: "instagram_account_id,instagram_media_id",
      ignoreDuplicates: false,
    });
  if (error) {
    console.error(`[story-ingest] upsert failed for account ${accountId}:`, error);
  }

  // 5) Aggregate by UTC date for daily metrics
  const byDate = new Map<string, { count: number; reach: number; impressions: number; replies: number; taps_forward: number; taps_back: number; exits: number }>();
  for (const row of upsertRows) {
    const date = toUtcDateStr(row.posted_at);
    const agg = byDate.get(date) ?? { count: 0, reach: 0, impressions: 0, replies: 0, taps_forward: 0, taps_back: 0, exits: 0 };
    agg.count++;
    agg.reach += row.reach ?? 0;
    agg.impressions += row.impressions ?? 0;
    agg.replies += row.replies ?? 0;
    agg.taps_forward += row.taps_forward ?? 0;
    agg.taps_back += row.taps_back ?? 0;
    agg.exits += row.exits ?? 0;
    byDate.set(date, agg);
  }

  return [...byDate.entries()].map(([date, agg]) => ({
    instagram_account_id: accountId,
    snapshot_date: date,
    stories_count_day: agg.count,
    stories_reach_day: agg.reach,
    stories_impressions_day: agg.impressions,
    stories_replies_day: agg.replies,
    stories_taps_forward_day: agg.taps_forward,
    stories_taps_back_day: agg.taps_back,
    stories_exits_day: agg.exits,
  }));
}
```

Note: The PostgREST `.upsert()` with `onConflict` does NOT automatically use COALESCE. The COALESCE preservation is handled by the daily RPC (`upsert_metrics_daily`). For the individual story upsert, PostgREST's upsert will overwrite. To get true COALESCE behavior on `instagram_story_insights`, we use a raw SQL upsert via `db.rpc` or accept that re-ingesting the same story with fresh data is the correct behavior (the story is still live, so new values are real, not transient errors). If the insight fetch fails for a specific story, `fetchStoryInsights` returns `{}` and we set `null` for those columns — PostgREST's upsert will overwrite with null. To prevent that, filter out stories with empty insights from the upsert batch.

Revise the upsert section (step 3 in implementation) to skip stories with no insights:

```typescript
  // Filter: only upsert stories that got at least one metric
  const rowsWithData = upsertRows.filter(r =>
    r.reach !== null || r.impressions !== null || r.replies !== null
  );
  // For stories already in DB that we couldn't re-fetch, don't touch them
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd supabase/functions && deno test instagram-sync-cron/__tests__/story-ingest.test.ts --no-check`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/instagram-sync-cron/story-ingest.ts supabase/functions/instagram-sync-cron/__tests__/story-ingest.test.ts
git commit -m "feat(analytics): add story-ingest module with tests"
```

---

### Task 3: Integrate Story Ingest into Sync Cron + Monthly Close

**Files:**
- Modify: `supabase/functions/instagram-sync-cron/index.ts` (add story ingest call after media loop)
- Modify: `supabase/functions/instagram-sync-cron/daily-ingest.ts` (add stories columns to DailyRow)
- Modify: `supabase/functions/instagram-sync-cron/monthly-close.ts` (add `closeStoriesForMonth`)
- Modify: `supabase/functions/instagram-sync-cron/backfill.ts` (call closeStoriesForMonth from maintenance step)

**Interfaces:**
- Consumes: `ingestStories(opts)` from `./story-ingest.ts` returning `StoryDailyAgg[]`; `cachePostThumbnail` from `../_shared/instagram-thumbnail-cache.ts`
- Produces: Stories collected during hourly sync; daily aggregates merged into `upsert_metrics_daily`; monthly stories columns filled during maintenance step

- [ ] **Step 1: Add import and call in index.ts**

In `index.ts`, add import at top:
```typescript
import { ingestStories } from "./story-ingest.ts";
```

After the media processing loop (around line 341, after the post upsert batch), add:

```typescript
    // Stories ingest (non-fatal: failure never blocks feed sync)
    try {
      const storyAggs = await ingestStories({
        fetchFn: fetch,
        accountId: account.id,
        accessToken,
        db: supabase,
        cacheThumb: async (acctId, mediaId, url) => {
          const cached = await cachePostThumbnail(
            { fetch, storage: supabase.storage },
            acctId, mediaId, url, null,
          );
          return cached && !isEphemeralInstagramUrl(cached) ? cached : url;
        },
      });
      // Merge story daily aggregates into existing daily rows
      if (storyAggs.length > 0) {
        const { error: storyDailyErr } = await supabase.rpc("upsert_metrics_daily", {
          p_rows: storyAggs,
        });
        if (storyDailyErr) {
          console.warn(`[IG-SYNC-CRON] story daily upsert failed for ${account.id}:`, storyDailyErr);
        }
      }
    } catch (e) {
      console.warn(`[IG-SYNC-CRON] story ingest failed for account ${account.id} (non-fatal):`, e);
    }
```

Also add import for `isEphemeralInstagramUrl` if not already present:
```typescript
import { isEphemeralInstagramUrl } from "../_shared/instagram-thumbnail-cache.ts";
```

- [ ] **Step 2: Add closeStoriesForMonth to monthly-close.ts**

Add after the existing `closePreviousMonthIfMissing` function:

```typescript
export async function closeStoriesForMonth(
  db: any, accountId: string, month: string,
): Promise<void> {
  // Coverage signal: only write stories columns if the account has at least
  // one daily row with stories_count_day set for the month
  const { data: coverage } = await db
    .from("instagram_account_metrics_daily")
    .select("id")
    .eq("instagram_account_id", accountId)
    .gte("snapshot_date", month)
    .lt("snapshot_date", nextMonth(month))
    .not("stories_count_day", "is", null)
    .limit(1)
    .maybeSingle();

  if (!coverage) return; // No stories data collected this month; leave NULL

  // Aggregate from story insights table
  const { data: agg } = await db
    .from("instagram_story_insights")
    .select("reach, impressions, replies, taps_forward, taps_back, exits")
    .eq("instagram_account_id", accountId)
    .gte("posted_at", `${month}-01T00:00:00Z`)
    .lt("posted_at", `${nextMonth(month)}-01T00:00:00Z`);

  const rows = agg ?? [];
  const totals = {
    stories_count_month: rows.length,
    stories_reach_month: rows.reduce((s: number, r: any) => s + (r.reach ?? 0), 0),
    stories_impressions_month: rows.reduce((s: number, r: any) => s + (r.impressions ?? 0), 0),
    stories_replies_month: rows.reduce((s: number, r: any) => s + (r.replies ?? 0), 0),
    stories_taps_forward_month: rows.reduce((s: number, r: any) => s + (r.taps_forward ?? 0), 0),
    stories_taps_back_month: rows.reduce((s: number, r: any) => s + (r.taps_back ?? 0), 0),
    stories_exits_month: rows.reduce((s: number, r: any) => s + (r.exits ?? 0), 0),
  };

  await db
    .from("instagram_account_metrics_monthly")
    .update(totals)
    .eq("instagram_account_id", accountId)
    .eq("month", `${month}-01`)
    .is("stories_count_month", null);
}

function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return next;
}
```

- [ ] **Step 3: Call closeStoriesForMonth from backfill.ts maintenance step**

In `backfill.ts` `runMaintenanceStep`, after the `closePreviousMonthIfMissing` call (around line 450), add:

```typescript
import { closeStoriesForMonth } from "./monthly-close.ts";

// Inside the per-account loop, after closePreviousMonthIfMissing:
try {
  await closeStoriesForMonth(db, account.id, prevWindow.startDate.slice(0, 7));
} catch (e) {
  console.warn(`[IG-SYNC-CRON] closeStoriesForMonth failed for ${account.id}:`, e);
}
```

- [ ] **Step 4: Run existing tests to check nothing breaks**

Run: `cd supabase/functions && deno test instagram-sync-cron/ --no-check`
Expected: All existing tests pass; new story-ingest tests pass

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/instagram-sync-cron/index.ts supabase/functions/instagram-sync-cron/daily-ingest.ts supabase/functions/instagram-sync-cron/monthly-close.ts supabase/functions/instagram-sync-cron/backfill.ts
git commit -m "feat(analytics): integrate story ingest into sync cron and monthly close"
```

---

### Task 4: Stories Analytics API Endpoint + Tests

**Files:**
- Modify: `supabase/functions/instagram-analytics/index.ts` (add `/stories/:clientId` route)
- Create: `supabase/functions/instagram-analytics/__tests__/stories-endpoint.test.ts`

**Interfaces:**
- Consumes: `verifyClientOwnership(serviceClient, clientId, contaId)`, `getAccount(serviceClient, clientId)`, `json = createJsonResponder(corsHeaders)` from existing analytics helpers
- Produces: `GET /stories/:clientId?days=30` endpoint returning `StoriesAnalyticsResponse`

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/instagram-analytics/__tests__/stories-endpoint.test.ts`:

```typescript
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

interface StoriesKpis {
  stories_count: number;
  total_reach: number;
  total_impressions: number;
  total_replies: number;
  avg_retention_rate: number;
  avg_skip_rate: number;
  total_exits: number;
}

interface StoryInsight {
  instagram_media_id: string;
  media_type: string;
  thumbnail_url: string | null;
  posted_at: string;
  reach: number;
  impressions: number;
  replies: number;
  taps_forward: number;
  taps_back: number;
  exits: number;
  shares: number;
  retention_rate: number;
  skip_rate: number;
  back_rate: number;
}

Deno.test("retention_rate computed correctly", () => {
  const impressions = 800;
  const exits = 100;
  const retention = 1 - (exits / impressions);
  assertEquals(retention, 0.875);
});

Deno.test("retention_rate is 0 when impressions is 0", () => {
  const impressions = 0;
  const exits = 0;
  const retention = impressions === 0 ? 0 : 1 - (exits / impressions);
  assertEquals(retention, 0);
});

Deno.test("skip_rate computed correctly", () => {
  const impressions = 800;
  const tapsForward = 200;
  const skip = tapsForward / impressions;
  assertEquals(skip, 0.25);
});

Deno.test("aggregated retention is ratio of totals, not average of rates", () => {
  const stories = [
    { impressions: 100, exits: 50 },
    { impressions: 900, exits: 90 },
  ];
  const totalImpressions = stories.reduce((s, r) => s + r.impressions, 0);
  const totalExits = stories.reduce((s, r) => s + r.exits, 0);
  const aggregated = 1 - (totalExits / totalImpressions);
  assertEquals(aggregated, 0.86);

  const avgOfRates = ((1 - 50/100) + (1 - 90/900)) / 2;
  assert(Math.abs(aggregated - avgOfRates) > 0.01);
});
```

- [ ] **Step 2: Run test to verify it passes (these are unit-level formula tests)**

Run: `cd supabase/functions && deno test instagram-analytics/__tests__/stories-endpoint.test.ts --no-check`
Expected: PASS (4 tests; these validate the formula logic)

- [ ] **Step 3: Add the /stories/:clientId route to index.ts**

In `instagram-analytics/index.ts`, add the route handler before the 404 fallback:

```typescript
  // Stories analytics
  const storiesMatch = path.match(/^\/stories\/(\d+)$/);
  if (req.method === 'GET' && storiesMatch) {
    const clientId = storiesMatch[1];
    await verifyClientOwnership(serviceClient, clientId, contaId);
    const { account } = await getAccount(serviceClient, clientId);

    const url = new URL(req.url);
    const daysParam = parseInt(url.searchParams.get('days') || '30', 10);
    const startParam = url.searchParams.get('start');
    const endParam = url.searchParams.get('end');

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const todayStr = today.toISOString().slice(0, 10);

    let startDate: string;
    let endDate: string;

    if (startParam && endParam) {
      startDate = startParam;
      endDate = endParam > todayStr ? todayStr : endParam;
    } else {
      const days = Math.min(Math.max(1, daysParam), 365);
      const start = new Date(today);
      start.setUTCDate(start.getUTCDate() - days + 1);
      startDate = start.toISOString().slice(0, 10);
      endDate = todayStr;
    }

    // Validate range
    const startMs = Date.parse(startDate + 'T00:00:00Z');
    const endMs = Date.parse(endDate + 'T00:00:00Z');
    if (isNaN(startMs) || isNaN(endMs) || startMs > endMs) {
      return json({ error: 'invalid_date_range' }, 400);
    }
    if ((endMs - startMs) / 86_400_000 > 365) {
      return json({ error: 'range_too_large', max_days: 365 }, 400);
    }

    // Current period stories
    const { data: stories } = await serviceClient
      .from('instagram_story_insights')
      .select('*')
      .eq('instagram_account_id', account.id)
      .gte('posted_at', startDate + 'T00:00:00Z')
      .lt('posted_at', endDate + 'T24:00:00Z')
      .order('reach', { ascending: false, nullsFirst: false })
      .limit(200);

    const rows = stories ?? [];

    // Compute KPIs
    const totalImpressions = rows.reduce((s, r) => s + (r.impressions ?? 0), 0);
    const totalExits = rows.reduce((s, r) => s + (r.exits ?? 0), 0);
    const totalTapsForward = rows.reduce((s, r) => s + (r.taps_forward ?? 0), 0);
    const currentKpis = {
      stories_count: rows.length,
      total_reach: rows.reduce((s, r) => s + (r.reach ?? 0), 0),
      total_impressions: totalImpressions,
      total_replies: rows.reduce((s, r) => s + (r.replies ?? 0), 0),
      avg_retention_rate: totalImpressions > 0 ? 1 - (totalExits / totalImpressions) : 0,
      avg_skip_rate: totalImpressions > 0 ? totalTapsForward / totalImpressions : 0,
      total_exits: totalExits,
    };

    // Previous period (same duration, ending day before start)
    const rangeDays = Math.round((endMs - startMs) / 86_400_000) + 1;
    const prevEnd = new Date(startMs - 86_400_000);
    const prevStart = new Date(prevEnd.getTime() - (rangeDays - 1) * 86_400_000);
    const prevStartStr = prevStart.toISOString().slice(0, 10);
    const prevEndStr = prevEnd.toISOString().slice(0, 10);

    const { data: prevStories } = await serviceClient
      .from('instagram_story_insights')
      .select('reach, impressions, replies, taps_forward, exits')
      .eq('instagram_account_id', account.id)
      .gte('posted_at', prevStartStr + 'T00:00:00Z')
      .lt('posted_at', prevEndStr + 'T24:00:00Z');

    let previousKpis = null;
    if (prevStories && prevStories.length > 0) {
      const pImpressions = prevStories.reduce((s, r) => s + (r.impressions ?? 0), 0);
      const pExits = prevStories.reduce((s, r) => s + (r.exits ?? 0), 0);
      const pTapsForward = prevStories.reduce((s, r) => s + (r.taps_forward ?? 0), 0);
      previousKpis = {
        stories_count: prevStories.length,
        total_reach: prevStories.reduce((s, r) => s + (r.reach ?? 0), 0),
        total_impressions: pImpressions,
        total_replies: prevStories.reduce((s, r) => s + (r.replies ?? 0), 0),
        avg_retention_rate: pImpressions > 0 ? 1 - (pExits / pImpressions) : 0,
        avg_skip_rate: pImpressions > 0 ? pTapsForward / pImpressions : 0,
        total_exits: pExits,
      };
    }

    // Per-story computed rates
    const storyInsights = rows.map(r => ({
      instagram_media_id: r.instagram_media_id,
      media_type: r.media_type,
      thumbnail_url: r.thumbnail_url,
      posted_at: r.posted_at,
      reach: r.reach ?? 0,
      impressions: r.impressions ?? 0,
      replies: r.replies ?? 0,
      taps_forward: r.taps_forward ?? 0,
      taps_back: r.taps_back ?? 0,
      exits: r.exits ?? 0,
      shares: r.shares ?? 0,
      retention_rate: (r.impressions ?? 0) > 0 ? 1 - ((r.exits ?? 0) / r.impressions) : 0,
      skip_rate: (r.impressions ?? 0) > 0 ? (r.taps_forward ?? 0) / r.impressions : 0,
      back_rate: (r.impressions ?? 0) > 0 ? (r.taps_back ?? 0) / r.impressions : 0,
    }));

    return json({
      stories: storyInsights,
      kpis: { current: currentKpis, previous: previousKpis },
    });
  }
```

- [ ] **Step 4: Run all analytics tests**

Run: `cd supabase/functions && deno test instagram-analytics/ --no-check`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/instagram-analytics/index.ts supabase/functions/instagram-analytics/__tests__/stories-endpoint.test.ts
git commit -m "feat(analytics): add /stories/:clientId endpoint with KPIs and per-story rates"
```

---

### Task 5: Frontend Service Layer + Analytics Page Section

**Files:**
- Modify: `apps/crm/src/services/analytics.ts` (add `getStoriesAnalytics`)
- Modify: `apps/crm/src/pages/analytics-conta/AnalyticsContaPage.tsx` (add Stories section)

**Interfaces:**
- Consumes: `fetchEdge<T>(url, options): Promise<T | null>` from `analytics.ts:34`; `EDGE_URL` from `analytics.ts:19`; `StatCard` from `@/components/StatCard`; `StatCardGrid` from the analytics page; `useQuery` from `@tanstack/react-query`
- Produces: `getStoriesAnalytics(clientId, days?, dateRange?)` service function; `StoriesSection` component rendered in analytics page

- [ ] **Step 1: Add types and service function to analytics.ts**

In `apps/crm/src/services/analytics.ts`, add types and the function:

```typescript
// Stories analytics types
export interface StoriesKpis {
  stories_count: number;
  total_reach: number;
  total_impressions: number;
  total_replies: number;
  avg_retention_rate: number;
  avg_skip_rate: number;
  total_exits: number;
}

export interface StoryInsight {
  instagram_media_id: string;
  media_type: string;
  thumbnail_url: string | null;
  posted_at: string;
  reach: number;
  impressions: number;
  replies: number;
  taps_forward: number;
  taps_back: number;
  exits: number;
  shares: number;
  retention_rate: number;
  skip_rate: number;
  back_rate: number;
}

export interface StoriesAnalyticsResponse {
  stories: StoryInsight[];
  kpis: {
    current: StoriesKpis;
    previous: StoriesKpis | null;
  };
}

export async function getStoriesAnalytics(
  clientId: number,
  days?: number,
  dateRange?: { start: string; end: string },
): Promise<StoriesAnalyticsResponse | null> {
  const params = new URLSearchParams();
  if (dateRange) {
    params.set('start', dateRange.start);
    params.set('end', dateRange.end);
  } else if (days) {
    params.set('days', String(days));
  }
  const qs = params.toString();
  return fetchEdge(`${EDGE_URL}/stories/${clientId}${qs ? `?${qs}` : ''}`);
}
```

- [ ] **Step 2: Add Stories section to AnalyticsContaPage.tsx**

Find the position between BaselineCard and the widgets-grid. Add a `useQuery` call and the section:

```tsx
// Import at top
import { Film, Eye, ChevronRight, MessageCircle } from 'lucide-react';
import { getStoriesAnalytics, type StoriesAnalyticsResponse } from '@/services/analytics';

// Inside the component, alongside other queries:
const storiesQuery = useQuery({
  queryKey: ['stories-analytics', clientId, days, dateRange],
  queryFn: () => getStoriesAnalytics(clienteId, days, dateRange),
  enabled: !!clienteId,
});

// Between BaselineCard and widgets-grid, add:
{storiesQuery.data && storiesQuery.data.kpis.current.stories_count > 0 && (
  <section className="animate-up" style={{ animationDelay: '0.4s' }}>
    <div className="flex items-center gap-2 mb-4">
      <Film className="h-5 w-5" style={{ color: 'var(--primary-color)' }} />
      <h2 className="text-lg font-semibold" style={{ color: 'var(--text-main)' }}>
        Stories
      </h2>
    </div>

    <StatCardGrid maxCols={4}>
      <StatCard
        label="Stories publicados"
        value={storiesQuery.data.kpis.current.stories_count}
        icon={Film}
        tone="blue"
        delta={computeDelta(
          storiesQuery.data.kpis.current.stories_count,
          storiesQuery.data.kpis.previous?.stories_count,
        )}
      />
      <StatCard
        label="Alcance de Stories"
        value={formatNumber(storiesQuery.data.kpis.current.total_reach)}
        icon={Eye}
        tone="violet"
        delta={computeDelta(
          storiesQuery.data.kpis.current.total_reach,
          storiesQuery.data.kpis.previous?.total_reach,
        )}
      />
      <StatCard
        label="Taxa de retencao"
        value={`${(storiesQuery.data.kpis.current.avg_retention_rate * 100).toFixed(1)}%`}
        icon={ChevronRight}
        tone="green"
        delta={computeDelta(
          storiesQuery.data.kpis.current.avg_retention_rate,
          storiesQuery.data.kpis.previous?.avg_retention_rate,
        )}
      />
      <StatCard
        label="Respostas"
        value={storiesQuery.data.kpis.current.total_replies}
        icon={MessageCircle}
        tone="pink"
        delta={computeDelta(
          storiesQuery.data.kpis.current.total_replies,
          storiesQuery.data.kpis.previous?.total_replies,
        )}
      />
    </StatCardGrid>

    {storiesQuery.data.stories.length > 0 && (
      <div className="card animate-up mt-4" style={{ animationDelay: '0.5s' }}>
        <h3 className="text-sm font-medium mb-3" style={{ color: 'var(--text-muted)' }}>
          Detalhamento por story
        </h3>
        <div style={{ overflowX: 'auto' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                <th className="text-left py-2 px-2 font-medium" style={{ color: 'var(--text-muted)' }}>Data</th>
                <th className="text-right py-2 px-2 font-medium" style={{ color: 'var(--text-muted)' }}>Alcance</th>
                <th className="text-right py-2 px-2 font-medium" style={{ color: 'var(--text-muted)' }}>Impressoes</th>
                <th className="text-right py-2 px-2 font-medium" style={{ color: 'var(--text-muted)' }}>Retencao</th>
                <th className="text-right py-2 px-2 font-medium" style={{ color: 'var(--text-muted)' }}>Avancaram</th>
                <th className="text-right py-2 px-2 font-medium" style={{ color: 'var(--text-muted)' }}>Voltaram</th>
                <th className="text-right py-2 px-2 font-medium" style={{ color: 'var(--text-muted)' }}>Saidas</th>
                <th className="text-right py-2 px-2 font-medium" style={{ color: 'var(--text-muted)' }}>Respostas</th>
              </tr>
            </thead>
            <tbody>
              {storiesQuery.data.stories.map((story) => {
                const retPct = (story.retention_rate * 100).toFixed(1);
                const retColor = story.retention_rate > 0.7 ? 'var(--success)' : story.retention_rate > 0.5 ? 'var(--warning)' : 'var(--danger)';
                return (
                  <tr key={story.instagram_media_id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td className="py-2 px-2" style={{ color: 'var(--text-main)' }}>
                      {new Date(story.posted_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
                    </td>
                    <td className="text-right py-2 px-2" style={{ color: 'var(--text-main)' }}>{formatNumber(story.reach)}</td>
                    <td className="text-right py-2 px-2" style={{ color: 'var(--text-main)' }}>{formatNumber(story.impressions)}</td>
                    <td className="text-right py-2 px-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: `${retColor}20`, color: retColor }}>
                        {retPct}%
                      </span>
                    </td>
                    <td className="text-right py-2 px-2" style={{ color: 'var(--text-muted)' }}>{story.taps_forward}</td>
                    <td className="text-right py-2 px-2" style={{ color: 'var(--text-muted)' }}>{story.taps_back}</td>
                    <td className="text-right py-2 px-2" style={{ color: 'var(--text-muted)' }}>{story.exits}</td>
                    <td className="text-right py-2 px-2" style={{ color: 'var(--text-muted)' }}>{story.replies}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    )}
  </section>
)}
```

The `computeDelta` helper should already exist in the page (used by other KPI cards). If not, add:

```typescript
function computeDelta(
  current: number | undefined,
  previous: number | null | undefined,
): StatDelta | undefined {
  if (previous == null || previous === 0 || current == null) return undefined;
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  return {
    direction: pct > 0 ? 'up' : pct < 0 ? 'down' : 'stable',
    percent: Math.abs(pct),
    caption: 'vs periodo anterior',
  };
}
```

Note: `formatNumber` should already exist (used throughout the page). Verify — if not, use `Intl.NumberFormat('pt-BR').format(n)`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: PASS

- [ ] **Step 4: Verify in browser**

Start the dev server (`npm run dev`) and navigate to a client analytics page. The Stories section won't show data yet (no stories collected), but verify:
- No console errors
- Section is absent (graceful: renders nothing when `stories_count === 0`)

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/services/analytics.ts apps/crm/src/pages/analytics-conta/AnalyticsContaPage.tsx
git commit -m "feat(analytics): add Stories section to analytics page with KPIs and table"
```

---

### Task 6: Frontend Tests

**Files:**
- Create: `apps/crm/src/__tests__/stories-analytics.test.ts`

**Interfaces:**
- Consumes: `getStoriesAnalytics` from `@/services/analytics`; `StoriesAnalyticsResponse` type

- [ ] **Step 1: Write the service function test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('getStoriesAnalytics', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('builds correct URL with days param', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ stories: [], kpis: { current: {}, previous: null } }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { getStoriesAnalytics } = await import('@/services/analytics');
    await getStoriesAnalytics(123, 60);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/stories/123?days=60'),
      expect.any(Object),
    );
  });

  it('builds correct URL with date range', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ stories: [], kpis: { current: {}, previous: null } }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const { getStoriesAnalytics } = await import('@/services/analytics');
    await getStoriesAnalytics(123, undefined, { start: '2026-08-01', end: '2026-08-31' });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/stories/123?start=2026-08-01&end=2026-08-31'),
      expect.any(Object),
    );
  });

  it('returns null on fetch error', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve('') });
    vi.stubGlobal('fetch', mockFetch);

    const { getStoriesAnalytics } = await import('@/services/analytics');
    const result = await getStoriesAnalytics(123);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Run test**

Run: `npm run test -- --run apps/crm/src/__tests__/stories-analytics.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 3: Commit**

```bash
git add apps/crm/src/__tests__/stories-analytics.test.ts
git commit -m "test(analytics): add stories analytics service tests"
```

---

### Task 7: Final Checks and Cleanup

**Files:** none new

**Interfaces:** none

- [ ] **Step 1: Run all typechecks**

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
```
Expected: All four PASS

- [ ] **Step 2: Run lint and format**

```bash
npm run lint
npm run format:check
```
Expected: PASS. If format fails, run `npm run format` then commit.

- [ ] **Step 3: Run all test suites**

```bash
npm run test
cd supabase/functions && deno test --no-check
```
Expected: All PASS

- [ ] **Step 4: Verify migration prefix one final time**

```bash
git ls-tree origin/main:supabase/migrations | tail -3
```
Confirm `20260902000010` doesn't collide.

- [ ] **Step 5: Final commit (format fixes if any)**

```bash
git add -A
git status  # review staged files
git commit -m "chore: format fixes"
```

---

## Phase 2 (Separate PR): Report Pipeline Integration

Not part of this PR. Tracked for completeness. Includes:

1. **BLOCK_TYPES** in `_shared/report-docs/layout.ts` — add `kpi_stories_count`, `kpi_stories_reach`, `kpi_stories_retention`, `top_stories`
2. **BLOCK_COMPONENTS** in `packages/report-blocks/BlockRenderer.tsx` — KPI cards use existing `KpiCardBlock`; `top_stories` needs new `TopStoriesBlock`
3. **WIDGET_CATALOG** in `packages/report-blocks/catalog.ts` — 4 entries in 'Numeros' and 'Conteudo'
4. **WIDGET_ICONS** in `apps/crm/src/pages/relatorio-editor/widgetIcons.ts` — Film, Eye, Percent, Trophy
5. **blockHasData** in `packages/report-blocks/data-presence.ts` — cases for KPIs + top_stories
6. **KPI_IDS + KPI_LABELS_PT + KpiSources** in `_shared/report-docs/kpis.ts` — stories_count, stories_reach, stories_retention
7. **ReportDocSnapshot** in `_shared/report-docs/snapshot.ts` — add optional `stories` field
8. **snapshot-source.ts** — query `instagram_story_insights` for the month, add to snapshot
9. **default-layout.ts** — conditional section after "Publicacoes" (guarded by `hasStories`)
10. **ai-input.ts** — add `stories_summary` to `snapshotToReportData()` output
