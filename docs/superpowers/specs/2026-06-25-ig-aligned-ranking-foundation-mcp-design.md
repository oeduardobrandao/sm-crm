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

Add `instagram_posts.unavailable_metrics text[] NOT NULL DEFAULT '{}'`.

Tokens use the DB column names: `reach`, `impressions`, `saved`, `shares`,
`likes`, `comments`. A token in the array means "the API did not return this
metric at the last sync, and the stored count is a preserved/default value, not a
fresh `0`." Count columns stay `NOT NULL DEFAULT 0`, so the existing Analytics
consumers (`instagram-analytics`, `instagram-report-generator`, the CRM Analytics
pages, `hub-posts`) are **unaffected** — they keep reading numbers. Only the
MCP rate layer consults `unavailable_metrics`.

## Sync changes

Three per-post upsert sites build and write metrics; all three change the same
way:
- `instagram-integration/index.ts:369` (connect, per-post upsert)
- `instagram-integration/index.ts:614` (refresh, batch `allPostData`)
- `instagram-sync-cron/index.ts:276` (cron, batch `allPostData`)

Changes:
1. **Fetch `shares` for all media types**, not just `VIDEO` (carousels/images are
   most of the content; share rate is IG's #2 signal). Request
   `reach,views,saved,shares` for every post.
2. **Track availability.** Begin with the insight metrics assumed unavailable;
   remove each from the unavailable set as it is parsed from the response.
   `likes`/`comments` come from the media node (`like_count`/`comments_count`) —
   mark unavailable only if the field is absent.
3. **Never overwrite with `0` on failure.** When a metric is not returned (per-type
   API rejection, or the whole insights call throwing), **omit that count column
   from the upsert payload** so the previous value is preserved on conflict-update
   (a brand-new row falls back to the column default `0`), and add the metric's
   token to `unavailable_metrics`. Always write `unavailable_metrics`.

Existing rows carry `unavailable_metrics = '{}'` until re-synced; the daily cron
heals them (no data backfill migration). Pre-fix carousel `shares` stay `0` but
get marked unavailable / repopulated on the next sync.

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
  (overall + per format, `MIN_SAMPLE`-gated) instead of raw counts. Payload also
  includes `weights` (the heuristic) with the "not Instagram's published weights"
  note, and keeps `reach` raw quartiles as context outside the score. *Contract
  change* — update its tests and the MCP help article.
- **`get_post`** → adds `views`, the four rates, `ig_score`, and the per-rate
  quartile tier (resolves the post's `client_id` via its workflow, then uses
  `loadClientRateDistributions`).
- **`list_posts`** → each row gains `views` + the four rates always (cheap,
  per-row). `ig_score` is included per row **only when `client_id` is provided**
  (it needs the client distribution); otherwise the field is `null`.
  `sort_by_metric` gains `share_rate | like_rate | save_rate | comment_rate |
  ig_score` (existing raw-count keys kept for back-compat). Rate sorts:
  descending, `null` last.
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
- **Deploy:** migration (`unavailable_metrics`); `mcp`, `instagram-integration`,
  `instagram-sync-cron` via `--use-api` (the Docker bundler is broken on CLI
  2.108.0); prod + staging. `instagram-integration`/`instagram-sync-cron` keep
  their existing deploy flags. Restore `deno.lock` + `npm ci` after.

## Out of scope (Project 2)

- The CRM Analytics UI, `instagram-analytics`, `instagram-report-generator`, and
  the AI portfolio analysis switching to the rate/score model.
- Syncing reels watch-time as a skip-rate proxy.
- Any change making the count columns nullable.

## Testing summary

- Deno unit tests for all `content.ts` helpers (ties, zero views, missing
  metrics, small samples) + extended `mcp-metrics_test.ts`.
- `deno check` on changed edge functions; `npm run build` green.
- Post-deploy live check via the prod MCP tools: `get_performance_baseline`
  returns rate quartiles; `list_posts` `sort_by_metric=ig_score` (with
  `client_id`) ranks; `get_post` returns rates + score + tiers.
