# IG-Aligned Ranking — Analytics UI (Project 2) — Design

**Date:** 2026-06-25
**Status:** Approved (brainstorming complete; ready for implementation plan)
**Predecessor:** `2026-06-25-ig-aligned-ranking-foundation-mcp-design.md` (Project 1 — shipped as PR #158: rate/score model + MCP tools + sync capturing `shares` for all media types + `unavailable_metrics` marker column).

## Goal

Surface the IG-aligned engagement model (per-view **rates** + the 0–100 **`ig_score`** + the per-client+format **baseline**) built in Project 1 inside the CRM Analytics UI — the portfolio page (`apps/crm/src/pages/analytics/AnalyticsPage.tsx`) and the per-client page (`apps/crm/src/pages/analytics-conta/AnalyticsContaPage.tsx`) — so agency staff see the same engagement-quality lens an MCP-connected agent sees.

## Scope decisions (locked during brainstorming)

1. **Both pages** — portfolio gets per-view rates; per-client gets rates + `ig_score` + the baseline card.
2. **Additive only** — reach stays the default ranking everywhere. The IG-aligned metrics are added as extra sort options, columns, and displays. No existing default ordering changes. Account-level `engagement_rate_avg` stays reach-based and is **not** touched.
3. **Portfolio = rates only.** `ig_score` is **not** computed on the portfolio page (mixed clients + reach-windowed query → biased distribution). The portfolio page gets the four exact per-view rates as sort options + per-row display. `ig_score` is reserved for the per-client page where the distribution is sound.
4. **Per-client score window = full history (match MCP).** `ig_score` and the baseline are computed against the client's **entire** post history (no period filter), exactly like the MCP's `loadClientRateDistributions`. The number a user sees in the CRM equals what an MCP agent reports for the same post. The per-post **rates** still display for whatever posts are shown in the selected period.
5. **Baseline card layout = "rate strips" (Variant B).** One horizontal strip per rate, ordered by IG weight (Compartilhamentos 40% → Curtidas 30% → Salvos 20% → Comentários 10%), each with a p25–p75 bar and the median marked, plus per-format breakdown text and the weights/skip-repost caveat.

## Global constraints

- **Rates are raw fractions.** `computeRates` returns `0.04`, not `4`. Internal values stay fractions; format to `%` (or another unit) **only at render**.
- **`ig_score` is 0–100**, `null` when the client+format has `< MIN_SAMPLE` (5) samples (with format → all-formats fallback, then `null`).
- **`MIN_SAMPLE = 5`**, **weights** `share_rate 0.40 / like_rate 0.30 / save_rate 0.20 / comment_rate 0.10` — copied from the source of truth, never re-derived.
- **Tenant safety unchanged.** Every Supabase read stays RLS-filtered exactly as today (the CRM app uses the user's session, not service-role). No new tenant surface; all changes are additive columns + one new full-history read scoped by the same `client_id → instagram_accounts` chain.
- **No cross-boundary import.** The frontend must not import from `supabase/functions/**` (Deno/Vite boundary — see `apps/crm/src/lib/mcp-scopes.ts`). Pure math is **ported** with a source-of-truth comment + a drift-guard test.
- **Portuguese UI**, Mesaas design system (brand `#eab308`, DM Sans / Playfair / DM Mono, card radius), `sanitizeUrl()` for any external `href`.

## Architecture

### New shared module: `apps/crm/src/lib/ig-rates.ts`

A verbatim port of the pure helpers from `supabase/functions/mcp/content.ts`, plus small pure glue. Header comment states: *"Mirror of `supabase/functions/mcp/content.ts` — keep in sync. Cannot import across the Deno/Vite boundary (see `lib/mcp-scopes.ts`)."*

Ported (identical signatures + behavior):
- `type RateKey = "share_rate" | "like_rate" | "save_rate" | "comment_rate"`
- `type Rates = Record<RateKey, number | null>`
- `const IG_RATE_WEIGHTS: Record<RateKey, number>` `{ share_rate:.40, like_rate:.30, save_rate:.20, comment_rate:.10 }`
- `const MIN_SAMPLE = 5`
- `interface Quartiles { p25; p50; p75 }`
- `function quartiles(values: number[]): Quartiles | null`
- `type PerformanceTier` + `function performanceTier(value, q): PerformanceTier`
- `function computeRates(counts: {shares;likes;saved;comments;impressions}, unavailable?: string[]): Rates` — real `0` stays `0`, `unavailable` → `null`, `impressions` `0`/unavailable → all `null`.
- `function percentileRank(value, sample): number | null` — midrank `(less + 0.5*equal) / n`.
- `function igAlignedScore(rates, distributions: Record<RateKey, number[]>): number | null` — weighted percentile, renormalized over present components, `MIN_SAMPLE` gate, returns 0–100.

CRM-side pure glue (built on the above):
- `interface DistBuckets = Record<RateKey, number[]> & { reach: number[] }`
- `function buildRateDistributions(rows: PostMetricRow[]): { overall: DistBuckets; byFormat: Record<string, DistBuckets> }` — mirror of the in-memory aggregation loop inside the MCP's `loadClientRateDistributions` (queries.ts:524-539).
- `function selectRateSamples(format, dists): Record<RateKey, number[]>` — port of queries.ts:543-555 (per rate, use the format sample if `≥ MIN_SAMPLE`, else overall).
- `function scorePost(post: {media_type; rates}, dists): number | null` — `igAlignedScore(post.rates, selectRateSamples(post.media_type, dists))`.

`PostMetricRow` (input to `buildRateDistributions`): `{ media_type: string|null; reach: number; impressions: number; saved: number; shares: number; likes: number; comments: number; unavailable_metrics: string[] }`.

### Data layer (`apps/crm/src/services/analytics.ts`)

**Portfolio — `getPortfolioSummary` (analytics.ts:218)**
- Only the **`topPostsRaw`** select (analytics.ts:394) gains `impressions, unavailable_metrics`. The `allRecentPosts` aggregate select (~:296) is **untouched** (account averages stay reach-based).
- `PortfolioTopPost` (analytics.ts:158) gains:
  - `views: number` (= `impressions`)
  - `rates: Rates`
  - `unavailable_metrics: string[]`
- In the `allRankedPosts` map (analytics.ts:411), compute `rates = computeRates({ shares, likes, saved, comments, impressions }, unavailable_metrics)` and `views = impressions`. Default order (by `reach`) unchanged.

**Per-client — `getPostsAnalytics` (analytics.ts:571)**
- Already `select('*')` → `impressions`, `shares`, `unavailable_metrics` present.
- `PostAnalytics` (analytics.ts:101) gains: `views: number` (= `impressions`), `rates: Rates`, `unavailable_metrics: string[]`, `ig_score: number | null`.
- Signature gains an optional trailing param: `dists?: { overall: DistBuckets; byFormat: Record<string, DistBuckets> }`.
- In the enrich step (analytics.ts:619): compute `rates`; when `dists` provided, compute `ig_score = scorePost({media_type, rates}, dists)`, else `ig_score = null`.
- `validCols` (analytics.ts:631) gains `share_rate, like_rate, save_rate, comment_rate, ig_score`. Because rate keys live inside `rates` (not top-level), the sort comparator resolves them via a small accessor (`rates[col]` for rate keys, `ig_score` top-level, else `p[col]`). `null` sorts to the bottom regardless of direction (so under-sampled posts don't crowd the top of an `ig_score` sort).

**New — `getClientRateBaseline(clientId)`**
- Mirrors the MCP exactly: same source as `loadClientRateDistributions` (queries.ts:511-521 — the client's accounts, then **all** posts, no date window) selecting `media_type, reach, impressions, saved, shares, likes, comments, unavailable_metrics`; same builder as `getPerformanceBaseline` (queries.ts:464-490).
- RLS-filtered through the user session; resolves the account chain via `client_id` (same pattern as `getAccountByClientId`).
- Returns the **documented intentional CRM shape** (header comment notes the extra `dists` is a CRM-only need for client-side scoring, not drift from the MCP):
  ```ts
  {
    sampleSize: number,
    dists: { overall: DistBuckets; byFormat: Record<string, DistBuckets> },   // CRM-only: feeds scorePost
    baseline: {                                                                // mirrors MCP get_performance_baseline
      sample_size: number,
      weights: typeof IG_RATE_WEIGHTS,
      weights_note: string,                                                    // same text as the MCP
      overall:   Record<RateKey | "reach", { n: number; quartiles: Quartiles | null }>,
      by_format: Record<string, Record<RateKey | "reach", { n: number; quartiles: Quartiles | null }>>,
    },
  }
  ```
  `quartiles` gated by `MIN_SAMPLE` (n<5 → `null`), exactly as queries.ts:477.

## Page wiring

### Per-client page (`AnalyticsContaPage.tsx`)

**Query wiring** (current posts query at lines 1040-1042):
- Add `const baselineQuery = useQuery({ queryKey: ['client-rate-baseline', clientId], queryFn: () => getClientRateBaseline(clientId), retry: false })` — keyed by `clientId` only (full history, **not** period). Reused for both scoring and the baseline card. **`retry: false`** because the baseline is non-critical: a slow retry chain must not delay the posts query (finding 3), and the page must render without it.
- Posts query: thread `baselineQuery.data?.dists` into `getPostsAnalytics(clientId, days, sort.col, sort.dir, dateRange, baselineQuery.data?.dists)`; key it on **`baselineQuery.dataUpdatedAt`** (not `sampleSize`) — `dataUpdatedAt` changes on **every** successful baseline fetch, so after a sync (which invalidates both queries) the posts refetch against the **fresh** dists even when the post count is unchanged but `impressions`/`shares` moved (finding 1). `sampleSize` alone would miss that case. Gate with `enabled: baselineQuery.isSuccess || baselineQuery.isError` (with `retry: false`, the error state is reached immediately, so an `ig_score` sort isn't a no-op on first paint and a baseline failure doesn't block posts; `dists` undefined → `ig_score` null → sort falls back to `posted_at`).
- The existing sync handler's `invalidateQueries` list adds `['client-rate-baseline', clientId]`. With `dataUpdatedAt` in the posts key, the baseline refetch then drives a posts refetch against the new dists automatically.

**Baseline Instagram card (Variant B)** — placed near "Desempenho por Tipo" (the format-performance section, ~line 1805):
- Title "Baseline Instagram" + subtitle "Histórico completo · {sampleSize} posts · por visualização".
- One strip per rate in weight order; each strip: rate name + `peso NN%`, median (p50) value (formatted from raw fraction), a p25–p75 bar with the median marked, and a per-format breakdown line (`Reels x% · Carrossel y% · Imagem z%`, with `n<5` where a format is under-sampled).
- Footer caveat (same spirit as MCP `weights_note`): *"Heurística interna alinhada ao IG (compart.>curt.>salvos>coment.) — não são os pesos oficiais do Instagram. Taxa de skip e repost não estão na API."*
- One-liner under the title: *"Pontuado vs. histórico completo do cliente — igual ao que o agente vê."*
- Hidden (or shows an "amostra insuficiente" empty state) when `sampleSize === 0`.

**`ig_score` column** in "Performance de Conteúdo" (table at ~line 1586-1700):
- New sortable column header "IG Score" (uses the existing `handleSortChange('ig_score')`).
- Cell: a 0–100 badge colored by **score band** — `≥ 75` success (green), `40–74` neutral/secondary, `< 40` danger. `null` → "—" with tooltip *"amostra insuficiente (<5)"*. (Coloring by score band, **not** `performanceTier` — `ig_score` is already a 0–100 composite, so a single fixed band is the legible choice. `performanceTier` stays reserved for tiering an individual rate against its quartiles, if ever surfaced.)

**Content-rank drawer** (sort options at lines 1104-1128, `rankedOrderBy`):
- Add options: `ig_score`, `share_rate`, `like_rate`, `save_rate`, `comment_rate`. Extend the `switch` with the corresponding comparators (rate keys via `rates[...]`, `null` to the bottom).
- Each drawer row shows the post's `ig_score` chip + the relevant per-view rate alongside existing counts.

### Portfolio page (`AnalyticsPage.tsx`)

**Drawer "Ordenar por"** (Select at lines 1627-1639; sort switch in `drawerPosts` memo at lines 449-471):
- Add four options with PT labels: `share_rate` "Compart./visualização", `like_rate` "Curt./visualização", `save_rate` "Salvos/visualização", `comment_rate` "Coment./visualização".
- Extend the sort `switch` with comparators reading `p.rates[key]` (raw fraction; `null` to the bottom).
- Each drawer row (lines 1799-1849) shows the matching per-view rate (formatted) next to the existing Alcance / Eng. / counts.
- Top-5 "Melhores Posts" / "Precisam de Atenção" cards stay reach-ranked. No `ig_score` anywhere on this page.

**Known limitation — reach-capped sample (finding 2).** `allRankedPosts` is built from `topPostsRaw`, which is ordered by `reach DESC` and **limited to 200** with `reach > 0` (analytics.ts:394-403). So a rate sort reorders only the top-200-by-reach subset of the period — a low-reach / high-share-rate post can be excluded entirely. This is consistent with decision 3 (the portfolio is the *approximate* surface; the per-client page is the complete one — `getPostsAnalytics` has **no** limit, so per-client rate sorting covers the full period). To avoid overstating coverage, when the active drawer sort is a rate (not reach), the drawer subtitle reads **"Top 200 por alcance, reordenado por {taxa}"**. Fetching the full unbiased period set for the portfolio drawer is recorded as a future enhancement (Out of scope), not done here — it would make every portfolio load heavier for a secondary surface.

## Rate display format

Render raw fractions as **percentage of views** with appropriate precision: `share/save/comment` rates are small, so show 1 decimal (e.g. `0.018 → "1,8%"`); a `null` rate (metric unavailable or 0 views) → "—". Centralize formatting in a tiny helper (`formatRate(value: number | null): string`) used by both pages, PT-BR locale.

## Error handling

- All scoring is pure and null-safe. **`computeRates` null semantics (match `content.ts:106-122` exactly):** a missing/non-array `unavailable_metrics` normalizes to `[]` (rates computed normally — **not** all-null); missing or `≤ 0` **`impressions`** (views), or `impressions` listed in `unavailable_metrics`, → **all** rates `null`; a specific numerator listed in `unavailable_metrics` (e.g. `shares` on an older carousel) → that one rate `null`; a real `0` count with views present → `0` (a genuine value, kept in distributions). `null` rates are excluded from distributions and shown as "—". The port and `buildRateDistributions` must coerce `Array.isArray(unavailable_metrics) ? unavailable_metrics : []` (mirror `queries.ts:525`) since the DB column can come back `null`.
- `getClientRateBaseline` failure: posts query still runs (gated on `isFetched`); `ig_score` column shows "—"; baseline card hidden. No thrown error reaches the user; internal `console.error` only (consistent with the existing service functions).
- No raw error details surfaced (consistent with existing analytics service behavior).

## Testing

- **`apps/crm/src/lib/__tests__/ig-rates.test.ts`** — drift guard pinning the same values asserted by the Deno `content_test.ts`: `percentileRank` midrank `0.25` case, `igAlignedScore` renormalization over present components, `< MIN_SAMPLE` → `null`, `computeRates` 0-vs-`null` (real 0 stays 0; numerator in `unavailable` → null; `≤0`/unavailable views → all null; **missing/non-array `unavailable` → `[]`, rates computed normally**), `quartiles` linear interpolation, and `buildRateDistributions` coercing a `null` `unavailable_metrics` row.
- **`getClientRateBaseline` service test** — shape mirrors MCP `get_performance_baseline` (`sample_size`, `weights`, `weights_note`, `overall`, `by_format`; quartiles gated by `MIN_SAMPLE`); `dists` present for scoring.
- **Extend `apps/crm/src/pages/analytics/__tests__/AnalyticsPage.test.tsx`** — new rate sort options work; drawer rows render rates; fixtures updated for the added `views`/`rates`/`unavailable_metrics` fields.
- **Extend `apps/crm/src/pages/analytics-conta/__tests__/AnalyticsContaPage.test.tsx`** — baseline card renders (and hides at `sampleSize 0`); `ig_score` column + sort; "—" for under-sampled; fixtures updated.
- Per the contract-change rule, grep both app test suites for old `PortfolioTopPost`/`PostAnalytics` fixture shapes and update; run `npm run test` + `npm run build` (typecheck). (Deno suite unaffected — no edge-function changes in this project.)

## Out of scope (future)

- **Full unbiased period-set fetch for the portfolio drawer** so rate sorts cover all period posts (not just top-200-by-reach). Deferred per finding 2 — labeled instead. Would mean a separate larger/lazy query for the portfolio.
- Edge functions `instagram-analytics` / `instagram-report-generator` (PDF/email reports) — not changed here.
- AI portfolio/account analysis prompts consuming `ig_score` — separate follow-up.
- Reels watch-time as a skip-rate proxy — separate follow-up.
