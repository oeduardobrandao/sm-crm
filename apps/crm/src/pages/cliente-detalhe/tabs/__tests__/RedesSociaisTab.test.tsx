import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
// jsdom has no layout, so useIsDesktop would report a phone; the desktop tabs are the default.
let mockIsDesktop = true;
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => mockIsDesktop }));

vi.mock('@/hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({ features: mockFeatures }),
}));

const { getTikTokSummaryMock } = vi.hoisted(() => ({ getTikTokSummaryMock: vi.fn() }));
vi.mock('@/services/tiktok', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/tiktok')>()),
  getTikTokSummary: (...args: unknown[]) => getTikTokSummaryMock(...args),
}));

const { toastInfoMock, toastErrorMock, toastSuccessMock } = vi.hoisted(() => ({
  toastInfoMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));
vi.mock('sonner', () => ({
  toast: { info: toastInfoMock, error: toastErrorMock, success: toastSuccessMock },
}));

// AutomationContactsSection has its own suite (it needs AuthContext and the
// contacts store, neither relevant here); stub it so query isolation stays
// about this tab's own queries.
vi.mock('../../components/AutomationContactsSection', () => ({
  AutomationContactsSection: () => null,
}));

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
  mockIsDesktop = true;
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

    it('hides the platform tabs when Instagram is the only one', async () => {
      getInstagramSummaryMock.mockResolvedValue(null);
      renderTab('/clientes/42/redes-sociais');
      await screen.findByTestId('instagram-section');
      expect(screen.queryByRole('navigation', { name: 'Redes sociais' })).toBeNull();
    });

    it('shows Instagram | TikTok tabs with the plan and switches between them', async () => {
      getInstagramSummaryMock.mockResolvedValue(null);
      getTikTokSummaryMock.mockResolvedValue(null);
      mockFeatures = { feature_tiktok: true };
      const { container } = renderTab('/clientes/42/redes-sociais');
      const nav = await screen.findByRole('navigation', { name: 'Redes sociais' });
      expect(within(nav).getByRole('link', { name: 'Instagram' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      expect(container.querySelector('#tiktok-container')).toBeNull();

      fireEvent.click(within(nav).getByRole('link', { name: 'TikTok' }));
      await waitFor(() => expect(container.querySelector('#btn-tt-connect')).not.toBeNull());
      expect(screen.queryByTestId('instagram-section')).toBeNull();
      expect(screen.getByTestId('search')).toHaveTextContent('?rede=tiktok');

      fireEvent.click(within(nav).getByRole('link', { name: 'Instagram' }));
      expect(await screen.findByTestId('instagram-section')).toBeInTheDocument();
      expect(screen.getByTestId('search')).toBeEmptyDOMElement();
    });

    it('uses the segmented control on a phone', async () => {
      getInstagramSummaryMock.mockResolvedValue(null);
      getTikTokSummaryMock.mockResolvedValue(null);
      mockFeatures = { feature_tiktok: true };
      mockIsDesktop = false;
      const { container } = renderTab('/clientes/42/redes-sociais');
      const tabs = await screen.findByRole('tablist', { name: 'Redes sociais' });
      fireEvent.click(within(tabs).getByRole('tab', { name: 'TikTok' }));
      await waitFor(() => expect(container.querySelector('#btn-tt-connect')).not.toBeNull());
      expect(screen.getByTestId('search')).toHaveTextContent('?rede=tiktok');
    });

    it('falls back to Instagram for a platform tab the plan does not include', async () => {
      getInstagramSummaryMock.mockResolvedValue(null);
      mockFeatures = { feature_tiktok: false };
      renderTab('/clientes/42/redes-sociais?rede=tiktok');
      expect(await screen.findByTestId('instagram-section')).toBeInTheDocument();
      expect(getTikTokSummaryMock).not.toHaveBeenCalled();
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
      const { container } = renderTab('/clientes/42/redes-sociais?rede=tiktok');
      await waitFor(() => expect(container.querySelector('#btn-tt-connect')).not.toBeNull());
      expect(getTikTokSummaryMock).toHaveBeenCalledWith(42);
    });
  });

  describe('query isolation', () => {
    it('the Instagram tab fires only igSummary: other platforms wait for their tab', async () => {
      getInstagramSummaryMock.mockResolvedValue(null);
      mockFeatures = { feature_tiktok: true };
      const { queryClient } = renderTab('/clientes/42/redes-sociais');
      await screen.findByTestId('instagram-section');

      const keys = queryClient
        .getQueryCache()
        .getAll()
        .map((q) => q.queryKey[0]);
      expect(new Set(keys)).toEqual(new Set(['igSummary']));
      expect(getTikTokSummaryMock).not.toHaveBeenCalled();
    });

    it('the TikTok tab adds ttSummary and nothing from Entregas/Hub/Financeiro', async () => {
      getInstagramSummaryMock.mockResolvedValue(null);
      mockFeatures = { feature_tiktok: true };
      getTikTokSummaryMock.mockResolvedValue(null);
      const { queryClient } = renderTab('/clientes/42/redes-sociais?rede=tiktok');
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

    it('ig_error=plan_limit: toasts the plan-limit message with an upgrade action', async () => {
      getInstagramSummaryMock.mockResolvedValue(null);
      renderTab('/clientes/42/redes-sociais?ig_error=plan_limit');

      await waitFor(() =>
        expect(toastErrorMock).toHaveBeenCalledWith(
          'O seu plano já está no limite de contas do Instagram. Faça upgrade para conectar esta conta.',
          expect.objectContaining({
            action: expect.objectContaining({ label: 'Ver planos' }),
          }),
        ),
      );
      expect(toastErrorMock).not.toHaveBeenCalledWith(
        'Ocorreu um erro ao conectar a conta Instagram. Tente novamente.',
      );
    });

    it('ig_error=plan_limit in the iOS app: states the limit with no plans action (D33)', async () => {
      vi.stubGlobal('Capacitor', { isNativePlatform: () => true, getPlatform: () => 'ios' });
      try {
        getInstagramSummaryMock.mockResolvedValue(null);
        renderTab('/clientes/42/redes-sociais?ig_error=plan_limit');

        await waitFor(() =>
          expect(toastErrorMock).toHaveBeenCalledWith('Você atingiu o limite da sua conta.'),
        );
        expect(toastErrorMock).toHaveBeenCalledTimes(1);
        await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent(''));
      } finally {
        vi.unstubAllGlobals();
      }
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
      // The callback params are gone and the TikTok tab is the one open.
      await waitFor(() =>
        expect(screen.getByTestId('search')).toHaveTextContent(/^\?rede=tiktok$/),
      );
    });

    it('tt_error=already_linked: names the TikTok account and the client that holds it, and strips every param', async () => {
      getInstagramSummaryMock.mockResolvedValue(null);
      renderTab(
        '/clientes/42/redes-sociais?tt_error=already_linked&tt_user=clinica.a&tt_other=Cl%C3%ADnica%20A',
      );

      await waitFor(() =>
        expect(toastErrorMock).toHaveBeenCalledWith(
          expect.stringContaining('A conta @clinica.a já está conectada ao cliente Clínica A.'),
          { duration: 12000 },
        ),
      );
      await waitFor(() =>
        expect(screen.getByTestId('search')).toHaveTextContent(/^\?rede=tiktok$/),
      );
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
      // whichever param the OTHER effect just removed. Assert the URL holds
      // only the landing tab, not just that each individual handler fired.
      await waitFor(() =>
        expect(screen.getByTestId('search')).toHaveTextContent(/^\?rede=tiktok$/),
      );
    });

    it('does not process anything on an ordinary visit with no OAuth params', async () => {
      getInstagramSummaryMock.mockResolvedValue(null);
      renderTab('/clientes/42/redes-sociais');
      await screen.findByTestId('instagram-section');

      expect(captureEventMock).not.toHaveBeenCalled();
      expect(toastInfoMock).not.toHaveBeenCalled();
      expect(toastErrorMock).not.toHaveBeenCalled();
      expect(toastSuccessMock).not.toHaveBeenCalled();
      expect(screen.queryByText('A Meta bloqueou a conexão')).not.toBeInTheDocument();
    });

    it('tt_connected=1: toasts success, captures tiktok_connected once and strips the param', async () => {
      getInstagramSummaryMock.mockResolvedValue(null);
      mockFeatures = { feature_tiktok: true };
      getTikTokSummaryMock.mockResolvedValue(null);
      renderTab('/clientes/42/redes-sociais?tt_connected=1&tab=redes');

      await waitFor(() =>
        expect(toastSuccessMock).toHaveBeenCalledWith('Conta do TikTok conectada.'),
      );
      expect(captureEventMock).toHaveBeenCalledWith('tiktok_connected', { cliente_id: 42 });
      expect(captureEventMock).toHaveBeenCalledTimes(1);
      expect(toastErrorMock).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(screen.getByTestId('search')).toHaveTextContent(/^\?tab=redes&rede=tiktok$/),
      );
    });

    it('tt_connected with any other value: no toast, no event, param still stripped', async () => {
      getInstagramSummaryMock.mockResolvedValue(null);
      renderTab('/clientes/42/redes-sociais?tt_connected=0');

      await waitFor(() =>
        expect(screen.getByTestId('search')).toHaveTextContent(/^\?rede=tiktok$/),
      );
      expect(toastSuccessMock).not.toHaveBeenCalled();
      expect(captureEventMock).not.toHaveBeenCalled();
    });

    it('preserves unrelated query parameters while stripping only the OAuth-callback ones', async () => {
      getInstagramSummaryMock.mockResolvedValue(null);
      renderTab('/clientes/42/redes-sociais?tab=redes&tt_error=1');

      await waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
      await waitFor(() =>
        expect(screen.getByTestId('search')).toHaveTextContent(/^\?tab=redes&rede=tiktok$/),
      );
    });
  });
});
