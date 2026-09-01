import type { ActivePost } from '@/store';

/** Sort modes a Publicações column header offers. 'manual' is the default:
 *  board_ordem asc with the never-positioned tail in automatic order. */
export type BoardColumnSort = 'manual' | 'data' | 'recentes' | 'antigos';

export const BOARD_COLUMN_SORTS: BoardColumnSort[] = ['manual', 'data', 'recentes', 'antigos'];

export const BOARD_COLUMN_SORT_LABELS: Record<BoardColumnSort, string> = {
  manual: 'Manual',
  data: 'Data agendada',
  recentes: 'Mais recentes',
  antigos: 'Mais antigos',
};

/** Spacing between materialized ranks; midpoints halve the gap ~50 times
 *  before a re-materialization is needed. */
export const BOARD_ORDEM_STEP = 1024;

/** scheduled_at asc nulls last, tie by id: the same automatic order the
 *  store's merge comparator produces. */
function byAuto(a: ActivePost, b: ActivePost): number {
  if (a.scheduled_at == null && b.scheduled_at == null) return a.id - b.id;
  if (a.scheduled_at == null) return 1;
  if (b.scheduled_at == null) return -1;
  if (a.scheduled_at < b.scheduled_at) return -1;
  if (a.scheduled_at > b.scheduled_at) return 1;
  return a.id - b.id;
}

export function sortColumnPosts(posts: ActivePost[], mode: BoardColumnSort): ActivePost[] {
  const arr = [...posts];
  switch (mode) {
    case 'manual':
      return arr.sort((a, b) => {
        if (a.board_ordem != null && b.board_ordem != null)
          return a.board_ordem - b.board_ordem || byAuto(a, b);
        if (a.board_ordem != null) return -1;
        if (b.board_ordem != null) return 1;
        return byAuto(a, b);
      });
    case 'data':
      return arr.sort(byAuto);
    case 'recentes':
      return arr.sort((a, b) => b.id - a.id);
    case 'antigos':
      return arr.sort((a, b) => a.id - b.id);
  }
}

export interface BoardPlacementUpdate {
  id: number;
  board_ordem: number;
}

/**
 * Ranks to persist so `draggedId` lands at `insertIndex` of a manual column.
 * `columnPosts` is the target column AS RENDERED (manual sort), WITHOUT the
 * dragged post. Single midpoint write when the neighbors allow it; otherwise
 * the whole column re-materializes on a fresh STEP grid (one RPC either way).
 */
export function planBoardPlacement(
  columnPosts: ActivePost[],
  insertIndex: number,
  draggedId: number,
): BoardPlacementUpdate[] {
  if (columnPosts.length === 0) return [{ id: draggedId, board_ordem: BOARD_ORDEM_STEP }];

  const clamped = Math.max(0, Math.min(insertIndex, columnPosts.length));
  const beforeRank = clamped > 0 ? columnPosts[clamped - 1].board_ordem : null;
  const afterRank = clamped < columnPosts.length ? columnPosts[clamped].board_ordem : null;

  if (clamped === 0 && afterRank != null)
    return [{ id: draggedId, board_ordem: afterRank - BOARD_ORDEM_STEP }];
  if (clamped === columnPosts.length && beforeRank != null)
    return [{ id: draggedId, board_ordem: beforeRank + BOARD_ORDEM_STEP }];
  if (beforeRank != null && afterRank != null) {
    const mid = (beforeRank + afterRank) / 2;
    if (mid > beforeRank && mid < afterRank) return [{ id: draggedId, board_ordem: mid }];
  }

  const ids = columnPosts.map((p) => p.id);
  ids.splice(clamped, 0, draggedId);
  return ids.map((id, i) => ({ id, board_ordem: (i + 1) * BOARD_ORDEM_STEP }));
}
