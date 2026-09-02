import { useEffect } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getMensagensFeed,
  getMensagensConversas,
  sendMensagem,
  markMensagensSeen,
  replyToPostApproval,
  getClientes,
  type MensagensCursor,
} from '@/store';

const PAGE_SIZE = 50;

export function useMensagensData(
  clienteId: number | null,
  enabled = true,
  // Separate from `enabled`: prefetching the clientes queries in the
  // background (e.g. while the Equipe tab is the one showing, both flags on)
  // is fine, but marking every client message seen is a WRITE that must only
  // fire while the clientes pane is actually the one on screen -- otherwise
  // a team-chat deep link would silently clear clientes unread state the
  // user never looked at. Defaults to `enabled` so every other call site
  // (mark-seen tied 1:1 to visibility) is unchanged.
  seenEnabled = enabled,
) {
  const qc = useQueryClient();

  const conversas = useQuery({
    queryKey: ['mensagens-conversas'],
    queryFn: getMensagensConversas,
    enabled,
  });
  const clientes = useQuery({ queryKey: ['clientes'], queryFn: getClientes, enabled });

  // A merely-numeric clienteId isn't enough — confirm it's a real conversation
  // before fetching its feed. Stays false (no fetch) while conversas is still
  // loading too, same as an unconfirmed id; the shell's precedence (Task 5)
  // is what decides what to show meanwhile, this just avoids the wasted call.
  const conversaExists =
    clienteId != null && (conversas.data?.some((c) => c.cliente_id === clienteId) ?? false);

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
    enabled: enabled && conversaExists,
  });

  // Opening the page marks the whole feed seen for this user -- but only
  // while the clientes pane is actually the one showing (`seenEnabled`), not
  // just while its queries are prefetching (`enabled`): a team-chat deep
  // link (both flags on) mounts this hook with `enabled: true` for
  // background prefetch, but must not silently clear clientes unread state
  // the user never looked at. Firing on `seenEnabled` transitioning to true
  // (not just at mount) also means switching to the Clientes tab later marks
  // it seen at that moment, matching pre-split behavior for the case where
  // the pane really does show.
  useEffect(() => {
    if (!seenEnabled) return;
    markMensagensSeen()
      .then(() => {
        qc.invalidateQueries({ queryKey: ['mensagens-unread'] });
        // The conversas query races the marker on mount; if it resolved first
        // its cached unread pills are already stale — refetch them too.
        qc.invalidateQueries({ queryKey: ['mensagens-conversas'] });
      })
      // A failed marker just leaves the badge as-is until the next poll; it
      // must not surface as an unhandled rejection.
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seenEnabled]);

  const invalidateFeed = () => {
    qc.invalidateQueries({ queryKey: ['mensagens-feed'] });
    qc.invalidateQueries({ queryKey: ['mensagens-conversas'] });
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
      /** NULL = post avulso (fora de fluxo); replyToPostApproval ignores it. */
      workflowId: number | null;
      content: string;
    }) => replyToPostApproval(postId, workflowId, content),
    onSuccess: invalidateFeed,
  });

  return { feed, conversas, clientes, sendGeneral, replyToPost };
}
