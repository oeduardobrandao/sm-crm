import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Desktop shell of the dialog (the phone sheet is covered by MembrosTab.phone.test.tsx).
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));

const { storeMock } = vi.hoisted(() => ({
  storeMock: {
    getClientes: vi.fn(async () => [] as Record<string, unknown>[]),
    setWorkspaceUserClientScope: vi.fn(async () => {}),
  },
}));
vi.mock('../../../../store', () => storeMock);
vi.mock('@/hooks/useClienteAvatars', () => ({
  useClienteAvatars: () => ({ fotosDe: () => [] }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { toast } from 'sonner';
import { ClientAccessDialog } from '../ClientAccessDialog';

const CLIENTES = [
  { id: 1, nome: 'Clínica Alfa', sigla: 'CA', cor: '#123456' },
  { id: 2, nome: 'Bistrô Beta', sigla: 'BB', cor: '#654321' },
  { id: 3, nome: 'Dental Gama', sigla: 'DG', cor: '#abcdef' },
];

const CARLA = { user_id: 'u3', nome: 'Carla Souza', client_scope: 'todos' as const };
const CARLA_RESTRITA = { ...CARLA, client_scope: 'atribuidos' as const };

function renderDialog(props: Partial<React.ComponentProps<typeof ClientAccessDialog>> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onOpenChange = vi.fn();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  render(
    <QueryClientProvider client={queryClient}>
      <ClientAccessDialog
        open
        onOpenChange={onOpenChange}
        member={CARLA}
        initialIds={[]}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onOpenChange, invalidate };
}

describe('ClientAccessDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storeMock.getClientes.mockResolvedValue(CLIENTES);
    storeMock.setWorkspaceUserClientScope.mockResolvedValue(undefined);
  });

  it('renders_scope_choice_and_list', async () => {
    renderDialog({ member: CARLA_RESTRITA, initialIds: [1] });
    const dialog = await screen.findByRole('dialog', { name: 'Acesso a clientes · Carla Souza' });
    expect(
      within(dialog).getByText(
        'A função define o que Carla pode fazer. Aqui você escolhe em quais clientes.',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('radio', { name: /Todos os clientes/ })).not.toBeChecked();
    expect(
      within(dialog).getByRole('radio', { name: /Só os clientes selecionados/ }),
    ).toBeChecked();
    expect(within(dialog).getByPlaceholderText('Buscar cliente')).toBeInTheDocument();
    expect(await within(dialog).findByRole('checkbox', { name: 'Clínica Alfa' })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'Bistrô Beta' })).not.toBeChecked();
    expect(within(dialog).getByText('1 de 3 selecionados')).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'Itens atribuídos a Carla Souza ou criados por ele(a) continuam visíveis, mesmo de outros clientes.',
      ),
    ).toBeInTheDocument();

    // Search filters the list.
    fireEvent.change(within(dialog).getByPlaceholderText('Buscar cliente'), {
      target: { value: 'beta' },
    });
    expect(within(dialog).queryByRole('checkbox', { name: 'Clínica Alfa' })).toBeNull();
    expect(within(dialog).getByRole('checkbox', { name: 'Bistrô Beta' })).toBeInTheDocument();
  });

  it('hides the list while the scope is "Todos os clientes"', async () => {
    renderDialog();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('radio', { name: /Todos os clientes/ })).toBeChecked();
    expect(within(dialog).queryByPlaceholderText('Buscar cliente')).toBeNull();
  });

  it('counter_updates_on_toggle', async () => {
    renderDialog({ member: CARLA_RESTRITA, initialIds: [1] });
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: 'Bistrô Beta' }));
    expect(within(dialog).getByText('2 de 3 selecionados')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Selecionar todos' }));
    expect(within(dialog).getByText('3 de 3 selecionados')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Limpar' }));
    expect(within(dialog).getByText('0 de 3 selecionados')).toBeInTheDocument();
  });

  it('zero_selected_shows_warning', async () => {
    renderDialog({ member: CARLA_RESTRITA, initialIds: [1] });
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('checkbox', { name: 'Clínica Alfa' });
    expect(within(dialog).queryByText('Carla Souza não vai ver nenhum cliente.')).toBeNull();
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Clínica Alfa' }));
    expect(within(dialog).getByText('Carla Souza não vai ver nenhum cliente.')).toBeInTheDocument();
  });

  it('save_calls_store_with_ids', async () => {
    const { onOpenChange, invalidate } = renderDialog();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('radio', { name: /Só os clientes selecionados/ }));
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: 'Dental Gama' }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Clínica Alfa' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    await waitFor(() =>
      expect(storeMock.setWorkspaceUserClientScope).toHaveBeenCalledWith(
        'u3',
        'atribuidos',
        [1, 3],
      ),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toast.success).toHaveBeenCalledWith('Acesso a clientes atualizado.');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['workspace-users'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['workspace-member-clientes'] });
  });

  it('saving "Todos os clientes" sends an empty list', async () => {
    renderDialog({ member: CARLA_RESTRITA, initialIds: [1] });
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('radio', { name: /Todos os clientes/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(storeMock.setWorkspaceUserClientScope).toHaveBeenCalledWith('u3', 'todos', []),
    );
  });

  it('a failed save shows a generic error and keeps the dialog open', async () => {
    storeMock.setWorkspaceUserClientScope.mockRejectedValueOnce(new Error('raw detail'));
    const { onOpenChange } = renderDialog({ member: CARLA_RESTRITA, initialIds: [1] });
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('radio', { name: /Todos os clientes/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Não foi possível salvar o acesso a clientes.'),
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('cancel_when_dirty_asks_confirm', async () => {
    const { onOpenChange } = renderDialog({ member: CARLA_RESTRITA, initialIds: [1] });
    const dialog = await screen.findByRole('dialog');

    // Clean: Cancelar closes straight away.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    onOpenChange.mockClear();

    // Dirty: Cancelar asks first.
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: 'Bistrô Beta' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(await screen.findByText('Fechar sem salvar?')).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Fechar mesmo assim' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('dirty Escape goes through the DialogContent confirm', async () => {
    const { onOpenChange } = renderDialog({ member: CARLA_RESTRITA, initialIds: [1] });
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(await within(dialog).findByRole('checkbox', { name: 'Bistrô Beta' }));
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(await screen.findByText('Fechar sem salvar?')).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('flag_off_restricted_shows_only_liberar', async () => {
    const { onOpenChange } = renderDialog({
      member: CARLA_RESTRITA,
      initialIds: [1],
      canRestrict: false,
    });
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('radio')).toBeNull();
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
    expect(within(dialog).queryByRole('button', { name: 'Salvar' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Liberar todos os clientes' }));
    await waitFor(() =>
      expect(storeMock.setWorkspaceUserClientScope).toHaveBeenCalledWith('u3', 'todos', []),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
