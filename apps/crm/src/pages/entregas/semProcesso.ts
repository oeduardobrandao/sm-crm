import type { ActivePost } from '../../store';
import type { FilterState } from './components/EntregasFilters';

/** Spec §4.3: no máximo 12 cards; paginação fica fora da v1. */
export const SEM_PROCESSO_LIMIT = 12;

/**
 * Avulsos sem execução vigente (nem ativa nem concluída), a partir do cache
 * ['active-posts'] de Publicações. Aplica os filtros que existem na barra do
 * modo Fluxos e falam de post (busca, cliente, responsável do post); os
 * filtros de produção não se aplicam e a seção avisa em vez de esconder.
 * Ordem: id desc (a consulta não expõe created_at/updated_at; o id é serial).
 */
export function selectSemProcessoPosts(
  posts: ActivePost[],
  hasProcess: (postId: number) => boolean,
  filters: Pick<FilterState, 'filterSearch' | 'filterClientes' | 'filterPostResponsaveis'>,
): ActivePost[] {
  let ps = posts.filter((p) => p.workflow_id == null && !hasProcess(p.id));
  if (filters.filterSearch) {
    const q = filters.filterSearch.toLowerCase();
    ps = ps.filter((p) => p.titulo.toLowerCase().includes(q));
  }
  if (filters.filterClientes.length)
    ps = ps.filter((p) => p.cliente_id != null && filters.filterClientes.includes(p.cliente_id));
  if (filters.filterPostResponsaveis.length)
    ps = ps.filter(
      (p) => p.responsavel_id != null && filters.filterPostResponsaveis.includes(p.responsavel_id),
    );
  return [...ps].sort((a, b) => b.id - a.id);
}

/** Filtros de etapa, template, responsável da etapa, status de prazo e prazo:
 *  não se aplicam à seção; quando algum está ativo ela mostra o aviso. */
export function productionFiltersActive(filters: FilterState): boolean {
  return (
    filters.filterMembros.length > 0 ||
    filters.filterEtapas.length > 0 ||
    filters.filterTemplates.length > 0 ||
    filters.filterStatus.length > 0 ||
    filters.filterPrazo.length > 0 ||
    !!filters.filterPrazoFrom ||
    !!filters.filterPrazoTo
  );
}
