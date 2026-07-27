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

- **Parsing happens client-side.** Uploaded files never travel to the edge: the browser runs the deterministic parsers and ships only the resulting normalized **`ImportBundle`** (metadata rows + provenance — small, since media never moves) to the edge function. This sidesteps both the edge payload limit (5 × 20 MB would exceed it) and the ~2s-CPU isolate kill profile that unzipping + parsing + an AI call in one request would hit. Parsers live in a shared workspace package, **`packages/import-parsers/`** (`trello-json.ts`, `notion-csv.ts`, `clickup-csv.ts`, `generic-csv.ts`), so future Deno-side OAuth importers can reuse them as `ImportBundle` producers.
- **Frontend:** new lazy-loaded wizard page in `apps/crm/src/pages/`, TanStack Query mutations against the edge function.
- **Edge function `data-import`** with three actions, JWT-auth'd and workspace-scoped (`conta_id` verified):
  - `analyze` — receives the `ImportBundle`, returns the mapping proposal
  - `preview` — dry-run against the workspace (client fuzzy-matching, dedupe, counts, plan-cap warnings)
  - `commit` — batched inserts, **client-driven batches** (~200 rows per request) so no single invocation risks the CPU kill; idempotent per source row (mechanism below), so a killed batch can't double-insert on resume
- **AI mapping is an enhancement, not a dependency.** A deterministic heuristic pass (exact/fuzzy header matching: "Data", "Status", "Cliente", "Legenda"…) always runs and fully populates the Mapeamento form; when `GEMINI_API_KEY` is set (it's optional everywhere else in the repo), the AI refines the proposal — classifying ambiguous collections, proposing status equivalences (e.g. Trello list "Aprovado" → post status). A missing key or Gemini outage degrades to heuristics + manual dropdowns, never a dead wizard. **Data minimization:** the AI request carries column headers plus at most a handful of sample values per column — never the full roster (client names/contacts are third-party PII).
- **Rich text:** post bodies are TipTap documents, and a node type outside the shared CRM/Hub schema silently blanks the whole post in the Hub. Conversion from source content (Trello Markdown, Notion text, plain CSV cells) goes through an explicit `toTipTapDoc()` step in `packages/import-parsers/` that emits only schema-shared node types (paragraph, text, bold/italic, bullet list, link), falling back to plain paragraphs; `conteudo_plain` is derived from it.
- **Job bookkeeping, idempotency, and undo:** `import_jobs` records each job; `import_job_items` records **every** created row (including `workflow_etapas`) as `(job_id, table_name, row_id text, source_row_key, ordinal)` — `row_id` is text because created ids are mixed types (`clientes`/`workflows`/`workflow_posts` are bigint, `ideias` are uuid). One source row can create multiple rows (an Entregas card → 1 workflow + N etapas), and container workflows/templates belong to no source row, so:
  - Uniqueness is on `(job_id, source_row_key, table_name, ordinal)`; containers and templates get synthetic source keys (`container:{cliente_id}:{n}`, `template:{board}`).
  - The **resume idempotency check is against the primary row only** (roster row → `clientes`; post row → `workflow_posts`; Entregas card → `workflows`): if the primary item exists, the whole source row is skipped. Each source row's inserts + items are written atomically (one RPC), so a partially created source row can never be recorded as done.
  - "Desfazer" deletes exactly the recorded rows, in reverse dependency order (`workflow_posts`/`workflow_etapas` → `workflows` → `workflow_templates` → `clientes`/`ideias`) — no reliance on FK cascade.
  - Undo restores **creations only** — and to keep that honest, "mesclar com existente" is **fill-only-empty-fields**: merge never overwrites populated fields on an existing Cliente, so there is nothing destructive that undo would need to revert (the preview states that merges are not undone).
  - `commit` and undo both call `insertAuditLog()` from `_shared/audit.ts`, alongside the job bookkeeping.
- **Media:** none moved. Source attachment URLs stored in the provenance blob on each imported row.

## Entity mapping

- **Clientes:** roster collections map columns → `Cliente` fields (nome, email, telefone, especialidade). Required fields the source won't have get synthesized defaults: `sigla` from initials, `cor` from the palette, `status: 'ativo'`, `plano: ''`, `valor_mensal: 0` (a monthly-value column, when detected, maps to `valor_mensal`). `Cliente` has no Instagram-handle or free-notes field, and briefings are structured hub Q&A (auto-seeded from the workspace's template on `addCliente`) — so unmapped columns are **not** forced anywhere; they stay in the provenance blob. Exception: a Notion import maps the source page URL to the existing `Cliente.notion_page_url` field. Fuzzy name match against existing clientes; per-row "mesclar com existente" vs "criar novo".
- **Posts:** posts cannot attach directly to a Cliente — `workflow_posts.workflow_id` is the only FK, and the calendar (`ScheduledPost`) is a read model over posts inside **ativo** workflows. The import therefore creates one container Workflow per client per job ("Calendário importado — {origem}", status `ativo`, no template) and inserts posts into it — chunking into additional numbered container workflows when a client's row count would exceed the plan's `max_posts_per_workflow` cap: title/caption, `scheduled_at`, `tipo` (mapped from a source column when one exists, default `'feed'`), and status mapped via a user-confirmed two-column table. **Status clamp:** imported posts may never land as `agendado` (the instagram-publish-cron machinery operates on that status and imported posts have no media/container) nor `falha_publicacao`; `postado` is allowed only for past-dated rows and sets `published_at` with no Instagram ids. Everything else clamps to the `rascunho`…`aprovado_cliente` range. Dateless rows import as unscheduled `rascunho`. Checklists and descriptions land in the post body.
- **Entregas:** a deliverables board maps as: source columns → etapas of a **new WorkflowTemplate** ("Importado do Trello — {board}"). Sources carry no scheduling config, so defaults are synthesized at both levels: per-etapa `prazo_dias: 1`, `tipo_prazo: 'uteis'`, `tipo: 'padrao'`; template-level `modo_prazo: 'padrao'`. Each card → one Workflow instance with due date preserved, positioned at the etapa matching its current column: prior etapas `concluido`, current etapa `ativo`, `etapa_atual` set accordingly.
- **Ideias:** idea-bank collections (or user-retagged ones) → `Ideia` per client. No-date, no-status content databases default here rather than to posts.
- **Cross-cutting:** if a collection has a client-ish column/label, rows split per client; otherwise the whole collection gets one client assignment in the Mapeamento step.

## Plan gating

- The wizard is gated by the existing **`feature_csv_import`** flag (it already gates the CSV imports on `LeadsPage`/`ClientesPage` — same concept, richer tool). Whether migration should instead be free on all plans as an acquisition feature is a **pricing decision left open**; the flag choice makes either answer a plan-table edit, not a code change.
- Resource caps (`max_clients`, `max_workflow_templates`, `max_posts_per_workflow`) are checked at **preview** time against source counts, surfacing warnings up front ("45 clientes excede o limite de 3 do seu plano") instead of letting commit fail mid-way.

## Limits & error handling

- Caps: 20 MB/file, 5 files/job, 2.000 rows/job — enforced in the browser at parse time (files never reach the edge).
- Zip safety (client-side): decompression size cap on Notion zips (zip-bomb guard); the Trello parser drops the `actions[]` array, which dominates board-export size, before building the bundle.
- Commit runs in client-driven batches with progress and is resumable per job via the primary-row idempotency check (see Job bookkeeping) — a killed batch cannot half-import silently or double-insert on resume.
- Partial failures never abort: failed rows go to a downloadable report; the rest lands.
- Malformed/unrecognized files fail at the parse step with a friendly message + export-guide link, before anything is uploaded.
- Undo window: 7 days per job. Undo skips (and reports) a created post that has actually been published to a platform since import — defined as `instagram_media_id` or `tiktok_post_id` being non-null. Rows imported as historical `postado` have no platform ids and remain undoable.

## Testing

- Real fixture exports (Trello JSON, Notion CSV zip — including the nested per-database CSV structure, ClickUp CSV) as fixtures in `packages/import-parsers/`; Vitest tests assert each parser's normalized `ImportBundle` output exactly (parsers are browser-side, so they're tested in the Vitest suite, not Deno).
- `toTipTapDoc()`: tests assert output contains only schema-shared node types for every fixture.
- AI mapping: golden tests with the LLM mocked, plus a schema-contract test on the required JSON output; heuristic-only path tested with no key set.
- Commit/undo (Deno edge tests): idempotent resume-after-kill (re-send a partially committed batch → no duplicates), undo-with-published-post (platform-id rows skipped and reported), `max_posts_per_workflow` chunking (rows split across numbered container workflows at the cap boundary), `conta_id` typed `uuid` (known mocked-RPC trap).
- Wizard: RTL tests for step transitions, mapping edits, preview → commit.

## Out of scope (v1)

- Media file transfer (download/re-upload to R2).
- OAuth/native API importers (future producer of `ImportBundle`).
- Asana, Monday, Airtable parsers (generic CSV covers them partially; add parsers on demand).
- Importing finance data, contracts, or team members.
