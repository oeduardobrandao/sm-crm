import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCan, fakeMembership } from '@/test/makeCan';

// The phone branch (below 768px) of /clientes: jsdom's matchMedia reports false, so
// useIsDesktop(768) is false and the page renders ClientesPhone on the real phone kit.

const {
  mockNavigate,
  openCSVSelectorMock,
  toastSuccessMock,
  mockUseAuth,
  isAtLimitMock,
  hasFeatureMock,
  limitsRef,
} = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  openCSVSelectorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  mockUseAuth: vi.fn(),
  isAtLimitMock: vi.fn(() => false),
  hasFeatureMock: vi.fn(() => true),
  limitsRef: { current: null as null | Record<string, number | null> },
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

vi.mock('sonner', () => ({ toast: { success: toastSuccessMock, error: vi.fn() } }));
vi.mock('../../../lib/csv', () => ({ openCSVSelector: openCSVSelectorMock }));
vi.mock('../../../lib/supabase');

vi.mock('../../../context/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../context/AuthContext')>();
  return { ...actual, useAuth: mockUseAuth };
});

vi.mock('../../../hooks/useEntitlements', () => ({
  useEntitlements: () => ({
    isAtLimit: isAtLimitMock,
    limits: limitsRef.current,
    hasFeature: hasFeatureMock,
    isLoading: false,
  }),
}));

vi.mock('../../../hooks/useIsWorkspaceOwner', () => ({ useIsWorkspaceOwner: () => true }));

// The real shell actions need the KB query and notifications; their own suites cover them.
vi.mock('@/components/layout/PhoneShellHeader', () => ({
  PhoneShellActions: () => <div data-testid="shell-actions" />,
}));

vi.mock('../../../store', async () => {
  const actual = await vi.importActual<typeof import('../../../store')>('../../../store');
  return {
    ...actual,
    getClientes: vi.fn(),
    addCliente: vi.fn(),
    updateCliente: vi.fn(),
    removeCliente: vi.fn(),
  };
});

// The page's own dialogs (F0c turns them into sheets): plain stand-ins.
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open?: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div role="dialog" aria-label="form">
      {children}
    </div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ open, children }: { open?: boolean; children: React.ReactNode }) =>
    open ? <div role="alertdialog">{children}</div> : null,
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  AlertDialogAction: ({ children, onClick }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  AlertDialogCancel: ({ children }: { children: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));

import * as store from '../../../store';
import ClientesPage from '../ClientesPage';

const mockedGetClientes = vi.mocked(store.getClientes);
const mockedAddCliente = vi.mocked(store.addCliente);
const mockedRemoveCliente = vi.mocked(store.removeCliente);

function makeCliente(overrides: Partial<store.Cliente> = {}): store.Cliente {
  return {
    id: 1,
    nome: 'Clínica Aurora',
    sigla: 'CA',
    cor: '#123456',
    plano: 'Premium',
    email: 'contato@aurora.com',
    telefone: '',
    status: 'ativo',
    valor_mensal: 3200,
    notion_page_url: '',
    data_pagamento: 10,
    ...overrides,
  };
}

const THREE = [
  makeCliente({ id: 1, nome: 'Alpha Studio', valor_mensal: 3200, status: 'ativo' }),
  makeCliente({ id: 2, nome: 'Bruno Labs', valor_mensal: 1500, status: 'pausado' }),
  makeCliente({
    id: 3,
    nome: 'Carla Care',
    valor_mensal: 2800,
    status: 'encerrado',
    notion_page_url: 'https://notion.so/carla',
  }),
];

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ClientesPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** Row names in on-screen order. */
function rowOrder() {
  return Array.from(document.querySelectorAll('.phone-el-row .phone-el-title')).map(
    (el) => el.textContent,
  );
}

const row = (name: string) =>
  screen.getByRole('link', { name: new RegExp(name) }).closest('li') as HTMLElement;

beforeEach(() => {
  mockNavigate.mockReset();
  openCSVSelectorMock.mockReset();
  toastSuccessMock.mockReset();
  isAtLimitMock.mockReset().mockReturnValue(false);
  hasFeatureMock.mockReset().mockReturnValue(true);
  limitsRef.current = null;
  mockUseAuth.mockReset().mockReturnValue({ canSeeFinancials: true, can: () => true });
  mockedGetClientes.mockReset().mockResolvedValue(THREE);
  mockedAddCliente.mockReset().mockImplementation(async (p) => ({ id: 99, ...p }) as store.Cliente);
  mockedRemoveCliente.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ClientesPage on phones', () => {
  it('renders the large-title header instead of .header, with the usage line and linked rows', async () => {
    limitsRef.current = { max_clients: 4 };
    renderPage();

    expect(await screen.findByRole('heading', { level: 1, name: 'Clientes' })).toBeInTheDocument();
    expect(document.querySelector('.header')).toBeNull();
    expect(await screen.findByText('3 de 4 clientes')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Fazer upgrade' })).toHaveAttribute(
      'href',
      '/configuracao/cobranca',
    );
    expect(screen.getByRole('link', { name: /Alpha Studio/ })).toHaveAttribute(
      'href',
      '/clientes/1',
    );
    expect(screen.getByText('Ordenado por nome')).toBeInTheDocument();
    expect(rowOrder()).toEqual(['Alpha Studio', 'Bruno Labs', 'Carla Care']);
  });

  it('shows the client count when the plan has no limit', async () => {
    renderPage();
    expect(await screen.findByText('3 clientes')).toBeInTheDocument();
  });

  it('shows an empty state with Novo Cliente when there are no clients', async () => {
    mockedGetClientes.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText('Nenhum cliente ainda')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Novo Cliente' }));
    expect(screen.getByRole('heading', { name: 'Novo Cliente' })).toBeInTheDocument();
  });

  it('searches from the header and offers Limpar filtros when nothing matches', async () => {
    renderPage();
    await screen.findByText('Alpha Studio');

    fireEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    const input = screen.getByRole('searchbox', { name: 'Buscar por nome ou e-mail...' });
    fireEvent.change(input, { target: { value: 'bruno' } });
    expect(rowOrder()).toEqual(['Bruno Labs']);

    fireEvent.change(input, { target: { value: 'zzz' } });
    expect(screen.getByText('Nenhum cliente encontrado.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(rowOrder()).toEqual(['Alpha Studio', 'Bruno Labs', 'Carla Care']);
  });

  it('filters by status and sorts from the Filtros sheet', async () => {
    renderPage();
    await screen.findByText('Alpha Studio');

    fireEvent.click(screen.getByRole('button', { name: 'Filtros' }));
    const sheet = await screen.findByRole('dialog', { name: 'Filtros' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Valor Mensal' }));
    expect(rowOrder()).toEqual(['Bruno Labs', 'Carla Care', 'Alpha Studio']);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Decrescente' }));
    expect(rowOrder()).toEqual(['Alpha Studio', 'Carla Care', 'Bruno Labs']);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Pausado' }));
    expect(within(sheet).getByRole('button', { name: 'Ver 1' })).toBeInTheDocument();
    expect(rowOrder()).toEqual(['Bruno Labs']);

    fireEvent.click(within(sheet).getByRole('button', { name: 'Limpar' }));
    expect(rowOrder()).toEqual(['Alpha Studio', 'Bruno Labs', 'Carla Care']);
  });

  it('keeps the financial sort out of the sheet without financial access', async () => {
    mockUseAuth.mockReturnValue({ canSeeFinancials: false, can: () => true });
    renderPage();
    await screen.findByText('Alpha Studio');

    fireEvent.click(screen.getByRole('button', { name: 'Filtros' }));
    const sheet = await screen.findByRole('dialog', { name: 'Filtros' });
    expect(within(sheet).queryByRole('button', { name: 'Valor Mensal' })).toBeNull();
    expect(within(sheet).getByRole('button', { name: 'Dia Pagamento' })).toBeInTheDocument();
  });

  it('"+" opens Novo Cliente / Importar CSV with the CSV columns', async () => {
    renderPage();
    await screen.findByText('Alpha Studio');

    fireEvent.click(screen.getByRole('button', { name: 'Novo cliente ou importar CSV' }));
    const sheet = await screen.findByRole('dialog', { name: 'Novo cliente ou importar CSV' });
    expect(within(sheet).getByText(/Colunas: nome\*/)).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Importar CSV' }));
    expect(openCSVSelectorMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Novo cliente ou importar CSV' }));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: 'Novo cliente ou importar CSV' })).getByRole(
        'button',
        { name: 'Novo Cliente' },
      ),
    );
    expect(await screen.findByRole('heading', { name: 'Novo Cliente' })).toBeInTheDocument();
  });

  it('disables Novo Cliente at the plan limit and says why', async () => {
    isAtLimitMock.mockReturnValue(true);
    renderPage();
    await screen.findByText('Alpha Studio');

    fireEvent.click(screen.getByRole('button', { name: 'Novo cliente ou importar CSV' }));
    const sheet = await screen.findByRole('dialog', { name: 'Novo cliente ou importar CSV' });
    expect(within(sheet).getByRole('button', { name: 'Novo Cliente' })).toBeDisabled();
    expect(within(sheet).getByText('Limite do plano atingido.')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Importar CSV' })).toBeEnabled();
  });

  it('sends a locked CSV import to Cobrança instead of opening the file picker', async () => {
    hasFeatureMock.mockReturnValue(false);
    renderPage();
    await screen.findByText('Alpha Studio');

    fireEvent.click(screen.getByRole('button', { name: 'Novo cliente ou importar CSV' }));
    const sheet = await screen.findByRole('dialog', { name: 'Novo cliente ou importar CSV' });
    expect(
      within(sheet).getByText('Importação CSV não está disponível no seu plano.'),
    ).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Importar CSV' }));
    expect(openCSVSelectorMock).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/configuracao/cobranca');
  });

  it('row menu: Abrir no Notion, Editar (prefilled form) and Remover with confirmation', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    renderPage();
    await screen.findByText('Carla Care');

    fireEvent.click(screen.getByRole('button', { name: 'Mais ações de Carla Care' }));
    let menu = await screen.findByRole('menu', { name: 'Ações do cliente' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Abrir no Notion' }));
    expect(openSpy).toHaveBeenCalledWith(
      'https://notion.so/carla',
      '_blank',
      'noopener,noreferrer',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Mais ações de Carla Care' }));
    menu = await screen.findByRole('menu', { name: 'Ações do cliente' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Editar' }));
    expect(await screen.findByRole('heading', { name: 'Editar Cliente' })).toBeInTheDocument();
    expect(screen.getByLabelText('Nome *')).toHaveValue('Carla Care');

    // No Notion item for a client without a link.
    fireEvent.click(screen.getByRole('button', { name: 'Mais ações de Alpha Studio' }));
    menu = await screen.findByRole('menu', { name: 'Ações do cliente' });
    expect(within(menu).queryByRole('menuitem', { name: 'Abrir no Notion' })).toBeNull();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Remover' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Remover este cliente?');
    fireEvent.click(screen.getByRole('button', { name: 'Sim' }));
    await waitFor(() => expect(mockedRemoveCliente).toHaveBeenCalledWith(1));
  });

  it('puts Editar and Remover behind the swipe (and Notion on the leading side)', async () => {
    renderPage();
    await screen.findByText('Carla Care');

    const carla = row('Carla Care');
    expect(within(carla).getByRole('button', { name: 'Notion' })).toBeInTheDocument();
    fireEvent.click(within(row('Bruno Labs')).getByRole('button', { name: 'Remover' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sim' }));
    await waitFor(() => expect(mockedRemoveCliente).toHaveBeenCalledWith(2));
  });

  it('hides "+", the row menus and the swipe actions for a custom role with clientes:ver only', async () => {
    mockUseAuth.mockReturnValue({
      canSeeFinancials: true,
      can: makeCan(
        fakeMembership({ role: 'agent', role_id: 'role-1', permissions: { clientes: 'ver' } }),
      ),
    });
    renderPage();
    await screen.findByText('Alpha Studio');

    expect(screen.queryByRole('button', { name: 'Novo cliente ou importar CSV' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mais ações de Alpha Studio' })).toBeNull();
    expect(within(row('Alpha Studio')).queryByRole('button', { name: 'Editar' })).toBeNull();
    // Notion is not an edit action: it stays.
    expect(screen.getByRole('button', { name: 'Mais ações de Carla Care' })).toBeInTheDocument();
  });

  it('adds a client through the phone form rows', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    renderPage();
    await screen.findByText('Alpha Studio');

    fireEvent.click(screen.getByRole('button', { name: 'Novo cliente ou importar CSV' }));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: 'Novo cliente ou importar CSV' })).getByRole(
        'button',
        { name: 'Novo Cliente' },
      ),
    );
    const form = await screen.findByRole('dialog', { name: 'form' });
    expect(form.querySelector('.phone-form-row')).not.toBeNull();
    fireEvent.change(within(form).getByLabelText('Nome *'), {
      target: { value: 'Clínica Solaris' },
    });
    fireEvent.change(within(form).getByLabelText('Valor Mensal (R$)'), {
      target: { value: '2500' },
    });
    fireEvent.change(within(form).getByLabelText('Dia de Pagamento (1-31)'), {
      target: { value: '18' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Salvar' }));

    await waitFor(() =>
      expect(mockedAddCliente).toHaveBeenCalledWith({
        nome: 'Clínica Solaris',
        email: '',
        telefone: '',
        plano: '',
        valor_mensal: 2500,
        data_pagamento: 18,
        sigla: 'CS',
        cor: '#e74c3c',
        status: 'ativo',
      }),
    );
    expect(toastSuccessMock).toHaveBeenCalledWith('Cliente adicionado');
  });
});
