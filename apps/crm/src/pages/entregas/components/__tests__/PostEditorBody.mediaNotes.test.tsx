import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock('@mesaas/app-lifecycle', () => ({
  useUnsavedWork: vi.fn(),
  trackUnsavedWork: vi.fn((p: Promise<unknown>) => p),
}));
vi.mock('@/lib/supabase');
vi.mock('@/services/instagram', () => ({
  scheduleInstagramPost: vi.fn(),
  cancelInstagramSchedule: vi.fn(),
  retryInstagramPublish: vi.fn(),
  publishInstagramNow: vi.fn(),
}));
vi.mock('@/services/tiktok', () => ({
  scheduleTikTokPost: vi.fn(),
  cancelTikTokSchedule: vi.fn(),
  retryTikTokPublish: vi.fn(),
  publishTikTokNow: vi.fn(),
}));

const limitsMock = vi.hoisted(() => ({ features: null as Record<string, boolean> | null }));
vi.mock('@/hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({ features: limitsMock.features, limits: null, isLoading: false }),
}));
vi.mock('@/hooks/useStatusRegistry', async () => {
  const { buildStatusRegistry } = await import('../../statusRegistry');
  return { useStatusRegistry: () => buildStatusRegistry([]) };
});
vi.mock('@/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store')>()),
  getPostTargets: vi.fn(async () => []),
  getBoardPlatforms: vi.fn(async () => []),
}));
vi.mock('@/services/postMedia', () => ({ listPostMedia: vi.fn(async () => []) }));
vi.mock('@/services/inlineImage', () => ({
  uploadInlineImage: vi.fn(),
  extractR2Keys: vi.fn(() => []),
  injectSignedUrls: vi.fn((c: unknown) => c),
  stripSignedUrls: vi.fn((c: unknown) => c),
  resolveInlineImageUrls: vi.fn(async () => ({})),
}));
vi.mock('@/pages/entregas/components/PostEditor', () => ({
  PostEditor: ({ variant }: { variant?: string }) => (
    <div data-testid="post-editor-stub" data-variant={variant} />
  ),
}));
vi.mock('@/pages/entregas/components/PropertyPanel', () => ({ PropertyPanel: () => null }));
vi.mock('@/pages/entregas/components/PostCommentSummary', () => ({ default: () => null }));
vi.mock('@/pages/entregas/components/PostMediaGallery', () => ({
  PostMediaGallery: ({
    variant,
    openLinkRequest,
  }: {
    variant?: string;
    openLinkRequest?: { linkId: number; nonce: number } | null;
  }) => (
    <div
      data-testid="media-stub"
      data-variant={variant}
      data-open-link={openLinkRequest?.linkId ?? ''}
    />
  ),
  hasVideoMissingThumbnail: () => false,
}));
// A caption draft the user is typing: it must survive tab switches (panes stay mounted).
vi.mock('@/pages/entregas/components/InstagramCaptionField', () => ({
  InstagramCaptionField: () => <textarea aria-label="Legenda do Instagram" />,
}));
vi.mock('@/pages/entregas/components/PlatformSelector', () => ({
  PlatformSelector: ({ onChange }: { onChange: (p: string) => void }) => (
    <div data-testid="platform-selector-stub">
      <button type="button" onClick={() => onChange('tiktok')}>
        stub-only-tiktok
      </button>
    </div>
  ),
}));
vi.mock('@/pages/entregas/components/TikTokSettingsPanel', () => ({
  TikTokSettingsPanel: () => <div data-testid="tiktok-settings-stub" />,
}));
vi.mock('@/store/postReferences', () => ({
  getPostReferences: vi.fn(async () => []),
  getPostReferenceCounts: vi.fn(async () => ({})),
  deletePostReference: vi.fn(),
}));
vi.mock('@/pages/entregas/components/references/PostClientReferences', () => ({
  PostClientReferences: () => null,
}));
vi.mock('@/pages/entregas/components/TrialReelPanel', () => ({ TrialReelPanel: () => null }));
vi.mock('@/pages/entregas/components/PostAutomationSection', () => ({
  PostAutomationSection: () => null,
}));
vi.mock('@/pages/entregas/components/PublishErrorBlock', () => ({
  PublishErrorBlock: ({ onEditCollaborators }: { onEditCollaborators?: () => void }) =>
    onEditCollaborators ? (
      <button type="button" onClick={onEditCollaborators}>
        stub-editar-colaboradores
      </button>
    ) : null,
}));
vi.mock('@/pages/entregas/components/SuggestTimeButton', () => ({ SuggestTimeButton: () => null }));
vi.mock('@/pages/entregas/components/PostVersionHistorySheet', () => ({
  PostVersionHistorySheet: ({ open }: { open: boolean }) =>
    open ? <div data-testid="versions-open" /> : null,
}));
vi.mock('@/components/ui/date-time-picker', () => ({ DateTimePicker: () => null }));

import { PostEditorBody, type PostEditorBodyProps } from '../PostEditorBody';
import type { PhoneEditorChrome } from '../postEditorPhone/types';
import type { WorkflowPost } from '@/store';
import type { MediaNotesBinding } from '../mediaNotes/ClientConversation';
import { makeNote } from '../mediaNotes/__tests__/fixtures';

const basePost = {
  id: 42,
  workflow_id: 10,
  conta_id: 'ws-1',
  cliente_id: 7,
  titulo: 'Lançamento outubro',
  conteudo: null,
  conteudo_plain: 'Primeiro parágrafo',
  tipo: 'feed',
  ordem: 0,
  status: 'rascunho',
  platform: 'instagram',
  ig_caption: 'Legenda IG',
  tiktok_caption: null,
  is_express: false,
  scheduled_at: null,
} as unknown as WorkflowPost;

function binding(over: Partial<MediaNotesBinding> = {}): MediaNotesBinding {
  return {
    notes: [makeNote({ id: 1, body: 'Trocar a cor', current_link_id: 5 })],
    clientName: 'Maria Souza',
    onReply: vi.fn(async () => {}),
    onStatus: vi.fn(async () => {}),
    ...over,
  };
}

function renderBody(over: Partial<PostEditorBodyProps> = {}, phoneLayout = false) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const phone: PhoneEditorChrome = {
    onBack: vi.fn(),
    subtitle: 'Padaria Sol · Outubro',
    clientName: 'Padaria Sol',
    saving: false,
    menuActions: [],
  };
  const props: PostEditorBodyProps = {
    post: basePost,
    templateId: undefined,
    workflowId: 10,
    clienteId: 7,
    clientePosts: [],
    isExpanded: true,
    approvals: [],
    statusEvents: [],
    editSuggestion: null,
    membros: [],
    replyText: '',
    sendingReply: false,
    commentThreads: [],
    currentUserId: 'user-1',
    currentUserRole: 'owner',
    canManageAutomations: false,
    workspaceUsers: [],
    hasInstagramAccount: true,
    igAccountStatus: null,
    hasActiveTikTokAccount: false,
    ttAccountStatus: null,
    onFieldChange: vi.fn(),
    onContentUpdate: vi.fn(),
    onReplyChange: vi.fn(),
    onReplySend: vi.fn(),
    onRefresh: vi.fn(),
    onCreateComment: vi.fn(async () => 1),
    onSaveCaption: vi.fn(async () => {}),
    onReplyToComment: vi.fn(async () => {}),
    onResolveThread: vi.fn(async () => {}),
    onReopenThread: vi.fn(async () => {}),
    onEditComment: vi.fn(async () => {}),
    onDeleteComment: vi.fn(async () => {}),
    editorVersion: 0,
    onAcceptSuggestion: vi.fn(),
    onRejectSuggestion: vi.fn(),
    ...(phoneLayout ? { layout: 'phone' as const, phone } : {}),
    ...over,
  };
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <PostEditorBody {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return props;
}

describe('PostEditorBody media notes wiring', () => {
  it('desktop: client notes show the client name, not the literal Cliente', () => {
    renderBody({ mediaNotes: binding() });
    expect(screen.getByText('Maria Souza')).toBeInTheDocument();
    expect(screen.queryByText('Cliente')).not.toBeInTheDocument();
  });

  it('desktop: the anchor chip asks the gallery to open that media', () => {
    const mediaNotes = binding({ onSelectMedia: vi.fn() });
    renderBody({ mediaNotes });
    expect(screen.getByTestId('media-stub')).toHaveAttribute('data-open-link', '');
    fireEvent.click(screen.getByRole('button', { name: 'Slide 1' }));
    expect(screen.getByTestId('media-stub')).toHaveAttribute('data-open-link', '5');
    expect(mediaNotes.onSelectMedia).toHaveBeenCalledWith(5);
  });

  it('phone: the anchor chip asks the gallery to open that media', () => {
    renderBody({ mediaNotes: binding() }, true);
    fireEvent.click(screen.getByText('Slide 1'));
    expect(screen.getByTestId('media-stub')).toHaveAttribute('data-open-link', '5');
  });

  it('shows the approved-with-open-comments flag on the post', () => {
    renderBody({
      mediaNotes: binding(),
      approvals: [
        {
          id: 1,
          post_id: 42,
          token: 't',
          action: 'aprovado',
          comentario: null,
          is_workspace_user: false,
          author_user_id: null,
          media_note_ids: [1],
          created_at: '2026-10-22T12:00:00Z',
        },
      ],
    });
    expect(screen.getAllByText('Aprovado com 1 comentário em aberto').length).toBeGreaterThan(0);
  });
});
