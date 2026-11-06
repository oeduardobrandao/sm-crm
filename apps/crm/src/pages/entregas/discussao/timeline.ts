import { format, isSameDay, subDays } from 'date-fns';
import { i18n, getDateFnsLocale } from '@mesaas/i18n';
import { isGeralThread, type CommentThreadWithComments, type PostComment } from '@/store/comments';

export type TimelineItem =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'unread'; key: 'unread' }
  | { kind: 'message'; key: string; comment: PostComment }
  | {
      kind: 'thread';
      key: string;
      thread: CommentThreadWithComments;
      replies: number;
      novas: number;
    }
  | { kind: 'resolved'; key: 'resolved'; threads: CommentThreadWithComments[] };

type Entry =
  | { at: number; id: number; kind: 'message'; comment: PostComment }
  | { at: number; id: number; kind: 'thread'; thread: CommentThreadWithComments };

function dayLabel(date: Date, now: Date): string {
  if (isSameDay(date, now)) return i18n.t('postPanels:discussao.today');
  if (isSameDay(date, subDays(now, 1))) return i18n.t('postPanels:discussao.yesterday');
  return format(date, i18n.t('postPanels:discussao.dayFormat'), { locale: getDateFnsLocale() });
}

function byTime(a: { at: number; id: number }, b: { at: number; id: number }): number {
  return a.at - b.at || a.id - b.id;
}

/**
 * Flat, ordered timeline of a post's team discussion: messages of the general thread and
 * cards for active anchored threads, interleaved by creation time, with day dividers and an
 * "unread" marker. Resolved anchored threads collapse into one trailing item.
 */
export function buildTimeline(args: {
  threads: CommentThreadWithComments[];
  /** null = the user does not participate: no unread marker and no "novas". */
  lastSeenCommentId: number | null;
  currentUserId: string;
  now: Date;
}): TimelineItem[] {
  const { threads, lastSeenCommentId, currentUserId, now } = args;

  const entries: Entry[] = [];
  const resolved: CommentThreadWithComments[] = [];

  for (const thread of threads) {
    if (isGeralThread(thread)) {
      for (const comment of thread.post_comments ?? []) {
        entries.push({
          at: new Date(comment.created_at).getTime(),
          id: comment.id,
          kind: 'message',
          comment,
        });
      }
    } else if (thread.status === 'resolved') {
      resolved.push(thread);
    } else {
      entries.push({
        at: new Date(thread.created_at).getTime(),
        id: thread.id,
        kind: 'thread',
        thread,
      });
    }
  }

  entries.sort(byTime);

  const isNewFromOthers = (c: PostComment): boolean =>
    lastSeenCommentId !== null && c.id > lastSeenCommentId && c.author_id !== currentUserId;

  const firstUnread = entries.find(
    (e): e is Extract<Entry, { kind: 'message' }> =>
      e.kind === 'message' && isNewFromOthers(e.comment),
  );

  const items: TimelineItem[] = [];
  let lastDay: Date | null = null;

  for (const entry of entries) {
    const when = new Date(entry.at);
    if (!lastDay || !isSameDay(lastDay, when)) {
      items.push({
        kind: 'day',
        key: `day-${format(when, 'yyyy-MM-dd')}`,
        label: dayLabel(when, now),
      });
      lastDay = when;
    }

    if (entry.kind === 'message') {
      if (firstUnread === entry) items.push({ kind: 'unread', key: 'unread' });
      items.push({ kind: 'message', key: `message-${entry.id}`, comment: entry.comment });
    } else {
      const comments = entry.thread.post_comments ?? [];
      items.push({
        kind: 'thread',
        key: `thread-${entry.id}`,
        thread: entry.thread,
        replies: Math.max(0, comments.length - 1),
        novas: comments.filter(isNewFromOthers).length,
      });
    }
  }

  if (resolved.length > 0) {
    resolved.sort((a, b) =>
      byTime(
        { at: new Date(a.created_at).getTime(), id: a.id },
        { at: new Date(b.created_at).getTime(), id: b.id },
      ),
    );
    items.push({ kind: 'resolved', key: 'resolved', threads: resolved });
  }

  return items;
}
