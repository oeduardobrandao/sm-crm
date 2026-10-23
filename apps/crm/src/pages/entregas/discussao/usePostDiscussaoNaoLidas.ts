import { useMemo } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getDiscussaoNaoLidas, type DiscussaoNaoLidas } from '../../../store';

/** Prefix invalidated after sends, reads and realtime events (see the discussion store). */
export const POST_DISCUSSAO_NAO_LIDAS_KEY = 'post-discussao-nao-lidas';

export interface PostDiscussaoNaoLidasResult {
  /** Discussion total and unread count per post. Posts without messages have no entry. */
  byPost: Map<number, DiscussaoNaoLidas>;
  /** Unread messages per workflow: the sum of `naoLidas` across the workflow's posts. */
  byWorkflow: Map<number, number>;
}

const EMPTY_IDS: number[] = [];

function sortedUnique(ids: number[] | undefined): number[] {
  if (!ids || ids.length === 0) return EMPTY_IDS;
  return Array.from(new Set(ids)).sort((a, b) => a - b);
}

/**
 * Discussion totals and unread counts for a set of posts and/or workflows, in ONE RPC
 * call. A board asks once for everything visible: fluxo cards by `workflowIds` (the
 * board knows workflow ids, not post ids), post cards by `postIds`. `naoLidas` is only
 * non-zero for participants who follow the discussion; everyone else gets the total.
 */
export function usePostDiscussaoNaoLidas(args: {
  postIds?: number[];
  workflowIds?: number[];
}): PostDiscussaoNaoLidasResult {
  const postIds = sortedUnique(args.postIds);
  const workflowIds = sortedUnique(args.workflowIds);
  const enabled = postIds.length > 0 || workflowIds.length > 0;

  const { data } = useQuery({
    queryKey: [POST_DISCUSSAO_NAO_LIDAS_KEY, postIds, workflowIds],
    queryFn: () => getDiscussaoNaoLidas({ postIds, workflowIds }),
    enabled,
    // The same ids reappear as a board refetches; keep the badges while a new set loads.
    placeholderData: keepPreviousData,
  });

  return useMemo(() => {
    const byPost = new Map<number, DiscussaoNaoLidas>();
    const byWorkflow = new Map<number, number>();
    // A post asked for by id AND through its workflow must count once.
    for (const row of data ?? []) byPost.set(row.postId, row);
    for (const row of byPost.values()) {
      if (row.workflowId == null) continue;
      byWorkflow.set(row.workflowId, (byWorkflow.get(row.workflowId) ?? 0) + row.naoLidas);
    }
    return { byPost, byWorkflow };
  }, [data]);
}

export interface DiscussaoTriggerBadge {
  count: number;
  /** True when `count` is unread messages (shown with a dot); false when it is the total. */
  unread: boolean;
  label: string;
}

/**
 * What the post's collapsed row shows. Unread (participants who follow) wins with a dot;
 * otherwise the discussion total with no dot. Nothing until the counts arrive (a thread
 * count standing in would label threads as messages) and nothing for an empty discussion.
 */
export function discussaoTriggerBadge(
  stats: Pick<DiscussaoNaoLidas, 'total' | 'naoLidas'> | undefined,
): DiscussaoTriggerBadge | null {
  if (!stats) return null;
  const { naoLidas, total } = stats;
  if (naoLidas > 0) {
    return {
      count: naoLidas,
      unread: true,
      label: `${naoLidas} ${naoLidas === 1 ? 'mensagem nova' : 'mensagens novas'} na discussão`,
    };
  }
  if (total <= 0) return null;
  return {
    count: total,
    unread: false,
    label: `${total} ${total === 1 ? 'mensagem' : 'mensagens'} na discussão`,
  };
}
