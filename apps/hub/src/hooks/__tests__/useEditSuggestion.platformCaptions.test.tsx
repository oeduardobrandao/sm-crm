import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  classifySaveError,
  resetEditSuggestionFailuresForTests,
  useEditSuggestion,
} from '../useEditSuggestion';
import { submitEditSuggestion } from '../../api';
import type { HubPost, PendingEditSuggestion } from '../../types';

vi.mock('../../api', () => ({
  submitEditSuggestion: vi.fn(),
}));
vi.mock('@mesaas/app-lifecycle', () => ({
  useUnsavedWork: () => undefined,
}));

const mockedSubmit = vi.mocked(submitEditSuggestion);

function makePost(overrides: Partial<HubPost> = {}): HubPost {
  return {
    id: 900,
    titulo: 'Reels',
    tipo: 'reels',
    status: 'enviado_cliente',
    ordem: 1,
    conteudo: null,
    conteudo_plain: 'corpo',
    ig_caption: 'IG vivo',
    tiktok_caption: 'TT vivo',
    geral_caption: 'G vivo',
    targets: ['instagram', 'tiktok', 'geral'],
    scheduled_at: null,
    workflow_id: null,
    workflow_titulo: null,
    media: [],
    cover_media: null,
    pending_suggestion: null,
    suggestion_rejected_at: null,
    ...overrides,
  } as HubPost;
}

function suggestion(over: Partial<PendingEditSuggestion> = {}): PendingEditSuggestion {
  return {
    id: 1,
    suggested_conteudo: null,
    suggested_conteudo_plain: 'corpo',
    suggested_ig_caption: 'IG vivo',
    suggested_tiktok_caption: 'TT sugerido',
    suggested_geral_caption: 'G antigo',
    changed_fields: ['tiktok_caption'],
    updated_at: '2026-10-30T12:00:00.000Z',
    ...over,
  };
}

/** A HubApiError-shaped rejection (the api module is mocked, so no real class here). */
function apiError(status: number, code?: string) {
  return Object.assign(new Error('x'), { status, code });
}

describe('useEditSuggestion: TikTok and Geral captions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockedSubmit.mockReset();
    resetEditSuggestionFailuresForTests();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('seeds a draft from the suggestion only for a column it changed, else from the raw post', () => {
    const post = makePost({ pending_suggestion: suggestion() });
    const { result } = renderHook(() => useEditSuggestion({ token: 't', post, onSaved: vi.fn() }));
    expect(result.current.draftTiktokCaption).toBe('TT sugerido');
    // geral_caption not in changed_fields: the stored copy is stale, the live post wins.
    expect(result.current.draftGeralCaption).toBe('G vivo');
  });

  it('keeps a null TikTok draft (following Instagram), never the effective caption', () => {
    const post = makePost({ tiktok_caption: null });
    const { result } = renderHook(() => useEditSuggestion({ token: 't', post, onSaved: vi.fn() }));
    expect(result.current.draftTiktokCaption).toBeNull();
  });

  it('sends the other captions with the save and keeps the first base per queued save', async () => {
    mockedSubmit.mockResolvedValue({ ok: true, pending_suggestion: null });
    const post = makePost({ tiktok_caption: null });
    const { result } = renderHook(() => useEditSuggestion({ token: 't', post, onSaved: vi.fn() }));
    act(() => {
      result.current.saveSuggestion(
        null,
        'corpo',
        'IG vivo',
        { fields: ['legenda_tiktok'], bases: { tiktok_caption: null } },
        { tiktok_caption: 'um', geral_caption: 'G vivo' },
      );
    });
    act(() => {
      result.current.saveSuggestion(
        null,
        'corpo',
        'IG vivo',
        { fields: ['legenda_tiktok'], bases: { tiktok_caption: 'um' } },
        { tiktok_caption: 'dois', geral_caption: 'G vivo' },
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(mockedSubmit).toHaveBeenCalledTimes(1);
    expect(mockedSubmit).toHaveBeenCalledWith('t', 900, {
      conteudo: null,
      conteudo_plain: 'corpo',
      captions: { ig_caption: 'IG vivo', tiktok_caption: 'dois', geral_caption: 'G vivo' },
      touched_fields: ['legenda_tiktok'],
      bases: { tiktok_caption: null },
    });
  });

  it('a 409 target_gone reloads the post and reports why', async () => {
    mockedSubmit.mockRejectedValue(apiError(409, 'target_gone'));
    const onSaved = vi.fn();
    const post = makePost();
    const { result } = renderHook(() => useEditSuggestion({ token: 't', post, onSaved }));
    act(() => {
      result.current.saveSuggestion(null, 'corpo', 'IG vivo', {
        fields: ['legenda_geral'],
        bases: { geral_caption: 'G vivo' },
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(result.current.saveFailed).toBe(true);
    expect(result.current.saveError).toBe('target_gone');
    // A new attempt clears the reason until it settles.
    act(() => {
      result.current.saveSuggestion(null, 'corpo', 'IG vivo', { fields: [], bases: {} });
    });
    expect(result.current.saveError).toBeNull();
  });

  it('classifies retry and caption_too_long, and nothing else', () => {
    expect(classifySaveError(apiError(409, 'retry'))).toBe('retry');
    expect(classifySaveError(apiError(400, 'caption_too_long'))).toBe('caption_too_long');
    expect(classifySaveError(apiError(409))).toBeNull();
    expect(classifySaveError(apiError(500, 'target_gone'))).toBeNull();
    expect(classifySaveError(new Error('rede'))).toBeNull();
    expect(classifySaveError(null)).toBeNull();
  });
});
