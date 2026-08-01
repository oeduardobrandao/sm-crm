import { useEffect } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getMensagensFeed,
  getMensagensUnread,
  sendMensagem,
  markMensagensSeen,
  replyToPostApproval,
  getClientes,
  type MensagensCursor,
} from '@/store';

const PAGE_SIZE = 50;

export function useMensagensData(clienteId: number | null) {
  const qc = useQueryClient();

  const feed = useInfiniteQuery({
    queryKey: ['mensagens-feed', clienteId],
    queryFn: ({ pageParam }) =>
      getMensagensFeed({ clienteId: clienteId ?? undefined, cursor: pageParam }),
    initialPageParam: undefined as MensagensCursor | undefined,
    getNextPageParam: (last) => {
      if (last.length !== PAGE_SIZE) return undefined;
      const oldest = last[last.length - 1];
      return {
        before: oldest.created_at,
        beforeSource: oldest.source,
        beforeItemId: oldest.item_id,
      };
    },
  });

  const unread = useQuery({ queryKey: ['mensagens-unread'], queryFn: getMensagensUnread });
  const clientes = useQuery({ queryKey: ['clientes'], queryFn: getClientes });

  // Opening the page marks the whole feed seen for this user.
  useEffect(() => {
    markMensagensSeen().then(() => {
      qc.invalidateQueries({ queryKey: ['mensagens-unread'] });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const invalidateFeed = () => {
    qc.invalidateQueries({ queryKey: ['mensagens-feed'] });
  };

  const sendGeneral = useMutation({
    mutationFn: ({ cliente, content }: { cliente: number; content: string }) =>
      sendMensagem(cliente, content),
    onSuccess: invalidateFeed,
  });

  const replyToPost = useMutation({
    mutationFn: ({
      postId,
      workflowId,
      content,
    }: {
      postId: number;
      workflowId: number;
      content: string;
    }) => replyToPostApproval(postId, workflowId, content),
    onSuccess: invalidateFeed,
  });

  return { feed, unread, clientes, sendGeneral, replyToPost };
}
