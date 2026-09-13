import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createFetchMock } from '../../../../../test/shared/fetchMock';

vi.mock('../../lib/supabase');

import { getPublishedMedia } from '../publishedMedia';

// Cobre a distinção 409 vs 429 vs erro genérico que a Task 6 vai depender pra
// mostrar mensagens diferentes ("reconecte o Instagram" x "aguarde e tente de
// novo"). Nada mais no repo garante isso -- um refactor que remova o `code`
// de qualquer um dos três ramos deve fazer estes testes falharem.

const fetchHarness = createFetchMock();

describe('getPublishedMedia', () => {
  beforeEach(() => {
    fetchHarness.reset();
    vi.stubGlobal('fetch', fetchHarness.fetchMock);
  });

  it('retorna posts e next_cursor no 200', async () => {
    fetchHarness.queueResponse({
      ok: true,
      status: 200,
      json: {
        posts: [
          {
            id: 'media-1',
            caption: 'Legenda',
            media_type: 'IMAGE',
            thumbnail_url: null,
            permalink: 'https://instagram.com/p/media-1',
            timestamp: '2026-09-01T12:00:00Z',
          },
        ],
        next_cursor: 'cursor-abc',
      },
    });

    const page = await getPublishedMedia(42);

    expect(page.posts).toHaveLength(1);
    expect(page.posts[0].id).toBe('media-1');
    expect(page.next_cursor).toBe('cursor-abc');

    const call = fetchHarness.calls[0];
    expect(String(call.input)).toContain('/instagram-integration/published-media/42');
    expect(call.init?.method).toBe('POST');
  });

  it('lança erro com code "instagram_not_authorized" no 409', async () => {
    fetchHarness.queueResponse({
      ok: false,
      status: 409,
      json: {
        error: true,
        code: 'instagram_not_authorized',
        message: 'Conta do Instagram nao autorizada',
      },
    });

    await expect(getPublishedMedia(42)).rejects.toMatchObject({
      code: 'instagram_not_authorized',
      message: 'Conta do Instagram nao autorizada',
    });
  });

  it('lança erro com code "rate_limited" no 429', async () => {
    fetchHarness.queueResponse({
      ok: false,
      status: 429,
      json: {
        error: true,
        code: 'rate_limited',
        message: 'Muitas requisições seguidas. Aguarde um minuto e tente novamente.',
      },
    });

    await expect(getPublishedMedia(42)).rejects.toMatchObject({
      code: 'rate_limited',
      message: 'Muitas requisições seguidas. Aguarde um minuto e tente novamente.',
    });
  });

  it('sintetiza code "rate_limited" no 429 quando o corpo não vem reconhecível (fallback defensivo de infra)', async () => {
    fetchHarness.queueResponse({
      ok: false,
      status: 429,
      json: {},
    });

    await expect(getPublishedMedia(42)).rejects.toMatchObject({
      code: 'rate_limited',
    });
  });

  it('lança erro sem code num erro genérico (ex.: 502)', async () => {
    fetchHarness.queueResponse({
      ok: false,
      status: 502,
      json: { error: true, message: 'Nao foi possivel listar as midias' },
    });

    const error = await getPublishedMedia(42).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Nao foi possivel listar as midias');
    expect(error.code).toBeUndefined();
  });

  it('usa mensagem genérica quando o erro não tem corpo JSON válido', async () => {
    fetchHarness.queueResponse({
      ok: false,
      status: 500,
      json: new Error('bad json'),
    });

    await expect(getPublishedMedia(42)).rejects.toThrow('Falha ao listar mídias publicadas');
  });
});
