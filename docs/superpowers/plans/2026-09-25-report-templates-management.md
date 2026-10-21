# Gestão de modelos de relatório — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users list, create, duplicate, rename, set default, delete and edit report templates (`report_templates`) from Configuração › Relatórios, in the same block editor used for reports, filled with sample data, before generating a report.

**Architecture:** Service functions in `apps/crm/src/services/reportTemplates.ts` (PostgREST + RLS, zero-row detection). The report editor's autosave hook gets a pluggable save target so reports and templates share it; the report editor's block-interaction logic is extracted into a hook so a new `ModeloEditorPage` can reuse it. A new `ReportTemplatesCard` lives in the Relatórios settings tab, and the "Novo relatório" dialog links to it.

**Tech Stack:** React 19, React Router v7, TanStack Query, shadcn/ui (Radix), sonner, Vitest + Testing Library, `@mesaas/report-blocks`.

**Spec:** `docs/superpowers/specs/2026-09-25-report-templates-management-design.md`

## Global Constraints

- All UI copy in Portuguese. No em-dashes in user-facing copy (use period or colon).
- Toasts via `toast` from `sonner`. Icons from `lucide-react` only.
- No migrations, no edge-function changes. Permissions stay as the DB has them: anyone who can open Configuração › Relatórios (`configuracoes:ver`) can manage templates; no `configuracoes:editar` gate and no read-only mode.
- Every template `layout` written to the DB goes through `stripAiTextForTemplate` (AI text never stored in a template).
- Never use `useBlocker`. Editors with in-flight saves are covered by the existing `useUnsavedWork` inside `useLayoutAutosave`.
- Run commands from the worktree root: `/Users/eduardosouza/projects/sm-crm/.claude/worktrees/relatorios-interativos-default-1e62f5`. Before any claim, `git -C <worktree> status`.
- If `ls node_modules/.deno` shows anything, run `npm ci` before `tsc` (Deno pollutes `node_modules` and breaks the CRM typecheck with duplicate TipTap types).
- Before pushing: `npm run lint`, `npm run format:check`, the four `tsc` commands, `npm run test`.

---

### Task 0: Commit the pending default-report work

The branch has uncommitted changes from earlier in this session (interactive report as default on the analytics page, dialog layout fix). Commit them on their own so the templates work is a separate commit series.

**Files:** already modified: `apps/crm/src/components/ui/month-picker.tsx`, `apps/crm/src/pages/analytics-conta/AnalyticsContaPage.tsx`, `apps/crm/src/pages/analytics-conta/__tests__/AnalyticsContaPage.test.tsx`, `apps/crm/src/pages/analytics-conta/components/NewReportDialog.tsx`, `apps/crm/src/services/__tests__/analytics.test.ts`, `apps/crm/src/services/analytics.ts`

- [ ] **Step 1: Run the affected tests**

Run: `npx vitest run apps/crm/src/pages/analytics-conta apps/crm/src/services/__tests__/analytics.test.ts`
Expected: all pass.

- [ ] **Step 2: Commit**

```bash
git add apps/crm/src/components/ui/month-picker.tsx apps/crm/src/pages/analytics-conta apps/crm/src/services/analytics.ts apps/crm/src/services/__tests__/analytics.test.ts
git commit -m "feat(analytics): relatório interativo como padrão na página da conta

Gerar Relatório (topo e card) abre o dialog do relatório interativo; o card
Relatórios Gerados lista os interativos e mantém os do formato anterior
abaixo. Remove generateReport do CRM (o cron mensal segue). Dialog com
campos empilhados e título Novo relatório.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1: Template service functions

**Files:**
- Modify: `apps/crm/src/services/reportTemplates.ts`
- Test: `apps/crm/src/services/__tests__/reportTemplates.test.ts`

**Interfaces:**
- Produces:
  - `getReportTemplate(id: string): Promise<ReportTemplateRow | null>`
  - `updateReportTemplate(id: string, patch: { name?: string; layout?: ReportLayout }): Promise<void>` (throws on zero rows)
  - `deleteReportTemplate(id: string): Promise<void>` (now throws on zero rows)
  - `buildSystemDefaultLayout(): ReportLayout`
  - `SYSTEM_TEMPLATE_NAME = 'Padrão do sistema'`

- [ ] **Step 1: Write the failing tests**

In `reportTemplates.test.ts`, extend the import list:

```ts
import {
  buildSystemDefaultLayout,
  createReportTemplate,
  deleteReportTemplate,
  getReportTemplate,
  listReportTemplates,
  setDefaultReportTemplate,
  updateReportTemplate,
} from '../reportTemplates';
import { validateLayout } from '@mesaas/report-blocks/types';
```

Replace the whole `describe('deleteReportTemplate', ...)` block with:

```ts
describe('deleteReportTemplate', () => {
  it('deleta filtrado por id e pede o id de volta', async () => {
    const select = vi.fn().mockResolvedValue({ data: [{ id: 't1' }], error: null });
    const eq = vi.fn().mockReturnValue({ select });
    const del = vi.fn().mockReturnValue({ eq });
    fromMock.mockReturnValue({ delete: del });

    await deleteReportTemplate('t1');

    expect(fromMock).toHaveBeenCalledWith('report_templates');
    expect(eq).toHaveBeenCalledWith('id', 't1');
    expect(select).toHaveBeenCalledWith('id');
  });

  it('erro do PostgREST vira Error', async () => {
    const select = vi.fn().mockResolvedValue({ data: null, error: { message: 'delete falhou' } });
    const eq = vi.fn().mockReturnValue({ select });
    fromMock.mockReturnValue({ delete: vi.fn().mockReturnValue({ eq }) });

    await expect(deleteReportTemplate('t1')).rejects.toThrow('delete falhou');
  });

  it('zero linhas (RLS filtrou) vira Error, não sucesso falso', async () => {
    const select = vi.fn().mockResolvedValue({ data: [], error: null });
    const eq = vi.fn().mockReturnValue({ select });
    fromMock.mockReturnValue({ delete: vi.fn().mockReturnValue({ eq }) });

    await expect(deleteReportTemplate('t1')).rejects.toThrow('Modelo não encontrado');
  });
});
```

Append:

```ts
describe('getReportTemplate', () => {
  it('busca por id com maybeSingle', async () => {
    const row = {
      id: 't1',
      name: 'Mensal',
      layout: { version: 1, blocks: [] },
      is_default: false,
      created_at: '2026-08-01',
    };
    const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null });
    const eq = vi.fn().mockReturnValue({ maybeSingle });
    const select = vi.fn().mockReturnValue({ eq });
    fromMock.mockReturnValue({ select });

    await expect(getReportTemplate('t1')).resolves.toEqual(row);
    expect(select).toHaveBeenCalledWith('id, name, layout, is_default, created_at');
    expect(eq).toHaveBeenCalledWith('id', 't1');
  });

  it('inexistente devolve null', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    fromMock.mockReturnValue({
      select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle }) }),
    });
    await expect(getReportTemplate('nope')).resolves.toBeNull();
  });

  it('erro do PostgREST vira Error', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
    fromMock.mockReturnValue({
      select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ maybeSingle }) }),
    });
    await expect(getReportTemplate('t1')).rejects.toThrow('boom');
  });
});

describe('updateReportTemplate', () => {
  it('atualiza name/layout filtrado por id e pede o id de volta', async () => {
    const select = vi.fn().mockResolvedValue({ data: [{ id: 't1' }], error: null });
    const eq = vi.fn().mockReturnValue({ select });
    const update = vi.fn().mockReturnValue({ eq });
    fromMock.mockReturnValue({ update });

    await updateReportTemplate('t1', { name: 'Novo nome' });

    expect(fromMock).toHaveBeenCalledWith('report_templates');
    expect(update).toHaveBeenCalledWith({ name: 'Novo nome' });
    expect(eq).toHaveBeenCalledWith('id', 't1');
    expect(select).toHaveBeenCalledWith('id');
  });

  it('zero linhas (RLS filtrou) vira Error', async () => {
    const select = vi.fn().mockResolvedValue({ data: [], error: null });
    fromMock.mockReturnValue({
      update: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ select }) }),
    });
    await expect(updateReportTemplate('t1', { name: 'x' })).rejects.toThrow(
      'Modelo não encontrado',
    );
  });

  it('erro do PostgREST vira Error', async () => {
    const select = vi.fn().mockResolvedValue({ data: null, error: { message: 'layout inválido' } });
    fromMock.mockReturnValue({
      update: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ select }) }),
    });
    await expect(updateReportTemplate('t1', { name: 'x' })).rejects.toThrow('layout inválido');
  });
});

describe('buildSystemDefaultLayout', () => {
  it('é um layout válido, começa pela capa e não carrega texto de IA', () => {
    const layout = buildSystemDefaultLayout();
    expect(validateLayout(layout).ok).toBe(true);
    expect(layout.blocks[0].type).toBe('cover');
    expect(layout.blocks.some((b) => b.type === 'ai_summary')).toBe(true);
    expect(layout.blocks.every((b) => b.text === undefined)).toBe(true);
  });

  it('gera ids novos a cada chamada', () => {
    const a = buildSystemDefaultLayout();
    const b = buildSystemDefaultLayout();
    expect(a.blocks[0].id).not.toBe(b.blocks[0].id);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run apps/crm/src/services/__tests__/reportTemplates.test.ts`
Expected: FAIL (`getReportTemplate`/`updateReportTemplate`/`buildSystemDefaultLayout` not exported; delete tests fail on missing `.select`).

- [ ] **Step 3: Implement**

In `reportTemplates.ts`, add imports below the existing ones:

```ts
import { buildDefaultLayout } from '../../../../supabase/functions/_shared/report-docs/default-layout.ts';
import { stripAiTextForTemplate } from '../pages/relatorio-editor/templateOps';
```

Add after the `ReportTemplateRow` interface:

```ts
const TEMPLATE_COLUMNS = 'id, name, layout, is_default, created_at';

/** Nome do layout embutido (não é uma linha do banco). */
export const SYSTEM_TEMPLATE_NAME = 'Padrão do sistema';

// Update/delete filtrados por RLS respondem 200 com zero linhas quando o
// workspace ativo muda ou o acesso some. Sem pedir o id de volta, o autosave
// marcaria como salvo algo que não persistiu (mesmo contrato de
// updateReportDoc).
function assertTouched(data: unknown[] | null): void {
  if (!data || data.length === 0) throw new Error('Modelo não encontrado');
}

export async function getReportTemplate(id: string): Promise<ReportTemplateRow | null> {
  const { data, error } = await supabase
    .from('report_templates')
    .select(TEMPLATE_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ReportTemplateRow | null) ?? null;
}

export async function updateReportTemplate(
  id: string,
  patch: { name?: string; layout?: ReportLayout },
): Promise<void> {
  const { data, error } = await supabase
    .from('report_templates')
    .update(patch)
    .eq('id', id)
    .select('id');
  if (error) throw new Error(error.message);
  assertTouched(data);
}

/** Layout padrão do sistema com todos os blocos opcionais, sem texto de IA. */
export function buildSystemDefaultLayout(): ReportLayout {
  return stripAiTextForTemplate(
    buildDefaultLayout({ hasAi: true, hasAudience: true, hasBestTimes: true, hasTags: true }),
  );
}
```

Replace `listReportTemplates`'s and `createReportTemplate`'s literal `'id, name, layout, is_default, created_at'` with `TEMPLATE_COLUMNS`, and replace `deleteReportTemplate` with:

```ts
export async function deleteReportTemplate(id: string): Promise<void> {
  const { data, error } = await supabase
    .from('report_templates')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) throw new Error(error.message);
  assertTouched(data);
}
```

If `tsc` complains that the `ReportLayout` from `@mesaas/report-blocks/types` and the one returned by `buildDefaultLayout` differ, they don't: `packages/report-blocks/types.ts` re-exports the `_shared` type. If `tsc` rejects the `.ts` import, confirm `allowImportingTsExtensions: true` in `apps/crm/tsconfig.json` (it is set today).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run apps/crm/src/services/__tests__/reportTemplates.test.ts apps/crm/src/pages/relatorio-editor`
Expected: PASS (ApplyTemplateDialog tests mock the service, so the delete change doesn't affect them).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/services/reportTemplates.ts apps/crm/src/services/__tests__/reportTemplates.test.ts
git commit -m "feat(relatorios): serviço de modelos com get/update, delete checado e layout padrão

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Pluggable autosave target

**Files:**
- Modify: `apps/crm/src/pages/relatorio-editor/useLayoutAutosave.ts`
- Create: `apps/crm/src/pages/relatorio-editor/templateAutosave.ts`
- Test: `apps/crm/src/pages/relatorio-editor/__tests__/useLayoutAutosave.test.ts`, create `apps/crm/src/pages/relatorio-editor/__tests__/templateAutosave.test.ts`

**Interfaces:**
- Consumes: `updateReportTemplate` (Task 1), `stripAiTextForTemplate` (`templateOps.ts`).
- Produces:
  - `export interface AutosaveTarget { save(id: string, patch: { layout?: ReportLayout; title?: string }): Promise<void>; cacheKey(id: string): QueryKey; titleField: 'title' | 'name'; errorMessage: string; }` (exported from `useLayoutAutosave.ts`)
  - `export const REPORT_DOC_TARGET: AutosaveTarget` (same file, the default)
  - `useLayoutAutosave(id, initial, target = REPORT_DOC_TARGET)`: unchanged return `{ layout, applyLayout, title, setTitle, saving }`
  - `export const TEMPLATE_AUTOSAVE_TARGET: AutosaveTarget` (`templateAutosave.ts`), cache key `['report-template', id]`

- [ ] **Step 1: Write the failing tests**

Append to `useLayoutAutosave.test.ts` (inside the top-level `describe`):

```ts
  it('target customizado: salva por ele, escreve no cacheKey dele e usa o titleField dele', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const target = {
      save,
      cacheKey: (id: string) => ['report-template', id],
      titleField: 'name' as const,
      errorMessage: 'Erro ao salvar o modelo',
    };
    qc.setQueryData(['report-template', 'tpl-1'], { id: 'tpl-1', name: 'Velho', layout: baseLayout });
    const { result } = renderHook(
      () => useLayoutAutosave('tpl-1', { layout: baseLayout, title: 'Velho' }, target),
      { wrapper },
    );
    const next: ReportLayout = { ...baseLayout, accent: '#0f766e' };
    act(() => result.current.applyLayout(next));
    act(() => result.current.setTitle('Novo'));
    await act(async () => {
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(updateMock).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith('tpl-1', { layout: next });
    expect(save).toHaveBeenCalledWith('tpl-1', { title: 'Novo' });
    expect(qc.getQueryData(['report-template', 'tpl-1'])).toMatchObject({
      name: 'Novo',
      layout: next,
    });
  });

  it('target customizado: falha usa a mensagem de erro dele', async () => {
    const target = {
      save: vi.fn().mockRejectedValue(new Error('x')),
      cacheKey: (id: string) => ['report-template', id],
      titleField: 'name' as const,
      errorMessage: 'Erro ao salvar o modelo',
    };
    const { result } = renderHook(
      () => useLayoutAutosave('tpl-1', { layout: baseLayout, title: 'T' }, target),
      { wrapper },
    );
    act(() => result.current.applyLayout({ ...baseLayout, accent: '#111111' }));
    await act(async () => {
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(toastErrorMock).toHaveBeenCalledWith('Erro ao salvar o modelo', expect.anything());
  });
```

Create `templateAutosave.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportLayout } from '@mesaas/report-blocks/types';

const { updateReportTemplateMock } = vi.hoisted(() => ({
  updateReportTemplateMock: vi.fn(),
}));
vi.mock('../../../services/reportTemplates', () => ({
  updateReportTemplate: updateReportTemplateMock,
}));

import { TEMPLATE_AUTOSAVE_TARGET } from '../templateAutosave';

beforeEach(() => {
  updateReportTemplateMock.mockReset();
  updateReportTemplateMock.mockResolvedValue(undefined);
});

describe('TEMPLATE_AUTOSAVE_TARGET', () => {
  it('layout é gravado sem texto de IA', async () => {
    const layout: ReportLayout = {
      version: 1,
      blocks: [
        { id: 'c', type: 'cover', size: 'full' },
        { id: 'a', type: 'ai_summary', size: 'full', text: { type: 'doc', content: [] } },
        { id: 't', type: 'text', size: 'full', text: { type: 'doc', content: [] } },
      ],
    };
    await TEMPLATE_AUTOSAVE_TARGET.save('tpl-1', { layout });
    const [id, patch] = updateReportTemplateMock.mock.calls[0];
    expect(id).toBe('tpl-1');
    expect(patch.layout.blocks[1].text).toBeUndefined();
    expect(patch.layout.blocks[2].text).toEqual({ type: 'doc', content: [] });
  });

  it('title vira name, aparado', async () => {
    await TEMPLATE_AUTOSAVE_TARGET.save('tpl-1', { title: '  Mensal  ' });
    expect(updateReportTemplateMock).toHaveBeenCalledWith('tpl-1', { name: 'Mensal' });
  });

  it('title em branco não grava (name é NOT NULL e vazio não serve)', async () => {
    await TEMPLATE_AUTOSAVE_TARGET.save('tpl-1', { title: '   ' });
    expect(updateReportTemplateMock).not.toHaveBeenCalled();
  });

  it('chave de cache e campo de título', () => {
    expect(TEMPLATE_AUTOSAVE_TARGET.cacheKey('tpl-1')).toEqual(['report-template', 'tpl-1']);
    expect(TEMPLATE_AUTOSAVE_TARGET.titleField).toBe('name');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/crm/src/pages/relatorio-editor/__tests__/useLayoutAutosave.test.ts apps/crm/src/pages/relatorio-editor/__tests__/templateAutosave.test.ts`
Expected: FAIL (third argument ignored; `templateAutosave` module missing).

- [ ] **Step 3: Implement the target in the hook**

In `useLayoutAutosave.ts`:

1. Change the react-query import to `import { useQueryClient, type QueryKey } from '@tanstack/react-query';`
2. Delete `const SAVE_ERROR_MSG = 'Erro ao salvar o relatório';`.
3. After the `SAVE_ERROR_TOAST` constant, add:

```ts
/** Onde o autosave grava: relatório (report_documents) ou modelo (report_templates). */
export interface AutosaveTarget {
  save(id: string, patch: { layout?: ReportLayout; title?: string }): Promise<void>;
  /** Query de detalhe que o editor lê com staleTime: Infinity. */
  cacheKey(id: string): QueryKey;
  /** Campo do registro em cache que guarda o título. */
  titleField: 'title' | 'name';
  errorMessage: string;
}

export const REPORT_DOC_TARGET: AutosaveTarget = {
  save: (id, patch) => updateReportDoc(id, patch),
  cacheKey: (id) => ['report-doc', id],
  titleField: 'title',
  errorMessage: 'Erro ao salvar o relatório',
};
```

4. Change the hook signature and add a ref right after `const qc = useQueryClient();`:

```ts
export function useLayoutAutosave(
  docId: string,
  initial: { layout: ReportLayout; title: string },
  target: AutosaveTarget = REPORT_DOC_TARGET,
) {
  const qc = useQueryClient();
  // Por ref: os timers e o flush de unmount leem o target vigente sem
  // depender do closure do render em que foram agendados.
  const targetRef = useRef(target);
  targetRef.current = target;
```

5. Inside the hook, replace every write, keeping all surrounding logic identical:
   - each `updateReportDoc(X, { layout: Y })` → `targetRef.current.save(X, { layout: Y })`
   - each `updateReportDoc(X, { title: Y })` → `targetRef.current.save(X, { title: Y })`
   - each `qc.setQueryData(['report-doc', X], (old: unknown) => old ? { ...(old as object), layout: Y } : old)` → `qc.setQueryData(targetRef.current.cacheKey(X), (old: unknown) => old ? { ...(old as object), layout: Y } : old)`
   - each title cache write `{ ...(old as object), title: Y }` → `{ ...(old as object), [targetRef.current.titleField]: Y }` with `targetRef.current.cacheKey(X)` as the key
   - each `toast.error(SAVE_ERROR_MSG, SAVE_ERROR_TOAST)` → `toast.error(targetRef.current.errorMessage, SAVE_ERROR_TOAST)`

   There are 4 `updateReportDoc` calls, 4 `setQueryData` calls and 3 `toast.error` calls today; after the edit `grep -n "updateReportDoc\|'report-doc'\|SAVE_ERROR_MSG" useLayoutAutosave.ts` must only show the import and `REPORT_DOC_TARGET`.

Update the module header comment's first line to: `// Autosave do editor de blocos (relatório ou modelo, via AutosaveTarget), no padrão inline da casa (WorkflowDrawer:448):`

- [ ] **Step 4: Create `templateAutosave.ts`**

```ts
// Autosave do editor de modelo (spec 2026-09-25 §3): grava em report_templates.
// O texto de IA nunca vai para um modelo, e o nome não pode ficar vazio
// (coluna NOT NULL): em branco, mantém o último nome salvo.
import { updateReportTemplate } from '../../services/reportTemplates';
import { stripAiTextForTemplate } from './templateOps';
import type { AutosaveTarget } from './useLayoutAutosave';

export const TEMPLATE_AUTOSAVE_TARGET: AutosaveTarget = {
  async save(id, patch) {
    if (patch.layout) {
      await updateReportTemplate(id, { layout: stripAiTextForTemplate(patch.layout) });
    }
    if (patch.title !== undefined) {
      const name = patch.title.trim();
      if (name) await updateReportTemplate(id, { name });
    }
  },
  cacheKey: (id) => ['report-template', id],
  titleField: 'name',
  errorMessage: 'Erro ao salvar o modelo',
};
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run apps/crm/src/pages/relatorio-editor`
Expected: PASS, including every pre-existing `useLayoutAutosave` and `RelatorioEditorPage` test unchanged.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/pages/relatorio-editor/useLayoutAutosave.ts apps/crm/src/pages/relatorio-editor/templateAutosave.ts apps/crm/src/pages/relatorio-editor/__tests__/useLayoutAutosave.test.ts apps/crm/src/pages/relatorio-editor/__tests__/templateAutosave.test.ts
git commit -m "refactor(relatorio-editor): autosave com destino plugável (relatório ou modelo)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Extract block-editing interactions from the report editor

Pure refactor so the template editor can reuse insert/remove/highlight without copying it.

**Files:**
- Create: `apps/crm/src/pages/relatorio-editor/useBlockEditing.ts`
- Modify: `apps/crm/src/pages/relatorio-editor/RelatorioEditorPage.tsx`
- Test: existing `apps/crm/src/pages/relatorio-editor/__tests__/RelatorioEditorPage.test.tsx` (regression; no new test needed, it already covers insert, remove + undo, highlight)

**Interfaces:**
- Produces: `useBlockEditing(layoutRef: { current: ReportLayout }, applyLayout: (next: ReportLayout) => void)` returning `{ drawerOpen: boolean; setDrawerOpen: (open: boolean) => void; highlightId: string | null; highlightAndScroll: (id: string) => void; openWidgetDrawer: (at: number | null) => void; handleInsert: (type: BlockType) => void; handleRemoveBlock: (id: string) => void }`

- [ ] **Step 1: Create the hook**

Move the code verbatim (comments included) from `EditorBody` in `RelatorioEditorPage.tsx`: the `drawerOpen`, `insertAt`, `highlightId` states, the `highlightTimer`/`scrollTimer` refs, their unmount-cleanup `useEffect`, and the functions `handleRemoveBlock`, `highlightAndScroll`, `openWidgetDrawer`, `handleInsert`.

```ts
// Interações de bloco compartilhadas pelo editor de relatório e pelo de
// modelo: inserir na posição escolhida, excluir com desfazer, destacar e
// rolar até um bloco.
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { BlockType, ReportLayout } from '@mesaas/report-blocks/types';
import { insertBlockAt, removeBlock, restoreBlock } from './layoutOps';

export function useBlockEditing(
  layoutRef: { current: ReportLayout },
  applyLayout: (next: ReportLayout) => void,
) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Posição de inserção do próximo widget: null = fim do documento. Setada
  // pelos pontos de inserção do painel de camadas antes de abrir o drawer.
  const [insertAt, setInsertAt] = useState<number | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // (move the existing unmount-cleanup useEffect here, verbatim)

  // (move handleRemoveBlock, highlightAndScroll, openWidgetDrawer, handleInsert here, verbatim)

  return {
    drawerOpen,
    setDrawerOpen,
    highlightId,
    highlightAndScroll,
    openWidgetDrawer,
    handleInsert,
    handleRemoveBlock,
  };
}
```

The two "(move ...)" lines are instructions, not code: paste the exact bodies from `RelatorioEditorPage.tsx` (currently lines ~131-179) in their place.

- [ ] **Step 2: Use it in `EditorBody`**

In `RelatorioEditorPage.tsx`, delete the moved states/refs/effect/functions and, right after `layoutRef.current = layout;`, add:

```ts
  const {
    drawerOpen,
    setDrawerOpen,
    highlightId,
    highlightAndScroll,
    openWidgetDrawer,
    handleInsert,
    handleRemoveBlock,
  } = useBlockEditing(layoutRef, applyLayout);
```

Add `import { useBlockEditing } from './useBlockEditing';`. Remove now-unused imports (`insertBlockAt`, `removeBlock`, `restoreBlock`, `BlockType` if unused). Keep `useEffect`/`useRef` only if still used (`useRef` is, for `layoutRef`).

- [ ] **Step 3: Run the regression suite and typecheck**

Run: `npx vitest run apps/crm/src/pages/relatorio-editor && npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: PASS with no test changes.

- [ ] **Step 4: Commit**

```bash
git add apps/crm/src/pages/relatorio-editor/useBlockEditing.ts apps/crm/src/pages/relatorio-editor/RelatorioEditorPage.tsx
git commit -m "refactor(relatorio-editor): extrai interações de bloco para useBlockEditing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Template editor page and route

**Files:**
- Create: `apps/crm/src/pages/relatorio-editor/ModeloEditorPage.tsx`
- Modify: `apps/crm/src/App.tsx` (lazy import near line 77, route before `/relatorios/:id` near line 245)
- Test: create `apps/crm/src/pages/relatorio-editor/__tests__/ModeloEditorPage.test.tsx`

**Interfaces:**
- Consumes: `getReportTemplate`, `ReportTemplateRow` (Task 1); `useLayoutAutosave`, `TEMPLATE_AUTOSAVE_TARGET` (Task 2); `useBlockEditing` (Task 3); `getCurrentWorkspace`, `getWorkspaceBranding` from `../../store` (query keys `['currentWorkspace']`, `['workspace-branding']`, same as `RelatoriosTab`); `makeSnapshotFixture` from `@mesaas/report-blocks/fixtures`.
- Produces: default export `ModeloEditorPage` at route `/relatorios/modelos/:id`; query key `['report-template', id]`.

- [ ] **Step 1: Write the failing test**

```tsx
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportLayout } from '@mesaas/report-blocks/types';

const { getReportTemplateMock, updateReportTemplateMock } = vi.hoisted(() => ({
  getReportTemplateMock: vi.fn(),
  updateReportTemplateMock: vi.fn(),
}));
vi.mock('../../../services/reportTemplates', () => ({
  getReportTemplate: getReportTemplateMock,
  updateReportTemplate: updateReportTemplateMock,
}));
vi.mock('../../../store', () => ({
  getCurrentWorkspace: vi.fn().mockResolvedValue({ id: 'ws-1', name: 'Agência X', logo_url: null }),
  getWorkspaceBranding: vi.fn().mockResolvedValue({
    brand_color: '#7c3aed',
    report_splash_url: null,
    send_report_email: false,
    send_client_event_emails: false,
  }),
}));
const { toastMock } = vi.hoisted(() => ({
  toastMock: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), loading: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: toastMock }));

import ModeloEditorPage from '../ModeloEditorPage';

const layout: ReportLayout = {
  version: 1,
  blocks: [
    { id: 'c', type: 'cover', size: 'full' },
    { id: 'ai', type: 'ai_summary', size: 'full' },
  ],
};

function renderAt(id = 'tpl-1') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/relatorios/modelos/${id}`]}>
        <Routes>
          <Route path="/relatorios/modelos/:id" element={<ModeloEditorPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  getReportTemplateMock.mockReset();
  updateReportTemplateMock.mockReset();
  updateReportTemplateMock.mockResolvedValue(undefined);
  getReportTemplateMock.mockResolvedValue({
    id: 'tpl-1',
    name: 'Mensal completo',
    layout,
    is_default: true,
    created_at: '2026-09-01',
  });
});

describe('ModeloEditorPage', () => {
  it('abre o modelo com nome editável, aviso de dados de exemplo e placeholder de IA', async () => {
    renderAt();
    expect(await screen.findByDisplayValue('Mensal completo')).toBeInTheDocument();
    expect(screen.getByText(/Dados de exemplo/)).toBeInTheDocument();
    expect(screen.getByText('Gerado pela IA em cada relatório')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Modelos/ })).toHaveAttribute(
      'href',
      '/configuracao/relatorios',
    );
  });

  it('não mostra ações de relatório', async () => {
    renderAt();
    await screen.findByDisplayValue('Mensal completo');
    expect(screen.queryByRole('button', { name: /Exportar PDF/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Ações do relatório/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Adicionar widget/ })).toBeInTheDocument();
  });

  it('renomear grava name via updateReportTemplate', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderAt();
      const input = await screen.findByDisplayValue('Mensal completo');
      fireEvent.change(input, { target: { value: 'Resumo' } });
      await act(async () => {
        vi.advanceTimersByTime(500);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(updateReportTemplateMock).toHaveBeenCalledWith('tpl-1', { name: 'Resumo' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('modelo inexistente mostra "Modelo não encontrado."', async () => {
    getReportTemplateMock.mockResolvedValue(null);
    renderAt('nope');
    expect(await screen.findByText('Modelo não encontrado.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run apps/crm/src/pages/relatorio-editor/__tests__/ModeloEditorPage.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `ModeloEditorPage.tsx`**

```tsx
// Editor de modelo (spec 2026-09-25 §2): o mesmo canvas do relatório, com
// dados de exemplo e a marca real do workspace, gravando em report_templates.
// Sem PDF, atualizar dados, ver como cliente ou salvar/aplicar template.
import { useMemo, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Info, Plus, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { makeSnapshotFixture } from '@mesaas/report-blocks/fixtures';
import type { ReportBlock } from '@mesaas/report-blocks/types';
import '@mesaas/report-blocks/styles.css';
import { getReportTemplate, type ReportTemplateRow } from '../../services/reportTemplates';
import { getCurrentWorkspace, getWorkspaceBranding } from '../../store';
import { useLayoutAutosave } from './useLayoutAutosave';
import { TEMPLATE_AUTOSAVE_TARGET } from './templateAutosave';
import { useBlockEditing } from './useBlockEditing';
import { EditorCanvas } from './EditorCanvas';
import { TextBlockEditor } from './TextBlockEditor';
import { AddWidgetDrawer } from './AddWidgetDrawer';
import { LayersPanel } from './LayersPanel';
import { AppearancePopover } from './AppearancePopover';
import { moveBlock, normalizeCoverSize, updateBlockConfig, updateBlockText } from './layoutOps';

const SETTINGS_PATH = '/configuracao/relatorios';

function AiPlaceholder() {
  return (
    <div
      style={{
        border: '1px dashed var(--border-color)',
        borderRadius: 10,
        padding: '1rem',
        color: 'var(--text-muted)',
        fontSize: '0.85rem',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
      }}
    >
      <Sparkles className="h-4 w-4" aria-hidden="true" />
      Gerado pela IA em cada relatório
    </div>
  );
}

function ModeloEditorBody({ template }: { template: ReportTemplateRow }) {
  const { data: workspace } = useQuery({
    queryKey: ['currentWorkspace'],
    queryFn: getCurrentWorkspace,
  });
  const { data: branding } = useQuery({
    queryKey: ['workspace-branding'],
    queryFn: getWorkspaceBranding,
  });
  // Mesmo racional de ReportPreview.tsx: números de exemplo, marca real.
  const snapshot = useMemo(
    () =>
      makeSnapshotFixture({
        account: { handle: 'seucliente', specialty: '' },
        branding: {
          workspace_name: workspace?.name ?? '',
          logo_url: workspace?.logo_url ?? null,
          splash_url: branding?.report_splash_url ?? null,
          accent_color: branding?.brand_color ?? '#eab308',
        },
      }),
    [workspace, branding],
  );

  const { layout, applyLayout, title, setTitle, saving } = useLayoutAutosave(
    template.id,
    { layout: normalizeCoverSize(template.layout), title: template.name },
    TEMPLATE_AUTOSAVE_TARGET,
  );
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const {
    drawerOpen,
    setDrawerOpen,
    highlightId,
    highlightAndScroll,
    openWidgetDrawer,
    handleInsert,
    handleRemoveBlock,
  } = useBlockEditing(layoutRef, applyLayout);

  return (
    <div className="rb-editor-with-rail">
      <header
        style={{
          maxWidth: 880,
          margin: '0 auto 1rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          flexWrap: 'wrap',
        }}
      >
        <Button variant="outline" size="sm" asChild>
          <Link to={SETTINGS_PATH}>
            <ArrowLeft className="h-3.5 w-3.5" /> Modelos
          </Link>
        </Button>
        <div style={{ flex: 1, minWidth: 220 }}>
          <input
            aria-label="Nome do modelo"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{
              width: '100%',
              border: 'none',
              background: 'transparent',
              fontSize: '1.35rem',
              fontWeight: 700,
              letterSpacing: '-1px',
              color: 'var(--text-main)',
              outline: 'none',
            }}
          />
          <p style={{ margin: '0.15rem 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            Modelo de relatório
            {saving && (
              <span className="drawer-saving-indicator" style={{ marginLeft: '0.6rem' }}>
                Salvando…
              </span>
            )}
          </p>
        </div>
        <AppearancePopover layout={layout} snapshot={snapshot} onChange={applyLayout} />
        <Button size="sm" onClick={() => openWidgetDrawer(null)}>
          <Plus className="h-3.5 w-3.5" /> Adicionar widget
        </Button>
      </header>

      <p
        role="note"
        style={{
          maxWidth: 880,
          margin: '0 auto 1.25rem',
          padding: '0.6rem 0.85rem',
          borderRadius: 10,
          background: 'var(--surface-2)',
          color: 'var(--text-muted)',
          fontSize: '0.85rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
        }}
      >
        <Info className="h-4 w-4" aria-hidden="true" />
        Dados de exemplo. Os números reais entram quando o relatório é gerado.
      </p>

      <EditorCanvas
        layout={layout}
        snapshot={snapshot}
        onChange={applyLayout}
        onRemoveBlock={handleRemoveBlock}
        onConfigChange={(id, patch) => applyLayout(updateBlockConfig(layoutRef.current, id, patch))}
        highlightId={highlightId}
        renderTextBlock={(block: ReportBlock) =>
          block.type === 'text' ? (
            <TextBlockEditor
              key={block.id}
              block={block}
              onTextChange={(id, json) => applyLayout(updateBlockText(layoutRef.current, id, json))}
            />
          ) : (
            <AiPlaceholder key={block.id} />
          )
        }
      />

      <LayersPanel
        layout={layout}
        highlightId={highlightId}
        onReorder={(activeId, overId) =>
          applyLayout(moveBlock(layoutRef.current, activeId, overId))
        }
        onLocate={highlightAndScroll}
        onAddAt={openWidgetDrawer}
        onAddEnd={() => openWidgetDrawer(null)}
      />

      <AddWidgetDrawer open={drawerOpen} onOpenChange={setDrawerOpen} onInsert={handleInsert} />
    </div>
  );
}

export default function ModeloEditorPage() {
  const { id } = useParams<{ id: string }>();
  const { data: template, isLoading } = useQuery({
    queryKey: ['report-template', id],
    queryFn: () => getReportTemplate(id!),
    enabled: Boolean(id),
    // O editor é a fonte da verdade após carregar; refetch clobbaria edições.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  if (isLoading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '50vh' }}>
        <Spinner />
      </div>
    );
  }

  if (!template) {
    return (
      <div style={{ padding: '2rem' }}>
        <p style={{ color: 'var(--text-muted)' }}>Modelo não encontrado.</p>
        <Link to={SETTINGS_PATH}>Voltar para os modelos</Link>
      </div>
    );
  }

  return <ModeloEditorBody key={template.id} template={template} />;
}
```

Notes for the implementer:
- Check `Button` in `apps/crm/src/components/ui/button.tsx` supports `asChild` (shadcn default does). If it doesn't, render a plain `<Link className="...">` styled like an outline button instead.
- Check the `renderTextBlock` contract in `EditorCanvas.tsx:91`: it is called for every `TEXT_BLOCK_TYPES` block (`text`, `ai_summary`, `ai_recommendations`, `ai_goals`), so the `block.type === 'text'` branch covers text and the rest are AI blocks.
- `AppearancePopover`'s brand swatch reads `snapshot.branding.accent_color`, which is the workspace's real color here. That is intended.

- [ ] **Step 4: Register the route**

In `apps/crm/src/App.tsx`, next to `const RelatorioEditorPage = lazy(...)`:

```ts
const ModeloEditorPage = lazy(() => import('./pages/relatorio-editor/ModeloEditorPage'));
```

Immediately above `<Route path="/relatorios/:id" element={<RelatorioEditorPage />} />`:

```tsx
                <Route path="/relatorios/modelos/:id" element={<ModeloEditorPage />} />
```

No `vercel.json` change: its CRM pattern already includes `relatorios(/.*)?`.

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run apps/crm/src/pages/relatorio-editor && npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/pages/relatorio-editor/ModeloEditorPage.tsx apps/crm/src/pages/relatorio-editor/__tests__/ModeloEditorPage.test.tsx apps/crm/src/App.tsx
git commit -m "feat(relatorios): editor de modelo com dados de exemplo em /relatorios/modelos/:id

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Templates list in Configuração › Relatórios

**Files:**
- Create: `apps/crm/src/pages/configuracao/tabs/ReportTemplatesCard.tsx`
- Modify: `apps/crm/src/pages/configuracao/tabs/RelatoriosTab.tsx` (wrap the return in a fragment and render the card after the existing card)
- Modify: `apps/crm/src/pages/configuracao/tabs/__tests__/RelatoriosTab.test.tsx` (mock the new card)
- Test: create `apps/crm/src/pages/configuracao/tabs/__tests__/ReportTemplatesCard.test.tsx`

**Interfaces:**
- Consumes: `listReportTemplates`, `createReportTemplate`, `updateReportTemplate`, `deleteReportTemplate`, `setDefaultReportTemplate`, `buildSystemDefaultLayout`, `SYSTEM_TEMPLATE_NAME`, `ReportTemplateRow` (Task 1). Query keys `['report-templates']` and `['report-template', id]` (Task 4).
- Produces: `export function ReportTemplatesCard(): JSX.Element`

- [ ] **Step 1: Write the failing test**

```tsx
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const svc = vi.hoisted(() => ({
  listReportTemplates: vi.fn(),
  createReportTemplate: vi.fn(),
  updateReportTemplate: vi.fn(),
  deleteReportTemplate: vi.fn(),
  setDefaultReportTemplate: vi.fn(),
  buildSystemDefaultLayout: vi.fn(() => ({ version: 1, blocks: [] })),
  SYSTEM_TEMPLATE_NAME: 'Padrão do sistema',
}));
vi.mock('../../../../services/reportTemplates', () => svc);

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }));
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual<typeof import('react-router-dom')>('react-router-dom')),
  useNavigate: () => navigateMock,
}));

const { toastMock } = vi.hoisted(() => ({
  toastMock: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: toastMock }));

// DropdownMenu mockado no padrão da casa (RelatorioEditorPage.test.tsx): o
// Radix real não abre com fireEvent no jsdom.
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuItem: ({
    children,
    onSelect,
  }: {
    children: React.ReactNode;
    onSelect?: () => void;
  }) => (
    <button type="button" onClick={() => onSelect?.()}>
      {children}
    </button>
  ),
}));

import { ReportTemplatesCard } from '../ReportTemplatesCard';

const rows = [
  {
    id: 't1',
    name: 'Mensal completo',
    layout: { version: 1, blocks: [{ id: 'a', type: 'cover', size: 'full' }] },
    is_default: true,
    created_at: '2026-09-01',
  },
  {
    id: 't2',
    name: 'Resumo rápido',
    layout: { version: 1, blocks: [] },
    is_default: false,
    created_at: '2026-08-01',
  },
];

let qc: QueryClient;
function renderCard() {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ReportTemplatesCard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  for (const fn of Object.values(svc)) if (typeof fn === 'function' && 'mockReset' in fn) fn.mockReset();
  svc.buildSystemDefaultLayout.mockReturnValue({ version: 1, blocks: [] });
  svc.listReportTemplates.mockResolvedValue(rows);
  svc.createReportTemplate.mockResolvedValue({ ...rows[1], id: 'new-1' });
  svc.updateReportTemplate.mockResolvedValue(undefined);
  svc.deleteReportTemplate.mockResolvedValue(undefined);
  svc.setDefaultReportTemplate.mockResolvedValue(undefined);
  navigateMock.mockReset();
});

function rowOf(name: string) {
  return screen.getByText(name).closest('[data-template-row]') as HTMLElement;
}

describe('ReportTemplatesCard', () => {
  it('lista o padrão do sistema primeiro, depois os modelos com badge e contagem', async () => {
    renderCard();
    await screen.findByText('Mensal completo');
    const names = Array.from(document.querySelectorAll('[data-template-row]')).map(
      (r) => r.getAttribute('data-template-row'),
    );
    expect(names).toEqual(['system', 't1', 't2']);
    expect(within(rowOf('Mensal completo')).getByText('padrão')).toBeInTheDocument();
    expect(within(rowOf('Mensal completo')).getByText('1 bloco')).toBeInTheDocument();
    expect(within(rowOf('Resumo rápido')).getByText('0 blocos')).toBeInTheDocument();
  });

  it('Novo modelo cria com o layout do sistema e abre o editor', async () => {
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: /Novo modelo/ }));
    await waitFor(() =>
      expect(svc.createReportTemplate).toHaveBeenCalledWith('Novo modelo', {
        version: 1,
        blocks: [],
      }),
    );
    expect(navigateMock).toHaveBeenCalledWith('/relatorios/modelos/new-1');
  });

  it('Duplicar o padrão do sistema cria "Padrão do sistema (cópia)"', async () => {
    renderCard();
    await screen.findByText('Mensal completo');
    fireEvent.click(within(rowOf('Padrão do sistema')).getByRole('button', { name: /Duplicar/ }));
    await waitFor(() =>
      expect(svc.createReportTemplate).toHaveBeenCalledWith(
        'Padrão do sistema (cópia)',
        expect.anything(),
      ),
    );
  });

  it('Duplicar um modelo cria "Cópia de {nome}" com o layout dele', async () => {
    renderCard();
    await screen.findByText('Resumo rápido');
    fireEvent.click(within(rowOf('Resumo rápido')).getByRole('button', { name: /Duplicar/ }));
    await waitFor(() =>
      expect(svc.createReportTemplate).toHaveBeenCalledWith('Cópia de Resumo rápido', rows[1].layout),
    );
  });

  it('Editar navega para o editor do modelo', async () => {
    renderCard();
    await screen.findByText('Resumo rápido');
    fireEvent.click(within(rowOf('Resumo rápido')).getByRole('button', { name: /Editar/ }));
    expect(navigateMock).toHaveBeenCalledWith('/relatorios/modelos/t2');
  });

  it('Definir como padrão chama a RPC e só aparece em modelos não padrão', async () => {
    renderCard();
    await screen.findByText('Resumo rápido');
    expect(
      within(rowOf('Mensal completo')).queryByRole('button', { name: /Definir como padrão/ }),
    ).toBeNull();
    fireEvent.click(
      within(rowOf('Resumo rápido')).getByRole('button', { name: /Definir como padrão/ }),
    );
    await waitFor(() => expect(svc.setDefaultReportTemplate).toHaveBeenCalledWith('t2'));
  });

  it('Renomear grava o novo nome e invalida o detalhe do modelo', async () => {
    renderCard();
    await screen.findByText('Resumo rápido');
    const invalidate = vi.spyOn(qc, 'invalidateQueries');
    fireEvent.click(within(rowOf('Resumo rápido')).getByRole('button', { name: /Renomear/ }));
    const input = await screen.findByLabelText('Nome do modelo');
    fireEvent.change(input, { target: { value: 'Resumo semanal' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(svc.updateReportTemplate).toHaveBeenCalledWith('t2', { name: 'Resumo semanal' }),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['report-template', 't2'] });
  });

  it('Excluir pede confirmação, exclui e remove o detalhe do cache', async () => {
    renderCard();
    await screen.findByText('Resumo rápido');
    qc.setQueryData(['report-template', 't2'], rows[1]);
    fireEvent.click(within(rowOf('Resumo rápido')).getByRole('button', { name: /Excluir/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir modelo' }));
    await waitFor(() => expect(svc.deleteReportTemplate).toHaveBeenCalledWith('t2'));
    await waitFor(() => expect(qc.getQueryData(['report-template', 't2'])).toBeUndefined());
    expect(toastMock.success).toHaveBeenCalledWith('Modelo excluído.');
  });

  it('erro numa ação vira toast genérico', async () => {
    svc.setDefaultReportTemplate.mockRejectedValue(new Error('rpc boom'));
    renderCard();
    await screen.findByText('Resumo rápido');
    fireEvent.click(
      within(rowOf('Resumo rápido')).getByRole('button', { name: /Definir como padrão/ }),
    );
    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith('Não foi possível atualizar o modelo.'),
    );
  });

  it('sem modelos, mostra o texto de ajuda', async () => {
    svc.listReportTemplates.mockResolvedValue([]);
    renderCard();
    expect(
      await screen.findByText(
        'Crie um modelo para reaproveitar a mesma estrutura em todos os relatórios.',
      ),
    ).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run apps/crm/src/pages/configuracao/tabs/__tests__/ReportTemplatesCard.test.tsx`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `ReportTemplatesCard.tsx`**

```tsx
// Modelos de relatório (spec 2026-09-25 §1): lista, cria, duplica, renomeia,
// define o padrão e exclui. Sem gate por configuracoes:editar: as policies de
// report_templates liberam o workspace inteiro (ver a spec, "Permissões").
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy, Lock, MoreHorizontal, Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ReportLayout } from '@mesaas/report-blocks/types';
import {
  buildSystemDefaultLayout,
  createReportTemplate,
  deleteReportTemplate,
  listReportTemplates,
  setDefaultReportTemplate,
  SYSTEM_TEMPLATE_NAME,
  updateReportTemplate,
  type ReportTemplateRow,
} from '../../../services/reportTemplates';

const LIST_KEY = ['report-templates'] as const;
const detailKey = (id: string) => ['report-template', id] as const;
const GENERIC_ERROR = 'Não foi possível atualizar o modelo.';

function blockCount(n: number): string {
  return n === 1 ? '1 bloco' : `${n} blocos`;
}

const ROW_STYLE = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.75rem',
  padding: '0.65rem 0',
  borderBottom: '1px solid var(--border-color)',
} as const;

const META_STYLE = { fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.5rem' };

export function ReportTemplatesCard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: templates = [], isLoading } = useQuery({
    queryKey: LIST_KEY,
    queryFn: listReportTemplates,
  });
  const [renaming, setRenaming] = useState<ReportTemplateRow | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [deleting, setDeleting] = useState<ReportTemplateRow | null>(null);

  useEffect(() => {
    if (renaming) setRenameValue(renaming.name);
  }, [renaming]);

  const create = useMutation({
    mutationFn: ({ name, layout }: { name: string; layout: ReportLayout }) =>
      createReportTemplate(name, layout),
    onSuccess: async (row) => {
      await qc.invalidateQueries({ queryKey: LIST_KEY });
      navigate(`/relatorios/modelos/${row.id}`);
    },
    onError: () => toast.error('Não foi possível criar o modelo.'),
  });

  const makeDefault = useMutation({
    mutationFn: (id: string) => setDefaultReportTemplate(id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: LIST_KEY });
      toast.success('Modelo padrão atualizado.');
    },
    onError: () => toast.error(GENERIC_ERROR),
  });

  const rename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => updateReportTemplate(id, { name }),
    onSuccess: async (_data, { id }) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: LIST_KEY }),
        // O editor lê o detalhe com staleTime: Infinity: sem isso ele
        // reabriria com o nome antigo.
        qc.invalidateQueries({ queryKey: detailKey(id) }),
      ]);
      setRenaming(null);
      toast.success('Modelo renomeado.');
    },
    onError: () => toast.error(GENERIC_ERROR),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteReportTemplate(id),
    onSuccess: async (_data, id) => {
      qc.removeQueries({ queryKey: detailKey(id) });
      await qc.invalidateQueries({ queryKey: LIST_KEY });
      setDeleting(null);
      toast.success('Modelo excluído.');
    },
    onError: () => toast.error('Não foi possível excluir o modelo.'),
  });

  const busy = create.isPending;

  return (
    <div className="card animate-up" style={{ marginBottom: '1.5rem' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '1rem',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h3 className="config-title">Modelos de relatório</h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
            Layouts usados ao gerar relatórios. O padrão vem pré-selecionado.
          </p>
        </div>
        <Button
          size="sm"
          disabled={busy}
          onClick={() =>
            create.mutate({ name: 'Novo modelo', layout: buildSystemDefaultLayout() })
          }
        >
          <Plus className="h-3.5 w-3.5" /> Novo modelo
        </Button>
      </div>

      <div style={{ marginTop: '0.75rem' }}>
        <div data-template-row="system" style={ROW_STYLE}>
          <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
            <Lock
              className="h-3.5 w-3.5"
              aria-hidden="true"
              style={{ color: 'var(--text-muted)', marginRight: '0.5rem' }}
            />
            <span>{SYSTEM_TEMPLATE_NAME}</span>
            <span style={META_STYLE}>embutido</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              create.mutate({
                name: `${SYSTEM_TEMPLATE_NAME} (cópia)`,
                layout: buildSystemDefaultLayout(),
              })
            }
          >
            <Copy className="h-3.5 w-3.5" /> Duplicar
          </Button>
        </div>

        {templates.map((t) => (
          <div key={t.id} data-template-row={t.id} style={ROW_STYLE}>
            <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
              <span>{t.name}</span>
              {t.is_default && (
                <span className="badge badge-neutral badge--sm" style={{ marginLeft: '0.5rem' }}>
                  padrão
                </span>
              )}
              <span style={META_STYLE}>{blockCount(t.layout.blocks.length)}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(`/relatorios/modelos/${t.id}`)}
              >
                <Pencil className="h-3.5 w-3.5" /> Editar
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" aria-label={`Mais ações de ${t.name}`}>
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {!t.is_default && (
                    <DropdownMenuItem onSelect={() => makeDefault.mutate(t.id)}>
                      Definir como padrão
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onSelect={() => setRenaming(t)}>Renomear</DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={busy}
                    onSelect={() => create.mutate({ name: `Cópia de ${t.name}`, layout: t.layout })}
                  >
                    Duplicar
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setDeleting(t)}>Excluir</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        ))}

        {!isLoading && templates.length === 0 && (
          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0.75rem 0 0' }}>
            Crie um modelo para reaproveitar a mesma estrutura em todos os relatórios.
          </p>
        )}
      </div>

      <Dialog
        open={renaming !== null}
        onOpenChange={(open) => {
          if (!open && !rename.isPending) setRenaming(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Renomear modelo</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rename-template-name">Nome do modelo</Label>
            <Input
              id="rename-template-name"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenaming(null)}>
              Cancelar
            </Button>
            <Button
              disabled={rename.isPending || !renameValue.trim()}
              onClick={() =>
                renaming && rename.mutate({ id: renaming.id, name: renameValue.trim() })
              }
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir o modelo?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting?.name}. Relatórios já gerados com ele não mudam.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (deleting) remove.mutate(deleting.id);
              }}
            >
              Excluir modelo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

Notes for the implementer:
- The test's `DropdownMenu` mock renders items as buttons whose accessible name is their text ("Definir como padrão", "Renomear", "Duplicar", "Excluir"); the row-level "Duplicar" for saved templates is the menu item.
- If `DropdownMenuSeparator` is not exported from `apps/crm/src/components/ui/dropdown-menu.tsx`, drop it (and from the test mock).
- Deleting the workspace's default template leaves no default: the dialog then preselects "Padrão do sistema" (existing `NewReportDialog` behavior). No special handling needed.

- [ ] **Step 4: Wire into `RelatoriosTab.tsx`**

Import it: `import { ReportTemplatesCard } from './ReportTemplatesCard';`

Change the component's `return (` to return a fragment: `return (\n    <>\n      <div className="card animate-up" ...>` ... existing card unchanged ... `</div>\n      <ReportTemplatesCard />\n    </>\n  );`

In `RelatoriosTab.test.tsx`, add next to the other mocks:

```ts
vi.mock('../ReportTemplatesCard', () => ({
  ReportTemplatesCard: () => <div data-testid="report-templates-card" />,
}));
```

and add one assertion to the first existing render test: `expect(screen.getByTestId('report-templates-card')).toBeInTheDocument();`

- [ ] **Step 5: Run tests**

Run: `npx vitest run apps/crm/src/pages/configuracao`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/pages/configuracao/tabs/ReportTemplatesCard.tsx apps/crm/src/pages/configuracao/tabs/RelatoriosTab.tsx apps/crm/src/pages/configuracao/tabs/__tests__/ReportTemplatesCard.test.tsx apps/crm/src/pages/configuracao/tabs/__tests__/RelatoriosTab.test.tsx
git commit -m "feat(configuracao): lista de modelos de relatório em Configuração › Relatórios

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: "Ver e editar modelos" link in the Novo relatório dialog

**Files:**
- Modify: `apps/crm/src/pages/analytics-conta/components/NewReportDialog.tsx`
- Test: `apps/crm/src/pages/analytics-conta/components/__tests__/NewReportDialog.test.tsx`

**Interfaces:**
- Consumes: `useAuth().can` from `apps/crm/src/context/AuthContext` (`can('configuracoes', 'ver') === true`).

- [ ] **Step 1: Write the failing tests**

In `NewReportDialog.test.tsx`:

1. Capture the `useQuery` options so the refetch policy can be asserted. Replace the `@tanstack/react-query` mock with:

```ts
const { useQueryCalls } = vi.hoisted(() => ({ useQueryCalls: [] as Array<Record<string, unknown>> }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryKey: unknown[] } & Record<string, unknown>) => {
    useQueryCalls.push(options);
    const key = String(options.queryKey[0]);
    return queryState[key] ?? { data: undefined, isLoading: false };
  },
  useQueryClient: () => ({ invalidateQueries: invalidateQueriesMock }),
}));
```

(If `queryState`/`invalidateQueriesMock` are declared with `vi.hoisted`, add `useQueryCalls` to that same hoisted block instead.)

2. Mock auth:

```ts
const { canMock } = vi.hoisted(() => ({ canMock: vi.fn() }));
vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ can: canMock }) }));
```

3. In `beforeEach`, add `canMock.mockReturnValue(true); useQueryCalls.length = 0;`

4. Add tests:

```ts
  it('mostra "Ver e editar modelos" abrindo Configuração › Relatórios em nova aba', () => {
    render(<NewReportDialog open onOpenChange={() => {}} clientId={42} />);
    const link = screen.getByRole('link', { name: /Ver e editar modelos/ });
    expect(link).toHaveAttribute('href', '/configuracao/relatorios');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('sem configuracoes:ver, não mostra o link', () => {
    canMock.mockReturnValue(false);
    render(<NewReportDialog open onOpenChange={() => {}} clientId={42} />);
    expect(screen.queryByRole('link', { name: /Ver e editar modelos/ })).toBeNull();
  });

  it('a lista de modelos refaz sempre que a janela volta ao foco', () => {
    render(<NewReportDialog open onOpenChange={() => {}} clientId={42} />);
    const templatesQuery = useQueryCalls.find(
      (o) => (o.queryKey as unknown[])[0] === 'report-templates',
    );
    expect(templatesQuery?.refetchOnWindowFocus).toBe('always');
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/crm/src/pages/analytics-conta/components/__tests__/NewReportDialog.test.tsx`
Expected: the three new tests FAIL.

- [ ] **Step 3: Implement**

In `NewReportDialog.tsx`:

```ts
import { ExternalLink } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
```

Inside the component:

```ts
  const { can } = useAuth();
  // Só quem abre a aba (configTabs.ts: configuracoes:ver) vê o link.
  const canSeeTemplates = can('configuracoes', 'ver') === true;
```

Change the templates query to:

```ts
  const { data: templates = [], isLoading: templatesLoading } = useQuery({
    queryKey: ['report-templates'],
    queryFn: listReportTemplates,
    enabled: open,
    // O link abaixo abre os modelos em outra aba. O QueryClient global tem
    // staleTime de 30s, então sem 'always' um modelo criado lá e uma volta
    // rápida manteriam a lista antiga no select.
    refetchOnWindowFocus: 'always',
  });
```

Replace the "Modelo" label line `<Label htmlFor="new-report-template">Modelo</Label>` with:

```tsx
            <div className="flex items-baseline justify-between gap-2">
              <Label htmlFor="new-report-template">Modelo</Label>
              {canSeeTemplates && (
                <a
                  href="/configuracao/relatorios"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  Ver e editar modelos <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              )}
            </div>
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run apps/crm/src/pages/analytics-conta`
Expected: PASS (the page test mocks `NewReportDialog`, so it doesn't need an auth mock for the dialog).

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/analytics-conta/components/NewReportDialog.tsx apps/crm/src/pages/analytics-conta/components/__tests__/NewReportDialog.test.tsx
git commit -m "feat(analytics): link para os modelos no dialog Novo relatório

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Full verification

- [ ] **Step 1: Clean node_modules if Deno polluted it**

Run: `ls node_modules/.deno 2>/dev/null | head -1` — if it prints anything, run `npm ci`.

- [ ] **Step 2: Typecheck all four projects**

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
```

Expected: no errors.

- [ ] **Step 3: Lint, format, tests**

```bash
npm run lint
npm run format:check
npm run test
```

Expected: 0 lint errors (existing warnings only), Prettier clean, all tests pass. If `format:check` fails on changed files, run `npx prettier --write <files>` and amend into the task commit that introduced them.

- [ ] **Step 4: Browser check**

Start the CRM with `preview_start` (`crm-staging`), read the real port from `preview_logs` ("Local:" line), log in with the seed-session technique (memory: `reference_seed_login_browser_verification.md`), then:
1. `/configuracao/relatorios`: the "Modelos de relatório" card lists "Padrão do sistema" first.
2. "Novo modelo" opens `/relatorios/modelos/<id>` with sample data, the workspace's logo/color on the cover, the "Dados de exemplo" note and AI placeholders.
3. Rename in the header, add a widget, go back: the list shows the new name and block count.
4. Rename and delete from the list work; the default badge moves with "Definir como padrão".
5. Screenshot the card and the editor.

These screens only use PostgREST, so staging's edge-function CORS block shouldn't affect them. If they still can't load locally, say so plainly and rely on the test suite.

Delete any seed-session json dropped in the Vite root and stop the preview server when done.
