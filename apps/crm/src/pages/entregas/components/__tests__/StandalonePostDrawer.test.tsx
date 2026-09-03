import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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
    can: () => true,
  }),
}));

vi.mock('@/hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({
    limits: null,
    features: null,
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
import { getStandalonePost, updateWorkflowPost, removeWorkflowPost } from '@/store';

const mockGetStandalonePost = vi.mocked(getStandalonePost);
const mockUpdate = vi.mocked(updateWorkflowPost);
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

describe('StandalonePostDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
