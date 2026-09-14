import { describe, expect, it } from 'vitest';
import { filtersToReveal } from '../revealFilters';
import { EMPTY_FILTERS } from '../components/EntregasFilters';
import type { PostEntity } from '../boardEntity';

const entity = {
  kind: 'post',
  id: 'post:9',
  titulo: 'Reels de setembro',
  templateId: 3,
  etapaOrdem: 1,
  etapaNome: 'Design',
  steps: [],
  responsavel: undefined,
  prazoEfetivo: null,
  posicao: 0,
  deadline: { diasRestantes: 2, horasRestantes: 0, estourado: false, urgente: false },
  cliente: undefined,
  process: {
    id: 9,
    post_id: 77,
    post: { cliente_id: 4, responsavel_id: null, status: 'rascunho' },
  },
  step: { responsavel_id: 8 },
} as unknown as PostEntity;

describe('filtersToReveal', () => {
  it('não mexe em nada quando a entidade já é visível', () => {
    const f = { ...EMPTY_FILTERS, filterClientes: [4] };
    expect(filtersToReveal([entity], f)).toEqual({ filters: f, cleared: [] });
  });
  it('limpa SÓ as dimensões que escondem (cliente e etapa), preservando as outras', () => {
    const f = {
      ...EMPTY_FILTERS,
      filterClientes: [99],
      filterEtapas: ['Copy'],
      filterMembros: [8],
      filterSearch: 'reels',
    };
    const r = filtersToReveal([entity], f);
    expect(r.cleared.sort()).toEqual(['filterClientes', 'filterEtapas']);
    expect(r.filters).toEqual({ ...f, filterClientes: [], filterEtapas: [] });
  });
  it('trata prazo (preset + intervalo) como uma dimensão só', () => {
    const f = { ...EMPTY_FILTERS, filterPrazo: ['atrasado' as const] };
    const r = filtersToReveal([entity], f);
    expect(r.cleared).toEqual(
      expect.arrayContaining(['filterPrazo', 'filterPrazoFrom', 'filterPrazoTo']),
    );
  });
});
