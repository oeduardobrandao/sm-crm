import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  getConcludedWorkflows: vi.fn(async () => []),
  getWorkflowEtapas: vi.fn(async () => []),
  getWorkflowPosts: vi.fn(async () => []),
  getClientes: vi.fn(async () => [{ id: 3, nome: 'Aurora', cor: '#000' }]),
  reopenWorkflow: vi.fn(),
  getVigentePostProcesses: vi.fn(async () => []),
}));
vi.mock('../../../../store', () => store);
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../components/HistoryDrawer', () => ({
  HistoryDrawer: () => <div>HistoryDrawer</div>,
}));
const limitsMock = vi.hoisted(() => ({ features: null as Record<string, boolean> | null }));
vi.mock('@/hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({
    limits: null,
    features: limitsMock.features,
    planName: null,
    isLoading: false,
    isUnlimited: false,
  }),
}));

import { ConcludedView } from '../ConcludedView';

const concluded = {
  id: 9,
  conta_id: 'c',
  post_id: 77,
  template_id: 5,
  template_nome: 'Redes',
  assinatura: '',
  origem_workflow_id: null,
  origem_descricao: null,
  estado: 'concluido',
  motivo_encerramento: null,
  etapa_atual: 1,
  modo_prazo: 'padrao',
  board_position: 0,
  revisao: 2,
  created_by: null,
  created_at: '',
  updated_at: '',
  concluido_em: '2026-09-05T12:00:00Z',
  steps: [],
  post: {
    id: 77,
    workflow_id: null,
    cliente_id: 3,
    cliente_nome: 'Aurora',
    titulo: 'Post concluído',
    tipo: 'feed',
    status: 'postado',
  },
};

function renderView(onOpenPost = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ConcludedView onOpenPost={onOpenPost} />
    </QueryClientProvider>,
  );
  return onOpenPost;
}

describe('ConcludedView com processos individuais', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limitsMock.features = null;
  });

  it('flag desligada: não consulta processos e mantém a cópia vazia de sempre', async () => {
    renderView();
    expect(await screen.findByText('Nenhum fluxo concluído ainda.')).toBeInTheDocument();
    expect(store.getVigentePostProcesses).not.toHaveBeenCalled();
  });

  it('flag ligada: lista o processo concluído no grupo do cliente com a tag e abre o post', async () => {
    limitsMock.features = { feature_post_processes: true };
    store.getVigentePostProcesses.mockResolvedValueOnce([concluded] as never);
    const onOpenPost = renderView();
    fireEvent.click(await screen.findByText('Aurora'));
    expect(screen.getByText('Post concluído')).toBeInTheDocument();
    expect(screen.getByText('Post individual')).toBeInTheDocument();
    expect(screen.getByText(/1 post individual/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Post concluído'));
    expect(onOpenPost).toHaveBeenCalledWith(77);
    expect(screen.queryByTitle('Reabrir processo')).toBeNull();
  });

  it('flag ligada e nada concluído: cópia vazia inclui posts individuais', async () => {
    limitsMock.features = { feature_post_processes: true };
    renderView();
    expect(
      await screen.findByText('Nenhum fluxo ou post individual concluído ainda.'),
    ).toBeInTheDocument();
  });
});
