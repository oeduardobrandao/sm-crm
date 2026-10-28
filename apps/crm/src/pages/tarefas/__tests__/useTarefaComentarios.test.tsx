import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TarefaComentario, TarefaWithRelations } from '@/store';

const store = vi.hoisted(() => ({
  getTarefaComentarios: vi.fn(),
  enviarTarefaComentario: vi.fn(),
  updateTarefaComentario: vi.fn(),
  deleteTarefaComentario: vi.fn(),
}));
vi.mock('@/store', () => store);

// The shared supabase mock has no emitter for a '*' listener, so capture the handler here.
const realtime = vi.hoisted(() => ({ handler: null as null | (() => void) }));
vi.mock('@/lib/supabase', () => {
  const channel = {
    on: (_type: string, _filter: unknown, cb: () => void) => {
      realtime.handler = cb;
      return channel;
    },
    subscribe: () => channel,
  };
  return { supabase: { channel: () => channel, removeChannel: vi.fn(async () => 'ok') } };
});

import { useTarefaComentarios } from '../hooks/useTarefaComentarios';

const TAREFA = 42;

function comentario(id: number): TarefaComentario {
  return {
    id,
    tarefa_id: TAREFA,
    conta_id: 'ws',
    author_id: 'user-ana',
    conteudo: `c${id}`,
    created_at: '2026-10-28T12:00:00Z',
    edited_at: null,
  } as TarefaComentario;
}

const tarefa = (id: number, comentarios_total: number) =>
  ({ id, titulo: `T${id}`, comentarios_total }) as unknown as TarefaWithRelations;

function setup(seedList = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (seedList) qc.setQueryData(['tarefas'], [tarefa(TAREFA, 1), tarefa(7, 5)]);
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useTarefaComentarios(TAREFA), { wrapper });
  return { qc, invalidate, hook };
}

const listKeyInvalidations = (invalidate: ReturnType<typeof vi.spyOn>) =>
  invalidate.mock.calls.filter(
    ([filters]) => JSON.stringify((filters as { queryKey?: unknown })?.queryKey) === '["tarefas"]',
  );

const countOf = (qc: QueryClient, id: number) =>
  qc.getQueryData<TarefaWithRelations[]>(['tarefas'])?.find((t) => t.id === id)?.comentarios_total;

describe('useTarefaComentarios', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    realtime.handler = null;
    store.getTarefaComentarios.mockResolvedValue([comentario(1)]);
  });

  it('a realtime event refetches only the thread and patches the card count', async () => {
    const { qc, invalidate, hook } = setup();
    await waitFor(() => expect(hook.result.current.comentarios).toHaveLength(1));
    expect(realtime.handler).not.toBeNull();

    store.getTarefaComentarios.mockResolvedValue([comentario(1), comentario(2)]);
    await act(async () => realtime.handler!());

    await waitFor(() => expect(countOf(qc, TAREFA)).toBe(2));
    expect(countOf(qc, 7)).toBe(5);
    expect(listKeyInvalidations(invalidate)).toHaveLength(0);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['tarefa-comentarios', TAREFA] });
  });

  it('patching the count keeps the list cache timestamp (no false freshness)', async () => {
    const { qc, hook } = setup();
    await waitFor(() => expect(hook.result.current.comentarios).toHaveLength(1));
    const before = qc.getQueryState(['tarefas'])!.dataUpdatedAt;

    store.getTarefaComentarios.mockResolvedValue([comentario(1), comentario(2), comentario(3)]);
    await act(async () => realtime.handler!());

    await waitFor(() => expect(countOf(qc, TAREFA)).toBe(3));
    expect(qc.getQueryState(['tarefas'])!.dataUpdatedAt).toBe(before);
  });

  it('never creates the tasks list cache when it is not loaded', async () => {
    const { qc, hook } = setup(false);
    await waitFor(() => expect(hook.result.current.comentarios).toHaveLength(1));
    await act(async () => realtime.handler!());
    expect(qc.getQueryData(['tarefas'])).toBeUndefined();
  });

  it('a local send still invalidates the tasks list', async () => {
    store.enviarTarefaComentario.mockResolvedValue(comentario(2));
    const { invalidate, hook } = setup();
    await waitFor(() => expect(hook.result.current.comentarios).toHaveLength(1));

    await act(() => hook.result.current.send('oi'));

    expect(listKeyInvalidations(invalidate).length).toBeGreaterThan(0);
  });
});
