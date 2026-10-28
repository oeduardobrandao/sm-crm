import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerTikTokI18n } from '../../../analytics-tiktok/__tests__/fixtures';
import type {
  KpiEntry,
  TikTokKpiId,
  TikTokOverview,
  TikTokVideoAnalytics,
} from '../../../../services/tiktokAnalytics';

const limits = vi.hoisted(() => ({
  value: { features: { feature_tiktok: true } as Record<string, boolean> | null },
}));
vi.mock('@/hooks/useWorkspaceLimits', () => ({ useWorkspaceLimits: () => limits.value }));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));
vi.mock('chart.js', () => ({
  Chart: class {
    static register = vi.fn();
    destroy = vi.fn();
  },
  registerables: [],
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Keep the real error classes: the tab tells "not connected" apart with instanceof.
vi.mock('../../../../services/tiktokAnalytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../../services/tiktokAnalytics')>()),
  getTikTokOverview: vi.fn(),
  getTikTokFollowerHistory: vi.fn(),
  getTikTokPostsAnalytics: vi.fn(),
  getTikTokBestTimes: vi.fn(),
  getTikTokAIAnalysis: vi.fn(),
}));
vi.mock('../../../../services/tiktok', () => ({ syncTikTokData: vi.fn() }));

import {
  getTikTokAIAnalysis,
  getTikTokBestTimes,
  getTikTokFollowerHistory,
  getTikTokOverview,
  getTikTokPostsAnalytics,
  TikTokNotConnectedError,
  TikTokRateLimitedError,
} from '../../../../services/tiktokAnalytics';
import { syncTikTokData } from '../../../../services/tiktok';
import { TikTokAnalyticsTab } from '../TikTokAnalyticsTab';

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

const entry = (value: number | null, prev: number | null, unit: 'count' | 'pct' = 'count') =>
  ({ value, prev, unit }) as KpiEntry;

function overview(
  kpis: Partial<Record<TikTokKpiId, KpiEntry>> = {},
  status: TikTokOverview['account']['authorization_status'] = 'active',
): TikTokOverview {
  return {
    account: {
      username: 'clinica.tt',
      display_name: 'Clínica TT',
      avatar_url: null,
      authorization_status: status,
      last_synced_at: ago(0.1),
      follower_count: 12345,
    },
    window: {
      start: '2026-09-29',
      end: '2026-10-28',
      prevStart: '2026-08-30',
      prevEnd: '2026-09-28',
    },
    kpis: {
      followers_total: entry(12345, 12000),
      followers_gained: entry(345, 300),
      views: entry(1234567, null),
      engagement_rate: entry(6.8, 5.1, 'pct'),
      likes: entry(9876, null),
      comments: entry(321, null),
      shares: entry(45, null),
      posts_count: entry(8, 6),
      likes_total: entry(54321, null),
      ...kpis,
    },
  };
}

function vid(id: string, views: number, extra: Partial<TikTokVideoAnalytics> = {}) {
  return {
    tiktok_video_id: id,
    title: `Vídeo ${id}`,
    video_description: null,
    duration: 75,
    share_url: `https://www.tiktok.com/@clinica.tt/video/${id}`,
    cover_image_url: null,
    posted_at: ago(5),
    views,
    likes: 10,
    comments: 2,
    shares: 1,
    engagement_rate: 4.2,
    ...extra,
  } as TikTokVideoAnalytics;
}

let client: QueryClient;
function renderTab() {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TikTokAnalyticsTab clientId={12} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const kpi = (label: string) => screen.getByText(label).closest('.kpi-card') as HTMLElement;

beforeAll(registerTikTokI18n);

beforeEach(() => {
  vi.clearAllMocks();
  limits.value = { features: { feature_tiktok: true } };
  vi.mocked(getTikTokOverview).mockResolvedValue(overview());
  vi.mocked(getTikTokFollowerHistory).mockResolvedValue([]);
  vi.mocked(getTikTokPostsAnalytics).mockResolvedValue([vid('a', 5000), vid('b', 300)]);
  vi.mocked(getTikTokBestTimes).mockResolvedValue({
    heatmap: [],
    counts: [],
    topSlots: [],
    totalPosts: 0,
    labels_days: [],
    labels_hours: [],
  });
});

describe('TikTokAnalyticsTab', () => {
  it('renders KPI values pt-BR formatted', async () => {
    renderTab();
    await screen.findByText('Seguidores');
    expect(within(kpi('Seguidores')).getByText('12.345')).toBeInTheDocument();
    expect(within(kpi('Visualizações')).getByText('1.234.567')).toBeInTheDocument();
    expect(within(kpi('Engajamento')).getByText('6,8%')).toBeInTheDocument();
    expect(within(kpi('Engajamento')).getByText('Anterior: 5,1%')).toBeInTheDocument();
    expect(within(kpi('Curtidas totais do perfil')).getByText('54.321')).toBeInTheDocument();
    // likes_total is the last card.
    // StatCardGrid pads the last row with empty filler cells.
    const cards = Array.from(document.querySelectorAll('.kpi-card')).filter((c) => c.textContent);
    expect(cards).toHaveLength(9);
    expect(cards[cards.length - 1]).toHaveTextContent('Curtidas totais do perfil');
    expect(screen.getByRole('link', { name: '@clinica.tt' })).toHaveAttribute(
      'href',
      'https://www.tiktok.com/@clinica.tt',
    );
    expect(screen.getByText(/^Sincronizado há/)).toBeInTheDocument();
  });

  it("null follower KPI shows 'sem dados' and no delta", async () => {
    vi.mocked(getTikTokOverview).mockResolvedValue(
      overview({ followers_gained: entry(null, null) }),
    );
    renderTab();
    await screen.findByText('Novos seguidores');
    const card = kpi('Novos seguidores');
    expect(within(card).getByText('sem dados')).toBeInTheDocument();
    expect(within(card).queryByText('vs período anterior')).toBeNull();
    expect(within(card).queryByText(/^Anterior:/)).toBeNull();
  });

  it('a compared KPI without a previous window reads sem comparação', async () => {
    vi.mocked(getTikTokOverview).mockResolvedValue(overview({ posts_count: entry(3, null) }));
    renderTab();
    await screen.findByText('Vídeos publicados');
    const card = kpi('Vídeos publicados');
    expect(within(card).getByText('sem comparação')).toBeInTheDocument();
    expect(within(card).queryByText('vs período anterior')).toBeNull();
  });

  it('views card has no comparison and has the tooltip', async () => {
    // Even if the server sent a prev for views, the card must not compare it.
    vi.mocked(getTikTokOverview).mockResolvedValue(overview({ views: entry(1000, 900) }));
    renderTab();
    await screen.findByText('Visualizações');
    const card = kpi('Visualizações');
    expect(within(card).queryByText('vs período anterior')).toBeNull();
    expect(within(card).queryByText(/^Anterior:/)).toBeNull();
    expect(
      within(card).getByRole('button', {
        name: 'Total atual dos vídeos publicados no período, não as visualizações recebidas no período.',
      }),
    ).toBeInTheDocument();
    // The compared cards do show the comparison.
    expect(within(kpi('Seguidores')).getByText('vs período anterior')).toBeInTheDocument();
  });

  it('changing to 90 dias refetches with days=90', async () => {
    renderTab();
    await screen.findByText('Seguidores');
    expect(getTikTokOverview).toHaveBeenLastCalledWith(12, { days: 30 });
    fireEvent.click(screen.getByRole('tab', { name: '90 dias' }));
    await waitFor(() => expect(getTikTokOverview).toHaveBeenLastCalledWith(12, { days: 90 }));
    await waitFor(() =>
      expect(getTikTokFollowerHistory).toHaveBeenLastCalledWith(12, { days: 90 }),
    );
    await waitFor(() =>
      expect(getTikTokPostsAnalytics).toHaveBeenLastCalledWith(12, { days: 90 }, 'posted_at'),
    );
  });

  it('Último mês sends a start/end range', async () => {
    renderTab();
    await screen.findByText('Seguidores');
    fireEvent.click(screen.getByRole('tab', { name: 'Último mês' }));
    await waitFor(() =>
      expect(getTikTokOverview).toHaveBeenLastCalledWith(
        12,
        expect.objectContaining({ start: expect.stringMatching(/-01$/) }),
      ),
    );
  });

  it('not connected shows the connect card', async () => {
    vi.mocked(getTikTokOverview).mockRejectedValue(new TikTokNotConnectedError());
    renderTab();
    expect(await screen.findByText('TikTok não conectado')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir para Redes sociais' })).toHaveAttribute(
      'href',
      '/clientes/12/redes-sociais',
    );
    expect(getTikTokPostsAnalytics).not.toHaveBeenCalled();
    expect(screen.queryByText('Seguidores')).toBeNull();
  });

  it('expired authorization shows the banner above the data', async () => {
    vi.mocked(getTikTokOverview).mockResolvedValue(overview({}, 'expired'));
    renderTab();
    expect(await screen.findByText('Conexão expirada')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir para Redes sociais' })).toHaveAttribute(
      'href',
      '/clientes/12/redes-sociais',
    );
    expect(screen.getByText('Seguidores')).toBeInTheDocument();
  });

  it('share link uses sanitized url', async () => {
    vi.mocked(getTikTokPostsAnalytics).mockResolvedValue([
      vid('safe', 5000),
      vid('evil', 100, { share_url: 'javascript:alert(1)' }),
    ]);
    renderTab();
    const table = await screen.findByRole('table');
    expect(within(table).getByRole('link', { name: /Vídeo safe/ })).toHaveAttribute(
      'href',
      'https://www.tiktok.com/@clinica.tt/video/safe',
    );
    expect(within(table).getByRole('link', { name: /Vídeo evil/ })).toHaveAttribute('href', '#');
    const evilRow = within(table).getByText('Vídeo evil').closest('tr') as HTMLElement;
    expect(within(evilRow).getByText('1:15')).toBeInTheDocument();
    expect(within(evilRow).getByText('4,2%')).toBeInTheDocument();
  });

  it('table sorts client-side and asks the server for that column', async () => {
    vi.mocked(getTikTokPostsAnalytics).mockResolvedValue([
      vid('low', 10, { posted_at: ago(1) }),
      vid('high', 9000, { posted_at: ago(3) }),
    ]);
    renderTab();
    const table = await screen.findByRole('table');
    const titles = () =>
      within(table)
        .getAllByRole('row')
        .slice(1)
        .map((r) => within(r).getByText(/^Vídeo /).textContent);
    expect(titles()).toEqual(['Vídeo low', 'Vídeo high']);
    fireEvent.click(within(table).getByRole('button', { name: 'Visualizações' }));
    await waitFor(() =>
      expect(getTikTokPostsAnalytics).toHaveBeenLastCalledWith(12, { days: 30 }, 'views'),
    );
    await waitFor(() => expect(titles()).toEqual(['Vídeo high', 'Vídeo low']));
    fireEvent.click(within(table).getByRole('button', { name: /Visualizações/ }));
    await waitFor(() => expect(titles()).toEqual(['Vídeo low', 'Vídeo high']));
  });

  it('Sincronizar calls syncTikTokData and invalidates tt-* queries', async () => {
    vi.mocked(syncTikTokData).mockResolvedValue({} as never);
    renderTab();
    await screen.findByText('Seguidores');
    await waitFor(() => expect(getTikTokPostsAnalytics).toHaveBeenCalledTimes(1));
    const spy = vi.spyOn(client, 'invalidateQueries');
    fireEvent.click(screen.getByRole('button', { name: 'Sincronizar' }));
    await waitFor(() => expect(syncTikTokData).toHaveBeenCalledWith(12));
    await waitFor(() => expect(getTikTokOverview).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(getTikTokPostsAnalytics).toHaveBeenCalledTimes(2));
    expect(getTikTokFollowerHistory).toHaveBeenCalledTimes(2);
    expect(getTikTokBestTimes).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith({ queryKey: ['ttSummary', 12] });
  });

  it('best times locked by plan shows the locked state without fetching', async () => {
    limits.value = { features: { feature_tiktok: true, feature_best_times: false } };
    renderTab();
    expect(
      await screen.findByText('Melhores horários não está disponível no seu plano.'),
    ).toBeInTheDocument();
    expect(getTikTokBestTimes).not.toHaveBeenCalled();
  });

  it('best times feature_disabled from the server shows the locked state', async () => {
    vi.mocked(getTikTokBestTimes).mockRejectedValue(new Error('feature_disabled'));
    renderTab();
    expect(
      await screen.findByText('Melhores horários não está disponível no seu plano.'),
    ).toBeInTheDocument();
  });

  it('AI section clamps days to 365 and renders a server error analysis readably', async () => {
    vi.mocked(getTikTokAIAnalysis).mockResolvedValue({
      analysis: { error: true, raw: 'ai_unavailable' },
      generatedAt: '2026-10-28T12:00:00Z',
    });
    renderTab();
    await screen.findByText('Seguidores');
    const input = screen.getByRole('spinbutton', { name: 'Período personalizado em dias' });
    fireEvent.change(input, { target: { value: '500' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(getTikTokOverview).toHaveBeenLastCalledWith(12, { days: 500 }));
    fireEvent.click(screen.getByRole('button', { name: /Gerar Análise IA/ }));
    expect(
      await screen.findByText('A análise com IA está indisponível no momento.'),
    ).toBeInTheDocument();
    expect(getTikTokAIAnalysis).toHaveBeenCalledWith(12, 365);
  });

  it('AI "Nenhum vídeo no período" and rate limit read as copy', async () => {
    vi.mocked(getTikTokAIAnalysis).mockResolvedValueOnce({
      analysis: { error: true, raw: 'Nenhum vídeo no período' },
      generatedAt: '2026-10-28T12:00:00Z',
    });
    renderTab();
    await screen.findByText('Seguidores');
    fireEvent.click(screen.getByRole('button', { name: /Gerar Análise IA/ }));
    expect(await screen.findByText('Nenhum vídeo publicado neste período.')).toBeInTheDocument();
    vi.mocked(getTikTokAIAnalysis).mockRejectedValueOnce(new TikTokRateLimitedError());
    fireEvent.click(screen.getByRole('button', { name: /Gerar Análise IA/ }));
    expect(
      await screen.findByText(
        'Você atingiu o limite de análises por hora. Tente novamente mais tarde.',
      ),
    ).toBeInTheDocument();
  });

  it('AI locked by plan shows the locked state', async () => {
    limits.value = { features: { feature_tiktok: true, feature_instagram_ai: false } };
    renderTab();
    expect(
      await screen.findByText('A análise com IA não está disponível no seu plano.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Gerar Análise IA/ })).toBeNull();
  });
});
