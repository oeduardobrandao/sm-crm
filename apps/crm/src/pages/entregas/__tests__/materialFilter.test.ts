import { describe, expect, it, vi } from 'vitest';
vi.mock('../../../lib/supabase');

import { filterActivePosts } from '../boardFilters';
import { countActiveFilters, EMPTY_FILTERS } from '../components/EntregasFilters';
import { parseEntregasQuery, serializeEntregasQuery } from '../viewQuery';
import type { ActivePost } from '../../../store';
import type { MaterialSummaryRow } from '@/store/postReferences';

const post = (id: number, status: string) => ({ id, status }) as unknown as ActivePost;
const rows = new Map<number, MaterialSummaryRow>([
  [1, { post_id: 1, status: 'aberto', done: 0, total: 2 }],
  [2, { post_id: 2, status: 'concluido', done: 2, total: 2 }],
  [3, { post_id: 3, status: 'concluido', done: 2, total: 2 }],
]);
const materialOf = (id: number) => rows.get(id);

describe('filterMaterial', () => {
  it('starts empty and counts as one active filter in posts mode only', () => {
    expect(EMPTY_FILTERS.filterMaterial).toEqual([]);
    const f = { ...EMPTY_FILTERS, filterMaterial: ['aguardando' as const] };
    expect(countActiveFilters(f, 'posts')).toBe(1);
    expect(countActiveFilters(f, 'entregas')).toBe(0);
  });

  it('"aguardando" keeps only open requests', () => {
    const out = filterActivePosts(
      [post(1, 'rascunho'), post(2, 'rascunho'), post(4, 'rascunho')],
      { ...EMPTY_FILTERS, filterMaterial: ['aguardando'] },
      () => undefined,
      materialOf,
    );
    expect(out.map((p) => p.id)).toEqual([1]);
  });

  it('"recebido" keeps concluded requests on internal posts only', () => {
    const out = filterActivePosts(
      [post(2, 'rascunho'), post(3, 'enviado_cliente')],
      { ...EMPTY_FILTERS, filterMaterial: ['recebido'] },
      () => undefined,
      materialOf,
    );
    expect(out.map((p) => p.id)).toEqual([2]);
  });

  it('round-trips through the URL and old queries without it default to []', () => {
    const state = {
      view: 'kanban' as const,
      mode: 'publicacoes' as const,
      entidade: 'fluxos' as const,
      filaMembro: null,
      listGroupBy: 'prazo' as const,
      showPostados: false,
      filters: { ...EMPTY_FILTERS, filterMaterial: ['aguardando' as const, 'recebido' as const] },
    };
    const qs = serializeEntregasQuery(state);
    expect(parseEntregasQuery(new URLSearchParams(qs)).filters.filterMaterial).toEqual([
      'aguardando',
      'recebido',
    ]);
    expect(
      parseEntregasQuery(new URLSearchParams('mode=publicacoes&pstatus=agendado')).filters
        .filterMaterial,
    ).toEqual([]);
    expect(
      parseEntregasQuery(new URLSearchParams('material=bogus')).filters.filterMaterial,
    ).toEqual([]);
  });
});
