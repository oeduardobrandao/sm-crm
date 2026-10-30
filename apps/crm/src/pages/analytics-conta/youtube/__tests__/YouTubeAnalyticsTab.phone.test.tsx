import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import i18n from 'i18next';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import pt from '../../../../../../../packages/i18n/locales/pt/analyticsYoutube.json';
import en from '../../../../../../../packages/i18n/locales/en/analyticsYoutube.json';
import type { YtKpiId, YtOverview, YtVideoRow } from '../../../../services/youtubeAnalytics';

// Below 768px: the tab renders its phone variant.
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => false }));
vi.mock('@/hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: () => ({ features: { feature_youtube: true } }),
}));
vi.mock('chart.js', () => ({
  Chart: class {
    static register = vi.fn();
    destroy = vi.fn();
  },
  registerables: [],
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

vi.mock('../../../../services/youtubeAnalytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../services/youtubeAnalytics')>()),
  getYouTubeOverview: vi.fn(),
  getYouTubeDaily: vi.fn(),
  getYouTubeTraffic: vi.fn(),
  getYouTubeDemographics: vi.fn(),
  getYouTubeVideos: vi.fn(),
  getYouTubeTopShorts: vi.fn(),
}));
vi.mock('../../../../services/google', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../services/google')>()),
  syncGoogleProduct: vi.fn(),
}));

import {
  getYouTubeDaily,
  getYouTubeDemographics,
  getYouTubeOverview,
  getYouTubeTopShorts,
  getYouTubeTraffic,
  getYouTubeVideos,
  YouTubeNotConnectedError,
} from '../../../../services/youtubeAnalytics';
import { syncGoogleProduct } from '../../../../services/google';
import { YouTubeAnalyticsTab } from '../YouTubeAnalyticsTab';

const kpiEntry = (value: number | null, prev: number | null) => ({ value, prev });

function overview(over: Partial<YtOverview['channel']> = {}): YtOverview {
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
    } as Record<YtKpiId, { value: number | null; prev: number | null }>,
    split: {
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

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <YouTubeAnalyticsTab
          clientId={12}
          phoneFrame={{
            nome: 'Clínica Aurora',
            cor: null,
            photo: [],
            tabs: <div data-testid="shell-tabs" />,
          }}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeAll(() => {
  i18n.addResourceBundle('pt', 'analyticsYoutube', pt, true, true);
  i18n.addResourceBundle('en', 'analyticsYoutube', en, true, true);
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getYouTubeOverview).mockResolvedValue(overview());
  vi.mocked(getYouTubeDaily).mockResolvedValue([]);
  vi.mocked(getYouTubeTraffic).mockResolvedValue([{ sourceType: 'SHORTS', views: 100 }]);
  vi.mocked(getYouTubeDemographics).mockResolvedValue([]);
  vi.mocked(getYouTubeVideos).mockResolvedValue([
    video('a'),
    video('b', { isShort: false, title: 'Longo' }),
  ]);
  vi.mocked(getYouTubeTopShorts).mockResolvedValue([video('a')]);
});

describe('YouTubeAnalyticsTab (phone)', () => {
  it('renders the phone frame with the KPIs', async () => {
    const { container } = renderTab();
    await screen.findByText('Inscritos', { selector: '.phone-stat-tile__label' });
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent('Clínica Aurora');
    expect(screen.getByRole('link', { name: 'Clínica Sorriso Pleno' })).toHaveAttribute(
      'href',
      'https://www.youtube.com/@sorrisopleno',
    );
    expect(screen.getByTestId('shell-tabs')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sincronizar' })).toBeInTheDocument();
    expect(container.querySelectorAll('.phone-stat-tile')).toHaveLength(8);
    expect(container.querySelector('.kpi-grid')).toBeNull();
    expect(container.querySelector('.data-table')).toBeNull();
    expect(container.querySelector('.page-tabs')).toBeNull();
    expect(screen.getByText('12,4 mil')).toBeInTheDocument();
    expect(screen.getByText('1.840 h')).toBeInTheDocument();
    // Videos as a list linking to YouTube.
    const list = await screen.findByRole('list', { name: 'Vídeos' });
    expect(within(list).getByRole('link', { name: /Vídeo a/ })).toHaveAttribute(
      'href',
      'https://www.youtube.com/shorts/a',
    );
    expect(within(list).getByRole('link', { name: /Longo/ })).toHaveAttribute(
      'href',
      'https://www.youtube.com/watch?v=b',
    );
    expect(screen.getByText('Dados do YouTube, como o YouTube informa.')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\bIA\b/);
  });

  it('period and content type segments refetch', async () => {
    renderTab();
    await screen.findByText('Inscritos', { selector: '.phone-stat-tile__label' });
    const period = screen.getByRole('radiogroup', { name: 'Período' });
    expect(within(period).getByRole('radio', { name: '28d' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    fireEvent.click(within(period).getByRole('radio', { name: '7d' }));
    await waitFor(() =>
      expect(getYouTubeOverview).toHaveBeenLastCalledWith(12, { days: 7 }, 'all'),
    );
    // Personalizado: the sheet's day count becomes a start/end window ending at dataThrough.
    fireEvent.click(within(period).getByRole('radio', { name: 'Personalizado' }));
    fireEvent.change(await screen.findByLabelText('Período personalizado em dias'), {
      target: { value: '45' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));
    await waitFor(() =>
      expect(getYouTubeOverview).toHaveBeenLastCalledWith(
        12,
        { start: '2026-09-11', end: '2026-10-25' },
        'all',
      ),
    );
    const type = screen.getByRole('radiogroup', { name: 'Tipo de conteúdo' });
    fireEvent.click(within(type).getByRole('radio', { name: 'Vídeos longos' }));
    await waitFor(() =>
      expect(getYouTubeOverview).toHaveBeenLastCalledWith(
        12,
        { start: '2026-09-11', end: '2026-10-25' },
        'long',
      ),
    );
  });

  it('Sincronizar in the nav bar syncs', async () => {
    vi.mocked(syncGoogleProduct).mockResolvedValue({ ok: true, status: 'synced' });
    renderTab();
    await screen.findByText('Inscritos', { selector: '.phone-stat-tile__label' });
    fireEvent.click(screen.getByRole('button', { name: 'Sincronizar' }));
    await waitFor(() => expect(syncGoogleProduct).toHaveBeenCalledWith('youtube', 12));
    await waitFor(() => expect(getYouTubeOverview).toHaveBeenCalledTimes(2));
  });

  it('not connected keeps the frame and links to Redes sociais', async () => {
    vi.mocked(getYouTubeOverview).mockRejectedValue(new YouTubeNotConnectedError());
    renderTab();
    expect(await screen.findByText('YouTube não conectado')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Clínica Aurora');
    expect(screen.getByRole('link', { name: 'Ir para Redes sociais' })).toHaveAttribute(
      'href',
      '/clientes/12/redes-sociais',
    );
  });

  it('before the first sync shows Primeira sincronização em andamento', async () => {
    vi.mocked(getYouTubeOverview).mockResolvedValue(
      overview({ dataThrough: null, contentTypeThrough: null, trafficThrough: null }),
    );
    renderTab();
    expect(await screen.findByText('Primeira sincronização em andamento')).toBeInTheDocument();
    expect(document.querySelectorAll('.phone-stat-tile')).toHaveLength(0);
  });
});
