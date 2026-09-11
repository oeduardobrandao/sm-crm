import { describe, expect, it, vi } from 'vitest';
vi.mock('../../../lib/supabase');
import { EMPTY_FILTERS } from '../components/EntregasFilters';
import { matchesPostEntityFilters } from '../entityFilters';
import type { PostEntity } from '../boardEntity';

const NOW = new Date(2026, 6, 15, 10, 0, 0);

function entity(over: Partial<PostEntity> = {}): PostEntity {
  return {
    kind: 'post',
    id: 'post:1',
    process: {
      id: 1,
      post_id: 50,
      template_id: 7,
      post: { id: 50, cliente_id: 3, responsavel_id: 11, titulo: 'Reels de julho' },
    } as never,
    step: { responsavel_id: 8 } as never,
    templateId: 7,
    steps: [],
    etapaOrdem: 0,
    etapaNome: 'Design',
    responsavel: undefined,
    prazoEfetivo: new Date(2026, 6, 15, 18, 0, 0),
    posicao: 0,
    deadline: { diasRestantes: 0, horasRestantes: 8, estourado: false, urgente: true },
    cliente: undefined,
    titulo: 'Reels de julho',
    ...over,
  };
}

describe('matchesPostEntityFilters', () => {
  it('sem filtros aceita', () => {
    expect(matchesPostEntityFilters(entity(), EMPTY_FILTERS, NOW)).toBe(true);
  });
  it('busca por título, cliente, responsável da etapa, responsável do post, etapa e template', () => {
    const e = entity();
    expect(matchesPostEntityFilters(e, { ...EMPTY_FILTERS, filterSearch: 'JULHO' }, NOW)).toBe(
      true,
    );
    expect(matchesPostEntityFilters(e, { ...EMPTY_FILTERS, filterSearch: 'agosto' }, NOW)).toBe(
      false,
    );
    expect(matchesPostEntityFilters(e, { ...EMPTY_FILTERS, filterClientes: [3] }, NOW)).toBe(true);
    expect(matchesPostEntityFilters(e, { ...EMPTY_FILTERS, filterClientes: [4] }, NOW)).toBe(false);
    expect(matchesPostEntityFilters(e, { ...EMPTY_FILTERS, filterMembros: [8] }, NOW)).toBe(true);
    expect(matchesPostEntityFilters(e, { ...EMPTY_FILTERS, filterMembros: [11] }, NOW)).toBe(false);
    expect(
      matchesPostEntityFilters(e, { ...EMPTY_FILTERS, filterPostResponsaveis: [11] }, NOW),
    ).toBe(true);
    expect(matchesPostEntityFilters(e, { ...EMPTY_FILTERS, filterEtapas: ['Design'] }, NOW)).toBe(
      true,
    );
    expect(matchesPostEntityFilters(e, { ...EMPTY_FILTERS, filterEtapas: ['Copy'] }, NOW)).toBe(
      false,
    );
    expect(matchesPostEntityFilters(e, { ...EMPTY_FILTERS, filterTemplates: [7] }, NOW)).toBe(true);
    expect(
      matchesPostEntityFilters(
        entity({ templateId: null }),
        { ...EMPTY_FILTERS, filterTemplates: [7] },
        NOW,
      ),
    ).toBe(false);
  });
  it('status de prazo e prazo da etapa usam o mesmo bucket e o mesmo matcher dos fluxos', () => {
    const e = entity();
    expect(matchesPostEntityFilters(e, { ...EMPTY_FILTERS, filterStatus: ['urgente'] }, NOW)).toBe(
      true,
    );
    expect(matchesPostEntityFilters(e, { ...EMPTY_FILTERS, filterStatus: ['atrasado'] }, NOW)).toBe(
      false,
    );
    expect(matchesPostEntityFilters(e, { ...EMPTY_FILTERS, filterPrazo: ['hoje'] }, NOW)).toBe(
      true,
    );
    expect(
      matchesPostEntityFilters(
        entity({ prazoEfetivo: null }),
        { ...EMPTY_FILTERS, filterPrazo: ['hoje'] },
        NOW,
      ),
    ).toBe(false);
  });
});
