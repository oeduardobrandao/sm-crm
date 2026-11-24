# Métricas do post em pop-up, no estilo do Instagram

Date: 2026-11-23
Status: mockups approved; spec reviewed (Fable + Codex) and revised
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
- A views/reach curve per post, drawn from our own periodic snapshots.
- The account's "post típico" reference line is a follow-up (PR 3). It cannot draw anything
  until at least 5 posts of a format have weeks of snapshots, so PR 2 starts collecting and
  PR 3 adds the line once there is data to check it against.

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
- Backfilling the new metrics for posts older than 30 days. The cron never refetches those, so
  they show "—" for the new metrics (a manual refresh may fill the latest 50 media).
- `profile_activity`'s `OTHER` action type. It is an unnamed bucket that Instagram's own screen
  does not show either.
- Tags inside the desktop pop-up. The table's tags cell stays where it is.
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

Shipped in this order:
- **PR 1: frontend, no backend dependency.** The click change and the pop-up, using data already in
  `PostAnalytics`.
- **PR 2: backend plus the frontend bits that read it.** The new metrics, the snapshots, and the
  post's own curve.
- **PR 3 (later, its own spec section when it starts):** the "post típico" line, once PR 2's
  snapshots have a few weeks of data.

PR 1's pop-up already has the curve section's place. It is hidden until PR 2's data exists.

Conventions used throughout:
- **Post id.** `instagram_posts.id` is a `uuid` (`20260301_baseline_schema.sql:193`).
  `PostAnalytics.id` is typed `number` today, which is wrong. PR 1 fixes it to `string`, along with
  every place that copies the type (`ContaPhone.tsx`, `PostDetailSheet.tsx`, any `useState<number | null>`
  holding a post id). The tag RPCs and assignment code are checked as part of that change.
- **Reel.** A Reel is `media_type === 'VIDEO'`, the convention `post-action-metrics.ts:44-46`
  already uses. `media_product_type` is never stored, and this feature does not start storing it.
- **Dates.** A new formatter with an explicit `timeZone: 'America/Sao_Paulo'` for "Publicado em
  21 de nov. às 18:02". The existing `formatPostDate` uses the browser's timezone and stays as it
  is for the cards and table.
- **Open post held by id.** The page stores the open post's id and looks it up in `posts`, as
  `ContaPhone.tsx:257` already does. A refetch updates the pop-up, and a period change that drops
  the post closes it. The drawer rows are subsets of `posts`, so the lookup always finds them.

### 1. Click behaviour (PR 1)

- **`RankedPostCard`** (`AnalyticsContaPage.tsx`, the Melhores and "precisam de atenção"
  carousels):
  - It stops being an `<a>`. The card body is a `<button type="button">` that calls `onOpen(post)`.
  - A sibling `<a href={sanitizeUrl(permalink)} target="_blank" rel="noopener noreferrer"
    aria-label="Abrir no Instagram">` sits at the top-right of the thumbnail: a 32 px round white
    chip with the Instagram glyph.
  - No interactive element nests inside another.
  - The chip is hidden when `sanitizeUrl(permalink)` returns nothing, as the phone card already
    does (`RankedPostStrip.tsx:75`).
  - `InstagramPostCarousel` is a plain CSS scroll track with no pointer handlers, so there is no
    drag to guard. Nothing to add there.
- **"Ver mais" drawer rows** (the `Sheet` listing best/worst posts): same split. The row body is a
  button, and a 36 px square icon link with the Instagram glyph sits at the row's end.
  - Opening the pop-up keeps the Sheet open underneath. Two Radix modals fight: a click inside a
    sibling Dialog counts as an outside click for the Sheet, and the focus traps compete. Either
    render the Dialog inside the Sheet's tree, or have the Sheet ignore `onInteractOutside` /
    `onPointerDownOutside` while the pop-up is open.
  - Closing the pop-up returns focus to the row that opened it, explicitly through
    `onCloseAutoFocus` (see the memory note on controlled Radix dialogs dropping focus).
- **"Todos os posts" table rows:** a click opens the pop-up instead of toggling the inline expanded
  row. `ExpandedPostDetail` and the `post-detail-row` go away. The tags cell keeps its own click
  handling (`stopPropagation`). Rows become keyboard-openable (Enter/Space on the row's first cell
  button, or a row-level button; the plan picks the accessible pattern).
- **Phone (`ContaPhone`):**
  - The ranked strip's cards open the existing `PostDetailSheet` instead of linking out.
  - `RankedPostStrip` gets an optional `onSelect(post)` prop plus a separate Instagram icon link.
    Without the prop it behaves exactly as today, which keeps TikTok and the portfolio page unchanged.
  - The phone "Ver mais" drawer (`pages/analytics/phone/AllPostsSheet.tsx`, rows built with
    `href: post.permalink` at `ContaPhone.tsx:282-284`) gets the same optional `onSelect` per row,
    plus the icon link. It is shared with TikTok and the portfolio page, which pass no `onSelect`
    and stay unchanged.
  - The posts list already opens `PostDetailSheet`.
  - `ContaPhone` gets a `dists` prop (`baselineQuery.data?.dists`) so the phone view can draw the
    rate bars.
- **Instagram glyph:** lucide's `Instagram` icon, already imported elsewhere in the CRM
  (`pages/automacoes/TargetCards.tsx:1`).
- **Copy that becomes wrong in PR 2:** the page says "Taxa de skip e repost não estão na API."
  (`AnalyticsContaPage.tsx:2985`). PR 2 rewrites or removes it to match what the probe found.

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
- `variant: 'dialog' | 'sheet'` (sizes and the tab control)
- `overviewFooter?: ReactNode`: rendered at the end of the Visão geral tab. The phone host passes
  its existing Tags group ("Nova tag" included) here, so tags stay on phone without the view
  knowing about them.

The curve (PR 2) is fetched inside the view by post id, so it is not a prop.

Layout, top to bottom, matching the mockup:

1. **Header (owned by the hosts, not the view).**
   - Title "Métricas do post".
   - Desktop dialog: two round icon buttons on the right, Instagram (link) and Fechar.
   - Phone: `BottomSheet` keeps its own chrome. The Fechar control stays where the sheet puts it.
     The sheet's "Ver no Instagram" cell becomes the round Instagram icon button in the header.
   - Both hide the Instagram control when the permalink does not sanitize.
2. **Post block.**
   - Thumbnail. Desktop: 176×220, Reels 132×234, `object-fit: cover`, 12 px radius. Phone: centered, 232×290.
   - Next to it on desktop, below it on phone:
     - the format badge ("Carrossel", "Reel", "Imagem", via the existing `formatMediaType`)
     - "Publicado em 21 de nov. às 18:02", with the São Paulo formatter from Conventions
     - the caption, clamped to 3 lines with "Ver mais" to expand
3. **Icon row.** Five columns, each with an icon, the number and a small label:
   - Curtidas (Heart)
   - Comentários (MessageCircle)
   - Reposts (Repeat2)
   - Envios (Send; this is the `shares` metric, which Instagram labels as sends)
   - Salvos (Bookmark)

   Numbers use pt-BR grouping. `reposts` is null for every post in PR 1, and stays null if the
   PR 2 probe confirms Instagram still rejects it. So the Reposts column only renders when the
   post's `reposts` is non-null, and the row is 4 columns otherwise. No column says "—" for every
   post. (The approved mockup shows 5; this is the honest version of it, and the call is mine.)
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
       shown under the dash: whatever `missingActionMetricTitle` returns (today "O Instagram não
       fornece este dado para Reels", `post-action-metrics.ts:53`).
   - **Ratio strip:** small bordered tiles.
     - Engajamento (`engagement_rate`, green as today).
     - IG Score ("82 de 100", hidden when null).
     - Reels, PR 2: "Pularam nos 3 primeiros segundos" (`reels_skip_rate`).
     - No "Seguidores por mil alcançados" tile: the Engajamento tab's "1 novo seguidor a cada N
       contas alcançadas" line says the same thing.
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
     - a bar for this post's rate, plus a tick at the account's median for the same format.
       `RateDistributions` holds raw samples, not quartiles (`ig-rates.ts:134-143`), so take the
       samples with the existing `selectRateSamples` (`ig-rates.ts:179`, which already does the
       per-format fallback) and compute p50/p75 with `quartiles()`
     - the value as a pt-BR percentage with 2 decimals

     The bar's scale is `max(post rate, p75 × 1.5)`, so the tick and the bar always fit. Rows with
     a null rate are hidden. A rate whose sample is below `MIN_SAMPLE` shows the bar without the
     tick. The whole block is hidden without `dists`.
   - **Footnote:** "O Instagram não informa curtidas por foto do carrossel, de onde vieram as
     visualizações nem o público do post."
7. **Footer:** "Dados da API oficial do Instagram. Podem levar até 48 h para fechar." on the left,
   "Atualizado há X" on the right (from `synced_at`, which PR 1 adds to the `PostAnalytics` type
   as `synced_at: string | null`; it already arrives at runtime through `...p`; omitted when null). This follows the CLAUDE.md
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
  `parseBioLinkClicks` into `parseProfileActivity`, which returns the five counts (bio link, call,
  direction, email, text; `OTHER` is ignored) with the same "valid but absent = 0, malformed =
  undefined" semantics.
- **Probe first.** Before writing the request, probe one image, one carousel and one Reel against
  a real account for `reposts`, `total_interactions`, `ig_reels_avg_watch_time`,
  `ig_reels_video_view_total_time` and `reels_skip_rate`. Use the staging pilot, or prod read-only
  through a one-off authorized call. Record what each returned, and the `reels_skip_rate` unit, in
  the PR description. A metric that the probe shows as rejected is left out of the request and the
  UI entirely. That includes `reposts`: if it is still rejected, PR 2 does not request it, and the
  Reposts column stays hidden.
- New isolated **extras** request per post, pinned to `GRAPH_VERSION`, with the probed list:
  - FEED: the probed subset of `reposts,total_interactions`
  - REELS: the probed subset of the above plus
    `ig_reels_avg_watch_time,ig_reels_video_view_total_time,reels_skip_rate`
  - The request is all-or-nothing on Meta's side. If it is rejected and the error message names
    metrics in the list, retry once without the named ones. A second rejection leaves the extras
    absent for that post.
  - Rejections are logged through `logRejection("extras", …)`. They share the 5-per-isolate log
    budget, which is fine once the probed list contains no known rejection.
  - Net cost after the probe: one more request per post. A Reel goes from 1 to 2 requests, a feed
    post from 3 to 4. Check the Graph rate limit for Instagram Login during the probe (a 50-post
    manual refresh goes from about 150 to about 200 calls) and note it in the PR.
- `InsightValue`, `API_TO_COL`, `buildMetricFields` and `ActionCounts` gain the new keys, using
  nullable semantics like the action metrics: fresh when returned, else the preserved previous
  value, else null.
- `unavailable_metrics` only lists a new key when it applies to the post's type and was not
  returned. Reels-only keys are never listed for feed posts, and profile-action keys are never
  listed for Reels. The frontend reason branches on media type first anyway.
- **The payload must stay complete.** Today the three sync sites each hand-write the existing-row
  select and the upsert payload (`instagram-sync-cron/index.ts:291,330-333`,
  `instagram-integration/index.ts:518,543-546` and `:832,870-873`). PR 2 replaces that with:
  - an exported `PRESERVED_METRIC_COLUMNS` constant in `_shared/instagram-metrics.ts`, which the
    three existing-row selects build from
  - the `buildMetricFields` result spread into each payload, instead of picking keys by hand

  A Deno test pins that `PRESERVED_METRIC_COLUMNS` equals the keys `buildMetricFields` returns,
  minus `unavailable_metrics`. The only importers are `instagram-sync-cron` and
  `instagram-integration` (plus the Deno test); `story-ingest.ts` only mentions the module in a comment.

Frontend (`services/analytics.ts`):
- `PostAnalytics` gains the new nullable fields, mapped with `toNullableCount`.
- `missingActionMetricTitle` is widened from `ActionMetricKey` to the new keys too. It gets
  reasons for them: Reels-only ones say "Só para Reels"; the profile-actions ones say "O Instagram
  só informa para posts do feed".
- The page copy "Taxa de skip e repost não estão na API." (`AnalyticsContaPage.tsx:2985`) is
  rewritten to match what the probe found.

### 4. Snapshots and the curve (PR 2)

Table `instagram_post_metrics_history`:

| column | type |
|---|---|
| `id` | bigint identity, primary key |
| `post_id` | uuid not null, references `instagram_posts(id)` on delete cascade |
| `captured_at` | timestamptz not null default now() |
| `views` | integer not null |
| `reach` | integer not null |

Only views and reach: nothing reads the other counts, so they are not stored.

- Index on `(post_id, captured_at)`.
- RLS on. One SELECT policy for `authenticated`: `post_id IN (SELECT id FROM instagram_posts)`.
  That inherits `instagram_posts`' own RLS, workspace and `acesso por cliente` scope included, the
  way other FK children do (migration `20261117000006` header). The drift test's FK-child rule
  accepts this shape (`99_acesso_por_cliente_drift.sql:239`).
- No write policy: only the syncs (service role) insert.
- Grants: `REVOKE ALL ON … FROM PUBLIC, anon, authenticated`, then `GRANT SELECT … TO
  authenticated`. Naming the roles matters: Supabase default privileges give `authenticated` full
  rights on new tables, and a bare `REVOKE … FROM PUBLIC` leaves those.

Writes, after each sync site's `instagram_posts` upsert, through one shared helper in
`_shared/instagram-metrics.ts` (so the rules are tested once):
1. Read back `id, instagram_post_id` for the upserted posts (`.select(...)` on the upsert or a
   follow-up `.in(...)`, at most 50 rows).
2. Insert one history row per post that is **30 days old or less** and whose insights call
   returned views and reach freshly. Freshly means neither `impressions` (views' token, from
   `API_TO_COL`) nor `reach` is in `unavailable_metrics`. A failed call never draws a flat segment
   from preserved values.
3. Rows are inserted on every fresh sync, not only on change. A post that plateaus keeps
   producing points, so its line runs to its last sync and does not stop at its last change. The
   later "post típico" median also needs this to avoid bias toward posts that are still growing.

The 30-day limit matters because the connect and manual-refresh paths process all 50 latest media
with no age filter (`instagram-integration/index.ts:510-552`, `:826-881`); only the cron filters to
30 days (`instagram-sync-cron/index.ts:279-282`). Without the limit, a months-old post would get a
single dashed line from zero to today.

History insert failure is logged and never fails the sync. Concurrent sync and manual refresh can
insert near-duplicate rows, which is harmless for the curve, so there is no unique key.

Coverage and size:
- About one snapshot every 6 h (cron) plus manual refreshes, over a post's first 30 days.
- Roughly 120 rows per post at most, cascade-deleted with the post (disconnect deletes posts).
- No retention job. Growth is about posts per month × 120 rows × connected accounts, two
  integers per row.

Reading: an SQL function `instagram_post_curve(p_post_id uuid)`, `SECURITY INVOKER` (RLS
applies), `STABLE`, returning JSON:

```
{
  "posted_at": "...",
  "points": [{ "t": "<captured_at>", "views": n, "reach": n }],  // this post, ascending
  "history_since": "<earliest captured_at among the account's posts>" | null
}
```

- Returns `null` (not an object) when the caller cannot see the post.
- `history_since` is scoped to the post's own `instagram_account_id`, under the caller's RLS.
- Grants: `REVOKE ALL ON FUNCTION … FROM PUBLIC, anon, authenticated`, then `GRANT EXECUTE … TO
  authenticated`.
- The CRM calls it with `supabase.rpc` when the pop-up opens (`useQuery`, key
  `['ig-post-curve', postId]`, `staleTime` 5 min).
- The `typical` field is PR 3. PR 3 adds it to this same function, with a window of the account's
  last 90 days of posts, linear interpolation between snapshots, `h: 0 = 0` by definition, and age
  buckets up to 336 h (720 h is unreachable since the cron stops at 30 days).

Rendering (Visão geral, "Ao longo do tempo"):
- A hand-drawn SVG chart in the style of `FollowerChart.tsx`, not Chart.js. The page only uses
  Chart.js for the type and age charts, and `FollowerChart` already handles axes, tooltips and
  dark mode in SVG.
- Chips "Visualizações" / "Alcance" switch the series.
- This post: solid magenta `#c8169f`, 3 px. The curve starts at `(posted_at, 0)`. If the first
  snapshot is more than 8 h after `posted_at`, the segment from `(posted_at, 0)` to the first
  snapshot is dashed and lighter, marking the unmeasured gap.
- The x axis runs from `posted_at` to `max(last snapshot, posted_at + 7 d)` in dd mmm, São Paulo time.
- A legend ("Este post"), and a right-aligned note "Medido a cada sincronização, desde {first
  snapshot, dd de mmm às HHh}".
- With zero snapshots: the empty state from the mockup, "Sem curva para este post", with the
  sentence about the start date taken from `history_since`. When `history_since` is null, the
  sentence says "a partir da próxima sincronização".
- While the RPC is loading: a 210 px skeleton. On error (including the function not existing yet):
  hide the section and log it.

### 5. Deploy order (PR 2)

1. The migration (columns, table, function) on staging, then prod. It is additive, and safe before
   any code.
2. Then `instagram-sync-cron` and `instagram-integration`, the only importers of
   `_shared/instagram-metrics.ts`. Both deploy with `--no-verify-jwt` (cron and OAuth callback).
   **Inverting steps 1 and 2 breaks syncing:** a function that sends the new columns before they
   exist makes the bulk upsert fail for the whole batch (`instagram-sync-cron/index.ts:341`), so no
   post metrics are saved at all.
3. Then merge, which deploys the frontend.

Rollback: frontend first. Rolling the functions back is safe: the old payload omits the new keys,
and with a uniform key set PostgREST leaves those columns untouched. The migration can stay. The
columns are nullable, and the history table is harmless.

PR 1 has no deploy steps.

## Testing

PR 1 (Vitest):
- Card and row click opens the pop-up. The Instagram link has the sanitized permalink, `target=_blank`,
  and does not open the pop-up. No Instagram link when the permalink does not sanitize.
- Table row click opens the pop-up; the tags cell does not.
- Opening from the "Ver mais" Sheet keeps the Sheet open, and focus returns to the row on close.
- Phone: the ranked strip and the phone "Ver mais" rows open `PostDetailSheet`, and the TikTok and
  portfolio users of `RankedPostStrip` / `AllPostsSheet` still link out.
- Phone: the Tags group still renders in `PostDetailSheet`.
- Visão geral cards per media type, with Reel "—" reasons.
- The Reposts column is hidden when null.
- Comentários tab gated by the flag and mounted lazily.
- Tab reset on post change.
- Rate bars hidden without `dists`; no median tick below `MIN_SAMPLE`.
- The São Paulo date formatter (a fixed UTC instant renders the São Paulo date and hour).
- Update the existing tests that assert permalink hrefs on cards and rows
  (`AnalyticsContaPage.test.tsx`, `AnalyticsContaPage.phone.test.tsx`, `PostInsightsDetail.test.tsx`,
  and any `RankedPostStrip`/`AllPostsSheet` tests). Grep both `__tests__` trees. Run them with
  `TZ=UTC` too, since CI runs in UTC.

PR 2:
- Deno:
  - `parseProfileActivity` cases
  - the extras request: the probed metric list per type, and the retry that drops the metrics an
    error names
  - `buildMetricFields` completeness with the new keys (every key always present, preservation)
  - `PRESERVED_METRIC_COLUMNS` equals `buildMetricFields`' keys
  - `unavailable_metrics` never lists a key that does not apply to the post's type
  - the history helper: a row per fresh post up to 30 days old, none for an older post, none when
    `impressions` or `reach` is unavailable, a row even when nothing changed
  - update `supabase/functions/__tests__/instagram-metrics_test.ts` where it counts fetch calls
- SQL entitlement suite for `instagram_post_curve` and the history table:
  - another workspace sees no rows and gets `null`
  - a restricted member calling it for a hidden client's post gets `null`, not an empty curve
  - `history_since` only reflects the post's own account
  - `\dp` shows `authenticated=r` on the table and no `anon` grant
- Vitest:
  - curve rendering: the gap segment, the empty state with and without `history_since`, the
    section hidden on RPC error
  - the new metric rows, shown only when non-null (profile actions: non-zero)

Browser verification (PR 1 and PR 2):
- Desktop Vidro, classic, and dark mode.
- Phone shell.
- Opening from the "Ver mais" Sheet, then returning focus on close.
- A Reel shows "—" with its reason for follows and profile visits.

## Left to the builder

- The SVG chart details, following `FollowerChart.tsx`.
- How the table row becomes keyboard-accessible, as long as it is a real button.
- Whether `PostMetricsDialog` lives in `AnalyticsContaPage.tsx` or its own file (prefer its own
  file; the page is 3,100 lines).
- Whether the Dialog renders inside the Sheet's tree or the Sheet ignores outside interactions
  while it is open (section 1), whichever passes the focus test.

## Calls made during review (2026-11-23)

- Reposts column hidden when null, so the icon row may be 4 columns for good.
- No backfill of new metrics for posts older than 30 days.
- Snapshots only for posts 30 days old or less, written on every fresh sync.
- "Post típico" line moved to PR 3.
- History stores views and reach only.
- `OTHER` profile action and the "Seguidores por mil alcançados" tile dropped.
- SVG chart instead of Chart.js.
