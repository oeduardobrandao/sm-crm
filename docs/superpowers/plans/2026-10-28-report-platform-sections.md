# Report Platform Sections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reports become an ordered list of sections (Instagram, TikTok, Geral), each platform's widgets living only in its section, in storage, generation, rendering and the desktop editor.

**Architecture:** A `section` marker block opens a section inside today's flat `layout.blocks` (still `version: 1`). One shared module (`_shared/report-docs/sections.ts`) converts any layout to sections and back; validation lives in TS (`validateLayout`) and SQL (`validate_report_layout()` trigger) with shared fixtures. Generation picks whole sections, the renderer adds platform headings without changing the single grid, and the editor frames sections.

**Tech Stack:** TypeScript (pure TS shared by Deno and Vite), Deno edge functions, Postgres plpgsql, React 19, `@dnd-kit/core` + `@dnd-kit/sortable`, Vitest, `deno test`, psql entitlement suites.

**Spec:** `docs/superpowers/specs/2026-10-28-report-platform-sections-design.md` (read it: it is the authority).

## Global Constraints

- Layout stays `{ version: 1, blocks: ReportBlock[] }`. New block type `section`, `size: "full"`, `config` keys only `platform` (`"instagram"|"tiktok"`, absent = Geral), `title` (string, 1..80 chars after trim), `hideHeader` (exactly `true`, only with `platform`). No `text`. Serializers omit absent keys.
- Canonical rules (any layout with ≥1 `section`): first block is a `section`; a platform block (`blockPlatform(type) !== null`) sits in a section of the same platform; at most one section per platform; `MAX_SECTIONS = 12`; empty sections valid. `cover` is NOT restricted.
- Layout without any `section` = legacy, accepted unchanged.
- Caps: `MAX_BLOCKS = 200` counts non-`section` blocks; sections capped by `MAX_SECTIONS`; array may hold 212.
- `sectionizeLayout(x)` of any layout the old validator accepted must pass the new `validateLayout` (property test).
- Rendering keeps ONE `.rb-grid`; no wrapper element around sections; headings are full-width grid items.
- View-mode omission: a section with a visible heading whose platform widgets all lack data (`blockHasData`; neutral blocks do not count) is omitted whole. `hideHeader` sections keep today's per-block rule.
- Copy is pt-BR, sentence case, no em dashes. Icons `lucide-react` (Instagram = `Instagram`, TikTok = `Music2`, Geral = `PanelTop`).
- TikTok section offered only with `features?.feature_tiktok === true` (fail closed while loading).
- Phone (`ReportPhoneView`) stays read-only; no section editing on phone.
- Deploy: migration `20261103000003` → merge → `report-docs` + `instagram-report-generator-v2` after the Vercel production deploy is live.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Prettier/eslint only on the files you changed.

## Review Focus

1. A legacy layout with a `cover` or `text` block in an odd place (inside an Instagram run, between two Instagram runs, several covers) must convert, keep every block in order, and validate. Test in Task 1.
2. A legacy report must render the same DOM as before, including a section boundary falling mid-row. Test in Task 4.
3. A workspace template with no platform section, generated with platforms selected, must get no section added. Test in Task 3.
4. In the editor, removing a platform section and undoing must restore it in place with its blocks. Test in Task 6.
5. A document without TikTok data must not offer the TikTok section ("Sem dados do TikTok neste relatório. Atualize os dados depois de conectar a conta."). Test in Task 6.

---

### Task 1: Section model (shared TS)

**Files:**
- Modify: `supabase/functions/_shared/report-docs/layout.ts`
- Create: `supabase/functions/_shared/report-docs/sections.ts`
- Create: `supabase/functions/_shared/report-docs/sections.test.ts`
- Modify: `supabase/functions/_shared/report-docs/layout.test.ts`
- Create: `supabase/tests/fixtures/report_section_layouts.json`
- Modify: `packages/report-blocks/types.ts` (re-export the new names)
- Modify: `apps/crm/src/pages/relatorio-editor/widgetIcons.ts` (entry `section: PanelTop`, keeps the exhaustive map compiling)

**Interfaces:**
- Produces (in `layout.ts`): `"section"` in `BLOCK_TYPES` and in `PLATFORM_NEUTRAL_TYPES` (so `blockPlatform("section") === null`); `MAX_SECTIONS = 12`; `SECTION_TITLE_MAX = 80`; `validateLayout` implementing every Global Constraints rule.
- Produces (in `sections.ts`, re-exported from `packages/report-blocks/types.ts`):
  - `type SectionKind = "general" | "instagram" | "tiktok"`
  - `interface ReportSection { marker: ReportBlock; kind: SectionKind; blocks: ReportBlock[]; synthesized: boolean }` (`synthesized` = the marker was created by conversion/repair, not stored)
  - `isSectionMarker(b: ReportBlock): boolean`
  - `sectionKindOf(marker: ReportBlock): SectionKind`
  - `makeSectionMarker(kind: SectionKind, opts?: { id?: string; title?: string; hideHeader?: true }): ReportBlock`
  - `toSections(layout: ReportLayout, makeId?: () => string): ReportSection[]` (legacy inference + repair, spec §Reading)
  - `fromSections(sections: ReportSection[], base: ReportLayout): ReportLayout` (keeps `accent`/`theme`/`fonts`)
  - `sectionizeLayout(layout: ReportLayout, makeId?: () => string): ReportLayout` (returns the SAME reference when already canonical; the editor's autosave relies on `===`)
  - `isSectioned(layout: ReportLayout): boolean`
  - `sectionOfBlock(layout: ReportLayout, blockId: string): ReportSection | undefined`
  - `sectionPlatforms(layout: ReportLayout): ("instagram" | "tiktok")[]` (platform sections in order; legacy layouts via `toSections`)
  - `contentBlockCount(layout: ReportLayout): number` (non-`section` blocks)
  - `makeId` defaults to `() => crypto.randomUUID()`.
- Fixture file shape: `[{ "name": string, "valid": boolean, "layout": object }]`, consumed by Task 2's SQL suite and this task's parity test.

- [ ] **Step 1: Write the fixtures and failing tests.** Fixtures cover at least: legacy default Instagram layout (valid), canonical default (Geral, Instagram, TikTok, Geral) (valid), empty section (valid), cover inside an Instagram section (valid), two covers (valid), first block not a section (invalid), `tiktok_kpi_views` in an Instagram section (invalid), two Instagram sections (invalid), 13 sections (invalid), 200 content blocks + 12 sections (valid), 201 content blocks (invalid), section `size: "half"` (invalid), section with `text` (invalid), unknown config key (invalid), `platform: "youtube"` (invalid), `title: ""` and 81-char title (invalid), `hideHeader: false` (invalid), `hideHeader: true` on a Geral section (invalid).
  Tests in `layout.test.ts`: `validateLayout` agrees with `valid` on every fixture (read the JSON with `Deno.readTextFile(new URL("../../../tests/fixtures/report_section_layouts.json", import.meta.url))`).
  Tests in `sections.test.ts`:
  - `toSections` on `buildDefaultLayout({hasAi:true,hasAudience:true,hasBestTimes:true,hasTags:true})` from **before Task 3** (inline a legacy copy as a fixture: cover, ai_summary, the four Instagram `section_header` runs, "Próximos passos" + ai blocks) yields kinds `["general","instagram","general"]`, Instagram section `hideHeader: true`, every block id in original order.
  - neutral text segment between two Instagram segments joins Instagram; between Instagram and TikTok becomes Geral; a mixed segment splits at the platform change.
  - repair: platform block before the first marker → leading Geral; misplaced `tiktok_kpi_views` in Instagram section moves to the end of the TikTok section (created after the last platform section when missing); a second Instagram section merges into the first.
  - property: for 300 random legacy layouts (seeded PRNG; random mix of all `BLOCK_TYPES` except `section`, sizes valid, 0..60 blocks, covers anywhere) `validateLayout(sectionizeLayout(x)).ok === true` and the multiset of block ids is preserved.
  - `sectionizeLayout(canonical) === canonical`; `fromSections(toSections(c), c)` deep-equals `c` for every valid canonical fixture.
  - `contentBlockCount` ignores markers; `sectionPlatforms` returns `["instagram","tiktok"]` for the canonical default.
- [ ] **Step 2: Run, verify failure.** `deno test --no-check --node-modules-dir=auto --allow-read --allow-env supabase/functions/_shared/report-docs/` → fails (no `sections.ts`, validator rejects `section`).
- [ ] **Step 3: Implement** `layout.ts` changes and `sections.ts`. Legacy inference algorithm is the spec's (§Reading): split at `section_header`, classify segments, assign neutral segments, merge consecutive same-kind. Inferred platform sections get `hideHeader: true`; inferred Geral sections have no title.
- [ ] **Step 4: Run, verify pass.** Same command → all green. Also `npx tsc -p apps/crm/tsconfig.json --noEmit` and `npx tsc -p apps/hub/tsconfig.json --noEmit` = 0 (the `widgetIcons` entry keeps the exhaustive map compiling; `BLOCK_COMPONENTS` is `Partial` and needs nothing).
- [ ] **Step 5: Commit** `feat(reports): section marker model and legacy conversion`.

### Task 2: Database trigger enforces sections

**Files:**
- Create: `supabase/migrations/20261103000003_report_layout_sections.sql`
- Create: `supabase/tests/entitlements/99_report_layout_sections.sql`

**Interfaces:**
- Consumes: `supabase/tests/fixtures/report_section_layouts.json` (Task 1).
- Produces: `validate_report_layout()` that accepts exactly what TS `validateLayout` accepts on the fixtures, for both `report_documents` and `report_templates`.

- [ ] **Step 1: Write the failing suite.** Load fixtures with `\set fixtures `cat supabase/tests/fixtures/report_section_layouts.json`` (the runner's cwd is the repo root). Follow `66_report_docs.sql` for setup (workspace, client, document and template via the `et_*` helpers), then for each fixture run `update report_documents set layout = <fixture>`; assert success for `valid: true` and `INVALID_LAYOUT` for `valid: false`. Repeat on `report_templates`. Add one legacy layout at exactly 200 content blocks (valid) and the same plus 12 markers (valid).
- [ ] **Step 2: Verify failure** locally if Docker is available (`npm run test:db`), else note that CI's `entitlement-tests` job runs it; at minimum `psql` syntax check against a local DB.
- [ ] **Step 3: Implement the migration.** `CREATE OR REPLACE FUNCTION validate_report_layout()` with the full current body (from `20261003000001_report_image_block.sql`) plus: block count rule replaced by `count(non-section) <= 200 AND count(section) <= 12`; per-block marker shape; ordered walk (`jsonb_array_elements(...) WITH ORDINALITY`) enforcing first-block, platform-in-matching-section (`tiktok_` prefix = tiktok, neutral list = `cover, section_header, divider, text, ai_summary, ai_recommendations, ai_goals, image, section`, else instagram) and one-section-per-platform. Legacy layouts (no `section`) skip the ordered walk.
- [ ] **Step 4: Verify pass** (`npm run test:db` or CI). Also run `66_report_docs.sql`, `99_report_image_files.sql`, `63_storage_autoclean.sql` unchanged.
- [ ] **Step 5: Commit** `feat(reports): layout trigger validates sections`.

### Task 3: Generation picks sections

**Files:**
- Modify: `supabase/functions/_shared/report-docs/default-layout.ts`, `platform-filter.ts`, `default-layout.test.ts`, `platform-filter.test.ts`
- Modify: `supabase/functions/report-docs/generate.ts`, `generate.test.ts`

**Interfaces:**
- Consumes: Task 1 (`makeSectionMarker`, `toSections`, `fromSections`, `sectionizeLayout`, `sectionPlatforms`, `contentBlockCount`, `MAX_BLOCKS`).
- Produces:
  - `buildDefaultLayout(opts)` returns a canonical layout: `[Geral: cover, ai_summary]`, Instagram section (marker `{platform:"instagram"}`) with today's blocks, TikTok section (marker `{platform:"tiktok"}`) with today's blocks minus the leading `section_header "TikTok"`, then when `hasAi` a Geral marker `{title:"Próximos passos"}` + `section_header "Próximos passos"` + `ai_recommendations` + `ai_goals`.
  - `platformSectionBlocks(platform, opts, makeId?)`: content blocks only (no marker), same blocks as above. Task 6 uses it for Adicionar seção.
  - `selectPlatformSections(layout: ReportLayout, selected: LayoutPlatform[], opts: { hasData: (p: LayoutPlatform) => boolean; sectionOpts: PlatformSectionOpts; makeId?: () => string; onCapSkip?: (p: LayoutPlatform) => void }): ReportLayout` replacing `dropUnselectedPlatformBlocks` + `addMissingPlatformSections` (spec §Generation: sectionize, drop unselected/no-data platform sections, append missing selected ones after the last platform section only when ≥1 platform section exists, per-section cap with `console.warn`).
  - `showAllPlatformHeadings(layout: ReportLayout): ReportLayout` (clears `hideHeader` on every platform section when there are ≥2; same reference otherwise).
  - `narrativePlatforms(layout, selected)` reads `sectionPlatforms`.
  - `NEXT_STEPS_TITLE` stays exported.

- [ ] **Step 1: Failing tests.** `default-layout.test.ts`: canonical output for IG-only, TikTok-only, both, AI on/off; TikTok section has no `section_header` titled "TikTok"; `validateLayout(...).ok`. `platform-filter.test.ts`: legacy Instagram template + `["tiktok"]` → Instagram section dropped and the default TikTok section inserted where the template's last platform section was (the insertion point is computed on the template before dropping); template with no platform section + both selected → unchanged except sectionized; deselected platform's section removed whole; cap skip calls `onCapSkip`; `showAllPlatformHeadings` on a converted legacy template with appended TikTok clears both `hideHeader`. `generate.test.ts`: system default with AI failure has no "Próximos passos" marker and no empty Geral section; workspace template with AI failure keeps its sections; generated layouts always canonical.
- [ ] **Step 2: Verify failure** with `deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/_shared/report-docs/ supabase/functions/report-docs/`.
- [ ] **Step 3: Implement.** In `generate.ts`: template path = `selectPlatformSections(sanitized, selected, …)` then `showAllPlatformHeadings`; system path = `buildDefaultLayout`; AI-failure path for the system default removes the whole Geral section whose marker title is `NEXT_STEPS_TITLE` (marker and contents) instead of filtering the header block; templates untouched as today.
- [ ] **Step 4: Verify pass**, plus `deno check --node-modules-dir=auto supabase/functions/report-docs/index.ts`.
- [ ] **Step 5: Commit** `feat(reports): generation selects whole platform sections`.

### Task 4: Renderer headings and view omission

**Files:**
- Modify: `packages/report-blocks/BlockRenderer.tsx`, `platform.ts`, `data-presence.ts`, `catalog.ts`, `styles.css`
- Create: `packages/report-blocks/PlatformIcon.tsx`, `packages/report-blocks/blocks/PlatformSectionHeading.tsx`
- Modify: `supabase/functions/report-docs/pdf.ts` (`PDF_RENDERER_VERSION = 6`)
- Test: `packages/report-blocks/__tests__/BlockRenderer.test.tsx`, `platform.test.ts`, `catalog.test.ts`, new `PlatformSectionHeading.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`toSections`, `sectionPlatforms`, `isSectionMarker`).
- Produces:
  - `PlatformIcon({ platform: ReportPlatform; className?: string; size?: number })` (lucide `Instagram` / `Music2`, `aria-hidden`).
  - `PlatformSectionHeading({ section: ReportSection; snapshot: ReportDocSnapshot })`: full-width grid item `<div class="rb-full rb-platform-heading" data-section-id={marker.id}>` with icon, `<h2>` (title or `PLATFORM_NAMES[kind]`) and the account handle (`@handle` from the snapshot's Instagram account or `snapshot.tiktok.account.handle`) on the right.
  - `sectionVisibleInView(section: ReportSection, snapshot: ReportDocSnapshot): boolean` in `data-presence.ts` (Global Constraints omission rule).
  - `layoutPlatforms(layout)` = `sectionPlatforms(layout)` for sectioned layouts, today's block-type scan for legacy (identical results on legacy).
  - `WIDGET_CATALOG`: `section_header` label "Subtítulo"; no `section` entry.

- [ ] **Step 1: Failing tests.**
  - Legacy DOM parity: render today's legacy default layout and a legacy layout with a third-width `text` followed by `kpi_reach` third-width across a `section_header` boundary and across a mixed-platform boundary; assert `container.innerHTML` equals the snapshot recorded from the pre-change renderer (record it first, in the RED commit, from the unmodified renderer).
  - Canonical default: one `.rb-grid`; blocks remain direct children (`grid.querySelectorAll(':scope > [data-block-id]').length` = content blocks); one `.rb-platform-heading` per platform section; no heading for Geral; `hideHeader` hides it.
  - View omission: TikTok section with heading and no `snapshot.tiktok` → no heading, no sub-headings in `view` and `print`; same layout with `hideHeader` → today's per-block result; edit-free renderer has no edit mode, so only `view`/`print` covered here.
  - `layoutPlatforms` on a TikTok-only canonical layout = `["tiktok"]`; cover kicker in `CoverBlock` reads "· TikTok".
  - `catalog.test.ts`: `section_header` label "Subtítulo"; no catalog entry has type `section`.
- [ ] **Step 2: Verify failure** `npx vitest run packages/report-blocks`.
- [ ] **Step 3: Implement.** `BlockRenderer` maps `toSections(layout)`: for each section, heading (if platform, not hidden, and `sectionVisibleInView`), then its blocks exactly as today; skips the whole section when `!sectionVisibleInView`. Heading styles in `styles.css`: one level above `.rb-section-header`, per theme via the existing `--rb-*` variables, `break-after: avoid` in print. Bump `PDF_RENDERER_VERSION` to 6.
- [ ] **Step 4: Verify pass** `npx vitest run packages/report-blocks apps/hub/src/pages` and `npx tsc -p apps/hub/tsconfig.json --noEmit`.
- [ ] **Step 5: Commit** `feat(reports): platform section headings in the renderer`.

### Task 5: Editor layout operations

**Files:**
- Modify: `apps/crm/src/pages/relatorio-editor/layoutOps.ts`, `templateOps.ts`, `useBlockEditing.ts`
- Modify: `apps/crm/src/pages/configuracao/tabs/ReportTemplatesCard.tsx`, `apps/crm/src/pages/configuracao/tabs/phone/ReportTemplatesPhone.tsx` (block count = `contentBlockCount`)
- Test: `apps/crm/src/pages/relatorio-editor/__tests__/layoutOps.test.ts`, `templateOps.test.ts`, matching configuracao tests

**Interfaces:**
- Consumes: Task 1.
- Produces (all pure, canonical input in, canonical output; unchanged input returns the same reference):
  - `insertBlockInSection(layout, sectionId: string, type: BlockType, position?: number): ReportLayout` (`position` = index within the section's blocks; absent = end). Replaces `insertBlockAt` for the editor (keep `insertBlockAt` only if other callers remain).
  - `addSection(layout, kind: SectionKind, afterSectionId: string | null, blocks?: ReportBlock[]): ReportLayout` (`null` = after the last section; returns same ref when it would break a rule: duplicate platform, `MAX_SECTIONS`, `MAX_BLOCKS`).
  - `removeSection(layout, sectionId): ReportLayout`; `restoreSection(layout, section: ReportSection, index: number): ReportLayout` (undo toast).
  - `moveSection(layout, sectionId, delta: 1 | -1)`; `reorderSections(layout, activeSectionId, overSectionId)`.
  - `updateSectionConfig(layout, sectionId, patch: { title?: string | null; hideHeader?: boolean }): ReportLayout` (trims; `""`/`null` removes `title`; `hideHeader:false` removes the key).
  - `moveBlock(layout, activeId, overId)`: unchanged signature; same reference when `overId` is in another section or is a marker.
  - `DEFAULT_SIZE`: TikTok KPI types (`tiktok_kpi_*`) default to `third`.
  - `useBlockEditing`: `insertTarget: { sectionId: string; position?: number } | null`, `openWidgetDrawer(target)`; `handleRemoveBlock` unchanged.
  - `applyTemplateLayout(template, current)` returns a sectionized layout (`sectionizeLayout(template)` first).

- [ ] **Step 1: Failing tests** for every op above, including: insert TikTok KPI into the TikTok section lands at the end with size `third`; insert into a section whose id does not exist → same ref; `moveBlock` across sections → same ref; `addSection("tiktok")` when one exists → same ref; `removeSection` then `restoreSection` deep-equals the original; `updateSectionConfig` trims and validates (81 chars rejected → same ref); template list shows content counts.
- [ ] **Step 2: Verify failure** `npx vitest run apps/crm/src/pages/relatorio-editor/__tests__/layoutOps.test.ts apps/crm/src/pages/relatorio-editor/__tests__/templateOps.test.ts`.
- [ ] **Step 3: Implement** on top of `toSections`/`fromSections`; every result passes `validateLayout`.
- [ ] **Step 4: Verify pass** plus `npx tsc -p apps/crm/tsconfig.json --noEmit`.
- [ ] **Step 5: Commit** `feat(reports): section-aware editor layout operations`.

### Task 6: Editor UI with section frames

**Files:**
- Modify: `apps/crm/src/pages/relatorio-editor/EditorCanvas.tsx`, `LayersPanel.tsx`, `AddWidgetDrawer.tsx`, `RelatorioEditorPage.tsx`, `ModeloEditorPage.tsx`, `ModeloPadraoPage.tsx`
- Create: `apps/crm/src/pages/relatorio-editor/SectionFrameHeader.tsx`, `AddSectionMenu.tsx`
- Delete: `apps/crm/src/pages/relatorio-editor/PlatformBadge.tsx` (and its usages/tests)
- Test: the existing `__tests__` for those files plus new `SectionFrameHeader.test.tsx`, `AddSectionMenu.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`toSections`, `sectionizeLayout`, `ReportSection`), Task 3 (`platformSectionBlocks` via `@mesaas/report-blocks` re-export or the existing relative import pattern `buildSystemDefaultLayout` uses), Task 4 (`PlatformIcon`, `PLATFORM_NAMES`), Task 5 (all ops, `useBlockEditing` target).
- Produces: the UI in the mockups (`https://claude.ai/artifact/P63h7q7MXazMNSUfakEs1y`, artboards "Editor do relatório (desktop)" and "Adicionar widget na seção TikTok").
  - `AddWidgetDrawer` props: `{ open; onOpenChange; onInsert: (type: BlockType) => void; section: { kind: SectionKind } | null; hasCover: boolean }`. Lists widgets with `platform === kind` for platform sections plus neutral ones; Geral lists neutral only; `cover` only for Geral and only when `!hasCover`; subtitle "Na seção Instagram" / "Na seção TikTok" / "Na seção Geral".
  - `AddSectionMenu` props: `{ existing: SectionKind[]; tiktokEnabled: boolean; availablePlatforms: ReportPlatform[] | "all"; onAdd: (kind: SectionKind) => void }` (`"all"` in templates; documents pass `documentPlatforms(snapshot)`).

Copy (exact): section menu "Renomear seção", "Mover para cima", "Mover para baixo", "Ocultar título no relatório" / "Mostrar título no relatório", "Remover seção"; remove confirm title "Remover seção?", body "Os widgets desta seção também saem do relatório.", button "Remover"; section footer "Adicionar widget"; between sections "Adicionar seção"; items "Instagram", "TikTok", "Geral" with "Texto, imagens e análises da IA" under Geral; disabled hints "Já existe uma seção do Instagram", "Já existe uma seção do TikTok", "Sem dados do Instagram neste relatório. Atualize os dados depois de conectar a conta.", "Sem dados do TikTok neste relatório. Atualize os dados depois de conectar a conta."; Geral label default "Geral"; hidden-heading note "Sem título no relatório".

- [ ] **Step 1: Failing tests.**
  - Pages: a legacy document opens sectionized (canvas shows a "Geral" frame and an "Instagram" frame) and the first autosave payload passes `validateLayout` and contains `section` markers.
  - Canvas: one frame per section with `SectionFrameHeader`; footer "Adicionar widget" opens the drawer scoped to that section; inserted widget lands in that section.
  - Drawer: TikTok section lists "Visualizações" and "Lista de vídeos", not "Alcance"; Geral lists no platform widget; no radiogroup.
  - Section menu: move down swaps sections; hide title toggles `hideHeader`; remove with confirm removes section and blocks; "Desfazer" toast restores it in place (Review Focus 4).
  - A template holding a TikTok section opened without `feature_tiktok`: the section renders and can be removed, its "Adicionar widget" is absent.
  - Add-section: TikTok absent without `feature_tiktok`; TikTok disabled with "Sem dados do TikTok neste relatório. Atualize os dados depois de conectar a conta." when the document snapshot has no `tiktok` (Review Focus 5); disabled "Já existe…" when present; adding TikTok in a template inserts `platformSectionBlocks("tiktok")`.
  - Drag: dragging a block onto a block of another section does nothing; section reorder by dragging the header works (keyboard sensor path is enough in jsdom).
  - Layers panel: tree with section rows and indented blocks; `+` inside a section inserts into it.
  - `PlatformBadge` no longer rendered anywhere.
- [ ] **Step 2: Verify failure** `npx vitest run apps/crm/src/pages/relatorio-editor`.
- [ ] **Step 3: Implement.** Pages run `sectionizeLayout` on the loaded layout (documents and templates) before handing it to `useLayoutAutosave`/history. Canvas: an outer `SortableContext` of section ids (`verticalListSortingStrategy`), one inner `SortableContext` per section (`rectSortingStrategy`) each in its own frame with the frame's own `.rb-grid`; `onDragEnd` routes marker ids to `reorderSections` and block ids to `moveBlock`. Layers panel mirrors it. Remove `PlatformBadge`.
- [ ] **Step 4: Verify pass** `npx vitest run apps/crm/src/pages/relatorio-editor apps/crm/src/pages/configuracao`, `npx tsc -p apps/crm/tsconfig.json --noEmit`, `npx eslint apps/crm/src/pages/relatorio-editor`.
- [ ] **Step 5: Commit** `feat(reports): editor frames sections with scoped widgets`.

### Task 7: Docs and deploy notes

**Files:**
- Modify: `CLAUDE.md` (Gotchas: report sections deploy order: migration `20261103000003` before merge; deploy `report-docs` and `instagram-report-generator-v2` only after the Vercel production deploy of the merge is live; why: the pre-merge editor's `validateLayout` rejects `section`)
- Modify: `docs/superpowers/specs/2026-10-28-tiktok-analytics-and-multiplatform-reports-design.md` (one line under §B2 pointing to the sections spec as superseding the free-mix editor and §Deploy's Part B order)

- [ ] **Step 1:** Write both edits.
- [ ] **Step 2:** `npx prettier --check CLAUDE.md` passes or matches the file's existing style.
- [ ] **Step 3: Commit** `docs(reports): sections deploy order`.

## Execution waves (parallel lanes)

- Wave 1: Task 1 (alone; everything consumes it).
- Wave 2, in parallel: Task 2, Task 3, Task 4, Task 5, Task 7 (disjoint files).
- Wave 3: Task 6.
- Then: whole-branch review, full gates in a clean worktree, staging deploy (migration, then frontend preview, then functions) and a browser check of generate IG-only / TikTok-only / both, a legacy document, the Hub page and the PDF.
