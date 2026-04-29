import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockNavigate, openCSVSelectorMock, toastSuccessMock, toastErrorMock } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  openCSVSelectorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('sonner', () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
  },
}));

vi.mock('../../../lib/csv', () => ({
  openCSVSelector: openCSVSelectorMock,
}));

vi.mock('../../../lib/supabase');

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

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    type = 'button',
    variant,
    size,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => (
    <button type={type} data-variant={variant} data-size={size} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children, ...props }: React.HTMLAttributes<HTMLSpanElement>) => <span {...props}>{children}</span>,
}));

vi.mock('@/components/ui/spinner', () => ({
  Spinner: ({ size }: { size?: string }) => <div data-testid="spinner">Spinner {size}</div>,
}));

vi.mock('@/components/ui/select', async () => {
  const ReactModule = await vi.importActual<typeof import('react')>('react');

  interface SelectContextValue {
    value?: string;
    onValueChange?: (value: string) => void;
  }

  const SelectContext = ReactModule.createContext<SelectContextValue>({});

  function Select({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    children: React.ReactNode;
  }) {
    return (
      <SelectContext.Provider value={{ value, onValueChange }}>
        <div>{children}</div>
      </SelectContext.Provider>
    );
  }

  const SelectTrigger = ReactModule.forwardRef<
    HTMLButtonElement,
    React.ButtonHTMLAttributes<HTMLButtonElement>
  >(({ children, type = 'button', ...props }, ref) => (
    <button ref={ref} type={type} {...props}>
      {children}
    </button>
  ));

  function SelectValue() {
    const { value } = ReactModule.useContext(SelectContext);
    return <span>{value ?? ''}</span>;
  }

  function SelectContent({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>;
  }

  function SelectItem({ value, children }: { value: string; children: React.ReactNode }) {
    const { onValueChange } = ReactModule.useContext(SelectContext);
    return (
      <button type="button" onClick={() => onValueChange?.(value)}>
        {children}
      </button>
    );
  }

  return {
    Select,
    SelectTrigger,
    SelectValue,
    SelectContent,
    SelectItem,
  };
});

vi.mock('@/components/ui/dropdown-menu', async () => {
  const ReactModule = await vi.importActual<typeof import('react')>('react');

  interface DropdownContextValue {
    value?: string;
    onValueChange?: (value: string) => void;
  }

  const DropdownContext = ReactModule.createContext<DropdownContextValue>({});

  function DropdownMenu({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>;
  }

  function DropdownMenuTrigger({ children }: { children: React.ReactNode }) {
    return <>{children}</>;
  }

  function DropdownMenuContent({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>;
  }

  function DropdownMenuLabel({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>;
  }

  function DropdownMenuSeparator() {
    return <hr />;
  }

  function DropdownMenuItem({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
    return <button type="button" onClick={onClick}>{children}</button>;
  }

  function DropdownMenuRadioGroup({
    value,
    onValueChange,
    children,
  }: {
    value?: string;
    onValueChange?: (value: string) => void;
    children: React.ReactNode;
  }) {
    return (
      <DropdownContext.Provider value={{ value, onValueChange }}>
        <div>{children}</div>
      </DropdownContext.Provider>
    );
  }

  function DropdownMenuRadioItem({ value, children }: { value: string; children: React.ReactNode }) {
    const { onValueChange } = ReactModule.useContext(DropdownContext);
    return (
      <button type="button" onClick={() => onValueChange?.(value)}>
        {children}
      </button>
    );
  }

  return {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuItem,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
  };
});

vi.mock('@/components/ui/dialog', async () => {
  const ReactModule = await vi.importActual<typeof import('react')>('react');

  interface DialogContextValue {
    open: boolean;
    onOpenChange?: (open: boolean) => void;
  }

  const DialogContext = ReactModule.createContext<DialogContextValue>({ open: false });

  function Dialog({
    open: openProp = false,
    onOpenChange,
    children,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children: React.ReactNode;
  }) {
    const [open, setOpen] = ReactModule.useState(openProp);
    ReactModule.useEffect(() => { setOpen(openProp); }, [openProp]);
    return (
      <DialogContext.Provider value={{ open, onOpenChange: (v: boolean) => { setOpen(v); onOpenChange?.(v); } }}>
        <div>{children}</div>
      </DialogContext.Provider>
    );
  }

  function DialogContent({ children }: { children: React.ReactNode; onConfirmClose?: () => void }) {
    const { open } = ReactModule.useContext(DialogContext);
    return open ? <div role="dialog">{children}</div> : null;
  }

  function DialogHeader({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>;
  }

  function DialogFooter({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>;
  }

  function DialogTitle({ children }: { children: React.ReactNode }) {
    return <h2>{children}</h2>;
  }

  return {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogFooter,
    DialogTitle,
  };
});

vi.mock('@/components/ui/alert-dialog', async () => {
  const ReactModule = await vi.importActual<typeof import('react')>('react');

  interface AlertDialogContextValue {
    open: boolean;
    onOpenChange?: (open: boolean) => void;
  }

  const AlertDialogContext = ReactModule.createContext<AlertDialogContextValue>({ open: false });

  function AlertDialog({
    open: openProp = false,
    onOpenChange,
    children,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children: React.ReactNode;
  }) {
    const [open, setOpen] = ReactModule.useState(openProp);
    ReactModule.useEffect(() => { setOpen(openProp); }, [openProp]);
    return (
      <AlertDialogContext.Provider value={{ open, onOpenChange: (v: boolean) => { setOpen(v); onOpenChange?.(v); } }}>
        <div>{children}</div>
      </AlertDialogContext.Provider>
    );
  }

  function AlertDialogContent({ children }: { children: React.ReactNode }) {
    const { open } = ReactModule.useContext(AlertDialogContext);
    return open ? <div role="alertdialog">{children}</div> : null;
  }

  function AlertDialogHeader({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>;
  }

  function AlertDialogFooter({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>;
  }

  function AlertDialogTitle({ children }: { children: React.ReactNode }) {
    return <h2>{children}</h2>;
  }

  function AlertDialogAction({
    children,
    onClick,
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
    const { onOpenChange } = ReactModule.useContext(AlertDialogContext);
    return (
      <button
        type="button"
        onClick={(event) => {
          onClick?.(event);
          onOpenChange?.(false);
        }}
      >
        {children}
      </button>
    );
  }

  function AlertDialogCancel({ children }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
    const { onOpenChange } = ReactModule.useContext(AlertDialogContext);
    return (
      <button type="button" onClick={() => onOpenChange?.(false)}>
        {children}
      </button>
    );
  }

  return {
    AlertDialog,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogFooter,
    AlertDialogTitle,
    AlertDialogAction,
    AlertDialogCancel,
  };
});

import * as store from '../../../store';
import * as supabaseModule from '../../../lib/supabase';
import ClientesPage from '../ClientesPage';

type MockedSupabaseModule = typeof supabaseModule & {
  __getSupabaseCalls: () => Array<{
    table: string;
    operation: string;
    selectArgs: unknown[][];
    modifiers: Array<{ method: string; args: unknown[] }>;
  }>;
  __queueSupabaseResult: (
    table: string,
    operation: 'select' | 'insert' | 'update' | 'delete' | 'upsert',
    ...responses: Array<{ data?: unknown; error?: unknown; count?: number | null }>
  ) => void;
  __resetSupabaseMock: () => void;
};

const mockedSupabase = supabaseModule as MockedSupabaseModule;
const mockedGetClientes = vi.mocked(store.getClientes);
const mockedAddCliente = vi.mocked(store.addCliente);
const mockedUpdateCliente = vi.mocked(store.updateCliente);
const mockedRemoveCliente = vi.mocked(store.removeCliente);

function makeCliente(overrides: Partial<store.Cliente> = {}): store.Cliente {
  return {
    id: 1,
    nome: 'Clínica Aurora',
    sigla: 'CA',
    cor: '#123456',
    plano: 'Premium',
    email: 'contato@aurora.com',
    telefone: '(85) 99999-0000',
    status: 'ativo',
    valor_mensal: 3200,
    notion_page_url: '',
    data_pagamento: 10,
    ...overrides,
  };
}

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
}

function renderPage() {
  const queryClient = createTestQueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <ClientesPage />
    </QueryClientProvider>,
  );
  return { queryClient };
}

function getClientCard(name: string) {
  const card = screen.getByRole('button', { name }).closest('.team-card');
  expect(card).not.toBeNull();
  return card as HTMLElement;
}

function getClientOrder(names: string[]) {
  return screen
    .getAllByRole('button', { name: new RegExp(names.join('|')) })
    .map((button) => button.textContent?.trim() ?? '')
    .filter((text) => names.includes(text));
}

function getCSVCallbacks() {
  const lastCall = openCSVSelectorMock.mock.calls.at(-1);
  expect(lastCall).toBeDefined();
  return {
    onUpload: lastCall?.[0] as (rows: Array<Record<string, string>>) => Promise<void>,
    onError: lastCall?.[1] as (error: Error) => void,
  };
}

beforeEach(() => {
  mockNavigate.mockReset();
  openCSVSelectorMock.mockReset();
  toastSuccessMock.mockReset();
  toastErrorMock.mockReset();
  mockedSupabase.__resetSupabaseMock();

  mockedGetClientes.mockReset();
  mockedAddCliente.mockReset();
  mockedUpdateCliente.mockReset();
  mockedRemoveCliente.mockReset();

  mockedGetClientes.mockResolvedValue([]);
  mockedAddCliente.mockImplementation(async (payload) => ({ id: 99, ...payload } as store.Cliente));
  mockedUpdateCliente.mockImplementation(async (id, payload) => ({ id, ...makeCliente(payload) }));
  mockedRemoveCliente.mockResolvedValue(undefined);
});

describe('ClientesPage', () => {
  it('shows the loading state before rendering fetched clients', async () => {
    let resolveClientes: ((clientes: store.Cliente[]) => void) | undefined;
    mockedGetClientes.mockReturnValueOnce(
      new Promise<store.Cliente[]>((resolve) => {
        resolveClientes = resolve;
      }),
    );

    renderPage();

    expect(screen.getByTestId('spinner')).toBeInTheDocument();

    resolveClientes?.([makeCliente({ nome: 'Ana Costa', sigla: 'AC' })]);

    expect(await screen.findByRole('button', { name: 'Ana Costa' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByTestId('spinner')).not.toBeInTheDocument();
    });
  });

  it('filters by status, searches by name or email, and sorts the client cards', async () => {
    mockedGetClientes.mockResolvedValue([
      makeCliente({ id: 1, nome: 'Alpha Studio', sigla: 'AS', email: 'alpha@studio.com', valor_mensal: 3200, status: 'ativo' }),
      makeCliente({ id: 2, nome: 'Bruno Labs', sigla: 'BL', email: 'bruno@labs.com', valor_mensal: 1500, status: 'pausado' }),
      makeCliente({ id: 3, nome: 'Carla Care', sigla: 'CC', email: 'carla@care.com', valor_mensal: 2800, status: 'encerrado' }),
    ]);

    renderPage();

    await screen.findByRole('button', { name: 'Alpha Studio' });

    fireEvent.change(screen.getByPlaceholderText('Buscar por nome ou e-mail...'), {
      target: { value: 'carla@care.com' },
    });

    expect(screen.getByRole('button', { name: 'Carla Care' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Alpha Studio' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Buscar por nome ou e-mail...'), {
      target: { value: '' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Valor Mensal' }));
    expect(getClientOrder(['Alpha Studio', 'Bruno Labs', 'Carla Care'])).toEqual([
      'Bruno Labs',
      'Carla Care',
      'Alpha Studio',
    ]);

    const sortToggle = screen.getByRole('button', { name: 'Decrescente' });

    expect(sortToggle).toBeDefined();
    fireEvent.click(sortToggle as HTMLButtonElement);

    expect(getClientOrder(['Alpha Studio', 'Bruno Labs', 'Carla Care'])).toEqual([
      'Alpha Studio',
      'Carla Care',
      'Bruno Labs',
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Pausado' }));

    expect(screen.getByRole('button', { name: 'Bruno Labs' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Alpha Studio' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Carla Care' })).not.toBeInTheDocument();
  });

  it('submits the add flow with normalized store payloads', async () => {
    const { queryClient } = renderPage();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    vi.spyOn(Math, 'random').mockReturnValue(0);

    fireEvent.click(screen.getByRole('button', { name: 'Novo Cliente' }));

    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Nome *'), { target: { value: 'Clínica Solaris' } });
    fireEvent.change(within(dialog).getByLabelText('E-mail'), { target: { value: 'oi@solaris.com' } });
    fireEvent.change(within(dialog).getByLabelText('Telefone'), { target: { value: '(85) 98888-0000' } });
    fireEvent.change(within(dialog).getByLabelText('Plano'), { target: { value: 'Growth' } });
    fireEvent.change(within(dialog).getByLabelText('Valor Mensal (R$)'), { target: { value: '2500' } });
    fireEvent.change(within(dialog).getByLabelText('URL do Notion'), { target: { value: 'https://notion.so/solaris' } });
    fireEvent.change(within(dialog).getByLabelText('Dia de Pagamento (1-31)'), { target: { value: '18' } });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => {
      expect(mockedAddCliente).toHaveBeenCalledWith({
        nome: 'Clínica Solaris',
        email: 'oi@solaris.com',
        telefone: '(85) 98888-0000',
        plano: 'Growth',
        valor_mensal: 2500,
        notion_page_url: 'https://notion.so/solaris',
        data_pagamento: 18,
        sigla: 'CS',
        cor: '#e74c3c',
        status: 'ativo',
      });
    });

    expect(toastSuccessMock).toHaveBeenCalledWith('Cliente adicionado');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clientes'] });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('prefills and submits the edit flow, including status updates', async () => {
    mockedGetClientes.mockResolvedValue([
      makeCliente({
        id: 7,
        nome: 'Beta Care',
        sigla: 'BC',
        email: 'beta@care.com',
        telefone: '(85) 97777-0000',
        plano: 'Base',
        valor_mensal: 1800,
        notion_page_url: 'https://notion.so/beta',
        data_pagamento: 8,
        status: 'ativo',
      }),
    ]);

    const { queryClient } = renderPage();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await screen.findByRole('button', { name: 'Beta Care' });

    const card = getClientCard('Beta Care');
    fireEvent.click(within(card).getByRole('button', { name: 'Editar' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByDisplayValue('Beta Care')).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue('beta@care.com')).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText('Nome *'), { target: { value: 'Beta Care Plus' } });
    fireEvent.change(within(dialog).getByLabelText('Valor Mensal (R$)'), { target: { value: '2100' } });
    fireEvent.change(within(dialog).getByLabelText('Dia de Pagamento (1-31)'), { target: { value: '22' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pausado' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }));

    await waitFor(() => {
      expect(mockedUpdateCliente).toHaveBeenCalledWith(7, {
        nome: 'Beta Care Plus',
        email: 'beta@care.com',
        telefone: '(85) 97777-0000',
        plano: 'Base',
        valor_mensal: 2100,
        notion_page_url: 'https://notion.so/beta',
        data_pagamento: 22,
        status: 'pausado',
      });
    });

    expect(toastSuccessMock).toHaveBeenCalledWith('Cliente atualizado');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clientes'] });
  });

  it('removes a client after confirmation', async () => {
    mockedGetClientes.mockResolvedValue([
      makeCliente({ id: 21, nome: 'Delta Clinic', sigla: 'DC' }),
    ]);

    const { queryClient } = renderPage();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    await screen.findByRole('button', { name: 'Delta Clinic' });

    const card = getClientCard('Delta Clinic');
    fireEvent.click(within(card).getByRole('button', { name: 'Remover' }));

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sim' }));

    await waitFor(() => {
      expect(mockedRemoveCliente).toHaveBeenCalledWith(21);
    });

    expect(toastSuccessMock).toHaveBeenCalledWith('Cliente removido');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clientes'] });
  });

  it('imports CSV rows, skips invalid entries, and reports the success count', async () => {
    const { queryClient } = renderPage();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    vi.spyOn(Math, 'random').mockReturnValue(0);

    mockedAddCliente
      .mockResolvedValueOnce(makeCliente({ id: 31, nome: 'Atlas Saúde', sigla: 'AS' }))
      .mockRejectedValueOnce(new Error('Falhou'))
      .mockResolvedValueOnce(makeCliente({ id: 32, nome: 'Cora Studio', sigla: 'CS' }));

    fireEvent.click(screen.getByRole('button', { name: 'Importar CSV' }));

    const { onUpload } = getCSVCallbacks();

    await act(async () => {
      await onUpload([
        { nome: 'Atlas Saúde', email: 'atlas@saude.com', valor_mensal: '1200', data_pagamento: '5' },
        { nome: '' },
        { nome: 'Beta Labs', email: 'beta@labs.com', valor_mensal: '1800', data_pagamento: '10' },
        { nome: 'Cora Studio', email: 'cora@studio.com', valor_mensal: '2200', data_pagamento: '15' },
      ]);
    });

    expect(mockedAddCliente).toHaveBeenCalledTimes(3);
    expect(mockedAddCliente).toHaveBeenNthCalledWith(1, {
      nome: 'Atlas Saúde',
      email: 'atlas@saude.com',
      telefone: '',
      plano: '',
      valor_mensal: 1200,
      notion_page_url: '',
      data_pagamento: 5,
      sigla: 'AS',
      cor: '#e74c3c',
      status: 'ativo',
    });
    expect(mockedAddCliente).toHaveBeenNthCalledWith(3, {
      nome: 'Cora Studio',
      email: 'cora@studio.com',
      telefone: '',
      plano: '',
      valor_mensal: 2200,
      notion_page_url: '',
      data_pagamento: 15,
      sigla: 'CS',
      cor: '#e74c3c',
      status: 'ativo',
    });
    expect(toastSuccessMock).toHaveBeenCalledWith('2 clientes importados com sucesso!');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['clientes'] });
  });

  it('surfaces CSV parsing errors through toast feedback', async () => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Importar CSV' }));

    const { onError } = getCSVCallbacks();
    onError(new Error('Arquivo inválido'));

    expect(toastErrorMock).toHaveBeenCalledWith('Arquivo inválido');
    expect(mockedAddCliente).not.toHaveBeenCalled();
  });

  it('queries instagram avatars and falls back to initials when no avatar is returned', async () => {
    mockedGetClientes.mockResolvedValue([
      makeCliente({ id: 11, nome: 'Ana Costa', sigla: 'AC' }),
      makeCliente({ id: 12, nome: 'Bruno Lima', sigla: 'BL' }),
    ]);
    mockedSupabase.__queueSupabaseResult('instagram_accounts', 'select', {
      data: [
        { client_id: 11, profile_picture_url: 'https://cdn.mesaas.com/ana.jpg' },
      ],
      error: null,
    });

    renderPage();

    expect(await screen.findByRole('img', { name: 'AC' })).toHaveAttribute('src', 'https://cdn.mesaas.com/ana.jpg');

    const fallbackCard = getClientCard('Bruno Lima');
    expect(within(fallbackCard).queryByRole('img')).not.toBeInTheDocument();
    expect(within(fallbackCard).getByText('BL')).toBeInTheDocument();

    await waitFor(() => {
      const avatarCall = mockedSupabase.__getSupabaseCalls().find((entry) => entry.table === 'instagram_accounts');
      expect(avatarCall).toBeDefined();
      expect(avatarCall?.selectArgs).toEqual([['client_id, profile_picture_url']]);
      expect(avatarCall?.modifiers).toContainEqual({ method: 'in', args: ['client_id', [11, 12]] });
      expect(avatarCall?.modifiers).toContainEqual({ method: 'not', args: ['profile_picture_url', 'is', null] });
    });
  });
});
