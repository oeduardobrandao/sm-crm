import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

let mockFeatures: { feature_youtube?: boolean } | null | undefined = { feature_youtube: false };

vi.mock('../../../hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({ features: mockFeatures }),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

// jsdom has no layout: render the desktop card (a phone shows the analytics link as a cell).
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));

// Shows the path only after a navigation, so "renders nothing" tests still see an empty container.
function PathProbe() {
  const { pathname } = useLocation();
  return pathname.startsWith('/analytics') ? <span data-testid="path">{pathname}</span> : null;
}

const { getGoogleSummaryMock, getGoogleAuthUrlMock, disconnectYouTubeMock, syncMock } = vi.hoisted(
  () => ({
    getGoogleSummaryMock: vi.fn(),
    getGoogleAuthUrlMock: vi.fn(),
    disconnectYouTubeMock: vi.fn(),
    syncMock: vi.fn(),
  }),
);

vi.mock('../../../services/google', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/google')>();
  return {
    ...actual,
    getGoogleSummary: (...a: unknown[]) => getGoogleSummaryMock(...a),
    getGoogleAuthUrl: (...a: unknown[]) => getGoogleAuthUrlMock(...a),
    disconnectYouTube: (...a: unknown[]) => disconnectYouTubeMock(...a),
    syncGoogleProduct: (...a: unknown[]) => syncMock(...a),
  };
});

import { YouTubeSection } from '../YouTubeSection';

const channel = {
  channelId: 'UC123',
  title: 'Clínica Sorriso Pleno',
  handle: '@sorrisopleno',
  avatarUrl: 'https://yt3.ggpht.com/a.jpg',
  subscriberCount: 12430,
  viewCount: 1200000,
  videoCount: 214,
  authorizationStatus: 'active' as const,
  connectionEmail: 'contato@sorrisopleno.com.br',
  lastSyncedAt: null,
};

function renderSection(clienteId = 7) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries');
  const utils = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/clientes/7/redes-sociais']}>
        <Routes>
          <Route path="*" element={<YouTubeSection clienteId={clienteId} />} />
        </Routes>
        <PathProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, invalidate };
}

const originalLocation = window.location;

afterEach(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
  cleanup();
  vi.clearAllMocks();
  mockFeatures = { feature_youtube: false };
});

describe('YouTubeSection', () => {
  it('renders_nothing_without_flag', () => {
    const { container } = renderSection();
    expect(container).toBeEmptyDOMElement();
    expect(getGoogleSummaryMock).not.toHaveBeenCalled();
  });

  it('renders nothing while entitlements are still loading', () => {
    mockFeatures = undefined;
    const { container } = renderSection();
    expect(container).toBeEmptyDOMElement();
    expect(getGoogleSummaryMock).not.toHaveBeenCalled();
  });

  it('connect_card_when_no_channel', async () => {
    mockFeatures = { feature_youtube: true };
    getGoogleSummaryMock.mockResolvedValue({ youtube: null, gmn: null });
    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...originalLocation,
        set href(v: string) {
          assign(v);
        },
      },
    });
    getGoogleAuthUrlMock.mockResolvedValue('https://accounts.google.com/o/oauth2/v2/auth?x=1');

    renderSection(7);

    expect(await screen.findByText('Conectar YouTube')).toBeInTheDocument();
    expect(getGoogleSummaryMock).toHaveBeenCalledWith(7);
    await userEvent.click(screen.getByRole('button', { name: 'Conectar com o Google' }));
    await waitFor(() => expect(getGoogleAuthUrlMock).toHaveBeenCalledWith(7, 'youtube'));
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/v2/auth?x=1'),
    );
  });

  it('shows the load error, not the connect card, when the summary fails', async () => {
    mockFeatures = { feature_youtube: true };
    getGoogleSummaryMock.mockRejectedValue(new Error('boom'));
    renderSection();

    expect(
      await screen.findByText('Não foi possível carregar o YouTube deste cliente.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Conectar YouTube')).toBeNull();
  });

  it('connected_card_counts', async () => {
    mockFeatures = { feature_youtube: true };
    getGoogleSummaryMock.mockResolvedValue({ youtube: channel, gmn: null });
    renderSection();

    expect(await screen.findByText('Conectado')).toBeInTheDocument();
    expect(screen.getByText('12,4 mil')).toBeInTheDocument();
    expect(screen.getByText('1,2 mi')).toBeInTheDocument();
    expect(screen.getByText('Inscritos')).toBeInTheDocument();
    expect(screen.getByText('Visualizações totais')).toBeInTheDocument();
    expect(screen.getByText('Vídeos')).toBeInTheDocument();
    expect(
      screen.getByText('O YouTube libera os números com 2 a 3 dias de atraso.'),
    ).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'youtube.com/@sorrisopleno' });
    expect(link).toHaveAttribute('href', 'https://www.youtube.com/@sorrisopleno');
    expect(screen.queryByText(/Ver analytics/)).toBeNull();
  });

  it('revoked_banner', async () => {
    mockFeatures = { feature_youtube: true };
    getGoogleSummaryMock.mockResolvedValue({
      youtube: { ...channel, authorizationStatus: 'revoked' },
      gmn: null,
    });
    renderSection();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveClass('badge-warning');
    expect(alert.getAttribute('style')).not.toMatch(/badge-warning-/);
    expect(
      within(alert).getByText(
        'A autorização do Google expirou. Reconecte a conta para voltar a sincronizar.',
      ),
    ).toBeInTheDocument();
    expect(within(alert).getByRole('button', { name: 'Reconectar' })).toBeInTheDocument();
    expect(screen.queryByText('Conectado')).toBeNull();
  });

  it('disconnect_confirms_then_calls_service', async () => {
    mockFeatures = { feature_youtube: true };
    getGoogleSummaryMock.mockResolvedValue({ youtube: channel, gmn: null });
    disconnectYouTubeMock.mockResolvedValue(undefined);
    const { invalidate } = renderSection(7);

    await userEvent.click(await screen.findByRole('button', { name: 'Desconectar' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Desconectar YouTube?')).toBeInTheDocument();
    expect(within(dialog).getByText(/em até 7 dias/)).toBeInTheDocument();
    expect(disconnectYouTubeMock).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Desconectar' }));

    await waitFor(() => expect(disconnectYouTubeMock).toHaveBeenCalledWith(7));
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['googleSummary', 7] }),
    );
  });

  it('sync_calls_the_youtube_sync_and_refreshes_the_card', async () => {
    mockFeatures = { feature_youtube: true };
    getGoogleSummaryMock.mockResolvedValue({ youtube: channel, gmn: null });
    syncMock.mockResolvedValue({ ok: true, status: 'synced' });
    const { invalidate } = renderSection(7);

    await userEvent.click(await screen.findByRole('button', { name: 'Sincronizar Dados' }));
    await waitFor(() => expect(syncMock).toHaveBeenCalledWith('youtube', 7));
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['googleSummary', 7] }),
    );
  });

  it('sync is disabled while the channel needs reconnecting', async () => {
    mockFeatures = { feature_youtube: true };
    getGoogleSummaryMock.mockResolvedValue({
      youtube: { ...channel, authorizationStatus: 'revoked' },
      gmn: null,
    });
    renderSection(7);
    expect(await screen.findByRole('button', { name: 'Sincronizar Dados' })).toBeDisabled();
  });

  it('full analytics opens the client YouTube analytics tab', async () => {
    mockFeatures = { feature_youtube: true };
    getGoogleSummaryMock.mockResolvedValue({ youtube: channel, gmn: null });
    renderSection(7);
    await userEvent.click(await screen.findByRole('button', { name: /Ver Analytics Completo/ }));
    expect(screen.getByTestId('path')).toHaveTextContent('/analytics/7/youtube');
  });
});
