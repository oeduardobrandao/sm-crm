import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import type { MentionEditorHandle } from '@/components/mentions/MentionEditor';
import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';
import {
  DISCUSSAO_MAX_CHARS,
  deletePostComment,
  updatePostComment,
  type PostComment,
} from '@/store/comments';
import type { UseDiscussaoResult } from './useDiscussao';

// Defined next to the RPC wrapper; re-exported for the composers that import it from here.
export { DISCUSSAO_MAX_CHARS };
const NOW_REFRESH_MS = 60_000;

/** Keeps "Hoje"/"Ontem" right across midnight without recomputing on every render. */
export function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), NOW_REFRESH_MS);
    return () => clearInterval(id);
  }, []);
  return now;
}

/**
 * Whether the "Discutir no chat" slot renders. Fail-closed like ProtectedRoute: no
 * features loaded = no bridge.
 */
export function useShowChatBridge(): boolean {
  const { features, isUnlimited } = useWorkspaceLimits();
  return isUnlimited || features?.feature_team_chat === true;
}

/**
 * The discussion composer's behaviour, shared by the desktop section and the phone tab
 * (they differ only in markup): trimmed 1..4000 chars, Enter sends, Shift+Enter and IME
 * composition do not, a failed send keeps the text, and the unsaved-work guard holds while
 * a draft exists or a send is in flight.
 */
export function useDiscussaoComposer(discussao: UseDiscussaoResult) {
  const { t } = useTranslation('postPanels');
  const [draft, setDraft] = useState('');
  const editorRef = useRef<MentionEditorHandle>(null);
  const trimmed = draft.trim();
  const tooLong = trimmed.length > DISCUSSAO_MAX_CHARS;
  const canSend = !!trimmed && !tooLong && !discussao.sending;

  useUnsavedWork(trimmed.length > 0 || discussao.sending);

  // The editor stays editable while a send is in flight: flipping contenteditable off would
  // drop focus, and "Enter envia" is a typing loop. Only the send action is gated.
  const handleSend = async () => {
    if (!canSend) return;
    const text = trimmed;
    try {
      await discussao.send(text);
      // Clear only what was sent; anything typed during the request stays.
      setDraft((cur) => {
        const rest = cur.trimStart();
        if (rest.trim() === text) return '';
        return rest.startsWith(text) ? rest.slice(text.length).trimStart() : cur;
      });
      // Sending from the button (keyboard) leaves focus on a button that is now disabled,
      // so it falls to <body>; bring it back to the editor for the next message.
      if (typeof document !== 'undefined') {
        const active = document.activeElement;
        if (!active || active === document.body) editorRef.current?.focus();
      }
    } catch {
      toast.error(t('discussao.sendError'));
    }
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  return { draft, setDraft, editorRef, tooLong, canSend, handleSend, handleKeyDown };
}

/** The follow bell: for the implicit responsible "following" is true and a click unfollows. */
export function useSeguirToggle(discussao: UseDiscussaoResult) {
  const { t } = useTranslation('postPanels');
  const [busy, setBusy] = useState(false);
  const following = discussao.isParticipant;
  const toggle = async () => {
    setBusy(true);
    try {
      await discussao.toggleSeguir();
    } catch {
      toast.error(t('discussao.updateError'));
    } finally {
      setBusy(false);
    }
  };
  // `ready` is false until participation loads: callers hide the bell instead of flashing
  // "Seguir" to someone who follows.
  return { following, ready: !!discussao.participacao, disabled: busy, toggle };
}

/**
 * Edit/delete of the user's own general-thread messages, straight on `post_comments`: the
 * thread itself can never be deleted or resolved (the database rejects it), even when its
 * last message goes.
 */
export function useDiscussaoMessageActions() {
  const qc = useQueryClient();
  const refreshThreads = () => {
    void qc.invalidateQueries({ queryKey: ['post-comment-threads'] });
    void qc.invalidateQueries({ queryKey: ['post-discussao-nao-lidas'] });
  };
  const handleEditMessage = async (comment: PostComment, content: string) => {
    await updatePostComment(comment.id, content);
    refreshThreads();
  };
  const handleDeleteMessage = async (comment: PostComment) => {
    await deletePostComment(comment.id);
    refreshThreads();
  };
  return { handleEditMessage, handleDeleteMessage };
}
