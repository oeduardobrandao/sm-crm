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
  type Payload = {
    conteudo: Record<string, unknown> | null;
    conteudoPlain: string;
    igCaption: string | null;
  };
  const pendingRef = useRef<Payload | null>(null);
  const inFlightRef = useRef(false);

  const flush = useCallback(async () => {
    const payload = pendingRef.current;
    if (!payload || inFlightRef.current) return;
    pendingRef.current = null;
    inFlightRef.current = true;
    setSaveState('saving');
    try {
      const res = await submitEditSuggestion(
        token,
        post.id,
        payload.conteudo,
        payload.conteudoPlain,
        payload.igCaption,
      );
      setHasPendingSuggestion(!!res.pending_suggestion);
      onSaved();
      if (!pendingRef.current) {
        setSaveState('saved');
        setDirty(false);
        savedTimerRef.current = setTimeout(() => setSaveState('idle'), 3000);
      }
    } catch {
      // Swallowed on purpose (see saveState reset below), so `dirty` is the only
      // signal left that the edit never made it to the server: it stays true here.
      setSaveState('idle');
    } finally {
      inFlightRef.current = false;
      if (pendingRef.current) flush();
    }
  }, [token, post.id, onSaved]);

  const saveSuggestion = useCallback(
    (conteudo: Record<string, unknown> | null, conteudoPlain: string, igCaption: string | null) => {
      setDirty(true);
      pendingRef.current = { conteudo, conteudoPlain, igCaption };
      if (timerRef.current) clearTimeout(timerRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);

      timerRef.current = setTimeout(() => {
        flush();
      }, 1500);
    },
    [flush],
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
