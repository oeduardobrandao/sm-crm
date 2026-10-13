import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach, beforeAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { BoardCard } from '../../hooks/useEntregasData';
import { makeCan, fakeMembership } from '@/test/makeCan';
import { installPointerEvent } from '@/components/mobile/__tests__/pointer';

// Phone branch of WorkflowDrawer (PLAN C3.7). jsdom's matchMedia reports no match, so
// useIsDesktop(768) is false here: no mock needed. The desktop suites mock it to true.
// Leaves are stubbed so only the drawer's phone shell and its wiring are exercised; the
// kit sheets need a router (useSheetHistory), so renders go through MemoryRouter.

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

vi.mock('@/hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({
    limits: null,
    features: null,
    planName: null,
    isLoading: false,
    isUnlimited: true,
  }),
}));

// Inert dnd-kit: the handle's listeners are asserted by presence, not by dragging.
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  closestCenter: () => null,
  PointerSensor: class {},
  TouchSensor: class {},
  useSensor: () => ({}),
  useSensors: (...sensors: unknown[]) => sensors,
}));
vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useSortable: () => ({
    attributes: { 'aria-roledescription': 'sortable' },
    listeners: { onPointerDown: () => {} },
    setNodeRef: () => {},
    transform: null,
    transition: undefined,
    isDragging: false,
  }),
  verticalListSortingStrategy: () => null,
  arrayMove: (arr: unknown[]) => arr,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: null }),
        }),
      }),
    }),
  },
}));

vi.mock('@/store', () => ({
  getWorkflowPostsWithProperties: vi.fn(),
  addWorkflowPost: vi.fn(),
  updateWorkflowPost: vi.fn(),
  isFinalClientApprovalCycle: vi.fn(() => true),
  cardAutoScheduleGates: vi.fn(() => ({ autoPublishOnApproval: true, isFinalApprovalCycle: true })),
  removeWorkflowPost: vi.fn(),
  reorderWorkflowPosts: vi.fn(),
  sendPostsToCliente: vi.fn(),
  sendSelectedPostsToCliente: vi.fn(),
  isSendableFromSelection: (s: string) =>
    !['enviado_cliente', 'aprovado_cliente', 'agendado', 'postado', 'falha_publicacao'].includes(s),
  getPostApprovals: vi.fn(async () => []),
  getPostStatusEvents: vi.fn(async () => []),
  getPostProcessEvents: vi.fn(async () => []),
  getPostStatusDefinitions: vi.fn(async () => []),
  replyToPostApproval: vi.fn(),
  getPostCommentThreads: vi.fn(async () => []),
  createCommentThread: vi.fn(),
  saveIgCaption: vi.fn(),
  addPostComment: vi.fn(),
  updatePostComment: vi.fn(),
  deletePostComment: vi.fn(),
  resolveCommentThread: vi.fn(),
  reopenCommentThread: vi.fn(),
  deleteCommentThread: vi.fn(),
  getWorkspaceUsers: vi.fn(async () => []),
  getPostEditSuggestions: vi.fn(async () => []),
  acceptEditSuggestion: vi.fn(),
  rejectEditSuggestion: vi.fn(),
  getClientePosts: vi.fn(async () => []),
  syncMentions: vi.fn(),
}));

vi.mock('@/services/postMedia', () => ({ listPostMedia: vi.fn(async () => []) }));
vi.mock('@/store/postReferences', () => ({
  getPostReferenceCounts: vi.fn(async () => ({})),
}));
vi.mock('@/lib/copyAppLink', () => ({ copyAppLink: vi.fn(async () => {}) }));

// The editor belongs to C4: the stub only reports whether the drawer expanded the post.
vi.mock('@/pages/entregas/components/PostEditorBody', () => ({
  PostEditorBody: ({ post, isExpanded }: { post: { id: number }; isExpanded: boolean }) => (
    <div data-testid={`editor-${post.id}`} data-expanded={String(isExpanded)} />
  ),
}));
vi.mock('@/pages/entregas/components/PostMediaGallery', () => ({
  hasVideoMissingThumbnail: () => false,
}));
vi.mock('@/pages/entregas/components/WorkflowCalendarView', () => ({
  WorkflowCalendarView: () => <div data-testid="workflow-calendar-view-stub" />,
}));
vi.mock('@/pages/entregas/components/WorkflowGridView', () => ({
  WorkflowGridView: () => <div data-testid="workflow-grid-view-stub" />,
}));
vi.mock('@/pages/entregas/components/WorkflowHistoryView', () => ({
  WorkflowHistoryView: () => <div data-testid="workflow-history-view-stub" />,
}));
vi.mock('@/pages/entregas/components/MovePostsToFluxoDialog', () => ({
  MovePostsToFluxoDialog: ({ open, postIds }: { open: boolean; postIds: number[] }) =>
    open ? <div data-testid="move-dialog">{postIds.join(',')}</div> : null,
}));
vi.mock('@/pages/entregas/components/DetachPostsDialog', () => ({
  DetachPostsDialog: ({ posts }: { posts: { id: number }[] }) => (
    <div data-testid="detach-dialog">{posts.map((p) => p.id).join(',')}</div>
  ),
}));
vi.mock('@/pages/entregas/components/DuplicateDialog', () => ({
  DuplicateDialog: ({ target }: { target: { postId: number } | null }) =>
    target ? <div data-testid="duplicate-dialog">{target.postId}</div> : null,
}));

import { WorkflowDrawer } from '../WorkflowDrawer';
import { getWorkflowPostsWithProperties, sendPostsToCliente, getPostStatusEvents } from '@/store';
import { copyAppLink } from '@/lib/copyAppLink';
import { TIPO_LABELS } from '../../postLabels';

const mockGetPosts = vi.mocked(getWorkflowPostsWithProperties);
const mockSend = vi.mocked(sendPostsToCliente);
const mockCopyAppLink = vi.mocked(copyAppLink);
const mockStatusEvents = vi.mocked(getPostStatusEvents);

const basePost = {
  workflow_id: 10,
  conteudo: null,
  conteudo_plain: '',
  ordem: 0,
  responsavel_id: null,
  ig_caption: null,
  platform: 'instagram',
  published_at: null,
  created_at: '2026-10-01T12:00:00Z',
};

function makePosts() {
  return [
    {
      ...basePost,
      id: 1,
      titulo: 'Carrossel de lançamento',
      tipo: 'carrossel',
      status: 'aprovado_interno',
      scheduled_at: '2026-10-13T12:00:00Z',
    },
    {
      ...basePost,
      id: 2,
      titulo: 'Dica da semana',
      tipo: 'feed',
      ordem: 1,
      status: 'rascunho',
      scheduled_at: null,
    },
  ] as never;
}

function renderDrawer(
  overrides: { onClose?: () => void; hubUrl?: string; initialPostId?: number } = {},
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const card = {
    workflow: {
      id: 10,
      cliente_id: 42,
      titulo: 'Posts de outubro',
      template_id: null,
      status: 'ativo',
      etapa_atual: 0,
      recorrente: false,
    },
    etapa: { id: 1, workflow_id: 10, ordem: 0, nome: 'Produção', status: 'ativo' },
    cliente: { id: 42, nome: 'Café Aurora' },
    hubUrl: overrides.hubUrl,
    membro: undefined,
    deadline: null,
    totalEtapas: 1,
    etapaIdx: 0,
    allEtapas: [],
  } as unknown as BoardCard;
  const onClose = overrides.onClose ?? vi.fn();
  render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <WorkflowDrawer
          card={card}
          membros={[]}
          onClose={onClose}
          onRefresh={vi.fn()}
          initialPostId={overrides.initialPostId}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { onClose };
}

const rowMain = (title: string) => screen.getByText(title).closest('button') as HTMLButtonElement;

async function openPostMenu(title: string) {
  fireEvent.click(screen.getByRole('button', { name: `Ações do post ${title}` }));
  return screen.findByRole('menu', { name: 'Ações do post' });
}

beforeAll(installPointerEvent);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetPosts.mockResolvedValue(makePosts());
  mockStatusEvents.mockResolvedValue([]);
});

describe('WorkflowDrawer on phones: header', () => {
  it('shows the large title, the cliente/etapa subtitle and a back button that closes', async () => {
    const { onClose } = renderDrawer();
    expect(screen.getByRole('heading', { level: 2, name: 'Posts de outubro' })).toBeInTheDocument();
    expect(screen.getByText('Café Aurora · Etapa: Produção')).toBeInTheDocument();
    // The desktop fullscreen toggle and X are not rendered on phones.
    expect(screen.queryByTitle('Expandir')).toBeNull();
    expect(screen.queryByTitle('Fechar')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Voltar para Entregas' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('"…" lists Enviar N posts and Copiar link do fluxo, wired to the desktop handlers', async () => {
    mockSend.mockResolvedValue(undefined as never);
    renderDrawer();
    // Enviar ao cliente is also visible under the subtitle once a post is ready.
    await screen.findByRole('button', { name: 'Enviar 1 post aprovado ao cliente' });

    fireEvent.click(screen.getByRole('button', { name: 'Ações do fluxo' }));
    const sheet = await screen.findByRole('dialog', { name: 'Ações do fluxo' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Copiar link do fluxo' }));
    expect(mockCopyAppLink).toHaveBeenCalledWith('/entregas?drawer=10');

    fireEvent.click(screen.getByRole('button', { name: 'Ações do fluxo' }));
    const sheet2 = await screen.findByRole('dialog', { name: 'Ações do fluxo' });
    fireEvent.click(
      within(sheet2).getByRole('button', { name: 'Enviar 1 post aprovado ao cliente' }),
    );
    await waitFor(() => expect(mockSend).toHaveBeenCalledWith(10));
  });

  it('omits Enviar when no post is approved internally', async () => {
    mockGetPosts.mockResolvedValue([
      {
        ...basePost,
        id: 2,
        titulo: 'Post em produção',
        tipo: 'feed',
        status: 'rascunho',
        scheduled_at: null,
      },
    ] as never);
    renderDrawer();
    await screen.findByText('Post em produção');
    expect(screen.queryByRole('button', { name: /Enviar/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ações do fluxo' }));
    const sheet = await screen.findByRole('dialog', { name: 'Ações do fluxo' });
    expect(within(sheet).queryByRole('button', { name: /Enviar/ })).toBeNull();
    expect(within(sheet).getByRole('button', { name: 'Copiar link do fluxo' })).toBeInTheDocument();
  });

  it('segmented tabs switch between Posts, Grade, Calendário and Histórico', async () => {
    renderDrawer();
    await screen.findByText('Carrossel de lançamento');
    const tabs = screen.getByRole('tablist', { name: 'Visão do fluxo' });
    expect(within(tabs).getByRole('tab', { name: 'Posts' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    fireEvent.click(within(tabs).getByRole('tab', { name: 'Grade' }));
    expect(screen.getByTestId('workflow-grid-view-stub')).toBeInTheDocument();
    expect(screen.getByRole('tabpanel')).toHaveAttribute(
      'aria-labelledby',
      within(tabs).getByRole('tab', { name: 'Grade' }).id,
    );

    fireEvent.click(within(tabs).getByRole('tab', { name: 'Calendário' }));
    expect(screen.getByTestId('workflow-calendar-view-stub')).toBeInTheDocument();

    fireEvent.click(within(tabs).getByRole('tab', { name: 'Histórico' }));
    expect(screen.getByTestId('workflow-history-view-stub')).toBeInTheDocument();

    fireEvent.click(within(tabs).getByRole('tab', { name: 'Posts' }));
    expect(screen.getByText('Carrossel de lançamento')).toBeInTheDocument();
  });
});

describe('WorkflowDrawer on phones: posts list', () => {
  it('rows read "Tipo · data" and tapping one opens the pushed editor screen', async () => {
    renderDrawer();
    await screen.findByText('Carrossel de lançamento');
    // No post with the client yet: the counter falls back to the post count.
    expect(screen.getByText('2 posts')).toBeInTheDocument();
    expect(screen.getByText(new RegExp(`^${TIPO_LABELS.carrossel} · `))).toBeInTheDocument();
    expect(screen.getByText(`${TIPO_LABELS.feed} · A definir`)).toBeInTheDocument();

    expect(screen.queryByRole('region', { name: 'Editor do post' })).toBeNull();
    fireEvent.click(rowMain('Carrossel de lançamento'));
    const region = await screen.findByRole('region', { name: 'Editor do post' });
    expect(within(region).getByTestId('editor-1')).toBeInTheDocument();
    // The row itself never expands inline on phones.
    const inline = screen.getAllByTestId('editor-1').filter((el) => !region.contains(el));
    expect(inline).toHaveLength(1);
    expect(inline[0]).toHaveAttribute('data-expanded', 'false');
  });

  it('opening the "…" menu does not expand the post', async () => {
    renderDrawer();
    await screen.findByText('Carrossel de lançamento');
    await openPostMenu('Carrossel de lançamento');
    expect(screen.getByTestId('editor-1')).toHaveAttribute('data-expanded', 'false');
  });

  it('the post menu lists every desktop row action, in sections', async () => {
    renderDrawer({ hubUrl: 'https://mesaas.com.br/aurora/hub/tok' });
    await screen.findByText('Carrossel de lançamento');
    const menu = await openPostMenu('Carrossel de lançamento');
    const labels = within(menu)
      .getAllByRole('menuitem')
      .map((el) => el.textContent);
    expect(labels).toEqual([
      'Copiar link do post',
      'Copiar link da postagem no Hub',
      'Duplicar post',
      'Mover para outro fluxo',
      'Desmembrar do fluxo',
      'Histórico do post',
      'Remover post',
    ]);
  });

  it('hides the Hub link item when the cliente has no Hub', async () => {
    renderDrawer();
    await screen.findByText('Carrossel de lançamento');
    const menu = await openPostMenu('Carrossel de lançamento');
    expect(
      within(menu).queryByRole('menuitem', { name: 'Copiar link da postagem no Hub' }),
    ).toBeNull();
  });

  it('a long-press (contextmenu) opens the same menu', async () => {
    renderDrawer();
    await screen.findByText('Carrossel de lançamento');
    fireEvent.contextMenu(rowMain('Carrossel de lançamento'));
    expect(await screen.findByRole('menu', { name: 'Ações do post' })).toBeInTheDocument();
  });

  it('each menu item runs the desktop handler', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderDrawer({ hubUrl: 'https://mesaas.com.br/aurora/hub/tok' });
    await screen.findByText('Carrossel de lançamento');
    const pick = async (label: string) => {
      const menu = await openPostMenu('Carrossel de lançamento');
      fireEvent.click(within(menu).getByRole('menuitem', { name: label }));
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    };

    await pick('Copiar link do post');
    expect(mockCopyAppLink).toHaveBeenCalledWith('/entregas?post=1');

    await pick('Copiar link da postagem no Hub');
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('https://mesaas.com.br/aurora/hub/tok/postagens/1'),
    );

    await pick('Duplicar post');
    expect(screen.getByTestId('duplicate-dialog')).toHaveTextContent('1');

    await pick('Mover para outro fluxo');
    expect(screen.getByTestId('move-dialog')).toHaveTextContent('1');

    await pick('Desmembrar do fluxo');
    expect(screen.getByTestId('detach-dialog')).toHaveTextContent('1');
  });

  it('Histórico do post opens the timeline in a sheet', async () => {
    renderDrawer();
    await screen.findByText('Carrossel de lançamento');
    const menu = await openPostMenu('Carrossel de lançamento');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Histórico do post' }));
    const sheet = await screen.findByRole('dialog', { name: 'Histórico do post' });
    expect(within(sheet).getByText('Criado')).toBeInTheDocument();
  });

  it('Remover post opens the existing confirmation', async () => {
    renderDrawer();
    await screen.findByText('Carrossel de lançamento');
    const menu = await openPostMenu('Carrossel de lançamento');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Remover post' }));
    expect(await screen.findByRole('alertdialog', { name: 'Remover post?' })).toBeInTheDocument();
  });
});

describe('WorkflowDrawer on phones: Selecionar mode', () => {
  it('shows checkboxes and the bottom bar; Mover and Desmembrar open their dialogs', async () => {
    renderDrawer();
    await screen.findByText('Carrossel de lançamento');
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByTestId('phone-ent-fluxo-selection-bar')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Selecionar' }));
    const bar = screen.getByTestId('phone-ent-fluxo-selection-bar');
    expect(within(bar).getByText('0 selecionados')).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'Mover para outro fluxo' })).toBeDisabled();

    // Tapping a row selects it instead of expanding it.
    fireEvent.click(rowMain('Carrossel de lançamento'));
    expect(
      screen.getByRole('checkbox', { name: 'Selecionar Carrossel de lançamento' }),
    ).toBeChecked();
    expect(screen.getByTestId('editor-1')).toHaveAttribute('data-expanded', 'false');
    expect(within(bar).getByText('1 selecionado')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Selecionar todos' }));
    expect(within(bar).getByText('2 selecionados')).toBeInTheDocument();

    fireEvent.click(within(bar).getByRole('button', { name: 'Mover para outro fluxo' }));
    expect(screen.getByTestId('move-dialog')).toHaveTextContent('1,2');

    fireEvent.click(within(bar).getByRole('button', { name: 'Desmembrar' }));
    expect(screen.getByTestId('detach-dialog')).toHaveTextContent('1,2');
  });

  it('turns the post menu off and Cancelar leaves the mode, dropping the selection', async () => {
    renderDrawer();
    await screen.findByText('Carrossel de lançamento');
    fireEvent.click(screen.getByRole('button', { name: 'Selecionar' }));
    expect(screen.queryByRole('button', { name: /^Ações do post/ })).toBeNull();
    fireEvent.contextMenu(rowMain('Carrossel de lançamento'));
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(rowMain('Dica da semana'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByTestId('phone-ent-fluxo-selection-bar')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Selecionar' }));
    expect(screen.getByText('0 selecionados')).toBeInTheDocument();
  });
});

describe('WorkflowDrawer on phones: Reordenar mode', () => {
  it('drag handles exist only in Reordenar, and the post menu is off there', async () => {
    renderDrawer();
    await screen.findByText('Carrossel de lançamento');
    expect(screen.queryByTestId('phone-ent-fluxo-drag-handle')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Reordenar' }));
    const handles = screen.getAllByTestId('phone-ent-fluxo-drag-handle');
    expect(handles).toHaveLength(2);
    // dnd-kit's attributes land on the handle (listeners ride along with them).
    expect(handles[0]).toHaveAttribute('aria-roledescription', 'sortable');
    expect(screen.queryByRole('button', { name: /^Ações do post/ })).toBeNull();
    fireEvent.contextMenu(rowMain('Carrossel de lançamento'));
    expect(screen.queryByRole('menu')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Concluir' }));
    expect(screen.queryByTestId('phone-ent-fluxo-drag-handle')).toBeNull();
  });
});
