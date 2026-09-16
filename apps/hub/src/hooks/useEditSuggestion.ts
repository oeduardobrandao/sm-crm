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
  // can land AFTER a later, more complete one and silently overwrite it. `pendingRef`
  // always holds the latest edit; a flush in flight is followed by another flush of
  // whatever is left in `pendingRef` once it settles, so saves are strictly serialized
  // and each one reflects the freshest state at send time.
  //
  // `postId` travels WITH the payload, not via the `flush` closure's own `post.id`.
  // This component/hook instance can be reused across different posts without
  // remounting (e.g. `postagens/:postId` has no `key`, so React Router re-renders the
  // same instance on navigation) -- if the finally-block's recursive `flush()` call
  // resolved a stale, post-A-scoped closure while `pendingRef` now holds post B's
  // edit, submitting via that closure's own `post.id` would attribute B's content to
  // A. Reading the target id off the payload itself keeps every save attributed to
  // whichever post it was actually typed into, regardless of which closure sends it.
  type Payload = {
    postId: number;
    conteudo: Record<string, unknown> | null;
    conteudoPlain: string;
    igCaption: string | null;
  };
  const pendingRef = useRef<Payload | null>(null);
  const inFlightRef = useRef(false);

  // An explicit drain loop rather than recursion: a queued edit made while this was
  // already running (another `saveSuggestion` call landing mid-`await`) is handled by
  // looping back to `pendingRef` instead of calling `flush` again, so there is only
  // ever one closure involved -- nothing about it can go stale mid-drain.
  const flush = useCallback(async () => {
    if (inFlightRef.current || !pendingRef.current) return;
    inFlightRef.current = true;
    let succeeded = false;
    try {
      while (pendingRef.current) {
        const payload = pendingRef.current;
        pendingRef.current = null;
        setSaveState('saving');
        try {
          const res = await submitEditSuggestion(
            token,
            payload.postId,
            payload.conteudo,
            payload.conteudoPlain,
            payload.igCaption,
          );
          setHasPendingSuggestion(!!res.pending_suggestion);
          onSaved();
          succeeded = true;
        } catch {
          // Swallowed on purpose (see saveState reset below), so `dirty` is the only
          // signal left that the edit never made it to the server: it stays true here.
          succeeded = false;
        }
      }
    } finally {
      inFlightRef.current = false;
    }
    if (succeeded) {
      setSaveState('saved');
      setDirty(false);
      savedTimerRef.current = setTimeout(() => setSaveState('idle'), 3000);
    } else {
      setSaveState('idle');
    }
  }, [token, onSaved]);

  const saveSuggestion = useCallback(
    (conteudo: Record<string, unknown> | null, conteudoPlain: string, igCaption: string | null) => {
      setDirty(true);
      pendingRef.current = { postId: post.id, conteudo, conteudoPlain, igCaption };
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
