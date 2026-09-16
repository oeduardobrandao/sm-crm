import { useState, useRef, useCallback, useMemo } from 'react';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import { submitEditSuggestion } from '../api';
import type { HubPost, PendingEditSuggestion } from '../types';

export type SaveState = 'idle' | 'saving' | 'saved';

interface UseEditSuggestionOpts {
  token: string;
  post: HubPost;
  onSaved: () => void;
}

export function useEditSuggestion({ token, post, onSaved }: UseEditSuggestionOpts) {
  const isEditable = post.status === 'enviado_cliente';
  const suggestion = post.pending_suggestion;
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [hasPendingSuggestion, setHasPendingSuggestion] = useState(!!suggestion);
  const [dirty, setDirty] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const draftConteudo = useMemo(
    () => suggestion?.suggested_conteudo ?? post.conteudo,
    [suggestion, post.conteudo],
  );
  const draftConteudoPlain = useMemo(
    () => suggestion?.suggested_conteudo_plain ?? post.conteudo_plain,
    [suggestion, post.conteudo_plain],
  );
  const draftIgCaption = useMemo(
    () => suggestion?.suggested_ig_caption ?? post.ig_caption ?? null,
    [suggestion, post.ig_caption],
  );

  // At most one submitEditSuggestion call in flight at a time. Without this, two
  // debounced saves can overlap (the edge function round-trip is several sequential
  // DB calls, easily 0.5-1.5s) and complete out of order: an earlier, staler snapshot
  // can land AFTER a later, more complete one and silently overwrite it. A flush in
  // flight is followed by another flush of whatever is left queued once it settles,
  // so saves are strictly serialized and each one reflects the freshest state at send
  // time -- per post, see below.
  //
  // `pendingRef` is a Map keyed by post id, not a single slot. This component/hook
  // instance can be reused across different posts without remounting (e.g.
  // `postagens/:postId` has no `key`, so React Router re-renders the same instance on
  // navigation) -- a single-slot queue would let editing post C overwrite a still-queued
  // edit for post B, silently dropping B's edit even though it was typed into a
  // different post and never got a chance to send. Keying by post id keeps each post's
  // latest edit (repeated edits to the same post still coalesce onto one entry) until
  // it is actually sent.
  type Payload = {
    postId: number;
    conteudo: Record<string, unknown> | null;
    conteudoPlain: string;
    igCaption: string | null;
  };
  const pendingRef = useRef<Map<number, Payload>>(new Map());
  const inFlightRef = useRef(false);
  // Always holds the id of whichever post this hook is CURRENTLY rendering, updated
  // every render (not via effect -- there is nothing to react to, just a fresh read).
  // `flush` uses it to decide whether a just-drained save's outcome should update this
  // instance's on-screen state (saveState/hasPendingSuggestion/dirty): a save for a
  // post the user has since navigated away from must still be sent (below), but must
  // not paint the CURRENTLY displayed post's UI with a different post's result.
  const currentPostIdRef = useRef(post.id);
  currentPostIdRef.current = post.id;

  // An explicit drain loop rather than recursion: a queued edit made while this was
  // already running (another `saveSuggestion` call landing mid-`await`) is handled by
  // looping back to `pendingRef` instead of calling `flush` again, so there is only
  // ever one closure involved -- nothing about it can go stale mid-drain.
  const flush = useCallback(async () => {
    if (inFlightRef.current || pendingRef.current.size === 0) return;
    inFlightRef.current = true;
    try {
      while (pendingRef.current.size > 0) {
        const [postId, payload] = pendingRef.current.entries().next().value as [number, Payload];
        pendingRef.current.delete(postId);
        const isCurrentPost = postId === currentPostIdRef.current;
        if (isCurrentPost) setSaveState('saving');
        try {
          const res = await submitEditSuggestion(
            token,
            payload.postId,
            payload.conteudo,
            payload.conteudoPlain,
            payload.igCaption,
          );
          onSaved();
          if (isCurrentPost) {
            setHasPendingSuggestion(!!res.pending_suggestion);
            setSaveState('saved');
            setDirty(false);
            savedTimerRef.current = setTimeout(() => setSaveState('idle'), 3000);
          }
        } catch {
          // Swallowed on purpose, so `dirty` is the only signal left that the edit
          // never made it to the server: it stays true (set in saveSuggestion, never
          // cleared here) for whichever post this failure was for.
          if (isCurrentPost) setSaveState('idle');
        }
      }
    } finally {
      inFlightRef.current = false;
    }
  }, [token, onSaved]);

  const saveSuggestion = useCallback(
    (conteudo: Record<string, unknown> | null, conteudoPlain: string, igCaption: string | null) => {
      setDirty(true);
      pendingRef.current.set(post.id, { postId: post.id, conteudo, conteudoPlain, igCaption });
      if (timerRef.current) clearTimeout(timerRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);

      timerRef.current = setTimeout(() => {
        flush();
      }, 1500);
    },
    [flush, post.id],
  );

  const approvalBlocked = saveState === 'saving' || hasPendingSuggestion;
  const wasRejected = !hasPendingSuggestion && !!post.suggestion_rejected_at;

  useUnsavedWork(dirty || saveState === 'saving');

  return {
    isEditable,
    hasPendingSuggestion,
    wasRejected,
    saveSuggestion,
    saveState,
    approvalBlocked,
    draftConteudo,
    draftConteudoPlain,
    draftIgCaption,
  };
}
