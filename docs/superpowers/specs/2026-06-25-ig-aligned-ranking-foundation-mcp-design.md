# IG-Aligned Ranking — Foundation + MCP (Project 1) — Design

**Date:** 2026-06-25
**Status:** Approved (design)
**Author:** Eduardo + Claude

## Goal

Rank Instagram posts by *engagement rates* in Instagram's order of importance —
instead of raw counts — and expose that through the MCP tools (performance
baseline, `list_posts`, `get_post`). This is **Project 1 of 2**: it builds the
shared scoring model + the MCP surface + the sync data needed to feed it.
**Project 2** (deferred) rolls the same model into the Analytics UI + AI analysis.

## Background & rationale

Instagram's in-app "O que afeta suas visualizações" panel lists the signals that
drive reach, **in order of importance**: skipped-reels rate, *share* rate, *like*
rate, *save* rate, repost rate, *comment* rate (the percentages shown are the
account's own rates, not weights). The platform today ranks by **raw counts**
(`sort_by_metric`, baseline quartiles, Analytics "best posts"), which favors
high-reach posts rather than what Instagram actually rewards.

Two hard constraints:
- **Skip rate and repost are not available** via the Meta Graph API (app-only
  Professional-Dashboard metrics), so they are excluded — documented, never faked.
- Meta **publishes no numeric ranking weights**. Public guidance (e.g. Adam
  Mosseri, reported 2025-04: https://www.businessinsider.com/instagram-reach-top-priorities-creators-content-dms-adam-mosseri-2025-4)
  emphasizes shares/sends as a major reach signal, but gives no split. Our weights
  are therefore an **internal IG-aligned heuristic**, labeled as such everywhere
  they surface.

## The scoring model (pure helpers in `supabase/functions/mcp/content.ts`)

### Rates

Per post, each rate = numerator count ÷ **views** (stored in the `impressions`
column; the panel measures per-*visualização*). `computeRates` returns
`share_rate`, `like_rate`, `save_rate`, `comment_rate`, each of which is:

- a **number** (possibly `0`) when its numerator metric was returned by the API
  and `views > 0`;
- **`null`** when the numerator metric was *not returned* (listed in the post's
  `unavailable_metrics`), or when `views` is unavailable or `0`.

This is the crux of **0 ≠ missing**: a returned `0` is a real rate of `0`; an
absent metric is `null` and is excluded from scoring, never treated as `0`.

### Weights (internal heuristic)

`IG_RATE_WEIGHTS`, normalized, in IG's measurable order:
`share_rate 0.40 · like_rate 0.30 · save_rate 0.20 · comment_rate 0.10`.
A code comment and the baseline payload both label these *"an internal
IG-aligned heuristic, not Instagram's published weights."*

### Composite `ig_score` (0–100), percentile-normalized

A weighted sum of raw rates would be dominated by like-rate's magnitude, so each
rate is first normalized to its **percentile rank within the client's own
distribution** for that rate, then IG-weighted.

- `percentileRank(value, sample)` → midrank percentile:
  `(count(< value) + 0.5 · count(== value)) / n`; returns `null` for an empty
  sample or a `null` value.
- `igAlignedScore(rates, distributions)`: for each rate that is non-`null` **and**
  has a usable distribution, compute its percentile, multiply by its weight; sum
  the weighted percentiles and divide by the sum of the weights actually used
  (renormalization), then ×100. If no component is usable → `ig_score: null`.
  A missing component (e.g. no share data) drops out and the others renormalize —
  it never zeroes the score.

### Small-sample behavior (no fake precision)

`MIN_SAMPLE = 5`. Distribution selection for a post of format *F*:
1. client's posts **of format F** whose rate is non-`null`, if ≥ 5 → use it;
2. else client's posts **across all formats**, if ≥ 5 → use it;
3. else → `ig_score: null`.

The same `MIN_SAMPLE` gate applies to baseline quartile buckets: any
overall/per-format bucket with < 5 non-`null` values returns `null` quartiles
rather than quartiles over 1–4 points.

### Explainable tiers

Quartiles stay for human-readable tiers: `performanceTier` (top_quartile /
above_median / below_median / bottom_quartile) is computed per rate against the
client baseline and surfaced in `get_post`. (Percentile drives the score;
quartile tiers drive the human label.)

## Data model (one migration)

`instagram_posts` count columns (`reach`, `impressions`, `saved`, `shares`,
`likes`, `comments`) are `integer DEFAULT 0` and **nullable** — `DEFAULT 0` with
no `NOT NULL` (`20260301_baseline_schema.sql:200-205`). We keep them numeric
(never write `NULL`) so the existing Analytics consumers (`instagram-analytics`,
`instagram-report-generator`, the CRM Analytics pages, `hub-posts`) are
unaffected, and add a separate marker column as the single source of truth for
availability.

The migration:
1. Adds `instagram_posts.unavailable_metrics text[] NOT NULL DEFAULT '{}'`.
   Tokens use the DB column names above. A token means "the API did not return
   this metric at the last sync; the stored count is a preserved/last-known value
   (or `0` for a brand-new row), not a fresh `0`." Only the MCP rate layer reads
   it; it is the source of truth for `null`-vs-`0`.
2. **Backfills historical rows** so old data doesn't poison baselines: the old
   sync fetched `shares` only for `media_type = 'VIDEO'`
   (`instagram-integration/index.ts:355-356`), so existing image/carousel rows have
   a real-looking `shares = 0`. Mark them unavailable:
   `UPDATE instagram_posts SET unavailable_metrics = array_append(unavailable_metrics, 'shares') WHERE media_type <> 'VIDEO' AND NOT ('shares' = ANY(unavailable_metrics));`
   (Other metrics were fetched for all media types historically, so only `shares`
   needs backfilling.)

## Sync changes

Three per-post upsert sites build and write metrics; all three change the same
way:
- `instagram-integration/index.ts:369` (connect, per-post upsert)
- `instagram-integration/index.ts:614` (refresh, batch `allPostData`)
- `instagram-sync-cron/index.ts:276` (cron, batch `allPostData`)

Changes:
1. **Fetch `shares` for all media types, with a fallback.** Request
   `reach,views,saved,shares` for every post (carousels/images are most of the
   content; share rate is IG's #2 signal). If the call is rejected because `shares`
   is unsupported for that media type, **retry with `reach,views,saved`** and mark
   only `shares` unavailable — a shares-only rejection must never cost us
   reach/views/saved.
2. **Track availability.** Begin with the insight metrics assumed unavailable;
   remove each from the unavailable set as it is parsed from the response.
   `likes`/`comments` come from the media node (`like_count`/`comments_count`) —
   mark unavailable only if the field is absent.
3. **Preserve previous; never overwrite with `0`; write complete payloads.**
   Omitting a column is *not* a reliable way to preserve it here: the count columns
   are only `DEFAULT 0` (not `NOT NULL`), and in PostgREST **bulk** upserts a key
   present in some rows but absent in others is unioned across the batch and filled
   with `null`/default (governed by `defaultToNull`), not preserved. Instead: read
   the existing rows for the batch's `instagram_post_id`s and build **complete
   payloads with explicit numeric values** for every count column — freshly-fetched
   value if available, else the previous value, else `0` (new row) — plus the
   computed `unavailable_metrics`. No omitted columns ⇒ no `defaultToNull`
   ambiguity, and an unavailable metric never clobbers a real previous value. Same
   logic for the single upsert (`instagram-integration:369`) and the two bulk
   upserts (`instagram-integration:614`, `instagram-sync-cron:276`).

The migration's backfill marks historical non-video `shares` unavailable
immediately (no wait for re-sync); the daily cron keeps `unavailable_metrics`
current thereafter. **Tests:** a conflict-update preserves a previous value when
its metric is unavailable this sync; a brand-new row inserts `0` and marks the
metric unavailable.

## MCP surface changes (`queries.ts`, `tools.ts`)

A shared helper `loadClientRateDistributions(d, clientId)` (used by the baseline,
`get_post`, and client-scoped `list_posts`) loads the client's `instagram_posts`
(media_type + counts + `unavailable_metrics`), computes each post's rates, and
returns per-format and overall arrays per rate — the distributions the percentile
and quartile functions consume. It is client-scoped via the client's
`instagram_account_id`s (after `verifyClient`).

`loadMetrics` is extended to also select `impressions` and `unavailable_metrics`
so rates can be computed for `list_posts`/`get_post` rows.

- **`get_performance_baseline`** → quartiles computed on the four **rates**
  (overall + per format) instead of raw counts. Each bucket is reported as
  `{ n, quartiles }`, where `n` = the count of non-`null` rate values in that
  bucket and `quartiles` is `null` when `n < MIN_SAMPLE` — so a consumer can
  distinguish "no posts" / "metric missing" / "under-sampled" instead of guessing
  at a bare `null`. Payload also includes `weights` (the heuristic) with the "not
  Instagram's published weights" note, and keeps `reach` (raw) as `{ n, quartiles }`
  context outside the score. *Contract change* — update its tests and the MCP help
  article.
- **`get_post`** → adds `views`, the four rates, `ig_score`, and the per-rate
  quartile tier (resolves the post's `client_id` via its workflow, then uses
  `loadClientRateDistributions`).
- **`list_posts`** → each row gains `views` + the four rates always (cheap,
  per-row). `ig_score` is included per row **only when `client_id` is provided**
  (it needs the client distribution); otherwise the field is `null`.
  `sort_by_metric` gains `share_rate | like_rate | save_rate | comment_rate |
  ig_score` (existing raw-count keys kept for back-compat). Rate sorts:
  descending, `null` last.
  **Derived-metric sorts limit *after* sorting.** Today the DB query applies
  `order(published_at).limit(limit)` *before* the in-memory metric sort
  (`queries.ts:251`), so a derived sort would rank only within the recency window
  and miss the true top-by-score posts. When `sort_by_metric` is any rate or
  `ig_score`, fetch the full matching set up to a safe cap (`DERIVED_SORT_CAP =
  500`, no early `published_at` limit), compute and sort, then slice to `limit`;
  if the cap truncated the set, surface that in the result rather than capping
  silently. Non-metric/default ordering keeps the existing `published_at` + `limit`
  path.
  **`ig_score` sort requires `client_id`** — without it, raise
  `McpInputError("ig_score sort requires client_id")` (no silent raw-rate
  fallback, which would undermine the normalization). With `client_id`, load the
  distributions once, score each row, sort descending `null` last.

`tools.ts`: extend the `sort_by_metric` zod enum; refresh `list_posts`/`get_post`
descriptions. Audit redactors unchanged (rates/score are derived, non-sensitive).

## Help article

Update MCP help article #2 ("O que o agente pode fazer") via the existing
idempotent `_kb_*` upsert pattern to describe rate-based metrics + `ig_score` and
that the baseline is now rate-based. One small migration upsert; no new article.

## Architecture & testing

- **`content.ts`** new pure, fail-closed helpers: `computeRates`,
  `IG_RATE_WEIGHTS`, `percentileRank`, `igAlignedScore`. Unit-tested (deno) like
  `quartiles`/`performanceTier`, with explicit cases for **ties (midrank), zero
  views, missing metrics (null vs 0), and small samples** (format→overall→null
  fallback).
- **`queries.ts`**: `loadClientRateDistributions`, baseline/list/get wiring;
  extend `mcp-metrics_test.ts` for the new row shapes + the `ig_score`-without-
  `client_id` rejection.
- **Deploy:** migration (`unavailable_metrics` column **+ historical non-video
  `shares` backfill**); `mcp`, `instagram-integration`, `instagram-sync-cron` via
  `--use-api` (the Docker bundler is broken on CLI 2.108.0); prod + staging.
  `instagram-integration`/`instagram-sync-cron` keep their existing deploy flags.
  Restore `deno.lock` + `npm ci` after.

## Out of scope (Project 2)

- The CRM Analytics UI, `instagram-analytics`, `instagram-report-generator`, and
  the AI portfolio analysis switching to the rate/score model.
- Syncing reels watch-time as a skip-rate proxy.
- Any change making the count columns nullable.

## Testing summary

- Deno unit tests for all `content.ts` helpers — `percentileRank` ties (midrank),
  `computeRates` zero views and missing-metric (`null` vs `0`), `igAlignedScore`
  small-sample fallback (format → all-formats → `null`) and component
  renormalization.
- Sync tests: conflict-update preserves a previous value when its metric is
  unavailable this sync; brand-new row inserts `0` + marks unavailable; the
  `shares`-rejection retry keeps reach/views/saved.
- `mcp-metrics_test.ts` extended: rate fields + `views` on rows; `{ n, quartiles }`
  baseline shape; `ig_score` sort without `client_id` rejected (`McpInputError`);
  derived-sort fetches up to the cap and slices after sorting.
- `deno check` on changed edge functions; `npm run build` green.
- Post-deploy live check via the prod MCP tools: `get_performance_baseline`
  returns `{ n, quartiles }` rate buckets; `list_posts` `sort_by_metric=ig_score`
  (with `client_id`) ranks; `get_post` returns rates + score + tiers.
