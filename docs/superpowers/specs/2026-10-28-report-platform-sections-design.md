# Report sections per platform

Status: draft, awaiting Eduardo's approval (2026-10-28). Reviewed by Codex and a builder check; their points are folded in. Mockups: https://claude.ai/artifact/P63h7q7MXazMNSUfakEs1y Ships inside PR #766 (Part B of
`2026-10-28-tiktok-analytics-and-multiplatform-reports-design.md`), before it merges. Replaces
§B2's "free mix" editor model and the generate-time block filtering of §B1.

## Intent

With TikTok in reports, every widget belongs to a platform, but the report is still one flat list
of blocks: a "section" is just a `section_header` block holding a title, and nothing stops a TikTok
KPI from sitting between two Instagram KPIs. #766 keeps that list coherent by guessing in three
places (drop orphaned headers after deselecting a platform, insert a missing platform's section by
looking for the "Próximos passos" title, a platform switch inside the widget drawer). That holds for
two platforms and breaks as soon as a third arrives.

The standard in the tools agencies compare us with (Reportei, mLabs) is **one block per network**:
each network's metrics live inside that network's block, the user reorders whole networks, and a
separate free block ("Bloco Personalizado" in Reportei) holds cross-network summaries, manual
metrics and analysis. This spec makes sections a real part of the report.

## Decided by Eduardo

1. Reports are split into **sections**: an Instagram section, a TikTok section, and general
   content. Every widget of a platform lives only inside that platform's section.
2. The work folds into #766 instead of shipping the flat TikTok model first.

## Goals

- A report is an ordered list of sections. Section kinds: **Instagram**, **TikTok**, **Geral**.
- Platform widgets can only be added to, and only live in, their platform's section.
- Generation picks sections, not blocks: choosing platforms includes or skips whole sections.
- The desktop editor (document and template) shows and edits sections as such; the phone view, read-only as today, shows them.
- Every existing document and template keeps rendering exactly as it does today.

## Non-goals

- Cross-platform widgets (combined followers, total views). The Geral section is where they will
  live; building them is the next initiative.
- More than one section per platform.
- Per-section period, colors or theme.
- Dragging a block from one section into another (v1: remove and re-add).
- New platforms. The model must take a third one by adding a kind, nothing more.

## Anti-goals

- **An existing report that looks different after the deploy** (Hub page, PDF, editor preview).
- **A platform widget outside its platform's section**, in any write path.
- **A block lost when an old layout is read as sections.** The conversion keeps every block.

## Model

### Encoding: a `section` marker block (my call)

The layout stays a flat `blocks` array at `version: 1`. A new structural block type `section` opens a
section; every block belongs to the nearest `section` before it.

```ts
{ id, type: "section", size: "full",
  config?: { platform?: "instagram" | "tiktok",  // absent = Geral
             title?: string,                      // trimmed, 1..80 chars
             hideHeader?: true } }                // platform sections only
```

Exact accepted shape (TS `validateLayout` and the SQL trigger agree on it): `size` is `"full"`; no
`text`; `config` absent or an object whose keys are a subset of `platform`, `title`, `hideHeader`
(any other key is rejected, unlike other blocks' permissive config); `platform` one of the two
strings; `title` a string of 1 to 80 characters after trim; `hideHeader` exactly `true` and only
alongside `platform`. Serializers omit absent keys rather than writing `false` or `""`.

Why a marker and not `{ version: 2, sections: [...] }`:
- **Old bundles stay safe.** A CRM or Hub tab open across the deploy keeps its old bundle (silent
  updates). Today's renderer draws an unknown block type as nothing, so an old bundle shows a
  sectioned report as today's flat report minus the platform headings. A `version: 2` nested shape
  would render empty or crash in that tab and in the print page.
- **Server first stays safe.** `report-docs` deploys before the merge (as for Part B). With a marker
  it can write sectioned layouts that the live prod frontend still renders.
- **Little else moves.** `listReportDocs`'s `layout->blocks`, ids, autosave, undo history and the
  per-block code all keep working on one array. The DB trigger gains the section rules (below).

Code never walks the raw array to find sections. One shared module (`_shared/report-docs/sections.ts`,
re-exported by `packages/report-blocks`) owns the structure:

- `toSections(layout): ReportSection[]` where
  `ReportSection = { marker: ReportBlock /* the section block, synthesized for legacy */, kind:
  "general" | "instagram" | "tiktok", blocks: ReportBlock[] }`.
- `fromSections(sections, base: ReportLayout): ReportLayout` (inverse; keeps `accent`/`theme`/`fonts`).
- `sectionizeLayout(layout): ReportLayout` = `fromSections(toSections(layout))`: the canonical form.

### Rules

A layout with no `section` block is **legacy** and is accepted unchanged (old templates and
documents must keep validating). A layout with at least one `section` block must be **canonical**:

1. The first block is a `section`.
2. A platform block (`blockPlatform(type) !== null`) sits in a section of the same platform.
3. At most one section per platform. At most `MAX_SECTIONS` = 12 sections in all.
4. Every `section` block has the exact shape above.
5. Empty sections are valid.

`cover` stays neutral and unpinned, as today: it may sit in any section and a layout may hold more
than one (the editor allows both now, so prod data has them). The drawer only offers it in Geral
sections (§Editor), which is guidance, not a rule. *(my call: a rule here would force moving a
legacy cover on conversion, changing how that report renders.)*

**Conversion always validates.** `sectionizeLayout` of any layout the old `validateLayout` accepted
returns a layout the new `validateLayout` accepts (a property test over generated legacy layouts).
Without that, the editor would open a converted document whose first autosave is rejected, with no
retry: the failure `normalizeCoverSize` exists to prevent.

**Caps.** `MAX_BLOCKS` (200) counts content blocks only, `section` blocks excluded; sections have
their own cap (rule 3). So converting a legacy layout that is already at 200 blocks adds at most a
handful of markers and stays valid; nobody gets stuck behind autosave. The array can therefore hold
up to 212 entries.

**Where the rules are enforced.** Writes reach the database two ways: the CRM editor's autosave goes
straight to PostgREST (gated client-side by `validateLayout`), and `report-docs` writes generated
documents. The database's `validate_report_layout()` trigger is the gate both share, and it already
mirrors the per-block rules (cover full width, image config, text only on text blocks). A new
migration extends it with the marker shape (rule 4), the two caps, and rules 1 to 3, walking the
array in order (`jsonb_array_elements ... WITH ORDINALITY`). `validateLayout` in TS implements the
same rules with the same results, and a parity test runs both over the same fixtures.

### Reading: tolerant, never loses a block

`toSections` accepts anything `validateLayout` would have accepted before this change, plus layouts
that break rules 1-3:

- **Legacy layout (no `section` block):** split at each `section_header` into segments (the header
  starts its segment; blocks before the first header form a leading segment). A segment's platform
  is that of its platform blocks; none = neutral. A segment mixing platforms is split where the
  platform changes. Then:
  - consecutive segments of the same platform form that platform's section;
  - a neutral segment between two segments of the same platform joins that section;
  - every other neutral segment forms a Geral section (consecutive ones merge).
  Inferred platform sections get `hideHeader: true`, so the converted report renders exactly as
  the flat one did (the existing `section_header` blocks inside stay as sub-headings).
- **Sectioned layout breaking a rule** (only reachable through a write that skips both gates, such
  as a service-role script; kept so a bad row never breaks a page): blocks before the first marker go to a leading Geral
  section; a misplaced platform block moves to the end of its platform's section (created and
  appended after the last platform section if missing); a second section of the same platform
  merges into the first.

Every block id survives. Order changes only in the repair cases, which no prod data reaches: prod
layouts are legacy and Instagram-only, and conversion of a legacy layout produces at most one
section per platform unless the same platform's segments are split by another platform's, which
only #766's unmerged editor could write.

The upgrade is persisted only when someone edits: the editor works on `sectionizeLayout(stored)` and
its next autosave writes the canonical form. Generation always writes canonical layouts. No data
migration.

## Rendering (`packages/report-blocks`: CRM editor preview, Hub page, Hub print/PDF)

- `BlockRenderer` iterates `toSections(layout)` but **keeps the single `.rb-grid`** (6 columns)
  that lays out the whole document today. Sections add **no wrapper element**: blocks stay direct
  children of `.rb-grid` (its `> [data-block-id]` selectors, the empty-cell collapse and the
  divider's print page break depend on that), so row packing, page breaks and the PDF are exactly
  what the flat list produces. That is what makes a converted legacy report render identically even
  where a section boundary falls mid-row.
- A **platform section** renders a heading as one full-width grid item (`grid-column: 1 / -1`):
  platform icon + title (`title` or "Instagram" / "TikTok"), styled from the active theme one level
  above `section_header` (it is the chapter; `section_header` blocks inside stay sub-headings).
  `hideHeader` suppresses the item.
- A **Geral** section renders no heading; its `title` is an editor-only label.
- View mode (Hub, PDF), **sections with a visible heading**: when none of the section's platform
  widgets has data (`blockHasData`; neutral blocks such as `section_header`, `text` and `divider`
  do not count), the section is omitted whole: heading, sub-headings and text. Otherwise its
  blocks follow today's per-block rule. Sections with `hideHeader` (every converted legacy section)
  always follow today's per-block rule, so a legacy report with Instagram disconnected keeps its
  sub-headings exactly as now. Edit mode shows everything with placeholders, as today.
- Cover kicker and handle derive from the platform sections present (today: from block types).
- The reports list's platform badge (derived from `layout->blocks`) keeps working: it can read the
  `section` markers or the block types, same result.

## Generation (`report-docs` `/generate`)

Inputs as today (`platforms` optional, validated against connected + `feature_tiktok`).

- **System default** (`buildDefaultLayout`): `[Geral: cover, ai_summary]`, then an Instagram section
  and/or a TikTok section for the selected platforms, platform heading shown, then
  `[Geral "Próximos passos": section_header "Próximos passos", ai_recommendations, ai_goals]` when
  AI is on. The Instagram section keeps today's blocks, its four `section_header`s ("Métricas
  principais", "Crescimento e formatos", "Publicações", "Audiência") becoming sub-headings under the
  "Instagram" heading. The TikTok section drops its leading `section_header "TikTok"`: the heading
  says it, and keeping both would print "TikTok" twice. `platformSectionBlocks` (used for appended
  sections and for Adicionar seção) returns these same blocks.
- **Headings in a multi-platform document:** a generated document with two or more platform sections
  shows every platform heading (clears `hideHeader` on all of them), so a converted legacy template
  that gains an appended TikTok section does not end up with a labeled TikTok part next to an
  unlabeled Instagram part. With one platform section, the template's setting stands. The template
  itself is not changed.
- **Workspace template:** `sectionizeLayout(template)`, then drop the platform sections not selected
  (or without data); then, only if the template has at least one platform section, append the
  default section of each selected platform it lacks, right after its last platform section. A
  section that would exceed MAX_BLOCKS is skipped with the existing `console.warn` (today's cap
  behavior, now per section). A template with no platform section is taken as intentional and gets
  none added (today's rule).
- AI narrative platforms = platform sections in the final layout ∩ selected (today's
  `narrativePlatforms`, read from sections).
- **No AI content** (failure, timeout or AI off): as today, `fillAiBlocks` removes the AI blocks.
  In the system default the whole "Próximos passos" Geral section goes with them (its marker and
  its `section_header`), so no empty section is left; today the header alone is removed. In a
  workspace template the section stays as the user saved it (today's rule for its titles), even if
  the AI blocks were all it held: the user can delete it in the editor.

This replaces `dropUnselectedPlatformBlocks`, `addMissingPlatformSections` and the
`NEXT_STEPS_TITLE` lookup in `platform-filter.ts`. `refresh-data` does not touch the layout and is
unchanged.

## Editor (document `RelatorioEditorPage`, template `ModeloEditorPage`/`ModeloPadraoPage`)

### Canvas

- Each section is a frame. Its header bar: platform icon + editable title for platform sections,
  "Geral" + editable label for Geral sections; a menu with **Mover para cima**, **Mover para
  baixo**, **Ocultar título** / **Mostrar título** (platform only) and **Remover seção** (confirms
  when the section has blocks).
- Blocks inside keep today's grid, sizes, selection and per-block chrome. The per-block platform
  badge from #766 goes away (the section says it).
- Every insertion point inside a section (the `+` between blocks and the section's
  **Adicionar widget** at its end) opens the widget drawer **scoped to that section**: platform
  widgets of its platform plus the neutral ones (text, image, divider, `section_header`, AI blocks).
  Geral sections list only neutral widgets; `cover` only in Geral and only while the layout has no
  cover. The drawer's platform switch from #766 goes away.
- Between sections and after the last one: **Adicionar seção** → Instagram, TikTok, Geral.
  - A platform already present is disabled ("Já existe uma seção do Instagram").
  - TikTok needs `feature_tiktok` (absent from the menu without it, fail-closed while the plan
    loads).
  - In a **document**, a platform section needs that platform's data in the snapshot
    (`documentPlatforms`); otherwise disabled with "Sem dados do TikTok neste relatório. Atualize
    os dados depois de conectar a conta." In a **template**, both are available (sample data).
  - A new platform section starts with that platform's default blocks (the generation default);
    a new Geral section starts empty with its Adicionar widget button.
- Drag and drop: blocks reorder within their section only; sections reorder by dragging the header
  bar (and through the menu).

### Layers panel

A tree: sections (icon + title), their blocks indented. Selecting a section selects its header bar.
Reordering in the panel follows the same constraints as the canvas.

### Phone (`ReportPhoneView`)

Unchanged as a product rule: on the phone a report or template is read-only with export, and
editing stays on the computer (D27, "Edite o layout no computador."). The phone view renders through
`BlockRenderer`, so it shows the platform headings like the Hub does. No section editing on phone.

### Feature flag

A TikTok section that already exists in a template while the workspace has no `feature_tiktok`
renders and can be removed, but no TikTok widget can be added to it. Generation already drops it
(the backend gates TikTok data).

### Applying a template to a document

"Aplicar modelo" (`applyTemplateLayout`) copies the template's sections as they are, including a
platform section the document has no data for (or TikTok without `feature_tiktok`). It is neither
dropped nor blocked: in the editor it shows its placeholders like any widget without data, and the
user can remove it or refresh the data after connecting the account; on the Hub and in the PDF it is
omitted whole by the view-mode rule (§Rendering), so no empty heading reaches the client. *(my call;
same outcome as today's per-block behavior, now at section level.)*

## Touch points (from a full map of the layout's readers and writers)

**Writers.** Only two: the CRM editor's autosave (PostgREST, documents and templates) and
`report-docs` `generate.ts` (service role). No SQL seed, MCP tool or other function writes a layout;
the "Padrão do sistema" layout is code (`buildDefaultLayout`, also called client-side by
`buildSystemDefaultLayout`). "Salvar como modelo" and template apply (`applyTemplateLayout`) copy
whole layouts, sections included.

**Unchanged because the array stays flat** (the reason for the marker encoding; each would break
silently under a nested shape):
- `report_document_files_sync()` walks `layout->'blocks'` for image blocks (file reference counts,
  delete protection, autoclean).
- `hub-report-docs` `signImageBlocks` walks `layout.blocks` to sign image URLs for the Hub and PDF.
- `listReportDocs` selects `layout->blocks` for the reports list's platform badges.
- `useLayoutAutosave`, `useLayoutHistory` (whole-layout snapshots), `resolveReportTheme`,
  `report_documents.updated_at` (PDF cache).

**Changes:**
- `_shared/report-docs/layout.ts`: `section` in `BLOCK_TYPES` and `PLATFORM_NEUTRAL_TYPES`, the
  marker shape, rules, `MAX_SECTIONS`, cap counting; new `sections.ts` beside it.
- `platform-filter.ts`, `generate.ts`, `default-layout.ts`, `tiptap-doc.ts` (`fillAiBlocks` walks
  sections for the AI-removal rule): per §Generation.
- `packages/report-blocks`: `BlockRenderer` (headings, view-mode omission), `platform.ts`
  (`layoutPlatforms` and `coverDefaults` from sections), `catalog.ts` (`section` is not a drawer
  widget; `section_header`'s label becomes "Subtítulo" so the drawer stops offering two kinds of
  "section", *my call*), styles for the heading per theme; bump `PDF_RENDERER_VERSION` in
  `report-docs/pdf.ts` so cached PDFs re-render.
- Editor: `layoutOps.ts` gains section ops (add with default blocks, move, remove, rename, hide
  heading) and a section-aware insert (`insertBlockInSection(layout, sectionId, type, position)`
  replacing the index-based `insertBlockAt` path from `useBlockEditing.insertAt` and the layers
  `+`). `DEFAULT_SIZE` gains the TikTok KPIs as `third` (today a TikTok KPI added by hand comes out
  full width, unlike the default layout). `moveBlock` refuses a target in another section.
  `EditorCanvas` and `LayersPanel` (two independent `@dnd-kit` contexts today, one flat
  `SortableContext` each) get one sortable list of sections plus one per section's blocks.
  `AddWidgetDrawer` takes the target section instead of the platform switch; `PlatformBadge` goes
  away; `SectionHeaderEditor` stays for sub-headings; a section header editor is new;
  `widgetIcons.ts` gets an entry for `section` (the map is exhaustive over `BlockType`).
- The editor canvas does not use `BlockRenderer` (it re-implements the grid), so its section frames
  are its own: in edit mode each section is a framed grid. Edit-mode packing may differ from the
  output only in the legacy mid-row case, which prod data does not reach.
- Template list block counts (`ReportTemplatesCard`, `ReportTemplatesPhone`) count content blocks,
  not markers.
- `refresh-data` still never touches the layout: a platform connected after generation gets data on
  refresh and the user adds its section with Adicionar seção (now possible because the document
  has the data).

**Tests that construct v1 layouts** keep passing as legacy input; the SQL suites
`66_report_docs.sql`, `99_report_image_files.sql` and `63_storage_autoclean.sql` gain sectioned
cases.

## Deploy order

The prod CRM's editor (any bundle older than this merge) runs its own `validateLayout` before every
autosave, and that validator rejects the unknown `section` type: the save stops with the editor's
save-error toast and nothing is written. So **a sectioned document must not reach a prod editor
that predates the merge**, and that decides the order. Unlike #766 so far, the function goes out
after the frontend:

1. Migration `20261103000002` (already on staging and prod).
2. Migration `20261103000003` (new): `validate_report_layout()` accepts `section` blocks and enforces
   the rules and caps above. Legacy layouts pass exactly as before, so it is safe ahead of
   everything.
3. Merge. The new frontend reads legacy and sectioned layouts and writes sectioned ones; the DB
   accepts them (step 2).
4. As soon as the Vercel production deploy of the merge is live: deploy `report-docs` (accepts and
   writes sectioned layouts) and `instagram-report-generator-v2` (bundles `_shared/report-template`).
   Until then the old `report-docs` keeps generating legacy layouts, which the new frontend upgrades
   on its first save. The one thing that fails in that window is generating from a template someone
   already re-saved with sections (`invalid_template` from the old validator): minutes, and only
   for templates edited during them.

What remains is a CRM tab opened before the merge and kept open: it can still show a sectioned
document (generated after step 4) and its autosave fails with the save-error toast until the tab
reloads (silent updates reload it on the next navigation). Accepted.

The same tab (CRM or Hub) also mislabels slightly: before this change `blockPlatform` classifies
any type it does not know, `section` included, as Instagram, so an old bundle viewing a TikTok-only
sectioned report shows an Instagram kicker and handle on the cover until it reloads. The numbers it
shows are still right (TikTok widgets are their own types). Accepted for the same window.

## Testing

- Deno: `toSections` on the legacy default layout, on a hand-built legacy layout with text between
  Instagram segments, on a mixed segment, on every repair case; round trip
  `fromSections(toSections(x))` stable for canonical layouts; `validateLayout` rules 1-5 and legacy
  acceptance; generation from the system default and from templates (with and without platform
  sections, platform deselected, platform missing, MAX_BLOCKS per section).
- SQL (entitlement suite style, CI-gated): the trigger accepts legacy layouts and canonical ones,
  rejects each rule violation and bad marker shape, and enforces both caps (200 content blocks plus
  12 sections). The same fixture list feeds a Deno test of `validateLayout` (parity).
- Vitest: renderer output for a legacy layout is identical before and after, including a legacy
  layout whose section boundary falls mid-row (the one-grid rule); platform heading shown/hidden;
  empty-section omission in view mode; editor section menu, add-section rules (flag, existing
  platform, document without data), drawer scoped by section, drag constrained to a section, layers
  tree; phone view shows headings and stays read-only.
- Browser: generate IG-only, TikTok-only and both on staging; open an existing prod-shaped legacy
  document; check Hub page and PDF.

## Left to the builder

- The visual weight of the platform heading per theme (it must read as a chapter above
  `section_header`, match each theme, and print well).
- How the section frame looks in the editor canvas (follow the mockups).
- Drag library details for section reordering.
- Copy beyond what this spec fixes, in the editor's existing pt-BR tone.
