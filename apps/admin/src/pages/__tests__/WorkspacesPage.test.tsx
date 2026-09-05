import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../../components/ui/tooltip';
import type { ListWorkspacesResponse, WorkspaceSummary } from '../../lib/api';

vi.mock('../../lib/api', () => ({
  listWorkspaces: vi.fn(),
  listPlans: vi.fn(),
}));

import { listPlans, listWorkspaces } from '../../lib/api';
import WorkspacesPage from '../WorkspacesPage';
import { COLUMNS_STORAGE_KEY } from '../workspaces-columns';

const mockedList = vi.mocked(listWorkspaces);
const mockedPlans = vi.mocked(listPlans);

function ws(id: string, name: string): WorkspaceSummary {
  return {
    id,
    name,
    logo_url: null,
    created_at: '2026-01-15T10:00:00Z',
    last_activity_at: null,
    owner: { name: 'Ana', email: `${id}@example.com`, telefone: null, marketing_opt_in: false },
    member_count: 1,
    client_count: 2,
    plan_name: 'Pro',
    has_overrides: false,
    subscription: null,
  };
}

function response(
  workspaces: WorkspaceSummary[],
  total = workspaces.length,
): ListWorkspacesResponse {
  return { workspaces, total, total_members: 0, total_clients: 0, total_with_overrides: 0 };
}

function LocationProbe() {
  const loc = useLocation();
  return <span data-testid="url">{loc.pathname + loc.search}</span>;
}

function renderPage(initial = '/admin/workspaces') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[initial]}>
          <WorkspacesPage />
          <LocationProbe />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  mockedPlans.mockResolvedValue({ plans: [{ id: 'pro', name: 'Pro' }] } as never);
  mockedList.mockResolvedValue(response([ws('a', 'Alpha'), ws('b', 'Beta')], 2));
});

describe('WorkspacesPage', () => {
  it('turns the URL into the API request', async () => {
    renderPage(
      '/admin/workspaces?q=al&status=pendente&atividade=dormente&ord=client_count&dir=asc&pag=2&por=50',
    );
    await waitFor(() => expect(mockedList).toHaveBeenCalled());
    expect(mockedList.mock.calls[0][0]).toEqual({
      search: 'al',
      status: 'pendente',
      activity: 'dormente',
      sort: 'client_count',
      dir: 'asc',
      offset: 50,
      limit: 50,
    });
  });

  it('renders rows and the result count once loaded', async () => {
    renderPage('/admin/workspaces?status=ativo');
    expect(await screen.findAllByText('Alpha')).not.toHaveLength(0);
    expect(screen.getByText('2 resultados')).toBeInTheDocument();
  });

  it('clicking a sortable header updates ord/dir in the URL and flips on the second click', async () => {
    renderPage();
    await screen.findAllByText('Alpha');
    fireEvent.click(screen.getByRole('button', { name: /Clientes/ }));
    expect(screen.getByTestId('url').textContent).toBe('/admin/workspaces?ord=client_count');
    fireEvent.click(screen.getByRole('button', { name: /Clientes/ }));
    expect(screen.getByTestId('url').textContent).toBe(
      '/admin/workspaces?ord=client_count&dir=asc',
    );
  });

  it('removing a chip clears that filter and resets the page', async () => {
    renderPage('/admin/workspaces?status=ativo&criado=7d&pag=3');
    await screen.findAllByText('Alpha');
    fireEvent.click(screen.getByRole('button', { name: 'Remover filtro Status' }));
    expect(screen.getByTestId('url').textContent).toBe('/admin/workspaces?criado=7d');
  });

  it('shows the filtered empty state with a clear action', async () => {
    mockedList.mockResolvedValue(response([], 0));
    renderPage('/admin/workspaces?status=cancelado&ord=name');
    expect(await screen.findByText('Nenhum workspace com esses filtros')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Limpar filtros' })[0]);
    expect(screen.getByTestId('url').textContent).toBe('/admin/workspaces?ord=name');
  });

  it('shows the plain empty state without filters', async () => {
    mockedList.mockResolvedValue(response([], 0));
    renderPage();
    expect(await screen.findByText('Nenhum workspace cadastrado ainda.')).toBeInTheDocument();
  });

  it('shows the error state and refetches on retry', async () => {
    mockedList.mockRejectedValueOnce(new Error('boom'));
    renderPage();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    mockedList.mockResolvedValue(response([ws('a', 'Alpha')]));
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findAllByText('Alpha')).not.toHaveLength(0);
  });

  it('reads column prefs from localStorage', async () => {
    localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(['name', 'plan']));
    renderPage();
    await screen.findAllByText('Alpha');
    expect(screen.queryByRole('columnheader', { name: /Dono/ })).toBeNull();
    expect(screen.getByRole('columnheader', { name: /Plano/ })).toBeInTheDocument();
  });
});
