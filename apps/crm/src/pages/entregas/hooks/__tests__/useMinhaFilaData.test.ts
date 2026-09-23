import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

vi.mock('../../../../lib/supabase');

const store = vi.hoisted(() => ({
  getWorkflows: vi.fn(),
  getClientes: vi.fn(),
  getMembros: vi.fn(),
  getActivePosts: vi.fn(),
  getVigentePostProcesses: vi.fn(),
  getAllActiveEtapas: vi.fn(),
}));
vi.mock('../../../../store', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...store,
}));

import { useMinhaFilaData } from '../useMinhaFilaData';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
}

const processo = {
  id: 9,
  conta_id: 'c',
  post_id: 77,
  template_id: null,
  template_nome: null,
  assinatura: '',
  origem_workflow_id: null,
  origem_descricao: null,
  estado: 'ativo',
  motivo_encerramento: null,
  etapa_atual: 0,
  modo_prazo: 'padrao',
  board_position: 0,
  revisao: 1,
  created_by: null,
  created_at: '2026-09-10T00:00:00Z',
  updated_at: '2026-09-10T00:00:00Z',
  concluido_em: null,
  steps: [
    {
      id: 1,
      conta_id: 'c',
      process_id: 9,
      ordem: 0,
      nome: 'Copy',
      tipo: 'padrao',
      responsavel_id: 7,
      prazo_dias: null,
      tipo_prazo: null,
      prazo_efetivo: null,
      estado: 'ativo',
      iniciado_em: null,
      concluido_em: null,
      interrompido_em: null,
      origem_etapa_ordem: null,
      origem_etapa_nome: null,
    },
  ],
  post: { id: 77, workflow_id: null, cliente_id: 10, titulo: 'Post X', status: 'rascunho' },
};

describe('useMinhaFilaData', () => {
  beforeEach(() => {
    for (const fn of Object.values(store)) fn.mockReset();
    store.getWorkflows.mockResolvedValue([
      { id: 1, cliente_id: 10, titulo: 'WF-1', status: 'ativo', etapa_atual: 0 },
      { id: 2, cliente_id: 10, titulo: 'WF-2', status: 'concluido', etapa_atual: 0 },
    ]);
    store.getClientes.mockResolvedValue([{ id: 10, nome: 'Cliente A' }]);
    store.getMembros.mockResolvedValue([{ id: 7, nome: 'Ana' }]);
    store.getActivePosts.mockResolvedValue([{ id: 1, workflow_id: 1, status: 'rascunho' }]);
    store.getVigentePostProcesses.mockResolvedValue([
      processo,
      { ...processo, id: 10, post_id: 78, estado: 'concluido' },
    ]);
    store.getAllActiveEtapas.mockResolvedValue([
      {
        id: 100,
        workflow_id: 1,
        ordem: 0,
        nome: 'Design',
        prazo_dias: 2,
        tipo_prazo: 'corridos',
        status: 'ativo',
        responsavel_id: 7,
      },
    ]);
  });

  it('fetches nothing while disabled and reports neither loading nor error', () => {
    const { result } = renderHook(() => useMinhaFilaData({ enabled: false }), {
      wrapper: wrapper(),
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(result.current.cards).toEqual([]);
    expect(store.getWorkflows).not.toHaveBeenCalled();
    expect(store.getActivePosts).not.toHaveBeenCalled();
  });

  it('builds cards for active workflows and entities for active processes', async () => {
    const { result } = renderHook(() => useMinhaFilaData({ enabled: true }), {
      wrapper: wrapper(),
    });
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.cards.map((c) => c.workflow.id)).toEqual([1]);
    expect(result.current.cards[0].membro?.nome).toBe('Ana');
    expect(result.current.cards[0].hubUrl).toBeUndefined();
    expect(result.current.postEntities.map((e) => e.process.post_id)).toEqual([77]);
    expect(result.current.posts).toHaveLength(1);
    expect(result.current.isError).toBe(false);
  });

  it('reports isError when any of the six queries fails', async () => {
    store.getActivePosts.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useMinhaFilaData({ enabled: true }), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
