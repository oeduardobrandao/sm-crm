import { Suspense } from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { VidroToolbarHarness } from '@/test/vidroToolbar';

// Radix Select/Sheet need pointer-capture/scrollIntoView APIs jsdom lacks.
beforeAll(() => {
  (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture = () =>
    false;
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
});

const { useAuthMock, useFinanceiroV2Mock, store } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useFinanceiroV2Mock: vi.fn(),
  store: {
    getRentabilidade: vi.fn(),
    getFinanceiroConfig: vi.fn(),
    getFuncoes: vi.fn(),
    seedFinanceiro: vi.fn(),
    salvarConfig: vi.fn(),
    salvarFuncao: vi.fn(),
    excluirFuncao: vi.fn(),
  },
}));

vi.mock('@/context/AuthContext', () => ({ useAuth: useAuthMock }));
vi.mock('@/hooks/useFinanceiroV2', () => ({ useFinanceiroV2: useFinanceiroV2Mock }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/store')>()),
  ...store,
}));
// The real ledger is heavy and not what this suite is about.
// Like the real page, it registers its own page toolbar entry.
vi.mock('../../FinanceiroPage', async () => {
  const { usePageToolbar } = await import('@/components/layout/PageToolbarContext');
  return {
    default: function LedgerStub() {
      const inToolbar = usePageToolbar({ title: 'Livro de lançamentos' });
      return inToolbar ? null : <h1>Livro de lançamentos</h1>;
    },
  };
});

// The real page reads a full rentabilidade payload; this suite only checks the shell.
vi.mock('../CustosEquipePage', () => ({
  default: () => <p>Custos da equipe (stub)</p>,
}));
// The assignment matrix has its own suite (AtribuicaoPage.test.tsx); here only its
// placement inside the layout matters.
vi.mock('../AtribuicaoPage', () => ({
  default: function AtribuicaoStub() {
    return <p>Em construção.</p>;
  },
}));

import FinanceiroGate from '../FinanceiroGate';
import FinanceiroPage from '../../FinanceiroPage';
import RentabilidadePage from '../RentabilidadePage';
import CustosEquipePage from '../CustosEquipePage';
import AtribuicaoPage from '../AtribuicaoPage';

const SEEDED = { seeded: true };

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

/** Mirrors the /financeiro subtree of App.tsx. */
function renderAt(path: string, vidroShell = false) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <VidroToolbarHarness vidroShell={vidroShell}>
          <Suspense fallback={null}>
            <Routes>
              <Route path="/financeiro" element={<FinanceiroGate />}>
                <Route path="rentabilidade" element={<RentabilidadePage />} />
                <Route path="equipe" element={<CustosEquipePage />} />
                <Route path="atribuicao" element={<AtribuicaoPage />} />
                <Route path="lancamentos" element={<FinanceiroPage />} />
              </Route>
            </Routes>
            <Where />
          </Suspense>
        </VidroToolbarHarness>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function auth(editar: boolean | 'unknown' = true) {
  useAuthMock.mockReturnValue({
    canSeeFinancials: true,
    profile: { conta_id: 'w1' },
    can: (module: string, action = 'ver') =>
      module === 'financeiro' && action === 'editar' ? editar : true,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  auth(true);
  useFinanceiroV2Mock.mockReturnValue({ ativo: true, isLoading: false });
  store.getRentabilidade.mockResolvedValue(SEEDED);
  store.getFinanceiroConfig.mockResolvedValue({
    periodo_dia: 1,
    meta_margem: 55,
    seeded_at: '2026-10-01',
    updated_at: null,
  });
  store.getFuncoes.mockResolvedValue([]);
});

describe('FinanceiroGate', () => {
  it('flag_off_renders_ledger', async () => {
    useFinanceiroV2Mock.mockReturnValue({ ativo: false, isLoading: false });

    const { unmount } = renderAt('/financeiro');
    expect(await screen.findByRole('heading', { name: 'Livro de lançamentos' })).toBeVisible();
    expect(screen.getByTestId('where')).toHaveTextContent('/financeiro');
    expect(screen.queryByRole('navigation', { name: 'Seções do financeiro' })).toBeNull();
    unmount();

    renderAt('/financeiro/rentabilidade');
    expect(await screen.findByRole('heading', { name: 'Livro de lançamentos' })).toBeVisible();
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/financeiro$/);
    expect(store.getRentabilidade).not.toHaveBeenCalled();
  });

  it('renders nothing while the flag is loading', () => {
    useFinanceiroV2Mock.mockReturnValue({ ativo: false, isLoading: true });

    const { container } = renderAt('/financeiro/rentabilidade');

    expect(container.querySelector('h1')).toBeNull();
    expect(screen.getByTestId('where')).toHaveTextContent('/financeiro/rentabilidade');
  });

  it('flag_on_redirects_to_rentabilidade', async () => {
    renderAt('/financeiro');

    expect(await screen.findByText('Em construção.')).toBeVisible();
    expect(screen.getByTestId('where')).toHaveTextContent('/financeiro/rentabilidade');
  });

  it('tabs_have_aria_current', async () => {
    renderAt('/financeiro/equipe');

    const nav = await screen.findByRole('navigation', { name: 'Seções do financeiro' });
    const equipe = await screen.findByRole('link', { name: 'Custos da equipe' });
    expect(nav).toContainElement(equipe);
    expect(equipe).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Rentabilidade' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Lançamentos' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Rentabilidade' })).toHaveAttribute(
      'href',
      '/financeiro/rentabilidade',
    );
  });

  it('renders the assignment page inside the layout without a tab of its own', async () => {
    renderAt('/financeiro/atribuicao');

    expect(await screen.findByText('Em construção.')).toBeVisible();
    expect(screen.getAllByRole('link')).toHaveLength(3);
  });

  it('lancamentos renders the ledger inside the layout', async () => {
    renderAt('/financeiro/lancamentos');

    expect(await screen.findByRole('heading', { name: 'Livro de lançamentos' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Lançamentos' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // The ledger registers its own title: the layout must not add a second h1.
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it.each([
    ['/financeiro/rentabilidade', 'Financeiro'],
    ['/financeiro/lancamentos', 'Livro de lançamentos'],
  ])('registers a single title in the Vidro toolbar on %s', async (path, title) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderAt(path, true);

    const h1 = await screen.findByRole('heading', { level: 1, name: title });
    expect(h1.closest('.vidro-toolbar')).not.toBeNull();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('unseeded_shows_onboarding', async () => {
    store.getRentabilidade.mockResolvedValue({ seeded: false });

    renderAt('/financeiro/rentabilidade');

    expect(await screen.findByText('Montar o financeiro a partir dos dados atuais')).toBeVisible();
    expect(screen.queryByText('Em construção.')).toBeNull();
    // The tab bar stays so the ledger is one click away.
    expect(screen.getByRole('link', { name: 'Lançamentos' })).toBeVisible();
  });

  it('unseeded still renders the ledger on lancamentos', async () => {
    store.getRentabilidade.mockResolvedValue({ seeded: false });

    renderAt('/financeiro/lancamentos');

    expect(await screen.findByRole('heading', { name: 'Livro de lançamentos' })).toBeVisible();
    expect(screen.queryByText('Montar o financeiro a partir dos dados atuais')).toBeNull();
  });

  it('shows nothing in the content area while rentabilidade loads', async () => {
    store.getRentabilidade.mockReturnValue(new Promise(() => {}));

    renderAt('/financeiro/rentabilidade');

    expect(await screen.findByRole('link', { name: 'Rentabilidade' })).toBeVisible();
    expect(screen.queryByText('Em construção.')).toBeNull();
    expect(screen.queryByText('Montar o financeiro a partir dos dados atuais')).toBeNull();
  });

  it('configurar_hidden_without_editar', async () => {
    auth(false);

    renderAt('/financeiro/rentabilidade');

    expect(await screen.findByText('Em construção.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Configurar' })).toBeNull();
  });

  it('configurar is hidden while the permission is unknown', async () => {
    auth('unknown');

    renderAt('/financeiro/rentabilidade');

    expect(await screen.findByText('Em construção.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Configurar' })).toBeNull();
  });

  it('configurar opens the settings sheet for users with editar', async () => {
    const user = userEvent.setup();
    renderAt('/financeiro/rentabilidade');

    await user.click(await screen.findByRole('button', { name: 'Configurar' }));

    expect(await screen.findByRole('dialog', { name: 'Configurar o financeiro' })).toBeVisible();
  });
});
