import type { EntregasMode } from './components/ModeToggle';
import type { EntidadeFilter, ListGroupBy } from './viewQuery';
import { BOARD_COLUMN_SORTS, type BoardColumnSort } from './postsBoardOrder';
import type { FilaOrdem } from './minhaFila';

/** Ordenacao de uma coluna (etapa) do board de Fluxos: 'prazo' (padrao,
 *  atrasados primeiro) ou 'manual' (position persistida via drag). */
export type FluxosColumnSort = 'prazo' | 'manual';

const FLUXOS_COLUMN_SORTS: FluxosColumnSort[] = ['prazo', 'manual'];

const fluxosSortsKey = (contaId: string) => `entregas_fluxos_sorts_${contaId}`;

/** Sort escolhido por coluna do board de Fluxos (chave `${rowKey}::${ordem}`),
 *  por conta. Valores desconhecidos sao descartados no load. */
export function loadFluxosColumnSorts(contaId: string): Partial<Record<string, FluxosColumnSort>> {
  try {
    const raw = localStorage.getItem(fluxosSortsKey(contaId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed == null || typeof parsed !== 'object') return {};
    const out: Partial<Record<string, FluxosColumnSort>> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && (FLUXOS_COLUMN_SORTS as string[]).includes(value)) {
        out[key] = value as FluxosColumnSort;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function persistFluxosColumnSort(
  contaId: string,
  columnKey: string,
  sort: FluxosColumnSort,
): void {
  try {
    const current = loadFluxosColumnSorts(contaId);
    current[columnKey] = sort;
    localStorage.setItem(fluxosSortsKey(contaId), JSON.stringify(current));
  } catch {
    // Best effort: a preferencia so nao sobrevive ao reload.
  }
}

const storageKey = (contaId: string) => `entregas_last_mode_${contaId}`;

/** Last mode the user left Entregas in (Fluxos vs Publicações), per conta.
 *  Falls back to 'entregas' on a missing key or any storage failure. */
export function loadLastMode(contaId: string): EntregasMode {
  try {
    return localStorage.getItem(storageKey(contaId)) === 'publicacoes' ? 'publicacoes' : 'entregas';
  } catch {
    return 'entregas';
  }
}

export function persistLastMode(contaId: string, mode: EntregasMode): void {
  try {
    localStorage.setItem(storageKey(contaId), mode);
  } catch {
    // Private browsing / storage full -- the preference just doesn't survive a reload.
  }
}

const entidadeKey = (contaId: string) => `entregas_entidade_${contaId}`;
const ENTIDADES: EntidadeFilter[] = ['todos', 'fluxos', 'posts'];

/** Último filtro de entidade do quadro de Fluxos, por conta. null quando não
 *  há preferência gravada (ou o valor é lixo) -- a página então decide entre
 *  Fluxos e Todos pelo proxy hasLastMode (spec §4.1). */
export function loadLastEntidade(contaId: string): EntidadeFilter | null {
  try {
    const raw = localStorage.getItem(entidadeKey(contaId));
    return raw && (ENTIDADES as string[]).includes(raw) ? (raw as EntidadeFilter) : null;
  } catch {
    return null;
  }
}

export function persistLastEntidade(contaId: string, entidade: EntidadeFilter): void {
  try {
    localStorage.setItem(entidadeKey(contaId), entidade);
  } catch {
    // Best effort: a preferência só não sobrevive ao reload.
  }
}

/** "Já usou Entregas neste navegador": a chave de modo existe, qualquer valor.
 *  loadLastMode não serve porque devolve 'entregas' tanto para ausente quanto
 *  para o valor gravado. */
export function hasLastMode(contaId: string): boolean {
  try {
    return localStorage.getItem(storageKey(contaId)) !== null;
  } catch {
    return false;
  }
}

const boardSortsKey = (contaId: string) => `entregas_board_sorts_${contaId}`;

/** Sort escolhido por coluna do board de Publicações, por conta. Valores
 *  desconhecidos (versões antigas, lixo) são descartados no load. */
export function loadBoardColumnSorts(contaId: string): Partial<Record<string, BoardColumnSort>> {
  try {
    const raw = localStorage.getItem(boardSortsKey(contaId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed == null || typeof parsed !== 'object') return {};
    const out: Partial<Record<string, BoardColumnSort>> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && (BOARD_COLUMN_SORTS as string[]).includes(value)) {
        out[key] = value as BoardColumnSort;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function persistBoardColumnSort(
  contaId: string,
  columnKey: string,
  sort: BoardColumnSort,
): void {
  try {
    const current = loadBoardColumnSorts(contaId);
    current[columnKey] = sort;
    localStorage.setItem(boardSortsKey(contaId), JSON.stringify(current));
  } catch {
    // Best effort: a preferência só não sobrevive ao reload.
  }
}

const listGroupKey = (contaId: string) => `entregas_list_group_${contaId}`;
// Cópia local da lista válida, como ENTIDADES acima: importar o valor de
// viewQuery puxaria EntregasFilters e o store para este módulo.
const LIST_GROUPS: ListGroupBy[] = [
  'prazo',
  'postagem',
  'cliente',
  'responsavel',
  'etapa',
  'nenhum',
];

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

// Lista local (só tipo de minhaFila): o módulo da fila puxa o store e o cliente
// supabase, que este arquivo de preferências não precisa carregar.
const FILA_ORDENS: FilaOrdem[] = ['prazo', 'publicacao'];

const filaOrdemKey = (contaId: string) => `entregas_fila_ordem_${contaId}`;

/** Ordem da Minha fila (prazo da etapa ou data de publicação), por conta.
 *  Cai no padrão, 'prazo', sem preferência gravada ou com lixo. */
export function loadFilaOrdem(contaId: string): FilaOrdem {
  try {
    const raw = localStorage.getItem(filaOrdemKey(contaId));
    return raw && (FILA_ORDENS as string[]).includes(raw) ? (raw as FilaOrdem) : 'prazo';
  } catch {
    return 'prazo';
  }
}

export function persistFilaOrdem(contaId: string, ordem: FilaOrdem): void {
  try {
    localStorage.setItem(filaOrdemKey(contaId), ordem);
  } catch {
    // Best effort: a preferência só não sobrevive ao reload.
  }
}
