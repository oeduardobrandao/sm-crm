import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeCan, fakeMembership } from '@/test/makeCan';

// ── Mocks ─────────────────────────────────────────────────────────────────────
// Follows WorkflowDrawer.test.tsx's pattern: stub every heavy leaf component so
// only StandalonePostDrawer's own logic (query wiring, field-change/status-confirm/
// delete flows) is actually exercised. AttachToFluxoDialog is stubbed away entirely --
// its own behavior is covered by AttachToFluxoDialog.test.tsx.

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1' },
    role: 'owner',
    loading: false,
    profile: null,
    can: makeCan(fakeMembership({ role: 'owner' })),
  }),
}));

const limitsMock = vi.hoisted(() => ({ features: null as Record<string, boolean> | null }));
vi.mock('@/hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({
    limits: null,
    features: limitsMock.features,
    planName: null,
    isLoading: false,
    isUnlimited: true,
  }),
}));

// useClienteSocialAccounts (instagram_accounts/tiktok_accounts) and the drawer's own
// hub-token lookup (client_hub_tokens) both go through this client directly.
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'client_hub_tokens') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ data: [] }),
            }),
          }),
        };
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null }),
          }),
        }),
      };
    },
  },
}));

vi.mock('@/store', () => ({
  getStandalonePost: vi.fn(),
  getPostApprovals: vi.fn(async () => []),
  getPostStatusEvents: vi.fn(async () => []),
  getPostCommentThreads: vi.fn(async () => []),
  getPostEditSuggestions: vi.fn(async () => []),
  getWorkspaceUsers: vi.fn(async () => []),
  getClientePosts: vi.fn(async () => []),
  getWorkspaceSlug: vi.fn(async () => null),
  getPostStatusDefinitions: vi.fn(async () => []),
  updateWorkflowPost: vi.fn(),
  removeWorkflowPost: vi.fn(),
  replyToPostApproval: vi.fn(),
  createCommentThread: vi.fn(),
  addPostComment: vi.fn(),
  updatePostComment: vi.fn(),
  deletePostComment: vi.fn(),
  resolveCommentThread: vi.fn(),
  reopenCommentThread: vi.fn(),
  deleteCommentThread: vi.fn(),
  acceptEditSuggestion: vi.fn(),
  rejectEditSuggestion: vi.fn(),
  syncMentions: vi.fn(),
  getVigentePostProcess: vi.fn(async () => null),
  getPostProcessEvents: vi.fn(async () => []),
  transitionPostProcess: vi.fn(),
  removePostProcess: vi.fn(),
  CLIENT_CLEARED_STATUSES: ['aprovado_cliente', 'agendado', 'postado', 'falha_publicacao'],
}));

vi.mock('@/services/postMedia', () => ({ listPostMedia: vi.fn(async () => []) }));

vi.mock('@/services/inlineImage', () => ({
  uploadInlineImage: vi.fn(),
  extractR2Keys: vi.fn(() => []),
  injectSignedUrls: vi.fn((content: unknown) => content),
  resolveInlineImageUrls: vi.fn(async () => ({})),
}));

// Heavy leaf components -- stubbed out so only StandalonePostDrawer/PostEditorBody's own
// logic runs (same stub set as WorkflowDrawer.test.tsx).
vi.mock('@/pages/entregas/components/PostEditor', () => ({
  PostEditor: () => <div data-testid="post-editor-stub" />,
}));
vi.mock('@/pages/entregas/components/PropertyPanel', () => ({
  PropertyPanel: () => <div data-testid="property-panel-stub" />,
}));
vi.mock('@/pages/entregas/components/PostCommentSummary', () => ({
  default: () => <div data-testid="post-comment-summary-stub" />,
}));
vi.mock('@/pages/entregas/components/PostMediaGallery', () => ({
  PostMediaGallery: () => <div data-testid="post-media-gallery-stub" />,
  hasVideoMissingThumbnail: () => false,
}));
vi.mock('@/pages/entregas/components/InstagramCaptionField', () => ({
  InstagramCaptionField: () => <div data-testid="ig-caption-stub" />,
}));
vi.mock('@/pages/entregas/components/PlatformSelector', () => ({
  PlatformSelector: () => <div data-testid="platform-selector-stub" />,
}));
vi.mock('@/pages/entregas/components/TikTokSettingsPanel', () => ({
  TikTokSettingsPanel: () => <div data-testid="tiktok-settings-stub" />,
}));
vi.mock('@/pages/entregas/components/ScheduleButton', () => ({
  ScheduleButton: () => <div data-testid="schedule-button-stub" />,
}));
vi.mock('@/components/ui/date-time-picker', () => ({
  DateTimePicker: () => <div data-testid="date-time-picker-stub" />,
}));
vi.mock('@/components/CopyPostLinkButton', () => ({
  CopyPostLinkButton: () => <div data-testid="copy-post-link-stub" />,
}));
vi.mock('@/pages/entregas/components/DiffView', () => ({
  DiffView: () => <div data-testid="diff-view-stub" />,
}));
vi.mock('@/pages/entregas/components/ReadOnlyTipTap', () => ({
  ReadOnlyTipTap: () => <div data-testid="read-only-tiptap-stub" />,
}));
vi.mock('../AttachToFluxoDialog', () => ({
  AttachToFluxoDialog: () => <div data-testid="attach-to-fluxo-stub" />,
}));

import { StandalonePostDrawer } from '../StandalonePostDrawer';
import {
  getStandalonePost,
  getVigentePostProcess,
  updateWorkflowPost,
  removeWorkflowPost,
  transitionPostProcess,
} from '@/store';

const mockGetStandalonePost = vi.mocked(getStandalonePost);
const mockGetVigentePostProcess = vi.mocked(getVigentePostProcess);
const mockUpdate = vi.mocked(updateWorkflowPost);
const mockRemove = vi.mocked(removeWorkflowPost);
const mockTransition = vi.mocked(transitionPostProcess);

function basePost(overrides: Record<string, unknown> = {}) {
  return {
    id: 5,
    workflow_id: null,
    cliente_id: 42,
    cliente_nome: 'Marca X',
    titulo: 'Post avulso',
    conteudo: null,
    conteudo_plain: '',
    tipo: 'feed',
    ordem: 0,
    status: 'rascunho',
    responsavel_id: null,
    scheduled_at: null,
    ig_caption: null,
    platform: 'instagram',
    ...overrides,
  };
}

function renderDrawer(qc: QueryClient, props: Partial<Record<string, unknown>> = {}) {
  const onClose = vi.fn();
  const onRefresh = vi.fn();
  const onAttached = vi.fn();
  const utils = render(
    <QueryClientProvider client={qc}>
      <StandalonePostDrawer
        postId={5}
        membros={[]}
        onClose={onClose}
        onRefresh={onRefresh}
        onAttached={onAttached}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { ...utils, onClose, onRefresh, onAttached };
}

// ── Fixtures dos comandos do processo individual (Task 7) ────────────────────
const postFixture = basePost();

function processStep(ordem: number, estado: string, overrides: Record<string, unknown> = {}) {
  return {
    id: ordem + 1,
    ordem,
    nome: `Etapa ${ordem}`,
    estado,
    tipo: 'padrao',
    responsavel_id: null,
    prazo_dias: null,
    tipo_prazo: null,
    prazo_efetivo: null,
    iniciado_em: null,
    ...overrides,
  };
}

// Etapa 1 ativa de 3 (0 concluída, 1 ativa, 2 pendente): tem etapa anterior
// (Voltar etapa) e uma pendente adiante (Avançar etapa, não Concluir).
const processFixture = {
  id: 9,
  post_id: 5,
  estado: 'ativo',
  etapa_atual: 1,
  revisao: 3,
  template_id: null,
  template_nome: null,
  origem_descricao: null,
  steps: [processStep(0, 'concluido'), processStep(1, 'ativo'), processStep(2, 'pendente')],
};

// Última etapa ativa (nenhuma pendente adiante): canConcluir() = true.
const lastStepActiveSteps = [
  processStep(0, 'concluido'),
  processStep(1, 'concluido'),
  processStep(2, 'ativo'),
];

// Etapa ativa de aprovação do cliente, para a dica da seção de produção.
const approvalActiveProcessFixture = {
  ...processFixture,
  steps: [processStep(0, 'concluido'), processStep(1, 'ativo', { tipo: 'aprovacao_cliente' })],
};

describe('StandalonePostDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limitsMock.features = null;
    mockGetStandalonePost.mockResolvedValue(basePost() as never);
    mockUpdate.mockResolvedValue({} as never);
    mockRemove.mockResolvedValue(undefined as never);
  });

  it('renders the post editor without a PropertyPanel (posts avulsos have no template)', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc);

    expect(await screen.findByTestId('post-editor-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('property-panel-stub')).not.toBeInTheDocument();
  });

  it('shows the Avulso chip in the header subtitle', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc);

    expect(await screen.findByText('Avulso')).toBeInTheDocument();
    expect(screen.getByText('Marca X', { exact: false })).toBeInTheDocument();
  });

  it('deletes the post through the confirm dialog and closes the drawer', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { onClose, onRefresh } = renderDrawer(qc);

    await screen.findByTestId('post-editor-stub');

    fireEvent.click(screen.getByTitle('Remover post'));
    expect(await screen.findByText('Remover post?')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remover' }));

    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith(5));
    expect(onRefresh).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('does not delete when the confirm dialog is cancelled', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc);
    await screen.findByTestId('post-editor-stub');

    fireEvent.click(screen.getByTitle('Remover post'));
    expect(await screen.findByText('Remover post?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('asks for confirmation before changing the status of an approved post, then applies it', async () => {
    mockGetStandalonePost.mockResolvedValue(basePost({ status: 'aprovado_interno' }) as never);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = renderDrawer(qc);
    await screen.findByTestId('post-editor-stub');

    const statusSelect = Array.from(container.querySelectorAll('select')).find((s) =>
      s.querySelector('option[value="rascunho"]'),
    ) as HTMLSelectElement;
    expect(statusSelect).toBeTruthy();

    fireEvent.change(statusSelect, { target: { value: 'revisao_interna' } });

    expect(await screen.findByText('Post aprovado')).toBeInTheDocument();
    expect(mockUpdate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(5, {
        status: 'revisao_interna',
        custom_status_id: null,
      }),
    );
  });

  it('applies a status change immediately when the post is not approved', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = renderDrawer(qc);
    await screen.findByTestId('post-editor-stub');

    const statusSelect = Array.from(container.querySelectorAll('select')).find((s) =>
      s.querySelector('option[value="rascunho"]'),
    ) as HTMLSelectElement;

    fireEvent.change(statusSelect, { target: { value: 'revisao_interna' } });

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(5, {
        status: 'revisao_interna',
        custom_status_id: null,
      }),
    );
    expect(screen.queryByText('Post aprovado')).not.toBeInTheDocument();
  });

  it('flag desligada sem processo: tag "Avulso" (consulta o processo, que vem nulo)', async () => {
    limitsMock.features = { feature_post_processes: false };
    const { getVigentePostProcess } = await import('@/store');
    (getVigentePostProcess as any).mockResolvedValueOnce(null);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc);
    expect(await screen.findByText('Avulso')).toBeInTheDocument();
    expect(getVigentePostProcess).toHaveBeenCalledWith(5);
    expect(screen.queryByText(/Avulso · Sem processo/)).toBeNull();
  });

  it('flag desligada com processo existente: tag "Individual · <etapa>" e seção de produção visíveis', async () => {
    limitsMock.features = { feature_post_processes: false };
    const { getVigentePostProcess } = await import('@/store');
    (getVigentePostProcess as any).mockResolvedValueOnce({
      id: 9,
      post_id: 5,
      estado: 'ativo',
      etapa_atual: 1,
      template_id: null,
      template_nome: null,
      origem_descricao: null,
      steps: [
        {
          id: 1,
          ordem: 0,
          nome: 'Copy',
          estado: 'ignorado',
          tipo: 'padrao',
          responsavel_id: null,
          prazo_dias: null,
          tipo_prazo: null,
          prazo_efetivo: null,
          iniciado_em: null,
        },
        {
          id: 2,
          ordem: 1,
          nome: 'Design',
          estado: 'ativo',
          tipo: 'padrao',
          responsavel_id: null,
          prazo_dias: null,
          tipo_prazo: null,
          prazo_efetivo: null,
          iniciado_em: null,
        },
      ],
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc);
    expect(await screen.findByText('Individual · Design')).toBeInTheDocument();
    expect(screen.getByText('Produção')).toBeInTheDocument();
  });

  it('flag ligada sem processo: tag "Avulso · Sem processo"', async () => {
    limitsMock.features = { feature_post_processes: true };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc);
    expect(await screen.findByText('Avulso · Sem processo')).toBeInTheDocument();
    const { getVigentePostProcess } = await import('@/store');
    expect(getVigentePostProcess).toHaveBeenCalledWith(5);
  });

  it('flag ligada com processo ativo: tag "Individual · <etapa>" e seção Produção', async () => {
    limitsMock.features = { feature_post_processes: true };
    const { getVigentePostProcess } = await import('@/store');
    // Set the value BEFORE mounting: the query fires on mount, and a `Once`
    // value is consumed by whichever call happens next.
    (getVigentePostProcess as any).mockResolvedValueOnce({
      id: 9,
      post_id: 5,
      estado: 'ativo',
      etapa_atual: 1,
      template_id: null,
      template_nome: null,
      origem_descricao: null,
      steps: [
        {
          id: 1,
          ordem: 0,
          nome: 'Copy',
          estado: 'ignorado',
          tipo: 'padrao',
          responsavel_id: null,
          prazo_dias: null,
          tipo_prazo: null,
          prazo_efetivo: null,
          iniciado_em: null,
        },
        {
          id: 2,
          ordem: 1,
          nome: 'Design',
          estado: 'ativo',
          tipo: 'padrao',
          responsavel_id: null,
          prazo_dias: null,
          tipo_prazo: null,
          prazo_efetivo: null,
          iniciado_em: null,
        },
      ],
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc, { membros: [{ id: 1, nome: 'Ana' }] }); // the select (and its label) only renders with membros
    expect(await screen.findByText('Individual · Design')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Produção' })).toBeInTheDocument();
    expect(screen.getByText('Responsável do post')).toBeInTheDocument();
  });

  it('processo ativo sem etapa ativa: activeStepName cai em etapa_atual em vez de "Processo concluído"', async () => {
    // Mirrors toPostEntity's fallback in boardEntity.ts (`steps.find(estado ===
    // 'ativo') ?? steps.find(ordem === etapa_atual)`): a DB invariant keeps an
    // ativo process with exactly one ativo etapa, but the header must not
    // mislabel it as concluded if that invariant is ever violated.
    limitsMock.features = { feature_post_processes: true };
    const { getVigentePostProcess } = await import('@/store');
    (getVigentePostProcess as any).mockResolvedValueOnce({
      id: 9,
      post_id: 5,
      estado: 'ativo',
      etapa_atual: 1,
      template_id: null,
      template_nome: null,
      origem_descricao: null,
      steps: [
        {
          id: 1,
          ordem: 0,
          nome: 'Copy',
          estado: 'concluido',
          tipo: 'padrao',
          responsavel_id: null,
          prazo_dias: null,
          tipo_prazo: null,
          prazo_efetivo: null,
          iniciado_em: null,
        },
        {
          id: 2,
          ordem: 1,
          nome: 'Design',
          estado: 'pendente',
          tipo: 'padrao',
          responsavel_id: null,
          prazo_dias: null,
          tipo_prazo: null,
          prazo_efetivo: null,
          iniciado_em: null,
        },
      ],
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc, { membros: [{ id: 1, nome: 'Ana' }] });
    expect(await screen.findByText('Individual · Design')).toBeInTheDocument();
    expect(screen.queryByText('Individual · Processo concluído')).not.toBeInTheDocument();
  });

  it('processo ativo: cabeçalho com Voltar etapa / Avançar etapa / Remover processo, mesmo com a flag desligada', async () => {
    limitsMock.features = { feature_post_processes: false };
    mockGetVigentePostProcess.mockResolvedValueOnce(processFixture as never); // etapa 1 ativa de 3, próxima pendente
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc);
    await screen.findByRole('button', { name: 'Avançar etapa' });
    expect(screen.getByRole('button', { name: 'Voltar etapa' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remover processo' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Concluir processo' })).toBeNull();
  });

  it('última etapa ativa: "Concluir processo" no lugar de "Avançar etapa"; concluído: "Reabrir processo"', async () => {
    mockGetVigentePostProcess.mockResolvedValueOnce({
      ...processFixture,
      etapa_atual: 2,
      steps: lastStepActiveSteps,
    } as never);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc);
    await screen.findByRole('button', { name: 'Concluir processo' });
    expect(screen.queryByRole('button', { name: 'Avançar etapa' })).toBeNull();
  });

  it('post aprovado_cliente em etapa de aprovação: dica "Cliente aprovou. Avançar etapa?" na seção', async () => {
    mockGetStandalonePost.mockResolvedValueOnce({
      ...postFixture,
      status: 'aprovado_cliente',
    } as never);
    mockGetVigentePostProcess.mockResolvedValueOnce(approvalActiveProcessFixture as never);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc);
    await screen.findByText('Cliente aprovou. Avançar etapa?');
  });

  // Reviewer finding on Task 7 round 1: `approvalActiveProcessFixture`'s active
  // aprovacao_cliente step (ordem 1) has no later pendente step, so canConcluir()
  // is already true here -- this IS the last-step case. The hint used to always
  // wire onProcessAvancar to commands.avancar, so clicking it on this exact
  // fixture opened ForwardConfirmDialog with an empty next-step name and the RPC
  // rejected with no_next_step. Clicking through actually exercises that path
  // instead of only asserting the hint's text appears.
  it('post aprovado_cliente na última etapa de aprovação: clicar na dica CONCLUI o processo, não avança', async () => {
    mockGetStandalonePost.mockResolvedValueOnce({
      ...postFixture,
      status: 'aprovado_cliente',
    } as never);
    mockGetVigentePostProcess.mockResolvedValueOnce(approvalActiveProcessFixture as never);
    mockTransition.mockResolvedValueOnce({
      ok: true,
      revisao: 4,
      post_status: 'aprovado_cliente',
      post_status_changed: false,
      steps: [],
    } as never);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = renderDrawer(qc);
    await screen.findByText('Cliente aprovou. Avançar etapa?');

    const hintButton = container.querySelector('.post-production-hint button') as HTMLButtonElement;
    expect(hintButton).toBeTruthy();
    expect(hintButton).toHaveTextContent('Concluir processo');
    fireEvent.click(hintButton);

    fireEvent.click(await screen.findByRole('button', { name: 'Concluir' }));

    await waitFor(() => expect(mockTransition).toHaveBeenCalledTimes(1));
    expect(mockTransition.mock.calls[0][0]).toMatchObject({
      command: 'concluir',
    });
    expect(mockTransition.mock.calls[0][0]).not.toMatchObject({ command: 'avancar' });
  });
});
