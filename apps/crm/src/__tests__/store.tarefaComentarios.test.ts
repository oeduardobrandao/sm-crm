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
};

const mockedSupabase = supabaseModule as MockedSupabaseModule;

function getCalls(table: string, operation?: string) {
  return mockedSupabase
    .__getSupabaseCalls()
    .filter((entry) => entry.table === table && (!operation || entry.operation === operation));
}

const ROW = {
  id: 7,
  conta_id: 'conta-1',
  tarefa_id: 42,
  author_id: 'user-1',
  conteudo: 'Oi @[Ana](membro:5)',
  created_at: '2026-10-28T12:00:00Z',
  edited_at: null,
};

describe('tarefa comentarios store', () => {
  beforeEach(() => {
    mockedSupabase.__resetSupabaseMock();
  });

  it('exposes the 4000-char cap', () => {
    expect(store.TAREFA_COMENTARIO_MAX_CHARS).toBe(4000);
  });

  it('enviar calls rpc with p_tarefa_id/p_conteudo', async () => {
    mockedSupabase.__queueSupabaseRpc('tarefa_comentario_enviar', { data: ROW, error: null });

    const result = await store.enviarTarefaComentario(42, 'Oi @[Ana](membro:5)');

    const call = getCalls('rpc:tarefa_comentario_enviar', 'rpc').at(-1)!;
    expect(call.payload).toEqual({ p_tarefa_id: 42, p_conteudo: 'Oi @[Ana](membro:5)' });
    expect(result).toEqual(ROW);
    // Mentions are parsed server-side by the RPC: the client does not sync them on send.
    expect(getCalls('rpc:sync_mentions', 'rpc')).toHaveLength(0);
  });

  it('enviar throws when the rpc fails', async () => {
    mockedSupabase.__queueSupabaseRpc('tarefa_comentario_enviar', {
      data: null,
      error: { message: 'boom' },
    });
    await expect(store.enviarTarefaComentario(42, 'x')).rejects.toMatchObject({ message: 'boom' });
  });

  it('update syncs mentions with parsed ids', async () => {
    mockedSupabase.__queueSupabaseResult('tarefa_comentarios', 'update', {
      data: null,
      error: null,
    });
    mockedSupabase.__queueSupabaseRpc('sync_mentions', { data: null, error: null });

    await store.updateTarefaComentario(7, 'Agora @[Bia](membro:9) e @[Ana](membro:5)');

    const update = getCalls('tarefa_comentarios', 'update').at(-1)!;
    expect(update.payload).toEqual({ conteudo: 'Agora @[Bia](membro:9) e @[Ana](membro:5)' });
    expect(update.modifiers).toContainEqual({ method: 'eq', args: ['id', 7] });
    const sync = getCalls('rpc:sync_mentions', 'rpc').at(-1)!;
    expect(sync.payload).toEqual({
      p_host_type: 'tarefa_comentario',
      p_host_id: 7,
      p_membro_ids: [9, 5],
    });
  });

  it('update with no mentions syncs []', async () => {
    mockedSupabase.__queueSupabaseResult('tarefa_comentarios', 'update', {
      data: null,
      error: null,
    });
    mockedSupabase.__queueSupabaseRpc('sync_mentions', { data: null, error: null });

    await store.updateTarefaComentario(7, 'sem menção');

    const sync = getCalls('rpc:sync_mentions', 'rpc').at(-1)!;
    expect(sync.payload).toEqual({
      p_host_type: 'tarefa_comentario',
      p_host_id: 7,
      p_membro_ids: [],
    });
  });

  it('update does not sync mentions when the update fails', async () => {
    mockedSupabase.__queueSupabaseResult('tarefa_comentarios', 'update', {
      data: null,
      error: { message: 'denied' },
    });
    await expect(store.updateTarefaComentario(7, 'x')).rejects.toMatchObject({
      message: 'denied',
    });
    expect(getCalls('rpc:sync_mentions', 'rpc')).toHaveLength(0);
  });

  it('delete removes the row by id', async () => {
    mockedSupabase.__queueSupabaseResult('tarefa_comentarios', 'delete', {
      data: null,
      error: null,
    });
    await store.deleteTarefaComentario(7);
    const call = getCalls('tarefa_comentarios', 'delete').at(-1)!;
    expect(call.modifiers).toContainEqual({ method: 'eq', args: ['id', 7] });
  });

  it('getTarefaComentarios filters by task, oldest first', async () => {
    mockedSupabase.__queueSupabaseResult('tarefa_comentarios', 'select', {
      data: [ROW],
      error: null,
    });
    const rows = await store.getTarefaComentarios(42);
    expect(rows).toEqual([ROW]);
    const call = getCalls('tarefa_comentarios', 'select').at(-1)!;
    expect(call.modifiers).toContainEqual({ method: 'eq', args: ['tarefa_id', 42] });
    expect(call.modifiers).toContainEqual({
      method: 'order',
      args: ['created_at', { ascending: true }],
    });
  });

  it('getTarefaEventos filters by task, newest first', async () => {
    const evento = {
      id: 1,
      tarefa_id: 42,
      tipo: 'status',
      actor_user_id: null,
      actor_nome: null,
      de: 'pendente',
      para: 'concluida',
      txid: 99,
      created_at: '2026-10-28T12:00:00Z',
    };
    mockedSupabase.__queueSupabaseResult('tarefa_eventos', 'select', {
      data: [evento],
      error: null,
    });
    const rows = await store.getTarefaEventos(42);
    expect(rows).toEqual([evento]);
    const call = getCalls('tarefa_eventos', 'select').at(-1)!;
    expect(call.modifiers).toContainEqual({ method: 'eq', args: ['tarefa_id', 42] });
    expect(call.modifiers).toContainEqual({
      method: 'order',
      args: ['created_at', { ascending: false }],
    });
  });
});
