# Data Import Wizard (Notion / Trello / ClickUp / CSV) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An in-app wizard that imports a workspace's clients, content calendar, delivery boards, and idea backlog from Notion/Trello/ClickUp export files (or any CSV), with AI-assisted mapping, dry-run preview, idempotent commit, and one-click undo.

**Architecture:** Deterministic parsers + heuristic mapper run **in the browser** inside a new workspace package `packages/import-parsers/` (files never reach the edge; only the compact normalized `ImportBundle` does). A new edge function `data-import` exposes `start` / `analyze` (optional Gemini refinement) / `preview` / `commit` / `undo` actions; commit inserts each source row atomically via a `import_commit_row` SQL RPC recorded in `import_jobs` / `import_job_items`.

**Tech Stack:** React 19 + shadcn/ui (CRM app), Vitest + RTL, Deno edge functions + `createSupabaseQueryMock` tests, Postgres RPC (SECURITY DEFINER), `fflate` for Notion zips.

**Spec:** `docs/superpowers/specs/2026-07-27-data-import-migration-design.md`. One plan-level clarification of the spec: the heuristic mapping pass runs **client-side** in the package (so a missing Gemini key means the `analyze` call is simply skipped); the edge `analyze` action is only the AI refinement. This strengthens the spec's "AI is an enhancement, not a dependency" requirement.

## Global Constraints

- UI copy is **Portuguese (pt-BR)**, plain strings (no new i18n namespaces).
- **Metadata only** — no media files are downloaded or uploaded; source attachment URLs go in the `provenance` blob.
- Post status clamp: imported posts may **never** get status `agendado` or `falha_publicacao`; `postado` only for past-dated rows (sets `published_at`, no Instagram/TikTok ids); everything else clamps to `rascunho` / `revisao_interna` / `aprovado_interno` / `enviado_cliente` / `aprovado_cliente` / `correcao_cliente`.
- Caps enforced in the browser at parse time: **20 MB/file, 5 files/job, 2.000 rows/job**. Commit batches are **200 rows/request**.
- New npm deps must be **pinned to an exact, aged version** (Deno CI 24h min-dep-age policy): `fflate@0.8.2` only.
- Edge function auth: service-role client + `auth.getUser(token)`; workspace scoping via `profiles.conta_id`; gate on `feature_csv_import`; never return raw error details.
- Migration filename must use a **unique timestamp version prefix** (no other file may share the digits before the first `_`).
- After `npm run test:functions`, run `git checkout -- deno.lock` (the root lockfile always gets dirtied).
- Before pushing: `npm run format`, `npm run lint`, `npm run test`, `npm run test:functions`, `npm run build`.
- Deploy (not part of this plan's tasks, for reference): `npx supabase functions deploy data-import --use-api --no-verify-jwt` is NOT needed — this function verifies JWT itself via header, deploy plainly with `--use-api`.

---

## Shared contracts (referenced by every task)

`packages/import-parsers/src/types.ts` (defined in Task 1):

```ts
export type SourceKind = 'trello' | 'notion' | 'clickup' | 'csv';

export interface ImportRow {
  key: string; // stable source key: trello card id, "<file>:<rowIndex>", clickup task id
  cells: Record<string, string>; // header -> raw string value
  listName?: string; // kanban column / status origin (Trello list, ClickUp status)
  dueDate?: string | null; // ISO string when the source has a first-class date
  description?: string; // long-form body (markdown or plain text)
  checklist?: string[]; // flattened checklist item texts
  sourceUrl?: string; // deep link back to the source item, when the source has one
}

export interface ImportCollection {
  id: string; // board id or filename
  name: string; // board/database/file display name
  source: SourceKind;
  columns: string[]; // ordered union of row cell keys
  listNames: string[]; // distinct listName values in row order
  rows: ImportRow[];
}

export interface ImportBundle {
  source: SourceKind;
  collections: ImportCollection[];
  warnings: string[];
}

export type Destination = 'clientes' | 'posts' | 'entregas' | 'ideias' | 'ignorar';

export const POST_STATUS_TARGETS = [
  'rascunho', 'revisao_interna', 'aprovado_interno', 'enviado_cliente',
  'aprovado_cliente', 'correcao_cliente', 'postado',
] as const;
export type PostStatusTarget = (typeof POST_STATUS_TARGETS)[number];

export interface ColumnRoles {
  title?: string;
  date?: string;
  status?: string;
  client?: string;
  caption?: string;
  email?: string;
  phone?: string;
  monthlyValue?: string;
  specialty?: string;
  tipo?: string;
  url?: string; // -> Cliente.notion_page_url when destination === 'clientes'
}

export interface CollectionMapping {
  collectionId: string;
  destination: Destination;
  columnRoles: ColumnRoles;
  statusMap: Record<string, PostStatusTarget>; // source status/list -> post status
  clientAssignment: { mode: 'column'; column: string } | { mode: 'fixed'; clienteNome: string };
}

export interface MappingProposal {
  collections: CollectionMapping[];
}
```

`supabase/functions/data-import/types.ts` wire contract (defined in Task 8) — this is the **API contract**, deliberately independent of the package (edge code must not import from `packages/`, deploy bundling only follows paths under `supabase/functions/`):

```ts
export type ClienteRef = { type: 'existing'; clienteId: number } | { type: 'created'; sourceKey: string };

export interface CommitClienteRow {
  kind: 'cliente'; sourceKey: string; nome: string;
  email?: string; telefone?: string; especialidade?: string;
  valorMensal?: number; notionPageUrl?: string;
  merge?: { clienteId: number }; // fill-only-empty-fields merge target
}
export interface CommitContainerRow {
  kind: 'container'; sourceKey: string; // "container:<clienteKey>:<n>"
  clienteRef: ClienteRef; titulo: string;
}
export interface CommitTemplateRow {
  kind: 'template'; sourceKey: string; // "template:<boardId>"
  nome: string; etapas: string[]; // etapa names, in board column order
}
export interface CommitPostRow {
  kind: 'post'; sourceKey: string; containerKey: string; // sourceKey of a CommitContainerRow
  titulo: string; conteudo: Record<string, unknown> | null; conteudoPlain: string;
  tipo: 'feed' | 'reels' | 'stories' | 'carrossel';
  status: string; scheduledAt: string | null; publishedAt: string | null;
  provenance: Record<string, unknown>;
}
export interface CommitEntregaRow {
  kind: 'entrega'; sourceKey: string; templateKey: string; // sourceKey of a CommitTemplateRow
  clienteRef: ClienteRef; titulo: string;
  etapaIndex: number; // 0-based index of current etapa
  dueDate: string | null; provenance: Record<string, unknown>;
}
export interface CommitIdeiaRow {
  kind: 'ideia'; sourceKey: string; clienteRef: ClienteRef;
  titulo: string; descricao: string; provenance: Record<string, unknown>;
}
export type CommitRow =
  | CommitClienteRow | CommitContainerRow | CommitTemplateRow
  | CommitPostRow | CommitEntregaRow | CommitIdeiaRow;
```

Edge endpoints (all POST, JSON body, `Authorization: Bearer <jwt>`):

- `/data-import/start` `{ source, totalRows }` → `{ jobId }`
- `/data-import/analyze` `{ summary }` → `{ proposal | null }` (null when no `GEMINI_API_KEY`)
- `/data-import/preview` `{ rows: CommitRow[] }` → `{ counts, warnings: string[], limits: { maxClients, maxWorkflowTemplates, maxPostsPerWorkflow } }`
- `/data-import/commit` `{ jobId, rows: CommitRow[], final?: boolean }` (one batch ≤200; `final: true` on the last slice marks the job `completed`) → `{ results: { sourceKey, table, rowId, skipped, failed? }[] }`
- `/data-import/undo` `{ jobId }` → `{ deleted: number, skippedPublished: string[] }`

Commit ordering contract (client-side driver, Task 11): batches are sent in kind order `cliente` → `template` → `container` → `entrega`/`post`/`ideia`, because later kinds resolve `ClienteRef { type:'created' }` / `containerKey` / `templateKey` through `import_job_items` lookups inside the RPC.

---

### Task 1: `packages/import-parsers` scaffold, types, CSV core

**Files:**
- Create: `packages/import-parsers/package.json`
- Create: `packages/import-parsers/index.ts`
- Create: `packages/import-parsers/src/types.ts`
- Create: `packages/import-parsers/src/csv.ts`
- Create: `packages/import-parsers/__tests__/csv.test.ts`
- Modify: `vitest.config.ts` (add packages test glob + alias)
- Modify: `apps/crm/vite.config.ts:12-16` (add alias)
- Modify: `apps/crm/tsconfig.json:4-8` (add path mapping)

**Interfaces:**
- Produces: everything in `src/types.ts` (see Shared contracts above, verbatim) and `parseCsv(text: string): string[][]`.

- [ ] **Step 1: Write the failing test**

`packages/import-parsers/__tests__/csv.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { parseCsv } from '../src/csv';

describe('parseCsv', () => {
  test('parses simple rows', () => {
    expect(parseCsv('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  test('handles quoted fields with commas, escaped quotes, newlines', () => {
    expect(parseCsv('name,desc\n"Silva, Ana","diz ""oi""\nsegunda linha"')).toEqual([
      ['name', 'desc'],
      ['Silva, Ana', 'diz "oi"\nsegunda linha'],
    ]);
  });

  test('strips BOM and CRLF, drops fully empty lines', () => {
    expect(parseCsv('﻿a,b\r\n1,2\r\n,\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});
```

- [ ] **Step 2: Create the package and config wiring, run test to verify it fails**

`packages/import-parsers/package.json`:

```json
{
  "name": "@mesaas/import-parsers",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "dependencies": {
    "fflate": "0.8.2"
  }
}
```

`packages/import-parsers/index.ts` (grows over Tasks 2-7; start with):

```ts
export * from './src/types';
export { parseCsv } from './src/csv';
```

`packages/import-parsers/src/types.ts`: exactly the "Shared contracts" block above (the `packages/import-parsers/src/types.ts` portion).

In `vitest.config.ts`, extend `resolve.alias` with `'@mesaas/import-parsers': path.resolve(__dirname, 'packages/import-parsers/index.ts'),` and add to `test.include`: `'packages/**/__tests__/**/*.test.{ts,tsx}',` (the current globs only cover `apps/**` — without this the package tests silently never run).

In `apps/crm/vite.config.ts`, next to the `@mesaas/i18n` alias, add: `'@mesaas/import-parsers': path.resolve(__dirname, '../../packages/import-parsers/index.ts'),`

In `apps/crm/tsconfig.json` `paths`, add: `"@mesaas/import-parsers": ["../../packages/import-parsers/index.ts"],`

Run: `npm install` (links the workspace + installs fflate), then `npx vitest run packages/import-parsers`
Expected: FAIL — `Cannot find module '../src/csv'`

- [ ] **Step 3: Write minimal implementation**

`packages/import-parsers/src/csv.ts`:

```ts
/** Minimal RFC4180 parser (quoted fields, escaped quotes, CRLF); no deps. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/import-parsers`
Expected: 3 passed

- [ ] **Step 5: Commit**

```bash
git add packages/import-parsers vitest.config.ts apps/crm/vite.config.ts apps/crm/tsconfig.json package.json package-lock.json
git commit -m "feat(import): scaffold @mesaas/import-parsers with ImportBundle types and CSV core"
```

---

### Task 2: Generic CSV → ImportBundle adapter

**Files:**
- Create: `packages/import-parsers/src/generic-csv.ts`
- Create: `packages/import-parsers/__tests__/generic-csv.test.ts`
- Modify: `packages/import-parsers/index.ts`

**Interfaces:**
- Consumes: `parseCsv`, `ImportCollection` (Task 1).
- Produces: `parseGenericCsv(fileName: string, text: string): ImportCollection`.

- [ ] **Step 1: Write the failing test**

`packages/import-parsers/__tests__/generic-csv.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { parseGenericCsv } from '../src/generic-csv';

describe('parseGenericCsv', () => {
  test('first row is the header; rows keyed by file:index', () => {
    const col = parseGenericCsv('clientes.csv', 'Nome,Email\nAna,ana@x.com\nBia,bia@x.com');
    expect(col).toMatchObject({
      id: 'clientes.csv',
      name: 'clientes',
      source: 'csv',
      columns: ['Nome', 'Email'],
      listNames: [],
    });
    expect(col.rows).toEqual([
      { key: 'clientes.csv:1', cells: { Nome: 'Ana', Email: 'ana@x.com' } },
      { key: 'clientes.csv:2', cells: { Nome: 'Bia', Email: 'bia@x.com' } },
    ]);
  });

  test('ragged rows pad missing cells with empty string', () => {
    const col = parseGenericCsv('x.csv', 'A,B\n1');
    expect(col.rows[0].cells).toEqual({ A: '1', B: '' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/import-parsers/__tests__/generic-csv.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

`packages/import-parsers/src/generic-csv.ts`:

```ts
import { parseCsv } from './csv';
import type { ImportCollection } from './types';

export function parseGenericCsv(fileName: string, text: string): ImportCollection {
  const grid = parseCsv(text);
  const columns = grid[0] ?? [];
  const rows = grid.slice(1).map((r, i) => ({
    key: `${fileName}:${i + 1}`,
    cells: Object.fromEntries(columns.map((c, j) => [c, r[j] ?? ''])),
  }));
  return {
    id: fileName,
    name: fileName.replace(/\.csv$/i, ''),
    source: 'csv',
    columns,
    listNames: [],
    rows,
  };
}
```

Append to `packages/import-parsers/index.ts`: `export { parseGenericCsv } from './src/generic-csv';`

- [ ] **Step 4: Run tests, verify pass** — `npx vitest run packages/import-parsers` → all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/import-parsers
git commit -m "feat(import): generic CSV to ImportCollection adapter"
```

---

### Task 3: Trello JSON parser

**Files:**
- Create: `packages/import-parsers/src/trello-json.ts`
- Create: `packages/import-parsers/__tests__/fixtures/trello-board.json`
- Create: `packages/import-parsers/__tests__/trello-json.test.ts`
- Modify: `packages/import-parsers/index.ts`

**Interfaces:**
- Produces: `parseTrelloJson(fileName: string, text: string): ImportCollection` (source `'trello'`; `listNames` = open list names in board order; card rows carry `listName`, `dueDate`, `description`, `checklist`, `sourceUrl`).

- [ ] **Step 1: Create the fixture**

`packages/import-parsers/__tests__/fixtures/trello-board.json` — a realistic reduced board export (Trello's real export shape; `actions` present so the test proves it is ignored):

```json
{
  "name": "Calendário Dra. Marina",
  "lists": [
    { "id": "l1", "name": "Rascunho", "closed": false, "pos": 1 },
    { "id": "l2", "name": "Aprovado", "closed": false, "pos": 2 },
    { "id": "l3", "name": "Antiga", "closed": true, "pos": 3 }
  ],
  "cards": [
    {
      "id": "c1", "name": "Post mitos da amamentação", "desc": "Legenda: **mitos** comuns",
      "due": "2026-08-03T12:00:00.000Z", "idList": "l1", "closed": false,
      "shortUrl": "https://trello.com/c/abc123", "labels": [{ "name": "Dra. Marina" }]
    },
    {
      "id": "c2", "name": "Reels bastidores", "desc": "",
      "due": null, "idList": "l2", "closed": false,
      "shortUrl": "https://trello.com/c/def456", "labels": []
    },
    {
      "id": "c3", "name": "Card arquivado", "desc": "", "due": null,
      "idList": "l1", "closed": true, "shortUrl": "https://trello.com/c/ghi789", "labels": []
    }
  ],
  "checklists": [
    { "id": "ck1", "idCard": "c1", "name": "Tarefas", "checkItems": [{ "name": "Arte final", "state": "incomplete" }] }
  ],
  "actions": [{ "id": "a1", "type": "commentCard", "data": { "text": "should never appear in output" } }]
}
```

- [ ] **Step 2: Write the failing test**

`packages/import-parsers/__tests__/trello-json.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { parseTrelloJson } from '../src/trello-json';

const raw = readFileSync(join(__dirname, 'fixtures', 'trello-board.json'), 'utf8');

describe('parseTrelloJson', () => {
  const col = parseTrelloJson('board.json', raw);

  test('board metadata and open lists only', () => {
    expect(col.name).toBe('Calendário Dra. Marina');
    expect(col.source).toBe('trello');
    expect(col.listNames).toEqual(['Rascunho', 'Aprovado']);
    expect(col.columns).toEqual(['Nome', 'Etiquetas']);
  });

  test('open cards become rows with list, due, desc, checklist, url', () => {
    expect(col.rows).toHaveLength(2); // closed card dropped
    expect(col.rows[0]).toEqual({
      key: 'c1',
      cells: { Nome: 'Post mitos da amamentação', Etiquetas: 'Dra. Marina' },
      listName: 'Rascunho',
      dueDate: '2026-08-03T12:00:00.000Z',
      description: 'Legenda: **mitos** comuns',
      checklist: ['Arte final'],
      sourceUrl: 'https://trello.com/c/abc123',
    });
  });

  test('actions[] content never leaks into the bundle', () => {
    expect(JSON.stringify(col)).not.toContain('should never appear');
  });
});
```

- [ ] **Step 3: Run test, verify FAIL** — `npx vitest run packages/import-parsers/__tests__/trello-json.test.ts` → module not found.

- [ ] **Step 4: Write minimal implementation**

`packages/import-parsers/src/trello-json.ts`:

```ts
import type { ImportCollection, ImportRow } from './types';

interface TrelloList { id: string; name: string; closed: boolean; pos: number }
interface TrelloCard {
  id: string; name: string; desc: string; due: string | null;
  idList: string; closed: boolean; shortUrl?: string; labels?: { name: string }[];
}
interface TrelloChecklist { idCard: string; checkItems: { name: string }[] }

export function parseTrelloJson(fileName: string, text: string): ImportCollection {
  const board = JSON.parse(text) as {
    name?: string; lists?: TrelloList[]; cards?: TrelloCard[]; checklists?: TrelloChecklist[];
  };
  // actions[] (dominates export size) is simply never read.
  const openLists = (board.lists ?? [])
    .filter((l) => !l.closed)
    .sort((a, b) => a.pos - b.pos);
  const listById = new Map(openLists.map((l) => [l.id, l.name]));
  const checklistByCard = new Map<string, string[]>();
  for (const ck of board.checklists ?? []) {
    const items = ck.checkItems.map((i) => i.name);
    checklistByCard.set(ck.idCard, [...(checklistByCard.get(ck.idCard) ?? []), ...items]);
  }
  const rows: ImportRow[] = (board.cards ?? [])
    .filter((c) => !c.closed && listById.has(c.idList))
    .map((c) => ({
      key: c.id,
      cells: {
        Nome: c.name,
        Etiquetas: (c.labels ?? []).map((l) => l.name).filter(Boolean).join(', '),
      },
      listName: listById.get(c.idList)!,
      dueDate: c.due ?? null,
      description: c.desc ?? '',
      checklist: checklistByCard.get(c.id) ?? [],
      sourceUrl: c.shortUrl ?? '',
    }));
  return {
    id: fileName,
    name: board.name ?? fileName,
    source: 'trello',
    columns: ['Nome', 'Etiquetas'],
    listNames: openLists.map((l) => l.name),
    rows,
  };
}
```

Append to `index.ts`: `export { parseTrelloJson } from './src/trello-json';`

- [ ] **Step 5: Run tests, verify pass, commit**

```bash
npx vitest run packages/import-parsers
git add packages/import-parsers
git commit -m "feat(import): Trello board JSON parser (drops actions, closed lists/cards)"
```

---

### Task 4: Notion zip/CSV parser

**Files:**
- Create: `packages/import-parsers/src/notion-csv.ts`
- Create: `packages/import-parsers/__tests__/notion-csv.test.ts`
- Modify: `packages/import-parsers/index.ts`

**Interfaces:**
- Consumes: `parseGenericCsv` (Task 2), `unzipSync` from `fflate`.
- Produces: `parseNotionExport(fileName: string, data: Uint8Array): { collections: ImportCollection[]; warnings: string[] }` — accepts a `.zip` (Uint8Array) or a single `.csv` (Uint8Array of its text). Notion name hashes (` 0123abc…` 32-hex suffix) are stripped from collection names; `_all.csv` duplicates are preferred over the filtered view CSV; `.md` files ignored; decompressed size capped at 100 MB (zip-bomb guard).

- [ ] **Step 1: Write the failing test** (the fixture zip is built in-test with `zipSync` — no binary fixture files in git)

`packages/import-parsers/__tests__/notion-csv.test.ts`:

```ts
import { strToU8, zipSync } from 'fflate';
import { describe, expect, test } from 'vitest';
import { parseNotionExport } from '../src/notion-csv';

function makeZip(entries: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, strToU8(v)])));
}

describe('parseNotionExport', () => {
  test('extracts each csv as a collection, strips the notion hash, prefers _all.csv', () => {
    const zip = makeZip({
      'Export/Calendário 0a1b2c3d4e5f60718293a4b5c6d7e8f9.csv': 'Name,Data\nPost A,2026-08-01',
      'Export/Calendário 0a1b2c3d4e5f60718293a4b5c6d7e8f9_all.csv':
        'Name,Data\nPost A,2026-08-01\nPost B,2026-08-02',
      'Export/Página solta 99998888777766665555444433332222.md': '# ignora',
    });
    const { collections, warnings } = parseNotionExport('export.zip', zip);
    expect(warnings).toEqual([]);
    expect(collections).toHaveLength(1);
    expect(collections[0].name).toBe('Calendário');
    expect(collections[0].source).toBe('notion');
    expect(collections[0].rows).toHaveLength(2);
  });

  test('accepts a bare csv file', () => {
    const { collections } = parseNotionExport(
      'Clientes 0a1b2c3d4e5f60718293a4b5c6d7e8f9.csv',
      strToU8('Nome,Email\nAna,a@x.com'),
    );
    expect(collections[0].name).toBe('Clientes');
    expect(collections[0].rows).toHaveLength(1);
  });

  test('rejects zip expanding beyond the cap', () => {
    const big = 'A,B\n' + '1,2\n'.repeat(400);
    const zip = makeZip({ 'x.csv': big });
    const { warnings } = parseNotionExport('export.zip', zip, /* maxBytes */ 100);
    expect(warnings.some((w) => w.includes('grande'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, verify FAIL** — module not found.

- [ ] **Step 3: Write minimal implementation**

`packages/import-parsers/src/notion-csv.ts`:

```ts
import { strFromU8, unzipSync } from 'fflate';
import { parseGenericCsv } from './generic-csv';
import type { ImportCollection } from './types';

const NOTION_HASH = / [0-9a-f]{32}(?=(_all)?\.\w+$|$)/i;
const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;

function displayName(path: string): string {
  const base = path.split('/').pop() ?? path;
  return base.replace(/(_all)?\.csv$/i, '').replace(NOTION_HASH, '').trim();
}

export function parseNotionExport(
  fileName: string,
  data: Uint8Array,
  maxBytes = DEFAULT_MAX_BYTES,
): { collections: ImportCollection[]; warnings: string[] } {
  const warnings: string[] = [];
  const csvs = new Map<string, { path: string; text: string; isAll: boolean }>();

  const addCsv = (path: string, bytes: Uint8Array) => {
    const name = displayName(path);
    const isAll = /_all\.csv$/i.test(path);
    const existing = csvs.get(name);
    if (!existing || (isAll && !existing.isAll)) {
      csvs.set(name, { path, text: strFromU8(bytes), isAll });
    }
  };

  if (/\.zip$/i.test(fileName)) {
    let total = 0;
    try {
      const entries = unzipSync(data, {
        filter: (f) => {
          total += f.originalSize ?? 0;
          return /\.csv$/i.test(f.name) && total <= maxBytes;
        },
      });
      if (total > maxBytes) {
        warnings.push('Arquivo zip muito grande após descompactação — parte do conteúdo foi ignorada.');
      }
      for (const [path, bytes] of Object.entries(entries)) addCsv(path, bytes);
    } catch {
      warnings.push('Não foi possível ler o arquivo zip.');
    }
  } else {
    addCsv(fileName, data);
  }

  const collections = [...csvs.entries()].map(([name, { path, text }]) => ({
    ...parseGenericCsv(path, text),
    id: path,
    name,
    source: 'notion' as const,
  }));
  if (!collections.length && !warnings.length) {
    warnings.push('Nenhum arquivo CSV encontrado no export do Notion.');
  }
  return { collections, warnings };
}
```

Append to `index.ts`: `export { parseNotionExport } from './src/notion-csv';`

- [ ] **Step 4: Run tests, verify pass** — `npx vitest run packages/import-parsers`.

- [ ] **Step 5: Commit**

```bash
git add packages/import-parsers
git commit -m "feat(import): Notion export parser (zip of CSVs, hash stripping, zip-bomb cap)"
```

---

### Task 5: ClickUp CSV parser

**Files:**
- Create: `packages/import-parsers/src/clickup-csv.ts`
- Create: `packages/import-parsers/__tests__/clickup-csv.test.ts`
- Modify: `packages/import-parsers/index.ts`

**Interfaces:**
- Consumes: `parseCsv` (Task 1).
- Produces: `parseClickupCsv(fileName: string, text: string): ImportCollection` — ClickUp task exports have headers like `Task ID, Task Name, Status, Due Date, List Name, Task Content, Assignee`. `Status` → `listName`; `Due Date` (epoch-ms or ISO) → `dueDate`; `Task Content` → `description`; `Task ID` → `key`. Remaining columns stay as cells.

- [ ] **Step 1: Write the failing test**

`packages/import-parsers/__tests__/clickup-csv.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { parseClickupCsv } from '../src/clickup-csv';

const CSV = [
  'Task ID,Task Name,Status,Due Date,List Name,Task Content,Assignee',
  '86abc1,Post lançamento,em revisão,1754179200000,Calendário,Texto do post,Ana',
  '86abc2,Reels dicas,aprovado,,Calendário,,Bia',
].join('\n');

describe('parseClickupCsv', () => {
  const col = parseClickupCsv('tasks.csv', CSV);

  test('maps clickup columns onto row fields', () => {
    expect(col.source).toBe('clickup');
    expect(col.listNames).toEqual(['em revisão', 'aprovado']);
    expect(col.rows[0]).toMatchObject({
      key: '86abc1',
      listName: 'em revisão',
      dueDate: new Date(1754179200000).toISOString(),
      description: 'Texto do post',
    });
    expect(col.rows[0].cells).toMatchObject({ 'Task Name': 'Post lançamento', Assignee: 'Ana' });
    expect(col.rows[1].dueDate).toBeNull();
  });
});
```

- [ ] **Step 2: Run test, verify FAIL.**

- [ ] **Step 3: Write minimal implementation**

`packages/import-parsers/src/clickup-csv.ts`:

```ts
import { parseCsv } from './csv';
import type { ImportCollection, ImportRow } from './types';

function toIso(v: string): string | null {
  if (!v.trim()) return null;
  const n = Number(v);
  const d = Number.isFinite(n) && v.trim().length >= 12 ? new Date(n) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function parseClickupCsv(fileName: string, text: string): ImportCollection {
  const grid = parseCsv(text);
  const headers = grid[0] ?? [];
  const idx = (h: string) => headers.findIndex((x) => x.toLowerCase() === h.toLowerCase());
  const iId = idx('Task ID');
  const iStatus = idx('Status');
  const iDue = idx('Due Date');
  const iContent = idx('Task Content');
  const special = new Set([iId, iStatus, iDue, iContent].filter((i) => i >= 0));
  const cellHeaders = headers.filter((_, i) => !special.has(i));

  const listNames: string[] = [];
  const rows: ImportRow[] = grid.slice(1).map((r, n) => {
    const status = iStatus >= 0 ? (r[iStatus] ?? '') : '';
    if (status && !listNames.includes(status)) listNames.push(status);
    return {
      key: iId >= 0 && r[iId] ? r[iId] : `${fileName}:${n + 1}`,
      cells: Object.fromEntries(
        headers.map((h, i) => [h, r[i] ?? '']).filter(([h]) => cellHeaders.includes(h as string)),
      ),
      listName: status || undefined,
      dueDate: iDue >= 0 ? toIso(r[iDue] ?? '') : null,
      description: iContent >= 0 ? (r[iContent] ?? '') : '',
    };
  });

  return {
    id: fileName,
    name: fileName.replace(/\.csv$/i, ''),
    source: 'clickup',
    columns: cellHeaders,
    listNames,
    rows,
  };
}
```

Append to `index.ts`: `export { parseClickupCsv } from './src/clickup-csv';`

- [ ] **Step 4: Run tests, verify pass.**

- [ ] **Step 5: Commit**

```bash
git add packages/import-parsers
git commit -m "feat(import): ClickUp CSV parser (status->list, epoch due dates)"
```

---

### Task 6: `toTipTapDoc` rich-text conversion

**Files:**
- Create: `packages/import-parsers/src/tiptap.ts`
- Create: `packages/import-parsers/__tests__/tiptap.test.ts`
- Modify: `packages/import-parsers/index.ts`

**Interfaces:**
- Produces: `toTipTapDoc(text: string): { doc: Record<string, unknown> | null; plain: string }`. Emits ONLY schema-shared node/mark types: `doc`, `paragraph`, `text`, `bulletList`, `listItem`, marks `bold`, `italic`, `link`. Anything unrecognized falls back to plain text inside a paragraph. Empty input → `{ doc: null, plain: '' }`. (An out-of-schema node silently blanks the post body in the Hub — this whitelist is the guard.)

- [ ] **Step 1: Write the failing test**

`packages/import-parsers/__tests__/tiptap.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { toTipTapDoc } from '../src/tiptap';

const ALLOWED_NODES = new Set(['doc', 'paragraph', 'text', 'bulletList', 'listItem']);
const ALLOWED_MARKS = new Set(['bold', 'italic', 'link']);

function collectTypes(node: any, nodes: Set<string>, marks: Set<string>) {
  nodes.add(node.type);
  for (const m of node.marks ?? []) marks.add(m.type);
  for (const c of node.content ?? []) collectTypes(c, nodes, marks);
}

describe('toTipTapDoc', () => {
  test('markdown-ish input: paragraphs, bullets, bold/italic/link', () => {
    const { doc, plain } = toTipTapDoc(
      'Primeira linha com **negrito** e *itálico*.\n\n- item um\n- [site](https://x.com)\n\nFim.',
    );
    const nodes = new Set<string>();
    const marks = new Set<string>();
    collectTypes(doc, nodes, marks);
    expect([...nodes].every((n) => ALLOWED_NODES.has(n))).toBe(true);
    expect([...marks].every((m) => ALLOWED_MARKS.has(m))).toBe(true);
    expect(marks.has('bold')).toBe(true);
    expect(marks.has('link')).toBe(true);
    expect(plain).toContain('negrito');
    expect(plain).toContain('item um');
  });

  test('empty input produces null doc', () => {
    expect(toTipTapDoc('   ')).toEqual({ doc: null, plain: '' });
  });

  test('plain text round-trips as single paragraph', () => {
    const { doc } = toTipTapDoc('só texto');
    expect(doc).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'só texto' }] }],
    });
  });
});
```

- [ ] **Step 2: Run test, verify FAIL.**

- [ ] **Step 3: Write minimal implementation**

`packages/import-parsers/src/tiptap.ts`:

```ts
type Node = { type: string; content?: Node[]; text?: string; marks?: { type: string; attrs?: Record<string, unknown> }[]; attrs?: Record<string, unknown> };

/** Inline markdown -> text nodes with bold/italic/link marks. Unmatched syntax stays literal text. */
function inline(text: string): Node[] {
  const out: Node[] = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*|\[(.+?)\]\((https?:\/\/[^\s)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index) });
    if (m[1]) out.push({ type: 'text', text: m[1], marks: [{ type: 'bold' }] });
    else if (m[2]) out.push({ type: 'text', text: m[2], marks: [{ type: 'italic' }] });
    else out.push({ type: 'text', text: m[3], marks: [{ type: 'link', attrs: { href: m[4] } }] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out.filter((n) => n.text !== '');
}

export function toTipTapDoc(text: string): { doc: Record<string, unknown> | null; plain: string } {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return { doc: null, plain: '' };

  const content: Node[] = [];
  let bullets: Node[] = [];
  const flushBullets = () => {
    if (bullets.length) {
      content.push({ type: 'bulletList', content: bullets });
      bullets = [];
    }
  };
  for (const line of trimmed.split('\n')) {
    const l = line.trim();
    if (!l) {
      flushBullets();
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(l);
    if (bullet) {
      bullets.push({
        type: 'listItem',
        content: [{ type: 'paragraph', content: inline(bullet[1]) }],
      });
    } else {
      flushBullets();
      content.push({ type: 'paragraph', content: inline(l) });
    }
  }
  flushBullets();

  const plainOf = (n: Node): string =>
    n.text ?? (n.content ?? []).map(plainOf).join(n.type === 'bulletList' ? '\n' : n.type === 'doc' ? '\n' : '');
  const doc: Node = { type: 'doc', content };
  return { doc: doc as Record<string, unknown>, plain: content.map(plainOf).join('\n') };
}
```

Append to `index.ts`: `export { toTipTapDoc } from './src/tiptap';`

- [ ] **Step 4: Run tests, verify pass.**

- [ ] **Step 5: Commit**

```bash
git add packages/import-parsers
git commit -m "feat(import): toTipTapDoc conversion emitting only schema-shared nodes"
```

---

### Task 7: Heuristic mapper

**Files:**
- Create: `packages/import-parsers/src/mapper.ts`
- Create: `packages/import-parsers/__tests__/mapper.test.ts`
- Modify: `packages/import-parsers/index.ts`

**Interfaces:**
- Consumes: `ImportBundle`, `CollectionMapping`, `MappingProposal`, `POST_STATUS_TARGETS` (Task 1).
- Produces: `proposeMapping(bundle: ImportBundle): MappingProposal` and `mapStatus(source: string): PostStatusTarget` (exported for reuse in tests and the wizard).

Classification rules (deterministic, in priority order):
1. name matches `/client|roster/i` OR columns include both an email-ish and a phone-ish header → `clientes`
2. name matches `/ideia|idea|backlog|banco/i` → `ideias`
3. rows have `listName`s AND <30% of rows have a date → `entregas`
4. any date-ish column or ≥30% of rows have `dueDate` → `posts`
5. otherwise → `ideias`

Column roles by header regex (first match wins): title `/^(nome|name|task ?name|título|titulo)$/i`; date `/data|date|publica|agendad/i`; status `/status|fase|etapa/i`; client `/cliente|client|marca|conta|etiquetas/i`; caption `/legenda|caption|texto|conte[uú]do/i`; email `/e-?mail/i`; phone `/telefone|phone|celular|whats/i`; monthlyValue `/valor|mensalidade|fee/i`; specialty `/especialidade|specialty/i`; tipo `/tipo|formato|format/i`; url `/^(url|link)$/i`.

`mapStatus`: `aprovad` → `aprovado_cliente`; `revis|review` → `revisao_interna`; `enviado|client` → `enviado_cliente`; `corre` → `correcao_cliente`; `postado|publicado|published|done|conclu` → `postado`; `agendad|sched` → `aprovado_cliente` (clamp — never `agendado`); everything else → `rascunho`.

`clientAssignment`: `{ mode: 'column', column }` when a client-role column exists, else `{ mode: 'fixed', clienteNome: '' }`.

- [ ] **Step 1: Write the failing test**

`packages/import-parsers/__tests__/mapper.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { mapStatus, proposeMapping } from '../src/mapper';
import type { ImportBundle, ImportCollection } from '../src/types';

const col = (over: Partial<ImportCollection>): ImportCollection => ({
  id: 'x', name: 'x', source: 'csv', columns: [], listNames: [], rows: [], ...over,
});
const bundle = (...collections: ImportCollection[]): ImportBundle => ({
  source: 'csv', collections, warnings: [],
});

describe('proposeMapping', () => {
  test('email+phone columns classify as clientes with roles', () => {
    const p = proposeMapping(bundle(col({
      id: 'c', name: 'Contatos', columns: ['Nome', 'Email', 'Telefone', 'Valor'],
      rows: [{ key: 'c:1', cells: { Nome: 'Ana', Email: 'a@x.com', Telefone: '11 9', Valor: '1500' } }],
    })));
    expect(p.collections[0]).toMatchObject({
      destination: 'clientes',
      columnRoles: { title: 'Nome', email: 'Email', phone: 'Telefone', monthlyValue: 'Valor' },
    });
  });

  test('dated rows classify as posts; lists with few dates as entregas', () => {
    const dated = col({
      id: 'p', name: 'Calendário', columns: ['Nome'], listNames: ['Rascunho', 'Aprovado'],
      rows: [
        { key: 'p:1', cells: { Nome: 'A' }, listName: 'Rascunho', dueDate: '2026-08-01T00:00:00Z' },
        { key: 'p:2', cells: { Nome: 'B' }, listName: 'Aprovado', dueDate: '2026-08-02T00:00:00Z' },
      ],
    });
    const board = col({
      id: 'e', name: 'Entregas', columns: ['Nome'], listNames: ['A fazer', 'Feito'],
      rows: [
        { key: 'e:1', cells: { Nome: 'T1' }, listName: 'A fazer', dueDate: null },
        { key: 'e:2', cells: { Nome: 'T2' }, listName: 'Feito', dueDate: null },
        { key: 'e:3', cells: { Nome: 'T3' }, listName: 'Feito', dueDate: null },
        { key: 'e:4', cells: { Nome: 'T4' }, listName: 'A fazer', dueDate: null },
      ],
    });
    const p = proposeMapping(bundle(dated, board));
    expect(p.collections[0].destination).toBe('posts');
    expect(p.collections[0].statusMap).toEqual({ Rascunho: 'rascunho', Aprovado: 'aprovado_cliente' });
    expect(p.collections[1].destination).toBe('entregas');
  });

  test('idea-ish names classify as ideias', () => {
    const p = proposeMapping(bundle(col({ id: 'i', name: 'Banco de ideias', columns: ['Nome'] })));
    expect(p.collections[0].destination).toBe('ideias');
  });
});

describe('mapStatus clamp', () => {
  test('never returns agendado', () => {
    expect(mapStatus('Agendado')).toBe('aprovado_cliente');
    expect(mapStatus('Scheduled')).toBe('aprovado_cliente');
  });
  test('published-ish maps to postado, unknown to rascunho', () => {
    expect(mapStatus('Publicado')).toBe('postado');
    expect(mapStatus('???')).toBe('rascunho');
  });
});
```

- [ ] **Step 2: Run test, verify FAIL.**

- [ ] **Step 3: Write minimal implementation**

`packages/import-parsers/src/mapper.ts`:

```ts
import type {
  CollectionMapping, ColumnRoles, ImportBundle, ImportCollection, MappingProposal, PostStatusTarget,
} from './types';

const ROLE_PATTERNS: [keyof ColumnRoles, RegExp][] = [
  ['title', /^(nome|name|task ?name|t[ií]tulo)$/i],
  ['date', /data|date|publica|agendad/i],
  ['status', /status|fase|etapa/i],
  ['client', /cliente|client|marca|conta|etiquetas/i],
  ['caption', /legenda|caption|texto|conte[uú]do/i],
  ['email', /e-?mail/i],
  ['phone', /telefone|phone|celular|whats/i],
  ['monthlyValue', /valor|mensalidade|fee/i],
  ['specialty', /especialidade|specialty/i],
  ['tipo', /tipo|formato|format/i],
  ['url', /^(url|link)$/i],
];

export function mapStatus(source: string): PostStatusTarget {
  const s = source.toLowerCase();
  if (/aprovad/.test(s)) return 'aprovado_cliente';
  if (/revis|review/.test(s)) return 'revisao_interna';
  if (/corre/.test(s)) return 'correcao_cliente';
  if (/enviado|client/.test(s)) return 'enviado_cliente';
  if (/postado|publicado|published|done|conclu/.test(s)) return 'postado';
  if (/agendad|sched/.test(s)) return 'aprovado_cliente'; // clamp: never 'agendado'
  return 'rascunho';
}

function columnRoles(col: ImportCollection): ColumnRoles {
  const roles: ColumnRoles = {};
  for (const header of col.columns) {
    for (const [role, re] of ROLE_PATTERNS) {
      if (!roles[role] && re.test(header)) {
        roles[role] = header;
        break;
      }
    }
  }
  return roles;
}

function classify(col: ImportCollection, roles: ColumnRoles): CollectionMapping['destination'] {
  const dateDensity =
    col.rows.length === 0 ? 0 : col.rows.filter((r) => r.dueDate || (roles.date && r.cells[roles.date])).length / col.rows.length;
  if (/client|roster/i.test(col.name) || (roles.email && roles.phone)) return 'clientes';
  if (/ideia|idea|backlog|banco/i.test(col.name)) return 'ideias';
  if (col.listNames.length > 0 && dateDensity < 0.3) return 'entregas';
  if (roles.date || dateDensity >= 0.3) return 'posts';
  return 'ideias';
}

export function proposeMapping(bundle: ImportBundle): MappingProposal {
  const collections = bundle.collections.map((col): CollectionMapping => {
    const roles = columnRoles(col);
    const destination = classify(col, roles);
    const statusValues =
      col.listNames.length > 0
        ? col.listNames
        : roles.status
          ? [...new Set(col.rows.map((r) => r.cells[roles.status!]).filter(Boolean))]
          : [];
    return {
      collectionId: col.id,
      destination,
      columnRoles: roles,
      statusMap: destination === 'posts' ? Object.fromEntries(statusValues.map((v) => [v, mapStatus(v)])) : {},
      clientAssignment: roles.client
        ? { mode: 'column', column: roles.client }
        : { mode: 'fixed', clienteNome: '' },
    };
  });
  return { collections };
}
```

Append to `index.ts`: `export { proposeMapping, mapStatus } from './src/mapper';`

- [ ] **Step 4: Run tests, verify pass.**

- [ ] **Step 5: Commit**

```bash
git add packages/import-parsers
git commit -m "feat(import): deterministic heuristic mapper (classification, roles, status clamp)"
```

---

### Task 8: Migration — `import_jobs`, `import_job_items`, `import_commit_row` RPC

**Files:**
- Create: `supabase/migrations/20260727000001_data_import_jobs.sql`

**Interfaces:**
- Produces: tables `import_jobs`, `import_job_items`; RPC `import_commit_row(p_conta_id uuid, p_job_id bigint, p_source_row_key text, p_kind text, p_payload jsonb) returns jsonb` — SECURITY DEFINER, callable by `service_role` ONLY. Returns `{"skipped": bool, "table": text, "row_id": text}`. Consumed by the edge handler (Task 9) via `db.rpc('import_commit_row', {...})`.

Check no other migration shares the `20260727000001` prefix before creating (`ls supabase/migrations/ | grep 20260727`).

- [ ] **Step 1: Write the migration**

`supabase/migrations/20260727000001_data_import_jobs.sql`:

```sql
-- Data import wizard: job bookkeeping + atomic per-source-row commit.
-- Spec: docs/superpowers/specs/2026-07-27-data-import-migration-design.md

create table if not exists public.import_jobs (
  id bigint generated always as identity primary key,
  conta_id uuid not null,
  created_by uuid,
  source text not null,
  status text not null default 'committing'
    check (status in ('committing', 'completed', 'undone')),
  total_rows integer,
  created_at timestamptz not null default now()
);

create table if not exists public.import_job_items (
  id bigint generated always as identity primary key,
  job_id bigint not null references public.import_jobs (id) on delete cascade,
  conta_id uuid not null,
  table_name text not null,
  -- text: created ids are mixed types (clientes/workflows/workflow_posts bigint, ideias uuid)
  row_id text not null,
  source_row_key text not null,
  ordinal integer not null default 0,
  created_at timestamptz not null default now(),
  unique (job_id, source_row_key, table_name, ordinal)
);
create index if not exists import_job_items_job_idx on public.import_job_items (job_id);

alter table public.import_jobs enable row level security;
alter table public.import_job_items enable row level security;

-- Workspace members may read their own jobs (wizard history / undo button state).
-- Writes happen only through the service-role edge function.
create policy import_jobs_select on public.import_jobs
  for select using (conta_id = public.get_my_conta_id());
create policy import_job_items_select on public.import_job_items
  for select using (conta_id = public.get_my_conta_id());

-- Atomic commit of ONE source row: inserts target row(s) + bookkeeping items in
-- a single transaction. Resume-idempotent: if the PRIMARY item for
-- (job, source_row_key) already exists, returns it with skipped=true.
create or replace function public.import_commit_row(
  p_conta_id uuid,
  p_job_id bigint,
  p_source_row_key text,
  p_kind text,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.import_jobs%rowtype;
  v_existing public.import_job_items%rowtype;
  v_primary_table text;
  v_id text;
  v_cliente_id bigint;
  v_workflow_id bigint;
  v_template_id bigint;
  v_etapa text;
  v_etapa_id text;
  v_i integer;
  v_user_id uuid;
begin
  select * into v_job from public.import_jobs where id = p_job_id and conta_id = p_conta_id;
  -- 'completed' stays writable: a retry after a failed FINAL batch re-runs from
  -- batch 0 against a job already marked completed; idempotency makes it a no-op.
  if not found or v_job.status = 'undone' then
    raise exception 'import job not found or undone';
  end if;
  v_user_id := v_job.created_by;

  v_primary_table := case p_kind
    when 'cliente' then 'clientes'
    when 'container' then 'workflows'
    when 'template' then 'workflow_templates'
    when 'entrega' then 'workflows'
    when 'post' then 'workflow_posts'
    when 'ideia' then 'ideias'
    else null end;
  if v_primary_table is null then
    raise exception 'unknown import kind %', p_kind;
  end if;

  -- Idempotency: primary row only (ordinal 0).
  select * into v_existing from public.import_job_items
    where job_id = p_job_id and source_row_key = p_source_row_key
      and table_name = v_primary_table and ordinal = 0;
  if found then
    return jsonb_build_object('skipped', true, 'table', v_primary_table, 'row_id', v_existing.row_id);
  end if;

  if p_kind = 'cliente' then
    if p_payload ? 'mergeClienteId' then
      -- fill-only-empty-fields merge; nothing recorded (merge is not undoable by design)
      update public.clientes set
        email = coalesce(nullif(email, ''), p_payload->>'email', email),
        telefone = coalesce(nullif(telefone, ''), p_payload->>'telefone', telefone),
        especialidade = coalesce(nullif(especialidade, ''), p_payload->>'especialidade', especialidade),
        notion_page_url = coalesce(nullif(notion_page_url, ''), p_payload->>'notionPageUrl', notion_page_url)
      where id = (p_payload->>'mergeClienteId')::bigint and conta_id = p_conta_id;
      -- record the mapping so later rows can resolve clienteRef{created:sourceKey}
      insert into public.import_job_items (job_id, conta_id, table_name, row_id, source_row_key, ordinal)
        values (p_job_id, p_conta_id, 'clientes', p_payload->>'mergeClienteId', p_source_row_key, 0);
      return jsonb_build_object('skipped', false, 'table', 'clientes', 'row_id', p_payload->>'mergeClienteId');
    end if;
    insert into public.clientes (conta_id, user_id, nome, sigla, cor, plano, email, telefone,
                                 status, valor_mensal, especialidade, notion_page_url)
    values (p_conta_id, v_user_id, p_payload->>'nome',
            upper(left(regexp_replace(p_payload->>'nome', '[^a-zA-Z]', '', 'g') || 'XX', 2)),
            coalesce(p_payload->>'cor', '#eab308'), '',
            coalesce(p_payload->>'email', ''), coalesce(p_payload->>'telefone', ''),
            'ativo', coalesce((p_payload->>'valorMensal')::numeric, 0),
            p_payload->>'especialidade', p_payload->>'notionPageUrl')
    returning id::text into v_id;

  elsif p_kind = 'template' then
    insert into public.workflow_templates (conta_id, user_id, nome, etapas, modo_prazo)
    values (p_conta_id, v_user_id, p_payload->>'nome',
      (select jsonb_agg(jsonb_build_object(
         'nome', e.value, 'prazo_dias', 1, 'tipo_prazo', 'uteis', 'tipo', 'padrao'))
       from jsonb_array_elements_text(p_payload->'etapas') e),
      'padrao')
    returning id::text into v_id;

  elsif p_kind = 'container' then
    v_cliente_id := public.import_resolve_cliente(p_job_id, p_payload);
    insert into public.workflows (conta_id, user_id, cliente_id, titulo, status,
                                  etapa_atual, recorrente, created_via)
    values (p_conta_id, v_user_id, v_cliente_id, p_payload->>'titulo', 'ativo', 0, false, 'agent')
    returning id::text into v_id;

  elsif p_kind = 'entrega' then
    v_cliente_id := public.import_resolve_cliente(p_job_id, p_payload);
    select row_id::bigint into v_template_id from public.import_job_items
      where job_id = p_job_id and source_row_key = p_payload->>'templateKey'
        and table_name = 'workflow_templates' and ordinal = 0;
    if v_template_id is null then raise exception 'template % not committed yet', p_payload->>'templateKey'; end if;
    insert into public.workflows (conta_id, user_id, cliente_id, titulo, template_id, status,
                                  etapa_atual, recorrente, modo_prazo, created_via)
    values (p_conta_id, v_user_id, v_cliente_id, p_payload->>'titulo', v_template_id, 'ativo',
            coalesce((p_payload->>'etapaIndex')::int, 0), false, 'padrao', 'agent')
    returning id::text into v_id;
    -- etapas come from the TEMPLATE row (single source of truth — the wire
    -- CommitEntregaRow carries only templateKey + etapaIndex, never etapa names).
    -- prior=concluido, current=ativo, later=pendente.
    v_i := 0;
    for v_etapa in
      select e->>'nome' from public.workflow_templates t,
             jsonb_array_elements(t.etapas) e where t.id = v_template_id
    loop
      insert into public.workflow_etapas (workflow_id, ordem, nome, prazo_dias, tipo_prazo, tipo, status,
                                          data_limite)
      values (v_id::bigint, v_i, v_etapa, 1, 'uteis', 'padrao',
              case when v_i < coalesce((p_payload->>'etapaIndex')::int, 0) then 'concluido'
                   when v_i = coalesce((p_payload->>'etapaIndex')::int, 0) then 'ativo'
                   else 'pendente' end,
              case when v_i = coalesce((p_payload->>'etapaIndex')::int, 0)
                   then (p_payload->>'dueDate')::timestamptz else null end)
      returning id::text into v_etapa_id;
      insert into public.import_job_items (job_id, conta_id, table_name, row_id, source_row_key, ordinal)
        values (p_job_id, p_conta_id, 'workflow_etapas', v_etapa_id, p_source_row_key, v_i + 1);
      v_i := v_i + 1;
    end loop;

  elsif p_kind = 'post' then
    select row_id::bigint into v_workflow_id from public.import_job_items
      where job_id = p_job_id and source_row_key = p_payload->>'containerKey'
        and table_name = 'workflows' and ordinal = 0;
    if v_workflow_id is null then raise exception 'container % not committed yet', p_payload->>'containerKey'; end if;
    insert into public.workflow_posts (workflow_id, conta_id, titulo, conteudo, conteudo_plain, tipo,
                                       ordem, status, scheduled_at, published_at, created_via)
    values (v_workflow_id, p_conta_id, p_payload->>'titulo',
            p_payload->'conteudo', coalesce(p_payload->>'conteudoPlain', ''),
            coalesce(p_payload->>'tipo', 'feed'),
            0, p_payload->>'status',
            (p_payload->>'scheduledAt')::timestamptz, (p_payload->>'publishedAt')::timestamptz, 'agent')
    returning id::text into v_id;

  elsif p_kind = 'ideia' then
    v_cliente_id := public.import_resolve_cliente(p_job_id, p_payload);
    -- links deliberately omitted: let the column default apply (verify the
    -- column's type/default in the ideias migration before assuming '{}').
    insert into public.ideias (workspace_id, cliente_id, titulo, descricao, status)
    values (p_conta_id, v_cliente_id, p_payload->>'titulo',
            coalesce(p_payload->>'descricao', ''), 'nova')
    returning id::text into v_id;
  end if;

  insert into public.import_job_items (job_id, conta_id, table_name, row_id, source_row_key, ordinal)
    values (p_job_id, p_conta_id, v_primary_table, v_id, p_source_row_key, 0);
  return jsonb_build_object('skipped', false, 'table', v_primary_table, 'row_id', v_id);
end;
$$;

-- Resolves a payload's clienteRef: {"clienteRef":{"type":"existing","clienteId":N}}
-- or {"clienteRef":{"type":"created","sourceKey":"..."}} via import_job_items.
create or replace function public.import_resolve_cliente(p_job_id bigint, p_payload jsonb)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
begin
  if p_payload->'clienteRef'->>'type' = 'existing' then
    return (p_payload->'clienteRef'->>'clienteId')::bigint;
  end if;
  select row_id::bigint into v_id from public.import_job_items
    where job_id = p_job_id and source_row_key = p_payload->'clienteRef'->>'sourceKey'
      and table_name = 'clientes' and ordinal = 0;
  if v_id is null then
    raise exception 'cliente % not committed yet', p_payload->'clienteRef'->>'sourceKey';
  end if;
  return v_id;
end;
$$;

-- CRITICAL (repo gotcha): REVOKE FROM PUBLIC also strips service_role.
-- The explicit grants below are what let the edge function call these at all.
revoke all on function public.import_commit_row(uuid, bigint, text, text, jsonb) from public;
grant execute on function public.import_commit_row(uuid, bigint, text, text, jsonb) to service_role;
revoke all on function public.import_resolve_cliente(bigint, jsonb) from public;
grant execute on function public.import_resolve_cliente(bigint, jsonb) to service_role;
```

- [ ] **Step 2: Verify column assumptions against the real schema**

Before applying, check the actual definitions this migration writes to and adjust if they differ: `grep -rn "create table" supabase/migrations/ | grep -E "clientes|workflow_etapas|ideias"` and read each — specifically the `ideias.links` column type/default (the insert omits it and relies on the default) and any NOT NULL columns on `clientes` beyond those provided here.

- [ ] **Step 3: Apply to staging and smoke-test**

Run (verify the linked ref FIRST — link state flips):

```bash
cat supabase/.temp/project-ref   # MUST be wlyzhyfondykzpsiqsce (staging) before pushing
npx supabase db push --linked
```

If staging push is blocked by the known orphaned-backfill state, apply this single migration via the SQL editor and record its version, per the established workaround.

Smoke-test in the SQL editor (staging):

```sql
begin;
insert into import_jobs (conta_id, source, total_rows) values ('00000000-0000-0000-0000-000000000001', 'csv', 1) returning id;
-- use the returned id below
select import_commit_row('00000000-0000-0000-0000-000000000001', <id>, 'k1', 'cliente', '{"nome":"Teste Import"}');
select import_commit_row('00000000-0000-0000-0000-000000000001', <id>, 'k1', 'cliente', '{"nome":"Teste Import"}'); -- expect skipped=true
rollback;
```

Expected: first call returns `{"skipped": false, ...}`, second returns `{"skipped": true, ...}` with the same row_id.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260727000001_data_import_jobs.sql
git commit -m "feat(import): import_jobs bookkeeping tables + atomic import_commit_row RPC"
```

---

### Task 9: Edge function `data-import` (start / preview / commit / undo)

**Files:**
- Create: `supabase/functions/data-import/types.ts` (the wire contract from Shared contracts, verbatim)
- Create: `supabase/functions/data-import/handler.ts`
- Create: `supabase/functions/data-import/index.ts`
- Create: `supabase/functions/__tests__/data-import_test.ts`

**Interfaces:**
- Consumes: `import_commit_row` RPC (Task 8), `buildCorsHeaders` (`_shared/cors.ts`), `createJsonResponder` (`_shared/http.ts`), `insertAuditLog` (`_shared/audit.ts`), `resolveEntitlements` (`_shared/entitlements.ts`).
- Produces: the five endpoints in Shared contracts. `analyze` is added in Task 10 (returns `{ proposal: null }` until then).

- [ ] **Step 1: Write the failing tests**

`supabase/functions/__tests__/data-import_test.ts` (follow the `hub-ideias_test.ts` conventions — `createSupabaseQueryMock`, `db.queue(table, op, result)`, `db.queueRpc`):

```ts
import { assertEquals, readJson } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createDataImportHandler } from "../data-import/handler.ts";

const buildCorsHeaders = () => ({ "Access-Control-Allow-Origin": "https://app.mesaas.com" });

const ENTITLED = {
  planName: "pro",
  limits: { max_clients: 10, max_workflow_templates: 10, max_posts_per_workflow: 100 },
  features: { feature_csv_import: true },
};

function makeHandler(db: ReturnType<typeof createSupabaseQueryMock>, entitlements: unknown = ENTITLED) {
  return createDataImportHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    resolveEntitlements: async () => entitlements as never,
    geminiKey: null,
  });
}

function authAs(db: ReturnType<typeof createSupabaseQueryMock>) {
  db.setUser({ id: "user-1" });
  db.queue("profiles", "select", { data: { conta_id: "conta-1" }, error: null });
}

function post(path: string, body: unknown) {
  return new Request(`https://x.test/data-import/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer jwt" },
    body: JSON.stringify(body),
  });
}

Deno.test("data-import: rejects when feature_csv_import is off", async () => {
  const db = createSupabaseQueryMock();
  authAs(db);
  const gated = { ...ENTITLED, features: { feature_csv_import: false } };
  const res = await makeHandler(db, gated)(post("start", { source: "csv", totalRows: 1 }));
  assertEquals(res.status, 403);
});

Deno.test("data-import: start creates a job", async () => {
  const db = createSupabaseQueryMock();
  authAs(db);
  db.queue("import_jobs", "insert", { data: { id: 7 }, error: null });
  const res = await makeHandler(db)(post("start", { source: "trello", totalRows: 42 }));
  assertEquals(res.status, 200);
  assertEquals(await readJson(res), { jobId: 7 });
});

Deno.test("data-import: preview counts rows and warns on max_clients", async () => {
  const db = createSupabaseQueryMock();
  authAs(db);
  db.queue("clientes", "select", { data: null, error: null, count: 9 }); // 9 existing, cap 10
  const rows = [
    { kind: "cliente", sourceKey: "a", nome: "Ana" },
    { kind: "cliente", sourceKey: "b", nome: "Bia" },
  ];
  const res = await makeHandler(db)(post("preview", { rows }));
  const body = await readJson(res);
  assertEquals(body.counts.clientes, 2);
  assertEquals(body.limits.maxPostsPerWorkflow, 100);
  assertEquals(body.warnings.length, 1); // 9 + 2 > 10
});

Deno.test("data-import: commit calls the RPC per row and reports skips", async () => {
  const db = createSupabaseQueryMock();
  authAs(db);
  db.queueRpc("import_commit_row", { data: { skipped: false, table: "clientes", row_id: "3" }, error: null });
  db.queueRpc("import_commit_row", { data: { skipped: true, table: "clientes", row_id: "3" }, error: null });
  db.queue("audit_log", "insert", { data: null, error: null });
  const rows = [
    { kind: "cliente", sourceKey: "a", nome: "Ana" },
    { kind: "cliente", sourceKey: "a", nome: "Ana" },
  ];
  const res = await makeHandler(db)(post("commit", { jobId: 7, rows }));
  const body = await readJson(res);
  assertEquals(body.results, [
    { sourceKey: "a", table: "clientes", rowId: "3", skipped: false },
    { sourceKey: "a", table: "clientes", rowId: "3", skipped: true },
  ]);
});

Deno.test("data-import: commit reports per-row failures without aborting the batch", async () => {
  const db = createSupabaseQueryMock();
  authAs(db);
  db.queueRpc("import_commit_row", { data: null, error: { message: "boom" } });
  db.queueRpc("import_commit_row", { data: { skipped: false, table: "ideias", row_id: "u-1" }, error: null });
  db.queue("audit_log", "insert", { data: null, error: null });
  const rows = [
    { kind: "ideia", sourceKey: "x", clienteRef: { type: "existing", clienteId: 1 }, titulo: "T", descricao: "", provenance: {} },
    { kind: "ideia", sourceKey: "y", clienteRef: { type: "existing", clienteId: 1 }, titulo: "U", descricao: "", provenance: {} },
  ];
  const res = await makeHandler(db)(post("commit", { jobId: 7, rows }));
  const body = await readJson(res);
  assertEquals(body.results[0], { sourceKey: "x", table: null, rowId: null, skipped: false, failed: true });
  assertEquals(body.results[1].rowId, "u-1");
});

Deno.test("data-import: undo deletes recorded rows in order, skips published posts", async () => {
  const db = createSupabaseQueryMock();
  authAs(db);
  db.queue("import_jobs", "select", {
    data: { id: 7, conta_id: "conta-1", status: "completed", created_at: new Date().toISOString() },
    error: null,
  });
  db.queue("import_job_items", "select", {
    data: [
      { table_name: "workflow_posts", row_id: "31", source_row_key: "p1", ordinal: 0 },
      { table_name: "workflow_posts", row_id: "32", source_row_key: "p2", ordinal: 0 },
      { table_name: "workflows", row_id: "9", source_row_key: "container:1:0", ordinal: 0 },
      { table_name: "clientes", row_id: "3", source_row_key: "a", ordinal: 0 },
    ],
    error: null,
  });
  // published-post guard: one of the two posts has a platform id
  db.queue("workflow_posts", "select", {
    data: [{ id: 31, instagram_media_id: "ig1", tiktok_post_id: null }],
    error: null,
  });
  db.queue("workflow_posts", "delete", { data: null, error: null });
  db.queue("workflows", "delete", { data: null, error: null });
  db.queue("clientes", "delete", { data: null, error: null });
  db.queue("import_jobs", "update", { data: null, error: null });
  db.queue("audit_log", "insert", { data: null, error: null });
  const res = await makeHandler(db)(post("undo", { jobId: 7 }));
  const body = await readJson(res);
  assertEquals(body.skippedPublished, ["31"]);
  assertEquals(body.deleted, 3);
});
```

Note: if `createSupabaseQueryMock` has no `setUser`, follow whatever pattern `hub-ideias_test.ts` peers use for `auth.getUser` (check `test/shared/supabaseMock.ts` and adapt `authAs` — do not change the mock's public API).

- [ ] **Step 2: Run tests, verify FAIL**

Run: `npm run test:functions -- --filter "data-import"`
Expected: FAIL — `data-import/handler.ts` not found. Then `git checkout -- deno.lock`.

- [ ] **Step 3: Write the implementation**

`supabase/functions/data-import/types.ts`: the wire contract from Shared contracts, verbatim.

`supabase/functions/data-import/handler.ts`:

```ts
import { createJsonResponder } from "../_shared/http.ts";
import { insertAuditLog } from "../_shared/audit.ts";
import type { CommitRow } from "./types.ts";

type DbClient = {
  from: (table: string) => any;
  auth: { getUser: (token: string) => Promise<{ data: { user: any }; error: any }> };
  rpc: (name: string, params: Record<string, unknown>) => any;
};

interface Entitlements {
  limits: Record<string, number | null>;
  features: Record<string, boolean>;
}

interface Deps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  resolveEntitlements: (svc: DbClient, workspaceId: string) => Promise<Entitlements | null>;
  geminiKey: string | null;
}

const UNDO_ORDER = ["workflow_posts", "workflow_etapas", "workflows", "workflow_templates", "ideias", "clientes"];
const BATCH_LIMIT = 200;

export function createDataImportHandler(deps: Deps) {
  return async (req: Request): Promise<Response> => {
    const cors = { ...deps.buildCorsHeaders(req), "Access-Control-Allow-Methods": "POST, OPTIONS" };
    const json = createJsonResponder(cors);
    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);
    const db = deps.createDb();
    const { data: { user }, error: authErr } = await db.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);
    const { data: profile } = await db.from("profiles").select("conta_id").eq("id", user.id).single();
    if (!profile?.conta_id) return json({ error: "Profile not found" }, 403);
    const conta_id = profile.conta_id as string;

    const ent = await deps.resolveEntitlements(db, conta_id);
    if (!ent?.features?.feature_csv_import) return json({ error: "upgrade_required" }, 403);

    const parts = new URL(req.url).pathname.split("/").filter(Boolean);
    const action = parts[parts.indexOf("data-import") + 1] ?? "";
    let body: any = {};
    try { body = await req.json(); } catch { /* actions validate below */ }

    try {
      if (action === "start") {
        const source = String(body.source ?? "");
        if (!["trello", "notion", "clickup", "csv"].includes(source)) return json({ error: "Invalid source" }, 400);
        const { data, error } = await db.from("import_jobs")
          .insert({ conta_id, created_by: user.id, source, total_rows: Number(body.totalRows ?? 0) })
          .select("id").single();
        if (error) throw error;
        return json({ jobId: data.id });
      }

      if (action === "analyze") {
        // AI refinement lands in Task 10; without a key the client keeps its heuristic proposal.
        return json({ proposal: null });
      }

      if (action === "preview") {
        const rows = (body.rows ?? []) as CommitRow[];
        const counts: Record<string, number> = { clientes: 0, posts: 0, entregas: 0, ideias: 0 };
        for (const r of rows) {
          if (r.kind === "cliente") counts.clientes++;
          else if (r.kind === "post") counts.posts++;
          else if (r.kind === "entrega") counts.entregas++;
          else if (r.kind === "ideia") counts.ideias++;
        }
        const warnings: string[] = [];
        const maxClients = ent.limits.max_clients;
        if (counts.clientes > 0 && maxClients != null) {
          const { count } = await db.from("clientes")
            .select("id", { count: "exact", head: true }).eq("status", "ativo");
          if ((count ?? 0) + counts.clientes > maxClients) {
            warnings.push(
              `${counts.clientes} novos clientes excedem o limite de ${maxClients} do seu plano (${count ?? 0} existentes).`,
            );
          }
        }
        const templateRows = rows.filter((r) => r.kind === "template").length;
        const maxTemplates = ent.limits.max_workflow_templates;
        if (templateRows > 0 && maxTemplates != null) {
          const { count } = await db.from("workflow_templates")
            .select("id", { count: "exact", head: true });
          if ((count ?? 0) + templateRows > maxTemplates) {
            warnings.push(
              `${templateRows} novos modelos de fluxo excedem o limite de ${maxTemplates} do seu plano (${count ?? 0} existentes).`,
            );
          }
        }
        return json({
          counts,
          warnings,
          limits: {
            maxClients: ent.limits.max_clients ?? null,
            maxWorkflowTemplates: ent.limits.max_workflow_templates ?? null,
            maxPostsPerWorkflow: ent.limits.max_posts_per_workflow ?? null,
          },
        });
      }

      if (action === "commit") {
        const jobId = Number(body.jobId);
        const rows = (body.rows ?? []) as CommitRow[];
        if (!jobId || !Array.isArray(rows)) return json({ error: "Invalid payload" }, 400);
        if (rows.length > BATCH_LIMIT) return json({ error: "Batch too large" }, 400);
        const results = [];
        for (const row of rows) {
          const { data, error } = await db.rpc("import_commit_row", {
            p_conta_id: conta_id,
            p_job_id: jobId,
            p_source_row_key: row.sourceKey,
            p_kind: row.kind,
            p_payload: normalizePayload(row),
          });
          if (error) {
            console.error("[data-import] commit row failed:", row.sourceKey, error);
            results.push({ sourceKey: row.sourceKey, table: null, rowId: null, skipped: false, failed: true });
          } else {
            results.push({ sourceKey: row.sourceKey, table: data.table, rowId: data.row_id, skipped: data.skipped });
          }
        }
        // Last batch marks the job completed (client sets final on its last slice).
        if (body.final === true) {
          await db.from("import_jobs").update({ status: "completed" }).eq("id", jobId);
        }
        await insertAuditLog(db, {
          conta_id, actor_user_id: user.id, action: "import_commit_batch",
          resource_type: "import_job", resource_id: String(jobId),
          metadata: { rows: rows.length, failed: results.filter((r: any) => r.failed).length },
        });
        return json({ results });
      }

      if (action === "undo") {
        const jobId = Number(body.jobId);
        const { data: job } = await db.from("import_jobs")
          .select("id, conta_id, status, created_at").eq("id", jobId).eq("conta_id", conta_id).single();
        if (!job) return json({ error: "Job not found" }, 404);
        if (job.status === "undone") return json({ error: "Already undone" }, 400);
        // 7-day undo window (spec: Limits & error handling)
        if (Date.now() - new Date(job.created_at).getTime() > 7 * 24 * 60 * 60 * 1000) {
          return json({ error: "Undo window expired" }, 400);
        }
        const { data: items, error: itemsErr } = await db.from("import_job_items")
          .select("table_name, row_id, source_row_key, ordinal").eq("job_id", jobId);
        if (itemsErr) throw itemsErr;

        const byTable = new Map<string, string[]>();
        for (const it of items ?? []) {
          byTable.set(it.table_name, [...(byTable.get(it.table_name) ?? []), it.row_id]);
        }
        const skippedPublished: string[] = [];
        let deleted = 0;
        for (const table of UNDO_ORDER) {
          let ids = byTable.get(table) ?? [];
          if (!ids.length) continue;
          if (table === "workflow_posts") {
            const { data: published } = await db.from("workflow_posts")
              .select("id, instagram_media_id, tiktok_post_id")
              .in("id", ids.map(Number))
              .or("instagram_media_id.not.is.null,tiktok_post_id.not.is.null");
            const publishedIds = new Set((published ?? []).map((p: any) => String(p.id)));
            skippedPublished.push(...publishedIds);
            ids = ids.filter((id) => !publishedIds.has(id));
          }
          if (ids.length) {
            const numeric = table !== "ideias";
            // ideias is scoped by workspace_id, every other target by conta_id
            // (both hold the workspace uuid).
            const scopeCol = table === "ideias" ? "workspace_id" : "conta_id";
            const { error } = await db.from(table).delete()
              .in("id", numeric ? ids.map(Number) : ids).eq(scopeCol, conta_id);
            if (error) throw error;
            deleted += ids.length;
          }
        }
        await db.from("import_jobs").update({ status: "undone" }).eq("id", jobId);
        await insertAuditLog(db, {
          conta_id, actor_user_id: user.id, action: "import_undo",
          resource_type: "import_job", resource_id: String(jobId),
          metadata: { deleted, skippedPublished },
        });
        return json({ deleted, skippedPublished });
      }

      return json({ error: "Unknown action" }, 404);
    } catch (e) {
      console.error("[data-import] error:", e);
      return json({ error: "Internal error" }, 500);
    }
  };
}

/** Maps a CommitRow's wire fields onto the RPC's jsonb payload keys. */
function normalizePayload(row: CommitRow): Record<string, unknown> {
  const { kind, sourceKey: _sk, ...rest } = row as CommitRow & Record<string, unknown>;
  if (kind === "cliente" && (rest as any).merge) {
    const { merge, ...fields } = rest as any;
    return { ...fields, mergeClienteId: merge.clienteId };
  }
  return rest as Record<string, unknown>;
}
```

Note on the `ideias` delete: `ideias` is scoped by `workspace_id`, not `conta_id` — the scoping `.eq()` for that table must be `workspace_id`. Adjust the undo loop: `const scopeCol = table === "ideias" ? "workspace_id" : "conta_id";` and use `.eq(scopeCol, conta_id)`. (Both hold the workspace uuid.)

`supabase/functions/data-import/index.ts`:

```ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { resolveEntitlements } from "../_shared/entitlements.ts";
import { createDataImportHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(createDataImportHandler({
  buildCorsHeaders,
  createDb: () => createClient(SUPABASE_URL, SERVICE_ROLE_KEY) as never,
  resolveEntitlements: resolveEntitlements as never,
  geminiKey: Deno.env.get("GEMINI_API_KEY") ?? null,
}));
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm run test:functions -- --filter "data-import"` then `git checkout -- deno.lock`
Expected: all `data-import` tests pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/data-import supabase/functions/__tests__/data-import_test.ts
git commit -m "feat(import): data-import edge function (start/preview/commit/undo, gated, audited)"
```

---

### Task 10: AI mapping refinement (`analyze` action)

**Files:**
- Create: `supabase/functions/_shared/import-ai.ts`
- Create: `supabase/functions/__tests__/import-ai_test.ts`
- Modify: `supabase/functions/data-import/handler.ts` (analyze action)
- Modify: `supabase/functions/data-import/types.ts` (add summary/proposal types)

**Interfaces:**
- Consumes: Gemini REST endpoint pattern from `instagram-analytics/index.ts:1079` (`gemini-2.5-flash:generateContent`).
- Produces: `refineMapping(summary: AnalyzeSummary, proposal: WireMappingProposal, apiKey: string, fetchFn?: typeof fetch): Promise<WireMappingProposal | null>` — returns null on any API/shape failure (caller keeps the heuristic proposal).

Add to `types.ts`:

```ts
export interface AnalyzeCollectionSummary {
  collectionId: string; name: string; source: string;
  columns: string[]; listNames: string[]; rowCount: number;
  sampleCells: Record<string, string[]>; // per column, at most 3 sample values
}
export interface AnalyzeSummary { collections: AnalyzeCollectionSummary[] }
export interface WireCollectionMapping {
  collectionId: string;
  destination: 'clientes' | 'posts' | 'entregas' | 'ideias' | 'ignorar';
  columnRoles: Record<string, string>;
  statusMap: Record<string, string>;
  clientAssignment: { mode: 'column'; column: string } | { mode: 'fixed'; clienteNome: string };
}
export interface WireMappingProposal { collections: WireCollectionMapping[] }
```

- [ ] **Step 1: Write the failing tests**

`supabase/functions/__tests__/import-ai_test.ts`:

```ts
import { assertEquals } from "./assert.ts";
import { refineMapping } from "../_shared/import-ai.ts";

const SUMMARY = {
  collections: [{
    collectionId: "c1", name: "Calendário", source: "trello",
    columns: ["Nome"], listNames: ["Rascunho", "Aprovado"], rowCount: 2,
    sampleCells: { Nome: ["Post A", "Post B"] },
  }],
};
const HEURISTIC = {
  collections: [{
    collectionId: "c1", destination: "ideias" as const, columnRoles: {},
    statusMap: {}, clientAssignment: { mode: "fixed" as const, clienteNome: "" },
  }],
};

function geminiOk(payload: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
  }), { status: 200 })) as typeof fetch;
}

Deno.test("refineMapping: merges a valid AI answer over the heuristic proposal", async () => {
  const ai = {
    collections: [{
      collectionId: "c1", destination: "posts", columnRoles: { title: "Nome" },
      statusMap: { Rascunho: "rascunho", Aprovado: "aprovado_cliente" },
      clientAssignment: { mode: "fixed", clienteNome: "Dra. Marina" },
    }],
  };
  const out = await refineMapping(SUMMARY, HEURISTIC, "key", geminiOk(ai));
  assertEquals(out!.collections[0].destination, "posts");
  assertEquals(out!.collections[0].statusMap.Aprovado, "aprovado_cliente");
});

Deno.test("refineMapping: rejects forbidden status values (agendado) and unknown collections", async () => {
  const ai = {
    collections: [
      { collectionId: "c1", destination: "posts", columnRoles: {}, statusMap: { X: "agendado" }, clientAssignment: { mode: "fixed", clienteNome: "" } },
      { collectionId: "ghost", destination: "posts", columnRoles: {}, statusMap: {}, clientAssignment: { mode: "fixed", clienteNome: "" } },
    ],
  };
  const out = await refineMapping(SUMMARY, HEURISTIC, "key", geminiOk(ai));
  assertEquals(out!.collections.length, 1);
  assertEquals(out!.collections[0].statusMap.X, "rascunho"); // forbidden value clamped
});

Deno.test("refineMapping: returns null on API failure or malformed JSON", async () => {
  const fail = (async () => new Response("nope", { status: 500 })) as typeof fetch;
  assertEquals(await refineMapping(SUMMARY, HEURISTIC, "key", fail), null);
  const garbage = (async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: "not json" }] } }],
  }), { status: 200 })) as typeof fetch;
  assertEquals(await refineMapping(SUMMARY, HEURISTIC, "key", garbage), null);
});
```

- [ ] **Step 2: Run tests, verify FAIL** (`npm run test:functions -- --filter "import-ai"`, then `git checkout -- deno.lock`).

- [ ] **Step 3: Write the implementation**

`supabase/functions/_shared/import-ai.ts`:

```ts
import type { AnalyzeSummary, WireCollectionMapping, WireMappingProposal } from "../data-import/types.ts";

const DESTINATIONS = new Set(["clientes", "posts", "entregas", "ideias", "ignorar"]);
const STATUS_TARGETS = new Set([
  "rascunho", "revisao_interna", "aprovado_interno", "enviado_cliente",
  "aprovado_cliente", "correcao_cliente", "postado",
]);

function buildPrompt(summary: AnalyzeSummary, heuristic: WireMappingProposal): string {
  return [
    "Você mapeia dados exportados de ferramentas de gestão (Trello/Notion/ClickUp) para um CRM de social media.",
    "Destinos possíveis por coleção: clientes | posts | entregas | ideias | ignorar.",
    "Papéis de coluna possíveis: title, date, status, client, caption, email, phone, monthlyValue, specialty, tipo, url.",
    `Status de post permitidos: ${[...STATUS_TARGETS].join(", ")}. NUNCA use "agendado".`,
    "Responda APENAS com JSON no mesmo formato da proposta heurística, sem markdown.",
    `Coleções (com amostras): ${JSON.stringify(summary)}`,
    `Proposta heurística atual: ${JSON.stringify(heuristic)}`,
  ].join("\n");
}

export async function refineMapping(
  summary: AnalyzeSummary,
  heuristic: WireMappingProposal,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<WireMappingProposal | null> {
  try {
    const res = await fetchFn(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildPrompt(summary, heuristic) }] }],
          generationConfig: { responseMimeType: "application/json" },
        }),
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== "string") return null;
    const parsed = JSON.parse(text) as WireMappingProposal;
    if (!Array.isArray(parsed?.collections)) return null;

    const knownIds = new Set(summary.collections.map((c) => c.collectionId));
    const collections: WireCollectionMapping[] = [];
    for (const c of parsed.collections) {
      if (!knownIds.has(c?.collectionId) || !DESTINATIONS.has(c?.destination)) continue;
      const statusMap: Record<string, string> = {};
      for (const [k, v] of Object.entries(c.statusMap ?? {})) {
        statusMap[k] = STATUS_TARGETS.has(v as string) ? (v as string) : "rascunho";
      }
      collections.push({
        collectionId: c.collectionId,
        destination: c.destination,
        columnRoles: typeof c.columnRoles === "object" && c.columnRoles ? c.columnRoles : {},
        statusMap,
        clientAssignment:
          c.clientAssignment?.mode === "column" && typeof c.clientAssignment.column === "string"
            ? { mode: "column", column: c.clientAssignment.column }
            : { mode: "fixed", clienteNome: String((c.clientAssignment as any)?.clienteNome ?? "") },
      });
    }
    return collections.length ? { collections } : null;
  } catch {
    return null;
  }
}
```

In `handler.ts`, replace the `analyze` action body with:

```ts
      if (action === "analyze") {
        if (!deps.geminiKey) return json({ proposal: null });
        const proposal = await refineMapping(body.summary, body.heuristic, deps.geminiKey);
        return json({ proposal });
      }
```

and add the import `import { refineMapping } from "../_shared/import-ai.ts";`. Add a handler test: analyze with `geminiKey: null` returns `{ proposal: null }` (no fetch attempted).

- [ ] **Step 4: Run tests, verify pass** (`npm run test:functions -- --filter "import"`, then `git checkout -- deno.lock`).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/import-ai.ts supabase/functions/data-import supabase/functions/__tests__/import-ai_test.ts supabase/functions/__tests__/data-import_test.ts
git commit -m "feat(import): optional Gemini mapping refinement with strict output validation"
```

---

### Task 11: Frontend service + wizard page + route

**Files:**
- Create: `apps/crm/src/services/dataImport.ts`
- Create: `apps/crm/src/pages/importar/ImportarPage.tsx`
- Create: `apps/crm/src/pages/importar/buildCommitRows.ts`
- Create: `apps/crm/src/pages/importar/__tests__/buildCommitRows.test.ts`
- Create: `apps/crm/src/pages/importar/__tests__/ImportarPage.test.tsx`
- Modify: `apps/crm/src/App.tsx` (lazy route)
- Modify: `apps/crm/src/content/site-meta.ts:18` (`APP_ROUTE_PREFIXES` + `'importar'`)
- Modify: `vercel.json` (add `importar` to BOTH the app-shell rewrite alternation and the noindex-headers alternation — the vercel-routing test enforces both)

**Interfaces:**
- Consumes: everything exported from `@mesaas/import-parsers`; edge endpoints from Task 9/10; `CommitRow` wire shape (mirrored in `dataImport.ts` as frontend types — the frontend cannot import from `supabase/functions/`).
- Produces: `buildCommitRows(bundle: ImportBundle, proposal: MappingProposal, existingClientes: { id: number; nome: string }[], maxPostsPerWorkflow: number | null): CommitRow[]` — the pure transformation from confirmed mapping to wire rows, pre-sorted in commit order (container chunking against the cap happens here); `ImportarPage` default export.

**Flow ordering (avoids a circular dependency between preview and chunking):** step 4 first calls `buildCommitRows(..., null)` (no chunking) and sends those rows to `previewImport`; the response carries the authoritative `limits`; the commit step then rebuilds with `buildCommitRows(..., limits.maxPostsPerWorkflow)` before slicing into batches. `buildCommitRows` is deterministic, so the only difference between the two calls is container chunking — counts shown in the preview stay correct.

**`dataImport.ts` (complete):**

```ts
import { supabase } from '@/lib/supabase';

const BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/data-import`;

export type ClienteRef = { type: 'existing'; clienteId: number } | { type: 'created'; sourceKey: string };
export interface CommitRowBase { kind: string; sourceKey: string }
export type CommitRow = CommitRowBase & Record<string, unknown>;

export interface PreviewResult {
  counts: Record<string, number>;
  warnings: string[];
  limits: { maxClients: number | null; maxWorkflowTemplates: number | null; maxPostsPerWorkflow: number | null };
}
export interface CommitResult {
  results: { sourceKey: string; table: string | null; rowId: string | null; skipped: boolean; failed?: boolean }[];
}

async function post<T>(action: string, body: unknown): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sessão expirada');
  const res = await fetch(`${BASE}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error === 'upgrade_required' ? 'upgrade_required' : 'Falha na importação');
  }
  return res.json();
}

export const startImport = (source: string, totalRows: number) =>
  post<{ jobId: number }>('start', { source, totalRows });
export const analyzeImport = (summary: unknown, heuristic: unknown) =>
  post<{ proposal: unknown | null }>('analyze', { summary, heuristic });
export const previewImport = (rows: CommitRow[]) => post<PreviewResult>('preview', { rows });
export const commitBatch = (jobId: number, rows: CommitRow[], final: boolean) =>
  post<CommitResult>('commit', { jobId, rows, final });
export const undoImport = (jobId: number) =>
  post<{ deleted: number; skippedPublished: string[] }>('undo', { jobId });
```

**Design notes for the implementer:**
- `buildCommitRows(bundle, proposal, existingClientes, limits)` responsibilities (pure, fully unit-tested):
  1. For `clientes` collections: one `CommitClienteRow` per row; fuzzy match `nome` (case/diacritic-insensitive equality after trim) against `existingClientes` → sets `merge: { clienteId }`.
  2. Collect the distinct client names referenced by post/entrega/ideia rows (via `clientAssignment`); names not matching an existing cliente and not already in a clientes collection produce synthesized `CommitClienteRow`s (`sourceKey: "auto-cliente:<nome>"`).
  3. For `posts` collections: group rows per client; chunk each group into containers of at most `limits.maxPostsPerWorkflow ?? Infinity` rows (`sourceKey: "container:<clienteKey>:<n>"`, `titulo: "Calendário importado — <origem>"` + ` (n)` suffix when chunked); each row → `CommitPostRow` with `toTipTapDoc(description + checklist bullets)`, status from `statusMap` (default `rascunho`), `postado` only when the mapped status is `postado` AND the row date is in the past — otherwise downgrade to `aprovado_cliente`; dateless rows get `scheduledAt: null`, status forced to `rascunho` when the mapped status was date-dependent (`postado`).
  4. For `entregas` collections: one `CommitTemplateRow` per collection (`sourceKey: "template:<collectionId>"`, `etapas: listNames`), one `CommitEntregaRow` per row with `etapaIndex = listNames.indexOf(row.listName)` (fallback 0).
  5. For `ideias` collections: `CommitIdeiaRow` per row (`descricao` = description or joined cells).
  6. Every row's `provenance` carries `{ source, collectionId, sourceKey, sourceUrl, cells }`.
  7. Returns rows pre-sorted in commit order: clientes → templates → containers → rest.
- `ImportarPage` is a 5-step state machine (`origem` → `upload` → `mapeamento` → `previa` → `commit`), plain `useState`, shadcn `Button`/`Card`/`Select` components, pt-BR copy. Step 1 renders the per-source export instructions inline (static text + numbered steps). Step 2 uses `<input type="file" multiple>`; enforces 20 MB/file, 5 files, 2.000 total rows; dispatches to `parseTrelloJson` / `parseNotionExport` / `parseClickupCsv` / `parseGenericCsv` by chosen source; parse throws and parser `warnings` render as a friendly inline error ("Não conseguimos ler este arquivo — confira o passo a passo de exportação acima") without leaving the step; runs `proposeMapping`; fires `analyzeImport` (AI refinement, merged when non-null). Step 3 renders one card per collection: destination `<Select>`, client assignment, status-map table of `<Select>`s over `POST_STATUS_TARGETS`. Step 4 calls `previewImport`, shows counts + warnings, then `buildCommitRows` with returned `limits`. Step 5 calls `startImport`, then `commitBatch` in slices of 200 with a progress bar, passing `final: true` on the last slice; on failure shows "Tentar novamente" which simply re-runs from batch 0 (server-side idempotency makes this safe); done screen shows the report + failed-row download (client-generated CSV via `Blob`) + "Desfazer importação" button calling `undoImport`.
- RTL test drives the state machine with `dataImport` service and parsers mocked (`vi.mock`): renders, selects source, uploads a small CSV `File`, asserts the mapping step appears with the collection card, advances to preview (mock returns counts), asserts commit driver calls `commitBatch` once per 200-row slice.
- The `buildCommitRows` unit test covers: merge matching, auto-client synthesis, container chunking at the cap (e.g. cap 2, 5 posts → 3 containers), status clamp (`Agendado` list → `aprovado_cliente`), `postado` only when past-dated, entrega etapaIndex mapping, commit-order sorting. Write these as concrete cases with exact expected arrays — this file is the heart of the import correctness. Example of the required concreteness (the chunking case):

```ts
test('chunks a client posts group into numbered containers at the cap', () => {
  const bundle = mkBundle(mkPostsCollection('cal', 5)); // 5 dateless post rows, keys p1..p5
  const proposal = mkProposal('cal', 'posts', { clientAssignment: { mode: 'fixed', clienteNome: 'Ana' } });
  const rows = buildCommitRows(bundle, proposal, [{ id: 3, nome: 'Ana' }], 2);
  const containers = rows.filter((r) => r.kind === 'container');
  expect(containers.map((c) => c.sourceKey)).toEqual([
    'container:existing-3:0', 'container:existing-3:1', 'container:existing-3:2',
  ]);
  expect((containers[1] as any).titulo).toBe('Calendário importado — cal (2)');
  const posts = rows.filter((r) => r.kind === 'post');
  expect(posts.map((p: any) => p.containerKey)).toEqual([
    'container:existing-3:0', 'container:existing-3:0',
    'container:existing-3:1', 'container:existing-3:1',
    'container:existing-3:2',
  ]);
});
```

(`mkBundle` / `mkPostsCollection` / `mkProposal` are small local fixture helpers in the test file; write them once at the top.)

- [ ] **Step 1: Write `buildCommitRows` failing tests** (concrete cases per the list above, in the style of the example).
- [ ] **Step 2: Implement `buildCommitRows`, verify tests pass.**
- [ ] **Step 3: Write the `ImportarPage` RTL failing test, implement the page + service, verify pass.**
- [ ] **Step 4: Wire the route + routing metadata.**

In `App.tsx` near line 38: `const ImportarPage = lazy(() => import('./pages/importar/ImportarPage'));` and inside the authenticated routes: `<Route path="/importar" element={<ImportarPage />} />`.

In `site-meta.ts` `APP_ROUTE_PREFIXES`, add `'importar',`. In `vercel.json`, add `|importar` inside BOTH regex alternations (`(login|configurar-senha|...|ajuda|importar)`) — the headers entry and the rewrites entry.

Run: `npx vitest run apps/crm/src/content/__tests__/vercel-routing.test.ts`
Expected: PASS (fails if either vercel.json spot was missed).

- [ ] **Step 5: Full frontend suite + typecheck, commit**

```bash
npm run test
npm run build
git add apps/crm vercel.json
git commit -m "feat(import): wizard page, commit-row builder, batched commit driver, /importar route"
```

---

### Task 12: Entry points (Configurações card + dashboard banner)

**Files:**
- Create: `apps/crm/src/components/import/ImportBanner.tsx`
- Create: `apps/crm/src/components/import/__tests__/ImportBanner.test.tsx`
- Modify: `apps/crm/src/pages/configuracao/tabs/WorkspaceTab.tsx` (card linking to `/importar`)
- Modify: `apps/crm/src/pages/dashboard/DashboardPage.tsx` (banner when workspace has zero clientes)

**Interfaces:**
- Consumes: `/importar` route (Task 11), `FeatureGate` (`@/components/paywall/FeatureGate`).

- [ ] **Step 1: Write the failing test**

`ImportBanner.test.tsx`: renders `<ImportBanner clienteCount={0} />` inside a `MemoryRouter` → expects the text `Migrando do Notion, Trello ou ClickUp?` and a link with `href="/importar"`; renders `<ImportBanner clienteCount={3} />` → expects null output (`container.firstChild` is null).

- [ ] **Step 2: Implement `ImportBanner`**

```tsx
import { Link } from 'react-router-dom';
import { ArrowRight, Import } from 'lucide-react';

export function ImportBanner({ clienteCount }: { clienteCount: number }) {
  if (clienteCount > 0) return null;
  return (
    <div
      className="card animate-up"
      style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '1.25rem 1.5rem', marginBottom: '1.5rem' }}
    >
      <Import className="h-5 w-5" style={{ color: 'var(--primary-color)' }} />
      <div style={{ flex: 1 }}>
        <strong>Migrando do Notion, Trello ou ClickUp?</strong>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          Importe seus clientes, calendário e entregas em minutos.
        </div>
      </div>
      <Link to="/importar" className="btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
        Importar dados <ArrowRight className="h-4 w-4" />
      </Link>
    </div>
  );
}
```

- [ ] **Step 3: Wire the entry points**

Read `DashboardPage.tsx`; render `<ImportBanner clienteCount={clientes.length} />` immediately above the KPI/stats grid, using whatever clientes query the page already holds (if it has none, use the existing `getClientes` via `useQuery` with key `['clientes']` — the pattern used across pages). Read `WorkspaceTab.tsx`; append a bordered section at the bottom:

```tsx
<div className="card" style={{ marginTop: '1.5rem' }}>
  <h3>Importar dados</h3>
  <p style={{ color: 'var(--text-muted)' }}>
    Traga clientes, posts, entregas e ideias de Notion, Trello, ClickUp ou planilhas.
  </p>
  <Link to="/importar" className="btn-secondary">Abrir assistente de importação</Link>
</div>
```

(Adapt heading/wrapper markup to the tab's existing section pattern after reading the file.)

- [ ] **Step 4: Run tests, verify pass** — `npx vitest run apps/crm/src/components/import apps/crm/src/pages/importar`.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/components/import apps/crm/src/pages/configuracao apps/crm/src/pages/dashboard
git commit -m "feat(import): entry points — dashboard onboarding banner + Configurações card"
```

---

### Task 13: Full verification + browser walkthrough

- [ ] **Step 1: Full local gates**

```bash
npm run format
npm run lint
npm run test
npm run test:functions
git checkout -- deno.lock
npm run build
```

Expected: all green. Fix anything that isn't before proceeding.

- [ ] **Step 2: Browser verification against staging**

Start `npm run dev:staging` via the launch config, open `/importar`, and walk the wizard end-to-end with a real small Trello JSON export (staging workspace): upload → mapping cards render with heuristic pre-fill → preview counts → commit → verify the posts appear on `/calendario` under the imported container workflow and clientes on `/clientes` → click "Desfazer importação" → verify everything created is gone. Screenshot each step.

- [ ] **Step 3: Commit any fixes, then finish**

Use the superpowers:finishing-a-development-branch skill: push the branch, open a PR titled `feat(import): assistente de importação de dados (Notion/Trello/ClickUp/CSV)`, and verify the auto-fired external Codex review's findings rather than rubber-stamping them.

---

## Post-merge deploy checklist (operator steps, not plan tasks)

1. `cat supabase/.temp/project-ref` → confirm which project is linked before ANY `--linked` command.
2. Staging: `npx supabase db push --linked` (or SQL-editor apply per the known orphaned-backfill workaround), then `npx supabase functions deploy data-import --use-api`.
3. Prod: same pair against the prod ref after re-linking.
4. `feature_csv_import` already exists per plan — decide the pricing question (free-for-acquisition vs current gating) in the plans table; no code change either way.
