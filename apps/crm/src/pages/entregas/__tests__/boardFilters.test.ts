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
    custom_status_id: null,
    scheduled_at: null,
    published_at: null,
    ig_caption: null,
    instagram_permalink: null,
    publish_error: null,
    publish_error_code: null,
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
