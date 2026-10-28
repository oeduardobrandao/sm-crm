# TikTok analytics + multi-platform reports

Status: draft, awaiting Eduardo's approval (2026-10-28).

## Intent

TikTok publishing is live (app review and Direct Post audit approved). Agencies that post to TikTok through Mesaas have nowhere to see how it performed, and the block reports only know Instagram.

This initiative gives TikTok the same analytics experience Instagram has, and turns reports into a per-client, multi-platform thing the user composes freely: Instagram only, TikTok only, or both in one document.

The Instagram analytics pages (`/analytics`, `/analytics/:id`) are the baseline. "Like the Instagram one" is the bar: same structure, same feel, same interactions, adapted to the metrics TikTok actually gives us.

## Decided by Eduardo

1. **A full TikTok analytics overview page**, the TikTok twin of `/analytics` (portfolio across all clients).
2. **One client analytics page with three tabs: Instagram | TikTok | Relatórios.** The per-client page combines both platforms again; the third tab holds that client's reports.
3. **Reports are composed by the user**: they choose what to show, Instagram metrics, TikTok metrics, or both in the same report.

## Goals

- TikTok overview page across all clients, mirroring `AnalyticsPage`.
- Client analytics page `/analytics/:id` restructured into the three tabs, Instagram tab = today's page content unchanged in behavior.
- TikTok tab mirroring the Instagram tab's sections wherever TikTok data exists.
- Relatórios tab replacing the "Relatórios Gerados" card at the bottom of the Instagram page.
- Report blocks gain a platform. One report can mix Instagram and TikTok blocks.
- Start collecting per-video TikTok metric history now, because it cannot be backfilled later.

## Non-goals

- TikTok **Business Accounts API** (reach, saves/favorites, watch time, retention, demographics, gained/lost followers). Separate OAuth, separate app, mandatory access form. It is the follow-up initiative that fills the sections this one leaves out. The tables and snapshot shape here must accept those metrics later without redesign.
- Cross-platform aggregate blocks ("total followers across networks"). v1 "combined" means Instagram and TikTok blocks side by side in one report, nothing summed.
- The legacy monthly report pipeline (`analytics_reports`, `report-worker`, `instagram-report-generator-v2`, report e-mail). Untouched; its "Formato anterior" list moves to the Relatórios tab as-is.
- TikTok in the Hub feed, stories (no TikTok API), post tags/topics for TikTok, manual follower entry for TikTok.
- Translating the existing Instagram analytics pages. New copy is i18n'd; old copy stays as it is.

## Anti-goals

- **A TikTok number that means something different from what its label says.** Per-video counts are overwritten on each sync, so "Visualizações (30 dias)" cannot be views gained in the window. Every KPI label and tooltip states its real meaning (see §A3).
- Instagram behavior changes. The Instagram tab must be the current page, moved, not rewritten.
- A TikTok block silently rendering Instagram numbers (see deploy order, §Deploy).

## What TikTok data exists (constraints)

From the Developers API, scopes `user.info.basic,user.info.profile,user.info.stats,video.list,video.publish`:

- Per account (`tiktok_accounts`, current values): `follower_count`, `following_count`, `likes_count` (lifetime likes), `video_count`.
- Per account per day: `tiktok_follower_history` (`date` real date, `source` api/manual), `tiktok_account_metrics_daily` (followers, following, likes, videos; written only by `tiktok-sync-cron`; service-role only).
- Per video (`tiktok_posts`): `views`, `likes`, `comments`, `shares`, `posted_at`, `title`, `video_description`, `duration`, `width`, `height`, `share_url`, `embed_link`, `cover_image_url` (re-hosted). **Overwritten in place**, no history.
- Refresh coverage today: `importTikTokVideos` upserts counts straight from `/video/list/` (100 videos on connect and `/sync`, 40 in the daily cron), then `refreshStoredPostMetrics` re-queries the 200 most recent stored videos via `/video/query/` (both `/sync` and the cron call it). Older videos keep stale counts.
- No reach, impressions, saves, watch time, demographics, profile views, link clicks, stories.
- No read API for analytics: only `tiktok-integration` `GET /summary/:clientId` and `GET /posts/:clientId?page=`.
- Disconnect deletes the account's `tiktok_posts`; follower history and daily snapshots survive.

## Part A — TikTok analytics

### A1. Data collection changes

- **New table `tiktok_post_metrics_daily`** `(tiktok_account_id uuid FK tiktok_accounts ON DELETE CASCADE, tiktok_video_id text, snapshot_date date, views bigint, likes int, comments int, shares int, PRIMARY KEY (tiktok_account_id, tiktok_video_id, snapshot_date))`. Keyed by the TikTok video id, **not** an FK to `tiktok_posts`: disconnect deletes the account's `tiktok_posts`, and the history must survive a disconnect/reconnect, like follower history does. Service-role only: RLS on, no policies, `REVOKE ALL ... FROM PUBLIC, anon, authenticated`, then an explicit `GRANT SELECT, INSERT, UPDATE, DELETE ... TO service_role` (defensive; hosted grants service_role explicitly, local stacks may not). Nothing in v1 reads it; it exists so a later version can show views gained in a window. *(my call)*
- **One write path for video counts**: a single helper "persist current counts + upsert today's daily snapshot" replaces the two direct writes (`importTikTokVideos`' upsert from `/video/list/` and `refreshStoredPostMetrics`' update), so every count write also lands a snapshot row.
- **Refresh coverage**: `refreshStoredPostMetrics` selects the union of the 200 most recent stored videos and every stored video posted in the last 90 days, queried via `/video/query/` in batches of 20. Applies to `/sync` and the cron alike. The real gap today is an account with more than 200 videos posted recently; this closes it for the presets (7/30/90 days). Custom windows longer than 90 days can include older videos whose counts are stale; acceptable. *(my call)*
- `tiktok_account_metrics_daily` also gets written by `/sync` (today only the cron writes it), so a manual sync produces a data point the same day. *(my call)*
- **Who gets daily collection**: same rule as Instagram. `tiktok-sync-cron` keeps its `feature_auto_sync_cron` + `auto_sync_enabled` selection (the same plan flag gates `instagram-sync-cron`) and adds a `feature_tiktok` check. Workspaces without auto-sync build history only when someone clicks Sincronizar, so their follower KPIs often show "sem dados". *(my call, parity with Instagram; flagged for review)*

### A2. `tiktok-analytics` edge function (new)

Mirror of `instagram-analytics`'s route shape. Verifies the user JWT itself (service-role `getUser(token)`), deployed with `--no-verify-jwt` like `instagram-analytics`.

Tenant identity follows `report-docs/index.ts`, **not** `instagram-analytics` or `tiktok-integration` (both still read legacy `profiles.conta_id`, which is wrong after a workspace switch): workspace = `profiles.active_workspace_id`, confirmed by an existing `workspace_members` row for the caller, then `clientes.conta_id` must equal it. Every account and video query is scoped through that owned client (`tiktok_accounts.client_id = clientId`). Every route also gates on `feature_tiktok` **and** `feature_analytics_reports` via `effectivePlanFeature`. Beyond that, mirror Instagram's guard map (`_shared/feature-guard.ts`): `/best-times` also needs `feature_best_times`; the AI routes also need `feature_instagram_ai` (the AI flag despite its name) and share the `ig-ai:${contaId}` rate budget (10/hour), so TikTok doesn't double a workspace's AI allowance. The TikTok tab shows the same locked states as the Instagram tab for those. `report-docs` generate and `refresh-data` re-check `feature_tiktok` before loading the TikTok section; without it the section is null. No new plan column (avoids the entitlements enumerator redeploys).

| Route | Returns |
|---|---|
| `GET /overview/:clientId?start&end` | account card (handle, display name, avatar, status, last_synced_at), KPIs for the window + previous window of equal length |
| `GET /follower-history/:clientId?days=` | daily follower series from `tiktok_follower_history` |
| `GET /posts-analytics/:clientId?start&end&sort=` | videos posted in the window with metrics + derived rates |
| `GET /best-times/:clientId` | weekday × hour heatmap from the account's videos |
| `GET /portfolio?days=` | per-account rows + totals for the overview page |
| `POST /ai-analysis/:clientId` | AI narrative for one account (Gemini; skipped when `GEMINI_API_KEY` unset) |
| `POST /ai-analysis-portfolio` | AI narrative across accounts |

Instagram reads that go straight to PostgREST from `services/analytics.ts` stay as they are. TikTok reads all go through this function, because `tiktok_account_metrics_daily` and the new table are service-role only and the report snapshot loader (§B3) reuses the same query functions (put them in `_shared/tiktok-analytics/` so `report-docs` imports them).

Best times: `_shared/best-times.ts` scores interactions / reach and uses `saved`. Generalize it to take a rate function; TikTok uses (likes + comments + shares) / views.

AI: reuse the Instagram prompt structure with a TikTok variant (input = the KPIs and video list above, no reach/saves). Same output shape as the Instagram account and portfolio analyses so the existing AI section components render it.

### A3. KPI definitions (labels must say exactly this)

| KPI | Meaning | Comparison |
|---|---|---|
| Seguidores | current `follower_count` | vs the value at window start (from follower history) |
| Novos seguidores | follower delta over the window (history) | vs previous window |
| Visualizações | sum of current views of **videos posted in the window**. Tooltip: "Total atual dos vídeos publicados no período, não as visualizações recebidas no período." | **none** |
| Engajamento | (likes + comments + shares) / views over videos posted in the window | vs previous window |
| Curtidas | sum of likes of videos posted in the window | **none** |
| Comentários | sum of comments of videos posted in the window | **none** |
| Compartilhamentos | sum of shares of videos posted in the window | **none** |
| Vídeos publicados | count of videos posted in the window | vs previous window |
| Curtidas totais do perfil | lifetime `likes_count` | none |

Why no comparison on the summed counts: they are lifetime totals, so the previous window's videos have had longer to collect views and likes, and the comparison would show a drop when nothing got worse. Engagement is a ratio of those same counts and holds up better, so it keeps its comparison. Once `tiktok_post_metrics_daily` has history, a later version can compare counts at equal video age. *(my call)* In reports the same rule applies: these KPI entries carry `prev: null`.

Rules that make these deterministic:

- **One date boundary**: every window, `posted_at` bucket, follower-history date and snapshot date is evaluated in `America/Sao_Paulo`. A window `[start, end]` is inclusive whole days in that zone.
- **Follower KPIs read only observed points.** "Seguidores" comparison uses the first follower-history point on or after the window start; "Novos seguidores" = last point in the window minus first point in the window. Fewer than two points in the window (connected mid-window, syncs failed) → the value shows "sem dados" and no comparison; never zero, never extrapolated.
- **Previous-window comparisons** are null ("sem comparação") when the previous window has no data of that kind: no follower points for follower KPIs, no videos posted for video KPIs. A previous window with videos but zero views compares normally.
- Rates with a zero denominator are null, not 0%.

Engagement uses views as denominator because TikTok gives us no reach. Where a TikTok rate sits next to an Instagram rate (benchmarks, reports) it is labeled "por visualização", never compared as the same number.

### A4. Routes and navigation

| Route | Page |
|---|---|
| `/analytics` | Instagram overview (unchanged) |
| `/analytics/tiktok` | **TikTok overview** (new) |
| `/analytics/:id` | redirect to `/analytics/:id/instagram`, or `/tiktok` when the client has TikTok connected and no Instagram |
| `/analytics/:id/instagram` | client page, Instagram tab |
| `/analytics/:id/tiktok` | client page, TikTok tab |
| `/analytics/:id/relatorios` | client page, Relatórios tab |

- React Router ranks the static `tiktok` segment above `:id`; client ids are numeric (`parseInt` + `isNaN` guard as today), so a non-numeric `:id` is a not-found.
- `vercel.json` already rewrites `/analytics(/.*)?` and `/relatorios(/.*)?` to `app.html`; no rewrite change. Verify.
- `routePermissions.ts` already gates `/analytics*` on `analytics:ver`.
- Every existing link to `/analytics/${clientId}` keeps working through the redirect; links whose intent is reports (`cliente-detalhe` RelatoriosTab "Ver Analytics", the report editor's `fallbackTo` and back link) point straight at `/analytics/:id/relatorios`.
- Sidebar Analytics group: **Instagram** (`/analytics`), **TikTok** (`/analytics/tiktok`, shown when `feature_tiktok`). `isNavRouteActive` itself changes: its doc comment says it deliberately treats `/analytics/tiktok` as a child of `/analytics`, so today it lights Instagram there. It must not. On a client page, the item matching the active tab is lit (Relatórios tab lights Instagram). *(my call)* The tests asserting the TikTok nav item is absent (`nav-data.test.ts:157-163`, `Sidebar.test.tsx:327-334`) flip to assert it is present under the flag.
- Phone tab bar: `/analytics/tiktok` maps to the same analytics tab as `/analytics`.

### A5. TikTok overview page (`/analytics/tiktok`)

Mirrors `AnalyticsPage` section by section:

- Filters: client select, period 7 / 28 / 90 days (default 28).
- KPI grid: Contas conectadas, Seguidores totais, Visualizações (vídeos do período), Engajamento médio por visualização, Vídeos publicados.
- Highlights (leaders) and silent accounts (> 7 days without a video).
- "Melhores vídeos" top 5 by views and "Precisam de atenção" (videos older than 48h with the fewest views), each opening the all-videos sheet with sort, client and date filters (no format filter: we don't store a video/photo type).
- "Todas as contas" table + card variant, rows link to `/analytics/:clientId/tiktok`.
- Engagement benchmark chart and "Por especialidade" table.
- AI portfolio section.
- Empty state when no client has TikTok connected: explains where to connect (client detail › Redes sociais).
- Phone variant, mirroring `pages/analytics/phone/`.

Reuse Instagram components where they are presentational (period control, ranked strip, sheets, tiles, benchmark chart) by passing platform-neutral props; fork only where Instagram fields are baked in. Builder decides per component.

### A6. Client analytics page with tabs

`AnalyticsContaPage` becomes a shell: client header, tab bar (Instagram | TikTok | Relatórios), and the active tab below. Each platform tab keeps its own period controls. The Instagram tab keeps today's two period states (`days` for the post list, `overviewDays` for the KPIs, plus Último mês and custom days) exactly as they are. The TikTok tab gets one period control with 7 / 30 / 90 dias, Último mês and custom days (1–730), driving everything on the tab. *(my call: sharing one period across tabs would rewrite the Instagram tab's behavior)*

- **TikTok tab hidden** when the workspace lacks `feature_tiktok`. Shown otherwise, with a "TikTok não conectado" / "Conexão expirada" state linking to the client's Redes sociais tab, like the Instagram states today.
- **Instagram tab**: today's page content (`AnalyticsContent`) minus the "Relatórios Gerados" card. Header actions that belong to Instagram (sync, manual followers) move into the tab. One fix rides along: the "Token expirado" / "Instagram não conectado" buttons navigate to `/cliente/${clientId}` (singular, broken); they go to `/clientes/${clientId}`.
- **TikTok tab**, mirroring the Instagram tab:
  - Sync button (existing `syncTikTokData`).
  - KPI cards per §A3.
  - Best / worst videos ranked sections with the ranked drawer (sort by views, likes, comments, shares, engagement; date filter).
  - Follower growth chart.
  - Content table: date, cover, title, views, likes, comments, shares, engagement per view, duration, link to TikTok. Sortable.
  - Best time to post heatmap.
  - AI analysis section.
  - Omitted (no data): reach, saves, link clicks, profile views, stories, demographics, format and topic breakdowns, baseline card.
- **Relatórios tab**: Part A moves the existing "Relatórios Gerados" card into this tab as-is (lists, Gerar relatório, Abrir, delete, legacy list). Part B adds the Plataformas choice and the platforms badge (§B1).
- Phone variant: the existing `ContaPhone` gains the same three-tab structure; TikTok sections get phone versions in the style of `ContaSections.tsx`.

### A7. Copy

New UI copy goes through `react-i18next` with a new namespace (`analyticsTiktok`, pt + en), like the recently translated pages. Existing Instagram copy is moved, not translated. No em-dashes in user-facing copy.

## Part B — Multi-platform reports

### B1. Relatórios tab

Replaces the "Relatórios Gerados" card. Lists that client's block reports (newest first: title, period, platforms badge, updated, Abrir, delete) and below them the legacy "Formato anterior" list exactly as today (download, e-mail, pending polling).

"Gerar relatório" lives here (and stays as a header shortcut on the page, *my call*). The dialog (`NewReportDialog`, moved out of `analytics-conta/components` to a shared reports folder) gains a **Plataformas** choice: checkboxes for each platform the client has connected, all checked by default, at least one required. The choice shapes the **layout only**, at generation time: the system default layout includes a section per checked platform, and with a workspace template the blocks of unchecked platforms are dropped from the generated layout. Data is always loaded for every platform the client has connected (generate and `refresh-data` alike), so the user can add a TikTok block to an Instagram-only report later and it has numbers. Nothing about the choice is stored; the platforms badge in the list is derived from the block types in the layout. `/generate` gains an optional `platforms: ('instagram'|'tiktok')[]` (validated against the client's connected platforms; omitted = all connected, which keeps automations and older callers working).

### B2. Block platform

> Superseded in part by `docs/superpowers/specs/2026-10-28-report-platform-sections-design.md`: the editor no longer mixes platforms freely (widgets live in their platform's section), and that spec's deploy order (migration → merge → `report-docs` + `instagram-report-generator-v2`) replaces Part B's below.

- **TikTok blocks are their own block types**, prefixed `tiktok_`: `tiktok_kpi_<id>`, `tiktok_chart_followers`, `tiktok_chart_best_times`, `tiktok_top_posts`, `tiktok_post_list`. The platform is the prefix; existing types stay Instagram, so every existing layout, template and document is valid with no data migration.
- Why types and not a `config.platform` flag: a CRM or Hub bundle already open in a browser keeps running after a deploy (silent updates). Today's `BlockRenderer` and `EditorCanvas` render `null` for an unknown type (`hasOwnProperty` guard) and `layerLabel` falls back to the type string, so an old bundle shows a TikTok block as nothing. With a config flag the same old bundle would render Instagram numbers inside a TikTok block.
- The new types reuse the existing block components through a platform prop (`KpiCardBlock`, `FollowerChartBlock`, `BestTimesBlock`, `TopPostsBlock`, `PostListBlock` read `snapshot.tiktok` for `tiktok_*` types). Structure, text, AI, cover and image blocks are platform-neutral.
- No TikTok equivalent for `chart_formats`, `audience_*`, `tags_table`.
- TikTok KPI ids: `followers_total`, `followers_gained`, `views`, `engagement_rate`, `likes`, `shares`, `comments`, `posts_count`, `likes_total`, with meanings from §A3 and labels/tooltips from a TikTok table (TikTok's "Visualizações" carries its tooltip).
- `validateLayout` (`_shared/report-docs/layout.ts` `BLOCK_TYPES`) and the catalog/registry gain the new types. The DB trigger only checks shape, so no migration for that.
- The layers panel and block chrome show a small platform badge on platform blocks. *(my call)*
- `AddWidgetDrawer` gets a platform switch at the top when the client has both platforms connected (only one connected: no switch, that platform). Only blocks valid for the selected platform are listed. Template editor: both platforms always available.
- Cover: kicker derived from the platforms present in the layout ("Relatório mensal · Instagram", "· TikTok", "· Instagram e TikTok"); handle from the first platform in the layout. Other hardcoded Instagram copy (`KpiCardBlock` reach tooltip, `TopPostsBlock` format labels) becomes platform-aware; `FormatCardsBlock` stays Instagram-only.

### B3. Snapshot

- `ReportDocSnapshot` keeps its current root fields as the **Instagram** data (old documents unchanged) and gains `tiktok?: TikTokReportSnapshot | null`:
  `{ account: {handle, display_name, avatar_url}, kpis: Record<TikTokKpiId, KpiEntry>, follower_trend, best_times, top_posts }` (top posts with views, likes, comments, shares, title preview, date, share_url, cover URL from the `tiktok-posts` bucket).
- When the client has no Instagram account, the root Instagram fields hold an empty snapshot (null KPIs, empty arrays) and an `instagram_connected: false` flag, so Instagram blocks show their existing "sem dados" placeholder. *(my call; keeps one snapshot type instead of a union)*
- `snapshot-source.ts` loads TikTok via the `_shared/tiktok-analytics/` queries for the report month.
- `blockHasData` and the block components read from `snapshot.tiktok` for `tiktok_*` types (absent `tiktok` = no data). Same contract as today: placeholder in edit mode, omitted in view, Hub and PDF.
- `report_documents`: `instagram_account_id` is already nullable (`ON DELETE SET NULL`, `20260820000010`); the change there is in code (`loadClientSnapshot` and `generate.ts` assume an Instagram account id always exists). New nullable `tiktok_account_id uuid REFERENCES tiktok_accounts ON DELETE SET NULL`. Generation fails with a clear error only when the client has neither platform connected.
- `refresh-data` reloads both.
- Template sample data: `makeSnapshotFixture` gains a TikTok section (handle `seucliente`, tiktok.com links).
- AI narrative in reports: input includes the TikTok section when present; prompt asks for one narrative covering the platforms in the report. When only TikTok is present, the TikTok variant from §A2.
- Default layout (`buildDefaultLayout`): Instagram section when Instagram is selected, then a "TikTok" section header + TikTok KPIs, follower chart and top videos when TikTok is selected.

### B4. Report editor

Back link and `fallbackTo` go to `/analytics/:clientId/relatorios`. Nothing else in the editor changes beyond §B2.

## Deploy order

The renderer (`packages/report-blocks`) ships in the CRM editor, the Hub `RelatorioDocPage` and the Hub print page used by Gotenberg. Because TikTok blocks are new types (§B2), an old bundle renders them as nothing rather than as wrong numbers, so the usual order is safe: everything server-side before the merge.

Part A (its own PR):
1. Migration: `tiktok_post_metrics_daily`.
2. Deploy `tiktok-analytics` (new), `tiktok-sync-cron`, `tiktok-integration`.
3. Merge.

Part B (second PR):
1. Migration: `report_documents.tiktok_account_id`.
2. Deploy `report-docs` (its `validateLayout` must accept the `tiktok_*` types before any frontend can add one; a TikTok section it generates before the merge is invisible to the old bundle, not wrong).
3. Merge → Vercel builds CRM + Hub together.

`feature_tiktok` is off on all plans (overrides only), which bounds exposure.

## Testing

- Vitest: TikTok pages, tab shell and redirects, nav item presence under the flag, AddWidgetDrawer filtering, block rendering from `snapshot.tiktok`, `blockHasData` per platform, fixtures.
- Deno: `tiktok-analytics` routes (ownership, flags, KPI math including empty windows and previous-window comparison), cron refresh coverage + daily snapshot writes, `validateLayout` accepting the `tiktok_*` types, old-bundle safety (unknown type renders nothing), snapshot loader for IG-only / TikTok-only / both / neither.
- Browser check of both pages and the editor with a TikTok-connected client, desktop and phone width.

## Left to the builder

- Which Instagram components get generalized vs forked.
- Exact KPI card order and the TikTok tab's section order, following the Instagram tab.
- Query shapes inside `tiktok-analytics`, caching, and whether best-times is cached like Instagram's.
- How the period query param is named and parsed.
