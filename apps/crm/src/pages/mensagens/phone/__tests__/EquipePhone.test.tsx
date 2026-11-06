import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ComponentProps } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { setEditorText } from '@/test/mentionEditor';
import type { EquipeConversa, EquipeMensagem } from '@/store';
import { EquipeListPhone } from '../EquipeListPhone';
import { EquipeThreadPhone } from '../EquipeThreadPhone';

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, role: 'owner', loading: false, profile: null }),
}));

vi.mock('@/services/equipeChatMedia', () => ({
  validateEquipeChatFile: vi.fn(() => null),
  uploadEquipeChatAnexo: vi.fn(),
  signEquipeChatAnexoView: vi.fn(),
}));

// MentionEditor mounts useMentionSearch, which queries these on mount.
vi.mock('@/store', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getMembros: vi.fn(),
    getClientes: vi.fn(),
    getTarefas: vi.fn(),
    getPostChipPreview: vi.fn().mockResolvedValue(null),
    getDiscussaoNaoLidas: vi.fn().mockResolvedValue([]),
  };
});
vi.mock('@/store/posts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, searchPostsForMention: vi.fn() };
});

beforeEach(async () => {
  const store = await import('@/store');
  (store.getMembros as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (store.getClientes as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (store.getTarefas as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  const posts = await import('@/store/posts');
  (posts.searchPostsForMention as ReturnType<typeof vi.fn>).mockResolvedValue([]);
});

function conversa(overrides: Partial<EquipeConversa> = {}): EquipeConversa {
  return {
    conversa_id: 42,
    tipo: 'grupo',
    nome: 'Time de Design',
    display_nome: 'Time de Design',
    avatar_url: null,
    participantes_count: 3,
    last_author_name: 'Ana',
    last_author_id: 'user-2',
    last_content: 'Vamos revisar o brief',
    last_has_anexo: false,
    last_created_at: '2026-07-30T12:00:00.000Z',
    last_message_id: 2,
    unread_count: 0,
    dm_user_id: null,
    ...overrides,
  };
}

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('EquipeListPhone', () => {
  const CONVERSAS = [
    conversa(),
    conversa({
      conversa_id: 7,
      tipo: 'dm',
      nome: null,
      display_nome: 'Bruno',
      last_author_id: 'user-1',
      last_author_name: 'Eu',
      last_content: 'Fechado',
      last_created_at: '2026-07-30T13:00:00.000Z',
      unread_count: 3,
    }),
  ];

  function renderList(overrides: Partial<ComponentProps<typeof EquipeListPhone>> = {}) {
    const props: ComponentProps<typeof EquipeListPhone> = {
      conversas: CONVERSAS,
      colegas: [],
      isLoading: false,
      isError: false,
      currentUserId: 'user-1',
      onSelect: vi.fn(),
      onSelectColega: vi.fn(),
      onNovaConversa: vi.fn(),
      ...overrides,
    };
    wrap(<EquipeListPhone {...props} />);
    return props;
  }

  it('lists rows with the testids, "Você" on my last message and the unread badge', () => {
    const props = renderList();
    const dm = screen.getByTestId('equipe-conversa-7');
    expect(dm).toHaveTextContent('Você: Fechado');
    expect(within(dm).getByLabelText('3 não lidas')).toHaveTextContent('3');
    expect(screen.getByTestId('equipe-conversa-42')).toHaveTextContent('Ana: Vamos revisar');

    fireEvent.click(dm);
    expect(props.onSelect).toHaveBeenCalledWith(7);
  });

  it('opens Nova conversa from the header and filters by name from the search field', () => {
    const props = renderList();
    fireEvent.click(screen.getByTestId('nova-conversa-btn'));
    expect(props.onNovaConversa).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Buscar conversa' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar conversa' }), {
      target: { value: 'bru' },
    });
    expect(screen.getByTestId('equipe-conversa-7')).toBeInTheDocument();
    expect(screen.queryByTestId('equipe-conversa-42')).toBeNull();
  });

  it('renders the header extra (the Clientes | Equipe control) under the title', () => {
    renderList({ headerExtra: <div data-testid="tabs" /> });
    expect(screen.getByTestId('tabs')).toBeInTheDocument();
  });

  it('shows the empty note when there are no conversations', () => {
    renderList({ conversas: [] });
    expect(screen.getByText(/Nenhuma conversa ainda/)).toBeInTheDocument();
  });

  it('lists colleagues with no DM below the conversations and opens their DM on tap', () => {
    const props = renderList({
      colegas: [{ user_id: 'user-9', nome: 'Carla', avatar_url: null, role: 'agent' }],
    });
    const row = screen.getByTestId('equipe-colega-user-9');
    expect(row).toHaveTextContent('Carla');
    expect(row).toHaveTextContent('Sem mensagens ainda. Comece a conversa!');
    expect(
      screen.getByTestId('equipe-conversa-42').compareDocumentPosition(row) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    fireEvent.click(row);
    expect(props.onSelectColega).toHaveBeenCalledWith('user-9');
  });

  it('disables the colleague rows while a DM is being opened', () => {
    renderList({
      colegas: [{ user_id: 'user-9', nome: 'Carla', avatar_url: null, role: 'agent' }],
      abrindoColegaId: 'user-9',
    });
    expect(screen.getByTestId('equipe-colega-user-9')).toBeDisabled();
  });
});

describe('EquipeThreadPhone', () => {
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

  function renderThread(mensagens: EquipeMensagem[] = MENSAGENS) {
    const send = { mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false };
    const onOpenDetalhes = vi.fn();
    type P = ComponentProps<typeof EquipeThreadPhone>;
    wrap(
      <EquipeThreadPhone
        conversa={conversa()}
        mensagens={
          {
            data: { pages: [mensagens] },
            isLoading: false,
            isError: false,
            hasNextPage: false,
            isFetchingNextPage: false,
            fetchNextPage: vi.fn(),
            refetch: vi.fn(),
          } as unknown as P['mensagens']
        }
        send={send as unknown as P['send']}
        markSeen={{ mutate: vi.fn(), isPending: false } as unknown as P['markSeen']}
        onOpenDetalhes={onOpenDetalhes}
      />,
    );
    return { send, onOpenDetalhes };
  }

  it('shows the name in the nav bar and opens the details from its trailing button', () => {
    const { onOpenDetalhes } = renderThread();
    expect(screen.getByRole('button', { name: 'Voltar para as conversas' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ver detalhes da conversa' }));
    expect(onOpenDetalhes).toHaveBeenCalled();
  });

  it('puts the author name on colleagues bubbles only and mine on the trailing side', () => {
    renderThread();
    const outros = screen.getByTestId('equipe-msg-1');
    const minha = screen.getByTestId('equipe-msg-2');
    expect(outros).toHaveTextContent('Ana');
    expect(outros.className).not.toContain('--mine');
    expect(minha).not.toHaveTextContent('Eu');
    expect(minha.className).toContain('phone-msg-bubble-row--mine');
  });

  it('renders the phone post chip under a message that mentions a post', () => {
    renderThread([
      { ...MENSAGENS[0], id: 8, content: 'Vê isso\n@[Post de julho](post:7:3)' },
      { ...MENSAGENS[0], id: 9, content: '@[Outro](post:8)' },
    ]);
    const com = screen.getByTestId('equipe-msg-8');
    expect(com).toHaveTextContent('Vê isso');
    expect(com.querySelectorAll('.mention-chip--post')).toHaveLength(1);
    const bloco = com.querySelector('.phone-msg-post-blocks')!;
    const chip = within(bloco as HTMLElement).getByRole('link', { name: 'Post de julho' });
    expect(chip).toHaveClass('phone-msg-chip');
    expect(chip).toHaveAttribute('href', '/entregas?drawer=3&post=7');
    // Only the token: the block stands alone, no inline chip.
    const solo = screen.getByTestId('equipe-msg-9');
    expect(solo.querySelector('.mention-chip')).toBeNull();
    expect(solo.querySelector('.phone-msg-chip')).not.toBeNull();
  });

  it('sends on Enter but not while an IME is composing', async () => {
    const { send } = renderThread();
    const field = screen.getByRole('textbox', { name: 'Mensagem para a equipe…' });
    setEditorText(field, 'oi');

    fireEvent.keyDown(field, { key: 'Enter', isComposing: true });
    expect(send.mutateAsync).not.toHaveBeenCalled();

    fireEvent.keyDown(field, { key: 'Enter' });
    expect(send.mutateAsync).toHaveBeenCalledWith({ content: 'oi', anexoIds: undefined });
    await waitFor(() => expect(field.textContent).toBe(''));
  });
});
