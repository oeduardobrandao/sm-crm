# Views as Primary Performance Metric

**Date:** 2026-08-24
**Status:** Approved

## Summary

Replace "alcance" (reach) with "visualizações" (views) as the primary performance metric across all analytics surfaces: portfolio analytics, per-account analytics (including content table and print report), Hub client portal, and AI analysis prompts. Engagement rate formula stays unchanged (`interactions / reach * 100`). Reach is demoted, not removed.

## Data Model

No schema migration needed. The Instagram API `views` metric is already stored in the DB column `impressions` (on both `instagram_posts` and `instagram_accounts`). The mapping lives in `_shared/instagram-metrics.ts`: `{ views: "impressions" }`. Frontend types already alias `views` from `impressions`.

- Post-level: `instagram_posts.impressions` = views, `instagram_posts.reach` = reach
- Account-level: `instagram_accounts.impressions_28d` = views (28d), `instagram_accounts.reach_28d` = reach (28d)
- Account-level live views come from `getAccountViews` (Graph API, capped at 90 days)

**Unavailable views data:** When the Graph API does not return views for a post, `buildMetricFields` writes `0` to `impressions` and adds `"impressions"` to `unavailable_metrics`. To avoid silently dropping these posts from rankings, queries must use `.or('impressions.gt.0,reach.gt.0')` instead of `.gt('impressions', 0)`. Posts with `impressions = 0` but valid `reach` remain rankable — they sort to the bottom of views-based rankings naturally.

## Changes

### 1. Service Layer (`apps/crm/src/services/analytics.ts`)

**`getPortfolioSummary`:**
- Supabase query filter: `.gt('reach', 0)` becomes `.or('impressions.gt.0,reach.gt.0')`
- Supabase query order: `.order('reach', { ascending: false })` becomes `.order('impressions', { ascending: false })`
- JS sort: `b.reach - a.reach` becomes `b.views - a.views`

**`getPostsAnalytics`:**
- The DB query always orders by `posted_at`; sorting is JS-side via `validCols` + `.sort()`. Add `'views'` to `validCols`. The sort comparator already reads `(a as any)[col]` — since enriched posts have a `views` property (aliased from `impressions`), the `'views'` column works without extra mapping.
- Keep `'reach'` and `'impressions'` as valid columns too.

### 2. Hub Backend (`supabase/functions/hub-dashboard/handler.ts`)

- Post query filter: `.gt("reach", 0)` becomes `.or('impressions.gt.0,reach.gt.0')`
- Post query order: `.order("reach", { ascending: false })` becomes `.order("impressions", { ascending: false })`
- Remove the secondary `.sort()` by `engagementRate` + `.slice(0, 5)`. Instead, the top 5 posts are ranked by views (impressions), matching the CRM. The engagement rate is still displayed on each card but is not the ranking criterion.

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
- The drawer close handler reset (`setDrawerOrderBy('reach')` at line 1617) also changes to `'views'`
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

**KPI cards (complete order after change):**
1. Visualizações (already first, no change)
2. Seguidores
3. Engajamento
4. Contas engajadas (swaps with Alcance)
5. Alcance (demoted from position 4 to 5)
6. Cliques no link
7. Taxa de salvamentos
8. Posts publicados

**Content table (line 1753):**
- Move "Impressões" column before "Alcance" and rename to "Visualizações"
- Keep "Alcance" as a secondary column

**Print report (line 3091):**
- Add "Visualizações" KPI card using `impressions` data
- Demote "Alcance" KPI card to secondary position
- In the per-post table, add a "Visualizações" column before "Alcance"

**Drawer sort:**
- Add `'views'` sort case mapping to `post.views`
- Default sort changes from `'reach'` to `'views'`
- Any drawer reset/close handlers that set sort to `'reach'` must change to `'views'`

### 5. Hub Client Portal

**`TopPostsRow.tsx`:**
- Label: "Alcance" becomes "Visualizações"
- Value: `post.reach` becomes `post.impressions` (the `DashboardTopPost` type uses `impressions`, not an aliased `views`)

**`ReachChart.tsx`:**
- No changes. Stays as a secondary reach-over-time visualization. Tooltip already shows both "Alcance" and "Impressões".

### 6. AI Prompts (`supabase/functions/instagram-analytics/index.ts`)

**Per-account AI prompt:**
- Add `views` (from `impressions`) to the post summary object alongside `reach`
- Remove the reach-percentage benchmark ("Alcance medio por post: 20-40% dos seguidores"). Views can legitimately exceed follower count (repeat exposures), so a percentage-of-followers benchmark does not apply. Instead, frame the directive qualitatively: "Visualizações é a métrica principal de distribuição. Compare os posts entre si, identifique quais tiveram distribuição acima ou abaixo da média do perfil."
- System prompt frames views as the primary performance signal, reach as secondary

**Portfolio AI prompt:**
- Add `impressions_28d` to each account's summary data
- Update prompt to reference views as primary metric for comparing accounts, same qualitative framing

**`report-docs/generate.ts`:**
- No changes — already has views-first AI directive

## What Does NOT Change

- Engagement rate formula: stays `interactions / reach * 100`
- Database schema: no migrations
- Per-view rates (`share_rate`, `like_rate`, `save_rate`, `comment_rate`): already use `impressions` as denominator
- Reach data is still collected, stored, and available — just no longer the primary ranking/display metric
