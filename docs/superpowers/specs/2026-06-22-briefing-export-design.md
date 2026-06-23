# Briefing Export — Design Spec

**Date:** 2026-06-22
**Status:** Approved, pending implementation
**Branch:** `feat/briefing-export`

## Goal

Give users a way to export a client's briefing out of the CRM. This is the first
slice of a broader "better data export" effort. We add an **Exportar** dropdown
to the briefing toolbar, modelled on Supabase's table "Export" menu.

Scope is deliberately narrow: the **currently selected briefing only** (one
briefing document, its sections and questions/answers), in **CSV and Markdown**.

## Context

The briefing UI lives in `apps/crm/src/pages/cliente-detalhe/HubTab.tsx` inside
the `BriefingEditor` component (not `ClienteDetalhePage.tsx` directly, which only
renders `HubTab`). Key facts established during research:

- A client can have multiple briefings, shown as tabs. The toolbar
  (`HubTab.tsx` ~850–893) acts on the **selected** briefing — same as the
  existing "Importar CSV" button, which is disabled when there is no selection.
- Data model (`apps/crm/src/store/hub.ts`):
  - `BriefingRow`: `{ id, cliente_id, conta_id, title, display_order, created_at }`
  - `HubBriefingQuestionRow`:
    `{ id, cliente_id, conta_id, briefing_id, question, answer, section, display_order, created_at }`
  - Questions are grouped into ordered sections in the component
    (`HubTab.tsx` ~685–694): `q.section ?? ''`; the empty-string group is the
    "unsectioned" bucket, the rest are named sections.
- The existing CSV importer (`apps/crm/src/lib/csv.ts`, `parseCSV`) expects
  columns **`pergunta` (required), `secao`, `resposta`**. It is line-based:
  it splits on `\n`, so it cannot read fields that contain embedded newlines,
  and it strips surrounding quotes but does **not** un-double `""`.
- Toasts use `sonner` (`import { toast } from 'sonner'`). Clipboard uses
  `navigator.clipboard.writeText()` directly (see the "Link copiado!" handler at
  `HubTab.tsx:104`). There is no existing file-download or export helper.
- The "Direcionamento criativo" / "Banco de referências" sub-tabs seen in some
  mockups do **not** exist on this branch; there is nothing extra to export.

## Components

### 1. Pure formatter module — `apps/crm/src/lib/briefingExport.ts`

No React, no DOM. Pure functions so they are trivially unit-testable.

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

// CSV with columns: pergunta,secao,resposta — round-trips through parseCSV.
function briefingToCSV(questions: ExportQuestion[]): string;

// Full-fidelity Markdown (preserves line breaks in answers).
function briefingToMarkdown(title: string, sections: ExportSection[]): string;

// kebab-cased, accent-stripped slug for filenames.
function slugifyTitle(title: string): string;
```

**CSV format (`briefingToCSV`)**

- Header row: `pergunta,secao,resposta`.
- One row per question, in the questions' given order.
- Columns: `pergunta` = `question`, `secao` = `section ?? ''`, `resposta` =
  `answer ?? ''`.
- Field encoding (`csvField` helper):
  - Replace any `\r\n` / `\r` / `\n` inside a value with a single space. The
    importer is line-based and cannot read multi-line fields; flattening keeps
    re-import reliable and the output genuinely tabular.
  - After flattening, if the value contains `,` or `"`, wrap it in double quotes
    and double any internal `"` (`"` → `""`). RFC-4180-correct for Excel/Sheets.
- Line terminator: `\n` between rows (the importer filters blank lines and splits
  on `\n`). No trailing newline needed, but a single trailing `\n` is acceptable.

**Markdown format (`briefingToMarkdown`)**

```
# Briefing — {title}

**Pergunta sem seção?**
Resposta.

## DADOS
**Pergunta com resposta?**
Resposta aqui.

**Pergunta sem resposta?**
_(sem resposta)_
```

- `# Briefing — {title}` H1 (if `title` is blank, just `# Briefing`).
- Unsectioned questions (the `''` bucket) render first, directly under the H1,
  with no `##` heading.
- Each named section becomes a `## {name}` heading.
- Each question: the question text in bold on its own line, then the answer on
  the next line. Blank/`null` answers render as `_(sem resposta)_`.
- One blank line between questions and around headings.

**`slugifyTitle`** — lowercase, strip diacritics (`normalize('NFD')` + remove
combining marks), replace non-alphanumerics with `-`, collapse repeats, trim
leading/trailing `-`. Empty result falls back to `briefing`.

### 2. UI — Exportar dropdown in `BriefingEditor` (`HubTab.tsx`)

Placed in the toolbar (the `flex items-center gap-2` row at ~856), after the
"Importar CSV" button + its help tooltip. Same primitives as the existing
"Usar template" dropdown:

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
- `Copy` and `Download` come from `lucide-react` (`Download` is already used for
  this feature; verify/add imports).
- The handlers build `ExportQuestion[]` from `briefingQuestions` and the section
  list (`unsectioned` + `namedSections`, already computed in the component).

### 3. Side effects (in the component, not the pure module)

- **Clipboard:** `await navigator.clipboard.writeText(text)` then
  `toast.success('Briefing copiado como Markdown!' | '... como CSV!')`. On failure
  `toast.error('Não foi possível copiar.')`.
- **Download:** a small local helper
  `downloadTextFile(filename: string, mime: string, text: string)` that creates a
  `Blob`, `URL.createObjectURL`, a temporary `<a download>`, clicks it, then
  revokes the URL and removes the node. Filename:
  `briefing-${slugifyTitle(selectedBriefing.title)}.csv`, mime `text/csv`.
  Then `toast.success('CSV exportado!')`.

## Data flow

1. User clicks **Exportar** → picks an item.
2. Handler reads the already-in-state `briefingQuestions` (and derived
   `unsectioned` / `namedSections`) for `selectedBriefing`.
3. Maps them to `ExportQuestion[]` / `ExportSection[]` and calls the matching
   pure formatter.
4. Result goes to the clipboard or to `downloadTextFile`, then a toast confirms.

No network calls, no new store functions — all data is already loaded.

## Error handling

- Button disabled when there's nothing to export (no selection / zero questions),
  so handlers can assume a non-empty briefing.
- Clipboard write wrapped in try/catch → `toast.error` on rejection (e.g.
  permissions / insecure context).
- Download uses Blob + object URL; revoke in a `finally`.

## Testing

Vitest unit tests for the pure module (`apps/crm/src/lib/__tests__/
briefingExport.test.ts`):

- `briefingToCSV`:
  - header + one row per question, correct column order;
  - `null` answer → empty `resposta`;
  - comma in a value → field quoted;
  - quote in a value → quoted + `""` doubled;
  - newline in an answer → flattened to a space;
  - **round-trip:** `parseCSV(briefingToCSV(qs))` recovers
    `pergunta`/`secao`/`resposta` for newline-free inputs.
- `briefingToMarkdown`:
  - H1 with and without title;
  - unsectioned questions appear before any `##` heading;
  - named section emits `## {name}`;
  - blank answer → `_(sem resposta)_`.
- `slugifyTitle`: accents stripped, spaces → `-`, empty → `briefing`.

No component/RTL test for the dropdown in this slice (the logic worth testing is
in the pure module); revisit if the handlers grow.

## Out of scope (YAGNI)

- JSON export.
- Keyboard shortcuts (Supabase's ⇧⌘M / ⇧⌘J / ⇧⌘C / ⇧⌘D) — conflict risk, low
  value here.
- Exporting all of a client's briefings in one file.
- A shared/generic export utility for other pages — extract later if a second
  caller appears; this slice keeps `downloadTextFile` local.

## Known trade-off

The importer (`parseCSV`) does not un-double `""`, so an answer containing a
literal `"` re-imports with a slightly mangled quote. Rare and cosmetic; the
exported CSV itself is standards-correct for spreadsheets, which is the primary
consumer. Documented rather than worked around with importer-specific invalid CSV.
