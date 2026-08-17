import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, Outlet, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Cliente } from '@/store';
import type { ClienteDetalheOutletContext } from '../../clienteTabs.model';

// RedesSociaisTab owns two historical responsibilities pulled out of the old
// monolithic ClienteDetalhePage.tsx (see git history at d30adeea):
//  1. Rendering the Instagram (mocked here — separately tested in
//     components/__tests__/InstagramSection.test.tsx) and TikTok sections.
//  2. Processing the OAuth-callback query params (`ig_connected`, `ig_error`,
//     `tt_error`) and stripping them from the URL via React Router's API
//     instead of the historical `window.history.replaceState`.

const { captureEventMock } = vi.hoisted(() => ({ captureEventMock: vi.fn() }));
vi.mock('@/lib/analytics', () => ({ captureEvent: captureEventMock }));

const { getInstagramSummaryMock, syncInstagramDataMock } = vi.hoisted(() => ({
  getInstagramSummaryMock: vi.fn(),
  syncInstagramDataMock: vi.fn(),
}));
vi.mock('@/services/instagram', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/instagram')>()),
  getInstagramSummary: (...args: unknown[]) => getInstagramSummaryMock(...args),
  syncInstagramData: (...args: unknown[]) => syncInstagramDataMock(...args),
}));

let mockFeatures: { feature_tiktok?: boolean } | null | undefined = { feature_tiktok: false };
vi.mock('@/hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({ features: mockFeatures }),
}));

const { getTikTokSummaryMock } = vi.hoisted(() => ({ getTikTokSummaryMock: vi.fn() }));
vi.mock('@/services/tiktok', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/tiktok')>()),
  getTikTokSummary: (...args: unknown[]) => getTikTokSummaryMock(...args),
}));

const { toastInfoMock, toastErrorMock } = vi.hoisted(() => ({
  toastInfoMock: vi.fn(),
  toastErrorMock: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { info: toastInfoMock, error: toastErrorMock } }));

// InstagramSection has its own dedicated render-behavior suite; stub it here
// so this suite can focus on OAuth processing, composition, and query
// isolation without pulling in chart.js / the imperative ref renderers.
vi.mock('../../components/InstagramSection', () => ({
  InstagramSection: ({
    clienteId,
    clienteEmail,
    loadingIg,
    igSummary,
  }: {
    clienteId: number;
    clienteEmail: string | null;
    loadingIg: boolean;
    igSummary: unknown;
  }) => (
    <div data-testid="instagram-section">
      ig-{clienteId}-{clienteEmail}-{String(loadingIg)}-{igSummary ? 'has-summary' : 'no-summary'}
    </div>
  ),
}));

import RedesSociaisTab from '../RedesSociaisTab';

const CLIENTE: Cliente = {
  id: 42,
  nome: 'Aurora Estética',
  sigla: 'AE',
  cor: '#ffbf30',
  plano: 'Plano Ouro',
  email: 'contato@aurora.com.br',
  telefone: '(85) 99999-0000',
  status: 'ativo',
  valor_mensal: 1500,
};

function OutletContextProvider({ cliente }: { cliente: Cliente }) {
  return (
    <Outlet context={{ clienteId: cliente.id!, cliente } satisfies ClienteDetalheOutletContext} />
  );
}

function SearchProbe() {
  const location = useLocation();
  return <span data-testid="search">{location.search}</span>;
}

function renderTab(initialEntry: string, cliente: Cliente = CLIENTE) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route element={<OutletContextProvider cliente={cliente} />}>
            <Route path="/clientes/:id/redes-sociais" element={<RedesSociaisTab />} />
          </Route>
        </Routes>
        <SearchProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, queryClient };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockFeatures = { feature_tiktok: false };
});

describe('RedesSociaisTab', () => {
  describe('composition', () => {
    it('renders InstagramSection with the outlet-context cliente', async () => {
      getInstagramSummaryMock.mockResolvedValue(null);
      renderTab('/clientes/42/redes-sociais');
      expect(await screen.findByTestId('instagram-section')).toHaveTextContent(
        'ig-42-contato@aurora.com.br',
      );
    });

    it('renders nothing TikTok-related when feature_tiktok is off', async () => {
      getInstagramSummaryMock.mockResolvedValue(null);
      mockFeatures = { feature_tiktok: false };
      const { container } = renderTab('/clientes/42/redes-sociais');
      await screen.findByTestId('instagram-section');
      expect(container.querySelector('#tiktok-container')).toBeNull();
      expect(getTikTokSummaryMock).not.toHaveBeenCalled();
    });

    it('renders the TikTok connect button when feature_tiktok is on', async () => {
      getInstagramSummaryMock.mockResolvedValue(null);
      mockFeatures = { feature_tiktok: true };
      getTikTokSummaryMock.mockResolvedValue(null);
      const { container } = renderTab('/clientes/42/redes-sociais');
      await waitFor(() => expect(container.querySelector('#btn-tt-connect')).not.toBeNull());
      expect(getTikTokSummaryMock).toHaveBeenCalledWith(42);
    });
  });

  describe('query isolation', () => {
    it('only fires igSummary (and ttSummary when the feature is on) — nothing from Entregas/Hub/Financeiro', async () => {
      getInstagramSummaryMock.mockResolvedValue(null);
      mockFeatures = { feature_tiktok: true };
      getTikTokSummaryMock.mockResolvedValue(null);
      const { queryClient } = renderTab('/clientes/42/redes-sociais');
      await screen.findByTestId('instagram-section');
      await waitFor(() => expect(getTikTokSummaryMock).toHaveBeenCalled());

      const keys = queryClient
        .getQueryCache()
        .getAll()
        .map((q) => q.queryKey[0]);
      expect(new Set(keys)).toEqual(new Set(['igSummary', 'ttSummary']));
    });
  });

  describe('OAuth callback processing', () => {
    it('ig_connected: fires the instagram_connected activation event and strips the param', async () => {
      getInstagramSummaryMock.mockResolvedValue(null);
      renderTab('/clientes/42/redes-sociais?ig_connected=new');

      await waitFor(() =>
        expect(captureEventMock).toHaveBeenCalledWith('instagram_connected', {
          cliente_id: 42,
          connection_type: 'new',
        }),
      );
      await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent(''));
    });

    it('ig_error=off_meta_activity: opens the off-Meta AlertDialog and strips the param', async () => {
      getInstagramSummaryMock.mockResolvedValue(null);
      renderTab('/clientes/42/redes-sociais?ig_error=off_meta_activity');

      expect(await screen.findByText('A Meta bloqueou a conexão')).toBeInTheDocument();
      await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent(''));
    });

    it('ig_error=cancelled: toasts info (not error) and strips the param', async () => {
      getInstagramSummaryMock.mockResolvedValue(null);
      renderTab('/clientes/42/redes-sociais?ig_error=cancelled');

      await waitFor(() =>
        expect(toastInfoMock).toHaveBeenCalledWith(
          'A conexão foi cancelada antes de concluir. Clique em Conectar novamente e aceite as permissões solicitadas.',
        ),
      );
      expect(toastErrorMock).not.toHaveBeenCalled();
      await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent(''));
    });

    it('ig_error with an unrecognised code: toasts the generic error message', async () => {
      getInstagramSummaryMock.mockResolvedValue(null);
      renderTab('/clientes/42/redes-sociais?ig_error=some_unknown_code');

      await waitFor(() =>
        expect(toastErrorMock).toHaveBeenCalledWith(
          'Ocorreu um erro ao conectar a conta Instagram. Tente novamente.',
        ),
      );
    });

    it('tt_error=1: toasts the TikTok error message and strips the param', async () => {
      getInstagramSummaryMock.mockResolvedValue(null);
      renderTab('/clientes/42/redes-sociais?tt_error=1');

      await waitFor(() =>
        expect(toastErrorMock).toHaveBeenCalledWith(
          'Ocorreu um erro ao conectar a conta TikTok. Tente novamente.',
        ),
      );
      await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent(''));
    });

    it('all three params together: each is processed exactly once and the URL ends up fully clean (no clobbering race between the two independent setSearchParams calls)', async () => {
      getInstagramSummaryMock.mockResolvedValue(null);
      renderTab(
        '/clientes/42/redes-sociais?ig_connected=new&ig_error=off_meta_activity&tt_error=1',
      );

      await waitFor(() => expect(captureEventMock).toHaveBeenCalledTimes(1));
      expect(await screen.findByText('A Meta bloqueou a conexão')).toBeInTheDocument();
      await waitFor(() =>
        expect(toastErrorMock).toHaveBeenCalledWith(
          'Ocorreu um erro ao conectar a conta TikTok. Tente novamente.',
        ),
      );
      // The critical regression check: with two independent useSearchParams
      // consumers (this effect + useInstagramActivationEvent) both mutating
      // the URL on mount, a stale-snapshot race can silently resurrect
      // whichever param the OTHER effect just removed. Assert the URL is
      // fully empty, not just that each individual handler fired.
      await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent(''));
    });

    it('does not process anything on an ordinary visit with no OAuth params', async () => {
      getInstagramSummaryMock.mockResolvedValue(null);
      renderTab('/clientes/42/redes-sociais');
      await screen.findByTestId('instagram-section');

      expect(captureEventMock).not.toHaveBeenCalled();
      expect(toastInfoMock).not.toHaveBeenCalled();
      expect(toastErrorMock).not.toHaveBeenCalled();
      expect(screen.queryByText('A Meta bloqueou a conexão')).not.toBeInTheDocument();
    });

    it('preserves unrelated query parameters while stripping only the OAuth-callback ones', async () => {
      getInstagramSummaryMock.mockResolvedValue(null);
      renderTab('/clientes/42/redes-sociais?tab=redes&tt_error=1');

      await waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
      await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent('?tab=redes'));
    });
  });
});
