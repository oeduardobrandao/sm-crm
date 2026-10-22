import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockConversas,
  mockMembros,
  mockCreate,
  mockSend,
  mockToastSuccess,
  mockToastError,
  mockNavigate,
} = vi.hoisted(() => ({
  mockConversas: vi.fn(),
  mockMembros: vi.fn(),
  mockCreate: vi.fn(),
  mockSend: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
  mockNavigate: vi.fn(),
}));

vi.mock('@/store', () => ({
  getEquipeConversas: mockConversas,
  getEquipeChatMembers: mockMembros,
  createEquipeConversa: mockCreate,
  sendEquipeMensagem: mockSend,
}));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'me' } }),
}));
vi.mock('sonner', () => ({
  toast: { success: mockToastSuccess, error: mockToastError },
}));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useNavigate: () => mockNavigate,
}));
vi.mock('@/pages/mensagens/components/EquipeShared', () => ({
  EquipeConversaAvatar: () => <span />,
  EquipePessoaAvatar: () => <span />,
}));

import { DiscutirNoChat, buildBridgeMessage } from '../DiscutirNoChat';

const POST = { id: 42, titulo: 'Design de março', workflowId: 7 };

function conversa(over: Record<string, unknown>) {
  return {
    conversa_id: 1,
    tipo: 'grupo',
    nome: null,
    display_nome: 'Grupo',
    avatar_url: null,
    participantes_count: 3,
    last_author_name: null,
    last_author_id: null,
    last_content: null,
    last_has_anexo: false,
    last_created_at: null,
    last_message_id: null,
    unread_count: 0,
    dm_user_id: null,
    ...over,
  };
}

const CONVERSAS = [
  conversa({ conversa_id: 10, tipo: 'grupo', display_nome: 'Criação', participantes_count: 4 }),
  conversa({ conversa_id: 11, tipo: 'grupo', display_nome: 'Solo', participantes_count: 1 }),
  conversa({ conversa_id: 20, tipo: 'dm', display_nome: 'Bruno', dm_user_id: 'u-bruno' }),
];
const MEMBROS = [
  { user_id: 'me', nome: 'Eu Mesmo', avatar_url: null, role: 'owner' },
  { user_id: 'u-bruno', nome: 'Bruno', avatar_url: null, role: 'agent' },
  { user_id: 'u-carla', nome: 'Carla', avatar_url: null, role: 'agent' },
];

function renderIt(variant: 'popover' | 'sheet' = 'popover', post = POST) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DiscutirNoChat post={post} variant={variant} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openIt(name = /Discutir no chat/) {
  fireEvent.click(screen.getByRole('button', { name }));
  await screen.findByText('Levar este post para o chat');
  await screen.findByText('Carla');
}

beforeEach(() => {
  vi.clearAllMocks();
  mockConversas.mockResolvedValue(CONVERSAS);
  mockMembros.mockResolvedValue(MEMBROS);
  mockCreate.mockResolvedValue(99);
  mockSend.mockResolvedValue(1);
});

describe('buildBridgeMessage', () => {
  it('puts the text, a newline and the post token', () => {
    expect(buildBridgeMessage('  Olha isso  ', POST)).toBe(
      'Olha isso\n@[Design de março](post:42:7)',
    );
  });
  it('has no leading newline when the text is empty', () => {
    expect(buildBridgeMessage('   ', POST)).toBe('@[Design de março](post:42:7)');
  });
  it('omits the workflow segment for a standalone post', () => {
    expect(buildBridgeMessage('Oi', { id: 5, titulo: 'Avulso', workflowId: null })).toBe(
      'Oi\n@[Avulso](post:5)',
    );
  });
});

describe('DiscutirNoChat', () => {
  it('lists only group conversations under Grupos and colleagues (without self) under Pessoas', async () => {
    renderIt();
    await openIt();
    expect(screen.getByText('Grupos')).toBeInTheDocument();
    expect(screen.getByText('Pessoas')).toBeInTheDocument();
    expect(screen.getByText('Criação')).toBeInTheDocument();
    expect(screen.getByText('4 pessoas')).toBeInTheDocument();
    expect(screen.getByText('1 pessoa')).toBeInTheDocument();
    // The DM is NOT a separate row: Bruno appears once, as a person.
    expect(screen.getAllByText('Bruno')).toHaveLength(1);
    expect(screen.getByText('Carla')).toBeInTheDocument();
    expect(screen.queryByText('Eu Mesmo')).not.toBeInTheDocument();
  });

  it('filters both lists with the search box', async () => {
    renderIt();
    await openIt();
    fireEvent.change(screen.getByLabelText('Buscar conversa ou pessoa'), {
      target: { value: 'cri' },
    });
    expect(screen.getByText('Criação')).toBeInTheDocument();
    expect(screen.queryByText('Carla')).not.toBeInTheDocument();
    expect(screen.queryByText('Pessoas')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Buscar conversa ou pessoa'), {
      target: { value: 'car' },
    });
    expect(screen.getByText('Carla')).toBeInTheDocument();
    expect(screen.queryByText('Criação')).not.toBeInTheDocument();
    expect(screen.queryByText('Grupos')).not.toBeInTheDocument();
  });

  it('keeps "Enviar" disabled until a target is selected', async () => {
    renderIt();
    await openIt();
    expect(screen.getByRole('button', { name: 'Enviar' })).toBeDisabled();
    fireEvent.click(screen.getByTestId('discutir-pessoa-u-carla'));
    expect(screen.getByRole('button', { name: 'Enviar para Carla' })).toBeEnabled();
    expect(screen.getByPlaceholderText('Mensagem para Carla')).toBeInTheDocument();
    expect(screen.getByTestId('discutir-post-chip')).toHaveTextContent('Design de março');
  });

  it('creates the DM for a person without one, then sends the bridge message', async () => {
    renderIt();
    await openIt();
    fireEvent.click(screen.getByTestId('discutir-pessoa-u-carla'));
    fireEvent.change(screen.getByLabelText('Mensagem para Carla'), {
      target: { value: 'Pode revisar?' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar para Carla' }));
    await waitFor(() => expect(mockSend).toHaveBeenCalled());
    expect(mockCreate).toHaveBeenCalledWith('dm', null, ['u-carla']);
    expect(mockSend).toHaveBeenCalledWith(99, 'Pode revisar?\n@[Design de março](post:42:7)');
    await waitFor(() =>
      expect(mockToastSuccess).toHaveBeenCalledWith(
        'Enviado para Carla.',
        expect.objectContaining({
          action: expect.objectContaining({ label: 'Abrir conversa' }),
        }),
      ),
    );
    // closes
    await waitFor(() =>
      expect(screen.queryByText('Levar este post para o chat')).not.toBeInTheDocument(),
    );
    // the action opens the conversation
    mockToastSuccess.mock.calls[0][1].action.onClick();
    expect(mockNavigate).toHaveBeenCalledWith('/mensagens/equipe/99');
  });

  it('reuses the existing DM conversation of a person', async () => {
    renderIt();
    await openIt();
    fireEvent.click(screen.getByTestId('discutir-pessoa-u-bruno'));
    fireEvent.click(screen.getByRole('button', { name: 'Enviar para Bruno' }));
    await waitFor(() => expect(mockSend).toHaveBeenCalled());
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockSend).toHaveBeenCalledWith(20, '@[Design de março](post:42:7)');
  });

  it('sends to a group conversation directly', async () => {
    renderIt();
    await openIt();
    fireEvent.click(screen.getByTestId('discutir-grupo-10'));
    fireEvent.click(screen.getByRole('button', { name: 'Enviar para Criação' }));
    await waitFor(() => expect(mockSend).toHaveBeenCalledWith(10, expect.any(String)));
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('keeps the popover open and the text when sending fails', async () => {
    mockSend.mockRejectedValue(new Error('boom'));
    renderIt();
    await openIt();
    fireEvent.click(screen.getByTestId('discutir-pessoa-u-bruno'));
    fireEvent.change(screen.getByLabelText('Mensagem para Bruno'), {
      target: { value: 'Rascunho' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar para Bruno' }));
    await waitFor(() =>
      expect(mockToastError).toHaveBeenCalledWith('Não foi possível enviar. Tente novamente.'),
    );
    expect(mockToastSuccess).not.toHaveBeenCalled();
    expect(screen.getByText('Levar este post para o chat')).toBeInTheDocument();
    expect(screen.getByLabelText('Mensagem para Bruno')).toHaveValue('Rascunho');
    expect(screen.getByRole('button', { name: 'Enviar para Bruno' })).toBeEnabled();
  });

  it('Cancelar closes without sending', async () => {
    renderIt();
    await openIt();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    await waitFor(() =>
      expect(screen.queryByText('Levar este post para o chat')).not.toBeInTheDocument(),
    );
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('renders as a sheet with an icon button on phones', async () => {
    renderIt('sheet');
    expect(screen.queryByText('Discutir no chat', { selector: 'button' })).not.toBeInTheDocument();
    await openIt(/^Discutir no chat$/);
    expect(screen.getByText('A mensagem vai com um link para o post.')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('discutir-pessoa-u-carla'));
    expect(screen.getByRole('button', { name: 'Enviar para Carla' })).toBeEnabled();
  });
});
