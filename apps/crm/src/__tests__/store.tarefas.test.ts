import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase');

import * as supabaseModule from '../lib/supabase';
import * as store from '../store';

type MockedSupabaseModule = typeof supabaseModule & {
  __getSupabaseCalls: () => Array<{
    table: string;
    operation: string;
    payload?: unknown;
    selectArgs: unknown[][];
    modifiers: Array<{ method: string; args: unknown[] }>;
  }>;
  __queueSupabaseResult: (
    table: string,
    operation: 'select' | 'insert' | 'update' | 'delete' | 'upsert',
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

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    titulo: 'Tarefa',
    status: 'pendente',
    clientes: null,
    tarefa_tag_links: [],
    subtarefas: [],
    tarefa_series: null,
    ...overrides,
  };
}

describe('getTarefas', () => {
  beforeEach(() => {
    mockedSupabase.__resetSupabaseMock();
  });

  it('getTarefas maps tarefa_comentarios(count) to comentarios_total (0 when absent)', async () => {
    mockedSupabase.__queueSupabaseResult('tarefas', 'select', {
      data: [
        row({ id: 1, tarefa_comentarios: [{ count: 3 }] }),
        row({ id: 2, tarefa_comentarios: [] }),
        row({ id: 3 }),
      ],
      error: null,
    });

    const tarefas = await store.getTarefas();

    expect(tarefas.map((t) => t.comentarios_total)).toEqual([3, 0, 0]);
    // The embedded relation does not leak into the mapped object.
    expect(tarefas[0]).not.toHaveProperty('tarefa_comentarios');
    const select = getCalls('tarefas', 'select').at(-1)!;
    expect(String(select.selectArgs[0][0])).toContain('tarefa_comentarios(count)');
  });
});

describe('setTarefaTags', () => {
  beforeEach(() => {
    mockedSupabase.__resetSupabaseMock();
  });

  it('setTarefaTags deletes only removed and inserts only added', async () => {
    mockedSupabase.__queueSupabaseResult('tarefa_tag_links', 'select', {
      data: [{ tag_id: 1 }, { tag_id: 2 }],
      error: null,
    });

    await store.setTarefaTags(42, [2, 3]);

    const select = getCalls('tarefa_tag_links', 'select').at(-1)!;
    expect(select.modifiers).toContainEqual({ method: 'eq', args: ['tarefa_id', 42] });

    const deletes = getCalls('tarefa_tag_links', 'delete');
    expect(deletes).toHaveLength(1);
    expect(deletes[0].modifiers).toContainEqual({ method: 'eq', args: ['tarefa_id', 42] });
    expect(deletes[0].modifiers).toContainEqual({ method: 'in', args: ['tag_id', [1]] });

    const inserts = getCalls('tarefa_tag_links', 'insert');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].payload).toEqual([{ tarefa_id: 42, tag_id: 3, conta_id: 'conta-1' }]);
  });

  it('setTarefaTags with an identical set writes nothing', async () => {
    mockedSupabase.__queueSupabaseResult('tarefa_tag_links', 'select', {
      data: [{ tag_id: 2 }, { tag_id: 1 }],
      error: null,
    });

    await store.setTarefaTags(42, [1, 2]);

    const calls = getCalls('tarefa_tag_links');
    expect(calls.map((c) => c.operation)).toEqual(['select']);
  });

  it('setTarefaTags only deletes when every tag is removed', async () => {
    mockedSupabase.__queueSupabaseResult('tarefa_tag_links', 'select', {
      data: [{ tag_id: 4 }],
      error: null,
    });

    await store.setTarefaTags(42, []);

    expect(getCalls('tarefa_tag_links', 'insert')).toHaveLength(0);
    const deletes = getCalls('tarefa_tag_links', 'delete');
    expect(deletes).toHaveLength(1);
    expect(deletes[0].modifiers).toContainEqual({ method: 'in', args: ['tag_id', [4]] });
  });

  it('setTarefaTags throws when reading the current links fails', async () => {
    mockedSupabase.__queueSupabaseResult('tarefa_tag_links', 'select', {
      data: null,
      error: { message: 'boom' },
    });
    await expect(store.setTarefaTags(42, [1])).rejects.toMatchObject({ message: 'boom' });
    expect(getCalls('tarefa_tag_links', 'insert')).toHaveLength(0);
  });
});
