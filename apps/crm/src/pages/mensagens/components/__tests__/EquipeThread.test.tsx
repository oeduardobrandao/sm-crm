import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ComponentProps } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { setEditorText } from '@/test/mentionEditor';
import { toast } from 'sonner';
import { EquipeThread } from '../EquipeThread';
import type { EquipeConversa, EquipeMensagem } from '@/store';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, role: 'owner', loading: false, profile: null }),
}));

const { mockValidate, mockUpload, mockSign } = vi.hoisted(() => ({
  mockValidate: vi.fn(),
  mockUpload: vi.fn(),
  mockSign: vi.fn(),
}));

vi.mock('@/services/equipeChatMedia', () => ({
  validateEquipeChatFile: mockValidate,
  uploadEquipeChatAnexo: mockUpload,
  signEquipeChatAnexoView: mockSign,
}));

// MentionEditor always mounts useMentionSearch -> useQuery(['membros'|'clientes'|'tarefas']),
// even when the user never types "@" -- mock the store's fetchers so those queries
// resolve instantly instead of hitting the real (Supabase-backed) module.
vi.mock('@/store', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getMembros: vi.fn(),
    getClientes: vi.fn(),
    getTarefas: vi.fn(),
    getPostChipPreview: vi.fn(),
    getDiscussaoNaoLidas: vi.fn(),
  };
});
vi.mock('@/services/postMedia', () => ({ listPostMedia: vi.fn().mockResolvedValue([]) }));
vi.mock('@/store/posts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    searchPostsForMention: vi.fn(),
  };
});

// The repo's global afterEach calls vi.restoreAllMocks(), which strips a
// mockResolvedValue set only once at module scope -- re-arm every test (same
// rationale as ConversationThread.test.tsx / PostCommentPopover.test.tsx).
beforeEach(async () => {
  const store = await import('@/store');
  (store.getMembros as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (store.getClientes as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (store.getTarefas as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (store.getPostChipPreview as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: 7,
    titulo: 'Post de julho',
    tipo: 'feed',
    status: 'aprovado_cliente',
    scheduled_at: null,
    workflow_id: 3,
    workflow_titulo: 'Fluxo de agosto',
  });
  (store.getDiscussaoNaoLidas as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  const postsModule = await import('@/store/posts');
  (postsModule.searchPostsForMention as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  mockValidate.mockReturnValue(null);
  mockUpload.mockResolvedValue({
    id: 99,
    file_name: 'anexo.png',
    mime_type: 'image/png',
    size_bytes: 1000,
  });
  mockSign.mockResolvedValue('https://cdn.example.com/signed-url');
});

const CONVERSA: EquipeConversa = {
  conversa_id: 42,
  tipo: 'grupo',
  nome: 'Time de Design',
  display_nome: 'Time de Design',
  avatar_url: null,
  participantes_count: 3,
  last_author_name: 'Ana',
  last_author_id: null,
  last_content: 'Vamos revisar o brief',
  last_has_anexo: false,
  last_created_at: '2026-07-30T12:00:00.000Z',
  last_message_id: 2,
  unread_count: 0,
};

const MENSAGENS: EquipeMensagem[] = [
  {
    id: 1,
    conversa_id: 42,
    author_user_id: 'user-2',
    author_name: 'Ana',
    author_avatar_url: null,
    content: 'Vamos revisar o brief',
    created_at: '2026-07-30T10:00:00.000Z',
    anexos: [],
  },
  {
    id: 2,
    conversa_id: 42,
    author_user_id: 'user-1',
    author_name: 'Eu',
    author_avatar_url: null,
    content: 'Já revisei',
    created_at: '2026-07-30T11:00:00.000Z',
    anexos: [],
  },
];

function makeMensagens(overrides: Record<string, unknown> = {}) {
  return {
    data: { pages: [MENSAGENS] },
    isLoading: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
    ...overrides,
  } as unknown as ComponentProps<typeof EquipeThread>['mensagens'];
}

function makeSend(overrides: Record<string, unknown> = {}) {
  return {
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
    ...overrides,
  } as unknown as ComponentProps<typeof EquipeThread>['send'];
}

function makeMarkSeen(overrides: Record<string, unknown> = {}) {
  return {
    mutate: vi.fn(),
    isPending: false,
    ...overrides,
  } as unknown as ComponentProps<typeof EquipeThread>['markSeen'];
}

function wrapTree(qc: QueryClient, props: ComponentProps<typeof EquipeThread>) {
  return (
    <BrowserRouter>
      <QueryClientProvider client={qc}>
        <EquipeThread {...props} />
      </QueryClientProvider>
    </BrowserRouter>
  );
}

function renderThread(overrides: Partial<ComponentProps<typeof EquipeThread>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const send = makeSend();
  const markSeen = makeMarkSeen();
  const props: ComponentProps<typeof EquipeThread> = {
    conversa: CONVERSA,
    mensagens: makeMensagens(),
    send,
    markSeen,
    ...overrides,
  };
  const utils = render(wrapTree(qc, props));
  return { ...utils, send, markSeen, qc };
}

describe('EquipeThread', () => {
  // The amber button used to inherit the theme's text colour: in dark mode the
  // icon came out near-white on amber (about 1.5:1). --dark is the same
  // near-black in both themes.
  it('gives the send icon an explicit dark colour on the amber button', () => {
    renderThread();
    expect(screen.getByRole('button', { name: 'Enviar mensagem' })).toHaveClass(
      'text-[var(--dark)]',
    );
  });

  it('stacks a run from one author under a single name and time, with a day divider above', () => {
    const run: EquipeMensagem[] = [
      { ...MENSAGENS[0], id: 1, created_at: '2026-07-30T10:00:00.000Z' },
      { ...MENSAGENS[0], id: 3, content: 'E o roteiro', created_at: '2026-07-30T10:01:00.000Z' },
    ];
    renderThread({ mensagens: makeMensagens({ data: { pages: [run] } }) });

    expect(screen.getAllByRole('separator')).toHaveLength(1);
    const primeira = screen.getByTestId('equipe-msg-1');
    const segunda = screen.getByTestId('equipe-msg-3');
    expect(primeira).toHaveTextContent('Ana');
    expect(segunda).not.toHaveTextContent('Ana');
    // Only the run's last bubble carries the time.
    expect(primeira.textContent).not.toMatch(/\d{2}:\d{2}/);
    expect(segunda.textContent).toMatch(/\d{2}:\d{2}/);
  });

  it('renders messages in chronological order, author name on others, reversed alignment on the current user', () => {
    renderThread();

    const outros = screen.getByTestId('equipe-msg-1');
    const minha = screen.getByTestId('equipe-msg-2');

    expect(outros).toHaveTextContent('Vamos revisar o brief');
    expect(outros).toHaveTextContent('Ana');
    expect(outros.className).toContain('self-start');
    expect(outros.className).not.toContain('flex-row-reverse');

    expect(minha).toHaveTextContent('Já revisei');
    expect(minha).not.toHaveTextContent('Eu');
    expect(minha.className).toContain('self-end');
    expect(minha.className).toContain('flex-row-reverse');

    // DOM order follows created_at ascending.
    const bubbles = screen.getAllByTestId(/equipe-msg-/);
    expect(bubbles[0]).toBe(outros);
    expect(bubbles[1]).toBe(minha);
  });

  it('EquipeThread falls back to initials when the photo fails', () => {
    renderThread({
      mensagens: makeMensagens({
        data: {
          pages: [
            [
              {
                ...MENSAGENS[0],
                author_name: 'Ana Lima',
                author_avatar_url: 'https://x.test/ana.jpg',
              },
            ],
          ],
        },
      }),
    });

    const bolha = screen.getByTestId('equipe-msg-1');
    const img = bolha.querySelector('img');
    expect(img).toHaveAttribute('src', 'https://x.test/ana.jpg');

    fireEvent.error(img!);

    expect(bolha.querySelector('img')).not.toBeInTheDocument();
    expect(bolha).toHaveTextContent('AL');
  });

  it('sends a message on Enter and clears the draft', async () => {
    const { send } = renderThread();
    const input = screen.getByRole('textbox', { name: 'Mensagem para a equipe…' });
    setEditorText(input, 'Olá');
    // enviar() awaits mutateAsync before its own setState calls -- wrap the
    // triggering event in act() so those updates settle inside the test
    // (same rationale as ConversationThread.test.tsx).
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(send.mutateAsync).toHaveBeenCalledWith({ content: 'Olá', anexoIds: undefined });
    expect(input.textContent).toBe('');
  });

  it('does not send on Shift+Enter', async () => {
    const { send } = renderThread();
    const input = screen.getByRole('textbox', { name: 'Mensagem para a equipe…' });
    setEditorText(input, 'Olá');
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    });
    expect(send.mutateAsync).not.toHaveBeenCalled();
  });

  it('renders an image attachment as a thumbnail and a PDF as a file chip', () => {
    const comAnexos: EquipeMensagem[] = [
      {
        id: 3,
        conversa_id: 42,
        author_user_id: 'user-2',
        author_name: 'Ana',
        author_avatar_url: null,
        content: '',
        created_at: '2026-07-30T12:00:00.000Z',
        anexos: [
          { id: 10, file_name: 'foto.png', mime_type: 'image/png', size_bytes: 200_000 },
          {
            id: 11,
            file_name: 'contrato.pdf',
            mime_type: 'application/pdf',
            size_bytes: 1_500_000,
          },
        ],
      },
    ];
    renderThread({ mensagens: makeMensagens({ data: { pages: [comAnexos] } }) });

    expect(screen.getByTestId('anexo-imagem')).toBeInTheDocument();
    expect(screen.getByText('contrato.pdf')).toBeInTheDocument();
  });

  it('shows "Carregar mensagens anteriores" when hasNextPage and calls fetchNextPage', () => {
    const mensagens = makeMensagens({ hasNextPage: true });
    renderThread({ mensagens });
    fireEvent.click(screen.getByRole('button', { name: 'Carregar mensagens anteriores' }));
    expect(mensagens.fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it('marks the highest rendered message id as seen on mount', () => {
    const { markSeen } = renderThread();
    expect(markSeen.mutate).toHaveBeenCalledWith(2);
  });

  it('shows an error toast when sending fails', async () => {
    const send = makeSend({ mutateAsync: vi.fn().mockRejectedValue(new Error('network')) });
    renderThread({ send });
    const input = screen.getByRole('textbox', { name: 'Mensagem para a equipe…' });
    setEditorText(input, 'Olá');
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(toast.error).toHaveBeenCalledWith('Não foi possível enviar a mensagem.');
  });

  it('re-arms auto-scroll after a successful send, so a later message growth snaps to the bottom', async () => {
    const { send, markSeen, qc, rerender } = renderThread();
    const scrollEl = screen.getByTestId('thread-scroll');

    const input = screen.getByRole('textbox', { name: 'Mensagem para a equipe…' });
    setEditorText(input, 'Nova mensagem');
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(send.mutateAsync).toHaveBeenCalled();

    // Same idiom as MensagensPage.test.tsx's scroll-to-bottom assertion:
    // override scrollHeight/scrollTop so the effect's assignment is
    // observable (jsdom otherwise keeps both pinned at 0).
    Object.defineProperty(scrollEl, 'scrollHeight', { value: 999, configurable: true });
    const scrollTopSpy = vi.fn();
    Object.defineProperty(scrollEl, 'scrollTop', {
      get: () => 0,
      set: scrollTopSpy,
      configurable: true,
    });

    // Simulates the growth a real send would cause once the query client
    // invalidates and refetches: one more item in the page.
    const grown: EquipeMensagem[] = [
      ...MENSAGENS,
      {
        id: 3,
        conversa_id: 42,
        author_user_id: 'user-1',
        author_name: 'Eu',
        author_avatar_url: null,
        content: 'Nova mensagem',
        created_at: '2026-07-30T12:00:00.000Z',
        anexos: [],
      },
    ];
    rerender(
      wrapTree(qc, {
        conversa: CONVERSA,
        mensagens: makeMensagens({ data: { pages: [grown] } }),
        send,
        markSeen,
      }),
    );

    expect(scrollTopSpy).toHaveBeenCalledWith(999);
  });

  it('shows an error toast when clicking an image attachment whose signed URL failed to load', async () => {
    mockSign.mockRejectedValue(new Error('boom'));
    const comAnexo: EquipeMensagem[] = [
      {
        id: 4,
        conversa_id: 42,
        author_user_id: 'user-2',
        author_name: 'Ana',
        author_avatar_url: null,
        content: '',
        created_at: '2026-07-30T13:00:00.000Z',
        anexos: [{ id: 20, file_name: 'foto.png', mime_type: 'image/png', size_bytes: 200_000 }],
      },
    ];
    renderThread({ mensagens: makeMensagens({ data: { pages: [comAnexo] } }) });
    const img = screen.getByTestId('anexo-imagem');

    // The signed-URL query settles to an error asynchronously and AnexoImagem
    // renders the same <img> either way (no visible DOM marker for "failed")
    // -- retry the click until the query has actually failed and the
    // handler's error branch fires.
    await waitFor(() => {
      fireEvent.click(img);
      expect(toast.error).toHaveBeenCalledWith('Não foi possível abrir o arquivo.');
    });
  });

  describe('post blocks under a message', () => {
    const tok = (id: number, wf: number | null, label = `Post ${id}`) =>
      wf != null ? `@[${label}](post:${id}:${wf})` : `@[${label}](post:${id})`;

    function renderWith(content: string) {
      const msg: EquipeMensagem = { ...MENSAGENS[0], id: 9, content };
      return renderThread({ mensagens: makeMensagens({ data: { pages: [[msg]] } }) });
    }

    it('renders the text with its inline chip and one block below', () => {
      renderWith(`Olha esse post\n${tok(7, 3, 'Post de julho')}`);
      const msg = screen.getByTestId('equipe-msg-9');
      expect(msg).toHaveTextContent('Olha esse post');
      expect(msg.querySelectorAll('.mention-chip--post')).toHaveLength(1);
      const blocks = within(screen.getByTestId('post-chips-below'));
      expect(blocks.getAllByRole('link')).toHaveLength(1);
      expect(blocks.getByRole('link', { name: 'Post de julho' })).toHaveAttribute(
        'href',
        '/entregas?drawer=3&post=7',
      );
    });

    it('renders only the block when the message is just the token', () => {
      renderWith(tok(7, 3, 'Post de julho'));
      const msg = screen.getByTestId('equipe-msg-9');
      expect(msg.querySelector('.mention-chip')).toBeNull();
      expect(msg.querySelector('p')).toBeNull();
      expect(screen.getAllByTestId('post-chips-below')).toHaveLength(1);
      expect(screen.getByRole('link', { name: 'Post de julho' })).toBeInTheDocument();
    });

    it('keeps the text when another kind of mention sits next to the post token', () => {
      renderWith(`@[Ana](membro:5) ${tok(7, 3)}`);
      const msg = screen.getByTestId('equipe-msg-9');
      expect(msg.querySelector('.mention-chip--membro')).not.toBeNull();
      expect(screen.getByTestId('post-chips-below')).toBeInTheDocument();
    });

    it('renders inline chips and no blocks above three distinct posts', () => {
      renderWith(`${tok(1, 3)} ${tok(2, 3)} ${tok(3, 3)} ${tok(4, 3)}`);
      const msg = screen.getByTestId('equipe-msg-9');
      expect(msg.querySelectorAll('.mention-chip--post')).toHaveLength(4);
      expect(screen.queryByTestId('post-chips-below')).not.toBeInTheDocument();
    });

    it('renders one block for a repeated token and a standalone post link', () => {
      renderWith(`${tok(7, null, 'Avulso')} de novo ${tok(7, null, 'Avulso')}`);
      const blocks = within(screen.getByTestId('post-chips-below'));
      expect(blocks.getAllByRole('link')).toHaveLength(1);
      expect(blocks.getByRole('link', { name: 'Avulso' })).toHaveAttribute(
        'href',
        '/entregas?post=7',
      );
    });

    it('shows the discussion count and the discussion link on hover', async () => {
      const store = await import('@/store');
      (store.getDiscussaoNaoLidas as ReturnType<typeof vi.fn>).mockResolvedValue([
        { postId: 7, workflowId: 3, total: 4, naoLidas: 1 },
      ]);
      renderWith(`Veja\n${tok(7, 3, 'Post de julho')}`);
      const chip = within(screen.getByTestId('post-chips-below')).getByRole('link', {
        name: 'Post de julho',
      });
      fireEvent.mouseEnter(chip.parentElement!);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 250));
      });
      const card = await screen.findByTestId('post-hover-preview');
      await waitFor(() => expect(card).toHaveTextContent('4 mensagens na discussão'));
      expect(store.getDiscussaoNaoLidas).toHaveBeenCalledWith({ postIds: [7] });
      expect(
        within(card).getByRole('link', { name: /Abrir na discussão do post/ }),
      ).toHaveAttribute('href', '/entregas?drawer=3&post=7&discussao=1');
    });

    it('hides the count when the post has no discussion yet (no row)', async () => {
      renderWith(`Veja\n${tok(7, 3, 'Post de julho')}`);
      const chip = within(screen.getByTestId('post-chips-below')).getByRole('link', {
        name: 'Post de julho',
      });
      fireEvent.mouseEnter(chip.parentElement!);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 250));
      });
      const card = await screen.findByTestId('post-hover-preview');
      await waitFor(() => expect(card).toHaveTextContent('Fluxo de agosto'));
      expect(card).not.toHaveTextContent(/mensage(m|ns) na discussão/);
      expect(card).toHaveTextContent('Abrir na discussão do post');
    });
  });
});
