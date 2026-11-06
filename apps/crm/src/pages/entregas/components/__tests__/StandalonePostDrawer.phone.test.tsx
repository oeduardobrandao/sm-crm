import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { PostEditorBodyProps } from '../PostEditorBody';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeCan, fakeMembership } from '@/test/makeCan';

// ── Mocks ─────────────────────────────────────────────────────────────────────
// Follows WorkflowDrawer.test.tsx's pattern: stub every heavy leaf component so
// only StandalonePostDrawer's own logic (query wiring, field-change/status-confirm/
// delete flows) is actually exercised. AttachToFluxoDialog is stubbed away entirely --
// its own behavior is covered by AttachToFluxoDialog.test.tsx.

// Phone (C4): the drawer IS the pushed editor screen; its header actions move to "…".
// Feedback em mídia: the drawers fetch client notes by path (not through the mocked '@/store').
vi.mock('@/store/mediaNotes', () => ({
  getMediaNotes: async () => [],
  mediaNotesKey: (ids: number[]) => ['media-notes', ids.join(',')],
  replyToMediaNote: async () => undefined,
  setMediaNoteStatus: async () => undefined,
}));

vi.mock('@/pages/entregas/components/postEditorPhone/useIsPhoneEditor', () => ({
  useIsPhoneEditor: () => true,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

// `can` e um vi.fn() para cada teste poder negar uma permissao especifica.
const authMock = vi.hoisted(() => ({ can: vi.fn() }));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1' },
    role: 'owner',
    loading: false,
    profile: null,
    can: authMock.can,
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
  saveIgCaption: vi.fn(),
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
  resolvePostProcessRascunhoBanner: vi.fn(async () => true),
  removePostProcess: vi.fn(),
  CLIENT_CLEARED_STATUSES: ['aprovado_cliente', 'agendado', 'postado', 'falha_publicacao'],
  // Consumed by ApplyProcessDialog, which this drawer mounts in its header for the
  // "Aplicar processo" action -- the module-namespace mock below must list every
  // export imported anywhere in that subtree, even in tests that never open it.
  getWorkflowTemplates: vi.fn(async () => []),
  getClientes: vi.fn(async () => []),
  applyPostProcess: vi.fn(),
  // Consumed by DuplicateDialog ("Duplicar post" no cabecalho).
  clonePost: vi.fn(),
  cloneWorkflow: vi.fn(),
}));

vi.mock('@/services/postMedia', () => ({ listPostMedia: vi.fn(async () => []) }));
// PostEditorBody and WorkflowDrawer read client references from this module by path.
vi.mock('@/store/postReferences', () => ({
  getPostReferences: vi.fn(async () => []),
  getPostReferenceCounts: vi.fn(async () => ({})),
  deletePostReference: vi.fn(),
}));

vi.mock('@/services/inlineImage', () => ({
  uploadInlineImage: vi.fn(),
  extractR2Keys: vi.fn(() => []),
  injectSignedUrls: vi.fn((content: unknown) => content),
  stripSignedUrls: vi.fn((content: unknown) => content),
  resolveInlineImageUrls: vi.fn(async () => ({})),
}));

// Heavy leaf components -- stubbed out so only StandalonePostDrawer/PostEditorBody's own
// logic runs (same stub set as WorkflowDrawer.test.tsx).
// O stub expõe um botão que dispara onUpdate, para armar o autosave do conteúdo.
vi.mock('@/pages/entregas/components/PostEditor', () => ({
  PostEditor: ({
    onUpdate,
  }: {
    onUpdate?: (json: Record<string, unknown>, plain: string) => void;
  }) => (
    <div data-testid="post-editor-stub">
      <button type="button" onClick={() => onUpdate?.({ type: 'doc' }, 'novo texto')}>
        Editar conteúdo
      </button>
    </div>
  ),
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
  useScheduleActions: () => ({}),
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
// A view do calendário tem DnD, queries próprias e grade de mês -- só interessa
// aqui QUE ela é montada, e com qual escopo de posse (currentWorkflowId).
vi.mock('../WorkflowCalendarView', () => ({
  WorkflowCalendarView: ({ currentWorkflowId }: { currentWorkflowId: number | null }) => (
    <div data-testid="calendar-view-stub" data-current-workflow={String(currentWorkflowId)} />
  ),
}));

vi.mock('@/pages/entregas/components/PostEditorBody', () => ({
  PostEditorBody: ({ layout, phone }: PostEditorBodyProps) => (
    <div data-testid="editor-body" data-layout={layout ?? 'desktop'}>
      <p>{phone?.subtitle}</p>
      {phone?.banner}
      <button type="button" onClick={phone?.onBack}>
        Voltar
      </button>
      <ul aria-label="Mais ações do post">
        {phone?.menuActions.map((a) => (
          <li key={a.label}>
            <button type="button" disabled={a.disabled} onClick={a.onSelect}>
              {a.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  ),
}));

import { StandalonePostDrawer } from '../StandalonePostDrawer';
import {
  getStandalonePost,
  getVigentePostProcess,
  removeWorkflowPost,
  resolvePostProcessRascunhoBanner,
} from '@/store';

const mockGetStandalonePost = vi.mocked(getStandalonePost);
const mockGetVigentePostProcess = vi.mocked(getVigentePostProcess);
const mockRemove = vi.mocked(removeWorkflowPost);

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
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <StandalonePostDrawer
          postId={5}
          membros={[]}
          onClose={onClose}
          onRefresh={onRefresh}
          onAttached={onAttached}
          {...props}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { ...utils, onClose, onRefresh, onAttached };
}

const processStep = (ordem: number, estado: string, extra: Record<string, unknown> = {}) => ({
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
  ...extra,
});
const activeProcess = {
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

const menuLabels = () =>
  Array.from(
    screen.getByRole('list', { name: 'Mais ações do post' }).querySelectorAll('button'),
  ).map((b) => b.textContent);

describe('StandalonePostDrawer on phones', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limitsMock.features = null;
    authMock.can.mockImplementation(makeCan(fakeMembership({ role: 'owner' })));
    mockGetStandalonePost.mockResolvedValue(basePost() as never);
    mockRemove.mockResolvedValue(undefined as never);
  });

  it('renders the phone editor inside a screen region, with no history entry of its own', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc);
    const body = await screen.findByTestId('editor-body');
    expect(body.closest('[role="region"]')).toHaveAccessibleName('Editor do post');
    expect(body).toHaveAttribute('data-layout', 'phone');
    expect(screen.getByText('Marca X · Avulso')).toBeInTheDocument();
    // The desktop drawer header is not rendered.
    expect(document.querySelector('.drawer-panel')).toBeNull();
  });

  it('the "…" menu carries the header actions: process commands, links, Duplicar, Excluir last', async () => {
    mockGetVigentePostProcess.mockResolvedValue(activeProcess as never);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc);
    await screen.findByTestId('editor-body');
    await waitFor(() => expect(menuLabels()).toContain('Avançar etapa'));
    expect(menuLabels()).toEqual([
      'Voltar etapa',
      'Avançar etapa',
      'Remover processo',
      'Vincular a um fluxo',
      'Ver calendário do cliente',
      'Copiar link',
      'Duplicar',
      'Excluir post',
    ]);
  });

  it('Voltar calls onClose; Excluir post goes through the confirm dialog', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { onClose } = renderDrawer(qc);
    await screen.findByTestId('editor-body');
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(onClose).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Excluir post' }));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('Ver calendário do cliente swaps the screen content and its Voltar returns to the post', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { onClose } = renderDrawer(qc);
    await screen.findByTestId('editor-body');
    fireEvent.click(screen.getByRole('button', { name: 'Ver calendário do cliente' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Calendário do cliente' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(await screen.findByTestId('editor-body')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('mostra o banner de rascunho no editor do phone e o X dispensa', async () => {
    const ciclo = '2026-10-20T10:00:00.123456+00:00';
    mockGetStandalonePost.mockResolvedValue(basePost({ status: 'aprovado_cliente' }) as never);
    mockGetVigentePostProcess.mockResolvedValue({
      ...activeProcess,
      aviso_rascunho_dispensado_em: null,
      steps: [
        processStep(0, 'concluido', { tipo: 'aprovacao_cliente', concluido_em: ciclo }),
        processStep(1, 'ativo'),
        processStep(2, 'pendente', { tipo: 'aprovacao_cliente' }),
      ],
    } as never);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderDrawer(qc);
    const body = await screen.findByTestId('editor-body');
    await waitFor(() => expect(body).toHaveTextContent('Este post continua aprovado.'));
    fireEvent.click(screen.getByRole('button', { name: 'Dispensar aviso' }));
    expect(vi.mocked(resolvePostProcessRascunhoBanner)).toHaveBeenCalledWith(9, ciclo, false);
    expect(screen.queryByText('Este post continua aprovado.')).toBeNull();
  });
});
