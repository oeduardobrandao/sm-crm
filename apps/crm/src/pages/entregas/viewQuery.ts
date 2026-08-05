import type { FilterState, StatusFilter } from './components/EntregasFilters';
import { EMPTY_FILTERS } from './components/EntregasFilters';
import type { EntregasMode } from './components/ModeToggle';
import { TIPO_ORDER } from './postLabels';
import { isStatusKeyToken } from './statusRegistry';
import type { StatusKey } from './statusRegistry';
import { PRAZO_PRESET_ORDER } from './etapaPrazo';

export type ActiveView = 'kanban' | 'chart' | 'calendar' | 'list' | 'concluded';

const VIEWS: readonly ActiveView[] = ['kanban', 'chart', 'calendar', 'list', 'concluded'];
const STATUS_VALUES: readonly StatusFilter[] = ['atrasado', 'urgente', 'em_dia'];

export interface EntregasViewState {
  view: ActiveView;
  /** Mode of the ACTIVE view (only meaningful for kanban/calendar/list). */
  mode: EntregasMode;
  filters: FilterState;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Serializes the page state into a shareable query string. Defaults are omitted
 * so the URL stays clean ('' for the default kanban/entregas/no-filters state).
 * Multi-value filters use repeated params (etapas=Design&etapas=Copy) so values
 * containing commas survive the round trip.
 */
export function serializeEntregasQuery(state: EntregasViewState): string {
  const p = new URLSearchParams();
  if (state.view !== 'kanban') p.set('view', state.view);
  if (state.mode !== 'entregas') p.set('mode', state.mode);

  const f = state.filters;
  if (f.filterSearch) p.set('q', f.filterSearch);
  const append = (key: string, values: readonly (string | number)[]) => {
    for (const v of values) p.append(key, String(v));
  };
  append('clientes', f.filterClientes);
  append('membros', f.filterMembros);
  append('resp', f.filterPostResponsaveis);
  append('status', f.filterStatus);
  append('etapas', f.filterEtapas);
  append('templates', f.filterTemplates);
  append('tipos', f.filterTipos);
  append('pstatus', f.filterPostStatus);
  append('prazo', f.filterPrazo);
  if (f.filterPrazoFrom) p.set('de', f.filterPrazoFrom);
  if (f.filterPrazoTo) p.set('ate', f.filterPrazoTo);
  return p.toString();
}

/** Inverse of serializeEntregasQuery. Unknown/malformed values fall back to defaults. */
export function parseEntregasQuery(p: URLSearchParams): EntregasViewState {
  const rawView = p.get('view') as ActiveView | null;
  const view = rawView && VIEWS.includes(rawView) ? rawView : 'kanban';
  const mode: EntregasMode = p.get('mode') === 'publicacoes' ? 'publicacoes' : 'entregas';

  const nums = (key: string) =>
    p
      .getAll(key)
      .map((v) => parseInt(v, 10))
      .filter((n) => !isNaN(n));
  const oneOf = <T extends string>(key: string, valid: readonly T[]): T[] =>
    p.getAll(key).filter((v): v is T => (valid as readonly string[]).includes(v));
  const day = (key: string) => {
    const v = p.get(key) ?? '';
    return DATE_RE.test(v) ? v : '';
  };

  const filters: FilterState = {
    ...EMPTY_FILTERS,
    filterSearch: p.get('q') ?? '',
    filterClientes: nums('clientes'),
    filterMembros: nums('membros'),
    filterPostResponsaveis: nums('resp'),
    filterStatus: oneOf('status', STATUS_VALUES),
    filterEtapas: p.getAll('etapas'),
    filterTemplates: nums('templates'),
    filterTipos: oneOf('tipos', TIPO_ORDER),
    // Canonical statuses plus 'custom:<uuid>' tokens. Unknown custom ids
    // simply match no post; the filter UI prunes them on the next change.
    filterPostStatus: p.getAll('pstatus').filter(isStatusKeyToken) as StatusKey[],
    filterPrazo: oneOf('prazo', PRAZO_PRESET_ORDER),
    filterPrazoFrom: day('de'),
    filterPrazoTo: day('ate'),
  };

  return { view, mode, filters };
}
