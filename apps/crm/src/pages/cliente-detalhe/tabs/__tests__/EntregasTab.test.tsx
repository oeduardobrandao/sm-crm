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
  getWorkflowTemplates: vi.fn(),
  getVigentePostProcessesByCliente: vi.fn(),
  // Consumed by the real usePostProcessCommands (not mocked — same rationale
  // as completeEtapa/completeEtapaWithRearm below: this suite pins that the
  // individual-post forward/revert buttons wire to the same commands the
  // Fluxos board uses).
  transitionPostProcess: vi.fn(),
  removePostProcess: vi.fn(),
  sendPostToCliente: vi.fn(),
  CLIENT_CLEARED_STATUSES: ['aprovado_cliente', 'agendado', 'postado', 'falha_publicacao'],
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

// Mutable so a future test can flip a feature on for just its own describe
// block; every other test keeps the flags off (default null), same
// mutable-features pattern as WorkflowDrawer.test.tsx. No test in THIS file
// reassigns it yet, so `let` alone trips prefer-const.
// eslint-disable-next-line prefer-const
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
  StandalonePostDrawer: ({ postId, onClose }: { postId: number; onClose: () => void }) => (
    <div>
      <span>StandalonePostDrawer open: {postId}</span>
      <button onClick={onClose}>close-standalone-drawer</button>
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
  getWorkflowTemplates,
  getVigentePostProcessesByCliente,
  transitionPostProcess,
  completeEtapa,
  completeEtapaWithRearm,
  type Cliente,
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
const mockedGetWorkflowTemplates = vi.mocked(getWorkflowTemplates);
const mockedGetWorkflowCovers = vi.mocked(getWorkflowCovers);
const mockedGetVigentePostProcessesByCliente = vi.mocked(getVigentePostProcessesByCliente);
const mockedGetPostCovers = vi.mocked(getPostCovers);
const mockedTransitionPostProcess = vi.mocked(transitionPostProcess);
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

/**
 * Wait until the per-workflow count queries have actually landed in the card.
 *
 * handleForwardConfirm picks between the silent advance and the client-approval
 * dialog by comparing postsCount with clearedClienteCount. Both arrive from
 * queries that settle *after* the workflow list does, so clicking "Avançar" as
 * soon as `forward-card-1` renders is a race: with the count maps still empty
 * `total` is 0, `allCleared` is false, and the approval dialog opens instead of
 * the path the test set up with mockCounts(). Any test that depends on the
 * counts must await this first — it is the difference between a deterministic
 * test and one that fails a few percent of the time under load.
 */
async function awaitCountsLoaded(total: number, cleared: number) {
  await waitFor(() =>
    expect(screen.getByTestId('counts-1')).toHaveTextContent(`${total}/${cleared}`),
  );
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
    mockFeatures = null;
    mockedGetWorkflowsByCliente.mockResolvedValue([workflow()]);
    mockedGetWorkflowEtapas.mockResolvedValue([approvalEtapa, nextEtapa]);
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
    mockedGetWorkflowPostsWithProperties.mockResolvedValue([]);
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
      await awaitCountsLoaded(2, 2);
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

  // Fix A (revisão final): antes deste describe, `mockFeatures` era declarado
  // mas NUNCA reatribuído para longe de `null` em nenhum teste deste arquivo,
  // então schedulingEnabled/tiktokEnabled eram sempre false e
  // handleApproveInternally jamais abria o AutoScheduleBatchDialog sob teste --
  // zero cobertura comportamental para essa superfície nesta aba, apesar do
  // mock (`mockFeatures`) já existir pronto para ligar. AutoScheduleBatchDialog
  // NÃO é mockado neste arquivo (ao contrário de
  // KanbanBatchAutoScheduleNudge.test.tsx), então os casos abaixo procuram o
  // conteúdo real do AlertDialog.
  describe('batch auto-schedule nudge after "Aprovar internamente" (spec peça 2 / fix A)', () => {
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

    it('opens the batch dialog once scheduling is enabled, the client auto-publishes, and the approval is not a rearm', async () => {
      mockFeatures = { feature_post_scheduling: true };
      // hasLaterApprovalEtapa -> false makes decideApprovalAdvance's willRearm
      // false (approvalAdvance.ts: willRearm = temAprovacaoAdiante), the
      // !willRearm half of the gate this test exercises. Mirrors how
      // KanbanBatchAutoScheduleNudge.test.tsx's makeCard()/renderBoard()
      // construct the non-rearm case for KanbanView's equivalent handler.
      mockedHasLaterApprovalEtapa.mockReturnValue(false);
      mockedGetWorkflowPosts.mockResolvedValue([approvedPost()] as never);
      renderTab({ ...CLIENTE, auto_publish_on_approval: true });

      // mockCounts(0) from beforeEach -> cleared !== total -> approval-choice dialog.
      fireEvent.click(await screen.findByText('forward-card-1'));
      fireEvent.click(await screen.findByText('Avançar'));
      fireEvent.click(await screen.findByText('Aprovar internamente'));

      await waitFor(() => expect(mockedApprovePostsInternally).toHaveBeenCalledWith(1));
      expect(await screen.findByText('Agendar os posts aprovados?')).toBeInTheDocument();
      expect(await screen.findByRole('button', { name: /Agendar 1 post/ })).toBeInTheDocument();
    });

    it('does not end up open when the same advance also completes a recorrente workflow cycle', async () => {
      mockFeatures = { feature_post_scheduling: true };
      mockedHasLaterApprovalEtapa.mockReturnValue(false);
      mockedGetWorkflowPosts.mockResolvedValue([approvedPost()] as never);
      mockedGetWorkflowsByCliente.mockResolvedValue([workflow({ recorrente: true })]);
      mockedCompleteEtapaWithRearm.mockResolvedValue({
        workflow: workflow({ status: 'concluido', recorrente: true }),
        etapas: [],
        rearmed: false,
        rearmFailed: false,
      });
      renderTab({ ...CLIENTE, auto_publish_on_approval: true });

      fireEvent.click(await screen.findByText('forward-card-1'));
      fireEvent.click(await screen.findByText('Avançar'));
      fireEvent.click(await screen.findByText('Aprovar internamente'));

      await waitFor(() => expect(mockedApprovePostsInternally).toHaveBeenCalledWith(1));
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
    mockCounts(2); // silent advance path
    mockedCompleteEtapaWithRearm.mockResolvedValue({
      workflow: workflow({ status: 'concluido', recorrente: true }),
      etapas: [],
      rearmed: false,
      rearmFailed: false,
    });
    mockedGetWorkflowsByCliente.mockResolvedValue([workflow({ recorrente: true })]);
    renderTab();
    await awaitCountsLoaded(2, 2);
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
      // `auto-schedule-batch-posts` is AutoScheduleBatchDialog's own useQuery
      // (a workflow_posts read, same domain as everything else here): it is
      // always mounted (workflowId gates only whether it fetches), so React
      // Query registers the cache entry even with workflowId still null.
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
            'workflow-approved-posts-counts',
            'workflow-cleared-cliente-counts',
            'workflow-revisao-interna-counts',
            'workflow-awaiting-cliente-counts',
            'workflow-covers',
            'workspace-slug',
            'hub-token',
            'auto-schedule-batch-posts',
            'post-processes-cliente',
            'post-covers-cliente',
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
});
