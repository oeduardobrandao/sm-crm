# Instagram post action metrics (reposts, profile visits, follows, bio link taps)

Status: approved design, 2026-09-29
Mockups: https://claude.ai/artifact/49HycgcaWpHk8ZZnYbM8mx

## Goal

Show four per-post Instagram metrics the app's own "Post insights" screen shows and
the CRM doesn't: **Reposts**, **Visitas ao perfil**, **Novos seguidores** and
**Toques no link da bio**. All four come from the media insights endpoint we
already call.

| UI label | Graph API | Column |
|---|---|---|
| Reposts | `reposts` | `reposts` |
| Visitas ao perfil | `profile_visits` | `profile_visits` |
| Novos seguidores | `follows` | `follows` |
| Toques no link da bio | `profile_activity` with `breakdown=action_type`, result `bio_link_clicked` | `bio_link_clicks` |

Out of scope: Hub top posts, report blocks, the client's "Últimos posts" card, MCP
`get_post` / performance baseline, AI narrative, account-level KPIs, and per-post
views-over-time, audience split and demographics (not in the API).

## Decisions

1. **Reposts do not enter the engagement rate or IG Score.** Adding them would shift
   every post's rate at once and penalise posts synced before this change.
2. **New columns are nullable. `NULL` means "no data".** The UI renders `NULL` as "—",
   never 0. No backfill UPDATE. This differs from the older metric columns (default 0 +
   `unavailable_metrics`) on purpose: a 0 here reads as "this post brought no one".
3. **No hard-coded Reels exclusion.** Meta documents `follows`, `profile_visits` and
   `profile_activity` for FEED and STORY only; `reposts` also covers REELS. The sync
   still asks for all four on every post and stores whatever comes back. The first prod
   sync tells us empirically whether Reels return them. If they consistently don't, a
   `media_product_type` gate that skips the wasted call is a follow-up.
4. **Preserve on miss.** If a sync doesn't return a metric, the previous stored value is
   kept (may be `NULL`), same as the existing metrics.

## Data

Migration `supabase/migrations/20260929000001_instagram_post_action_metrics.sql`:

```sql
ALTER TABLE instagram_posts
  ADD COLUMN IF NOT EXISTS reposts integer,
  ADD COLUMN IF NOT EXISTS profile_visits integer,
  ADD COLUMN IF NOT EXISTS follows integer,
  ADD COLUMN IF NOT EXISTS bio_link_clicks integer;
```

No grants change: `instagram_posts` has no column-level allowlist; the CRM reads it with
`select('*')` under the existing RLS policy.

Naming note: `profile_visits` is the per-post metric and is unrelated to the
account-level `profile_views*` columns (the cron writes real `profile_views` there; the
integration connect/refresh paths still write a mislabeled value). Don't touch those.

## Fetch (`supabase/functions/_shared/instagram-metrics.ts`)

Per post, three requests to `graph.instagram.com/{media-id}/insights`:

1. **Core, unchanged:** `reach,views,saved,shares`, with the existing retry without
   `shares`. Nothing about the new metrics can affect this call.
2. **Actions:** `reposts,follows,profile_visits`. On an error response whose Graph
   `error.code` is NOT transient or auth (transient/auth = 1, 2, 4, 9, 17, 32, 613, 190),
   retry once with `reposts` alone; the other two are then absent. On a transient or
   auth error, or a timeout, don't retry: all three are absent for this sync and keep
   their previous stored values.
3. **Bio link:** `profile_activity&breakdown=action_type`. Must be its own request: Meta
   errors when a breakdown is combined with metrics that don't support it. Parse
   `data[0].total_value.breakdowns[0].results[]`, take the result whose
   `dimension_values[0]` equals `bio_link_clicked` case-insensitively. When the response
   is valid but has no such result, the value is 0 (the account had no taps). When the
   request errors or the shape is unexpected, it is absent.

Calls 2 and 3 run in parallel with call 1. Each failure is isolated: a thrown fetch or
an error body in one call never removes values from another.

Every insights request (the existing core call included) carries
`signal: AbortSignal.timeout(10_000)`; a timeout counts as absent. The edge runtime
kills isolates that hang on I/O, and today's helper has no bound at all.

The connect callback loops over posts serially (pre-existing). Because the three calls
per post run concurrently, its wall-clock time per post stays roughly the same; no
restructuring of that loop is in scope. The `last_synced_at` stamp semantics are also
unchanged.

Parsing for calls 1 and 2 keeps reading `values[0].value` (lifetime metrics), falling
back to `total_value.value` in case Meta returns that shape.

Cost: 1 → 3 calls per post per sync. A 50-post manual refresh goes from ~50 to ~150
calls; the hourly cron touches only posts from the last 30 days.

`fetchPostInsights` return shape extends to the new tokens (`reposts`, `profile_visits`,
`follows`, `bio_link_clicks`) in `values` and `returned`.

`buildMetricFields` gains the four fields. For them, a miss keeps `existing?.[token]`
and falls back to `null` (not 0). Missed new tokens are added to `unavailable_metrics`,
same as the existing ones.

## Sync sites

Three places call `fetchPostInsights` + `buildMetricFields`:

- `instagram-integration/index.ts` connect (~L487) and refresh (~L810): latest 50 posts.
- `instagram-sync-cron/index.ts` (~L302): posts from the last 30 days among the latest 50.

Each needs two edits:

- The `existingByPostId` select adds `reposts, profile_visits, follows, bio_link_clicks`.
  Without this, preservation silently fails.
- The upsert payload adds the four fields from `buildMetricFields`.

`instagram-analytics` needs no change.

## CRM

Type: `PostAnalytics` in `apps/crm/src/services/analytics.ts` adds
`reposts`, `profile_visits`, `follows`, `bio_link_clicks: number | null` and a derived
`follows_per_mil_reach: number | null` = `follows / reach * 1000`, null when `follows`
is null or `reach` is 0. Rows read before the migration has run yield `undefined`;
normalise to `null` in the mapper.

### A. Expanded row (`AnalyticsContaPage.tsx`, `post-detail-row`)

Replace the "Visualizações / Curtidas" spans with two groups under the caption and the
"Ver no Instagram" link:

- **Interações:** Curtidas, Comentários, Reposts, Compartilhamentos, Salvamentos.
- **Ações após a visualização:** Visitas ao perfil, Novos seguidores, Toques no link da
  bio, plus the line "1 novo seguidor a cada N contas alcançadas" (N = round(reach /
  follows)) when follows > 0 and reach > 0.

A null value renders "—" with a metric-specific `title`: when the metric's token is in
the post's `unavailable_metrics` (the last sync asked and got nothing),
"O Instagram não retornou este dado na última sincronização"; otherwise
"Sem dado para este post" (no "ainda": posts outside the sync window are never refreshed). No Reels-specific copy until the first prod sync
confirms what Reels return. Fix `colSpan` to the real column count (12 after B).

### B. Table column

Add sortable "Novos seg." (key `follows`) after "Compart.". Null → "—" with the same
tooltip rules.

### C. "Ver mais" drawer

`RankedPostOrderBy` adds `reposts`, `profile_visits`, `follows`,
`follows_per_mil_reach`. Options, in the select: "Reposts", "Visitas ao perfil",
"Novos seguidores" after "Compart."; "Seguidores/mil alcançados" after
"Coment./visualização".

### D. Ranked post card

Fourth chip with lucide `UserPlus` and `follows`, on the carousel cards
(`RankedPostCard`) and on the items of the "Ver mais" drawer, which repeat the same
chips. Hidden when `follows` is null.

### Sorting

Nulls sort last in both directions, in both places:

- `getPostsAnalytics` (`services/analytics.ts`): the generic branch does
  `(a as any)[col] ?? 0`, so the four new columns and `follows_per_mil_reach` go
  through the nulls-last branch with `derivedCols`, and are accepted as valid sort keys.
- `rankedDrawerPosts` switch (`AnalyticsContaPage.tsx`): new cases use the nulls-last
  comparator already used for `ig_score`.

Extract one shared `compareNullableNumber(a, b, dir)` helper for both instead of a
third copy of the pattern.

## Tests

Deno (`supabase/functions/__tests__/instagram-metrics_test.ts`). Existing tests mock one
URL per post; update them for three calls (route the fake `fetchFn` by URL).

- Actions call parsed into the four tokens; `returned` reflects what came back.
- Actions error → retry with `reposts` only; follows/profile_visits absent.
- Breakdown parsed case-insensitively; valid response with no `bio_link_clicked` → 0;
  error → absent.
- A failure in call 2 or 3 leaves call 1's values intact, and the reverse.
- `buildMetricFields`: new tokens preserve the previous value, fall back to `null`
  (not 0) on a new row, and are listed in `unavailable_metrics` when missed.

Vitest:

- `services/__tests__/analytics.test.ts`: sort by `follows` puts nulls last asc and
  desc; `follows_per_mil_reach` computed and null-safe; pre-migration rows (fields
  undefined) map to null.
- `pages/analytics-conta/__tests__/AnalyticsContaPage.test.tsx`: expanded row renders
  the new metrics and "—" for null; the column renders; the ranked card hides the chip
  on null.

## Deploy order

Merging ships the CRM on Vercel immediately, so backend first:

1. `npx supabase db push` for the migration (prod and staging).
2. Deploy `instagram-integration` and `instagram-sync-cron` with `--use-api`,
   `--no-verify-jwt` and an explicit `--project-ref`.
3. Merge.

The frontend tolerates missing columns (undefined → null → "—"), but the two sync
functions do NOT: deployed before the migration (or with the migration rolled
back), their `existingByPostId` select errors and every `instagram_posts` upsert
fails, so metric syncing stops for every account. Migration first is mandatory.
After `db push`, confirm PostgREST sees the columns (e.g. a REST
`select=reposts&limit=1` on `instagram_posts`) before deploying the functions, on
staging and prod.

## Verification after deploy

Click "Sincronizar Dados" on a real connected account with both feed posts and Reels, then
check `instagram_posts` for the four columns and `unavailable_metrics` on Reels rows.
That answers decision 3 and gives the numbers to compare against the Instagram app.
