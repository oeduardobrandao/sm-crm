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

**Unavailable views data:** When the Graph API does not return views for a post, `buildMetricFields` preserves the previous `impressions` value if one exists; it only writes `0` for a brand-new post with no prior sync. In either case, `"impressions"` is added to `unavailable_metrics`. To avoid silently dropping posts from rankings, queries must use `.or('impressions.gt.0,reach.gt.0')` instead of `.gt('impressions', 0)`. Posts with stale or zero `impressions` but valid `reach` remain rankable — they sort to the bottom of views-based rankings naturally. The `unavailable_metrics` array is already surfaced on post cards as a visual indicator; no additional handling is needed for ranking.

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
- Change the `.limit(20)` to `.limit(5)` and remove the secondary `.sort()` by `engagementRate` + `.slice(0, 5)`. The top 5 posts are now ranked by views directly from the query. The engagement rate is still computed and displayed on each card but is not the ranking criterion.

### 3. CRM Portfolio Page (`apps/crm/src/pages/analytics/AnalyticsPage.tsx`)

**Post rankings:**
- `reachRankedPosts` memo renamed to `viewsRankedPosts`, sorted by `b.views - a.views`
- `matureReachRankedPosts` renamed to `matureViewsRankedPosts`, sorted by `a.views - b.views`

**Post cards (top/worst):**
- Label changes from "Alcance" to "Visualizações"
- Value changes from `post.reach` to `post.views`
- Tooltip on top posts section (line 861): "Top 5 posts com maior alcance" becomes "Top 5 posts com mais visualizações"
- Tooltip on worst posts section (line 1063): "menor alcance" becomes "menos visualizações"
- Per-card metric label (lines 970, 1173): "Alcance" becomes "Visualizações"

**KPI cards:**
- "Alcance total (28d)" becomes "Visualizações totais" using `impressions_28d` summed across accounts
- "Maior alcance" leader card changes to "Mais visualizações", sorted by `impressions_28d`
- Sub-label (line 829): `alcance 28d` becomes `visualizações 28d`

**Drawer:**
- Default `drawerOrderBy` changes from `'reach'` to `'views'`
- The drawer close handler reset (`setDrawerOrderBy('reach')` at line 1617) also changes to `'views'`
- Add `case 'views'` to the switch at line 462, sorting by `a.views - b.views`
- Add `<SelectItem value="views">Visualizações</SelectItem>` to the selector at line 1668 (before the existing "Alcance" option)
- Keep the `reach` option as "Alcance" for users who want to sort by it
- Drawer result rows (line 1850 area): the primary displayed metric changes from "Alcance" to "Visualizações" with `post.views`
- Drawer description line (line 1655): "Top 200 por alcance" becomes "Top 200 por visualizações"

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
- Add `<SelectItem value="views">Visualizações</SelectItem>` to the drawer's order selector (before existing "Alcance" option)
- Default sort changes from `'reach'` to `'views'`
- Any drawer reset/close handlers that set sort to `'reach'` must change to `'views'`
- Drawer result rows: primary displayed metric changes from "Alcance" to "Visualizações"

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

**Portfolio AI prompt (line 1180):**
- Add `impressions_28d` to the `.select()` projection: `'id, client_id, username, follower_count, profile_views_28d, reach_28d, impressions_28d'`
- Add `views28d: acc.impressions_28d || 0` to the account summary object at line 1218
- Update prompt to reference views as primary metric for comparing accounts, same qualitative framing

**`report-docs/generate.ts`:**
- No changes — already has views-first AI directive

## What Does NOT Change

- Engagement rate formula: stays `interactions / reach * 100`
- Database schema: no migrations
- Per-view rates (`share_rate`, `like_rate`, `save_rate`, `comment_rate`): already use `impressions` as denominator
- Reach data is still collected, stored, and available — just no longer the primary ranking/display metric
