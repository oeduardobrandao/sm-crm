import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCan, fakeMembership } from '@/test/makeCan';

// Follows LeadsPage.atlimit.test.tsx's mocking convention (shallow UI
// primitive stand-ins so only LeadsPage's own logic is exercised).

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
  useEntitlements: () => ({ isAtLimit: () => false, limits: null }),
}));

vi.mock('../../../hooks/useIsWorkspaceOwner', () => ({
  useIsWorkspaceOwner: () => true,
}));

vi.mock('@/components/usage/UsageMeter', () => ({
  UsageMeter: () => null,
}));

const { useAuthMock } = vi.hoisted(() => ({ useAuthMock: vi.fn() }));
vi.mock('../../../context/AuthContext', () => ({ useAuth: useAuthMock }));

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
  mockedGetLeads.mockReset();
  mockedGetLeads.mockResolvedValue([{ id: 1, nome: 'Ana Lead', status: 'novo' } as store.Lead]);
  mockedGetLeadsCount.mockReset();
  mockedGetLeadsCount.mockResolvedValue(1);
  useAuthMock.mockReturnValue({
    canSeeFinancials: true,
    can: makeCan(fakeMembership({ role: 'owner' })),
  });
});

/**
 * Task 14: LeadsPage had NO internal role check before this task -- the
 * ROUTE already blocked a legacy agent (AGENT_ROLE_PRESET.leads is 'none',
 * routePermissions.ts gates /leads on leads:ver), so gating the create/edit
 * row-action UI on `can('leads', 'editar') === true` only starts to matter
 * for a custom role that reaches this page with leads:ver but not
 * leads:editar -- exactly the gap the tab-level `ver` gate leaves open.
 */
describe('LeadsPage — mutation UI gated on leads:editar', () => {
  it('keeps a legacy admin unchanged (leads preset resolves to true, matches the old "route already restricted this" behaviour)', async () => {
    useAuthMock.mockReturnValue({
      canSeeFinancials: true,
      can: makeCan(fakeMembership({ role: 'admin' })),
    });
    renderPage();

    await waitFor(() => expect(screen.getAllByText('Ana Lead').length).toBeGreaterThan(0));
    expect(screen.getByRole('button', { name: /Novo Lead/ })).toBeInTheDocument();
    expect(screen.getByTitle('Converter em cliente')).toBeInTheDocument();
  });

  it('hides Novo Lead/Importar CSV and the row actions for a custom role with leads:ver only', async () => {
    useAuthMock.mockReturnValue({
      canSeeFinancials: true,
      can: makeCan(
        fakeMembership({ role: 'agent', role_id: 'role-1', permissions: { leads: 'ver' } }),
      ),
    });
    renderPage();

    await waitFor(() => expect(mockedGetLeads).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /Novo Lead/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Importar CSV/i })).not.toBeInTheDocument();
    expect(screen.queryByTitle('Converter em cliente')).not.toBeInTheDocument();
  });

  it('shows Novo Lead and the row actions for a custom role with leads:editar (the fix)', async () => {
    useAuthMock.mockReturnValue({
      canSeeFinancials: true,
      can: makeCan(
        fakeMembership({ role: 'agent', role_id: 'role-1', permissions: { leads: 'editar' } }),
      ),
    });
    renderPage();

    await waitFor(() => expect(screen.getAllByText('Ana Lead').length).toBeGreaterThan(0));
    expect(screen.getByRole('button', { name: /Novo Lead/ })).toBeInTheDocument();
    expect(screen.getByTitle('Converter em cliente')).toBeInTheDocument();
  });
});
