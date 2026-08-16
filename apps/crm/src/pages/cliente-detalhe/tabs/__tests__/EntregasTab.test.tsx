import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, Outlet } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/store', () => ({
  getWorkflowsByCliente: vi.fn(),
  getWorkflowEtapas: vi.fn(),
  getDeadlineInfo: vi.fn(),
  getMembros: vi.fn(),
  hasLaterApprovalEtapa: vi.fn(),
  revertEtapa: vi.fn(),
  approvePostsInternally: vi.fn(),
  sendPostsToCliente: vi.fn(),
  duplicateWorkflow: vi.fn(),
  getWorkflowPostsCounts: vi.fn(),
  getWorkflowApprovedPostsCounts: vi.fn(),
  getWorkflowClearedClientePostsCounts: vi.fn(),
  getWorkflowRevisaoInternaCounts: vi.fn(),
  getWorkflowAwaitingClientePostsCounts: vi.fn(),
  getConcludedWorkflowsByCliente: vi.fn(),
  getWorkflowPosts: vi.fn(),
  getWorkflowPostsWithProperties: vi.fn(),
  updateWorkflowPost: vi.fn(),
  getClientes: vi.fn(),
  getWorkspaceSlug: vi.fn(),
  getHubToken: vi.fn(),
  // Consumed by the real advanceEtapa.ts (not mocked — the rearm decision
  // itself is covered by advanceEtapa.test.ts / KanbanRearm.test.tsx; this
  // suite pins that EntregasTab wires it exactly the same way).
  completeEtapa: vi.fn(),
  completeEtapaWithRearm: vi.fn(),
  // Transitively required by the real WorkflowModals.tsx (EditWorkflowModal +
  // TemplatesModal share the module).
  addWorkflowTemplate: vi.fn(),
  removeWorkflowTemplate: vi.fn(),
  removeWorkflow: vi.fn(),
  updateWorkflow: vi.fn(),
  updateWorkflowEtapa: vi.fn(),
  updateWorkflowTemplate: vi.fn(),
  propagateTemplateToWorkflows: vi.fn(),
  getPropertyDefinitions: vi.fn(),
  deletePropertyDefinition: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('@/services/postMedia', () => ({
  getWorkflowCovers: vi.fn(),
}));

vi.mock('@/pages/entregas/components/PropertyDefinitionPanel', () => ({
  PropertyDefinitionPanel: () => <div>PropertyDefinitionPanel</div>,
}));

// The card itself is not under test here — only the handlers it triggers.
// Matches the mocking approach already established for this exact logic in
// views/__tests__/KanbanRearm.test.tsx.
vi.mock('@/pages/entregas/components/WorkflowCard', () => ({
  WorkflowCard: ({
    card,
    onClick,
    onEditClick,
    onPostsClick,
    onForwardClick,
    onRevertClick,
  }: {
    card: { workflow: { id: number; titulo: string }; hubUrl?: string };
    onClick?: () => void;
    onEditClick?: () => void;
    onPostsClick?: () => void;
    onForwardClick?: () => void;
    onRevertClick?: () => void;
  }) => (
    <div>
      <span>{card.workflow.titulo}</span>
      <span data-testid={`hub-url-${card.workflow.id}`}>{card.hubUrl ?? ''}</span>
      <button onClick={onClick}>open-card-{card.workflow.id}</button>
      <button onClick={onEditClick}>edit-card-{card.workflow.id}</button>
      <button onClick={onPostsClick}>posts-card-{card.workflow.id}</button>
      <button onClick={onForwardClick}>forward-card-{card.workflow.id}</button>
      {onRevertClick && <button onClick={onRevertClick}>revert-card-{card.workflow.id}</button>}
    </div>
  ),
}));

// Heavy shared component with its own large query surface (post threads,
// approvals, Instagram/TikTok connection checks...) — none of that is this
// tab's concern; only that EntregasTab opens/closes it with the right card.
vi.mock('@/pages/entregas/components/WorkflowDrawer', () => ({
  WorkflowDrawer: ({
    card,
    onClose,
  }: {
    card: { workflow: { titulo: string } };
    onClose: () => void;
  }) => (
    <div>
      <span>WorkflowDrawer open: {card.workflow.titulo}</span>
      <button onClick={onClose}>close-workflow-drawer</button>
    </div>
  ),
}));

vi.mock('@/pages/entregas/components/HistoryDrawer', () => ({
  HistoryDrawer: ({ workflow, onClose }: { workflow: { titulo: string }; onClose: () => void }) => (
    <div>
      <span>HistoryDrawer open: {workflow.titulo}</span>
      <button onClick={onClose}>close-history-drawer</button>
    </div>
  ),
}));

import {
  getWorkflowsByCliente,
  getWorkflowEtapas,
  getDeadlineInfo,
  getMembros,
  hasLaterApprovalEtapa,
  revertEtapa,
  approvePostsInternally,
  sendPostsToCliente,
  duplicateWorkflow,
  getWorkflowPostsCounts,
  getWorkflowApprovedPostsCounts,
  getWorkflowClearedClientePostsCounts,
  getWorkflowRevisaoInternaCounts,
  getWorkflowAwaitingClientePostsCounts,
  getConcludedWorkflowsByCliente,
  getWorkflowPosts,
  getWorkflowPostsWithProperties,
  getClientes,
  getWorkspaceSlug,
  getHubToken,
  completeEtapa,
  completeEtapaWithRearm,
  type Cliente,
  type Workflow,
  type WorkflowEtapa,
} from '@/store';
import { toast } from 'sonner';
import { getWorkflowCovers } from '@/services/postMedia';
import type { ClienteDetalheOutletContext } from '../../clienteTabs.model';
import EntregasTab from '../EntregasTab';

const mockedGetWorkflowsByCliente = vi.mocked(getWorkflowsByCliente);
const mockedGetWorkflowEtapas = vi.mocked(getWorkflowEtapas);
const mockedGetDeadlineInfo = vi.mocked(getDeadlineInfo);
const mockedGetMembros = vi.mocked(getMembros);
const mockedHasLaterApprovalEtapa = vi.mocked(hasLaterApprovalEtapa);
const mockedRevertEtapa = vi.mocked(revertEtapa);
const mockedApprovePostsInternally = vi.mocked(approvePostsInternally);
const mockedSendPostsToCliente = vi.mocked(sendPostsToCliente);
const mockedDuplicateWorkflow = vi.mocked(duplicateWorkflow);
const mockedGetWorkflowPostsCounts = vi.mocked(getWorkflowPostsCounts);
const mockedGetWorkflowApprovedPostsCounts = vi.mocked(getWorkflowApprovedPostsCounts);
const mockedGetWorkflowClearedClientePostsCounts = vi.mocked(getWorkflowClearedClientePostsCounts);
const mockedGetWorkflowRevisaoInternaCounts = vi.mocked(getWorkflowRevisaoInternaCounts);
const mockedGetWorkflowAwaitingClientePostsCounts = vi.mocked(
  getWorkflowAwaitingClientePostsCounts,
);
const mockedGetConcludedWorkflowsByCliente = vi.mocked(getConcludedWorkflowsByCliente);
const mockedGetWorkflowPosts = vi.mocked(getWorkflowPosts);
const mockedGetWorkflowPostsWithProperties = vi.mocked(getWorkflowPostsWithProperties);
const mockedGetClientes = vi.mocked(getClientes);
const mockedGetWorkspaceSlug = vi.mocked(getWorkspaceSlug);
const mockedGetHubToken = vi.mocked(getHubToken);
const mockedGetWorkflowCovers = vi.mocked(getWorkflowCovers);
const mockedCompleteEtapa = vi.mocked(completeEtapa);
const mockedCompleteEtapaWithRearm = vi.mocked(completeEtapaWithRearm);
const mockedToast = vi.mocked(toast);

const CLIENTE: Cliente = {
  id: 42,
  nome: 'Aurora Estética',
  sigla: 'AE',
  cor: '#ffbf30',
  plano: 'Plano Ouro',
  email: 'contato@aurora.com.br',
  telefone: '(85) 99999-0000',
  status: 'ativo',
};

const approvalEtapa: WorkflowEtapa = {
  id: 11,
  workflow_id: 1,
  ordem: 1,
  nome: 'Aprovação do texto',
  prazo_dias: 2,
  tipo_prazo: 'corridos',
  tipo: 'aprovacao_cliente',
  status: 'ativo',
};
const nextEtapa: WorkflowEtapa = {
  id: 12,
  workflow_id: 1,
  ordem: 2,
  nome: 'Design',
  prazo_dias: 2,
  tipo_prazo: 'corridos',
  tipo: 'padrao',
  status: 'pendente',
};

function workflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: 1,
    cliente_id: 42,
    titulo: 'Posts Agosto',
    status: 'ativo',
    etapa_atual: 1,
    recorrente: false,
    ...overrides,
  };
}

function OutletContextProvider({ cliente }: { cliente: Cliente }) {
  return (
    <Outlet context={{ clienteId: cliente.id!, cliente } satisfies ClienteDetalheOutletContext} />
  );
}

function renderTab(cliente: Cliente = CLIENTE) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<OutletContextProvider cliente={cliente} />}>
            <Route path="/" element={<EntregasTab />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, queryClient, invalidateSpy };
}

/** cleared/total feed the historical "allCleared" branch in handleForwardConfirm. */
function mockCounts(cleared: number) {
  mockedGetWorkflowPostsCounts.mockResolvedValue(new Map([[1, 2]]));
  mockedGetWorkflowApprovedPostsCounts.mockResolvedValue(new Map());
  mockedGetWorkflowClearedClientePostsCounts.mockResolvedValue(new Map([[1, cleared]]));
  mockedGetWorkflowRevisaoInternaCounts.mockResolvedValue(new Map());
  mockedGetWorkflowAwaitingClientePostsCounts.mockResolvedValue(new Map());
}

describe('EntregasTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetWorkflowsByCliente.mockResolvedValue([workflow()]);
    mockedGetWorkflowEtapas.mockResolvedValue([approvalEtapa, nextEtapa]);
    mockedGetDeadlineInfo.mockReturnValue({
      diasRestantes: 2,
      horasRestantes: 0,
      estourado: false,
      urgente: false,
    });
    mockedGetMembros.mockResolvedValue([]);
    mockedGetConcludedWorkflowsByCliente.mockResolvedValue([]);
    mockedGetWorkflowPosts.mockResolvedValue([]);
    mockedGetWorkflowPostsWithProperties.mockResolvedValue([]);
    mockedGetWorkflowCovers.mockResolvedValue(new Map());
    mockedGetClientes.mockResolvedValue([]);
    mockedGetWorkspaceSlug.mockResolvedValue(null);
    mockedGetHubToken.mockResolvedValue(null);
    mockCounts(0);
    mockedCompleteEtapa.mockResolvedValue({
      workflow: workflow({ status: 'ativo' }),
      etapas: [],
    });
    mockedCompleteEtapaWithRearm.mockResolvedValue({
      workflow: workflow({ status: 'ativo' }),
      etapas: [],
      rearmed: true,
      rearmFailed: false,
    });
    mockedHasLaterApprovalEtapa.mockReturnValue(true);
    mockedApprovePostsInternally.mockResolvedValue(undefined);
    mockedSendPostsToCliente.mockResolvedValue(undefined);
    mockedRevertEtapa.mockResolvedValue(undefined);
    mockedDuplicateWorkflow.mockResolvedValue(workflow());
  });

  it('shows an empty state, keeping the tab visible, when there are no active workflows', async () => {
    mockedGetWorkflowsByCliente.mockResolvedValue([]);
    renderTab();
    expect(await screen.findByText('Entregas Ativas')).toBeInTheDocument();
    expect(screen.getByText('Nenhuma entrega ativa no momento.')).toBeInTheDocument();
    expect(screen.queryByText('Posts Agosto')).not.toBeInTheDocument();
  });

  it('renders the active workflow card', async () => {
    renderTab();
    expect(await screen.findByText('Posts Agosto')).toBeInTheDocument();
  });

  describe('approval re-arm wiring (three advance paths, two rearm notifications)', () => {
    it('silent all-cleared advance uses completeEtapaWithRearm and reports the re-arm', async () => {
      mockCounts(2); // cleared === total → no approval dialog, straight advance
      renderTab();
      fireEvent.click(await screen.findByText('forward-card-1'));
      fireEvent.click(await screen.findByText('Avançar'));
      await waitFor(() => expect(mockedCompleteEtapaWithRearm).toHaveBeenCalledWith(1, 11));
      expect(mockedCompleteEtapa).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(mockedToast.info).toHaveBeenCalledWith(
          expect.stringMatching(/voltaram para rascunho/i),
        ),
      );
    });

    it('"Aprovar internamente" approves then advances with re-arm', async () => {
      renderTab(); // mockCounts(0) from beforeEach → cleared !== total → approval dialog
      fireEvent.click(await screen.findByText('forward-card-1'));
      fireEvent.click(await screen.findByText('Avançar'));
      fireEvent.click(await screen.findByText('Aprovar internamente'));
      await waitFor(() => expect(mockedApprovePostsInternally).toHaveBeenCalledWith(1));
      await waitFor(() => expect(mockedCompleteEtapaWithRearm).toHaveBeenCalledWith(1, 11));
      expect(mockedCompleteEtapa).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(mockedToast.info).toHaveBeenCalledWith(
          expect.stringMatching(/voltaram para rascunho/i),
        ),
      );
    });

    it('"Avançar etapa sem alterar posts" uses plain completeEtapa, passes rearm:false, and never notifies', async () => {
      renderTab();
      fireEvent.click(await screen.findByText('forward-card-1'));
      fireEvent.click(await screen.findByText('Avançar'));
      fireEvent.click(await screen.findByText('Avançar etapa sem alterar posts'));
      await waitFor(() => expect(mockedCompleteEtapa).toHaveBeenCalledWith(1, 11));
      expect(mockedCompleteEtapaWithRearm).not.toHaveBeenCalled();
      expect(mockedToast.info).not.toHaveBeenCalled();
    });

    it('sends to the client portal without advancing the etapa', async () => {
      renderTab();
      fireEvent.click(await screen.findByText('forward-card-1'));
      fireEvent.click(await screen.findByText('Avançar'));
      fireEvent.click(await screen.findByText('Enviar ao portal do cliente'));
      await waitFor(() => expect(mockedSendPostsToCliente).toHaveBeenCalledWith(1));
      expect(mockedCompleteEtapa).not.toHaveBeenCalled();
      expect(mockedCompleteEtapaWithRearm).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(mockedToast.success).toHaveBeenCalledWith('Posts enviados ao portal do cliente!'),
      );
    });

    it('shows the re-arm warning in the approval dialog only when another approval etapa lies ahead', async () => {
      renderTab();
      fireEvent.click(await screen.findByText('forward-card-1'));
      fireEvent.click(await screen.findByText('Avançar'));
      expect(await screen.findByText(/voltarão para rascunho/i)).toBeInTheDocument();
      expect(mockedHasLaterApprovalEtapa).toHaveBeenCalledWith([approvalEtapa, nextEtapa], 11);

      mockedHasLaterApprovalEtapa.mockReturnValue(false);
      fireEvent.click(screen.getByText('Cancelar'));
      fireEvent.click(await screen.findByText('forward-card-1'));
      fireEvent.click(await screen.findByText('Avançar'));
      expect(await screen.findByText('Aprovar internamente')).toBeInTheDocument();
      expect(screen.queryByText(/voltarão para rascunho/i)).not.toBeInTheDocument();
    });
  });

  it('reverts an etapa and refreshes the board', async () => {
    const { invalidateSpy } = renderTab();
    fireEvent.click(await screen.findByText('revert-card-1'));
    fireEvent.click(await screen.findByText('Reverter'));
    await waitFor(() => expect(mockedRevertEtapa).toHaveBeenCalledWith(1));
    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['workflowsByCliente', 42] }),
    );
    await waitFor(() => expect(mockedToast.success).toHaveBeenCalledWith('Etapa revertida!'));
  });

  it('creates a new recurring cycle when a recurring workflow concludes', async () => {
    mockCounts(2); // silent advance path
    mockedCompleteEtapaWithRearm.mockResolvedValue({
      workflow: workflow({ status: 'concluido', recorrente: true }),
      etapas: [],
      rearmed: false,
      rearmFailed: false,
    });
    mockedGetWorkflowsByCliente.mockResolvedValue([workflow({ recorrente: true })]);
    renderTab();
    fireEvent.click(await screen.findByText('forward-card-1'));
    fireEvent.click(await screen.findByText('Avançar'));
    fireEvent.click(await screen.findByText('Criar Novo Ciclo'));
    await waitFor(() => expect(mockedDuplicateWorkflow).toHaveBeenCalledWith(1));
    await waitFor(() => expect(mockedToast.success).toHaveBeenCalledWith('Novo ciclo criado!'));
  });

  it('opens and closes the history drawer for a concluded workflow', async () => {
    const concluded = workflow({ id: 2, status: 'concluido', titulo: 'Ciclo Julho' });
    mockedGetConcludedWorkflowsByCliente.mockResolvedValue([concluded]);
    mockedGetWorkflowEtapas.mockImplementation(async (id: number) =>
      id === 1 ? [approvalEtapa, nextEtapa] : [],
    );
    mockedGetWorkflowPosts.mockResolvedValue([]);
    renderTab();

    fireEvent.click(await screen.findByText('Ciclo Julho'));
    expect(await screen.findByText('HistoryDrawer open: Ciclo Julho')).toBeInTheDocument();

    fireEvent.click(screen.getByText('close-history-drawer'));
    await waitFor(() =>
      expect(screen.queryByText('HistoryDrawer open: Ciclo Julho')).not.toBeInTheDocument(),
    );
  });

  it('opens and closes the workflow drawer from the card', async () => {
    renderTab();
    fireEvent.click(await screen.findByText('open-card-1'));
    expect(await screen.findByText('WorkflowDrawer open: Posts Agosto')).toBeInTheDocument();
    fireEvent.click(screen.getByText('close-workflow-drawer'));
    await waitFor(() =>
      expect(screen.queryByText('WorkflowDrawer open: Posts Agosto')).not.toBeInTheDocument(),
    );
  });

  describe('query isolation', () => {
    it('declares only Entregas/workflow-domain query keys, plus the narrow hub-url exception — nothing else from Instagram, Hub, or Financeiro', async () => {
      // `clientes` is included here even though EditWorkflowModal isn't open:
      // React Query registers a cache entry for every declared `useQuery` call
      // as soon as it mounts, `enabled: false` or not — it just never fetches.
      // The companion test below asserts the actual fetch stays lazy.
      // `workspace-slug`/`hub-token` are the one deliberate exception (see
      // EntregasTab.tsx's module doc): they exist only to compute
      // BoardCard.hubUrl, not to pull any Hub-domain content.
      const { queryClient } = renderTab();
      await screen.findByText('Posts Agosto');

      await waitFor(() => {
        const keys = new Set(
          queryClient
            .getQueryCache()
            .getAll()
            .map((q) => q.queryKey[0]),
        );
        expect(keys).toEqual(
          new Set([
            'workflowsByCliente',
            'membros',
            'concluded-by-cliente',
            'concluded-summaries-cliente',
            'clientes',
            'workflow-posts-counts',
            'workflow-approved-posts-counts',
            'workflow-cleared-cliente-counts',
            'workflow-revisao-interna-counts',
            'workflow-awaiting-cliente-counts',
            'workflow-covers',
            'workspace-slug',
            'hub-token',
          ]),
        );
      });
    });

    it('only fetches the full client portfolio once the edit-workflow modal opens', async () => {
      renderTab();
      await screen.findByText('Posts Agosto');
      const { getClientes } = await import('@/store');
      expect(vi.mocked(getClientes)).not.toHaveBeenCalled();

      fireEvent.click(screen.getByText('edit-card-1'));
      await waitFor(() => expect(vi.mocked(getClientes)).toHaveBeenCalled());
    });
  });

  describe('hubUrl', () => {
    it('populates BoardCard.hubUrl from the active hub token and workspace slug', async () => {
      mockedGetWorkspaceSlug.mockResolvedValue('aurora-estetica');
      mockedGetHubToken.mockResolvedValue({
        id: 'tok-1',
        token: 'abc123',
        is_active: true,
        expires_at: '2099-01-01T00:00:00Z',
      });
      renderTab();
      await screen.findByText('Posts Agosto');
      await waitFor(() =>
        expect(screen.getByTestId('hub-url-1')).toHaveTextContent(
          `${window.location.origin}/aurora-estetica/hub/abc123`,
        ),
      );
    });

    it('leaves BoardCard.hubUrl undefined when there is no active hub token', async () => {
      mockedGetWorkspaceSlug.mockResolvedValue('aurora-estetica');
      mockedGetHubToken.mockResolvedValue(null);
      renderTab();
      await screen.findByText('Posts Agosto');
      await waitFor(() => expect(screen.getByTestId('hub-url-1')).toHaveTextContent(''));
    });

    it('leaves BoardCard.hubUrl undefined when the workspace has no slug', async () => {
      mockedGetWorkspaceSlug.mockResolvedValue(null);
      mockedGetHubToken.mockResolvedValue({
        id: 'tok-1',
        token: 'abc123',
        is_active: true,
        expires_at: '2099-01-01T00:00:00Z',
      });
      renderTab();
      await screen.findByText('Posts Agosto');
      await waitFor(() => expect(screen.getByTestId('hub-url-1')).toHaveTextContent(''));
    });

    it('leaves BoardCard.hubUrl undefined when the hub token is inactive', async () => {
      mockedGetWorkspaceSlug.mockResolvedValue('aurora-estetica');
      mockedGetHubToken.mockResolvedValue({
        id: 'tok-1',
        token: 'abc123',
        is_active: false,
        expires_at: '2099-01-01T00:00:00Z',
      });
      renderTab();
      await screen.findByText('Posts Agosto');
      await waitFor(() => expect(screen.getByTestId('hub-url-1')).toHaveTextContent(''));
    });
  });
});
