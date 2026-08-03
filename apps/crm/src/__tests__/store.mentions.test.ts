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

describe('syncMentions', () => {
  beforeEach(() => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentProfile({
      id: 'user-1',
      nome: 'Eduardo Souza',
      role: 'owner',
      conta_id: 'conta-1',
    });
  });

  it('calls sync_mentions with the host type, host id, and membro ids', async () => {
    mockedSupabase.__queueSupabaseRpc('sync_mentions', { data: null, error: null });

    await store.syncMentions('post_comment', 42, [5, 7]);

    const call = getCalls('rpc:sync_mentions', 'rpc').at(-1)!;
    expect(call.payload).toEqual({
      p_host_type: 'post_comment',
      p_host_id: 42,
      p_membro_ids: [5, 7],
    });
  });

  it('calls sync_mentions with an empty array to clear removed mentions', async () => {
    mockedSupabase.__queueSupabaseRpc('sync_mentions', { data: null, error: null });

    await store.syncMentions('tarefa', 1, []);

    const call = getCalls('rpc:sync_mentions', 'rpc').at(-1)!;
    expect(call.payload).toEqual({ p_host_type: 'tarefa', p_host_id: 1, p_membro_ids: [] });
  });

  it('never rejects when the RPC returns an error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockedSupabase.__queueSupabaseRpc('sync_mentions', {
      data: null,
      error: { message: 'host not found' },
    });

    await expect(store.syncMentions('workflow_post', 1, [1])).resolves.toBeUndefined();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
