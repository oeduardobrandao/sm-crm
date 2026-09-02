import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NovaConversaDialog } from '../NovaConversaDialog';

const { mockGetMembers, mockCreateConversa, toastError } = vi.hoisted(() => ({
  mockGetMembers: vi.fn(),
  mockCreateConversa: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/store', () => ({
  getEquipeChatMembers: mockGetMembers,
  createEquipeConversa: mockCreateConversa,
}));

vi.mock('sonner', () => ({
  toast: { error: toastError, success: vi.fn() },
}));

let mockAuth: { user: { id: string }; role: 'owner' | 'admin' | 'agent' } = {
  user: { id: 'user-1' },
  role: 'owner',
};
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => mockAuth,
}));

const MEMBERS = [
  { user_id: 'user-1', nome: 'Eu Mesmo', avatar_url: null, role: 'owner' },
  { user_id: 'user-2', nome: 'Ana Silva', avatar_url: null, role: 'admin' },
  { user_id: 'user-3', nome: 'Bruno Costa', avatar_url: null, role: 'agent' },
];

function renderDialog(open = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onOpenChange = vi.fn();
  const onCreated = vi.fn();
  const utils = render(
    <QueryClientProvider client={qc}>
      <NovaConversaDialog open={open} onOpenChange={onOpenChange} onCreated={onCreated} />
    </QueryClientProvider>,
  );
  return { ...utils, onOpenChange, onCreated };
}

beforeEach(() => {
  mockAuth = { user: { id: 'user-1' }, role: 'owner' };
  mockGetMembers.mockResolvedValue(MEMBERS);
  mockCreateConversa.mockResolvedValue(99);
});

describe('NovaConversaDialog', () => {
  it('lista colegas de getEquipeChatMembers excluindo o proprio usuario', async () => {
    renderDialog();
    expect(await screen.findByText('Ana Silva')).toBeInTheDocument();
    expect(screen.getByText('Bruno Costa')).toBeInTheDocument();
    expect(screen.queryByText('Eu Mesmo')).not.toBeInTheDocument();
  });

  it('clique num colega chama createEquipeConversa(dm) e onCreated', async () => {
    const { onCreated, onOpenChange } = renderDialog();
    fireEvent.click(await screen.findByTestId('colega-dm-user-2'));
    await waitFor(() => expect(mockCreateConversa).toHaveBeenCalledWith('dm', null, ['user-2']));
    expect(onCreated).toHaveBeenCalledWith(99);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('role agent nao ve o botao Criar grupo', async () => {
    mockAuth = { user: { id: 'user-1' }, role: 'agent' };
    renderDialog();
    await screen.findByText('Ana Silva');
    expect(screen.queryByText('Criar grupo')).not.toBeInTheDocument();
  });

  it('role admin ve o botao Criar grupo', async () => {
    mockAuth = { user: { id: 'user-1' }, role: 'admin' };
    renderDialog();
    expect(await screen.findByText('Criar grupo')).toBeInTheDocument();
  });

  it('fluxo grupo (admin): nome + 2 colegas selecionados -> createEquipeConversa(grupo) -> onCreated', async () => {
    mockAuth = { user: { id: 'user-1' }, role: 'admin' };
    const { onCreated } = renderDialog();

    fireEvent.click(await screen.findByText('Criar grupo'));
    fireEvent.change(screen.getByLabelText('Nome do grupo'), {
      target: { value: 'Time de Design' },
    });
    fireEvent.click(screen.getByTestId('colega-toggle-user-2'));
    fireEvent.click(screen.getByTestId('colega-toggle-user-3'));
    fireEvent.click(screen.getByRole('button', { name: 'Criar' }));

    await waitFor(() =>
      expect(mockCreateConversa).toHaveBeenCalledWith('grupo', 'Time de Design', [
        'user-2',
        'user-3',
      ]),
    );
    expect(onCreated).toHaveBeenCalledWith(99);
  });

  it('erro da RPC mostra toast.error e mantem o dialog aberto', async () => {
    mockCreateConversa.mockRejectedValue(new Error('boom'));
    const { onOpenChange, onCreated } = renderDialog();

    fireEvent.click(await screen.findByTestId('colega-dm-user-2'));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('reseta modo/nome/selecionados quando o Radix Dialog dispara onOpenChange(false)', async () => {
    mockAuth = { user: { id: 'user-1' }, role: 'admin' };
    const { onOpenChange } = renderDialog();

    fireEvent.click(await screen.findByText('Criar grupo'));
    fireEvent.change(screen.getByLabelText('Nome do grupo'), { target: { value: 'Rascunho' } });
    expect(screen.getByLabelText('Nome do grupo')).toHaveValue('Rascunho');

    // The mocked onOpenChange never flips the `open` prop back, so the
    // dialog itself stays mounted/visible in the DOM after this -- only its
    // internal state should have been cleared, which is exactly what this
    // asserts without needing to close/reopen via props.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(await screen.findByText('Ana Silva')).toBeInTheDocument();
    expect(screen.queryByLabelText('Nome do grupo')).not.toBeInTheDocument();
  });
});
