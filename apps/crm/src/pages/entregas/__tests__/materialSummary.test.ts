import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../../lib/supabase');

const getMaterialSummary = vi.fn();
vi.mock('@/store/postReferences', () => ({
  getMaterialSummary: (ids: number[]) => getMaterialSummary(ids),
}));

import { fetchMaterialSummaryMap, materialBadge, matchesMaterialFilter } from '../materialSummary';

const row = (status: 'aberto' | 'concluido' | 'cancelado', done: number, total: number) => ({
  post_id: 1,
  status,
  done,
  total,
});

describe('materialBadge', () => {
  it('shows "aguardando" while open, whatever the post status', () => {
    expect(materialBadge(row('aberto', 1, 3), 'rascunho')).toEqual({
      kind: 'aguardando',
      done: 1,
      total: 3,
    });
    expect(materialBadge(row('aberto', 0, 2), 'enviado_cliente')?.kind).toBe('aguardando');
  });

  it('shows "recebido" only for a concluded request on an internal post', () => {
    for (const s of ['rascunho', 'revisao_interna', 'aprovado_interno']) {
      expect(materialBadge(row('concluido', 3, 3), s)).toEqual({
        kind: 'recebido',
        done: 3,
        total: 3,
      });
    }
    expect(materialBadge(row('concluido', 3, 3), 'enviado_cliente')).toBeNull();
  });

  it('keeps X de N when the client closed with items missing', () => {
    expect(materialBadge(row('concluido', 2, 3), 'rascunho')).toEqual({
      kind: 'recebido',
      done: 2,
      total: 3,
    });
  });

  it('shows nothing for cancelled or missing requests', () => {
    expect(materialBadge(row('cancelado', 0, 3), 'rascunho')).toBeNull();
    expect(materialBadge(undefined, 'rascunho')).toBeNull();
  });
});

describe('matchesMaterialFilter', () => {
  it('empty selection keeps everything', () => {
    expect(matchesMaterialFilter(undefined, 'rascunho', [])).toBe(true);
  });
  it('aguardando keeps only open requests', () => {
    expect(matchesMaterialFilter(row('aberto', 0, 1), 'rascunho', ['aguardando'])).toBe(true);
    expect(matchesMaterialFilter(row('concluido', 1, 1), 'rascunho', ['aguardando'])).toBe(false);
    expect(matchesMaterialFilter(undefined, 'rascunho', ['aguardando'])).toBe(false);
  });
  it('recebido follows the badge rule', () => {
    expect(matchesMaterialFilter(row('concluido', 1, 1), 'rascunho', ['recebido'])).toBe(true);
    expect(matchesMaterialFilter(row('concluido', 1, 1), 'agendado', ['recebido'])).toBe(false);
  });
  it('both selected is a union', () => {
    const both: ('aguardando' | 'recebido')[] = ['aguardando', 'recebido'];
    expect(matchesMaterialFilter(row('aberto', 0, 1), 'rascunho', both)).toBe(true);
    expect(matchesMaterialFilter(row('concluido', 1, 1), 'rascunho', both)).toBe(true);
    expect(matchesMaterialFilter(row('cancelado', 0, 1), 'rascunho', both)).toBe(false);
  });
});

describe('fetchMaterialSummaryMap', () => {
  beforeEach(() => getMaterialSummary.mockReset());

  it('chunks the ids by 200, one request per chunk', async () => {
    getMaterialSummary.mockImplementation(async (ids: number[]) =>
      ids.filter((i) => i % 2 === 0).map((i) => ({ ...row('aberto', 0, 1), post_id: i })),
    );
    const ids = Array.from({ length: 450 }, (_, i) => i + 1);
    const map = await fetchMaterialSummaryMap(ids);
    expect(getMaterialSummary).toHaveBeenCalledTimes(3);
    expect(getMaterialSummary.mock.calls.map((c) => c[0].length)).toEqual([200, 200, 50]);
    expect(map.size).toBe(225);
    expect(map.get(2)?.status).toBe('aberto');
  });

  it('makes no request for an empty list', async () => {
    expect((await fetchMaterialSummaryMap([])).size).toBe(0);
    expect(getMaterialSummary).not.toHaveBeenCalled();
  });
});
