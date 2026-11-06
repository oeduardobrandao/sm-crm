import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';

// Desktop layout; the phone frame has its own cases below.
const { isDesktop } = vi.hoisted(() => ({ isDesktop: { value: true } }));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => isDesktop.value }));

vi.mock('chart.js', () => {
  class ChartMock {
    static register = vi.fn();
    destroy = vi.fn();
  }
  return { Chart: ChartMock, registerables: [] };
});

vi.mock('@/hooks/useWorkspaceLimits', () => ({ useWorkspaceLimits: vi.fn() }));
vi.mock('../../../store', () => ({ getClientes: vi.fn() }));
vi.mock('../../../services/instagram', () => ({
  getInstagramSummary: vi.fn(),
  syncInstagramData: vi.fn(),
}));
vi.mock('../../../services/tiktok', () => ({ getTikTokSummary: vi.fn() }));
vi.mock('../../../services/google', () => ({ getGoogleSummary: vi.fn() }));

// The connected Instagram tab stays on its skeleton: every content query never settles.
const pending = () => new Promise<never>(() => {});
vi.mock('../../../services/analytics', () => ({
  getAnalyticsOverview: vi.fn(() => pending()),
  getAccountMetrics: vi.fn(() => pending()),
  makeDelta: vi.fn(),
  getPostsAnalytics: vi.fn(() => pending()),
  getFollowerHistory: vi.fn(() => pending()),
  getAudienceDemographics: vi.fn(() => pending()),
  getBestPostingTimes: vi.fn(() => pending()),
  getTags: vi.fn(() => pending()),
  createTag: vi.fn(),
  deleteTag: vi.fn(),
  assignTagToPost: vi.fn(),
  removeTagFromPost: vi.fn(),
  getClientReports: vi.fn(),
  getAccountAIAnalysis: vi.fn(),
  upsertManualFollowerCount: vi.fn(),
  sendReportEmail: vi.fn(),
  getReportDownloadUrl: vi.fn(),
  getClientRateBaseline: vi.fn(() => pending()),
  getStoriesAnalytics: vi.fn(() => pending()),
}));
vi.mock('../../../services/reportDocs', () => ({
  listReportDocs: vi.fn(),
  deleteReportDoc: vi.fn(),
}));
// The TikTok tab has its own suite; here it only has to mount with the client id.
vi.mock('../tiktok/TikTokAnalyticsTab', () => ({
  TikTokAnalyticsTab: ({
    clientId,
    phoneFrame,
  }: {
    clientId: number;
    phoneFrame?: { nome: string; tabs: ReactNode };
  }) => (
    <div data-testid="tiktok-tab" data-client={clientId} data-nome={phoneFrame?.nome}>
      {phoneFrame?.tabs}
    </div>
  ),
}));
// The YouTube and Google tabs have their own suites too.
type MockFrame = { nome: string; tabs: ReactNode };
vi.mock('../youtube/YouTubeAnalyticsTab', () => ({
  YouTubeAnalyticsTab: ({ clientId, phoneFrame }: { clientId: number; phoneFrame?: MockFrame }) => (
    <div data-testid="youtube-tab" data-client={clientId} data-nome={phoneFrame?.nome}>
      {phoneFrame?.tabs}
    </div>
  ),
}));
vi.mock('../google/GoogleAnalyticsTab', () => ({
  GoogleAnalyticsTab: ({ clientId, phoneFrame }: { clientId: number; phoneFrame?: MockFrame }) => (
    <div data-testid="google-tab" data-client={clientId} data-nome={phoneFrame?.nome}>
      {phoneFrame?.tabs}
    </div>
  ),
}));
vi.mock('../reports/NewReportDialog', () => ({
  NewReportDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="Novo relatório" /> : null,
}));

import AnalyticsClientShell from '../AnalyticsClientShell';
import { useWorkspaceLimits } from '@/hooks/useWorkspaceLimits';
import { getClientes } from '../../../store';
import { getInstagramSummary } from '../../../services/instagram';
import { getTikTokSummary } from '../../../services/tiktok';
import { getGoogleSummary } from '../../../services/google';
import { getClientReports } from '../../../services/analytics';
import { listReportDocs } from '../../../services/reportDocs';
import { VidroToolbarHarness } from '@/test/vidroToolbar';

const IG = { account: { username: 'clinica.aurora', profile_picture_url: null } };
const TT = { account: { username: 'clinica.tt', avatar_url: null }, follower_history: [] };

function setFeatures(features: Record<string, boolean> | null, isLoading = false) {
  vi.mocked(useWorkspaceLimits).mockReturnValue({
    limits: null,
    features,
    planName: null,
    isLoading,
    isSuccess: !isLoading,
    isUnlimited: false,
  } as never);
}

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="path">{loc.pathname}</div>;
}

function renderShell(path: string, { vidro }: { vidro?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const routes = (
    <>
      <Routes>
        <Route path="/analytics/:id/:tab?" element={<AnalyticsClientShell />} />
        <Route path="*" element={null} />
      </Routes>
      <LocationProbe />
    </>
  );
  // The Vidro toolbar lives inside the router, as in AppLayout (its back control is a Link).
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        {vidro === undefined ? (
          routes
        ) : (
          <VidroToolbarHarness vidroShell={vidro}>{routes}</VidroToolbarHarness>
        )}
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const path = () => screen.getByTestId('path').textContent;

beforeEach(() => {
  vi.clearAllMocks();
  isDesktop.value = true;
  setFeatures({ feature_tiktok: true, feature_analytics_reports: true });
  vi.mocked(getClientes).mockResolvedValue([
    { id: 12, nome: 'Clínica Aurora', especialidade: 'Dermatologia', cor: '#123456' } as never,
  ]);
  vi.mocked(getInstagramSummary).mockResolvedValue(IG as never);
  vi.mocked(getTikTokSummary).mockResolvedValue(TT as never);
  vi.mocked(getGoogleSummary).mockResolvedValue({ youtube: null, gmn: null });
  vi.mocked(getClientReports).mockResolvedValue([]);
  vi.mocked(listReportDocs).mockResolvedValue([]);
});

describe('AnalyticsClientShell: default tab', () => {
  it('/analytics/12 redirects to /analytics/12/instagram', async () => {
    renderShell('/analytics/12');
    await waitFor(() => expect(path()).toBe('/analytics/12/instagram'));
  });

  it('redirects to tiktok when only TikTok is connected', async () => {
    vi.mocked(getInstagramSummary).mockResolvedValue(null as never);
    renderShell('/analytics/12');
    await waitFor(() => expect(path()).toBe('/analytics/12/tiktok'));
  });

  it('stays on instagram when Instagram is connected with an expired token', async () => {
    vi.mocked(getInstagramSummary).mockRejectedValue(new Error('TOKEN_EXPIRED'));
    renderShell('/analytics/12');
    await waitFor(() => expect(path()).toBe('/analytics/12/instagram'));
  });

  it('defaults to instagram when neither is connected', async () => {
    vi.mocked(getInstagramSummary).mockResolvedValue(null as never);
    vi.mocked(getTikTokSummary).mockRejectedValue(new Error('not found'));
    renderShell('/analytics/12');
    await waitFor(() => expect(path()).toBe('/analytics/12/instagram'));
  });

  it('defaults to instagram without feature_tiktok, even with only TikTok connected', async () => {
    setFeatures({ feature_tiktok: false, feature_analytics_reports: true });
    vi.mocked(getInstagramSummary).mockResolvedValue(null as never);
    renderShell('/analytics/12');
    await waitFor(() => expect(path()).toBe('/analytics/12/instagram'));
    expect(getTikTokSummary).not.toHaveBeenCalled();
  });

  it('unknown tab redirects to default', async () => {
    vi.mocked(getInstagramSummary).mockResolvedValue(null as never);
    renderShell('/analytics/12/foo');
    await waitFor(() => expect(path()).toBe('/analytics/12/tiktok'));
  });

  it('does not wait on the TikTok summary when Instagram is connected', async () => {
    vi.mocked(getTikTokSummary).mockReturnValue(new Promise<never>(() => {}));
    renderShell('/analytics/12');
    await waitFor(() => expect(path()).toBe('/analytics/12/instagram'));
  });

  it('waits on the TikTok summary when Instagram is not connected', async () => {
    vi.mocked(getInstagramSummary).mockResolvedValue(null as never);
    vi.mocked(getTikTokSummary).mockReturnValue(new Promise<never>(() => {}));
    renderShell('/analytics/12');
    await waitFor(() => expect(getTikTokSummary).toHaveBeenCalled());
    expect(path()).toBe('/analytics/12');
  });

  it('waits for the plan before choosing a default', async () => {
    setFeatures(null, true);
    vi.mocked(getInstagramSummary).mockResolvedValue(null as never);
    renderShell('/analytics/12');
    await waitFor(() => expect(getInstagramSummary).toHaveBeenCalled());
    // Still deciding: no redirect yet.
    expect(path()).toBe('/analytics/12');
  });
});

describe('AnalyticsClientShell: tabs', () => {
  it('renders the header and the three tabs', async () => {
    renderShell('/analytics/12/instagram');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Clínica Aurora' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Dermatologia')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Analytics' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Instagram', 'TikTok', 'Relatórios']);
    expect(within(nav).getByRole('link', { name: 'Instagram' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'TikTok' })).toHaveAttribute(
      'href',
      '/analytics/12/tiktok',
    );
    expect(screen.getByRole('link', { name: /Voltar/ })).toHaveAttribute('href', '/analytics');
  });

  it('TikTok tab hidden without feature_tiktok', async () => {
    setFeatures({ feature_tiktok: false, feature_analytics_reports: true });
    renderShell('/analytics/12/instagram');
    const nav = await screen.findByRole('navigation', { name: 'Analytics' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Instagram', 'Relatórios']);
  });

  it('/analytics/12/tiktok redirects to instagram without feature_tiktok', async () => {
    setFeatures({ feature_tiktok: false, feature_analytics_reports: true });
    renderShell('/analytics/12/tiktok');
    await waitFor(() => expect(path()).toBe('/analytics/12/instagram'));
  });

  it('does not bounce /analytics/12/tiktok while the plan is loading', async () => {
    setFeatures(null, true);
    renderShell('/analytics/12/tiktok');
    await waitFor(() => expect(getClientes).toHaveBeenCalled());
    expect(path()).toBe('/analytics/12/tiktok');
  });

  it('renders the TikTok tab', async () => {
    renderShell('/analytics/12/tiktok');
    expect(await screen.findByTestId('tiktok-tab')).toHaveAttribute('data-client', '12');
  });

  it('Instagram not connected shows the message inside the shell with tabs visible', async () => {
    vi.mocked(getInstagramSummary).mockResolvedValue(null as never);
    renderShell('/analytics/12/instagram');
    expect(await screen.findByText('Instagram não conectado')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Analytics' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Clínica Aurora' })).toBeInTheDocument();
  });

  it('reconnect button goes to /clientes/12/redes-sociais', async () => {
    vi.mocked(getInstagramSummary).mockRejectedValue(new Error('TOKEN_EXPIRED'));
    renderShell('/analytics/12/instagram');
    fireEvent.click(await screen.findByRole('button', { name: /Reconectar Conta/i }));
    await waitFor(() => expect(path()).toBe('/clientes/12/redes-sociais'));
  });

  it('not-connected button goes to /clientes/12/redes-sociais', async () => {
    vi.mocked(getInstagramSummary).mockResolvedValue(null as never);
    renderShell('/analytics/12/instagram');
    fireEvent.click(await screen.findByRole('button', { name: /Ir para o perfil do cliente/i }));
    await waitFor(() => expect(path()).toBe('/clientes/12/redes-sociais'));
  });

  it('Relatórios tab lists report docs and keeps old-format reports below them', async () => {
    vi.mocked(listReportDocs).mockResolvedValue([
      {
        id: 'doc-1',
        title: 'Relatório de Julho',
        period_start: '2026-07-01',
        status: 'ready',
        created_at: '2026-08-01T00:00:00Z',
        platforms: ['instagram'],
      } as never,
    ]);
    vi.mocked(getClientReports).mockResolvedValue([
      {
        id: 10,
        report_month: '2026-04',
        generated_at: '2026-04-17T09:00:00Z',
        status: 'ready',
        report_url: 'https://example.com/report.pdf',
      } as never,
    ]);
    renderShell('/analytics/12/relatorios');
    const doc = await screen.findByText('Relatório de Julho');
    const legacyHeading = await screen.findByText('Formato anterior');
    const legacyRow = screen.getByText('Abr 2026');
    expect(
      doc.compareDocumentPosition(legacyHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      legacyHeading.compareDocumentPosition(legacyRow) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Relatórios' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // The Instagram tab is not mounted here.
    expect(screen.queryByTitle('Sincronizar Dados')).toBeNull();
  });

  it('Relatórios tab: Gerar opens the report dialog', async () => {
    renderShell('/analytics/12/relatorios');
    fireEvent.click(await screen.findByRole('button', { name: 'Gerar' }));
    expect(screen.getByRole('dialog', { name: 'Novo relatório' })).toBeInTheDocument();
  });

  it('shows not-found for an unknown client', async () => {
    renderShell('/analytics/99/instagram');
    expect(await screen.findByText('Cliente não encontrado.')).toBeInTheDocument();
  });

  it('shows invalid id for a non-numeric id', () => {
    renderShell('/analytics/abc/instagram');
    expect(screen.getByText('ID de cliente inválido.')).toBeInTheDocument();
  });
});

describe('AnalyticsClientShell: YouTube and Google Meu Negócio tabs', () => {
  const tabTexts = async () => {
    const nav = await screen.findByRole('navigation', { name: 'Analytics' });
    return within(nav)
      .getAllByRole('link')
      .map((l) => l.textContent);
  };

  it('hides both tabs and never reads the Google summary with both flags off', async () => {
    renderShell('/analytics/12/instagram');
    expect(await tabTexts()).toEqual(['Instagram', 'TikTok', 'Relatórios']);
    expect(getGoogleSummary).not.toHaveBeenCalled();
  });

  it('redirects a deep link to YouTube or Google to instagram with the flags off', async () => {
    renderShell('/analytics/12/youtube');
    await waitFor(() => expect(path()).toBe('/analytics/12/instagram'));
    expect(screen.queryByTestId('youtube-tab')).toBeNull();
  });

  it('redirects /google to instagram when only the YouTube flag is on', async () => {
    setFeatures({ feature_tiktok: true, feature_youtube: true });
    renderShell('/analytics/12/google');
    await waitFor(() => expect(path()).toBe('/analytics/12/instagram'));
  });

  it('does not bounce a deep link while the plan is loading', async () => {
    setFeatures(null, true);
    renderShell('/analytics/12/youtube');
    await waitFor(() => expect(getClientes).toHaveBeenCalled());
    expect(path()).toBe('/analytics/12/youtube');
  });

  it('shows the YouTube tab and renders YouTubeAnalyticsTab with the flag on', async () => {
    setFeatures({ feature_tiktok: true, feature_youtube: true });
    renderShell('/analytics/12/youtube');
    expect(await screen.findByTestId('youtube-tab')).toHaveAttribute('data-client', '12');
    expect(await tabTexts()).toEqual(['Instagram', 'TikTok', 'YouTube', 'Relatórios']);
    expect(screen.getByRole('link', { name: 'YouTube' })).toHaveAttribute(
      'href',
      '/analytics/12/youtube',
    );
  });

  it('shows the Google Meu Negócio tab and renders GoogleAnalyticsTab with the flag on', async () => {
    setFeatures({ feature_google_business: true });
    renderShell('/analytics/12/google');
    expect(await screen.findByTestId('google-tab')).toHaveAttribute('data-client', '12');
    expect(await tabTexts()).toEqual(['Instagram', 'Google Meu Negócio', 'Relatórios']);
  });

  it('keeps instagram as the default tab even when a Google product is connected', async () => {
    setFeatures({ feature_youtube: true, feature_google_business: true });
    vi.mocked(getInstagramSummary).mockResolvedValue(null as never);
    vi.mocked(getGoogleSummary).mockResolvedValue({
      youtube: { channelId: 'UC1', avatarUrl: null } as never,
      gmn: null,
    });
    renderShell('/analytics/12');
    await waitFor(() => expect(path()).toBe('/analytics/12/instagram'));
  });

  it('uses the YouTube channel avatar in the header', async () => {
    setFeatures({ feature_youtube: true });
    vi.mocked(getGoogleSummary).mockResolvedValue({
      youtube: { channelId: 'UC1', avatarUrl: 'https://yt.example/a.jpg' } as never,
      gmn: null,
    });
    const { container } = renderShell('/analytics/12/youtube');
    await waitFor(() =>
      expect(container.querySelector('img.conta-identity__avatar')).toHaveAttribute(
        'src',
        'https://yt.example/a.jpg',
      ),
    );
  });
});

describe('AnalyticsClientShell in the Vidro toolbar', () => {
  it('registers the client identity once, from the shell, and keeps the tabs in the page', async () => {
    vi.mocked(getInstagramSummary).mockResolvedValue(null as never);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container } = renderShell('/analytics/12/instagram', { vidro: true });

    expect(await screen.findByText('Instagram não conectado')).toBeInTheDocument();
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0].closest('.vidro-toolbar')).not.toBeNull();
    expect(h1s[0]).toHaveTextContent('Clínica Aurora');
    expect(screen.getAllByRole('link', { name: /Voltar/ })).toHaveLength(1);
    expect(container.querySelector('.header')).toBeNull();
    const nav = screen.getByRole('navigation', { name: 'Analytics' });
    expect(nav.closest('.vidro-toolbar')).toBeNull();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('keeps the in-page header when the Vidro shell is off', async () => {
    renderShell('/analytics/12/relatorios', { vidro: false });
    const h1 = await screen.findByRole('heading', { level: 1, name: 'Clínica Aurora' });
    expect(h1.closest('.header')).not.toBeNull();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});

describe('AnalyticsClientShell (phone)', () => {
  beforeEach(() => {
    isDesktop.value = false;
  });

  it('Relatórios tab renders the report lists under one identity heading and the tab control', async () => {
    vi.mocked(listReportDocs).mockResolvedValue([
      {
        id: 'doc-1',
        title: 'Relatório de setembro',
        period_start: '2026-09-01',
        status: 'ready',
        created_at: '2026-10-02T10:00:00Z',
        platforms: ['instagram'],
      } as never,
    ]);
    renderShell('/analytics/12/relatorios');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Clínica Aurora' }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(
      await screen.findByRole('button', { name: /Relatório de setembro/ }),
    ).toBeInTheDocument();
    const tabs = screen.getByRole('tablist', { name: 'Analytics' });
    expect(within(tabs).getByRole('tab', { name: 'Relatórios' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('switches tabs from the segmented control', async () => {
    renderShell('/analytics/12/relatorios');
    const tabs = await screen.findByRole('tablist', { name: 'Analytics' });
    fireEvent.click(within(tabs).getByRole('tab', { name: 'TikTok' }));
    await waitFor(() => expect(path()).toBe('/analytics/12/tiktok'));
  });

  it('TikTok tab owns its phone frame: the shell hands it the client and the tab control', async () => {
    renderShell('/analytics/12/tiktok');
    const tab = await screen.findByTestId('tiktok-tab');
    expect(tab).toHaveAttribute('data-client', '12');
    expect(tab).toHaveAttribute('data-nome', 'Clínica Aurora');
    // No shell frame around it: the tab renders the nav bar and the one h1 itself.
    expect(document.querySelector('.phone-an-identity')).toBeNull();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    const tabs = within(tab).getByRole('tablist', { name: 'Analytics' });
    expect(within(tabs).getByRole('tab', { name: 'TikTok' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('Instagram not connected keeps the tab control above the message', async () => {
    vi.mocked(getInstagramSummary).mockResolvedValue(null as never);
    renderShell('/analytics/12/instagram');
    expect(await screen.findByText('Instagram não conectado')).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Analytics' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('lists the visible tabs in the phone tablist, flags on', async () => {
    setFeatures({ feature_tiktok: true, feature_youtube: true, feature_google_business: true });
    renderShell('/analytics/12/relatorios');
    const tabs = await screen.findByRole('tablist', { name: 'Analytics' });
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((t) => t.textContent),
    ).toEqual(['Instagram', 'TikTok', 'YouTube', 'Google Meu Negócio', 'Relatórios']);
  });

  it('omits the new tabs from the phone tablist with the flags off', async () => {
    renderShell('/analytics/12/relatorios');
    const tabs = await screen.findByRole('tablist', { name: 'Analytics' });
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((t) => t.textContent),
    ).toEqual(['Instagram', 'TikTok', 'Relatórios']);
  });

  it('YouTube and Google tabs always get the phone frame with the tab control', async () => {
    setFeatures({ feature_youtube: true, feature_google_business: true });
    renderShell('/analytics/12/youtube');
    const yt = await screen.findByTestId('youtube-tab');
    expect(yt).toHaveAttribute('data-nome', 'Clínica Aurora');
    const tabs = within(yt).getByRole('tablist', { name: 'Analytics' });
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Google Meu Negócio' }));
    await waitFor(() => expect(path()).toBe('/analytics/12/google'));
    const g = await screen.findByTestId('google-tab');
    expect(g).toHaveAttribute('data-nome', 'Clínica Aurora');
    expect(within(g).getByRole('tab', { name: 'Google Meu Negócio' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});
