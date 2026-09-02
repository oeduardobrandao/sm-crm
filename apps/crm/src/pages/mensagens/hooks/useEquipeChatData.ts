import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getEquipeConversas,
  getEquipeMensagens,
  markEquipeConversaSeen,
  sendEquipeMensagem,
  type EquipeMensagensCursor,
} from '@/store';

const PAGE_SIZE = 50;

export function useEquipeChatData(conversaId: number | null) {
  const qc = useQueryClient();

  const conversas = useQuery({
    queryKey: ['equipe-conversas'],
    queryFn: getEquipeConversas,
    refetchInterval: 60_000,
  });

  const conversaExists =
    conversaId != null && (conversas.data?.some((c) => c.conversa_id === conversaId) ?? false);

  const mensagens = useInfiniteQuery({
    queryKey: ['equipe-mensagens', conversaId],
    queryFn: ({ pageParam }) => getEquipeMensagens({ conversaId: conversaId!, cursor: pageParam }),
    initialPageParam: undefined as EquipeMensagensCursor | undefined,
    getNextPageParam: (last) => {
      if (last.length !== PAGE_SIZE) return undefined;
      const oldest = last[last.length - 1];
      return { before: oldest.created_at, beforeId: oldest.id };
    },
    enabled: conversaExists,
    // Realtime fallback (spec): poll every 60s while the thread is open, same
    // interval as the conversas list above. Re-fetches EVERY loaded page, not
    // just the newest -- acceptable here since chat threads keep few pages
    // loaded (50/page, and older ones rarely stay mounted long).
    refetchInterval: 60_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['equipe-mensagens'] });
    qc.invalidateQueries({ queryKey: ['equipe-conversas'] });
  };

  const send = useMutation({
    mutationFn: ({ content, anexoIds }: { content: string; anexoIds?: number[] }) =>
      sendEquipeMensagem(conversaId!, content, anexoIds),
    onSuccess: invalidate,
  });

  const markSeen = useMutation({
    mutationFn: (lastMessageId: number) => markEquipeConversaSeen(conversaId!, lastMessageId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['equipe-conversas'] });
      qc.invalidateQueries({ queryKey: ['equipe-chat-unread'] });
    },
  });

  return { conversas, mensagens, send, markSeen };
}
