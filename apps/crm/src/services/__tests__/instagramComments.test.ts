import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../analytics', () => ({
  EDGE_URL: 'https://edge.test/functions/v1/instagram-analytics',
  getAuthHeaders: async () => ({ Authorization: 'Bearer t' }),
}));

import {
  CommentsApiError,
  analyzeAccountComments,
  analyzePostComments,
  commentsErrorMessage,
  getAccountCommentsAnalysis,
  getPostComments,
} from '../instagramComments';

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe('instagramComments service', () => {
  it('lança CommentsApiError com code do corpo', async () => {
    mockFetch(409, { error: 'missing_comments_scope' });
    const err = await getPostComments(1, 'm1').catch((e) => e);
    expect(err).toBeInstanceOf(CommentsApiError);
    expect(err.code).toBe('missing_comments_scope');
    expect(err.status).toBe(409);
  });

  it('chama as rotas do contrato e desembrulha analysis', async () => {
    const analysis = { result: {}, comments_analyzed: 3 };
    const f = mockFetch(200, { analysis, current_comments: 4 });
    expect(await analyzePostComments(7, 'm9')).toBe(analysis);
    expect(f.mock.calls[0][0]).toBe(
      'https://edge.test/functions/v1/instagram-analytics/comments-analysis/7/m9',
    );
    expect(f.mock.calls[0][1].method).toBe('POST');
    expect((await getAccountCommentsAnalysis(7)).current_comments).toBe(4);
    expect(f.mock.calls[1][0]).toMatch(/\/comments-analysis-account\/7$/);
    expect(f.mock.calls[1][1].method).toBe('GET');
    await analyzeAccountComments(7);
    expect(f.mock.calls[2][1].method).toBe('POST');
  });

  it('commentsErrorMessage mapeia cada código', () => {
    const m = (code: string, status = 500) =>
      commentsErrorMessage(new CommentsApiError(code, status));
    expect(m('missing_comments_scope', 409)).toBe(
      'Reconecte o Instagram deste cliente para ver os comentários.',
    );
    expect(m('too_few_comments', 422)).toBe('Ainda não há comentários suficientes para analisar.');
    expect(m('ai_unavailable', 503)).toBe('A análise por IA está indisponível no momento.');
    expect(m('ai_timeout', 504)).toBe('A análise demorou demais. Tente de novo.');
    expect(m('ai_bad_output', 502)).toBe('Não foi possível gerar a análise. Tente de novo.');
    expect(m('rate_limited', 429)).toBe(
      'Muitas análises seguidas. Tente de novo em alguns minutos.',
    );
    expect(m('x')).toBe('Não foi possível carregar os comentários.');
    expect(commentsErrorMessage(new Error('boom'))).toBe(
      'Não foi possível carregar os comentários.',
    );
  });
});
