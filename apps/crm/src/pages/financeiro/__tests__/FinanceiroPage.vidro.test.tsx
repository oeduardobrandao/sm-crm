import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VidroToolbarHarness } from '@/test/vidroToolbar';

// The desktop table layout (the phone branch has its own suite).
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));

const { useAuthMock, store } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  store: {
    getTransacoes: vi.fn(),
    getClientes: vi.fn(),
    getMembros: vi.fn(),
    addTransacao: vi.fn(),
    updateTransacao: vi.fn(),
    removeTransacao: vi.fn(),
  },
}));

vi.mock('../../../context/AuthContext', () => ({ useAuth: useAuthMock }));
vi.mock('@/context/AuthContext', () => ({ useAuth: useAuthMock }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../../store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../store')>()),
  ...store,
  projetarAgendamentos: (rows: unknown[]) => rows,
}));

import FinanceiroPage from '../FinanceiroPage';

function renderPage(vidroShell: boolean) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/financeiro']}>
        <VidroToolbarHarness vidroShell={vidroShell}>
          <FinanceiroPage />
        </VidroToolbarHarness>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useAuthMock.mockReturnValue({ canSeeFinancials: true, profile: { conta_id: 'w1' } });
  store.getTransacoes.mockResolvedValue([]);
  store.getClientes.mockResolvedValue([]);
  store.getMembros.mockResolvedValue([]);
});

describe('FinanceiroPage in the Vidro toolbar', () => {
  it('puts the title, CSV import and Entrada/Saída in the toolbar, once each', async () => {
    renderPage(true);

    const h1s = await screen.findAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    const toolbar = h1s[0].closest('.vidro-toolbar') as HTMLElement;
    expect(toolbar).not.toBeNull();
    expect(h1s[0]).toHaveTextContent('Financeiro');
    expect(screen.getAllByRole('button', { name: /Entrada/ })).toHaveLength(1);
    expect(within(toolbar).getByRole('button', { name: /Entrada/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Saída/ })).toHaveLength(1);
    expect(within(toolbar).getByRole('button', { name: /Saída/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Importar CSV/ })).toHaveLength(1);
    expect(within(toolbar).getByRole('button', { name: /Importar CSV/ })).toBeInTheDocument();
    expect(document.querySelector('.header')).toBeNull();
  });

  it('keeps the in-page header when the Vidro shell is off', async () => {
    renderPage(false);

    const h1 = await screen.findByRole('heading', { level: 1, name: 'Financeiro' });
    expect(h1.closest('.header')).not.toBeNull();
    expect(document.querySelector('.vidro-toolbar')).toBeNull();
    expect(screen.getAllByRole('button', { name: /Entrada/ })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: /Saída/ })).toHaveLength(1);
  });

  it('keeps the classic order Importar, Entrada, Saída in the in-page header', async () => {
    renderPage(false);

    await screen.findByRole('heading', { level: 1, name: 'Financeiro' });
    const actions = document.querySelector('.header-actions') as HTMLElement;
    const labels = Array.from(actions.querySelectorAll('button')).map((b) => b.textContent?.trim());
    expect(labels.slice(-3)).toEqual(['Importar CSV', 'Entrada', 'Saída']);
  });
});
