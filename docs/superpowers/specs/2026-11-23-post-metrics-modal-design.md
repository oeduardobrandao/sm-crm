# Métricas do post em pop-up, no estilo do Instagram

Date: 2026-11-23
Status: mockups approved, spec in review
Mockups: https://claude.ai/artifact/M6GzjFooXT16NGcn1hWdoq (5 screens, approved 2026-11-23 with the bigger post image)

## Intent

On the analytics Conta page (`/analytics/:clientId`, Instagram tab), clicking a post today
sends the user to Instagram. The full numbers only show up when a row of "Todos os posts" is
expanded. The user wants:

1. Clicking a post (the Melhores Posts carousel, the "Ver mais" list, and the posts table)
   opens the post's metrics. A small Instagram icon next to it still opens the post on Instagram.
2. The metrics open in a pop-up that looks like Instagram's own "Post insights" screen:
   - an icon row (likes, comments, reposts, sends, saves)
   - the headline numbers in soft cards (views, accounts reached, profile visits, new followers)
   - an "Engajamento" tab with the action and interaction lists
3. Every per-post metric the Instagram API offers is shown, including the ones we don't fetch yet.
4. A "views over time" curve with the pink line, like Instagram's.

Why: the agency reads post performance inside Mesaas to report to the client. Today that means
jumping to Instagram, or reading a dense expanded table row.

## Goals

- One shared "post metrics" view used by every post entry point on the Conta page, desktop and phone.
- The whole card or row opens the pop-up. The Instagram link is a separate, smaller control.
- All per-post metrics available from the Instagram API with Instagram Login are stored and shown.
  If one is missing, the reason is said in place ("—" plus a reason).
- A views/reach curve per post, drawn from our own periodic snapshots, plus the account's
  "post típico" reference line once there is enough history.

## Non-goals

These are impossible through the API, so they don't appear (and the Engajamento tab says so in one line):
- followers vs non-followers split
- likes per carousel slide
- view sources (feed, explore, profile)
- per-post audience

Also out of scope:
- `facebook_views` / `crossposted_views`. Each one throws when the post was not shared to Facebook,
  costs one more request per post, and applies to few of our clients.
- Backfilling a curve for posts published before the snapshots start.
- TikTok, YouTube and GMN post cards. Their strips keep linking out.
- The portfolio Analytics page (`/analytics`). Its phone strip keeps linking out.

## Anti-goals

- Showing a fake curve, meaning one that suggests detail we never measured.
- A metric showing `0` when we have no data. NULL stays "—", as it does today.
- Losing anything the expanded row offers today:
  - caption
  - the missing-metric reasons
  - the "1 novo seguidor a cada N contas alcançadas" line
  - the Comentários tab, behind `feature_instagram_comments_ai`
  - tags on phone

## What the API gives (researched 2026-11-23, Meta docs for Instagram media insights)

Media insights are lifetime-only: "Period is automatically set to `lifetime`". There are no breakdowns
except `action_type` on `profile_activity`.

| Metric | Types | We fetch today |
|---|---|---|
| reach, views, saved, shares | FEED, REELS | yes (views stored as `impressions`) |
| likes, comments | from the /media node | yes |
| follows, profile_visits | FEED only (Meta rejects for REELS) | yes |
| profile_activity, by action_type: BIO_LINK_CLICKED, CALL, DIRECTION, EMAIL, TEXT, OTHER | FEED only | only BIO_LINK_CLICKED |
| reposts | FEED, REELS (doc) | **no**: graph.instagram.com rejected it in Sept 2026, column `reposts` exists but is never written |
| total_interactions | FEED, REELS | no |
| ig_reels_avg_watch_time, ig_reels_video_view_total_time (ms) | REELS | no |
| reels_skip_rate | REELS | no ("estimated and in development") |

Data can lag up to 48 h. "Insights data is not available for any media within an Instagram Media
album" refers to album children; album-level insights already work in prod.

## Approaches considered

1. **A pop-up fed by a new edge route that calls the Graph API live when it opens.** Rejected:
   - it can't produce a curve (the data is lifetime-only)
   - it adds latency and Graph rate-limit cost to every click
   - the CRM already reads `instagram_posts` directly
2. **Pop-up over data we store, extra metrics stored by the existing syncs, curve from snapshots
   written by those syncs (chosen).** Every number is available instantly. The curve is honest: it
   only draws what we measured. The cost is that it only exists going forward.
3. **Keep the expanded row and restyle it.** Rejected: the user asked for a pop-up that the
   carousel and the list open too.

## Design

Two PRs, shipped in this order:
- **PR 1: frontend, no backend dependency.** The click change and the pop-up, using data already in
  `PostAnalytics`.
- **PR 2: backend plus the frontend bits that read it.** The new metrics, the snapshots, and the curve.

PR 1's pop-up already has the curve section's place. It is hidden until PR 2's data exists.

### 1. Click behaviour (PR 1)

- **`RankedPostCard`** (`AnalyticsContaPage.tsx`, the Melhores and "precisam de atenção"
  carousels):
  - It stops being an `<a>`. The card body is a `<button type="button">` that calls `onOpen(post)`.
  - A sibling `<a href={sanitizeUrl(permalink)} target="_blank" rel="noopener noreferrer"
    aria-label="Abrir no Instagram">` sits at the top-right of the thumbnail: a 32 px round white
    chip with the Instagram glyph.
  - No interactive element nests inside another.
  - The carousel's drag/scroll must not fire `onOpen`. Check how `InstagramPostCarousel` handles
    pointer drags. If it has no click-suppression after drag, add it there, guarded so only an
    actual drag (more than ~5 px of movement) suppresses.
- **"Ver mais" drawer rows** (the `Sheet` listing best/worst posts): same split. The row body is a
  button, and a 36 px square icon link with the Instagram glyph sits at the row's end. Opening the
  pop-up keeps the Sheet open underneath. Closing the pop-up returns focus to the row that opened it.
- **"Todos os posts" table rows:** a click opens the pop-up instead of toggling the inline expanded
  row. `ExpandedPostDetail` and the `post-detail-row` go away. The tags cell keeps its own click
  handling (`stopPropagation`). Rows become keyboard-openable (Enter/Space on the row's first cell
  button, or a row-level button; the plan picks the accessible pattern).
- **Phone (`ContaPhone`):**
  - The ranked strip's cards open the existing `PostDetailSheet` instead of linking out.
  - `RankedPostStrip` gets an optional `onSelect(post)` prop plus a separate Instagram icon link.
    Without the prop it behaves exactly as today, which keeps TikTok and the portfolio page unchanged.
  - The posts list already opens `PostDetailSheet`.
- **Instagram glyph:** use whatever the CRM already uses for Instagram, if anything. lucide's
  `Instagram` icon is deprecated but still exported by our lucide-react version; check. If absent,
  use a small inline SVG component in `components/instagram/`.

### 2. The pop-up (PR 1)

New component `PostMetricsView` (`pages/analytics-conta/components/PostMetricsView.tsx`), the
content only. Two hosts render it:
- desktop: `PostMetricsDialog`, a shadcn `Dialog`, about 720 px wide, scrolling inside
- phone: the existing `PostDetailSheet`, whose insights body is replaced by it

Its props are:
- `post: PostAnalytics`
- `clientId`
- `dists` (rate distributions, optional)
- `commentsEnabled`
- `history` (PR 2, optional)

Layout, top to bottom, matching the mockup:

1. **Header.**
   - Title "Métricas do post".
   - Two round icon buttons on the right: Instagram (link) and Fechar. On phone, Fechar is on the
     left and the Instagram link on the right.
2. **Post block.**
   - Thumbnail. Desktop: 176×220, Reels 132×234, `object-fit: cover`, 12 px radius. Phone: centered, 232×290.
   - Next to it on desktop, below it on phone:
     - the format badge ("Carrossel", "Reel", "Imagem", via the existing `formatMediaType`)
     - "Publicado em 21 de nov. às 18:02", in São Paulo time, the way the page already formats dates
     - the caption, clamped to 3 lines with "Ver mais" to expand
3. **Icon row.** Five columns, each with an icon, the number and a small label:
   - Curtidas (Heart)
   - Comentários (MessageCircle)
   - Reposts (Repeat2)
   - Envios (Send; this is the `shares` metric, which Instagram labels as sends)
   - Salvos (Bookmark)

   Numbers use pt-BR grouping. A null `reposts` shows "—" with the tooltip/reason. In PR 1,
   `reposts` is always null, so the Reposts column is hidden until a non-null value exists for the
   post. No column should say "—" for every post.
4. **Tabs** (underline style, like the mockup): Visão geral · Engajamento · Comentários · N.
   - Comentários only with `feature_instagram_comments_ai`. It mounts `PostCommentsPanel` lazily,
     only once the tab opens, as `ExpandedPostDetail` does today.
   - The tab resets to Visão geral when the post changes.
   - On phone the tabs are the existing `SegmentedControl`.
5. **Visão geral.**
   - **Resumo:** a 2-column grid of soft cards (`surface-1`, 12 px radius, label on top, a 24 px bold number).
     - FEED and carousel: Visualizações, Contas alcançadas, Visitas ao perfil, Novos seguidores.
     - REELS: Visualizações, Contas alcançadas, Tempo médio assistido, Tempo total assistido (PR 2;
       hidden in PR 1), then Visitas ao perfil and Novos seguidores as "—" cards with the reason
       ("O Instagram não informa … para Reels", from `missingActionMetricTitle`).
   - **Ratio strip:** small bordered tiles.
     - Engajamento (`engagement_rate`, green as today).
     - IG Score ("82 de 100", hidden when null).
     - Seguidores por mil alcançados (`follows_per_mil_reach`, hidden when null).
     - Reels, PR 2: "Pularam nos 3 primeiros segundos" (`reels_skip_rate`).
   - **Ao longo do tempo:** PR 2. In PR 1 the section is not rendered.
6. **Engajamento.**
   - **Ações após a visualização:** label/value rows.
     - Visitas ao perfil, Novos seguidores, Toques no link da bio.
     - PR 2 adds Toques em Enviar mensagem, Como chegar, Ligar and E-mail. Each row shows only
       when its value is non-null. The four new ones show only when non-zero, since most accounts
       aren't business profiles with those buttons.
     - Then the "1 novo seguidor a cada N contas alcançadas" line.
   - **Interações:** Curtidas, Comentários, Reposts (when non-null), Compartilhamentos, Salvamentos.
     PR 2 adds Total de interações (`total_interactions`, when non-null) under a hairline.
   - **Por visualização:** for each of the four per-view rates (`rates.share_rate`, `like_rate`,
     `save_rate`, `comment_rate`), a row with:
     - the label
     - a bar for this post's rate, plus a tick at the account's median for the same format
       (`dists.byFormat[type]` p50, falling back to `dists.overall`)
     - the value as a pt-BR percentage with 2 decimals

     The bar's scale is `max(post rate, p75 × 1.5)`, so the tick and the bar always fit. Rows with
     a null rate are hidden. The whole block is hidden without `dists`, or when the sample is below
     `MIN_SAMPLE`.
   - **Footnote:** "O Instagram não informa curtidas por foto do carrossel, de onde vieram as
     visualizações nem o público do post."
7. **Footer:** "Dados da API oficial do Instagram. Podem levar até 48 h para fechar." on the left,
   "Atualizado há X" on the right (from `synced_at`; omitted when absent). This follows the CLAUDE.md
   copy rule: "API oficial" yes, never "aprovado pela Meta".

Styling:
- The CRM legacy tokens (`--card-bg`, `--surface-1/2`, `--text-main/muted/light`, `--border-color`,
  `--success`), with the Vidro look and dark mode both checked.
- No em dashes in copy.
- Numbers use `font-variant-numeric: tabular-nums`.
- Icons from `lucide-react`.

`PostInsightsDetail` and `ActionMetricValue`: `ActionMetricValue` stays, since the table cells
use it. `PostInsightsDetail` is replaced by the Engajamento tab and deleted, along with its test,
which moves to the new component.

### 3. New metrics (PR 2)

Migration (next free version above main's tail at PR-open time), adding to `instagram_posts`.
Every column is nullable, with no backfill, and NULL means no data:
- `total_interactions integer`
- `profile_call_clicks integer`, `profile_direction_clicks integer`, `profile_email_clicks integer`,
  `profile_text_clicks integer`
- `reels_avg_watch_time_ms integer`, `reels_total_watch_time_ms bigint`
- `reels_skip_rate numeric`. Store what the API returns. The implementer confirms the unit (fraction
  vs percent) from a live response before writing the formatter.
- `reposts` already exists; it starts being written.

`instagram_posts` has no column-level grant allowlist (unlike `clientes`/`membros`), so `select('*')`
picks the new columns up. Confirm with `\dp instagram_posts` during implementation.

`_shared/instagram-metrics.ts`:
- The bio call already requests `profile_activity&breakdown=action_type`. Generalize
  `parseBioLinkClicks` into `parseProfileActivity`, which returns all five counts with the same
  "valid but absent = 0, malformed = undefined" semantics.
- New isolated **extras** request per post, pinned to `GRAPH_VERSION`:
  - FEED: `metric=reposts,total_interactions`
  - REELS: `metric=reposts,total_interactions,ig_reels_avg_watch_time,ig_reels_video_view_total_time,reels_skip_rate`
  - If it is rejected and the error names `reposts`, retry once without `reposts`.
  - Rejections are logged through `logRejection("extras", …)`.
  - Net cost: one more request per post (two on the retry path). Reels skip the actions/bio calls,
    so a Reel goes from 1 to 2 requests and a feed post from 3 to 4.
- `InsightValue`, `API_TO_COL`, `buildMetricFields` and `ActionCounts` gain the new keys, using
  nullable semantics like the action metrics: fresh when returned, else the preserved previous
  value, else null, plus listed in `unavailable_metrics`. **The payload must stay complete**:
  - every key is present in all three sync sites: `instagram-sync-cron`, and both
    `instagram-integration` paths (connect and refresh)
  - each site's "existing row" select gains the new columns, or preservation silently drops them
- Before the PR merges, probe one image, one carousel and one Reel with the extras call against a
  real account (staging pilot, or prod read-only through a one-off authorized call), and record
  what each metric returned in the PR description. A metric that never returns is removed from the
  request and the UI, not left as permanent "—".

Frontend (`services/analytics.ts`):
- `PostAnalytics` gains the new nullable fields, mapped with `toNullableCount`.
- `missingActionMetricTitle` gets reasons for the new keys: Reels-only ones say "Só para Reels";
  the profile-actions ones say "O Instagram só informa para posts do feed".

### 4. Snapshots and the curve (PR 2)

Table `instagram_post_metrics_history`:

| column | type |
|---|---|
| `id` | bigint identity, primary key |
| `post_id` | bigint not null, references `instagram_posts(id)` on delete cascade |
| `captured_at` | timestamptz not null default now() |
| `views` | integer not null |
| `reach` | integer not null |
| `likes` | integer not null |
| `comments` | integer not null |
| `shares` | integer not null |
| `saved` | integer not null |

- Index on `(post_id, captured_at)`.
- RLS on. One SELECT policy for `authenticated`: `post_id IN (SELECT id FROM instagram_posts)`.
  That inherits `instagram_posts`' own RLS, workspace and `acesso por cliente` scope included, the
  way other FK children do (migration `20261117000006` header).
- No write policy: only the syncs (service role) insert.
- `REVOKE ALL … FROM anon`, and `GRANT SELECT` to `authenticated`, so the grant is explicit.
- Check `99_acesso_por_cliente_drift.sql`: if it flags the table (it has no `cliente_id`, but its
  FK parent leads to one), follow the existing pattern for FK children of `instagram_posts`.

Writes: after each sync site's `instagram_posts` upsert:
1. Read back `id, instagram_post_id` for the upserted posts. Either add `.select('id,
   instagram_post_id')` to the upsert, or do a follow-up `.in(...)` select.
2. Insert one history row per post whose `impressions` (views) or `reach` changed versus the
   pre-sync existing row, or that has no existing row.

Rows are only inserted for posts whose insights call returned views and reach freshly (both
missing from `unavailable_metrics`), so a failed call never draws a flat segment from preserved
values. History insert failure is logged and never fails the sync.

Coverage: the syncs refresh posts up to 30 days old, among the latest 50 media, about every 6 h
(cron) plus manual refreshes. So a curve covers a post's first 30 days. Growth is bounded at about
120 rows per post, and cascade-deleted with the post (disconnect deletes posts). No retention job.

Reading: an SQL function `instagram_post_curve(p_post_id bigint)`, `SECURITY INVOKER` (RLS
applies), `STABLE`, returning JSON:

```
{
  "posted_at": "...",
  "points": [{ "t": "<captured_at>", "views": n, "reach": n }],  // this post, ascending
  "typical": [{ "h": <age hours>, "views": n, "reach": n }] | null
}
```

- `typical`: for the same account and media type (falling back to all types when there are fewer
  than 5 posts of that type), the median of other posts' views/reach at ages 0, 6, 12, 24, 48, 72,
  120, 168, 336 and 720 hours. Each post's value at an age is linearly interpolated between its
  surrounding snapshots, and only counted when the post has snapshots on both sides of that age
  (or exactly at it). An age bucket is reported only when at least 5 posts contribute (`MIN_SAMPLE`).
- `null` when no bucket qualifies.
- `GRANT EXECUTE` to `authenticated`, revoked from `anon`/`public`.
- The CRM calls it with `supabase.rpc` when the pop-up opens (`useQuery`, key
  `['ig-post-curve', postId]`, `staleTime` 5 min).

Rendering (Visão geral, "Ao longo do tempo"):
- Chips "Visualizações" / "Alcance" switch the series.
- Chart.js line chart, which the page already uses.
- This post: solid magenta `#c8169f`, 3 px. The curve starts at `(posted_at, 0)`. If the first
  snapshot is more than 8 h after `posted_at`, the segment from `(posted_at, 0)` to the first
  snapshot is dashed and lighter, marking the unmeasured gap.
- Post típico: grey dashed, plotted at `posted_at + h`, and only up to the post's current age.
- The x axis runs from `posted_at` to `max(last snapshot, posted_at + 7 d)` in dd mmm.
- A legend ("Este post", "Post típico da conta"), and a right-aligned note "Medido a cada
  sincronização, desde {first snapshot, dd de mmm às HHh}".
- With zero snapshots: the empty state from the mockup, "Sem curva para este post", with the
  sentence about the start date. The date is the earliest `captured_at` in the account's history,
  falling back to "a partir de agora".
- While the RPC is loading: a 210 px skeleton. On error: hide the section and log it.

Hide the section entirely when the RPC does not exist yet (PostgREST `PGRST202`), so PR 2's
frontend tolerates running before the migration. The deploy order says the migration goes first
anyway.

### 5. Deploy order (PR 2)

1. The migration (columns, table, function) on staging, then prod. It is additive, and safe before
   any code.
2. Then the functions that import `_shared/instagram-metrics.ts`: `instagram-sync-cron`,
   `instagram-integration`, plus any other importer found by grep at PR time. Flags:
   - `instagram-integration` uses `--no-verify-jwt`, since it is an OAuth callback
   - `instagram-sync-cron` uses `--no-verify-jwt`, since it is a cron
3. Then merge, which deploys the frontend.

Rollback: frontend first. The functions and the migration can stay. The columns are nullable, and
the history table is harmless.

PR 1 has no deploy steps.

## Testing

PR 1 (Vitest):
- Card and row click opens the pop-up. The Instagram link has the sanitized permalink, `target=_blank`,
  and does not open the pop-up.
- Table row click opens the pop-up; the tags cell does not.
- Visão geral cards per media type, with Reel "—" reasons.
- The Reposts column is hidden when null.
- Comentários tab gated by the flag and mounted lazily.
- Tab reset on post change.
- Rate bars hidden without `dists`.
- Update the existing tests that assert permalink hrefs on cards and rows
  (`AnalyticsContaPage.test.tsx`, `AnalyticsContaPage.phone.test.tsx`, `PostInsightsDetail.test.tsx`).
  Grep both `__tests__` trees.

PR 2:
- Deno: `parseProfileActivity` cases, the extras request with the `reposts` retry, and
  `buildMetricFields` completeness with the new keys (every key always present, preservation).
- A test that every sync site's existing-row select includes every preserved column. This guards
  the "silently nulled" failure.
- History insert only on change and only on fresh values.
- SQL: an entitlement suite for `instagram_post_curve`:
  - RLS: other workspace sees nothing, a restricted member sees only assigned clients
  - typical-curve minimum sample
  - interpolation
- Vitest:
  - curve rendering: gap segment, empty state, `PGRST202` hidden
  - the new metric rows, shown only when non-null or non-zero

Browser verification (PR 1 and PR 2):
- Desktop Vidro, classic, and dark mode.
- Phone shell.
- Opening from the "Ver mais" Sheet, then returning focus on close.
- A carousel drag does not open the pop-up.

## Left to the builder

- Exact Chart.js options. The existing `FollowerChart` is the pattern to follow.
- How the table row becomes keyboard-accessible, as long as it is a real button.
- Whether `PostMetricsDialog` lives in `AnalyticsContaPage.tsx` or its own file (prefer its own
  file; the page is 3,100 lines).
