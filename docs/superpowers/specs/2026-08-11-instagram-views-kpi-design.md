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

#### Range contract

- Exactly one of `days` **or** the `start`+`end` pair is required; anything
  else (both, neither, `start` without `end`) is a 400.
- `days`: integer 1..730 (mirrors the UI's custom input). Rolling mode:
  `until = now`, `since = until - days*86400` (unix seconds).
- `start`/`end`: `YYYY-MM-DD`, interpreted as UTC calendar days, inclusive on
  both ends to match "Último mês": `since = start T00:00:00Z`,
  `until = min(end + 1 day T00:00:00Z, now)`. Reject `start > end` and
  `start` in the future with 400.
- All windows are half-open `[since, until)`. Chunks share boundaries
  (`chunk[i].until === chunk[i+1].since`) so no day is double-counted, and
  each chunk spans at most 30 days.
- Availability clamp: `since' = max(since, now - 90d)`;
  `partial = since' > since`.
- Previous period = `[since' - len, since')` where `len = until - since'`.
  Fetched **only if it lies fully inside the availability window**; otherwise
  `previous: null` (always the case when `partial` is true).

#### Fetching

- For each chunk call
  `GET graph.instagram.com/me/insights?metric=views&metric_type=total_value&period=day&since=..&until=..`
  and sum `total_value.value` across chunks.
- **Bounded I/O, not the shared `graphFetch`**: the shared helper has no
  request timeout and sleeps 60s on rate limits, which across up to 6 chunk
  calls can blow the edge function's wall-clock budget. This route uses a
  route-local bounded fetch: `AbortSignal.timeout(10_000)` per Graph call, no
  sleep-and-retry on rate limits (a rate-limited chunk is a failed chunk), and
  the token-expired (code 190) detection kept identical. The shared
  `graphFetch` is left untouched for the other routes.
- **A failed chunk fails the whole request** (throw). No silent zero-filling:
  a partial sum would look authoritative and, worse, be cached. Because
  `getCachedOrFetch` only writes the cache after `fetchFn` resolves, a thrown
  chunk error also guarantees no cache write. The client sees the generic
  error path and the card shows the unavailable state; details are logged
  server-side only.
- Cache: existing `getCachedOrFetch`, TTL 6h, cache key `views_{days}` or
  `views_{start}_{end}`. A `?refresh=1` query param skips the cache **read**
  (still writes the fresh result); the frontend sends it only right after a
  manual "Sincronizar Dados" (see below).
- Response shape:

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

- `services/analytics.ts`: new
  `getAccountViews(clientId, days, dateRange?, refresh?)` using the existing
  `fetchEdge` helper. Returns `{ current, previous, partial, fetchedAt } | null`
  (null on any fetch error, matching `fetchEdge` semantics).
- `AnalyticsContaPage`: new independent `useQuery` keyed
  `['analytics-views', clientId, overviewDays, periodStart, periodEnd]` so the
  seven existing DB-backed KPIs keep rendering without waiting on the IG API.
- **Manual sync coherence**: `handleSync` today invalidates only local query
  caches, which would leave this KPI serving the 6h server cache after the
  user explicitly asked for fresh data. Fix: a `forceRefresh` ref set to true
  in `handleSync` before invalidating a new `['analytics-views', clientId]`
  key; the queryFn passes `refresh=1` when the ref is set and clears it after
  use. Period switches keep using the server cache (no `refresh`).
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
### Explicitly out of scope

- No migration, no cron change, no renaming of the legacy `impressions*` /
  `profile_views*` fields.
- No daily views storage (would make >90d periods accurate over time); possible
  follow-up slice.
- No report changes. The in-page HTML export (`handleGenerateReport`) turned
  out to be dead code: no button invokes it; the visible "Gerar Relatório"
  button calls the scheduled-report pipeline (`handleGenerateScheduledReport`,
  report-generator-v2 edge function). Adding Visualizações to the real report
  pipeline is a separate follow-up; the dead export is flagged separately as
  cleanup.
- The dead client-side `overview.impressions` delta (always 0: the query never
  selects the column) stays as-is; flagged separately as cleanup.
- The stale `GET /overview/:clientId` edge route stays untouched.

## Error handling summary

| Case | Behavior |
| --- | --- |
| IG token expired (code 190) | Route returns error; card shows `—` + `Indisponível no momento` |
| Any chunk fails (error, timeout, rate limit) | Whole request fails, nothing cached; card shows the unavailable state; details logged server-side only |
| Malformed params (`days` + range, reversed range, future start) | 400, generic message |
| Period > 90d | Clamped total, `partial: true`, chip `máx. 90d` |
| Previous period out of window | `previous: null`, no delta chip |
| Manual "Sincronizar Dados" | Views refetched with `refresh=1`, bypassing the 6h server cache |
| No IG account connected | Page already gates on account existence before the KPI grid renders |

## Testing

- **Deno (`supabase/functions/__tests__`)**: unit tests for the pure helpers
  (param validation including the 400 cases, range clamp to 90d, ≤30-day
  chunking with shared half-open boundaries, previous-window computation, and
  chunk-sum **throwing** when any chunk fails). Helpers live in a small module
  next to the function (e.g. `instagram-analytics/views.ts`) so they are
  importable without serving the function.
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
