import type { TFunction } from 'i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import pt from '../../../../../packages/i18n/locales/pt/analyticsComments.json';
import en from '../../../../../packages/i18n/locales/en/analyticsComments.json';

const { i18nMock } = vi.hoisted(() => ({ i18nMock: { language: 'pt' } }));
vi.mock('@mesaas/i18n', () => ({ i18n: i18nMock }));

vi.mock('../analytics', () => ({
  EDGE_URL: 'https://edge.test/functions/v1/instagram-analytics',
  getAuthHeaders: async () => ({ Authorization: 'Bearer t' }),
}));

import {
  CommentsApiError,
  analyzeAccountComments,
  analyzePostComments,
  commentsErrorMessage,
  deleteComment,
  getAccountCommentsAnalysis,
  getPostComments,
  setCommentHidden,
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

// `t` do namespace analyticsComments em português, sem subir o i18next.
const t = ((key: string) =>
  key
    .split('.')
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown>)?.[part],
      pt,
    )) as unknown as TFunction;

afterEach(() => {
  vi.unstubAllGlobals();
  i18nMock.language = 'pt';
});

describe('instagramComments service', () => {
  it('lança CommentsApiError com code do corpo', async () => {
    mockFetch(409, { error: 'missing_comments_scope' });
    const err = await getPostComments(1, 'm1').catch((e) => e);
    expect(err).toBeInstanceOf(CommentsApiError);
    expect(err.code).toBe('missing_comments_scope');
    expect(err.status).toBe(409);
  });

  it('token do Instagram expirado: lê code do corpo { error: true, code }', async () => {
    mockFetch(401, { error: true, code: 'TOKEN_EXPIRED' });
    const err = await getPostComments(1, 'm1').catch((e) => e);
    expect(err).toBeInstanceOf(CommentsApiError);
    expect(err.status).toBe(401);
    expect(err.code).toBe('TOKEN_EXPIRED');
  });

  it('401 sem code (login do usuário) fica unknown', async () => {
    mockFetch(401, { error: 'Unauthorized' });
    const err = await getPostComments(1, 'm1').catch((e) => e);
    expect(err.status).toBe(401);
    expect(err.code).toBe('Unauthorized');
    expect(commentsErrorMessage(err, t)).toBe('Não foi possível carregar os comentários.');
  });

  it('chama as rotas do contrato e desembrulha analysis', async () => {
    const analysis = { result: {}, comments_analyzed: 3 };
    const f = mockFetch(200, { analysis, current_comments: 4 });
    expect(await analyzePostComments(7, 'm9')).toBe(analysis);
    expect(f.mock.calls[0][0]).toBe(
      'https://edge.test/functions/v1/instagram-analytics/comments-analysis/7/m9?lang=pt',
    );
    expect(f.mock.calls[0][1].method).toBe('POST');
    expect((await getAccountCommentsAnalysis(7)).current_comments).toBe(4);
    expect(f.mock.calls[1][0]).toMatch(/\/comments-analysis-account\/7$/);
    expect(f.mock.calls[1][1].method).toBe('GET');
    await analyzeAccountComments(7);
    expect(f.mock.calls[2][0]).toMatch(/\/comments-analysis-account\/7\?lang=pt$/);
    expect(f.mock.calls[2][1].method).toBe('POST');
  });

  it('com a interface em inglês, o POST pede a análise em inglês', async () => {
    i18nMock.language = 'en';
    const f = mockFetch(200, { analysis: { result: {} } });
    await analyzePostComments(7, 'm9');
    await analyzeAccountComments(7);
    expect(f.mock.calls[0][0]).toMatch(/\?lang=en$/);
    expect(f.mock.calls[1][0]).toMatch(/\?lang=en$/);
  });

  it('commentsErrorMessage mapeia cada código', () => {
    const m = (code: string, status = 500) =>
      commentsErrorMessage(new CommentsApiError(code, status), t);
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
    expect(commentsErrorMessage(new Error('boom'), t)).toBe(
      'Não foi possível carregar os comentários.',
    );
  });

  it('setCommentHidden faz POST em /post-comments/:c/:p/:id/hide com {hidden}', async () => {
    const f = mockFetch(200, { id: 'c1', hidden: true });
    const r = await setCommentHidden(7, 'm/9', 'c1', true);
    expect(r).toEqual({ id: 'c1', hidden: true });
    expect(f.mock.calls[0][0]).toBe(
      'https://edge.test/functions/v1/instagram-analytics/post-comments/7/m%2F9/c1/hide',
    );
    const init = f.mock.calls[0][1];
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify({ hidden: true }));
  });

  it('deleteComment faz DELETE sem body', async () => {
    const f = mockFetch(200, { id: 'c1', deleted: true });
    expect(await deleteComment(7, 'm9', 'c1')).toEqual({ id: 'c1', deleted: true });
    expect(f.mock.calls[0][0]).toMatch(/\/post-comments\/7\/m9\/c1$/);
    const init = f.mock.calls[0][1];
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
    expect(init.headers['Content-Type']).toBeUndefined();
  });

  it('write_rate_limited usa error.writeRateLimited, não error.rateLimited', () => {
    const msg = commentsErrorMessage(new CommentsApiError('write_rate_limited', 429), t);
    expect(msg).toBe('Muitas ações seguidas. Tente de novo em alguns minutos.');
    expect(msg).not.toBe(pt.error.rateLimited);
  });

  it('429 rate_limited segue error.rateLimited', () => {
    expect(commentsErrorMessage(new CommentsApiError('rate_limited', 429), t)).toBe(
      pt.error.rateLimited,
    );
  });

  it('comment_unavailable e comment_not_found usam error.commentGone', () => {
    for (const code of ['comment_unavailable', 'comment_not_found']) {
      expect(commentsErrorMessage(new CommentsApiError(code, 404), t)).toBe(
        'Não foi possível encontrar esse comentário no Instagram. A lista foi atualizada.',
      );
    }
  });

  it('forbidden e owner_comment_not_hideable têm texto próprio', () => {
    expect(commentsErrorMessage(new CommentsApiError('forbidden', 403), t)).toBe(
      'Você não tem permissão para moderar comentários.',
    );
    expect(commentsErrorMessage(new CommentsApiError('owner_comment_not_hideable', 409), t)).toBe(
      'O Instagram não permite ocultar comentários da própria conta.',
    );
  });

  it('pt e en têm as mesmas chaves em moderation e error', () => {
    expect(Object.keys(en.moderation).sort()).toEqual(Object.keys(pt.moderation).sort());
    expect(Object.keys(en.error).sort()).toEqual(Object.keys(pt.error).sort());
  });

  it('nenhum texto novo tem travessão', () => {
    const newErrors = ['forbidden', 'writeRateLimited', 'commentGone', 'ownerNotHideable'] as const;
    for (const lang of [pt, en]) {
      const values = [...Object.values(lang.moderation), ...newErrors.map((k) => lang.error[k])];
      expect(values.length).toBeGreaterThan(newErrors.length);
      for (const v of values) expect(v).not.toContain('—');
    }
  });
});
