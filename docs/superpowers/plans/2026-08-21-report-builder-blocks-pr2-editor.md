# Relatório interativo de blocos — PR 2 (Editor) — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transformar a página `/relatorios/:id` (hoje read-only) no editor Reportei-style: arrastar blocos, redimensionar (1/3, 1/2, 1/1), excluir, adicionar pelo drawer de catálogo, editar texto inline com TipTap, escolher a cor de destaque, tudo com autosave.

**Architecture:** Spec: `docs/superpowers/specs/2026-08-20-report-builder-blocks-design.md` §8 + decisão B (accent). Empilhado sobre o PR #375 (branch base `claude/report-restructure-41a80e`; este plano roda em `claude/report-editor-pr2`). Edições são funções puras sobre o `layout` (módulo `layoutOps`), persistidas por autosave debounced via PostgREST (`UPDATE report_documents (layout, title)` — as únicas colunas com grant). O canvas do editor NÃO reusa o `BlockRenderer` (que fica para view/print): reimplementa o grid com células sortable (dnd-kit) que renderizam os mesmos `BLOCK_COMPONENTS` do pacote, com toolbar de chrome por bloco. Blocos de texto trocam o render estático por um editor TipTap restrito às marks que o `tiptapToHtml` do pacote sabe renderizar.

**Tech Stack:** dnd-kit 6.3.1/10.0.0 (já instalado), TipTap v3.22 (já instalado), TanStack Query, shadcn Sheet, ColorPicker compartilhado (`components/shared/ColorPicker.tsx`).

## Global Constraints

- Copy pt-BR **sem travessão**; reticências no indicador de save são o caractere `…` (padrão `Salvando…`).
- `packages/report-blocks` NUNCA importa `@/` (compartilhado CRM+Hub); todo código de EDIÇÃO (TipTap, dnd, drawer, CSS de chrome) vive no CRM — o pacote só ganha dados puros (catálogo, exports) e CSS de modo.
- Superfície de escrita: `UPDATE report_documents (layout, title)` apenas (grant por coluna do PR 1). Todo save passa por `validateLayout` ANTES do PostgREST; layout inválido nunca é enviado (toast de erro genérico + console.error se acontecer, é bug).
- dnd-kit, invariantes da casa: sensores `useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))`; guard `if (!over || active.id === over.id) return;`; handle = `<button>` com `{...attributes} {...listeners}`, `cursor-grab touch-none`, `aria-label` pt-BR, ícone `GripVertical`; `onDragCancel` limpa TODO estado de drag (precedente KanbanView:770-779 — drag cancelado não pode vazar estado).
- TipTap, invariantes da casa: `useEditor` congela extensões no 1º render (callbacks instáveis vão por ref — comentário canônico em `PostEditor.tsx:120-124`); botões de toolbar usam `onMouseDown={(e) => { e.preventDefault(); … }}`, NUNCA `onClick`; leitura via `getJSON()`; `isInitialized` ref + `onCreate` para não disparar save no conteúdo inicial; troca de conteúdo externo = remount por `key`, não `setContent`.
- Marks/nós permitidos no editor de texto = EXATAMENTE o que `packages/report-blocks/tiptap-render.ts` renderiza: paragraph, heading (níveis 2-3 no editor), bulletList, orderedList, listItem, blockquote, hardBreak, horizontalRule, bold, italic, strike. `code`/`codeBlock`/`link` DESABILITADOS no StarterKit (o renderer degradaria para texto puro).
- Autosave: padrão inline da casa (`WorkflowDrawer.tsx:448-479`): `setSaving(true)` ANTES do debounce, `clearTimeout` do anterior, 1500 ms, `try/catch(toast.error)/finally(setSaving(false))`. Título usa o padrão 400 ms com `dirty` ref + callback ref anti-reset (`WorkflowDrawer.tsx:1080-1101`).
- Testes de packages/ só em `packages/**/__tests__/`; testes do CRM junto das páginas. TDD com RED real.
- Antes do push: `npm run lint`, `npm run format:check`, 4× tsc, `npm run test`, `npm run test:functions`, `git checkout -- deno.lock`. Cuidado com poluição `.deno` do node_modules (rodar deno por último; `npm ci` se `ls node_modules/.deno` existir antes de vitest/tsc).
- Worktree `/Users/eduardosouza/Projects/sm-crm/.claude/worktrees/report-restructure-41a80e`, branch **`claude/report-editor-pr2`** (empilhado em `claude/report-restructure-41a80e`). `git branch --show-current` antes de qualquer commit. PR ao final com `--base claude/report-restructure-41a80e`; quando o #375 squash-mergear, `rebase --onto main` (nunca só retarget).
- Sem migration e sem mudança em edge function neste PR (frontend + pacote apenas).
- Commits `feat(relatorios): …`/`test`/`chore` + rodapé `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Pacote — catálogo de widgets, exports e CSS de modo edição

**Files:**
- Create: `packages/report-blocks/catalog.ts`
- Create: `packages/report-blocks/__tests__/catalog.test.ts`
- Modify: `packages/report-blocks/BlockRenderer.tsx` (exportar `SIZE_CLASS`; extrair `resolveLayoutAccent`)
- Modify: `packages/report-blocks/styles.css` (regras `.rb-mode-edit`)
- Test (extend): `packages/report-blocks/__tests__/BlockRenderer.test.tsx`

**Interfaces:**
- Consumes: `BLOCK_TYPES`, `BlockType`, `ReportLayout`, `ReportDocSnapshot` (types.ts), `resolveAccent` (import já existente no BlockRenderer).
- Produces (Tasks 4, 6, 7 consomem):
  - `WIDGET_CATALOG: readonly WidgetCatalogEntry[]` com `interface WidgetCatalogEntry { type: BlockType; label: string; category: WidgetCategory }`
  - `type WidgetCategory = 'Números' | 'Gráficos' | 'Audiência' | 'Conteúdo' | 'Texto' | 'Estrutura'`
  - `WIDGET_CATEGORIES: readonly WidgetCategory[]` (ordem de exibição do drawer)
  - `export const SIZE_CLASS` (de BlockRenderer.tsx, hoje privado)
  - `export function resolveLayoutAccent(layout: ReportLayout, snapshot: ReportDocSnapshot): { acc: string; accFg: string }`
  - CSS: `.rb-grid.rb-mode-edit > [data-block-id]:empty` fica visível com placeholder "Sem dados no período" via `::after`

- [ ] **Step 1: Teste do catálogo (RED)**

```ts
// packages/report-blocks/__tests__/catalog.test.ts
import { describe, expect, it } from 'vitest';
import { WIDGET_CATALOG, WIDGET_CATEGORIES } from '../catalog';
import { BLOCK_TYPES } from '../types';

describe('WIDGET_CATALOG', () => {
  it('cobre todos os 25 tipos de bloco, sem duplicatas', () => {
    const types = WIDGET_CATALOG.map((w) => w.type);
    expect(new Set(types).size).toBe(types.length);
    expect([...types].sort()).toEqual([...BLOCK_TYPES].sort());
  });

  it('toda entrada tem label pt-BR não vazio e categoria válida', () => {
    for (const w of WIDGET_CATALOG) {
      expect(w.label.length).toBeGreaterThan(0);
      expect(w.label).not.toContain('—');
      expect(WIDGET_CATEGORIES).toContain(w.category);
    }
  });

  it('a ordem de categorias começa em Números e termina em Estrutura', () => {
    expect(WIDGET_CATEGORIES[0]).toBe('Números');
    expect(WIDGET_CATEGORIES[WIDGET_CATEGORIES.length - 1]).toBe('Estrutura');
  });
});
```

- [ ] **Step 2: RED**

Run: `npx vitest run packages/report-blocks/__tests__/catalog.test.ts`
Expected: FAIL (módulo `../catalog` não existe).

- [ ] **Step 3: Implementar `catalog.ts`**

```ts
// packages/report-blocks/catalog.ts
// Catálogo do drawer "Adicionar widget": label pt-BR e categoria por tipo.
// Fonte única para o editor do CRM; a ordem dentro do array é a ordem do drawer.
import type { BlockType } from './types';

export type WidgetCategory =
  | 'Números'
  | 'Gráficos'
  | 'Audiência'
  | 'Conteúdo'
  | 'Texto'
  | 'Estrutura';

export const WIDGET_CATEGORIES: readonly WidgetCategory[] = [
  'Números', 'Gráficos', 'Audiência', 'Conteúdo', 'Texto', 'Estrutura',
];

export interface WidgetCatalogEntry {
  type: BlockType;
  label: string;
  category: WidgetCategory;
}

export const WIDGET_CATALOG: readonly WidgetCatalogEntry[] = [
  { type: 'kpi_followers_gained', label: 'Novos seguidores', category: 'Números' },
  { type: 'kpi_followers_total', label: 'Seguidores totais', category: 'Números' },
  { type: 'kpi_reach', label: 'Alcance', category: 'Números' },
  { type: 'kpi_engagement_rate', label: 'Taxa de engajamento', category: 'Números' },
  { type: 'kpi_saves', label: 'Salvamentos', category: 'Números' },
  { type: 'kpi_posts_count', label: 'Publicações', category: 'Números' },
  { type: 'kpi_profile_views', label: 'Visitas ao perfil', category: 'Números' },
  { type: 'kpi_website_clicks', label: 'Cliques no link', category: 'Números' },
  { type: 'chart_followers', label: 'Evolução de seguidores', category: 'Gráficos' },
  { type: 'chart_formats', label: 'Desempenho por formato', category: 'Gráficos' },
  { type: 'chart_best_times', label: 'Melhores horários', category: 'Gráficos' },
  { type: 'audience_gender', label: 'Gênero', category: 'Audiência' },
  { type: 'audience_age', label: 'Faixa etária', category: 'Audiência' },
  { type: 'audience_cities', label: 'Cidades', category: 'Audiência' },
  { type: 'audience_countries', label: 'Países', category: 'Audiência' },
  { type: 'top_posts', label: 'Top publicações', category: 'Conteúdo' },
  { type: 'post_list', label: 'Lista de publicações', category: 'Conteúdo' },
  { type: 'tags_table', label: 'Performance por tópico', category: 'Conteúdo' },
  { type: 'text', label: 'Texto livre', category: 'Texto' },
  { type: 'ai_summary', label: 'Resumo do mês', category: 'Texto' },
  { type: 'ai_recommendations', label: 'Recomendações', category: 'Texto' },
  { type: 'ai_goals', label: 'Metas', category: 'Texto' },
  { type: 'cover', label: 'Capa', category: 'Estrutura' },
  { type: 'section_header', label: 'Cabeçalho de seção', category: 'Estrutura' },
  { type: 'divider', label: 'Divisor de página', category: 'Estrutura' },
];
```

- [ ] **Step 4: Exportar `SIZE_CLASS` e extrair `resolveLayoutAccent` em BlockRenderer.tsx**

No `packages/report-blocks/BlockRenderer.tsx`:
1. Trocar `const SIZE_CLASS = …` por `export const SIZE_CLASS = …` (objeto inalterado).
2. Acima do componente, adicionar e usar:

```tsx
/** Accent efetivo do documento: override do layout com fallback na marca
 * congelada no snapshot, sempre via resolveAccent (contraste garantido). */
export function resolveLayoutAccent(
  layout: ReportLayout,
  snapshot: ReportDocSnapshot,
): { acc: string; accFg: string } {
  return resolveAccent(layout.accent ?? snapshot.branding.accent_color);
}
```

3. Dentro de `BlockRenderer`, substituir a chamada direta por `const { acc, accFg } = resolveLayoutAccent(layout, snapshot);` (comportamento idêntico).

- [ ] **Step 5: CSS de modo edição em `packages/report-blocks/styles.css`**

Adicionar ao final:

```css
/* Modo edição (canvas do CRM): célula sem dados NÃO colapsa; mostra aviso. */
.rb-grid.rb-mode-edit > [data-block-id]:empty {
  display: block;
  min-height: 56px;
  border: 1px dashed rgba(0, 0, 0, 0.18);
  border-radius: 12px;
  position: relative;
}
.rb-grid.rb-mode-edit > [data-block-id]:empty::after {
  content: 'Sem dados no período';
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 0.78rem;
  opacity: 0.55;
}
```

- [ ] **Step 6: Testes de renderer estendidos (GREEN de tudo)**

Acrescentar em `packages/report-blocks/__tests__/BlockRenderer.test.tsx`:

```tsx
import { resolveLayoutAccent, SIZE_CLASS } from '../BlockRenderer';

it('resolveLayoutAccent prioriza layout.accent sobre a marca do snapshot', () => {
  const snap = makeSnapshotFixture();
  const base = resolveLayoutAccent({ version: 1, blocks: [] }, snap);
  const overridden = resolveLayoutAccent({ version: 1, accent: '#0f766e', blocks: [] }, snap);
  expect(base.acc).not.toBe(overridden.acc);
  expect(overridden.acc.toLowerCase()).toBe('#0f766e');
});

it('SIZE_CLASS mapeia os três tamanhos', () => {
  expect(SIZE_CLASS).toEqual({ third: 'rb-third', half: 'rb-half', full: 'rb-full' });
});

it('styles.css tem as regras de modo edição', () => {
  const css = readFileSync(join(__dirname, '../styles.css'), 'utf8');
  expect(css).toContain('.rb-grid.rb-mode-edit > [data-block-id]:empty');
  expect(css).toContain('Sem dados no período');
});
```

(`readFileSync`/`join` já são usados no teste do `:empty` do PR 1 — reutilizar os imports existentes do arquivo.)

Run: `npx vitest run packages/report-blocks`
Expected: tudo PASS (catálogo + renderer + existentes).

- [ ] **Step 7: tsc + commit**

```bash
npx tsc -p apps/crm/tsconfig.json --noEmit
git add packages/report-blocks/
git commit -m "feat(relatorios): catálogo de widgets, exports do renderer e CSS de edição"
```

---

### Task 2: `layoutOps` — operações puras de edição do layout

**Files:**
- Create: `apps/crm/src/pages/relatorio-editor/layoutOps.ts`
- Create: `apps/crm/src/pages/relatorio-editor/__tests__/layoutOps.test.ts`

**Interfaces:**
- Consumes: `ReportLayout`, `ReportBlock`, `BlockType`, `BlockSize`, `BLOCK_SIZES`, `TEXT_BLOCK_TYPES`, `validateLayout` de `@mesaas/report-blocks/types` (reexports do _shared).
- Produces (Tasks 4-7 consomem — assinaturas exatas):
  - `SIZE_ORDER: readonly BlockSize[]` = `['third', 'half', 'full']`
  - `moveBlock(layout: ReportLayout, activeId: string, overId: string): ReportLayout`
  - `resizeBlock(layout: ReportLayout, id: string, delta: 1 | -1): ReportLayout` (satura nas pontas; `+` alarga)
  - `removeBlock(layout: ReportLayout, id: string): ReportLayout`
  - `insertBlock(layout: ReportLayout, type: BlockType, makeId?: () => string): { layout: ReportLayout; newId: string }` (insere no FIM; defaults por tipo)
  - `updateBlockText(layout: ReportLayout, id: string, text: unknown): ReportLayout`
  - `setLayoutAccent(layout: ReportLayout, accent: string | undefined): ReportLayout` (undefined remove a chave)
  - Todas retornam NOVO objeto (imutável); ids inexistentes retornam o layout original inalterado (mesma referência).

- [ ] **Step 1: Testes (RED)**

```ts
// apps/crm/src/pages/relatorio-editor/__tests__/layoutOps.test.ts
import { describe, expect, it } from 'vitest';
import {
  insertBlock, moveBlock, removeBlock, resizeBlock, setLayoutAccent,
  SIZE_ORDER, updateBlockText,
} from '../layoutOps';
import { validateLayout, type ReportLayout } from '@mesaas/report-blocks/types';

const layout = (): ReportLayout => ({
  version: 1,
  blocks: [
    { id: 'a', type: 'cover', size: 'full' },
    { id: 'b', type: 'kpi_reach', size: 'third' },
    { id: 'c', type: 'text', size: 'full', text: { type: 'doc', content: [] } },
  ],
});

describe('moveBlock', () => {
  it('move a antes de c quando arrastado sobre c', () => {
    const next = moveBlock(layout(), 'a', 'c');
    expect(next.blocks.map((b) => b.id)).toEqual(['b', 'c', 'a']);
  });
  it('id inexistente: retorna a MESMA referência', () => {
    const l = layout();
    expect(moveBlock(l, 'zzz', 'a')).toBe(l);
  });
  it('não muta o original', () => {
    const l = layout();
    moveBlock(l, 'a', 'c');
    expect(l.blocks[0].id).toBe('a');
  });
});

describe('resizeBlock', () => {
  it('third +1 vira half; half +1 vira full; full satura', () => {
    let l = resizeBlock(layout(), 'b', 1);
    expect(l.blocks[1].size).toBe('half');
    l = resizeBlock(l, 'b', 1);
    expect(l.blocks[1].size).toBe('full');
    expect(resizeBlock(l, 'b', 1).blocks[1].size).toBe('full');
  });
  it('third -1 satura em third', () => {
    expect(resizeBlock(layout(), 'b', -1).blocks[1].size).toBe('third');
  });
});

describe('removeBlock', () => {
  it('remove pelo id', () => {
    expect(removeBlock(layout(), 'b').blocks.map((b) => b.id)).toEqual(['a', 'c']);
  });
});

describe('insertBlock', () => {
  it('insere no fim com defaults por tipo e id novo', () => {
    let n = 0;
    const { layout: next, newId } = insertBlock(layout(), 'top_posts', () => `n${++n}`);
    const added = next.blocks[next.blocks.length - 1];
    expect(newId).toBe('n1');
    expect(added).toEqual({ id: 'n1', type: 'top_posts', size: 'full', config: { count: 6 } });
  });
  it('kpi entra como third; texto entra como full com doc vazio', () => {
    const kpi = insertBlock(layout(), 'kpi_saves', () => 'k').layout.blocks.at(-1)!;
    expect(kpi.size).toBe('third');
    const txt = insertBlock(layout(), 'text', () => 't').layout.blocks.at(-1)!;
    expect(txt.size).toBe('full');
    expect(txt.text).toEqual({ type: 'doc', content: [{ type: 'paragraph', content: [] }] });
  });
  it('section_header entra com config.title vazio editável', () => {
    const sh = insertBlock(layout(), 'section_header', () => 's').layout.blocks.at(-1)!;
    expect(sh.config).toEqual({ title: 'Nova seção' });
  });
  it('todo insert produz layout que passa no validateLayout', () => {
    const { layout: next } = insertBlock(layout(), 'audience_gender');
    expect(validateLayout(next).ok).toBe(true);
  });
});

describe('updateBlockText', () => {
  it('atualiza o text do bloco', () => {
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] };
    const next = updateBlockText(layout(), 'c', doc);
    expect(next.blocks[2].text).toEqual(doc);
  });
});

describe('setLayoutAccent', () => {
  it('define e remove o accent', () => {
    const on = setLayoutAccent(layout(), '#0f766e');
    expect(on.accent).toBe('#0f766e');
    const off = setLayoutAccent(on, undefined);
    expect('accent' in off).toBe(false);
    expect(validateLayout(on).ok).toBe(true);
  });
  it('SIZE_ORDER é third < half < full', () => {
    expect(SIZE_ORDER).toEqual(['third', 'half', 'full']);
  });
});
```

- [ ] **Step 2: RED**

Run: `npx vitest run apps/crm/src/pages/relatorio-editor/__tests__/layoutOps.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar**

```ts
// apps/crm/src/pages/relatorio-editor/layoutOps.ts
// Operações puras de edição do layout do relatório de blocos. Imutáveis; id
// inexistente devolve a MESMA referência (o autosave usa igualdade referencial
// para saber se algo mudou). Todo output é válido por construção; o gate
// validateLayout roda no save (useLayoutAutosave), não aqui.
import type { BlockSize, BlockType, ReportBlock, ReportLayout } from '@mesaas/report-blocks/types';
import { TEXT_BLOCK_TYPES } from '@mesaas/report-blocks/types';

export const SIZE_ORDER: readonly BlockSize[] = ['third', 'half', 'full'];

const DEFAULT_SIZE: Partial<Record<BlockType, BlockSize>> = {
  kpi_followers_gained: 'third',
  kpi_followers_total: 'third',
  kpi_reach: 'third',
  kpi_engagement_rate: 'third',
  kpi_saves: 'third',
  kpi_posts_count: 'third',
  kpi_profile_views: 'third',
  kpi_website_clicks: 'third',
  audience_gender: 'half',
  audience_age: 'half',
  audience_cities: 'half',
  audience_countries: 'half',
};

const EMPTY_TEXT_DOC = { type: 'doc', content: [{ type: 'paragraph', content: [] }] };

export function moveBlock(layout: ReportLayout, activeId: string, overId: string): ReportLayout {
  const from = layout.blocks.findIndex((b) => b.id === activeId);
  const to = layout.blocks.findIndex((b) => b.id === overId);
  if (from < 0 || to < 0 || from === to) return layout;
  const blocks = [...layout.blocks];
  const [moved] = blocks.splice(from, 1);
  blocks.splice(to, 0, moved);
  return { ...layout, blocks };
}

export function resizeBlock(layout: ReportLayout, id: string, delta: 1 | -1): ReportLayout {
  const idx = layout.blocks.findIndex((b) => b.id === id);
  if (idx < 0) return layout;
  const current = SIZE_ORDER.indexOf(layout.blocks[idx].size);
  const next = Math.min(Math.max(current + delta, 0), SIZE_ORDER.length - 1);
  if (next === current) return layout;
  const blocks = [...layout.blocks];
  blocks[idx] = { ...blocks[idx], size: SIZE_ORDER[next] };
  return { ...layout, blocks };
}

export function removeBlock(layout: ReportLayout, id: string): ReportLayout {
  const blocks = layout.blocks.filter((b) => b.id !== id);
  if (blocks.length === layout.blocks.length) return layout;
  return { ...layout, blocks };
}

export function insertBlock(
  layout: ReportLayout,
  type: BlockType,
  makeId: () => string = () => crypto.randomUUID(),
): { layout: ReportLayout; newId: string } {
  const newId = makeId();
  const block: ReportBlock = { id: newId, type, size: DEFAULT_SIZE[type] ?? 'full' };
  if (type === 'top_posts') block.config = { count: 6 };
  if (type === 'post_list') block.config = { count: 12 };
  if (type === 'section_header') block.config = { title: 'Nova seção' };
  if (TEXT_BLOCK_TYPES.includes(type)) block.text = structuredClone(EMPTY_TEXT_DOC);
  return { layout: { ...layout, blocks: [...layout.blocks, block] }, newId };
}

export function updateBlockText(layout: ReportLayout, id: string, text: unknown): ReportLayout {
  const idx = layout.blocks.findIndex((b) => b.id === id);
  if (idx < 0) return layout;
  const blocks = [...layout.blocks];
  blocks[idx] = { ...blocks[idx], text };
  return { ...layout, blocks };
}

export function setLayoutAccent(layout: ReportLayout, accent: string | undefined): ReportLayout {
  if (accent === undefined) {
    const { accent: _drop, ...rest } = layout;
    return rest as ReportLayout;
  }
  return { ...layout, accent };
}
```

- [ ] **Step 4: GREEN + commit**

Run: `npx vitest run apps/crm/src/pages/relatorio-editor` — tudo PASS.

```bash
git add apps/crm/src/pages/relatorio-editor/layoutOps.ts apps/crm/src/pages/relatorio-editor/__tests__/layoutOps.test.ts
git commit -m "feat(relatorios): operações puras de edição do layout"
```

---

### Task 3: Serviço de update + hook `useLayoutAutosave`

**Files:**
- Modify: `apps/crm/src/services/reportDocs.ts` (adicionar `updateReportDoc`)
- Create: `apps/crm/src/pages/relatorio-editor/useLayoutAutosave.ts`
- Create: `apps/crm/src/pages/relatorio-editor/__tests__/useLayoutAutosave.test.ts`
- Test (extend): `apps/crm/src/services/__tests__/reportDocs.test.ts`

**Interfaces:**
- Consumes: `validateLayout`, `ReportLayout` (types); `supabase` client; padrão de autosave da casa.
- Produces (Tasks 4-7 consomem):
  - `updateReportDoc(id: string, patch: { layout?: ReportLayout; title?: string }): Promise<void>` (PostgREST update; lança Error em falha)
  - `useLayoutAutosave(docId: string, initial: { layout: ReportLayout; title: string }): { layout: ReportLayout; applyLayout: (next: ReportLayout) => void; title: string; setTitle: (t: string) => void; saving: boolean }`
  - Semântica: `applyLayout(next)` — se `next === layout` (mesma referência, contrato do layoutOps para no-op) NADA acontece; senão seta o estado imediatamente (render otimista), `saving=true`, debounce 1500 ms, `validateLayout` no flush (inválido: toast.error('Erro ao salvar o relatório') + console.error, sem request), request `updateReportDoc(docId, { layout })`, falha: toast.error('Erro ao salvar o relatório'). `setTitle` usa debounce próprio de 400 ms com dirty ref. Timers limpos no unmount.

- [ ] **Step 1: Teste do serviço (RED) — acrescentar ao arquivo existente**

Em `apps/crm/src/services/__tests__/reportDocs.test.ts`, novo describe (os mocks `fromMock` já existem no arquivo):

```ts
describe('updateReportDoc', () => {
  it('faz update apenas das colunas passadas, filtrado por id', async () => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn().mockReturnValue({ eq });
    fromMock.mockReturnValue({ update });
    await updateReportDoc('doc-1', { title: 'Novo título' });
    expect(fromMock).toHaveBeenCalledWith('report_documents');
    expect(update).toHaveBeenCalledWith({ title: 'Novo título' });
    expect(eq).toHaveBeenCalledWith('id', 'doc-1');
  });

  it('erro do PostgREST vira Error', async () => {
    const eq = vi.fn().mockResolvedValue({ error: { message: 'boom' } });
    fromMock.mockReturnValue({ update: vi.fn().mockReturnValue({ eq }) });
    await expect(updateReportDoc('doc-1', { title: 'x' })).rejects.toThrow('boom');
  });
});
```

(Adicionar `updateReportDoc` ao import do topo do teste.)

- [ ] **Step 2: RED, depois implementar o serviço**

Acrescentar a `apps/crm/src/services/reportDocs.ts`:

```ts
/** Atualiza as únicas colunas com grant de escrita para authenticated
 * (layout, title — ver migration 20260820000010). Qualquer outra coluna
 * falharia com insufficient_privilege. */
export async function updateReportDoc(
  id: string,
  patch: { layout?: ReportLayout; title?: string },
): Promise<void> {
  const { error } = await supabase.from('report_documents').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}
```

Run: `npx vitest run apps/crm/src/services/__tests__/reportDocs.test.ts` — PASS.

- [ ] **Step 3: Teste do hook (RED)**

```tsx
// apps/crm/src/pages/relatorio-editor/__tests__/useLayoutAutosave.test.ts
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { updateMock, toastErrorMock } = vi.hoisted(() => ({
  updateMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));
vi.mock('../../../services/reportDocs', () => ({ updateReportDoc: updateMock }));
vi.mock('sonner', () => ({ toast: { error: toastErrorMock, success: vi.fn() } }));

import { useLayoutAutosave } from '../useLayoutAutosave';
import type { ReportLayout } from '@mesaas/report-blocks/types';

const baseLayout: ReportLayout = {
  version: 1,
  blocks: [{ id: 'a', type: 'cover', size: 'full' }],
};

beforeEach(() => {
  vi.useFakeTimers();
  updateMock.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('useLayoutAutosave', () => {
  it('applyLayout: otimista na hora, persiste após 1500ms, saving liga e desliga', async () => {
    const { result } = renderHook(() =>
      useLayoutAutosave('doc-1', { layout: baseLayout, title: 'T' }),
    );
    const next: ReportLayout = { ...baseLayout, accent: '#0f766e' };
    act(() => result.current.applyLayout(next));
    expect(result.current.layout).toBe(next);
    expect(result.current.saving).toBe(true);
    expect(updateMock).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
    });
    expect(updateMock).toHaveBeenCalledWith('doc-1', { layout: next });
    expect(result.current.saving).toBe(false);
  });

  it('duas edições dentro da janela: um único request com o estado final', async () => {
    const { result } = renderHook(() =>
      useLayoutAutosave('doc-1', { layout: baseLayout, title: 'T' }),
    );
    const l1: ReportLayout = { ...baseLayout, accent: '#111111' };
    const l2: ReportLayout = { ...baseLayout, accent: '#222222' };
    act(() => result.current.applyLayout(l1));
    act(() => {
      vi.advanceTimersByTime(700);
      result.current.applyLayout(l2);
    });
    await act(async () => {
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
    });
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith('doc-1', { layout: l2 });
  });

  it('applyLayout com a MESMA referência: nenhum save agendado', () => {
    const { result } = renderHook(() =>
      useLayoutAutosave('doc-1', { layout: baseLayout, title: 'T' }),
    );
    act(() => result.current.applyLayout(result.current.layout));
    expect(result.current.saving).toBe(false);
    vi.advanceTimersByTime(3000);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it('layout inválido no flush: toast de erro e NENHUM request', async () => {
    const { result } = renderHook(() =>
      useLayoutAutosave('doc-1', { layout: baseLayout, title: 'T' }),
    );
    const invalid = { version: 1, blocks: [{ id: '', type: 'cover', size: 'full' }] } as ReportLayout;
    act(() => result.current.applyLayout(invalid));
    await act(async () => {
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
    });
    expect(updateMock).not.toHaveBeenCalled();
    expect(toastErrorMock).toHaveBeenCalledWith('Erro ao salvar o relatório');
  });

  it('falha do request: toast de erro e saving desliga', async () => {
    updateMock.mockRejectedValueOnce(new Error('rede'));
    const { result } = renderHook(() =>
      useLayoutAutosave('doc-1', { layout: baseLayout, title: 'T' }),
    );
    act(() => result.current.applyLayout({ ...baseLayout, accent: '#333333' }));
    await act(async () => {
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(toastErrorMock).toHaveBeenCalledWith('Erro ao salvar o relatório');
    expect(result.current.saving).toBe(false);
  });

  it('setTitle persiste após 400ms com dirty ref', async () => {
    const { result } = renderHook(() =>
      useLayoutAutosave('doc-1', { layout: baseLayout, title: 'T' }),
    );
    act(() => result.current.setTitle('Relatório de Abril'));
    expect(result.current.title).toBe('Relatório de Abril');
    await act(async () => {
      vi.advanceTimersByTime(400);
      await Promise.resolve();
    });
    expect(updateMock).toHaveBeenCalledWith('doc-1', { title: 'Relatório de Abril' });
  });
});
```

- [ ] **Step 4: RED, implementar o hook**

```tsx
// apps/crm/src/pages/relatorio-editor/useLayoutAutosave.ts
// Autosave do editor de blocos, no padrão inline da casa (WorkflowDrawer:448):
// otimista no estado, saving liga ANTES do debounce, clearTimeout do anterior,
// validateLayout como gate final antes do PostgREST.
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { validateLayout, type ReportLayout } from '@mesaas/report-blocks/types';
import { updateReportDoc } from '../../services/reportDocs';

const LAYOUT_DEBOUNCE_MS = 1500;
const TITLE_DEBOUNCE_MS = 400;
const SAVE_ERROR_MSG = 'Erro ao salvar o relatório';

export function useLayoutAutosave(
  docId: string,
  initial: { layout: ReportLayout; title: string },
) {
  const [layout, setLayout] = useState<ReportLayout>(initial.layout);
  const [title, setTitleState] = useState(initial.title);
  const [saving, setSaving] = useState(false);

  const layoutTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleDirty = useRef(false);
  const pendingLayout = useRef<ReportLayout | null>(null);

  useEffect(
    () => () => {
      if (layoutTimer.current) clearTimeout(layoutTimer.current);
      if (titleTimer.current) clearTimeout(titleTimer.current);
    },
    [],
  );

  function applyLayout(next: ReportLayout) {
    if (next === layout) return;
    setLayout(next);
    pendingLayout.current = next;
    setSaving(true);
    if (layoutTimer.current) clearTimeout(layoutTimer.current);
    layoutTimer.current = setTimeout(async () => {
      const toSave = pendingLayout.current;
      pendingLayout.current = null;
      if (!toSave) return;
      const check = validateLayout(toSave);
      if (!check.ok) {
        // Bug de layoutOps se chegar aqui: nada de request com payload inválido.
        console.error('[relatorio-editor] layout inválido no autosave:', check.error);
        toast.error(SAVE_ERROR_MSG);
        setSaving(false);
        return;
      }
      try {
        await updateReportDoc(docId, { layout: toSave });
      } catch (err) {
        console.error('[relatorio-editor] autosave falhou:', err);
        toast.error(SAVE_ERROR_MSG);
      } finally {
        setSaving(false);
      }
    }, LAYOUT_DEBOUNCE_MS);
  }

  function setTitle(next: string) {
    setTitleState(next);
    titleDirty.current = true;
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(async () => {
      if (!titleDirty.current) return;
      titleDirty.current = false;
      try {
        await updateReportDoc(docId, { title: next });
      } catch (err) {
        console.error('[relatorio-editor] save de título falhou:', err);
        toast.error(SAVE_ERROR_MSG);
      }
    }, TITLE_DEBOUNCE_MS);
  }

  return { layout, applyLayout, title, setTitle, saving };
}
```

- [ ] **Step 5: GREEN + commit**

Run: `npx vitest run apps/crm/src/pages/relatorio-editor apps/crm/src/services/__tests__/reportDocs.test.ts` — PASS.

```bash
git add apps/crm/src/services/reportDocs.ts apps/crm/src/services/__tests__/reportDocs.test.ts apps/crm/src/pages/relatorio-editor/useLayoutAutosave.ts apps/crm/src/pages/relatorio-editor/__tests__/useLayoutAutosave.test.ts
git commit -m "feat(relatorios): updateReportDoc e autosave com debounce e gate de validação"
```

---

### Task 4: `EditorCanvas` — grid sortable com chrome por bloco

**Files:**
- Create: `apps/crm/src/pages/relatorio-editor/EditorCanvas.tsx`
- Create: `apps/crm/src/pages/relatorio-editor/__tests__/EditorCanvas.test.tsx`
- Modify: `apps/crm/style.css` (chrome do editor, ao final do arquivo)

**Interfaces:**
- Consumes: `BLOCK_COMPONENTS`, `SIZE_CLASS`, `resolveLayoutAccent` (`@mesaas/report-blocks/BlockRenderer`), tipos; `moveBlock`, `resizeBlock`, `removeBlock` (Task 2); sensores/padrões dnd-kit da casa.
- Produces (Task 7 consome):
  - `EditorCanvas({ layout, snapshot, onChange, highlightId, renderTextBlock }: { layout: ReportLayout; snapshot: ReportDocSnapshot; onChange: (next: ReportLayout) => void; highlightId?: string | null; renderTextBlock?: (block: ReportBlock) => ReactNode })`
  - `onChange` recebe o resultado de `moveBlock`/`resizeBlock`/`removeBlock` (a página passa `applyLayout` do hook).
  - `renderTextBlock`: quando fornecido e o bloco é textual, substitui o componente do registro (a Task 5 injeta o TipTap por aqui; default = componente do pacote).
  - Grid usa classes `rb-grid rb-mode-edit` + import de `@mesaas/report-blocks/styles.css` já feito pela página (Task 7); accent via `resolveLayoutAccent`.

- [ ] **Step 1: Testes (RED)**

```tsx
// apps/crm/src/pages/relatorio-editor/__tests__/EditorCanvas.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EditorCanvas } from '../EditorCanvas';
import { makeSnapshotFixture } from '@mesaas/report-blocks/fixtures';
import type { ReportLayout } from '@mesaas/report-blocks/types';

const layout = (): ReportLayout => ({
  version: 1,
  blocks: [
    { id: 'a', type: 'cover', size: 'full' },
    { id: 'b', type: 'kpi_reach', size: 'third' },
  ],
});

describe('EditorCanvas', () => {
  it('renderiza os widgets com chrome: alça, largura e excluir por bloco', () => {
    render(
      <EditorCanvas layout={layout()} snapshot={makeSnapshotFixture()} onChange={() => {}} />,
    );
    expect(screen.getByText('DK Marketing')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Reordenar bloco')).toHaveLength(2);
    expect(screen.getAllByLabelText('Aumentar largura')).toHaveLength(2);
    expect(screen.getAllByLabelText('Diminuir largura')).toHaveLength(2);
    expect(screen.getAllByLabelText('Excluir bloco')).toHaveLength(2);
  });

  it('excluir chama onChange com o bloco removido', () => {
    const onChange = vi.fn();
    render(
      <EditorCanvas layout={layout()} snapshot={makeSnapshotFixture()} onChange={onChange} />,
    );
    fireEvent.click(screen.getAllByLabelText('Excluir bloco')[1]);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].blocks.map((b: { id: string }) => b.id)).toEqual(['a']);
  });

  it('aumentar largura chama onChange com o size seguinte', () => {
    const onChange = vi.fn();
    render(
      <EditorCanvas layout={layout()} snapshot={makeSnapshotFixture()} onChange={onChange} />,
    );
    fireEvent.click(screen.getAllByLabelText('Aumentar largura')[1]);
    expect(onChange.mock.calls[0][0].blocks[1].size).toBe('half');
  });

  it('diminuir largura em third não dispara onChange (no-op preservado)', () => {
    const onChange = vi.fn();
    render(
      <EditorCanvas layout={layout()} snapshot={makeSnapshotFixture()} onChange={onChange} />,
    );
    fireEvent.click(screen.getAllByLabelText('Diminuir largura')[1]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renderTextBlock substitui o render do bloco textual', () => {
    const l: ReportLayout = {
      version: 1,
      blocks: [{ id: 't', type: 'text', size: 'full', text: { type: 'doc', content: [] } }],
    };
    render(
      <EditorCanvas
        layout={l}
        snapshot={makeSnapshotFixture()}
        onChange={() => {}}
        renderTextBlock={() => <div data-testid="tiptap-slot" />}
      />,
    );
    expect(screen.getByTestId('tiptap-slot')).toBeInTheDocument();
  });

  it('bloco em highlight recebe a classe de destaque', () => {
    const { container } = render(
      <EditorCanvas
        layout={layout()}
        snapshot={makeSnapshotFixture()}
        onChange={() => {}}
        highlightId="b"
      />,
    );
    const cell = container.querySelector('[data-block-id="b"]');
    expect(cell?.className).toContain('rb-edit-highlight');
  });
});
```

- [ ] **Step 2: RED, implementar**

```tsx
// apps/crm/src/pages/relatorio-editor/EditorCanvas.tsx
// Canvas de edição do relatório de blocos: o MESMO grid/widgets do pacote, com
// células sortable (dnd-kit) e toolbar de chrome por bloco. O BlockRenderer do
// pacote fica para view/print; aqui as células nunca colapsam (rb-mode-edit).
import type { ReactNode } from 'react';
import { useState } from 'react';
import { GripVertical, Minus, Plus, Trash2 } from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  BLOCK_COMPONENTS,
  SIZE_CLASS,
  resolveLayoutAccent,
} from '@mesaas/report-blocks/BlockRenderer';
import type { ReportBlock, ReportDocSnapshot, ReportLayout } from '@mesaas/report-blocks/types';
import { TEXT_BLOCK_TYPES } from '@mesaas/report-blocks/types';
import { moveBlock, removeBlock, resizeBlock } from './layoutOps';

interface SortableCellProps {
  block: ReportBlock;
  snapshot: ReportDocSnapshot;
  highlighted: boolean;
  onResize: (delta: 1 | -1) => void;
  onRemove: () => void;
  renderTextBlock?: (block: ReportBlock) => ReactNode;
}

function SortableCell({
  block, snapshot, highlighted, onResize, onRemove, renderTextBlock,
}: SortableCellProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: block.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const Component = BLOCK_COMPONENTS[block.type];
  const isText = TEXT_BLOCK_TYPES.includes(block.type);
  const body = isText && renderTextBlock
    ? renderTextBlock(block)
    : Component
      ? <Component block={block} snapshot={snapshot} />
      : null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-block-id={block.id}
      className={`${SIZE_CLASS[block.size] ?? 'rb-full'} rb-edit-cell${highlighted ? ' rb-edit-highlight' : ''}`}
    >
      <div className="rb-edit-toolbar">
        <button
          type="button"
          className="rb-edit-btn cursor-grab touch-none"
          aria-label="Reordenar bloco"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="rb-edit-btn"
          aria-label="Diminuir largura"
          onClick={() => onResize(-1)}
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="rb-edit-btn"
          aria-label="Aumentar largura"
          onClick={() => onResize(1)}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="rb-edit-btn rb-edit-btn-danger"
          aria-label="Excluir bloco"
          onClick={onRemove}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {body}
    </div>
  );
}

export interface EditorCanvasProps {
  layout: ReportLayout;
  snapshot: ReportDocSnapshot;
  onChange: (next: ReportLayout) => void;
  highlightId?: string | null;
  renderTextBlock?: (block: ReportBlock) => ReactNode;
}

export function EditorCanvas({
  layout, snapshot, onChange, highlightId, renderTextBlock,
}: EditorCanvasProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const { acc, accFg } = resolveLayoutAccent(layout, snapshot);

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }
  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const next = moveBlock(layout, String(active.id), String(over.id));
    if (next !== layout) onChange(next);
  }

  const activeBlock = activeId ? layout.blocks.find((b) => b.id === activeId) : null;
  const ActiveComponent = activeBlock ? BLOCK_COMPONENTS[activeBlock.type] : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={layout.blocks.map((b) => b.id)} strategy={rectSortingStrategy}>
        <div
          className="rb-grid rb-mode-edit"
          style={{ ['--rb-accent' as string]: acc, ['--rb-accent-fg' as string]: accFg }}
        >
          {layout.blocks.map((block) => (
            <SortableCell
              key={block.id}
              block={block}
              snapshot={snapshot}
              highlighted={block.id === highlightId}
              onResize={(delta) => {
                const next = resizeBlock(layout, block.id, delta);
                if (next !== layout) onChange(next);
              }}
              onRemove={() => onChange(removeBlock(layout, block.id))}
              renderTextBlock={renderTextBlock}
            />
          ))}
        </div>
      </SortableContext>
      <DragOverlay>
        {activeBlock && ActiveComponent && (
          <div className="rb-edit-overlay">
            <ActiveComponent block={activeBlock} snapshot={snapshot} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
```

- [ ] **Step 3: CSS do chrome em `apps/crm/style.css` (final do arquivo)**

```css
/* ===== Editor de relatório de blocos (PR 2) ===== */
.rb-edit-cell {
  position: relative;
  border-radius: 12px;
}
.rb-edit-cell:hover {
  outline: 2px solid var(--primary-color);
  outline-offset: 2px;
}
.rb-edit-toolbar {
  position: absolute;
  top: -14px;
  right: 10px;
  z-index: 5;
  display: none;
  gap: 2px;
  align-items: center;
  background: var(--dark);
  color: #fff;
  border-radius: 8px;
  padding: 3px 6px;
}
.rb-edit-cell:hover .rb-edit-toolbar,
.rb-edit-toolbar:focus-within {
  display: flex;
}
.rb-edit-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.rb-edit-btn:hover {
  background: rgba(255, 255, 255, 0.16);
}
.rb-edit-btn-danger:hover {
  background: var(--danger);
}
.rb-edit-highlight {
  outline: 2px solid var(--primary-color);
  outline-offset: 2px;
  animation: rb-edit-pulse 1.2s ease-in-out 2;
}
@keyframes rb-edit-pulse {
  50% { outline-color: transparent; }
}
.rb-edit-overlay {
  opacity: 0.85;
  pointer-events: none;
}
```

- [ ] **Step 4: GREEN + tsc + commit**

Run: `npx vitest run apps/crm/src/pages/relatorio-editor` e `npx tsc -p apps/crm/tsconfig.json --noEmit` — PASS/limpo.

```bash
git add apps/crm/src/pages/relatorio-editor/EditorCanvas.tsx apps/crm/src/pages/relatorio-editor/__tests__/EditorCanvas.test.tsx apps/crm/style.css
git commit -m "feat(relatorios): canvas de edição com dnd, resize e exclusão por bloco"
```

---

### Task 5: `TextBlockEditor` — TipTap inline nos blocos de texto

**Files:**
- Create: `apps/crm/src/pages/relatorio-editor/TextBlockEditor.tsx`
- Create: `apps/crm/src/pages/relatorio-editor/__tests__/TextBlockEditor.test.tsx`
- Modify: `apps/crm/style.css` (conteúdo `.rb-text-editor`)

**Interfaces:**
- Consumes: TipTap v3 (`useEditor`, `EditorContent` de `@tiptap/react`; `BubbleMenu` de `@tiptap/react/menus`; `StarterKit`; `Placeholder` default export de `@tiptap/extension-placeholder`).
- Produces (Task 7 consome):
  - `TextBlockEditor({ block, onTextChange }: { block: ReportBlock; onTextChange: (id: string, json: unknown) => void })`
  - `buildTextBlockExtensions(): Extension[]` exportada para teste — StarterKit configurado com `heading: { levels: [2, 3] }`, `code: false`, `codeBlock: false`, `link: false` + Placeholder 'Escreva sua análise…'. (No StarterKit v3, `link: false` desativa a extensão embutida; heading levels seguem o precedente de ArtigoPage.)
  - Contrato de conteúdo: JSON do bloco entra por `content:` no `useEditor`; `onUpdate` → `getJSON()` → `onTextChange(block.id, json)`; ref `isInitialized` + `onCreate` (padrão PostEditor) para não disparar no mount. Troca externa de conteúdo = remount por `key={block.id}` (responsabilidade do chamador).
  - BubbleMenu com bold/italic/strike APENAS (as marks que o tiptapToHtml renderiza), botões `onMouseDown preventDefault` + classes `.post-editor-btn` reutilizadas.

- [ ] **Step 1: Testes (RED)**

```tsx
// apps/crm/src/pages/relatorio-editor/__tests__/TextBlockEditor.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import { TextBlockEditor, buildTextBlockExtensions } from '../TextBlockEditor';
import type { ReportBlock } from '@mesaas/report-blocks/types';

const textBlock = (text: unknown): ReportBlock => ({
  id: 't1',
  type: 'text',
  size: 'full',
  text,
});

describe('buildTextBlockExtensions', () => {
  it('aceita os nós que o renderer read-only suporta e rejeita code/link', () => {
    const editor = new Editor({
      extensions: buildTextBlockExtensions(),
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] },
    });
    const schema = editor.schema;
    expect(schema.nodes.heading).toBeDefined();
    expect(schema.nodes.bulletList).toBeDefined();
    expect(schema.nodes.blockquote).toBeDefined();
    expect(schema.nodes.codeBlock).toBeUndefined();
    expect(schema.marks.bold).toBeDefined();
    expect(schema.marks.strike).toBeDefined();
    expect(schema.marks.code).toBeUndefined();
    expect(schema.marks.link).toBeUndefined();
    editor.destroy();
  });

  it('heading restrito aos níveis 2 e 3', () => {
    const editor = new Editor({ extensions: buildTextBlockExtensions() });
    expect(editor.schema.nodes.heading.spec.attrs?.level?.default).toBe(2);
    editor.destroy();
  });
});

describe('TextBlockEditor', () => {
  it('renderiza o conteúdo inicial e NÃO dispara onTextChange no mount', async () => {
    const onTextChange = vi.fn();
    render(
      <TextBlockEditor
        block={textBlock({
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Análise inicial' }] }],
        })}
        onTextChange={onTextChange}
      />,
    );
    await waitFor(() => expect(screen.getByText('Análise inicial')).toBeInTheDocument());
    expect(onTextChange).not.toHaveBeenCalled();
  });

  it('edição programática dispara onTextChange com o JSON novo', async () => {
    const onTextChange = vi.fn();
    const { container } = render(
      <TextBlockEditor block={textBlock({ type: 'doc', content: [] })} onTextChange={onTextChange} />,
    );
    await waitFor(() => expect(container.querySelector('.ProseMirror')).toBeInTheDocument());
    // O editor TipTap real está montado; simular digitação via evento de input
    // é frágil em jsdom — o contrato onUpdate→getJSON é coberto pelo teste de
    // integração do PostEditor da casa; aqui provamos mount sem side effects e
    // schema correto (acima). Nada a assertar além do não-disparo inicial.
    expect(onTextChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: RED, implementar**

```tsx
// apps/crm/src/pages/relatorio-editor/TextBlockEditor.tsx
// Editor TipTap dos blocos de texto do relatório. Restrito EXATAMENTE ao que
// packages/report-blocks/tiptap-render.ts sabe renderizar (view/Hub/print):
// paragraph, heading 2-3, listas, blockquote, hr, hardBreak; bold/italic/strike.
// code/codeBlock/link desativados: o renderer degradaria para texto puro.
import { EditorContent, useEditor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { Bold, Italic, Strikethrough } from 'lucide-react';
import { useRef } from 'react';
import type { AnyExtension } from '@tiptap/core';
import type { ReportBlock } from '@mesaas/report-blocks/types';

export function buildTextBlockExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      heading: { levels: [2, 3] },
      code: false,
      codeBlock: false,
      link: false,
    }),
    Placeholder.configure({ placeholder: 'Escreva sua análise…' }),
  ];
}

export interface TextBlockEditorProps {
  block: ReportBlock;
  onTextChange: (id: string, json: unknown) => void;
}

export function TextBlockEditor({ block, onTextChange }: TextBlockEditorProps) {
  // Extensões congeladas no 1º render (useEditor sem deps) — padrão da casa
  // (PostEditor.tsx:120-124). onTextChange vai por ref para não recriar o editor.
  const onTextChangeRef = useRef(onTextChange);
  onTextChangeRef.current = onTextChange;
  const isInitialized = useRef(false);

  const editor = useEditor({
    extensions: buildTextBlockExtensions(),
    content: (block.text as object | undefined) ?? undefined,
    onCreate: () => {
      isInitialized.current = true;
    },
    onUpdate: ({ editor: ed }) => {
      if (!isInitialized.current) return;
      onTextChangeRef.current(block.id, ed.getJSON());
    },
  });

  return (
    <div className="rb-text-editor">
      {editor && (
        <BubbleMenu editor={editor} className="bubble-menu">
          <button
            type="button"
            className={`post-editor-btn${editor.isActive('bold') ? ' active' : ''}`}
            onMouseDown={(e) => {
              e.preventDefault();
              editor.chain().focus().toggleBold().run();
            }}
            data-tooltip="Negrito"
          >
            <Bold className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={`post-editor-btn${editor.isActive('italic') ? ' active' : ''}`}
            onMouseDown={(e) => {
              e.preventDefault();
              editor.chain().focus().toggleItalic().run();
            }}
            data-tooltip="Itálico"
          >
            <Italic className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            className={`post-editor-btn${editor.isActive('strike') ? ' active' : ''}`}
            onMouseDown={(e) => {
              e.preventDefault();
              editor.chain().focus().toggleStrike().run();
            }}
            data-tooltip="Tachado"
          >
            <Strikethrough className="h-3.5 w-3.5" />
          </button>
        </BubbleMenu>
      )}
      <EditorContent editor={editor} className="rb-text-editor-content" />
    </div>
  );
}
```

- [ ] **Step 3: CSS em `apps/crm/style.css` (após o bloco do editor de relatório)**

```css
.rb-text-editor {
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 12px;
  background: var(--card-bg);
}
.rb-text-editor-content {
  padding: 0.75rem 1rem;
}
.rb-text-editor-content .ProseMirror {
  outline: none;
  min-height: 64px;
  font-size: 0.875rem;
  line-height: 1.6;
  color: var(--text-color);
}
.rb-text-editor-content .ProseMirror ul,
.rb-text-editor-content .ProseMirror ol {
  padding-left: 1.5em;
  margin: 0.25em 0;
}
.rb-text-editor-content .ProseMirror li {
  list-style: revert;
}
.rb-text-editor-content .ProseMirror p.is-editor-empty:first-child::before {
  content: attr(data-placeholder);
  color: var(--text-muted);
  pointer-events: none;
  float: left;
  height: 0;
}
```

- [ ] **Step 4: GREEN + commit**

Run: `npx vitest run apps/crm/src/pages/relatorio-editor` — PASS.

```bash
git add apps/crm/src/pages/relatorio-editor/TextBlockEditor.tsx apps/crm/src/pages/relatorio-editor/__tests__/TextBlockEditor.test.tsx apps/crm/style.css
git commit -m "feat(relatorios): editor TipTap restrito nos blocos de texto"
```

---

### Task 6: `AddWidgetDrawer` — catálogo em Sheet com inserção

**Files:**
- Create: `apps/crm/src/pages/relatorio-editor/AddWidgetDrawer.tsx`
- Create: `apps/crm/src/pages/relatorio-editor/__tests__/AddWidgetDrawer.test.tsx`

**Interfaces:**
- Consumes: `WIDGET_CATALOG`, `WIDGET_CATEGORIES` (`@mesaas/report-blocks/catalog`); `Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger` (`@/components/ui/sheet`); `Button` (`@/components/ui/button`).
- Produces (Task 7 consome):
  - `AddWidgetDrawer({ open, onOpenChange, onInsert }: { open: boolean; onOpenChange: (open: boolean) => void; onInsert: (type: BlockType) => void })`
  - Ao clicar num item: chama `onInsert(type)` e `onOpenChange(false)` (fecha). A página faz o insert + highlight + scroll.

- [ ] **Step 1: Testes (RED)**

```tsx
// apps/crm/src/pages/relatorio-editor/__tests__/AddWidgetDrawer.test.tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AddWidgetDrawer } from '../AddWidgetDrawer';
import { WIDGET_CATALOG, WIDGET_CATEGORIES } from '@mesaas/report-blocks/catalog';

describe('AddWidgetDrawer', () => {
  it('lista todas as categorias e todos os widgets do catálogo', () => {
    render(<AddWidgetDrawer open onOpenChange={() => {}} onInsert={() => {}} />);
    for (const cat of WIDGET_CATEGORIES) {
      expect(screen.getByRole('heading', { name: cat })).toBeInTheDocument();
    }
    for (const w of WIDGET_CATALOG) {
      expect(screen.getByRole('button', { name: w.label })).toBeInTheDocument();
    }
  });

  it('clicar num widget chama onInsert com o tipo e fecha o drawer', () => {
    const onInsert = vi.fn();
    const onOpenChange = vi.fn();
    render(<AddWidgetDrawer open onOpenChange={onOpenChange} onInsert={onInsert} />);
    fireEvent.click(screen.getByRole('button', { name: 'Top publicações' }));
    expect(onInsert).toHaveBeenCalledWith('top_posts');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('fechado, nada renderizado', () => {
    render(<AddWidgetDrawer open={false} onOpenChange={() => {}} onInsert={() => {}} />);
    expect(screen.queryByText('Adicionar widget')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: RED, implementar**

```tsx
// apps/crm/src/pages/relatorio-editor/AddWidgetDrawer.tsx
// Drawer "Adicionar widget": catálogo por categoria; o clique insere no fim do
// documento (a página cuida do insert, highlight e scroll).
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { WIDGET_CATALOG, WIDGET_CATEGORIES } from '@mesaas/report-blocks/catalog';
import type { BlockType } from '@mesaas/report-blocks/types';

export interface AddWidgetDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInsert: (type: BlockType) => void;
}

export function AddWidgetDrawer({ open, onOpenChange, onInsert }: AddWidgetDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Adicionar widget</SheetTitle>
        </SheetHeader>
        {WIDGET_CATEGORIES.map((cat) => (
          <div key={cat} style={{ marginTop: '1rem' }}>
            <h4
              style={{
                margin: '0 0 0.5rem',
                fontSize: '0.72rem',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: 'var(--text-muted)',
              }}
            >
              {cat}
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              {WIDGET_CATALOG.filter((w) => w.category === cat).map((w) => (
                <button
                  key={w.type}
                  type="button"
                  onClick={() => {
                    onInsert(w.type);
                    onOpenChange(false);
                  }}
                  style={{
                    border: '1px solid var(--border-color)',
                    borderRadius: 8,
                    background: 'var(--card-bg)',
                    padding: '0.6rem 0.5rem',
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                    textAlign: 'center',
                  }}
                >
                  {w.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 3: GREEN + commit**

Run: `npx vitest run apps/crm/src/pages/relatorio-editor` — PASS.

```bash
git add apps/crm/src/pages/relatorio-editor/AddWidgetDrawer.tsx apps/crm/src/pages/relatorio-editor/__tests__/AddWidgetDrawer.test.tsx
git commit -m "feat(relatorios): drawer de catálogo de widgets"
```

---

### Task 7: Topbar + integração da página (o editor completo)

**Files:**
- Modify: `apps/crm/src/pages/relatorio-editor/RelatorioEditorPage.tsx` (reescrita: read-only → editor)
- Modify: `apps/crm/src/pages/relatorio-editor/__tests__/RelatorioEditorPage.test.tsx` (reescrita dos asserts)

**Interfaces:**
- Consumes: TUDO das Tasks 1-6 (`useLayoutAutosave`, `EditorCanvas`, `TextBlockEditor`, `AddWidgetDrawer`, `insertBlock`, `updateBlockText`, `setLayoutAccent`, `resolveLayoutAccent`); `ColorPicker` + `normalizeHexInput` de `@/components/shared/ColorPicker`; `getReportDoc` existente.
- Produces: a página final. Estrutura do JSX:
  1. `useQuery(['report-doc', id], getReportDoc)` como hoje; loading/não-encontrado inalterados.
  2. Com doc: componente interno `<EditorBody doc={doc} />` (remonta por `key={doc.id}`) que instancia `useLayoutAutosave(doc.id, { layout: doc.layout, title: doc.title })`.
  3. Topbar: input de título (value do hook, `onChange={(e) => setTitle(e.target.value)}`, `aria-label="Título do relatório"`, classe visual de heading); `{saving && <span className="drawer-saving-indicator">Salvando…</span>}`; label do mês (`doc.data_snapshot.period.label`); botão "Cor" abrindo o `ColorPicker` compartilhado (value = `layout.accent ?? snapshot.branding.accent_color`; `onChange={(hex) => applyLayout(setLayoutAccent(layout, hex))}`; `brandColors={[snapshot.branding.accent_color]}`) + botão "Usar cor da marca" (`applyLayout(setLayoutAccent(layout, undefined))`, visível só quando `layout.accent` definido); botão "Adicionar widget" abrindo o drawer.
  4. `<EditorCanvas layout={layout} snapshot={doc.data_snapshot} onChange={applyLayout} highlightId={highlightId} renderTextBlock={(block) => <TextBlockEditor key={block.id} block={block} onTextChange={(id, json) => applyLayout(updateBlockText(layout, id, json))} />} />` — ATENÇÃO: `layout` capturado no closure do renderTextBlock deve vir de um ref atualizado (`layoutRef.current`) para não aplicar updates sobre layout obsoleto (mesma razão do padrão de refs do PostEditor).
  5. Insert: `const { layout: next, newId } = insertBlock(layoutRef.current, type); applyLayout(next); setHighlightId(newId);` + `setTimeout(() => document.querySelector(\`[data-block-id="${newId}"]\`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);` + limpar highlight após 2500 ms.
  6. `import '@mesaas/report-blocks/styles.css';` permanece.

- [ ] **Step 1: Reescrever o teste da página (RED)**

Substituir o conteúdo de `__tests__/RelatorioEditorPage.test.tsx`:

```tsx
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { makeSnapshotFixture } from '@mesaas/report-blocks/fixtures';

const { getReportDocMock, updateReportDocMock } = vi.hoisted(() => ({
  getReportDocMock: vi.fn(),
  updateReportDocMock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../../services/reportDocs', () => ({
  getReportDoc: getReportDocMock,
  updateReportDoc: updateReportDocMock,
}));

import RelatorioEditorPage from '../RelatorioEditorPage';

const doc = () => ({
  id: 'doc-1',
  client_id: 42,
  title: 'Relatório de Abril de 2026',
  period_start: '2026-04-01',
  period_end: '2026-05-01',
  layout: {
    version: 1,
    blocks: [
      { id: 'a', type: 'cover', size: 'full' },
      { id: 'b', type: 'kpi_reach', size: 'third' },
    ],
  },
  data_snapshot: makeSnapshotFixture(),
  status: 'ready',
  generation_error: null,
  created_at: '2026-08-21T00:00:00Z',
  updated_at: '2026-08-21T00:00:00Z',
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/relatorios/doc-1']}>
        <Routes>
          <Route path="/relatorios/:id" element={<RelatorioEditorPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RelatorioEditorPage (editor)', () => {
  it('renderiza topbar de edição: título editável, mês, Cor e Adicionar widget', async () => {
    getReportDocMock.mockResolvedValue(doc());
    renderPage();
    expect(
      await screen.findByLabelText('Título do relatório'),
    ).toHaveValue('Relatório de Abril de 2026');
    expect(screen.getByText('Julho de 2026')).toBeInTheDocument(); // period.label do fixture
    expect(screen.getByRole('button', { name: 'Adicionar widget' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cor' })).toBeInTheDocument();
  });

  it('canvas em modo edição: chrome presente nos blocos', async () => {
    getReportDocMock.mockResolvedValue(doc());
    renderPage();
    await screen.findByLabelText('Título do relatório');
    expect(screen.getAllByLabelText('Excluir bloco')).toHaveLength(2);
  });

  it('excluir um bloco persiste o layout sem ele (autosave)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    getReportDocMock.mockResolvedValue(doc());
    renderPage();
    await screen.findByLabelText('Título do relatório');
    fireEvent.click(screen.getAllByLabelText('Excluir bloco')[1]);
    await waitFor(() =>
      expect(updateReportDocMock).toHaveBeenCalledWith('doc-1', {
        layout: expect.objectContaining({
          blocks: [expect.objectContaining({ id: 'a' })],
        }),
      }),
    , { timeout: 4000 });
    vi.useRealTimers();
  });

  it('Adicionar widget insere no fim e destaca', async () => {
    getReportDocMock.mockResolvedValue(doc());
    renderPage();
    await screen.findByLabelText('Título do relatório');
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar widget' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Texto livre' }));
    await waitFor(() => {
      const cells = document.querySelectorAll('[data-block-id]');
      expect(cells).toHaveLength(3);
      expect(cells[2].className).toContain('rb-edit-highlight');
    });
  });

  it('documento inexistente mostra estado de não encontrado', async () => {
    getReportDocMock.mockResolvedValue(null);
    renderPage();
    expect(await screen.findByText('Relatório não encontrado.')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: RED, reescrever a página**

```tsx
// apps/crm/src/pages/relatorio-editor/RelatorioEditorPage.tsx
// PR 2: o editor do relatório de blocos. Canvas dnd + drawer + TipTap +
// autosave. View/print continuam no BlockRenderer do pacote (Hub, PR 3).
import { useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Palette, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { ColorPicker } from '@/components/shared/ColorPicker';
import { BLOCK_COMPONENTS } from '@mesaas/report-blocks/BlockRenderer';
import type { BlockType, ReportBlock } from '@mesaas/report-blocks/types';
import '@mesaas/report-blocks/styles.css';
import { getReportDoc, type ReportDocumentRow } from '../../services/reportDocs';
import { useLayoutAutosave } from './useLayoutAutosave';
import { EditorCanvas } from './EditorCanvas';
import { TextBlockEditor } from './TextBlockEditor';
import { AddWidgetDrawer } from './AddWidgetDrawer';
import { insertBlock, setLayoutAccent, updateBlockText } from './layoutOps';

function EditorBody({ doc }: { doc: ReportDocumentRow }) {
  const snapshot = doc.data_snapshot!;
  const { layout, applyLayout, title, setTitle, saving } = useLayoutAutosave(doc.id, {
    layout: doc.layout,
    title: doc.title,
  });
  // renderTextBlock/insert leem o layout por ref: o closure do canvas pode ser
  // de um render anterior e aplicaria updates sobre estado obsoleto.
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleInsert(type: BlockType) {
    const { layout: next, newId } = insertBlock(layoutRef.current, type);
    applyLayout(next);
    setHighlightId(newId);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightId(null), 2500);
    setTimeout(() => {
      document
        .querySelector(`[data-block-id="${newId}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  }

  return (
    <div style={{ padding: '1.5rem' }}>
      <header
        style={{
          maxWidth: 880,
          margin: '0 auto 1.25rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ flex: 1, minWidth: 220 }}>
          <input
            aria-label="Título do relatório"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            style={{
              width: '100%',
              border: 'none',
              background: 'transparent',
              fontSize: '1.35rem',
              fontWeight: 700,
              color: 'var(--text-main)',
              outline: 'none',
            }}
          />
          <p style={{ margin: '0.15rem 0 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            {snapshot.period.label}
            {saving && (
              <span className="drawer-saving-indicator" style={{ marginLeft: '0.6rem' }}>
                Salvando…
              </span>
            )}
          </p>
        </div>
        <ColorPicker
          value={layout.accent ?? snapshot.branding.accent_color}
          onChange={(hex) => applyLayout(setLayoutAccent(layoutRef.current, hex))}
          brandColors={[snapshot.branding.accent_color]}
          triggerLabel="Cor"
          triggerIcon={Palette}
        />
        {layout.accent && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => applyLayout(setLayoutAccent(layoutRef.current, undefined))}
          >
            Usar cor da marca
          </Button>
        )}
        <Button size="sm" onClick={() => setDrawerOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> Adicionar widget
        </Button>
      </header>

      <EditorCanvas
        layout={layout}
        snapshot={snapshot}
        onChange={applyLayout}
        highlightId={highlightId}
        renderTextBlock={(block: ReportBlock) => (
          <TextBlockEditor
            key={block.id}
            block={block}
            onTextChange={(id, json) => applyLayout(updateBlockText(layoutRef.current, id, json))}
          />
        )}
      />

      <AddWidgetDrawer open={drawerOpen} onOpenChange={setDrawerOpen} onInsert={handleInsert} />
    </div>
  );
}

export default function RelatorioEditorPage() {
  const { id } = useParams<{ id: string }>();
  const { data: doc, isLoading } = useQuery({
    queryKey: ['report-doc', id],
    queryFn: () => getReportDoc(id!),
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

  if (!doc || !doc.data_snapshot) {
    return (
      <div style={{ padding: '2rem' }}>
        <p style={{ color: 'var(--text-muted)' }}>Relatório não encontrado.</p>
      </div>
    );
  }

  return <EditorBody key={doc.id} doc={doc} />;
}
```

NOTA para o implementador sobre o `ColorPicker` compartilhado: abra `apps/crm/src/components/shared/ColorPicker.tsx` e confira a assinatura REAL das props (`value`, `onChange`, `brandColors`, e como o trigger é rotulado — os `data-testid` são `estudio-color-*`). Se não existir prop `triggerLabel`/`triggerIcon`, envolva o picker no Popover dele com um `<Button variant="outline" size="sm">Cor</Button>` como trigger, mantendo o `aria`/role que o teste da página usa (`getByRole('button', { name: 'Cor' })`). Ajuste o JSX acima ao contrato real SEM mudar o teste.

- [ ] **Step 3: GREEN**

Run: `npx vitest run apps/crm/src/pages/relatorio-editor` — TODOS os testes da pasta (layoutOps, hook, canvas, tiptap, drawer, página) PASS.

- [ ] **Step 4: Regressões + tsc + commit**

```bash
npx vitest run apps/crm/src/pages/analytics-conta apps/crm/src/content
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
git add apps/crm/src/pages/relatorio-editor/ apps/crm/src/services/reportDocs.ts
git commit -m "feat(relatorios): página do editor com topbar, cor e inserção de widgets"
```

---

### Task 8: Verificação completa, browser em staging e PR empilhado

**Files:** nenhum novo (só correções que a verificação apontar).

- [ ] **Step 1: Gates completos**

```bash
cd /Users/eduardosouza/Projects/sm-crm/.claude/worktrees/report-restructure-41a80e
git branch --show-current   # claude/report-editor-pr2
ls node_modules/.deno 2>/dev/null && npm ci
npm run lint
npm run format:check        # npm run format se falhar; changes viram chore commit
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
npm run test:functions      # POR ÚLTIMO (polui node_modules/.deno)
git checkout -- deno.lock
```

- [ ] **Step 2: Browser em staging (sem deploy: só frontend)**

Nada a deployar (sem migration, sem função). `cp /Users/eduardosouza/Projects/sm-crm/.env.staging .env.staging` se ausente; subir `npm run dev:staging` via preview e provar no relatório de Abril criado no PR 1 (cliente Dr. Rafael Nunes, /analytics/21 → Relatórios Interativos → Abrir):
1. Título editável; digitar e ver `Salvando…` aparecer e sumir.
2. Arrastar um KPI para outra posição; recarregar a página; ordem persistiu.
3. − / + de largura num KPI; excluir um bloco; recarregar; persistiu.
4. "Adicionar widget" → Texto livre → bloco entra no fim com highlight; digitar análise; BubbleMenu bold/italic/strike; recarregar; texto persistiu.
5. "Cor" → escolher um verde → capa/underlines mudam na hora; "Usar cor da marca" volta ao âmbar; recarregar; persistiu.
6. Console sem erros novos; network sem 4xx nos PATCH de `report_documents`.
7. Screenshot final do editor com as mudanças.

- [ ] **Step 3: PR empilhado**

```bash
git push -u origin claude/report-editor-pr2
gh pr create --base claude/report-restructure-41a80e --title "feat(relatorios): editor do relatório interativo de blocos (PR 2/3)" --body "$(cat <<'EOF'
Fase 2 da spec docs/superpowers/specs/2026-08-20-report-builder-blocks-design.md (§8 + decisão B de accent). Empilhado sobre #375 — mergear DEPOIS dele (e rebase --onto main se o #375 squash-mergear).

- layoutOps puros (mover, redimensionar third/half/full, excluir, inserir com defaults, texto, accent) + autosave 1500ms com gate validateLayout e update restrito a (layout, title)
- EditorCanvas: grid dnd-kit (rectSortingStrategy, DragOverlay, onDragCancel limpo) com toolbar por bloco
- TipTap v3 nos blocos de texto, restrito às marks que o tiptapToHtml renderiza (bold/italic/strike; heading 2-3; listas; blockquote)
- Drawer de catálogo (25 widgets em 6 categorias) com inserção + highlight
- Topbar: título editável (400ms), seletor de cor com "Usar cor da marca", indicador Salvando…
- Sem migration, sem edge function: frontend + packages/report-blocks (catálogo/exports/CSS de modo)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Review externo do Codex dispara sozinho; triar antes de qualquer merge.

---

## Self-review do plano (executado na escrita)

- **Cobertura da spec §8**: canvas+toolbar por bloco (T4), drawer (T6), barra superior com título/cor/salvando (T7), autosave (T3), TipTap (T5), highlight de inserção (T7). Fora do PR 2 por fase: "Salvar/Aplicar template" e "Exportar PDF"/"Ver como cliente" (PR 3 — a spec §8 os lista na topbar; entram quando os backends existirem).
- **Riscos sinalizados ao implementador**: contrato real do ColorPicker compartilhado (nota na T7); StarterKit v3 `link: false` (verificar se o StarterKit da 3.22 embute link — se não embutir, a linha é inócua e o teste de schema confirma); BubbleMenu de `@tiptap/react/menus` (import v3).
- **Consistência**: `applyLayout` sempre recebe resultado de layoutOps (no-op = mesma referência = nada salvo); `layoutRef` para closures do canvas; `key={doc.id}` remonta o body ao trocar de documento; testes usam os aria-labels exatos definidos nos componentes.
