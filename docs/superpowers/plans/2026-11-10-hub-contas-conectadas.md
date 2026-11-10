# Hub: contas conectadas (Instagram + TikTok) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the client, in the Hub, a card per connected account (Instagram, TikTok) with status, followers and sync age, and make "Desempenho" work per platform.

**Architecture:** `hub-dashboard` stays the only endpoint: it gains an `accounts` summary on every response, a `platform` parameter and a `tiktok` detail block, all additive. The Hub renders a new "Contas conectadas" strip from the same query the Desempenho section already makes. `tiktok-sync-cron` moves to the hourly, batch-limited, attempt-tracked model of `instagram-sync-cron`.

**Tech Stack:** Deno edge functions (Supabase), Postgres + pg_cron, React 19 + TanStack Query + Tailwind (Hub), chart.js, i18next, Vitest, `deno test`.

**Spec:** `docs/superpowers/specs/2026-11-10-hub-contas-conectadas-design.md` (read it first; this plan argues from it). Mockups: https://claude.ai/artifact/8GQVPWQS3tnMgYYCV5XvVU. Where the mockup and the spec disagree, the spec wins (the "Não conectada" card and the "quando o TikTok foi conectado" caption were dropped).

## Global Constraints

- All UI copy exists in pt and en, in `packages/i18n/locales/{pt,en}/hubHome.json`, and is used through `t()` with the pt text as fallback. No em dashes in copy. `packages/i18n/__tests__/locales.test.ts` fails on a key missing in either language.
- Hub UI uses only `hub-*` tokens and classes (`hub-card`, `hub-pill`, `hub-pill-neutral`, `hub-pill-danger`, `hub-txt`, `hub-tx2`, `hub-tx3`, `hub-bg-soft`, `hub-btn-primary`). Tailwind variants do not work on `hub-*` classes. No platform brand colours; charts stay monochrome (`chartInk`). One exception: the positive follower change keeps the `text-emerald-*` green the Hub already uses for engagement in `TopPostsRow`.
- Icons: `lucide-react` only. Instagram = `Instagram`, TikTok = `Music2`.
- No "live" or pulsing indicator anywhere.
- Edge functions: never select encrypted token columns for TikTok (use `TIKTOK_ACCOUNT_COLUMNS`); CORS only through `buildCorsHeaders(req)`; generic error messages to the client.
- External links go through `sanitizeExternalUrl` (`apps/hub/src/lib/security.ts`).
- chart.js stays inside the lazy `DashboardCharts` chunk. Nothing the strip imports may import chart.js.
- Never use `useBlocker`.
- Migration filename needs a unique version prefix above main's tail. `20261126000001` is free today; re-check against `origin/main` before opening the PR and renumber if taken.
- Format only the files you touched (`npx prettier --write <paths>`), never the whole repo.
- Run every command from the worktree root. Deno single-file runs: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys <file>`.

## Review Focus

Inputs the spec implies but does not spell out. Each has a test in the task named.

1. **Null numbers from a half-synced account** (`follower_count`, `reach_28d`, `likes_count` null): the card shows "—" for that figure, never "null", "NaN" or "0". (Task 5)
2. **TikTok video with no cover, no `share_url` or no duration:** a placeholder tile, no duration tag, and a non-link card (no `href=""`). (Task 6)
3. **Clock skew or a `last_synced_at` slightly in the future:** "Atualizado há 1 min", never a negative or "há 0 min". (Task 4)
4. **Follower history that is unsorted, has one point, or shrinks:** sorted before use; one point gives no change; a loss renders with a minus sign in neutral colour. (Tasks 2 and 5)
5. **Very long `@username` or a null one:** truncates on one line without pushing the status pill out of the card; null shows the platform name alone. (Task 5)

---

### Task 1: TikTok sync on the hourly model

**Files:**
- Create: `supabase/migrations/20261126000001_tiktok_sync_hourly.sql`
- Modify: `supabase/functions/tiktok-sync-cron/core.ts`, `supabase/functions/tiktok-sync-cron/index.ts`
- Test: `supabase/functions/__tests__/tiktok-sync-cron_test.ts`

**Interfaces:**
- Consumes: `collectSyncCandidates`, `selectAccountsToSync`, `contaIdOf` from `../instagram-sync-cron/select.ts` (unchanged); `runPool` (already imported).
- Produces: `TikTokSyncCronDeps.batchLimit?: number` (default 25). Response body gains `deferred: number`. Nothing else depends on this task.

- [ ] **Step 1: Write the migration**

Two statements, both idempotent:
1. `ALTER TABLE public.tiktok_accounts ADD COLUMN IF NOT EXISTS last_sync_attempt_at timestamptz;` plus a `COMMENT ON COLUMN` saying it is stamped for the whole batch before any sync work and doubles as the claim.
2. The unschedule-if-exists `DO` block and `cron.schedule('tiktok-sync-cron', '30 * * * *', …)` copied from `20260720000007_tiktok_sync_cron_schedule.sql`, with the same `vault.decrypted_secrets` subselect form. Only the schedule string changes.

- [ ] **Step 2: Write the failing tests**

In `tiktok-sync-cron_test.ts`, add a helper `queueClaim(db, ids: string[])` that queues `db.queue("tiktok_accounts", "update", { data: ids.map((id) => ({ id })), error: null })`, and call it in every existing test that expects accounts to be processed (the claim is the first `update` on that table, before the per-account stats update). Then add:

```ts
Deno.test("tiktok-sync-cron: eligibility requires a stale success AND a stale attempt", async () => {
  // run with zero accounts; inspect the tiktok_accounts select call's modifiers
  // expect two `or` modifiers: one on last_synced_at, one on last_sync_attempt_at, both with the 6h cutoff
  // expect order('last_sync_attempt_at', { ascending: true, nullsFirst: true }) then order('id', { ascending: true })
});

Deno.test("tiktok-sync-cron: batch limit applies after the workspace filters, least recently attempted first", async () => {
  // 4 candidates: A (ws without feature_tiktok, attempt null), B (attempt 9h ago), C (attempt 7h ago), D (attempt 8h ago); batchLimit: 2
  // claim is called with ids [B, D] exactly; response.deferred === 1; A is never claimed
});

Deno.test("tiktok-sync-cron: only accounts returned by the claim are synced", async () => {
  // 2 eligible accounts; claim update returns only the first id
  // getFreshTikTokToken called once, for that id; response.synced === 1
});

Deno.test("tiktok-sync-cron: the claim stamps last_sync_attempt_at before any TikTok call", async () => {
  // record call order: the tiktok_accounts update with { last_sync_attempt_at } precedes the first getFreshTikTokToken
});

Deno.test("tiktok-sync-cron: a failed claim is reported and syncs nothing", async () => {
  // claim update returns { error: { message: "boom" } } -> 500, reportCronFailure called once, getFreshTikTokToken never
});
```

The existing test "selects active + auto_sync_enabled accounts not synced in the last 6h" keeps its assertions and gains the attempt gate.

- [ ] **Step 3: Run them to see them fail**

Run: `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/tiktok-sync-cron_test.ts`
Expected: the five new tests FAIL; older tests that process accounts fail until Step 4 lands (the claim returns nothing yet).

- [ ] **Step 4: Implement in `core.ts`**

Replace the single account query and the inline feature filter in `runTikTokSyncCron` with:
- `collectSyncCandidates({ fetchPage, resolveAllowedWorkspaces, internalWorkspaces }, { pageSize: 200, maxPages: 10, targetEligible: batchLimit })`. `fetchPage` is today's query plus `last_sync_attempt_at` in the select, the second `.or('last_sync_attempt_at.is.null,last_sync_attempt_at.lt.<sixHoursAgoIso>')`, the two `.order(...)` calls from the test, and `.range(from, from + size - 1)`. `resolveAllowedWorkspaces` returns the workspaces that have **both** `feature_auto_sync_cron` and `feature_tiktok`.
- `selectAccountsToSync(candidates, { allowedWorkspaces, internalWorkspaces, limit: batchLimit })`.
- The claim: `svc.from("tiktok_accounts").update({ last_sync_attempt_at: now.toISOString() }).in("id", selectedIds).or('last_sync_attempt_at.is.null,last_sync_attempt_at.lt.<sixHoursAgoIso>').select("id")`. An error throws (the outer catch reports it and answers 500). Only the returned ids go to `runPool`.
- Response: `{ success, synced, failed, total, deferred }` where `total` is the claimed count.

`batchLimit = Math.max(1, deps.batchLimit ?? 25)`. The webhook purge and the per-account `processAccount` are untouched. Update the file's header comment: hourly schedule, attempt gate, claim, shared dials.

- [ ] **Step 5: Wire the dial in `index.ts`**

Pass `batchLimit: Math.max(1, parseInt(Deno.env.get("SYNC_BATCH_LIMIT") || "25", 10) || 25)`.

- [ ] **Step 6: Run the suite and the type gate**

Run: the Step 3 command, then `npm run check:functions`
Expected: all tests PASS; `deno check` clean.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20261126000001_tiktok_sync_hourly.sql supabase/functions/tiktok-sync-cron supabase/functions/__tests__/tiktok-sync-cron_test.ts
git commit -m "feat(tiktok): sync de hora em hora com limite de lote e claim por tentativa"
```

---

### Task 2: `hub-dashboard` account summary

**Files:**
- Create: `supabase/functions/hub-dashboard/accounts.ts`
- Modify: `supabase/functions/hub-dashboard/handler.ts`, `supabase/functions/hub-dashboard/index.ts`
- Test: `supabase/functions/__tests__/hub-dashboard-accounts_test.ts` (new, pure functions), `supabase/functions/__tests__/hub-dashboard_test.ts`

**Interfaces:**
- Consumes: `loadTikTokAccount`, `loadVideosInWindow`, `loadFollowerHistory` (`_shared/tiktok-analytics/queries.ts`); `windowFromDays`, `spDayStartIso` (`_shared/tiktok-analytics/window.ts`); `effectivePlanFeature` (`_shared/entitlements-rpc.ts`).
- Produces, in `accounts.ts`:

```ts
export type AccountState = "connected" | "needs_reconnect";
export interface FollowerPoint { date: string; follower_count: number }
export interface FollowersDelta { value: number; since: string; fullWindow: boolean }
export interface HubAccountSummary {
  platform: "instagram" | "tiktok";
  state: AccountState;
  username: string | null;
  followerCount: number | null;
  followersDelta: FollowersDelta | null;
  lastSyncedAt: string | null;
  instagram?: { reach28d: number | null; impressions28d: number | null; mediaCount: number | null };
  tiktok?: { views30d: number; likesTotal: number | null; videoCount: number | null };
}
/** null = the account gets no card. Order of tests: disconnected, then reconnect, then connected. */
export function instagramState(row: { authorization_status?: string | null; token_expires_at?: string | null }, nowIso: string): AccountState | null;
export function tiktokState(row: { authorization_status?: string | null }): AccountState | null;
/** Last minus first observed point with date >= windowStart and >= minDate. null with fewer than two. */
export function followersDelta(points: FollowerPoint[], windowStart: string, minDate?: string | null): FollowersDelta | null;
```

- Produces, in the handler: dep `effectivePlanFeature: (db: DbClient, workspaceId: string, key: string) => Promise<boolean>` (required), and the response keys `accounts: HubAccountSummary[]` and `platform` (Task 3 completes `platform`; in this task it is always `"instagram"`).

- [ ] **Step 1: Write the failing pure-function tests** (`hub-dashboard-accounts_test.ts`)

```ts
const NOW = "2026-11-10T12:00:00.000Z";
Deno.test("instagramState: disconnected wins over an expired token (epoch 0)", () => {
  assertEquals(instagramState({ authorization_status: "disconnected", token_expires_at: "1970-01-01T00:00:00.000Z" }, NOW), null);
});
Deno.test("instagramState: revoked and expired need reconnection", () => {
  assertEquals(instagramState({ authorization_status: "revoked", token_expires_at: null }, NOW), "needs_reconnect");
  assertEquals(instagramState({ authorization_status: "expired", token_expires_at: null }, NOW), "needs_reconnect");
});
Deno.test("instagramState: active with a past token needs reconnection; null or future token is connected", () => {
  assertEquals(instagramState({ authorization_status: "active", token_expires_at: "2026-11-09T00:00:00.000Z" }, NOW), "needs_reconnect");
  assertEquals(instagramState({ authorization_status: "active", token_expires_at: null }, NOW), "connected");
  assertEquals(instagramState({ authorization_status: "active", token_expires_at: "2026-12-01T00:00:00.000Z" }, NOW), "connected");
});
Deno.test("tiktokState: active, revoked/expired, disconnected", () => {
  assertEquals(tiktokState({ authorization_status: "active" }), "connected");
  assertEquals(tiktokState({ authorization_status: "expired" }), "needs_reconnect");
  assertEquals(tiktokState({ authorization_status: "revoked" }), "needs_reconnect");
  assertEquals(tiktokState({ authorization_status: "disconnected" }), null);
});
Deno.test("followersDelta: full window", () => {
  const d = followersDelta([{ date: "2026-10-12", follower_count: 12168 }, { date: "2026-11-10", follower_count: 12480 }], "2026-10-11");
  assertEquals(d, { value: 312, since: "2026-10-12", fullWindow: true });
});
Deno.test("followersDelta: history starts later", () => {
  const d = followersDelta([{ date: "2026-10-30", follower_count: 3822 }, { date: "2026-11-09", follower_count: 3906 }], "2026-10-12");
  assertEquals(d, { value: 84, since: "2026-10-30", fullWindow: false });
});
Deno.test("followersDelta: unsorted input, a loss, one point, points before minDate", () => {
  assertEquals(followersDelta([{ date: "2026-11-09", follower_count: 90 }, { date: "2026-10-12", follower_count: 100 }], "2026-10-11")?.value, -10);
  assertEquals(followersDelta([{ date: "2026-11-09", follower_count: 90 }], "2026-10-11"), null);
  // connected 2026-11-01: the two earlier points are reconstructed and must not count
  const d = followersDelta(
    [{ date: "2026-10-15", follower_count: 10 }, { date: "2026-10-20", follower_count: 50 }, { date: "2026-11-01", follower_count: 100 }, { date: "2026-11-10", follower_count: 105 }],
    "2026-10-11", "2026-11-01");
  assertEquals(d, { value: 5, since: "2026-11-01", fullWindow: false });
});
```

`fullWindow` is true when `since` is at most one day after `windowStart`.

- [ ] **Step 2: Write the failing handler tests** (`hub-dashboard_test.ts`)

First update `makeHandler` to take an optional `feature` argument (`(db, feature: (key: string) => Promise<boolean> = async () => false)`) and add `authorization_status: "active"`, `token_expires_at: null`, `username: "clinica"`, `created_at: "2025-01-01T00:00:00.000Z"` to the Instagram account fixtures of the existing tests. Then add:

- `"hub-dashboard: accounts lists a connected Instagram account with its 30-day change"`: asserts `body.accounts` equals one entry with `platform: "instagram"`, `state: "connected"`, `username: "clinica"`, `followerCount`, `lastSyncedAt`, the `instagram` block, and `followersDelta` computed from the queued history; `body.platform === "instagram"`.
- `"hub-dashboard: a disconnected Instagram row answers like no account"`: `account === null`, `accounts` is `[]`, no `instagram_posts` query was made.
- `"hub-dashboard: an Instagram account that needs reconnection keeps its detail and skips the Graph call"`: status `expired`, an encrypted token present; `accounts[0].state === "needs_reconnect"`, `topPosts` present, the `fetch` stub was never called.
- `"hub-dashboard: Instagram change ignores history before the connection date"`: `created_at` inside the window; the delta uses only later points and `fullWindow` is false.
- `"hub-dashboard: TikTok account appears when the workspace has feature_tiktok"`: queues `tiktok_accounts`, `tiktok_posts` (two videos in the last 30 days, 1200 and 800 views) and `tiktok_follower_history`; asserts the `tiktok` summary entry with `views30d: 2000`, `likesTotal`, `videoCount`, and that it comes after Instagram.
- `"hub-dashboard: TikTok is hidden without feature_tiktok and when the entitlement lookup throws"`: two runs; `accounts` has no TikTok entry and no `tiktok_posts` query was made.
- `"hub-dashboard: a disconnected TikTok row is not shown and costs no entitlement lookup"`.
- `"hub-dashboard: the TikTok account select never names a token column"`: the `tiktok_accounts` select args contain neither `encrypted_access_token` nor `encrypted_refresh_token`.
- `"hub-dashboard: accounts is an empty array when nothing is connected"`.

- [ ] **Step 3: Run both files to see the new tests fail**

Run the Deno single-file command on each.
Expected: new tests FAIL (`accounts` undefined; `accounts.ts` missing).

- [ ] **Step 4: Implement `accounts.ts`**

The three pure functions above, plus the two loaders the handler calls:

```ts
export function instagramSummary(row: InstagramAccountRow, history: FollowerPoint[], nowIso: string): HubAccountSummary | null;
export async function loadTikTokSummary(
  db: Db, clienteId: number, contaId: string, now: Date,
  feature: (key: string) => Promise<boolean>,
): Promise<{ summary: HubAccountSummary; account: TikTokAccountRow } | null>;
```

`instagramSummary`: window start is the UTC date 30 days before `nowIso`; `minDate` is the UTC date of `row.created_at`. `loadTikTokSummary`: `loadTikTokAccount` first; return null without calling `feature` when there is no row or `tiktokState` is null; then `feature("feature_tiktok")` inside try/catch (a throw reads as false); then `windowFromDays(30, now)`, `loadVideosInWindow` and `loadFollowerHistory` for that window; `views30d` is the sum of `views`.

- [ ] **Step 5: Wire the handler**

- Add `username, authorization_status, token_expires_at, created_at` to the `instagram_accounts` select.
- Compute `instagramState` right after the select. `null` takes the existing "no account" early path, but that path now also builds `accounts` (TikTok can still have a card).
- The existing follower-history query already covers 30 days (`period` is 30, 60 or 90): feed its rows to `instagramSummary`, no second query.
- Skip the Graph thumbnail call when the state is `needs_reconnect`.
- Add `accounts` (Instagram first, then TikTok) and `platform: "instagram"` to both return paths.
- `index.ts`: pass `effectivePlanFeature` from `../_shared/entitlements-rpc.ts`.

- [ ] **Step 6: Run both test files and the type gate**

Expected: all PASS; `npm run check:functions` clean.

- [ ] **Step 7: Commit**

```bash
git add supabase/functions/hub-dashboard supabase/functions/__tests__/hub-dashboard_test.ts supabase/functions/__tests__/hub-dashboard-accounts_test.ts
git commit -m "feat(hub-dashboard): resumo das contas conectadas com estado e variação de seguidores"
```

---

### Task 3: `hub-dashboard` platform parameter and TikTok detail

**Files:**
- Create: `supabase/functions/hub-dashboard/tiktok-detail.ts`
- Modify: `supabase/functions/hub-dashboard/handler.ts`
- Test: `supabase/functions/__tests__/hub-dashboard-accounts_test.ts`, `supabase/functions/__tests__/hub-dashboard_test.ts`

**Interfaces:**
- Consumes: Task 2's `loadTikTokSummary` result (`account` row) and `accounts` list; `TikTokVideoDetailRow`, `FollowerHistoryRow` from `_shared/tiktok-analytics/queries.ts`; `videoEngagementRate` from `_shared/tiktok-analytics/kpis.ts`; `saoPauloDate` from `_shared/sao-paulo-date.ts`.
- Produces:

```ts
export interface DashboardTopVideo {
  id: string; coverUrl: string | null; shareUrl: string | null; postedAt: string | null;
  durationSeconds: number | null; views: number; likes: number; comments: number; shares: number;
  engagementRate: number | null; // one decimal
}
export function topVideos(videos: TikTokVideoDetailRow[]): DashboardTopVideo[]; // views > 0, most viewed first, ties newest first, max 5
export function viewsHistory(videos: TikTokVideoDetailRow[]): { date: string; views: number }[]; // by São Paulo posting day, ascending
export function resolvePlatform(requested: string | null, accounts: { platform: "instagram" | "tiktok" }[]): "instagram" | "tiktok";
```

Response: `platform` is the resolved platform; `tiktok?: { topVideos, followerHistory: { date, followerCount }[], viewsHistory }` only when the resolved platform is `tiktok` and TikTok has a card.

- [ ] **Step 1: Write the failing tests**

Pure (`hub-dashboard-accounts_test.ts`):

```ts
Deno.test("resolvePlatform: explicit value wins; missing or unknown takes the first card; none means instagram", () => {
  assertEquals(resolvePlatform("tiktok", [{ platform: "instagram" }]), "tiktok");
  assertEquals(resolvePlatform(null, [{ platform: "tiktok" }]), "tiktok");
  assertEquals(resolvePlatform("youtube", [{ platform: "instagram" }, { platform: "tiktok" }]), "instagram");
  assertEquals(resolvePlatform(null, []), "instagram");
});
Deno.test("topVideos: ranks by views, drops zero-view videos, caps at five, rounds engagement to one decimal", () => { /* 7 rows in, 5 out; (likes 40 + comments 6 + shares 4) / views 676 -> 7.4 */ });
Deno.test("topVideos: ties go to the newest; null cover, share_url and duration pass through as null", () => {});
Deno.test("viewsHistory: sums per São Paulo day", () => {
  // 2026-11-10T01:30:00Z is 2026-11-09 in São Paulo: it must land on the 9th
});
```

Handler (`hub-dashboard_test.ts`):
- `"hub-dashboard: platform=tiktok returns the tiktok block and empty Instagram keys"`: `topPosts`, `followerHistory`, `reachHistory` empty, `account` null, `platform: "tiktok"`, `tiktok.topVideos` ordered, `tiktok.viewsHistory`, `tiktok.followerHistory` as `{ date, followerCount }`; no `instagram_posts` query.
- `"hub-dashboard: a TikTok-only client gets TikTok detail without sending platform"`.
- `"hub-dashboard: platform=tiktok without a TikTok card answers 200 with no tiktok block"`: `platform: "tiktok"`, `accounts` lists Instagram.
- `"hub-dashboard: with period=90 the TikTok summary still uses 30 days"`: videos at 10 and 60 days old; `views30d` counts only the first, `tiktok.topVideos` has both.
- `"hub-dashboard: an Instagram client without platform gets exactly the legacy keys"`: the existing first test, plus `body.tiktok === undefined`.

- [ ] **Step 2: Run to see them fail**

- [ ] **Step 3: Implement**

`tiktok-detail.ts`: the three pure functions. Handler: read `platform` from the query string, build `accounts` first, then `resolvePlatform`. When the resolved platform is `tiktok` and TikTok has a card, load videos and follower history once for `windowFromDays(period, now)` and derive the 30-day summary from that same data in memory (posted on or after `spDayStartIso(window30.start)`; history `date >= window30.start`), so a TikTok request makes one `tiktok_posts` and one `tiktok_follower_history` query. When the resolved platform is `tiktok`, skip every Instagram detail query. The Instagram **summary** is still built on a TikTok request: it needs the account row and one follower-history query for 30 days.

- [ ] **Step 4: Run both test files and `npm run check:functions`**

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/hub-dashboard supabase/functions/__tests__/hub-dashboard_test.ts supabase/functions/__tests__/hub-dashboard-accounts_test.ts
git commit -m "feat(hub-dashboard): parâmetro platform e detalhe do TikTok"
```

---

### Task 4: Hub data layer, formatters and copy

**Files:**
- Create: `apps/hub/src/lib/dashboardFormat.ts`
- Modify: `apps/hub/src/types.ts`, `apps/hub/src/api.ts`, `apps/hub/src/queries.ts`, `packages/i18n/locales/pt/hubHome.json`, `packages/i18n/locales/en/hubHome.json`
- Test: `apps/hub/src/lib/__tests__/dashboardFormat.test.ts`

**Interfaces:**
- Produces (`types.ts`): `DashboardPlatform = 'instagram' | 'tiktok'`, `HubAccountState`, `HubAccountSummary`, `FollowersDelta`, `DashboardTopVideo`, `DashboardViewsEntry = { date: string; views: number }`, all shaped as in the spec's contract; `HubDashboardResponse` gains optional `platform?`, `accounts?`, `tiktok?` (optional: an old function may answer during the deploy window).
- Produces (`api.ts`): `fetchDashboard(token: string, period: number, platform?: DashboardPlatform)`; the parameter is sent only when given.
- Produces (`queries.ts`):

```ts
export type DashboardPlatformKey = DashboardPlatform | 'default';
export const hubDashboardQuery = (token: string, period: number, platform: DashboardPlatformKey = 'default') =>
  queryOptions({
    queryKey: ['hub-dashboard', token, period, platform],
    queryFn: () => fetchDashboard(token, period, platform === 'default' ? undefined : platform),
    staleTime: 5 * 60 * 1000,
  });
```

- Produces (`dashboardFormat.ts`):

```ts
/** Full number with grouping: 12480 -> "12.480" (pt-BR). null -> "—". */
export function formatCount(n: number | null | undefined, locale: string): string;
/** Compact from 1000 up, one decimal: 48200 -> "48,2 mil", 214 -> "214". null -> "—". */
export function formatCompact(n: number | null | undefined, locale: string): string;
/** "dd/mm" in pt-BR, the locale's day+month order otherwise. Accepts an ISO instant or a YYYY-MM-DD day. */
export function formatDayMonth(iso: string, locale: string): string;
export type SyncAge = { kind: 'minutes'; n: number } | { kind: 'hours'; n: number } | { kind: 'date'; iso: string } | { kind: 'never' };
export function syncAge(lastSyncedAt: string | null, now: Date): SyncAge;
/** Seconds -> "0:42", "1:05". null -> null. */
export function formatDuration(seconds: number | null): string | null;
```

- [ ] **Step 1: Write the failing tests**

```ts
describe('dashboardFormat', () => {
  it('formatCount groups in pt-BR and returns a dash for null', () => {
    expect(formatCount(12480, 'pt-BR')).toBe('12.480');
    expect(formatCount(null, 'pt-BR')).toBe('—');
  });
  it('formatCompact keeps small numbers whole and compacts from 1000', () => {
    expect(formatCompact(214, 'pt-BR')).toBe('214');
    expect(formatCompact(48200, 'pt-BR')).toBe('48,2 mil');
    expect(formatCompact(126000, 'pt-BR')).toBe('126 mil');
    expect(formatCompact(undefined, 'pt-BR')).toBe('—');
  });
  it('syncAge buckets', () => {
    const now = new Date('2026-11-10T12:00:00Z');
    expect(syncAge('2026-11-10T11:20:00Z', now)).toEqual({ kind: 'minutes', n: 40 });
    expect(syncAge('2026-11-10T10:00:00Z', now)).toEqual({ kind: 'hours', n: 2 });
    expect(syncAge('2026-11-08T10:00:00Z', now)).toEqual({ kind: 'date', iso: '2026-11-08T10:00:00Z' });
    expect(syncAge(null, now)).toEqual({ kind: 'never' });
  });
  it('syncAge never goes below one minute, even for a future stamp', () => {
    const now = new Date('2026-11-10T12:00:00Z');
    expect(syncAge('2026-11-10T11:59:50Z', now)).toEqual({ kind: 'minutes', n: 1 });
    expect(syncAge('2026-11-10T12:03:00Z', now)).toEqual({ kind: 'minutes', n: 1 });
  });
  it('formatDayMonth and formatDuration', () => {
    expect(formatDayMonth('2026-10-30', 'pt-BR')).toBe('30/10');
    expect(formatDuration(42)).toBe('0:42');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(null)).toBeNull();
  });
});
```

`formatDayMonth('2026-10-30', …)` must not shift a day in a negative-offset timezone: treat a bare `YYYY-MM-DD` as a calendar day, not as UTC midnight. Hours are floored; the boundary to `date` is 24 hours.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run apps/hub/src/lib/__tests__/dashboardFormat.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `dashboardFormat.ts`, the types, `fetchDashboard` and `hubDashboardQuery`**

`Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 })` for the compact form.

- [ ] **Step 4: Add the copy to both `hubHome.json` files**

| Key | pt | en |
| --- | --- | --- |
| `accounts.title` | Contas conectadas | Connected accounts |
| `accounts.subtitle` | Seus números, atualizados automaticamente ao longo do dia | Your numbers, updated automatically through the day |
| `accounts.platform.instagram` | Instagram | Instagram |
| `accounts.platform.tiktok` | TikTok | TikTok |
| `accounts.status.connected` | Conectada | Connected |
| `accounts.status.needsReconnect` | Reconexão necessária | Reconnection needed |
| `accounts.followers` | seguidores | followers |
| `accounts.followersOn` | seguidores em {{date}} | followers on {{date}} |
| `accounts.delta.window` | {{value}} em 30 dias | {{value}} in 30 days |
| `accounts.delta.since` | {{value}} desde {{date}} | {{value}} since {{date}} |
| `accounts.delta.noneWindow` | Sem variação em 30 dias | No change in 30 days |
| `accounts.delta.noneSince` | Sem variação desde {{date}} | No change since {{date}} |
| `accounts.stats.reach28d` | Alcance, 28 dias | Reach, 28 days |
| `accounts.stats.views28d` | Visualizações, 28 dias | Views, 28 days |
| `accounts.stats.posts` | Publicações | Posts |
| `accounts.stats.views30d` | Visualizações, 30 dias | Views, 30 days |
| `accounts.stats.likesTotal` | Curtidas no total | Total likes |
| `accounts.stats.videos` | Vídeos | Videos |
| `accounts.sync.minutes` | Atualizado há {{n}} min | Updated {{n}} min ago |
| `accounts.sync.hours` | Atualizado há {{n}} h | Updated {{n}} h ago |
| `accounts.sync.date` | Atualizado em {{date}} | Updated on {{date}} |
| `accounts.sync.never` | Aguardando a primeira atualização | Waiting for the first update |
| `accounts.sync.last` | Última atualização em {{date}} | Last updated on {{date}} |
| `accounts.reconnect.stopped` | Os números pararam de atualizar em {{date}}. Fale com a sua agência para reconectar a conta. | The numbers stopped updating on {{date}}. Ask your agency to reconnect the account. |
| `accounts.reconnect.never` | Os números não estão sendo atualizados. Fale com a sua agência para reconectar a conta. | The numbers are not being updated. Ask your agency to reconnect the account. |
| `accounts.seePerformance` | Ver desempenho | See performance |
| `accounts.seeHistory` | Ver histórico | See history |
| `accounts.goToAccount` | Ir para conta {{index}} | Go to account {{index}} |
| `dashboard.platformLabel` | Plataforma | Platform |
| `dashboard.topVideosTitle` | Melhores vídeos | Top videos |
| `topVideos.noVideos` | Nenhum vídeo no período selecionado. | No videos in the selected period. |
| `topVideos.goToVideo` | Ir para vídeo {{index}} | Go to video {{index}} |
| `topVideos.stats.shares` | Compartilhamentos | Shares |
| `followerChart.historySince` | Histórico disponível desde {{date}}. | History available since {{date}}. |
| `viewsChart.title` | Visualizações por dia de postagem | Views by posting day |
| `viewsChart.caption` | Soma das visualizações dos vídeos publicados em cada dia. | Sum of the views of the videos posted each day. |
| `viewsChart.tooltip` | {{value}} visualizações | {{value}} views |

- [ ] **Step 5: Run the tests and typecheck**

Run: `npx vitest run apps/hub/src/lib/__tests__/dashboardFormat.test.ts packages/i18n/__tests__/locales.test.ts && npx tsc -p apps/hub/tsconfig.json --noEmit`
Expected: PASS. (`locales.test.ts` also checks that literal `t()` keys resolve; the new keys are unused until Tasks 5 and 6, which is fine.)

- [ ] **Step 6: Commit**

```bash
git add apps/hub/src/lib apps/hub/src/types.ts apps/hub/src/api.ts apps/hub/src/queries.ts packages/i18n/locales
git commit -m "feat(hub): tipos, query e formatadores das contas conectadas"
```

---

### Task 5: The "Contas conectadas" strip

**Files:**
- Create: `apps/hub/src/components/dashboard/AccountStatusPill.tsx`, `apps/hub/src/components/dashboard/AccountCard.tsx`, `apps/hub/src/components/dashboard/ConnectedAccounts.tsx`, `apps/hub/src/components/dashboard/useDashboardPlatform.ts`
- Modify: `apps/hub/src/pages/HomePage.tsx`, `apps/hub/src/pages/HomePagePauta.tsx`, and the home tests that mock `fetchDashboard` (`apps/hub/src/pages/__tests__/homeMaterial.test.tsx`, `homePauta.test.tsx`, `homeCalendarRange.test.tsx`)
- Test: `apps/hub/src/components/__tests__/ConnectedAccounts.test.tsx`

**Interfaces:**
- Consumes: `hubDashboardQuery`, the types and formatters of Task 4.
- Produces:

```ts
// AccountStatusPill.tsx
export function AccountStatusPill({ state }: { state: HubAccountState }): JSX.Element;
// AccountCard.tsx — 'wide' is the single-account horizontal layout (mockup "Estados", state 4)
export function AccountCard(props: { account: HubAccountSummary; layout: 'stacked' | 'wide'; onOpen: () => void; className?: string }): JSX.Element;
// ConnectedAccounts.tsx — renders null on error, with no accounts, or when the response has no `accounts`
export function ConnectedAccounts(props: { onOpenPlatform: (platform: DashboardPlatform) => void; className?: string }): JSX.Element | null;
// useDashboardPlatform.ts
export const DASHBOARD_SECTION_ID = 'hub-desempenho';
export function useDashboardPlatform(): {
  platform: DashboardPlatform | null;           // null until the client picks one
  setPlatform: (p: DashboardPlatform | null) => void;
  openPlatform: (p: DashboardPlatform) => void; // setPlatform + scroll DASHBOARD_SECTION_ID into view
};
```

- [ ] **Step 1: Write the failing tests** (`ConnectedAccounts.test.tsx`)

Mock `../../api` `fetchDashboard`, render inside a `QueryClientProvider` and the Hub context the other component tests use. Fixture: `makeAccount(overrides)` returning the connected Instagram summary of the mockup (12480 followers, delta `{ value: 312, since: '2026-10-12', fullWindow: true }`, 48200 / 126000 / 214, `lastSyncedAt` two hours before a faked `now`).

```ts
it('renders a card per account, Instagram first', async () => { /* headings "Instagram" then "TikTok"; "@drahelenaprado" twice */ });
it('connected Instagram card shows followers, change, three numbers and sync age', async () => {
  // "12.480", "seguidores", "+312 em 30 dias", "48,2 mil", "Alcance, 28 dias", "126 mil", "214", "Publicações", "Atualizado há 2 h", "Conectada"
});
it('TikTok card shows its own three numbers and "desde" when history starts later', async () => {
  // delta { value: 84, since: '2026-10-30', fullWindow: false } -> "+84 desde 30/10"; "Visualizações, 30 dias", "Curtidas no total", "Vídeos"
});
it('needs-reconnect card shows the warning and hides change and numbers', async () => {
  // "Reconexão necessária", "seguidores em 02/11", the accounts.reconnect.stopped sentence with 02/11,
  // "Última atualização em 02/11", "Ver histórico"; no "em 30 dias", no "Alcance, 28 dias"
});
it('needs-reconnect without a sync date uses the "never" sentence', async () => {});
it('a loss shows a minus sign without a success colour, and zero says "Sem variação em 30 dias"', async () => {});
it('null figures render as a dash, never "null" or "NaN"', async () => {
  // followerCount null, reach28d null -> "—"; container text has no "null"/"NaN"
});
it('a null username shows the platform name alone; a 60-character username keeps the pill visible', async () => {
  // the handle element has the `truncate` class and `min-w-0` on its flex parent; "Conectada" is in the document
});
it('one account uses the wide layout; two use the carousel with dots', async () => {
  // one: no button named /Ir para conta/; two: two such buttons
});
it('clicking "Ver desempenho" calls onOpenPlatform with that platform', async () => {});
it('renders nothing with no accounts, with a response lacking `accounts`, and on error', async () => {});
it('requests period 30 without a platform', async () => { expect(fetchDashboard).toHaveBeenCalledWith('tok', 30, undefined); });
```

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run apps/hub/src/components/__tests__/ConnectedAccounts.test.tsx`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement the components**

Follow the mockup boards "A. Início", "Estados" and "Celular" for structure and spacing, and `apps/hub/src/pages/HomePage.tsx` for the classic card idiom (`hub-card p-5`, 16px semibold heading, 12.5px `hub-tx3` subtitle).
- Heading + subtitle sit above the cards, not inside a card.
- Two accounts: from `md` up a two-column grid; below `md` the snap carousel of `TopPostsRow` (same track classes, first card `basis-[86%]`, dots from its "Pagination dots" block, with `accounts.goToAccount` as the dot label).
- One account: `layout="wide"` from `md` up, stacked below.
- Loading: one skeleton block the height of a card (`Skeleton` from `components/Skeleton.tsx`).
- The change figure uses `text-emerald-600 dark:text-emerald-400` only when positive.
- "Ver desempenho" / "Ver histórico" is a `<button type="button">` at least 44px tall on phones.
- `useDashboardPlatform().openPlatform` scrolls with `behavior: 'auto'` under `prefers-reduced-motion: reduce`, else `'smooth'`, `block: 'start'`.
- Platform icon: `PlatformIcon` from `@mesaas/report-blocks/PlatformIcon` (the Hub already imports that package in `RelatorioDocPage.tsx`).

- [ ] **Step 4: Place the strip**

`HomePage.tsx` (classic): call `useDashboardPlatform()` once. Wrap the greeting `<section>`, the new strip and the KPI `<section>` in one `<div className="flex flex-col gap-6">`, in the DOM order greeting, strip, KPIs, and give the strip `className="md:order-last"`. That yields strip-above-KPIs on phones and strip-under-KPIs from `md` up without touching the other children. Pass the hook's `platform` and `setPlatform` to `DashboardSection` (Task 6 adds those props; until then pass nothing and keep the hook's values unused).

`HomePagePauta.tsx`: new props `accountsStrip: ReactNode`, `dashboardPlatform: DashboardPlatform | null`, `onDashboardPlatform: (p: DashboardPlatform | null) => void`; render `accountsStrip` right after `<PautaKpiStrip>` at every width. `HomePage` builds the strip element once and passes it.

- [ ] **Step 5: Fix the home tests**

The three home test files mock `../../api`; `fetchDashboard` there is a bare `vi.fn()`. Give it `mockResolvedValue({ topPosts: [], followerHistory: [], reachHistory: [], account: null, period: 30, platform: 'instagram', accounts: [] })` in each file's setup so the strip resolves to nothing. Add to `homePauta.test.tsx`: `'renders the accounts strip right after the KPI strip'` (with one account in the mock, the "Contas conectadas" heading follows the KPI strip in document order).

- [ ] **Step 6: Run the Hub suites and typecheck**

Run: `npx vitest run apps/hub && npx tsc -p apps/hub/tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/hub/src/components/dashboard apps/hub/src/components/__tests__/ConnectedAccounts.test.tsx apps/hub/src/pages
git commit -m "feat(hub): faixa Contas conectadas no Início"
```

---

### Task 6: Desempenho per platform

**Files:**
- Create: `apps/hub/src/components/dashboard/PlatformSwitch.tsx`, `apps/hub/src/components/dashboard/TopVideosRow.tsx`, `apps/hub/src/components/dashboard/ViewsChart.tsx`
- Modify: `apps/hub/src/components/dashboard/DashboardSection.tsx`, `DashboardCharts.tsx`, `FollowerChart.tsx`, `apps/hub/src/pages/HomePage.tsx`, `HomePagePauta.tsx`
- Test: `apps/hub/src/components/__tests__/DashboardSection.test.tsx`, `apps/hub/src/components/__tests__/TopVideosRow.test.tsx`

**Interfaces:**
- Consumes: Task 4's query and formatters; Task 5's `AccountStatusPill`, `DASHBOARD_SECTION_ID`, and the `platform` / `setPlatform` pair.
- Produces:

```ts
// DashboardSection.tsx
export function DashboardSection(props?: {
  sectionNumber?: number;
  selectedPlatform?: DashboardPlatform | null;
  onSelectPlatform?: (p: DashboardPlatform | null) => void;
}): JSX.Element | null;
// PlatformSwitch.tsx — a role="group" of two buttons with aria-pressed, icon + name
export function PlatformSwitch(props: { value: DashboardPlatform; onChange: (p: DashboardPlatform) => void }): JSX.Element;
// TopVideosRow.tsx
export function TopVideosRow({ videos }: { videos: DashboardTopVideo[] }): JSX.Element;
// ViewsChart.tsx (inside the lazy chunk)
export function ViewsChart({ viewsHistory }: { viewsHistory: DashboardViewsEntry[] }): JSX.Element;
// FollowerChart.tsx gains: caption?: string
// DashboardCharts.tsx default export props:
type DashboardChartsProps =
  | { platform: 'instagram'; followerHistory: DashboardFollowerEntry[]; reachHistory: DashboardReachEntry[] }
  | { platform: 'tiktok'; followerHistory: DashboardFollowerEntry[]; viewsHistory: DashboardViewsEntry[]; followerCaption?: string };
```

Query rule inside `DashboardSection`: it always subscribes to `hubDashboardQuery(token, 30)` (the strip's query) to learn `defaultPlatform = data.platform`. Its own request key is `platform = !selectedPlatform || selectedPlatform === defaultPlatform ? 'default' : selectedPlatform`, with the selected period. So choosing the platform that is already the default never triggers a second request.

- [ ] **Step 1: Write the failing tests**

`TopVideosRow.test.tsx`:

```ts
it('renders views, engagement and shares for each video', () => { /* "6,8 mil", "7,4%", "212", "Compartilhamentos"; no "Salvos" */ });
it('shows the duration tag and links to the share url in a new tab', () => { /* "0:42"; a[href="https://www.tiktok.com/@x/video/1"][target="_blank"][rel~="noopener"] */ });
it('a video without cover, share_url or duration renders a placeholder, no tag and no link', () => {
  // no <a> for that card; no img; no element matching /^\d+:\d\d$/
});
it('a javascript: share url is not rendered as a link', () => {});
it('a null engagement rate shows a dash', () => {});
it('shows the empty message with no videos', () => { /* "Nenhum vídeo no período selecionado." */ });
```

`DashboardSection.test.tsx` (mock `../../api`; mock `../dashboard/DashboardCharts` with a stub that prints its props as JSON so chart.js never loads):

```ts
it('with one Instagram account: no switch, the account line, and today\'s content', async () => {
  // no group named "Plataforma"; "@clinica"; "Conectada"; "Melhores Posts"
});
it('with two accounts: the switch appears with Instagram pressed', async () => {});
it('choosing TikTok requests platform=tiktok and shows Melhores vídeos', async () => {
  // fetchDashboard called with ('tok', 30, 'tiktok'); "Melhores vídeos"; charts stub got platform "tiktok"
});
it('choosing the default platform again does not refetch', async () => { /* call count unchanged */ });
it('a TikTok-only client lands on TikTok from the plain request', async () => {
  // response.platform 'tiktok' with a tiktok block; exactly one fetchDashboard call, without a platform
});
it('changing the period keeps the platform', async () => { /* ('tok', 60, 'tiktok') */ });
it('falls back to the first account when the tiktok block is missing', async () => {
  // onSelectPlatform called with null; Instagram content shown
});
it('an account that needs reconnection shows the pill and "Última atualização em"', async () => {});
it('passes the follower caption only when history starts more than a day after the period', async () => {
  // first point 2026-10-30, period 30 ending 2026-11-10 -> followerCaption "Histórico disponível desde 30/10."
  // first point at the period start -> followerCaption undefined
});
it('a response without `accounts` behaves as before: no switch, no account line', async () => {});
it('no account at all keeps the "Conecte o Instagram" card', async () => {});
it('renders with the section id used by the strip', async () => { /* container.querySelector('#hub-desempenho') */ });
```

The period start for the caption is the request's period counted back from today (`period - 1` days before today), compared on calendar days.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run apps/hub/src/components/__tests__/DashboardSection.test.tsx apps/hub/src/components/__tests__/TopVideosRow.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `DashboardSection`: root element gets `id={DASHBOARD_SECTION_ID}`. Header row: title on the left; on the right the `PlatformSwitch` (only when `accounts.length === 2`) then the existing `PeriodSelector`, wrapping on narrow widths. Below it the account line (`@username`, `AccountStatusPill`, sync age on the right; "Última atualização em" for `needs_reconnect`). In the Pauta header (`SectionHeader` with `action`), the same two controls go in `action`.
- Instagram content is the current JSX, unchanged.
- TikTok content: `dashboard.topVideosTitle` + `TopVideosRow`, then the charts grid with `platform: 'tiktok'`.
- The missing-block fallback runs in an effect: `selectedPlatform === 'tiktok'` and the settled response has no `tiktok` block -> `onSelectPlatform(null)`.
- `TopVideosRow`: copy `TopPostsRow`'s track, card and dots; grid `sm:grid-cols-3 md:grid-cols-5`; phone card `basis-[46%]`; cover box `aspect-[9/13]` with `object-cover`; numbers through `formatCompact`. Whether to extract the shared carousel logic into a hook is the implementer's call; do not change `TopPostsRow`'s rendered output.
- `ViewsChart`: model it on `ReachChart.tsx` (bars, `chartInk`, `chartFont`, `useFontsReady`), one bar per entry, total on the right of the title (`formatCompact`), `viewsChart.caption` under the chart, the follower chart's `noData` card pattern with `topVideos.noVideos` when empty.
- `FollowerChart`: render `caption` as a 12px `hub-tx3` line under the footer when given.
- `HomePage` / `HomePagePauta`: pass `selectedPlatform` and `onSelectPlatform` from the Task 5 hook.

- [ ] **Step 4: Run the Hub suites and typecheck**

Run: `npx vitest run apps/hub packages/i18n && npx tsc -p apps/hub/tsconfig.json --noEmit`
Expected: PASS (`homePauta.test.tsx` has a `DashboardSection sectionNumber` block that renders the real component: keep it green).

- [ ] **Step 5: Commit**

```bash
git add apps/hub/src/components apps/hub/src/pages
git commit -m "feat(hub): Desempenho por plataforma com TikTok"
```

---

### Task 7: Docs, full gates and browser check

**Files:**
- Modify: `CLAUDE.md` (the `SYNC_BATCH_LIMIT / SYNC_CONCURRENCY / BACKFILL_BATCH_LIMIT` entry and a new Gotchas bullet)

- [ ] **Step 1: Update `CLAUDE.md`**

In the env entry, add that `tiktok-sync-cron` reads the same two dials (hourly at minute 30, 6 hour window, so `6 × SYNC_BATCH_LIMIT` TikTok accounts) and that a failing TikTok account is retried every 6 hours. Add a Gotchas bullet "Hub: contas conectadas" with the spec path, the deploy order below, and the rollback line.

- [ ] **Step 2: Run every CI gate**

```bash
npm run lint
npm run format:check
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p apps/mcp-widgets/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
npm run check:functions
npm run test:functions
```

Expected: all clean. Also run `TZ=UTC npx vitest run apps/hub/src/lib apps/hub/src/components/__tests__` (CI runs in UTC; the date tests must not depend on the local zone).

- [ ] **Step 3: Verify in a browser**

Start the Hub dev server (`npm run dev:hub`, port 5175) and open a Hub link of a client with Instagram and TikTok connected. The edge function is not deployed yet, so for this check serve the new `hub-dashboard` locally (`npx supabase functions serve`) or patch `fetch` in the page to answer `hub-dashboard` with a fixture; say which one you did. Check and screenshot:
- Desktop: strip under the KPIs; two cards; "Ver desempenho" scrolls to Desempenho with the right platform.
- 390px wide: strip above the KPIs, carousel with dots; TikTok video carousel.
- Dark theme; a workspace with a brand accent; the Pauta look.
- A needs-reconnect fixture and a single-account fixture.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: contas conectadas do Hub e sync horário do TikTok"
```

---

## Rollout (run by a person, in this order)

1. `npx supabase db push --linked` for the migration (staging first). Safe before any deploy: the old function just runs hourly.
2. Deploy `tiktok-sync-cron` with `--no-verify-jwt`. Never before step 1: it selects the new column.
3. Deploy `hub-dashboard` with `--no-verify-jwt`. Additive: the current Hub bundle ignores the new keys.
4. Merge. The Hub frontend deploys on merge.

Check after: one hourly run in the function logs with `synced`/`deferred`; a Hub link of a client with both accounts.

Rollback: frontend first. Functions and the column can stay. To go back to a daily TikTok sync, reschedule the job with SQL.
