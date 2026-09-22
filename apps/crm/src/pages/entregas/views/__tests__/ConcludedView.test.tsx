import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  getConcludedWorkflows: vi.fn(async () => []),
  getWorkflowEtapas: vi.fn(async () => []),
  getWorkflowPosts: vi.fn(async () => []),
  getClientes: vi.fn(async () => [{ id: 3, nome: 'Aurora', cor: '#000' }]),
  reopenWorkflow: vi.fn(),
  getVigentePostProcesses: vi.fn(async () => []),
  // Fase 4: usePostProcessCommands (chamado incondicionalmente pelo
  // ConcludedView) importa estes do store; o módulo precisa resolver os nomes
  // mesmo nos testes que não exercitam "Reabrir processo".
  transitionPostProcess: vi.fn(),
  removePostProcess: vi.fn(),
  updateWorkflowPost: vi.fn(),
  CLIENT_CLEARED_STATUSES: ['aprovado_cliente', 'agendado', 'postado', 'falha_publicacao'],
}));
vi.mock('../../../../store', () => store);
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('../../components/HistoryDrawer', () => ({
  HistoryDrawer: () => <div>HistoryDrawer</div>,
}));
const igAvatarsMock = vi.hoisted(() => ({
  rows: [] as { client_id: number; profile_picture_url: string }[],
}));
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({
        in: () => ({
          not: () =>
            Promise.resolve({ data: table === 'instagram_accounts' ? igAvatarsMock.rows : [] }),
        }),
      }),
    }),
  },
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

import { toast } from 'sonner';
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

const concludedWorkflow = {
  id: 42,
  cliente_id: 3,
  titulo: 'Campanha de Lançamento',
  status: 'concluido',
  created_at: '2026-09-01T12:00:00Z',
};

function renderView(onOpenPost = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ConcludedView onOpenPost={onOpenPost} />
    </QueryClientProvider>,
  );
  return { onOpenPost, qc };
}

describe('ConcludedView com processos individuais', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limitsMock.features = null;
    igAvatarsMock.rows = [];
  });

  it('flag desligada: consulta processos; sem linhas mantém a cópia vazia de sempre', async () => {
    limitsMock.features = { feature_post_processes: false };
    store.getVigentePostProcesses.mockResolvedValueOnce([] as never);
    renderView();
    expect(await screen.findByText('Nenhum fluxo concluído ainda.')).toBeInTheDocument();
    expect(store.getVigentePostProcesses).toHaveBeenCalledTimes(1);
  });

  it('flag desligada com processo concluído: a entrada "Post individual" aparece', async () => {
    limitsMock.features = { feature_post_processes: false };
    store.getVigentePostProcesses.mockResolvedValueOnce([concluded] as never);
    renderView();
    fireEvent.click(await screen.findByText('Aurora'));
    expect(screen.getByText('Post individual')).toBeInTheDocument();
  });

  it('flag ligada: lista o processo concluído no grupo do cliente com a tag e abre o post', async () => {
    limitsMock.features = { feature_post_processes: true };
    store.getVigentePostProcesses.mockResolvedValueOnce([concluded] as never);
    const { onOpenPost } = renderView();
    fireEvent.click(await screen.findByText('Aurora'));
    expect(screen.getByText('Post concluído')).toBeInTheDocument();
    expect(screen.getByText('Post individual')).toBeInTheDocument();
    expect(screen.getByText(/1 post individual/)).toBeInTheDocument();
    // Task 9: existe o botão "Reabrir processo" na linha do post individual
    // concluído.
    expect(screen.getByTitle('Reabrir processo')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Post concluído'));
    expect(onOpenPost).toHaveBeenCalledWith(77);
    // O painel do cliente fecha ao abrir o post, para não ficar atrás do
    // StandalonePostDrawer (mesmo z-index do HistoryDrawer).
    expect(screen.queryByText('Post concluído')).toBeNull();
  });

  it('clicar num fluxo concluído fecha o painel do cliente antes de abrir o histórico', async () => {
    store.getConcludedWorkflows.mockResolvedValueOnce([concludedWorkflow] as never);
    renderView();
    fireEvent.click(await screen.findByText('Aurora'));
    expect(await screen.findByText('Campanha de Lançamento')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Campanha de Lançamento'));
    expect(await screen.findByText('HistoryDrawer')).toBeInTheDocument();
    // O painel do cliente fecha ao abrir o histórico, para não ficar atrás
    // dele (mesmo z-index de sheet, HistoryDrawer usa um z-index menor).
    expect(screen.queryByText('Campanha de Lançamento')).toBeNull();
  });

  it('prioriza o avatar do Instagram sincronizado sobre o foto_url manual do cliente', async () => {
    store.getClientes.mockResolvedValueOnce([
      { id: 3, nome: 'Aurora', cor: '#000', foto_url: 'manual.jpg' },
    ] as never);
    igAvatarsMock.rows = [{ client_id: 3, profile_picture_url: 'ig.jpg' }];
    store.getConcludedWorkflows.mockResolvedValueOnce([concludedWorkflow] as never);
    renderView();
    await screen.findByText('Aurora');
    const avatar = await screen.findByTestId('cliente-avatar-foto');
    expect(avatar).toHaveAttribute('src', 'ig.jpg');
  });

  it('busca de clientes (controlada por EntregasPage via prop) filtra o grid pelo nome', async () => {
    store.getClientes.mockResolvedValueOnce([
      { id: 3, nome: 'Aurora', cor: '#000' },
      { id: 4, nome: 'Zebra Studio', cor: '#111' },
    ] as never);
    store.getConcludedWorkflows.mockResolvedValueOnce([
      concludedWorkflow,
      { ...concludedWorkflow, id: 43, cliente_id: 4, titulo: 'Outro fluxo' },
    ] as never);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <ConcludedView clientSearch="" />
      </QueryClientProvider>,
    );
    await screen.findByText('Aurora');
    expect(screen.getByText('Zebra Studio')).toBeInTheDocument();

    rerender(
      <QueryClientProvider client={qc}>
        <ConcludedView clientSearch="zebra" />
      </QueryClientProvider>,
    );
    expect(screen.queryByText('Aurora')).toBeNull();
    expect(screen.getByText('Zebra Studio')).toBeInTheDocument();
  });

  it('busca de fluxos filtra a lista dentro do painel do cliente', async () => {
    store.getConcludedWorkflows.mockResolvedValueOnce([
      concludedWorkflow,
      { ...concludedWorkflow, id: 43, titulo: 'Reels de julho' },
    ] as never);
    renderView();
    fireEvent.click(await screen.findByText('Aurora'));
    await screen.findByText('Campanha de Lançamento');
    expect(screen.getByText('Reels de julho')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Buscar fluxo...'), {
      target: { value: 'reels' },
    });
    expect(screen.queryByText('Campanha de Lançamento')).toBeNull();
    expect(screen.getByText('Reels de julho')).toBeInTheDocument();
  });

  it('flag ligada e nada concluído: cópia vazia inclui posts individuais', async () => {
    limitsMock.features = { feature_post_processes: true };
    renderView();
    expect(
      await screen.findByText('Nenhum fluxo ou post individual concluído ainda.'),
    ).toBeInTheDocument();
  });

  it('flag ligada: não mostra o vazio prematuro enquanto os processos ainda carregam', async () => {
    limitsMock.features = { feature_post_processes: true };
    // getConcludedWorkflows resolve rápido (zero fluxos), mas getVigentePostProcesses
    // fica pendente de propósito: o guard de vazio não pode renderizar antes dela
    // resolver, mesmo com summaries e concludedProcesses ambos vazios nesse meio-tempo.
    let resolveVigente: (value: unknown[]) => void = () => {};
    store.getVigentePostProcesses.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveVigente = resolve;
        }),
    );
    const { qc } = renderView();

    // Espera a query de fluxos concluídos assentar (sucesso, sem fetch em
    // voo) sem nunca resolver a de processos: é exatamente a janela em que
    // o bug aparecia (isLoading dos fluxos já false, processos ainda pendente).
    await waitFor(() => {
      const state = qc.getQueryState(['concluded-workflows']);
      expect(state?.status).toBe('success');
      expect(state?.fetchStatus).toBe('idle');
    });
    expect(screen.queryByText('Nenhum fluxo ou post individual concluído ainda.')).toBeNull();
    expect(screen.queryByText('Nenhum fluxo concluído ainda.')).toBeNull();
    expect(screen.getByText('Carregando...')).toBeInTheDocument();

    await act(async () => {
      resolveVigente([concluded]);
    });
    fireEvent.click(await screen.findByText('Aurora'));
    expect(await screen.findByText('Post individual')).toBeInTheDocument();
  });

  it('fluxo concluído existe mas o resumo (etapas/posts) ainda carrega: não mostra o vazio prematuro', async () => {
    store.getConcludedWorkflows.mockResolvedValueOnce([concludedWorkflow] as never);
    let resolveEtapas: (value: unknown[]) => void = () => {};
    store.getWorkflowEtapas.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveEtapas = resolve;
        }),
    );
    renderView();

    await waitFor(() => expect(store.getWorkflowEtapas).toHaveBeenCalled());
    expect(screen.queryByText('Nenhum fluxo concluído ainda.')).toBeNull();
    expect(screen.getByText('Carregando...')).toBeInTheDocument();

    await act(async () => {
      resolveEtapas([]);
    });
    expect(await screen.findByText('Aurora')).toBeInTheDocument();
  });

  it('Reabrir processo: confirma e chama transition_post_process com reabrir', async () => {
    store.transitionPostProcess.mockResolvedValue({
      ok: true,
      revisao: 2,
      post_status: 'postado',
      post_status_changed: false,
      steps: [],
    });
    store.getVigentePostProcesses.mockResolvedValueOnce([concluded] as never);
    renderView();
    fireEvent.click(await screen.findByText('Aurora')); // expand the client group (fixture's client name)
    fireEvent.click(await screen.findByRole('button', { name: 'Reabrir processo' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Reabrir' }));
    await waitFor(() =>
      expect(store.transitionPostProcess).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'reabrir',
          processId: concluded.id,
          expectedRevisao: concluded.revisao,
        }),
      ),
    );
  });

  it('rollback: reabrir falha com process_not_concluded → toast mapeado e nenhum sucesso', async () => {
    store.transitionPostProcess.mockRejectedValueOnce({
      message: 'process_not_concluded',
      code: 'P0001',
    });
    store.getVigentePostProcesses.mockResolvedValueOnce([concluded] as never);
    renderView();
    fireEvent.click(await screen.findByText('Aurora'));
    fireEvent.click(await screen.findByRole('button', { name: 'Reabrir processo' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Reabrir' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Só um processo concluído pode ser reaberto.'),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });
});
