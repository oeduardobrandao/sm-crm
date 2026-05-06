# Hub Client Dashboard — Design Spec

## Overview

Add a performance dashboard section to the Hub Home page, giving clients visibility into their Instagram post performance and follower growth without asking the agency. The dashboard sits between the existing welcome hero and the navigation cards grid — the rest of the Home page stays unchanged.

## Scope

- New edge function: `hub-dashboard`
- New Hub frontend components: `DashboardSection`, `TopPostsRow`, `FollowerChart`, `ReachChart`, `PeriodSelector`
- Modified page: `apps/hub/src/pages/HomePage.tsx`
- New Hub types and API function for the dashboard endpoint
- Chart.js (already a project dependency via `react-chartjs-2`)

## Edge Function: `hub-dashboard`

### Endpoint

`GET /functions/v1/hub-dashboard?token=<token>&period=30|60|90`

### Auth

Same token validation as other hub functions:
1. Look up `client_hub_tokens` by `token` param
2. Validate `expires_at > now()` and `is_active = true`
3. Extract `cliente_id` and `conta_id`
4. Query `instagram_accounts` where `client_id = cliente_id`

### Query Logic

**Top posts** (max 5):
```sql
SELECT instagram_post_id, thumbnail_url, media_type, permalink, posted_at,
       likes, comments, reach, impressions, saved, shares
FROM instagram_posts
WHERE instagram_account_id = $1
  AND posted_at >= now() - interval '$period days'
  AND reach > 0
ORDER BY (likes + comments + saved + shares)::float / reach DESC
LIMIT 5
```

**Follower history**:
```sql
SELECT date, follower_count
FROM instagram_follower_history
WHERE instagram_account_id = $1
  AND date >= to_char(now() - interval '$period days', 'YYYY-MM-DD')
ORDER BY date ASC
```

**Reach history** (aggregated by post date):
```sql
SELECT posted_at::date as date, SUM(reach) as reach, SUM(impressions) as impressions
FROM instagram_posts
WHERE instagram_account_id = $1
  AND posted_at >= now() - interval '$period days'
GROUP BY posted_at::date
ORDER BY date ASC
```

**Account snapshot**: Read directly from `instagram_accounts` row.

### Response Shape

```typescript
interface HubDashboardResponse {
  topPosts: {
    id: string;
    thumbnailUrl: string | null;
    mediaType: string;
    permalink: string;
    postedAt: string;
    likes: number;
    comments: number;
    reach: number;
    impressions: number;
    saved: number;
    shares: number;
    engagementRate: number;
  }[];
  followerHistory: {
    date: string;
    followerCount: number;
  }[];
  reachHistory: {
    date: string;
    reach: number;
    impressions: number;
  }[];
  account: {
    followerCount: number;
    followingCount: number;
    mediaCount: number;
    reach28d: number;
    impressions28d: number;
    lastSyncedAt: string | null;
  } | null;
  period: number;
}
```

If the client has no linked Instagram account, `account` is `null` and all arrays are empty.

### Error Handling

- Invalid/expired token: 401 with generic message
- Missing `period` param: default to 30
- Invalid `period` value (not 30/60/90): default to 30
- No Instagram account: return success with null account and empty arrays (not an error)
- CORS: use `buildCorsHeaders(req)` from `_shared/cors.ts`

### Deployment

Deploy with `--no-verify-jwt` since Hub functions handle their own token auth.

## Frontend Components

### DashboardSection

Container component rendered in `HomePage.tsx` between the hero and the section cards. Manages:
- `period` state (default: 30)
- React Query call to `hub-dashboard` with `token` and `period`
- Loading state (skeleton placeholders for cards and charts)
- Empty state when `account` is null: shows a centered message "Conecte o Instagram para ver métricas de desempenho" with a muted style
- Passes data down to child components

### PeriodSelector

Segmented control with three options: 30d, 60d, 90d. Styled as pill buttons in a container with a subtle background. Active option uses brand yellow background with dark text; inactive options use muted text. Positioned top-right of the section header, aligned with the "Desempenho" heading.

### TopPostsRow

Horizontal scrollable row of up to 5 post cards. Each card:
- Thumbnail image area (120px height) with media type badge (FEED/REELS/STORIES/CARROSSEL) top-left
- If no thumbnail, show a gradient placeholder based on media type color
- Three metric rows below: Alcance (reach), Engajamento (engagement rate %), Salvos (saved count)
- Engagement rate displayed in green (`--success` color)
- Entire card is clickable — opens Instagram permalink in new tab
- Cards have `min-width: 160px`, flex-shrink 0, with horizontal scroll and hidden scrollbar

Media type colors (matching existing PostCalendar convention):
- Feed: `#3b82f6`
- Reels: `#8b5cf6`
- Stories: `#f59e0b`
- Carrossel: `#10b981`

### FollowerChart

Chart.js line chart showing follower count over the selected period.
- Single line in brand yellow (`#eab308`) with 2.5px stroke
- Gradient area fill below the line (yellow to transparent)
- Y-axis: follower count with abbreviated labels (e.g., "14.8k")
- X-axis: date labels, spaced to avoid crowding (auto-ticked by Chart.js)
- Point markers on dates that appear in `reachHistory` (days a post was published)
- Below the chart: current follower count in large mono font + delta percentage badge (green for growth, red for decline)
- Delta computed as: `(latest - earliest) / earliest * 100`
- Grid lines: subtle `rgba(255,255,255,0.04)` in dark mode
- Tooltip on hover showing exact date and count
- Font: DM Mono for axis labels and values

### ReachChart

Chart.js bar chart showing reach per post-day over the selected period.
- Bars in brand yellow with slight opacity variation
- Each bar represents a day where at least one post exists
- Y-axis: reach with abbreviated labels
- X-axis: date labels
- Below the chart: total reach in the period in large mono font + "total no período" label
- Same grid and font styling as FollowerChart
- Tooltip on hover showing date, reach, and impressions

### Chart Container Layout

Both charts sit side-by-side in a 2-column grid on desktop (min-width 768px). On mobile, they stack vertically. Each chart is in its own card (`background: var(--surface-main)`, `border-radius: 16px`, `padding: 1.25rem`, subtle border).

## Page Layout (top to bottom)

1. Welcome hero (existing, unchanged)
2. **Dashboard section** (new)
   - Section header: "Desempenho" h2 + PeriodSelector
   - "Melhores Posts" label + TopPostsRow
   - Two-column chart grid: FollowerChart + ReachChart
3. Section cards grid (existing, unchanged)
4. PostCalendar (existing, unchanged)

## Responsive Behavior

- **Desktop (> 900px)**: Charts side-by-side, 5 post cards visible before scroll
- **Tablet (768-900px)**: Charts side-by-side but narrower, 3 post cards visible
- **Mobile (< 768px)**: Charts stack vertically, 1.5 post cards visible (encouraging scroll)
- Period selector stays inline with heading at all breakpoints

## Data Fetching

- Use React Query (`useQuery`) with key `['hub-dashboard', token, period]`
- `staleTime: 5 * 60 * 1000` (5 minutes) — this data doesn't change frequently
- On period change, React Query handles refetch automatically via the key
- The dashboard query runs independently from the existing posts query (no dependency)

## Empty / Error States

- **No Instagram account**: Show a card-styled empty state with muted text: "Conecte o Instagram para ver métricas de desempenho." No charts rendered.
- **Loading**: Skeleton placeholders — 5 card-shaped pulses for top posts, two chart-sized pulses for the charts.
- **Error**: Silent fail — don't show the dashboard section at all. Log to console. The rest of the Home page works normally.
- **No posts in period**: Show charts with empty data and a "Nenhum post no período selecionado" message inside each chart area.

## Files to Create

- `supabase/functions/hub-dashboard/index.ts` — edge function entry point
- `supabase/functions/hub-dashboard/handler.ts` — request handling and queries
- `apps/hub/src/components/dashboard/DashboardSection.tsx` — container
- `apps/hub/src/components/dashboard/TopPostsRow.tsx` — top posts horizontal scroll
- `apps/hub/src/components/dashboard/FollowerChart.tsx` — line chart
- `apps/hub/src/components/dashboard/ReachChart.tsx` — bar chart
- `apps/hub/src/components/dashboard/PeriodSelector.tsx` — segmented control

## Files to Modify

- `apps/hub/src/pages/HomePage.tsx` — add DashboardSection between hero and cards
- `apps/hub/src/types.ts` — add `HubDashboardResponse` and related types
- `apps/hub/src/api.ts` — add `fetchDashboard(token, period)` function

## Out of Scope

- Post pipeline metrics (posts this month, approval rate) — not requested
- Audience demographics — too much complexity for v1
- Best posting times heatmap — not requested
- AI-generated insights — not requested
- PDF export / report generation
- Real-time updates / polling
