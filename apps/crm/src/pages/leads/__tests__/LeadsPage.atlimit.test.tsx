import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { isAtLimitMock, limitsRef } = vi.hoisted(() => ({
  isAtLimitMock: vi.fn(),
  limitsRef: { current: null as unknown as Record<string, number | null> },
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
    getLeads: vi.fn(),
    getLeadsCount: vi.fn(),
    addLead: vi.fn(),
    updateLead: vi.fn(),
    removeLead: vi.fn(),
    addCliente: vi.fn(),
  };
});

vi.mock('../../../hooks/useEntitlements', () => ({
  useEntitlements: () => ({ isAtLimit: isAtLimitMock, limits: limitsRef.current }),
}));

vi.mock('../../../hooks/useIsWorkspaceOwner', () => ({
  useIsWorkspaceOwner: () => true,
}));

vi.mock('@/components/usage/UsageMeter', () => ({
  UsageMeter: ({ label, used, limit }: { label: string; used: number; limit: number }) => (
    <div>{`${used} de ${limit} ${label}`}</div>
  ),
}));

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ canSeeFinancials: true, can: () => true }),
}));

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

vi.mock('@/components/ui/textarea', () => ({
  Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
}));

vi.mock('@/components/ui/table', () => ({
  Table: ({ children }: { children: React.ReactNode }) => <table>{children}</table>,
  TableBody: ({ children }: { children: React.ReactNode }) => <tbody>{children}</tbody>,
  TableCell: ({ children }: { children: React.ReactNode }) => <td>{children}</td>,
  TableHead: ({ children }: { children: React.ReactNode }) => <th>{children}</th>,
  TableHeader: ({ children }: { children: React.ReactNode }) => <thead>{children}</thead>,
  TableRow: ({ children }: { children: React.ReactNode }) => <tr>{children}</tr>,
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
  FormDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FormField: () => null,
  FormItem: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  FormLabel: ({ children }: { children: React.ReactNode }) => <label>{children}</label>,
  FormMessage: () => null,
}));

import * as store from '../../../store';
import LeadsPage from '../LeadsPage';

const mockedGetLeads = vi.mocked(store.getLeads);
const mockedGetLeadsCount = vi.mocked(store.getLeadsCount);

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <LeadsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  isAtLimitMock.mockReset();
  limitsRef.current = null;
  mockedGetLeads.mockReset();
  mockedGetLeads.mockResolvedValue([]);
  mockedGetLeadsCount.mockReset();
  mockedGetLeadsCount.mockResolvedValue(0);
});

describe('LeadsPage at-limit create button', () => {
  it('disables "Novo Lead" and shows the limit title when at the plan limit', async () => {
    isAtLimitMock.mockReturnValue(true);
    renderPage();

    await waitFor(() => {
      expect(mockedGetLeads).toHaveBeenCalled();
    });

    const createBtn = screen.getByRole('button', { name: /Novo Lead/ });
    expect(createBtn).toBeDisabled();
    expect(createBtn).toHaveAttribute('title', 'Limite do plano atingido');
  });

  it('keeps "Novo Lead" enabled and untitled when below the plan limit', async () => {
    isAtLimitMock.mockReturnValue(false);
    renderPage();

    await waitFor(() => {
      expect(mockedGetLeads).toHaveBeenCalled();
    });

    const createBtn = screen.getByRole('button', { name: /Novo Lead/ });
    expect(createBtn).not.toBeDisabled();
    expect(createBtn).not.toHaveAttribute('title');
  });

  it('calls isAtLimit with the max_leads key and the exact server count', async () => {
    isAtLimitMock.mockReturnValue(false);
    mockedGetLeads.mockResolvedValue([
      { id: 1, nome: 'A', status: 'novo' } as store.Lead,
      { id: 2, nome: 'B', status: 'novo' } as store.Lead,
      { id: 3, nome: 'C', status: 'novo' } as store.Lead,
    ]);
    mockedGetLeadsCount.mockResolvedValue(3);
    renderPage();

    await waitFor(() => {
      expect(isAtLimitMock).toHaveBeenCalledWith('max_leads', 3);
    });
  });

  it('feeds isAtLimit the exact server count, not the list length', async () => {
    isAtLimitMock.mockReturnValue(false);
    mockedGetLeads.mockResolvedValue([{ id: 1 } as never, { id: 2 } as never]);
    mockedGetLeadsCount.mockResolvedValue(1205); // truncated list scenario
    renderPage();
    await waitFor(() => expect(isAtLimitMock).toHaveBeenCalledWith('max_leads', 1205));
  });

  it('shows the header meter from the exact count', async () => {
    isAtLimitMock.mockReturnValue(false);
    limitsRef.current = { max_leads: 200 };
    mockedGetLeads.mockResolvedValue([]);
    mockedGetLeadsCount.mockResolvedValue(37);
    renderPage();
    expect(await screen.findByText('37 de 200 leads')).toBeInTheDocument();
  });

  it('hides the header meter while getLeadsCount is still pending, even with limits set', async () => {
    isAtLimitMock.mockReturnValue(false);
    limitsRef.current = { max_leads: 200 };
    mockedGetLeads.mockResolvedValue([{ id: 1 } as never, { id: 2 } as never]);
    // Never resolves -- leadsCount stays undefined for the life of the test.
    mockedGetLeadsCount.mockReturnValue(new Promise(() => {}));
    renderPage();

    // Wait for the leads list itself to finish loading (its query resolves),
    // so any state update triggered by that settles before we assert.
    await waitFor(() => expect(screen.queryByTestId('spinner')).not.toBeInTheDocument());
    expect(screen.queryByText(/de 200 leads/)).not.toBeInTheDocument();
  });

  it('hides the header meter when getLeadsCount rejects, but the create button still follows the list-length fallback', async () => {
    isAtLimitMock.mockReturnValue(false);
    limitsRef.current = { max_leads: 200 };
    mockedGetLeads.mockResolvedValue([{ id: 1 } as never, { id: 2 } as never, { id: 3 } as never]);
    mockedGetLeadsCount.mockRejectedValue(new Error('rpc failed'));
    renderPage();

    await waitFor(() => {
      // leadsCount rejected -> usedLeads falls back to leads.length (3).
      expect(isAtLimitMock).toHaveBeenCalledWith('max_leads', 3);
    });
    expect(screen.queryByText(/de 200 leads/)).not.toBeInTheDocument();
    const createBtn = screen.getByRole('button', { name: /Novo Lead/ });
    expect(createBtn).not.toBeDisabled();
  });
});
