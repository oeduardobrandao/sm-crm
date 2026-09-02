import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PostEditorBody, type PostEditorBodyProps } from '../PostEditorBody';
import type { PostEditSuggestion } from '../../../../store';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@/services/inlineImage', () => ({
  uploadInlineImage: vi.fn(),
  extractR2Keys: () => [],
  injectSignedUrls: (c: unknown) => c,
  resolveInlineImageUrls: vi.fn(async () => ({})),
}));

vi.mock('../../../../services/postMedia', () => ({
  listPostMedia: vi.fn(async () => [{ id: 1 }, { id: 2 }]),
}));

vi.mock('@/hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({ features: {}, limits: null, isLoading: false }),
}));

vi.mock('@/hooks/useStatusRegistry', async () => {
  const { buildStatusRegistry } = await import('../../statusRegistry');
  return { useStatusRegistry: () => buildStatusRegistry([]) };
});

vi.mock('@/utils/tiptapDiff', () => ({ computeTipTapDiff: vi.fn(() => ({})) }));

vi.mock('../PostEditor', () => ({
  PostEditor: () => <div data-testid="post-editor" />,
}));
vi.mock('../PropertyPanel', () => ({
  PropertyPanel: () => <div data-testid="property-panel" />,
}));
vi.mock('../PostCommentSummary', () => ({
  default: () => <div data-testid="comment-summary" />,
}));
vi.mock('../PostMediaGallery', () => ({
  PostMediaGallery: () => <div data-testid="media-gallery" />,
}));
vi.mock('../InstagramCaptionField', () => ({
  InstagramCaptionField: () => <div data-testid="ig-caption" />,
}));
vi.mock('../PlatformSelector', () => ({
  PlatformSelector: () => <div data-testid="platform-selector" />,
}));
vi.mock('../TikTokSettingsPanel', () => ({
  TikTokSettingsPanel: () => <div data-testid="tiktok-panel" />,
}));
vi.mock('../TrialReelPanel', () => ({
  TrialReelPanel: () => <div data-testid="trial-reel" />,
}));
vi.mock('../ScheduleButton', () => ({
  ScheduleButton: () => <div data-testid="schedule-button" />,
}));
vi.mock('../PostAutomationSection', () => ({
  PostAutomationSection: () => <div data-testid="automation-section" />,
}));
vi.mock('../PublishErrorBlock', () => ({
  PublishErrorBlock: () => <div data-testid="publish-error" />,
}));
vi.mock('../DiffView', () => ({ DiffView: () => <div data-testid="diff-view" /> }));
vi.mock('../ReadOnlyTipTap', () => ({
  ReadOnlyTipTap: () => <div data-testid="readonly-tiptap" />,
}));
vi.mock('@/components/ui/date-time-picker', () => ({
  DateTimePicker: () => <div data-testid="date-picker" />,
}));

const basePost = {
  id: 1,
  titulo: 'Post teste',
  tipo: 'carrossel',
  status: 'rascunho',
  platform: 'instagram',
  conteudo: null,
  ig_caption: '',
  scheduled_at: null,
  responsavel_id: null,
  instagram_media_id: null,
  publish_error: null,
  publish_error_code: null,
  media_autocleaned_at: null,
  instagram_permalink: null,
  tiktok_post_url: null,
  ig_trial_strategy: null,
  custom_status_id: null,
  property_values: [],
} as unknown as PostEditorBodyProps['post'];

function renderBody(overrides: Partial<PostEditorBodyProps> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props: PostEditorBodyProps = {
    post: basePost,
    templateId: 10,
    workflowId: 5,
    clienteId: 3,
    clientePosts: [],
    isExpanded: true,
    approvals: [],
    editSuggestion: null,
    membros: [],
    replyText: '',
    sendingReply: false,
    commentThreads: [],
    currentUserId: 'u1',
    currentUserRole: 'owner',
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
    onReplyToComment: vi.fn(async () => {}),
    onResolveThread: vi.fn(async () => {}),
    onReopenThread: vi.fn(async () => {}),
    onEditComment: vi.fn(async () => {}),
    onDeleteComment: vi.fn(async () => {}),
    editorVersion: 0,
    onAcceptSuggestion: vi.fn(),
    onRejectSuggestion: vi.fn(),
    ...overrides,
  };
  return render(
    <QueryClientProvider client={qc}>
      <PostEditorBody {...props} />
    </QueryClientProvider>,
  );
}

describe('PostEditorBody tabs', () => {
  it('opens on Conteúdo with all panels mounted but only the active one visible', () => {
    renderBody();
    expect(screen.getByRole('tab', { name: 'Conteúdo' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('post-editor')).toBeVisible();
    expect(screen.getByTestId('schedule-button')).not.toBeVisible();
    expect(screen.getByTestId('media-gallery')).not.toBeVisible();
    expect(screen.getByTestId('comment-summary')).not.toBeVisible();
  });

  it('reveals the Mídia panel when its tab is clicked, keeping the editor mounted', () => {
    renderBody();
    fireEvent.click(screen.getByRole('tab', { name: /Mídia/ }));
    expect(screen.getByTestId('media-gallery')).toBeVisible();
    expect(screen.getByTestId('post-editor')).not.toBeVisible();
    expect(screen.getByTestId('post-editor')).toBeInTheDocument();
  });

  it('shows the media count badge once the media query resolves', async () => {
    renderBody();
    await waitFor(() => expect(screen.getByRole('tab', { name: /Mídia/ })).toHaveTextContent('2'));
  });

  it('defaults to Publicação with a danger dot when the post has a publish error', () => {
    const { container } = renderBody({
      post: {
        ...basePost,
        status: 'falha_publicacao',
        publish_error: 'IG error',
      } as PostEditorBodyProps['post'],
    });
    expect(screen.getByRole('tab', { name: 'Publicação' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByTestId('publish-error')).toBeVisible();
    expect(container.querySelector('.drawer-post-tab-dot--danger')).not.toBeNull();
  });

  it('hides the Propriedades tab for a post avulso (no template)', () => {
    renderBody({ templateId: undefined, workflowId: null });
    expect(screen.queryByRole('tab', { name: 'Propriedades' })).toBeNull();
    expect(screen.queryByTestId('property-panel')).toBeNull();
  });

  it('shows the open-thread count on the Comentários tab', () => {
    renderBody({
      commentThreads: [
        { id: 1, status: 'active', comments: [] },
        { id: 2, status: 'resolved', comments: [] },
      ] as unknown as PostEditorBodyProps['commentThreads'],
    });
    expect(screen.getByRole('tab', { name: /Comentários/ })).toHaveTextContent('1');
  });

  it('marks Conteúdo with a warning dot when there is a pending client suggestion', () => {
    const { container } = renderBody({
      editSuggestion: {
        id: 9,
        changed_fields: ['conteudo'],
        suggested_conteudo: null,
        suggested_ig_caption: null,
        updated_at: new Date().toISOString(),
      } as unknown as PostEditSuggestion,
    });
    expect(container.querySelector('.drawer-post-tab-dot--warning')).not.toBeNull();
  });
});
