import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../../components/ui/tooltip';
import type { ListWorkspacesResponse, WorkspaceSummary } from '../../lib/api';
import { mockPhone } from '../../__tests__/phone';

vi.mock('../../lib/api', () => ({
  listWorkspaces: vi.fn(),
  listPlans: vi.fn(),
}));

import { listPlans, listWorkspaces } from '../../lib/api';
import WorkspacesPage from '../WorkspacesPage';
import { COLUMNS_STORAGE_KEY } from '../workspaces-columns';

const mockedList = vi.mocked(listWorkspaces);
const mockedPlans = vi.mocked(listPlans);

function ws(id: string, name: string, overrides: Partial<WorkspaceSummary> = {}): WorkspaceSummary {
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
    ...overrides,
  };
}

function response(
  workspaces: WorkspaceSummary[],
  total = workspaces.length,
): ListWorkspacesResponse {
  return { workspaces, total, total_members: 0, total_clients: 0, total_with_overrides: 0 };
}

function renderPage(initial = '/admin/workspaces') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(
    [
      { path: '/admin/workspaces', element: <WorkspacesPage /> },
      { path: '/admin/workspaces/:id', element: <p>detalhe</p> },
    ],
    { initialEntries: [initial] },
  );
  render(
    <QueryClientProvider client={qc}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
  return router;
}

const search = (router: ReturnType<typeof renderPage>) => router.state.location.search;

let restorePhone: () => void;
beforeEach(() => {
  restorePhone = mockPhone();
  localStorage.clear();
  mockedPlans.mockResolvedValue({
    plans: [
      { id: 'pro', name: 'Pro' },
      { id: 'max', name: 'Max' },
    ],
  } as never);
  mockedList.mockResolvedValue(
    response([ws('a', 'Alpha', { has_overrides: true }), ws('b', 'Beta')], 2),
  );
});
afterEach(() => restorePhone());

describe('WorkspacesPage on phones', () => {
  it('shows the large title and the workspaces as links with their primary text', async () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Workspaces' })).toBeInTheDocument();
    const alpha = await screen.findByRole('link', { name: /Alpha/ });
    expect(alpha).toHaveAttribute('href', '/admin/workspaces/a');
    expect(within(alpha).getByText('a@example.com')).toBeInTheDocument();
    expect(within(alpha).getByText('overrides')).toBeInTheDocument();
    expect(within(alpha).getByText('Pro')).toBeInTheDocument();
    expect(within(alpha).getByText(/2 clientes/)).toBeInTheDocument();
    expect(within(alpha).getByText(/Sem assinatura/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Beta/ })).toHaveAttribute(
      'href',
      '/admin/workspaces/b',
    );
  });

  it('ignores the desktop column preferences and has no CSV export', async () => {
    localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(['name']));
    renderPage();
    const alpha = await screen.findByRole('link', { name: /Alpha/ });
    expect(within(alpha).getByText('a@example.com')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Exportar CSV/ })).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('opens the filters sheet from the header button and applies a status', async () => {
    const router = renderPage();
    await screen.findByRole('link', { name: /Alpha/ });
    fireEvent.click(screen.getByRole('button', { name: 'Filtros' }));
    const sheet = await screen.findByRole('dialog', { name: 'Filtros' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Teste' }));
    await waitFor(() => expect(search(router)).toBe('?status=teste'));
    // "Ver N" closes the sheet; the header button then reports the active count.
    fireEvent.click(within(sheet).getByRole('button', { name: /^Ver / }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('button', { name: 'Filtros, 1 ativo' })).toBeInTheDocument();
  });

  it('filter taps inside the sheet replace history instead of pushing', async () => {
    const router = renderPage();
    await screen.findByRole('link', { name: /Alpha/ });
    expect(router.state.historyAction).toBe('POP');

    fireEvent.click(screen.getByRole('button', { name: 'Filtros' }));
    const sheet = await screen.findByRole('dialog', { name: 'Filtros' });

    fireEvent.click(within(sheet).getByRole('button', { name: 'Teste' }));
    await waitFor(() => expect(search(router)).toBe('?status=teste'));
    expect(router.state.historyAction).toBe('REPLACE');

    fireEvent.click(within(sheet).getByRole('button', { name: 'Pro' }));
    await waitFor(() => expect(search(router)).toBe('?plano=pro&status=teste'));
    expect(router.state.historyAction).toBe('REPLACE');

    // Limpar (also from inside the sheet) replaces too.
    fireEvent.click(within(sheet).getByRole('button', { name: 'Limpar' }));
    await waitFor(() => expect(search(router)).toBe(''));
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('shows removable chips for the active filters and clears one', async () => {
    const router = renderPage('/admin/workspaces?status=teste&atividade=7d');
    await screen.findByRole('link', { name: /Alpha/ });
    expect(screen.getByRole('button', { name: 'Remover filtro Status' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remover filtro Atividade' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remover filtro Status' }));
    expect(search(router)).toBe('?atividade=7d');
    fireEvent.click(screen.getByRole('button', { name: 'Limpar' }));
    expect(search(router)).toBe('');
  });

  it('the sort header shows the current order and the action sheet changes it', async () => {
    const router = renderPage();
    await screen.findByRole('link', { name: /Alpha/ });
    const sortButton = screen.getByRole('button', { name: /Ordenar por Criado em/ });
    fireEvent.click(sortButton);
    const sheet = await screen.findByRole('dialog', { name: 'Ordenar por' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Clientes' }));
    await waitFor(() => expect(search(router)).toBe('?ord=client_count'));
    expect(screen.getByRole('button', { name: /Ordenar por Clientes/ })).toBeInTheDocument();
  });

  it('searches by name or e-mail with a debounce', async () => {
    const router = renderPage();
    await screen.findByRole('link', { name: /Alpha/ });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar workspaces' }), {
        target: { value: 'alp' },
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(350);
      });
    } finally {
      vi.useRealTimers();
    }
    expect(search(router)).toBe('?q=alp');
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('pages through the results', async () => {
    mockedList.mockResolvedValue(response([ws('a', 'Alpha')], 45));
    const router = renderPage();
    await screen.findByRole('link', { name: /Alpha/ });
    expect(screen.getByText('1–20 de 45')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Página anterior' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Próxima página' }));
    expect(search(router)).toBe('?pag=2');
  });

  it('shows the filtered empty state with a clear action', async () => {
    mockedList.mockResolvedValue(response([], 0));
    const router = renderPage('/admin/workspaces?status=cancelado');
    expect(await screen.findByText('Nenhum workspace com esses filtros')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(search(router)).toBe('');
  });

  it('shows the error state and retries', async () => {
    mockedList.mockRejectedValueOnce(new Error('boom'));
    renderPage();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    mockedList.mockResolvedValue(response([ws('a', 'Alpha')]));
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByRole('link', { name: /Alpha/ })).toBeInTheDocument();
  });
});
