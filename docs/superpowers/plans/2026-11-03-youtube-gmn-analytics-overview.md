# YouTube + GMN Analytics Overview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add YouTube and Google Meu Negócio to the CRM sidebar's Analytics group (active with the
flag, "Em breve" without) and build `/analytics/google` (GMN portfolio dashboard) and
`/analytics/youtube` (per-channel list).

**Architecture:** Two new read routes, `GET /portfolio` on `gbp-analytics` and
`youtube-analytics`, built from the existing per-client KPI math (`computeGbpKpis`,
`computeYtKpis`, `computeYtSplit`) over one paged query per table for the whole workspace. Two
new lazy CRM pages modeled on `TikTokOverviewPage` (Vidro toolbar, phone layout, empty state).
Sidebar gets a third gating mode, "soon", next to hide and lock.

**Tech Stack:** React 19, React Router v7, TanStack Query, Vitest + Testing Library; Deno edge
functions with the shared `supabaseMock`.

**Spec:** `docs/superpowers/specs/2026-11-03-youtube-gmn-analytics-overview-design.md`
(amends `docs/superpowers/specs/2026-10-29-youtube-google-meu-negocio-design.md` §3 and §4.6).

## Global Constraints

- pt-BR UI copy, sentence case, no em dashes in user-facing strings; every new string in both
  `packages/i18n/locales/pt` and `packages/i18n/locales/en`.
- YouTube page: no number that spans channels except channel counts (connected; per status in
  the filter). No totals, averages, leaders, rank labels, medals or highlighted rows.
- `GET /portfolio` on `youtube-analytics` answers `{ channels }` and nothing else at top level.
- Windows: YouTube 7/28/90 (default 28, `YT_WINDOW_DAYS`); GMN 7/30/90 (default 30,
  `GBP_WINDOW_DAYS`).
- Guards on both new routes: tenant via `resolveTenant` (active_workspace_id +
  workspace_members), rate limit 120/min, product flag + `feature_analytics_reports` → 403
  `{ error: "feature_disabled", feature }`. Never return raw error details.
- Reads: one `fetchAllRows` paged query per table over `.in(...)`, ordered by the table's full
  primary key; never a query per unit/channel in a loop.
- External URLs (`maps_uri`) go through `sanitizeUrl()` before `href`.
- Icons in nav data are Phosphor class strings (`ph-youtube-logo`, `ph-storefront`); React icon
  components in pages are `lucide-react`.
- No migration. Both functions deploy with `--no-verify-jwt`, before the merge.
- Never run repo-wide prettier/eslint: scope to touched files. After any `deno test` run, check
  `ls node_modules/.deno` and `npm ci` if it exists; revert `deno.lock` changes.

## Review Focus

1. **Flag loading flash:** while `features` is null the two sidebar items render as "Em breve",
   never as links, and the pages render the skeleton, never fetch. Test: Task 1 (null features
   → `disabled: true`), Tasks 4/5 (`isLoading` → no service call).
2. **A revoked YouTube channel after its purge** (`data_through` null, no rows): the row renders
   with dashes and "Reconectar", sorts last on every numeric column, and does not crash the
   sort. Test: Task 3 (metrics all null) and Task 4 (sort places null last in both directions).
3. **GMN units of an inactive client or a `disconnected` unit** must not appear anywhere. Test:
   Task 2 asserts the `clientes` read filters `status = 'ativo'` and the `gbp_locations` read
   filters `status in (active, revoked)`.
4. **A client filter that matches nothing / a foreign client id** (`?client=` of another
   workspace): returns the empty portfolio, never another tenant's units. Test: Task 2 asserts
   the `clientes` read is keyed by the tenant `conta_id` and an unknown id yields `units: []`.
5. **One stale unit among fresh ones:** KPIs and rows end at the fresh units' watermark, the
   stale unit still listed with `stale: true`. Test: Task 2 (`portfolioDataThrough`).

---

### Task 1: Sidebar items and active state

**Files:**
- Modify: `apps/crm/src/components/layout/nav-data.ts` (Analytics group ~168-187, `NAV_FEATURE`
  ~246, `NAV_FEATURE_REQUIRED_TRUE` ~266, `NAV_MODULE` ~300, `getNavGroups` ~330-375,
  `isNavRouteActive` ~395-401)
- Modify: `packages/i18n/locales/pt/common.json`, `packages/i18n/locales/en/common.json` (`nav`)
- Test: `apps/crm/src/components/layout/__tests__/nav-data.test.ts`,
  `apps/crm/src/components/layout/__tests__/Sidebar.test.tsx`,
  `apps/crm/src/components/layout/__tests__/MobileNav.test.tsx`

**Interfaces:**
- Produces: nav ids `analytics-youtube` (`/analytics/youtube`) and `analytics-google`
  (`/analytics/google`); `isNavRouteActive(pathname, route, itemId?)` unchanged signature.

- [ ] **Step 1: Write the failing tests** in `nav-data.test.ts`:
  - `analytics group lists Instagram, TikTok, YouTube, Google Meu Negócio in order` (features
    with `feature_tiktok`, `feature_youtube`, `feature_google_business`,
    `feature_analytics_reports` true; ids `['analytics','analytics-tiktok','analytics-youtube','analytics-google']`).
  - `YouTube and GMN are disabled ("Em breve") when their flag is false`: items present with
    `disabled: true`.
  - `YouTube and GMN are disabled while features is null` (plan loading).
  - `YouTube and GMN are enabled only when their flag is exactly true` (`disabled` falsy).
  - `YouTube and GMN are hidden without analytics:ver` and `hidden when feature_analytics_reports is false`.
  - `isNavRouteActive`: `/analytics/youtube` and `/analytics/12/youtube` active for
    `analytics-youtube` only; `/analytics/google`, `/analytics/12/google` for
    `analytics-google` only; `analytics` (Instagram) inactive on all four and on the TikTok
    paths; `/analytics/12/instagram` and `/analytics` active for `analytics`; without an item id
    every `/analytics/*` path matches `/analytics`.
  - `Sidebar.test.tsx`: with `feature_youtube` false, "YouTube" renders with "Em breve" and no
    link (`queryByRole('link', { name: /YouTube/ })` is null). `MobileNav.test.tsx`: the "Mais"
    sheet shows the same inert row.

- [ ] **Step 2: Run to verify they fail**
  Run: `npx vitest run apps/crm/src/components/layout/__tests__/nav-data.test.ts apps/crm/src/components/layout/__tests__/Sidebar.test.tsx apps/crm/src/components/layout/__tests__/MobileNav.test.tsx`
  Expected: FAIL (new ids missing).

- [ ] **Step 3: Implement** in `nav-data.ts`:
  - Two items after `analytics-tiktok`: `{ id: 'analytics-youtube', route: '/analytics/youtube', label: 'YouTube', labelKey: 'nav.youtube', icon: 'ph-youtube-logo' }`, `{ id: 'analytics-google', route: '/analytics/google', label: 'Google Meu Negócio', labelKey: 'nav.googleBusiness', icon: 'ph-storefront' }`.
  - `NAV_FEATURE` and `NAV_MODULE` entries identical to `analytics-tiktok`'s
    (`feature_analytics_reports`; `['analytics','ver']`).
  - `const NAV_FEATURE_SOON: Record<string, string> = { 'analytics-youtube': 'feature_youtube', 'analytics-google': 'feature_google_business' };` with a doc comment: fail-closed like
    `NAV_FEATURE_REQUIRED_TRUE`, but keeps the item as `disabled: true` instead of removing it.
    Apply it in `getNavGroups` right after the `NAV_FEATURE_REQUIRED_TRUE` pass:
    `features?.[flag] === true ? i : { ...i, disabled: true }`.
  - Replace `TIKTOK_ANALYTICS_PATH` with a map `PLATFORM_ANALYTICS_PATH: Record<string, RegExp>`
    for `analytics-tiktok`, `analytics-youtube`, `analytics-google`
    (`/^\/analytics\/(?:<p>|[^/]+\/<p>)\/?$/`); the item's own regex decides its active state,
    and `analytics` is false when any of the three matches. Update the doc comment.
  - i18n `nav.youtube` = "YouTube", `nav.googleBusiness` = "Google Meu Negócio" (en: "Google
    Business Profile").

- [ ] **Step 4: Run the tests** (same command). Expected: PASS. Also run
  `npx vitest run apps/crm/src/components/layout` to catch other nav snapshots.

- [ ] **Step 5: Commit**
  `git add apps/crm/src/components/layout packages/i18n/locales && git commit -m "feat(nav): YouTube e Google Meu Negócio no grupo Analytics, Em breve sem a flag"`

---

### Task 2: `gbp-analytics` `GET /portfolio`

**Files:**
- Create: `supabase/functions/_shared/gbp-analytics/portfolio.ts`
- Modify: `supabase/functions/_shared/gbp-analytics/queries.ts` (export `loadMetrics`,
  `loadRatings`; no behaviour change)
- Modify: `supabase/functions/gbp-analytics/handlers.ts` (`route()` ~187)
- Test: `supabase/functions/_shared/gbp-analytics/portfolio.test.ts`,
  `supabase/functions/__tests__/gbp-analytics_test.ts`

**Interfaces:**
- Consumes: `computeGbpKpis`, `GbpKpiEntry`, `GbpMetricsRow`, `sumMetrics` (kpis.ts);
  `resolveWindow`, `windowDataThrough`, `minDataThrough`, `parseWindowRequest`, `addDays`
  (window.ts); `saoPauloDate` (`_shared/sao-paulo-date.ts`); `fetchAllRows`.
- Produces (mirrored in Task 5's service):

```ts
export interface GbpPortfolioUnit {
  id: string; clientId: number; clientName: string; especialidade: string | null;
  title: string | null; status: "active" | "revoked"; mapsUri: string | null;
  lastSyncedAt: string | null; stale: boolean;
  profileViews: number; prevProfileViews: number | null;
  calls: number; directions: number; websiteClicks: number; messages: number; bookings: number;
  actions: number;            // calls + directions + websiteClicks + messages + bookings
  avgRating: number | null;   // snapshot at window end, else gbp_locations.average_rating
  reviewCount: number | null; // snapshot total_review_count, else gbp_locations.total_review_count
  newReviews: number | null;
}
export interface GbpAttentionReview {
  unitId: string; clientId: number; unitTitle: string | null; mapsUri: string | null;
  reviewerName: string | null; starRating: number; comment: string | null; createTime: string | null;
}
export interface GbpPortfolio {
  window: AnalyticsWindow; dataThrough: string | null;
  kpis: { units: number; revokedUnits: number; profileViews: GbpKpiEntry; actions: GbpKpiEntry;
          avgRating: GbpKpiEntry; newReviews: GbpKpiEntry };
  units: GbpPortfolioUnit[];
  reviewsAttention: GbpAttentionReview[]; // every match, newest first; the page shows 10
}
export const GBP_STALE_MS = 48 * 3600 * 1000;
export function isStaleUnit(u: { status: string; last_synced_at: string | null }, now: Date): boolean;
export function portfolioDataThrough(units: { status: string; data_through: string | null; last_synced_at: string | null }[], now: Date): string | null;
export async function buildGbpPortfolio(db: Db, contaId: string, req: WindowRequest, clientId: number | null, now: Date): Promise<GbpPortfolio>;
```

- [ ] **Step 1: Write the failing pure tests** in `portfolio.test.ts`:
  - `isStaleUnit`: active + last_synced_at 49 h ago → true; 47 h → false; null → false;
    revoked + 72 h → false.
  - `portfolioDataThrough`: active fresh `2026-10-27` + active stale `2026-10-20` → `2026-10-27`;
    every active unit stale → falls back to `windowDataThrough` (`2026-10-20`); revoked
    `2026-10-01` ignored when a fresh active unit exists.

- [ ] **Step 2: Write the failing handler tests** in `gbp-analytics_test.ts` (reuse `signedIn`,
  `metrics()`, `NOW`, U1/U2 fixtures; add `client_id`, `last_synced_at` to the unit rows):
  - `portfolio: 403 feature_disabled when feature_google_business is off` (and for
    `feature_analytics_reports`).
  - `portfolio: 400 invalid_window on days=28` and `400 invalid_client_id on client=abc`.
  - `portfolio: reads active clients of the tenant only` (recorded `clientes` modifiers include
    `eq conta_id ws-B` and `eq status ativo`; `gbp_locations` includes `in status [active,revoked]`).
  - `portfolio: empty when no client or no unit` → `units: []`, `kpis.units: 0`, 200.
  - `portfolio: foreign client id yields the empty portfolio` (clientes read returns nothing).
  - `portfolio: sums KPIs and per-unit rows over the shared window` with U1 (30 days of
    `call_clicks: 1`, `business_direction_requests: 1`) and U2: assert `units[0].actions`,
    `kpis.actions.value`, `kpis.units`, window end = `portfolioDataThrough`.
  - `portfolio: per-unit prevProfileViews null when the unit has no row on prevStart`.
  - `portfolio: avgRating uses the window-end snapshot, falls back to gbp_locations`.
  - `portfolio: a stale unit is flagged and does not move the window end`.
  - `portfolio: reviewsAttention filters <=3 stars, unanswered, from SP today - N + 1, newest
    first` (assert the recorded `lte star_rating 3`, `eq has_reply false`, `gte create_time`
    `2026-10-01T03:00:00.000Z` for days=30 at NOW, and `order create_time desc`).
  - `portfolio: 100 units × 90 days paged` (queue 18 pages of 1000 metric rows; assert 200 and
    `units.length === 100`).

- [ ] **Step 3: Run to verify they fail**
  Run: `deno test --no-check --allow-env --allow-net supabase/functions/_shared/gbp-analytics/portfolio.test.ts supabase/functions/__tests__/gbp-analytics_test.ts`
  Expected: FAIL (module/route missing).

- [ ] **Step 4: Implement `portfolio.ts`.** Read order (the mock queues per table in call
  order, keep it fixed and document it): `clientes` (`id, nome, especialidade`, tenant, `ativo`,
  optional `eq id`) → `gbp_locations` (unit columns + `client_id, last_synced_at`, `in client_id`,
  counted statuses, ordered `client_id, created_at, id`) → `Promise.all([loadMetrics(prevStart,
  end), loadRatings(window), reviews])`. Window: `resolveWindow(req, portfolioDataThrough(units,
  now), now)`. Portfolio KPIs: one `computeGbpKpis` over all units with `prevCovered` = some
  unit has a row on `prevStart`; `actions` entry = sum of the five action entries' `value`/`prev`
  (prev null if any is null). Per unit: `computeGbpKpis` over that unit's rows and ratings with
  its own `prevCovered`. Reviews: `gbp_reviews` select `location_name, reviewer_name,
  star_rating, comment, create_time`, tenant, `in location_name`, `lte star_rating 3`,
  `eq has_reply false`, `gte create_time` = São Paulo midnight of `saoPauloDate(now) - (N - 1)`
  as ISO (for a `range` request use its `start`), ordered `create_time desc` then the primary
  key, through `fetchAllRows`. `hasData` false → zeros/nulls with the same shape.
- [ ] **Step 5: Wire the route** in `handlers.ts`: before the `/<route>/<id>` match,
  `if (req.method === "GET" && path === "/portfolio")` → `parseWindowRequest` (400
  `invalid_window`), optional `client` via `parseClientId` (400 `invalid_client_id`),
  `requireFeatures`, then `ctx.json(await buildGbpPortfolio(...))`. No ownership check (the
  query is tenant-keyed).
- [ ] **Step 6: Run the tests** (Step 3 command, plus the whole `gbp-analytics_test.ts` and
  `_shared/gbp-analytics/*.test.ts`). Expected: PASS. Then `npm run check:functions`. Clean
  `node_modules/.deno` / `deno.lock` per Global Constraints.
- [ ] **Step 7: Commit**
  `git commit -m "feat(gbp-analytics): rota /portfolio com todas as unidades do workspace"`

---

### Task 3: `youtube-analytics` `GET /portfolio`

**Files:**
- Create: `supabase/functions/_shared/youtube-analytics/portfolio.ts`
- Modify: `supabase/functions/youtube-analytics/handlers.ts` (`route()` ~170)
- Test: `supabase/functions/_shared/youtube-analytics/portfolio.test.ts`,
  `supabase/functions/__tests__/youtube-analytics_test.ts`

**Interfaces:**
- Consumes: `resolveYtWindow`, `parseYtWindowRequest`, `YtWindow` (window.ts);
  `computeYtKpis`, `computeYtSplit`, `emptyYtKpis`, `YtChannelDailyRow` (kpis.ts);
  `YOUTUBE_CHANNEL_COLUMNS`, `YouTubeChannelRow` (queries.ts); `fetchAllRows`.
- Produces:

```ts
export interface YtPortfolioChannel {
  clientId: number; clientName: string; title: string | null; handle: string | null;
  avatarUrl: string | null; subscriberCount: number | null;
  authorizationStatus: "active" | "revoked"; lastSyncedAt: string | null;
  window: YtWindow | null; // null when the channel has no data (first sync, purged)
  metrics: { netSubscribers: number | null; views: number | null; watchMinutes: number | null;
             avgViewDurationS: number | null; shortsShare: number | null }; // shortsShare 0..1
}
export interface YtPortfolio { channels: YtPortfolioChannel[] }
export function channelPortfolioRow(channel: YouTubeChannelRow & { client_id: number }, clientName: string, rows: YtChannelDailyRow[], window: YtWindow | null, hasData: boolean): YtPortfolioChannel;
export async function buildYtPortfolio(db: Db, contaId: string, req: YtWindowRequest, now: Date): Promise<YtPortfolio>;
```

- [ ] **Step 1: Write the failing pure tests** (`portfolio.test.ts`, `channelPortfolioRow`):
  - views/watchMinutes/avgViewDurationS equal `computeYtKpis` `all` values for the same rows.
  - `shortsShare` = shorts ÷ (shorts + long) over `[window.start, min(window.end, content_type_through)]`; null when `content_type_through` is null or before `window.start`;
    null when shorts + long views are 0.
  - `hasData` false → every metric null, `window` null.
- [ ] **Step 2: Write the failing handler tests** (`youtube-analytics_test.ts`):
  - `portfolio: top-level keys are exactly ["channels"]` (`assertEquals(Object.keys(body), ["channels"])`).
  - 403 for each flag off; 400 `invalid_window` on `days=30`.
  - `portfolio: reads active clients only and every content type except live`
    (recorded `in content_type [all, shorts, long]`).
  - `portfolio: each channel uses its own data_through` (two channels with different
    `data_through`, assert two different `window.end`).
  - `portfolio: revoked purged channel` → metrics all null, `authorizationStatus: "revoked"`.
  - `portfolio: 100 channels × 90 days paged` (27 pages of 1000 rows) → 200, 100 channels.
- [ ] **Step 3: Run to verify they fail**
  Run: `deno test --no-check --allow-env --allow-net supabase/functions/_shared/youtube-analytics/portfolio.test.ts supabase/functions/__tests__/youtube-analytics_test.ts`
- [ ] **Step 4: Implement.** Reads: `clientes` (tenant, `ativo`) → `youtube_channels`
  (`YOUTUBE_CHANNEL_COLUMNS`, tenant, `in client_id`) → one `youtube_channel_daily` paged read
  (tenant, `in channel_id`, `in content_type [all, shorts, long]`, `day` between the earliest
  window start and the latest window end of the channels with data, ordered `channel_id, day,
  content_type`). Group rows by channel, then by its own window. `watchMinutes` stays minutes
  (the page divides by 60). Route branch in `handlers.ts` like Task 2 Step 5, response
  `{ channels }` built field by field (no spread of an object that could carry extra keys).
- [ ] **Step 5: Run the tests**, then `npm run check:functions`; clean `node_modules/.deno`.
- [ ] **Step 6: Commit**
  `git commit -m "feat(youtube-analytics): rota /portfolio com uma linha por canal"`

---

### Task 4: `/analytics/youtube` page

**Files:**
- Modify: `apps/crm/src/services/youtubeAnalytics.ts` (types + `getYouTubePortfolio`)
- Create: `apps/crm/src/pages/analytics-youtube/YouTubeOverviewPage.tsx`,
  `apps/crm/src/pages/analytics-youtube/youtubeOverviewModel.ts`,
  `apps/crm/src/pages/analytics-youtube/phone/YouTubeOverviewPhone.tsx`
- Modify: `apps/crm/src/App.tsx` (lazy import + `<Route path="/analytics/youtube">` above
  `/analytics/:id/:tab?`)
- Modify: `packages/i18n/locales/{pt,en}/analyticsYoutube.json` (`overview.*`)
- Test: `apps/crm/src/pages/analytics-youtube/__tests__/YouTubeOverviewPage.test.tsx`,
  `.../youtubeOverviewModel.test.ts`, `.../YouTubeOverviewPage.phone.test.tsx`

**Interfaces:**
- Consumes: Task 3 response shape; `YtWindow` exported type from the service.
- Produces: `getYouTubePortfolio(days: 7 | 28 | 90): Promise<YtPortfolioChannel[]>`;
  model `filterChannels(channels, { query, clientId, status: 'all' | 'revoked' })`,
  `sortChannels(channels, col, dir)` with nulls last in both directions,
  `YtChannelSortCol = 'subscriberCount' | 'netSubscribers' | 'views' | 'watchHours' | 'shortsShare' | 'avgViewDurationS' | 'lastSyncedAt' | 'title'`.

- [ ] **Step 1: Failing tests.** Model: search matches title, handle or client name
  (case/accent-insensitive); status `revoked` keeps only revoked; sort nulls last asc and desc.
  Page (mock `useWorkspaceLimits` and the service like `TikTokOverviewPage.test.tsx`):
  - `isLoading` → skeleton, service not called; `feature_youtube` false → `<Navigate to="/analytics">`.
  - renders one row per channel with formatted numbers; no element whose text contains "Total"
    or "Média" (anti-goal guard); the count "N canais conectados"; status chips with counts.
  - clicking a row navigates to `/analytics/<clientId>/youtube`.
  - revoked row shows "Reconectar" and dashes.
  - "Dados do YouTube" attribution present.
  - changing the period calls `getYouTubePortfolio(7)`.
  - empty → empty state with a link to `/clientes`.
  - phone test: the phone layout renders cells (no table) below 768px.
- [ ] **Step 2: Run to verify fail:** `npx vitest run apps/crm/src/pages/analytics-youtube`
- [ ] **Step 3: Implement.** Copy the TikTok page's shell decisions (guard, `usePageToolbar`
  for Vidro, `useIsDesktop(768)` for phone, query key `['youtube-portfolio', days]`). Table
  with shadcn `Table` and `ArrowUpDown` sortable heads (TikTok pattern), default sort `views`
  desc. Shorts cell: bar + `%` from `shortsShare`. Watch hours = `watchMinutes / 60`. Atualizado
  = relative `lastSyncedAt` (`date-fns` `formatDistanceToNowStrict`, pt-BR). Footer line
  "Cada número pertence só ao canal da linha." + attribution reused from the client tab's
  YouTube frame (`YouTubeCardFrame.tsx`) if it exports one, else the same markup.
- [ ] **Step 4: Run the tests** (Step 2) and `npx tsc -p apps/crm/tsconfig.json --noEmit`.
- [ ] **Step 5: Commit** `git commit -m "feat(analytics): página /analytics/youtube com uma linha por canal"`

---

### Task 5: `/analytics/google` page

**Files:**
- Modify: `apps/crm/src/services/gbpAnalytics.ts` (types + `getGbpPortfolio`)
- Create: `apps/crm/src/pages/analytics-google/GoogleOverviewPage.tsx`,
  `apps/crm/src/pages/analytics-google/gbpOverviewModel.ts`,
  `apps/crm/src/pages/analytics-google/phone/GoogleOverviewPhone.tsx`
- Modify: `apps/crm/src/App.tsx` (route `/analytics/google` above `/analytics/:id/:tab?`)
- Modify: `packages/i18n/locales/{pt,en}/analyticsGoogle.json` (`overview.*`)
- Test: `apps/crm/src/pages/analytics-google/__tests__/GoogleOverviewPage.test.tsx`,
  `.../gbpOverviewModel.test.ts`, `.../GoogleOverviewPage.phone.test.tsx`

**Interfaces:**
- Consumes: Task 2 response shape.
- Produces: `getGbpPortfolio(days: 7 | 30 | 90, clientId?: number): Promise<GbpPortfolio>`;
  model `highlightsFor(units): GbpHighlight[]`, `specialtyStatsFor(units): GbpSpecialtyStat[]`,
  `attentionUnits(units): GbpPortfolioUnit[]`, `sortUnits(units, col, dir)`.

- [ ] **Step 1: Failing model tests** (`gbpOverviewModel.test.ts`), exact rules from spec §5.1:
  - Mais ações: max `actions`; ties by title (pt-BR collation).
  - Maior crescimento: max `(profileViews - prev) / prev` among units with
    `prevProfileViews !== null && prevProfileViews >= 50`; a unit at prev 49 is never chosen.
  - Melhor nota: max `avgRating` among units with `reviewCount >= 10`.
  - Mais avaliações novas: max `newReviews` (> 0).
  - A highlight with no eligible unit is absent from the result.
  - Specialty groups: only `especialidade` non-null and ≥ 2 units; views and actions per unit =
    sum ÷ count; rating weighted by `reviewCount`.
  - `attentionUnits`: revoked units, then active `stale` units.
- [ ] **Step 2: Failing page tests** (same harness as Task 4): loading/flag guard; KPI cards
  (Unidades with "2 precisam reconectar", Visualizações do perfil, Ações, Nota média, Avaliações
  novas); highlights render; reviews list shows at most 10 and "Ver todas" reveals the rest;
  "Ver no Google" href passes through `sanitizeUrl` and is absent when `mapsUri` is null; the
  hint about the most recent stored reviews; attention units link to
  `/clientes/<id>?tab=redes&rede=google` (check the Redes sociais tab param name in
  `RedesSociaisTab.tsx` / the client page and use it); units table row → `/analytics/<id>/google`;
  specialty section hidden with < 2 units per group; client filter calls
  `getGbpPortfolio(30, <id>)`; period options 7/30/90; empty state.
- [ ] **Step 3: Run to verify fail:** `npx vitest run apps/crm/src/pages/analytics-google`
- [ ] **Step 4: Implement**, same shell as Task 4, query key `['gbp-portfolio', days, clientId]`,
  KPI grid like `GbpKpiGrid` (reuse its `KpiCard` usage and `gbpTabFormat.ts` formatters), stars
  rendering reused from `GbpReviewsList.tsx` if exported, relative dates via `date-fns`.
- [ ] **Step 5: Run the tests** and `npx tsc -p apps/crm/tsconfig.json --noEmit`.
- [ ] **Step 6: Commit** `git commit -m "feat(analytics): página /analytics/google com o portfólio de unidades"`

---

### Task 6: Parent spec amendments and full verification

**Files:**
- Modify: `docs/superpowers/specs/2026-10-29-youtube-google-meu-negocio-design.md` (§3 non-goals
  sentence, §4.6 Aggregation bullet), wording exactly as in the overview spec §6.

- [ ] **Step 1: Edit the parent spec** with the two replacements.
- [ ] **Step 2: Run every CI gate locally:**
  `npm run lint` · `npx prettier --check <touched files>` · the five `tsc` commands
  (crm, hub, admin, mcp-widgets, `tsconfig.scripts.json`) · `npm run test` ·
  `npm run check:functions` · `npm run test:functions`. Expected: all green. Clean
  `node_modules/.deno` and `deno.lock` afterwards.
- [ ] **Step 3: Browser check** (`preview_start crm-staging`, seed login, temporary flag patch
  in `useWorkspaceLimits.ts` reverted afterwards): sidebar shows both items as "Em breve" with
  the flags off and as links with them on; `/analytics/youtube` and `/analytics/google` render
  their empty states against staging (no connected Google units there); screenshot both.
- [ ] **Step 4: Commit** `git commit -m "docs(spec): portfólio GMN e lista de canais do YouTube"`
