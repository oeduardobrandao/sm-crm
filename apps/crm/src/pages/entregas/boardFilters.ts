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
// A Lista de Publicações ainda passa o resultado de filterActivePosts por
// withoutPostados (abaixo), na lista e nas contagens do painel.

/** Filtros do modo Fluxos sobre os cards de fluxo. Every dropdown filter is
 *  multi-select: empty means "no filter", otherwise a card matches if it hits
 *  ANY of the selected values. Keep in sync with matchesPostEntityFilters
 *  (entityFilters.ts), which applies this same chain to individual posts: a new
 *  filter step goes in both. */
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
 * Os campos lidos aqui têm de bater com `postsFiltersActive` (EntregasPage),
 * que decide entre "Ajuste os filtros" e o estado vazio de criar avulso.
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

/**
 * Lista de Publicações: posts já postados ficam fora por padrão (o Kanban segue
 * com a coluna Postado). `status` é a coluna canônica, então um status
 * personalizado que se comporta como postado sai junto. A página só aplica isto
 * com o filtro de status do post vazio: com ele em uso, o filtro decide.
 */
export function withoutPostados(posts: ActivePost[]): ActivePost[] {
  return posts.filter((p) => p.status !== 'postado');
}
