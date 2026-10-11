import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCan, fakeMembership } from '@/test/makeCan';

// The phone branch (below 768px) of /leads: jsdom's matchMedia reports false, so
// useIsDesktop(768) is false and the page renders LeadsPhone on the real phone kit.

const { useAuthMock, isAtLimitMock, limitsRef, openCSVSelectorMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  isAtLimitMock: vi.fn(() => false),
  limitsRef: { current: null as null | Record<string, number | null> },
  openCSVSelectorMock: vi.fn(),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../lib/csv', () => ({ openCSVSelector: openCSVSelectorMock }));
vi.mock('../../../lib/supabase');

vi.mock('../../../context/AuthContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../context/AuthContext')>();
  return { ...actual, useAuth: useAuthMock };
});

vi.mock('../../../hooks/useEntitlements', () => ({
  useEntitlements: () => ({
    isAtLimit: isAtLimitMock,
    limits: limitsRef.current,
    hasFeature: () => true,
    isLoading: false,
  }),
}));
vi.mock('../../../hooks/useIsWorkspaceOwner', () => ({ useIsWorkspaceOwner: () => true }));

vi.mock('@/components/layout/PhoneShellHeader', () => ({
  PhoneShellActions: () => <div data-testid="shell-actions" />,
}));

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
import LeadsPage from '../LeadsPage';

const mockedGetLeads = vi.mocked(store.getLeads);
const mockedGetLeadsCount = vi.mocked(store.getLeadsCount);
const mockedUpdateLead = vi.mocked(store.updateLead);
const mockedRemoveLead = vi.mocked(store.removeLead);

function makeLead(overrides: Partial<store.Lead>): store.Lead {
  return {
    id: 1,
    nome: 'Lead',
    email: '',
    telefone: '',
    instagram: '',
    canal: '',
    especialidade: '',
    faturamento: '',
    tags: '',
    notas: '',
    objetivo: '',
    origem: 'manual',
    status: 'novo',
    created_at: '2026-10-08T12:00:00Z',
    ...overrides,
  } as store.Lead;
}

const LEADS = [
  makeLead({ id: 1, nome: 'Padaria Trigo Bom', instagram: '@trigobom', canal: 'Instagram' }),
  makeLead({
    id: 2,
    nome: 'Dra. Helena Prado',
    status: 'qualificado',
    canal: 'Indicação',
    created_at: '2026-10-06T12:00:00Z',
  }),
];

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <LeadsPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const rowOrder = () =>
  Array.from(document.querySelectorAll('.phone-el-row .phone-el-title')).map((e) => e.textContent);

beforeEach(() => {
  isAtLimitMock.mockReset().mockReturnValue(false);
  limitsRef.current = null;
  openCSVSelectorMock.mockReset();
  useAuthMock.mockReset().mockReturnValue({
    canSeeFinancials: true,
    can: makeCan(fakeMembership({ role: 'owner' })),
  });
  mockedGetLeads.mockReset().mockResolvedValue(LEADS);
  mockedGetLeadsCount.mockReset().mockResolvedValue(2);
  mockedUpdateLead.mockReset().mockResolvedValue(undefined as never);
  mockedRemoveLead.mockReset().mockResolvedValue(undefined);
});

describe('LeadsPage on phones', () => {
  it('renders the large-title header, usage line, status chips and rows', async () => {
    limitsRef.current = { max_leads: 50 };
    renderPage();

    expect(await screen.findByRole('heading', { level: 1, name: 'Leads' })).toBeInTheDocument();
    expect(document.querySelector('.header')).toBeNull();
    expect(await screen.findByText('2 de 50 leads')).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Status' })).toBeInTheDocument();
    expect(screen.getByText('Ordenado por data de criação · Decrescente')).toBeInTheDocument();
    expect(rowOrder()).toEqual(['Padaria Trigo Bom', 'Dra. Helena Prado']);
    expect(screen.getByText(/@trigobom · Instagram · /)).toBeInTheDocument();
  });

  it('filters by the status chips', async () => {
    renderPage();
    await screen.findByText('Padaria Trigo Bom');

    fireEvent.click(screen.getByRole('tab', { name: 'Qualificado' }));
    expect(rowOrder()).toEqual(['Dra. Helena Prado']);
    fireEvent.click(screen.getByRole('tab', { name: 'Perdido' }));
    expect(screen.getByText('Nenhum lead com esses filtros ou essa busca.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(rowOrder()).toHaveLength(2);
  });

  it('sorts from the Filtros sheet like the desktop menu (a new column sorts ascending)', async () => {
    renderPage();
    await screen.findByText('Padaria Trigo Bom');

    fireEvent.click(screen.getByRole('button', { name: 'Filtros' }));
    const sheet = await screen.findByRole('dialog', { name: 'Filtros' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Nome' }));
    expect(rowOrder()).toEqual(['Dra. Helena Prado', 'Padaria Trigo Bom']);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Ver 2' }));
    expect(await screen.findByRole('button', { name: 'Filtros, 1 ativos' })).toBeInTheDocument();
    expect(screen.getByText('Ordenado por nome')).toBeInTheDocument();
  });

  it('tapping a row opens the edit form (leads have no detail screen)', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /^Padaria Trigo Bom/ }));
    expect(await screen.findByRole('heading', { name: 'Editar Lead' })).toBeInTheDocument();
    expect(screen.getByLabelText('Nome *')).toHaveValue('Padaria Trigo Bom');
    expect(screen.getByLabelText('Instagram')).toHaveValue('@trigobom');
  });

  it('changes the status from the row menu through the Status picker', async () => {
    renderPage();
    await screen.findByText('Padaria Trigo Bom');

    fireEvent.click(screen.getByRole('button', { name: 'Mais ações de Padaria Trigo Bom' }));
    const menu = await screen.findByRole('menu', { name: 'Ações do lead' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: /Status/ }));

    const picker = await screen.findByRole('dialog', { name: 'Status' });
    fireEvent.click(within(picker).getByRole('button', { name: 'Qualificado' }));
    await waitFor(() =>
      expect(mockedUpdateLead).toHaveBeenCalledWith(1, { status: 'qualificado' }),
    );
  });

  it('opens the convert form from the menu and Remover from the swipe', async () => {
    renderPage();
    await screen.findByText('Dra. Helena Prado');

    fireEvent.click(screen.getByRole('button', { name: 'Mais ações de Dra. Helena Prado' }));
    fireEvent.click(
      within(await screen.findByRole('menu', { name: 'Ações do lead' })).getByRole('menuitem', {
        name: 'Converter em cliente',
      }),
    );
    expect(
      await screen.findByRole('heading', { name: 'Converter Lead em Cliente' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('E-mail (opcional)')).toBeInTheDocument();

    const helena = screen.getByRole('button', { name: /^Dra\. Helena Prado/ }).closest('li')!;
    expect(within(helena).getByRole('button', { name: 'Converter' })).toBeInTheDocument();
    fireEvent.click(within(helena).getByRole('button', { name: 'Remover' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Remover este lead?');
    fireEvent.click(screen.getByRole('button', { name: 'Sim' }));
    await waitFor(() => expect(mockedRemoveLead).toHaveBeenCalledWith(2));
  });

  it('"+" disables Novo Lead at the limit and keeps Importar CSV', async () => {
    isAtLimitMock.mockReturnValue(true);
    renderPage();
    await screen.findByText('Padaria Trigo Bom');

    fireEvent.click(screen.getByRole('button', { name: 'Novo lead ou importar CSV' }));
    const sheet = await screen.findByRole('dialog', { name: 'Novo lead ou importar CSV' });
    expect(within(sheet).getByRole('button', { name: 'Novo Lead' })).toBeDisabled();
    expect(within(sheet).getByText('Limite do plano atingido.')).toBeInTheDocument();
    expect(within(sheet).getByText(/Colunas: nome\*/)).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Importar CSV' }));
    expect(openCSVSelectorMock).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state when there are no leads', async () => {
    mockedGetLeads.mockResolvedValue([]);
    mockedGetLeadsCount.mockResolvedValue(0);
    renderPage();
    expect(await screen.findByText('Nenhum lead ainda')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Novo Lead' }));
    expect(screen.getByRole('heading', { name: 'Novo Lead' })).toBeInTheDocument();
  });

  it('is read-only for a custom role with leads:ver only', async () => {
    useAuthMock.mockReturnValue({
      canSeeFinancials: true,
      can: makeCan(
        fakeMembership({ role: 'agent', role_id: 'role-1', permissions: { leads: 'ver' } }),
      ),
    });
    renderPage();
    await screen.findByText('Padaria Trigo Bom');

    expect(screen.queryByRole('button', { name: 'Novo lead ou importar CSV' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Mais ações de/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Padaria Trigo Bom/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remover' })).toBeNull();
  });
});
