import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase');

import * as supabaseModule from '../lib/supabase';
import * as store from '../store';

type MockedSupabaseModule = typeof supabaseModule & {
  __getSupabaseCalls: () => Array<{
    table: string;
    operation: string;
    payload?: unknown;
    modifiers: Array<{ method: string; args: unknown[] }>;
  }>;
  __queueSupabaseResult: (table: string, operation: 'select' | 'insert' | 'update' | 'delete' | 'upsert', ...responses: Array<{ data?: unknown; error?: unknown; count?: number | null }>) => void;
  __resetSupabaseMock: () => void;
  __setCurrentProfile: (profile: Record<string, unknown> | null) => void;
};

const mockedSupabase = supabaseModule as MockedSupabaseModule;

function getCalls(table: string, operation?: string) {
  return mockedSupabase.__getSupabaseCalls().filter((entry) => entry.table === table && (!operation || entry.operation === operation));
}

describe('comment thread store', () => {
  beforeEach(() => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentProfile({
      id: 'user-1',
      nome: 'Eduardo',
      role: 'owner',
      conta_id: 'conta-1',
    });
  });

  it('getPostCommentThreads returns empty for empty postIds', async () => {
    const result = await store.getPostCommentThreads([]);
    expect(result).toEqual([]);
  });

  it('getPostCommentThreads fetches threads with comments', async () => {
    const thread = {
      id: 1, post_id: 10, conta_id: 'conta-1', quoted_text: 'sample text',
      status: 'active', created_by: 'user-1', resolved_by: null,
      created_at: '2026-04-23T00:00:00Z', resolved_at: null,
      post_comments: [
        { id: 1, thread_id: 1, author_id: 'user-1', content: 'Fix this', created_at: '2026-04-23T00:00:00Z', updated_at: null },
      ],
    };
    mockedSupabase.__queueSupabaseResult('post_comment_threads', 'select', { data: [thread], error: null });
    const result = await store.getPostCommentThreads([10]);
    expect(result).toHaveLength(1);
    expect(result[0].quoted_text).toBe('sample text');
    expect(result[0].post_comments).toHaveLength(1);
  });

  it('createCommentThread inserts thread and first comment', async () => {
    const thread = { id: 5, post_id: 10, conta_id: 'conta-1', quoted_text: 'highlighted', status: 'active', created_by: 'user-1', resolved_by: null, created_at: '2026-04-23T00:00:00Z', resolved_at: null };
    const comment = { id: 1, thread_id: 5, author_id: 'user-1', content: 'Needs rework', created_at: '2026-04-23T00:00:00Z', updated_at: null };
    mockedSupabase.__queueSupabaseResult('post_comment_threads', 'insert', { data: thread, error: null });
    mockedSupabase.__queueSupabaseResult('post_comments', 'insert', { data: comment, error: null });
    const result = await store.createCommentThread(10, 'highlighted', 'Needs rework');
    expect(result.id).toBe(5);
    expect(result.post_comments).toHaveLength(1);
    expect(result.post_comments[0].content).toBe('Needs rework');
  });

  it('addPostComment inserts with author_id from profile', async () => {
    const comment = { id: 2, thread_id: 5, author_id: 'user-1', content: 'Agreed', created_at: '2026-04-23T00:00:00Z', updated_at: null };
    mockedSupabase.__queueSupabaseResult('post_comments', 'insert', { data: comment, error: null });
    const result = await store.addPostComment(5, 'Agreed');
    expect(result.content).toBe('Agreed');
    const call = getCalls('post_comments', 'insert').at(-1)!;
    expect(call.payload).toMatchObject({ thread_id: 5, author_id: 'user-1' });
  });

  it('resolveCommentThread updates status', async () => {
    mockedSupabase.__queueSupabaseResult('post_comment_threads', 'update', { data: null, error: null });
    await store.resolveCommentThread(5);
    const call = getCalls('post_comment_threads', 'update').at(-1)!;
    expect(call.payload).toMatchObject({ status: 'resolved', resolved_by: 'user-1' });
  });

  it('deletePostComment calls delete', async () => {
    mockedSupabase.__queueSupabaseResult('post_comments', 'delete', { data: null, error: null });
    await store.deletePostComment(2);
    const call = getCalls('post_comments', 'delete').at(-1)!;
    expect(call.modifiers).toContainEqual({ method: 'eq', args: ['id', 2] });
  });
});
