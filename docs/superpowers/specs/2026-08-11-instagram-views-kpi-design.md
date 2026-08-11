# Visualizações (Instagram account views) KPI on the account analytics page

**Date:** 2026-08-11
**Status:** Approved (Option B: live fetch via edge function, cached)

## Problem

Instagram made **Views** its primary success metric (it replaced Impressions and
Plays; the old metrics were deprecated in the API in April 2025). Users ask for
it, but the account analytics page (`AnalyticsContaPage`) does not show it. The
page's KPI row starts with Seguidores and shows 7 cards, none of which is the
compound account viewership for the selected period.

The data already flows through the system in two places, both invisible to the
page:

- `instagram-sync-cron` fetches the account-level `views` metric hourly, but
  only as a fixed rolling 28-day total, stored under the **legacy column name**
  `instagram_accounts.impressions_28d` (and daily snapshots of that rolling
  value in `instagram_account_metrics_daily.impressions_28d`).
- `instagram-analytics` has a `GET /overview/:clientId` route that fetches
  `views` live per period, but the CRM stopped calling it (the overview is now
  computed client-side from DB data), and its single un-chunked API call breaks
  silently for periods over ~30 days.

Naming trap for future readers: in this codebase `impressions*` fields hold the
IG **views** metric and `profile_views*` fields hold **accounts_engaged**. This
spec does not rename them.

## What Instagram's "Views" means (metric semantics)

- Reels/videos: one view per play or replay start. Photos, carousels, stories,
  live: one view each time the content appears on screen.
- Repeats count (3 plays by one person = 3 views). Reach counts unique accounts.
- The account-level figure is the sum of views across **all** the account's
  content during the period, regardless of when each piece was posted, from
  followers and non-followers.
- The API's user-level `views` insight returns this same number the client sees
  in the Instagram app. That equivalence is the point of this feature.

## Hard API constraints (drive the design)

1. User-level insights data is stored by Meta for **up to 90 days**.
2. A single insights call covers at most ~30 days of range (the sync cron's
   28-day single-call fetch works; the broken 365-day overview call does not).

Consequences:

- 7d and 30d presets and "Último mês": current AND previous period fit in the
  window; full delta support.
- 90d preset: current period fits; previous period (days 90-180 back) does not.
  Card shows the value with **no delta chip**.
- Custom periods > 90 days: only the last 90 days are fetchable. The card shows
  the 90-day total, flagged as partial (see UI section).

## Design

### Backend: new route on `instagram-analytics`

`GET /views/:clientId?days=N` or `GET /views/:clientId?start=YYYY-MM-DD&end=YYYY-MM-DD`

- Auth, conta ownership check (`verifyClientOwnership`), token decryption, and
  CORS: identical to the existing routes in the same function. The route falls
  under the default `feature_instagram` gate in `feature-guard.ts` with no
  change needed there.
- Availability window: `[now - 90d, now]`. Clamp the requested range to it.
- Chunk the clamped range into ≤ 30-day windows (pure helper, unit-tested).
  For each chunk call
  `GET graph.instagram.com/me/insights?metric=views&metric_type=total_value&period=day&since=..&until=..`
  via the existing `graphFetch` (it already handles token-expiry code 190 and
  rate-limit retry). Sum `total_value.value` across chunks. A failed chunk
  counts as 0 and is logged internally; the route still returns a number.
- Previous period = the window of equal length immediately before the requested
  start. Fetch it the same way **only if it lies fully inside the availability
  window**; otherwise `previous: null`.
- Response shape (wrapped by the existing `getCachedOrFetch`, TTL 6h, cache key
  `views_{days}` or `views_{start}_{end}`):

```json
{
  "data": { "current": 123456, "previous": 98765, "partial": false },
  "fromCache": false,
  "fetchedAt": "2026-08-11T..."
}
```

  `previous` is `null` when the comparison window is unavailable. `partial` is
  `true` when the requested range was clamped (start older than 90 days).

### Frontend: service + card

- `services/analytics.ts`: new `getAccountViews(clientId, days, dateRange?)`
  using the existing `fetchEdge` helper. Returns
  `{ current, previous, partial, fetchedAt } | null` (null on any fetch error,
  matching `fetchEdge` semantics).
- `AnalyticsContaPage`: new independent `useQuery` keyed
  `['analytics-views', clientId, overviewDays, periodStart, periodEnd]` so the
  seven existing DB-backed KPIs keep rendering without waiting on the IG API.
- New **first** card in the `StatCardGrid` (before Seguidores), `maxCols` 7 → 8:
  - Label `Visualizações`, lucide `Play` icon, tone `violet` (StatCard tones
    allow repeats; positions 1 and 4 are not adjacent).
  - Value: `current.toLocaleString('pt-BR')`. While the query loads: `…`. On
    error/null: `—` with footnote `Indisponível no momento`.
  - Delta: `KpiCard`'s `delta` prop becomes optional (StatCard's already is).
    When `previous != null`, build the delta with the existing `makeDelta` and
    show `Anterior: <n>` like the other cards. When `previous == null`, no
    delta chip.
  - Period chip: the shared `periodTag`. When `partial` is true, the chip reads
    `máx. 90d` and the footnote explains: `O Instagram fornece visualizações
    de no máximo 90 dias.` (No em-dashes in any user-facing copy.)
- Report export (in-page "Gerar Relatório" HTML): `Visualizações` becomes the
  first `kpiCard(...)`; with 8 cards the export's `repeat(4, 1fr)` grid forms a
  clean 2×4. No delta in the export when `previous == null` (existing `noDelta`
  parameter).

### Explicitly out of scope

- No migration, no cron change, no renaming of the legacy `impressions*` /
  `profile_views*` fields.
- No daily views storage (would make >90d periods accurate over time); possible
  follow-up slice.
- The dead client-side `overview.impressions` delta (always 0: the query never
  selects the column) stays as-is; flagged separately as cleanup.
- The stale `GET /overview/:clientId` edge route stays untouched.

## Error handling summary

| Case | Behavior |
| --- | --- |
| IG token expired (code 190) | `graphFetch` throws; route returns error; card shows `—` + `Indisponível no momento` |
| One chunk fails | That chunk counts 0, logged server-side; total still returned |
| Period > 90d | Clamped total, `partial: true`, chip `máx. 90d` |
| Previous period out of window | `previous: null`, no delta chip |
| No IG account connected | Page already gates on account existence before the KPI grid renders |

## Testing

- **Deno (`supabase/functions/__tests__`)**: unit tests for the pure helpers
  (range clamp to 90d, ≤30-day chunking, previous-window computation,
  chunk-sum with a failed chunk). Helpers live in a small module next to the
  function (e.g. `instagram-analytics/views.ts`) so they are importable without
  serving the function.
- **Vitest (page test)**: extend the `services/analytics` mock factory with
  `getAccountViews`; assert the Visualizações card renders first with the
  formatted value; assert the no-delta state when `previous` is null.
- Full local gate before pushing: `npm run lint`, `npm run format:check`, the
  four `tsc` projects, `npm run test`, `npm run test:functions` (then revert
  the dirtied root `deno.lock`).

## Deploy order

1. `npx supabase functions deploy instagram-analytics --use-api` (same
   verify-jwt setting the function has today; it validates the JWT itself).
2. Merge → Vercel ships the CRM. Until step 1 is live, the new card degrades to
   `—` + `Indisponível no momento`, so order is safe either way; function-first
   avoids any visible gap.
