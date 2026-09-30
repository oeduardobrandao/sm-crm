# Entregas: Lista agrupada + painel Responsáveis. Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Entregas **Lista** tab a ClickUp-style view: rows split into collapsible groups ("Agrupar por": prazo da etapa, data de postagem, cliente, responsável, etapa, nenhum) plus a "Responsáveis" side panel that shows how many rows each member has and filters by member.

**Architecture:** Frontend-only. No migration, no edge function. The grouping choice is new page state serialized as `agrupar=` in the existing shareable query (`viewQuery.ts`), remembered per conta in `localStorage` (`entregasPrefs.ts`). A pure module (`listGrouping.ts`) turns already-sorted rows into ordered groups. Both list views (`ListView` for Fluxos, `PostsListView` for Publicações) render one `<tbody>` per group with a shared header row. The Responsáveis panel is a different UI for the **existing** `filterMembros` filter; its counts are facets computed from the page's filter chains with the responsável filter removed, which requires extracting those chains from `EntregasPage` into `boardFilters.ts`.

**Tech Stack:** React 19, TypeScript, Tailwind + CRM `style.css` tokens, shadcn/ui (`Select`, `Checkbox`, `Sheet`), lucide-react, Vitest + Testing Library.

## Decisions (settled, do not reopen during execution)

- **Default grouping is `prazo`.** Every existing Lista user goes from a flat table to a grouped one. What makes that acceptable is that the choice is **persisted per conta**: one switch to "Nenhum" sticks. Persistence is in scope.
- **Both Lista modes get grouping.** "Data de postagem" exists only in Publicações. In Fluxos a stored `postagem` renders as `prazo`, without erasing the stored choice.
- **Date groups reuse Minha fila's buckets** (`filaBucketOf`): Atrasado, Hoje, Amanhã, then one group per weekday for +2..+7 days ("Sexta-feira · 2 out"), then Depois, then Sem prazo/Sem data. Rows keep the table's column sort inside each group.
- **"Responsável" everywhere follows the existing filter rule:**
  - Publicações: the responsável of the etapa the post is in (fluxo or processo individual). Without an etapa, it's the post's own `responsavel_id` (`postResponsavelIdOf`, new).
  - Fluxos: the responsável of the current etapa of the fluxo or processo.
  - The Publicações cell, sort and grouping switch to this rule too. Today the cell shows "—" for an avulso without an etapa, while the filter matches it by `responsavel_id`, so a "Bia (1)" group would contain a row whose Responsável cell reads "—".
- **Panel counts are facets.** They are computed with every active filter except the responsável filter, so checking Ana doesn't zero out everyone else. They respect the Fluxos entity toggle (cards only when `entidade !== 'posts'`, processos only when `entidade !== 'fluxos'`).
- **Panel placement:** inline `<aside>` at ≥901px (`useIsDesktop(901)`, the same breakpoint as the filter pills), bottom `Sheet` below 901px. Below 901px the Lista toolbar also leaves the horizontally scrolling tabs row for a row of its own (Task 9, step 10).
- **Mockups:** https://claude.ai/artifact/PeuTauLf7N16k3nfE8EX6f (antes/depois, alternativa sobreposta, modo Etapas, tema escuro, celular).
- **Docked aside, not an overlay** (user's choice, 2026-09-30). With the aside open the 9-column Publicações table loses 276px and scrolls horizontally inside its card on laptop widths. That cost is accepted.

## Global Constraints

- UI copy in Portuguese. **No em-dashes in new user-facing strings** (use period, colon or middle dot "·").
- No new dependencies. Icons from `lucide-react` only.
- `agrupar=` is written **only** for `view=list` and **only** when the value is not `prazo`. Saved vistas (`VistasTabs`) match by exact string equality, so a pre-existing saved Lista vista must keep matching.
- Components rendered under `EntregasPage` (`ListToolbar`, `ResponsaveisPanel`, `ListGroupHeaderRow`, the two list views) must **not import runtime values** from `@/store` / `../../../store` or from `./components/EntregasFilters`. `EntregasPage.test.tsx` mocks both modules wholesale, so any export it doesn't list is `undefined` at render. `import type` is fine.
- Red text uses `var(--danger-text)`, never `var(--danger)` (`--danger` fails AA as text on light cards; see DESIGN_SYSTEM.md).
- Keep `filteredCards` / `filteredPosts` memoized in `EntregasPage`: Visão geral and Calendário re-animate on a fresh `filteredCards` identity (comment above `filteredCards`).
- Never use `useBlocker` (CLAUDE.md).
- Run `npm run format` before every commit (CI `format-check` gates).
- Test runner: `npx vitest run <path>` from the repo root.
- Commit messages: conventional commits with Portuguese descriptions, ending with the `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` trailer.

## File map

| File | Status | Responsibility |
|---|---|---|
| `apps/crm/src/pages/entregas/viewQuery.ts` | modify | `ListGroupBy` type/values/default, `agrupar=` (de)serialization |
| `apps/crm/src/pages/entregas/entregasPrefs.ts` | modify | `loadListGroupBy` / `persistListGroupBy` |
| `apps/crm/src/pages/entregas/listGrouping.ts` | **create** | `groupListRows`, `countByResponsavel`, `toggleKey` (pure) |
| `apps/crm/src/pages/entregas/postStage.ts` | modify | `postResponsavelIdOf` |
| `apps/crm/src/pages/entregas/boardFilters.ts` | **create** | `filterBoardCards`, `filterActivePosts` (moved out of the page) |
| `apps/crm/src/pages/entregas/components/ListGroupHeaderRow.tsx` | **create** | collapsible group header `<tr>` |
| `apps/crm/src/pages/entregas/views/PostsListView.tsx` | modify | grouped rendering, unified responsável |
| `apps/crm/src/pages/entregas/views/ListView.tsx` | modify | grouped rendering |
| `apps/crm/src/pages/entregas/components/ListToolbar.tsx` | **create** | "Agrupar por" select + Responsáveis toggle |
| `apps/crm/src/pages/entregas/components/ResponsaveisPanel.tsx` | **create** | member checklist with facet counts |
| `apps/crm/src/pages/entregas/EntregasPage.tsx` | modify | state, URL/prefs wiring, facet counts, layout |
| `apps/crm/style.css` | modify (append) | `.list-group-*` rules |
| tests | create/modify | one per unit above, plus `EntregasPage.test.tsx` |

---

### Task 1: `agrupar=` in the URL and per-conta preference

**Files:**
- Modify: `apps/crm/src/pages/entregas/viewQuery.ts`
- Modify: `apps/crm/src/pages/entregas/entregasPrefs.ts`
- Modify: `apps/crm/src/pages/entregas/EntregasPage.tsx` (temporary default only)
- Test: `apps/crm/src/pages/entregas/__tests__/viewQuery.test.ts`
- Test: `apps/crm/src/pages/entregas/__tests__/entregasPrefs.test.ts`

**Interfaces:**
- Produces (from `viewQuery.ts`): `type ListGroupBy = 'prazo' | 'postagem' | 'cliente' | 'responsavel' | 'etapa' | 'nenhum'`, `LIST_GROUP_BYS: readonly ListGroupBy[]` (that order), `DEFAULT_LIST_GROUP_BY: ListGroupBy = 'prazo'`, and `EntregasViewState.listGroupBy: ListGroupBy`.
- Produces (from `entregasPrefs.ts`): `loadListGroupBy(contaId: string): ListGroupBy | null`, `persistListGroupBy(contaId: string, groupBy: ListGroupBy): void`. Storage key: `` `entregas_list_group_${contaId}` ``.

- [ ] **Step 1: Write the failing viewQuery tests**

In `apps/crm/src/pages/entregas/__tests__/viewQuery.test.ts`:

1. In `'serializes the default state to an empty query'`, add `listGroupBy: 'prazo',` to the object passed to `serializeEntregasQuery` (after `filaMembro: null,`).
2. In `'round-trips a fully loaded state'` (the one with `view: 'list' as const`), add `listGroupBy: 'cliente' as const,` after `filaMembro: null,`.
3. In `'round-trips view=fila with an explicit membro'`, add `listGroupBy: 'prazo' as const,` after `filaMembro: 12,`.

(These are the only two `toEqual(state)` round-trips: `grep -n "toEqual(state)"` shows lines 47 and 124.) Then add this block at the end of the top-level `describe('viewQuery', …)`:

```ts
  describe('agrupar (Lista)', () => {
    const base = {
      mode: 'entregas' as const,
      entidade: 'fluxos' as const,
      filaMembro: null,
      filters: EMPTY_FILTERS,
    };

    it('omits the default prazo and emits the others, only on view=list', () => {
      expect(serializeEntregasQuery({ ...base, view: 'list', listGroupBy: 'prazo' })).toBe(
        'view=list',
      );
      expect(serializeEntregasQuery({ ...base, view: 'list', listGroupBy: 'cliente' })).toBe(
        'view=list&agrupar=cliente',
      );
      expect(serializeEntregasQuery({ ...base, view: 'kanban', listGroupBy: 'cliente' })).toBe('');
    });

    it('parses agrupar only for view=list and falls back to prazo', () => {
      const parse = (qs: string) => parseEntregasQuery(new URLSearchParams(qs)).listGroupBy;
      expect(parse('view=list&agrupar=etapa')).toBe('etapa');
      expect(parse('view=list&agrupar=nenhum')).toBe('nenhum');
      expect(parse('view=list&agrupar=xyz')).toBe('prazo');
      expect(parse('view=list')).toBe('prazo');
      expect(parse('view=kanban&agrupar=etapa')).toBe('prazo');
    });

    it('writes agrupar right after the view params, before the filters', () => {
      expect(
        serializeEntregasQuery({
          ...base,
          view: 'list',
          mode: 'publicacoes',
          listGroupBy: 'responsavel',
          filters: { ...EMPTY_FILTERS, filterClientes: [3] },
        }),
      ).toBe('view=list&mode=publicacoes&agrupar=responsavel&clientes=3');
    });
  });
```

- [ ] **Step 2: Write the failing prefs tests**

In `apps/crm/src/pages/entregas/__tests__/entregasPrefs.test.ts`, add `loadListGroupBy,` and `persistListGroupBy,` to the existing import list from `'../entregasPrefs'`, then append:

```ts
describe('agrupar da Lista', () => {
  beforeEach(() => localStorage.clear());

  it('devolve null sem preferência gravada e com lixo gravado', () => {
    expect(loadListGroupBy('c1')).toBeNull();
    localStorage.setItem('entregas_list_group_c1', 'xyz');
    expect(loadListGroupBy('c1')).toBeNull();
  });

  it('grava e lê por conta', () => {
    persistListGroupBy('c1', 'nenhum');
    persistListGroupBy('c2', 'cliente');
    expect(loadListGroupBy('c1')).toBe('nenhum');
    expect(loadListGroupBy('c2')).toBe('cliente');
  });
});
```

- [ ] **Step 3: Run both to verify they fail**

Run: `npx vitest run apps/crm/src/pages/entregas/__tests__/viewQuery.test.ts apps/crm/src/pages/entregas/__tests__/entregasPrefs.test.ts`
Expected: FAIL. The round-trips miss `listGroupBy`, `agrupar=` is never written, and `loadListGroupBy is not a function`.

- [ ] **Step 4: Implement in `viewQuery.ts`**

Right after `const ENTIDADES: readonly EntidadeFilter[] = ['todos', 'fluxos', 'posts'];` add:

```ts
/** "Agrupar por" da vista Lista. `prazo` é o default do parser/serializador e
 *  sai da URL, para que vistas salvas antigas da Lista continuem casando por
 *  igualdade de string. */
export type ListGroupBy = 'prazo' | 'postagem' | 'cliente' | 'responsavel' | 'etapa' | 'nenhum';
export const LIST_GROUP_BYS: readonly ListGroupBy[] = [
  'prazo',
  'postagem',
  'cliente',
  'responsavel',
  'etapa',
  'nenhum',
];
export const DEFAULT_LIST_GROUP_BY: ListGroupBy = 'prazo';
```

In `interface EntregasViewState`, after the `filaMembro` field add:

```ts
  /** Only meaningful for view 'list': how the Lista splits its rows. */
  listGroupBy: ListGroupBy;
```

In `serializeEntregasQuery`, directly after the line `if (state.view === 'fila' && state.filaMembro != null) p.set('membro', String(state.filaMembro));` add:

```ts
  if (state.view === 'list' && state.listGroupBy !== DEFAULT_LIST_GROUP_BY)
    p.set('agrupar', state.listGroupBy);
```

In `parseEntregasQuery`, directly after the `const filaMembro = …;` line add:

```ts
  const rawAgrupar = p.get('agrupar') as ListGroupBy | null;
  const listGroupBy: ListGroupBy =
    view === 'list' && rawAgrupar && LIST_GROUP_BYS.includes(rawAgrupar)
      ? rawAgrupar
      : DEFAULT_LIST_GROUP_BY;
```

and change the final return to `return { view, mode, entidade, filaMembro, listGroupBy, filters };`.

- [ ] **Step 5: Implement in `entregasPrefs.ts`**

Change the first-line import `import type { EntidadeFilter } from './viewQuery';` to:

```ts
import type { EntidadeFilter, ListGroupBy } from './viewQuery';
```

Append at the end of the file:

```ts
const listGroupKey = (contaId: string) => `entregas_list_group_${contaId}`;
// Cópia local da lista válida, como ENTIDADES acima: importar o valor de
// viewQuery puxaria EntregasFilters e o store para este módulo.
const LIST_GROUPS: ListGroupBy[] = ['prazo', 'postagem', 'cliente', 'responsavel', 'etapa', 'nenhum'];

/** Último "Agrupar por" da Lista, por conta. null sem preferência gravada (ou
 *  com lixo): a página cai no padrão, prazo. */
export function loadListGroupBy(contaId: string): ListGroupBy | null {
  try {
    const raw = localStorage.getItem(listGroupKey(contaId));
    return raw && (LIST_GROUPS as string[]).includes(raw) ? (raw as ListGroupBy) : null;
  } catch {
    return null;
  }
}

export function persistListGroupBy(contaId: string, groupBy: ListGroupBy): void {
  try {
    localStorage.setItem(listGroupKey(contaId), groupBy);
  } catch {
    // Best effort: a preferência só não sobrevive ao reload.
  }
}
```

- [ ] **Step 6: Keep `EntregasPage` compiling (temporary default)**

`serializeEntregasQuery` now requires `listGroupBy`. In `EntregasPage.tsx`, add `DEFAULT_LIST_GROUP_BY,` to the existing `import { parseEntregasQuery, serializeEntregasQuery, type ActiveView, type EntidadeFilter } from './viewQuery';` block, and in the `const currentQuery = serializeEntregasQuery({ … })` call add `listGroupBy: DEFAULT_LIST_GROUP_BY,` after the `filaMembro: …` line. Task 9 replaces this with real state.

- [ ] **Step 7: Run tests and typecheck**

Run: `npx vitest run apps/crm/src/pages/entregas/__tests__/viewQuery.test.ts apps/crm/src/pages/entregas/__tests__/entregasPrefs.test.ts apps/crm/src/pages/entregas/__tests__/EntregasPage.test.tsx`
Expected: PASS. `EntregasPage.test.tsx` still expects `/entregas?view=list` after clicking "Lista", and that holds because `prazo` is omitted.

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
npm run format
git add apps/crm/src/pages/entregas/viewQuery.ts apps/crm/src/pages/entregas/entregasPrefs.ts apps/crm/src/pages/entregas/EntregasPage.tsx apps/crm/src/pages/entregas/__tests__/viewQuery.test.ts apps/crm/src/pages/entregas/__tests__/entregasPrefs.test.ts
git commit -m "feat(entregas): agrupar= na URL da Lista e preferência por conta

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `listGrouping.ts` (pure grouping)

**Files:**
- Create: `apps/crm/src/pages/entregas/listGrouping.ts`
- Test: `apps/crm/src/pages/entregas/__tests__/listGrouping.test.ts`

**Interfaces:**
- Consumes: `ListGroupBy` (Task 1). Also `filaBucketOf(prazoDate: Date | null, deadline: DeadlineInfo, now: Date): FilaBucket` from `minhaFila.ts`, and `dayNum`, `dayDiff(when, now)`, `formatEtapaDeadlineDay(d, now)`, `type DeadlineInfo` from `etapaPrazo.ts`. All of these already exist.
- Produces:
  - `interface ListGroupAccessors<T> { prazo(row): { date: Date | null; deadline: DeadlineInfo } | undefined; postagem?(row): Date | null; cliente(row): { id: number | null; nome: string }; responsavel(row): { id: number | null; nome: string }; etapa(row): string }`
  - `interface ListGroup<T> { key: string; label: string; sub?: string; danger: boolean; rows: T[] }`
  - `groupListRows<T>(rows: readonly T[], by: Exclude<ListGroupBy, 'nenhum'>, acc: ListGroupAccessors<T>, now: Date): ListGroup<T>[]`
  - `countByResponsavel(ids: Iterable<number | null | undefined>): Map<number, number>`
  - `toggleKey(set: ReadonlySet<string>, key: string): Set<string>`

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/pages/entregas/__tests__/listGrouping.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
// listGrouping -> minhaFila -> store, que puxa o cliente supabase; o automock
// deixa o import inerte (mesmo motivo de minhaFila.test.ts).
vi.mock('../../../lib/supabase');
import {
  countByResponsavel,
  groupListRows,
  toggleKey,
  type ListGroup,
  type ListGroupAccessors,
} from '../listGrouping';
import type { DeadlineInfo } from '../etapaPrazo';

// Fixed "now": quarta-feira 2026-09-30, 10:00 local.
const NOW = new Date(2026, 8, 30, 10, 0, 0);
const OK: DeadlineInfo = { diasRestantes: 1, horasRestantes: 0, estourado: false, urgente: false };
const LATE: DeadlineInfo = { diasRestantes: -1, horasRestantes: 0, estourado: true, urgente: false };
/** Data local `n` dias depois do dia de NOW, às `h` horas. */
const day = (n: number, h = 9) => new Date(2026, 8, 30 + n, h, 0, 0);

interface Row {
  id: string;
  prazo?: { date: Date | null; deadline: DeadlineInfo };
  postagem?: Date | null;
  cliente?: { id: number | null; nome: string };
  resp?: { id: number | null; nome: string };
  etapa?: string;
}

const acc: ListGroupAccessors<Row> = {
  prazo: (r) => r.prazo,
  postagem: (r) => r.postagem ?? null,
  cliente: (r) => r.cliente ?? { id: null, nome: '' },
  responsavel: (r) => r.resp ?? { id: null, nome: '' },
  etapa: (r) => r.etapa ?? '',
};

const summary = (groups: ListGroup<Row>[]) =>
  groups.map((g) => [g.label, g.sub ?? null, g.rows.map((r) => r.id)]);

describe('groupListRows', () => {
  it('prazo: Atrasado, Hoje, Amanhã, um grupo por dia da semana até +7, Depois, Sem prazo', () => {
    const rows: Row[] = [
      { id: 'a', prazo: { date: day(8), deadline: OK } },
      { id: 'b', prazo: { date: day(0), deadline: LATE } },
      { id: 'c', prazo: { date: day(2), deadline: OK } },
      { id: 'd' },
      { id: 'e', prazo: { date: day(1), deadline: OK } },
      { id: 'f', prazo: { date: day(0, 18), deadline: OK } },
      { id: 'g', prazo: { date: day(7), deadline: OK } },
      { id: 'h', prazo: { date: day(-2), deadline: OK } },
      { id: 'i', prazo: { date: day(2, 15), deadline: OK } },
    ];
    const groups = groupListRows(rows, 'prazo', acc, NOW);
    expect(summary(groups)).toEqual([
      ['Atrasado', null, ['b', 'h']],
      ['Hoje', null, ['f']],
      ['Amanhã', null, ['e']],
      ['Sexta-feira', '2 out', ['c', 'i']],
      ['Quarta-feira', '7 out', ['g']],
      ['Depois', null, ['a']],
      ['Sem prazo', null, ['d']],
    ]);
    expect(groups.map((g) => g.danger)).toEqual([true, false, false, false, false, false, false]);
    expect(groups[0].key).toBe('prazo:atrasado');
    expect(groups[3].key).toBe('prazo:dia:20261002');
  });

  it('postagem: passado vira "Data passada" (sem vermelho) e sem data vira "Sem data"', () => {
    const rows: Row[] = [
      { id: 'a', postagem: null },
      { id: 'b', postagem: day(-1, 20) },
      { id: 'c', postagem: day(0, 8) },
    ];
    const groups = groupListRows(rows, 'postagem', acc, NOW);
    expect(summary(groups)).toEqual([
      ['Data passada', null, ['b']],
      ['Hoje', null, ['c']],
      ['Sem data', null, ['a']],
    ]);
    expect(groups.every((g) => !g.danger)).toBe(true);
    expect(groups.map((g) => g.key)).toEqual([
      'postagem:atrasado',
      'postagem:hoje',
      'postagem:sem_prazo',
    ]);
  });

  it('postagem sem o acessor (Lista de Fluxos) agrupa por prazo', () => {
    const { postagem: _omit, ...semPostagem } = acc;
    const rows: Row[] = [{ id: 'a', prazo: { date: day(1), deadline: OK } }];
    const groups = groupListRows(rows, 'postagem', semPostagem, NOW);
    expect(summary(groups)).toEqual([['Amanhã', null, ['a']]]);
    expect(groups[0].key).toBe('prazo:amanha');
  });

  it('cliente: alfabético sem acento, "Sem cliente" por último, chave pelo id', () => {
    const rows: Row[] = [
      { id: 'a', cliente: { id: 2, nome: 'Beta' } },
      { id: 'b', cliente: { id: 1, nome: 'Álvaro' } },
      { id: 'c' },
      { id: 'd', cliente: { id: 2, nome: 'Beta' } },
    ];
    const groups = groupListRows(rows, 'cliente', acc, NOW);
    expect(summary(groups)).toEqual([
      ['Álvaro', null, ['b']],
      ['Beta', null, ['a', 'd']],
      ['Sem cliente', null, ['c']],
    ]);
    expect(groups.map((g) => g.key)).toEqual(['cliente:1', 'cliente:2', 'cliente:none']);
  });

  it('responsável: id sem nome vira "Sem nome"; sem id vai para "Sem responsável" no fim', () => {
    const rows: Row[] = [
      { id: 'a', resp: { id: 9, nome: '' } },
      { id: 'b' },
      { id: 'c', resp: { id: 7, nome: 'Ana' } },
    ];
    expect(summary(groupListRows(rows, 'responsavel', acc, NOW))).toEqual([
      ['Ana', null, ['c']],
      ['Sem nome', null, ['a']],
      ['Sem responsável', null, ['b']],
    ]);
  });

  it('etapa: alfabético, "Sem etapa" por último', () => {
    const rows: Row[] = [{ id: 'a', etapa: 'Design' }, { id: 'b' }, { id: 'c', etapa: 'Copy' }];
    expect(summary(groupListRows(rows, 'etapa', acc, NOW))).toEqual([
      ['Copy', null, ['c']],
      ['Design', null, ['a']],
      ['Sem etapa', null, ['b']],
    ]);
  });
});

describe('countByResponsavel', () => {
  it('conta por id e ignora quem não tem responsável', () => {
    expect(countByResponsavel([7, null, 7, 9, undefined])).toEqual(
      new Map([
        [7, 2],
        [9, 1],
      ]),
    );
  });
});

describe('toggleKey', () => {
  it('devolve um Set novo com a chave alternada', () => {
    const a = new Set(['x']);
    const b = toggleKey(a, 'y');
    expect([...b]).toEqual(['x', 'y']);
    expect([...toggleKey(b, 'x')]).toEqual(['y']);
    expect([...a]).toEqual(['x']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run apps/crm/src/pages/entregas/__tests__/listGrouping.test.ts`
Expected: FAIL with "Failed to resolve import ../listGrouping".

- [ ] **Step 3: Implement**

Create `apps/crm/src/pages/entregas/listGrouping.ts`:

```ts
import type { ListGroupBy } from './viewQuery';
import { dayDiff, dayNum, formatEtapaDeadlineDay, type DeadlineInfo } from './etapaPrazo';
import { filaBucketOf, type FilaBucket } from './minhaFila';

// "Agrupar por" da vista Lista (Entregas). Puro: sem React, sem fetch. As faixas
// de data são as mesmas da Minha fila (filaBucketOf), com "Próximos 7 dias"
// aberto em um grupo por dia da semana.

/** O que cada agrupamento lê de uma linha. */
export interface ListGroupAccessors<T> {
  /** Prazo da etapa em que a linha está. undefined = sem etapa ("Sem prazo"). */
  prazo: (row: T) => { date: Date | null; deadline: DeadlineInfo } | undefined;
  /** Data de postagem. A Lista de Fluxos não tem (um fluxo tem vários posts):
   *  sem este acessor, `postagem` agrupa por prazo. */
  postagem?: (row: T) => Date | null;
  cliente: (row: T) => { id: number | null; nome: string };
  responsavel: (row: T) => { id: number | null; nome: string };
  etapa: (row: T) => string;
}

export interface ListGroup<T> {
  /** Única entre agrupamentos ("prazo:hoje", "cliente:12"): recolher "Hoje" no
   *  prazo não recolhe "Hoje" na data de postagem. */
  key: string;
  label: string;
  /** Data de um grupo de dia da semana, ex. "2 out". */
  sub?: string;
  /** Rótulo em vermelho. Só o "Atrasado" do prazo da etapa. */
  danger: boolean;
  /** Na ordem de entrada: a ordenação da tabela vale dentro de cada grupo. */
  rows: T[];
}

type GroupDim = Exclude<ListGroupBy, 'nenhum'>;
type DateBucket = Exclude<FilaBucket, 'proximos7'>;

const WEEKDAYS = [
  'Domingo',
  'Segunda-feira',
  'Terça-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sábado',
];

/** Data de postagem não "estoura": só a data decide a faixa. */
const SEM_ESTOURO: DeadlineInfo = {
  diasRestantes: 0,
  horasRestantes: 0,
  estourado: false,
  urgente: false,
};

const DATE_LABELS: Record<'prazo' | 'postagem', Record<DateBucket, string>> = {
  prazo: {
    atrasado: 'Atrasado',
    hoje: 'Hoje',
    amanha: 'Amanhã',
    depois: 'Depois',
    sem_prazo: 'Sem prazo',
  },
  postagem: {
    atrasado: 'Data passada',
    hoje: 'Hoje',
    amanha: 'Amanhã',
    depois: 'Depois',
    sem_prazo: 'Sem data',
  },
};

// Posição das faixas. Os dias da semana (+2 a +7) ocupam 4..9, entre Amanhã e Depois.
const DATE_ORDER: Record<DateBucket, number> = {
  atrasado: 0,
  hoje: 1,
  amanha: 2,
  depois: 100,
  sem_prazo: 101,
};

interface Slot {
  key: string;
  label: string;
  sub?: string;
  danger: boolean;
  /** Menor primeiro; empate desempata pelo rótulo (pt-BR). */
  order: number;
}

function dateSlot(
  dim: 'prazo' | 'postagem',
  date: Date | null,
  deadline: DeadlineInfo,
  now: Date,
): Slot {
  const bucket = filaBucketOf(date, deadline, now);
  if (bucket === 'proximos7' && date) {
    return {
      key: `${dim}:dia:${dayNum(date)}`,
      label: WEEKDAYS[date.getDay()],
      sub: formatEtapaDeadlineDay(date, now),
      danger: false,
      order: 2 + dayDiff(date, now),
    };
  }
  // filaBucketOf só devolve proximos7 com data; o fallback existe para o tipo.
  const b: DateBucket = bucket === 'proximos7' ? 'sem_prazo' : bucket;
  return {
    key: `${dim}:${b}`,
    label: DATE_LABELS[dim][b],
    danger: dim === 'prazo' && b === 'atrasado',
    order: DATE_ORDER[b],
  };
}

/** Grupo por entidade: os nomeados em ordem alfabética, o "sem" por último. */
function entitySlot(dim: GroupDim, id: string | null, nome: string, semLabel: string): Slot {
  return {
    key: `${dim}:${id ?? 'none'}`,
    label: id == null ? semLabel : nome || 'Sem nome',
    danger: false,
    order: id == null ? 1 : 0,
  };
}

function slotOf<T>(row: T, dim: GroupDim, acc: ListGroupAccessors<T>, now: Date): Slot {
  switch (dim) {
    case 'prazo': {
      const p = acc.prazo(row);
      return dateSlot('prazo', p?.date ?? null, p?.deadline ?? SEM_ESTOURO, now);
    }
    case 'postagem':
      return dateSlot('postagem', acc.postagem?.(row) ?? null, SEM_ESTOURO, now);
    case 'cliente': {
      const c = acc.cliente(row);
      return entitySlot('cliente', c.id == null ? null : String(c.id), c.nome, 'Sem cliente');
    }
    case 'responsavel': {
      const r = acc.responsavel(row);
      return entitySlot(
        'responsavel',
        r.id == null ? null : String(r.id),
        r.nome,
        'Sem responsável',
      );
    }
    case 'etapa': {
      const e = acc.etapa(row);
      return entitySlot('etapa', e || null, e, 'Sem etapa');
    }
  }
}

/**
 * Divide as linhas (já ordenadas pela tabela) em grupos, na ordem de exibição.
 * Grupo vazio não existe.
 */
export function groupListRows<T>(
  rows: readonly T[],
  by: GroupDim,
  acc: ListGroupAccessors<T>,
  now: Date,
): ListGroup<T>[] {
  const dim: GroupDim = by === 'postagem' && !acc.postagem ? 'prazo' : by;
  const slots = new Map<string, { slot: Slot; rows: T[] }>();
  for (const row of rows) {
    const slot = slotOf(row, dim, acc, now);
    const hit = slots.get(slot.key);
    if (hit) hit.rows.push(row);
    else slots.set(slot.key, { slot, rows: [row] });
  }
  return [...slots.values()]
    .sort(
      (a, b) =>
        a.slot.order - b.slot.order ||
        a.slot.label.localeCompare(b.slot.label, 'pt-BR', { sensitivity: 'base' }),
    )
    .map(({ slot, rows: groupRows }) => ({
      key: slot.key,
      label: slot.label,
      sub: slot.sub,
      danger: slot.danger,
      rows: groupRows,
    }));
}

/** Contagem por responsável do painel Responsáveis. Sem responsável não entra. */
export function countByResponsavel(ids: Iterable<number | null | undefined>): Map<number, number> {
  const out = new Map<number, number>();
  for (const id of ids) if (id != null) out.set(id, (out.get(id) ?? 0) + 1);
  return out;
}

/** Recolhe/expande um grupo da Lista: um Set novo, para o estado do React. */
export function toggleKey(set: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run apps/crm/src/pages/entregas/__tests__/listGrouping.test.ts`
Expected: PASS (8 tests).
Run: `npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: no errors. If TS reports "Function lacks ending return statement" on `slotOf`, add `default: return dateSlot('prazo', null, SEM_ESTOURO, now);` as the last `case`. The switch is exhaustive, so this shouldn't be needed.

- [ ] **Step 5: Commit**

```bash
npm run format
git add apps/crm/src/pages/entregas/listGrouping.ts apps/crm/src/pages/entregas/__tests__/listGrouping.test.ts
git commit -m "feat(entregas): agrupamento puro das linhas da Lista

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: One responsável rule + filter chains out of the page

Behavior-preserving refactor. It exists so Task 9 can run each filter chain a second time with the responsável filter removed (facet counts).

**Files:**
- Modify: `apps/crm/src/pages/entregas/postStage.ts`
- Create: `apps/crm/src/pages/entregas/boardFilters.ts`
- Modify: `apps/crm/src/pages/entregas/EntregasPage.tsx`
- Test: `apps/crm/src/pages/entregas/__tests__/boardFilters.test.ts`

**Interfaces:**
- Produces:
  - `postResponsavelIdOf(post: { responsavel_id: number | null }, stage: PostStage | undefined): number | null` (in `postStage.ts`)
  - `filterBoardCards(cards: BoardCard[], filters: FilterState, postResponsaveis: Map<number, number[]>): BoardCard[]`
  - `filterActivePosts(posts: ActivePost[], filters: FilterState, stageOf: (p: ActivePost) => PostStage | undefined): ActivePost[]`
  - In `EntregasPage`: `const stageOfPost = useCallback((p: ActivePost) => PostStage | undefined, [cardsByWorkflowId, postEntityByPostId])` (Task 9 uses it).

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/pages/entregas/__tests__/boardFilters.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
// EMPTY_FILTERS (EntregasFilters) puxa useStatusRegistry -> store -> supabase.
vi.mock('../../../lib/supabase');
import { filterActivePosts, filterBoardCards } from '../boardFilters';
import { EMPTY_FILTERS, type FilterState } from '../components/EntregasFilters';
import type { ActivePost } from '../../../store';
import type { BoardCard } from '../hooks/useEntregasData';
import type { PostStage } from '../postStage';

let nextId = 1;
function makePost(overrides: Partial<ActivePost> = {}): ActivePost {
  return {
    id: nextId++,
    workflow_id: 10,
    cliente_id: 1,
    cliente_nome: 'Aurora',
    workflow_titulo: 'Fluxo Base',
    titulo: 'Post Base',
    tipo: 'feed',
    status: 'rascunho',
    scheduled_at: null,
    published_at: null,
    ig_caption: null,
    instagram_permalink: null,
    publish_error: null,
    ordem: 0,
    responsavel_id: null,
    platform: 'instagram',
    tiktok_publish_status: null,
    tiktok_publish_error: null,
    tiktok_post_url: null,
    instagram_media_id: null,
    ig_trial_strategy: null,
    board_ordem: null,
    ...overrides,
  };
}

const stage = (responsavelId: number | null): PostStage => ({
  etapaNome: 'Design',
  responsavelId,
  responsavelNome: '',
  deadline: { diasRestantes: 2, horasRestantes: 0, estourado: false, urgente: false },
  prazoDate: null,
  hasPrazo: false,
});

describe('filterActivePosts', () => {
  it('Responsável lê a etapa; sem etapa, o responsavel_id do próprio post', () => {
    const wired = makePost({ id: 1, workflow_id: 10, responsavel_id: 99 });
    const avulso = makePost({ id: 2, workflow_id: null, responsavel_id: 9 });
    const stageOf = (p: ActivePost) => (p.id === 1 ? stage(7) : undefined);
    const ids = (filterMembros: number[]) =>
      filterActivePosts([wired, avulso], { ...EMPTY_FILTERS, filterMembros }, stageOf).map(
        (p) => p.id,
      );
    expect(ids([])).toEqual([1, 2]);
    expect(ids([7])).toEqual([1]);
    expect(ids([99])).toEqual([]);
    expect(ids([9])).toEqual([2]);
  });

  it('combina busca e cliente com os demais filtros', () => {
    const a = makePost({ id: 11, titulo: 'Carrossel julho', cliente_id: 1 });
    const b = makePost({ id: 12, titulo: 'Carrossel agosto', cliente_id: 2 });
    const c = makePost({ id: 13, titulo: 'Reels julho', cliente_id: 1 });
    const out = filterActivePosts(
      [a, b, c],
      { ...EMPTY_FILTERS, filterSearch: 'carrossel', filterClientes: [1] },
      () => undefined,
    );
    expect(out.map((p) => p.id)).toEqual([11]);
  });
});

describe('filterBoardCards', () => {
  const card = (id: number, responsavelId: number) =>
    ({
      workflow: { id, titulo: `Fluxo ${id}`, cliente_id: 10, template_id: null },
      etapa: { nome: 'Design', responsavel_id: responsavelId },
      deadline: { estourado: false, urgente: false, diasRestantes: 3, horasRestantes: 0 },
    }) as unknown as BoardCard;

  it('Responsável lê a etapa atual; Responsável do post lê postResponsaveis', () => {
    const cards = [card(1, 7), card(2, 8)];
    const resp = new Map<number, number[]>([
      [1, [42]],
      [2, []],
    ]);
    const titulos = (f: Partial<FilterState>) =>
      filterBoardCards(cards, { ...EMPTY_FILTERS, ...f }, resp).map((c) => c.workflow.titulo);
    expect(titulos({})).toEqual(['Fluxo 1', 'Fluxo 2']);
    expect(titulos({ filterMembros: [8] })).toEqual(['Fluxo 2']);
    expect(titulos({ filterPostResponsaveis: [42] })).toEqual(['Fluxo 1']);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run apps/crm/src/pages/entregas/__tests__/boardFilters.test.ts`
Expected: FAIL with "Failed to resolve import ../boardFilters".

- [ ] **Step 3: Add `postResponsavelIdOf` to `postStage.ts`**

Append to `apps/crm/src/pages/entregas/postStage.ts`:

```ts
/**
 * Quem está com o post AGORA, pela regra do filtro "Responsável" de
 * Publicações: o responsável da etapa (fluxo ou processo individual); sem
 * etapa, o responsavel_id do próprio post. O painel Responsáveis e o
 * agrupamento da Lista usam a mesma regra; senão um grupo "Ana (3)" sairia de
 * um filtro que só acha 2.
 */
export function postResponsavelIdOf(
  post: { responsavel_id: number | null },
  stage: PostStage | undefined,
): number | null {
  return stage ? stage.responsavelId : post.responsavel_id;
}
```

- [ ] **Step 4: Create `boardFilters.ts` (moved logic, unchanged behavior)**

Create `apps/crm/src/pages/entregas/boardFilters.ts`:

```ts
import type { ActivePost } from '../../store';
import type { BoardCard } from './hooks/useEntregasData';
import type { FilterState, StatusFilter } from './components/EntregasFilters';
import { postResponsavelIdOf, type PostStage } from './postStage';
import { matchesDeadlineFilter, matchesEtapaPrazo } from './etapaPrazo';
import { postMatchesStatusFilter } from './statusRegistry';

// As duas cadeias de filtro da página de Entregas, fora do componente para
// rodarem duas vezes: a lista com todos os filtros, e a base das contagens do
// painel Responsáveis com todos menos o de responsável. Movidas de
// EntregasPage (filteredCards / filteredPosts) sem mudança de comportamento.

/** Filtros do modo Fluxos sobre os cards de fluxo. Every dropdown filter is
 *  multi-select: empty means "no filter", otherwise a card matches if it hits
 *  ANY of the selected values. */
export function filterBoardCards(
  cards: BoardCard[],
  filters: FilterState,
  postResponsaveis: Map<number, number[]>,
): BoardCard[] {
  let out = cards;
  if (filters.filterSearch) {
    const q = filters.filterSearch.toLowerCase();
    out = out.filter((c) => c.workflow.titulo.toLowerCase().includes(q));
  }
  if (filters.filterClientes.length)
    out = out.filter(
      (c) =>
        c.workflow.cliente_id != null && filters.filterClientes.includes(c.workflow.cliente_id),
    );
  if (filters.filterMembros.length)
    out = out.filter(
      (c) =>
        c.etapa.responsavel_id != null && filters.filterMembros.includes(c.etapa.responsavel_id),
    );
  if (filters.filterPostResponsaveis.length)
    out = out.filter((c) => {
      const responsaveis = postResponsaveis.get(c.workflow.id!);
      return responsaveis?.some((r) => filters.filterPostResponsaveis.includes(r)) ?? false;
    });
  if (filters.filterEtapas.length)
    out = out.filter((c) => filters.filterEtapas.includes(c.etapa.nome));
  if (filters.filterTemplates.length)
    out = out.filter(
      (c) =>
        c.workflow.template_id != null && filters.filterTemplates.includes(c.workflow.template_id),
    );
  if (filters.filterStatus.length)
    out = out.filter((c) => {
      const status: StatusFilter = c.deadline.estourado
        ? 'atrasado'
        : c.deadline.urgente
          ? 'urgente'
          : 'em_dia';
      return filters.filterStatus.includes(status);
    });
  // Prazo da etapa: the same matcher the posts pipeline uses. Without it the
  // Visão geral's "Vencem hoje" KPI and "Idade dos atrasos" buckets would
  // patch the filter state and leave the board untouched.
  if (filters.filterPrazo.length || filters.filterPrazoFrom || filters.filterPrazoTo)
    out = out.filter((c) =>
      matchesEtapaPrazo(c, filters.filterPrazo, filters.filterPrazoFrom, filters.filterPrazoTo),
    );
  return out;
}

/**
 * Filtros de Publicações: busca / cliente / status / tipo aplicam ao post;
 * etapa, responsável e prazo aplicam à etapa em que ele está (`stageOf`: a do
 * fluxo para um post amarrado, a do processo individual para um avulso que
 * tenha um). Templates e o status de prazo são de fluxo e não são lidos aqui.
 */
export function filterActivePosts(
  posts: ActivePost[],
  filters: FilterState,
  stageOf: (p: ActivePost) => PostStage | undefined,
): ActivePost[] {
  let ps = posts;
  if (filters.filterSearch) {
    const q = filters.filterSearch.toLowerCase();
    ps = ps.filter((p) => p.titulo.toLowerCase().includes(q));
  }
  if (filters.filterClientes.length)
    ps = ps.filter((p) => p.cliente_id != null && filters.filterClientes.includes(p.cliente_id));
  // "Responsável" aqui é quem está com o post AGORA (postResponsavelIdOf): o da
  // etapa atual do fluxo ou do processo individual; um avulso sem processo cai
  // no responsavel_id do próprio post em vez de ser excluído de saída.
  if (filters.filterMembros.length)
    ps = ps.filter((p) => {
      const respId = postResponsavelIdOf(p, stageOf(p));
      return respId != null && filters.filterMembros.includes(respId);
    });
  // Um post "está em" a etapa do seu fluxo ou a do seu processo individual;
  // sem nenhum dos dois este filtro (como o de prazo abaixo) o exclui.
  if (filters.filterEtapas.length)
    ps = ps.filter((p) => {
      const etapaNome = stageOf(p)?.etapaNome;
      return etapaNome != null && filters.filterEtapas.includes(etapaNome);
    });
  if (filters.filterTipos.length) ps = ps.filter((p) => filters.filterTipos.includes(p.tipo));
  if (filters.filterPostStatus.length)
    ps = ps.filter((p) => postMatchesStatusFilter(p, filters.filterPostStatus));
  // Sem etapa, matchesDeadlineFilter devolve false enquanto um preset/intervalo
  // estiver ativo, e true incondicionalmente com o filtro vazio.
  ps = ps.filter((p) => {
    const stage = stageOf(p);
    return matchesDeadlineFilter(
      stage ? { deadline: stage.deadline, date: stage.prazoDate } : undefined,
      filters.filterPrazo,
      filters.filterPrazoFrom,
      filters.filterPrazoTo,
    );
  });
  return ps;
}
```

- [ ] **Step 5: Point `EntregasPage` at the extracted functions**

In `apps/crm/src/pages/entregas/EntregasPage.tsx`:

1. Replace the whole block that starts with the comment `// Posts-mode filtering: busca / cliente / status / tipo aplicam ao post; etapa,` and ends with the closing `]);` of `const filteredPosts = useMemo(…)`, just before the comment `// Mirrors exactly the fields filteredPosts reads above`, with:

```ts
  // Posts-mode filtering (boardFilters.filterActivePosts): busca / cliente /
  // status / tipo aplicam ao post; etapa, responsável e prazo aplicam à etapa
  // em que ele está -- a do fluxo para um post amarrado, a do processo
  // individual para um avulso que tenha um (postStageOf).
  const stageOfPost = useCallback(
    (p: ActivePost) =>
      postStageOf(
        p.workflow_id != null ? cardsByWorkflowId.get(p.workflow_id) : undefined,
        p.workflow_id == null ? postEntityByPostId.get(p.id) : undefined,
      ),
    [cardsByWorkflowId, postEntityByPostId],
  );
  const filteredPosts = useMemo(
    () => filterActivePosts(activePosts, filters, stageOfPost),
    [activePosts, filters, stageOfPost],
  );
```

2. Replace the whole block that starts with the comment `// Apply filters. Memoized on purpose:` and ends with `}, [cards, filters, postResponsaveis]);` with:

```ts
  // Apply filters (boardFilters.filterBoardCards). Memoized on purpose: the
  // Visão geral derives every chart dataset from this array, and a fresh
  // identity on each render re-animates all of them (and re-runs their
  // builders) on any unrelated state change.
  const filteredCards = useMemo(
    () => filterBoardCards(cards, filters, postResponsaveis),
    [cards, filters, postResponsaveis],
  );
```

3. Imports:
   - Add `import { filterActivePosts, filterBoardCards } from './boardFilters';`.
   - Delete `import { matchesDeadlineFilter, matchesEtapaPrazo } from './etapaPrazo';` and `import { postMatchesStatusFilter } from './statusRegistry';`.
   - Change `import { EntregasFilters, type FilterState, type StatusFilter } from './components/EntregasFilters';` to `import { EntregasFilters, type FilterState } from './components/EntregasFilters';`.

   Confirm nothing else in the page used them: `grep -n "matchesDeadlineFilter\|matchesEtapaPrazo\|postMatchesStatusFilter\|StatusFilter" apps/crm/src/pages/entregas/EntregasPage.tsx` should print nothing.

- [ ] **Step 6: Run the new test and the whole Entregas suite (regression gate)**

Run: `npx vitest run apps/crm/src/pages/entregas`
Expected: PASS, including every existing `EntregasPage.test.tsx` filter test ("Filter member", "Filter prazo atrasado", the Publicações processo tests). Any failure means the move changed behavior. Fix it before continuing. **This whole-folder run is the real gate for the refactor**, because `filteredCards` feeds Visão geral and Calendário. Don't shortcut it to `boardFilters.test.ts` alone.

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit && npm run lint`
Expected: no errors, no new warnings in the touched files.

- [ ] **Step 7: Commit**

```bash
npm run format
git add apps/crm/src/pages/entregas/postStage.ts apps/crm/src/pages/entregas/boardFilters.ts apps/crm/src/pages/entregas/EntregasPage.tsx apps/crm/src/pages/entregas/__tests__/boardFilters.test.ts
git commit -m "refactor(entregas): cadeias de filtro da página em boardFilters.ts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Group header row + CSS

**Files:**
- Create: `apps/crm/src/pages/entregas/components/ListGroupHeaderRow.tsx`
- Modify: `apps/crm/style.css` (append at end of file)
- Test: `apps/crm/src/pages/entregas/components/__tests__/ListGroupHeaderRow.test.tsx`

**Interfaces:**
- Produces: `ListGroupHeaderRow({ label: string; sub?: string; count: number; danger?: boolean; colSpan: number; collapsed: boolean; onToggle: () => void })`. It renders `<tr class="list-group-head"><th colSpan scope="rowgroup"><button class="list-group-toggle[ is-danger]" aria-expanded aria-label="{label}[ {sub}] ({count})">…`. Tests in Tasks 5 and 6 read group headers via `document.querySelectorAll('.list-group-toggle')` and their `aria-label`.

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/pages/entregas/components/__tests__/ListGroupHeaderRow.test.tsx`:

```tsx
import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ListGroupHeaderRow } from '../ListGroupHeaderRow';

function renderRow(props: Partial<ComponentProps<typeof ListGroupHeaderRow>> = {}) {
  const onToggle = vi.fn();
  const { container } = render(
    <table>
      <tbody>
        <ListGroupHeaderRow
          label="Sexta-feira"
          sub="2 out"
          count={3}
          colSpan={6}
          collapsed={false}
          onToggle={onToggle}
          {...props}
        />
      </tbody>
    </table>,
  );
  return { onToggle, container };
}

describe('ListGroupHeaderRow', () => {
  it('names the group with its date and count, spans every column and toggles', () => {
    const { onToggle, container } = renderRow();
    const button = screen.getByRole('button', { name: 'Sexta-feira 2 out (3)' });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const th = container.querySelector('th')!;
    expect(th).toHaveAttribute('colspan', '6');
    expect(th).toHaveAttribute('scope', 'rowgroup');
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('reflects the collapsed state and marks Atrasado as danger', () => {
    renderRow({ label: 'Atrasado', sub: undefined, count: 2, collapsed: true, danger: true });
    const button = screen.getByRole('button', { name: 'Atrasado (2)' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveClass('is-danger');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/ListGroupHeaderRow.test.tsx`
Expected: FAIL with "Failed to resolve import ../ListGroupHeaderRow".

- [ ] **Step 3: Implement the component**

Create `apps/crm/src/pages/entregas/components/ListGroupHeaderRow.tsx`:

```tsx
import { ChevronDown, ChevronRight } from 'lucide-react';

/** Cabeçalho de um grupo da vista Lista (Agrupar por): a primeira linha do
 *  `<tbody>` do grupo, com `<th scope="rowgroup">` para leitores de tela
 *  anunciarem o grupo de cada linha. O botão recolhe/expande o grupo. */
export function ListGroupHeaderRow({
  label,
  sub,
  count,
  danger = false,
  colSpan,
  collapsed,
  onToggle,
}: {
  label: string;
  sub?: string;
  count: number;
  danger?: boolean;
  colSpan: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <tr className="list-group-head">
      <th colSpan={colSpan} scope="rowgroup">
        <button
          type="button"
          className={`list-group-toggle${danger ? ' is-danger' : ''}`}
          aria-expanded={!collapsed}
          aria-label={`${label}${sub ? ` ${sub}` : ''} (${count})`}
          onClick={onToggle}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          )}
          <span className="list-group-label">{label}</span>
          {sub && <span className="list-group-sub">{sub}</span>}
          <span className="list-group-count">{count}</span>
        </button>
      </th>
    </tr>
  );
}
```

- [ ] **Step 4: Append the styles**

Append to the end of `apps/crm/style.css`:

```css
/* Entregas, vista Lista: cabeçalho de grupo (Agrupar por) */
.list-group-head th {
  padding: 1rem 1rem 0.4rem;
  text-align: left;
  font-weight: 400;
  border-bottom: 1px solid var(--border-color);
}
.list-group-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  margin-left: -0.4rem;
  padding: 0.25rem 0.4rem;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--text-main);
  font: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
}
.list-group-toggle:hover {
  background: var(--surface-hover);
}
.list-group-toggle:focus-visible {
  outline: 2px solid var(--primary-color);
  outline-offset: 2px;
}
.list-group-toggle svg {
  flex-shrink: 0;
  color: var(--text-muted);
}
.list-group-toggle.is-danger .list-group-label {
  color: var(--danger-text);
}
.list-group-sub {
  font-weight: 400;
  color: var(--text-muted);
}
.list-group-count {
  min-width: 1.4rem;
  padding: 0.05rem 0.45rem;
  border-radius: 999px;
  background: var(--surface-2);
  color: var(--text-muted);
  font-size: 0.72rem;
  font-weight: 500;
  text-align: center;
}
```

- [ ] **Step 5: Run the test**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/ListGroupHeaderRow.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
npm run format
git add apps/crm/src/pages/entregas/components/ListGroupHeaderRow.tsx apps/crm/src/pages/entregas/components/__tests__/ListGroupHeaderRow.test.tsx apps/crm/style.css
git commit -m "feat(entregas): cabeçalho de grupo recolhível da Lista

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `PostsListView` grouped (Publicações)

**Files:**
- Modify: `apps/crm/src/pages/entregas/views/PostsListView.tsx`
- Test: `apps/crm/src/pages/entregas/views/__tests__/PostsListView.test.tsx`

**Interfaces:**
- Consumes: `groupListRows`, `toggleKey` (Task 2), `postResponsavelIdOf` (Task 3), `ListGroupHeaderRow` (Task 4), `ListGroupBy` (Task 1).
- Produces: two new optional props on `PostsListView`:
  - `groupBy?: ListGroupBy`, default `'nenhum'`, which renders the flat table exactly as today.
  - `membroNomeById?: ReadonlyMap<number, string>`, default empty.

  Task 9 passes both.

- [ ] **Step 1: Write the failing tests**

In `apps/crm/src/pages/entregas/views/__tests__/PostsListView.test.tsx`, add below `getRenderedTitles`:

```ts
const groupHeads = () =>
  Array.from(document.querySelectorAll('.list-group-toggle')).map((b) =>
    b.getAttribute('aria-label'),
  );
```

and add these tests inside `describe('PostsListView', …)`:

```tsx
  it('sem groupBy continua uma tabela corrida', () => {
    render(<PostsListView {...baseProps} posts={[makePost({ titulo: 'Solo' })]} />);
    expect(groupHeads()).toEqual([]);
    expect(screen.getByText('Solo')).toBeInTheDocument();
  });

  it('agrupa por responsável: o da etapa, ou o responsavel_id do avulso sem etapa, que também aparece na célula', () => {
    const posts = [
      makePost({ titulo: 'Do fluxo' }),
      makePost({
        titulo: 'Avulso da Bia',
        workflow_id: null,
        workflow_titulo: null,
        responsavel_id: 9,
      }),
      makePost({ titulo: 'Avulso sem ninguém', workflow_id: null, workflow_titulo: null }),
    ];
    render(
      <PostsListView
        {...baseProps}
        cardsByWorkflowId={
          new Map([[10, makeBoardCard({ etapa: { nome: 'Design', responsavel_id: 7 } })]])
        }
        posts={posts}
        groupBy="responsavel"
        membroNomeById={new Map([[9, 'Bia Costa']])}
      />,
    );
    expect(groupHeads()).toEqual(['Ana Silva (1)', 'Bia Costa (1)', 'Sem responsável (1)']);
    const row = screen.getByText('Avulso da Bia').closest('tr')!;
    const cells = Array.from(row.querySelectorAll('td')).map((td) => td.textContent);
    expect(cells[6]).toBe('Bia Costa'); // Responsável
  });

  it('agrupa por data de postagem com "Sem data" por último e recolhe um grupo', () => {
    const hoje = new Date();
    hoje.setHours(12, 0, 0, 0);
    const posts = [
      makePost({ titulo: 'Sem agenda' }),
      makePost({ titulo: 'Sai hoje', scheduled_at: hoje.toISOString() }),
    ];
    render(<PostsListView {...baseProps} posts={posts} groupBy="postagem" />);
    expect(groupHeads()).toEqual(['Hoje (1)', 'Sem data (1)']);

    fireEvent.click(screen.getByRole('button', { name: 'Hoje (1)' }));

    expect(screen.getByRole('button', { name: 'Hoje (1)' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByText('Sai hoje')).toBeNull();
    expect(screen.getByText('Sem agenda')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/crm/src/pages/entregas/views/__tests__/PostsListView.test.tsx`
Expected: the flat test passes. The two grouping tests FAIL with empty `groupHeads()`, and the Responsável cell for "Avulso da Bia" is `—`.

- [ ] **Step 3: Implement**

In `apps/crm/src/pages/entregas/views/PostsListView.tsx`:

1. Imports. Replace `import { postStageOf } from '../postStage';` with the first line below, then add the other three:

```ts
import { postStageOf, postResponsavelIdOf, type PostStage } from '../postStage';
import type { ListGroupBy } from '../viewQuery';
import { groupListRows, toggleKey } from '../listGrouping';
import { ListGroupHeaderRow } from '../components/ListGroupHeaderRow';
```

2. Props. Add to `interface PostsListViewProps`, after `postEntityByPostId?`:

```ts
  /** "Agrupar por" da Lista. 'nenhum' (padrão) = tabela corrida. */
  groupBy?: ListGroupBy;
  /** Nome de cada membro: o responsável de um avulso sem etapa vem do
   *  responsavel_id do próprio post, que não tem card nem processo para dar o nome. */
  membroNomeById?: ReadonlyMap<number, string>;
```

3. Module scope. Add below the `oneLineCell` constant:

```ts
const EMPTY_NOMES: ReadonlyMap<number, string> = new Map();

/** Responsável pela regra do filtro "Responsável" (postResponsavelIdOf): o da
 *  etapa, ou o responsavel_id do próprio post quando ele não está em etapa
 *  nenhuma. Célula, ordenação e agrupamento leem daqui. */
function resolveResponsavel(
  p: ActivePost,
  stage: PostStage | undefined,
  nomes: ReadonlyMap<number, string>,
): { id: number | null; nome: string } {
  const id = postResponsavelIdOf(p, stage);
  const nome = stage ? stage.responsavelNome : id != null ? (nomes.get(id) ?? '') : '';
  return { id, nome };
}
```

4. Component signature. Add `groupBy = 'nenhum',` and `membroNomeById = EMPTY_NOMES,` to the destructured props. Directly under the existing `const [sort, setSort] = useState…({ … });` add:

```ts
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
```

5. Replace `const membroNome = (p: ActivePost) => stageOf(p)?.responsavelNome || '';` with:

```ts
  const membroNome = (p: ActivePost) => resolveResponsavel(p, stageOf(p), membroNomeById).nome;
```

6. Inside the `sorted` `useMemo`:
   - Replace `const nome = (p: ActivePost) => stageForSort(p)?.responsavelNome || '';` with `const nome = (p: ActivePost) => resolveResponsavel(p, stageForSort(p), membroNomeById).nome;`.
   - Change the deps to `[posts, sort, cardsByWorkflowId, postEntityByPostId, membroNomeById]`.
   - Update its leading comment's last clause from "e fica com o responsável vazio, como já acontecia." to "; o responsável dele é o responsavel_id do próprio post (resolveResponsavel)."

7. Row renderer. Right after the `handleSort` function, declare `const renderRow = (p: ActivePost) => { … };`. Its body is the callback body currently inside `{sorted.map((p) => { … })}` in `<tbody>`, **moved verbatim**: the `const workflowId`, `openable`, `card`, `stage`, `processEtapa`, `prazo`, `prazoDate` lines, then `return ( <tr key={p.id} …> … </tr> );`. No change inside the `<tr>`. The Responsável cell already calls `membroNome(p)`, which now resolves the avulso's own responsável.

8. Groups. Right after `renderRow`, add:

```ts
  const groups =
    groupBy === 'nenhum'
      ? null
      : groupListRows(
          sorted,
          groupBy,
          {
            prazo: (p) => {
              const s = stageOf(p);
              return s ? { date: s.prazoDate, deadline: s.deadline } : undefined;
            },
            postagem: (p) => (p.scheduled_at ? new Date(p.scheduled_at) : null),
            cliente: (p) => ({ id: p.cliente_id, nome: p.cliente_nome }),
            responsavel: (p) => resolveResponsavel(p, stageOf(p), membroNomeById),
            etapa: (p) => stageOf(p)?.etapaNome ?? '',
          },
          new Date(),
        );
```

9. Replace the whole `<tbody> … </tbody>` element with:

```tsx
        {groups ? (
          groups.map((g) => {
            const isCollapsed = collapsed.has(g.key);
            return (
              <tbody key={g.key}>
                <ListGroupHeaderRow
                  label={g.label}
                  sub={g.sub}
                  count={g.rows.length}
                  danger={g.danger}
                  colSpan={COLUMNS.length}
                  collapsed={isCollapsed}
                  onToggle={() => setCollapsed((prev) => toggleKey(prev, g.key))}
                />
                {!isCollapsed && g.rows.map(renderRow)}
              </tbody>
            );
          })
        ) : (
          <tbody>{sorted.map(renderRow)}</tbody>
        )}
```

- [ ] **Step 4: Run the view tests**

Run: `npx vitest run apps/crm/src/pages/entregas/views/__tests__/PostsListView.test.tsx`
If the suite fails at import with a supabase client error (the view now reaches `listGrouping → minhaFila → store`), add `vi.mock('@/lib/supabase');` at the top of the test file, as `minhaFila.test.ts` does.
Expected: PASS, both old and new tests. `'leaves Etapa atual and Prazo da etapa blank for a post avulso'` asserts only cells 3 and 7, so the Responsável change doesn't affect it.

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
npm run format
git add apps/crm/src/pages/entregas/views/PostsListView.tsx apps/crm/src/pages/entregas/views/__tests__/PostsListView.test.tsx
git commit -m "feat(entregas): Lista de Publicações agrupada e responsável do avulso sem etapa

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `ListView` grouped (Fluxos)

**Files:**
- Modify: `apps/crm/src/pages/entregas/views/ListView.tsx` (full replacement below)
- Test: `apps/crm/src/pages/entregas/views/__tests__/ListView.test.tsx`

**Interfaces:**
- Consumes: `groupListRows`, `toggleKey` (Task 2), `ListGroupHeaderRow` (Task 4), `etapaDeadlineDate(card)` (existing, `etapaPrazo.ts`).
- Produces: new optional prop `groupBy?: ListGroupBy` (default `'nenhum'`). No `postagem` accessor, so `postagem` falls back to `prazo` inside `groupListRows`.

- [ ] **Step 1: Write the failing tests**

In `apps/crm/src/pages/entregas/views/__tests__/ListView.test.tsx`, add `import { toLocalISODate } from '@/utils/postDate';` to the imports, and add below `getRenderedTitles`:

```ts
const groupHeads = () =>
  Array.from(document.querySelectorAll('.list-group-toggle')).map((b) =>
    b.getAttribute('aria-label'),
  );
/** 'YYYY-MM-DD' local de hoje + n dias (data_limite da etapa). */
const isoDay = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return toLocalISODate(d);
};
```

Then add inside `describe('ListView', …)`:

```tsx
  it('agrupa por prazo da etapa: Atrasado primeiro, Sem prazo por último', () => {
    const cards = [
      makeCard({
        workflow: { id: 1, titulo: 'Fluxo A' },
        etapa: { id: 11, nome: 'Copy', data_limite: isoDay(1) },
      }),
      makeCard({
        workflow: { id: 2, titulo: 'Fluxo B' },
        etapa: { id: 12, nome: 'Copy', data_limite: isoDay(-3) },
        deadline: { estourado: true, urgente: false, diasRestantes: -3, horasRestantes: 0 },
      }),
      makeCard({ workflow: { id: 3, titulo: 'Fluxo C' }, etapa: { id: 13, nome: 'Copy' } }),
    ];
    render(
      <ListView
        cards={cards}
        sort={{ column: 'titulo', direction: 'asc' }}
        onSortChange={vi.fn()}
        onCardClick={vi.fn()}
        groupBy="prazo"
      />,
    );
    expect(groupHeads()).toEqual(['Atrasado (1)', 'Amanhã (1)', 'Sem prazo (1)']);
  });

  it('agrupa pelo responsável da etapa e recolhe um grupo', () => {
    const cards = [
      makeCard({
        workflow: { id: 1, titulo: 'Fluxo da Ana' },
        etapa: { id: 11, nome: 'Copy', responsavel_id: 7 },
        membro: { id: 7, nome: 'Ana' },
      }),
      makeCard({
        workflow: { id: 2, titulo: 'Fluxo sem dono' },
        etapa: { id: 12, nome: 'Copy' },
        membro: undefined,
      }),
    ];
    render(
      <ListView
        cards={cards}
        sort={{ column: 'titulo', direction: 'asc' }}
        onSortChange={vi.fn()}
        onCardClick={vi.fn()}
        groupBy="responsavel"
      />,
    );
    expect(groupHeads()).toEqual(['Ana (1)', 'Sem responsável (1)']);

    fireEvent.click(screen.getByRole('button', { name: 'Ana (1)' }));

    expect(screen.queryByText('Fluxo da Ana')).toBeNull();
    expect(screen.getByText('Fluxo sem dono')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run apps/crm/src/pages/entregas/views/__tests__/ListView.test.tsx`
Expected: the two new tests FAIL (no group headers). The old ones pass.

- [ ] **Step 3: Implement (replace the file)**

Replace `apps/crm/src/pages/entregas/views/ListView.tsx` with:

```tsx
import { useState } from 'react';
import { ChevronUp, ChevronDown, FileText } from 'lucide-react';
import type { BoardCard } from '../hooks/useEntregasData';
import type { PostEntity } from '../boardEntity';
import { DEADLINE_STATUS, classifyDeadline } from '../deadlineStatus';
import { etapaDeadlineDate } from '../etapaPrazo';
import type { ListGroupBy } from '../viewQuery';
import { groupListRows, toggleKey } from '../listGrouping';
import { ListGroupHeaderRow } from '../components/ListGroupHeaderRow';

interface ListViewProps {
  cards: BoardCard[];
  /** Processos individuais (spec §4.4: mesmos tipos e filtro de entidade do Kanban). */
  postEntities?: PostEntity[];
  sort: { column: string; direction: 'asc' | 'desc' };
  onSortChange: (sort: { column: string; direction: 'asc' | 'desc' }) => void;
  onCardClick: (card: BoardCard) => void;
  onPostClick?: (entity: PostEntity) => void;
  /** "Agrupar por" da Lista. 'nenhum' (padrão) = tabela corrida. Sem data de
   *  postagem aqui: um fluxo tem vários posts, e 'postagem' agrupa por prazo. */
  groupBy?: ListGroupBy;
}

type Column = { key: string; label: string };
const COLUMNS: Column[] = [
  { key: 'titulo', label: 'Título' },
  { key: 'cliente', label: 'Cliente' },
  { key: 'etapa', label: 'Etapa atual' },
  { key: 'responsavel', label: 'Responsável' },
  { key: 'prazo', label: 'Prazo' },
  { key: 'status', label: 'Status' },
];

/** Projeção comum de fluxo e post para a tabela: etapa, responsável e prazo
 *  resolvidos pela entidade. */
interface ListRow {
  key: string;
  titulo: string;
  clienteId: number | null;
  clienteNome: string;
  clienteCor: string | undefined;
  etapaNome: string;
  responsavelId: number | null;
  responsavelNome: string;
  deadline: BoardCard['deadline'];
  /** Dia do prazo da etapa, ou null sem prazo resolvido (agrupamento por prazo). */
  prazoDate: Date | null;
  /** false quando a entidade não tem prazo efetivo (etapa não ativada ou prazo
   *  limpo). deadline vem com um fallback zerado nesse caso (spec §7) e não
   *  deve ser lido como "vence em 0h" -- ver formatPrazo. */
  hasDeadline: boolean;
  individual: boolean;
  open: () => void;
}

const EMPTY_POST_ENTITIES: PostEntity[] = [];

/** Same three buckets the board, the Visão geral and the filters use. */
function getStatusBadge(row: ListRow) {
  const { label, cssVar } = DEADLINE_STATUS[classifyDeadline(row.deadline)];
  return { label, color: `var(${cssVar})` };
}

function sortRows(rows: ListRow[], column: string, direction: 'asc' | 'desc'): ListRow[] {
  const dir = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    switch (column) {
      case 'titulo':
        return dir * a.titulo.localeCompare(b.titulo);
      case 'cliente':
        return dir * a.clienteNome.localeCompare(b.clienteNome);
      case 'etapa':
        return dir * a.etapaNome.localeCompare(b.etapaNome);
      case 'responsavel':
        return dir * a.responsavelNome.localeCompare(b.responsavelNome);
      case 'prazo':
        return dir * (a.deadline.diasRestantes - b.deadline.diasRestantes);
      case 'status': {
        const order = (r: ListRow) => (r.deadline.estourado ? 0 : r.deadline.urgente ? 1 : 2);
        return dir * (order(a) - order(b));
      }
      default:
        return 0;
    }
  });
}

function formatPrazo(row: ListRow): string {
  if (!row.hasDeadline) return 'Sem prazo';
  const d = row.deadline;
  if (d.estourado) return `${Math.abs(d.diasRestantes)}d atrasado`;
  if (d.diasRestantes === 0) return `${d.horasRestantes}h restantes`;
  return `${d.diasRestantes}d restantes`;
}

export function ListView({
  cards,
  postEntities = EMPTY_POST_ENTITIES,
  sort,
  onSortChange,
  onCardClick,
  onPostClick,
  groupBy = 'nenhum',
}: ListViewProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());

  if (cards.length === 0 && postEntities.length === 0) {
    return (
      <div
        className="card animate-up"
        style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}
      >
        <p>Nenhuma entrega encontrada. Ajuste os filtros.</p>
      </div>
    );
  }

  const rows: ListRow[] = [
    ...cards.map<ListRow>((card) => ({
      key: `wf-${card.workflow.id}`,
      titulo: card.workflow.titulo,
      clienteId: card.workflow.cliente_id ?? card.cliente?.id ?? null,
      clienteNome: card.cliente?.nome || '',
      clienteCor: card.cliente?.cor,
      etapaNome: card.etapa.nome,
      responsavelId: card.etapa.responsavel_id ?? null,
      responsavelNome: card.membro?.nome || '',
      deadline: card.deadline,
      prazoDate: etapaDeadlineDate(card),
      hasDeadline: true,
      individual: false,
      open: () => onCardClick(card),
    })),
    ...postEntities.map<ListRow>((e) => ({
      key: e.id,
      titulo: e.titulo,
      clienteId: e.process.post.cliente_id ?? null,
      clienteNome: e.cliente?.nome || e.process.post.cliente_nome || '',
      clienteCor: e.cliente?.cor,
      etapaNome: e.etapaNome,
      responsavelId: e.step.responsavel_id ?? null,
      responsavelNome: e.responsavel?.nome || '',
      deadline: e.deadline,
      prazoDate: e.prazoEfetivo,
      hasDeadline: e.prazoEfetivo != null,
      individual: true,
      open: () => onPostClick?.(e),
    })),
  ];
  const sorted = sortRows(rows, sort.column, sort.direction);

  const handleSort = (key: string) => {
    if (sort.column === key) {
      onSortChange({ column: key, direction: sort.direction === 'asc' ? 'desc' : 'asc' });
    } else {
      onSortChange({ column: key, direction: 'asc' });
    }
  };

  const renderRow = (row: ListRow) => {
    const badge = getStatusBadge(row);
    return (
      <tr
        key={row.key}
        onClick={row.open}
        style={{ cursor: 'pointer', borderBottom: '1px solid var(--border-color)' }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        <td style={{ padding: '0.75rem 1rem' }}>
          {row.titulo}
          {row.individual && (
            <span
              className="post-fluxo-tag post-fluxo-tag--avulso post-fluxo-tag--individual"
              style={{ marginLeft: '0.5rem' }}
            >
              <FileText size={11} aria-hidden="true" style={{ flexShrink: 0 }} />
              Individual
            </span>
          )}
        </td>
        <td style={{ padding: '0.75rem 1rem' }}>
          <span
            style={{
              borderLeft: `3px solid ${row.clienteCor || '#888'}`,
              paddingLeft: '0.5rem',
            }}
          >
            {row.clienteNome || '—'}
          </span>
        </td>
        <td style={{ padding: '0.75rem 1rem' }}>{row.etapaNome}</td>
        <td style={{ padding: '0.75rem 1rem' }}>{row.responsavelNome || '—'}</td>
        <td style={{ padding: '0.75rem 1rem' }}>{formatPrazo(row)}</td>
        <td style={{ padding: '0.75rem 1rem' }}>
          <span
            style={{
              padding: '0.2rem 0.6rem',
              borderRadius: 12,
              background: `color-mix(in srgb, ${badge.color} 13%, transparent)`,
              color: badge.color,
              fontSize: '0.75rem',
              fontWeight: 600,
            }}
          >
            {badge.label}
          </span>
        </td>
      </tr>
    );
  };

  const groups =
    groupBy === 'nenhum'
      ? null
      : groupListRows(
          sorted,
          groupBy,
          {
            prazo: (r) => ({ date: r.prazoDate, deadline: r.deadline }),
            cliente: (r) => ({ id: r.clienteId, nome: r.clienteNome }),
            responsavel: (r) => ({ id: r.responsavelId, nome: r.responsavelNome }),
            etapa: (r) => r.etapaNome,
          },
          new Date(),
        );

  return (
    <div className="animate-up card" style={{ overflow: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
        <thead>
          <tr>
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                onClick={() => handleSort(col.key)}
                style={{
                  padding: '0.75rem 1rem',
                  textAlign: 'left',
                  cursor: 'pointer',
                  userSelect: 'none',
                  whiteSpace: 'nowrap',
                  borderBottom: '1px solid var(--border-color)',
                  color: sort.column === col.key ? 'var(--accent)' : 'var(--text-secondary)',
                  fontWeight: 600,
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                  {col.label}
                  {sort.column === col.key ? (
                    sort.direction === 'asc' ? (
                      <ChevronUp className="h-3 w-3" />
                    ) : (
                      <ChevronDown className="h-3 w-3" />
                    )
                  ) : null}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        {groups ? (
          groups.map((g) => {
            const isCollapsed = collapsed.has(g.key);
            return (
              <tbody key={g.key}>
                <ListGroupHeaderRow
                  label={g.label}
                  sub={g.sub}
                  count={g.rows.length}
                  danger={g.danger}
                  colSpan={COLUMNS.length}
                  collapsed={isCollapsed}
                  onToggle={() => setCollapsed((prev) => toggleKey(prev, g.key))}
                />
                {!isCollapsed && g.rows.map(renderRow)}
              </tbody>
            );
          })
        ) : (
          <tbody>{sorted.map(renderRow)}</tbody>
        )}
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run apps/crm/src/pages/entregas/views/__tests__/ListView.test.tsx`
This suite didn't load the store before. If it fails at import with a supabase client error, add `vi.mock('@/lib/supabase');` at the top of the test file, as `minhaFila.test.ts` does.
Expected: PASS (old and new).
Run: `npx tsc -p apps/crm/tsconfig.json --noEmit`
Expected: no errors. If `card.workflow.cliente_id` or `e.process.post.cliente_id` is typed `number | undefined`, the `?? null` already normalizes it. If TS complains that `e.prazoEfetivo` is not `Date | null`, read `PostEntity` in `boardEntity.ts` and convert the same way `postStageOf` does (it assigns `entity.prazoEfetivo` to `prazoDate: Date | null` directly).

- [ ] **Step 5: Commit**

```bash
npm run format
git add apps/crm/src/pages/entregas/views/ListView.tsx apps/crm/src/pages/entregas/views/__tests__/ListView.test.tsx
git commit -m "feat(entregas): Lista de Fluxos agrupada

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: `ListToolbar` ("Agrupar por" + Responsáveis toggle)

**Files:**
- Create: `apps/crm/src/pages/entregas/components/ListToolbar.tsx`
- Test: `apps/crm/src/pages/entregas/components/__tests__/ListToolbar.test.tsx`

**Interfaces:**
- Produces: `ListToolbar({ groupBy: ListGroupBy; groupByOptions: readonly ListGroupBy[]; onGroupByChange: (g: ListGroupBy) => void; responsaveisOpen: boolean; onToggleResponsaveis: () => void; selectedResponsaveis: number })`. It imports only UI primitives and `import type` from `viewQuery`, with no store and no `EntregasFilters`.

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/pages/entregas/components/__tests__/ListToolbar.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// Radix Select não abre em jsdom: o mesmo <select> nativo de NovaIdeiaDialog.test.tsx.
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    children: React.ReactNode;
  }) => (
    <select aria-label="Agrupar por" value={value} onChange={(e) => onValueChange(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}));

import { ListToolbar } from '../ListToolbar';

const ALL = ['prazo', 'postagem', 'cliente', 'responsavel', 'etapa', 'nenhum'] as const;

describe('ListToolbar', () => {
  it('oferece os agrupamentos recebidos com rótulos em português e avisa a troca', () => {
    const onGroupByChange = vi.fn();
    render(
      <ListToolbar
        groupBy="prazo"
        groupByOptions={ALL}
        onGroupByChange={onGroupByChange}
        responsaveisOpen={false}
        onToggleResponsaveis={vi.fn()}
        selectedResponsaveis={0}
      />,
    );
    const select = screen.getByRole('combobox', { name: 'Agrupar por' }) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
      'Prazo da etapa',
      'Data de postagem',
      'Cliente',
      'Responsável',
      'Etapa',
      'Nenhum',
    ]);
    fireEvent.change(select, { target: { value: 'cliente' } });
    expect(onGroupByChange).toHaveBeenCalledWith('cliente');
  });

  it('só oferece o que a página passar (sem Data de postagem na Lista de Fluxos)', () => {
    render(
      <ListToolbar
        groupBy="prazo"
        groupByOptions={ALL.filter((g) => g !== 'postagem')}
        onGroupByChange={vi.fn()}
        responsaveisOpen={false}
        onToggleResponsaveis={vi.fn()}
        selectedResponsaveis={0}
      />,
    );
    const select = screen.getByRole('combobox', { name: 'Agrupar por' }) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).not.toContain('postagem');
  });

  it('alterna o painel Responsáveis e mostra quantos estão marcados', () => {
    const onToggle = vi.fn();
    render(
      <ListToolbar
        groupBy="prazo"
        groupByOptions={ALL}
        onGroupByChange={vi.fn()}
        responsaveisOpen
        onToggleResponsaveis={onToggle}
        selectedResponsaveis={2}
      />,
    );
    const button = screen.getByRole('button', { name: /Responsáveis/ });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveTextContent('2');
    fireEvent.click(button);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/ListToolbar.test.tsx`
Expected: FAIL with "Failed to resolve import ../ListToolbar".

- [ ] **Step 3: Implement**

Create `apps/crm/src/pages/entregas/components/ListToolbar.tsx`:

```tsx
import { Rows3, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ListGroupBy } from '../viewQuery';

const LIST_GROUP_BY_LABELS: Record<ListGroupBy, string> = {
  prazo: 'Prazo da etapa',
  postagem: 'Data de postagem',
  cliente: 'Cliente',
  responsavel: 'Responsável',
  etapa: 'Etapa',
  nenhum: 'Nenhum',
};

/** Controles da vista Lista, na linha das abas: "Agrupar por" e o botão do
 *  painel Responsáveis. */
export function ListToolbar({
  groupBy,
  groupByOptions,
  onGroupByChange,
  responsaveisOpen,
  onToggleResponsaveis,
  selectedResponsaveis,
}: {
  groupBy: ListGroupBy;
  /** Data de postagem só existe em Publicações: a página decide a lista. */
  groupByOptions: readonly ListGroupBy[];
  onGroupByChange: (groupBy: ListGroupBy) => void;
  responsaveisOpen: boolean;
  onToggleResponsaveis: () => void;
  /** Quantos responsáveis estão marcados no filtro (selo no botão). */
  selectedResponsaveis: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <Select
        value={groupBy}
        onValueChange={(v) => {
          const next = groupByOptions.find((o) => o === v);
          if (next) onGroupByChange(next);
        }}
      >
        <SelectTrigger className="h-8 w-auto rounded-full text-xs gap-1.5" aria-label="Agrupar por">
          <Rows3 className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />
          <span style={{ color: 'var(--text-muted)' }}>Agrupar:</span>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {groupByOptions.map((o) => (
            <SelectItem key={o} value={o}>
              {LIST_GROUP_BY_LABELS[o]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="outline"
        // Aberto = fundo accent: o estado do painel fica visível no próprio botão.
        className={`h-8 rounded-full px-3 text-xs gap-1.5 font-normal mb-0${
          responsaveisOpen ? ' bg-accent' : ''
        }`}
        aria-expanded={responsaveisOpen}
        onClick={onToggleResponsaveis}
      >
        <Users className="h-3.5 w-3.5" aria-hidden="true" />
        Responsáveis
        {selectedResponsaveis > 0 && (
          <span
            className="inline-flex items-center justify-center rounded-full text-[0.6rem] font-semibold leading-none"
            style={{
              background: 'var(--primary-color)',
              color: '#000',
              width: '1.1rem',
              height: '1.1rem',
            }}
          >
            {selectedResponsaveis}
          </span>
        )}
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/ListToolbar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run format
git add apps/crm/src/pages/entregas/components/ListToolbar.tsx apps/crm/src/pages/entregas/components/__tests__/ListToolbar.test.tsx
git commit -m "feat(entregas): barra da Lista com Agrupar por e botão Responsáveis

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `ResponsaveisPanel`

**Files:**
- Create: `apps/crm/src/pages/entregas/components/ResponsaveisPanel.tsx`
- Test: `apps/crm/src/pages/entregas/components/__tests__/ResponsaveisPanel.test.tsx`

**Interfaces:**
- Produces: `ResponsaveisPanel({ membros: Membro[]; counts: ReadonlyMap<number, number>; selected: number[]; onChange: (ids: number[]) => void; caption: string; onClose?: () => void })`. Each checkbox has `aria-label={membro.nome}`, and the count span has `data-testid="responsavel-count"`.

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/pages/entregas/components/__tests__/ResponsaveisPanel.test.tsx`:

```tsx
import type { ComponentProps } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ResponsaveisPanel } from '../ResponsaveisPanel';
import type { Membro } from '../../../../store';

const membro = (id: number, nome: string) =>
  ({ id, nome, cargo: '', tipo: 'clt', custo_mensal: null, avatar_url: '' }) as Membro;
const membros = [membro(8, 'Bruno Lima'), membro(7, 'Ana Silva'), membro(9, 'Érica Souza')];

function renderPanel(props: Partial<ComponentProps<typeof ResponsaveisPanel>> = {}) {
  const onChange = vi.fn();
  const onClose = vi.fn();
  render(
    <ResponsaveisPanel
      membros={membros}
      counts={
        new Map([
          [7, 3],
          [8, 1],
        ])
      }
      selected={[]}
      onChange={onChange}
      caption="Responsável pela etapa atual"
      onClose={onClose}
      {...props}
    />,
  );
  return { onChange, onClose };
}

const countOf = (nome: string) =>
  within(screen.getByRole('checkbox', { name: nome }).closest('li')!).getByTestId(
    'responsavel-count',
  ).textContent;

describe('ResponsaveisPanel', () => {
  it('lista os membros em ordem alfabética (sem acento) com a contagem, 0 quando ausente', () => {
    renderPanel();
    expect(screen.getAllByRole('checkbox').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Ana Silva',
      'Bruno Lima',
      'Érica Souza',
    ]);
    expect(countOf('Ana Silva')).toBe('3');
    expect(countOf('Érica Souza')).toBe('0');
    expect(screen.getByText('Responsável pela etapa atual')).toBeInTheDocument();
  });

  it('marca e desmarca um membro na seleção', () => {
    const { onChange } = renderPanel({ selected: [8] });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ana Silva' }));
    expect(onChange).toHaveBeenLastCalledWith([8, 7]);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Bruno Lima' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('Limpar só aparece com seleção; o X fecha', () => {
    const first = renderPanel();
    expect(screen.queryByRole('button', { name: 'Limpar' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar painel de responsáveis' }));
    expect(first.onClose).toHaveBeenCalledTimes(1);
  });

  it('Limpar zera a seleção', () => {
    const { onChange } = renderPanel({ selected: [7] });
    fireEvent.click(screen.getByRole('button', { name: 'Limpar' }));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/ResponsaveisPanel.test.tsx`
Expected: FAIL with "Failed to resolve import ../ResponsaveisPanel".

- [ ] **Step 3: Implement**

Create `apps/crm/src/pages/entregas/components/ResponsaveisPanel.tsx`:

```tsx
import { X } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { avatarColorClass } from '@/lib/avatarColor';
import type { Membro } from '../../../store';

// Iniciais locais em vez do getInitials do store: EntregasPage.test mocka o
// store inteiro, e um import de valor de lá chegaria undefined no render.
function initials(nome: string): string {
  return nome
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

// Ordem alfabética pt-BR, sem diferenciar acento nem caixa (como FilaMembroPicker).
const byNome = (a: Membro, b: Membro) =>
  a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' });

/**
 * Painel "Responsáveis" da vista Lista: cada membro com quantas linhas estão
 * com ele e um checkbox que é o MESMO estado do filtro "Responsável"
 * (filterMembros). As contagens chegam prontas da página e ignoram o próprio
 * filtro de responsável: marcar a Ana não zera os números dos outros.
 */
export function ResponsaveisPanel({
  membros,
  counts,
  selected,
  onChange,
  caption,
  onClose,
}: {
  membros: Membro[];
  counts: ReadonlyMap<number, number>;
  selected: number[];
  onChange: (ids: number[]) => void;
  /** De quem é a contagem neste modo da Lista. */
  caption: string;
  /** Painel lateral (desktop): botão X. No Sheet do celular o Sheet fecha sozinho. */
  onClose?: () => void;
}) {
  const sorted = membros.filter((m) => m.id != null).sort(byNome);
  const toggle = (id: number, checked: boolean) =>
    onChange(checked ? [...selected, id] : selected.filter((s) => s !== id));

  return (
    <div className="flex flex-col gap-3">
      {/* Sem onClose o painel está no Sheet do celular, cujo X fica no canto
          superior direito: pr-8 tira o "Limpar" de baixo dele. */}
      <div className={`flex items-start justify-between gap-2${onClose ? '' : ' pr-8'}`}>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text-main)' }}>
            Responsáveis
          </h2>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {caption}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {selected.length > 0 && (
            <button
              type="button"
              className="text-xs underline"
              style={{ color: 'var(--text-muted)', background: 'none', border: 'none' }}
              onClick={() => onChange([])}
            >
              Limpar
            </button>
          )}
          {onClose && (
            <button
              type="button"
              aria-label="Fechar painel de responsáveis"
              onClick={onClose}
              className="rounded-md p-1 hover:bg-[var(--surface-hover)]"
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)' }}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      {sorted.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Nenhum membro na equipe.
        </p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {sorted.map((m) => {
            const id = m.id!;
            return (
              <li key={id}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-[var(--surface-hover)]">
                  <span
                    className={`avatar ${avatarColorClass(id)}`}
                    style={{ width: 22, height: 22, fontSize: '0.55rem', flexShrink: 0 }}
                    aria-hidden="true"
                  >
                    {initials(m.nome)}
                  </span>
                  <span className="min-w-0 flex-1 truncate" style={{ color: 'var(--text-main)' }}>
                    {m.nome}
                  </span>
                  <span
                    className="text-xs tabular-nums"
                    style={{ color: 'var(--text-muted)' }}
                    data-testid="responsavel-count"
                  >
                    {counts.get(id) ?? 0}
                  </span>
                  <Checkbox
                    aria-label={m.nome}
                    checked={selected.includes(id)}
                    onCheckedChange={(v) => toggle(id, v === true)}
                  />
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run apps/crm/src/pages/entregas/components/__tests__/ResponsaveisPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
npm run format
git add apps/crm/src/pages/entregas/components/ResponsaveisPanel.tsx apps/crm/src/pages/entregas/components/__tests__/ResponsaveisPanel.test.tsx
git commit -m "feat(entregas): painel Responsáveis com contagem por membro

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Wire it into `EntregasPage`

**Files:**
- Modify: `apps/crm/src/pages/entregas/EntregasPage.tsx`
- Test: `apps/crm/src/pages/entregas/__tests__/EntregasPage.test.tsx`

**Interfaces:**
- Consumes everything above: `ListGroupBy`, `LIST_GROUP_BYS`, `DEFAULT_LIST_GROUP_BY`, `loadListGroupBy`, `persistListGroupBy`, `countByResponsavel`, `postResponsavelIdOf`, `filterActivePosts`, `filterBoardCards`, `stageOfPost` (Task 3), `ListToolbar`, `ResponsaveisPanel`, `useIsDesktop` (`@/hooks/useIsDesktop`, existing), and `Sheet*` (`@/components/ui/sheet`, existing).
- Analytics events (new): `entregas_lista_agrupar` `{ agrupar, mode }` and `entregas_lista_responsaveis_aberto` `{ mode }`.

- [ ] **Step 1: Update the page test mocks**

In `apps/crm/src/pages/entregas/__tests__/EntregasPage.test.tsx`:

1. Next to the other hoisted mocks (e.g. after the `vi.mock('@/hooks/useCurrentMembro', …)` block), add:

```tsx
// jsdom's matchMedia is a stub; the Lista's Responsáveis panel is an inline
// aside on desktop and a Sheet below 901px. Each test picks the branch.
const isDesktopMock = vi.hoisted(() => ({ value: true }));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => isDesktopMock.value }));

// Like FilaMembroPicker: the Lista controls live in the tabs row and are
// unit-tested on their own (ListToolbar.test.tsx / ResponsaveisPanel.test.tsx).
vi.mock('../components/ListToolbar', () => ({
  ListToolbar: ({
    groupBy,
    groupByOptions,
    onGroupByChange,
    onToggleResponsaveis,
  }: {
    groupBy: string;
    groupByOptions: readonly string[];
    onGroupByChange: (g: string) => void;
    onToggleResponsaveis: () => void;
  }) => (
    <div>
      <div>GroupBy: {groupBy}</div>
      <div>GroupByOptions: {groupByOptions.join(',')}</div>
      <button onClick={() => onGroupByChange('cliente')}>Agrupar por cliente</button>
      <button onClick={onToggleResponsaveis}>Alternar responsáveis</button>
    </div>
  ),
}));

vi.mock('../components/ResponsaveisPanel', () => ({
  ResponsaveisPanel: ({
    counts,
    selected,
    onChange,
    caption,
  }: {
    counts: ReadonlyMap<number, number>;
    selected: number[];
    onChange: (ids: number[]) => void;
    caption: string;
  }) => (
    <div>
      <div>
        Contagens:{' '}
        {[...counts.entries()].map(([id, n]) => `${id}=${n}`).join(',')}
      </div>
      <div>Selecionados: {selected.join(',')}</div>
      <div>Legenda: {caption}</div>
      <button onClick={() => onChange([7])}>Marcar membro 7</button>
    </div>
  ),
}));
```

2. In the existing `vi.mock('../views/ListView', …)` mock, add `groupBy` to the destructured props (type `groupBy?: string`) and render `<div>ListGroupBy: {groupBy}</div>` inside its root `<div>`.
3. In the existing `vi.mock('../views/PostsListView', …)` mock, do the same, rendering `<div>PostsGroupBy: {groupBy}</div>`.

- [ ] **Step 2: Write the failing page tests**

Append a new top-level block at the end of `EntregasPage.test.tsx`:

```tsx
describe('EntregasPage: Lista agrupada e painel Responsáveis', () => {
  // No `postResponsaveis` in the fixture on purpose: filterBoardCards only reads
  // it while filterPostResponsaveis is non-empty, which these tests never set.
  function renderLista(entry: string, over: Record<string, unknown> = {}) {
    mockedUseEntregasData.mockReturnValue({
      clientes: [],
      membros: [
        { id: 7, nome: 'Ana' },
        { id: 8, nome: 'Bruno' },
      ],
      templates: [],
      cards: [
        makeCard({
          workflow: { id: 1, titulo: 'Fluxo Ana', cliente_id: 10, status: 'ativo' },
          etapa: { responsavel_id: 7 },
        }),
        makeCard({
          workflow: { id: 2, titulo: 'Fluxo Bruno', cliente_id: 10, status: 'ativo' },
          etapa: { responsavel_id: 8 },
        }),
      ],
      activeWorkflows: [wfFixture],
      postEntities: [],
      processByPostId: new Map(),
      concludedPostProcesses: [],
      activePostProcessCount: 0,
      postProcessesVisible: false,
      isLoading: false,
      isError: false,
      refresh: vi.fn(),
      ...over,
    } as never);
    return renderPage(entry);
  }

  beforeEach(() => {
    limitsMock.features = null;
    localStorage.clear();
    localStorage.setItem('entregas_explainer_dismissed_conta-1', 'true');
    mockedUseActivePosts.mockReturnValue({ posts: [], isLoading: false, isError: false });
    analyticsMock.captureEvent.mockReset();
    isDesktopMock.value = true;
  });

  it('lê agrupar= da URL e grava a nova escolha na URL e na preferência da conta', () => {
    renderLista('/entregas?view=list&agrupar=etapa');
    expect(screen.getByText('ListGroupBy: etapa')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Agrupar por cliente'));

    expect(screen.getByText('ListGroupBy: cliente')).toBeInTheDocument();
    expect(screen.getByTestId('current-path')).toHaveTextContent(
      /^\/entregas\?view=list&agrupar=cliente$/,
    );
    expect(localStorage.getItem('entregas_list_group_conta-1')).toBe('cliente');
    expect(analyticsMock.captureEvent).toHaveBeenCalledWith('entregas_lista_agrupar', {
      agrupar: 'cliente',
      mode: 'entregas',
    });
  });

  it('sem agrupar= na URL, começa pela preferência gravada', () => {
    localStorage.setItem('entregas_list_group_conta-1', 'nenhum');
    renderLista('/entregas?view=list');
    expect(screen.getByText('ListGroupBy: nenhum')).toBeInTheDocument();
    expect(screen.getByTestId('current-path')).toHaveTextContent(
      /^\/entregas\?view=list&agrupar=nenhum$/,
    );
  });

  it('sem URL e sem preferência, agrupa por prazo e deixa a URL limpa', () => {
    renderLista('/entregas?view=list');
    expect(screen.getByText('ListGroupBy: prazo')).toBeInTheDocument();
    expect(screen.getByTestId('current-path')).toHaveTextContent(/^\/entregas\?view=list$/);
  });

  it('na Lista de Fluxos, postagem vale como prazo e não é oferecida', () => {
    renderLista('/entregas?view=list&agrupar=postagem');
    expect(screen.getByText('ListGroupBy: prazo')).toBeInTheDocument();
    expect(
      screen.getByText('GroupByOptions: prazo,cliente,responsavel,etapa,nenhum'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('current-path')).toHaveTextContent(/^\/entregas\?view=list$/);
  });

  it('em Publicações, postagem é oferecida e aplicada', () => {
    renderLista('/entregas?view=list&mode=publicacoes&agrupar=postagem');
    expect(screen.getByText('PostsGroupBy: postagem')).toBeInTheDocument();
    expect(
      screen.getByText('GroupByOptions: prazo,postagem,cliente,responsavel,etapa,nenhum'),
    ).toBeInTheDocument();
  });

  it('painel: as contagens ignoram o próprio filtro de responsável e marcar filtra a lista', () => {
    renderLista('/entregas?view=list');
    expect(screen.queryByText(/Contagens:/)).toBeNull();

    fireEvent.click(screen.getByText('Alternar responsáveis'));
    expect(screen.getByText('Contagens: 7=1,8=1')).toBeInTheDocument();
    expect(screen.getByText('Legenda: Responsável pela etapa atual')).toBeInTheDocument();
    expect(analyticsMock.captureEvent).toHaveBeenCalledWith('entregas_lista_responsaveis_aberto', {
      mode: 'entregas',
    });

    fireEvent.click(screen.getByText('Marcar membro 7'));

    expect(screen.getByText('List view: Fluxo Ana')).toBeInTheDocument();
    expect(screen.getByText('Contagens: 7=1,8=1')).toBeInTheDocument();
    expect(screen.getByText('Selecionados: 7')).toBeInTheDocument();
    expect(screen.getByTestId('current-path')).toHaveTextContent(
      /^\/entregas\?view=list&membros=7$/,
    );
  });

  it('painel em Publicações conta pelo responsável da etapa e, sem etapa, pelo do próprio post', () => {
    mockedUseActivePosts.mockReturnValue({
      posts: [
        {
          id: 5,
          workflow_id: 1,
          cliente_id: 10,
          titulo: 'Post do fluxo',
          tipo: 'feed',
          status: 'rascunho',
          responsavel_id: null,
          scheduled_at: null,
        },
        {
          id: 6,
          workflow_id: null,
          cliente_id: 10,
          titulo: 'Avulso',
          tipo: 'feed',
          status: 'rascunho',
          responsavel_id: 8,
          scheduled_at: null,
        },
      ],
      isLoading: false,
      isError: false,
    } as never);
    renderLista('/entregas?view=list&mode=publicacoes');

    fireEvent.click(screen.getByText('Alternar responsáveis'));

    expect(screen.getByText('Contagens: 7=1,8=1')).toBeInTheDocument();
    expect(
      screen.getByText('Legenda: Quem está com o post na etapa atual'),
    ).toBeInTheDocument();
  });

  it('no celular o painel abre num Sheet', async () => {
    isDesktopMock.value = false;
    renderLista('/entregas?view=list');

    fireEvent.click(screen.getByText('Alternar responsáveis'));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Contagens: 7=1,8=1')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run apps/crm/src/pages/entregas/__tests__/EntregasPage.test.tsx -t "Lista agrupada"`
Expected: FAIL. There's no `ListGroupBy:` text yet (`groupBy` is undefined) and no "Alternar responsáveis" button.

- [ ] **Step 4: Implement the page wiring**

In `apps/crm/src/pages/entregas/EntregasPage.tsx`:

1. **Imports.** Add:

```ts
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { ListToolbar } from './components/ListToolbar';
import { ResponsaveisPanel } from './components/ResponsaveisPanel';
import { countByResponsavel } from './listGrouping';
```

   Then extend the existing imports:
   - `import { postStageOf } from './postStage';` becomes `import { postStageOf, postResponsavelIdOf } from './postStage';`.
   - Add `loadListGroupBy, persistListGroupBy,` to the `./entregasPrefs` import.
   - Add `LIST_GROUP_BYS, type ListGroupBy,` to the `./viewQuery` import (it already has `DEFAULT_LIST_GROUP_BY` from Task 1).

2. **Module constant.** Next to `EMPTY_POST_ENTITY_MAP`, add:

```ts
const EMPTY_COUNTS: ReadonlyMap<number, number> = new Map();
```

3. **Seed flag.** Next to `const hadEntidadeParam = useRef(searchParams.has('entidade')).current;`, add:

```ts
  const hadAgruparParam = useRef(searchParams.has('agrupar')).current;
```

4. **State.** Right after the `const [entidade, setEntidade] = useState<EntidadeFilter>(…);` block, add:

```ts
  // "Agrupar por" da Lista: `agrupar=` na URL vence a preferência da conta; sem
  // as duas, prazo. Mesmo esquema do modo (hadModeParam / loadLastMode).
  const [listGroupBy, setListGroupBy] = useState<ListGroupBy>(() =>
    hadAgruparParam && initialQuery.view === 'list'
      ? initialQuery.listGroupBy
      : (loadListGroupBy(contaId) ?? DEFAULT_LIST_GROUP_BY),
  );
  // Painel Responsáveis da Lista: aside ao lado da tabela a partir de 901px
  // (mesmo breakpoint da barra de filtros), Sheet de baixo abaixo disso.
  const [responsaveisOpen, setResponsaveisOpen] = useState(false);
  const isDesktop = useIsDesktop(901);
  // Cruzar o breakpoint com o painel aberto montaria o Sheet já aberto (ou
  // sumiria com o aside): fecha e deixa o usuário reabrir no layout novo.
  useEffect(() => {
    setResponsaveisOpen(false);
  }, [isDesktop]);
```

5. **Effective value.** Right after `const effectiveEntidade: EntidadeFilter = …;`, add:

```ts
  // Data de postagem só existe em Publicações: na Lista de Fluxos ela vale como
  // prazo, sem apagar a escolha (voltar a Publicações a traz de volta).
  const effectiveListGroupBy: ListGroupBy =
    listGroupBy === 'postagem' && mode !== 'publicacoes' ? DEFAULT_LIST_GROUP_BY : listGroupBy;
  const listGroupByOptions =
    mode === 'publicacoes' ? LIST_GROUP_BYS : LIST_GROUP_BYS.filter((g) => g !== 'postagem');
```

6. **URL.** In `serializeEntregasQuery({ … })`, replace the Task 1 placeholder `listGroupBy: DEFAULT_LIST_GROUP_BY,` with `listGroupBy: effectiveListGroupBy,`. The serializer ignores it outside `view=list`.

7. **Persist.** Right after the `persistLastMode` effect, add:

```ts
  useEffect(() => {
    if (activeView === 'list') persistListGroupBy(contaId, listGroupBy);
  }, [activeView, listGroupBy, contaId]);
```

8. **Saved vistas.** In `applySavedView`, after `setFilters(parsed.filters);`, add:

```ts
    if (parsed.view === 'list') setListGroupBy(parsed.listGroupBy);
```

9. **Handlers + member names + facet counts.** Right after `const visiblePostEntities = …;`, add:

```ts
  const handleListGroupByChange = (next: ListGroupBy) => {
    setListGroupBy(next);
    captureEvent('entregas_lista_agrupar', { agrupar: next, mode: activeMode });
  };
  const toggleResponsaveis = () => {
    const next = !responsaveisOpen;
    setResponsaveisOpen(next);
    if (next) captureEvent('entregas_lista_responsaveis_aberto', { mode: activeMode });
  };

  const membroNomeById = useMemo(
    () => new Map(membros.filter((m) => m.id != null).map((m) => [m.id!, m.nome])),
    [membros],
  );

  // Painel Responsáveis (Lista): contagem por responsável sobre as linhas que a
  // Lista mostraria SEM o filtro de responsável (facetas), com a regra de
  // "responsável" de cada modo e o mesmo filtro de entidade da Lista de Fluxos.
  // Só roda com o painel aberto.
  const responsavelCounts = useMemo(() => {
    if (activeView !== 'list' || !responsaveisOpen) return EMPTY_COUNTS;
    const semResponsavel: FilterState = { ...filters, filterMembros: [] };
    if (mode === 'publicacoes') {
      return countByResponsavel(
        filterActivePosts(activePosts, semResponsavel, stageOfPost).map((p) =>
          postResponsavelIdOf(p, stageOfPost(p)),
        ),
      );
    }
    const cardIds =
      effectiveEntidade === 'posts'
        ? []
        : filterBoardCards(cards, semResponsavel, postResponsaveis).map(
            (c) => c.etapa.responsavel_id ?? null,
          );
    const entityIds =
      effectiveEntidade === 'fluxos'
        ? []
        : postEntities
            .filter((e) => matchesPostEntityFilters(e, semResponsavel))
            .map((e) => e.step.responsavel_id ?? null);
    return countByResponsavel([...cardIds, ...entityIds]);
  }, [
    activeView,
    responsaveisOpen,
    filters,
    mode,
    activePosts,
    stageOfPost,
    effectiveEntidade,
    cards,
    postResponsaveis,
    postEntities,
  ]);

  const renderResponsaveisPanel = (onClose?: () => void) => (
    <ResponsaveisPanel
      membros={membros}
      counts={responsavelCounts}
      selected={filters.filterMembros}
      onChange={(filterMembros) => setFilters({ ...filters, filterMembros })}
      caption={
        mode === 'publicacoes'
          ? 'Quem está com o post na etapa atual'
          : 'Responsável pela etapa atual'
      }
      onClose={onClose}
    />
  );
```

10. **Toolbar: in the tabs row on desktop, its own row on phones.** Below 901px the tabs row scrolls horizontally and already holds six tabs plus the Etapas/Status and entity toggles, so a control at its end sits off-screen (the mockups showed it). Right after `renderResponsaveisPanel`, add:

```tsx
  const listToolbar = (
    <ListToolbar
      groupBy={effectiveListGroupBy}
      groupByOptions={listGroupByOptions}
      onGroupByChange={handleListGroupByChange}
      responsaveisOpen={responsaveisOpen}
      onToggleResponsaveis={toggleResponsaveis}
      selectedResponsaveis={filters.filterMembros.length}
    />
  );
```

In the horizontally scrolling row, between the `EntidadeToggle` block and the `{activeView === 'concluded' && (` block, add:

```tsx
          {activeView === 'list' && isDesktop && (
            <div style={{ marginLeft: 'auto', flexShrink: 0 }}>{listToolbar}</div>
          )}
```

Then, right after the closing `</div>` of the `flex flex-wrap items-center gap-3 min-[901px]:gap-y-6` wrapper (filters + tabs), add:

```tsx
      {/* Celular: a linha das abas rola na horizontal, então a barra da Lista
          ganha linha própria em vez de ficar escondida no fim da rolagem. */}
      {activeView === 'list' && !isDesktop && listToolbar}
```

11. **List region.** Replace the whole `{activeView === 'list' && (mode === 'entregas' ? ( <ListView … /> ) : ( <PostsListView … /> ))}` expression with:

```tsx
      {activeView === 'list' && (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
          <div style={{ flex: '1 1 0%', minWidth: 0 }}>
            {mode === 'entregas' ? (
              <ListView
                cards={visibleCards}
                postEntities={visiblePostEntities}
                onPostClick={handlePostEntityClick}
                sort={listSort}
                onSortChange={setListSort}
                onCardClick={handleCardClick}
                groupBy={effectiveListGroupBy}
              />
            ) : (
              <PostsListView
                posts={filteredPosts}
                isLoading={activePostsLoading}
                openableWorkflowIds={openableWorkflowIds}
                onPostClick={handlePostClick}
                onFluxoClick={handleFluxoClick}
                cardsByWorkflowId={cardsByWorkflowId}
                filtersActive={postsFiltersActive}
                onCreateAvulso={() => {
                  setAvulsoTemplateId(null);
                  setNewAvulsoOpen(true);
                }}
                postEntityByPostId={postEntityByPostId}
                groupBy={effectiveListGroupBy}
                membroNomeById={membroNomeById}
              />
            )}
          </div>
          {isDesktop && responsaveisOpen && (
            <aside
              className="card animate-up"
              aria-label="Responsáveis"
              style={{ width: 260, flexShrink: 0, padding: '1rem' }}
            >
              {renderResponsaveisPanel(() => setResponsaveisOpen(false))}
            </aside>
          )}
        </div>
      )}
      {activeView === 'list' && !isDesktop && (
        <Sheet open={responsaveisOpen} onOpenChange={setResponsaveisOpen}>
          <SheetContent
            side="bottom"
            className="rounded-t-[24px] max-h-[85vh] overflow-y-auto pb-24"
          >
            <SheetTitle className="sr-only">Responsáveis</SheetTitle>
            <SheetDescription className="sr-only">Filtre a lista por responsável</SheetDescription>
            {renderResponsaveisPanel()}
          </SheetContent>
        </Sheet>
      )}
```

- [ ] **Step 5: Run the page suite and the whole Entregas folder**

Run: `npx vitest run apps/crm/src/pages/entregas`
Expected: PASS, both the new block and every existing test. In particular, the "filtro de entidade" test still sees `/entregas?view=list` after clicking "Lista".

Run: `npx tsc -p apps/crm/tsconfig.json --noEmit && npm run lint`
Expected: no errors and no new warnings. If `react-hooks/exhaustive-deps` flags the `responsavelCounts` memo, add the missing dependency; don't silence it.

- [ ] **Step 6: Commit**

```bash
npm run format
git add apps/crm/src/pages/entregas/EntregasPage.tsx apps/crm/src/pages/entregas/__tests__/EntregasPage.test.tsx
git commit -m "feat(entregas): Lista agrupada e painel Responsáveis na página

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Final verification (CI gates + browser)

**Files:** none new. Fix anything found in the files above.

- [ ] **Step 1: Every CI gate this change can affect**

```bash
npm run lint
npm run format:check
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
```

Expected: all green. The Hub imports `apps/crm/style.css`, so its `tsc` plus a quick look at the Hub is the regression check for the appended CSS. The new `.list-group-*` selectors are unused there. `check:functions` / `test:functions` are unaffected (nothing under `supabase/`). Skip them locally; if you do run them, run `npm ci` afterwards (Deno pollutes `node_modules`).

- [ ] **Step 2: Start the CRM in the Browser pane**

Confirm `ls .env.staging` first: worktrees usually lack it, and without it the `:staging` scripts silently hit prod (memory `reference_worktree_env_staging_gotcha`). If it's present, use `preview_start` with `{ name: "crm-staging" }` (the entry already exists in `.claude/launch.json`). Log in with the seed flow from the memory note `reference_seed_login_browser_verification`. If `.env.staging` is absent, or staging has no usable data, use `{ name: "crm" }` (prod) and **only read**: grouping, collapsing and checking members are local UI state, but do not open or edit any post.

- [ ] **Step 3: Desktop checks (≥1101px)**

Entregas → **Lista**:
1. **Fluxos mode** groups by "Prazo da etapa" by default. Check the order: Atrasado (red label) / Hoje / Amanhã / weekday · date / Depois / Sem prazo. Header counts must equal the visible rows. Collapse and expand a group. Column sort still works inside groups.
2. Switch through every "Agrupar por" option. "Data de postagem" is **absent** in Fluxos.
3. **Publicações mode**: "Data de postagem" is present, groups by `scheduled_at`, and puts "Sem data" last. An avulso without a process shows its own responsável in the Responsável column.
4. **Responsáveis** opens the aside. Checking a member filters the table, the "Responsável" pill in the filter bar shows the same selection, the **other members' counts don't change**, and the button badge shows the count. "Limpar" and the X both work.
5. Reload. The grouping choice persists, and the URL carries `agrupar=` except for `prazo`.
6. Save a vista on Lista with the default grouping, switch away, then apply it. It highlights as active and restores the grouping. A Lista vista saved **before** this change (no `agrupar=`) still highlights while grouping is `prazo`.
7. `read_console_messages` shows no errors.

- [ ] **Step 4: Mobile and dark**

`resize_window` with `{ preset: "mobile" }`, reload, then Lista:
- The toolbar sits on its own row under the tabs. Nothing of it is hidden at the end of the scrolling tabs row.
- "Responsáveis" opens a **bottom Sheet** with the same list, and checking a member filters the table behind it.
- The group headers fit, with no horizontal page scroll beyond the table's own.

Then set dark mode the way the app does (`document.documentElement.dataset.theme = 'dark'` via `javascript_tool` is fine for inspection). Group headers, count chips, the red "Atrasado" label and the aside should all read correctly. Reset with `{ preset: "desktop" }` when done.

- [ ] **Step 5: Proof**

Take a `computer` screenshot of the grouped Lista with the Responsáveis aside open, and one of the mobile Sheet. Share both with the user.

- [ ] **Step 6: Hand off**

Use superpowers:finishing-a-development-branch. Frontend-only change: no migration or function deploy before merge, and merging deploys the CRM on Vercel.

---

## Out of scope (deliberately not built)

- **Prioridade** column/field: needs a migration, a `post` column grant and Hub changes.
- **"Não atribuído" as a checkable panel entry**: `filterMembros` can't express "no responsável" today. Grouping by Responsável already shows a "Sem responsável" group.
- **Inline "+ Adicionar" per group**: a prazo belongs to the etapa/processo, not the post, so the prefill semantics need their own design.
- **Responsáveis panel on Kanban/Calendário.**
- **Persisting collapsed groups or panel open state.**
- **Member photos in the panel**: initials only, like the filter pill.

## Self-review notes

- Spec coverage:
  - Grouping by date/cliente/responsável/etapa: Tasks 2, 5 and 6.
  - Collapsible headers with counts: Task 4.
  - Responsáveis panel with facet counts: Tasks 3, 8 and 9.
  - Saved vistas and URL: Tasks 1 and 9.
  - Persisted default: Tasks 1 and 9.
  - Mobile: Tasks 9 and 10.
- Type names used across tasks: `ListGroupBy`, `LIST_GROUP_BYS`, `DEFAULT_LIST_GROUP_BY`, `groupListRows`, `ListGroupAccessors`, `ListGroup`, `countByResponsavel`, `toggleKey`, `postResponsavelIdOf`, `filterActivePosts`, `filterBoardCards`, `stageOfPost`, `ListGroupHeaderRow`, `ListToolbar`, `ResponsaveisPanel`, `loadListGroupBy`, `persistListGroupBy`.
