# Briefing Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Exportar" dropdown to the CRM briefing toolbar that copies the selected briefing as Markdown or CSV to the clipboard, and downloads it as a CSV file.

**Architecture:** A pure, unit-tested module (`apps/crm/src/lib/briefingExport.ts`) does selection + grouping + formatting; the `BriefingEditor` component in `HubTab.tsx` wires three dropdown items to clipboard/download side effects. No network calls, no new store functions — all data is already loaded in the component.

**Tech Stack:** React 19, TypeScript, Vitest, `sonner` toasts, shadcn `DropdownMenu`/`Button`, `lucide-react` icons.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-22-briefing-export-design.md`.
- Scope: the **currently selected** briefing only — handlers consume the selected briefing's questions, never the full `questions` list.
- Briefing content is **plain text** → must be escaped when emitted into Markdown.
- CSV columns are exactly `pergunta,secao,resposta` (matches the importer `apps/crm/src/lib/csv.ts` `parseCSV`); unsectioned `secao` is `''`.
- CSV is RFC-4180 (quote fields containing `,`/`"`, double internal `"`); newlines inside values flattened to a single space.
- Section order = CRM visual order: unsectioned (`''`) bucket first, then named sections in first-seen order (mirrors `HubTab.tsx:687` + `:987`).
- Download only: mime `text/csv;charset=utf-8`, prepend UTF-8 BOM `﻿`. Clipboard CSV gets **no** BOM.
- Toasts via `sonner` `toast`. Portuguese UI copy.
- Typecheck with `npm run build`; run `npm run test` after changes. No linter/formatter configured.
- Commit trailers (every commit):
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01VthUpFawXvDWo7ZNtoD24r
  ```

---

## File Structure

- **Create** `apps/crm/src/lib/briefingExport.ts` — pure functions: `escapeMarkdown`, `slugifyTitle`, `buildBriefingExportSections`, `briefingToCSV`, `briefingToMarkdown` (+ private `csvField`). Exports `ExportSection`/`ExportQuestion` types.
- **Create** `apps/crm/src/lib/__tests__/briefingExport.test.ts` — Vitest unit tests for all of the above.
- **Modify** `apps/crm/src/pages/cliente-detalhe/HubTab.tsx` — add `Download` to the `lucide-react` import; add a module-level `downloadTextFile` helper; add three export handlers + a `canExport` flag in `BriefingEditor`; add the "Exportar" `DropdownMenu` to the toolbar.

Tasks 1–4 build the pure module bottom-up (each independently testable). Task 5 wires the UI.

---

### Task 1: Pure string helpers — `escapeMarkdown` + `slugifyTitle`

**Files:**
- Create: `apps/crm/src/lib/briefingExport.ts`
- Test: `apps/crm/src/lib/__tests__/briefingExport.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `escapeMarkdown(text: string): string` — backslash-escapes Markdown metacharacters in plain text.
  - `slugifyTitle(title: string): string` — filename-safe slug; empty → `'briefing'`.
  - `interface ExportQuestion { question: string; answer: string | null }`
  - `interface ExportSection { name: string; questions: ExportQuestion[] }` (`name === ''` is the unsectioned bucket)

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/lib/__tests__/briefingExport.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { escapeMarkdown, slugifyTitle } from '../briefingExport';

describe('escapeMarkdown', () => {
  it('escapes inline metacharacters', () => {
    expect(escapeMarkdown('a *b* _c_ `d` [e] <f>')).toBe('a \\*b\\* \\_c\\_ \\`d\\` \\[e\\] \\<f>');
  });

  it('escapes a leading heading marker', () => {
    expect(escapeMarkdown('## not a heading')).toBe('\\## not a heading');
  });

  it('escapes a leading list/quote/pipe marker', () => {
    expect(escapeMarkdown('- item')).toBe('\\- item');
    expect(escapeMarkdown('> quote')).toBe('\\> quote');
    expect(escapeMarkdown('| a | b |')).toBe('\\| a | b |'); // only the leading marker is escaped
  });

  it('escapes an ordered-list marker on the punctuation', () => {
    expect(escapeMarkdown('1. first')).toBe('1\\. first');
  });

  it('leaves ordinary prose punctuation untouched', () => {
    expect(escapeMarkdown('Olá, tudo bem? (sim!)')).toBe('Olá, tudo bem? (sim!)');
  });

  it('handles each line of multi-line text', () => {
    expect(escapeMarkdown('first\n# second')).toBe('first\n\\# second');
  });
});

describe('slugifyTitle', () => {
  it('strips accents and lowercases', () => {
    expect(slugifyTitle('Visão & Storytelling')).toBe('visao-storytelling');
  });

  it('collapses separators and trims dashes', () => {
    expect(slugifyTitle('  Briefing -- 2026!  ')).toBe('briefing-2026');
  });

  it('falls back to "briefing" when empty', () => {
    expect(slugifyTitle('   ')).toBe('briefing');
    expect(slugifyTitle('!!!')).toBe('briefing');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/lib/__tests__/briefingExport.test.ts`
Expected: FAIL — `Failed to resolve import "../briefingExport"` (module does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `apps/crm/src/lib/briefingExport.ts`:

```ts
// =============================================
// Briefing export — pure formatters (no React/DOM)
// =============================================

export interface ExportQuestion {
  question: string;
  answer: string | null;
}

export interface ExportSection {
  name: string; // '' is the unsectioned bucket
  questions: ExportQuestion[];
}

/**
 * Backslash-escapes Markdown metacharacters so plain-text briefing content
 * cannot alter the exported document's structure.
 */
export function escapeMarkdown(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      // Inline metacharacters anywhere: \ ` * _ [ ] <
      let out = line.replace(/([\\`*_[\]<])/g, '\\$1');
      // Leading block markers (after optional spaces): # > | + - =
      out = out.replace(/^(\s*)([#>|+\-=])/, '$1\\$2');
      // Leading ordered-list marker: escape the punctuation, e.g. "1." -> "1\."
      out = out.replace(/^(\s*)(\d+)([.)])/, '$1$2\\$3');
      return out;
    })
    .join('\n');
}

/** Filename-safe slug: lowercased, accent-stripped, non-alphanumerics -> '-'. */
export function slugifyTitle(title: string): string {
  const slug = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'briefing';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/crm/src/lib/__tests__/briefingExport.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/lib/briefingExport.ts apps/crm/src/lib/__tests__/briefingExport.test.ts
git commit -m "$(cat <<'EOF'
feat(briefing): add escapeMarkdown + slugifyTitle export helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VthUpFawXvDWo7ZNtoD24r
EOF
)"
```

---

### Task 2: `buildBriefingExportSections` (selection + grouping + ordering)

**Files:**
- Modify: `apps/crm/src/lib/briefingExport.ts`
- Test: `apps/crm/src/lib/__tests__/briefingExport.test.ts`

**Interfaces:**
- Consumes: `ExportSection` (Task 1); `HubBriefingQuestionRow` from `@/store/hub`.
- Produces: `buildBriefingExportSections(allQuestions: HubBriefingQuestionRow[], selectedId: string | null, firstId: string | null): ExportSection[]` — filters to the selected briefing, groups by section, returns CRM visual order (unsectioned first, then named first-seen).

Note: this re-applies the `(q.briefing_id ?? firstId) === selectedId` predicate from `HubTab.tsx:585` so the "selected briefing only" guarantee is a pure, testable property.

- [ ] **Step 1: Write the failing test**

Append to `apps/crm/src/lib/__tests__/briefingExport.test.ts`:

```ts
import { buildBriefingExportSections } from '../briefingExport';
import type { HubBriefingQuestionRow } from '@/store/hub';

function q(partial: Partial<HubBriefingQuestionRow>): HubBriefingQuestionRow {
  return {
    id: partial.id ?? 'id',
    cliente_id: 1,
    conta_id: 'c',
    briefing_id: partial.briefing_id ?? 'b1',
    question: partial.question ?? 'Q',
    answer: partial.answer ?? null,
    section: partial.section ?? null,
    display_order: partial.display_order ?? 0,
    created_at: '2026-01-01',
  };
}

describe('buildBriefingExportSections', () => {
  it('returns only the selected briefing’s questions', () => {
    const rows = [
      q({ id: '1', briefing_id: 'b1', question: 'keep' }),
      q({ id: '2', briefing_id: 'b2', question: 'drop' }),
    ];
    const sections = buildBriefingExportSections(rows, 'b1', 'b1');
    const questions = sections.flatMap((s) => s.questions.map((x) => x.question));
    expect(questions).toEqual(['keep']);
  });

  it('treats null briefing_id as the first briefing', () => {
    const rows = [q({ id: '1', briefing_id: null, question: 'orphan' })];
    const sections = buildBriefingExportSections(rows, 'b1', 'b1');
    expect(sections.flatMap((s) => s.questions.map((x) => x.question))).toEqual(['orphan']);
  });

  it('orders the unsectioned bucket first, then named sections first-seen', () => {
    const rows = [
      q({ id: '1', section: 'DADOS', question: 'a' }),
      q({ id: '2', section: null, question: 'b' }),
      q({ id: '3', section: 'AUDIÊNCIA', question: 'c' }),
      q({ id: '4', section: 'DADOS', question: 'd' }),
    ];
    const sections = buildBriefingExportSections(rows, 'b1', 'b1');
    expect(sections.map((s) => s.name)).toEqual(['', 'DADOS', 'AUDIÊNCIA']);
    expect(sections[1].questions.map((x) => x.question)).toEqual(['a', 'd']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/lib/__tests__/briefingExport.test.ts`
Expected: FAIL — `buildBriefingExportSections is not a function` / no matching export.

- [ ] **Step 3: Write minimal implementation**

Add to the top of `apps/crm/src/lib/briefingExport.ts` (after the existing interfaces):

```ts
import type { HubBriefingQuestionRow } from '@/store/hub';
```

Add this function to `apps/crm/src/lib/briefingExport.ts`:

```ts
/**
 * Filters questions to the selected briefing and groups them into sections in
 * CRM visual order: the unsectioned ('') bucket first, then named sections in
 * first-seen order. Mirrors HubTab.tsx:585 (selection) and :687/:987 (order).
 */
export function buildBriefingExportSections(
  allQuestions: HubBriefingQuestionRow[],
  selectedId: string | null,
  firstId: string | null,
): ExportSection[] {
  const selected = allQuestions.filter((q) => (q.briefing_id ?? firstId) === selectedId);
  const sections: ExportSection[] = [];
  for (const q of selected) {
    const name = q.section ?? '';
    const item: ExportQuestion = { question: q.question, answer: q.answer };
    const existing = sections.find((s) => s.name === name);
    if (existing) existing.questions.push(item);
    else sections.push({ name, questions: [item] });
  }
  const unsectioned = sections.filter((s) => s.name === '');
  const named = sections.filter((s) => s.name !== '');
  return [...unsectioned, ...named];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/crm/src/lib/__tests__/briefingExport.test.ts`
Expected: PASS (all Task 1 + Task 2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/lib/briefingExport.ts apps/crm/src/lib/__tests__/briefingExport.test.ts
git commit -m "$(cat <<'EOF'
feat(briefing): add buildBriefingExportSections (selection + CRM ordering)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VthUpFawXvDWo7ZNtoD24r
EOF
)"
```

---

### Task 3: `briefingToCSV` (+ private `csvField`)

**Files:**
- Modify: `apps/crm/src/lib/briefingExport.ts`
- Test: `apps/crm/src/lib/__tests__/briefingExport.test.ts`

**Interfaces:**
- Consumes: `ExportSection` (Task 1); `parseCSV` from `../csv` (test only, for round-trip).
- Produces: `briefingToCSV(sections: ExportSection[]): string` — header `pergunta,secao,resposta` then one row per question, RFC-4180 quoting, newlines flattened, no BOM.

- [ ] **Step 1: Write the failing test**

Append to `apps/crm/src/lib/__tests__/briefingExport.test.ts`:

```ts
import { briefingToCSV } from '../briefingExport';
import { parseCSV } from '../csv';

describe('briefingToCSV', () => {
  it('emits header and one row per question in section order', () => {
    const csv = briefingToCSV([
      { name: '', questions: [{ question: 'Nome?', answer: 'Ana' }] },
      { name: 'DADOS', questions: [{ question: 'Idade?', answer: null }] },
    ]);
    expect(csv).toBe('pergunta,secao,resposta\nNome?,,Ana\nIdade?,DADOS,');
  });

  it('quotes fields containing commas or quotes and doubles internal quotes', () => {
    const csv = briefingToCSV([
      { name: '', questions: [{ question: 'Cores?', answer: 'azul, verde' }] },
      { name: '', questions: [{ question: 'Apelido?', answer: 'diz "oi"' }] },
    ]);
    const lines = csv.split('\n');
    expect(lines[1]).toBe('Cores?,,"azul, verde"');
    expect(lines[2]).toBe('Apelido?,,"diz ""oi"""');
  });

  it('flattens newlines inside a value to a single space', () => {
    const csv = briefingToCSV([
      { name: '', questions: [{ question: 'Bio?', answer: 'linha1\nlinha2' }] },
    ]);
    expect(csv.split('\n')[1]).toBe('Bio?,,linha1 linha2');
  });

  it('round-trips through parseCSV for quote-free, newline-free values', () => {
    const sections = [
      { name: '', questions: [{ question: 'Nome?', answer: 'Ana' }] },
      { name: 'DADOS', questions: [{ question: 'Cidade?', answer: 'São Paulo, SP' }] },
    ];
    const parsed = parseCSV(briefingToCSV(sections));
    expect(parsed).toEqual([
      { pergunta: 'Nome?', secao: '', resposta: 'Ana' },
      { pergunta: 'Cidade?', secao: 'DADOS', resposta: 'São Paulo, SP' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/lib/__tests__/briefingExport.test.ts`
Expected: FAIL — `briefingToCSV is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `apps/crm/src/lib/briefingExport.ts`:

```ts
/** Encodes one CSV field: flatten newlines, then RFC-4180 quote if needed. */
function csvField(value: string): string {
  const flat = value.replace(/\r\n|\r|\n/g, ' ');
  return /[",]/.test(flat) ? `"${flat.replace(/"/g, '""')}"` : flat;
}

/**
 * CSV with columns pergunta,secao,resposta (importer-compatible). Rows follow
 * the given section order. No BOM (added only on the download path).
 */
export function briefingToCSV(sections: ExportSection[]): string {
  const rows = ['pergunta,secao,resposta'];
  for (const section of sections) {
    for (const q of section.questions) {
      rows.push([csvField(q.question), csvField(section.name), csvField(q.answer ?? '')].join(','));
    }
  }
  return rows.join('\n');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/crm/src/lib/__tests__/briefingExport.test.ts`
Expected: PASS (Tasks 1–3).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/lib/briefingExport.ts apps/crm/src/lib/__tests__/briefingExport.test.ts
git commit -m "$(cat <<'EOF'
feat(briefing): add briefingToCSV (RFC-4180, importer round-trip)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VthUpFawXvDWo7ZNtoD24r
EOF
)"
```

---

### Task 4: `briefingToMarkdown`

**Files:**
- Modify: `apps/crm/src/lib/briefingExport.ts`
- Test: `apps/crm/src/lib/__tests__/briefingExport.test.ts`

**Interfaces:**
- Consumes: `ExportSection` (Task 1), `escapeMarkdown` (Task 1).
- Produces: `briefingToMarkdown(title: string, sections: ExportSection[]): string` — `# Briefing — {title}` H1, `## {name}` per named section, unsectioned questions under the H1 with no heading, `**question**` then answer (or `_(sem resposta)_`).

- [ ] **Step 1: Write the failing test**

Append to `apps/crm/src/lib/__tests__/briefingExport.test.ts`:

```ts
import { briefingToMarkdown } from '../briefingExport';

describe('briefingToMarkdown', () => {
  it('renders title H1, unsectioned-first, headings, and blank-answer marker', () => {
    const md = briefingToMarkdown('Briefing Ana', [
      { name: '', questions: [{ question: 'Nome?', answer: 'Ana' }] },
      { name: 'DADOS', questions: [{ question: 'Idade?', answer: null }] },
    ]);
    expect(md).toBe(
      '# Briefing — Briefing Ana\n\n' +
        '**Nome?**\nAna\n\n' +
        '## DADOS\n\n' +
        '**Idade?**\n_(sem resposta)_\n',
    );
  });

  it('omits the title suffix when title is blank', () => {
    const md = briefingToMarkdown('  ', [{ name: '', questions: [{ question: 'Q?', answer: 'A' }] }]);
    expect(md.startsWith('# Briefing\n\n')).toBe(true);
  });

  it('escapes metacharacters in questions and answers', () => {
    const md = briefingToMarkdown('T', [
      { name: '', questions: [{ question: '# heading?', answer: 'use *bold*' }] },
    ]);
    expect(md).toContain('**\\# heading?**');
    expect(md).toContain('use \\*bold\\*');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/crm/src/lib/__tests__/briefingExport.test.ts`
Expected: FAIL — `briefingToMarkdown is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `apps/crm/src/lib/briefingExport.ts`:

```ts
/**
 * Escaped-plain-text Markdown. Unsectioned questions render under the H1 with no
 * heading; each named section emits a `## {name}` heading. Answer line breaks
 * are preserved; blank answers render as _(sem resposta)_.
 */
export function briefingToMarkdown(title: string, sections: ExportSection[]): string {
  const trimmed = title.trim();
  const blocks: string[] = [trimmed ? `# Briefing — ${escapeMarkdown(trimmed)}` : '# Briefing'];
  for (const section of sections) {
    if (section.name !== '') blocks.push(`## ${escapeMarkdown(section.name)}`);
    for (const q of section.questions) {
      const answer = q.answer && q.answer.trim() ? escapeMarkdown(q.answer) : '_(sem resposta)_';
      blocks.push(`**${escapeMarkdown(q.question)}**\n${answer}`);
    }
  }
  return blocks.join('\n\n') + '\n';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/crm/src/lib/__tests__/briefingExport.test.ts`
Expected: PASS (all module tests).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/lib/briefingExport.ts apps/crm/src/lib/__tests__/briefingExport.test.ts
git commit -m "$(cat <<'EOF'
feat(briefing): add briefingToMarkdown (escaped, CRM ordering)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VthUpFawXvDWo7ZNtoD24r
EOF
)"
```

---

### Task 5: Wire the "Exportar" dropdown into `BriefingEditor`

**Files:**
- Modify: `apps/crm/src/pages/cliente-detalhe/HubTab.tsx`

**Interfaces:**
- Consumes: `buildBriefingExportSections`, `briefingToCSV`, `briefingToMarkdown`, `slugifyTitle` from `@/lib/briefingExport`. In-scope component values: `questions` (`HubTab.tsx:542`), `selectedId` (`:547`), `firstId` (`:584`), `briefingQuestions` (`:585`), `selectedBriefing` (`:850`).
- Produces: UI only (no exports). No automated test (no HubTab test harness; verified by typecheck + manual smoke).

- [ ] **Step 1: Add the `Download` icon import**

In `apps/crm/src/pages/cliente-detalhe/HubTab.tsx`, the `lucide-react` import block (lines 4–17) already imports `Copy`, `Upload`, `ChevronDown`. Add `Download` to that list. After editing, the block includes:

```tsx
import {
  Copy,
  Eye,
  ToggleLeft,
  ToggleRight,
  Plus,
  Trash2,
  Save,
  Upload,
  Download,
  HelpCircle,
  Pencil,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
```

- [ ] **Step 2: Add the export-helpers import**

Below the existing `import { openCSVSelector } from '@/lib/csv';` (line 2), add:

```tsx
import {
  buildBriefingExportSections,
  briefingToCSV,
  briefingToMarkdown,
  slugifyTitle,
} from '@/lib/briefingExport';
```

- [ ] **Step 3: Add the module-level `downloadTextFile` helper**

Add this top-level function in `HubTab.tsx` (e.g. just after the imports, above the first component):

```tsx
function downloadTextFile(filename: string, mime: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    URL.revokeObjectURL(url);
  }
}
```

- [ ] **Step 4: Add `canExport` + three handlers in `BriefingEditor`**

In `BriefingEditor`, immediately after `const selectedBriefing = briefings.find((b) => b.id === selectedId) ?? null;` (line 850) and before `return (`, add:

```tsx
  const canExport = !!selectedBriefing && briefingQuestions.length > 0;

  async function handleCopyMarkdown() {
    const sections = buildBriefingExportSections(questions, selectedId, firstId);
    const md = briefingToMarkdown(selectedBriefing?.title ?? '', sections);
    try {
      await navigator.clipboard.writeText(md);
      toast.success('Briefing copiado como Markdown!');
    } catch {
      toast.error('Não foi possível copiar.');
    }
  }

  async function handleCopyCSV() {
    const sections = buildBriefingExportSections(questions, selectedId, firstId);
    try {
      await navigator.clipboard.writeText(briefingToCSV(sections));
      toast.success('Briefing copiado como CSV!');
    } catch {
      toast.error('Não foi possível copiar.');
    }
  }

  function handleDownloadCSV() {
    const sections = buildBriefingExportSections(questions, selectedId, firstId);
    const csv = '﻿' + briefingToCSV(sections); // BOM so Excel reads accents
    downloadTextFile(
      `briefing-${slugifyTitle(selectedBriefing?.title ?? '')}.csv`,
      'text/csv;charset=utf-8',
      csv,
    );
    toast.success('CSV exportado!');
  }
```

- [ ] **Step 5: Add the "Exportar" dropdown to the toolbar**

In the toolbar, the "Importar CSV" button and its help tooltip `<span>` end at line 891 (`</span>`), just before the toolbar's closing `</div>` (line 892). Insert the dropdown immediately after that `</span>`:

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

(`DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem` are already imported at the top of the file — verify they are; the "Usar template" dropdown at `:860` uses them.)

- [ ] **Step 6: Typecheck**

Run: `npm run build`
Expected: `tsc` + `vite build` succeed with no errors.

- [ ] **Step 7: Run the full unit suite**

Run: `npm run test`
Expected: PASS, including the new `briefingExport.test.ts`, no regressions.

- [ ] **Step 8: Manual smoke verification**

Run `npm run dev` (CRM on :5173), open a client → Briefing tab, then verify:
- "Exportar" appears in the toolbar, **disabled** for a briefing with zero questions and **enabled** when it has questions.
- **Copiar como Markdown** → toast "Briefing copiado como Markdown!"; pasted text has `# Briefing — …`, `## SECTION` headings, `**question**` lines, unsectioned questions before the first heading.
- **Copiar como CSV** → toast "Briefing copiado como CSV!"; pasted text starts `pergunta,secao,resposta`.
- **Baixar CSV** → toast "CSV exportado!"; a `briefing-<slug>.csv` downloads and opens in Excel/Sheets with accents intact.
- Re-import the downloaded CSV via **Importar CSV** → questions import back correctly.

- [ ] **Step 9: Commit**

```bash
git add apps/crm/src/pages/cliente-detalhe/HubTab.tsx
git commit -m "$(cat <<'EOF'
feat(briefing): add Exportar dropdown (copy MD/CSV, download CSV)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01VthUpFawXvDWo7ZNtoD24r
EOF
)"
```

---

## Self-Review

**Spec coverage:**
- Exportar dropdown, 3 items, disabled when empty → Task 5.
- `briefingToCSV` / `briefingToMarkdown` / `slugifyTitle` / `escapeMarkdown` / `buildBriefingExportSections` → Tasks 1–4.
- CRM visual ordering feeding both formats → Task 2 (+ consumed in 3/4).
- Selection guarantee as pure property → Task 2 test.
- RFC-4180 + newline flatten + narrowed round-trip → Task 3 tests.
- Markdown escaping (plain text) → Tasks 1 & 4 tests.
- Download mime + BOM, clipboard no BOM → Task 5 handlers.
- Toasts, Portuguese copy → Task 5.
- Out of scope (JSON, Baixar Markdown, shortcuts, all-briefings, shared util) → not implemented. ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code. ✓

**Type consistency:** `ExportQuestion`/`ExportSection` defined in Task 1, consumed unchanged in 2–5. `buildBriefingExportSections(allQuestions, selectedId, firstId)` signature identical in Task 2 definition and Task 5 calls. `briefingToCSV(sections)` / `briefingToMarkdown(title, sections)` consistent across definition and use. `selectedId`/`firstId` are `string | null`, matching `HubTab.tsx:547`/`:584`. ✓
