import type { FilterState, StatusFilter } from './components/EntregasFilters';
import type { PostEntity } from './boardEntity';
import { classifyDeadline } from './deadlineStatus';
import { matchesDeadlineFilter } from './etapaPrazo';

/**
 * The Fluxos-mode page filters applied to an individual post (mirror of the
 * `filteredCards` chain in EntregasPage, field by field, in the same order).
 * filterTipos / filterPostStatus only exist on the Publicações bar and are not
 * read here, exactly like `filteredCards`.
 */
export function matchesPostEntityFilters(
  entity: PostEntity,
  filters: FilterState,
  now: Date = new Date(),
): boolean {
  if (filters.filterSearch) {
    if (!entity.titulo.toLowerCase().includes(filters.filterSearch.toLowerCase())) return false;
  }
  const clienteId = entity.process.post.cliente_id;
  if (filters.filterClientes.length) {
    if (clienteId == null || !filters.filterClientes.includes(clienteId)) return false;
  }
  if (filters.filterMembros.length) {
    const r = entity.step.responsavel_id;
    if (r == null || !filters.filterMembros.includes(r)) return false;
  }
  if (filters.filterPostResponsaveis.length) {
    const r = entity.process.post.responsavel_id;
    if (r == null || !filters.filterPostResponsaveis.includes(r)) return false;
  }
  if (filters.filterEtapas.length && !filters.filterEtapas.includes(entity.etapaNome)) return false;
  if (filters.filterTemplates.length) {
    if (entity.templateId == null || !filters.filterTemplates.includes(entity.templateId))
      return false;
  }
  if (filters.filterStatus.length) {
    const status: StatusFilter = classifyDeadline(entity.deadline);
    if (!filters.filterStatus.includes(status)) return false;
  }
  if (filters.filterPrazo.length || filters.filterPrazoFrom || filters.filterPrazoTo) {
    if (
      !matchesDeadlineFilter(
        { deadline: entity.deadline, date: entity.prazoEfetivo },
        filters.filterPrazo,
        filters.filterPrazoFrom,
        filters.filterPrazoTo,
        now,
      )
    )
      return false;
  }
  return true;
}
