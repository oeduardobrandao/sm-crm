import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase');

import {
  __resetSupabaseMock,
  __getSupabaseCalls,
  __queueSupabaseRpc,
} from '../../lib/__mocks__/supabase';
import { clonePost } from '../posts';
import { cloneWorkflow } from '../workflows';

describe('clonePost', () => {
  beforeEach(() => __resetSupabaseMock());

  it('chama duplicate_post e devolve o id novo', async () => {
    __queueSupabaseRpc('duplicate_post', { data: 321 });
    await expect(clonePost(12, true)).resolves.toBe(321);
    const call = __getSupabaseCalls().find((c) => c.table === 'rpc:duplicate_post');
    expect(call?.payload).toEqual({ p_post_id: 12, p_to_rascunho: true });
  });

  it('propaga o erro', async () => {
    __queueSupabaseRpc('duplicate_post', {
      error: { message: 'plan_limit_exceeded:max_posts_per_workflow' },
    });
    await expect(clonePost(12, false)).rejects.toMatchObject({
      message: 'plan_limit_exceeded:max_posts_per_workflow',
    });
  });
});

describe('cloneWorkflow', () => {
  beforeEach(() => __resetSupabaseMock());

  it('chama duplicate_workflow e devolve o id novo', async () => {
    __queueSupabaseRpc('duplicate_workflow', { data: 77 });
    await expect(cloneWorkflow(5, false)).resolves.toBe(77);
    const call = __getSupabaseCalls().find((c) => c.table === 'rpc:duplicate_workflow');
    expect(call?.payload).toEqual({ p_workflow_id: 5, p_to_rascunho: false });
  });

  it('propaga o erro', async () => {
    __queueSupabaseRpc('duplicate_workflow', { error: { message: 'not_found' } });
    await expect(cloneWorkflow(5, true)).rejects.toMatchObject({ message: 'not_found' });
  });
});
