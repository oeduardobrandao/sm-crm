import type { EntregasMode } from './components/ModeToggle';
import { BOARD_COLUMN_SORTS, type BoardColumnSort } from './postsBoardOrder';

/** Ordenacao de uma coluna (etapa) do board de Fluxos: 'prazo' (padrao,
 *  atrasados primeiro) ou 'manual' (position persistida via drag). */
export type FluxosColumnSort = 'prazo' | 'manual';

const FLUXOS_COLUMN_SORTS: FluxosColumnSort[] = ['prazo', 'manual'];

const fluxosSortsKey = (contaId: string) => `entregas_fluxos_sorts_${contaId}`;

/** Sort escolhido por coluna do board de Fluxos (chave `${rowKey}::${etapa}`),
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
