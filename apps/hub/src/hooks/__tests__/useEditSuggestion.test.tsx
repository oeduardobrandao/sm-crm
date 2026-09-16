import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { useEditSuggestion } from '../useEditSuggestion';
import { submitEditSuggestion } from '../../api';
import type { HubPost } from '../../types';

vi.mock('../../api', () => ({
  submitEditSuggestion: vi.fn(),
}));

const mockedSubmit = vi.mocked(submitEditSuggestion);

function makePost(overrides: Partial<HubPost> = {}): HubPost {
  return {
    id: 5103,
    titulo: 'Roteiro',
    tipo: 'reels',
    status: 'enviado_cliente',
    ordem: 1,
    conteudo: { type: 'doc', content: [] },
    conteudo_plain: 'original',
    ig_caption: 'legenda original',
    scheduled_at: '2026-04-28T10:00:00.000Z',
    workflow_id: 42,
    workflow_titulo: 'Editorial',
    media: [],
    cover_media: null,
    ...overrides,
  } as HubPost;
}

// Deferred promise so the test controls exactly when each network call "resolves",
// letting us simulate responses arriving out of send order.
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('useEditSuggestion', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockedSubmit.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('serializes saves so an earlier, in-flight request cannot land after a later one and overwrite it', async () => {
    const first = deferred<{ ok: boolean; pending_suggestion: null }>();
    const second = deferred<{ ok: boolean; pending_suggestion: null }>();
    mockedSubmit.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const post = makePost();
    const { result } = renderHook(() =>
      useEditSuggestion({ token: 'tok', post, onSaved: vi.fn() }),
    );

    // First edit (e.g. mid-restructure of the roteiro): debounce fires, request #1 sent.
    act(() => {
      result.current.saveSuggestion({ type: 'doc', content: [] }, 'edit-1-intermediate', null);
    });
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(mockedSubmit).toHaveBeenCalledTimes(1);

    // Client keeps typing before request #1's response comes back. A second debounce
    // fires and sends request #2 -- but useEditSuggestion must NOT send it while #1 is
    // still in flight; it should queue and send it only once #1 settles.
    act(() => {
      result.current.saveSuggestion({ type: 'doc', content: [] }, 'edit-2-final', null);
    });
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(mockedSubmit).toHaveBeenCalledTimes(1); // still just #1 -- #2 is queued, not sent

    // Request #1 (the stale, intermediate snapshot) finally resolves.
    await act(async () => {
      first.resolve({ ok: true, pending_suggestion: null });
      await Promise.resolve();
      await Promise.resolve();
    });

    // Now that #1 settled, the queued edit must be flushed as request #2.
    expect(mockedSubmit).toHaveBeenCalledTimes(2);
    expect(mockedSubmit).toHaveBeenLastCalledWith(
      'tok',
      5103,
      { type: 'doc', content: [] },
      'edit-2-final',
      null,
    );

    await act(async () => {
      second.resolve({ ok: true, pending_suggestion: null });
      await Promise.resolve();
    });

    // The final server-bound payload is the latest edit, never the stale intermediate one.
    expect(mockedSubmit).toHaveBeenLastCalledWith(
      'tok',
      5103,
      { type: 'doc', content: [] },
      'edit-2-final',
      null,
    );
  });
});
