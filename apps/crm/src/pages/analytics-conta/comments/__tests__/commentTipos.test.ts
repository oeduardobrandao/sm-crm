import { describe, expect, it } from 'vitest';
import type { Categoria, IgComment, StoredAnalysis } from '../../../../services/instagramComments';
import { countByTipo, tipoOf, tiposState, untypedCounts } from '../commentTipos';

function c(id: string, extra: Partial<IgComment> = {}): IgComment {
  return {
    id,
    text: `texto ${id}`,
    timestamp: '2026-11-21T10:00:00Z',
    username: `user_${id}`,
    like_count: 0,
    replies_count: 0,
    replies_more: false,
    ...extra,
  };
}

function analysis(
  tipos?: Record<string, Categoria | null>,
  status?: 'ok' | 'failed',
): StoredAnalysis {
  return {
    result: {
      sentimento_geral: 'positivo',
      resumo: '',
      distribuicao: { apoio: 0, duvida: 0, critica: 0, discussao: 0, spam: 0 },
      temas: [],
      perguntas_frequentes: [],
      ideias: [],
      ...(tipos ? { tipos } : {}),
      ...(status ? { tipos_status: status } : {}),
    },
    comments_analyzed: 0,
    comments_count_at_analysis: 0,
    posts_analyzed: null,
    analyzed_at: '2026-11-21T12:00:00Z',
    period_start: null,
    period_end: null,
  } as StoredAnalysis;
}

describe('tiposState', () => {
  it('classifica o estado da leitura', () => {
    expect(tiposState(null)).toBe('none');
    expect(tiposState(analysis())).toBe('legacy');
    expect(tiposState(analysis({}, 'failed'))).toBe('failed');
    expect(tiposState(analysis({}, 'ok'))).toBe('ok');
  });
});

describe('tipoOf', () => {
  const a = analysis({ a: 'apoio', n: null, o: 'spam' }, 'ok');
  it('devolve o tipo do mapa', () => {
    expect(tipoOf(c('a'), a)).toBe('apoio');
  });
  it('null para fora do mapa, valor null, dono e sem leitura', () => {
    expect(tipoOf(c('x'), a)).toBeNull();
    expect(tipoOf(c('n'), a)).toBeNull();
    expect(tipoOf(c('o', { from_owner: true }), a)).toBeNull();
    expect(tipoOf(c('a'), null)).toBeNull();
  });
});

describe('countByTipo', () => {
  it('conta por tipo', () => {
    const a = analysis({ a: 'apoio', b: 'apoio', s: 'spam', n: null }, 'ok');
    const list = [c('a'), c('b'), c('s'), c('n'), c('fora')];
    expect(countByTipo(list, a)).toEqual({
      apoio: 2,
      duvida: 0,
      critica: 0,
      discussao: 0,
      spam: 1,
    });
  });
  it('leitura antiga zera tudo', () => {
    expect(countByTipo([c('a')], analysis())).toEqual({
      apoio: 0,
      duvida: 0,
      critica: 0,
      discussao: 0,
      spam: 0,
    });
  });
});

describe('untypedCounts', () => {
  it('separa novos depois da leitura de sem classificação', () => {
    const a = analysis({ t: 'apoio', nul: null, nul2: null }, 'ok');
    const list = [
      c('late', { timestamp: '2026-11-21T13:00:00Z' }),
      c('early', { timestamp: '2026-11-21T11:00:00Z' }),
      c('nul', { timestamp: '2026-11-21T10:00:00Z' }),
      c('nul2', { timestamp: '2026-11-21T13:00:00Z' }),
      c('bad', { timestamp: 'nope' }),
      c('own', { from_owner: true, timestamp: '2026-11-21T13:00:00Z' }),
      c('t', { timestamp: '2026-11-21T13:00:00Z' }),
    ];
    expect(untypedCounts(list, a)).toEqual({ late: 1, unclassified: 4 });
  });
});
