import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from 'i18next';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pt from '../../../../../../../packages/i18n/locales/pt/analyticsYoutube.json';
import en from '../../../../../../../packages/i18n/locales/en/analyticsYoutube.json';
import type { YtKpiId, YtOverview, YtVideoRow } from '../../../../services/youtubeAnalytics';

vi.mock('@/hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({ features: { feature_youtube: true } }),
}));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));
vi.mock('chart.js', () => ({
  Chart: class {
    static register = vi.fn();
    destroy = vi.fn();
  },
  registerables: [],
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Keep the real error classes: the tab tells the states apart with instanceof.
vi.mock('../../../../services/youtubeAnalytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../services/youtubeAnalytics')>()),
  getYouTubeOverview: vi.fn(),
  getYouTubeDaily: vi.fn(),
  getYouTubeTraffic: vi.fn(),
  getYouTubeDemographics: vi.fn(),
  getYouTubeVideos: vi.fn(),
  getYouTubeTopShorts: vi.fn(),
}));
// isGoogleFeatureDisabled and GoogleServiceError stay real.
vi.mock('../../../../services/google', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../services/google')>()),
  syncGoogleProduct: vi.fn(),
}));

import { toast } from 'sonner';
import {
  getYouTubeDaily,
  getYouTubeDemographics,
  getYouTubeOverview,
  getYouTubeTopShorts,
  getYouTubeTraffic,
  getYouTubeVideos,
  YouTubeNotConnectedError,
} from '../../../../services/youtubeAnalytics';
import { GoogleServiceError, syncGoogleProduct } from '../../../../services/google';
import { YouTubeAnalyticsTab } from '../YouTubeAnalyticsTab';

const kpiEntry = (value: number | null, prev: number | null) => ({ value, prev });

function overview(
  over: Partial<YtOverview['channel']> = {},
  kpis: Partial<YtOverview['kpis']> = {},
  split?: YtOverview['split'],
): YtOverview {
  return {
    channel: {
      title: 'Clínica Sorriso Pleno',
      handle: '@sorrisopleno',
      avatarUrl: null,
      subscriberCount: 12430,
      authorizationStatus: 'active',
      lastSyncedAt: new Date(Date.now() - 3_600_000).toISOString(),
      dataThrough: '2026-10-25',
      contentTypeThrough: '2026-10-25',
      trafficThrough: '2026-10-25',
      videosThrough: '2026-10-25',
      ...over,
    },
    window: {
      start: '2026-09-28',
      end: '2026-10-25',
      prevStart: '2026-08-31',
      prevEnd: '2026-09-27',
    },
    kpis: {
      subscribers: kpiEntry(12430, 12175),
      net_subscribers: kpiEntry(284, 240),
      views: kpiEntry(184200, 148500),
      engaged_views: kpiEntry(96800, 88800),
      watch_minutes: kpiEntry(110400, 115000),
      avg_view_duration_s: kpiEntry(38, 41),
      likes: kpiEntry(9112, 8135),
      shares: kpiEntry(1304, 1304),
      comments: kpiEntry(412, 380),
      ...kpis,
    } as Record<YtKpiId, { value: number | null; prev: number | null }>,
    split: split ?? {
      views: { shorts: 149200, long: 35000 },
      minutes: { shorts: 41940, long: 68460 },
      likes: { shorts: 6930, long: 2182 },
    },
  };
}

function video(id: string, extra: Partial<YtVideoRow> = {}): YtVideoRow {
  return {
    videoId: id,
    title: `Vídeo ${id}`,
    isShort: true,
    publishedAt: '2026-10-21T15:00:00Z',
    thumbnailUrl: null,
    views: 38412,
    engagedViews: 19880,
    avgViewDurationS: 41,
    avgViewPct: 84,
    likes: 2104,
    comments: 96,
    subscribersGained: 71,
    ...extra,
  };
}

let client: QueryClient;
function renderTab() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <YouTubeAnalyticsTab clientId={12} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const kpi = (label: string) =>
  screen
    .getByText(label, { selector: '.kpi-label, .kpi-label *' })
    .closest('.kpi-card') as HTMLElement;
const card = (title: string) =>
  screen.getByRole('heading', { name: title }).closest('.card') as HTMLElement;

beforeAll(() => {
  i18n.addResourceBundle('pt', 'analyticsYoutube', pt, true, true);
  i18n.addResourceBundle('en', 'analyticsYoutube', en, true, true);
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getYouTubeOverview).mockResolvedValue(overview());
  vi.mocked(getYouTubeDaily).mockResolvedValue([
    {
      date: '2026-10-24',
      views: 6000,
      engagedViews: 3000,
      watchMinutes: 4000,
      likes: 300,
      comments: 10,
      shares: 40,
      subscribersGained: 200,
      subscribersLost: 20,
      shortsViews: 5000,
      longViews: 1000,
    },
    {
      date: '2026-10-25',
      views: 7000,
      engagedViews: 3500,
      watchMinutes: 4200,
      likes: 320,
      comments: 12,
      shares: 44,
      subscribersGained: 112,
      subscribersLost: 8,
      shortsViews: 5600,
      longViews: 1400,
    },
  ]);
  vi.mocked(getYouTubeTraffic).mockResolvedValue([
    { sourceType: 'SHORTS', views: 680 },
    { sourceType: 'YT_SEARCH', views: 120 },
    { sourceType: 'RELATED_VIDEO', views: 90 },
    { sourceType: 'EXT_URL', views: 60 },
    { sourceType: 'YT_CHANNEL', views: 30 },
    { sourceType: 'SUBSCRIBER', views: 12 },
    { sourceType: 'NOTIFICATION', views: 8 },
  ]);
  vi.mocked(getYouTubeDemographics).mockResolvedValue([
    { ageGroup: 'age25-34', gender: 'female', viewerPct: 26 },
    { ageGroup: 'age25-34', gender: 'male', viewerPct: 12 },
    { ageGroup: 'age55-64', gender: 'female', viewerPct: 3 },
    { ageGroup: 'age65-', gender: 'female', viewerPct: 2 },
    { ageGroup: 'age55-64', gender: 'male', viewerPct: 3 },
  ]);
  vi.mocked(getYouTubeVideos).mockResolvedValue([
    video('a'),
    video('b', {
      title: 'Implante dentário: guia completo',
      isShort: false,
      publishedAt: '2026-10-18T15:00:00Z',
      views: 4210,
      avgViewDurationS: 372,
      avgViewPct: 41,
    }),
  ]);
  vi.mocked(getYouTubeTopShorts).mockResolvedValue([video('a')]);
});

describe('YouTubeAnalyticsTab', () => {
  it('renders the eight KPIs, pt-BR formatted, in the mockup order', async () => {
    renderTab();
    await screen.findByText('Inscritos', { selector: '.kpi-label, .kpi-label *' });
    const cards = Array.from(document.querySelectorAll('.kpi-card')).filter((c) => c.textContent);
    expect(cards.map((c) => c.querySelector('.kpi-label')?.textContent)).toEqual([
      'Inscritos',
      'Novos inscritos',
      'Visualizações',
      'Visualizações engajadas',
      'Tempo assistido',
      'Duração média',
      'Curtidas',
      'Compartilhamentos',
    ]);
    expect(within(kpi('Inscritos')).getByText('12,4 mil')).toBeInTheDocument();
    expect(within(kpi('Novos inscritos')).getByText('+284')).toBeInTheDocument();
    expect(within(kpi('Visualizações')).getByText('184,2 mil')).toBeInTheDocument();
    expect(within(kpi('Visualizações engajadas')).getByText('96,8 mil')).toBeInTheDocument();
    expect(within(kpi('Tempo assistido')).getByText('1.840 h')).toBeInTheDocument();
    expect(within(kpi('Duração média')).getByText('0:38')).toBeInTheDocument();
    expect(within(kpi('Curtidas')).getByText('9.112')).toBeInTheDocument();
    expect(within(kpi('Compartilhamentos')).getByText('1.304')).toBeInTheDocument();
    expect(
      within(kpi('Compartilhamentos')).getByText('412 comentários no período'),
    ).toBeInTheDocument();
    // Delta caption names the window's length.
    expect(within(kpi('Inscritos')).getByText('vs. 28 dias anteriores')).toBeInTheDocument();
    // Gained and lost come from the daily series.
    expect(
      await within(kpi('Novos inscritos')).findByText('312 ganhos, 28 perdidos'),
    ).toBeInTheDocument();
    // Channel row and data note.
    expect(screen.getByRole('link', { name: 'Clínica Sorriso Pleno' })).toHaveAttribute(
      'href',
      'https://www.youtube.com/@sorrisopleno',
    );
    expect(screen.getByText('· 12.430 inscritos')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Dados até 25 de out. O YouTube libera os números com 2 a 3 dias de atraso.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Dados do YouTube, como o YouTube informa.')).toBeInTheDocument();
  });

  it("prefers the server's gained and lost over the daily sum", async () => {
    vi.mocked(getYouTubeOverview).mockResolvedValue(
      overview({}, { net_subscribers: { value: 284, prev: 240, gained: 300, lost: 16 } }),
    );
    renderTab();
    await screen.findByText('Inscritos', { selector: '.kpi-label, .kpi-label *' });
    expect(within(kpi('Novos inscritos')).getByText('300 ganhos, 16 perdidos')).toBeInTheDocument();
  });

  it('starts at 28 dias and switching the period refetches with that window', async () => {
    renderTab();
    await screen.findByText('Inscritos', { selector: '.kpi-label, .kpi-label *' });
    expect(getYouTubeOverview).toHaveBeenLastCalledWith(12, { days: 28 }, 'all');
    expect(screen.getByRole('tab', { name: '28 dias' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('tab', { name: '90 dias' }));
    await waitFor(() =>
      expect(getYouTubeOverview).toHaveBeenLastCalledWith(12, { days: 90 }, 'all'),
    );
    await waitFor(() => expect(getYouTubeTraffic).toHaveBeenLastCalledWith(12, { days: 90 }));
    // Personalizado: a day count ending at dataThrough, sent as start/end (the server's
    // ?days takes only 7, 28 and 90).
    fireEvent.click(screen.getByRole('tab', { name: 'Personalizado' }));
    const input = screen.getByRole('spinbutton', { name: 'Período personalizado em dias' });
    fireEvent.change(input, { target: { value: '45' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() =>
      expect(getYouTubeOverview).toHaveBeenLastCalledWith(
        12,
        { start: '2026-09-11', end: '2026-10-25' },
        'all',
      ),
    );
  });

  it('switching to Shorts refetches the overview and the daily series with type=shorts', async () => {
    renderTab();
    await screen.findByText('Inscritos', { selector: '.kpi-label, .kpi-label *' });
    fireEvent.click(screen.getByRole('tab', { name: 'Shorts' }));
    await waitFor(() =>
      expect(getYouTubeOverview).toHaveBeenLastCalledWith(12, { days: 28 }, 'shorts'),
    );
    await waitFor(() =>
      expect(getYouTubeDaily).toHaveBeenLastCalledWith(12, { days: 28 }, 'shorts'),
    );
  });

  it('Sincronizar calls syncGoogleProduct and invalidates the yt- queries', async () => {
    vi.mocked(syncGoogleProduct).mockResolvedValue(undefined);
    renderTab();
    await screen.findByText('Inscritos', { selector: '.kpi-label, .kpi-label *' });
    await waitFor(() => expect(getYouTubeVideos).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Sincronizar' }));
    await waitFor(() => expect(syncGoogleProduct).toHaveBeenCalledWith('youtube', 12));
    await waitFor(() => expect(getYouTubeOverview).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(getYouTubeVideos).toHaveBeenCalledTimes(2));
    expect(getYouTubeDaily).toHaveBeenCalledTimes(2);
    expect(getYouTubeTraffic).toHaveBeenCalledTimes(2);
    expect(getYouTubeTopShorts).toHaveBeenCalledTimes(2);
    expect(toast.success).toHaveBeenCalledWith('Dados do YouTube sincronizados.');
  });

  it('a rate-limited sync reads the Google limit copy', async () => {
    vi.mocked(syncGoogleProduct).mockRejectedValue(new GoogleServiceError('rate_limited'));
    renderTab();
    await screen.findByText('Inscritos', { selector: '.kpi-label, .kpi-label *' });
    fireEvent.click(screen.getByRole('button', { name: 'Sincronizar' }));
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        'Limite da API do Google atingido. Tente de novo em alguns minutos.',
      ),
    );
  });

  it('a lagging traffic watermark shows its own Dados até on that card only', async () => {
    vi.mocked(getYouTubeOverview).mockResolvedValue(overview({ trafficThrough: '2026-10-22' }));
    renderTab();
    await screen.findByText('Feed de Shorts');
    expect(
      within(card('De onde vêm as visualizações')).getByText('Dados até 22 de out.'),
    ).toBeInTheDocument();
    expect(within(card('Shorts x vídeos longos')).queryByText(/^Dados até/)).toBeNull();
  });

  it('a lagging content-type watermark marks the split card and the daily chart', async () => {
    vi.mocked(getYouTubeOverview).mockResolvedValue(overview({ contentTypeThrough: '2026-10-23' }));
    renderTab();
    await screen.findByText('Feed de Shorts');
    expect(
      within(card('Shorts x vídeos longos')).getByText('Dados até 23 de out.'),
    ).toBeInTheDocument();
    expect(
      within(card('Visualizações por dia')).getByText('Dados até 23 de out.'),
    ).toBeInTheDocument();
    expect(within(card('De onde vêm as visualizações')).queryByText(/^Dados até/)).toBeNull();
  });

  it('a lagging videos watermark marks Shorts em destaque and Vídeos only', async () => {
    vi.mocked(getYouTubeOverview).mockResolvedValue(overview({ videosThrough: '2026-10-20' }));
    renderTab();
    await screen.findByRole('table');
    expect(
      within(card('Shorts em destaque')).getByText('Dados até 20 de out.'),
    ).toBeInTheDocument();
    expect(within(card('Vídeos')).getByText('Dados até 20 de out.')).toBeInTheDocument();
    expect(within(card('De onde vêm as visualizações')).queryByText(/^Dados até/)).toBeNull();
  });

  it('null KPIs under a content type read sem dados, not 0', async () => {
    renderTab();
    await screen.findByText('Inscritos', { selector: '.kpi-label, .kpi-label *' });
    vi.mocked(getYouTubeOverview).mockResolvedValue(
      overview(
        { contentTypeThrough: null },
        {
          views: kpiEntry(null, null),
          engaged_views: kpiEntry(null, null),
          watch_minutes: kpiEntry(null, null),
          avg_view_duration_s: kpiEntry(null, null),
          likes: kpiEntry(null, null),
          shares: kpiEntry(null, null),
          comments: kpiEntry(null, null),
        },
      ),
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Shorts' }));
    await waitFor(() =>
      expect(within(kpi('Visualizações')).getByText('sem dados')).toBeInTheDocument(),
    );
    expect(within(kpi('Visualizações')).queryByText('0')).toBeNull();
    expect(within(kpi('Visualizações')).queryByText(/dias anteriores/)).toBeNull();
    // Subscribers are channel-wide: they stay.
    expect(within(kpi('Inscritos')).getByText('12,4 mil')).toBeInTheDocument();
  });

  it('maps traffic sources and sums the rest into Outras origens', async () => {
    renderTab();
    const traffic = within(
      await screen.findByText('Feed de Shorts').then(() => card('De onde vêm as visualizações')),
    );
    const rows = traffic.getAllByTestId('yt-traffic-row').map((r) => r.textContent);
    expect(rows).toEqual([
      'Feed de Shorts68%',
      'Pesquisa12%',
      'Sugestões9%',
      'Links externos6%',
      'Página do canal3%',
      'Outras origens2%',
    ]);
  });

  it('the split card shows shares and zeros, never sem dados, for a channel without Shorts', async () => {
    vi.mocked(getYouTubeOverview).mockResolvedValue(
      overview(
        {},
        {},
        {
          views: { shorts: 0, long: 5000 },
          minutes: { shorts: 0, long: 600 },
          likes: { shorts: 0, long: 0 },
        },
      ),
    );
    renderTab();
    await screen.findByText('Inscritos', { selector: '.kpi-label, .kpi-label *' });
    const split = within(card('Shorts x vídeos longos'));
    expect(
      split.getByText('Participação no período: Shorts têm 0% das visualizações'),
    ).toBeInTheDocument();
    expect(split.getAllByText('Shorts 0')).toHaveLength(2);
    expect(split.getByText('Shorts 0 h')).toBeInTheDocument();
    expect(split.getByText('Longos 10 h')).toBeInTheDocument();
    expect(split.queryByText('sem dados')).toBeNull();
  });

  it('the audience card merges 55+ and splits women and men', async () => {
    renderTab();
    const audience = within(await screen.findByText('Mulheres 67%').then(() => card('Público')));
    expect(
      audience.getByText('Idade e gênero dos espectadores · últimos 28 dias'),
    ).toBeInTheDocument();
    expect(audience.getByText('Homens 33%')).toBeInTheDocument();
    expect(audience.getByText('25-34')).toBeInTheDocument();
    expect(audience.getByText('55+')).toBeInTheDocument();
    expect(audience.getByText('8%')).toBeInTheDocument();
  });

  it('lists top Shorts and the videos table with sanitized YouTube links', async () => {
    vi.mocked(getYouTubeVideos).mockResolvedValue([
      video('a'),
      video('b', { isShort: false, title: 'Longo', publishedAt: '2026-10-18T15:00:00Z' }),
      video('evil"/><script>', { title: 'Estranho' }),
    ]);
    renderTab();
    const table = await screen.findByRole('table');
    const rowA = within(table).getByText('Vídeo a').closest('tr') as HTMLElement;
    expect(within(rowA).getByText('Short')).toBeInTheDocument();
    expect(within(rowA).getByText('21 out.')).toBeInTheDocument();
    expect(within(rowA).getByText('38.412')).toBeInTheDocument();
    expect(within(rowA).getByText('84%')).toBeInTheDocument();
    expect(within(rowA).getByText('+71')).toBeInTheDocument();
    expect(within(rowA).getByRole('link', { name: 'Abrir no YouTube: Vídeo a' })).toHaveAttribute(
      'href',
      'https://www.youtube.com/shorts/a',
    );
    const rowB = within(table).getByText('Longo').closest('tr') as HTMLElement;
    expect(within(rowB).getByText('Vídeo longo')).toBeInTheDocument();
    expect(within(rowB).getByRole('link', { name: /Abrir no YouTube/ })).toHaveAttribute(
      'href',
      'https://www.youtube.com/watch?v=b',
    );
    const odd = within(table).getByText('Estranho').closest('tr') as HTMLElement;
    expect(
      within(odd)
        .getByRole('link', { name: /Abrir no YouTube/ })
        .getAttribute('href'),
    ).toBe(`https://www.youtube.com/shorts/${encodeURIComponent('evil"/><script>')}`);
    const top = within(card('Shorts em destaque'));
    expect(top.getByText('#1')).toBeInTheDocument();
    expect(top.getByText('38,4 mil visualizações · 84% assistido')).toBeInTheDocument();
  });

  it('pending shows the skeleton', async () => {
    vi.mocked(getYouTubeOverview).mockReturnValue(new Promise<never>(() => {}));
    const { container } = renderTab();
    expect(
      container.querySelector('[aria-busy="true"], .skeleton, [class*="skeleton"]'),
    ).not.toBeNull();
    expect(screen.queryByText('Inscritos')).toBeNull();
  });

  it('not connected shows a card linking to Redes sociais and fetches nothing else', async () => {
    vi.mocked(getYouTubeOverview).mockRejectedValue(new YouTubeNotConnectedError());
    renderTab();
    expect(await screen.findByText('YouTube não conectado')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir para Redes sociais' })).toHaveAttribute(
      'href',
      '/clientes/12/redes-sociais',
    );
    expect(getYouTubeVideos).not.toHaveBeenCalled();
  });

  it('feature_disabled shows the locked card', async () => {
    vi.mocked(getYouTubeOverview).mockRejectedValue(new Error('feature_disabled'));
    renderTab();
    expect(
      await screen.findByText('O YouTube não está disponível no seu plano.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver planos' })).toHaveAttribute(
      'href',
      '/configuracao/cobranca',
    );
  });

  it('an error shows a retry and keeps the period control', async () => {
    vi.mocked(getYouTubeOverview).mockRejectedValueOnce(new Error('Error 500'));
    renderTab();
    expect(
      await screen.findByText('Não foi possível carregar os dados do YouTube.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '7 dias' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(
      await screen.findByText('Inscritos', { selector: '.kpi-label, .kpi-label *' }),
    ).toBeInTheDocument();
  });

  it('revoked shows the reconnect callout', async () => {
    vi.mocked(getYouTubeOverview).mockResolvedValue(
      overview({
        authorizationStatus: 'revoked',
        dataThrough: null,
        contentTypeThrough: null,
        trafficThrough: null,
      }),
    );
    renderTab();
    expect(await screen.findByText('Autorização do Google expirada')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Reconectar' })).toHaveAttribute(
      'href',
      '/clientes/12/redes-sociais',
    );
    expect(screen.queryByText('Primeira sincronização em andamento')).toBeNull();
  });

  it('before the first sync shows Primeira sincronização em andamento', async () => {
    vi.mocked(getYouTubeOverview).mockResolvedValue(
      overview({ dataThrough: null, contentTypeThrough: null, trafficThrough: null }),
    );
    renderTab();
    expect(await screen.findByText('Primeira sincronização em andamento')).toBeInTheDocument();
    expect(screen.queryByText('Inscritos', { selector: '.kpi-label, .kpi-label *' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sincronizar' })).toBeInTheDocument();
  });

  it('no element mentions IA', async () => {
    renderTab();
    await screen.findByText('Feed de Shorts');
    await screen.findByRole('table');
    expect(document.body.textContent).not.toMatch(/\bIA\b/);
  });
});
