// T2.11 autosave — the FULL concurrency protocol of docs/estudio-design.md §6.2 (decision 1b-7):
// 800 ms-debounced PUT with at most ONE save in flight; every local edit bumps a generation
// counter; a save snapshots the generation it covers; edits landing while a save is in flight
// set a queued-dirty flag that re-arms the debounce on completion; a response is fully adopted
// (server-normalized doc + rev) only when NO newer local generation exists — otherwise only the
// `rev` is adopted and the local doc stands (an older response must never clobber newer edits).
//
// Server-echo detection is BY REFERENCE: `lastSyncedRef` holds the exact doc object that
// currently matches the server head (the loaded doc on reset, the normalized response doc after
// a fully-adopted save). The doc-change effect counts a render as a local edit iff
// `doc !== lastSyncedRef.current` — which also gets the undo-back-to-original-load case right
// after intermediate saves (the original reference is no longer the synced one, so it re-saves).
//
// Failure taxonomy:
//  - `rev_conflict` (another writer — MCP agent, second tab): stash the local doc to
//    localStorage, enter `conflict`, and PAUSE — no retries; the conflict banner owns recovery.
//  - other 4xx (deterministic — e.g. design_invalid): surface once, stay `dirty`, do NOT
//    auto-retry (identical content would fail identically, forever); the next edit re-arms.
//  - network/5xx (transient): stay `dirty` and re-arm ONE slower retry.
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { PostDesignError, savePostDesign } from './usePostDesignQuery';
import { writeEstudioStash } from '../lib/estudioStash';
import type { DesignDoc } from '../types';

export const AUTOSAVE_DEBOUNCE_MS = 800;
export const AUTOSAVE_RETRY_MS = 2400;

export type AutosaveStatus = 'saved' | 'saving' | 'dirty' | 'conflict';

export interface UseAutosaveArgs {
  postId: number;
  /** The live editor doc (state.doc from useDesignDocState). */
  doc: DesignDoc;
  /** Swaps the server-normalized doc into the reducer without an undo entry ('doc/adopt'). */
  adoptNormalized: (doc: DesignDoc) => void;
  /** False while the design query hasn't loaded — nothing to save against yet. */
  enabled: boolean;
}

export interface Autosave {
  status: AutosaveStatus;
  /** The rev the next save will send — exposed for tests/debugging, not for rendering. */
  currentRev: () => number;
  /** Immediate save (blocker/unmount path) — skips the debounce, still single-flight. */
  flush: () => Promise<void>;
  /** (Re)baselines the protocol on a fresh server doc: GET load and conflict-reload both. */
  reset: (serverDoc: DesignDoc, rev: number) => void;
  /** True when the last failure was deterministic (4xx) — the blocker's escape hatch. */
  lastFailureWasDeterministic: () => boolean;
  /** Writes the current doc to the localStorage stash immediately (blocker escape hatch). */
  stashNow: () => void;
}

export function useAutosave({ postId, doc, adoptNormalized, enabled }: UseAutosaveArgs): Autosave {
  const { t } = useTranslation('estudio');
  const [status, setStatusState] = useState<AutosaveStatus>('saved');

  const statusRef = useRef<AutosaveStatus>('saved');
  const setStatus = useCallback((s: AutosaveStatus) => {
    statusRef.current = s;
    setStatusState(s);
  }, []);

  const docRef = useRef(doc);
  const lastSyncedRef = useRef<DesignDoc | null>(null);
  const revRef = useRef(0);
  const generationRef = useRef(0);
  const inFlightRef = useRef(false);
  const queuedDirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deterministicFailureRef = useRef(false);
  const warnedCodesRef = useRef(new Set<string>());
  const adoptNormalizedRef = useRef(adoptNormalized);
  adoptNormalizedRef.current = adoptNormalized;

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // saveNow schedules ITSELF (transient retry, queued-dirty re-arm) — the self-reference goes
  // through a ref so the callback never closes over its own binding before declaration.
  const saveNowRef = useRef<() => Promise<void>>(() => Promise.resolve());

  const saveNow = useCallback(async (): Promise<void> => {
    clearTimer();
    if (!enabled || statusRef.current === 'conflict') return;
    if (inFlightRef.current) {
      queuedDirtyRef.current = true;
      return;
    }
    const snapshot = docRef.current;
    if (snapshot === lastSyncedRef.current) {
      setStatus('saved');
      return;
    }
    const generation = generationRef.current;
    inFlightRef.current = true;
    setStatus('saving');
    try {
      const res = await savePostDesign(postId, snapshot, revRef.current);
      revRef.current = res.rev;
      deterministicFailureRef.current = false;
      if (Array.isArray(res.warnings)) {
        for (const w of res.warnings as Array<{ code?: string; message?: string }>) {
          const code = w?.code ?? 'unknown';
          if (warnedCodesRef.current.has(code)) continue;
          warnedCodesRef.current.add(code);
          toast.warning(w?.message ?? code);
        }
      }
      if (generationRef.current === generation) {
        // Full adoption: the server's normalized doc becomes the synced baseline. Setting the
        // baseline BEFORE dispatching keeps the resulting doc-change render from counting as a
        // new local edit (the reducer stores this exact reference).
        lastSyncedRef.current = res.design;
        adoptNormalizedRef.current(res.design);
        setStatus('saved');
      } else {
        // Stale response: newer local generations exist — rev-only adoption (done above), the
        // local doc stands, and the queued-dirty re-arm below schedules the follow-up save.
        queuedDirtyRef.current = true;
        setStatus('dirty');
      }
    } catch (e) {
      if (e instanceof PostDesignError && e.code === 'rev_conflict') {
        writeEstudioStash(postId, docRef.current, revRef.current);
        queuedDirtyRef.current = false;
        setStatus('conflict');
        return;
      }
      const deterministic = e instanceof PostDesignError && e.status >= 400 && e.status < 500;
      deterministicFailureRef.current = deterministic;
      toast.error(t('editor.saveError'));
      if (!deterministic) {
        // Transient — one slower retry.
        setStatus('dirty');
        timerRef.current = setTimeout(() => void saveNowRef.current(), AUTOSAVE_RETRY_MS);
        return;
      }
      setStatus('dirty');
    } finally {
      inFlightRef.current = false;
      // Widened read (`as`): TS control-flow narrowing can't see that setStatus() writes this
      // ref through a callback, and would otherwise narrow 'conflict' out of the comparison.
      const current = statusRef.current as AutosaveStatus;
      if (current !== 'conflict' && queuedDirtyRef.current) {
        queuedDirtyRef.current = false;
        clearTimer();
        timerRef.current = setTimeout(() => void saveNowRef.current(), AUTOSAVE_DEBOUNCE_MS);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId, enabled, clearTimer, setStatus, t]);

  saveNowRef.current = saveNow;

  // Local-edit detection (see header) + debounce arming.
  useEffect(() => {
    docRef.current = doc;
    if (!enabled) return;
    if (lastSyncedRef.current === null) return; // not baselined yet (reset() pending)
    if (doc === lastSyncedRef.current) return; // server echo (load/adoption), not an edit
    generationRef.current++;
    if (statusRef.current === 'conflict') return; // paused — banner owns recovery
    if (inFlightRef.current) {
      queuedDirtyRef.current = true;
      return;
    }
    setStatus('dirty');
    clearTimer();
    timerRef.current = setTimeout(() => void saveNow(), AUTOSAVE_DEBOUNCE_MS);
  }, [doc, enabled, saveNow, clearTimer, setStatus]);

  const reset = useCallback(
    (serverDoc: DesignDoc, rev: number) => {
      clearTimer();
      lastSyncedRef.current = serverDoc;
      revRef.current = rev;
      generationRef.current++;
      queuedDirtyRef.current = false;
      deterministicFailureRef.current = false;
      setStatus('saved');
    },
    [clearTimer, setStatus],
  );

  // Stash-before-unload (design §6.2): flush-on-unload cannot be awaited, so anything unsaved is
  // stashed and the browser's native leave prompt engaged.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      const unsaved =
        statusRef.current === 'dirty' ||
        statusRef.current === 'saving' ||
        statusRef.current === 'conflict' ||
        queuedDirtyRef.current;
      if (!unsaved) return;
      writeEstudioStash(postId, docRef.current, revRef.current);
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [postId]);

  // Best-effort flush on unmount (in-app navigation normally flushes via the blocker first —
  // this covers unmounts the blocker never saw, e.g. an error boundary swap).
  useEffect(() => {
    return () => {
      clearTimer();
      if (
        enabled &&
        lastSyncedRef.current !== null &&
        docRef.current !== lastSyncedRef.current &&
        statusRef.current !== 'conflict' &&
        !inFlightRef.current
      ) {
        writeEstudioStash(postId, docRef.current, revRef.current);
        try {
          // Fire-and-forget; the stash above is the recovery path. Unmount cleanup must never
          // throw, so both the sync call and the async rejection are swallowed.
          void Promise.resolve(savePostDesign(postId, docRef.current, revRef.current)).catch(
            () => undefined,
          );
        } catch {
          // best-effort — see above
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId, enabled]);

  return {
    status,
    currentRev: useCallback(() => revRef.current, []),
    flush: saveNow,
    reset,
    lastFailureWasDeterministic: useCallback(() => deterministicFailureRef.current, []),
    stashNow: useCallback(
      () => writeEstudioStash(postId, docRef.current, revRef.current),
      [postId],
    ),
  };
}
