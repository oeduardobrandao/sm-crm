import { describe, expect, it, vi } from 'vitest';
vi.mock('../../../lib/supabase');
import { EMPTY_FILTERS } from '../components/EntregasFilters';
import {
  productionFiltersActive,
  selectSemProcessoPosts,
  SEM_PROCESSO_LIMIT,
} from '../semProcesso';
import type { ActivePost } from '../../../store';

function post(id: number, over: Partial<ActivePost> = {}): ActivePost {
  return {
    id,
    workflow_id: null,
    cliente_id: 1,
    cliente_nome: 'A',
    workflow_titulo: null,
    titulo: `Post ${id}`,
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
    ...over,
  };
}

describe('selectSemProcessoPosts', () => {
  it('só avulsos sem processo vigente, mais recentes primeiro por id', () => {
    const out = selectSemProcessoPosts(
      [post(1), post(2, { workflow_id: 9 }), post(3), post(4)],
      (id) => id === 3,
      EMPTY_FILTERS,
    );
    expect(out.map((p) => p.id)).toEqual([4, 1]);
  });
  it('aplica busca, cliente e responsável do post; ignora os filtros de produção', () => {
    const posts = [
      post(1, { titulo: 'Reels' }),
      post(2, { titulo: 'Feed', cliente_id: 2, responsavel_id: 5 }),
    ];
    expect(
      selectSemProcessoPosts(posts, () => false, { ...EMPTY_FILTERS, filterSearch: 'reels' }).map(
        (p) => p.id,
      ),
    ).toEqual([1]);
    expect(
      selectSemProcessoPosts(posts, () => false, { ...EMPTY_FILTERS, filterClientes: [2] }).map(
        (p) => p.id,
      ),
    ).toEqual([2]);
    expect(
      selectSemProcessoPosts(posts, () => false, {
        ...EMPTY_FILTERS,
        filterPostResponsaveis: [5],
      }).map((p) => p.id),
    ).toEqual([2]);
    expect(
      selectSemProcessoPosts(posts, () => false, { ...EMPTY_FILTERS, filterEtapas: ['Copy'] }),
    ).toHaveLength(2);
  });
  it('productionFiltersActive só olha os filtros de etapa/template/responsável da etapa/status/prazo', () => {
    expect(productionFiltersActive(EMPTY_FILTERS)).toBe(false);
    expect(
      productionFiltersActive({ ...EMPTY_FILTERS, filterSearch: 'x', filterClientes: [1] }),
    ).toBe(false);
    expect(productionFiltersActive({ ...EMPTY_FILTERS, filterEtapas: ['Copy'] })).toBe(true);
    expect(productionFiltersActive({ ...EMPTY_FILTERS, filterPrazoTo: '2026-01-01' })).toBe(true);
    expect(SEM_PROCESSO_LIMIT).toBe(12);
  });
});
