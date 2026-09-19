import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import type { CaptionAnchorPatch, CommentThread } from '@/store';
import {
  anchorsFromThreads,
  patchesFromAnchors,
  remapAnchors,
  validateAnchors,
  type CaptionAnchor,
} from '../utils/captionAnchors';

export const MAX_CAPTION_CHARS = 2200;
const SAVE_DEBOUNCE_MS = 1500;

interface Draft {
  text: string;
  anchors: CaptionAnchor[];
}

interface Args {
  value: string;
  threads: CommentThread[];
  onSave: (text: string, anchors: CaptionAnchorPatch[]) => Promise<void>;
}

/**
 * Local edit state for the Instagram caption and its comment anchors.
 *
 * Until the user types, text/anchors come from props (anchors validated against the
 * text). Typing creates a draft that shadows props; inbound props never overwrite it
 * while it exists. Saves are debounced, serialized, read the draft when they RUN, and
 * commit text + anchors together through `onSave`.
 *
 * One instance per post: the consumer must remount it per post (`key={post.id}`); there
 * is no post identity in the args, so a swapped post would inherit a pending draft.
 *
 * `onSave` owns error reporting (the caller toasts); the hook swallows the rejection,
 * keeps the draft and does not retry: the next keystroke or `flush()` retries.
 */
export function useCaptionDraft({ value, threads, onSave }: Args) {
  const serverAnchors = useMemo(
    () => validateAnchors(value, anchorsFromThreads(threads)),
    [value, threads],
  );

  const [draft, setDraft] = useState<Draft | null>(null);
  // Forces the catch-up effect below to re-run when a save settles after props already
  // caught up; deleting it makes the draft stick.
  const [, setTick] = useState(0);
  const draftRef = useRef<Draft | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inFlightRef = useRef(false);
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  // Text of the last successful save that `value` (props) has not reflected yet.
  // While set, "typed back to `value`" is NOT "back to persisted": the server holds
  // the saved text, so that edit must still be saved.
  const unackedRef = useRef<string | null>(null);
  // Signature (text + anchor patches) of the last payload `onSave` accepted, so `flush()`
  // does not re-send an identical payload while props have not caught up yet. Cleared
  // whenever the draft is dropped, so a later real edit back to an old value still saves.
  const lastSavedSigRef = useRef<string | null>(null);
  const latest = useRef({ value, serverAnchors, onSave });

  useEffect(() => {
    latest.current = { value, serverAnchors, onSave };
  });

  const setDraftBoth = useCallback((next: Draft | null) => {
    draftRef.current = next;
    if (next === null) lastSavedSigRef.current = null;
    setDraft(next);
  }, []);

  const runSave = useCallback(async (): Promise<boolean> => {
    const d = draftRef.current;
    if (!d) return true;
    const patches = patchesFromAnchors(validateAnchors(d.text, d.anchors));
    const sig = JSON.stringify([d.text, patches]);
    if (sig === lastSavedSigRef.current) return true; // already persisted, nothing new to send
    inFlightRef.current = true;
    try {
      // Defense in depth (Task 2 review): remapAnchors trusts in-range input, and an
      // out-of-range non-orphaned anchor makes save_ig_caption raise. Re-validate the
      // draft's anchors against the exact text being saved: re-anchor on a unique quote,
      // else orphan. A no-op for anchors that are already consistent.
      await latest.current.onSave(d.text, patches);
      unackedRef.current = d.text;
      lastSavedSigRef.current = sig;
      return true;
    } catch {
      return false;
    } finally {
      inFlightRef.current = false;
      setTick((t) => t + 1);
    }
  }, []);

  const enqueueSave = useCallback((): Promise<boolean> => {
    const next = chainRef.current.then(runSave);
    chainRef.current = next;
    return next;
  }, [runSave]);

  // (Re)arms the debounce. The timer deliberately survives unmount so a late edit still
  // saves.
  const armTimer = useCallback(() => {
    if (timerRef.current !== undefined) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = undefined;
      void enqueueSave();
    }, SAVE_DEBOUNCE_MS);
  }, [enqueueSave]);

  const change = useCallback(
    (next: string) => {
      if (next.length > MAX_CAPTION_CHARS) return;
      const persisted = latest.current.value;

      if (timerRef.current !== undefined) {
        clearTimeout(timerRef.current);
        timerRef.current = undefined;
      }

      // Back to exactly what is persisted (e.g. an undo inside the debounce window):
      // nothing to save, and anchors reset to the persisted ones.
      if (next === persisted && unackedRef.current === null && !inFlightRef.current) {
        setDraftBoth(null);
        return;
      }

      if (next === persisted) {
        // Cannot drop the draft (the server holds different saved text), so it must still
        // be saved, but from the persisted anchors: a local orphan from the earlier draft
        // would otherwise be persisted although the quote is back. Valid by construction
        // since next === value.
        setDraftBoth({ text: next, anchors: latest.current.serverAnchors });
      } else {
        const prev = draftRef.current ?? {
          text: persisted,
          anchors: latest.current.serverAnchors,
        };
        setDraftBoth({ text: next, anchors: remapAnchors(prev.text, next, prev.anchors) });
      }
      armTimer();
    },
    [armTimer, setDraftBoth],
  );

  const flush = useCallback((): Promise<boolean> => {
    if (timerRef.current !== undefined) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    return enqueueSave();
  }, [enqueueSave]);

  const getText = useCallback(() => draftRef.current?.text ?? latest.current.value, []);

  // Threads that arrive (or are created) while a draft exists are merged in, validated
  // against the draft text. Anchors already in the draft are never touched.
  useEffect(() => {
    const d = draftRef.current;
    if (!d) return;
    const known = new Set(d.anchors.map((a) => a.id));
    const missing = anchorsFromThreads(threads).filter((a) => !known.has(a.id));
    if (missing.length === 0) return;
    setDraftBoth({ text: d.text, anchors: [...d.anchors, ...validateAnchors(d.text, missing)] });
  }, [threads, setDraftBoth]);

  // Props caught up with a saved draft: go back to reading from props.
  useEffect(() => {
    if (draft && value === draft.text && timerRef.current === undefined && !inFlightRef.current) {
      unackedRef.current = null;
      setDraftBoth(null);
    }
  });

  useUnsavedWork(draft !== null);

  return {
    text: draft?.text ?? value,
    anchors: draft?.anchors ?? serverAnchors,
    change,
    flush,
    getText,
  };
}
