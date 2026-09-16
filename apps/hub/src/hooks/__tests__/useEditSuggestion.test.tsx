import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { useEditSuggestion } from '../useEditSuggestion';
import { submitEditSuggestion } from '../../api';
import type { HubPost } from '../../types';

vi.mock('../../api', () => ({
  submitEditSuggestion: vi.fn(),
}));

// `dirty` (the real "is there unsaved work" signal) isn't part of the hook's public
// return value -- it only ever surfaces via `useUnsavedWork(dirty || saveState ===
// 'saving')`. Spying on that call is the only way to observe it from outside.
const useUnsavedWorkMock = vi.hoisted(() => vi.fn());
vi.mock('@mesaas/app-lifecycle', () => ({
  useUnsavedWork: (active: boolean) => useUnsavedWorkMock(active),
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
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useEditSuggestion', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockedSubmit.mockReset();
    useUnsavedWorkMock.mockReset();
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

  it('attributes a queued save to the post it was typed into, even when the hook is reused for a different post mid-flight', async () => {
    // `postagens/:postId` has no `key`, so React Router reuses the same component
    // (and this hook's instance/refs) across navigation -- editing post A, then
    // navigating to post B before A's save resolves, re-renders this hook with a new
    // `post` while its in-flight request and queue are still live.
    const postA = deferred<{ ok: boolean; pending_suggestion: null }>();
    const postBResponse = { ok: true, pending_suggestion: null };
    mockedSubmit.mockReturnValueOnce(postA.promise).mockResolvedValueOnce(postBResponse);

    const onSaved = vi.fn();
    const { result, rerender } = renderHook(
      ({ post }) => useEditSuggestion({ token: 'tok', post, onSaved }),
      { initialProps: { post: makePost({ id: 5103 }) } },
    );

    // Edit post A (5103): debounce fires, its save goes in flight and stays there.
    act(() => {
      result.current.saveSuggestion({ type: 'doc', content: [] }, 'edit-for-post-a', null);
    });
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(mockedSubmit).toHaveBeenCalledTimes(1);
    expect(mockedSubmit).toHaveBeenNthCalledWith(
      1,
      'tok',
      5103,
      { type: 'doc', content: [] },
      'edit-for-post-a',
      null,
    );

    // Navigate to a different post (5104) -- same hook instance, new `post` prop --
    // and edit it before post A's save has resolved.
    rerender({ post: makePost({ id: 5104 }) });
    act(() => {
      result.current.saveSuggestion({ type: 'doc', content: [] }, 'edit-for-post-b', null);
    });
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(mockedSubmit).toHaveBeenCalledTimes(1); // still queued -- post A's save is in flight

    // Post A's save finally resolves; its `finally` block drains the queue.
    await act(async () => {
      postA.resolve({ ok: true, pending_suggestion: null });
      await Promise.resolve();
      await Promise.resolve();
    });

    // The queued edit must be sent for post B (5104), not misattributed to post A (5103).
    expect(mockedSubmit).toHaveBeenCalledTimes(2);
    expect(mockedSubmit).toHaveBeenNthCalledWith(
      2,
      'tok',
      5104,
      { type: 'doc', content: [] },
      'edit-for-post-b',
      null,
    );
  });

  it('queues edits per post so a third post edited mid-flight does not drop a second, still-queued post', async () => {
    // A single-slot queue would let editing post C overwrite post B's still-queued
    // entry while post A's save is in flight, silently dropping B's edit. Each post
    // must keep its own queued entry until it is actually sent.
    const postA = deferred<{ ok: boolean; pending_suggestion: null }>();
    mockedSubmit
      .mockReturnValueOnce(postA.promise)
      .mockResolvedValueOnce({ ok: true, pending_suggestion: null })
      .mockResolvedValueOnce({ ok: true, pending_suggestion: null });

    const onSaved = vi.fn();
    const { result, rerender } = renderHook(
      ({ post }) => useEditSuggestion({ token: 'tok', post, onSaved }),
      { initialProps: { post: makePost({ id: 5103 }) } },
    );

    // Edit post A (5103): its save goes in flight and stays there.
    act(() => {
      result.current.saveSuggestion({ type: 'doc', content: [] }, 'edit-for-post-a', null);
    });
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(mockedSubmit).toHaveBeenCalledTimes(1);

    // Navigate to post B (5104) and edit it -- queued, post A is still in flight.
    rerender({ post: makePost({ id: 5104 }) });
    act(() => {
      result.current.saveSuggestion({ type: 'doc', content: [] }, 'edit-for-post-b', null);
    });
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(mockedSubmit).toHaveBeenCalledTimes(1); // still just post A -- B is queued

    // Navigate to post C (5105) and edit it too, before post A's save resolves.
    rerender({ post: makePost({ id: 5105 }) });
    act(() => {
      result.current.saveSuggestion({ type: 'doc', content: [] }, 'edit-for-post-c', null);
    });
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(mockedSubmit).toHaveBeenCalledTimes(1); // still just post A -- B and C are both queued

    // Post A's save finally resolves; the drain loop must send BOTH queued posts.
    await act(async () => {
      postA.resolve({ ok: true, pending_suggestion: null });
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockedSubmit).toHaveBeenCalledTimes(3);
    const sentPostIds = mockedSubmit.mock.calls.map((call) => call[1]).sort();
    expect(sentPostIds).toEqual([5103, 5104, 5105]);
  });

  it('keeps `dirty` true when a newer edit to the same post fails, even though an earlier response for it already succeeded', async () => {
    // A second edit to the SAME post made while its first save is in flight coalesces
    // onto the same queue entry and is picked up by the drain loop's next iteration.
    // If the completion side effects were applied per-response instead of once the
    // whole queue drains, the first response succeeding would clear `dirty` right
    // away -- even though that second, newer edit hasn't been sent yet -- and if THAT
    // one then fails, `dirty` would be stuck at false with no signal the latest edit
    // was never saved. `dirty` itself isn't exposed; it only surfaces via
    // `useUnsavedWork(dirty || saveState === 'saving')`, so assert through that spy.
    const first = deferred<{ ok: boolean; pending_suggestion: null }>();
    const second = deferred<{ ok: boolean; pending_suggestion: null }>();
    mockedSubmit.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const post = makePost();
    const { result } = renderHook(() =>
      useEditSuggestion({ token: 'tok', post, onSaved: vi.fn() }),
    );
    const lastActive = () => useUnsavedWorkMock.mock.calls.at(-1)?.[0];

    act(() => {
      result.current.saveSuggestion({ type: 'doc', content: [] }, 'edit-1', null);
    });
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(mockedSubmit).toHaveBeenCalledTimes(1);
    expect(lastActive()).toBe(true); // dirty || saving -- unsaved work in progress

    // A second edit to the same post, queued while the first is still in flight --
    // the already-running flush's while loop will pick this up on its own, no need
    // to wait out another debounce.
    act(() => {
      result.current.saveSuggestion({ type: 'doc', content: [] }, 'edit-2', null);
    });

    // The first (now-stale) request resolves successfully.
    await act(async () => {
      first.resolve({ ok: true, pending_suggestion: null });
      await Promise.resolve();
      await Promise.resolve();
    });

    // Must still report unsaved work -- edit-2 is being sent right now, not confirmed.
    expect(mockedSubmit).toHaveBeenCalledTimes(2);
    expect(lastActive()).toBe(true);

    // The second, newer request (the one that actually matters) fails.
    await act(async () => {
      second.reject(new Error('network error'));
      await Promise.resolve();
      await Promise.resolve();
    });

    // The latest edit never made it to the server -- must still report unsaved work,
    // not silently treat the earlier (now-superseded) success as the final word.
    expect(lastActive()).toBe(true);
  });
});
