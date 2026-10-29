import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, Outlet, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Cliente } from '@/store';
import type { ClienteDetalheOutletContext } from '../../clienteTabs.model';

// Google (YouTube + Google Meu Negócio) wiring in RedesSociaisTab: the sections render after
// TikTok, and the tab's single OAuth-param effect toasts and strips the Google return params.

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

let mockFeatures:
  | { feature_tiktok?: boolean; feature_youtube?: boolean; feature_google_business?: boolean }
  | null
  | undefined = {};
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

// The Google sections have their own suites; stub them so this file asserts the wiring only.
vi.mock('../../YouTubeSection', () => ({
  YouTubeSection: ({ clienteId }: { clienteId: number }) => (
    <div data-testid="youtube-section">yt-{clienteId}</div>
  ),
}));
vi.mock('../../GoogleBusinessSection', () => ({
  GoogleBusinessSection: ({
    clienteId,
    clienteNome,
    pickConnectionId,
    onPickHandled,
  }: {
    clienteId: number;
    clienteNome: string;
    pickConnectionId: string | null;
    onPickHandled: () => void;
  }) => (
    <div data-testid="gmn-section">
      gmn-{clienteId}-{clienteNome}-{pickConnectionId ?? 'no-pick'}
      <button type="button" onClick={onPickHandled}>
        handled
      </button>
    </div>
  ),
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
  vi.clearAllMocks();
  mockFeatures = {};
});

describe('RedesSociaisTab Google wiring', () => {
  it('renders both Google sections after TikTok, passing the client name', async () => {
    getInstagramSummaryMock.mockResolvedValue(null);
    renderTab('/clientes/42/redes-sociais');
    expect(await screen.findByTestId('youtube-section')).toHaveTextContent('yt-42');
    expect(screen.getByTestId('gmn-section')).toHaveTextContent('gmn-42-Aurora Estética-no-pick');
  });

  it('toasts YouTube connected and strips yt_connected', async () => {
    getInstagramSummaryMock.mockResolvedValue(null);
    renderTab('/clientes/42/redes-sociais?yt_connected=1');
    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith('YouTube conectado.'));
    await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent(/^$/));
  });

  it('names the other client on channel_in_use and removes every Google param', async () => {
    getInstagramSummaryMock.mockResolvedValue(null);
    renderTab(
      '/clientes/42/redes-sociais?yt_error=channel_in_use&yt_other=Cl%C3%ADnica%20X&yt_connected=1&gbp_pick=abc&gmn_error=denied&keep=1',
    );
    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        'Este canal já está vinculado ao cliente Clínica X.',
      ),
    );
    await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent('?keep=1'));
    const search = screen.getByTestId('search').textContent ?? '';
    for (const p of ['yt_connected', 'yt_error', 'yt_other', 'gbp_pick', 'gmn_error']) {
      expect(search).not.toContain(p);
    }
  });

  it('falls back to a generic message when channel_in_use has no name', async () => {
    getInstagramSummaryMock.mockResolvedValue(null);
    renderTab('/clientes/42/redes-sociais?yt_error=channel_in_use');
    await waitFor(() =>
      expect(toastErrorMock).toHaveBeenCalledWith(
        'Este canal já está vinculado a outro cliente deste workspace.',
      ),
    );
  });

  it.each([
    ['denied', 'Conexão cancelada no Google.'],
    ['missing_scope', 'Marque todas as permissões pedidas pelo Google e tente de novo.'],
    ['no_refresh_token', 'O Google não liberou o acesso contínuo. Tente conectar de novo.'],
    ['no_channel', 'Esta conta Google não tem canal do YouTube.'],
    ['unknown', 'Não foi possível conectar o YouTube.'],
    ['something_new', 'Não foi possível conectar o YouTube.'],
  ])('maps yt_error=%s', async (code, message) => {
    getInstagramSummaryMock.mockResolvedValue(null);
    renderTab(`/clientes/42/redes-sociais?yt_error=${code}`);
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith(message));
  });

  it.each([
    ['denied', 'Conexão cancelada no Google.'],
    ['missing_scope', 'Marque todas as permissões pedidas pelo Google e tente de novo.'],
    ['no_refresh_token', 'O Google não liberou o acesso contínuo. Tente conectar de novo.'],
    ['unknown', 'Não foi possível conectar o Google Meu Negócio.'],
  ])('maps gmn_error=%s', async (code, message) => {
    getInstagramSummaryMock.mockResolvedValue(null);
    renderTab(`/clientes/42/redes-sociais?gmn_error=${code}`);
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith(message));
  });

  it('hands gbp_pick to GoogleBusinessSection and removes the param', async () => {
    getInstagramSummaryMock.mockResolvedValue(null);
    renderTab('/clientes/42/redes-sociais?gbp_pick=conn-uuid-1');
    await waitFor(() =>
      expect(screen.getByTestId('gmn-section')).toHaveTextContent(
        'gmn-42-Aurora Estética-conn-uuid-1',
      ),
    );
    await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent(/^$/));

    fireEvent.click(screen.getByRole('button', { name: 'handled' }));
    await waitFor(() => expect(screen.getByTestId('gmn-section')).toHaveTextContent('no-pick'));
  });

  it('keeps the Instagram and TikTok params working next to the Google ones', async () => {
    getInstagramSummaryMock.mockResolvedValue(null);
    renderTab('/clientes/42/redes-sociais?tt_error=1&yt_connected=1&ig_connected=1');
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
    await waitFor(() => expect(toastSuccessMock).toHaveBeenCalledWith('YouTube conectado.'));
    await waitFor(() => expect(screen.getByTestId('search')).toHaveTextContent(/^$/));
  });
});
