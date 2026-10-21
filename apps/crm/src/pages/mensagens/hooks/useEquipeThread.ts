import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { trackUnsavedWork, useUnsavedWork } from '@mesaas/app-lifecycle';
import { useAuth } from '@/context/AuthContext';
import { uploadEquipeChatAnexo, validateEquipeChatFile } from '@/services/equipeChatMedia';
import type { EquipeConversa, EquipeMensagemAnexo } from '@/store';
import type { useEquipeChatData } from './useEquipeChatData';
import { agruparEquipeMensagens } from '../equipeChatLogic';

type EquipeData = ReturnType<typeof useEquipeChatData>;

interface Options {
  conversa: EquipeConversa;
  mensagens: EquipeData['mensagens'];
  send: EquipeData['send'];
  markSeen: EquipeData['markSeen'];
}

/**
 * State of one open team conversation, shared by the desktop thread and the phone one:
 * the composer draft, the staged attachments, the messages in chronological order, the
 * scroll-to-newest ref, the seen high-water mark, `anexar` and `enviar`.
 */
export function useEquipeThread({ conversa, mensagens, send, markSeen }: Options) {
  const { user } = useAuth();
  const meuId = user?.id ?? null;
  const [draft, setDraft] = useState('');
  const [anexosPendentes, setAnexosPendentes] = useState<EquipeMensagemAnexo[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Same rationale as useConversationThread: starts true so the first settled
  // render snaps to the newest message; "Carregar mensagens anteriores"
  // never sets it, so loading older pages doesn't force a snap-to-bottom.
  const scrollPending = useRef(true);

  // Staged attachments live only in this state until the message is sent (the
  // DOM heuristic of the silent-update guard can't see them), and an upload or
  // send in flight would be cut by a reload.
  useUnsavedWork(anexosPendentes.length > 0 || uploading || send.isPending);

  const itens = useMemo(() => {
    const all = (mensagens.data?.pages ?? []).flat();
    return [...all].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id - b.id);
  }, [mensagens.data]);

  // Day dividers and stacked runs (same author, a few minutes apart).
  const rows = useMemo(() => agruparEquipeMensagens(itens), [itens]);

  useEffect(() => {
    if (!scrollPending.current || mensagens.isLoading) return;
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      scrollPending.current = false;
    }
  }, [mensagens.isLoading, itens.length]);

  // High-water mark: marca lido o maior id RENDERIZADO. Re-marca a cada
  // mensagem nova (realtime invalida -> itens muda).
  const maiorId = itens.length > 0 ? itens[itens.length - 1].id : 0;
  useEffect(() => {
    if (maiorId > 0) markSeen.mutate(maiorId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maiorId, conversa.conversa_id]);

  async function anexar(file: File) {
    const erro = validateEquipeChatFile(file);
    if (erro) {
      toast.error(erro);
      return;
    }
    setUploading(true);
    try {
      const anexo = await trackUnsavedWork(uploadEquipeChatAnexo(conversa.conversa_id, file));
      setAnexosPendentes((prev) => [...prev, anexo]);
    } catch {
      toast.error('Não foi possível enviar o arquivo.');
    } finally {
      setUploading(false);
    }
  }

  function removerAnexo(id: number) {
    setAnexosPendentes((prev) => prev.filter((a) => a.id !== id));
  }

  const podeEnviar =
    !send.isPending && !uploading && (draft.trim() !== '' || anexosPendentes.length > 0);

  async function enviar() {
    const text = draft.trim();
    if (!podeEnviar) return;
    try {
      await send.mutateAsync({
        content: text,
        anexoIds: anexosPendentes.length > 0 ? anexosPendentes.map((a) => a.id) : undefined,
      });
      setDraft('');
      setAnexosPendentes([]);
      scrollPending.current = true;
    } catch {
      toast.error('Não foi possível enviar a mensagem.');
    }
  }

  /** Enter sends, Shift+Enter breaks the line. MentionEditor skips this while an IME
   * is composing or an @-suggestion is open. */
  function onComposerKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    void enviar();
  }

  return {
    meuId,
    draft,
    setDraft,
    anexosPendentes,
    removerAnexo,
    uploading,
    fileInputRef,
    scrollRef,
    itens,
    rows,
    anexar,
    podeEnviar,
    enviar,
    onComposerKeyDown,
  };
}
