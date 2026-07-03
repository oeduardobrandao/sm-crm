// T2.11 autosave protocol tests (plan: "interleaved-save races (an older response never
// clobbers newer edits), blocker engagement, stash contents"). Blocker engagement itself is an
// EstudioPage integration concern (EstudioPage.test.tsx); this file pins the protocol core.
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDoc, makePage, makeTextLayer } from './fixtures';
import type { DesignDoc } from '../types';

const savePostDesign = vi.fn();
vi.mock('../hooks/usePostDesignQuery', async () => {
  const actual = await vi.importActual<typeof import('../hooks/usePostDesignQuery')>(
    '../hooks/usePostDesignQuery',
  );
  return { ...actual, savePostDesign: (...args: unknown[]) => savePostDesign(...args) };
});

const toastWarning = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    warning: (...args: unknown[]) => toastWarning(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

import { AUTOSAVE_DEBOUNCE_MS, AUTOSAVE_RETRY_MS, useAutosave } from '../hooks/useAutosave';
import { PostDesignError } from '../hooks/usePostDesignQuery';
import { readEstudioStash, clearEstudioStash } from '../lib/estudioStash';

const POST_ID = 42;

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function docV(text: string): DesignDoc {
  return makeDoc({ pages: [makePage({ layers: [makeTextLayer({ id: 'a', text })] })] });
}

/** Renders the hook already baselined on `serverDoc` at `rev` (the load path). */
function renderAutosave(serverDoc: DesignDoc, rev = 1) {
  const adoptNormalized = vi.fn();
  const utils = renderHook(
    ({ doc }: { doc: DesignDoc }) =>
      useAutosave({ postId: POST_ID, doc, adoptNormalized, enabled: true }),
    { initialProps: { doc: serverDoc } },
  );
  act(() => utils.result.current.reset(serverDoc, rev));
  return { ...utils, adoptNormalized };
}

describe('useAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    savePostDesign.mockReset();
    toastWarning.mockClear();
    toastError.mockClear();
    clearEstudioStash(POST_ID);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces edits by 800ms and PUTs the latest doc with the loaded rev', async () => {
    const base = docV('base');
    const { result, rerender } = renderAutosave(base, 7);
    const save = deferred<{ design: DesignDoc; rev: number; warnings: [] }>();
    savePostDesign.mockReturnValue(save.promise);

    const edited = docV('edited');
    rerender({ doc: edited });
    expect(result.current.status).toBe('dirty');
    expect(savePostDesign).not.toHaveBeenCalled();

    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS));
    expect(savePostDesign).toHaveBeenCalledTimes(1);
    expect(savePostDesign).toHaveBeenCalledWith(POST_ID, edited, 7);
    expect(result.current.status).toBe('saving');
  });

  it('fully adopts the normalized response (doc + rev) when no newer edits exist', async () => {
    const base = docV('base');
    const { result, rerender, adoptNormalized } = renderAutosave(base, 1);
    const normalized = docV('edited-normalized');
    savePostDesign.mockResolvedValue({ design: normalized, rev: 2, warnings: [] });

    rerender({ doc: docV('edited') });
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS));

    expect(adoptNormalized).toHaveBeenCalledWith(normalized);
    expect(result.current.status).toBe('saved');
    expect(result.current.currentRev()).toBe(2);

    // The adoption echo (state.doc becomes the normalized reference) is NOT a new edit.
    rerender({ doc: normalized });
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2));
    expect(savePostDesign).toHaveBeenCalledTimes(1);
  });

  it('NEVER clobbers newer edits with an older response — rev-only adoption + queued re-arm', async () => {
    const base = docV('base');
    const { result, rerender, adoptNormalized } = renderAutosave(base, 1);

    const firstSave = deferred<{ design: DesignDoc; rev: number; warnings: [] }>();
    savePostDesign.mockReturnValueOnce(firstSave.promise);

    const editA = docV('A');
    rerender({ doc: editA });
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS));
    expect(savePostDesign).toHaveBeenCalledWith(POST_ID, editA, 1);

    // Edit B lands while save A is in flight.
    const editB = docV('B');
    rerender({ doc: editB });
    expect(result.current.status).toBe('saving');

    // Save A's response arrives late: its normalized doc must NOT be adopted (it would clobber
    // edit B) — only the rev is.
    const normalizedA = docV('A-normalized');
    const secondSave = deferred<{ design: DesignDoc; rev: number; warnings: [] }>();
    savePostDesign.mockReturnValueOnce(secondSave.promise);
    await act(async () => {
      firstSave.resolve({ design: normalizedA, rev: 2, warnings: [] });
      await Promise.resolve();
    });
    expect(adoptNormalized).not.toHaveBeenCalled();
    expect(result.current.currentRev()).toBe(2);
    expect(result.current.status).toBe('dirty');

    // The queued-dirty flag re-arms the debounce; the follow-up save carries edit B at rev 2.
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS));
    expect(savePostDesign).toHaveBeenCalledTimes(2);
    expect(savePostDesign).toHaveBeenLastCalledWith(POST_ID, editB, 2);
  });

  it('keeps saves single-flight: a flush during an in-flight save queues instead of double-PUTting', async () => {
    const base = docV('base');
    const { result, rerender } = renderAutosave(base, 1);
    const save = deferred<{ design: DesignDoc; rev: number; warnings: [] }>();
    savePostDesign.mockReturnValue(save.promise);

    rerender({ doc: docV('edited') });
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS));
    expect(savePostDesign).toHaveBeenCalledTimes(1);

    await act(async () => {
      void result.current.flush();
      await Promise.resolve();
    });
    expect(savePostDesign).toHaveBeenCalledTimes(1);
  });

  it('rev_conflict: stashes the local doc, enters conflict, and PAUSES (no retry, edits ignored)', async () => {
    const base = docV('base');
    const { result, rerender } = renderAutosave(base, 3);
    const local = docV('local-edits');
    savePostDesign.mockRejectedValue(
      new PostDesignError('rev_conflict', 409, { error: 'rev_conflict', current_rev: 9 }),
    );

    rerender({ doc: local });
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS));

    expect(result.current.status).toBe('conflict');
    const stash = readEstudioStash(POST_ID);
    expect(stash?.doc).toEqual(local);
    expect(stash?.rev).toBe(3);

    // Paused: further edits must not fire saves while in conflict.
    rerender({ doc: docV('more-edits') });
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 3));
    expect(savePostDesign).toHaveBeenCalledTimes(1);
  });

  it('deterministic 4xx failure: stays dirty with NO auto-retry (identical content would fail identically)', async () => {
    const base = docV('base');
    const { result, rerender } = renderAutosave(base, 1);
    savePostDesign.mockRejectedValue(
      new PostDesignError('design_invalid', 400, { error: 'design_invalid' }),
    );

    rerender({ doc: docV('bad') });
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS));

    expect(result.current.status).toBe('dirty');
    expect(result.current.lastFailureWasDeterministic()).toBe(true);
    expect(toastError).toHaveBeenCalledTimes(1);

    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_RETRY_MS * 3));
    expect(savePostDesign).toHaveBeenCalledTimes(1);
  });

  it('transient failure: stays dirty and retries once on a slower timer', async () => {
    const base = docV('base');
    const { result, rerender } = renderAutosave(base, 1);
    savePostDesign
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ design: docV('edited'), rev: 2, warnings: [] });

    rerender({ doc: docV('edited') });
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS));
    expect(result.current.status).toBe('dirty');
    expect(result.current.lastFailureWasDeterministic()).toBe(false);

    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_RETRY_MS));
    expect(savePostDesign).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('saved');
  });

  it('surfaces PUT warnings via sonner once per code', async () => {
    const base = docV('base');
    const { rerender } = renderAutosave(base, 1);
    savePostDesign.mockResolvedValue({
      design: docV('edited'),
      rev: 2,
      warnings: [{ code: 'layer_off_canvas', message: 'Camada fora do canvas.' }],
    });

    rerender({ doc: docV('edited') });
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS));
    rerender({ doc: docV('edited again') });
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS));

    expect(savePostDesign).toHaveBeenCalledTimes(2);
    expect(toastWarning).toHaveBeenCalledTimes(1);
  });

  it('stashes on beforeunload while dirty (stash contents = the CURRENT doc + rev)', async () => {
    const base = docV('base');
    const { rerender } = renderAutosave(base, 5);
    savePostDesign.mockReturnValue(deferred().promise);

    const local = docV('unsaved');
    rerender({ doc: local });

    window.dispatchEvent(new Event('beforeunload', { cancelable: true }));
    const stash = readEstudioStash(POST_ID);
    expect(stash?.doc).toEqual(local);
    expect(stash?.rev).toBe(5);
  });

  it('reset() after a conflict reload re-baselines and resumes saving', async () => {
    const base = docV('base');
    const { result, rerender } = renderAutosave(base, 1);
    savePostDesign.mockRejectedValueOnce(new PostDesignError('rev_conflict', 409, null));

    rerender({ doc: docV('local') });
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS));
    expect(result.current.status).toBe('conflict');

    // "Recarregar": the page refetches and re-baselines on the server's head.
    const reloaded = docV('server-head');
    act(() => result.current.reset(reloaded, 9));
    rerender({ doc: reloaded });
    expect(result.current.status).toBe('saved');

    savePostDesign.mockResolvedValue({ design: docV('after'), rev: 10, warnings: [] });
    rerender({ doc: docV('after') });
    await act(() => vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS));
    expect(savePostDesign).toHaveBeenLastCalledWith(POST_ID, expect.anything(), 9);
    expect(result.current.status).toBe('saved');
  });
});
