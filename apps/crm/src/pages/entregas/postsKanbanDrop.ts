import type { ActivePost } from '@/store';
import { LOCKED_STATUSES, LOCKED_TOOLTIPS } from './postLabels';
import { statusChangeNeedsConfirm, type StatusKey, type StatusRegistry } from './statusRegistry';

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
