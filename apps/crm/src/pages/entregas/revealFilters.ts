import { EMPTY_FILTERS, type FilterState } from './components/EntregasFilters';
import { matchesPostEntityFilters } from './entityFilters';
import type { PostEntity } from './boardEntity';

/** Dimensões independentes do filtro do modo Fluxos; prazo é uma só. */
const GROUPS: (keyof FilterState)[][] = [
  ['filterSearch'],
  ['filterClientes'],
  ['filterMembros'],
  ['filterPostResponsaveis'],
  ['filterEtapas'],
  ['filterTemplates'],
  ['filterStatus'],
  ['filterPrazo', 'filterPrazoFrom', 'filterPrazoTo'],
];

function withCleared(filters: FilterState, keys: (keyof FilterState)[]): FilterState {
  const out = { ...filters } as Record<keyof FilterState, unknown>;
  for (const k of keys) out[k] = EMPTY_FILTERS[k];
  return out as FilterState;
}

/**
 * Spec §4.1: revelar o card "removendo só os filtros que o ocultariam". Uma
 * dimensão esconde a entidade quando ela passa com TODAS as dimensões limpas
 * mas não passa com todas limpas EXCETO essa. União sobre as entidades.
 */
export function filtersToReveal(
  entities: PostEntity[],
  filters: FilterState,
  now: Date = new Date(),
): { filters: FilterState; cleared: (keyof FilterState)[] } {
  const all = GROUPS.flat();
  const cleared = new Set<keyof FilterState>();
  for (const e of entities) {
    if (matchesPostEntityFilters(e, filters, now)) continue;
    if (!matchesPostEntityFilters(e, withCleared(filters, all), now)) continue; // hidden by something we cannot clear
    for (const group of GROUPS) {
      const allButThis = all.filter((k) => !group.includes(k));
      if (!matchesPostEntityFilters(e, withCleared(filters, allButThis), now))
        group.forEach((k) => cleared.add(k));
    }
  }
  const keys = [...cleared];
  return { filters: keys.length ? withCleared(filters, keys) : filters, cleared: keys };
}
