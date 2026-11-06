# YouTube and Google Meu Negócio in the Analytics sidebar + overview pages — design

Date: 2026-11-03 · Status: draft, builder check and Codex review folded in
Mockups: https://claude.ai/artifact/9dcJUTeCQX52D3cGzZZ7S6
Parent spec: `docs/superpowers/specs/2026-10-29-youtube-google-meu-negocio-design.md` (this
document amends its §3 and §4.6, see §6)

## 1. Intent

The CRM sidebar's Analytics group lists Instagram and TikTok. YouTube and Google Meu Negócio
("GMN") already have per-client analytics tabs (`/analytics/:id/youtube`, `/analytics/:id/google`,
Phase 2), but nothing in the sidebar leads there and there is no page that shows every client at
once. Agencies open the TikTok overview (`/analytics/tiktok`) to see the whole portfolio in one
place; they should be able to do the same for the two new platforms.

Success:
- A workspace whose plan has the flag sees YouTube and Google Meu Negócio under Analytics and
  lands on a page that covers every connected client.
- A workspace without the flag sees the two items as "Em breve", so the agency knows they are
  coming instead of not knowing they exist.
- Nothing on the YouTube page combines numbers from different channels.

## 2. Decisions

By the user (2026-11-03):
1. **Sidebar:** under Instagram and TikTok, items "YouTube" and "Google Meu Negócio". Flag on:
   a normal, clickable item. Flag off: an inert item with an "Em breve" tag.
2. **GMN:** a full portfolio dashboard, like the TikTok overview.
3. **YouTube:** a per-channel list (one row per channel, each row only its own numbers), not a
   dashboard. Chosen after the YouTube aggregation constraint (§6) was raised.

My calls (stated here so they can be rejected):
- Icons `ph-youtube-logo` and `ph-storefront`. `NavItem.icon` is a Phosphor class string and
  every sidebar item uses one (`ph-instagram-logo`, `ph-tiktok-logo`); the repo's
  "lucide-react only" rule covers React icon components, not this data field.
- "Em breve" also applies in the phone "Mais" sheet, same rule as the sidebar.
- Period choices follow each platform's existing analytics windows: YouTube 7/28/90 days
  (default 28, `YT_WINDOW_DAYS`), GMN 7/30/90 days (default 30, `GBP_WINDOW_DAYS`). The mockups
  show 28 on the GMN page; the build uses 30.
- GMN "Ações" = calls + directions + website clicks + messages + bookings, the five action
  metrics the client tab already shows separately.
- No AI analysis on either page (YouTube: §4.6 of the parent spec; GMN: not asked for).
- No portfolio sync button on the YouTube page; GMN gets none either. The hourly crons keep
  both fresh and per-client sync lives in the client tab and the Redes sociais card. (TikTok's
  "sincronizar todos" exists because TikTok has no Google-style quota; repeating it for 25+
  Google units would burn the 300 QPM budget.) The mockups' "Sincronizar" button is dropped.

## 3. Non-goals / anti-goals

Non-goals: replying to reviews (still parent §3), report changes, Hub pages, MCP tools, exports,
a YouTube video ranking across clients, any change to the TikTok item or page.

Anti-goals (a failure even if it works):
- **Any YouTube number that mixes channels:** a total, average, leader, benchmark, chart series
  or "x% of your channels" figure. The only cross-channel numbers allowed on the YouTube page
  are counts of channels (connected, and per authorization status in the filter): they count
  Mesaas link records, not YouTube metrics.
- An "Em breve" item that navigates anywhere or opens a paywall.
- A sidebar item that flashes visible then disappears while the plan loads (the existing
  fail-closed behaviour stays).
- Showing YouTube data of a channel whose client the user cannot see (same tenant rules as the
  per-client routes).

## 4. Sidebar

`apps/crm/src/components/layout/nav-data.ts`, Analytics group, after `analytics-tiktok`:

| id | route | label (labelKey) | icon |
|---|---|---|---|
| `analytics-youtube` | `/analytics/youtube` | YouTube (`nav.youtube`) | `ph-youtube-logo` |
| `analytics-google` | `/analytics/google` | Google Meu Negócio (`nav.googleBusiness`) | `ph-storefront` |

Gating, per item:
- Permission: `NAV_MODULE` `['analytics', 'ver']`, like the other Analytics items. Failing it
  hides the item (unchanged rule).
- `feature_analytics_reports` via `NAV_FEATURE` (hidden when explicitly false, unchanged rule).
- The product flag (`feature_youtube` / `feature_google_business`) is new behaviour: when it is
  not explicitly `true` the item stays in the list with `disabled: true`, which the sidebar and
  `MobileNav` already render as an inert row with the "Em breve" badge
  (`sidebar.comingSoon`). This is the opposite of `NAV_FEATURE_REQUIRED_TRUE` (which hides), so
  it gets its own map, e.g. `NAV_FEATURE_SOON: Record<string, string>`, applied after the
  permission filter. While `features` is null (plan loading) the item is `disabled` too:
  disabled-then-enabled is acceptable, enabled-then-disabled is not.
- A disabled item must not count as "usable" for the phone tab bar fallback (the existing
  `!item.disabled` check covers it) and must not be the target of any redirect.

Active state: `isNavRouteActive` today special-cases TikTok with `TIKTOK_ANALYTICS_PATH`.
Generalize to one regex per platform item:
- `analytics-youtube` is active on `/analytics/youtube` and `/analytics/<id>/youtube`.
- `analytics-google` is active on `/analytics/google` and `/analytics/<id>/google`.
- `analytics` (Instagram) is active on none of the TikTok, YouTube or Google paths.
- Without an item id (phone tab bar) every `/analytics*` child path still matches `/analytics`.

i18n: `nav.youtube`, `nav.googleBusiness` in every locale `nav.tiktok` exists in.

## 5. Pages

Routes in `App.tsx`, both before `/analytics/:id/:tab?` (otherwise `youtube`/`google` is read as
a client id): `/analytics/youtube` → `YouTubeOverviewPage`, `/analytics/google` →
`GoogleOverviewPage`, lazy like `TikTokOverviewPage`. `vercel.json` already rewrites
`/analytics(/.*)?`; no change.

Both pages, like the TikTok overview:
- Route guard: the same permission as the sidebar item (`ProtectedRoute` already gates
  `feature_analytics_reports`). With the product flag off (deep link), the page redirects to
  `/analytics` once the plan has loaded, exactly like `TikTokOverviewPage` does for
  `feature_tiktok` (`TikTokOverviewPage.tsx:128`), and fetches nothing before that.
- Vidro look: filters go in the toolbar (`inToolbar`), the classic look keeps the header row.
- Phone (≤767px): its own single-column layout, following `pages/analytics-tiktok/phone`.
- Empty state when nothing is connected: "Nenhum canal/perfil conectado" with a link to
  `/clientes`, like TikTok's.
- Loading, error and retry states follow the TikTok page.

### 5.1 `/analytics/google` (GMN portfolio)

Scope: every **counted** unit (`gbp_locations.status` in `active`, `revoked`) of every
**active** client (`clientes.status = 'ativo'`) of the workspace. A client filter narrows it to
one client.

Sections, top to bottom (mockup board 2):
1. **Header:** title, client filter, period 7/30/90.
2. **KPIs (5):**
   - Unidades: count of counted units; sub-line "N precisam reconectar" when any is `revoked`.
   - Visualizações do perfil, Ações, Avaliações novas: sums over the selected units with the
     % change against the previous window, computed exactly as `computeGbpKpis` does for one
     client (same window rule: `windowDataThrough` over the selected units, prev nulled when not
     covered, rating snapshots for new reviews).
   - Nota média: review-count-weighted, same `weightedRating` as the client tab, from each
     unit's `gbp_rating_daily` snapshot at the window end.
3. **Destaques do período (4 cards):** unit with the most Ações; biggest % growth in
   Visualizações do perfil (only units whose previous window is covered and had ≥ 50 views, so
   10 → 30 is not "+200%"); best Nota média (the unit's rating snapshot at the window end, see Nota in the table) among
   units with ≥ 10 reviews at that snapshot; most Avaliações
   novas. A card with no eligible unit is hidden; ties break by unit title.
4. **Avaliações que pedem atenção:** reviews with `star_rating <= 3` and `has_reply = false`,
   created in the last N São Paulo days ending today (N = the selected period), newest first.
   Not the metrics window: reviews sync on their own and are current, while the metrics window
   ends days back at `data_through`, which would hide yesterday's 1-star review. Show at most 10, with "Ver
   todas" when more exist (drawer or expand, builder's call). Only stored reviews count:
   `gbp_reviews` keeps the latest 200 per unit, so a very busy unit may have older low reviews
   in a 90-day window that are no longer stored. The list and its total say "nas avaliações
   mais recentes" in a hint, and no retention change is made. Each row: stars, reviewer, relative
   date, unit, comment (clamped to 3 lines). The action "Ver no Google" opens the unit's
   `maps_uri` through `sanitizeUrl` (no per-review URL is stored); hidden when `maps_uri` is
   null.
5. **Unidades que precisam de atenção:** `revoked` units ("Acesso revogado no Google",
   "Reconectar" linking to the client's Redes sociais `?rede=google`) and active units whose
   `last_synced_at` is older than 48 h ("Desatualizada", "Última sincronização há N dias").
   Hidden when empty.
6. **Todas as unidades:** sortable table, one row per unit: unit title + client, Visualizações
   (with % change), Ligações, Rotas, Cliques no site, Mensagens, Nota, Avaliações novas,
   Atualizado. Default sort Visualizações desc. A row opens `/analytics/<clientId>/google`. (The
   tab keeps its unit selection in React state; preselecting the unit is out of scope.) Revoked units
   show "Reconectar" in Atualizado; their stored history still counts until the 30-day expiry,
   as in the client tab.
7. **Comparativo por especialidade:** units grouped by the client's `especialidade`; per group:
   unit count, Visualizações per unit, Ações per unit, Nota média (weighted). Only groups with ≥ 2
   units; units without a specialty are left out. Hidden when no group qualifies.

Per-unit windows: each unit's row in the table and the highlights use the portfolio window
(`windowDataThrough` over the selected units), so rows compare like with like, the same choice
`buildUnits` makes for one client. One difference: the portfolio watermark leaves out active
units flagged "Desatualizada" (`last_synced_at` older than 48 h), the same way revoked units are
already left out, so one stuck unit cannot drag 100 others back to its date. A portfolio-only
variant of `windowDataThrough` takes `last_synced_at` and `now`; the shared helper and the client
tab do not change. Those units still appear in the table and the sums with whatever they have
stored, and their Atualizado cell carries the "Desatualizada" badge. If every active unit is
stale, the rule falls back to `windowDataThrough` unchanged.

Per-unit previous-window coverage (for each row's % change and the growth highlight): the sync
stores every day from the unit's backfill start, zeros included, so a unit's previous window is
covered when its loaded rows include a row on `prevStart`. Derive it from the rows already loaded;
no per-unit query.

Rating per unit (table column Nota, the highlight, the specialty average): the unit's latest
`gbp_rating_daily` snapshot on or before the window end, falling back to
`gbp_locations.average_rating` only when the unit has no snapshot at all. This differs from
today's `buildUnits` (which reads the current value) on purpose: a 90-day view shows the rating
as of its last day, consistent with the Nota média KPI. Avaliações novas per unit is that unit's
`reviewDelta` across the same snapshots.

### 5.2 `/analytics/youtube` (per-channel list)

Scope: every `youtube_channels` row of the workspace's active clients (one channel per client,
parent §4.3), `active` or `revoked`. A client filter, a text search (channel title, handle or
client name) and a status filter "Todos (N) | Precisam reconectar (N)" narrow it.

Layout (mockup board 3):
1. **Header:** title, one-line description, search, client filter, period 7/28/90.
2. **Status filter** and the count "N canais conectados". No other cross-channel number.
3. **Table, sortable on every numeric column, default Visualizações desc**, one row per channel:
   - Canal: avatar, title, client name.
   - Inscritos: `subscriber_count`.
   - Ganho no período: net subscribers (gained − lost) over the channel's window.
   - Visualizações, Horas assistidas (estimated minutes ÷ 60), Duração média
     (view-weighted `average_view_duration_s`): the channel's `all` content type over its window.
   - Shorts nas visualizações: exactly the client tab's Shorts split, so both places show the
     same %: shorts ÷ (shorts + long) via `computeYtSplit`, over the window clipped to
     `min(window end, content_type_through)` (`queries.ts` overview). A small bar plus %; "–" only
     when `content_type_through` is null or before the window start.
   - Atualizado: relative `last_synced_at`; a `revoked` channel shows the "Reconectar" badge and
     dashes in every metric column (its history is purged on revocation, parent §4.6).
   - The whole row opens `/analytics/<clientId>/youtube`.
4. **Footer:** the line "Cada número pertence só ao canal da linha." and the YouTube attribution
   ("Dados do YouTube" with the unaltered logo), as on the client tab.

Each row uses **its own channel's window** (`data_through` of that channel, Pacific days, same
`resolveYtWindow` as the client tab), not a shared one: the rows are never added up, so there is
nothing to line up, and clipping every channel to the slowest one would hide good data.

Sorting is a presentation of independent rows, not a ranking: no "1º lugar", medals, "top
channel" copy or highlighted row.

## 6. Amendments to the parent spec

- §3: "portfolio-level pages like `/analytics/tiktok` for the two new platforms" is replaced by:
  "a YouTube portfolio dashboard (totals, leaders, benchmarks). A GMN portfolio page and a
  YouTube per-channel list exist per the 2026-11-03 overview spec."
- §4.6 Aggregation becomes: "YouTube data is never combined across channels: no sum, average,
  ranking label or chart across channels. Channels may be listed side by side, one row per
  channel with only its own numbers (`/analytics/youtube`)."
- The builder adds both edits to the parent spec in the same PR.

Risk accepted with decision 3: a YouTube audit reviewer may still read a side-by-side list as
aggregation. Mitigation: the page sits behind `feature_youtube` (off for every plan today); if
the audit objects, the item can show "Em breve" again by turning the page off without touching
the client tabs. The builder keeps the page self-contained so that switch is a one-line change.

## 7. Backend

Two new read routes, same tenant/rate-limit/flag guards as their functions' existing routes
(tenant from `active_workspace_id` + `workspace_members`, never `profiles.conta_id`; 120/min;
flags product + `feature_analytics_reports`, 403 `feature_disabled`). No migration.

- **`gbp-analytics` `GET /portfolio?days=7|30|90[&client=<id>]`** returns
  `{ window, dataThrough, kpis, units: [...], reviewsAttention: [...], reviewsAttentionTotal,
  specialties: [...] }`. `units` rows extend `GbpUnitRow` with `clientId`, `clientName`,
  `especialidade`, `mapsUri`, `lastSyncedAt`, `prevProfileViews` (null when not covered) and
  `newReviews`. Reuse `computeGbpKpis`, `sumMetrics` and the rating snapshot
  helpers (per unit, `computeGbpKpis` over that unit's rows gives its rating, new reviews and
  covered previous window);
  no second copy of the math. "Ações" is a new sum of the five action entries. Highlights and specialty groups may be computed
  server-side or in the page (builder's call) but from these rows only.
- **`youtube-analytics` `GET /portfolio?days=7|28|90`** returns `{ channels: [...] }`, each with
  `clientId`, `clientName`, `title`, `handle`, `avatarUrl`, `subscriberCount`,
  `authorizationStatus`, `lastSyncedAt`, `window`, and `metrics` (`netSubscribers`, `views`,
  `watchMinutes`, `avgViewDurationS`, `shortsShare`), every metric nullable. **The response has
  no field that spans channels**, and a test asserts the top-level keys are exactly
  `["channels"]`. Per-channel math reuses `computeYtKpis` / `computeYtSplit`.
- Reads stay bounded: paged queries ordered by the full primary key (`fetchAllRows`), never one
  query per unit or channel in a loop. Whole-workspace reads filter by `conta_id` and dates and
  drop other units/channels in code, so no request URL lists every id (a few hundred location
  names in an `.in(...)` would exceed the URL limit); a `client` filter keeps the short `.in`.
  YouTube issues one daily read per distinct channel window, so a channel stuck months behind
  does not widen everyone's range. Sizes at 90 days to design and test against:
  - GMN, 100 units: metrics for the current + previous window = 18k rows (18 pages of 1000),
    plus rating snapshots (at most 100 × 271 days: both windows plus the 91-day lookback `loadRatings` uses)
    and the attention reviews (filtered in SQL: `star_rating <= 3`, `has_reply = false`,
    inside the window).
  - YouTube, 100 channels: the table shows no % change, so only the current window is read,
    and only `content_type in ('all','shorts','long')` (the split needs long too) = 27k rows.
    No previous window.
  - Above 200 units or channels the page is still expected to work but may be slow; a handler
    test pins the 100-unit/100-channel case with paged mock data, and the plan records the
    measured wall time on the pilot. If a later workspace outgrows it, the fix is a SQL
    aggregate RPC, not this spec.
- Both routers only match `/<route>/<clientId>` today (`gbp-analytics/handlers.ts:188`,
  `youtube-analytics/handlers.ts:171`): `/portfolio` gets its own branch before that match, with
  the same tenant, rate-limit and flag guards but no client ownership check.
- Both functions keep `--no-verify-jwt` on deploy.

Frontend services: `getGbpPortfolio(days, clientId?)` in `services/gbpAnalytics.ts` and `getYouTubePortfolio(days)` in `services/youtubeAnalytics.ts`,
wrapped in TanStack Query like `getTikTokPortfolio`.

## 8. Rollout

1. Deploy `gbp-analytics` and `youtube-analytics` (both `--no-verify-jwt`), staging then prod,
   before the merge (the merge deploys the frontend at once).
2. Merge. Every plan has both flags off, so every user who sees the Analytics group
   (`feature_analytics_reports` on and `analytics:ver`) sees two "Em breve" rows; the pilot
   override (DK Marketing Médico) sees both pages.
3. Check on prod with the pilot: the sidebar states with and without the override, both pages
   load, the YouTube response has only `channels`.

Rollback: frontend revert alone is safe (the new routes are additive).

## 9. Left to the builder

- Component split and whether highlights/specialties are computed server- or client-side.
- The "Ver todas" pattern for the reviews list.
- Phone layout details within the TikTok phone pattern.
- Copy beyond the strings named here (pt-BR, sentence case, no em dashes).
