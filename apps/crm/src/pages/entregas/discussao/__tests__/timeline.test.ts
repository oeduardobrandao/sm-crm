import { describe, it, expect } from 'vitest';
import type { CommentThreadWithComments, PostComment } from '@/store/comments';
import { buildTimeline } from '../timeline';

// Local-time constructors keep the day boundaries stable under any TZ.
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).toISOString();
const NOW = new Date(2026, 9, 22, 15, 0);
const ME = 'me';
const OTHER = 'other';

function comment(id: number, threadId: number, author: string, created: string): PostComment {
  return {
    id,
    thread_id: threadId,
    author_id: author,
    content: `c${id}`,
    created_at: created,
    updated_at: null,
  };
}

function thread(
  id: number,
  field: CommentThreadWithComments['field'],
  created: string,
  comments: PostComment[],
  status: 'active' | 'resolved' = 'active',
): CommentThreadWithComments {
  return {
    id,
    post_id: 1,
    conta_id: 'conta',
    quoted_text: field === 'geral' ? '' : 'trecho',
    status,
    created_by: OTHER,
    resolved_by: null,
    created_at: created,
    resolved_at: null,
    field,
    anchor_start: null,
    anchor_end: null,
    orphaned: false,
    post_comments: comments,
  };
}

const base = { currentUserId: ME, now: NOW };

describe('buildTimeline', () => {
  it('returns [] for empty input', () => {
    expect(buildTimeline({ ...base, threads: [], lastSeenCommentId: null })).toEqual([]);
  });

  it('returns [] when the only thread is an empty geral thread', () => {
    const geral = thread(1, 'geral', at(22, 9), []);
    expect(buildTimeline({ ...base, threads: [geral], lastSeenCommentId: 0 })).toEqual([]);
  });

  it('interleaves geral messages and active thread cards by created_at', () => {
    const geral = thread(1, 'geral', at(22, 8), [
      comment(10, 1, OTHER, at(22, 9)),
      comment(11, 1, ME, at(22, 11)),
    ]);
    const anchored = thread(2, 'conteudo', at(22, 10), [comment(20, 2, OTHER, at(22, 10))]);
    const items = buildTimeline({ ...base, threads: [geral, anchored], lastSeenCommentId: null });
    expect(items.map((i) => i.key)).toEqual([
      'day-2026-10-22',
      'message-10',
      'thread-2',
      'message-11',
    ]);
  });

  it('inserts day dividers: Hoje, Ontem and "d de MMMM"', () => {
    const geral = thread(1, 'geral', at(15, 8), [
      comment(1, 1, OTHER, at(15, 9)),
      comment(2, 1, OTHER, at(21, 9)),
      comment(3, 1, OTHER, at(21, 18)),
      comment(4, 1, OTHER, at(22, 9)),
    ]);
    const items = buildTimeline({ ...base, threads: [geral], lastSeenCommentId: null });
    const days = items.filter((i) => i.kind === 'day');
    expect(days.map((d) => d.kind === 'day' && d.label)).toEqual([
      '15 de outubro',
      'Ontem',
      'Hoje',
    ]);
    expect(items.map((i) => i.key)).toEqual([
      'day-2026-10-15',
      'message-1',
      'day-2026-10-21',
      'message-2',
      'message-3',
      'day-2026-10-22',
      'message-4',
    ]);
  });

  it('puts the unread marker before the first unseen message from someone else', () => {
    const geral = thread(1, 'geral', at(22, 8), [
      comment(10, 1, OTHER, at(22, 9)),
      comment(11, 1, ME, at(22, 10)),
      comment(12, 1, OTHER, at(22, 11)),
      comment(13, 1, OTHER, at(22, 12)),
    ]);
    const items = buildTimeline({ ...base, threads: [geral], lastSeenCommentId: 10 });
    expect(items.map((i) => i.key)).toEqual([
      'day-2026-10-22',
      'message-10',
      'message-11',
      'unread',
      'message-12',
      'message-13',
    ]);
  });

  it('skips own unseen messages when picking the unread position', () => {
    const geral = thread(1, 'geral', at(22, 8), [
      comment(10, 1, OTHER, at(22, 9)),
      comment(11, 1, ME, at(22, 10)),
    ]);
    const items = buildTimeline({ ...base, threads: [geral], lastSeenCommentId: 10 });
    expect(items.some((i) => i.kind === 'unread')).toBe(false);
  });

  it('has no unread marker when lastSeenCommentId is null', () => {
    const geral = thread(1, 'geral', at(22, 8), [comment(10, 1, OTHER, at(22, 9))]);
    const items = buildTimeline({ ...base, threads: [geral], lastSeenCommentId: null });
    expect(items.some((i) => i.kind === 'unread')).toBe(false);
  });

  it('has no unread marker when nothing is newer than lastSeenCommentId', () => {
    const geral = thread(1, 'geral', at(22, 8), [comment(10, 1, OTHER, at(22, 9))]);
    const items = buildTimeline({ ...base, threads: [geral], lastSeenCommentId: 10 });
    expect(items.some((i) => i.kind === 'unread')).toBe(false);
  });

  it('ignores anchored-thread comments when placing the unread marker', () => {
    const geral = thread(1, 'geral', at(22, 8), [comment(10, 1, OTHER, at(22, 9))]);
    const anchored = thread(2, 'conteudo', at(22, 10), [comment(30, 2, OTHER, at(22, 10))]);
    const items = buildTimeline({ ...base, threads: [geral, anchored], lastSeenCommentId: 10 });
    expect(items.some((i) => i.kind === 'unread')).toBe(false);
  });

  it('counts replies as comments minus one and novas as unseen replies from others', () => {
    const anchored = thread(2, 'conteudo', at(22, 10), [
      comment(20, 2, OTHER, at(22, 10)),
      comment(21, 2, OTHER, at(22, 11)),
      comment(22, 2, ME, at(22, 12)),
      comment(23, 2, OTHER, at(22, 13)),
    ]);
    const seen = buildTimeline({ ...base, threads: [anchored], lastSeenCommentId: 20 });
    const card = seen.find((i) => i.kind === 'thread');
    expect(card).toMatchObject({ replies: 3, novas: 2 });

    const nonParticipant = buildTimeline({ ...base, threads: [anchored], lastSeenCommentId: null });
    expect(nonParticipant.find((i) => i.kind === 'thread')).toMatchObject({
      replies: 3,
      novas: 0,
    });
  });

  it('shows 0 replies for a thread with a single comment', () => {
    const anchored = thread(2, 'ig_caption', at(22, 10), [comment(20, 2, OTHER, at(22, 10))]);
    const items = buildTimeline({ ...base, threads: [anchored], lastSeenCommentId: 5 });
    expect(items.find((i) => i.kind === 'thread')).toMatchObject({ replies: 0, novas: 1 });
  });

  it('collapses resolved anchored threads into one trailing item', () => {
    const geral = thread(1, 'geral', at(22, 8), [comment(10, 1, OTHER, at(22, 9))]);
    const r1 = thread(3, 'conteudo', at(21, 10), [comment(30, 3, OTHER, at(21, 10))], 'resolved');
    const r2 = thread(2, 'conteudo', at(20, 10), [comment(31, 2, OTHER, at(20, 10))], 'resolved');
    const items = buildTimeline({ ...base, threads: [r1, geral, r2], lastSeenCommentId: null });
    expect(items.map((i) => i.key)).toEqual(['day-2026-10-22', 'message-10', 'resolved']);
    const last = items[items.length - 1];
    expect(last.kind === 'resolved' && last.threads.map((t) => t.id)).toEqual([2, 3]);
  });

  it('omits the resolved item when there are none', () => {
    const anchored = thread(2, 'conteudo', at(22, 10), [comment(20, 2, OTHER, at(22, 10))]);
    const items = buildTimeline({ ...base, threads: [anchored], lastSeenCommentId: null });
    expect(items.some((i) => i.kind === 'resolved')).toBe(false);
  });

  it('shows only the resolved item when every thread is resolved', () => {
    const r = thread(3, 'conteudo', at(21, 10), [comment(30, 3, OTHER, at(21, 10))], 'resolved');
    expect(buildTimeline({ ...base, threads: [r], lastSeenCommentId: null })).toEqual([
      { kind: 'resolved', key: 'resolved', threads: [r] },
    ]);
  });
});
