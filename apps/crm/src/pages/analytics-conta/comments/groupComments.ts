import type { IgComment } from '../../../services/instagramComments';

export interface CommentGroup {
  comment: IgComment;
  replies: IgComment[];
}

/**
 * Nests the flat comment list one level deep: a row goes under its parent only when the
 * parent is in the list, is not the row itself and is top-level (no `parent_id` of its
 * own). Everything else (orphan, reply to a reply, self or cyclic reference, or an older
 * function that sends no `parent_id`) stays top-level, so no row is ever dropped. Groups
 * keep the order of their top-level rows; replies keep their original order.
 */
export function groupComments(comments: IgComment[]): CommentGroup[] {
  const byId = new Map(comments.map((c) => [c.id, c]));
  const parentOf = (c: IgComment): string | null => {
    const pid = c.parent_id;
    if (!pid || pid === c.id) return null;
    const parent = byId.get(pid);
    return parent && !parent.parent_id ? pid : null;
  };

  const groups: CommentGroup[] = [];
  const groupById = new Map<string, CommentGroup>();
  for (const c of comments) {
    if (parentOf(c) === null) {
      const group = { comment: c, replies: [] };
      groups.push(group);
      groupById.set(c.id, group);
    }
  }
  for (const c of comments) {
    const pid = parentOf(c);
    if (pid !== null) groupById.get(pid)?.replies.push(c);
  }
  return groups;
}
