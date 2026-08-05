import { describe, expect, it, vi } from 'vitest';

// EntregasFilters (imported for EMPTY_FILTERS) now pulls useStatusRegistry ->
// store -> the supabase client, which throws without env vars in tests.
vi.mock('../../../lib/supabase');

import { parseEntregasQuery, serializeEntregasQuery } from '../viewQuery';
import { EMPTY_FILTERS } from '../components/EntregasFilters';

describe('viewQuery', () => {
  it('serializes the default state to an empty query', () => {
    expect(
      serializeEntregasQuery({ view: 'kanban', mode: 'entregas', filters: EMPTY_FILTERS }),
    ).toBe('');
  });

  it('round-trips a fully loaded state', () => {
    const state = {
      view: 'list' as const,
      mode: 'publicacoes' as const,
      filters: {
        ...EMPTY_FILTERS,
        filterSearch: 'post de julho',
        filterClientes: [1, 2],
        filterMembros: [7],
        filterPostResponsaveis: [9],
        filterStatus: ['atrasado' as const],
        filterEtapas: ['Design', 'Copy, revisada'], // comma inside a value must survive
        filterTemplates: [3],
        filterTipos: ['reels' as const],
        filterPostStatus: ['agendado' as const],
        filterPrazo: ['hoje' as const, 'atrasado' as const],
        filterPrazoFrom: '2026-07-01',
        filterPrazoTo: '2026-07-31',
      },
    };
    const qs = serializeEntregasQuery(state);
    const parsed = parseEntregasQuery(new URLSearchParams(qs));
    expect(parsed).toEqual(state);
  });

  it('falls back to defaults on unknown or malformed values', () => {
    const parsed = parseEntregasQuery(
      new URLSearchParams(
        'view=nope&mode=weird&clientes=abc&status=inventado&tipos=gif&prazo=ontem&de=31/07/2026&pstatus=x',
      ),
    );
    expect(parsed.view).toBe('kanban');
    expect(parsed.mode).toBe('entregas');
    expect(parsed.filters).toEqual(EMPTY_FILTERS);
  });

  it('round-trips custom status keys in pstatus and drops malformed ones', () => {
    const customStatusKey = 'custom:11111111-2222-3333-4444-555555555555' as const;
    const state = {
      view: 'kanban' as const,
      mode: 'publicacoes' as const,
      filters: {
        ...EMPTY_FILTERS,
        filterPostStatus: ['revisao_interna' as const, customStatusKey],
      },
    };
    const parsed = parseEntregasQuery(new URLSearchParams(serializeEntregasQuery(state)));
    expect(parsed.filters.filterPostStatus).toEqual(['revisao_interna', customStatusKey]);

    const malformed = parseEntregasQuery(
      new URLSearchParams('pstatus=custom:nope&pstatus=custom:&pstatus=publicando'),
    );
    expect(malformed.filters.filterPostStatus).toEqual([]);
  });

  it('parses a hand-written shareable URL', () => {
    const parsed = parseEntregasQuery(
      new URLSearchParams('view=list&mode=publicacoes&prazo=hoje&clientes=10'),
    );
    expect(parsed.view).toBe('list');
    expect(parsed.mode).toBe('publicacoes');
    expect(parsed.filters.filterPrazo).toEqual(['hoje']);
    expect(parsed.filters.filterClientes).toEqual([10]);
  });

  it('ignores the transient drawer param', () => {
    const parsed = parseEntregasQuery(new URLSearchParams('drawer=5'));
    expect(parsed.view).toBe('kanban');
    expect(parsed.filters).toEqual(EMPTY_FILTERS);
  });
});
