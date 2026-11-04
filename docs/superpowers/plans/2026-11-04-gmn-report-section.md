# Google Meu Negócio report section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `google` (Google Meu Negócio) platform section with 14 `gbp_*` widgets to the block report, end to end: validator + SQL trigger, snapshot loader, generation/refresh/AI, renderer and CRM editor.

**Architecture:** Same shape as TikTok (own block types, section marker platform, `snapshot.google` sub-object, loader in `report-docs`), with the hardcoded `instagram|tiktok` lists turned into shared constants so `youtube` can be added later by one entry each. The loader reuses `_shared/gbp-analytics/` so the numbers equal the GMN tab for the same dates.

**Tech Stack:** Deno edge functions, TS-pure shared modules (`_shared/report-docs`), React 19 (`packages/report-blocks`, CRM), Postgres trigger (plpgsql), Vitest, `deno test`, psql suites.

**Spec:** `docs/superpowers/specs/2026-11-04-gmn-report-section-design.md` (approved 2026-11-04, choices A-D = recommended). Parent: `docs/superpowers/specs/2026-10-28-report-platform-sections-design.md`. Mockups: https://claude.ai/artifact/1TFcauWXBipKacf4RrR13M

## Global Constraints

- Platform id `google`; block prefix `gbp_`; `PLATFORM_NAMES.google = "Google Meu Negócio"`; icon lucide `Store`.
- Section order: `instagram, tiktok, (youtube reserved), google`. `youtube` is NOT added to any validator, TS or SQL.
- Migration version `20261118000001` (PR #816 holds `20261117…`). File: `supabase/migrations/20261118000001_report_layout_google_section.sql`.
- GMN data only with `feature_google_business` on (and `feature_analytics_reports`, already required by generation). Fail closed in the CRM while the plan loads.
- No em dashes (`—`) in any user-facing copy. Use "." or ":".
- `PDF_RENDERER_VERSION` 6 → 7.
- Never return raw errors to clients; log internally.
- Run prettier/eslint only on files you touched (`npx prettier --write <files>`, `npx eslint <files>`), never repo-wide. Never `deno fmt` repo-wide.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Approved choices: (A) GMN prev = same number of days right before the window (the tab's custom range); (B) highlighted review only from reviews created inside the window; (C) reviewer as first name + initial ("Mariana C."); (D) default section has 6 KPI thirds: profile_views, calls, directions, website_clicks, messages, new_reviews.
- Run Deno tests with `deno test --no-check <path>` plus `npm run check:functions` for types; Vitest with `npx vitest run <path>`. Use `TZ=UTC` for date-sensitive tests.

## Review Focus

1. **Report month entirely after `data_through`** (report for the current month on its 1st-2nd day): GMN section present with null KPIs and empty lists, no crash, blocks omitted in view. → Task 4 test `window after data_through`.
2. **Mixed active + revoked units with different `data_through`**: window ends on the active units' watermark (`windowDataThrough`), revoked rows still summed. → Task 4 test `revoked unit holds no window back`.
3. **GMN-only document refreshed after its last unit was unlinked**: refresh keeps the frozen section, no 404. → Task 5 test.
4. **AI goal id `website_clicks` in an Instagram-absent, GMN-only narrative**: label resolves to the GMN label, never TikTok or Instagram. → Task 6 test.
5. **Old template saved with legacy (unsectioned) layout + Google selected**: template with any platform section gains the default Google section after its last platform section; template without one gains none. → Task 3 test.

---

### Task 1: Layout schema, sections and SQL trigger (google platform)

**Files:**
- Modify: `supabase/functions/_shared/report-docs/layout.ts`, `sections.ts`
- Create: `supabase/migrations/20261118000001_report_layout_google_section.sql`
- Modify: `supabase/tests/fixtures/report_section_layouts.json`
- Test: `supabase/functions/_shared/report-docs/layout.test.ts`, `sections.test.ts`, `supabase/tests/entitlements/99_report_layout_sections.sql` (reads fixtures; add nothing unless a case needs DB-only setup)

**Interfaces:**
- Produces (layout.ts):
  - `BLOCK_TYPES` += `"gbp_kpi_profile_views","gbp_kpi_calls","gbp_kpi_directions","gbp_kpi_website_clicks","gbp_kpi_messages","gbp_kpi_bookings","gbp_kpi_avg_rating","gbp_kpi_new_reviews","gbp_surfaces","gbp_rating","gbp_actions_chart","gbp_keywords","gbp_review_highlight","gbp_units"`.
  - `export const GBP_BLOCK_PREFIX = "gbp_";`
  - `export const PLATFORM_BLOCK_PREFIXES = { tiktok: "tiktok_", google: "gbp_" } as const;`
  - `export const SECTION_PLATFORMS = ["instagram", "tiktok", "google"] as const;` `export type SectionPlatformId = (typeof SECTION_PLATFORMS)[number];`
  - `blockPlatform(type: string): SectionPlatformId | null` (prefix map first, then neutral list, then `"instagram"`).
- Produces (sections.ts): `SectionKind = "general" | SectionPlatformId`; `SectionPlatform = SectionPlatformId`; `export const PLATFORM_ORDER: readonly SectionPlatform[] = ["instagram", "tiktok", "google"]` (comment: youtube goes between tiktok and google, parent spec §8); `sectionKindOf` accepts any `SECTION_PLATFORMS` value; `repairGroups`' `moved` built from `PLATFORM_ORDER`.

- [ ] **Step 1: Add fixture cases** to `report_section_layouts.json` (each `{name, valid, layout}`):
  `"sectioned: instagram + google"` valid (Geral[cover], instagram[kpi_reach], google[gbp_kpi_calls, gbp_surfaces]);
  `"sectioned: google only"` valid;
  `"sectioned: gbp block in instagram section"` invalid;
  `"sectioned: gbp block in geral section"` invalid;
  `"sectioned: gbp block before first marker"` invalid;
  `"sectioned: two google sections"` invalid;
  `"sectioned: youtube platform marker"` invalid (`config.platform: "youtube"`);
  `"sectioned: google marker with hideHeader"` valid;
  `"legacy: gbp blocks without markers"` valid.
- [ ] **Step 2: Add Deno tests** in `layout.test.ts`: `blockPlatform("gbp_units") === "google"`, `blockPlatform("gbp_kpi_calls") === "google"`, `blockPlatform("tiktok_kpi_views") === "tiktok"`, `blockPlatform("kpi_reach") === "instagram"`, `blockPlatform("section") === null`. In `sections.test.ts`: legacy layout `[cover, kpi_reach, gbp_kpi_calls]` → sections kinds `["general","instagram","google"]` with google `hideHeader: true`; repair: sectioned layout with `gbp_units` in the Instagram section → moved to the end of a synthesized google section placed after the last platform section; `sectionKindOf({config:{platform:"google"}})==="google"`, `platform:"youtube"` → `"general"`.
- [ ] **Step 3: Run** `deno test --no-check supabase/functions/_shared/report-docs/` → new cases FAIL.
- [ ] **Step 4: Implement** layout.ts + sections.ts per Interfaces. Keep `TIKTOK_BLOCK_PREFIX` exported (used by `packages/report-blocks`).
- [ ] **Step 5: Write the migration**: copy `validate_report_layout()` verbatim from `20261103000003_report_layout_sections.sql` (the full `CREATE OR REPLACE FUNCTION`, same signature/SECURITY/search_path), changing only `NOT IN ('instagram', 'tiktok')` → `NOT IN ('instagram', 'tiktok', 'google')` and the CASE adding `WHEN starts_with(v_type, 'gbp_') THEN 'google'` right after the tiktok line. Update the header comment to cite this spec. No trigger re-creation needed if the trigger references the function by name (check `20261103000003`; mirror whatever it does).
- [ ] **Step 6: Run** `deno test --no-check supabase/functions/_shared/report-docs/` → PASS; `npx vitest run packages/report-blocks/__tests__/BlockRenderer.test.tsx` → PASS (it reads the fixtures); if Docker/colima is available run `bash scripts/test-entitlements.sh` (else note CI covers it).
- [ ] **Step 7: Commit** `feat(report-docs): plataforma google nas seções do relatório + trigger`.

### Task 2: Snapshot types, GMN labels and fixtures

**Files:**
- Modify: `supabase/functions/_shared/report-docs/snapshot.ts`
- Create: `supabase/functions/_shared/report-docs/gbp-kpi-labels.ts`
- Modify: `packages/report-blocks/types.ts` (re-exports), `packages/report-blocks/fixtures.ts`
- Test: `packages/report-blocks/__tests__/platform.test.ts` (label parity with `packages/i18n/locales/pt/analyticsGoogle.json` `kpi.<id>.label`)

**Interfaces:**
- Produces (snapshot.ts):
```ts
export interface GbpReportKpiEntry { value: number | null; prev: number | null; unit: "count" | "rating" }
export interface GoogleReportSnapshot {
  units: { id: string; title: string | null; status: "active" | "revoked" }[];
  data_through: string | null;
  window: { start: string; end: string; prevStart: string; prevEnd: string } | null;
  kpis: Record<GbpKpiId, GbpReportKpiEntry>;
  surfaces: { surface: GbpSurface; value: number; pct: number }[];
  daily: { date: string; calls: number; directions: number; websiteClicks: number; messages: number }[];
  keywords: { month: string | null; rows: { keyword: string; value: number | null; threshold: number | null }[] };
  rating_distribution: GbpRatingDistribution | null;
  highlight: { reviewer: string; rating: 4 | 5; comment: string; unit_title: string | null; date: string } | null;
  unit_rows: { id: string; title: string | null; status: "active" | "revoked"; views: number; calls: number; directions: number; website_clicks: number; rating: number | null; reviews: number | null }[];
}
```
  and `ReportDocSnapshot.google?: GoogleReportSnapshot | null` (doc comment: absent/null = no GMN).
- Produces (gbp-kpi-labels.ts): `GBP_KPI_LABELS_PT: Record<GbpKpiId, string>` = the pt `kpi.<id>.label` strings ("Visualizações do perfil", "Ligações", "Pedidos de rota", "Cliques no site", "Mensagens", "Agendamentos", "Nota média", "Novas avaliações"; read the json for the exact last two); `GBP_KPI_TOOLTIPS_PT: Partial<Record<GbpKpiId,string>>` with `profile_views` = the tab's `kpi.profile_views.tooltip`.
- Produces (types.ts re-exports): `GoogleReportSnapshot`, `GbpReportKpiEntry`, `GbpKpiId`, `GBP_KPI_IDS`, `GBP_BLOCK_PREFIX`, `PLATFORM_BLOCK_PREFIXES`, `PLATFORM_ORDER`, `SectionPlatformId`.
- Produces (fixtures.ts): `makeSnapshotFixture()` gains `google:` a 3-unit clinic (`Unidade Centro`, `Unidade Jardins`, `Unidade Moema`), window `2026-07-01..2026-07-31`, prev `2026-05-31..2026-06-30`, all 8 KPIs non-null, 4 surfaces, 31 daily points, 7 keywords incl. one `threshold: 15`, distribution, a 5★ highlight ("Paula R."), 3 unit_rows.

- [ ] **Step 1:** Test in `platform.test.ts`: every `GBP_KPI_LABELS_PT[id]` equals `pt.analyticsGoogle.kpi[id].label`; fixture `google.unit_rows.length === 3`.
- [ ] **Step 2:** Run `npx vitest run packages/report-blocks/__tests__/platform.test.ts` → FAIL.
- [ ] **Step 3:** Implement per Interfaces.
- [ ] **Step 4:** Run → PASS; `npx tsc -p apps/crm/tsconfig.json --noEmit` → no new errors.
- [ ] **Step 5: Commit** `feat(report-docs): tipos do snapshot google e rótulos GMN`.

### Task 3: Default layout, platform filter, cover helpers

**Files:**
- Modify: `supabase/functions/_shared/report-docs/default-layout.ts`, `platform-filter.ts`
- Test: `default-layout.test.ts`, `platform-filter.test.ts`

**Interfaces:**
- Consumes: Task 1 `PLATFORM_ORDER`, `SectionPlatform`.
- Produces: `DefaultLayoutPlatform = SectionPlatform`; `PlatformSectionOpts` gains `hasGbpUnits?: boolean` (2+ unit rows); `platformSectionBlocks("google", opts, makeId)` returns, in order: `gbp_kpi_profile_views, gbp_kpi_calls, gbp_kpi_directions, gbp_kpi_website_clicks, gbp_kpi_messages, gbp_kpi_new_reviews` (third), `gbp_surfaces, gbp_rating` (half), `gbp_actions_chart` (full), `gbp_keywords, gbp_review_highlight` (half), and `gbp_units` (full) only when `hasGbpUnits`. `buildDefaultLayout` emits the google section after tiktok when `platforms` includes `"google"`. `platform-filter.ts` imports `PLATFORM_ORDER` from sections.ts (delete its local copy) and `PLATFORM_NAMES` gains `google: "Google Meu Negócio"`; `LayoutPlatform = SectionPlatform`.

- [ ] **Step 1: Tests:** `buildDefaultLayout({platforms:["instagram","google"], hasGbpUnits:true, …})` → section kinds `general, instagram, google, general(Próximos passos)` and google blocks as listed (12 incl. `gbp_units`); with `hasGbpUnits:false` → 11 blocks, no `gbp_units`; result passes `validateLayout`. `selectPlatformSections`: legacy IG template + selected `["instagram","google"]` + `hasData` true for both → google section appended after the instagram section; neutral-only template → no google section; selected `["google"]` with IG template → IG section dropped, google appended after where IG was. `showAllPlatformHeadings` with IG(hideHeader) + google → both headings shown.
- [ ] **Step 2:** Run `deno test --no-check supabase/functions/_shared/report-docs/` → FAIL.
- [ ] **Step 3:** Implement `addGoogleSection(add, opts)` in default-layout.ts and the platform-filter changes.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(report-docs): seção google no layout padrão e no filtro de plataformas`.

### Task 4: GMN loader `report-docs/google-section.ts`

**Files:**
- Create: `supabase/functions/report-docs/google-section.ts`, `google-section.test.ts`
- Possibly modify: `supabase/functions/_shared/gbp-analytics/queries.ts` (only to export a helper the loader needs, e.g. `hasMetricsOnOrBefore`; no behavior change)

**Interfaces:**
- Consumes: `_shared/gbp-analytics` (`loadUnits`, `loadMetrics`, `loadRatings`, `computeGbpKpis`, `dailySeries`, `surfaceBreakdown`, `sumMetrics`, `buildRatingDistribution`, `aggregateKeywords`, `resolveWindow`, `windowDataThrough`), `monthWindow`, `lastDayOfMonth` (`_shared/sao-paulo-date.ts`), Task 2 types.
- Produces:
```ts
export async function loadGoogleReportSection(
  db: Db, contaId: string, clientId: number, month: string, now: Date,
): Promise<GoogleReportSnapshot | null>;
export async function hasGoogleUnits(db: Db, contaId: string, clientId: number): Promise<boolean>;
export function abbreviateReviewer(name: string | null): string; // "Mariana Costa Lima" -> "Mariana L."; "Mariana" -> "Mariana"; null/blank -> "Cliente do Google"
export const KEYWORD_ROWS = 10; export const HIGHLIGHT_MAX_CHARS = 400;
```
- Rules: no units → `null`. Window = `resolveWindow({kind:"range", start:`${month}-01`, end: lastDayOfMonth(month)}, windowDataThrough(units), now)`; `hasData` false → section with `window: null`, `emptyGbpKpis()` mapped to `unit`, empty arrays, `rating_distribution: null`, `highlight: null`, `unit_rows` with zeros. Otherwise KPIs exactly as `buildOverview` (`prevCovered` via the same probe); `unit` = `"rating"` for `avg_rating`, else `"count"`. Surfaces = `surfaceBreakdown(sumMetrics(rows, start, end))`. Daily = `dailySeries` mapped to `{date, calls, directions, websiteClicks, messages}`. Unit rows = per-unit `sumMetrics` + `average_rating`/`total_review_count` from the unit row (as `buildUnits`). Distribution = `buildRatingDistribution`. Keywords: rows for `${month}-01`; if none, the newest month `< month` among the stored months found by probing the 2 months before (`gbp_search_keywords_monthly`, `conta_id`, `in location_name`, `limit(1)`); `aggregateKeywords(rows).slice(0, KEYWORD_ROWS)`; `month` = the month used (`YYYY-MM`) or null. Highlight: one query `gbp_reviews` (`conta_id`, `in location_name`, `star_rating in (4,5)`, `create_time >= start (SP midnight→UTC)` and `< end+1 day`, `comment not null`), order `create_time desc`, limit 50; pick the first 5★ with trimmed non-empty comment, else first 4★; comment trimmed and cut at 400 chars (add "…" when cut); reviewer via `abbreviateReviewer`; `unit_title` from units; `date` = `create_time` ISO.
- Every query carries `.eq("conta_id", contaId)`. Query errors throw (the caller fails generation, as other sources).

- [ ] **Step 1: Tests** (mock db like `tiktok-section.test.ts` / `gbp-analytics` handler tests): `no units → null`; `window clipped to data_through` (month 2026-10, data_through 2026-10-29 → window 10-01..10-29, prev 09-02..09-30); `KPIs equal buildOverview for the same range` (feed identical rows to both, assert deep-equal values/prev); `window after data_through` (data_through 2026-09-30, month 2026-10 → `window: null`, every KPI value null); `revoked unit holds no window back` (active dt 10-29, revoked dt 10-10 → window end 10-29); `keywords fall back to previous month` (none for 10, rows for 09 → `month: "2026-09"`); `highlight prefers 5★ with text, else 4★, ignores blank comments`; `abbreviateReviewer` cases above; `every query filters conta_id`.
- [ ] **Step 2:** Run `deno test --no-check supabase/functions/report-docs/google-section.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `feat(report-docs): carregador da seção Google Meu Negócio`.

### Task 5: Generation, refresh, flags, PDF version

**Files:**
- Modify: `supabase/functions/report-docs/client-id.ts`, `snapshot-source.ts`, `generate.ts`, `refresh.ts`, `pdf.ts`
- Test: `client-id.test.ts`, `generate.test.ts`, `refresh.test.ts`, `pdf.test.ts` (if it pins the number)

**Interfaces:**
- Consumes: Task 3 `buildDefaultLayout`/`selectPlatformSections` with google; Task 4 `loadGoogleReportSection`, `hasGoogleUnits`.
- Produces:
  - `REPORT_PLATFORMS = ["instagram", "tiktok", "google"] as const`.
  - `connectedPlatforms(db, contaId: string, clientId: number, flags: { tiktokEnabled: boolean; googleEnabled: boolean }): Promise<ReportPlatform[]>`.
  - `loadClientSnapshot(db, deps, contaId, cliente, month, opts: { tiktokEnabled: boolean; googleEnabled: boolean; allowNone?: boolean }): Promise<{ snapshot; igAccountId; tiktokAccountId; googleUnitIds: string[] | null }>`; `snapshot.google` set from the loader; throws `GenerateError("not_found","Nenhuma rede conectada")` only when none of the three is connected AND `!allowNone`; with `allowNone` it returns the empty-Instagram snapshot.
  - `generate.ts`: `googleEnabled = await effectivePlanFeature(db, contaId, "feature_google_business")` read once; `connected` gains `"google"` when `snapshot.google`; `hasData: p => p==="instagram" ? … : p==="tiktok" ? !!snapshot.tiktok : !!snapshot.google`; `sectionOpts.hasGbpUnits = (snapshot.google?.unit_rows.length ?? 0) > 1`.
  - `refresh.ts`: calls `loadClientSnapshot(..., { tiktokEnabled, googleEnabled, allowNone: true })`; `carryOverFrozenPlatforms` keeps `prev.google` when `loaded.snapshot.google` is absent; after carry-over, if the result has no Instagram, no TikTok and no Google, throw `DocActionError("not_found")`.
  - `pdf.ts`: `PDF_RENDERER_VERSION = 7`.

- [ ] **Step 1: Tests:** `parseGenerateBody({clientId:1, month:"2026-10", platforms:["google"]})` → platforms `["google"]`; `["youtube"]` → null. generate: flag off → no `snapshot.google` and requesting `platforms:["google"]` → `invalid_platforms`; flag on, GMN-only client → doc inserted with sections `general, google, …`, `instagram_connected:false`; feature RPC error → generation fails. refresh: GMN-only doc whose units are gone → `data_snapshot.google` equals the stored one, no throw; doc with nothing frozen and nothing connected → `not_found`; TikTok-only doc with TikTok gone → kept (regression of the old 404).
- [ ] **Step 2:** Run `deno test --no-check supabase/functions/report-docs/` → FAIL.
- [ ] **Step 3:** Implement per Interfaces (update every existing `connectedPlatforms`/`loadClientSnapshot` call and test mock).
- [ ] **Step 4:** Run → PASS; `npm run check:functions` → PASS.
- [ ] **Step 5: Commit** `feat(report-docs): Google Meu Negócio na geração e no refresh`.

### Task 6: AI input, prompt rules, goal labels, fallback summary

**Files:**
- Modify: `supabase/functions/_shared/report-template/types.ts`, `ai.ts`, `supabase/functions/_shared/report-docs/ai-input.ts`, `tiptap-doc.ts`, `supabase/functions/report-docs/generate.ts`
- Test: `ai-input.test.ts`, `tiptap-doc.test.ts`, `supabase/functions/_shared/report-template/ai.test.ts` (or wherever `buildAIPrompt` is tested; grep)

**Interfaces:**
- Produces:
```ts
export interface ReportDataGoogle {
  units: number;
  window: { start: string; end: string; compared_with_days: number } | null;
  kpis: Record<GbpKpiId, number | null>;
  kpis_previous_period: Partial<Record<GbpKpiId, number>>; // only where value & prev non-null
  surfaces: { surface: GbpSurface; pct: number }[];
  top_keywords: { keyword: string; people: number | null; at_most: number | null }[]; // max 5
  rating_distribution: Record<"1"|"2"|"3"|"4"|"5", number> | null;
}
// ReportData.google?: ReportDataGoogle
export function snapshotToReportData(snap, platforms?: readonly ReportPlatform[]): ReportData; // adds google when snap.google && (!platforms || includes google)
export function prefixGoalMetrics(output: AIOutput, platform: "tiktok" | "google"): AIOutput; // replaces prefixTikTokGoalMetrics; google uses GBP_KPI_IDS and "gbp_"
```
  `FallbackPlatforms` gains `google: Record<GbpKpiId, GbpReportKpiEntry> | null`; GMN sentence: `No Google Meu Negócio: 18.420 visualizações do perfil, 592 ligações, 459 pedidos de rota, 223 cliques no site.` (only non-null parts; GMN-only: `Resumo de <mês> no Google Meu Negócio: …`). `metricLabel("gbp_calls")` → `"Ligações no Google Meu Negócio"`.
  `ai.ts`: `GOOGLE_RULES` (English, like `TIKTOK_RULES`): views are a sum of daily unique users per surface (a person on Search and Maps the same day counts twice); actions are taps on Ligar/Rotas/Site/Mensagem; no reach, followers, engagement rate or audience; previous-period values cover the same number of days right before, not the previous calendar month; `at_most` keywords mean "fewer than N people"; null = no data; no benchmarks; goal/recommendation ids about GMN use the `gbp_` prefix (e.g. `gbp_calls`). Scope line built from the platforms present (`Instagram`, `TikTok`, `Google Meu Negócio`): one platform → "covers only X"; 2-3 → "covers X, Y and Z. Write ONE narrative…". Non-Instagram-only prompt: the data object holds only the present non-Instagram platforms.
  `generate.ts`: after AI success, if Instagram is out of the narrative and exactly one other platform is in, apply `prefixGoalMetrics(output, thatPlatform)`; with two non-Instagram platforms, no prefixing (the prompt asks for prefixes). `narrativeGoogle` passed to fallback summary.

- [ ] **Step 1: Tests:** `snapshotToReportData` with google → `data.google.kpis.calls === 592`, no reviewer names anywhere in `JSON.stringify(data)`; `platforms:["instagram"]` → no `google`. `buildAIPrompt` with google only → system prompt contains `GOOGLE MEU NEGÓCIO DATA RULES` and "covers only Google Meu Negócio"; IG+TikTok+Google → "covers Instagram, TikTok and Google Meu Negócio"; IG-only prompt byte-identical to before (snapshot the string from `main`). `prefixGoalMetrics(out, "google")` turns `website_clicks` into `gbp_website_clicks` and leaves `gbp_calls` alone; `metricLabel` google case; fallback summary GMN-only and IG+GMN strings.
- [ ] **Step 2:** Run the three test files → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS; `npm run check:functions` → PASS.
- [ ] **Step 5: Commit** `feat(report-ai): Google Meu Negócio na narrativa do relatório`.

### Task 7: Renderer blocks (`packages/report-blocks`)

**Files:**
- Modify: `platform.ts`, `PlatformIcon.tsx`, `data-presence.ts`, `catalog.ts`, `BlockRenderer.tsx`, `styles.css`, `blocks/CoverBlock.tsx` (only if `coverDefaults` changes need it)
- Create: `blocks/gbp/GbpKpiCardBlock.tsx`, `GbpSurfacesBlock.tsx`, `GbpRatingBlock.tsx`, `GbpActionsChartBlock.tsx`, `GbpKeywordsBlock.tsx`, `GbpReviewHighlightBlock.tsx`, `GbpUnitsBlock.tsx`, `blocks/gbp/format.ts` (`fmtRating(4.75) → "4,8"`, `fmtWindowStamp(window, partial)`)
- Test: `__tests__/gbp-blocks.test.tsx`, `catalog.test.ts`, `platform.test.ts`

**Interfaces:**
- Consumes: Task 2 types/fixture, Task 1 `PLATFORM_BLOCK_PREFIXES`.
- Produces: `ReportPlatform` includes `google`; `PLATFORM_NAMES.google = "Google Meu Negócio"`; `PlatformIcon` google → `Store`; `coverDefaults` iterates `PLATFORM_ORDER` (no hardcoded list), google counts as "with data" when `snapshot.google`, and a google-first cover has `handle: ""` and the root `profile_picture_url`; `CoverBlock` hides the `@` line when the handle is empty (check current behavior first). `blockHasData`: `gbp_*` → false without `snapshot.google`; KPI → `kpis[id].value !== null`; `gbp_surfaces` → total > 0; `gbp_rating` → `kpis.avg_rating.value !== null`; `gbp_actions_chart` → any daily action > 0; `gbp_keywords` → rows > 0; `gbp_review_highlight` → highlight; `gbp_units` → `unit_rows.length > 1`. `instagramAbsent` unchanged. Catalog: 14 entries with `platform:'google'`, categories: 8 KPIs `Números`; `gbp_surfaces`,`gbp_actions_chart` `Gráficos`; `gbp_keywords`,`gbp_rating`,`gbp_review_highlight`,`gbp_units` `Conteúdo`; labels from the mockup drawer. `BLOCK_COMPONENTS` maps all 14.
- Copy (pt-BR, from the GMN tab's `analyticsGoogle.json` where it exists; mockup otherwise): stamp from `google.window` (`"01–29 de outubro · parcial"` when `window.end` < last day of the report month); KPI prev line `vs. N dias anteriores: X` (N = days of prev window); rating card "Situação em <dia> de <mês>", "<n> avaliações · +<new> no período", footnote "Distribuição das últimas 200 avaliações por unidade." only when `partial`; keywords footnote "O Google só mostra o número exato acima de 15 pessoas por mês." and month stamp ("Outubro de 2026"); highlight stamp "Avaliação de 18 de outubro", "<reviewer> · <unit_title>"; units status "Autorização expirada" for revoked. Surfaces footnote "<m>% pelo celular. Maps responde por <x>% das visualizações." Actions legend "Ligações / Rotas / Site / Mensagens" with totals; stacked SVG bars like `FollowerChartBlock` (viewBox 640×170). No em dashes.
- Styles: card classes `rb-card rb-card--pad`, title `rb-card-title`; new rules prefixed `.rb-gbp-` in `styles.css`; colors via theme tokens (`--rb-accent`, `--rb-ink`, `--rb-border`), action series may use fixed hues with a print-safe palette.

- [ ] **Step 1: Tests:** each of the 7 components renders fixture values (e.g. KPI "18.420"-style formatting of fixture value, rating "4,8", keyword "menos de 15", highlight reviewer, units row count 3) and returns null without `snapshot.google`; `blockHasData` matrix; `gbp_units` false with 1 unit row; catalog covers every `gbp_*` BLOCK_TYPE exactly once; `coverDefaults(snapshot, ["google"]).kicker === "Relatório mensal · Google Meu Negócio"`; IG+google kicker `"Relatório mensal · Instagram e Google Meu Negócio"`; existing renderer snapshot tests (`__snapshots__/legacy-*.html`) unchanged.
- [ ] **Step 2:** Run `npx vitest run packages/report-blocks` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS; `npx tsc -p apps/crm/tsconfig.json --noEmit` and `-p apps/hub/tsconfig.json` → PASS.
- [ ] **Step 5: Commit** `feat(report-blocks): widgets do Google Meu Negócio`.

### Task 8: CRM editor and Gerar relatório dialog

**Files:**
- Modify: `apps/crm/src/pages/relatorio-editor/{RelatorioEditorPage,ModeloEditorPage,EditorCanvas,LayersPanel,useBlockEditing,AddSectionMenu,AddWidgetDrawer,SectionFrame,widgetIcons,layoutOps}.tsx|ts`, `apps/crm/src/pages/analytics-conta/reports/{ClientReportsPanel,NewReportDialog}.tsx`, `packages/i18n/locales/{pt,en}/*.json` (only keys that go through `t()`)
- Test: existing `__tests__` beside those files (`grep -l tiktokEnabled apps/crm/src/**/__tests__`)

**Interfaces:**
- Consumes: Task 7 `ReportPlatform`, `PLATFORM_NAMES`, `PlatformIcon`; Task 1 `PLATFORM_ORDER`.
- Produces: every `tiktokEnabled?: boolean` prop/option becomes `enabledPlatforms: readonly ReportPlatform[]` (default `['instagram']`). Pages compute `enabledPlatforms = ['instagram', ...(features?.feature_tiktok === true ? ['tiktok'] : []), ...(features?.feature_google_business === true ? ['google'] : [])]`. Checks `section.kind !== 'tiktok' || tiktokEnabled` become `section.kind === 'general' || enabledPlatforms.includes(section.kind)`. `AddSectionMenu` lists `PLATFORM_ORDER.filter(p => enabledPlatforms.includes(p))` then Geral; Google item hint text from the mockup ("Visualizações, ligações, rotas, buscas e avaliações") shown when enabled and available; disabled hints keep today's wording with `PLATFORM_NAMES`. `documentPlatforms` adds `'google'` when `snapshot.google`. `SectionFrame` handle: google → `null` (show unit count "N unidades" in its place if the header has a slot; else nothing). `widgetIcons`: `Eye, Phone, Route, MousePointerClick, MessageSquare, CalendarCheck, Star, StarHalf/Sparkles` for KPIs, `MapPin`, `ChartColumnStacked` (or `ChartColumn`), `Search`, `Star`, `Quote`, `Table` (map is exhaustive over `BlockType`). `layoutOps` `DEFAULT_SIZE`: `gbp_kpi_*` third; `gbp_surfaces, gbp_rating, gbp_keywords, gbp_review_highlight` half. `ModeloEditorPage` sample opts gain `hasGbpUnits: true`. `ClientReportsPanel` `connected` gains `'google'` when `googleEnabled && googleSummary.gbp.locations` has any non-`disconnected` unit (reuse query key `['googleSummary', clientId]` and `getGoogleSummary`), unknown while loading → `undefined`.

- [ ] **Step 1: Tests:** `AddSectionMenu` with `enabledPlatforms=['instagram','google']` shows "Google Meu Negócio", not TikTok; with `availablePlatforms=['instagram']` the Google item is disabled with "Sem dados do Google Meu Negócio neste relatório. Atualize os dados depois de conectar a conta."; `drawerWidgets('google', true)` = the 14 gbp types + neutrals; `documentPlatforms` with google; LayersPanel/EditorCanvas google section without the flag has no "+"; `ClientReportsPanel` passes `connected` including google when summary has units; existing TikTok tests updated to `enabledPlatforms`.
- [ ] **Step 2:** Run `npx vitest run apps/crm/src/pages/relatorio-editor apps/crm/src/pages/analytics-conta/reports` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS; `npx tsc -p apps/crm/tsconfig.json --noEmit` → PASS.
- [ ] **Step 5: Commit** `feat(relatorios): seção Google Meu Negócio no editor e no dialog`.

### Task 9: Full CI checklist, docs, PR

- [ ] Run, from the worktree: `npm run lint`, `npm run format:check`, the five `npx tsc` commands from CLAUDE.md, `npm run build:mcp-widgets && git diff --exit-code supabase/functions/mcp/ui/generated/cards.ts`, `npm run test`, `npm run check:functions`, `npm run test:functions`. All pass (format failures: `npx prettier --write` only on touched files).
- [ ] CLAUDE.md: add a "Seção Google Meu Negócio nos relatórios" gotcha with the deploy order (migration `20261118000001` → merge → `report-docs` after the Vercel prod deploy is live) and rollback rule (roll back `report-docs` only).
- [ ] Commit, push, open the PR with the deploy order in the body; bind it (`ccd_pr`).
- [ ] Browser verification (needs Eduardo's go-ahead for the prod migration): DK Marketing Médico (`cbaf0da8-d042-46dd-a8ee-cd5ca2b857a0`): open a report, Adicionar seção → Google Meu Negócio, generate one with GMN via local `report-docs` against prod, check editor, Hub page, PDF and the numbers vs the GMN tab with the same custom range.
