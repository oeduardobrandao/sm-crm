# Briefing Export — Design Spec

**Date:** 2026-06-22
**Status:** Approved, pending implementation
**Branch:** `feat/briefing-export`

## Goal

Give users a way to export a client's briefing out of the CRM. This is the first
slice of a broader "better data export" effort. We add an **Exportar** dropdown
to the briefing toolbar, modelled on Supabase's table "Export" menu.

Scope is deliberately narrow — the **currently selected briefing only** (one
briefing document, its sections and questions/answers) — with three actions:

- **Copiar como Markdown** → Markdown text to the clipboard.
- **Copiar como CSV** → CSV text to the clipboard.
- **Baixar CSV** → CSV downloaded as a `.csv` file.

Markdown delivery is clipboard-only by deliberate choice (the common use is
pasting into a doc/Notion/chat); there is no "Baixar Markdown" in this slice.

## Context

The briefing UI lives in `apps/crm/src/pages/cliente-detalhe/HubTab.tsx` inside
the `BriefingEditor` component (not `ClienteDetalhePage.tsx` directly, which only
renders `HubTab`). Key facts established during research:

- A client can have multiple briefings, shown as tabs. The toolbar
  (`HubTab.tsx` ~850–893) acts on the **selected** briefing — same as the
  existing "Importar CSV" button, which is disabled when there is no selection.
- The selected briefing's questions are derived in-component at `HubTab.tsx:585`:
  `briefingQuestions = questions.filter(q => (q.briefing_id ?? firstId) === selectedId)`.
  Exporting the selected briefing therefore means exporting `briefingQuestions`,
  never the full `questions` list — the one regression worth a test.
- Data model (`apps/crm/src/store/hub.ts`):
  - `BriefingRow`: `{ id, cliente_id, conta_id, title, display_order, created_at }`
  - `HubBriefingQuestionRow`:
    `{ id, cliente_id, conta_id, briefing_id, question, answer, section, display_order, created_at }`
- **Briefing content is plain text, not Markdown.** Answers are authored in a
  plain `<textarea>` (`apps/hub/src/pages/BriefingPage.tsx:170`) and rendered as
  plain text; `ReactMarkdown` is used only by the Brand editor
  (`HubTab.tsx:501`), never for briefings. So question/answer/section/title text
  may contain `#`, `*`, `_`, backticks, `[]`, `<>` as literal characters and must
  be **escaped** when emitted into Markdown.
- **Section grouping differs across the app:**
  - CRM editor groups by `q.section ?? ''` and renders the unsectioned (`''`)
    bucket **first**, then named sections in first-seen order
    (`HubTab.tsx:687` + `:987`).
  - Public hub groups by `q.section ?? 'Geral'` in first-seen order, with no
    forced unsectioned-first (`BriefingPage.tsx:34`).
  This export uses **CRM visual order** (see below), since it lives in and
  reflects the CRM.
- The existing CSV importer (`apps/crm/src/lib/csv.ts`, `parseCSV`) expects
  columns **`pergunta` (required), `secao`, `resposta`**. It is line-based: it
  splits on `\n` (cannot read embedded-newline fields), and it strips surrounding
  quotes but does **not** un-double `""`. Its header parse is
  `h.trim().toLowerCase()`; `trim()` removes a leading U+FEFF BOM (verified), so a
  BOM-prefixed download still re-imports.
- Toasts use `sonner` (`import { toast } from 'sonner'`). Clipboard uses
  `navigator.clipboard.writeText()` directly (see "Link copiado!" at
  `HubTab.tsx:104`). There is no existing file-download or export helper.
- The "Direcionamento criativo" / "Banco de referências" sub-tabs seen in some
  mockups do **not** exist on this branch; there is nothing extra to export.

## Components

### 1. Pure formatter module — `apps/crm/src/lib/briefingExport.ts`

No React, no DOM. Pure functions, trivially unit-testable.

```ts
interface ExportQuestion {
  question: string;
  answer: string | null;
  section: string | null;
}

interface ExportSection {
  name: string;            // '' for the unsectioned bucket
  questions: ExportQuestion[];
}

// Selection + grouping + ordering, all in one pure step.
// Filters `allQuestions` to the selected briefing, then groups into sections in
// CRM visual order: the unsectioned ('') bucket first, then named sections in
// first-seen order; questions keep their input order within each section.
function buildBriefingExportSections(
  allQuestions: HubBriefingQuestionRow[],
  selectedId: string,
  firstId: string,
): ExportSection[];

// CSV with columns: pergunta,secao,resposta — emitted in the section order above.
function briefingToCSV(sections: ExportSection[]): string;

// Escaped-plain-text Markdown (preserves answer line breaks; escapes metachars).
function briefingToMarkdown(title: string, sections: ExportSection[]): string;

// Backslash-escapes Markdown metacharacters in plain-text user content.
function escapeMarkdown(text: string): string;

// kebab-cased, accent-stripped slug for filenames.
function slugifyTitle(title: string): string;
```

`buildBriefingExportSections` makes the product guarantee — *export the selected
briefing only* — a pure property, testable without RTL. It duplicates the simple
`(q.briefing_id ?? firstId) === selectedId` predicate already at `HubTab.tsx:585`;
that duplication is intentional to keep the helper pure (the component keeps its
own `briefingQuestions` for rendering).

**`buildBriefingExportSections` ordering (CRM visual order)**

- Filter to the selected briefing.
- Group by `q.section ?? ''`.
- Emit the `''` (unsectioned) bucket first if present, then named sections in
  first-seen order. Questions keep their input order within a section.
- This single ordering feeds **both** CSV and Markdown, so the two formats agree.

**CSV format (`briefingToCSV`)**

- Header row: `pergunta,secao,resposta`.
- One row per question, walking `sections` in order.
- Columns: `pergunta` = `question`, `secao` = `name` (`''` for unsectioned, which
  the importer reads back as `null`), `resposta` = `answer ?? ''`.
- Field encoding (`csvField` helper):
  - Replace any `\r\n` / `\r` / `\n` inside a value with a single space. The
    importer is line-based and cannot read multi-line fields; flattening keeps
    re-import reliable and the output genuinely tabular.
  - After flattening, if the value contains `,` or `"`, wrap it in double quotes
    and double any internal `"` (`"` → `""`). This is RFC-4180-correct for
    Excel/Sheets, the primary consumer.
- Row terminator: `\n`. No BOM here — the BOM is added only on the download path
  (see Side effects), never in clipboard or in this pure string.

**Round-trip contract (narrowed).** For values containing **no `"` and no
newline**, `parseCSV(briefingToCSV(sections))` recovers `pergunta`/`secao`/
`resposta` exactly. Two documented, intentional deviations outside that set:
newlines are flattened to spaces; and because `parseCSV` does not un-double `""`,
a value with a literal `"` re-imports with the quote doubled. The exported CSV is
still standards-correct for spreadsheets. Tests assert the narrowed contract, not
exact round-trip of quotes/newlines.

**Markdown format (`briefingToMarkdown`)**

```
# Briefing — {escaped title}

**{escaped question without section}**
{escaped answer}

## {escaped section name}
**{escaped question}**
{escaped answer}

**{escaped question with blank answer}**
_(sem resposta)_
```

- `# Briefing — {escapeMarkdown(title)}` H1; if `title` is blank, just
  `# Briefing`.
- Section order follows `buildBriefingExportSections`: the `''` bucket's
  questions render first, directly under the H1, with **no** `##` heading; each
  named section emits `## {escapeMarkdown(name)}`.
- Each question: `**{escapeMarkdown(question)}**` on its own line, then the
  answer on the next line. Blank/`null` answers render as `_(sem resposta)_`.
- One blank line between questions and around headings.

**`escapeMarkdown(text)`** — treats input as literal plain text:
- Backslash-escape inline metacharacters anywhere: `\` `` ` `` `*` `_` `[` `]`
  `<` (these begin emphasis, code spans, links, or raw HTML).
- For each line, escape a leading block marker (after optional leading spaces):
  `#`, `>`, `|`, `+`, `-`, `=`, or an ordered-list `\d+` followed by `.` or `)`.
- Leaves ordinary prose punctuation (`.`, `,`, `(`, `)`, `!`, `?`) untouched so
  pasted text reads naturally.

**`slugifyTitle`** — lowercase, strip diacritics (`normalize('NFD')` + remove
combining marks), replace non-alphanumerics with `-`, collapse repeats, trim
leading/trailing `-`. Empty result falls back to `briefing`.

### 2. UI — Exportar dropdown in `BriefingEditor` (`HubTab.tsx`)

Placed in the toolbar (`flex items-center gap-2` row at ~856), after the
"Importar CSV" button + its help tooltip. Same primitives as the existing "Usar
template" dropdown:

```tsx
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button size="sm" variant="outline" disabled={!canExport}>
      <Download size={14} className="mr-1.5" /> Exportar
      <ChevronDown size={14} className="ml-1.5" />
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="end">
    <DropdownMenuItem onClick={handleCopyMarkdown}>
      <Copy size={14} className="mr-2" /> Copiar como Markdown
    </DropdownMenuItem>
    <DropdownMenuItem onClick={handleCopyCSV}>
      <Copy size={14} className="mr-2" /> Copiar como CSV
    </DropdownMenuItem>
    <DropdownMenuItem onClick={handleDownloadCSV}>
      <Download size={14} className="mr-2" /> Baixar CSV
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

- `canExport = !!selectedBriefing && briefingQuestions.length > 0`.
- `Copy` and `Download` from `lucide-react` (verify/add imports).
- Each handler computes `sections = buildBriefingExportSections(questions,
  selectedId, firstId)` and calls the matching formatter.

### 3. Side effects (in the component, not the pure module)

- **Clipboard:** `await navigator.clipboard.writeText(text)` then
  `toast.success('Briefing copiado como Markdown!' | '... como CSV!')`. On failure
  `toast.error('Não foi possível copiar.')`.
- **Download:** a small local helper
  `downloadTextFile(filename, mime, text)` that creates a `Blob`,
  `URL.createObjectURL`, a temporary `<a download>`, clicks it, then revokes the
  URL (in `finally`) and removes the node. For CSV:
  - mime `text/csv;charset=utf-8`;
  - prepend a UTF-8 BOM (`﻿`) so Excel renders Portuguese accents correctly
    (safe for re-import — `parseCSV`'s `trim()` drops it);
  - filename `briefing-${slugifyTitle(selectedBriefing.title)}.csv`;
  - then `toast.success('CSV exportado!')`.

## Data flow

1. User clicks **Exportar** → picks an item.
2. Handler calls `buildBriefingExportSections(questions, selectedId, firstId)`
   (pure: selection + grouping + ordering).
3. Calls `briefingToCSV(sections)` or `briefingToMarkdown(title, sections)`.
4. Result goes to the clipboard, or to `downloadTextFile` (BOM + utf-8), then a
   toast confirms.

No network calls and no new store functions — all data is already loaded.

## Error handling

- Button disabled when there's nothing to export (no selection / zero questions),
  so handlers can assume a non-empty briefing.
- Clipboard write wrapped in try/catch → `toast.error` on rejection (e.g.
  permissions / insecure context).
- Download revokes the object URL in a `finally`.

## Testing

Vitest unit tests for the pure module
(`apps/crm/src/lib/__tests__/briefingExport.test.ts`):

- `buildBriefingExportSections` (covers the product guarantee + ordering):
  - given questions from **two** briefings, returns only the selected briefing's
    questions (selection guarantee — the `questions`-vs-`briefingQuestions`
    regression);
  - unsectioned (`''`) bucket comes first;
  - named sections in first-seen order; question order preserved within a section.
- `briefingToCSV`:
  - header + one row per question, correct column order;
  - `null` answer → empty `resposta`; unsectioned → empty `secao`;
  - comma in a value → field quoted; quote → quoted + `""` doubled;
  - newline in an answer → flattened to a space;
  - **narrowed round-trip:** for quote-free, newline-free values,
    `parseCSV(briefingToCSV(sections))` recovers `pergunta`/`secao`/`resposta`.
- `briefingToMarkdown`:
  - H1 with and without title;
  - unsectioned questions appear before any `##` heading;
  - named section emits `## {name}`;
  - blank answer → `_(sem resposta)_`;
  - answer/question containing `#`, `*`, backtick is escaped (structure intact).
- `escapeMarkdown`: inline metachars escaped; leading block markers (`#`, `-`,
  `>`, `1.`) escaped; ordinary prose punctuation untouched.
- `slugifyTitle`: accents stripped, spaces → `-`, empty → `briefing`.

Because selection, grouping, and ordering all live in
`buildBriefingExportSections`, no RTL/component test is needed (there is no
existing HubTab test harness; standing one up would be disproportionate). If the
handlers later grow logic beyond calling the helper, revisit.

## Out of scope (YAGNI)

- JSON export.
- "Baixar Markdown" (Markdown is clipboard-only by choice).
- Keyboard shortcuts (Supabase's ⇧⌘M / ⇧⌘J / ⇧⌘C / ⇧⌘D) — conflict risk, low
  value here.
- Exporting all of a client's briefings in one file.
- A shared/generic export utility for other pages — extract later if a second
  caller appears; this slice keeps `downloadTextFile` local.
