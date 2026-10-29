import type React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, Outlet } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Desktop layout by default; the "no celular" describe flips it (jsdom's matchMedia is
// false, so without a mock this suite would render the phone branch).
const { desktop } = vi.hoisted(() => ({ desktop: { value: true } }));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => desktop.value }));

vi.mock('@/store', () => ({
  getWorkflowsByCliente: vi.fn(),
  getWorkflowEtapas: vi.fn(),
  getWorkflowEtapasByWorkflowIds: vi.fn(),
  getConcludedWorkflowSummaries: vi.fn(),
  getDeadlineInfo: vi.fn(),
  getMembros: vi.fn(),
  hasLaterApprovalEtapa: vi.fn(),
  revertEtapa: vi.fn(),
  sendPostsToCliente: vi.fn(),
  duplicateWorkflow: vi.fn(),
  getWorkflowPostStats: vi.fn(),
  getConcludedWorkflowsByCliente: vi.fn(),
  getWorkflowPosts: vi.fn(),
  getClientePosts: vi.fn(),
  updateWorkflowPost: vi.fn(),
  getClientes: vi.fn(),
  getWorkspaceSlug: vi.fn(),
  getHubToken: vi.fn(),
  getWorkflowTemplates: vi.fn(),
  getVigentePostProcessesByCliente: vi.fn(),
  // Consumed by the real usePostProcessCommands (not mocked — same rationale
  // as the fluxo stage chain below: this suite pins that the
  // individual-post forward/revert buttons wire to the same commands the
  // Fluxos board uses).
  transitionPostProcess: vi.fn(),
  removePostProcess: vi.fn(),
  sendPostToCliente: vi.fn(),
  CLIENT_CLEARED_STATUSES: ['aprovado_cliente', 'agendado', 'postado', 'falha_publicacao'],
  // Consumed by the real useWorkflowStageCommands (not mocked — the dialog
  // logic itself is covered by KanbanApprovalExit.test.tsx; this suite pins
  // that EntregasTab wires the same chain).
  completeEtapa: vi.fn(),
  advanceWorkflowFromApproval: vi.fn(),
  getWorkflowPostStatusCounts: vi.fn(),
  // Transitively required by the real WorkflowModals.tsx (EditWorkflowModal +
  // TemplatesModal share the module).
  addWorkflowTemplate: vi.fn(),
  removeWorkflowTemplate: vi.fn(),
  removeWorkflow: vi.fn(),
  updateWorkflow: vi.fn(),
  updateWorkflowEtapa: vi.fn(),
  getPropertyDefinitions: vi.fn(),
  deletePropertyDefinition: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// The suggestion move guard reads this by path (not through the '@/store' barrel).
vi.mock('@/store/posts', () => ({ hasPendingEditSuggestion: vi.fn(async () => false) }));

// Mutable so a describe block can flip a feature on for its own tests; every
// other test keeps the flags off (default null), same mutable-features pattern
// as WorkflowDrawer.test.tsx.
let mockFeatures: Record<string, boolean> | null = null;
vi.mock('@/hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({
    limits: null,
    get features() {
      return mockFeatures;
    },
    planName: null,
    isLoading: false,
    isUnlimited: true,
  }),
}));

vi.mock('@/services/postMedia', () => ({
  getWorkflowCovers: vi.fn(),
  getPostCovers: vi.fn(),
}));

vi.mock('@/pages/entregas/components/PropertyDefinitionPanel', () => ({
  PropertyDefinitionPanel: () => <div>PropertyDefinitionPanel</div>,
}));

// The card itself is not under test here — only the handlers it triggers.
// Same stub approach as the Kanban suites in views/__tests__/.
vi.mock('@/pages/entregas/components/WorkflowCard', () => ({
  WorkflowCard: ({
    card,
    onClick,
    onEditClick,
    onPostsClick,
    onForwardClick,
    onRevertClick,
    postsCount,
    clearedClienteCount,
  }: {
    card: { workflow: { id: number; titulo: string }; hubUrl?: string };
    onClick?: () => void;
    onEditClick?: () => void;
    onPostsClick?: () => void;
    onForwardClick?: () => void;
    onRevertClick?: () => void;
    postsCount?: number;
    clearedClienteCount?: number;
  }) => (
    <div>
      <span>{card.workflow.titulo}</span>
      <span data-testid={`hub-url-${card.workflow.id}`}>{card.hubUrl ?? ''}</span>
      {/* Renders the two counts handleForwardConfirm branches on, so tests can
          wait for them instead of racing the queries that supply them. */}
      <span data-testid={`counts-${card.workflow.id}`}>
        {postsCount ?? 0}/{clearedClienteCount ?? 0}
      </span>
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

// Individual posts (post_processes) card/drawer — same "not under test here"
// rationale as WorkflowCard/WorkflowDrawer above.
vi.mock('@/pages/entregas/components/PostProcessCard', () => ({
  PostProcessCard: ({
    entity,
    onClick,
    onForwardClick,
    onRevertClick,
  }: {
    entity: { id: string; titulo: string };
    onClick?: () => void;
    onForwardClick?: () => void;
    onRevertClick?: () => void;
  }) => (
    <div>
      <span>{entity.titulo}</span>
      <button onClick={onClick}>open-post-{entity.id}</button>
      <button onClick={onForwardClick}>forward-post-{entity.id}</button>
      {onRevertClick && <button onClick={onRevertClick}>revert-post-{entity.id}</button>}
    </div>
  ),
}));

vi.mock('@/pages/entregas/components/StandalonePostDrawer', () => ({
  StandalonePostDrawer: ({
    postId,
    onClose,
    onAttached,
  }: {
    postId: number;
    onClose: () => void;
    onAttached: (workflowId: number, postId: number) => void;
  }) => (
    <div>
      <span>StandalonePostDrawer open: {postId}</span>
      <button onClick={onClose}>close-standalone-drawer</button>
      <button onClick={() => onAttached(1, postId)}>attach-standalone-post</button>
    </div>
  ),
}));

vi.mock('@/pages/entregas/components/HistoryDrawer', () => ({
  HistoryDrawer: ({
    workflow,
    onClose,
    variant,
  }: {
    workflow: { titulo: string };
    onClose: () => void;
    variant?: string;
  }) => (
    <div data-variant={variant ?? 'drawer'} data-testid="history-drawer">
      <span>HistoryDrawer open: {workflow.titulo}</span>
      <button onClick={onClose}>close-history-drawer</button>
    </div>
  ),
}));

// Phone cards and their long-press menus (shipped Entregas phone code, with suites of
// their own): stubs that expose the handlers EntregasTab wires.
vi.mock('@/pages/entregas/phone/PhoneBoardCards', () => ({
  PhoneWorkflowCard: ({
    card,
    counts,
    onOpen,
    onForward,
    preview,
  }: {
    card: { workflow: { id: number; titulo: string } };
    counts: { postsCount: number; clearedClienteCount: number };
    onOpen?: () => void;
    onForward?: () => void;
    preview?: boolean;
  }) =>
    preview ? null : (
      <div>
        <span>{card.workflow.titulo}</span>
        <span data-testid={`counts-${card.workflow.id}`}>
          {counts.postsCount}/{counts.clearedClienteCount}
        </span>
        <button onClick={onOpen}>phone-open-card-{card.workflow.id}</button>
        <button onClick={onForward}>phone-forward-card-{card.workflow.id}</button>
      </div>
    ),
  PhonePostProcessCard: ({
    entity,
    onOpen,
    preview,
  }: {
    entity: { id: string; titulo: string };
    onOpen?: () => void;
    preview?: boolean;
  }) =>
    preview ? null : (
      <div>
        <span>{entity.titulo}</span>
        <button onClick={onOpen}>phone-open-post-{entity.id}</button>
      </div>
    ),
}));
vi.mock('@/pages/entregas/phone/cardMenus', () => ({
  WorkflowCardMenu: ({
    card,
    onEdit,
    onRevert,
    children,
  }: {
    card: { workflow: { id: number } };
    onEdit?: () => void;
    onRevert?: () => void;
    children: (api: { triggerProps: object }) => React.ReactNode;
  }) => (
    <div>
      {children({ triggerProps: {} })}
      <button onClick={onEdit}>menu-edit-{card.workflow.id}</button>
      <button onClick={onRevert}>menu-revert-{card.workflow.id}</button>
    </div>
  ),
  PostProcessCardMenu: ({
    entity,
    onRemoveProcess,
    children,
  }: {
    entity: { id: string };
    onRemoveProcess?: () => void;
    children: (api: { triggerProps: object }) => React.ReactNode;
  }) => (
    <div>
      {children({ triggerProps: {} })}
      <button onClick={onRemoveProcess}>menu-remove-{entity.id}</button>
    </div>
  ),
}));

import {
  getWorkflowsByCliente,
  getWorkflowEtapas,
  getWorkflowEtapasByWorkflowIds,
  getConcludedWorkflowSummaries,
  getDeadlineInfo,
  getMembros,
  hasLaterApprovalEtapa,
  revertEtapa,
  sendPostsToCliente,
  duplicateWorkflow,
  getWorkflowPostStats,
  getConcludedWorkflowsByCliente,
  getWorkflowPosts,
  getClientePosts,
  getClientes,
  getWorkspaceSlug,
  getHubToken,
  getWorkflowTemplates,
  getVigentePostProcessesByCliente,
  transitionPostProcess,
  completeEtapa,
  advanceWorkflowFromApproval,
  getWorkflowPostStatusCounts,
  type Cliente,
  type ClientePost,
  type Workflow,
  type WorkflowEtapa,
  type PostProcessStep,
  type PostProcessWithPost,
} from '@/store';
import { toast } from 'sonner';
import { getWorkflowCovers, getPostCovers } from '@/services/postMedia';
import type { ClienteDetalheOutletContext } from '../../clienteTabs.model';
import EntregasTab from '../EntregasTab';

const mockedGetWorkflowsByCliente = vi.mocked(getWorkflowsByCliente);
const mockedGetWorkflowEtapas = vi.mocked(getWorkflowEtapas);
const mockedGetWorkflowEtapasByWorkflowIds = vi.mocked(getWorkflowEtapasByWorkflowIds);
const mockedGetConcludedWorkflowSummaries = vi.mocked(getConcludedWorkflowSummaries);
const mockedGetDeadlineInfo = vi.mocked(getDeadlineInfo);
const mockedGetMembros = vi.mocked(getMembros);
const mockedHasLaterApprovalEtapa = vi.mocked(hasLaterApprovalEtapa);
const mockedRevertEtapa = vi.mocked(revertEtapa);
const mockedSendPostsToCliente = vi.mocked(sendPostsToCliente);
const mockedDuplicateWorkflow = vi.mocked(duplicateWorkflow);
const mockedGetWorkflowPostStats = vi.mocked(getWorkflowPostStats);
const mockedGetConcludedWorkflowsByCliente = vi.mocked(getConcludedWorkflowsByCliente);
const mockedGetWorkflowPosts = vi.mocked(getWorkflowPosts);
const mockedGetClientePosts = vi.mocked(getClientePosts);
const mockedGetClientes = vi.mocked(getClientes);
const mockedGetWorkspaceSlug = vi.mocked(getWorkspaceSlug);
const mockedGetHubToken = vi.mocked(getHubToken);
const mockedGetWorkflowTemplates = vi.mocked(getWorkflowTemplates);
const mockedGetWorkflowCovers = vi.mocked(getWorkflowCovers);
const mockedGetVigentePostProcessesByCliente = vi.mocked(getVigentePostProcessesByCliente);
const mockedGetPostCovers = vi.mocked(getPostCovers);
const mockedTransitionPostProcess = vi.mocked(transitionPostProcess);
const mockedCompleteEtapa = vi.mocked(completeEtapa);
const mockedAdvanceWorkflowFromApproval = vi.mocked(advanceWorkflowFromApproval);
const mockedGetWorkflowPostStatusCounts = vi.mocked(getWorkflowPostStatusCounts);
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

function processStep(
  p: Partial<PostProcessStep> & { ordem: number; nome: string },
): PostProcessStep {
  return {
    id: 200 + p.ordem,
    conta_id: 'c',
    process_id: 9,
    tipo: 'padrao',
    responsavel_id: null,
    prazo_dias: null,
    tipo_prazo: null,
    prazo_efetivo: null,
    estado: 'pendente',
    iniciado_em: null,
    concluido_em: null,
    interrompido_em: null,
    origem_etapa_ordem: null,
    origem_etapa_nome: null,
    ...p,
  };
}

function postProcess(overrides: Partial<PostProcessWithPost> = {}): PostProcessWithPost {
  return {
    id: 9,
    conta_id: 'c',
    post_id: 77,
    template_id: 5,
    template_nome: 'Redes',
    assinatura: '',
    origem_workflow_id: null,
    origem_descricao: null,
    estado: 'ativo',
    motivo_encerramento: null,
    etapa_atual: 1,
    modo_prazo: 'padrao',
    board_position: 0,
    revisao: 1,
    created_by: null,
    created_at: '2026-09-10T00:00:00Z',
    updated_at: '2026-09-10T00:00:00Z',
    concluido_em: null,
    steps: [
      processStep({ ordem: 0, nome: 'Copy', estado: 'ignorado' }),
      processStep({
        ordem: 1,
        nome: 'Design',
        estado: 'ativo',
        responsavel_id: null,
        prazo_efetivo: '2026-07-20T15:00:00.000Z',
        iniciado_em: '2026-07-18T10:00:00Z',
      }),
      // A pending step after the active one keeps canConcluir() false, so the
      // card's forward button dispatches `avancar` (not `concluir`) — the
      // path this fixture's tests exercise.
      processStep({ ordem: 2, nome: 'Publicação', estado: 'pendente' }),
    ],
    post: {
      id: 77,
      workflow_id: null,
      cliente_id: 42,
      cliente_nome: 'Aurora Estética',
      workflow_titulo: null,
      titulo: 'Post avulso X',
      tipo: 'feed',
      status: 'rascunho',
      custom_status_id: null,
      scheduled_at: null,
      published_at: null,
      ig_caption: null,
      instagram_permalink: null,
      publish_error: null,
      publish_error_code: null,
      ordem: 0,
      responsavel_id: null,
      platform: 'instagram',
      tiktok_publish_status: null,
      tiktok_publish_error: null,
      tiktok_post_url: null,
      instagram_media_id: null,
      ig_trial_strategy: null,
      board_ordem: null,
    },
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

/** Board counts (WorkflowCard props); the approval-exit dialog fetches its own. */
function mockCounts(cleared: number) {
  mockedGetWorkflowPostStats.mockResolvedValue({
    total: new Map([[1, 2]]),
    aprovadoCliente: new Map(),
    clearedCliente: cleared > 0 ? new Map([[1, cleared]]) : new Map(),
    enviadoCliente: new Map(),
    revisaoInterna: new Map(),
    responsaveis: new Map(),
  });
}

/** Per-status counts the approval-exit dialog fetches on open. */
const STATUS_COUNTS = { rascunho: 1, aprovado_interno: 1, aprovado_cliente: 1 };

/** Waits for the approval-exit dialog with its counts loaded (the options past
 *  "Manter" only show once they land). */
async function openedExitDialog() {
  await screen.findByRole('radio', { name: /Voltar todos para rascunho/ });
}

async function approveAllFromExitDialog() {
  fireEvent.click(await screen.findByText('forward-card-1'));
  await openedExitDialog();
  fireEvent.click(screen.getByRole('radio', { name: /Aprovar todos/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Avançar' }));
  await waitFor(() =>
    expect(mockedAdvanceWorkflowFromApproval).toHaveBeenCalledWith(
      expect.objectContaining({ choice: 'aprovar_todos' }),
    ),
  );
}

describe('EntregasTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFeatures = null;
    mockedGetWorkflowsByCliente.mockResolvedValue([workflow()]);
    mockedGetWorkflowEtapas.mockResolvedValue([approvalEtapa, nextEtapa]);
    mockedGetWorkflowEtapasByWorkflowIds.mockImplementation(
      async (ids: number[]) => new Map(ids.map((id) => [id, [approvalEtapa, nextEtapa]])),
    );
    mockedGetConcludedWorkflowSummaries.mockImplementation(async (wfs) =>
      wfs.map((w) => ({ workflow: w, postCount: 0, totalDays: null, completedAt: null })),
    );
    mockedGetDeadlineInfo.mockReturnValue({
      diasRestantes: 2,
      horasRestantes: 0,
      estourado: false,
      urgente: false,
    });
    mockedGetMembros.mockResolvedValue([]);
    mockedGetWorkflowTemplates.mockResolvedValue([]);
    mockedGetConcludedWorkflowsByCliente.mockResolvedValue([]);
    mockedGetWorkflowPosts.mockResolvedValue([]);
    mockedGetClientePosts.mockResolvedValue([]);
    mockedGetWorkflowCovers.mockResolvedValue(new Map());
    mockedGetVigentePostProcessesByCliente.mockResolvedValue([]);
    mockedGetPostCovers.mockResolvedValue(new Map());
    mockedTransitionPostProcess.mockResolvedValue({
      ok: true,
      process_id: 9,
      post_id: 77,
      command: 'avancar',
      estado: 'ativo',
      etapa_atual: 1,
      revisao: 2,
      post_status: 'rascunho',
      post_status_changed: false,
      steps: [],
    });
    mockedGetClientes.mockResolvedValue([]);
    mockedGetWorkspaceSlug.mockResolvedValue(null);
    mockedGetHubToken.mockResolvedValue(null);
    mockCounts(0);
    mockedCompleteEtapa.mockResolvedValue({
      workflow: workflow({ status: 'ativo' }),
      etapas: [],
    });
    mockedAdvanceWorkflowFromApproval.mockResolvedValue({
      workflowStatus: 'ativo',
      etapaAtual: 2,
      postsChanged: 2,
    });
    mockedGetWorkflowPostStatusCounts.mockResolvedValue(STATUS_COUNTS);
    mockedHasLaterApprovalEtapa.mockReturnValue(true);
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

  describe('saída de etapa de aprovação (cadeia compartilhada)', () => {
    it('avançar um fluxo em etapa de aprovação abre o diálogo de saída, sem o ForwardConfirm', async () => {
      renderTab();
      fireEvent.click(await screen.findByText('forward-card-1'));
      await openedExitDialog();
      expect(mockedGetWorkflowPostStatusCounts).toHaveBeenCalledWith(1);
      expect(screen.queryByText('Avançar etapa?')).not.toBeInTheDocument();
      expect(mockedHasLaterApprovalEtapa).toHaveBeenCalledWith([approvalEtapa, nextEtapa], 11);
    });

    it('confirmar a recomendada chama advanceWorkflowFromApproval e atualiza a aba', async () => {
      const { invalidateSpy } = renderTab();
      fireEvent.click(await screen.findByText('forward-card-1'));
      await openedExitDialog();
      expect(screen.getByRole('radio', { name: /Voltar todos para rascunho/ })).toBeChecked();
      fireEvent.click(screen.getByRole('button', { name: 'Avançar' }));
      await waitFor(() =>
        expect(mockedAdvanceWorkflowFromApproval).toHaveBeenCalledWith({
          workflowId: 1,
          expectedEtapaId: 11,
          choice: 'voltar_rascunho',
          expectedCounts: STATUS_COUNTS,
        }),
      );
      await waitFor(() =>
        expect(mockedToast.success).toHaveBeenCalledWith(
          'Etapa concluída. Posts voltaram para rascunho.',
        ),
      );
      // refreshCards keeps the historical invalidations.
      for (const queryKey of [
        ['workflowsByCliente', 42],
        ['workflow-posts-counts'],
        ['workflow-covers'],
        ['concluded-by-cliente', 42],
        ['concluded-summaries-cliente'],
        ['workflow-events'],
        ['post-processes-cliente', 42],
        ['post-covers-cliente'],
        ['clientePosts', 42],
      ]) {
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey });
      }
      expect(mockedCompleteEtapa).not.toHaveBeenCalled();
    });

    it('"Aprovar todos" avança com aprovar_todos', async () => {
      renderTab();
      fireEvent.click(await screen.findByText('forward-card-1'));
      await openedExitDialog();
      fireEvent.click(screen.getByRole('radio', { name: /Aprovar todos/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Avançar' }));
      await waitFor(() =>
        expect(mockedAdvanceWorkflowFromApproval).toHaveBeenCalledWith(
          expect.objectContaining({ choice: 'aprovar_todos', expectedCounts: STATUS_COUNTS }),
        ),
      );
    });

    it('"Enviar ao portal" envia os posts sem avançar a etapa', async () => {
      renderTab();
      fireEvent.click(await screen.findByText('forward-card-1'));
      await openedExitDialog();
      fireEvent.click(screen.getByRole('radio', { name: /Enviar ao portal/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Enviar ao portal' }));
      await waitFor(() => expect(mockedSendPostsToCliente).toHaveBeenCalledWith(1));
      expect(mockedAdvanceWorkflowFromApproval).not.toHaveBeenCalled();
      expect(mockedCompleteEtapa).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(mockedToast.success).toHaveBeenCalledWith('Posts enviados ao portal do cliente!'),
      );
    });

    it('etapa padrão continua com o ForwardConfirm e completeEtapa', async () => {
      const padrao: WorkflowEtapa = { ...approvalEtapa, tipo: 'padrao' };
      mockedGetWorkflowEtapasByWorkflowIds.mockImplementation(
        async (ids: number[]) => new Map(ids.map((id) => [id, [padrao, nextEtapa]])),
      );
      renderTab();
      fireEvent.click(await screen.findByText('forward-card-1'));
      fireEvent.click(await screen.findByRole('button', { name: 'Avançar' }));
      await waitFor(() => expect(mockedCompleteEtapa).toHaveBeenCalledWith(1, 11));
      expect(mockedAdvanceWorkflowFromApproval).not.toHaveBeenCalled();
      expect(mockedGetWorkflowPostStatusCounts).not.toHaveBeenCalled();
      await waitFor(() => expect(mockedToast.success).toHaveBeenCalledWith('Etapa concluída!'));
    });
  });

  // Fix A (revisão final): antes deste describe, `mockFeatures` era declarado
  // mas NUNCA reatribuído para longe de `null` em nenhum teste deste arquivo,
  // então schedulingEnabled/tiktokEnabled eram sempre false e
  // handleApproveInternally jamais abria o AutoScheduleBatchDialog sob teste --
  // zero cobertura comportamental para essa superfície nesta aba, apesar do
  // mock (`mockFeatures`) já existir pronto para ligar. AutoScheduleBatchDialog
  // NÃO é mockado neste arquivo (ao contrário de
  // KanbanBatchAutoScheduleNudge.test.tsx), então os casos abaixo procuram o
  // conteúdo real do AlertDialog.
  describe('batch auto-schedule nudge after "Aprovar todos" (spec peça 2 / fix A)', () => {
    const futureIso = () => new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();

    function approvedPost(overrides: Record<string, unknown> = {}) {
      return {
        id: 1,
        titulo: 'Post A',
        status: 'aprovado_cliente',
        platform: 'instagram',
        scheduled_at: futureIso(),
        ...overrides,
      };
    }

    it('opens the batch dialog once scheduling is enabled, the client auto-publishes, and no approval etapa lies ahead', async () => {
      mockFeatures = { feature_post_scheduling: true };
      // No later approval etapa: the nudge only shows when nothing else will ask
      // the client to approve before publishing.
      mockedHasLaterApprovalEtapa.mockReturnValue(false);
      mockedGetWorkflowPosts.mockResolvedValue([approvedPost()] as never);
      renderTab({ ...CLIENTE, auto_publish_on_approval: true });

      await approveAllFromExitDialog();
      expect(await screen.findByText('Agendar os posts aprovados?')).toBeInTheDocument();
      expect(await screen.findByRole('button', { name: /Agendar 1 post/ })).toBeInTheDocument();
    });

    it('does not end up open when the same advance also completes a recorrente workflow cycle', async () => {
      mockFeatures = { feature_post_scheduling: true };
      mockedHasLaterApprovalEtapa.mockReturnValue(false);
      mockedGetWorkflowPosts.mockResolvedValue([approvedPost()] as never);
      mockedGetWorkflowsByCliente.mockResolvedValue([workflow({ recorrente: true })]);
      mockedAdvanceWorkflowFromApproval.mockResolvedValue({
        workflowStatus: 'concluido',
        etapaAtual: 2,
        postsChanged: 1,
      });
      renderTab({ ...CLIENTE, auto_publish_on_approval: true });

      await approveAllFromExitDialog();
      // The recurring-completion dialog wins (its own workflowId={recurringWfId
      // == null ? ... : null} render-time gate) -- settled state never shows
      // both AlertDialogs at once.
      expect(await screen.findByText('Criar Novo Ciclo')).toBeInTheDocument();
      expect(screen.queryByText('Agendar os posts aprovados?')).not.toBeInTheDocument();
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
    mockedAdvanceWorkflowFromApproval.mockResolvedValue({
      workflowStatus: 'concluido',
      etapaAtual: 2,
      postsChanged: 0,
    });
    mockedGetWorkflowsByCliente.mockResolvedValue([workflow({ recorrente: true })]);
    renderTab();
    fireEvent.click(await screen.findByText('forward-card-1'));
    await openedExitDialog();
    fireEvent.click(screen.getByRole('radio', { name: /Manter status atuais/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Avançar' }));
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

    await waitFor(() =>
      expect(mockedGetConcludedWorkflowSummaries).toHaveBeenCalledWith([concluded]),
    );
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

  describe('post calendar', () => {
    function todayISO() {
      const d = new Date();
      const p = (n: number) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T12:00:00`;
    }
    function clientePost(overrides: Partial<ClientePost> = {}): ClientePost {
      return {
        id: 500,
        workflow_id: null,
        titulo: 'Post avulso de hoje',
        tipo: 'feed',
        status: 'aprovado_interno',
        custom_status_id: null,
        scheduled_at: todayISO(),
        ordem: 0,
        workflow_titulo: null,
        ...overrides,
      };
    }

    it('shows posts avulsos even with no active deliveries, and opens them in the standalone drawer', async () => {
      mockedGetWorkflowsByCliente.mockResolvedValue([]);
      mockedGetClientePosts.mockResolvedValue([clientePost()]);
      renderTab();
      expect(await screen.findByText('Post avulso de hoje')).toBeInTheDocument();
      expect(screen.getByText('Post avulso')).toBeInTheDocument();
      fireEvent.click(
        screen.getByRole('button', { name: /Abrir publicação: Post avulso de hoje/i }),
      );
      expect(await screen.findByText('StandalonePostDrawer open: 500')).toBeInTheDocument();
      expect(mockedGetClientePosts).toHaveBeenCalledWith(42);
    });

    it('refreshes the individual-post cards too after a calendar status change', async () => {
      const { updateWorkflowPost } = await import('@/store');
      vi.mocked(updateWorkflowPost).mockResolvedValue(undefined as never);
      mockedGetClientePosts.mockResolvedValue([clientePost()]);
      const { invalidateSpy } = renderTab();
      await screen.findByText('Post avulso de hoje');
      fireEvent.click(screen.getByRole('button', { name: /○ Agendar/ }));
      await waitFor(() =>
        expect(vi.mocked(updateWorkflowPost)).toHaveBeenCalledWith(500, { status: 'agendado' }),
      );
      await waitFor(() =>
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['post-processes-cliente', 42] }),
      );
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clientePosts', 42] });
    });

    describe('suggestion move guard', () => {
      afterEach(async () => {
        const { hasPendingEditSuggestion } = await import('@/store/posts');
        vi.mocked(hasPendingEditSuggestion).mockResolvedValue(false);
      });

      it('asks before scheduling a post with a pending client suggestion and writes only after "Mover mesmo assim"', async () => {
        const { updateWorkflowPost } = await import('@/store');
        const { hasPendingEditSuggestion } = await import('@/store/posts');
        vi.mocked(updateWorkflowPost).mockResolvedValue(undefined as never);
        vi.mocked(hasPendingEditSuggestion).mockResolvedValue(true);
        mockedGetClientePosts.mockResolvedValue([clientePost()]);
        renderTab();
        await screen.findByText('Post avulso de hoje');

        fireEvent.click(screen.getByRole('button', { name: /○ Agendar/ }));

        expect(await screen.findByText('Mover para Agendado?')).toBeInTheDocument();
        expect(vi.mocked(hasPendingEditSuggestion)).toHaveBeenCalledWith(500);
        expect(vi.mocked(updateWorkflowPost)).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole('button', { name: 'Mover mesmo assim' }));
        await waitFor(() =>
          expect(vi.mocked(updateWorkflowPost)).toHaveBeenCalledWith(500, { status: 'agendado' }),
        );
      });

      it('Cancelar does not write', async () => {
        const { updateWorkflowPost } = await import('@/store');
        const { hasPendingEditSuggestion } = await import('@/store/posts');
        vi.mocked(hasPendingEditSuggestion).mockResolvedValue(true);
        mockedGetClientePosts.mockResolvedValue([clientePost()]);
        renderTab();
        await screen.findByText('Post avulso de hoje');

        fireEvent.click(screen.getByRole('button', { name: /○ Agendar/ }));
        await screen.findByText('Mover para Agendado?');
        fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

        await waitFor(() => expect(screen.queryByText('Mover para Agendado?')).toBeNull());
        expect(vi.mocked(updateWorkflowPost)).not.toHaveBeenCalled();
      });
    });

    it('opens a fluxo post in its workflow drawer', async () => {
      mockedGetClientePosts.mockResolvedValue([
        clientePost({
          id: 501,
          workflow_id: 1,
          workflow_titulo: 'Posts Agosto',
          titulo: 'Post do fluxo',
        }),
      ]);
      renderTab();
      await screen.findByText('open-card-1');
      fireEvent.click(
        await screen.findByRole('button', { name: /Abrir publicação: Post do fluxo/i }),
      );
      expect(await screen.findByText('WorkflowDrawer open: Posts Agosto')).toBeInTheDocument();
      expect(screen.queryByText(/StandalonePostDrawer open/)).not.toBeInTheDocument();
    });
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
      // `auto-schedule-batch-posts` is AutoScheduleBatchDialog's own useQuery
      // (a workflow_posts read, same domain as everything else here): it is
      // always mounted (workflowId gates only whether it fetches), so React
      // Query registers the cache entry even with workflowId still null.
      // `clientePosts` feeds the post calendar (fluxo posts + posts avulsos),
      // shared with WorkflowDrawer / StandalonePostDrawer.
      // `workflow-post-status-counts` is the approval-exit dialog's per-status
      // counts (useWorkflowStageCommands), registered disabled until it opens.
      // `workflow-pending-suggestions` is the same dialog's count of posts with an
      // unreviewed client suggestion (a post_edit_suggestions read), same lifecycle.
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
            'workflow-templates',
            'concluded-by-cliente',
            'concluded-summaries-cliente',
            'clientes',
            'workflow-posts-counts',
            'workflow-covers',
            'workspace-slug',
            'hub-token',
            'auto-schedule-batch-posts',
            'post-processes-cliente',
            'post-covers-cliente',
            'clientePosts',
            'workflow-post-status-counts',
            'workflow-pending-suggestions',
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

  describe('individual posts (post_processes)', () => {
    it('does not fetch or render individual posts when feature_post_processes is off', async () => {
      mockedGetVigentePostProcessesByCliente.mockResolvedValue([postProcess()]);
      renderTab();
      await screen.findByText('Posts Agosto');
      expect(screen.queryByText('Post avulso X')).not.toBeInTheDocument();
      expect(mockedGetVigentePostProcessesByCliente).not.toHaveBeenCalled();
    });

    it('renders an active individual post card alongside workflow cards when the flag is on', async () => {
      mockFeatures = { feature_post_processes: true };
      mockedGetVigentePostProcessesByCliente.mockResolvedValue([postProcess()]);
      renderTab();
      await screen.findByText('Posts Agosto');
      expect(await screen.findByText('Post avulso X')).toBeInTheDocument();
      expect(mockedGetVigentePostProcessesByCliente).toHaveBeenCalledWith(42);
    });

    it('leaves out concluded individual posts (no history surface for them yet)', async () => {
      mockFeatures = { feature_post_processes: true };
      mockedGetVigentePostProcessesByCliente.mockResolvedValue([
        postProcess({ estado: 'concluido' }),
      ]);
      renderTab();
      await screen.findByText('Posts Agosto');
      expect(screen.queryByText('Post avulso X')).not.toBeInTheDocument();
    });

    it('opens and closes the standalone post drawer from the card', async () => {
      mockFeatures = { feature_post_processes: true };
      mockedGetVigentePostProcessesByCliente.mockResolvedValue([postProcess()]);
      renderTab();
      await screen.findByText('Posts Agosto');
      fireEvent.click(await screen.findByText('open-post-post:9'));
      expect(await screen.findByText('StandalonePostDrawer open: 77')).toBeInTheDocument();
      fireEvent.click(screen.getByText('close-standalone-drawer'));
      await waitFor(() =>
        expect(screen.queryByText('StandalonePostDrawer open: 77')).not.toBeInTheDocument(),
      );
    });

    it('refreshes the client process rail once a standalone post is attached to a workflow, so the now-closed process stops rendering as an active card', async () => {
      mockFeatures = { feature_post_processes: true };
      mockedGetVigentePostProcessesByCliente.mockResolvedValue([postProcess()]);
      renderTab();
      await screen.findByText('Posts Agosto');
      fireEvent.click(await screen.findByText('open-post-post:9'));
      await screen.findByText('StandalonePostDrawer open: 77');

      // AttachToFluxoDialog's own onAttached is what encerra'd the process
      // (motivo_encerramento: 'vinculado'); simulate the next fetch dropping
      // it from VIGENTES.
      mockedGetVigentePostProcessesByCliente.mockResolvedValue([]);
      fireEvent.click(screen.getByText('attach-standalone-post'));

      await waitFor(() => expect(mockedGetVigentePostProcessesByCliente).toHaveBeenCalledTimes(2));
      await waitFor(() =>
        expect(screen.queryByText('StandalonePostDrawer open: 77')).not.toBeInTheDocument(),
      );
      expect(screen.queryByText('Post avulso X')).not.toBeInTheDocument();
    });

    it('advances the process etapa via transitionPostProcess and refreshes', async () => {
      mockFeatures = { feature_post_processes: true };
      mockedGetVigentePostProcessesByCliente.mockResolvedValue([postProcess()]);
      const { invalidateSpy } = renderTab();
      await screen.findByText('Posts Agosto');
      fireEvent.click(await screen.findByText('forward-post-post:9'));
      fireEvent.click(await screen.findByText('Avançar'));
      await waitFor(() =>
        expect(mockedTransitionPostProcess).toHaveBeenCalledWith(
          expect.objectContaining({ processId: 9, command: 'avancar' }),
        ),
      );
      await waitFor(() =>
        expect(invalidateSpy).toHaveBeenCalledWith({
          queryKey: ['post-processes-cliente', 42],
        }),
      );
    });
  });

  describe('no celular', () => {
    beforeEach(() => {
      desktop.value = false;
    });
    afterEach(() => {
      desktop.value = true;
    });

    it('stacks phone cards instead of the desktop rail', async () => {
      renderTab();
      expect(await screen.findByText('phone-open-card-1')).toBeInTheDocument();
      expect(screen.queryByText('open-card-1')).not.toBeInTheDocument();
      expect(document.querySelector('.cliente-deliveries-rail')).toBeNull();
      expect(screen.getByRole('heading', { level: 2, name: 'Fluxos' })).toBeInTheDocument();
    });

    it('opens the workflow drawer from the card and the edit modal from the menu', async () => {
      renderTab();
      fireEvent.click(await screen.findByText('phone-open-card-1'));
      expect(await screen.findByText('WorkflowDrawer open: Posts Agosto')).toBeInTheDocument();
      fireEvent.click(screen.getByText('close-workflow-drawer'));

      fireEvent.click(screen.getByText('menu-edit-1'));
      expect(await screen.findByRole('dialog', { name: 'Editar Fluxo' })).toBeInTheDocument();
    });

    it('shows the empty state card when there are no active deliveries', async () => {
      mockedGetWorkflowsByCliente.mockResolvedValue([]);
      renderTab();
      expect(await screen.findByText('Nenhuma entrega ativa no momento.')).toBeInTheDocument();
    });

    it('opens a concluded fluxo as a pushed history screen in place of the tab', async () => {
      const concluded = workflow({ id: 2, status: 'concluido', titulo: 'Ciclo Julho' });
      mockedGetConcludedWorkflowsByCliente.mockResolvedValue([concluded]);
      mockedGetConcludedWorkflowSummaries.mockResolvedValue([
        { workflow: concluded, postCount: 3, totalDays: 12, completedAt: null },
      ] as never);
      renderTab();

      fireEvent.click(await screen.findByRole('button', { name: /Ciclo Julho/ }));
      expect(await screen.findByTestId('history-drawer')).toHaveAttribute('data-variant', 'page');
      // Render only what's visible: the board is gone while the history is up.
      expect(screen.queryByText('phone-open-card-1')).not.toBeInTheDocument();

      fireEvent.click(screen.getByText('close-history-drawer'));
      expect(await screen.findByText('phone-open-card-1')).toBeInTheDocument();
    });

    it('asks to create a new cycle in a confirm sheet when a recurring fluxo concludes', async () => {
      mockedAdvanceWorkflowFromApproval.mockResolvedValue({
        workflowStatus: 'concluido',
        etapaAtual: 2,
        postsChanged: 0,
      });
      mockedGetWorkflowsByCliente.mockResolvedValue([workflow({ recorrente: true })]);
      renderTab();
      fireEvent.click(await screen.findByText('phone-forward-card-1'));
      const exit = await screen.findByRole('dialog');
      const manter = await within(exit).findByRole('button', { name: /Manter status atuais/ });
      await waitFor(() => expect(manter).toBeEnabled());
      fireEvent.click(manter);

      const sheet = await screen.findByRole('dialog', { name: 'Criar novo ciclo?' });
      fireEvent.click(within(sheet).getByRole('button', { name: 'Criar novo ciclo' }));
      await waitFor(() => expect(mockedDuplicateWorkflow).toHaveBeenCalledWith(1));
    });

    it('uses the phone post calendar and keeps the Agendar step', async () => {
      const { updateWorkflowPost } = await import('@/store');
      vi.mocked(updateWorkflowPost).mockResolvedValue(undefined as never);
      const d = new Date();
      const p = (n: number) => String(n).padStart(2, '0');
      mockedGetClientePosts.mockResolvedValue([
        {
          id: 500,
          workflow_id: null,
          titulo: 'Post avulso de hoje',
          tipo: 'feed',
          status: 'aprovado_interno',
          custom_status_id: null,
          scheduled_at: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T12:00:00`,
          ordem: 0,
          workflow_titulo: null,
        },
      ]);
      renderTab();

      expect(await screen.findByText('Post avulso de hoje')).toBeInTheDocument();
      expect(document.querySelector('.phone-ent-v-cal')).not.toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Agendar' }));
      await waitFor(() =>
        expect(vi.mocked(updateWorkflowPost)).toHaveBeenCalledWith(500, { status: 'agendado' }),
      );

      fireEvent.click(
        screen.getByRole('button', { name: /Abrir publicação: Post avulso de hoje/i }),
      );
      expect(await screen.findByText('StandalonePostDrawer open: 500')).toBeInTheDocument();
    });

    it('wires "Remover processo" on an individual post card menu', async () => {
      mockFeatures = { feature_post_processes: true };
      mockedGetVigentePostProcessesByCliente.mockResolvedValue([postProcess()]);
      renderTab();
      fireEvent.click(await screen.findByText('menu-remove-post:9'));
      // usePostProcessCommands asks before removing (its own AlertDialog).
      expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    });
  });
});
