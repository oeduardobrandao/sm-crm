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
 */
export function useCaptionDraft({ value, threads, onSave }: Args) {
  const serverAnchors = useMemo(
    () => validateAnchors(value, anchorsFromThreads(threads)),
    [value, threads],
  );

  const [draft, setDraft] = useState<Draft | null>(null);
  const [, setTick] = useState(0);
  const draftRef = useRef<Draft | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inFlightRef = useRef(false);
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());
  // Text of the last successful save that `value` (props) has not reflected yet.
  // While set, "typed back to `value`" is NOT "back to persisted": the server holds
  // the saved text, so that edit must still be saved.
  const unackedRef = useRef<string | null>(null);
  const latest = useRef({ value, serverAnchors, onSave });

  useEffect(() => {
    latest.current = { value, serverAnchors, onSave };
  });

  const setDraftBoth = useCallback((next: Draft | null) => {
    draftRef.current = next;
    setDraft(next);
  }, []);

  const runSave = useCallback(async (): Promise<boolean> => {
    const d = draftRef.current;
    if (!d) return true;
    inFlightRef.current = true;
    try {
      // Defense in depth (Task 2 review): remapAnchors trusts in-range input, and an
      // out-of-range non-orphaned anchor makes save_ig_caption raise. Re-validate the
      // draft's anchors against the exact text being saved: re-anchor on a unique quote,
      // else orphan. A no-op for anchors that are already consistent.
      await latest.current.onSave(d.text, patchesFromAnchors(validateAnchors(d.text, d.anchors)));
      unackedRef.current = d.text;
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

      const prev = draftRef.current ?? {
        text: persisted,
        anchors: latest.current.serverAnchors,
      };
      setDraftBoth({ text: next, anchors: remapAnchors(prev.text, next, prev.anchors) });
      timerRef.current = setTimeout(() => {
        timerRef.current = undefined;
        void enqueueSave();
      }, SAVE_DEBOUNCE_MS);
    },
    [enqueueSave, setDraftBoth],
  );

  const flush = useCallback((): Promise<boolean> => {
    if (timerRef.current !== undefined) {
      clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    return enqueueSave();
  }, [enqueueSave]);

  const getText = useCallback(() => draftRef.current?.text ?? latest.current.value, []);

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
