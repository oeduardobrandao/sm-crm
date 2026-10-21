# Pré-requisitos de "Posts individuais no quadro de Fluxos". Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir, em quatro PRs independentes, os quatro defeitos do quadro de Fluxos que a spec `docs/superpowers/specs/2026-09-10-posts-individuais-fluxos-design.md` (§2, "Pré-requisitos") exige resolvidos antes da feature: colunas chaveadas por nome, renumeração de posição sobre a coluna filtrada, deep link `?drawer=` sem fallback e gate do quadro de exemplo só por fluxos.

**Architecture:** Cada PR extrai a lógica corrigida para um módulo puro com testes Vitest e liga o módulo no componente existente com a menor mudança possível. O PR 2 acrescenta uma RPC `SECURITY DEFINER` no padrão de `reorder_board_posts` e uma suíte SQL em `supabase/tests/entitlements`. Nenhum PR muda contrato de URL, cópia visível ao usuário (fora dos toasts novos) ou comportamento das RPCs existentes.

**Tech Stack:** React 19, TypeScript, Vitest + Testing Library (jsdom), dnd-kit, Supabase (Postgres, plpgsql), psql para a suíte de entitlements.

## Global Constraints

- Cada PR nasce de `origin/main` atualizado: `git fetch origin main && git checkout -b <branch> origin/main`. Nunca da branch da spec nem de outro PR.
- Trabalhar no worktree desta sessão: `/Users/eduardosouza/projects/sm-crm/.claude/worktrees/instagram-dm-follow-automation-107fe8`. Rodar `pwd` e `git branch --show-current` antes de editar.
- Prefixo de migration único e maior que o último de `origin/main`. Conferir com `git ls-tree --name-only origin/main:supabase/migrations | tail -1` imediatamente antes de abrir o PR; hoje o último é `20260916000001`.
- Cópia de UI em português, sem travessão (`—`); usar ponto, dois-pontos ou `·`.
- Antes de `git push`: `npm run lint`, `npm run format:check` (`npm run format` corrige), os quatro typechecks (`npx tsc -p apps/crm/tsconfig.json --noEmit`, `npx tsc -p apps/hub/tsconfig.json --noEmit`, `npx tsc -p apps/admin/tsconfig.json --noEmit`, `npx tsc -p tsconfig.scripts.json`), `npm run test`. O PR 2 também `npm run test:db` se houver Docker/colima; senão o job `entitlement-tests` do CI cobre.
- Se `ls node_modules/.deno` existir, rodar `npm ci` antes de confiar em tsc/vitest (poluição de deno).
- Commits terminam com `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. PR bodies terminam com `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Todo PR recebe review externo do Codex ao ser aberto. Ler o corpo do comentário, verificar cada achado contra o código, e responder o que for rejeitado.
- Ícones só de `lucide-react`; toasts via `toast` de `sonner`.

---

## PR 1. Identidade de coluna por posição

Branch: `fix/fluxos-colunas-por-posicao`

Problema: `buildBoardRows` em `apps/crm/src/pages/entregas/views/KanbanView.tsx:89-122` chaveia colunas por nome de etapa num `Map<string, BoardCard[]>`. Duas etapas chamadas "Aprovação" no mesmo template colapsam numa coluna, e o drag resolve `ordem` pelo primeiro nome igual (`:419`, `:534-535`), rejeitando o movimento com "Só é possível mover para a etapa adjacente".

Decisão de escopo: o filtro "Etapa" (`filterEtapas`, `viewQuery.ts:43,78`, `EntregasPage.tsx:590-591`) continua por nome. Ele é um filtro de usuário ("mostrar cards em Aprovação") e um nome que aparece duas vezes no template deve casar as duas colunas. A identidade posicional é do quadro, não do filtro.

### Task 1.1: Módulo puro `boardRows.ts`

**Files:**
- Create: `apps/crm/src/pages/entregas/boardRows.ts`
- Test: `apps/crm/src/pages/entregas/__tests__/boardRows.test.ts`

**Interfaces:**
- Consumes: `BoardCard` de `./hooks/useEntregasData`, `WorkflowTemplate` de `../../store`.
- Produces:
  ```ts
  export interface BoardColumn { ordem: number; nome: string; tipo: 'padrao' | 'aprovacao_cliente'; cards: BoardCard[] }
  export interface BoardRow { key: string; label: string; columns: BoardColumn[] }  // columns ordenadas por ordem asc
  export function buildBoardRows(cards: BoardCard[], templates: WorkflowTemplate[]): BoardRow[]
  export function columnKey(rowKey: string, ordem: number): string   // `${rowKey}::${ordem}`
  export function parseColumnKey(key: string): { rowKey: string; ordem: number } | null
  export function findCardColumn(cardId: string, rows: BoardRow[]): { row: BoardRow; column: BoardColumn } | null
  ```

- [ ] **Step 1: Escrever o teste que falha**

```ts
// apps/crm/src/pages/entregas/__tests__/boardRows.test.ts
import { describe, expect, it } from 'vitest';
import { buildBoardRows, columnKey, findCardColumn, parseColumnKey } from '../boardRows';
import type { BoardCard } from '../hooks/useEntregasData';

type EtapaLike = { id: number; ordem: number; nome: string; tipo?: 'padrao' | 'aprovacao_cliente' };

function makeCard(
  wfId: number,
  templateId: number | null,
  etapas: EtapaLike[],
  ativaOrdem: number,
  position = 0,
): BoardCard {
  const all = etapas.map((e) => ({
    id: e.id,
    workflow_id: wfId,
    ordem: e.ordem,
    nome: e.nome,
    tipo: e.tipo ?? 'padrao',
    prazo_dias: 1,
    tipo_prazo: 'corridos' as const,
    status: e.ordem === ativaOrdem ? ('ativo' as const) : ('pendente' as const),
  }));
  const etapa = all.find((e) => e.ordem === ativaOrdem)!;
  return {
    workflow: { id: wfId, cliente_id: 1, titulo: `WF ${wfId}`, status: 'ativo', etapa_atual: ativaOrdem, recorrente: false, template_id: templateId, position },
    etapa,
    cliente: undefined,
    membro: undefined,
    deadline: { diasRestantes: 1, horasRestantes: 0, estourado: false, urgente: false },
    totalEtapas: all.length,
    etapaIdx: ativaOrdem,
    allEtapas: all,
  } as unknown as BoardCard;
}

const DUP = [
  { id: 1, ordem: 0, nome: 'Copy' },
  { id: 2, ordem: 1, nome: 'Aprovação', tipo: 'aprovacao_cliente' as const },
  { id: 3, ordem: 2, nome: 'Design' },
  { id: 4, ordem: 3, nome: 'Aprovação', tipo: 'aprovacao_cliente' as const },
];

describe('buildBoardRows', () => {
  it('mantém duas etapas de mesmo nome como colunas distintas, por ordem', () => {
    const rows = buildBoardRows([makeCard(1, 7, DUP, 1), makeCard(2, 7, DUP, 3)], []);
    expect(rows).toHaveLength(1);
    expect(rows[0].columns.map((c) => c.ordem)).toEqual([0, 1, 2, 3]);
    expect(rows[0].columns.map((c) => c.nome)).toEqual(['Copy', 'Aprovação', 'Design', 'Aprovação']);
    expect(rows[0].columns[1].cards.map((c) => c.workflow.id)).toEqual([1]);
    expect(rows[0].columns[3].cards.map((c) => c.workflow.id)).toEqual([2]);
  });

  it('marca o tipo da coluna a partir da etapa', () => {
    const rows = buildBoardRows([makeCard(1, 7, DUP, 0)], []);
    expect(rows[0].columns.map((c) => c.tipo)).toEqual(['padrao', 'aprovacao_cliente', 'padrao', 'aprovacao_cliente']);
  });

  it('usa o rótulo do template quando existe e ordena cards por position', () => {
    const rows = buildBoardRows(
      [makeCard(1, 7, DUP, 0, 5), makeCard(2, 7, DUP, 0, 2)],
      [{ id: 7, nome: 'Redes', etapas: [] } as never],
    );
    expect(rows[0].key).toBe('template:7');
    expect(rows[0].label).toBe('REDES');
    expect(rows[0].columns[0].cards.map((c) => c.workflow.id)).toEqual([2, 1]);
  });

  it('sem template, agrupa pelos nomes unidos', () => {
    const rows = buildBoardRows([makeCard(1, null, DUP, 0)], []);
    expect(rows[0].key).toBe('Copy → Aprovação → Design → Aprovação');
  });

  it('acrescenta colunas que só alguns cards têm, na posição da ordem', () => {
    const longer = [...DUP, { id: 5, ordem: 4, nome: 'Publicação' }];
    const rows = buildBoardRows([makeCard(1, 7, DUP, 0), makeCard(2, 7, longer, 4)], []);
    expect(rows[0].columns.map((c) => c.ordem)).toEqual([0, 1, 2, 3, 4]);
    expect(rows[0].columns[4].cards.map((c) => c.workflow.id)).toEqual([2]);
  });

  it('descarta linhas sem nenhum card', () => {
    expect(buildBoardRows([], [])).toEqual([]);
  });
});

describe('columnKey / parseColumnKey', () => {
  it('serializa e volta', () => {
    expect(columnKey('template:7', 3)).toBe('template:7::3');
    expect(parseColumnKey('template:7::3')).toEqual({ rowKey: 'template:7', ordem: 3 });
    expect(parseColumnKey('Copy → Design::1')).toEqual({ rowKey: 'Copy → Design', ordem: 1 });
    expect(parseColumnKey('sem-separador')).toBeNull();
    expect(parseColumnKey('template:7::x')).toBeNull();
  });
});

describe('findCardColumn', () => {
  it('localiza a coluna de um card pelo id do workflow', () => {
    const rows = buildBoardRows([makeCard(1, 7, DUP, 3)], []);
    const hit = findCardColumn('1', rows);
    expect(hit?.column.ordem).toBe(3);
    expect(findCardColumn('99', rows)).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run apps/crm/src/pages/entregas/__tests__/boardRows.test.ts`
Expected: FAIL, `Cannot find module '../boardRows'`.

- [ ] **Step 3: Implementar o módulo**

```ts
// apps/crm/src/pages/entregas/boardRows.ts
import type { WorkflowTemplate } from '../../store';
import type { BoardCard } from './hooks/useEntregasData';

/** Uma coluna do quadro de Fluxos: identidade pela ORDEM da etapa dentro da
 *  linha, nunca pelo nome. Duas etapas chamadas "Aprovação" são duas colunas. */
export interface BoardColumn {
  ordem: number;
  nome: string;
  tipo: 'padrao' | 'aprovacao_cliente';
  cards: BoardCard[];
}

export interface BoardRow {
  key: string;
  label: string;
  /** Ordenadas por `ordem` ascendente. */
  columns: BoardColumn[];
}

const KEY_SEP = '::';

export function columnKey(rowKey: string, ordem: number): string {
  return `${rowKey}${KEY_SEP}${ordem}`;
}

/** Inverso de columnKey. O rowKey pode conter "::"? Não: chaves de template são
 *  `template:<id>` e chaves sem template são nomes unidos por " → ". Mesmo assim
 *  a ordem é sempre o ÚLTIMO segmento, então o split é pelo último separador. */
export function parseColumnKey(key: string): { rowKey: string; ordem: number } | null {
  const idx = key.lastIndexOf(KEY_SEP);
  if (idx === -1) return null;
  const ordem = Number(key.slice(idx + KEY_SEP.length));
  if (!Number.isInteger(ordem)) return null;
  return { rowKey: key.slice(0, idx), ordem };
}

export function buildBoardRows(cards: BoardCard[], templates: WorkflowTemplate[]): BoardRow[] {
  const rowMap = new Map<string, { key: string; label: string; columns: Map<number, BoardColumn> }>();
  for (const card of cards) {
    const sorted = [...card.allEtapas].sort((a, b) => a.ordem - b.ordem);
    const key =
      card.workflow.template_id != null
        ? `template:${card.workflow.template_id}`
        : sorted.map((e) => e.nome).join(' → ');
    if (!rowMap.has(key)) {
      const t = templates.find((t) => t.id === card.workflow.template_id);
      rowMap.set(key, { key, label: (t ? t.nome : key).toUpperCase(), columns: new Map() });
    }
    const row = rowMap.get(key)!;
    // Garante a coluna de cada etapa deste card (templates evoluem; um card pode
    // ter uma etapa a mais). O nome e o tipo vêm do primeiro card que trouxe a ordem.
    for (const e of sorted) {
      if (!row.columns.has(e.ordem)) {
        row.columns.set(e.ordem, { ordem: e.ordem, nome: e.nome, tipo: e.tipo ?? 'padrao', cards: [] });
      }
    }
    row.columns.get(card.etapa.ordem)?.cards.push(card);
  }
  const rows: BoardRow[] = [];
  for (const r of rowMap.values()) {
    const columns = [...r.columns.values()].sort((a, b) => a.ordem - b.ordem);
    for (const col of columns) {
      col.cards.sort((a, b) => (a.workflow.position ?? 0) - (b.workflow.position ?? 0));
    }
    if (columns.some((c) => c.cards.length > 0)) rows.push({ key: r.key, label: r.label, columns });
  }
  return rows;
}

export function findCardColumn(
  cardId: string,
  rows: BoardRow[],
): { row: BoardRow; column: BoardColumn } | null {
  for (const row of rows) {
    for (const column of row.columns) {
      if (column.cards.some((c) => String(c.workflow.id) === cardId)) return { row, column };
    }
  }
  return null;
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run apps/crm/src/pages/entregas/__tests__/boardRows.test.ts`
Expected: PASS, 9 testes.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/boardRows.ts apps/crm/src/pages/entregas/__tests__/boardRows.test.ts
git commit -m "feat(entregas): boardRows com colunas por ordem da etapa

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 1.2: Ligar `KanbanView` ao novo módulo

**Files:**
- Modify: `apps/crm/src/pages/entregas/views/KanbanView.tsx` (remover `BoardRow`, `buildBoardRows`, `rowCardCount`, `findCardColumn` locais; usar o módulo; chavear droppables, sort prefs e `data-tour` por ordem)
- Test: `apps/crm/src/pages/entregas/views/__tests__/KanbanDuplicateNames.test.tsx`

**Interfaces:**
- Consumes: `buildBoardRows`, `columnKey`, `parseColumnKey`, `findCardColumn`, `BoardRow`, `BoardColumn` de `../boardRows`.
- Produces: nada novo; `KanbanViewProps` não muda.

- [ ] **Step 1: Escrever o teste que falha**

```tsx
// apps/crm/src/pages/entregas/views/__tests__/KanbanDuplicateNames.test.tsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  completeEtapa: vi.fn(),
  completeEtapaWithRearm: vi.fn(),
  hasLaterApprovalEtapa: vi.fn(),
  approvePostsInternally: vi.fn(),
  sendPostsToCliente: vi.fn(),
  revertEtapa: vi.fn(),
  updateWorkflowPositions: vi.fn(),
  getDeadlineInfo: vi.fn(),
  addWorkflow: vi.fn(),
  addWorkflowEtapa: vi.fn(),
  addWorkflowTemplate: vi.fn(),
  removeWorkflowTemplate: vi.fn(),
  removeWorkflow: vi.fn(),
  updateWorkflow: vi.fn(),
  updateWorkflowEtapa: vi.fn(),
  updateWorkflowTemplate: vi.fn(),
  propagateTemplateToWorkflows: vi.fn(),
  getPropertyDefinitions: vi.fn(),
  deletePropertyDefinition: vi.fn(),
  getWorkflows: vi.fn(),
  getClientes: vi.fn(),
  getMembros: vi.fn(),
  getWorkflowTemplates: vi.fn(),
  getWorkflowEtapas: vi.fn(),
  getWorkflowPostsCounts: vi.fn(),
  getWorkflowApprovedPostsCounts: vi.fn(),
  getWorkflowClearedClientePostsCounts: vi.fn(),
  getWorkflowRevisaoInternaCounts: vi.fn(),
  getWorkflowAwaitingClientePostsCounts: vi.fn(),
  getWorkflowPostResponsaveis: vi.fn(),
  getWorkspaceSlug: vi.fn(),
}));
vi.mock('../../../../store', () => store);
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('../../components/PropertyDefinitionPanel', () => ({
  PropertyDefinitionPanel: () => <div>PropertyDefinitionPanel</div>,
}));
vi.mock('../../components/WorkflowCard', () => ({
  WorkflowCard: ({ card }: { card: { workflow: { titulo: string } } }) => (
    <div>{card.workflow.titulo}</div>
  ),
}));

import { KanbanView } from '../KanbanView';
import type { BoardCard } from '../../hooks/useEntregasData';

const ETAPAS = [
  { id: 1, ordem: 0, nome: 'Copy', tipo: 'padrao' as const },
  { id: 2, ordem: 1, nome: 'Aprovação', tipo: 'aprovacao_cliente' as const },
  { id: 3, ordem: 2, nome: 'Design', tipo: 'padrao' as const },
  { id: 4, ordem: 3, nome: 'Aprovação', tipo: 'aprovacao_cliente' as const },
].map((e) => ({ ...e, workflow_id: 1, prazo_dias: 1, tipo_prazo: 'corridos' as const, status: 'pendente' as const }));

function makeCard(wfId: number, titulo: string, ativaOrdem: number): BoardCard {
  const etapa = { ...ETAPAS[ativaOrdem], status: 'ativo' as const };
  return {
    workflow: { id: wfId, cliente_id: 1, titulo, status: 'ativo', etapa_atual: ativaOrdem, recorrente: false, template_id: 7 },
    etapa,
    cliente: undefined,
    membro: undefined,
    deadline: { diasRestantes: 1, horasRestantes: 0, estourado: false, urgente: false },
    totalEtapas: 4,
    etapaIdx: ativaOrdem,
    allEtapas: ETAPAS,
  } as unknown as BoardCard;
}

function boardProps(cards: BoardCard[]) {
  return {
    cards,
    onCardClick: () => {},
    onEditClick: () => {},
    onPostsClick: () => {},
    onRefresh: () => {},
    onRecurring: () => {},
    membros: [],
    templates: [],
    postsCounts: new Map<number, number>(),
    approvedPostsCounts: new Map<number, number>(),
    clearedClienteCounts: new Map<number, number>(),
    revisaoInternaCounts: new Map<number, number>(),
    awaitingClienteCounts: new Map<number, number>(),
  };
}

describe('KanbanView com etapas de mesmo nome', () => {
  it('renderiza duas colunas "Aprovação" e coloca cada card na sua', () => {
    const { container } = render(
      <KanbanView {...boardProps([makeCard(1, 'Primeira aprovação', 1), makeCard(2, 'Segunda aprovação', 3)])} />,
    );
    const titles = [...container.querySelectorAll('.board-column-title')].map((el) => el.textContent);
    expect(titles).toEqual(['Copy', 'Aprovação', 'Design', 'Aprovação']);

    const columns = container.querySelectorAll('.board-column');
    expect(columns[1].textContent).toContain('Primeira aprovação');
    expect(columns[1].textContent).not.toContain('Segunda aprovação');
    expect(columns[3].textContent).toContain('Segunda aprovação');
  });

  it('marca as duas colunas de aprovação para o tour', () => {
    const { container } = render(<KanbanView {...boardProps([makeCard(1, 'A', 0)])} />);
    expect(container.querySelectorAll('[data-tour="wf-col-aprovacao"]')).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run apps/crm/src/pages/entregas/views/__tests__/KanbanDuplicateNames.test.tsx`
Expected: FAIL. O primeiro teste vê `['Copy', 'Aprovação', 'Design']` (três colunas) e o card "Segunda aprovação" dentro da coluna 1.

- [ ] **Step 3: Substituir a composição local pelo módulo**

Em `KanbanView.tsx`:

1. Apagar as linhas 82-126 (`interface BoardRow`, `buildBoardRows`, `rowCardCount`) e a função local `findCardColumn` (linhas 361-371). Acrescentar ao topo:

```ts
import { buildBoardRows, columnKey, parseColumnKey, findCardColumn } from '../boardRows';
import type { BoardRow, BoardColumn } from '../boardRows';

function rowCardCount(row: BoardRow): number {
  return row.columns.reduce((sum, col) => sum + col.cards.length, 0);
}
```

2. `displayCards` (linha 276-280) passa a receber a ordem:

```ts
const displayCards = useCallback(
  (rowKey: string, ordem: number, cards: BoardCard[]): BoardCard[] =>
    sortModeFor(columnKey(rowKey, ordem)) === 'prazo' ? sortCardsByPrazo(cards) : cards,
  [sortModeFor],
);
```

3. Apagar `approvalStepNames` (linhas 347-355). O `data-tour` vem de `column.tipo`.

4. `handleDragOver` (linhas 384-450). Substituir o miolo por:

```ts
const overId = String(over.id);
const rows = buildBoardRows(localCards, templates);
const activeLocation = findCardColumn(String(active.id), rows);

let targetRow: BoardRow | undefined;
let targetColumn: BoardColumn | undefined;
if (overId.startsWith(COL_PREFIX)) {
  const parsed = parseColumnKey(overId.slice(COL_PREFIX.length));
  targetRow = parsed ? rows.find((r) => r.key === parsed.rowKey) : undefined;
  targetColumn = parsed ? targetRow?.columns.find((c) => c.ordem === parsed.ordem) : undefined;
} else {
  const overLocation = findCardColumn(overId, rows);
  targetRow = overLocation?.row;
  targetColumn = overLocation?.column;
}

if (
  !targetRow ||
  !targetColumn ||
  !activeLocation ||
  targetRow.key !== activeLocation.row.key ||
  targetColumn.ordem === activeLocation.column.ordem
) {
  setDropSlot(null);
  return;
}
const valid = Math.abs(targetColumn.ordem - draggedCard.etapa.ordem) === 1;
if (!valid) {
  setDropSlot(null);
  return;
}

const targetCards = displayCards(targetRow.key, targetColumn.ordem, targetColumn.cards);
let index = targetCards.length;
if (!overId.startsWith(COL_PREFIX)) {
  const overIdx = targetCards.findIndex((c) => String(c.workflow.id) === overId);
  if (overIdx !== -1) {
    const activeRect = active.rect.current?.translated;
    const after = activeRect && activeRect.top > over.rect.top + over.rect.height / 2;
    index = after ? overIdx + 1 : overIdx;
  }
}
const colKey = columnKey(targetRow.key, targetColumn.ordem);
setDropSlot((prev) =>
  prev && prev.colKey === colKey && prev.index === index ? prev : { colKey, index },
);
```

5. `handleDragEnd` (linhas 452-592). Mesma resolução de alvo:

```ts
const rows = buildBoardRows(localCards, templates);
const activeLocation = findCardColumn(activeId, rows);
if (!activeLocation) return;

let targetRow: BoardRow;
let targetColumn: BoardColumn;
if (overId.startsWith(COL_PREFIX)) {
  const parsed = parseColumnKey(overId.slice(COL_PREFIX.length));
  const row = parsed ? rows.find((r) => r.key === parsed.rowKey) : undefined;
  const col = parsed ? row?.columns.find((c) => c.ordem === parsed.ordem) : undefined;
  if (!row || !col) return;
  targetRow = row;
  targetColumn = col;
} else {
  const overLocation = findCardColumn(overId, rows);
  if (!overLocation) return;
  targetRow = overLocation.row;
  targetColumn = overLocation.column;
}

if (targetColumn.ordem === activeLocation.column.ordem && targetRow.key === activeLocation.row.key) {
  const colKeyStr = columnKey(activeLocation.row.key, activeLocation.column.ordem);
  const col = displayCards(activeLocation.row.key, activeLocation.column.ordem, activeLocation.column.cards);
  // ... resto do bloco de reorder inalterado (oldIdx/newIdx/arrayMove/updateWorkflowPositions)
} else {
  const diff = targetColumn.ordem - draggedCard.etapa.ordem;
  if (Math.abs(diff) !== 1) {
    toast.error('Só é possível mover para a etapa adjacente');
    return;
  }
  const targetDisplay = displayCards(targetRow.key, targetColumn.ordem, targetColumn.cards);
  const colKey = columnKey(targetRow.key, targetColumn.ordem);
  // ... resto do bloco (slotIndex/beforePos/afterPos/pendingInsertRef/handleForwardCard/setRevertTarget) inalterado
}
```

As linhas 530-537 (`targetOrdem` por nome) desaparecem: a ordem é `targetColumn.ordem`.

6. `renderRowBoard` (linhas 769-904). Trocar `[...row.columns.entries()].map(([stepName, rawStepCards], colIdx)` por `row.columns.map((column, colIdx)` e dentro:

```tsx
const stepName = column.nome;
const tint = columnTint(stepName);
const colKeyStr = columnKey(row.key, column.ordem);
const stepCards = displayCards(row.key, column.ordem, column.cards);
const sortMode = sortModeFor(colKeyStr);
return (
  <div key={column.ordem} className="board-column" style={{ borderColor: `${tint}30` }}>
    <div
      className="board-column-header"
      style={{ background: `${tint}30`, borderBottomColor: `${tint}30` }}
      {...(column.tipo === 'aprovacao_cliente' ? { 'data-tour': 'wf-col-aprovacao' } : {})}
    >
```

e o droppable `id={`${COL_PREFIX}${colKeyStr}`}`. Nas duas checagens `\`${row.key}::${stepName}\` === dropSlot?.colKey` (linhas 854 e 859) usar `colKeyStr === dropSlot?.colKey`.

7. Atualizar o comentário de `entregasPrefs.ts:12` para `(chave \`${rowKey}::${ordem}\`)`. Não migrar chaves antigas: chave desconhecida cai em `'prazo'` pelo `?? 'prazo'` de `sortModeFor`.

- [ ] **Step 4: Rodar os testes de Kanban e confirmar que passam**

Run: `npx vitest run apps/crm/src/pages/entregas/views/__tests__/ apps/crm/src/pages/entregas/__tests__/boardRows.test.ts apps/crm/src/pages/entregas/__tests__/entregasPrefs.test.ts`
Expected: PASS em todos, inclusive `KanbanPrazoSort`, `KanbanRearm`, `KanbanSync`.

- [ ] **Step 5: Typecheck e lint**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit && npm run lint`
Expected: sem erros. Se o lint acusar `BoardColumn` importado e não usado, remover o import de tipo não usado.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/pages/entregas/views/KanbanView.tsx apps/crm/src/pages/entregas/views/__tests__/KanbanDuplicateNames.test.tsx apps/crm/src/pages/entregas/entregasPrefs.ts
git commit -m "fix(entregas): colunas do quadro de Fluxos identificadas pela ordem da etapa

Duas etapas com o mesmo nome no template colapsavam numa coluna e o drag
para fora da segunda era rejeitado como não adjacente.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 1.3: Verificação no browser e PR

**Files:** nenhum novo.

- [ ] **Step 1: Verificar no browser contra staging**

Subir o CRM com `preview_start` (`npm run dev:staging` via `.claude/launch.json`; conferir que o worktree tem `.env.staging`, senão copiar do checkout principal). Criar um template com etapas `Copy, Aprovação, Design, Aprovação`, um fluxo nele, avançar até a segunda "Aprovação" e confirmar que o card está na quarta coluna, que o botão "Voltar etapa" o leva para "Design", e que o drag de "Design" para a quarta coluna funciona. Tirar screenshot do quadro com as quatro colunas.

- [ ] **Step 2: Gate completo**

Run: `npm run lint && npm run format:check && npx tsc -p apps/crm/tsconfig.json --noEmit && npx tsc -p apps/hub/tsconfig.json --noEmit && npx tsc -p apps/admin/tsconfig.json --noEmit && npx tsc -p tsconfig.scripts.json && npm run test`
Expected: tudo verde.

- [ ] **Step 3: Push e PR**

```bash
git push -u origin fix/fluxos-colunas-por-posicao
gh pr create --base main --title "fix(entregas): colunas do quadro de Fluxos por ordem da etapa" --body "$(cat <<'EOF'
## Problema
`buildBoardRows` chaveava colunas por nome de etapa. Duas etapas "Aprovação" no mesmo template viravam uma coluna só, e o drag a partir da segunda era rejeitado como "não adjacente" porque a ordem era resolvida pelo primeiro nome igual.

## Mudança
- Novo módulo puro `boardRows.ts` (`BoardRow`/`BoardColumn`, colunas por `ordem`, `columnKey`/`parseColumnKey`, `findCardColumn`) com testes.
- `KanbanView` usa o módulo: droppables, preferências de sort e `data-tour` chaveados por ordem.
- O filtro "Etapa" continua por nome de propósito: é filtro de usuário e deve casar as duas colunas.
- Chaves antigas de sort por nome caem em `prazo` (comportamento já existente para chave desconhecida).

Pré-requisito 1 de `docs/superpowers/specs/2026-09-10-posts-individuais-fluxos-design.md`.

## Verificação
- `boardRows.test.ts` (9) e `KanbanDuplicateNames.test.tsx` (2) novos; suítes de Kanban existentes verdes.
- Browser em staging: template com dois "Aprovação", card na quarta coluna, voltar e arrastar funcionam (screenshot no PR).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Anexar o screenshot como comentário. Aguardar o review do Codex e responder.

---

## PR 2. Renumeração sobre a coluna inteira

Branch: `fix/fluxos-reorder-coluna-inteira`

Problema: em `KanbanView.tsx` o drag manual dentro da coluna faz `arrayMove` sobre a lista **exibida** (já filtrada pela página, porque `EntregasPage` passa `filteredCards`) e grava `position = índice` para esses cards (linhas 503-517). O mesmo acontece no insert entre colunas (`advanceEtapa` 619-628, `handleRevertConfirm` 724-733). Fluxos ocultos pelo filtro ficam com posições colidentes. E `updateWorkflowPositions` (`store/workflows.ts:169-183`) dispara N UPDATEs em paralelo, sem atomicidade.

Solução: (a) uma RPC `reorder_workflow_positions` atômica no padrão de `reorder_board_posts`; (b) `KanbanView` recebe também `allCards` (sem filtro) e calcula a ordem da coluna inteira com um módulo puro que preserva a posição relativa dos ocultos.

Depende do PR 1 apenas nos nomes `BoardColumn`/`columnKey`. Se o PR 1 ainda não estiver em main, nascer de `origin/main` mesmo assim e usar `row.columns.get(name)` no lugar de `column.cards`; o conflito na hora do merge é pequeno e a lógica pura independe.

### Task 2.1: Migration com a RPC `reorder_workflow_positions`

**Files:**
- Create: `supabase/migrations/20260917000001_reorder_workflow_positions_rpc.sql`
- Test: `supabase/tests/entitlements/82_reorder_workflow_positions.sql`

**Interfaces:**
- Produces: `public.reorder_workflow_positions(p_workflow_ids bigint[], p_positions integer[]) returns void`. Erros `P0001`: `not_authenticated`, `invalid_arguments`, `workflow_not_found`.

- [ ] **Step 1: Escrever a suíte SQL que falha**

```sql
-- supabase/tests/entitlements/82_reorder_workflow_positions.sql
\set ON_ERROR_STOP on
\i supabase/tests/entitlements/_helpers.sql

-- reorder_workflow_positions: suite da migration
--   20260917000001_reorder_workflow_positions_rpc.sql
-- Espelha 71_board_ordem.sql: impersonacao de `authenticated`, lock em ordem
-- estavel + count(*) all-or-nothing, e o triplo has_function_privilege.

-- 0. sem workspace ativo -> not_authenticated
begin;
do $$
declare v_no_user uuid := gen_random_uuid(); v_raised boolean := false;
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_no_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform reorder_workflow_positions(array[1]::bigint[], array[0]::integer[]);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'not_authenticated', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  assert v_raised, 'caller sem workspace ativo deve levantar not_authenticated';
  execute 'reset role';
  raise notice 'PASS 82.0 not_authenticated';
end $$;
rollback;

-- 1. happy path: reordena tres fluxos da propria conta em uma chamada
begin;
do $$
declare
  v_ws uuid; v_user uuid := gen_random_uuid(); v_cli bigint;
  v_a bigint; v_b bigint; v_c bigint; v_pa int; v_pb int; v_pc int;
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user;
  insert into clientes (user_id, conta_id, nome, sigla, cor)
    values (v_user, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, position)
    values (v_user, v_ws, v_cli, 'A', 'ativo', 0) returning id into v_a;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, position)
    values (v_user, v_ws, v_cli, 'B', 'ativo', 1) returning id into v_b;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, position)
    values (v_user, v_ws, v_cli, 'C', 'ativo', 2) returning id into v_c;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform reorder_workflow_positions(array[v_c, v_a, v_b], array[0, 1, 2]::integer[]);
  execute 'reset role';

  select position into v_pa from workflows where id = v_a;
  select position into v_pb from workflows where id = v_b;
  select position into v_pc from workflows where id = v_c;
  assert v_pc = 0 and v_pa = 1 and v_pb = 2,
    format('esperado C=0 A=1 B=2, obtido A=%s B=%s C=%s', v_pa, v_pb, v_pc);
  raise notice 'PASS 82.1 happy path';
end $$;
rollback;

-- 2. all-or-nothing entre contas: um fluxo alheio no lote -> workflow_not_found e nada muda
begin;
do $$
declare
  v_ws uuid; v_ws_other uuid; v_user uuid := gen_random_uuid(); v_user_o uuid := gen_random_uuid();
  v_cli bigint; v_cli_o bigint; v_mine bigint; v_theirs bigint; v_raised boolean := false; v_pos int;
begin
  v_ws := et_make_workspace('pro');
  v_ws_other := et_make_workspace('pro');
  insert into auth.users (id) values (v_user), (v_user_o);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner'), (v_user_o, v_ws_other, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user;
  update profiles set conta_id = v_ws_other, active_workspace_id = v_ws_other where id = v_user_o;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_user, v_ws, 'C', 'C', '#000') returning id into v_cli;
  insert into clientes (user_id, conta_id, nome, sigla, cor) values (v_user_o, v_ws_other, 'O', 'O', '#000') returning id into v_cli_o;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, position)
    values (v_user, v_ws, v_cli, 'MINE', 'ativo', 5) returning id into v_mine;
  insert into workflows (user_id, conta_id, cliente_id, titulo, status, position)
    values (v_user_o, v_ws_other, v_cli_o, 'THEIRS', 'ativo', 5) returning id into v_theirs;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform reorder_workflow_positions(array[v_mine, v_theirs], array[0, 1]::integer[]);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'workflow_not_found', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'lote com fluxo de outra conta deve levantar workflow_not_found';
  select position into v_pos from workflows where id = v_mine;
  assert v_pos = 5, format('fluxo proprio deveria ficar intacto (5), obtido %s', v_pos);
  raise notice 'PASS 82.2 all-or-nothing entre contas';
end $$;
rollback;

-- 3. argumentos invalidos: arrays de tamanhos diferentes
begin;
do $$
declare v_ws uuid; v_user uuid := gen_random_uuid(); v_raised boolean := false;
begin
  v_ws := et_make_workspace('pro');
  insert into auth.users (id) values (v_user);
  insert into workspace_members (user_id, workspace_id, role) values (v_user, v_ws, 'owner');
  update profiles set conta_id = v_ws, active_workspace_id = v_ws where id = v_user;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform reorder_workflow_positions(array[1, 2]::bigint[], array[0]::integer[]);
  exception when sqlstate 'P0001' then
    assert sqlerrm = 'invalid_arguments', format('wrong msg: %s', sqlerrm);
    v_raised := true;
  end;
  execute 'reset role';
  assert v_raised, 'arrays de tamanhos diferentes devem levantar invalid_arguments';
  raise notice 'PASS 82.3 invalid_arguments';
end $$;
rollback;

-- 4. ACL: anon nao executa; authenticated e service_role executam
begin;
do $$
begin
  assert not has_function_privilege('anon', 'public.reorder_workflow_positions(bigint[], integer[])', 'execute'),
    'anon nao pode executar reorder_workflow_positions';
  assert has_function_privilege('authenticated', 'public.reorder_workflow_positions(bigint[], integer[])', 'execute'),
    'authenticated deve executar reorder_workflow_positions';
  assert has_function_privilege('service_role', 'public.reorder_workflow_positions(bigint[], integer[])', 'execute'),
    'service_role deve executar reorder_workflow_positions';
  raise notice 'PASS 82.4 ACL';
end $$;
rollback;
```

- [ ] **Step 2: Rodar a suíte e confirmar que falha**

Com Supabase local (colima + `npx supabase start`): `bash scripts/test-entitlements.sh`
Expected: FAIL no bloco 82.0 com `function reorder_workflow_positions(bigint[], integer[]) does not exist`. Sem Docker, pular para o Step 3 e deixar o CI (`entitlement-tests`) confirmar; registrar isso no PR.

- [ ] **Step 3: Escrever a migration**

```sql
-- supabase/migrations/20260917000001_reorder_workflow_positions_rpc.sql
-- Ordem manual do quadro de Fluxos, atomica.
--
-- workflows.position e um inteiro denso por coluna. Ate aqui o CRM gravava
-- N UPDATEs em paralelo (updateWorkflowPositions) e so para os cards VISIVEIS
-- da coluna, entao fluxos ocultos por filtro ficavam com posicoes colidentes.
-- Esta RPC grava o lote inteiro numa chamada, conta-scoped, all-or-nothing
-- na posse, no mesmo desenho de reorder_board_posts (20260901000020).
--
-- Nenhum trigger le position; um UPDATE so dessa coluna nao passa pelo guard
-- post_a0_sync_cliente (que e de workflow_posts). RLS de workflows continua
-- cobrindo escrita direta; a RPC e o caminho sancionado por ser atomica.

create or replace function public.reorder_workflow_positions(
  p_workflow_ids bigint[],
  p_positions integer[]
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_conta uuid := public.get_my_conta_id();
  v_count int;
begin
  if v_conta is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;
  if p_workflow_ids is null or p_positions is null
     or array_length(p_workflow_ids, 1) is null
     or array_length(p_workflow_ids, 1) is distinct from array_length(p_positions, 1) then
    raise exception 'invalid_arguments' using errcode = 'P0001';
  end if;

  perform 1 from workflows
   where id = any(p_workflow_ids) and conta_id = v_conta
   order by id
   for update;

  select count(*) into v_count
    from workflows
   where id = any(p_workflow_ids) and conta_id = v_conta;
  if v_count is distinct from array_length(p_workflow_ids, 1) then
    raise exception 'workflow_not_found' using errcode = 'P0001';
  end if;

  update workflows w
     set position = u.pos
    from unnest(p_workflow_ids, p_positions) as u(id, pos)
   where w.id = u.id and w.conta_id = v_conta;
end;
$$;

revoke all on function public.reorder_workflow_positions(bigint[], integer[]) from public, anon;
grant execute on function public.reorder_workflow_positions(bigint[], integer[]) to authenticated, service_role;
```

- [ ] **Step 4: Rodar a suíte e confirmar que passa**

Run: `bash scripts/test-entitlements.sh`
Expected: `PASS 82.0` a `PASS 82.4`. Sem Docker, confirmar ao menos que `psql -f` não é possível e anotar no PR que o CI valida.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260917000001_reorder_workflow_positions_rpc.sql supabase/tests/entitlements/82_reorder_workflow_positions.sql
git commit -m "feat(db): rpc reorder_workflow_positions atomica e conta-scoped

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 2.2: Store chama a RPC

**Files:**
- Modify: `apps/crm/src/store/workflows.ts:169-183`
- Test: `apps/crm/src/store/__tests__/updateWorkflowPositions.test.ts`

**Interfaces:**
- Produces: `updateWorkflowPositions(updates: { id: number; position: number }[]): Promise<void>` mantém a assinatura; passa a fazer uma única chamada `supabase.rpc('reorder_workflow_positions', { p_workflow_ids, p_positions })`. Lista vazia é no-op sem chamada.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// apps/crm/src/store/__tests__/updateWorkflowPositions.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const supabaseMock = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));
vi.mock('../../lib/supabase', () => ({ supabase: supabaseMock }));

import { updateWorkflowPositions } from '../workflows';

describe('updateWorkflowPositions', () => {
  beforeEach(() => {
    supabaseMock.rpc.mockReset();
    supabaseMock.from.mockReset();
  });

  it('grava o lote inteiro numa única RPC', async () => {
    supabaseMock.rpc.mockResolvedValue({ error: null });
    await updateWorkflowPositions([
      { id: 30, position: 0 },
      { id: 10, position: 1 },
      { id: 20, position: 2 },
    ]);
    expect(supabaseMock.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMock.rpc).toHaveBeenCalledWith('reorder_workflow_positions', {
      p_workflow_ids: [30, 10, 20],
      p_positions: [0, 1, 2],
    });
    expect(supabaseMock.from).not.toHaveBeenCalled();
  });

  it('propaga o erro da RPC', async () => {
    supabaseMock.rpc.mockResolvedValue({ error: { message: 'workflow_not_found' } });
    await expect(updateWorkflowPositions([{ id: 1, position: 0 }])).rejects.toMatchObject({
      message: 'workflow_not_found',
    });
  });

  it('não chama nada com lista vazia', async () => {
    await updateWorkflowPositions([]);
    expect(supabaseMock.rpc).not.toHaveBeenCalled();
  });
});
```

Se `apps/crm/src/store/__tests__/` não existir, criar o diretório. Conferir como outros testes do store mockam o cliente: `grep -rl "lib/supabase" apps/crm/src/store/__tests__ apps/crm/src/__tests__ | head -3` e copiar o caminho do `vi.mock` de lá se for diferente de `../../lib/supabase`.

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run apps/crm/src/store/__tests__/updateWorkflowPositions.test.ts`
Expected: FAIL, `expected rpc to have been called 1 times` (a função atual usa `from().update()`).

- [ ] **Step 3: Reescrever a função**

```ts
// apps/crm/src/store/workflows.ts (substitui as linhas 169-183)
/** Grava a ordem manual de um lote de fluxos numa única chamada atômica
 *  (RPC reorder_workflow_positions). Sempre enviar a coluna INTEIRA, não só os
 *  cards visíveis: a RPC grava exatamente o que recebe. */
export async function updateWorkflowPositions(
  updates: { id: number; position: number }[],
): Promise<void> {
  if (updates.length === 0) return;
  const { error } = await supabase.rpc('reorder_workflow_positions', {
    p_workflow_ids: updates.map((u) => u.id),
    p_positions: updates.map((u) => u.position),
  });
  if (error) throw error;
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run apps/crm/src/store/__tests__/updateWorkflowPositions.test.ts`
Expected: PASS, 3 testes.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/store/workflows.ts apps/crm/src/store/__tests__/updateWorkflowPositions.test.ts
git commit -m "refactor(entregas): updateWorkflowPositions usa a rpc atomica

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 2.3: Módulo puro `boardReorder.ts`

**Files:**
- Create: `apps/crm/src/pages/entregas/boardReorder.ts`
- Test: `apps/crm/src/pages/entregas/__tests__/boardReorder.test.ts`

**Interfaces:**
- Produces:
  ```ts
  /** Aplica a ordem nova dos itens visíveis sobre a coluna inteira, mantendo os
   *  ocultos nas posições relativas em que estavam. */
  export function mergeVisibleReorder(fullOrder: number[], visibleReordered: number[]): number[]
  /** Insere `movedId` na coluna inteira no ponto que corresponde ao índice `slotIndex`
   *  da lista visível (antes do item visível que ocupa esse índice; no fim se não houver). */
  export function insertIntoFullOrder(fullOrder: number[], visibleOrder: number[], slotIndex: number, movedId: number): number[]
  ```

- [ ] **Step 1: Escrever o teste que falha**

```ts
// apps/crm/src/pages/entregas/__tests__/boardReorder.test.ts
import { describe, expect, it } from 'vitest';
import { insertIntoFullOrder, mergeVisibleReorder } from '../boardReorder';

describe('mergeVisibleReorder', () => {
  it('reordena só os visíveis e mantém os ocultos no lugar', () => {
    // coluna inteira: 1 2 3 4 5; visíveis: 1 3 5; usuário arrasta 5 para antes de 1
    expect(mergeVisibleReorder([1, 2, 3, 4, 5], [5, 1, 3])).toEqual([5, 2, 1, 4, 3]);
  });

  it('sem ocultos é a própria ordem visível', () => {
    expect(mergeVisibleReorder([1, 2, 3], [3, 1, 2])).toEqual([3, 1, 2]);
  });

  it('ignora ids visíveis que não estão na coluna inteira e preserva os demais', () => {
    expect(mergeVisibleReorder([1, 2, 3], [3, 99, 1])).toEqual([3, 2, 1]);
  });

  it('coluna inteira vazia retorna vazio', () => {
    expect(mergeVisibleReorder([], [1])).toEqual([]);
  });
});

describe('insertIntoFullOrder', () => {
  it('insere antes do item visível no índice do slot', () => {
    // inteira: 1 2 3 4; visíveis: 1 3; slot 1 = antes do 3 -> 1 2 [9] 3 4
    expect(insertIntoFullOrder([1, 2, 3, 4], [1, 3], 1, 9)).toEqual([1, 2, 9, 3, 4]);
  });

  it('slot no fim da lista visível vai para o fim da coluna inteira', () => {
    expect(insertIntoFullOrder([1, 2, 3, 4], [1, 3], 2, 9)).toEqual([1, 2, 3, 4, 9]);
  });

  it('slot 0 vai para o início', () => {
    expect(insertIntoFullOrder([1, 2, 3], [1, 3], 0, 9)).toEqual([9, 1, 2, 3]);
  });

  it('remove uma ocorrência anterior do mesmo id antes de inserir', () => {
    expect(insertIntoFullOrder([1, 9, 2], [1, 2], 2, 9)).toEqual([1, 2, 9]);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run apps/crm/src/pages/entregas/__tests__/boardReorder.test.ts`
Expected: FAIL, `Cannot find module '../boardReorder'`.

- [ ] **Step 3: Implementar**

```ts
// apps/crm/src/pages/entregas/boardReorder.ts
/**
 * Ordem manual de uma coluna do quadro de Fluxos.
 *
 * O usuário arrasta sobre a lista VISÍVEL (a página filtra os cards antes de
 * entregá-los ao Kanban), mas `workflows.position` é gravada para a coluna
 * INTEIRA. Estas funções traduzem um gesto sobre a lista visível numa ordem
 * completa que não pisa nos cards ocultos pelo filtro.
 */

export function mergeVisibleReorder(fullOrder: number[], visibleReordered: number[]): number[] {
  const full = new Set(fullOrder);
  const visible = visibleReordered.filter((id) => full.has(id));
  const visibleSet = new Set(visible);
  let next = 0;
  return fullOrder.map((id) => (visibleSet.has(id) ? visible[next++] : id));
}

export function insertIntoFullOrder(
  fullOrder: number[],
  visibleOrder: number[],
  slotIndex: number,
  movedId: number,
): number[] {
  const base = fullOrder.filter((id) => id !== movedId);
  const anchor = visibleOrder.filter((id) => id !== movedId)[slotIndex];
  const at = anchor === undefined ? base.length : base.indexOf(anchor);
  const out = [...base];
  out.splice(at === -1 ? base.length : at, 0, movedId);
  return out;
}
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `npx vitest run apps/crm/src/pages/entregas/__tests__/boardReorder.test.ts`
Expected: PASS, 8 testes.

- [ ] **Step 5: Commit**

```bash
git add apps/crm/src/pages/entregas/boardReorder.ts apps/crm/src/pages/entregas/__tests__/boardReorder.test.ts
git commit -m "feat(entregas): boardReorder preserva cards ocultos ao reordenar coluna

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 2.4: `KanbanView` reordena a coluna inteira

**Files:**
- Modify: `apps/crm/src/pages/entregas/views/KanbanView.tsx` (prop `allCards`, reorder dentro da coluna, insert entre colunas em `advanceEtapa` e `handleRevertConfirm`)
- Modify: `apps/crm/src/pages/entregas/EntregasPage.tsx` (passar `allCards={cards}` ao `KanbanView`, linha ~816)
- Test: `apps/crm/src/pages/entregas/views/__tests__/KanbanFullColumnOrder.test.tsx`

**Interfaces:**
- Consumes: `mergeVisibleReorder`, `insertIntoFullOrder` de `../boardReorder`; `buildBoardRows`, `columnKey`, `findCardColumn` de `../boardRows` (PR 1) ou a versão local se o PR 1 não tiver sido mergeado.
- Produces: `KanbanViewProps.allCards?: BoardCard[]`. Opcional: quando ausente, a coluna inteira é a própria lista recebida (comportamento atual; mantém os testes existentes e o `cliente-detalhe/tabs/EntregasTab`, se ele renderiza `KanbanView`, sem mudança).

- [ ] **Step 1: Escrever o teste que falha**

O dnd-kit não roda em jsdom, então o teste exercita a função interna por um prop de teste. Expor em `KanbanView` um helper puro que o componente usa e o teste importa:

```ts
// exportado de KanbanView.tsx (ao lado de KanbanView)
export function fullColumnOrder(
  allCards: BoardCard[] | undefined,
  visibleColumnCards: BoardCard[],
  rowKey: string,
  ordem: number,
  templates: WorkflowTemplate[],
  sortMode: 'prazo' | 'manual',
): number[]
```

que devolve os ids da coluna inteira `(rowKey, ordem)` na ordem exibida (por prazo ou por position), caindo na lista visível quando `allCards` é `undefined`.

```tsx
// apps/crm/src/pages/entregas/views/__tests__/KanbanFullColumnOrder.test.tsx
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../../store', () => ({
  completeEtapa: vi.fn(), completeEtapaWithRearm: vi.fn(), hasLaterApprovalEtapa: vi.fn(),
  approvePostsInternally: vi.fn(), sendPostsToCliente: vi.fn(), revertEtapa: vi.fn(),
  updateWorkflowPositions: vi.fn(), getDeadlineInfo: vi.fn(), addWorkflow: vi.fn(),
  addWorkflowEtapa: vi.fn(), addWorkflowTemplate: vi.fn(), removeWorkflowTemplate: vi.fn(),
  removeWorkflow: vi.fn(), updateWorkflow: vi.fn(), updateWorkflowEtapa: vi.fn(),
  updateWorkflowTemplate: vi.fn(), propagateTemplateToWorkflows: vi.fn(),
  getPropertyDefinitions: vi.fn(), deletePropertyDefinition: vi.fn(), getWorkflows: vi.fn(),
  getClientes: vi.fn(), getMembros: vi.fn(), getWorkflowTemplates: vi.fn(), getWorkflowEtapas: vi.fn(),
  getWorkflowPostsCounts: vi.fn(), getWorkflowApprovedPostsCounts: vi.fn(),
  getWorkflowClearedClientePostsCounts: vi.fn(), getWorkflowRevisaoInternaCounts: vi.fn(),
  getWorkflowAwaitingClientePostsCounts: vi.fn(), getWorkflowPostResponsaveis: vi.fn(),
  getWorkspaceSlug: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { fullColumnOrder } from '../KanbanView';
import type { BoardCard } from '../../hooks/useEntregasData';

const etapa = { id: 11, workflow_id: 1, ordem: 1, nome: 'Produção', prazo_dias: 2, tipo_prazo: 'corridos' as const, tipo: 'padrao' as const, status: 'ativo' as const };

function card(id: number, position: number): BoardCard {
  return {
    workflow: { id, cliente_id: 1, titulo: `WF ${id}`, status: 'ativo', etapa_atual: 1, recorrente: false, template_id: 7, position },
    etapa: { ...etapa, workflow_id: id },
    cliente: undefined, membro: undefined,
    deadline: { diasRestantes: 2, horasRestantes: 0, estourado: false, urgente: false },
    totalEtapas: 2, etapaIdx: 1, allEtapas: [{ ...etapa, workflow_id: id }],
  } as unknown as BoardCard;
}

describe('fullColumnOrder', () => {
  it('em modo manual devolve a coluna inteira por position, incluindo ocultos', () => {
    const all = [card(1, 0), card(2, 1), card(3, 2)];
    const visible = [all[0], all[2]];
    expect(fullColumnOrder(all, visible, 'template:7', 1, [], 'manual')).toEqual([1, 2, 3]);
  });

  it('sem allCards cai na lista visível', () => {
    const visible = [card(3, 0), card(1, 1)];
    expect(fullColumnOrder(undefined, visible, 'template:7', 1, [], 'manual')).toEqual([3, 1]);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run apps/crm/src/pages/entregas/views/__tests__/KanbanFullColumnOrder.test.tsx`
Expected: FAIL, `fullColumnOrder` não é exportado.

- [ ] **Step 3: Implementar em `KanbanView.tsx`**

1. Prop nova em `KanbanViewProps`: `allCards?: BoardCard[];` com o comentário: "Todos os cards ativos, sem o filtro da página. A ordem manual é gravada para a coluna inteira; sem esta prop, a coluna inteira é a lista visível (comportamento antigo)." Desestruturar `allCards` no componente.

2. Helper exportado, fora do componente:

```ts
export function fullColumnOrder(
  allCards: BoardCard[] | undefined,
  visibleColumnCards: BoardCard[],
  rowKey: string,
  ordem: number,
  templates: WorkflowTemplate[],
  sortMode: FluxosColumnSort,
): number[] {
  const source = allCards
    ? (buildBoardRows(allCards, templates)
        .find((r) => r.key === rowKey)
        ?.columns.find((c) => c.ordem === ordem)?.cards ?? visibleColumnCards)
    : visibleColumnCards;
  const ordered = sortMode === 'prazo' ? sortCardsByPrazo(source) : source;
  return ordered.map((c) => c.workflow.id!);
}
```

(`FluxosColumnSort` já é importado de `../entregasPrefs`; `WorkflowTemplate` de `../../../store`.)

3. No reorder dentro da coluna (bloco após `const reordered = arrayMove(col, oldIdx, newIdx);`), substituir a persistência:

```ts
const colOrdem = activeLocation.column.ordem;
const full = fullColumnOrder(allCards, activeLocation.column.cards, activeLocation.row.key, colOrdem, templates, sortModeFor(colKeyStr));
const merged = mergeVisibleReorder(full, reordered.map((c) => c.workflow.id!));

setPendingPositions((prev) => {
  const next = new Map(prev);
  merged.forEach((id, i) => next.set(id, i));
  return next;
});
if (sortModeFor(colKeyStr) === 'prazo') setColumnSort(colKeyStr, 'manual');

try {
  await updateWorkflowPositions(merged.map((id, i) => ({ id, position: i })));
  onRefresh();
} catch {
  setPendingPositions((prev) => {
    const next = new Map(prev);
    merged.forEach((id) => next.delete(id));
    return next;
  });
  toast.error('Erro ao salvar ordem dos cartões');
}
```

Nota: em modo `prazo` a coluna inteira é a ordem por prazo, e o `merged` materializa essa ordem para todos, como já acontecia para os visíveis.

4. No insert entre colunas (`handleDragEnd`, onde hoje monta `pendingInsertRef.current = { wfId, ids: targetDisplay.map(...), index: slotIndex, optimisticPos }`), guardar a coluna inteira:

```ts
const targetFull = fullColumnOrder(allCards, targetColumn.cards, targetRow.key, targetColumn.ordem, templates, sortModeFor(colKey));
pendingInsertRef.current = {
  wfId: draggedCard.workflow.id!,
  ids: insertIntoFullOrder(targetFull, targetDisplay.map((c) => c.workflow.id!), slotIndex, draggedCard.workflow.id!),
  optimisticPos,
};
```

e mudar o tipo do ref para `{ wfId: number; ids: number[]; optimisticPos: number } | null` (o `index` deixa de existir: `ids` já contém o card movido no lugar certo).

5. Em `advanceEtapa` e `handleRevertConfirm`, trocar

```ts
const order = [...insert.ids];
order.splice(insert.index, 0, wfId);
await updateWorkflowPositions(order.map((id, i) => ({ id, position: i })));
```

por

```ts
await updateWorkflowPositions(insert.ids.map((id, i) => ({ id, position: i })));
```

(nos dois lugares; em `handleRevertConfirm` o id é `revertTarget.workflowId`, já contido em `insert.ids`).

6. Em `EntregasPage.tsx`, na renderização do `KanbanView` (linha ~816, onde passa `cards={filteredCards}`), acrescentar `allCards={cards}`.

- [ ] **Step 4: Rodar os testes**

Run: `npx vitest run apps/crm/src/pages/entregas/`
Expected: PASS, inclusive `KanbanFullColumnOrder`, `KanbanSync`, `KanbanPrazoSort`, `KanbanRearm`, `EntregasPage`.

- [ ] **Step 5: Typecheck e lint**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit && npm run lint`
Expected: sem erros. Se `cliente-detalhe/tabs/EntregasTab.tsx` renderiza `KanbanView`, ele continua válido porque `allCards` é opcional.

- [ ] **Step 6: Commit**

```bash
git add apps/crm/src/pages/entregas/views/KanbanView.tsx apps/crm/src/pages/entregas/EntregasPage.tsx apps/crm/src/pages/entregas/views/__tests__/KanbanFullColumnOrder.test.tsx
git commit -m "fix(entregas): reordenar coluna do quadro de Fluxos preserva cards ocultos pelo filtro

A ordem manual era gravada só para os cards visíveis, com N updates em
paralelo. Agora a coluna inteira vai numa RPC atômica e os ocultos mantêm
a posição relativa.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 2.5: Migration em staging, verificação e PR

- [ ] **Step 1: Aplicar a migration em staging**

Conferir o link: `cat supabase/.temp/project-ref` deve ser `wlyzhyfondykzpsiqsce` (staging). Se for o de prod (`skjzpekeqefvlojenfsw`) ou não existir, seguir `reference_supabase_project_refs` da memória e usar `--project-ref` explícito. Depois `npx supabase db push --linked` (ou o caminho de migration fora de banda documentado em `reference_staging_ops_management_api` se o push recusar por migrations alheias).

- [ ] **Step 2: Verificar no browser contra staging**

Com o CRM em `dev:staging`: criar quatro fluxos do mesmo cliente na mesma etapa, filtrar por um responsável que deixe dois visíveis, arrastar um deles para cima, limpar o filtro e confirmar que os dois que estavam ocultos continuam na posição relativa original (não colidiram para o fim). Recarregar e confirmar que persiste. Screenshot antes e depois de limpar o filtro.

- [ ] **Step 3: Gate completo**

Run: `npm run lint && npm run format:check && npx tsc -p apps/crm/tsconfig.json --noEmit && npx tsc -p apps/hub/tsconfig.json --noEmit && npx tsc -p apps/admin/tsconfig.json --noEmit && npx tsc -p tsconfig.scripts.json && npm run test`
Expected: verde. Reconferir o prefixo da migration contra `git ls-tree --name-only origin/main:supabase/migrations | tail -1`; se main já tiver `20260917000001`, renomear para o próximo prefixo livre e reaplicar em staging.

- [ ] **Step 4: Push e PR**

```bash
git push -u origin fix/fluxos-reorder-coluna-inteira
gh pr create --base main --title "fix(entregas): reordenar coluna de Fluxos preserva cards ocultos e grava numa RPC atômica" --body "$(cat <<'EOF'
## Problema
O drag manual no quadro de Fluxos renumerava `workflows.position` 0..n só sobre os cards VISÍVEIS (a página passa `filteredCards`), com N UPDATEs em paralelo. Fluxos ocultos pelo filtro ficavam com posições colidentes.

## Mudança
- RPC `reorder_workflow_positions(bigint[], integer[])` no padrão de `reorder_board_posts` (conta-scoped, lock em ordem estável, all-or-nothing na posse). Suíte `82_reorder_workflow_positions.sql`.
- `updateWorkflowPositions` faz uma única chamada à RPC.
- `boardReorder.ts`: `mergeVisibleReorder` e `insertIntoFullOrder`, puros e testados.
- `KanbanView` recebe `allCards` e grava a coluna inteira nos três pontos (reorder na coluna, avançar, voltar).

Pré-requisito 2 de `docs/superpowers/specs/2026-09-10-posts-individuais-fluxos-design.md`.

## Rollout
Migration aplicada em staging antes de abrir o PR. **Aplicar em prod antes do merge**: o frontend novo chama a RPC.

## Verificação
- Testes novos: SQL (5 blocos), `updateWorkflowPositions` (3), `boardReorder` (8), `fullColumnOrder` (2).
- Browser em staging: filtro deixando 2 de 4 visíveis, drag, limpar filtro, ocultos preservados após reload (screenshots).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Aguardar o review do Codex e responder. Antes do merge, aplicar a migration em prod (memória `feedback_merge_deploys_frontend_migrations_first`).

---

## PR 3. Deep link `?drawer=` com fallback

Branch: `fix/entregas-deep-link-drawer-fallback`

Problema: em `EntregasPage.tsx:318-331` o link `?drawer=<wf>&post=<id>` só resolve por `cards.find(c => c.workflow.id === workflowId)`. Se o fluxo foi concluído, arquivado, excluído, ou o post foi desmembrado, `pendingDeepLink` fica guardado para sempre e nada abre nem avisa. O guard `cards.length === 0` também impede resolver num workspace vazio.

Solução: quando `isLoading` é falso e não há card correspondente, cair no resolvedor de `?post=` (que já existe, linhas 336-374) se houver `postId`; sem `postId`, toast "Fluxo não encontrado". O resolvedor de post, ao descobrir que o post ainda está num fluxo fora do quadro, não devolve ao resolvedor de cards (evita o pingue-pongue): mostra toast e encerra.

### Task 3.1: Fallback com testes de página

**Files:**
- Modify: `apps/crm/src/pages/entregas/EntregasPage.tsx:255-374`
- Test: `apps/crm/src/pages/entregas/__tests__/EntregasPage.test.tsx` (adicionar `describe`)

**Interfaces:**
- Consumes: `isLoading` de `useEntregasData()` (já desestruturado na linha 145), `getStandalonePost` do store, `toast` de sonner.
- Produces: estado interno `pendingDeepLink: { workflowId: number | null; postId: number | null; fromDrawerFallback?: boolean } | null`.

- [ ] **Step 1: Escrever os testes que falham**

Acrescentar ao final de `EntregasPage.test.tsx`, dentro do `describe` principal (usa `renderPage`, `mockedUseEntregasData`, `mockedGetStandalonePost`, `mockedToast`, `makeCard`, `wfFixture` já definidos no arquivo):

```tsx
describe('deep link ?drawer= quando o fluxo não está no quadro', () => {
  function renderWithBoard(entry: string) {
    mockedUseEntregasData.mockReturnValue({
      clientes: [],
      membros: [],
      templates: [],
      cards: [makeCard()],
      activeWorkflows: [wfFixture],
      isLoading: false,
      refresh: vi.fn(),
    } as never);
    return renderPage(entry);
  }

  it('abre o post avulso quando o post foi desmembrado do fluxo do link', async () => {
    mockedGetStandalonePost.mockResolvedValue({ id: 5, workflow_id: null } as never);
    renderWithBoard('/entregas?drawer=99&post=5');
    expect(await screen.findByText('Standalone drawer: 5')).toBeInTheDocument();
    expect(mockedGetStandalonePost).toHaveBeenCalledWith(5);
    expect(screen.getByTestId('current-path')).toHaveTextContent('/entregas');
  });

  it('avisa quando o post continua em um fluxo fora do quadro, sem entrar em loop', async () => {
    mockedGetStandalonePost.mockResolvedValue({ id: 5, workflow_id: 99 } as never);
    renderWithBoard('/entregas?drawer=99&post=5');
    await waitFor(() =>
      expect(mockedToast.error).toHaveBeenCalledWith(
        'Este post está em um fluxo que não aparece no quadro. Veja em Concluídas.',
      ),
    );
    expect(mockedGetStandalonePost).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Standalone drawer/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Workflow drawer/)).not.toBeInTheDocument();
  });

  it('avisa quando só o fluxo foi pedido e ele não existe', async () => {
    renderWithBoard('/entregas?drawer=99');
    await waitFor(() => expect(mockedToast.error).toHaveBeenCalledWith('Fluxo não encontrado'));
    expect(mockedGetStandalonePost).not.toHaveBeenCalled();
  });

  it('espera o carregamento antes de decidir que o fluxo não existe', async () => {
    mockedUseEntregasData.mockReturnValue({
      clientes: [],
      membros: [],
      templates: [],
      cards: [],
      activeWorkflows: [],
      isLoading: true,
      refresh: vi.fn(),
    } as never);
    renderPage('/entregas?drawer=99');
    await new Promise((r) => setTimeout(r, 0));
    expect(mockedToast.error).not.toHaveBeenCalled();
  });

  it('continua abrindo o drawer do fluxo quando o card existe', async () => {
    renderWithBoard('/entregas?drawer=1&post=5');
    expect(await screen.findByText('Workflow drawer: Fluxo Editorial')).toBeInTheDocument();
    expect(screen.getByTestId('drawer-initial-post')).toHaveTextContent('5');
    expect(mockedGetStandalonePost).not.toHaveBeenCalled();
  });
});
```

Conferir no arquivo que o mock do `WorkflowDrawer` renderiza `Workflow drawer: {card.workflow.titulo}` e `data-testid="drawer-initial-post"` (linhas ~297-298) e que o mock do `StandalonePostDrawer` renderiza `Standalone drawer: {postId}` (linha ~334). Se os textos forem outros, usar os do arquivo.

- [ ] **Step 2: Rodar os testes e confirmar que falham**

Run: `npx vitest run apps/crm/src/pages/entregas/__tests__/EntregasPage.test.tsx -t "deep link ?drawer="`
Expected: FAIL nos três primeiros (nada acontece: nenhum drawer, nenhum toast). O quarto e o quinto passam já hoje.

- [ ] **Step 3: Implementar o fallback**

Em `EntregasPage.tsx`:

1. Tipo do estado (linha ~255):

```ts
const [pendingDeepLink, setPendingDeepLink] = useState<{
  workflowId: number | null;
  postId: number | null;
  /** Chegou aqui porque o `?drawer=` não casou com nenhum card. Se o post ainda
   *  estiver em um fluxo, não devolver ao resolvedor de cards (evita loop). */
  fromDrawerFallback?: boolean;
} | null>(null);
```

2. Resolvedor de cards (substitui as linhas 318-331):

```ts
useEffect(() => {
  if (pendingDeepLink === null || pendingDeepLink.workflowId == null) return;
  // `cards` chega assíncrono: só decidir que o fluxo não existe depois do load.
  if (isLoading) return;
  const { workflowId, postId } = pendingDeepLink;
  const match = cards.find((c) => c.workflow.id === workflowId);
  if (match) {
    setPendingDeepLink(null);
    setStandalonePostId(null);
    setDrawerInitialPostId(postId);
    setDrawerCard(match);
    return;
  }
  // Fluxo concluído, arquivado, excluído, ou post desmembrado depois que o
  // link foi compartilhado. Com post no link, o post é o que interessa.
  if (postId != null) {
    setPendingDeepLink({ workflowId: null, postId, fromDrawerFallback: true });
    return;
  }
  toast.error('Fluxo não encontrado');
  setPendingDeepLink(null);
}, [cards, isLoading, pendingDeepLink]);
```

3. Resolvedor de post (linhas 336-374): no ramo `else` (post ainda com `workflow_id`), trocar

```ts
} else {
  setPendingDeepLink({ workflowId: post.workflow_id, postId });
}
```

por

```ts
} else if (pendingDeepLink.fromDrawerFallback) {
  // Já tentamos o quadro e o fluxo não está lá: parar aqui.
  toast.error('Este post está em um fluxo que não aparece no quadro. Veja em Concluídas.');
  setPendingDeepLink(null);
} else {
  // Reanexado depois que o link foi compartilhado: entregar ao resolvedor de cards.
  setPendingDeepLink({ workflowId: post.workflow_id, postId });
}
```

O `useEffect` do resolvedor de post já depende de `[pendingDeepLink]`; `fromDrawerFallback` faz parte do objeto, nada mais muda.

- [ ] **Step 4: Rodar os testes e confirmar que passam**

Run: `npx vitest run apps/crm/src/pages/entregas/__tests__/EntregasPage.test.tsx`
Expected: PASS em toda a suíte, inclusive os cinco novos.

- [ ] **Step 5: Typecheck, lint, commit**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit && npm run lint`

```bash
git add apps/crm/src/pages/entregas/EntregasPage.tsx apps/crm/src/pages/entregas/__tests__/EntregasPage.test.tsx
git commit -m "fix(entregas): deep link ?drawer= cai no post quando o fluxo não está no quadro

Um link ?drawer=<wf>&post=<id> ficava pendurado para sempre se o fluxo
tivesse sido concluído, arquivado ou o post desmembrado. Agora abre o post,
ou avisa quando nem isso é possível.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 3.2: Verificação e PR

- [ ] **Step 1: Verificar no browser contra staging**

Com o CRM em `dev:staging`: abrir um fluxo, copiar o link de um post (botão de copiar link no drawer, formato `?drawer=<wf>&post=<id>`), desmembrar o post pelo drawer do fluxo, colar o link: o drawer avulso abre. Depois concluir um fluxo e abrir `?drawer=<id>` dele: toast "Fluxo não encontrado". Screenshots dos dois.

- [ ] **Step 2: Gate completo e PR**

Run: `npm run lint && npm run format:check && npx tsc -p apps/crm/tsconfig.json --noEmit && npx tsc -p apps/hub/tsconfig.json --noEmit && npx tsc -p apps/admin/tsconfig.json --noEmit && npx tsc -p tsconfig.scripts.json && npm run test`

```bash
git push -u origin fix/entregas-deep-link-drawer-fallback
gh pr create --base main --title "fix(entregas): deep link ?drawer= com fallback para o post" --body "$(cat <<'EOF'
## Problema
`?drawer=<wf>&post=<id>` só resolvia por `cards.find(...)`. Fluxo concluído, arquivado, excluído ou post desmembrado: o link ficava pendurado, sem drawer e sem aviso.

## Mudança
- Depois do carregamento, sem card correspondente: com `post` no link, cai no resolvedor de `?post=` já existente; sem `post`, toast "Fluxo não encontrado".
- O resolvedor de post, quando entrou por esse fallback e o post ainda está num fluxo fora do quadro, avisa e para (sem pingue-pongue entre os dois resolvedores).

Pré-requisito 3 de `docs/superpowers/specs/2026-09-10-posts-individuais-fluxos-design.md`.

## Verificação
- 5 testes novos em `EntregasPage.test.tsx`.
- Browser em staging: link de post desmembrado abre o avulso; link de fluxo concluído avisa (screenshots).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Aguardar o review do Codex e responder.

---

## PR 4. Gate do quadro de exemplo e do tour

Branch: `fix/entregas-example-board-gate`

Problema: `EntregasPage.tsx:193` decide `showExample = activeWorkflows.length === 0 && (!tourDone || replayActive)`, e `shouldAutoStartTour` recebe esse `showExample`. Quando o quadro passar a ter cards que não são fluxos, um workspace só com posts individuais veria o quadro falso de fluxos e o tour dispararia ancorado em `[data-tour="wf-card"]` no card errado ou em nada.

Este PR é pequeno de propósito: extrai a decisão para um módulo puro com testes e cria o único ponto (`activeBoardCount`) que a feature vai estender. Não muda comportamento hoje.

### Task 4.1: `exampleGate.ts` e uso na página

**Files:**
- Create: `apps/crm/src/pages/entregas/tour/exampleGate.ts`
- Modify: `apps/crm/src/pages/entregas/EntregasPage.tsx:189-193`
- Test: `apps/crm/src/pages/entregas/__tests__/exampleGate.test.ts`

**Interfaces:**
- Produces: `shouldShowExample(i: { activeBoardCount: number; tourDone: boolean; replayActive: boolean }): boolean`.

- [ ] **Step 1: Escrever o teste que falha**

```ts
// apps/crm/src/pages/entregas/__tests__/exampleGate.test.ts
import { describe, expect, it } from 'vitest';
import { shouldShowExample } from '../tour/exampleGate';

describe('shouldShowExample', () => {
  it('mostra o exemplo no primeiro acesso sem nenhum card', () => {
    expect(shouldShowExample({ activeBoardCount: 0, tourDone: false, replayActive: false })).toBe(true);
  });

  it('não mostra quando existe qualquer card ativo, mesmo antes do tour', () => {
    expect(shouldShowExample({ activeBoardCount: 1, tourDone: false, replayActive: false })).toBe(false);
  });

  it('não mostra depois do tour, exceto em replay', () => {
    expect(shouldShowExample({ activeBoardCount: 0, tourDone: true, replayActive: false })).toBe(false);
    expect(shouldShowExample({ activeBoardCount: 0, tourDone: true, replayActive: true })).toBe(true);
  });

  it('replay com cards ativos não mostra o exemplo', () => {
    expect(shouldShowExample({ activeBoardCount: 2, tourDone: true, replayActive: true })).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `npx vitest run apps/crm/src/pages/entregas/__tests__/exampleGate.test.ts`
Expected: FAIL, `Cannot find module '../tour/exampleGate'`.

- [ ] **Step 3: Implementar e ligar**

```ts
// apps/crm/src/pages/entregas/tour/exampleGate.ts
/**
 * O quadro de exemplo (e o tour que ele ancora) só faz sentido num quadro de
 * Fluxos sem NENHUM card ativo. `activeBoardCount` conta todo tipo de card que
 * o quadro renderiza: hoje só fluxos; a feature de posts individuais soma os
 * processos ativos aqui, e em nenhum outro lugar.
 */
export function shouldShowExample(i: {
  activeBoardCount: number;
  tourDone: boolean;
  replayActive: boolean;
}): boolean {
  return i.activeBoardCount === 0 && (!i.tourDone || i.replayActive);
}
```

Em `EntregasPage.tsx`, substituir as linhas 189-193 por:

```ts
// The example board stands in for a real board on an empty first visit, and comes back
// temporarily during a replay. A board emptied by filters (but with real cards) shows the
// plain "Nenhuma entrega" message instead — hence the unfiltered count, not filteredCards.
// activeBoardCount is the single place to extend when the board gains new card kinds.
const activeBoardCount = activeWorkflows.length;
const showExample = shouldShowExample({ activeBoardCount, tourDone, replayActive });
```

e importar `shouldShowExample` de `./tour/exampleGate` ao lado do import de `shouldAutoStartTour` (linha 29).

- [ ] **Step 4: Rodar os testes**

Run: `npx vitest run apps/crm/src/pages/entregas/__tests__/exampleGate.test.ts apps/crm/src/pages/entregas/__tests__/EntregasPage.test.tsx apps/crm/src/pages/entregas/__tests__/tourGating.test.ts`
Expected: PASS. Os testes de página que cobrem o quadro de exemplo e o tour (`Posts de Agosto`, `Ocultar exemplo`, `startEntregasTour`) continuam verdes.

- [ ] **Step 5: Typecheck, lint, commit**

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit && npm run lint`

```bash
git add apps/crm/src/pages/entregas/tour/exampleGate.ts apps/crm/src/pages/entregas/__tests__/exampleGate.test.ts apps/crm/src/pages/entregas/EntregasPage.tsx
git commit -m "refactor(entregas): gate do quadro de exemplo por contagem de cards do quadro

Extrai shouldShowExample e cria activeBoardCount como o único ponto a
estender quando o quadro ganhar cards que não são fluxos.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

### Task 4.2: Gate completo e PR

- [ ] **Step 1: Gate completo**

Run: `npm run lint && npm run format:check && npx tsc -p apps/crm/tsconfig.json --noEmit && npx tsc -p apps/hub/tsconfig.json --noEmit && npx tsc -p apps/admin/tsconfig.json --noEmit && npx tsc -p tsconfig.scripts.json && npm run test`
Expected: verde. Sem verificação de browser: não há mudança observável.

- [ ] **Step 2: Push e PR**

```bash
git push -u origin fix/entregas-example-board-gate
gh pr create --base main --title "refactor(entregas): gate do quadro de exemplo por contagem de cards" --body "$(cat <<'EOF'
## Contexto
`showExample` (e por tabela o auto-start do tour) olha só `activeWorkflows.length`. Quando o quadro de Fluxos ganhar cards de posts individuais, um workspace só com esses cards veria o quadro falso de fluxos ou dispararia o tour ancorado no card errado.

## Mudança
- `tour/exampleGate.ts`: `shouldShowExample({ activeBoardCount, tourDone, replayActive })`, puro e testado.
- `EntregasPage`: `activeBoardCount` é o único ponto a estender. Sem mudança de comportamento hoje.

Pré-requisito 4 de `docs/superpowers/specs/2026-09-10-posts-individuais-fluxos-design.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Aguardar o review do Codex e responder.

---

## Ordem de execução e merge

Os quatro PRs são independentes e podem ser abertos em paralelo, cada um de `origin/main`. Só o PR 2 tem migration, e ela precisa estar em prod antes do merge dele. Recomendação de merge: 4, 3, 1, 2 (do menor conflito para o maior). Se o PR 2 for mergeado antes do PR 1, o PR 1 precisa de rebase para usar `column.cards` no lugar de `row.columns.get(name)` em `fullColumnOrder`.

Depois dos quatro em main, atualizar a memória `project_posts_individuais_fluxos` com o estado e voltar à spec para o plano da feature.
