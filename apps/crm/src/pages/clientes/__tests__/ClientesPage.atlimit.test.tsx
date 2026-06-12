import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { isAtLimitMock } = vi.hoisted(() => ({
  isAtLimitMock: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('../../../lib/csv', () => ({ openCSVSelector: vi.fn() }));

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

// Control the at-limit decision directly.
vi.mock('../../../hooks/useEntitlements', () => ({
  useEntitlements: () => ({ isAtLimit: isAtLimitMock }),
}));

// The CSV import button is wrapped in FeatureGate; render its children unconditionally
// so it does not interfere with the create-button assertions.
vi.mock('@/components/paywall/FeatureGate', () => ({
  FeatureGate: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

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
  Badge: ({ children, ...props }: React.HTMLAttributes<HTMLSpanElement>) => (
    <span {...props}>{children}</span>
  ),
}));

vi.mock('@/components/ui/spinner', () => ({
  Spinner: ({ size }: { size?: string }) => <div data-testid="spinner">Spinner {size}</div>,
}));

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectValue: () => <span />,
  SelectContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuLabel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuRadioGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DropdownMenuRadioItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: () => null,
  DialogContent: () => null,
  DialogHeader: () => null,
  DialogFooter: () => null,
  DialogTitle: () => null,
}));

vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: () => null,
  AlertDialogContent: () => null,
  AlertDialogHeader: () => null,
  AlertDialogFooter: () => null,
  AlertDialogTitle: () => null,
  AlertDialogAction: () => null,
  AlertDialogCancel: () => null,
}));

vi.mock('@/components/ui/form', () => ({
  Form: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FormControl: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FormField: () => null,
  FormItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FormLabel: ({ children }: { children: React.ReactNode }) => <label>{children}</label>,
  FormMessage: () => null,
}));

import * as store from '../../../store';
import ClientesPage from '../ClientesPage';

const mockedGetClientes = vi.mocked(store.getClientes);

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ClientesPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  isAtLimitMock.mockReset();
  mockedGetClientes.mockReset();
  mockedGetClientes.mockResolvedValue([]);
});

describe('ClientesPage at-limit create button', () => {
  it('disables "Novo Cliente" and shows the limit title when at the plan limit', async () => {
    isAtLimitMock.mockReturnValue(true);
    renderPage();

    await waitFor(() => {
      expect(mockedGetClientes).toHaveBeenCalled();
    });

    const createBtn = screen.getByRole('button', { name: /Novo Cliente/ });
    expect(createBtn).toBeDisabled();
    expect(createBtn).toHaveAttribute('title', 'Limite do plano atingido');
  });

  it('keeps "Novo Cliente" enabled and untitled when below the plan limit', async () => {
    isAtLimitMock.mockReturnValue(false);
    renderPage();

    await waitFor(() => {
      expect(mockedGetClientes).toHaveBeenCalled();
    });

    const createBtn = screen.getByRole('button', { name: /Novo Cliente/ });
    expect(createBtn).not.toBeDisabled();
    expect(createBtn).not.toHaveAttribute('title');
  });

  it('calls isAtLimit with the max_clients key and the current client count', async () => {
    isAtLimitMock.mockReturnValue(false);
    mockedGetClientes.mockResolvedValue([
      { id: 1, nome: 'A', sigla: 'A', cor: '#000', status: 'ativo' } as store.Cliente,
      { id: 2, nome: 'B', sigla: 'B', cor: '#000', status: 'ativo' } as store.Cliente,
    ]);
    renderPage();

    await waitFor(() => {
      expect(isAtLimitMock).toHaveBeenCalledWith('max_clients', 2);
    });
  });
});
