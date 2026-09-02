import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ComponentProps } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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

// MentionTextarea always mounts useMentionSearch -> useQuery(['membros'|'clientes'|'tarefas']),
// even when the user never types "@" -- mock the store's fetchers so those queries
// resolve instantly instead of hitting the real (Supabase-backed) module.
vi.mock('@/store', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getMembros: vi.fn(),
    getClientes: vi.fn(),
    getTarefas: vi.fn(),
  };
});
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

  it('sends a message on Enter and clears the draft', async () => {
    const { send } = renderThread();
    const input = screen.getByPlaceholderText('Mensagem para a equipe…');
    fireEvent.change(input, { target: { value: 'Olá' } });
    // enviar() awaits mutateAsync before its own setState calls -- wrap the
    // triggering event in act() so those updates settle inside the test
    // (same rationale as ConversationThread.test.tsx).
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(send.mutateAsync).toHaveBeenCalledWith({ content: 'Olá', anexoIds: undefined });
    expect(input).toHaveValue('');
  });

  it('does not send on Shift+Enter', async () => {
    const { send } = renderThread();
    const input = screen.getByPlaceholderText('Mensagem para a equipe…');
    fireEvent.change(input, { target: { value: 'Olá' } });
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
    const input = screen.getByPlaceholderText('Mensagem para a equipe…');
    fireEvent.change(input, { target: { value: 'Olá' } });
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
    });
    expect(toast.error).toHaveBeenCalledWith('Não foi possível enviar a mensagem.');
  });

  it('re-arms auto-scroll after a successful send, so a later message growth snaps to the bottom', async () => {
    const { send, markSeen, qc, rerender } = renderThread();
    const scrollEl = screen.getByTestId('thread-scroll');

    const input = screen.getByPlaceholderText('Mensagem para a equipe…');
    fireEvent.change(input, { target: { value: 'Nova mensagem' } });
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
});
