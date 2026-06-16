# Instagram Sync Cron Performance Optimization

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optimize `instagram-sync-cron` so it scales from ~28 accounts to hundreds without hitting Supabase edge function timeouts (~150s wall-clock limit).

**Architecture:** Three targeted changes: (1) extract a concurrency-limited pool runner into a side-effect-free module and use it to process accounts in parallel, (2) filter out recently-synced accounts at the DB query level, (3) only fetch per-post insights for posts from the last 30 days — dropping older posts from the upsert entirely to avoid overwriting their existing insight data.

**Tech Stack:** Deno (Supabase Edge Functions), Supabase JS client, Instagram Graph API

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `supabase/functions/instagram-sync-cron/pool.ts` | Pure `runPool` concurrency utility — no env vars, no side effects |
| Modify | `supabase/functions/instagram-sync-cron/index.ts:265-340` | Use `runPool`, update DB query filter, update post-insight filter |
| Create | `supabase/functions/__tests__/instagram-sync-pool_test.ts` | Tests for `runPool` imported from `pool.ts` |

---

### Task 1: Extract `runPool` concurrency utility

The current cron processes accounts sequentially in a `for` loop with a 2s sleep between each (lines 292-314). Replace this with a concurrency-limited pool that processes N accounts in parallel. Each account uses its own Instagram token, so there is no shared rate limit — the 2s delay between accounts is unnecessary.

`runPool` lives in its own pure module (`pool.ts`) so tests can import it without triggering `Deno.serve()` or env var reads from `index.ts`. This follows the existing pattern where `handler.ts` is the side-effect-free module that tests import.

**Files:**
- Create: `supabase/functions/instagram-sync-cron/pool.ts`
- Modify: `supabase/functions/instagram-sync-cron/index.ts:292-314`
- Create: `supabase/functions/__tests__/instagram-sync-pool_test.ts`

- [ ] **Step 1: Write the failing test for `runPool`**

Create `supabase/functions/__tests__/instagram-sync-pool_test.ts`:

```ts
import { assert, assertEquals } from "./assert.ts";
import { runPool } from "../instagram-sync-cron/pool.ts";

Deno.test("runPool processes all items", async () => {
  const results: number[] = [];
  await runPool([1, 2, 3, 4, 5], 3, async (n) => {
    results.push(n);
  });
  assertEquals(results.sort(), [1, 2, 3, 4, 5]);
});

Deno.test("runPool respects concurrency limit", async () => {
  let maxConcurrent = 0;
  let currentConcurrent = 0;
  await runPool([1, 2, 3, 4, 5, 6], 2, async (_n) => {
    currentConcurrent++;
    if (currentConcurrent > maxConcurrent) maxConcurrent = currentConcurrent;
    await new Promise((r) => setTimeout(r, 50));
    currentConcurrent--;
  });
  assertEquals(maxConcurrent, 2);
});

Deno.test("runPool handles empty array", async () => {
  let called = false;
  await runPool([], 3, async () => { called = true; });
  assertEquals(called, false);
});

Deno.test("runPool rejects when a callback throws and completes in-flight work", async () => {
  const completed: number[] = [];
  let rejected = false;
  let rejectedMessage = "";
  try {
    await runPool([1, 2, 3, 4], 2, async (n) => {
      if (n === 2) throw new Error("boom");
      await new Promise((r) => setTimeout(r, 30));
      completed.push(n);
    });
  } catch (err: any) {
    rejected = true;
    rejectedMessage = err.message;
  }
  // Pool must reject with the original error
  assert(rejected, "runPool should have rejected");
  assertEquals(rejectedMessage, "boom");
  // Worker 1 processes item 1 then picks up item 3 (next in queue).
  // Worker 2 throws on item 2. Promise.all rejects once worker 2 throws,
  // but worker 1 already started item 3 and completes it.
  assert(completed.includes(1), "Item 1 should have completed before the error");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `deno test supabase/functions/__tests__/instagram-sync-pool_test.ts`
Expected: FAIL — `pool.ts` does not exist yet

- [ ] **Step 4: Create `pool.ts` with `runPool`**

Create `supabase/functions/instagram-sync-cron/pool.ts`:

```ts
export async function runPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let i = 0;
  async function next(): Promise<void> {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx]);
    }
  }
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => next(),
  );
  await Promise.all(workers);
}
```

Work-stealing pool: N workers each pull the next item from the shared index. `Promise.all` propagates the first rejection but lets already-started work in other workers finish naturally.

- [ ] **Step 5: Run the test to verify it passes**

Run: `deno test supabase/functions/__tests__/instagram-sync-pool_test.ts`
Expected: All 4 tests PASS

- [ ] **Step 6: Replace the sequential loop with `runPool` in `index.ts`**

In `supabase/functions/instagram-sync-cron/index.ts`, add the import at the top (after existing imports):

```ts
import { runPool } from "./pool.ts";
```

Then replace the sequential account loop (lines 292-314):

```ts
// REMOVE this entire block:
for (let i = 0; i < accounts.length; i++) {
  const account = accounts[i];
  try {
    const result = await syncAccount(supabase, account);
    if (result.success) {
      console.log(`[IG-SYNC-CRON] Synced account ${account.id}`);
      syncedCount++;
    } else {
      console.error(`[IG-SYNC-CRON] Account ${account.id} failed: ${result.error}`);
      failedCount++;
      errors.push({ accountId: account.id, error: result.error || 'Unknown' });
    }
  } catch (err: any) {
    console.error(`[IG-SYNC-CRON] Account ${account.id} threw:`, err);
    failedCount++;
    errors.push({ accountId: account.id, error: err.message });
  }

  // Rate limit: 2s delay between accounts
  if (i < accounts.length - 1) {
    await new Promise(r => setTimeout(r, 2000));
  }
}
```

Replace with:

```ts
const CONCURRENCY = parseInt(Deno.env.get("SYNC_CONCURRENCY") || "5", 10);
await runPool(accounts, CONCURRENCY, async (account) => {
  try {
    const result = await syncAccount(supabase, account);
    if (result.success) {
      console.log(`[IG-SYNC-CRON] Synced account ${account.id}`);
      syncedCount++;
    } else {
      console.error(`[IG-SYNC-CRON] Account ${account.id} failed: ${result.error}`);
      failedCount++;
      errors.push({ accountId: account.id, error: result.error || 'Unknown' });
    }
  } catch (err: any) {
    console.error(`[IG-SYNC-CRON] Account ${account.id} threw:`, err);
    failedCount++;
    errors.push({ accountId: account.id, error: err.message });
  }
});
```

`SYNC_CONCURRENCY` defaults to 5 but is configurable via env var. Each account already makes ~6 parallel Graph API calls internally, so concurrency=5 means ~30 outbound connections at peak — safe to tune down if needed.

- [ ] **Step 7: Run the full test suite to check nothing broke**

Run: `deno test supabase/functions/__tests__/`
Expected: All tests PASS (including existing `cron-auth_test.ts`)

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/instagram-sync-cron/pool.ts supabase/functions/instagram-sync-cron/index.ts supabase/functions/__tests__/instagram-sync-pool_test.ts
git commit -m "perf(instagram-sync-cron): process accounts with concurrency pool (5 at a time)

Replaces sequential loop + 2s delay with a work-stealing pool.
Each account has its own Instagram token so no shared rate limit.
Concurrency configurable via SYNC_CONCURRENCY env var (default 5)."
```

---

### Task 2: Skip recently synced accounts

If an account was synced manually from the CRM UI (via `syncInstagramData()`) within the last 6 hours, the cron should skip it. The `last_synced_at` column already exists on `instagram_accounts` and gets updated on every sync.

**Files:**
- Modify: `supabase/functions/instagram-sync-cron/index.ts:275-286`

- [ ] **Step 1: Update the DB query to filter out recently synced accounts**

In `supabase/functions/instagram-sync-cron/index.ts`, find the query (lines 275-279):

```ts
const { data: accounts, error } = await supabase
  .from('instagram_accounts')
  .select('id, instagram_user_id, encrypted_access_token, token_expires_at, follower_count, following_count, media_count')
  .eq('authorization_status', 'active')
  .eq('auto_sync_enabled', true);
```

Replace with:

```ts
const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
const { data: accounts, error } = await supabase
  .from('instagram_accounts')
  .select('id, instagram_user_id, encrypted_access_token, token_expires_at, follower_count, following_count, media_count')
  .eq('authorization_status', 'active')
  .eq('auto_sync_enabled', true)
  .or(`last_synced_at.is.null,last_synced_at.lt.${sixHoursAgo}`);
```

This adds a filter: only sync accounts where `last_synced_at` is NULL (never synced) or older than 6 hours. Accounts recently synced via the UI are skipped.

- [ ] **Step 2: Update the log line to show skip context**

Find (line 286):
```ts
console.log(`[IG-SYNC-CRON] Starting sync for ${accounts.length} account(s)`);
```

Replace with:
```ts
console.log(`[IG-SYNC-CRON] Starting sync for ${accounts.length} account(s) (skipped recently synced)`);
```

- [ ] **Step 3: Run the test suite**

Run: `deno test supabase/functions/__tests__/`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/instagram-sync-cron/index.ts
git commit -m "perf(instagram-sync-cron): skip accounts synced within the last 6 hours

Avoids redundant API calls for accounts already synced manually via the UI."
```

---

### Task 3: Only fetch per-post insights for recent posts

Currently `syncAccount` fetches up to 50 posts and makes an individual Instagram API call for each post's insights (lines 210-259). For older posts, metrics barely change. Only fetch insights for posts from the last 30 days. Drop older posts from the upsert entirely — their data was already synced when they were recent, and upserting them now would either require matching column shapes (adding `reach: 0` etc. which overwrites real data) or a separate upsert path. Since older post metadata (likes, comments) barely changes, skipping them is the simplest correct approach.

**Files:**
- Modify: `supabase/functions/instagram-sync-cron/index.ts:210-259`

- [ ] **Step 1: Filter posts to recent-only before the insight loop**

In `supabase/functions/instagram-sync-cron/index.ts`, find the post processing block (lines 210-259). Replace the entire block with:

```ts
if (mediaData.data && mediaData.data.length > 0) {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recentPosts = mediaData.data.filter(
    (post: any) => new Date(post.timestamp).getTime() > thirtyDaysAgo
  );

  if (recentPosts.length > 0) {
    const allPostData: any[] = [];
    const BATCH_SIZE = 10;

    for (let i = 0; i < recentPosts.length; i += BATCH_SIZE) {
      const batch = recentPosts.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(batch.map(async (post: any) => {
        let reach = 0, impressions = 0, saved = 0, shares = 0;
        try {
          let metrics = 'reach,views,saved';
          if (post.media_type === 'VIDEO') metrics += ',shares';
          const postInsightsRes = await fetch(`https://graph.instagram.com/${post.id}/insights?metric=${metrics}&access_token=${accessToken}`);
          const postInsightsData = await postInsightsRes.json();
          if (postInsightsData.data) {
            for (const insight of postInsightsData.data) {
              if (insight.name === 'reach') reach = insight.values[0].value;
              if (insight.name === 'views') impressions = insight.values[0].value;
              if (insight.name === 'saved') saved = insight.values[0].value;
              if (insight.name === 'shares') shares = insight.values[0].value;
            }
          }
        } catch (_) { /* ignore per-post insight errors */ }

        let thumbUrl = post.thumbnail_url || post.media_url || null;
        if (!thumbUrl && post.media_type === 'CAROUSEL_ALBUM') {
          try {
            const childRes = await fetch(`https://graph.instagram.com/${post.id}/children?fields=media_url,media_type&limit=1&access_token=${accessToken}`);
            const childData = await childRes.json();
            if (childData.data?.[0]?.media_url) thumbUrl = childData.data[0].media_url;
          } catch (_) { /* ignore */ }
        }

        return {
          instagram_account_id: account.id,
          instagram_post_id: post.id,
          caption: post.caption || '',
          media_type: post.media_type,
          thumbnail_url: thumbUrl,
          permalink: post.permalink,
          posted_at: post.timestamp,
          likes: post.like_count || 0,
          comments: post.comments_count || 0,
          reach, impressions, saved, shares,
          synced_at: new Date().toISOString()
        };
      }));
      allPostData.push(...batchResults);
    }

    await supabase.from('instagram_posts').upsert(allPostData, { onConflict: 'instagram_post_id' });
  }
}
```

Key differences from current code:
- Posts older than 30 days are filtered out entirely — not fetched for insights, not upserted
- This avoids the inconsistent-column-shape problem: all rows in the upsert array have the same keys (including `reach`, `impressions`, `saved`, `shares`)
- Older posts retain whatever insight data they had from when they were last synced as recent posts — no regression, no overwrite with zeros
- Carousel child thumbnail fetches still happen for recent posts (no thumbnail regression)
- Reduces API calls from up to ~50 per account to ~15-20

- [ ] **Step 2: Run the test suite**

Run: `deno test supabase/functions/__tests__/`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/instagram-sync-cron/index.ts
git commit -m "perf(instagram-sync-cron): only fetch insights for posts < 30 days old

Older posts are excluded from the upsert entirely to preserve their
existing insight data. Reduces per-account API calls from ~50 to ~15-20."
```

---

## Performance Impact Summary

| Metric | Before (28 accounts) | After (28 accounts) | After (200 accounts) |
|--------|----------------------|---------------------|----------------------|
| Wall-clock time | ~56s sleep + API (~2-3 min) | No sleep, 5 concurrent (~30s) | ~60s estimated |
| API calls per account | 6 + ~50 posts = ~56 | 6 + ~15 recent = ~21 | ~21 |
| Total API calls | ~1,568 | ~588 | ~4,200 |
| Accounts skipped | 0 | Recently synced ones | Recently synced ones |
