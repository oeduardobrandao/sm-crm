import type { ActivePost } from '@/store';
import { LOCKED_STATUSES, LOCKED_TOOLTIPS } from './postLabels';
import { statusChangeNeedsConfirm, type StatusKey, type StatusRegistry } from './statusRegistry';
import type { UpdatePostStatusVars } from './hooks/useUpdatePostStatus';

/** Droppable column ids are prefixed so they never collide with a draggable
 *  card id (a plain post id) in dnd-kit's id-keyed registries. */
export const COL_PREFIX = 'col:';

export type PostsKanbanDropResult =
  | { kind: 'noop' }
  | { kind: 'invalid' }
  | { kind: 'locked-column'; message: string }
  | { kind: 'confirm'; key: StatusKey }
  | { kind: 'write'; key: StatusKey };

/**
 * Decides what a Publicações kanban drag-end means. Pure: no toasts, no
 * mutations. Mirrors calendarDrop.ts's resolveCalendarDrop — kept separate
 * from the dnd-kit wiring so the branching is testable without simulating
 * pointer events.
 */
export function resolvePostsKanbanDrop({
  post,
  overId,
  registry,
}: {
  post: ActivePost | undefined;
  overId: string | undefined;
  registry: StatusRegistry;
}): PostsKanbanDropResult {
  if (!post || !overId || !overId.startsWith(COL_PREFIX)) return { kind: 'noop' };

  const currentOpt = registry.resolve(post);
  // Defensive: the card's own useDraggable is already disabled for a locked
  // source, so the UI never fires this, but a direct call must not write either.
  if (LOCKED_STATUSES.has(currentOpt.canonical)) return { kind: 'noop' };

  const targetKey = overId.slice(COL_PREFIX.length) as StatusKey;
  if (targetKey === currentOpt.key) return { kind: 'noop' };

  const targetOpt = registry.byKey.get(targetKey);
  if (!targetOpt) return { kind: 'invalid' };

  if (LOCKED_STATUSES.has(targetOpt.canonical)) {
    return {
      kind: 'locked-column',
      message: LOCKED_TOOLTIPS[targetOpt.canonical] ?? 'Esta coluna é controlada pelo sistema.',
    };
  }

  if (statusChangeNeedsConfirm(post, targetKey, registry)) {
    return { kind: 'confirm', key: targetKey };
  }

  return { kind: 'write', key: targetKey };
}

export interface PostsKanbanHoverSlot {
  key: StatusKey;
  index: number;
}

/**
 * Decides whether the hovered column should open a live drop slot during a
 * drag, and at which index. Pure, like resolvePostsKanbanDrop above.
 *
 * The index is the spot the card will REALLY land at after the drop: the
 * byStatus grouping preserves the order of `posts` (scheduled_at asc, nulls
 * last from the query), so the landing index is the number of target-column
 * posts that precede the dragged post in that same order. Anchoring the slot
 * to the true landing spot, instead of the pointer, means the card never
 * jumps when the optimistic move settles.
 */
export function resolvePostsKanbanHover({
  post,
  posts,
  overId,
  registry,
}: {
  post: ActivePost | undefined;
  /** Full board list, in the exact order the byStatus grouping consumes. */
  posts: ActivePost[];
  overId: string | undefined;
  registry: StatusRegistry;
}): PostsKanbanHoverSlot | null {
  if (!post || !overId || !overId.startsWith(COL_PREFIX)) return null;

  const currentOpt = registry.resolve(post);
  if (LOCKED_STATUSES.has(currentOpt.canonical)) return null;

  const targetKey = overId.slice(COL_PREFIX.length) as StatusKey;
  if (targetKey === currentOpt.key) return null;

  const targetOpt = registry.byKey.get(targetKey);
  // Locked targets refuse the drop with a toast, so opening space would lie.
  if (!targetOpt || LOCKED_STATUSES.has(targetOpt.canonical)) return null;

  const draggedAt = posts.findIndex((p) => p.id === post.id);
  const before = draggedAt === -1 ? posts.length : draggedAt;
  let index = 0;
  for (let i = 0; i < before; i++) {
    const p = posts[i];
    if (p.id !== post.id && registry.resolve(p).key === targetKey) index++;
  }
  return { key: targetKey, index };
}

export interface UndoableStatusMove {
  forward: UpdatePostStatusVars;
  backward: UpdatePostStatusVars;
  targetLabel: string;
}

/**
 * Snapshots a drag-initiated status change as a forward/backward pair, so the
 * caller can offer a temporary undo. backward restores the RESOLVED current
 * key (custom pointer included), and by design skips resolvePostsKanbanDrop:
 * undoing back into an approved status must not re-open the confirm dialog.
 */
export function buildUndoableStatusMove({
  post,
  key,
  registry,
}: {
  post: ActivePost;
  key: StatusKey;
  registry: StatusRegistry;
}): UndoableStatusMove | null {
  const target = registry.byKey.get(key);
  if (!target) return null;
  const prev = registry.resolve(post);
  return {
    forward: { id: post.id, workflowId: post.workflow_id, key, canonical: target.canonical },
    backward: {
      id: post.id,
      workflowId: post.workflow_id,
      key: prev.key,
      canonical: prev.canonical,
    },
    targetLabel: target.label,
  };
}

export type UndoGuardResult = 'apply' | 'stale';

/** Undo is only safe while the post still sits where the drag left it: if its
 *  resolved key no longer equals the forward target (someone else moved it, or
 *  it vanished from the board), the backward write would clobber a newer
 *  change, so the caller must no-op. */
export function resolveUndoGuard(
  currentPosts: ActivePost[] | undefined,
  move: UndoableStatusMove,
  registry: StatusRegistry,
): UndoGuardResult {
  const current = (currentPosts ?? []).find((p) => p.id === move.forward.id);
  if (!current) return 'stale';
  return registry.resolve(current).key === move.forward.key ? 'apply' : 'stale';
}
