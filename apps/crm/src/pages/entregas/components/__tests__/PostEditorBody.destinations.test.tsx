import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@mesaas/app-lifecycle', () => ({
  useUnsavedWork: vi.fn(),
  trackUnsavedWork: vi.fn((p: Promise<unknown>) => p),
}));
vi.mock('@/lib/supabase');

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
  getPostTargets: vi.fn(),
  getBoardPlatforms: vi.fn(),
  addPostDestination: vi.fn(async () => {}),
  removePostDestination: vi.fn(async () => {}),
  savePostCaption: vi.fn(async () => {}),
}));
vi.mock('@/services/postMedia', () => ({ listPostMedia: vi.fn(async () => []) }));
vi.mock('@/services/inlineImage', () => ({
  uploadInlineImage: vi.fn(),
  extractR2Keys: vi.fn(() => []),
  injectSignedUrls: vi.fn((c: unknown) => c),
  stripSignedUrls: vi.fn((c: unknown) => c),
  resolveInlineImageUrls: vi.fn(async () => ({})),
}));
vi.mock('@/pages/entregas/components/PostEditor', () => ({ PostEditor: () => <div /> }));
vi.mock('@/pages/entregas/components/PropertyPanel', () => ({ PropertyPanel: () => null }));
vi.mock('@/pages/entregas/components/PostCommentSummary', () => ({ default: () => null }));
vi.mock('@/pages/entregas/components/PostMediaGallery', () => ({
  PostMediaGallery: () => null,
  hasVideoMissingThumbnail: () => false,
}));
vi.mock('@/pages/entregas/components/InstagramCaptionField', () => ({
  InstagramCaptionField: () => <div data-testid="ig-caption-stub" />,
}));
vi.mock('@/pages/entregas/components/PlatformSelector', () => ({
  PlatformSelector: () => <div data-testid="platform-selector-stub" />,
}));
vi.mock('@/pages/entregas/components/TikTokSettingsPanel', () => ({
  TikTokSettingsPanel: ({ hideCaption }: { hideCaption?: boolean }) => (
    <div data-testid="tiktok-settings-stub" data-hide-caption={String(!!hideCaption)} />
  ),
}));
vi.mock('@/pages/entregas/components/TrialReelPanel', () => ({ TrialReelPanel: () => null }));
vi.mock('@/pages/entregas/components/ScheduleButton', () => ({
  ScheduleButton: ({
    explainMissingInstagramAccount,
  }: {
    explainMissingInstagramAccount?: boolean;
  }) => <div data-testid="schedule-stub" data-explain={String(!!explainMissingInstagramAccount)} />,
}));
vi.mock('@/pages/entregas/components/PostAutomationSection', () => ({
  PostAutomationSection: () => null,
}));
vi.mock('@/pages/entregas/components/PublishErrorBlock', () => ({ PublishErrorBlock: () => null }));
vi.mock('@/pages/entregas/components/SuggestTimeButton', () => ({ SuggestTimeButton: () => null }));
vi.mock('@/pages/entregas/components/PostVersionHistorySheet', () => ({
  PostVersionHistorySheet: () => null,
}));
vi.mock('@/components/ui/date-time-picker', () => ({ DateTimePicker: () => null }));

import { toast } from 'sonner';
import * as store from '@/store';
import { PostEditorBody, type PostEditorBodyProps } from '../PostEditorBody';
import type { WorkflowPost } from '@/store';

const basePost = {
  id: 42,
  workflow_id: 10,
  conta_id: 'ws-1',
  cliente_id: 7,
  titulo: 'Post',
  conteudo: null,
  conteudo_plain: '',
  tipo: 'feed',
  ordem: 0,
  status: 'rascunho',
  platform: 'instagram',
  ig_caption: 'Legenda IG',
  tiktok_caption: null,
  is_express: false,
} as WorkflowPost;

function renderBody(over: Partial<PostEditorBodyProps> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
    hasInstagramAccount: false,
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
    ...over,
  };
  return render(
    <QueryClientProvider client={qc}>
      <PostEditorBody {...props} />
    </QueryClientProvider>,
  );
}

const target = (platform: 'instagram' | 'tiktok' | 'geral', caption: string | null = null) => ({
  id: platform.length,
  post_id: 42,
  platform,
  status: 'pendente' as const,
  caption,
});

describe('PostEditorBody, feature_multiplatform OFF (regressão: igual a hoje)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limitsMock.features = { feature_tiktok: true };
  });

  it('keeps PlatformSelector, no Destinos row, no tabs, no post_targets request', () => {
    renderBody();
    expect(screen.getByTestId('platform-selector-stub')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Destinos' })).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(store.getPostTargets).not.toHaveBeenCalled();
    expect(store.getBoardPlatforms).not.toHaveBeenCalled();
  });

  it('hides the caption without a connected Instagram account, shows it with one', () => {
    const { unmount } = renderBody({ hasInstagramAccount: false });
    expect(screen.queryByTestId('ig-caption-stub')).toBeNull();
    unmount();
    renderBody({ hasInstagramAccount: true });
    expect(screen.getByTestId('ig-caption-stub')).toBeInTheDocument();
  });

  it('TikTok panel keeps its own caption field and the schedule hint stays off', () => {
    renderBody({ post: { ...basePost, platform: 'both' } });
    expect(screen.getByTestId('tiktok-settings-stub')).toHaveAttribute(
      'data-hide-caption',
      'false',
    );
    expect(screen.getByTestId('schedule-stub')).toHaveAttribute('data-explain', 'false');
  });

  it('still loading limits (features null) behaves as OFF', () => {
    limitsMock.features = null;
    renderBody();
    expect(screen.getByTestId('platform-selector-stub')).toBeInTheDocument();
    expect(store.getPostTargets).not.toHaveBeenCalled();
  });
});

describe('PostEditorBody, feature_multiplatform ON', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limitsMock.features = { feature_tiktok: true, feature_multiplatform: true };
    vi.mocked(store.getBoardPlatforms).mockResolvedValue(['instagram', 'geral']);
  });

  it('caption tabs appear without a connected Instagram account; PlatformSelector is gone', async () => {
    vi.mocked(store.getPostTargets).mockResolvedValue([
      target('instagram'),
      target('geral', 'Texto geral'),
    ]);
    renderBody({ hasInstagramAccount: false });
    expect(await screen.findByRole('tab', { name: /Instagram/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Geral/ })).toBeInTheDocument();
    expect(screen.getByTestId('ig-caption-stub')).toBeInTheDocument();
    expect(screen.queryByTestId('platform-selector-stub')).toBeNull();
    expect(screen.getByTestId('schedule-stub')).toHaveAttribute('data-explain', 'true');
  });

  it('turning Geral on copies the first destination caption', async () => {
    vi.mocked(store.getPostTargets).mockResolvedValue([target('instagram')]);
    renderBody();
    const geral = await screen.findByRole('button', { name: /Geral/ });
    await waitFor(() => expect(geral).not.toBeDisabled());
    fireEvent.click(geral);
    await waitFor(() =>
      expect(store.addPostDestination).toHaveBeenCalledWith({
        postId: 42,
        contaId: 'ws-1',
        platform: 'geral',
        seedCaption: 'Legenda IG',
      }),
    );
  });

  it('turning Instagram back on does not overwrite a caption it already has', async () => {
    vi.mocked(store.getPostTargets).mockResolvedValue([target('geral', 'G')]);
    renderBody(); // basePost.ig_caption = 'Legenda IG'
    const ig = await screen.findByRole('button', { name: /Instagram/ });
    await waitFor(() => expect(ig).not.toBeDisabled());
    fireEvent.click(ig);
    await waitFor(() =>
      expect(store.addPostDestination).toHaveBeenCalledWith(
        expect.objectContaining({ platform: 'instagram', seedCaption: null }),
      ),
    );
  });

  it('turning a destination off removes it', async () => {
    vi.mocked(store.getPostTargets).mockResolvedValue([target('instagram'), target('geral')]);
    renderBody();
    const geral = await screen.findByRole('button', { name: /Geral/ });
    await waitFor(() => expect(geral).not.toBeDisabled());
    fireEvent.click(geral);
    await waitFor(() => expect(store.removePostDestination).toHaveBeenCalledWith(42, 'geral'));
  });

  it('TikTok settings move into the TikTok tab without their caption field', async () => {
    vi.mocked(store.getBoardPlatforms).mockResolvedValue(['instagram', 'tiktok']);
    vi.mocked(store.getPostTargets).mockResolvedValue([target('instagram'), target('tiktok')]);
    renderBody({ post: { ...basePost, platform: 'both' }, hasActiveTikTokAccount: true });
    expect(await screen.findByRole('tab', { name: /TikTok/ })).toBeInTheDocument();
    const panels = screen.getAllByTestId('tiktok-settings-stub');
    expect(panels).toHaveLength(1);
    expect(panels[0]).toHaveAttribute('data-hide-caption', 'true');
  });

  it('a copy longer than the new destination limit is cut, with one toast', async () => {
    vi.mocked(store.getBoardPlatforms).mockResolvedValue(['instagram', 'tiktok']);
    vi.mocked(store.getPostTargets).mockResolvedValue([target('tiktok')]);
    renderBody({
      post: { ...basePost, platform: 'tiktok', ig_caption: null, tiktok_caption: 'x'.repeat(3000) },
      hasActiveTikTokAccount: true,
    });
    const ig = await screen.findByRole('button', { name: /Instagram/ });
    await waitFor(() => expect(ig).not.toBeDisabled());
    fireEvent.click(ig);
    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.info).mock.calls[0][0]).toContain('cortada em 800 caracteres');
    await waitFor(() =>
      expect(store.addPostDestination).toHaveBeenCalledWith(
        expect.objectContaining({ platform: 'instagram', seedCaption: 'x'.repeat(2200) }),
      ),
    );
  });

  it('a published destination cannot be turned off', async () => {
    vi.mocked(store.getPostTargets).mockResolvedValue([target('instagram'), target('geral')]);
    renderBody({ post: { ...basePost, status: 'falha_publicacao', instagram_media_id: 'm1' } });
    const ig = await screen.findByRole('button', { name: /Instagram/ });
    await waitFor(() => expect(screen.getByRole('button', { name: /Geral/ })).not.toBeDisabled());
    expect(ig).toBeDisabled();
    expect(ig.parentElement).toHaveAttribute('title', 'Já publicado');
  });

  it('Post Express: no Destinos row', async () => {
    vi.mocked(store.getPostTargets).mockResolvedValue([target('instagram')]);
    renderBody({ post: { ...basePost, is_express: true } });
    await screen.findByRole('tab', { name: /Instagram/ });
    expect(screen.queryByRole('group', { name: 'Destinos' })).toBeNull();
  });
});
