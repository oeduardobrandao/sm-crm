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

describe('tarefas mention sync', () => {
  beforeEach(() => {
    mockedSupabase.__resetSupabaseMock();
    mockedSupabase.__setCurrentProfile({
      id: 'user-1',
      nome: 'Eduardo Souza',
      role: 'owner',
      conta_id: 'conta-1',
    });
  });

  it('addTarefa syncs mentions extracted from descricao against the new tarefa id', async () => {
    mockedSupabase.__queueSupabaseResult('tarefas', 'insert', {
      data: { id: 10, titulo: 'Nova tarefa', descricao: '@[Ana](membro:5) confere' },
      error: null,
    });
    mockedSupabase.__queueSupabaseRpc('sync_mentions', { data: null, error: null });

    await store.addTarefa({
      titulo: 'Nova tarefa',
      descricao: '@[Ana](membro:5) confere',
      status: 'pendente',
    });

    const call = getCalls('rpc:sync_mentions', 'rpc').at(-1)!;
    expect(call.payload).toEqual({ p_host_type: 'tarefa', p_host_id: 10, p_membro_ids: [5] });
  });

  it('addTarefa syncs an empty array when descricao is omitted', async () => {
    mockedSupabase.__queueSupabaseResult('tarefas', 'insert', {
      data: { id: 11, titulo: 'Sem descricao' },
      error: null,
    });
    mockedSupabase.__queueSupabaseRpc('sync_mentions', { data: null, error: null });

    await store.addTarefa({ titulo: 'Sem descricao', status: 'pendente' });

    const call = getCalls('rpc:sync_mentions', 'rpc').at(-1)!;
    expect(call.payload).toEqual({ p_host_type: 'tarefa', p_host_id: 11, p_membro_ids: [] });
  });

  it('updateTarefa syncs mentions when the patch includes descricao', async () => {
    mockedSupabase.__queueSupabaseResult('tarefas', 'update', {
      data: { id: 20, descricao: '@[Bia](membro:9)' },
      error: null,
    });
    mockedSupabase.__queueSupabaseRpc('sync_mentions', { data: null, error: null });

    await store.updateTarefa(20, { descricao: '@[Bia](membro:9)' });

    const call = getCalls('rpc:sync_mentions', 'rpc').at(-1)!;
    expect(call.payload).toEqual({ p_host_type: 'tarefa', p_host_id: 20, p_membro_ids: [9] });
  });

  it('updateTarefa clears mentions when descricao is written as null (removed)', async () => {
    mockedSupabase.__queueSupabaseResult('tarefas', 'update', {
      data: { id: 20, descricao: null },
      error: null,
    });
    mockedSupabase.__queueSupabaseRpc('sync_mentions', { data: null, error: null });

    await store.updateTarefa(20, { descricao: null });

    const call = getCalls('rpc:sync_mentions', 'rpc').at(-1)!;
    expect(call.payload).toEqual({ p_host_type: 'tarefa', p_host_id: 20, p_membro_ids: [] });
  });

  it('updateTarefa does not touch sync_mentions when descricao is not part of the patch', async () => {
    mockedSupabase.__queueSupabaseResult('tarefas', 'update', {
      data: { id: 20, status: 'em_andamento' },
      error: null,
    });

    await store.updateTarefa(20, { status: 'em_andamento' });

    expect(getCalls('rpc:sync_mentions', 'rpc')).toHaveLength(0);
  });

  it('updateTarefa resolves even when sync_mentions rejects', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockedSupabase.__queueSupabaseResult('tarefas', 'update', {
      data: { id: 20, descricao: '@[Bia](membro:9)' },
      error: null,
    });
    mockedSupabase.__queueSupabaseRpc('sync_mentions', {
      data: null,
      error: { message: 'boom' },
    });

    await expect(store.updateTarefa(20, { descricao: '@[Bia](membro:9)' })).resolves.toMatchObject({
      id: 20,
    });
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
