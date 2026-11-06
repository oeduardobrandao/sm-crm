import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  // MentionEditor (the Equipe composer of the Comentários tab) loads these for @-search.
  getMembros: vi.fn(async () => []),
  getClientes: vi.fn(async () => []),
  getTarefas: vi.fn(async () => []),
}));
vi.mock('@/services/postMedia', () => ({ listPostMedia: vi.fn(async () => []) }));
vi.mock('@/services/inlineImage', () => ({
  uploadInlineImage: vi.fn(),
  extractR2Keys: vi.fn(() => []),
  injectSignedUrls: vi.fn((c: unknown) => c),
  stripSignedUrls: vi.fn((c: unknown) => c),
  resolveInlineImageUrls: vi.fn(async () => ({})),
}));
const editorMock = vi.hoisted(() => ({ focusThread: vi.fn() }));
vi.mock('@/pages/entregas/components/PostEditor', async () => {
  const { useImperativeHandle } = await import('react');
  return {
    PostEditor: function PostEditorStub({
      variant,
      ref,
    }: {
      variant?: string;
      ref?: import('react').Ref<{ focusThread(id: number): void }>;
    }) {
      useImperativeHandle(ref, () => ({ focusThread: editorMock.focusThread }));
      return <div data-testid="post-editor-stub" data-variant={variant} />;
    },
  };
});
vi.mock('@/pages/entregas/components/PropertyPanel', () => ({ PropertyPanel: () => null }));
// Only the desktop section is stubbed: the phone tab renders the real DiscussaoTimeline.
vi.mock('@/pages/entregas/discussao/DiscussaoEquipe', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/pages/entregas/discussao/DiscussaoEquipe')>()),
  DiscussaoEquipe: () => null,
}));
vi.mock('@/pages/entregas/discussao/DiscutirNoChat', () => ({
  DiscutirNoChat: ({ variant, post }: { variant: string; post: unknown }) => (
    <button type="button" data-testid="bridge-stub" data-variant={variant}>
      {JSON.stringify(post)}
    </button>
  ),
}));
const discussaoMock = vi.hoisted(() => ({ naoLidas: 0 }));
beforeEach(() => {
  discussaoMock.naoLidas = 0;
});
vi.mock('@/pages/entregas/discussao/useDiscussao', () => ({
  useDiscussao: () => ({
    participacao: { seguindo: true, lastSeenCommentId: 0, implicito: false },
    isParticipant: true,
    naoLidas: discussaoMock.naoLidas,
    unreadAnchorId: null,
    send: vi.fn(async () => {}),
    sending: false,
    toggleSeguir: vi.fn(async () => {}),
    sectionRef: vi.fn(),
  }),
}));
vi.mock('@/pages/entregas/components/PostMediaGallery', () => ({
  PostMediaGallery: ({ variant }: { variant?: string }) => (
    <div data-testid="media-stub" data-variant={variant} />
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
vi.mock('@/pages/entregas/components/ReadOnlyTipTap', () => ({
  ReadOnlyTipTap: () => <div data-testid="texto-diff-stub" />,
}));

import { toast } from 'sonner';
import { PostEditorBody, type PostEditorBodyProps } from '../PostEditorBody';
import { TIPO_LABELS } from '../../postLabels';
import type { PhoneEditorChrome } from '../postEditorPhone/types';
import {
  getPostTargets,
  type CommentThreadWithComments,
  type PostEditSuggestion,
  type WorkflowPost,
} from '@/store';

const basePost = {
  id: 42,
  workflow_id: 10,
  conta_id: 'ws-1',
  cliente_id: 7,
  titulo: 'Lançamento outubro',
  conteudo: null,
  conteudo_plain: 'Primeiro parágrafo\nSegundo parágrafo',
  tipo: 'feed',
  ordem: 0,
  status: 'rascunho',
  platform: 'instagram',
  ig_caption: 'Legenda IG',
  tiktok_caption: null,
  is_express: false,
  scheduled_at: null,
} as unknown as WorkflowPost;

function renderPhone(
  over: Partial<PostEditorBodyProps> = {},
  chrome: Partial<PhoneEditorChrome> = {},
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const phone: PhoneEditorChrome = {
    onBack: vi.fn(),
    subtitle: 'Padaria Sol · Outubro',
    clientName: 'Padaria Sol',
    saving: false,
    menuActions: [
      { label: 'Copiar link', onSelect: vi.fn() },
      { label: 'Excluir post', destructive: true, onSelect: vi.fn() },
    ],
    ...chrome,
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
    layout: 'phone',
    phone,
    ...over,
  };
  const tree = (extra: Partial<PostEditorBodyProps>) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <PostEditorBody {...props} {...extra} />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const utils = render(tree({}));
  /** Re-renders the SAME editor instance with other props (no remount). */
  const rerenderWith = (extra: Partial<PostEditorBodyProps>) => utils.rerender(tree(extra));
  return { ...utils, props, phone, rerenderWith };
}

describe('PostEditorBody, phone layout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limitsMock.features = { feature_tiktok: true };
  });

  it('renders the header, the four tabs and every pane mounted, only Conteúdo visible', () => {
    renderPhone();
    expect(screen.getByRole('heading', { level: 1, name: 'Lançamento outubro' })).toBeVisible();
    expect(screen.getByText('Padaria Sol · Outubro')).toBeInTheDocument();
    const tabs = within(screen.getByRole('tablist', { name: 'Seções do post' }));
    for (const name of ['Conteúdo', 'Detalhes', 'Publicar', /Comentários/]) {
      expect(tabs.getByRole('tab', { name })).toBeInTheDocument();
    }
    const panes = screen.getAllByRole('tabpanel', { hidden: true });
    expect(panes).toHaveLength(4);
    expect(panes.filter((p) => !p.hidden)).toHaveLength(1);
    expect(screen.getByTestId('media-stub')).toHaveAttribute('data-variant', 'phone');
    expect(screen.getByTestId('post-editor-stub')).toHaveAttribute('data-variant', 'phone');
    expect(screen.getByText('2 parágrafos')).toBeInTheDocument();
  });

  it('keeps a caption draft across tab switches (panes are hidden, not unmounted)', async () => {
    const user = userEvent.setup();
    renderPhone();
    const caption = screen.getByRole('textbox', { name: 'Legenda do Instagram', hidden: true });
    await user.type(caption, 'rascunho não salvo');
    await user.click(screen.getByRole('tab', { name: 'Detalhes' }));
    expect(caption).not.toBeVisible();
    await user.click(screen.getByRole('tab', { name: 'Publicar' }));
    await user.click(screen.getByRole('tab', { name: 'Conteúdo' }));
    const again = screen.getByRole('textbox', { name: 'Legenda do Instagram' });
    expect(again).toBe(caption);
    expect(again).toHaveValue('rascunho não salvo');
  });

  it('Voltar calls the host back', async () => {
    const user = userEvent.setup();
    const { phone } = renderPhone();
    await user.click(screen.getByRole('button', { name: 'Voltar' }));
    expect(phone.onBack).toHaveBeenCalledTimes(1);
  });

  it('the "…" menu lists host actions with the editor ones before the destructive ones', async () => {
    const user = userEvent.setup();
    const { phone } = renderPhone();
    await user.click(screen.getByRole('button', { name: 'Mais ações do post' }));
    const sheet = await screen.findByRole('dialog');
    const labels = within(sheet)
      .getAllByRole('button')
      .map((b) => b.textContent?.trim())
      .filter(Boolean);
    const order = ['Copiar link', 'Histórico de versões', 'Histórico do post', 'Excluir post'];
    expect(labels.filter((l) => order.includes(l!))).toEqual(order);
    await user.click(within(sheet).getByRole('button', { name: 'Copiar link' }));
    expect(phone.menuActions[0].onSelect).toHaveBeenCalled();
  });

  it('picking a status in the status sheet calls onFieldChange', async () => {
    const user = userEvent.setup();
    const { props } = renderPhone();
    await user.click(screen.getByRole('button', { name: /Trocar status/ }));
    const sheet = await screen.findByRole('dialog');
    await user.click(within(sheet).getByRole('button', { name: /Em revisão/ }));
    expect(props.onFieldChange).toHaveBeenCalledWith('status', 'revisao_interna');
  });

  describe('bottom bar follows the status', () => {
    it('rascunho: no bottom bar', () => {
      renderPhone();
      expect(screen.queryByRole('button', { name: /Agendar publicação/ })).toBeNull();
      expect(screen.queryByRole('button', { name: /Enviar ao cliente/ })).toBeNull();
    });

    it('aprovado_interno with posts ready: Enviar ao cliente runs the host command', async () => {
      const user = userEvent.setup();
      const onSend = vi.fn();
      renderPhone(
        { post: { ...basePost, status: 'aprovado_interno' } },
        { sendToClient: { count: 1, sending: false, onSend } },
      );
      await user.click(screen.getByRole('button', { name: 'Enviar ao cliente' }));
      expect(onSend).toHaveBeenCalledTimes(1);
    });

    it('aprovado_cliente without date or caption: both blocked, "Falta" names them', () => {
      renderPhone({ post: { ...basePost, status: 'aprovado_cliente', ig_caption: '' } });
      expect(screen.getByRole('button', { name: /Agendar publicação/ })).toBeDisabled();
      expect(screen.getByRole('button', { name: /Publicar agora/ })).toBeDisabled();
      // Same copy as the desktop ScheduleButton, in the bar and in Publicar's checklist.
      expect(
        screen.getAllByText('Falta: data de publicação, legenda do Instagram', { exact: false })
          .length,
      ).toBeGreaterThan(0);
    });

    it('agendado: shows the date and Cancelar agendamento', () => {
      renderPhone({
        post: {
          ...basePost,
          status: 'agendado',
          scheduled_at: '2030-10-15T21:00:00.000Z',
        } as WorkflowPost,
      });
      expect(screen.getByText(/Agendado para/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Cancelar agendamento/ })).toBeEnabled();
    });

    it('falha: Tentar novamente', () => {
      renderPhone({ post: { ...basePost, status: 'falha_publicacao' } });
      expect(screen.getByRole('button', { name: /Tentar novamente/ })).toBeInTheDocument();
    });

    it('discussao=1 deep link opens Comentários on Equipe, reports once, and never focuses', () => {
      const onDiscussaoFocused = vi.fn();
      renderPhone({
        post: { ...basePost, status: 'falha_publicacao' },
        approvals: [
          {
            id: 1,
            post_id: 42,
            token: 't',
            action: 'mensagem',
            comentario: 'Oi',
            is_workspace_user: false,
            created_at: new Date(2026, 9, 21, 10, 0).toISOString(),
          },
        ] as never,
        focusRequest: 1,
        onDiscussaoFocused,
      });
      expect(screen.getByRole('tab', { name: /Comentários/ })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      // The newest message is the client's, which would open Cliente without the link.
      expect(screen.getByRole('button', { name: /^Equipe/ })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      expect(screen.getByRole('textbox', { name: 'Mensagem para a equipe' })).toBeVisible();
      expect(screen.getByRole('textbox', { name: 'Mensagem para a equipe' })).not.toHaveFocus();
      expect(onDiscussaoFocused).toHaveBeenCalledTimes(1);
    });

    it('a new discussao=1 request while the editor is open switches to Comentários', async () => {
      const user = userEvent.setup();
      const onDiscussaoFocused = vi.fn();
      const { rerenderWith } = renderPhone({
        post: { ...basePost, status: 'falha_publicacao' },
        onDiscussaoFocused,
      });
      expect(screen.getByRole('tab', { name: 'Conteúdo' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await user.click(screen.getByRole('tab', { name: 'Detalhes' }));

      rerenderWith({ focusRequest: 2 });

      expect(screen.getByRole('tab', { name: /Comentários/ })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(onDiscussaoFocused).toHaveBeenCalledTimes(1);
    });

    it('Comentários tab hides the bar and splits into Equipe and Cliente', async () => {
      const user = userEvent.setup();
      renderPhone({ post: { ...basePost, status: 'falha_publicacao' } });
      await user.click(screen.getByRole('tab', { name: /Comentários/ }));
      expect(screen.queryByRole('button', { name: /Tentar novamente/ })).toBeNull();
      expect(screen.getByRole('button', { name: /^Equipe/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cliente' })).toBeInTheDocument();
      // Nothing unread and no client message: opens on the team discussion.
      expect(screen.getByRole('textbox', { name: 'Mensagem para a equipe' })).toBeVisible();
      fireEvent.click(screen.getByRole('button', { name: 'Cliente' }));
      expect(screen.getByText(/Nenhuma mensagem com o cliente/)).toBeVisible();
      expect(screen.getByPlaceholderText('Responder ao cliente…')).toBeVisible();
      expect(
        screen.getByRole('textbox', { name: 'Mensagem para a equipe', hidden: true }),
      ).not.toBeVisible();
    });

    describe('Discutir no chat bridge', () => {
      async function openComentarios() {
        const user = userEvent.setup();
        await user.click(screen.getByRole('tab', { name: /Comentários/ }));
      }

      it('shows the sheet variant with the post when the plan has the team chat', async () => {
        limitsMock.features = { feature_team_chat: true };
        renderPhone();
        await openComentarios();
        const bridge = screen.getByTestId('bridge-stub');
        expect(bridge).toHaveAttribute('data-variant', 'sheet');
        expect(JSON.parse(bridge.textContent ?? '')).toEqual({
          id: 42,
          titulo: 'Lançamento outubro',
          workflowId: 10,
        });
      });

      it('sends a null workflowId for a standalone post', async () => {
        limitsMock.features = { feature_team_chat: true };
        renderPhone({ post: { ...basePost, workflow_id: null } });
        await openComentarios();
        expect(JSON.parse(screen.getByTestId('bridge-stub').textContent ?? '')).toMatchObject({
          workflowId: null,
        });
      });

      it('is absent without the team chat feature', async () => {
        limitsMock.features = { feature_team_chat: false };
        renderPhone();
        await openComentarios();
        expect(screen.queryByTestId('bridge-stub')).toBeNull();
      });

      it('is absent for an unsaved post (no id)', async () => {
        limitsMock.features = { feature_team_chat: true };
        renderPhone({ post: { ...basePost, id: undefined } });
        await openComentarios();
        expect(screen.queryByTestId('bridge-stub')).toBeNull();
      });
    });

    it('Comentários tab count is the unread team messages plus the client messages', () => {
      discussaoMock.naoLidas = 3;
      renderPhone({
        approvals: [
          {
            id: 1,
            post_id: 42,
            token: 't',
            action: 'mensagem',
            comentario: 'Oi',
            is_workspace_user: false,
            created_at: '2026-10-21T10:00:00Z',
          },
          {
            id: 2,
            post_id: 42,
            token: 't',
            action: 'mensagem',
            comentario: 'Olá',
            is_workspace_user: true,
            created_at: '2026-10-21T11:00:00Z',
          },
        ],
      });
      expect(screen.getByRole('tab', { name: 'Comentários, 5' })).toBeInTheDocument();
    });

    it('Ver no texto on a Roteiro thread opens Conteúdo and the Roteiro screen, then focuses it', async () => {
      const passage = {
        id: 5,
        post_id: 42,
        conta_id: 'ws-1',
        quoted_text: 'trecho do roteiro',
        status: 'active',
        created_by: 'user-1',
        resolved_by: null,
        created_at: '2026-10-21T10:00:00Z',
        resolved_at: null,
        field: 'conteudo',
        anchor_start: null,
        anchor_end: null,
        orphaned: false,
        post_comments: [
          {
            id: 50,
            thread_id: 5,
            author_id: 'user-1',
            content: 'Ajustar',
            created_at: '2026-10-21T10:00:00Z',
            updated_at: null,
          },
        ],
      } as unknown as CommentThreadWithComments;
      const user = userEvent.setup();
      renderPhone({ commentThreads: [passage] });
      await user.click(screen.getByRole('tab', { name: /Comentários/ }));
      await user.click(screen.getByRole('button', { name: /Ver no texto/ }));

      expect(screen.getByRole('tab', { name: 'Conteúdo' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(screen.getByRole('group', { name: 'Roteiro e briefing' })).toBeInTheDocument();
      await waitFor(() => expect(editorMock.focusThread).toHaveBeenCalledWith(5));
    });

    it('the general thread does not count as a passage comment or as a tab total', () => {
      const geral = {
        id: 1,
        post_id: 42,
        conta_id: 'ws-1',
        quoted_text: '',
        status: 'active',
        created_by: 'user-1',
        resolved_by: null,
        created_at: '2026-10-21T10:00:00Z',
        resolved_at: null,
        field: 'geral',
        anchor_start: null,
        anchor_end: null,
        orphaned: false,
        post_comments: [
          {
            id: 9,
            thread_id: 1,
            author_id: 'user-2',
            content: 'Oi equipe',
            created_at: '2026-10-21T10:00:00Z',
            updated_at: null,
          },
        ],
      } as unknown as CommentThreadWithComments;
      const passage = {
        ...geral,
        id: 2,
        field: 'ig_caption',
        quoted_text: 'trecho',
        post_comments: [],
      } as unknown as CommentThreadWithComments;
      renderPhone({ commentThreads: [geral] });
      expect(screen.queryByText(/comentário(s)? no texto/)).toBeNull();
      expect(screen.getByRole('tab', { name: 'Comentários' })).toBeInTheDocument();
      cleanup();
      renderPhone({ commentThreads: [geral, passage] });
      expect(screen.getByText('1 comentário no texto')).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Comentários' })).toBeInTheDocument();
    });
  });
});

describe('PostEditorBody, phone layout: colaboradores do Instagram', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limitsMock.features = { feature_tiktok: true };
  });

  const instagramSection = () => screen.queryByRole('region', { name: 'Instagram', hidden: true });

  it('feed + Instagram: o campo fica na seção Instagram do Publicar (fixture sem ig_collaborators)', () => {
    renderPhone();
    const section = instagramSection();
    expect(section).not.toBeNull();
    expect(
      within(section!).getByRole('group', { name: 'Colaboradores', hidden: true }),
    ).toBeTruthy();
    expect(within(section!).getByText('0 de 3')).toBeTruthy();
    // Não duplica na aba Conteúdo.
    expect(screen.getAllByRole('group', { name: 'Colaboradores', hidden: true })).toHaveLength(1);
  });

  it('sem seção Instagram em stories, só-TikTok ou sem conta', () => {
    const a = renderPhone({ post: { ...basePost, tipo: 'stories' } });
    expect(instagramSection()).toBeNull();
    a.unmount();
    const b = renderPhone({ post: { ...basePost, platform: 'tiktok' } });
    expect(instagramSection()).toBeNull();
    b.unmount();
    renderPhone({ hasInstagramAccount: false });
    expect(instagramSection()).toBeNull();
  });

  it('tipo → stories com colaboradores limpa a lista e avisa', () => {
    const { props } = renderPhone({ post: { ...basePost, ig_collaborators: ['dra.julia'] } });
    fireEvent.click(screen.getByRole('radio', { name: TIPO_LABELS.stories, hidden: true }));
    expect(props.onFieldChange).toHaveBeenCalledWith('tipo', 'stories');
    expect(props.onFieldChange).toHaveBeenCalledWith('ig_collaborators', []);
    expect(toast.info).toHaveBeenCalledWith(
      'Colaboradores removidos: Stories não aceitam colaboradores.',
    );
  });

  it('plataforma → só TikTok com colaboradores limpa a lista e avisa', () => {
    const { props } = renderPhone({ post: { ...basePost, ig_collaborators: ['dra.julia'] } });
    fireEvent.click(screen.getByRole('button', { name: 'stub-only-tiktok', hidden: true }));
    expect(props.onFieldChange).toHaveBeenCalledWith('platform', 'tiktok');
    expect(props.onFieldChange).toHaveBeenCalledWith('ig_collaborators', []);
    expect(toast.info).toHaveBeenCalledWith(
      'Colaboradores removidos: o post não vai mais para o Instagram.',
    );
  });

  it('Editar colaboradores abre o Publicar e foca o input', async () => {
    renderPhone({
      post: {
        ...basePost,
        status: 'falha_publicacao',
        publish_error_code: 'COLLABORATOR_INVALID',
        publish_error: 'x',
        ig_collaborators: ['dra.julia'],
        ig_collaborators_refused: ['dra.julia'],
      },
    });
    expect(screen.getByTestId('collab-chip-dra.julia')).toHaveAttribute('data-refused', 'true');
    fireEvent.click(
      screen.getByRole('button', { name: 'stub-editar-colaboradores', hidden: true }),
    );
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Publicar' })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    );
    await waitFor(() => expect(screen.getByPlaceholderText('Adicionar @usuário')).toHaveFocus());
  });
});

// ── Client edit suggestion: review card per field ───────────────────────────────

/** The client changed the texto; the team has since edited only the legenda (post 11807). */
const teamEditedCaptionOnly: PostEditSuggestion = {
  id: 11807,
  post_id: 42,
  suggested_conteudo: { type: 'doc', content: [] },
  suggested_conteudo_plain: 'Texto do cliente',
  suggested_ig_caption: null,
  original_conteudo: null,
  original_conteudo_plain: 'Primeiro parágrafo\nSegundo parágrafo',
  original_ig_caption: 'Legenda antiga',
  suggested_tiktok_caption: null,
  original_tiktok_caption: null,
  suggested_geral_caption: null,
  original_geral_caption: null,
  geral_target_id: null,
  tiktok_followed_ig: null,
  changed_fields: ['conteudo', 'conteudo_plain'],
  status: 'pending',
  updated_at: '2026-10-28T20:33:00Z',
};

/** The client rewrote the legenda, and the team rewrote it too since. */
const captionClash: PostEditSuggestion = {
  ...teamEditedCaptionOnly,
  id: 12000,
  suggested_conteudo: null,
  suggested_conteudo_plain: '',
  suggested_ig_caption: 'Legenda do cliente',
  original_conteudo_plain: 'Primeiro parágrafo\nSegundo parágrafo',
  original_ig_caption: 'Legenda base',
  changed_fields: ['ig_caption'],
};

/** Legacy phantom row: `conteudo` listed as changed against a NULL doc, nothing the CRM can apply. */
const nothingToApply: PostEditSuggestion = {
  ...teamEditedCaptionOnly,
  id: 13000,
  suggested_conteudo: null,
  suggested_conteudo_plain: null,
  suggested_ig_caption: null,
  changed_fields: ['conteudo'],
};

describe('PostEditorBody, client suggestion card (desktop)', () => {
  const renderCard = (suggestion: PostEditSuggestion, onAcceptSuggestion = vi.fn()) =>
    renderPhone({
      layout: 'desktop',
      post: { ...basePost, conteudo: { type: 'doc', content: [] } },
      editSuggestion: suggestion,
      onAcceptSuggestion,
    });

  beforeEach(() => {
    vi.clearAllMocks();
    limitsMock.features = { feature_tiktok: true };
  });

  it('team-only caption edit: no conflict, plain Aceitar, footer says what accept leaves alone', async () => {
    const user = userEvent.setup();
    const onAcceptSuggestion = vi.fn();
    renderCard(teamEditedCaptionOnly, onAcceptSuggestion);

    expect(
      screen.getByText(
        'Aceitar não muda a legenda do Instagram, que a equipe editou depois da sugestão.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/depois desta sugestão/)).toBeNull();
    expect(screen.getByTestId('texto-diff-stub')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Aceitar' }));
    expect(onAcceptSuggestion).toHaveBeenCalledWith(teamEditedCaptionOnly, ['texto'], []);
  });

  it('nothing to apply: Aceitar is disabled and Rejeitar still works', async () => {
    const user = userEvent.setup();
    const onAcceptSuggestion = vi.fn();
    const onRejectSuggestion = vi.fn();
    renderPhone({
      layout: 'desktop',
      post: { ...basePost, conteudo: { type: 'doc', content: [] } },
      editSuggestion: nothingToApply,
      onAcceptSuggestion,
      onRejectSuggestion,
    });

    const accept = screen.getByRole('button', { name: 'Aceitar' });
    expect(accept).toBeDisabled();
    await user.click(accept);
    expect(onAcceptSuggestion).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Rejeitar' }));
    expect(onRejectSuggestion).toHaveBeenCalledWith(nothingToApply.id);
  });

  it('caption clash: amber line, "Aceitar…", diff defaults to live then flips to the client base', async () => {
    const user = userEvent.setup();
    const onAcceptSuggestion = vi.fn();
    renderCard(captionClash, onAcceptSuggestion);

    expect(
      screen.getByText('A equipe editou a legenda depois desta sugestão.'),
    ).toBeInTheDocument();
    // What accepting would do: the team's current caption is struck out.
    const card = screen
      .getByText('A equipe editou a legenda depois desta sugestão.')
      .closest('div.space-y-2')!;
    expect(card.textContent).toContain('Legenda IG');
    expect(card.textContent).not.toContain('Legenda base');
    expect(screen.getByRole('button', { name: 'O que muda ao aceitar' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.click(screen.getByRole('button', { name: 'Só o que o cliente mudou' }));
    expect(card.textContent).toContain('Legenda base');
    expect(card.textContent).not.toContain('Legenda IG');

    // Conflicts never accept in one click: the dialog comes first.
    await user.click(screen.getByRole('button', { name: 'Aceitar…' }));
    expect(onAcceptSuggestion).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', { name: 'Aceitar a sugestão?' });
    expect(within(dialog).getByRole('radio', { name: 'Manter a versão da equipe' })).toBeChecked();
    // Keeping the team caption leaves nothing to apply.
    expect(within(dialog).getByRole('button', { name: 'Aceitar sugestão' })).toBeDisabled();
    await user.click(within(dialog).getByRole('radio', { name: 'Usar a versão do cliente' }));
    await user.click(within(dialog).getByRole('button', { name: 'Aceitar sugestão' }));
    expect(onAcceptSuggestion).toHaveBeenCalledWith(captionClash, ['legenda'], ['legenda']);
  });

  it('lists the fields the client left alone', () => {
    renderCard(teamEditedCaptionOnly);
    expect(
      screen.getByText('Legenda do Instagram: sem alterações do cliente.'),
    ).toBeInTheDocument();
  });

  describe('TikTok and Geral captions', () => {
    /** The client rewrote the TikTok and the Geral captions; the team has since edited Geral. */
    const tiktokAndGeral: PostEditSuggestion = {
      ...teamEditedCaptionOnly,
      id: 14000,
      suggested_conteudo: null,
      suggested_conteudo_plain: '',
      suggested_tiktok_caption: 'TikTok do cliente',
      original_tiktok_caption: null,
      suggested_geral_caption: 'Geral do cliente',
      original_geral_caption: 'Geral base',
      geral_target_id: 5,
      changed_fields: ['tiktok_caption', 'geral_caption'],
    };
    const bothPost = { ...basePost, platform: 'both', conteudo: { type: 'doc', content: [] } };
    afterEach(() => {
      vi.mocked(getPostTargets).mockImplementation(async () => []);
    });

    it('Geral still loading: the field says so and Aceitar stays disabled', async () => {
      vi.mocked(getPostTargets).mockImplementation(() => new Promise(() => {}));
      renderPhone({
        layout: 'desktop',
        post: bothPost as WorkflowPost,
        editSuggestion: tiktokAndGeral,
      });

      expect(await screen.findByText('Carregando a legenda Geral atual…')).toBeInTheDocument();
      expect(screen.getByText('Legenda do TikTok')).toBeInTheDocument();
      expect(screen.getByText('Legenda Geral')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Aceitar' })).toBeDisabled();
      expect(getPostTargets).toHaveBeenCalledWith(42);
    });

    it('Geral loaded in conflict: amber line, and the dialog acknowledges it per field', async () => {
      const user = userEvent.setup();
      const onAcceptSuggestion = vi.fn();
      vi.mocked(getPostTargets).mockResolvedValue([
        { id: 3, post_id: 42, platform: 'instagram', status: 'pendente', caption: null },
        { id: 4, post_id: 42, platform: 'tiktok', status: 'pendente', caption: null },
        { id: 5, post_id: 42, platform: 'geral', status: 'pendente', caption: 'Geral da equipe' },
      ]);
      renderPhone({
        layout: 'desktop',
        post: bothPost as WorkflowPost,
        editSuggestion: tiktokAndGeral,
        onAcceptSuggestion,
      });

      expect(
        await screen.findByText('A equipe editou a legenda Geral depois desta sugestão.'),
      ).toBeInTheDocument();
      expect(
        screen.getByText('Texto do post e legenda do Instagram: sem alterações do cliente.'),
      ).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Aceitar…' }));
      const dialog = await screen.findByRole('dialog', { name: 'Aceitar a sugestão?' });
      // TikTok has no conflict: listed as applied.
      expect(within(dialog).getByText('Legenda do TikTok')).toBeInTheDocument();
      await user.click(within(dialog).getByRole('radio', { name: 'Usar a versão do cliente' }));
      await user.click(within(dialog).getByRole('button', { name: 'Aceitar sugestão' }));
      expect(onAcceptSuggestion).toHaveBeenCalledWith(
        tiktokAndGeral,
        ['legenda_tiktok', 'legenda_geral'],
        ['legenda_geral'],
      );
    });

    it('Geral removed from the post: not offered, the rest still accepts', async () => {
      const user = userEvent.setup();
      const onAcceptSuggestion = vi.fn();
      vi.mocked(getPostTargets).mockResolvedValue([
        { id: 3, post_id: 42, platform: 'instagram', status: 'pendente', caption: null },
        { id: 4, post_id: 42, platform: 'tiktok', status: 'pendente', caption: null },
      ]);
      renderPhone({
        layout: 'desktop',
        post: bothPost as WorkflowPost,
        editSuggestion: tiktokAndGeral,
        onAcceptSuggestion,
      });

      expect(
        await screen.findByText(
          'O destino Geral foi removido do post. Esta parte da sugestão não pode ser aplicada.',
        ),
      ).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Aceitar' }));
      expect(onAcceptSuggestion).toHaveBeenCalledWith(tiktokAndGeral, ['legenda_tiktok'], []);
    });

    it('warns on the Instagram caption when TikTok followed it and now has its own', () => {
      renderCard({
        ...captionClash,
        original_ig_caption: 'Legenda IG',
        tiktok_followed_ig: true,
      });
      expect(screen.queryByText(/O TikTok seguia o Instagram/)).toBeNull();
      cleanup();
      renderPhone({
        layout: 'desktop',
        post: { ...basePost, tiktok_caption: 'Legenda própria do TikTok' } as WorkflowPost,
        editSuggestion: {
          ...captionClash,
          original_ig_caption: 'Legenda IG',
          tiktok_followed_ig: true,
        },
      });
      expect(
        screen.getByText(
          'O TikTok seguia o Instagram quando o cliente sugeriu; agora tem legenda própria e não muda.',
        ),
      ).toBeInTheDocument();
    });
  });
});

describe('PostEditorBody, aviso na legenda quando o cliente sugeriu outra', () => {
  const NOTE = 'O cliente sugeriu uma nova legenda. Revise a sugestão antes de editar.';
  const scrollIntoView = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    limitsMock.features = { feature_tiktok: true };
    Element.prototype.scrollIntoView = scrollIntoView;
  });

  it('desktop: aparece sobre o campo quando a sugestão mexe na legenda, e "Ver sugestão" leva ao cartão', async () => {
    const user = userEvent.setup();
    renderPhone({ layout: 'desktop', editSuggestion: captionClash });

    const note = screen.getByText(NOTE);
    const field = screen.getByLabelText('Legenda do Instagram');
    // The note sits above the caption field.
    expect(note.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Ver sugestão' }));
    const card = screen.getByText('Sugestão do cliente').closest('div.rounded-lg') as HTMLElement;
    expect(scrollIntoView).toHaveBeenCalled();
    expect(scrollIntoView.mock.contexts.at(-1)).toBe(card);
    expect(card).toHaveFocus();
  });

  it('desktop: não aparece quando a sugestão só mexe no texto', () => {
    renderPhone({ layout: 'desktop', editSuggestion: teamEditedCaptionOnly });
    expect(screen.queryByText(NOTE)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ver sugestão' })).toBeNull();
  });

  it('desktop: não aparece sem sugestão pendente', () => {
    renderPhone({ layout: 'desktop' });
    expect(screen.queryByText(NOTE)).toBeNull();
  });

  it('celular: "Ver sugestão" abre a folha da sugestão', async () => {
    const user = userEvent.setup();
    renderPhone({ editSuggestion: captionClash });

    expect(screen.getByText(NOTE)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ver sugestão' }));
    expect(await screen.findByRole('dialog', { name: 'Sugestão do cliente' })).toBeInTheDocument();
  });
});

describe('PostEditorBody, client suggestion sheet (phone)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limitsMock.features = { feature_tiktok: true };
  });

  it('caption clash: the sheet shows the conflict, and the dialog opens after the sheet closes', async () => {
    const user = userEvent.setup();
    const onAcceptSuggestion = vi.fn();
    renderPhone({ editSuggestion: captionClash, onAcceptSuggestion });

    await user.click(screen.getByRole('button', { name: /Roteiro e briefing/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Sugestão do cliente' });
    expect(
      within(sheet).getByText('A equipe editou a legenda depois desta sugestão.'),
    ).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Aceitar…' }));

    const dialog = await screen.findByRole('dialog', { name: 'Aceitar a sugestão?' });
    await user.click(within(dialog).getByRole('radio', { name: 'Usar a versão do cliente' }));
    await user.click(within(dialog).getByRole('button', { name: 'Aceitar sugestão' }));
    expect(onAcceptSuggestion).toHaveBeenCalledWith(captionClash, ['legenda'], ['legenda']);
  });

  it('nothing to apply: Aceitar is disabled in the sheet and Rejeitar still works', async () => {
    const user = userEvent.setup();
    const onAcceptSuggestion = vi.fn();
    const onRejectSuggestion = vi.fn();
    renderPhone({ editSuggestion: nothingToApply, onAcceptSuggestion, onRejectSuggestion });

    await user.click(screen.getByRole('button', { name: /Roteiro e briefing/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Sugestão do cliente' });
    expect(within(sheet).getByRole('button', { name: 'Aceitar' })).toBeDisabled();
    await user.click(within(sheet).getByRole('button', { name: 'Rejeitar' }));
    await waitFor(() => expect(onRejectSuggestion).toHaveBeenCalledWith(nothingToApply.id));
    expect(onAcceptSuggestion).not.toHaveBeenCalled();
  });

  it('TikTok caption: the sheet names it and Aceitar sends legenda_tiktok', async () => {
    const user = userEvent.setup();
    const onAcceptSuggestion = vi.fn();
    const tiktokOnly: PostEditSuggestion = {
      ...captionClash,
      id: 15000,
      suggested_ig_caption: null,
      suggested_tiktok_caption: 'TikTok do cliente',
      original_tiktok_caption: '',
      changed_fields: ['tiktok_caption'],
    };
    renderPhone({
      post: { ...basePost, platform: 'both' } as WorkflowPost,
      editSuggestion: tiktokOnly,
      onAcceptSuggestion,
    });

    await user.click(screen.getByRole('button', { name: /Roteiro e briefing/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Sugestão do cliente' });
    expect(within(sheet).getByRole('heading', { name: 'Legenda do TikTok' })).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Aceitar' }));
    await waitFor(() =>
      expect(onAcceptSuggestion).toHaveBeenCalledWith(tiktokOnly, ['legenda_tiktok'], []),
    );
  });

  it('team-only caption edit: footer in the sheet, plain Aceitar sends the changed field', async () => {
    const user = userEvent.setup();
    const onAcceptSuggestion = vi.fn();
    renderPhone({ editSuggestion: teamEditedCaptionOnly, onAcceptSuggestion });

    await user.click(screen.getByRole('button', { name: /Roteiro e briefing/ }));
    const sheet = await screen.findByRole('dialog', { name: 'Sugestão do cliente' });
    expect(
      within(sheet).getByText(
        'Aceitar não muda a legenda do Instagram, que a equipe editou depois da sugestão.',
      ),
    ).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: 'Aceitar' }));
    await waitFor(() =>
      expect(onAcceptSuggestion).toHaveBeenCalledWith(teamEditedCaptionOnly, ['texto'], []),
    );
  });
});
