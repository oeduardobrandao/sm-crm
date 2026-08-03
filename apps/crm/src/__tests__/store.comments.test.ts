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
  __queueSupabaseResult: (
    table: string,
    operation: 'select' | 'insert' | 'update' | 'delete' | 'upsert',
    ...responses: Array<{ data?: unknown; error?: unknown; count?: number | null }>
  ) => void;
  __queueSupabaseRpc: (
    name: string,
    ...responses: Array<{ data?: unknown; error?: unknown; count?: number | null }>
  ) => void;
  __resetSupabaseMock: () => void;
  __setCurrentProfile: (profile: Record<string, unknown> | null) => void;
};

const mockedSupabase = supabaseModule as MockedSupabaseModule;

function getCalls(table: string, operation?: string) {
  return mockedSupabase
    .__getSupabaseCalls()
    .filter((entry) => entry.table === table && (!operation || entry.operation === operation));
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
      id: 1,
      post_id: 10,
      conta_id: 'conta-1',
      quoted_text: 'sample text',
      status: 'active',
      created_by: 'user-1',
      resolved_by: null,
      created_at: '2026-04-23T00:00:00Z',
      resolved_at: null,
      post_comments: [
        {
          id: 1,
          thread_id: 1,
          author_id: 'user-1',
          content: 'Fix this',
          created_at: '2026-04-23T00:00:00Z',
          updated_at: null,
        },
      ],
    };
    mockedSupabase.__queueSupabaseResult('post_comment_threads', 'select', {
      data: [thread],
      error: null,
    });
    const result = await store.getPostCommentThreads([10]);
    expect(result).toHaveLength(1);
    expect(result[0].quoted_text).toBe('sample text');
    expect(result[0].post_comments).toHaveLength(1);
  });

  it('createCommentThread inserts thread and first comment', async () => {
    const thread = {
      id: 5,
      post_id: 10,
      conta_id: 'conta-1',
      quoted_text: 'highlighted',
      status: 'active',
      created_by: 'user-1',
      resolved_by: null,
      created_at: '2026-04-23T00:00:00Z',
      resolved_at: null,
    };
    const comment = {
      id: 1,
      thread_id: 5,
      author_id: 'user-1',
      content: 'Needs rework',
      created_at: '2026-04-23T00:00:00Z',
      updated_at: null,
    };
    mockedSupabase.__queueSupabaseResult('post_comment_threads', 'insert', {
      data: thread,
      error: null,
    });
    mockedSupabase.__queueSupabaseResult('post_comments', 'insert', { data: comment, error: null });
    const result = await store.createCommentThread(10, 'highlighted', 'Needs rework');
    expect(result.id).toBe(5);
    expect(result.post_comments).toHaveLength(1);
    expect(result.post_comments[0].content).toBe('Needs rework');
  });

  it('addPostComment inserts with author_id from profile', async () => {
    const comment = {
      id: 2,
      thread_id: 5,
      author_id: 'user-1',
      content: 'Agreed',
      created_at: '2026-04-23T00:00:00Z',
      updated_at: null,
    };
    mockedSupabase.__queueSupabaseResult('post_comments', 'insert', { data: comment, error: null });
    const result = await store.addPostComment(5, 'Agreed');
    expect(result.content).toBe('Agreed');
    const call = getCalls('post_comments', 'insert').at(-1)!;
    expect(call.payload).toMatchObject({ thread_id: 5, author_id: 'user-1' });
  });

  it('resolveCommentThread updates status', async () => {
    mockedSupabase.__queueSupabaseResult('post_comment_threads', 'update', {
      data: null,
      error: null,
    });
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

  describe('mention sync', () => {
    it('addPostComment syncs the created comment id and extracted membro ids', async () => {
      const comment = {
        id: 2,
        thread_id: 5,
        author_id: 'user-1',
        content: 'Olha isso @[Ana](membro:5)',
        created_at: '2026-04-23T00:00:00Z',
        updated_at: null,
      };
      mockedSupabase.__queueSupabaseResult('post_comments', 'insert', {
        data: comment,
        error: null,
      });
      mockedSupabase.__queueSupabaseRpc('sync_mentions', { data: null, error: null });

      await store.addPostComment(5, 'Olha isso @[Ana](membro:5)');

      const call = getCalls('rpc:sync_mentions', 'rpc').at(-1)!;
      expect(call.payload).toEqual({
        p_host_type: 'post_comment',
        p_host_id: 2,
        p_membro_ids: [5],
      });
    });

    it('addPostComment syncs an empty array when the content has no mention token', async () => {
      mockedSupabase.__queueSupabaseResult('post_comments', 'insert', {
        data: { id: 3, thread_id: 5, author_id: 'user-1', content: 'sem mencao', updated_at: null },
        error: null,
      });
      mockedSupabase.__queueSupabaseRpc('sync_mentions', { data: null, error: null });

      await store.addPostComment(5, 'sem mencao');

      const call = getCalls('rpc:sync_mentions', 'rpc').at(-1)!;
      expect(call.payload).toEqual({ p_host_type: 'post_comment', p_host_id: 3, p_membro_ids: [] });
    });

    it('addPostComment does not reject when sync_mentions fails', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      mockedSupabase.__queueSupabaseResult('post_comments', 'insert', {
        data: {
          id: 4,
          thread_id: 5,
          author_id: 'user-1',
          content: '@[Ana](membro:5)',
          updated_at: null,
        },
        error: null,
      });
      mockedSupabase.__queueSupabaseRpc('sync_mentions', {
        data: null,
        error: { message: 'boom' },
      });

      await expect(store.addPostComment(5, '@[Ana](membro:5)')).resolves.toMatchObject({ id: 4 });
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('createCommentThread syncs mentions against the created comment id, not the thread id', async () => {
      mockedSupabase.__queueSupabaseResult('post_comment_threads', 'insert', {
        data: {
          id: 5,
          post_id: 10,
          conta_id: 'conta-1',
          quoted_text: 'highlighted',
          status: 'active',
          created_by: 'user-1',
          resolved_by: null,
          created_at: '2026-04-23T00:00:00Z',
          resolved_at: null,
        },
        error: null,
      });
      mockedSupabase.__queueSupabaseResult('post_comments', 'insert', {
        data: {
          id: 99,
          thread_id: 5,
          author_id: 'user-1',
          content: '@[Ana](membro:5)',
          created_at: '2026-04-23T00:00:00Z',
          updated_at: null,
        },
        error: null,
      });
      mockedSupabase.__queueSupabaseRpc('sync_mentions', { data: null, error: null });

      await store.createCommentThread(10, 'highlighted', '@[Ana](membro:5)');

      const call = getCalls('rpc:sync_mentions', 'rpc').at(-1)!;
      expect(call.payload).toEqual({
        p_host_type: 'post_comment',
        p_host_id: 99,
        p_membro_ids: [5],
      });
    });

    it('updatePostComment syncs the updated content mentions against the comment id', async () => {
      mockedSupabase.__queueSupabaseResult('post_comments', 'update', { data: null, error: null });
      mockedSupabase.__queueSupabaseRpc('sync_mentions', { data: null, error: null });

      await store.updatePostComment(2, '@[Bia](membro:9) @[Bia](membro:9)');

      const call = getCalls('rpc:sync_mentions', 'rpc').at(-1)!;
      expect(call.payload).toEqual({
        p_host_type: 'post_comment',
        p_host_id: 2,
        p_membro_ids: [9],
      });
    });

    it('ignores non-membro tokens (post/cliente/tarefa) when syncing', async () => {
      mockedSupabase.__queueSupabaseResult('post_comments', 'insert', {
        data: { id: 6, thread_id: 5, author_id: 'user-1', content: '', updated_at: null },
        error: null,
      });
      mockedSupabase.__queueSupabaseRpc('sync_mentions', { data: null, error: null });

      await store.addPostComment(5, '@[Post](post:1:2) @[Cliente](cliente:3) @[Membro](membro:8)');

      const call = getCalls('rpc:sync_mentions', 'rpc').at(-1)!;
      expect(call.payload).toEqual({
        p_host_type: 'post_comment',
        p_host_id: 6,
        p_membro_ids: [8],
      });
    });
  });
});
