# Views as Primary Performance Metric

**Date:** 2026-08-24
**Status:** Approved

## Summary

Replace "alcance" (reach) with "visualizações" (views) as the primary performance metric across all analytics surfaces: portfolio analytics, per-account analytics, Hub client portal, and AI analysis prompts. Engagement rate formula stays unchanged (`interactions / reach * 100`). Reach is demoted, not removed.

## Data Model

No schema migration needed. The Instagram API `views` metric is already stored in the DB column `impressions` (on both `instagram_posts` and `instagram_accounts`). The mapping lives in `_shared/instagram-metrics.ts`: `{ views: "impressions" }`. Frontend types already alias `views` from `impressions`.

- Post-level: `instagram_posts.impressions` = views, `instagram_posts.reach` = reach
- Account-level: `instagram_accounts.impressions_28d` = views (28d), `instagram_accounts.reach_28d` = reach (28d)
- Account-level live views come from `getAccountViews` (Graph API, capped at 90 days)

## Changes

### 1. Service Layer (`apps/crm/src/services/analytics.ts`)

**`getPortfolioSummary`:**
- Supabase query: `.gt('reach', 0).order('reach', { ascending: false })` becomes `.gt('impressions', 0).order('impressions', { ascending: false })`
- JS sort: `b.reach - a.reach` becomes `b.views - a.views`

**`getPostsAnalytics`:**
- Add `'views'` as a valid sort column alias mapping to `'impressions'` in the DB query
- Keep `'reach'` as a valid column

### 2. Hub Backend (`supabase/functions/hub-dashboard/handler.ts`)

- Post query: `.gt("reach", 0).order("reach", { ascending: false })` becomes `.gt("impressions", 0).order("impressions", { ascending: false })`

### 3. CRM Portfolio Page (`apps/crm/src/pages/analytics/AnalyticsPage.tsx`)

**Post rankings:**
- `reachRankedPosts` memo renamed to `viewsRankedPosts`, sorted by `b.views - a.views`
- `matureReachRankedPosts` renamed to `matureViewsRankedPosts`, sorted by `a.views - b.views`

**Post cards (top/worst):**
- Label changes from "Alcance" to "Visualizações"
- Value changes from `post.reach` to `post.views`

**KPI cards:**
- "Alcance total (28d)" becomes "Visualizações totais" using `impressions_28d` summed across accounts
- "Maior alcance" leader card changes to "Mais visualizações", sorted by `impressions_28d`

**Drawer:**
- Default `drawerOrderBy` changes from `'reach'` to `'views'`
- Add `'views'` sort case mapping to `post.views`

**Accounts table:**
- Add "Visualizações (28d)" column using `impressions_28d`
- Move "Alcance (28d)" one position to the right
- Add `'impressions_28d'` to the `SortCol` type

### 4. CRM Per-Account Page (`apps/crm/src/pages/analytics-conta/AnalyticsContaPage.tsx`)

**Post rankings:**
- `rankedPosts` sort: `b.reach - a.reach` becomes `b.views - a.views`
- `matureRankedPosts` sort: `a.reach - b.reach` becomes `a.views - b.views`

**RankedPostCard:**
- Leading metric label from "Alcance" to "Visualizações"
- Value from `post.reach` to `post.views`

**KPI cards:**
- Visualizações already first — no label change
- Alcance moves from position 4 to position 5 (after engagement rate)

**Drawer sort:**
- Add `'views'` sort case mapping to `post.views`
- Default sort changes from `'reach'` to `'views'`

### 5. Hub Client Portal

**`TopPostsRow.tsx`:**
- Label: "Alcance" becomes "Visualizações"
- Value: `post.reach` becomes `post.impressions` (the `DashboardTopPost` type uses `impressions`, not an aliased `views`)

**`ReachChart.tsx`:**
- No changes. Stays as a secondary reach-over-time visualization. Tooltip already shows both "Alcance" and "Impressões".

### 6. AI Prompts (`supabase/functions/instagram-analytics/index.ts`)

**Per-account AI prompt:**
- Add `views` (from `impressions`) to the post summary object alongside `reach`
- Update benchmark text to include views reference
- System prompt frames views as the primary performance signal, reach as secondary

**Portfolio AI prompt:**
- Add `impressions_28d` to each account's summary data
- Update prompt to reference views as primary metric for comparing accounts

**`report-docs/generate.ts`:**
- No changes — already has views-first AI directive

## What Does NOT Change

- Engagement rate formula: stays `interactions / reach * 100`
- Database schema: no migrations
- Per-view rates (`share_rate`, `like_rate`, `save_rate`, `comment_rate`): already use `impressions` as denominator
- Reach data is still collected, stored, and available — just no longer the primary ranking/display metric
