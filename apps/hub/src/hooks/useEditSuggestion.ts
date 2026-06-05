import { useState, useRef, useCallback, useMemo } from 'react';
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

  const saveSuggestion = useCallback(
    (conteudo: Record<string, unknown> | null, conteudoPlain: string, igCaption: string | null) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);

      timerRef.current = setTimeout(async () => {
        setSaveState('saving');
        try {
          const res = await submitEditSuggestion(
            token,
            post.id,
            conteudo,
            conteudoPlain,
            igCaption,
          );
          setHasPendingSuggestion(!!res.pending_suggestion);
          setSaveState('saved');
          savedTimerRef.current = setTimeout(() => setSaveState('idle'), 3000);
          onSaved();
        } catch {
          setSaveState('idle');
        }
      }, 1500);
    },
    [token, post.id, onSaved],
  );

  const approvalBlocked = saveState === 'saving' || hasPendingSuggestion;
  const wasRejected = !hasPendingSuggestion && !!post.suggestion_rejected_at;

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
