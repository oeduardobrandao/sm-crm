# Google Meu Negócio section in block reports: design addendum

Date: 2026-11-04 · Status: draft, awaiting Eduardo's OK on the mockups
Mockups: https://claude.ai/artifact/1TFcauWXBipKacf4RrR13M
Parent specs: `2026-10-29-youtube-google-meu-negocio-design.md` §8 (Phase 4, GMN half),
`2026-10-28-report-platform-sections-design.md` (the section model),
`2026-10-28-tiktok-analytics-and-multiplatform-reports-design.md` Part B (the precedent).

## Intent

Agencies screenshot the client's Google profile by hand for the monthly report. The block report
gets a **Google Meu Negócio** section next to Instagram, TikTok and Geral, filled from the same
stored history and the same math as the client's GMN analytics tab, so the report and the tab
agree for the same dates. GMN goes ahead of YouTube; YouTube report blocks stay out of scope
(they need Phase 3 and the purge rules), but the plumbing takes a `youtube` kind later by adding
one entry per list. Shipping order is GMN first; section order in a report stays the parent
spec's (§8): Instagram, TikTok, YouTube, Google.

## Decided (task brief)

- One section kind `google`, block types prefixed `gbp_`, added exactly the way TikTok was
  (own block types, a section marker platform, a snapshot sub-object, a loader in `report-docs`).
- Widgets: KPIs (views, calls, direction requests, website clicks), where people saw the profile
  (Search vs Maps, mobile vs desktop), daily actions, search terms, rating with distribution,
  a highlighted review (most recent 5★ with text, else 4★), a units comparison for clients with
  more than one unit.
- GMN requires `feature_google_business` (plus `feature_analytics_reports`, which every report
  already requires). Ships dark; DK Marketing Médico has overrides on.
- The AI narrative covers GMN; never YouTube.
- Deploy order: migration → merge → `report-docs` once the Vercel production deploy is live.

## Non-goals

- YouTube blocks, `report_documents.youtube_channel_id`, the YouTube purge exception on refresh.
- A per-unit filter inside the report (the section is always "Todas as unidades"; the units
  comparison block is where units show apart).
- A `report_documents.gbp_*` column (the snapshot records the unit ids it used, per §8).
- A reviews list, reply status, "Abrir no Google" links (the report is for the client, not a
  moderation tool).

## Anti-goals

- A GMN number in the report that differs from the GMN tab for the same date range and units.
- A GMN widget outside the GMN section, in any write path (TS validator and SQL trigger agree).
- An existing Instagram/TikTok report that renders differently after the deploy.
- GMN data in a workspace without `feature_google_business`.

## Model

### Block types (`_shared/report-docs/layout.ts`)

| Type | Default size | Renders |
|---|---|---|
| `gbp_kpi_profile_views` | third | Visualizações do perfil |
| `gbp_kpi_calls` | third | Ligações |
| `gbp_kpi_directions` | third | Pedidos de rota |
| `gbp_kpi_website_clicks` | third | Cliques no site |
| `gbp_kpi_messages` | third | Mensagens |
| `gbp_kpi_bookings` | third | Agendamentos (drawer only) |
| `gbp_kpi_avg_rating` | third | Nota média (drawer only) |
| `gbp_kpi_new_reviews` | third | Novas avaliações |
| `gbp_surfaces` | half | Onde viram o perfil (4 surfaces, share bars, mobile/Maps footnote) |
| `gbp_rating` | half | Nota média, stars, total and new reviews, 5→1 distribution |
| `gbp_actions_chart` | full | Ações por dia (stacked bars: ligações, rotas, site, mensagens) |
| `gbp_keywords` | half | O que buscaram no Google (top 10 terms, "menos de N") |
| `gbp_review_highlight` | half | Avaliação em destaque |
| `gbp_units` | full | Comparar unidades (table) |

KPI labels and tooltips are the GMN tab's (`analyticsGoogle.json` `kpi.*`), kept in a TS table
beside `tiktok-kpi-labels.ts` with a parity test against the pt i18n file, as TikTok does.

Platform plumbing becomes data instead of `if tiktok`:
`PLATFORM_BLOCK_PREFIXES = { tiktok: "tiktok_", google: "gbp_" }`; `blockPlatform()` walks it
before the neutral list and the unknown-is-Instagram fallback. `SECTION_PLATFORMS` gains
`"google"`; `sectionStructureError` needs no other change (it reads `blockPlatform`).
`sections.ts`: `SectionKind` gains `google`; `PLATFORM_ORDER` is `instagram, tiktok, google`
with a comment reserving `youtube` between `tiktok` and `google`, per the parent spec §8 (not
added to any validator now: a `youtube` section must not be writable before its blocks exist).
Every other hardcoded platform list moves to these constants: `platform-filter.ts`
(`PLATFORM_ORDER`, `PLATFORM_NAMES`), `repairGroups`' `moved` record, `coverDefaults`'
`['instagram','tiktok'] as const`, `ClientReportsPanel`'s `connected` list. `sectionKindOf` reads the
platform from `SECTION_PLATFORMS`; `repairGroups`' per-platform buckets come from
`PLATFORM_ORDER`.

### Migration (`20261118000001`; open PR #816 holds `20261117…`)

Recreates `validate_report_layout()` from `20261103000003` with two changes only: the marker
platform list becomes `('instagram', 'tiktok', 'google')`, and the block-platform `CASE` gains
`WHEN starts_with(v_type, 'gbp_') THEN 'google'` before the neutral list. Legacy and existing
sectioned layouts validate exactly as before. New cases in
`supabase/tests/fixtures/report_section_layouts.json`: canonical Instagram + Google,
Google-only, a `gbp_*` block in an Instagram or Geral section (invalid), a `gbp_*` block before
the first marker (invalid), two Google sections (invalid), a legacy layout with `gbp_*` blocks
(valid: legacy only checks the content cap), `platform: "youtube"` (invalid). The Deno
`validateLayout` suite and the SQL suite `99_report_layout_sections.sql` read the same file.

### Snapshot (`_shared/report-docs/snapshot.ts`)

`ReportDocSnapshot.google?: GoogleReportSnapshot | null` (absent/null = no GMN in this
document; `version: 1` unchanged):

```ts
interface GoogleReportSnapshot {
  units: { id: string; title: string | null; status: "active" | "revoked" }[]; // ids used
  data_through: string | null;            // window watermark (windowDataThrough)
  window: { start: string; end: string; prevStart: string; prevEnd: string } | null; // null = nothing synced
  kpis: Record<GbpKpiId, GbpReportKpiEntry>; // { value, prev, unit: "count" | "rating" }
  surfaces: { surface: GbpSurface; value: number; pct: number }[];
  daily: { date: string; calls: number; directions: number; websiteClicks: number; messages: number }[];
  keywords: { month: string | null; rows: { keyword: string; value: number | null; threshold: number | null }[] };
  rating_distribution: GbpRatingDistribution | null;
  highlight: { reviewer: string; rating: 4 | 5; comment: string; unit_title: string | null; date: string } | null;
  unit_rows: { id: string; title: string | null; views: number; calls: number; directions: number;
               website_clicks: number; rating: number | null; reviews: number | null }[];
}
```

### Loader (`report-docs/google-section.ts`)

Reuses `_shared/gbp-analytics/` (`loadUnits`, `loadMetrics`, `loadRatings`, `computeGbpKpis`,
`dailySeries`, `surfaceBreakdown`, `buildUnits`, `buildRatingDistribution`, `aggregateKeywords`),
service-role client, every read with `conta_id`.

- **Units:** `loadUnits` (active and revoked; `disconnected` never counts, as in the tab).
  No units → `null` (the client has no GMN). Units but nothing synced → a section with null
  KPIs and empty lists (placeholders in the editor, omitted in view).
- **Window = the tab's custom range for the report month:** `resolveWindow({ kind: "range",
  start: <month>-01, end: <last day> }, windowDataThrough(units), now)`. `end` is clipped to
  `data_through`; the previous window is **the same number of days right before** (the tab's
  "vs. N dias anteriores"), not the previous calendar month. *(my call: this is what makes the
  report equal the tab for the same dates; the GMN KPI card's comparison line says
  "vs. N dias anteriores".)* GMN blocks stamp their own dates from `window`
  ("01–29 de outubro · parcial"), never the Instagram `period.effectiveEnd`.
- **KPIs:** `buildOverview`'s exact path (`computeGbpKpis` with `prevCovered`).
- **Surfaces, daily, units:** `surfaceBreakdown`, `dailySeries`, `buildUnits` over the window.
- **Rating:** `avg_rating` / `new_reviews` KPIs; distribution from `buildRatingDistribution`
  (all stored reviews, which the sync already prunes to the newest 200 per unit, `gbp-sync.ts`
  `MAX_REVIEWS`; "Últimas 200 avaliações por unidade" when partial, as in the tab).
  `avg_rating` renders with one decimal ("4,7"), never through `fmtCount`.
- **Keywords** *(my call)*: the report month's rows when stored; otherwise the newest stored
  closed month before it (Google publishes a month's terms some days after it closes, so an
  early-month report would otherwise always lack them). The block names the month it shows.
  Top 10 rows.
- **Highlighted review** *(my call)*: among the stored reviews created inside the window, the
  newest 5★ with non-empty text, else the newest 4★ with text, else none (block omitted in
  view). Older reviews are not featured (the same review would repeat every month). Comment cut
  at 400 characters. Reviewer shown as first name + initial ("Maria S."): Google shows the name
  publicly, but the snapshot outlives the 30-day GMN purge (§9 keeps generated reports), so it
  keeps the least personal data that still reads naturally.
- **Units comparison:** stored for every client; the block has data only with 2+ units.

### Generation (`report-docs`)

- `REPORT_PLATFORMS = ["instagram", "tiktok", "google"]`; `parseGenerateBody` accepts it.
- `generate.ts` reads `feature_google_business` once (an RPC error fails generation, as for
  TikTok). Off → GMN counts as not connected: no `snapshot.google`, no Google section.
- `connectedPlatforms(db, contaId, clientId, …)` gains `contaId` (`loadUnits` is tenant-scoped)
  and adds `google` when `loadUnits` returns any unit.
- Callers that omit `platforms` (monthly automations, older callers) now get a Google section for
  flagged workspaces whose client has GMN units. Intended: same rule as TikTok.
- `loadClientSnapshot(…, { tiktokEnabled, googleEnabled })` loads the GMN section in parallel.
  "Nenhuma rede conectada" now means none of the three. A GMN-only client gets the empty
  Instagram root (`instagram_connected: false`), like a TikTok-only one.
- Default layout and `selectPlatformSections`: the Google section comes after TikTok, with
  `platformSectionBlocks("google", opts)`: KPIs views, calls, directions, website clicks,
  messages, new reviews (6 thirds), surfaces + rating (halves), actions chart (full), keywords +
  highlighted review (halves), units comparison (full, only with 2+ units: `hasGbpUnits`).
  `hasData("google") = !!snapshot.google`.
- AI: `ReportData` gains an explicit `google?: ReportDataGoogle` (`report-template/types.ts`),
  and `snapshotToReportData` adds it (KPIs with prev, surfaces, top keywords, rating;
  never reviewer names or review text). `ai.ts` gains GMN rules: what each number is (daily
  unique users per surface, summed), no reach/followers/engagement on GMN, prev compares the same
  number of days before, "menos de N" keywords are bounds, goal metric ids prefixed `gbp_`.
  Scope lines cover every combination of the three platforms. `metricLabel` maps `gbp_<id>` to
  "<label> no Google Meu Negócio". The no-AI fallback summary gains a GMN sentence.
  `prefixTikTokGoalMetrics` today runs whenever Instagram is out of the narrative; it becomes
  "exactly one non-Instagram platform in the narrative" with a `gbp_` twin, so a bare GMN id
  (`website_clicks`, `profile_views` exist on both) never gets `tiktok_`, and an Instagram id
  never gets read as GMN.
- `refresh-data`: a GMN section frozen in the document stays when GMN is gone (all units
  unlinked, or flag off), as TikTok does. Today `loadClientSnapshot` throws `not_found` when no
  platform is connected, so a single-platform document whose platform left 404s before the
  carry-over runs (true for TikTok-only today too). Refresh calls it with `allowNone: true`:
  empty Instagram root, then `carryOverFrozenPlatforms` restores what the document had; only a
  document with nothing frozen and nothing connected still answers `not_found`.
- `PDF_RENDERER_VERSION` 6 → 7.

### Renderer (`packages/report-blocks`)

- `ReportPlatform` gains `google`; `PLATFORM_NAMES.google = "Google Meu Negócio"`;
  `PlatformIcon` uses lucide `Store` (the CRM nav's storefront); no Google logo.
- GMN blocks are their own components (no Instagram component fits rating, stacked bars or the
  keyword table), reading `snapshot.google`; absent = null. `blockHasData` per type
  (`gbp_units` needs 2+ unit rows; `gbp_review_highlight` needs a highlight).
- Cover: kicker lists the platforms present ("· Instagram e Google Meu Negócio"); a GMN-only
  report has no @ line, client photo as today.
- Fixtures (`makeSnapshotFixture`) gain a 3-unit clinic GMN section for templates.

### CRM editor

- `tiktokEnabled` props become `enabledPlatforms: ReportPlatform[]` (Instagram always, TikTok by
  `feature_tiktok`, Google by `feature_google_business`, fail-closed while the plan loads)
  through `RelatorioEditorPage`, `ModeloEditorPage`, `EditorCanvas`, `LayersPanel`,
  `useBlockEditing`, `AddSectionMenu`.
- `AddSectionMenu` lists Instagram, TikTok, Google Meu Negócio, Geral, with today's hints.
- `documentPlatforms` adds `google` when `snapshot.google`; `AddWidgetDrawer` needs nothing else
  (it filters the catalog by section kind); `widgetIcons` gets the 14 types; `layoutOps`
  `DEFAULT_SIZE` the sizes above; `SectionFrame` shows no @ for Google.
- `NewReportDialog`: "Google Meu Negócio" checkbox when the client has GMN units and the flag is
  on (the shell's `googleSummary` query, same cache key).
- i18n pt/en for strings that go through `t()`; block copy in the report package stays pt-BR
  like every other block.

## Deploy order (PR body)

1. Migration (staging, then prod). Safe ahead of everything: it only widens what the trigger
   accepts.
2. Merge. The new frontend can add a Google section to templates; documents get GMN data only
   after step 3.
3. As soon as the Vercel production deploy is live: deploy `report-docs` (`--no-verify-jwt` as
   today). `instagram-report-generator-v2` bundles `_shared/report-template/ai.ts`, but its
   Instagram-only prompt is unchanged, so its redeploy is optional.

Between 2 and 3, generating from a template already saved with a Google section fails with
`invalid_template` in the old `report-docs` (minutes, as in the sections rollout). A CRM/Hub tab
kept open across the merge shows GMN blocks as nothing and cannot autosave a GMN document until
it reloads (the same accepted window as sections).

Rollback: once a GMN document exists, roll back `report-docs` only (it stops writing GMN), never
the frontend to before the merge.

## Testing

- Deno: `validateLayout` + SQL parity fixtures; `blockPlatform`; `toSections`/repair with
  `google`; `selectPlatformSections` and `buildDefaultLayout` with Google; `google-section.ts`
  (window clipping, prev coverage, keyword fallback month, highlight choice, name abbreviation,
  no units, units without sync) against the `gbp-analytics` overview for the same range;
  `generate` flag gating and `invalid_platforms`; refresh carry-over; AI input and labels.
- Vitest: each GMN block (data and no data), `blockHasData`, catalog/icon exhaustiveness,
  `AddSectionMenu` with the flag, `NewReportDialog` checkbox, fixtures.
- Browser: DK Marketing Médico (5 units): add the Google section, generate against a local or
  staging function, check editor, Hub page and PDF; numbers vs the GMN tab with the same custom
  range.

## Left to the builder

Component internals, copy beyond the tab's strings, chart drawing (SVG, like
`FollowerChartBlock`), test layout.
