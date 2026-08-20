import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { InstagramCommentAutomation, WorkflowPost } from '../../../../store';

// t devolve a CHAVE, mesmo padrao do AutomacoesPage.test/AutomationFormDialog.test.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key,
    i18n: { language: 'pt' },
  }),
}));

let mockFeatures: Record<string, boolean> | null = { feature_instagram_automation: true };
vi.mock('@/hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({ features: mockFeatures }),
}));

const { mockGetAutomationsForPost } = vi.hoisted(() => ({
  mockGetAutomationsForPost: vi.fn(),
}));
vi.mock('../../../../store', async () => {
  const actual = await vi.importActual<typeof import('../../../../store')>('../../../../store');
  return { ...actual, getAutomationsForPost: mockGetAutomationsForPost };
});

// The real dialog is loaded through React.lazy; this stand-in reports the props
// that matter (open, editing, initialTarget) straight into the DOM.
vi.mock('@/pages/automacoes/AutomationFormDialog', () => ({
  default: ({
    open,
    editing,
    initialTarget,
    elevated,
  }: {
    open: boolean;
    editing: InstagramCommentAutomation | null;
    initialTarget?: unknown;
    elevated?: boolean;
  }) =>
    open ? (
      <div data-testid="automation-dialog">
        <span data-testid="dialog-editing">{editing?.id ?? 'none'}</span>
        <span data-testid="dialog-initial-target">{JSON.stringify(initialTarget ?? null)}</span>
        <span data-testid="dialog-elevated">{String(elevated ?? false)}</span>
      </div>
    ) : null,
}));

import { PostAutomationSection } from '../PostAutomationSection';

function makePost(overrides?: Partial<WorkflowPost>): WorkflowPost {
  return {
    id: 501,
    workflow_id: 10,
    titulo: 'Carrossel de agosto',
    conteudo: null,
    conteudo_plain: '',
    tipo: 'carrossel',
    ordem: 0,
    status: 'aprovado_cliente',
    platform: 'instagram',
    ...overrides,
  };
}

function makeAutomation(over?: Partial<InstagramCommentAutomation>): InstagramCommentAutomation {
  return {
    id: 'auto-1',
    conta_id: 'conta-1',
    client_id: 7,
    name: 'Promo de agosto',
    ig_media_id: null,
    media_permalink: null,
    media_caption: 'Carrossel de agosto',
    workflow_post_id: 501,
    pending_post_deleted_at: null,
    keywords: ['quero'],
    dm_message: 'Segue o link!',
    public_reply: null,
    ativo: true,
    dms_sent_count: 0,
    last_triggered_at: null,
    created_at: '2026-08-19T00:00:00.000Z',
    updated_at: '2026-08-19T00:00:00.000Z',
    ...over,
  };
}

function tree(props?: {
  post?: WorkflowPost;
  currentUserRole?: 'owner' | 'admin' | 'agent';
  hasInstagramAccount?: boolean;
}) {
  return (
    <PostAutomationSection
      post={props?.post ?? makePost()}
      clienteId={7}
      currentUserRole={props?.currentUserRole ?? 'owner'}
      hasInstagramAccount={props?.hasInstagramAccount ?? true}
    />
  );
}

function renderSection(props?: {
  post?: WorkflowPost;
  currentUserRole?: 'owner' | 'admin' | 'agent';
  hasInstagramAccount?: boolean;
}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(<QueryClientProvider client={qc}>{tree(props)}</QueryClientProvider>);
  return {
    qc,
    ...utils,
    /** Re-renders through the SAME QueryClient, so a key change is a real cache
     * miss rather than a fresh cache. */
    rerenderWith: (next: Parameters<typeof tree>[0]) =>
      utils.rerender(<QueryClientProvider client={qc}>{tree(next)}</QueryClientProvider>),
  };
}

describe('PostAutomationSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFeatures = { feature_instagram_automation: true };
    mockGetAutomationsForPost.mockResolvedValue([]);
  });

  it('stays out of the drawer when the plan does not include automations', async () => {
    mockFeatures = { feature_instagram_automation: false };
    const { container } = renderSection();

    expect(container.textContent).toBe('');
    expect(mockGetAutomationsForPost).not.toHaveBeenCalled();
  });

  it('stays out of the drawer while the workspace limits are still unknown', () => {
    mockFeatures = null;
    const { container } = renderSection();

    expect(container.textContent).toBe('');
  });

  it('stays out of the drawer for stories, which expire before a DM is worth sending', () => {
    const { container } = renderSection({ post: makePost({ tipo: 'stories' }) });

    expect(container.textContent).toBe('');
  });

  it('stays out of the drawer for a TikTok-only post, which never gets an IG media id', () => {
    const { container } = renderSection({ post: makePost({ platform: 'tiktok' }) });

    expect(container.textContent).toBe('');
  });

  it('stays out of the drawer when the client has no Instagram connected', () => {
    const { container } = renderSection({ hasInstagramAccount: false });

    expect(container.textContent).toBe('');
  });

  it('still shows for a cross-posted (instagram + tiktok) post', async () => {
    renderSection({ post: makePost({ platform: 'both' }) });

    expect(await screen.findByText('postSection.title')).toBeTruthy();
  });

  it('queries by the post id alone while the post has not published', async () => {
    renderSection();

    await waitFor(() => expect(mockGetAutomationsForPost).toHaveBeenCalledWith(501, null));
  });

  it('queries by the media id too once the post has published', async () => {
    renderSection({ post: makePost({ instagram_media_id: '17900000000000001' }) });

    await waitFor(() =>
      expect(mockGetAutomationsForPost).toHaveBeenCalledWith(501, '17900000000000001'),
    );
  });

  it('refetches when the post publishes under an open drawer', async () => {
    const { rerenderWith } = renderSection();

    await waitFor(() => expect(mockGetAutomationsForPost).toHaveBeenCalledWith(501, null));

    // The media id lives inside the queryFn closure, so it has to be part of the
    // key too -- otherwise the cache keeps serving the pre-publish list.
    rerenderWith({ post: makePost({ instagram_media_id: '17900000000000001' }) });

    await waitFor(() =>
      expect(mockGetAutomationsForPost).toHaveBeenCalledWith(501, '17900000000000001'),
    );
    expect(mockGetAutomationsForPost).toHaveBeenCalledTimes(2);
  });

  it('holds a placeholder instead of the empty hint while the list is loading', async () => {
    mockGetAutomationsForPost.mockReturnValue(new Promise(() => {}));
    renderSection();

    expect(await screen.findByText('postSection.loading')).toBeTruthy();
    expect(screen.queryByText('postSection.emptyHint')).toBeNull();
  });

  it('says the list failed instead of pretending the post has no automation', async () => {
    mockGetAutomationsForPost.mockRejectedValue(new Error('boom'));
    renderSection();

    expect(await screen.findByText('postSection.loadError')).toBeTruthy();
    expect(screen.queryByText('postSection.emptyHint')).toBeNull();
    // Creating one is still on the table.
    expect(screen.getByRole('button', { name: 'postSection.createForPost' })).toBeTruthy();
  });

  it('shows the empty hint when the post has no automation yet', async () => {
    renderSection();

    expect(await screen.findByText('postSection.emptyHint')).toBeTruthy();
  });

  it('lists each automation with its status badge, and flags the ones still awaiting publication', async () => {
    mockGetAutomationsForPost.mockResolvedValue([
      makeAutomation({ id: 'auto-1', name: 'Ativa pendente' }),
      makeAutomation({
        id: 'auto-2',
        name: 'Pausada publicada',
        ativo: false,
        ig_media_id: '17900000000000001',
        workflow_post_id: null,
      }),
    ]);
    renderSection();

    expect(await screen.findByText('Ativa pendente')).toBeTruthy();
    expect(screen.getByText('Pausada publicada')).toBeTruthy();
    expect(screen.getByText('status.active')).toBeTruthy();
    expect(screen.getByText('status.inactive')).toBeTruthy();
    // Only the unpublished target is "awaiting publication".
    expect(screen.getAllByText('pendingBadge')).toHaveLength(1);
    expect(screen.queryByText('postSection.emptyHint')).toBeNull();
  });

  it('does not call a published automation pending just because the internal link is gone', async () => {
    mockGetAutomationsForPost.mockResolvedValue([
      makeAutomation({ ig_media_id: '17900000000000001', workflow_post_id: 501 }),
    ]);
    renderSection();

    expect(await screen.findByText('Promo de agosto')).toBeTruthy();
    expect(screen.queryByText('pendingBadge')).toBeNull();
  });

  it('seeds the dialog with the production post when creating from an unpublished post', async () => {
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: 'postSection.createForPost' }));

    expect(await screen.findByTestId('automation-dialog')).toBeTruthy();
    expect(screen.getByTestId('dialog-editing').textContent).toBe('none');
    expect(JSON.parse(screen.getByTestId('dialog-initial-target').textContent!)).toEqual({
      clientId: 7,
      target: { kind: 'production', workflow_post_id: 501, titulo: 'Carrossel de agosto' },
    });
  });

  it('seeds the dialog with the live media once the post has published', async () => {
    renderSection({
      post: makePost({
        instagram_media_id: '17900000000000001',
        instagram_permalink: 'https://instagram.com/p/teste',
        ig_caption: 'Legenda publicada',
      }),
    });

    fireEvent.click(await screen.findByRole('button', { name: 'postSection.createForPost' }));

    await screen.findByTestId('automation-dialog');
    expect(JSON.parse(screen.getByTestId('dialog-initial-target').textContent!)).toEqual({
      clientId: 7,
      target: {
        kind: 'published',
        ig_media_id: '17900000000000001',
        media_permalink: 'https://instagram.com/p/teste',
        media_caption: 'Legenda publicada',
        // The internal link travels along, so the post keeps listing it.
        workflow_post_id: 501,
      },
    });
  });

  it('falls back to the titulo when the published post carries no caption', async () => {
    renderSection({
      post: makePost({ instagram_media_id: '17900000000000001', ig_caption: '' }),
    });

    fireEvent.click(await screen.findByRole('button', { name: 'postSection.createForPost' }));

    await screen.findByTestId('automation-dialog');
    expect(
      JSON.parse(screen.getByTestId('dialog-initial-target').textContent!).target.media_caption,
    ).toBe('Carrossel de agosto');
  });

  it('always asks the dialog to stack above the drawer it lives in', async () => {
    mockGetAutomationsForPost.mockResolvedValue([makeAutomation()]);
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: 'postSection.createForPost' }));
    expect((await screen.findByTestId('dialog-elevated')).textContent).toBe('true');

    // Same on the edit path: both open on top of the drawer panel.
    fireEvent.click(screen.getByRole('button', { name: /Promo de agosto/ }));
    expect((await screen.findByTestId('dialog-elevated')).textContent).toBe('true');
  });

  it('opens an existing automation in edit mode, without a seeded target', async () => {
    mockGetAutomationsForPost.mockResolvedValue([makeAutomation()]);
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: /Promo de agosto/ }));

    expect(await screen.findByTestId('automation-dialog')).toBeTruthy();
    expect(screen.getByTestId('dialog-editing').textContent).toBe('auto-1');
    expect(screen.getByTestId('dialog-initial-target').textContent).toBe('null');
  });

  it('gives an agent the list but no way to create or edit', async () => {
    mockGetAutomationsForPost.mockResolvedValue([makeAutomation()]);
    renderSection({ currentUserRole: 'agent' });

    expect(await screen.findByText('Promo de agosto')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'postSection.createForPost' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Promo de agosto/ })).toBeNull();
  });

  it('lets an admin create, same as an owner', async () => {
    renderSection({ currentUserRole: 'admin' });

    expect(await screen.findByRole('button', { name: 'postSection.createForPost' })).toBeTruthy();
  });
});
