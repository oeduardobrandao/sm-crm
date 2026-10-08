import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase');

import * as supabaseModule from '../../lib/supabase';
import {
  addPostDestination,
  getBoardPlatforms,
  getPostTargets,
  removePostDestination,
  savePostCaption,
} from '../postTargets';

type MockedSupabaseModule = typeof supabaseModule & {
  __getSupabaseCalls: () => Array<{
    table: string;
    operation: string;
    payload?: unknown;
    selectArgs?: unknown[][];
    modifiers: Array<{ method: string; args: unknown[] }>;
  }>;
  __queueSupabaseResult: (
    table: string,
    operation: 'select' | 'insert' | 'update' | 'delete' | 'upsert',
    ...responses: Array<{ data?: unknown; error?: unknown }>
  ) => void;
  __queueSupabaseRpc: (
    name: string,
    ...responses: Array<{ data?: unknown; error?: unknown }>
  ) => void;
  __resetSupabaseMock: () => void;
};
const mocked = supabaseModule as MockedSupabaseModule;
const calls = (table: string, op?: string) =>
  mocked.__getSupabaseCalls().filter((c) => c.table === table && (!op || c.operation === op));

describe('postTargets store', () => {
  beforeEach(() => mocked.__resetSupabaseMock());

  it('getPostTargets reads one post and sorts by registry order', async () => {
    mocked.__queueSupabaseResult('post_targets', 'select', {
      data: [
        { id: 2, post_id: 9, platform: 'geral', status: 'pendente', caption: 'g' },
        { id: 1, post_id: 9, platform: 'instagram', status: 'pendente', caption: null },
      ],
      error: null,
    });
    const rows = await getPostTargets(9);
    expect(rows.map((r) => r.platform)).toEqual(['instagram', 'geral']);
    expect(calls('post_targets', 'select')[0].modifiers).toContainEqual({
      method: 'eq',
      args: ['post_id', 9],
    });
  });

  it('getBoardPlatforms reads the workflow, or the client default for an avulso', async () => {
    mocked.__queueSupabaseResult('workflows', 'select', {
      data: { plataformas: ['instagram', 'geral'] },
      error: null,
    });
    expect(await getBoardPlatforms({ workflow_id: 5, cliente_id: 7 })).toEqual([
      'instagram',
      'geral',
    ]);
    mocked.__queueSupabaseResult('clientes', 'select', {
      data: { plataformas_padrao: ['geral'] },
      error: null,
    });
    expect(await getBoardPlatforms({ workflow_id: null, cliente_id: 7 })).toEqual(['geral']);
  });

  it('getBoardPlatforms falls back to Instagram when the row is missing', async () => {
    mocked.__queueSupabaseResult('workflows', 'select', { data: null, error: null });
    expect(await getBoardPlatforms({ workflow_id: 5, cliente_id: 7 })).toEqual(['instagram']);
  });

  it('adds Geral with its caption in a single insert', async () => {
    mocked.__queueSupabaseResult('post_targets', 'insert', { data: null, error: null });
    await addPostDestination({ postId: 9, contaId: 'ws', platform: 'geral', seedCaption: 'oi' });
    expect(calls('post_targets', 'insert')[0].payload).toEqual({
      conta_id: 'ws',
      post_id: 9,
      platform: 'geral',
      caption: 'oi',
    });
    expect(calls('rpc:save_ig_caption', 'rpc')).toHaveLength(0);
  });

  it('adds Instagram, then seeds ig_caption through save_ig_caption', async () => {
    mocked.__queueSupabaseResult('post_targets', 'insert', { data: null, error: null });
    mocked.__queueSupabaseRpc('save_ig_caption', { data: null, error: null });
    await addPostDestination({ postId: 9, contaId: 'ws', platform: 'instagram', seedCaption: 'x' });
    expect(calls('post_targets', 'insert')[0].payload).toEqual({
      conta_id: 'ws',
      post_id: 9,
      platform: 'instagram',
    });
    expect(calls('rpc:save_ig_caption', 'rpc')[0].payload).toEqual({
      p_post_id: 9,
      p_caption: 'x',
      p_anchors: [],
    });
  });

  it('adds TikTok and seeds tiktok_caption; no seed means no caption write', async () => {
    mocked.__queueSupabaseResult('post_targets', 'insert', { data: null, error: null });
    mocked.__queueSupabaseResult('workflow_posts', 'update', { data: null, error: null });
    await addPostDestination({ postId: 9, contaId: 'ws', platform: 'tiktok', seedCaption: 'tt' });
    expect(calls('workflow_posts', 'update')[0].payload).toEqual({ tiktok_caption: 'tt' });

    mocked.__resetSupabaseMock();
    mocked.__queueSupabaseResult('post_targets', 'insert', { data: null, error: null });
    await addPostDestination({ postId: 9, contaId: 'ws', platform: 'tiktok', seedCaption: null });
    expect(calls('workflow_posts', 'update')).toHaveLength(0);
  });

  it('treats a duplicate destination (23505) as already added', async () => {
    mocked.__queueSupabaseResult('post_targets', 'insert', {
      data: null,
      error: { code: '23505', message: 'duplicate key' },
    });
    await expect(
      addPostDestination({ postId: 9, contaId: 'ws', platform: 'geral', seedCaption: null }),
    ).resolves.toBeUndefined();
  });

  it('removePostDestination deletes one (post, platform) row', async () => {
    mocked.__queueSupabaseResult('post_targets', 'delete', { data: null, error: null });
    await removePostDestination(9, 'tiktok');
    const del = calls('post_targets', 'delete')[0];
    expect(del.modifiers).toContainEqual({ method: 'eq', args: ['post_id', 9] });
    expect(del.modifiers).toContainEqual({ method: 'eq', args: ['platform', 'tiktok'] });
  });

  it('savePostCaption routes TikTok to workflow_posts and Geral to post_targets', async () => {
    mocked.__queueSupabaseResult('workflow_posts', 'update', { data: [{ id: 9 }], error: null });
    await savePostCaption(9, 'tiktok', 'a');
    expect(calls('workflow_posts', 'update')[0].payload).toEqual({ tiktok_caption: 'a' });

    mocked.__queueSupabaseResult('post_targets', 'update', { data: [{ id: 1 }], error: null });
    await savePostCaption(9, 'geral', 'b');
    const upd = calls('post_targets', 'update')[0];
    expect(upd.payload).toEqual({ caption: 'b' });
    expect(upd.selectArgs).toEqual([['id']]);
    expect(upd.modifiers).toContainEqual({ method: 'eq', args: ['platform', 'geral'] });
  });

  it('throws store errors so the caller can toast', async () => {
    mocked.__queueSupabaseResult('post_targets', 'update', {
      data: null,
      error: { message: 'boom' },
    });
    await expect(savePostCaption(9, 'geral', 'b')).rejects.toBeTruthy();
  });

  it('throws when the update matches no row (Geral gone, RLS deny)', async () => {
    mocked.__queueSupabaseResult('post_targets', 'update', { data: [], error: null });
    await expect(savePostCaption(9, 'geral', 'b')).rejects.toThrow();
    mocked.__queueSupabaseResult('workflow_posts', 'update', { data: [], error: null });
    await expect(savePostCaption(9, 'tiktok', 'b')).rejects.toThrow();
  });
});
