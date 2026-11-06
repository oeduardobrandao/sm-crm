import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { MensagemConversa } from '@/store';
import type { useMensagensData } from './useMensagensData';
import { matchesTipo, type MensagensTipoFilter } from '../mensagensLogic';

type MensagensData = ReturnType<typeof useMensagensData>;

/** Post a reply is about. NULL workflowId = post avulso (fora de fluxo); replyToPostApproval
 *  keys on postId alone, so a null workflowId still supports the reply. */
export interface ReplyTarget {
  postId: number;
  workflowId: number | null;
  titulo: string;
}

interface Options {
  conversa: MensagemConversa;
  feed: MensagensData['feed'];
  sendGeneral: MensagensData['sendGeneral'];
  replyToPost: MensagensData['replyToPost'];
}

/**
 * State of one open conversation, shared by the desktop thread and the phone one: the
 * type filter, the composer draft and reply target, the visible items in chronological
 * order, the scroll-to-newest ref and `enviar`.
 */
export function useConversationThread({ conversa, feed, sendGeneral, replyToPost }: Options) {
  const { t } = useTranslation('messages');
  const [tipo, setTipo] = useState<MensagensTipoFilter>('todas');
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Starts true so the very first settled render (including a cold deep
  // link) snaps to the newest message; sending sets it again. "Carregar
  // mensagens anteriores" never sets it, so that fetch doesn't force a
  // snap-to-bottom — it does NOT compensate scrollTop for the newly
  // prepended content's height either, so on a large older batch the
  // previously-topmost message can still end up below the fold. Same gap
  // as the pre-refactor code; real compensation is a follow-up, not part
  // of this task.
  const scrollPending = useRef(true);

  const itens = useMemo(() => {
    const all = (feed.data?.pages ?? []).flat().filter((i) => matchesTipo(i, tipo));
    return [...all].sort((a, b) => a.created_at.localeCompare(b.created_at));
  }, [feed.data, tipo]);

  useEffect(() => {
    if (!scrollPending.current || feed.isLoading) return;
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      scrollPending.current = false;
    }
  }, [feed.isLoading, itens.length]);

  const sending = sendGeneral.isPending || replyToPost.isPending;

  async function enviar() {
    const text = draft.trim();
    if (!text || sending) return;
    try {
      if (replyTo) {
        await replyToPost.mutateAsync({
          postId: replyTo.postId,
          workflowId: replyTo.workflowId,
          content: text,
        });
      } else {
        await sendGeneral.mutateAsync({ cliente: conversa.cliente_id, content: text });
      }
      setDraft('');
      setReplyTo(null);
      scrollPending.current = true;
    } catch {
      toast.error(t('shared.sendError'));
    }
  }

  return {
    tipo,
    setTipo,
    draft,
    setDraft,
    replyTo,
    setReplyTo,
    itens,
    scrollRef,
    sending,
    enviar,
  };
}
