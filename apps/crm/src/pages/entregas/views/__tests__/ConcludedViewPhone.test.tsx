import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  getConcludedWorkflows: vi.fn(async () => []),
  // One bulk call per list (never per workflow); the summary math is covered
  // in store.workflows.test.ts.
  getConcludedWorkflowSummaries: vi.fn(async (wfs: Array<Record<string, unknown>>) =>
    wfs.map((w) => ({ workflow: w, postCount: 0, totalDays: null, completedAt: null })),
  ),
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

// jsdom's matchMedia reports false, so useIsDesktop() is false: the phone branch.

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

function renderView(props: Partial<React.ComponentProps<typeof ConcludedView>> = {}): {
  onOpenPost: ReturnType<typeof vi.fn>;
  rerender: (p: typeof props) => void;
} {
  const onOpenPost = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (p: typeof props) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ConcludedView onOpenPost={onOpenPost} {...p} />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const utils = render(tree(props));
  return { onOpenPost, rerender: (p) => utils.rerender(tree(p)) };
}

describe('ConcludedView (phone)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limitsMock.features = null;
    igAvatarsMock.rows = [];
  });

  it('moves the client search into the view and filters by the controlled value', async () => {
    store.getClientes.mockResolvedValueOnce([
      { id: 3, nome: 'Aurora', cor: '#000' },
      { id: 4, nome: 'Zebra Studio', cor: '#111' },
    ] as never);
    store.getConcludedWorkflows.mockResolvedValueOnce([
      concludedWorkflow,
      { ...concludedWorkflow, id: 43, cliente_id: 4, titulo: 'Outro fluxo' },
    ] as never);
    const onClientSearchChange = vi.fn();
    const { rerender } = renderView({ clientSearch: '', onClientSearchChange });
    await screen.findByText('Aurora');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar cliente' }), {
      target: { value: 'zeb' },
    });
    expect(onClientSearchChange).toHaveBeenCalledWith('zeb');

    rerender({ clientSearch: 'zeb', onClientSearchChange });
    expect(screen.queryByText('Aurora')).toBeNull();
    expect(screen.getByText('Zebra Studio')).toBeInTheDocument();

    rerender({ clientSearch: 'nada', onClientSearchChange });
    expect(screen.getByText('Nenhum cliente encontrado para "nada".')).toBeInTheDocument();
  });

  it('hides the search field when the page does not pass onClientSearchChange', async () => {
    store.getConcludedWorkflows.mockResolvedValueOnce([concludedWorkflow] as never);
    renderView();
    await screen.findByText('Aurora');
    expect(screen.queryByRole('searchbox', { name: 'Buscar cliente' })).toBeNull();
  });

  it('client → sheet with fluxo search → workflow history (sheet closed first)', async () => {
    store.getConcludedWorkflows.mockResolvedValueOnce([
      concludedWorkflow,
      { ...concludedWorkflow, id: 43, titulo: 'Reels de julho' },
    ] as never);
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: /Aurora/ }));
    const sheet = screen.getByRole('dialog', { name: 'Aurora' });
    expect(within(sheet).getByText('Campanha de Lançamento')).toBeInTheDocument();
    fireEvent.change(within(sheet).getByRole('searchbox', { name: 'Buscar fluxo...' }), {
      target: { value: 'reels' },
    });
    expect(within(sheet).queryByText('Campanha de Lançamento')).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: /Reels de julho/ }));
    expect(screen.queryByRole('dialog', { name: 'Aurora' })).toBeNull();
    expect(screen.getByText('HistoryDrawer')).toBeInTheDocument();
  });

  it('Reabrir a fluxo keeps its confirmation, as an action sheet', async () => {
    store.getConcludedWorkflows.mockResolvedValueOnce([concludedWorkflow] as never);
    store.reopenWorkflow.mockResolvedValueOnce(undefined as never);
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: /Aurora/ }));
    const sheet = screen.getByRole('dialog', { name: 'Aurora' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Reabrir' }));
    const confirm = screen.getByRole('dialog', { name: 'Reabrir fluxo?' });
    expect(confirm).toHaveTextContent('"Campanha de Lançamento" será reaberto');
    expect(store.reopenWorkflow).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole('button', { name: 'Reabrir' }));
    await waitFor(() => expect(store.reopenWorkflow).toHaveBeenCalledWith(42));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Fluxo reaberto com sucesso!'));
  });

  it('opens a concluded post individual via onOpenPost and reopens its process', async () => {
    limitsMock.features = { feature_post_processes: true };
    store.transitionPostProcess.mockResolvedValue({
      ok: true,
      revisao: 2,
      post_status: 'postado',
      post_status_changed: false,
      steps: [],
    });
    store.getVigentePostProcesses.mockResolvedValue([concluded] as never);
    const { onOpenPost } = renderView();
    fireEvent.click(await screen.findByRole('button', { name: /Aurora/ }));
    let sheet = screen.getByRole('dialog', { name: 'Aurora' });
    expect(within(sheet).getByText(/Post individual · Redes/)).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Reabrir' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Reabrir' }));
    await waitFor(() =>
      expect(store.transitionPostProcess).toHaveBeenCalledWith(
        expect.objectContaining({ command: 'reabrir', processId: concluded.id }),
      ),
    );

    sheet = screen.getByRole('dialog', { name: 'Aurora' });
    fireEvent.click(within(sheet).getByRole('button', { name: /Post concluído/ }));
    expect(onOpenPost).toHaveBeenCalledWith(77);
    expect(screen.queryByRole('dialog', { name: 'Aurora' })).toBeNull();
    store.getVigentePostProcesses.mockImplementation(async () => []);
  });
});
