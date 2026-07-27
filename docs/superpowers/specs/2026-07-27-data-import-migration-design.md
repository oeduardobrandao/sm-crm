# Data Import / Migration from Competitor Tools — Design

**Date:** 2026-07-27
**Status:** Approved (brainstorm complete, pending implementation plan)

## Problem

The biggest objection from prospects is migration lift: their client roster, content calendar, and delivery boards live in Notion, Trello, ClickUp, or spreadsheets, and re-entering everything by hand is a dealbreaker. We want a product feature (not just guides or concierge service) that removes this objection.

## Decision

Build a **universal export-file import wizard with AI-assisted mapping** (chosen over per-platform OAuth importers and over a guides-only approach). One pipeline covers Notion, Trello, ClickUp, and generic spreadsheets:

1. User exports from their current tool using its free, no-API export path (Trello board JSON; Notion CSV/zip; ClickUp CSV; any CSV).
2. Deterministic parsers normalize the file into a common intermediate model.
3. An AI step proposes the mapping (what each collection is, which columns mean what, which client each row belongs to). The AI pre-fills a form; the user confirms/edits everything. The AI never writes data directly.
4. Dry-run preview, then commit — with one-click undo.

**Scope of v1 data:** Clientes, Posts (content calendar), Entregas (workflows), Ideias. **Metadata only** — no media files are downloaded or re-uploaded; source attachment URLs are preserved in provenance.

**Why not OAuth importers (Approach A):** 3 integrations to build and maintain, and the hard problem (heterogeneous schemas) doesn't go away. The normalized intermediate model makes OAuth fetchers a pure add-on later — they'd just be another producer of the same `ImportBundle`.

## User experience

Entry points: **Configurações → Importar dados**, and a prompt during new-workspace onboarding ("Migrando do Notion, Trello ou ClickUp?").

Wizard steps:

1. **Origem** — pick Notion / Trello / ClickUp / Planilha / Outro. Each shows an illustrated "how to export" mini-guide.
2. **Upload** — drop file(s). Multiple files per job (several boards, a Notion zip).
3. **Mapeamento** — AI proposal screen. Each detected collection gets: a destination (Clientes / Posts / Entregas / Ideias / Ignorar), a client assignment (matched existing Cliente or "criar novo"), and column/status mappings. All editable dropdowns; AI pre-fills.
4. **Prévia** — dry-run: exact counts per destination, sample rows, warnings (e.g. "8 posts sem data → entrarão como rascunho").
5. **Importar** — commit with progress, final report, and a **Desfazer importação** action.

## Architecture

- **Frontend:** new lazy-loaded wizard page in `apps/crm/src/pages/`, TanStack Query mutations against the edge function.
- **Edge function `data-import`** with three actions, JWT-auth'd and workspace-scoped (`conta_id` verified):
  - `analyze` — parse file(s) + AI mapping proposal
  - `preview` — dry-run against the workspace (client fuzzy-matching, dedupe, counts, warnings)
  - `commit` — batched inserts, idempotent per job
- **Parsers** in `supabase/functions/_shared/import/`: `trello-json.ts`, `notion-csv.ts`, `clickup-csv.ts`, `generic-csv.ts`. All deterministic; all emit a normalized **`ImportBundle`** (collections of rows with typed candidate fields + provenance). This is the extension seam for future OAuth importers.
- **AI mapping** only where determinism runs out: classifying collections, identifying date/caption/status columns, proposing status equivalences (e.g. Trello list "Aprovado" → post status). Uses existing `GEMINI_API_KEY` plumbing. Output is a JSON mapping proposal consumed by the wizard form.
- **Undo/audit:** `import_jobs` table records each job; `import_job_items` records every created row id. "Desfazer" deletes exactly the recorded ids.
- **Media:** none moved. Source attachment URLs stored in the provenance blob on each imported row.

## Entity mapping

- **Clientes:** roster collections map columns → `Cliente` fields (nome, contato, Instagram handle, notas → briefing). Fuzzy name match against existing clientes; per-row "mesclar com existente" vs "criar novo".
- **Posts:** card/row → post attached to a Cliente: title/caption, publish date, status mapped from source (Trello list / Notion select / ClickUp status) onto Mesaas post statuses via a user-confirmed two-column table. Dateless rows import as unscheduled drafts. Checklists and descriptions land in the post body/notes.
- **Entregas:** a deliverables board maps as: source columns → etapas of a **new WorkflowTemplate** ("Importado do Trello — {board}"); each card → one Workflow instance positioned at the etapa matching its current column, due date preserved.
- **Ideias:** idea-bank collections (or user-retagged ones) → `Ideia` per client. No-date, no-status content databases default here rather than to posts.
- **Cross-cutting:** if a collection has a client-ish column/label, rows split per client; otherwise the whole collection gets one client assignment in the Mapeamento step.

## Limits & error handling

- Caps: 20 MB/file, 5 files/job, 2.000 rows/job.
- Commit runs in batches with progress and is resumable per job — edge-function CPU/timeout kills cannot half-import silently.
- Partial failures never abort: failed rows go to a downloadable report; the rest lands.
- Malformed/unrecognized files fail at `analyze` with a friendly message + export-guide link, before any AI call.
- Undo window: 7 days per job. Undo is blocked for a created post that has since been published.

## Testing

- Real fixture exports (Trello JSON, Notion CSV zip, ClickUp CSV) in `supabase/functions/__tests__/fixtures/import/`; Deno tests assert each parser's normalized output exactly.
- AI mapping: golden tests with the LLM mocked, plus a schema-contract test on the required JSON output.
- Commit/undo tested at the RPC layer with `conta_id` typed `uuid` (known mocked-RPC trap).
- Wizard: RTL tests for step transitions, mapping edits, preview → commit.

## Out of scope (v1)

- Media file transfer (download/re-upload to R2).
- OAuth/native API importers (future producer of `ImportBundle`).
- Asana, Monday, Airtable parsers (generic CSV covers them partially; add parsers on demand).
- Importing finance data, contracts, or team members.
