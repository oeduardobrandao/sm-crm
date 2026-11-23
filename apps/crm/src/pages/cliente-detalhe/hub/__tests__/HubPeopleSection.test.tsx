import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/context/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('@/store/hubPeople', async () => {
  const actual = await vi.importActual<typeof import('@/store/hubPeople')>('@/store/hubPeople');
  return {
    ...actual,
    getHubPeople: vi.fn(),
    addHubPerson: vi.fn(),
    removeHubPerson: vi.fn(),
    setHubRequireLogin: vi.fn(),
  };
});

import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { makeCan, fakeMembership } from '@/test/makeCan';
import * as store from '@/store/hubPeople';
import type { HubPerson } from '@/store/hubPeople';
import { HubPeopleSection } from '../HubPeopleSection';

const mockedUseAuth = vi.mocked(useAuth);

const MARINA: HubPerson = {
  id: 'p1',
  nome: 'Marina Costa',
  email: 'marina@clinicavida.com.br',
  last_login_at: '2026-11-03T15:00:00Z',
  created_at: '2026-10-01T10:00:00Z',
};
const RECEPCAO: HubPerson = {
  id: 'p2',
  nome: 'Recepção',
  email: 'contato@clinicavida.com.br',
  last_login_at: null,
  created_at: '2026-10-02T10:00:00Z',
};

function setAuth(role: 'owner' | 'agent') {
  mockedUseAuth.mockReturnValue({
    workspaceRole: role,
    can: makeCan(fakeMembership({ role })),
  } as never);
}

function renderSection(
  variant: 'desktop' | 'phone' = 'desktop',
  clienteEmail: string | null = 'c@x.com',
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <HubPeopleSection
          clienteId={15}
          clienteNome="Aurora Estética"
          clienteEmail={clienteEmail}
          variant={variant}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, invalidate };
}

function listReturns(people: HubPerson[], require_login = false) {
  vi.mocked(store.getHubPeople).mockResolvedValue({ require_login, people });
}

const nameInput = () => screen.getByRole('textbox', { name: 'Nome' }) as HTMLInputElement;
const emailInput = () => screen.getByRole('textbox', { name: 'E-mail' }) as HTMLInputElement;

describe('HubPeopleSection (desktop)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setAuth('owner');
  });
  afterEach(() => cleanup());

  it('empty list: pre-fills the add row, disables the switch and shows the empty text', async () => {
    listReturns([]);
    renderSection();
    expect(
      await screen.findByText(
        'Ninguém na lista ainda. Adicione a primeira pessoa para poder exigir login.',
      ),
    ).toBeInTheDocument();
    await waitFor(() => expect(nameInput().value).toBe('Aurora Estética'));
    expect(emailInput().value).toBe('c@x.com');
    expect(screen.getByRole('switch', { name: 'Exigir login' })).toBeDisabled();
  });

  it('does not pre-fill the e-mail when the client has none', async () => {
    listReturns([]);
    renderSection('desktop', null);
    await waitFor(() => expect(nameInput().value).toBe('Aurora Estética'));
    expect(emailInput().value).toBe('');
  });

  it('with people: rows show name, e-mail and last access; the add row is empty', async () => {
    listReturns([MARINA, RECEPCAO]);
    renderSection();
    expect(await screen.findByText('Marina Costa')).toBeInTheDocument();
    expect(screen.getByText('marina@clinicavida.com.br')).toBeInTheDocument();
    expect(screen.getByText(/^Último acesso em \d{2}\/\d{2}/)).toBeInTheDocument();
    expect(screen.getByText('Nunca entrou')).toBeInTheDocument();
    expect(nameInput().value).toBe('');
    expect(emailInput().value).toBe('');
    expect(screen.queryByText(/Ninguém na lista/)).not.toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Exigir login' })).toBeEnabled();
  });

  it('shows the matching helper line for the switch state', async () => {
    listReturns([MARINA], true);
    renderSection();
    expect(
      await screen.findByText(/Com o login ligado, o link abre uma tela de entrada/),
    ).toBeInTheDocument();
    cleanup();
    listReturns([MARINA], false);
    renderSection();
    expect(
      await screen.findByText('Com o login desligado, qualquer pessoa com o link abre o portal.'),
    ).toBeInTheDocument();
  });

  it('while the list loads or fails: no empty text, no pre-fill, switch disabled', async () => {
    vi.mocked(store.getHubPeople).mockReturnValue(new Promise(() => {}));
    renderSection();
    expect(screen.getByRole('switch', { name: 'Exigir login' })).toBeDisabled();
    expect(screen.queryByText(/Ninguém na lista/)).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Nome' })).not.toBeInTheDocument();
    cleanup();

    vi.mocked(store.getHubPeople).mockRejectedValue({ message: 'boom' });
    renderSection();
    await waitFor(() => expect(store.getHubPeople).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('switch', { name: 'Exigir login' })).toBeDisabled();
    expect(screen.queryByText(/Ninguém na lista/)).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Nome' })).not.toBeInTheDocument();
  });

  it('adding calls addHubPerson, toasts, invalidates the list and clears the row', async () => {
    listReturns([MARINA]);
    vi.mocked(store.addHubPerson).mockResolvedValue('new');
    const { invalidate } = renderSection();
    await screen.findByText('Marina Costa');
    fireEvent.change(nameInput(), { target: { value: ' Paulo Reis ' } });
    fireEvent.change(emailInput(), { target: { value: 'paulo@clinicavida.com.br' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar pessoa' }));
    await waitFor(() =>
      expect(store.addHubPerson).toHaveBeenCalledWith(15, 'Paulo Reis', 'paulo@clinicavida.com.br'),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Pessoa adicionada.'));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: store.hubPeopleKey(15) });
    await waitFor(() => expect(nameInput().value).toBe(''));
    expect(emailInput().value).toBe('');
  });

  it('the pre-fill does not come back after the first add clears the row', async () => {
    vi.mocked(store.getHubPeople).mockResolvedValueOnce({ require_login: false, people: [] });
    vi.mocked(store.addHubPerson).mockResolvedValue('new');
    renderSection();
    await waitFor(() => expect(nameInput().value).toBe('Aurora Estética'));
    vi.mocked(store.getHubPeople).mockResolvedValue({ require_login: false, people: [MARINA] });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar pessoa' }));
    await waitFor(() =>
      expect(store.addHubPerson).toHaveBeenCalledWith(15, 'Aurora Estética', 'c@x.com'),
    );
    await screen.findByText('Marina Costa');
    expect(nameInput().value).toBe('');
    expect(emailInput().value).toBe('');
  });

  it('invalid input never reaches the server and shows the invalid message', async () => {
    listReturns([MARINA]);
    renderSection();
    await screen.findByText('Marina Costa');
    fireEvent.change(nameInput(), { target: { value: 'Paulo' } });
    fireEvent.change(emailInput(), { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar pessoa' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Confira o nome e o e-mail.'));
    expect(store.addHubPerson).not.toHaveBeenCalled();
  });

  const ADD_ERRORS: Record<string, string> = {
    duplicate: 'Este e-mail já está na lista.',
    limit: 'O limite é de 20 pessoas por cliente.',
    invalid: 'Confira o nome e o e-mail.',
    forbidden: 'Você não tem permissão para alterar o acesso.',
    not_found: 'Cliente não encontrado.',
  };
  for (const [code, text] of Object.entries(ADD_ERRORS)) {
    it(`add error "${code}" shows its own message, never the raw text`, async () => {
      listReturns([MARINA]);
      vi.mocked(store.addHubPerson).mockRejectedValue({
        message: `raise_exception: ${code} (SQLSTATE P0001)`,
      });
      renderSection();
      await screen.findByText('Marina Costa');
      fireEvent.change(nameInput(), { target: { value: 'Paulo' } });
      fireEvent.change(emailInput(), { target: { value: 'p@x.com' } });
      fireEvent.click(screen.getByRole('button', { name: 'Adicionar pessoa' }));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith(text));
      expect(document.body.textContent).not.toContain('SQLSTATE');
      expect(toast.success).not.toHaveBeenCalled();
    });
  }

  it('an unknown add error falls back to the generic message', async () => {
    listReturns([MARINA]);
    vi.mocked(store.addHubPerson).mockRejectedValue({ message: 'relation "x" does not exist' });
    renderSection();
    await screen.findByText('Marina Costa');
    fireEvent.change(nameInput(), { target: { value: 'Paulo' } });
    fireEvent.change(emailInput(), { target: { value: 'p@x.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar pessoa' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Não foi possível salvar. Tente de novo.'),
    );
    expect(document.body.textContent).not.toContain('relation');
  });

  it('at 20 people the add row is replaced by the limit line', async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      ...MARINA,
      id: `p${i}`,
      nome: `Pessoa ${i}`,
      email: `p${i}@x.com`,
    }));
    listReturns(many);
    renderSection();
    await screen.findByText('Pessoa 0');
    expect(screen.getByText('O limite é de 20 pessoas por cliente.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Adicionar pessoa' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Nome' })).not.toBeInTheDocument();
  });

  it('toggling the switch calls setHubRequireLogin and toasts', async () => {
    listReturns([MARINA], false);
    vi.mocked(store.setHubRequireLogin).mockResolvedValue(undefined);
    renderSection();
    const sw = await screen.findByRole('switch', { name: 'Exigir login' });
    await waitFor(() => expect(sw).toBeEnabled());
    listReturns([MARINA], true);
    fireEvent.click(sw);
    await waitFor(() => expect(store.setHubRequireLogin).toHaveBeenCalledWith(15, true));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Login exigido para este cliente.'),
    );
    await waitFor(() => expect(sw).toBeChecked());
  });

  it('turning login off toasts the off message', async () => {
    listReturns([MARINA], true);
    vi.mocked(store.setHubRequireLogin).mockResolvedValue(undefined);
    renderSection();
    const sw = await screen.findByRole('switch', { name: 'Exigir login' });
    await waitFor(() => expect(sw).toBeChecked());
    listReturns([MARINA], false);
    fireEvent.click(sw);
    await waitFor(() => expect(store.setHubRequireLogin).toHaveBeenCalledWith(15, false));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Login não é mais exigido.'));
  });

  it('a failing toggle returns the switch to its previous position and shows the mapped error', async () => {
    listReturns([MARINA], false);
    vi.mocked(store.setHubRequireLogin).mockRejectedValue({ message: 'no_people' });
    renderSection();
    const sw = await screen.findByRole('switch', { name: 'Exigir login' });
    await waitFor(() => expect(sw).toBeEnabled());
    fireEvent.click(sw);
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Adicione ao menos uma pessoa antes de exigir login.',
      ),
    );
    await waitFor(() => expect(sw).not.toBeChecked());
  });

  it('an enabled switch with zero people stays operable so it can be turned off', async () => {
    listReturns([], true);
    renderSection();
    const sw = await screen.findByRole('switch', { name: 'Exigir login' });
    await waitFor(() => expect(sw).toBeChecked());
    expect(sw).toBeEnabled();
  });

  it('remove opens a confirm and only then calls removeHubPerson', async () => {
    listReturns([MARINA, RECEPCAO]);
    vi.mocked(store.removeHubPerson).mockResolvedValue(undefined);
    const { invalidate } = renderSection();
    const btn = await screen.findByRole('button', { name: 'Remover Marina Costa' });
    fireEvent.click(btn);
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Remover Marina Costa?')).toBeInTheDocument();
    expect(
      within(dialog).getByText('Essa pessoa perde o acesso ao portal na hora.'),
    ).toBeInTheDocument();
    expect(store.removeHubPerson).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remover' }));
    await waitFor(() => expect(store.removeHubPerson).toHaveBeenCalledWith('p1'));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Pessoa removida.'));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: store.hubPeopleKey(15) });
  });

  it('cancelling the confirm removes nobody', async () => {
    listReturns([MARINA]);
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Remover Marina Costa' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(store.removeHubPerson).not.toHaveBeenCalled();
  });

  it('a failing remove shows the mapped message', async () => {
    listReturns([MARINA], true);
    vi.mocked(store.removeHubPerson).mockRejectedValue({ message: 'last_person' });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Remover Marina Costa' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remover' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Desligue "Exigir login" antes de remover a última pessoa.',
      ),
    );
  });

  it('never calls the store for an agent (query gated)', async () => {
    setAuth('agent');
    listReturns([MARINA]);
    renderSection();
    await new Promise((r) => setTimeout(r, 20));
    expect(store.getHubPeople).not.toHaveBeenCalled();
  });
});

describe('HubPeopleSection (phone)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    setAuth('owner');
  });
  afterEach(() => cleanup());

  it('renders grouped-list cells, no table', async () => {
    listReturns([MARINA, RECEPCAO]);
    const { container } = renderSection('phone');
    expect(await screen.findByText('Marina Costa')).toBeInTheDocument();
    expect(container.querySelector('.phone-group')).not.toBeNull();
    expect(container.querySelectorAll('li.phone-cell').length).toBeGreaterThan(2);
    expect(container.querySelector('table')).toBeNull();
    expect(screen.getByText('marina@clinicavida.com.br')).toBeInTheDocument();
    expect(screen.getByText('Nunca entrou')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Exigir login' })).toBeInTheDocument();
  });

  it('remove goes through the confirm sheet', async () => {
    listReturns([MARINA]);
    vi.mocked(store.removeHubPerson).mockResolvedValue(undefined);
    renderSection('phone');
    fireEvent.click(await screen.findByRole('button', { name: 'Remover Marina Costa' }));
    const sheet = await screen.findByRole('dialog', { name: 'Remover Marina Costa?' });
    expect(store.removeHubPerson).not.toHaveBeenCalled();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Remover' }));
    await waitFor(() => expect(store.removeHubPerson).toHaveBeenCalledWith('p1'));
  });

  it('adds a person from the phone form', async () => {
    listReturns([MARINA]);
    vi.mocked(store.addHubPerson).mockResolvedValue('new');
    renderSection('phone');
    await screen.findByText('Marina Costa');
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'Paulo Reis' } });
    fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: 'p@x.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar pessoa' }));
    await waitFor(() =>
      expect(store.addHubPerson).toHaveBeenCalledWith(15, 'Paulo Reis', 'p@x.com'),
    );
  });

  it('toggles the switch', async () => {
    listReturns([MARINA], false);
    vi.mocked(store.setHubRequireLogin).mockResolvedValue(undefined);
    renderSection('phone');
    const sw = await screen.findByRole('switch', { name: 'Exigir login' });
    await waitFor(() => expect(sw).toBeEnabled());
    fireEvent.click(sw);
    await waitFor(() => expect(store.setHubRequireLogin).toHaveBeenCalledWith(15, true));
  });
});
