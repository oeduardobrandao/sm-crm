import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { useEditSuggestion, resetEditSuggestionFailuresForTests } from '../useEditSuggestion';
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
    // The failed-post memory is module-level (survives a real unmount on purpose --
    // see useEditSuggestion.ts) but must not leak between tests.
    resetEditSuggestionFailuresForTests();
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

  it('does not get stuck showing "saving" for a freshly-displayed post after navigating away from an in-flight save', async () => {
    // Post A's save begins (saveState -> 'saving'), then the user navigates to post B
    // before it resolves. `flush`'s completion gate correctly refuses to apply A's
    // eventual outcome to B's UI (that's the point) -- but without a reset on
    // navigation, nothing EVER clears the 'saving' state that was set while A was
    // still current, permanently blocking approval and showing a false unsaved-work
    // warning for B, even though B itself was never touched.
    const first = deferred<{ ok: boolean; pending_suggestion: null }>();
    mockedSubmit.mockReturnValueOnce(first.promise);

    const onSaved = vi.fn();
    const { result, rerender } = renderHook(
      ({ post }) => useEditSuggestion({ token: 'tok', post, onSaved }),
      { initialProps: { post: makePost({ id: 5103 }) } },
    );
    const lastActive = () => useUnsavedWorkMock.mock.calls.at(-1)?.[0];

    act(() => {
      result.current.saveSuggestion({ type: 'doc', content: [] }, 'edit-for-post-a', null);
    });
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(mockedSubmit).toHaveBeenCalledTimes(1);
    expect(result.current.saveState).toBe('saving');

    // Navigate to a fresh post (5104) that was never edited -- same hook instance,
    // post A's save is still in flight.
    rerender({ post: makePost({ id: 5104 }) });

    // Must immediately reflect post B's own (clean) status, not post A's leftover
    // 'saving' state.
    expect(result.current.saveState).toBe('idle');
    expect(result.current.approvalBlocked).toBe(false);
    expect(lastActive()).toBe(false);

    // Post A's save finally resolves in the background.
    await act(async () => {
      first.resolve({ ok: true, pending_suggestion: null });
      await Promise.resolve();
      await Promise.resolve();
    });

    // Its outcome must still not touch post B's (currently displayed) UI.
    expect(result.current.saveState).toBe('idle');
    expect(result.current.approvalBlocked).toBe(false);
  });

  it('keeps showing "saving" for a post whose save is genuinely in flight when navigating back to it', async () => {
    // `flush` dequeues post A's entry from `pendingRef` BEFORE awaiting its request,
    // so `pendingRef.current.has(A)` alone goes false the instant the request is
    // sent -- even though it hasn't resolved yet. If the navigation-reset only checked
    // `pendingRef`, navigating A -> B -> A while A's original request is still
    // unresolved would wrongly reset A to idle/clean, unblocking its approval button
    // while an edit-suggestion submission for it is still underway.
    const first = deferred<{ ok: boolean; pending_suggestion: null }>();
    mockedSubmit.mockReturnValueOnce(first.promise);

    const onSaved = vi.fn();
    const { result, rerender } = renderHook(
      ({ post }) => useEditSuggestion({ token: 'tok', post, onSaved }),
      { initialProps: { post: makePost({ id: 5103 }) } },
    );
    const lastActive = () => useUnsavedWorkMock.mock.calls.at(-1)?.[0];

    // Edit post A (5103): debounce fires, its save is dequeued and in flight.
    act(() => {
      result.current.saveSuggestion({ type: 'doc', content: [] }, 'edit-for-post-a', null);
    });
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(mockedSubmit).toHaveBeenCalledTimes(1);
    expect(result.current.saveState).toBe('saving');

    // Navigate away to post B, then back to post A -- all before A's request settles.
    rerender({ post: makePost({ id: 5104 }) });
    rerender({ post: makePost({ id: 5103 }) });

    // Post A's save is still genuinely in flight: must still show saving/blocked/dirty,
    // not a false idle/clean that would let the client approve ahead of the pending edit.
    expect(result.current.saveState).toBe('saving');
    expect(result.current.approvalBlocked).toBe(true);
    expect(lastActive()).toBe(true);

    // The in-flight request finally resolves while post A is back on screen.
    await act(async () => {
      first.resolve({ ok: true, pending_suggestion: null });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.saveState).toBe('saved');
    expect(lastActive()).toBe(false);
  });

  it('remembers a save failed for a post even after navigating away and back before the response arrives', async () => {
    // Post A's save is dequeued and in flight while it's still on screen (isCurrentPost
    // captured true), but the user navigates to post B before it resolves. The
    // navigation reset correctly clears A's `dirty` for POST B'S display -- but when
    // A's request then fails in the background, `flush`'s completion gate correctly
    // refuses to paint that failure onto B's UI either (it isn't A's outcome to show).
    // Without separately remembering the failure, navigating back to A afterward would
    // show a clean idle/saved state with no trace the edit never reached the server.
    const first = deferred<{ ok: boolean; pending_suggestion: null }>();
    mockedSubmit.mockReturnValueOnce(first.promise);

    const onSaved = vi.fn();
    const { result, rerender } = renderHook(
      ({ post }) => useEditSuggestion({ token: 'tok', post, onSaved }),
      { initialProps: { post: makePost({ id: 5103 }) } },
    );
    const lastActive = () => useUnsavedWorkMock.mock.calls.at(-1)?.[0];

    // Edit post A (5103): debounce fires, its save is dequeued and in flight.
    act(() => {
      result.current.saveSuggestion({ type: 'doc', content: [] }, 'edit-for-post-a', null);
    });
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(mockedSubmit).toHaveBeenCalledTimes(1);

    // Navigate away to post B before A's request settles.
    rerender({ post: makePost({ id: 5104 }) });
    expect(result.current.saveState).toBe('idle');
    expect(lastActive()).toBe(false); // post B itself has no unsaved work

    // Post A's save fails while post B is on screen.
    await act(async () => {
      first.reject(new Error('network error'));
      await Promise.resolve();
      await Promise.resolve();
    });

    // Must still not touch post B's (currently displayed, untouched) UI.
    expect(result.current.saveState).toBe('idle');
    expect(lastActive()).toBe(false);

    // Navigate back to post A.
    rerender({ post: makePost({ id: 5103 }) });

    // The failed edit must still be flagged as unsaved -- it never reached the server,
    // and the client could otherwise navigate away thinking it was saved.
    expect(lastActive()).toBe(true);
  });

  it('remembers a save failed for a post across a real unmount, not just a same-instance navigation', async () => {
    // `postagens/:postId` and `postagens` (the list) are SIBLING routes with different
    // Components -- clicking through to "Ver todas as postagens" and back fully
    // unmounts and remounts this hook, unlike the param-only navigation the other
    // tests cover via `rerender`. Any state kept purely on a per-instance ref would be
    // discarded with that unmount; this is what forces the failure memory to live at
    // module level instead.
    const first = deferred<{ ok: boolean; pending_suggestion: null }>();
    mockedSubmit.mockReturnValueOnce(first.promise);

    const post = makePost({ id: 5103 });
    const { result, unmount } = renderHook(() =>
      useEditSuggestion({ token: 'tok', post, onSaved: vi.fn() }),
    );

    act(() => {
      result.current.saveSuggestion({ type: 'doc', content: [] }, 'edit-for-post-a', null);
    });
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(mockedSubmit).toHaveBeenCalledTimes(1);

    // Navigate away entirely -- a real unmount, not a rerender with a new post prop --
    // before the request settles.
    unmount();

    // The save fails while nothing for post A is mounted at all.
    await act(async () => {
      first.reject(new Error('network error'));
      await Promise.resolve();
      await Promise.resolve();
    });

    // Reopen the same post: a brand new hook instance, unrelated to the one that was
    // just unmounted.
    renderHook(() => useEditSuggestion({ token: 'tok', post, onSaved: vi.fn() }));
    const lastActive = () => useUnsavedWorkMock.mock.calls.at(-1)?.[0];

    // Must still show the failed edit as unsaved, not a clean idle state.
    expect(lastActive()).toBe(true);
  });

  it('does not let a stale, older save erase a newer save failure recorded for the same post', async () => {
    // Two SEPARATE hook instances for the same post can each have their own request in
    // flight: attempt A is dispatched, the user leaves before it resolves (a real
    // unmount, not just a rerender), reopens the same post (a fresh instance), and
    // edits again -- attempt B. If B fails first and A's now-stale, slower request
    // then succeeds, that success must not erase B's failure: B is the newer, truer
    // outcome, and its edit never actually reached the server.
    //
    // A currently-mounted instance's own `dirty` state is a poor probe here: it's
    // already true from its own `saveSuggestion` call and stays true regardless of
    // what the module-level failure map does in the background (that map is only
    // re-read at mount time). So this asserts through a THIRD, later instance's own
    // mount -- the same observable the original finding described ("reopening the
    // post appears clean") -- rather than through instance #2, which would pass even
    // on the buggy code.
    const attemptA = deferred<{ ok: boolean; pending_suggestion: null }>();
    const attemptB = deferred<{ ok: boolean; pending_suggestion: null }>();
    mockedSubmit.mockReturnValueOnce(attemptA.promise).mockReturnValueOnce(attemptB.promise);

    const post = makePost({ id: 5103 });

    // Instance #1: dispatch attempt A, then leave before it resolves.
    const { result: result1, unmount: unmount1 } = renderHook(() =>
      useEditSuggestion({ token: 'tok', post, onSaved: vi.fn() }),
    );
    act(() => {
      result1.current.saveSuggestion({ type: 'doc', content: [] }, 'edit-attempt-a', null);
    });
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(mockedSubmit).toHaveBeenCalledTimes(1);
    unmount1();

    // Instance #2: reopen the same post fresh, and edit it again -- dispatches attempt B.
    const { result: result2, unmount: unmount2 } = renderHook(() =>
      useEditSuggestion({ token: 'tok', post, onSaved: vi.fn() }),
    );
    act(() => {
      result2.current.saveSuggestion({ type: 'doc', content: [] }, 'edit-attempt-b', null);
    });
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(mockedSubmit).toHaveBeenCalledTimes(2);

    // Attempt B (the newer one) fails first, recording the hold.
    await act(async () => {
      attemptB.reject(new Error('network error'));
      await Promise.resolve();
      await Promise.resolve();
    });
    unmount2();

    // Attempt A (the older, now-superseded one) finally succeeds in the background.
    await act(async () => {
      attemptA.resolve({ ok: true, pending_suggestion: null });
      await Promise.resolve();
      await Promise.resolve();
    });

    // Reopen the post a third time: a brand new instance, reading the module-level
    // failure memory fresh at mount. B's failure must have survived A's stale
    // success -- the latest edit never reached the server.
    renderHook(() => useEditSuggestion({ token: 'tok', post, onSaved: vi.fn() }));
    const lastActive = () => useUnsavedWorkMock.mock.calls.at(-1)?.[0];
    expect(lastActive()).toBe(true);
  });
});
