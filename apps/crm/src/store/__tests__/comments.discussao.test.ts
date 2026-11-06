import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase');

import * as supabaseModule from '../../lib/supabase';
import {
  addPostComment,
  getDiscussaoNaoLidas,
  getDiscussaoParticipacao,
  isGeralThread,
  markDiscussaoLida,
  sendDiscussaoMessage,
  setDiscussaoSeguindo,
  type CommentThread,
} from '../comments';

type MockedSupabaseModule = typeof supabaseModule & {
  __getSupabaseCalls: () => Array<{ table: string; operation: string; payload?: unknown }>;
  __queueSupabaseRpc: (
    name: string,
    ...responses: Array<{ data?: unknown; error?: unknown }>
  ) => void;
  __resetSupabaseMock: () => void;
};

const mocked = supabaseModule as MockedSupabaseModule;

function rpcCalls(name: string) {
  return mocked.__getSupabaseCalls().filter((c) => c.table === `rpc:${name}`);
}

const boom = { data: null, error: { message: 'boom' } };

describe('discussion store', () => {
  beforeEach(() => {
    mocked.__resetSupabaseMock();
  });

  describe('sendDiscussaoMessage', () => {
    it('sends to the general thread (p_thread_id null) and returns the comment', async () => {
      const comment = { id: 7, thread_id: 3, author_id: 'user-1', content: 'oi' };
      mocked.__queueSupabaseRpc('post_discussao_enviar', { data: comment, error: null });
      await expect(sendDiscussaoMessage(10, 'oi')).resolves.toEqual(comment);
      expect(rpcCalls('post_discussao_enviar').at(-1)!.payload).toEqual({
        p_post_id: 10,
        p_content: 'oi',
        p_thread_id: null,
      });
    });

    it('passes p_thread_id when replying in a passage thread', async () => {
      mocked.__queueSupabaseRpc('post_discussao_enviar', { data: { id: 8 }, error: null });
      await sendDiscussaoMessage(10, 'resp', 5);
      expect(rpcCalls('post_discussao_enviar').at(-1)!.payload).toEqual({
        p_post_id: 10,
        p_content: 'resp',
        p_thread_id: 5,
      });
    });

    it('rejects when the RPC errors', async () => {
      mocked.__queueSupabaseRpc('post_discussao_enviar', boom);
      await expect(sendDiscussaoMessage(10, 'oi')).rejects.toBeTruthy();
    });
  });

  describe('addPostComment', () => {
    it('goes through post_discussao_enviar with the thread id and never syncs mentions itself', async () => {
      mocked.__queueSupabaseRpc('post_discussao_enviar', { data: { id: 9 }, error: null });
      await addPostComment(10, 5, 'Olha @[Ana](membro:5)');
      expect(rpcCalls('post_discussao_enviar').at(-1)!.payload).toEqual({
        p_post_id: 10,
        p_content: 'Olha @[Ana](membro:5)',
        p_thread_id: 5,
      });
      expect(rpcCalls('sync_mentions')).toHaveLength(0);
    });

    it('rejects when the RPC errors', async () => {
      mocked.__queueSupabaseRpc('post_discussao_enviar', boom);
      await expect(addPostComment(10, 5, 'x')).rejects.toBeTruthy();
    });
  });

  describe('markDiscussaoLida', () => {
    it('calls post_discussao_marcar_lido', async () => {
      mocked.__queueSupabaseRpc('post_discussao_marcar_lido', { data: null, error: null });
      await markDiscussaoLida(10, 42);
      expect(rpcCalls('post_discussao_marcar_lido').at(-1)!.payload).toEqual({
        p_post_id: 10,
        p_comment_id: 42,
      });
    });

    it('rejects on RPC error', async () => {
      mocked.__queueSupabaseRpc('post_discussao_marcar_lido', boom);
      await expect(markDiscussaoLida(10, 42)).rejects.toBeTruthy();
    });
  });

  describe('setDiscussaoSeguindo', () => {
    it('calls post_discussao_seguir', async () => {
      mocked.__queueSupabaseRpc('post_discussao_seguir', { data: null, error: null });
      await setDiscussaoSeguindo(10, false);
      expect(rpcCalls('post_discussao_seguir').at(-1)!.payload).toEqual({
        p_post_id: 10,
        p_seguir: false,
      });
    });

    it('rejects on RPC error', async () => {
      mocked.__queueSupabaseRpc('post_discussao_seguir', boom);
      await expect(setDiscussaoSeguindo(10, true)).rejects.toBeTruthy();
    });
  });

  describe('getDiscussaoParticipacao', () => {
    it('maps the single returned row to camelCase', async () => {
      mocked.__queueSupabaseRpc('get_post_discussao_participacao', {
        data: [{ seguindo: true, last_seen_comment_id: 12, implicito: true }],
        error: null,
      });
      await expect(getDiscussaoParticipacao(10)).resolves.toEqual({
        seguindo: true,
        lastSeenCommentId: 12,
        implicito: true,
      });
      expect(rpcCalls('get_post_discussao_participacao').at(-1)!.payload).toEqual({
        p_post_id: 10,
      });
    });

    it('accepts a bare object and bigint-as-string ids', async () => {
      mocked.__queueSupabaseRpc('get_post_discussao_participacao', {
        data: { seguindo: false, last_seen_comment_id: '5', implicito: false },
        error: null,
      });
      await expect(getDiscussaoParticipacao(10)).resolves.toEqual({
        seguindo: false,
        lastSeenCommentId: 5,
        implicito: false,
      });
    });

    it('falls back to a not-following state when no row comes back', async () => {
      mocked.__queueSupabaseRpc('get_post_discussao_participacao', { data: [], error: null });
      await expect(getDiscussaoParticipacao(10)).resolves.toEqual({
        seguindo: false,
        lastSeenCommentId: 0,
        implicito: false,
      });
    });

    it('rejects on RPC error', async () => {
      mocked.__queueSupabaseRpc('get_post_discussao_participacao', boom);
      await expect(getDiscussaoParticipacao(10)).rejects.toBeTruthy();
    });
  });

  describe('getDiscussaoNaoLidas', () => {
    it('returns [] without calling the RPC when both lists are empty or missing', async () => {
      await expect(getDiscussaoNaoLidas({})).resolves.toEqual([]);
      await expect(getDiscussaoNaoLidas({ postIds: [], workflowIds: [] })).resolves.toEqual([]);
      expect(rpcCalls('get_post_discussao_nao_lidas')).toHaveLength(0);
    });

    it('sends the post ids and null for the absent workflow list, mapping rows', async () => {
      mocked.__queueSupabaseRpc('get_post_discussao_nao_lidas', {
        data: [
          { post_id: 10, workflow_id: 3, total: 4, nao_lidas: 2 },
          { post_id: 11, workflow_id: null, total: 1, nao_lidas: 0 },
        ],
        error: null,
      });
      await expect(getDiscussaoNaoLidas({ postIds: [10, 11] })).resolves.toEqual([
        { postId: 10, workflowId: 3, total: 4, naoLidas: 2 },
        { postId: 11, workflowId: null, total: 1, naoLidas: 0 },
      ]);
      expect(rpcCalls('get_post_discussao_nao_lidas').at(-1)!.payload).toEqual({
        p_post_ids: [10, 11],
        p_workflow_ids: null,
      });
    });

    it('sends workflow ids with a null post list', async () => {
      mocked.__queueSupabaseRpc('get_post_discussao_nao_lidas', { data: null, error: null });
      await expect(getDiscussaoNaoLidas({ workflowIds: [3] })).resolves.toEqual([]);
      expect(rpcCalls('get_post_discussao_nao_lidas').at(-1)!.payload).toEqual({
        p_post_ids: null,
        p_workflow_ids: [3],
      });
    });

    it('rejects on RPC error', async () => {
      mocked.__queueSupabaseRpc('get_post_discussao_nao_lidas', boom);
      await expect(getDiscussaoNaoLidas({ postIds: [1] })).rejects.toBeTruthy();
    });
  });

  describe('isGeralThread', () => {
    const base: CommentThread = {
      id: 1,
      post_id: 10,
      conta_id: 'c',
      quoted_text: '',
      status: 'active',
      created_by: 'u',
      resolved_by: null,
      created_at: '2026-10-22T00:00:00Z',
      resolved_at: null,
      field: 'geral',
      anchor_start: null,
      anchor_end: null,
      orphaned: false,
    };
    it('is true only for field geral', () => {
      expect(isGeralThread(base)).toBe(true);
      expect(isGeralThread({ ...base, field: 'conteudo' })).toBe(false);
      expect(isGeralThread({ ...base, field: 'ig_caption' })).toBe(false);
    });
  });
});
