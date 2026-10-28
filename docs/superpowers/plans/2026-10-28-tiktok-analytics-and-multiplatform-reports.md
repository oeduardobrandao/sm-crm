# TikTok Analytics + Multi-platform Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give TikTok the same analytics experience Instagram has (an all-clients overview plus a per-client tab), put each client's analytics behind Instagram | TikTok | Relatórios tabs, and let block reports mix Instagram and TikTok blocks.

**Architecture:** Part A adds a `tiktok-analytics` edge function whose pure KPI/window logic and queries live in `_shared/tiktok-analytics/` so Part B's report snapshot loader reuses them. The CRM gains a client analytics shell with three tabs, a TikTok overview page, and a TikTok tab. Part B adds `tiktok_*` report block types that the shared renderer resolves against a new optional `snapshot.tiktok` section. An old bundle renders unknown types as nothing, so no stale tab ever shows Instagram numbers in a TikTok block.

**Tech Stack:** React 19, React Router v7 (data router), TanStack Query, react-i18next, Tailwind/shadcn, Supabase Postgres, Deno edge functions, Vitest, `deno test`.

**Spec:** `docs/superpowers/specs/2026-10-28-tiktok-analytics-and-multiplatform-reports-design.md`. Read it first; this plan argues from it and does not repeat its rationale.

## Global Constraints

- Part A and Part B ship as two PRs, Part A first. Each PR's migrations and functions deploy before its merge (deploy order: spec §Deploy order).
- Migration version prefixes must be unique and above main's tail at PR-open time. The plan uses `20261103000001` (A) and `20261103000002` (B); renumber if main moved.
- Every date boundary (windows, `posted_at` buckets, follower-history dates, snapshot dates) is `America/Sao_Paulo`, via `_shared/sao-paulo-date.ts`. A window `[start, end]` is inclusive whole SP days.
- Tenant identity for every new or changed server path: `profiles.active_workspace_id` + an existing `workspace_members` row, then `clientes.conta_id` must equal it (pattern: `supabase/functions/report-docs/index.ts:47-58`). Never `profiles.conta_id`.
- User auth inside the function: service-role client + `auth.getUser(token)` with the token passed explicitly. `tiktok-analytics` deploys with `--no-verify-jwt` and gets `[functions.tiktok-analytics] verify_jwt = false` in `supabase/config.toml` (same as `instagram-analytics`).
- Never return raw error details to clients; log internally. CORS via `buildCorsHeaders(req)`.
- New UI copy goes through react-i18next namespace `analyticsTiktok` (pt + en). Moved Instagram copy stays literal. No em dashes in user-facing copy. pt-BR number formatting.
- No new plan column. TikTok analytics gates: `feature_tiktok` AND `feature_analytics_reports`; best-times also `feature_best_times`; AI also `feature_instagram_ai`, sharing the `ig-ai:${contaId}` budget (10/3600s).
- Icons: `lucide-react` in pages; Phosphor (`ph-tiktok-logo`) only in nav chrome.
- TikTok summed counts (views, likes, comments, shares, likes_total) always carry `prev: null`.
- Before each PR push: `npm run lint`, `npm run format:check`, the four `tsc` commands from CLAUDE.md, `npm run test`, `npm run check:functions`, then `npm run test:functions` last (deno pollutes node_modules; `npm ci` afterwards if frontend gates rerun).

## Review Focus

1. **Client with TikTok but no Instagram.** `/analytics/:id` must land on the TikTok tab, the Instagram tab must show "Instagram não conectado" inside the shell (not replace it), and report generation must succeed with a TikTok-only snapshot. Tests: Task A7 (shell default tab), Task B2 (loader, IG absent).
2. **A window with 0 or 1 follower points, or 0 videos.** It must show "sem dados" with no comparison, never `0`, `NaN` or `0%`. Tests: Task A3 (KPI math), Task A8 (card renders "sem dados").
3. **A user who switched workspace.** The function must answer for the active workspace only: a client of the previous workspace returns 403. Test: Task A4.
4. **Disconnect then reconnect.** Per-video history rows survive the `tiktok_posts` delete, and the TikTok tab shows the not-connected state while disconnected. Tests: Task A1 (no FK to `tiktok_posts`), Task A7 (state).
5. **A template with TikTok blocks applied to an Instagram-only client, and an old bundle opening a doc with `tiktok_*` blocks.** Placeholders in edit mode, omitted in view/Hub/PDF; unknown type renders nothing. Tests: Task B4.

---

# Part A — TikTok analytics (PR 1)

### Task A1: `tiktok_post_metrics_daily` migration

**Files:**
- Create: `supabase/migrations/20261103000001_tiktok_post_metrics_daily.sql`
- Test: `supabase/tests/entitlements/tiktok_post_metrics_daily.sql` (psql suite, CI `entitlement-tests`)

**Interfaces:**
- Produces: table `public.tiktok_post_metrics_daily(tiktok_account_id uuid NOT NULL REFERENCES tiktok_accounts(id) ON DELETE CASCADE, tiktok_video_id text NOT NULL, snapshot_date date NOT NULL, views bigint, likes int, comments int, shares int, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (tiktok_account_id, tiktok_video_id, snapshot_date))`.

- [ ] **Step 1: Write the psql test.** Follow an existing file in `supabase/tests/entitlements/` (call `et_grant_hosted_parity()` first, see memory note in that folder's other suites). Assert:
  - `authenticated` and `anon` get `permission denied` on `SELECT` and `INSERT`.
  - `service_role` can `INSERT` and `SELECT`.
  - Deleting a `tiktok_posts` row for the account leaves its `tiktok_post_metrics_daily` rows in place.
  - Deleting the `tiktok_accounts` row removes them.
- [ ] **Step 2: Run it to see it fail.** `bash scripts/test-entitlements.sh` (needs Docker/colima; if unavailable locally, note it and rely on CI). Expected: FAIL, relation does not exist.
- [ ] **Step 3: Write the migration.** Table as above; `ENABLE ROW LEVEL SECURITY` with no policies; `REVOKE ALL ON public.tiktok_post_metrics_daily FROM PUBLIC, anon, authenticated;` then `GRANT SELECT, INSERT, UPDATE, DELETE ON public.tiktok_post_metrics_daily TO service_role;`. Header comment cites spec §A1 and says why there is no FK to `tiktok_posts`.
- [ ] **Step 4: Run the suite.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(tiktok): per-video daily metrics history table`.

### Task A2: One write path for video counts, refresh coverage, SP dates

**Files:**
- Create: `supabase/functions/_shared/tiktok-video-metrics.ts`
- Modify: `supabase/functions/tiktok-integration/import.ts` (both count writes; `refreshStoredPostMetrics` selection)
- Modify: `supabase/functions/tiktok-integration/handlers.ts` (`/sync`: SP date, write `tiktok_account_metrics_daily`)
- Modify: `supabase/functions/tiktok-sync-cron/core.ts` (SP date; `feature_tiktok` check)
- Test: `supabase/functions/__tests__/tiktok-video-metrics_test.ts`, extend `tiktok-integration_test.ts`, `tiktok-sync-cron_test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface VideoCounts { tiktok_video_id: string; views: number | null; likes: number | null; comments: number | null; shares: number | null }
  /** Upserts today's (SP date) tiktok_post_metrics_daily row for each video. Never throws: logs and returns the number written. */
  export async function recordVideoSnapshots(svc: DbClient, accountId: string, rows: VideoCounts[], now?: Date): Promise<number>
  ```
- `importTikTokVideos` and `refreshStoredPostMetrics` keep their signatures.

- [ ] **Step 1: Write failing tests.**
  - `recordVideoSnapshots upserts one row per video on the São Paulo date`: with `now = 2026-10-29T01:30:00Z`, the upsert payload has `snapshot_date: "2026-10-28"` and `onConflict: "tiktok_account_id,tiktok_video_id,snapshot_date"`.
  - `recordVideoSnapshots swallows a db error and returns 0`.
  - `importTikTokVideos records a snapshot for every upserted video`, using the existing import test harness.
  - `refreshStoredPostMetrics records a snapshot for every updated video`.
  - `refreshStoredPostMetrics selects the 200 most recent plus every video posted in the last 90 days`. The mock returns 200 recent rows from the first select and 30 more ids from the 90-day select. Assert `video/query` is called with the union, deduplicated, in batches of 20.
  - `/sync writes tiktok_account_metrics_daily on the São Paulo date` (tiktok-integration_test).
  - `cron skips accounts whose workspace lacks feature_tiktok` (tiktok-sync-cron_test; `effectivePlanFeature` returns false only for `feature_tiktok`).
  - `cron uses the São Paulo date for follower history and the daily snapshot`.
- [ ] **Step 2: Run them to see them fail.** `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/tiktok-video-metrics_test.ts supabase/functions/__tests__/tiktok-integration_test.ts supabase/functions/__tests__/tiktok-sync-cron_test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `recordVideoSnapshots` uses `saoPauloDate(now)`.
  - In `importTikTokVideos`, after a successful upsert, call it with the upserted rows' counts.
  - In `refreshStoredPostMetrics`, collect the updated videos' counts and call it once at the end.
  - The selection is two queries: `.order('posted_at', desc).limit(200)`, and `.gte('posted_at', <SP midnight 89 days before today, as UTC ISO>)`. Merge the ids, deduplicated, keeping the first query's order.
  - Replace `new Date().toISOString().split("T")[0]` / `toDateString(now)` with `saoPauloDate(...)` in `/sync` and the cron.
  - `/sync` upserts `tiktok_account_metrics_daily` like `core.ts:178-185` does. A failure is logged, not fatal, which matches `/sync`'s other writes.
  - The cron checks `feature_tiktok` in the same per-workspace `Promise.all` as `feature_auto_sync_cron`, and requires both.
- [ ] **Step 4: Run the tests.** Same command. Expected: PASS, and the full existing suites stay green.
- [ ] **Step 5: Commit** `feat(tiktok): record daily video snapshots and widen metric refresh`.

### Task A3: Pure KPI, window and best-times logic

**Files:**
- Create: `supabase/functions/_shared/tiktok-analytics/window.ts`
- Create: `supabase/functions/_shared/tiktok-analytics/kpis.ts`
- Modify: `supabase/functions/_shared/best-times.ts` (optional rate function)
- Test: `supabase/functions/_shared/tiktok-analytics/window.test.ts`, `kpis.test.ts`; extend `supabase/functions/__tests__/best-times_test.ts`

**Interfaces:**
- Produces (`window.ts`):
  ```ts
  export interface AnalyticsWindow { start: string; end: string; prevStart: string; prevEnd: string } // YYYY-MM-DD, SP, inclusive
  export function windowFromDays(days: number, now: Date): AnalyticsWindow          // end = SP today, start = end - (days-1)
  export function windowFromRange(start: string, end: string): AnalyticsWindow | null // null on bad/inverted input or span > 730
  export function spDayStartIso(date: string): string      // `${date}T03:00:00.000Z`
  export function spDayEndExclusiveIso(date: string): string // next day T03:00Z
  ```
  The previous window has the same length and ends the day before `start`.
- Produces (`kpis.ts`):
  ```ts
  export const TIKTOK_KPI_IDS = ["followers_total","followers_gained","views","engagement_rate","likes","comments","shares","posts_count","likes_total"] as const;
  export type TikTokKpiId = (typeof TIKTOK_KPI_IDS)[number];
  export interface TikTokVideoRow { tiktok_video_id: string; posted_at: string | null; views: number | null; likes: number | null; comments: number | null; shares: number | null }
  export interface FollowerPoint { date: string; follower_count: number }
  export interface TikTokKpiInput {
    videos: TikTokVideoRow[]; prevVideos: TikTokVideoRow[];
    history: FollowerPoint[]; prevHistory: FollowerPoint[];   // already clipped to each window, any order
    currentFollowers: number | null;  // used only when the window ends on SP today and history lacks today
    windowEndsToday: boolean;
    likesTotal: number | null;
  }
  export function computeTikTokKpis(i: TikTokKpiInput): Record<TikTokKpiId, KpiEntry>  // KpiEntry from ../report-docs/kpis.ts
  export function videoEngagementRate(v: TikTokVideoRow): number | null // (l+c+s)/views*100, null when views falsy
  ```
- Modifies: `bestTimesFromPosts(posts: BestTimesPost[], rate?: (p: BestTimesPost) => number | null)`. `BestTimesPost` widens `saved`/`reach` to optional plus optional `views`. The default rate is today's formula, so Instagram output is byte-identical.
- Produces: `export const tiktokRate = (p: BestTimesPost) => p.views ? ((p.likes||0)+(p.comments||0)+(p.shares||0)) / p.views * 100 : null;`. A null rate counts the post but adds 0 (same as today's reach-0 case).

- [ ] **Step 1: Write failing tests (assertions with exact values).**
  - `windowFromDays(30, 2026-10-28T12:00Z)` → `{start:"2026-09-29", end:"2026-10-28", prevStart:"2026-08-30", prevEnd:"2026-09-28"}`.
  - `windowFromDays(7, 2026-10-29T01:30Z)` ends on `"2026-10-28"` (SP is still the 28th).
  - `windowFromRange("2026-10-10","2026-10-01")` → `null`; a 731-day span → `null`.
  - The KPI tests use one account fixture: history `[{2026-10-01,1000},{2026-10-15,1100},{2026-10-28,1200}]`, prevHistory `[{2026-09-01,900},{2026-09-30,980}]`, and videos `[{views:1000,likes:50,comments:10,shares:40},{views:0,likes:0,comments:0,shares:0}]`.
    - `followers_total` = `{value:1200, unit:"count", prev:1000}`.
    - `followers_gained` = `{value:200, prev:80}`.
    - `views` = `{value:1000, prev:null}`.
    - `engagement_rate` = `{value:10, unit:"pct"}`, with prev computed the same way from prevVideos.
    - `posts_count` = `{value:2}`.
    - `likes`, `comments` and `shares` all have `prev:null`.
    - `likes_total` has `prev:null`.
  - `one follower point in the window → followers_gained value null, prev null; followers_total prev null`.
  - `no prev follower points → followers_gained prev null`.
  - `zero videos in window → engagement_rate value null; views value 0`.
  - `zero videos in prev window → posts_count prev null and engagement_rate prev null`.
  - `window ending today with no point today uses currentFollowers for followers_total`.
  - `bestTimesFromPosts with tiktokRate scores by views` and `bestTimesFromPosts without a rate is unchanged` (the existing best-times tests still pass).
- [ ] **Step 2: Run them to see them fail.** `deno test --no-check --node-modules-dir=auto --allow-env --allow-read supabase/functions/_shared/tiktok-analytics/ supabase/functions/__tests__/best-times_test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the signatures above. Follower values read only observed points, sorted by date (spec §A3 rules).
- [ ] **Step 4: Run the tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(tiktok-analytics): window, KPI and best-times logic`.

### Task A4: `tiktok-analytics` edge function (data routes)

**Files:**
- Create: `supabase/functions/_shared/tiktok-analytics/queries.ts`
- Create: `supabase/functions/tiktok-analytics/index.ts` (env + dispatch only), `supabase/functions/tiktok-analytics/handlers.ts`
- Modify: `supabase/config.toml` (add `[functions.tiktok-analytics]` with `verify_jwt = false`)
- Test: `supabase/functions/__tests__/tiktok-analytics_test.ts`

**Interfaces:**
- Produces (`queries.ts`, all take a service-role `db`):
  ```ts
  export interface TikTokAccountRow { id: string; client_id: number; username: string|null; display_name: string|null; avatar_url: string|null; follower_count: number|null; likes_count: number|null; video_count: number|null; authorization_status: string; last_synced_at: string|null }
  export async function loadTikTokAccount(db, clientId: number): Promise<TikTokAccountRow | null>   // explicit column list, never tokens
  export async function loadVideosInWindow(db, accountId: string, startDate: string, endDate: string): Promise<TikTokVideoRow & {title,video_description,duration,share_url,cover_image_url}[]>
  export async function loadFollowerHistory(db, accountId: string, startDate: string, endDate: string): Promise<{date:string; follower_count:number; source:string}[]>
  export async function buildOverview(db, account: TikTokAccountRow, w: AnalyticsWindow, now: Date): Promise<TikTokOverview>
  export interface TikTokOverview { account: Pick<TikTokAccountRow,'username'|'display_name'|'avatar_url'|'authorization_status'|'last_synced_at'|'follower_count'>; window: AnalyticsWindow; kpis: Record<TikTokKpiId, KpiEntry> }
  ```
- Produces (`handlers.ts`): `export function createTikTokAnalyticsHandler(deps: { buildCorsHeaders; createServiceDb: () => DbClient; effectivePlanFeature?; checkRateLimit?; now?: () => Date; fetch?; geminiKey?: string }): (req: Request) => Promise<Response>`
- Routes (all JSON; `clientId` parsed with `parseInt` + `isNaN` guard; 400 on bad id):

| Route | Query | 200 body |
|---|---|---|
| `GET /overview/:clientId` | `days` (1-730, default 30) or `start&end` | `TikTokOverview` |
| `GET /follower-history/:clientId` | same window params | `{ history: {date, follower_count, source}[] }` |
| `GET /posts-analytics/:clientId` | window + `sort` ∈ `views\|likes\|comments\|shares\|engagement_rate\|posted_at` (default `views`) | `{ posts: (video row + engagement_rate)[] }`, desc, max 500 |
| `GET /best-times/:clientId` | none (last 90 SP days) | `BestTimesPayload` |
| `GET /portfolio` | `days` (1-365, default 28) | `{ window, totals: {accounts, followers, views, engagement_rate, posts_count}, accounts: PortfolioRow[], topVideos: PortfolioVideo[], bottomVideos: PortfolioVideo[] }` |

  `PortfolioRow = { client_id, client_name, especialidade, username, avatar_url, authorization_status, follower_count, followers_gained, views, engagement_rate, posts_count, last_posted_at }`. `PortfolioVideo = { client_id, client_name, tiktok_video_id, title, cover_image_url, share_url, posted_at, views, likes, engagement_rate }`. `topVideos` holds the top 5 by views in the window. `bottomVideos` holds the 5 with the fewest views among videos older than 48h.
- Error bodies:
  - 401 `{error:"Unauthorized"}`;
  - 403 `{error:"Unauthorized"}` (ownership);
  - 403 `{error:"feature_disabled", feature}`;
  - 404 `{error:"not_connected"}` when the client has no `tiktok_accounts` row or its status is `disconnected`/`revoked`. `expired` still returns data, plus `account.authorization_status`.
  - 429 on the rate limit (`tiktok-analytics:${contaId}`, 120/60s, *my call*).

- [ ] **Step 1: Write failing tests** with `createSupabaseQueryMock` (`test/shared/supabaseMock.ts`), following `tiktok-sync-cron_test.ts`'s DI style:
  - `401 without bearer token`.
  - `uses active_workspace_id, not profiles.conta_id`: profile `{active_workspace_id:"ws-B", conta_id:"ws-A"}` with the client in ws-A → 403.
  - `403 when the caller is not a workspace member`.
  - `403 feature_disabled when feature_tiktok is off` and `... when feature_analytics_reports is off`.
  - `best-times requires feature_best_times`.
  - `404 not_connected for a disconnected account`.
  - `overview returns kpis computed over the window` (fixture from Task A3; assert `kpis.followers_gained.value === 200`).
  - `overview rejects start after end with 400`.
  - `posts-analytics sorts by engagement_rate desc and caps at 500`.
  - `portfolio only includes clients of the active workspace`.
  - `portfolio bottomVideos excludes videos younger than 48h`.
  - `never selects token columns` (assert the `tiktok_accounts` select string has no `token`).
- [ ] **Step 2: Run them to see them fail.** `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net supabase/functions/__tests__/tiktok-analytics_test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `queries.ts`, `handlers.ts` and `index.ts`.
  - Auth is service-role `getUser(token)`, then the `active_workspace_id` + `workspace_members` check from Global Constraints.
  - The feature map is a local `featureForTikTokPath(path)` returning the extra flag (or null) on top of the two base flags.
  - `buildOverview` loads the window and previous-window videos and history in parallel, then calls `computeTikTokKpis`. `windowEndsToday` = `w.end === saoPauloDate(now)`.
- [ ] **Step 4: Run tests + type gate.** The test command above, then `npm run check:functions`. Expected: PASS, no type errors.
- [ ] **Step 5: Commit** `feat(tiktok-analytics): edge function with overview, history, posts, best-times, portfolio`.

### Task A5: TikTok AI routes

**Files:**
- Create: `supabase/functions/tiktok-analytics/ai.ts`
- Modify: `supabase/functions/tiktok-analytics/handlers.ts` (routes)
- Test: extend `supabase/functions/__tests__/tiktok-analytics_test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function buildAccountPrompts(input: { username: string; clientName: string; specialty: string|null; days: number; followers: number|null; history: FollowerPoint[]; videos: (TikTokVideoRow & {title: string|null; duration: number|null})[] }): { system: string; user: string }
  export function buildPortfolioPrompts(input: { days: number; accounts: PortfolioRow[] }): { system: string; user: string }
  export async function callGemini(fetchImpl: typeof fetch, key: string, prompts: {system: string; user: string}): Promise<unknown> // parsed JSON or {error:true, raw}
  ```
- Routes:
  - `POST /ai-analysis/:clientId` with body `{days}` (1-365, default 30) returns `{ analysis, generatedAt }`.
  - `POST /ai-analysis-portfolio` with body `{days}` returns `{ analysis, generatedAt }`.
  - The response JSON schemas are copied verbatim from `instagram-analytics/index.ts` (account: lines ~1068-1106; portfolio: the matching block after line 1158), so `AISection` and `AIPortfolioSection` render them unchanged. The wording is adapted to TikTok:
    - "vídeos", not "posts/Reels";
    - engagement per view, not reach;
    - no saves;
    - `contentMix` talks about duration and themes, since there is only one format.
  - No `GEMINI_API_KEY` → 200 `{analysis:{error:true, raw:"ai_unavailable"}}`. The raw Gemini error is logged, never returned (fixes the Instagram leak pattern for the new code only).

- [ ] **Step 1: Write failing tests.**
  - `ai-analysis requires feature_instagram_ai`.
  - `ai-analysis shares the ig-ai rate key` (assert `checkRateLimit` called with `ig-ai:<contaId>`, 10, 3600).
  - `ai-analysis without GEMINI key returns error analysis, no fetch`.
  - `account prompt mentions vídeos and never 'alcance' or 'salvamentos'`.
  - `gemini non-200 does not leak the upstream message` (body has no upstream text).
- [ ] **Step 2: Run to fail.** Same test command as A4. Expected: FAIL.
- [ ] **Step 3: Implement.** Model, `temperature`, `maxOutputTokens` and `responseMimeType` are the same as Instagram's (`gemini-2.5-flash`, 0.3, 8192, `application/json`). Parse fallback is the same as Instagram's.
- [ ] **Step 4: Run tests.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(tiktok-analytics): AI account and portfolio analysis`.

### Task A6: CRM service, types and i18n namespace

**Files:**
- Create: `apps/crm/src/services/tiktokAnalytics.ts`
- Create: `packages/i18n/locales/pt/analyticsTiktok.json`, `packages/i18n/locales/en/analyticsTiktok.json`
- Modify: `apps/crm/src/boot/i18nResources.ts` (register `analyticsTiktok` for pt and en)
- Test: `apps/crm/src/services/__tests__/tiktokAnalytics.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type TikTokKpiId = 'followers_total'|'followers_gained'|'views'|'engagement_rate'|'likes'|'comments'|'shares'|'posts_count'|'likes_total';
  export interface KpiEntry { value: number | null; unit: 'count' | 'pct'; prev: number | null }
  export type AnalyticsRange = { days: number } | { start: string; end: string };
  export interface TikTokOverview { account: {...}; window: {start,end,prevStart,prevEnd}; kpis: Record<TikTokKpiId, KpiEntry> }
  export interface TikTokVideoAnalytics { tiktok_video_id; title; video_description; duration; share_url; cover_image_url; posted_at; views; likes; comments; shares; engagement_rate: number | null }
  export interface TikTokPortfolio { window; totals; accounts: TikTokPortfolioRow[]; topVideos: TikTokPortfolioVideo[]; bottomVideos: TikTokPortfolioVideo[] }
  export class TikTokNotConnectedError extends Error {}
  export function getTikTokOverview(clientId: number, range: AnalyticsRange): Promise<TikTokOverview>
  export function getTikTokFollowerHistory(clientId: number, range: AnalyticsRange): Promise<{date:string; follower_count:number; source:string}[]>
  export function getTikTokPostsAnalytics(clientId: number, range: AnalyticsRange, sort?: TikTokPostSort): Promise<TikTokVideoAnalytics[]>
  export function getTikTokBestTimes(clientId: number): Promise<BestPostingTimes>   // reuse the Instagram BestPostingTimes type from services/analytics
  export function getTikTokPortfolio(days: number): Promise<TikTokPortfolio>
  export function getTikTokAIAnalysis(clientId: number, days: number): Promise<{ analysis: any; generatedAt: string }>
  export function getTikTokPortfolioAI(days: number): Promise<{ analysis: any; generatedAt: string }>
  ```
  The fetch helper follows `services/tiktok.ts` (session token, `VITE_SUPABASE_URL + '/functions/v1/tiktok-analytics'`). A 404 `not_connected` throws `TikTokNotConnectedError`; a 403 `feature_disabled` throws an error whose `message === 'feature_disabled'`.
- i18n keys: one flat-ish tree (`overview.*`, `tab.*`, `kpi.<id>.label`, `kpi.<id>.sub`, `kpi.views.tooltip`, `states.*`, `table.*`, `bestTimes.*`, `ai.*`). The pt `kpi.views.tooltip` is exactly "Total atual dos vídeos publicados no período, não as visualizações recebidas no período." en gets an equivalent.

- [ ] **Step 1: Write failing tests.**
  - `getTikTokOverview builds ?days= for a days range and ?start=&end= for a range`.
  - `throws TikTokNotConnectedError on 404 not_connected`.
  - `sends the session bearer token`.
  - `analyticsTiktok has the same keys in pt and en` (or rely on `packages/i18n/__tests__/locales.test.ts` if it already checks parity: run it).
- [ ] **Step 2: Run to fail.** `npx vitest run apps/crm/src/services/__tests__/tiktokAnalytics.test.ts packages/i18n/__tests__/locales.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(crm): TikTok analytics service and i18n namespace`.

### Task A7: Routes, nav, client shell with tabs, reports panel moved

**Files:**
- Create: `apps/crm/src/pages/analytics-conta/AnalyticsClientShell.tsx`
- Create: `apps/crm/src/pages/analytics-conta/reports/ClientReportsPanel.tsx` (desktop card + phone list, extracted)
- Move: `apps/crm/src/pages/analytics-conta/components/NewReportDialog.tsx` → `apps/crm/src/pages/analytics-conta/reports/NewReportDialog.tsx`
- Modify: `apps/crm/src/pages/analytics-conta/AnalyticsContaPage.tsx`:
  - becomes the Instagram tab: `export function InstagramAnalyticsTab({ clientId, cliente })`;
  - the default export is removed;
  - the reports card and report queries/mutations move out;
  - the client title moves to the shell;
  - `/cliente/${clientId}` becomes `/clientes/${clientId}/redes-sociais`.
- Modify: `apps/crm/src/pages/analytics-conta/phone/ContaPhone.tsx` (drop the reports section and its props: `reportDocs`, `reports`, `onOpenDoc` and the reports UI; keep `onNewReport`)
- Modify: `apps/crm/src/App.tsx:326-330` (routes), `apps/crm/src/components/layout/nav-data.ts`, `Sidebar.tsx`/`MobileNav.tsx` only if the active-match API changes
- Modify: `apps/crm/src/pages/relatorio-editor/RelatorioEditorPage.tsx:189,363` and `apps/crm/src/pages/cliente-detalhe/tabs/RelatoriosTab.tsx` ("Ver Analytics") → `/analytics/${clientId}/relatorios`
- Test: `apps/crm/src/pages/analytics-conta/__tests__/AnalyticsClientShell.test.tsx`; update `AnalyticsContaPage.test.tsx`, `AnalyticsContaPage.phone.test.tsx`, `components/layout/__tests__/nav-data.test.ts`, `Sidebar.test.tsx`

**Interfaces:**
- Consumes: `getTikTokSummary(clientId)` (existing, `services/tiktok.ts`) for the TikTok connection state; `getInstagramSummary` (existing).
- Produces:
  - `export type AnalyticsTab = 'instagram' | 'tiktok' | 'relatorios'`.
  - `AnalyticsClientShell` is the element for route `/analytics/:id/:tab?`. It renders the header (back link to `/analytics`, avatar, name, specialty), the tab bar, and below it one of `<InstagramAnalyticsTab/>`, `<TikTokAnalyticsTab/>` (Task A8; a placeholder `<div data-testid="tiktok-tab-pending"/>` until then) or `<ClientReportsPanel clientId/>`.
  - `ClientReportsPanel({ clientId }: { clientId: number })` owns `['report-docs', clientId]`, `['client-reports', clientId]` (keep the existing keys), delete/download/e-mail, and the `NewReportDialog`. It renders desktop or phone by `useIsDesktop(768)`.
- Routes:
  ```tsx
  <Route path="/analytics" element={<AnalyticsPage />} />
  <Route path="/analytics/tiktok" element={<TikTokOverviewPage />} />   // Task A10; placeholder element until then
  <Route path="/analytics/:id/:tab?" element={<AnalyticsClientShell />} />
  ```
- Tab rules:
  - With no `:tab`, or an unknown `:tab`, the shell redirects (`replace`) to the default: `tiktok` when Instagram is not connected and TikTok is (and `feature_tiktok`); `instagram` otherwise.
  - The TikTok tab is hidden, and `/analytics/:id/tiktok` redirects to `instagram`, when `features.feature_tiktok !== true`.
  - The Instagram tab's "not connected" / "token expirado" states render inside the shell, below the tabs, never replacing them.
- Nav:
  - Add the item `{ id: 'analytics-tiktok', route: '/analytics/tiktok', label: 'TikTok', labelKey: 'nav.tiktok', icon: 'ph-tiktok-logo' }` after Instagram.
  - `NAV_MODULE['analytics-tiktok'] = ['analytics','ver']`.
  - It is shown only when `features?.feature_tiktok === true && features?.feature_analytics_reports !== false`. That is fail-closed on `feature_tiktok`, so the item is hidden while features are null; implement it as a new `NAV_FEATURE_REQUIRED_TRUE: Record<string, string>` checked even when `features` is null.
  - Add `nav.tiktok` to `common.json`, pt and en.
- Active state:
  - Replace `isNavRouteActive(pathname, route)` with `isNavRouteActive(pathname, route, itemId?)`, with the same behavior plus one rule: the `analytics` item is not active on `/analytics/tiktok` or `/analytics/<id>/tiktok`, and the `analytics-tiktok` item is active exactly there.
  - Update its doc comment, which currently says the opposite.
  - The phone tab bar's single `analytics` tab (`PHONE_TAB.analytics` in `MobileNav`) stays active on every `/analytics*` path, TikTok included. Keep calling `isNavRouteActive` there without the item id, or assert it explicitly.
  - Test: `phone analytics tab is active on /analytics/tiktok`.

- [ ] **Step 1: Write failing tests.**
  - `nav-data`: `TikTok item shows under feature_tiktok + feature_analytics_reports` (replaces the "is gone" test); `TikTok item hidden when features null`; `TikTok item hidden when feature_tiktok false`.
  - `isNavRouteActive('/analytics/tiktok','/analytics','analytics') === false`; `isNavRouteActive('/analytics/12/tiktok','/analytics/tiktok','analytics-tiktok') === true`; `isNavRouteActive('/analytics/12/instagram','/analytics','analytics') === true`; `'/analytics-fluxos'` is still not active for `/analytics`.
  - Shell: `/analytics/12 redirects to /analytics/12/instagram`; `redirects to tiktok when only TikTok is connected`; `unknown tab redirects to default`; `TikTok tab hidden without feature_tiktok`; `Instagram not connected shows the message inside the shell with tabs visible`; `Relatórios tab lists report docs` (moved assertion from AnalyticsContaPage.test); `reconnect button goes to /clientes/12/redes-sociais`.
  - Phone: `AnalyticsContaPage.phone.test.tsx` updated so the Instagram tab still renders `ContaPhone`, and the report list asserts move to the Relatórios tab.
- [ ] **Step 2: Run to fail.** `npx vitest run apps/crm/src/pages/analytics-conta apps/crm/src/components/layout`. Expected: FAIL.
- [ ] **Step 3: Implement.** Moving code is cut and paste: no behavior change in the Instagram tab beyond the title, the reports card, and the link fix. Keep `AnalyticsContent`'s period state untouched (spec §A6).
- [ ] **Step 4: Run** the same command plus `npx tsc -p apps/crm/tsconfig.json --noEmit`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(analytics): client analytics shell with Instagram, TikTok and Relatórios tabs`.

### Task A8: TikTok tab (desktop)

**Files:**
- Create: `apps/crm/src/pages/analytics-conta/tiktok/TikTokAnalyticsTab.tsx`
- Create: `apps/crm/src/pages/analytics-conta/tiktok/TikTokKpiGrid.tsx`, `TikTokRankedVideos.tsx`, `TikTokVideosTable.tsx`, `TikTokPeriodBar.tsx`
- Modify: `AnalyticsClientShell.tsx` (replace the placeholder)
- Test: `apps/crm/src/pages/analytics-conta/tiktok/__tests__/TikTokAnalyticsTab.test.tsx`

**Interfaces:**
- Consumes: Task A6 service functions; `syncTikTokData(clientId)` (existing); Instagram presentational pieces where they take plain props: `FollowerChart`, `BestTimesHeatmap` and `AISection` in `AnalyticsContaPage.tsx`. Export them from there, or move them to `analytics-conta/shared/`. `AISection` gains a `load: (days) => Promise<{analysis, generatedAt}>` prop, default `getAccountAIAnalysis(clientId, days)`, so Instagram is unchanged.
- Produces: `export function TikTokAnalyticsTab({ clientId }: { clientId: number })`.
- Period: `TikTokPeriodBar` offers 7/30/90 dias, Último mês and Dias... (1-730), local state in the tab, and emits an `AnalyticsRange`. Query keys: `['tt-overview', clientId, range]`, `['tt-history', clientId, range]`, `['tt-posts', clientId, range, sort]`, `['tt-best-times', clientId]`.
- Sections, in this order: header row (handle, avatar, "Sincronizado há…", Sincronizar); KPI grid (A3 ids, `likes_total` last); Melhores vídeos / Precisam de atenção; Crescimento de seguidores; Desempenho dos vídeos table (date, cover, title, views, likes, comments, shares, eng. por view, duration, link via `sanitizeUrl(share_url)`); Melhor horário para postar; Análise com IA.
- KPI card: a null value renders "sem dados" with no delta line; `views` shows the tooltip from i18n; a pct is formatted `6,8%`.
- States:
  - `TikTokNotConnectedError` → "TikTok não conectado" card with a button to `/clientes/${clientId}/redes-sociais`.
  - `authorization_status === 'expired'` → a "Conexão expirada" banner above the data.
  - `feature_disabled` on best-times/AI → that section shows the locked state used by the Instagram tab.

- [ ] **Step 1: Write failing tests** (mock `services/tiktokAnalytics`):
  - `renders KPI values pt-BR formatted`.
  - `null follower KPI shows 'sem dados' and no delta`.
  - `views card has no comparison and has the tooltip`.
  - `changing to 90 dias refetches with days=90`.
  - `not connected shows the connect card`.
  - `share link uses sanitized url`.
  - `Sincronizar calls syncTikTokData and invalidates tt-* queries`.
- [ ] **Step 2: Run to fail.** `npx vitest run apps/crm/src/pages/analytics-conta/tiktok`. Expected: FAIL.
- [ ] **Step 3: Implement.** Copy comes from `useTranslation('analyticsTiktok')`.
- [ ] **Step 4: Run** the tests + crm `tsc`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(analytics): TikTok tab`.

### Task A9: TikTok tab (phone)

**Files:**
- Create: `apps/crm/src/pages/analytics-conta/tiktok/TikTokAnalyticsTabPhone.tsx`
- Modify: `TikTokAnalyticsTab.tsx` (render the phone variant below 768px, like `AnalyticsContent` does)
- Test: `apps/crm/src/pages/analytics-conta/tiktok/__tests__/TikTokAnalyticsTab.phone.test.tsx`

**Interfaces:**
- Consumes: the same queries as A8 (lift them into a `useTikTokTabData(clientId, range, sort)` hook in `tiktok/useTikTokTabData.ts` so both variants share them); phone pieces from `pages/analytics/phone/` (`PeriodSegmented`, `RankedPostStrip` if its props fit, `SectionHead`, `ValueTile`).
- Layout follows the mockup's phone artboard (https://claude.ai/artifact/9g36AxWzH5yaGa2h2y9Gpy): segmented period, 2-column KPI tiles, horizontal best-videos strip, follower chart, video list rows opening the share link.

- [ ] **Step 1: Failing tests:** `renders phone layout below 768px`; `period segmented switches range`; `video row links to sanitized share url`.
- [ ] **Step 2: Run to fail.** `npx vitest run apps/crm/src/pages/analytics-conta/tiktok`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(analytics): TikTok tab phone layout`.

### Task A10: TikTok overview page

**Files:**
- Create: `apps/crm/src/pages/analytics-tiktok/TikTokOverviewPage.tsx`, `apps/crm/src/pages/analytics-tiktok/phone/TikTokOverviewPhone.tsx`
- Modify: `apps/crm/src/App.tsx` (lazy import; replace the A7 placeholder)
- Test: `apps/crm/src/pages/analytics-tiktok/__tests__/TikTokOverviewPage.test.tsx`, `TikTokOverviewPage.phone.test.tsx`

**Interfaces:**
- Consumes: `getTikTokPortfolio(days)`, `getTikTokPortfolioAI(days)`; the portfolio AI section from `AnalyticsPage.tsx` (`AIPortfolioSection`) with a loader prop, like A8's `AISection`; `BenchmarkChart` if its props are plain data, else a TikTok copy.
- Produces: `export default function TikTokOverviewPage()`.
- Sections (spec §A5):
  - filters: client select, and period 7/28/90 (default 28);
  - KPI grid;
  - silent accounts line (no video in more than 7 days, from `last_posted_at`);
  - Melhores vídeos / Precisam de atenção, each with a "Ver todos" sheet (sort, client and date filters; no format filter);
  - Todas as contas table and card variant, rows linking to `/analytics/${client_id}/tiktok`;
  - engagement-per-view benchmark and Por especialidade;
  - AI;
  - empty state when `accounts.length === 0`.
- Route guard: without `feature_tiktok === true`, render the same "recurso indisponível" treatment `ProtectedRoute` gives a gated feature (reuse it; don't invent a new one).

- [ ] **Step 1: Failing tests:** `renders totals and account rows`; `row links to /analytics/:id/tiktok`; `empty state when no accounts`; `period change refetches with days=7`; `silent accounts listed`; `phone variant below 768px`.
- [ ] **Step 2: Run to fail.** `npx vitest run apps/crm/src/pages/analytics-tiktok`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(analytics): TikTok overview page`.

### Task A11: Part A verification and deploy runbook

- [ ] **Step 1: Gates.** Run, in order:
  - `npm run lint`;
  - `npm run format:check`;
  - `npx tsc -p apps/crm/tsconfig.json --noEmit`, `npx tsc -p apps/hub/tsconfig.json --noEmit`, `npx tsc -p apps/admin/tsconfig.json --noEmit`, `npx tsc -p tsconfig.scripts.json`;
  - `npm run test`;
  - `npm run check:functions`;
  - `npm run test:functions`.

  Expected: all green.
- [ ] **Step 2: Browser check.** Run `npm run dev:env`, sign in with the seed login, and check against a client with TikTok connected (DK TESTE client on prod data, read-only):
  - the TikTok nav item appears under the flag override;
  - `/analytics/tiktok` renders;
  - `/analytics/<id>` lands on the right tab;
  - all three tabs render;
  - the TikTok tab KPIs match the account;
  - the Relatórios tab lists existing docs;
  - the layout holds at 375px.

  Screenshot each. Note: until `tiktok-analytics` is deployed, the TikTok tab cannot load against prod, so either deploy to staging first or check with a patched fetch (memory: Hub repro via patched fetch).
- [ ] **Step 3: Deploy runbook (owner-confirmed, before merge).**
  1. `npx -y supabase@2.54.11 db push --linked` (staging, then prod) for `20261103000001`.
  2. `npx -y supabase@2.54.11 functions deploy tiktok-analytics --no-verify-jwt`.
  3. `functions deploy tiktok-integration --no-verify-jwt`.
  4. `functions deploy tiktok-sync-cron --no-verify-jwt`.
  5. Smoke: `GET /tiktok-analytics/overview/<id>` with a user token returns 200.
  6. Merge.
- [ ] **Step 4: Commit** any fixes; open PR 1.

---

# Part B — Multi-platform reports (PR 2)

### Task B1: Layout and snapshot types for TikTok blocks

**Files:**
- Modify: `supabase/functions/_shared/report-docs/layout.ts` (`BLOCK_TYPES`)
- Modify: `supabase/functions/_shared/report-docs/snapshot.ts` (types only)
- Modify: `packages/report-blocks/types.ts` (re-exports)
- Test: `supabase/functions/_shared/report-docs/layout.test.ts`

**Interfaces:**
- Produces:
  - New `BLOCK_TYPES` entries (after `image`): `"tiktok_kpi_followers_total","tiktok_kpi_followers_gained","tiktok_kpi_views","tiktok_kpi_engagement_rate","tiktok_kpi_likes","tiktok_kpi_comments","tiktok_kpi_shares","tiktok_kpi_posts_count","tiktok_kpi_likes_total","tiktok_chart_followers","tiktok_chart_best_times","tiktok_top_posts","tiktok_post_list"`.
  - `export const TIKTOK_BLOCK_PREFIX = "tiktok_"; export function blockPlatform(type: string): "instagram" | "tiktok" | null` (null = platform-neutral: cover, section_header, divider, text, ai_*, image).
  - In `snapshot.ts`:
    ```ts
    export interface TikTokSnapshotTopPost { video_id: string; views: number; likes: number; comments: number; shares: number; caption_preview: string; date: string | null; permalink: string | null; thumbnail_url: string | null }
    export interface TikTokReportSnapshot { account: { handle: string; display_name: string | null; avatar_url: string | null }; kpis: Record<TikTokKpiId, KpiEntry>; follower_trend: FollowerTrendPoint[]; best_times: BestTimeSlot[]; top_posts: TikTokSnapshotTopPost[] }
    // ReportDocSnapshot gains (both optional, version stays 1):
    instagram_connected?: boolean;   // absent = true (old snapshots)
    tiktok?: TikTokReportSnapshot | null;
    ```
  - `TikTokKpiId` is imported from `../tiktok-analytics/kpis.ts`.
- `validateLayout` needs no new rule beyond accepting the types. `top_posts`'s `count` bound applies to `tiktok_top_posts`/`tiktok_post_list` too (find where `TOP_POSTS_MIN/MAX` is checked and include the two new types).

- [ ] **Step 1: Failing tests:** `validateLayout accepts every tiktok_* type`; `tiktok_top_posts count out of bounds is rejected`; `blockPlatform('tiktok_kpi_views') === 'tiktok'`, `blockPlatform('kpi_views') === 'instagram'`, `blockPlatform('cover') === null`.
- [ ] **Step 2: Run to fail.** `deno test --no-check --allow-env --allow-read supabase/functions/_shared/report-docs/layout.test.ts`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** + `npm run check:functions` + crm `tsc`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(report-docs): TikTok block types and snapshot section`.

### Task B2: Snapshot loader, generate and refresh with TikTok

**Files:**
- Create: `supabase/migrations/20261103000002_report_documents_tiktok_account.sql`
- Create: `supabase/functions/report-docs/tiktok-section.ts`
- Modify: `supabase/functions/report-docs/snapshot-source.ts`, `generate.ts`, `refresh.ts`, `client-id.ts` (`parseGenerateBody`), `index.ts`
- Modify: `supabase/functions/_shared/report-docs/snapshot.ts` (an `emptyInstagramSection` helper)
- Test: `supabase/functions/report-docs/generate.test.ts`, `refresh.test.ts`, `client-id.test.ts`, new `tiktok-section.test.ts`

**Interfaces:**
- Migration: `ALTER TABLE report_documents ADD COLUMN tiktok_account_id uuid REFERENCES tiktok_accounts(id) ON DELETE SET NULL;`. No grant change, since `authenticated` UPDATE stays `(layout, title)`.
- Produces:
  ```ts
  // tiktok-section.ts
  export async function loadTikTokReportSection(db, clientId: number, month: string, now: Date): Promise<{ section: TikTokReportSnapshot; accountId: string } | null>
  // null when no tiktok_accounts row or status disconnected/revoked
  // snapshot-source.ts — signature changes:
  export async function loadClientSnapshot(db, deps, contaId, cliente, month, opts: { tiktokEnabled: boolean }): Promise<{ snapshot: ReportDocSnapshot; igAccountId: string | null; tiktokAccountId: string | null }>
  // throws GenerateError("not_found", "Nenhuma rede conectada") only when both are absent
  // client-id.ts
  parseGenerateBody(raw) -> { clientId; month; templateId; platforms: ('instagram'|'tiktok')[] | null } | null   // invalid entries or empty array -> null (400)
  ```
- Section contents:
  - KPIs: `computeTikTokKpis` over `monthWindow(month)` (videos by SP `posted_at`, follower history clipped to the month). `windowEndsToday` is true when the effective end is SP today. `likesTotal` = the last `tiktok_account_metrics_daily.likes_count` on or before the effective end, or `account.likes_count` when the month includes today.
  - `follower_trend`: the month's history as `{date, count}`.
  - `best_times`: `bestTimesFromPosts(last 90 days before effective end, tiktokRate)` mapped to `BestTimeSlot` the way the Instagram loader maps its payload. Look at how snapshot-source maps `best_times` and reuse that mapper.
  - `top_posts`: the 12 with the most views in the month.
  - `caption_preview`: `title || video_description`, truncated the way the Instagram snapshot truncates captions.
  - `thumbnail_url` = `cover_image_url` (already re-hosted).
- Instagram absent: the loader returns `assembleSnapshot` over empty inputs with `instagram_connected: false`. Every Instagram KPI value is null and every array is empty, so the existing blocks hide or placeholder.
- `generate.ts`:
  - `feature_tiktok` is checked via `effectivePlanFeature` once and passed as `tiktokEnabled`.
  - `platforms` is validated against what is connected; a requested platform that isn't connected → `GenerateError("invalid_platforms")` → 400.
  - The row is inserted with `instagram_account_id: igAccountId` and `tiktok_account_id: tiktokAccountId`.
  - The selected platforms go to the layout step (Task B3).
- `refresh.ts` reloads both (respecting `tiktokEnabled`) and writes `tiktok_account_id` too.
- `index.ts` passes the parsed `platforms` through and maps `invalid_platforms` to 400 `{error:"invalid_platforms"}`.

- [ ] **Step 1: Failing tests.**
  - `generate with only TikTok connected succeeds and sets instagram_connected false`.
  - `generate with neither connected → not_found`.
  - `generate without feature_tiktok leaves snapshot.tiktok null even when connected`.
  - `platforms ['tiktok'] for a client without TikTok → invalid_platforms`.
  - `parseGenerateBody rejects platforms ['x'] and []`.
  - `parseGenerateBody without platforms → null (all connected)`.
  - `refresh reloads tiktok section`.
  - `tiktok-section top_posts sorted by views, max 12`.
  - `tiktok-section uses SP month boundaries` (a video at `2026-10-01T02:00Z` belongs to September).
- [ ] **Step 2: Run to fail.** `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net supabase/functions/report-docs/`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** + `npm run check:functions`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(report-docs): load TikTok section and allow TikTok-only reports`.

### Task B3: Default layout per platform, template filtering, AI input

**Files:**
- Modify: `supabase/functions/_shared/report-docs/default-layout.ts`
- Create: `supabase/functions/_shared/report-docs/platform-filter.ts`
- Modify: `supabase/functions/report-docs/generate.ts`
- Modify: `supabase/functions/_shared/report-docs/ai-input.ts`, `supabase/functions/_shared/report-template/ai.ts`, `.../report-template/types.ts` (optional `tiktok` field)
- Test: `default-layout.test.ts`, new `platform-filter.test.ts`, `ai-input.test.ts`, and a `_shared/report-template` AI prompt test (find the existing one)

**Interfaces:**
- `DefaultLayoutOpts` gains `platforms: ('instagram'|'tiktok')[]`.
  - With `instagram`: today's blocks, unchanged order.
  - With `tiktok`: append `section_header {title:"TikTok"}`, then `tiktok_kpi_followers_gained`, `tiktok_kpi_followers_total` and `tiktok_kpi_engagement_rate` (third), then `tiktok_kpi_views`, `tiktok_kpi_likes` and `tiktok_kpi_posts_count` (third), then `tiktok_chart_followers` (full), `tiktok_top_posts {count:6}` (full), and `tiktok_chart_best_times` (full) when `hasTikTokBestTimes`.
  - The TikTok section goes before "Próximos passos".
  - TikTok only: `cover`, `ai_summary`, the TikTok section, then "Próximos passos".
- `export function dropUnselectedPlatformBlocks(layout: ReportLayout, platforms: ('instagram'|'tiktok')[]): ReportLayout` removes blocks whose `blockPlatform` is not selected (neutral blocks stay). It is applied to workspace templates in `generate.ts`.
- `snapshotToReportData` adds `tiktok?: { handle; kpis: Record<TikTokKpiId, number|null>; top_videos: {caption, views, likes, shares}[] }` when `snapshot.tiktok` is present, and marks Instagram absent when `instagram_connected === false`.
- `generateAINarrative`'s prompt gets a TikTok block only when `tiktok` is present, and drops the Instagram block when Instagram is absent. Legacy callers (no `tiktok` field, Instagram present) must produce a byte-identical prompt.

- [ ] **Step 1: Failing tests:**
  - `default layout instagram only is unchanged` (snapshot the current block type list).
  - `default layout both appends TikTok section before Próximos passos`.
  - `default layout tiktok only has no Instagram data blocks`.
  - `dropUnselectedPlatformBlocks keeps neutral blocks`.
  - `legacy prompt is byte-identical without tiktok`.
  - `prompt includes TikTok block when present`.
  - `prompt omits Instagram block when instagram_connected false`.
- [ ] **Step 2: Run to fail.** `deno test --no-check --allow-env --allow-read supabase/functions/_shared/report-docs/ supabase/functions/_shared/report-template/`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(report-docs): platform-aware default layout and AI narrative`.

### Task B4: Renderer, data presence, catalog, fixtures

**Files:**
- Create: `packages/report-blocks/platform.ts`
- Modify: `packages/report-blocks/BlockRenderer.tsx` (`BlockProps` gains `platform?`; register `tiktok_*`)
- Modify: `packages/report-blocks/blocks/KpiCardBlock.tsx`, `TopPostsBlock.tsx`, `PostListBlock.tsx`, `CoverBlock.tsx`
- Modify: `packages/report-blocks/data-presence.ts`, `catalog.ts`, `fixtures.ts`
- Modify: `apps/crm/src/pages/relatorio-editor/widgetIcons.ts` (icons for the new types)
- Test: `packages/report-blocks/__tests__/kpi-and-charts.test.tsx`, `BlockRenderer.test.tsx`, `CoverBlock.test.tsx`, `catalog.test.ts`, new `platform.test.ts`

**Interfaces:**
- Produces (`platform.ts`):
  ```ts
  /** For a tiktok_* block: the equivalent Instagram block type and a ReportDocSnapshot-shaped view built from snapshot.tiktok. null when the snapshot has no TikTok section. */
  export function tiktokBlockView(block: ReportBlock, snapshot: ReportDocSnapshot): { block: ReportBlock; snapshot: ReportDocSnapshot } | null
  export const TIKTOK_KPI_LABELS_PT: Record<TikTokKpiId, string>  // Seguidores totais, Novos seguidores, Visualizações, Engajamento por visualização, Curtidas, Comentários, Compartilhamentos, Vídeos publicados, Curtidas totais do perfil
  export const TIKTOK_KPI_TOOLTIPS_PT: Partial<Record<TikTokKpiId, string>> // views: "Total atual dos vídeos publicados no mês, não as visualizações recebidas no mês."
  ```
  The view maps `top_posts` to `SnapshotTopPost` with `type: 'reel'`, `reach: 0` and `saves: 0` (components get `platform="tiktok"` and must not show reach/saves). The view's `kpis` is cast from the TikTok record with a comment; `KpiCardBlock` looks the id up in the TikTok tables when `platform === 'tiktok'`.
- `BLOCK_COMPONENTS` gains each `tiktok_*` type mapped to a wrapper: `const v = tiktokBlockView(block, snapshot); return v ? <Base block={v.block} snapshot={v.snapshot} platform="tiktok" /> : null;`. Base is the matching Instagram component. `EditorCanvas` picks it up through the same map.
- Component changes under `platform="tiktok"`:
  - `TopPostsBlock`: label "Vídeo"; the metrics line is `Vis. · ♥ · Com. · Comp.` (shares, not saves).
  - `PostListBlock`: views.
  - `KpiCardBlock`: TikTok label/tooltip tables.
- `CoverBlock`:
  - The default kicker is derived from the layout's platforms: "Relatório mensal · Instagram", "Relatório mensal · TikTok" or "Relatório mensal · Instagram e TikTok". `BlockProps` gains an optional `layoutPlatforms?: ('instagram'|'tiktok')[]` that `BlockRenderer`/`EditorCanvas` compute once with `blockPlatform`. Absent or empty = today's Instagram kicker.
  - The handle comes from the first platform in the layout, falling back to Instagram's `account.handle`.
  - An explicit `config.kicker` still wins.
- `blockHasData`: a `tiktok_*` type → false when `!snapshot.tiktok`, else the same check as the base type against the view.
- `WidgetCatalogEntry` gains `platform: 'instagram' | 'tiktok' | null`, set on every entry (Instagram data entries `'instagram'`, neutral `null`). New TikTok entries use labels from `TIKTOK_KPI_LABELS_PT` plus "Crescimento de seguidores", "Melhor horário para postar", "Vídeos em destaque" and "Lista de vídeos".
- `makeSnapshotFixture` gains a `tiktok` section: handle `seucliente`, `https://www.tiktok.com/@seucliente/video/…` permalinks, plausible counts, every KPI non-null.

- [ ] **Step 1: Failing tests:**
  - `tiktok_kpi_views renders TikTok label and tooltip from snapshot.tiktok`.
  - `tiktok_kpi_views renders nothing when snapshot.tiktok is absent`.
  - `kpi_views still reads the Instagram root`.
  - `tiktok_top_posts shows Comp. not Salv.`.
  - `unknown type 'tiktok_future' renders nothing` (old-bundle safety pin).
  - `blockHasData false for tiktok_* without tiktok section`.
  - `Instagram blocks with instagram_connected false and empty data → blockHasData false`.
  - `cover kicker 'Instagram e TikTok' when layout mixes`.
  - `catalog: every BLOCK_TYPES entry except cover-only/neutral has a platform; tiktok entries platform 'tiktok'`.
  - `fixture tiktok kpis all non-null`.
- [ ] **Step 2: Run to fail.** `npx vitest run packages/report-blocks`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** + crm and hub `tsc` (the Hub renders this package). Expected: PASS.
- [ ] **Step 5: Commit** `feat(report-blocks): render TikTok blocks from snapshot.tiktok`.

### Task B5: Editor: platform switch, badges, back links

**Files:**
- Modify: `apps/crm/src/pages/relatorio-editor/AddWidgetDrawer.tsx`, `LayersPanel.tsx`, `EditorCanvas.tsx` (badge), `RelatorioEditorPage.tsx`, `ModeloEditorPage.tsx`
- Test: `apps/crm/src/pages/relatorio-editor/__tests__/AddWidgetDrawer.test.tsx` (create or extend), `LayersPanel.test.tsx`

**Interfaces:**
- `AddWidgetDrawer` gains a prop `platforms: ('instagram'|'tiktok')[]`.
  - Document editor: Instagram when `snapshot.instagram_connected !== false`, TikTok when `snapshot.tiktok` is present.
  - Template editor: both.
  - With two platforms, a segmented control "Instagram | TikTok" (radiogroup) appears at the top and filters entries with `platform === selected || platform === null`. With one, there is no control and that platform's entries show.
  - Neutral categories (Texto, Mídia, Estrutura) are always listed.
- Layers rows and the canvas block chrome show a small "TikTok" badge for `blockPlatform === 'tiktok'`. No badge for Instagram, to keep today's look.
- The back link was changed in A7. Confirm the editor's `fallbackTo` uses `/analytics/${doc.client_id}/relatorios`.

- [ ] **Step 1: Failing tests:** `both platforms: switch shows TikTok entries only after selecting TikTok`; `Instagram-only doc: no switch, no tiktok entries`; `TikTok-only doc: no switch, tiktok entries and neutral ones`; `layers row shows TikTok badge`.
- [ ] **Step 2: Run to fail.** `npx vitest run apps/crm/src/pages/relatorio-editor`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(report-editor): platform switch and TikTok badges`.

### Task B6: Relatórios tab: Plataformas choice and badges

**Files:**
- Modify: `apps/crm/src/pages/analytics-conta/reports/NewReportDialog.tsx`, `ClientReportsPanel.tsx`
- Modify: `apps/crm/src/services/reportDocs.ts` (`generateReportDoc` gains `platforms?`; `listReportDocs` selects `layout` to derive platforms)
- Test: `apps/crm/src/pages/analytics-conta/reports/__tests__/NewReportDialog.test.tsx`, `ClientReportsPanel.test.tsx`

**Interfaces:**
- `generateReportDoc(clientId: number, month: string, templateId: string | null, platforms?: ('instagram'|'tiktok')[])` sends `platforms` only when provided.
- `ReportDocListItem` gains `platforms: ('instagram'|'tiktok')[]`, derived client-side from `layout.blocks` via `blockPlatform` (import from `@mesaas/report-blocks`).
- The dialog shows one checkbox per connected platform (`NewReportDialog` gets `connected: ('instagram'|'tiktok')[]` from the shell's summaries).
  - All are checked by default, and Gerar is disabled when none is checked.
  - With a single connected platform the fieldset is hidden and that platform is sent.
  - The helper text under Modelo is exactly: "No padrão do sistema, cada plataforma marcada ganha sua seção. Num modelo seu, os blocos do modelo valem."
- Each list row shows neutral badges "Instagram" / "TikTok" per derived platform.

- [ ] **Step 1: Failing tests:** `both connected: two checkboxes checked; unchecking TikTok sends platforms ['instagram']`; `none checked disables Gerar`; `single platform hides the fieldset`; `list row shows TikTok badge for a doc with tiktok_* blocks`.
- [ ] **Step 2: Run to fail.** `npx vitest run apps/crm/src/pages/analytics-conta/reports`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(reports): choose platforms when generating`.

### Task B7: Part B verification and deploy runbook

- [ ] **Step 1: Gates.** Same list as A11 Step 1. Expected: all green.
- [ ] **Step 2: Browser check.** Generate a report for a client with both platforms:
  - the default layout has the TikTok section;
  - the editor switch filters blocks;
  - adding `tiktok_kpi_likes` shows data;
  - "Ver como cliente" in the Hub renders TikTok blocks;
  - the PDF export prints them;
  - a TikTok-only client generates;
  - an Instagram-only template applied with TikTok unchecked has no TikTok blocks.

  Screenshot each, desktop and 375px.
- [ ] **Step 3: Deploy runbook (owner-confirmed, before merge).**
  1. `db push` `20261103000002` (staging, then prod).
  2. `functions deploy report-docs`, with the same `verify_jwt` setting it has today (check `supabase/config.toml`; deploy accordingly).
  3. Smoke: generate on staging.
  4. Merge (Vercel builds CRM + Hub together).
- [ ] **Step 4: Commit** fixes; open PR 2.
