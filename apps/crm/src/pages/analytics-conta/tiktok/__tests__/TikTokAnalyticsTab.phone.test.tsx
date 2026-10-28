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

// Below 768px: the tab renders its phone variant.
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => false }));
const limits = vi.hoisted(() => ({
  value: { features: { feature_tiktok: true } as Record<string, boolean> | null },
}));
vi.mock('@/hooks/useWorkspaceLimits', () => ({ useWorkspaceLimits: () => limits.value }));
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

function vid(id: string, views: number | null, extra: Partial<TikTokVideoAnalytics> = {}) {
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

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <TikTokAnalyticsTab
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

const videoList = () => screen.getByRole('list', { name: 'Desempenho dos vídeos' });

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

describe('TikTokAnalyticsTab (phone)', () => {
  it('renders phone layout below 768px', async () => {
    const { container } = renderTab();
    await screen.findByRole('list', { name: 'Desempenho dos vídeos' });
    // One heading for the route: the client, with the TikTok handle under it.
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent('Clínica Aurora');
    expect(screen.getByRole('link', { name: '@clinica.tt' })).toHaveAttribute(
      'href',
      'https://www.tiktok.com/@clinica.tt',
    );
    expect(screen.getByTestId('shell-tabs')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sincronizar' })).toBeInTheDocument();
    // KPI tiles two-up, no desktop grid, table or period tabs.
    expect(container.querySelector('.phone-stat-grid')).not.toBeNull();
    expect(container.querySelector('.phone-stat-grid--scroll')).toBeNull();
    expect(container.querySelectorAll('.phone-stat-tile')).toHaveLength(9);
    expect(container.querySelector('.kpi-grid')).toBeNull();
    expect(container.querySelector('.data-table')).toBeNull();
    expect(container.querySelector('.page-tabs')).toBeNull();
    // Summed counts never compare with the previous window.
    const views = screen.getByText('Visualizações', { selector: '.phone-stat-tile__label' });
    expect(views.closest('.phone-stat-tile')?.querySelector('.phone-stat-tile__delta')).toBeNull();
    const followers = screen.getByText('Seguidores', { selector: '.phone-stat-tile__label' });
    expect(
      followers.closest('.phone-stat-tile')?.querySelector('.phone-stat-tile__delta'),
    ).not.toBeNull();
    // The best-videos strip.
    expect(screen.getByRole('heading', { level: 2, name: 'Melhores vídeos' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Análise com IA' })).toBeInTheDocument();
  });

  it('period segmented switches range', async () => {
    renderTab();
    await screen.findByRole('list', { name: 'Desempenho dos vídeos' });
    const period = screen.getByRole('radiogroup', { name: 'Período' });
    expect(within(period).getByRole('radio', { name: '30d' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    fireEvent.click(within(period).getByRole('radio', { name: '90d' }));
    await waitFor(() => expect(getTikTokOverview).toHaveBeenLastCalledWith(12, { days: 90 }));
    await waitFor(() =>
      expect(getTikTokPostsAnalytics).toHaveBeenLastCalledWith(12, { days: 90 }, 'posted_at'),
    );
    expect(getTikTokFollowerHistory).toHaveBeenLastCalledWith(12, { days: 90 });

    fireEvent.click(within(period).getByRole('radio', { name: 'Último mês' }));
    await waitFor(() =>
      expect(getTikTokOverview).toHaveBeenLastCalledWith(12, {
        start: expect.stringMatching(/^\d{4}-\d{2}-01$/),
        end: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
    );

    // Personalizado opens the days sheet; Aplicar commits.
    fireEvent.click(within(period).getByRole('radio', { name: 'Personalizado' }));
    const input = await screen.findByLabelText('Período personalizado em dias');
    fireEvent.change(input, { target: { value: '45' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));
    await waitFor(() => expect(getTikTokOverview).toHaveBeenLastCalledWith(12, { days: 45 }));
  });

  it('video row links to sanitized share url', async () => {
    vi.mocked(getTikTokPostsAnalytics).mockResolvedValue([
      vid('a', 5000),
      vid('evil', 300, { share_url: 'javascript:alert(1)' }),
      vid('nolink', null, { share_url: null }),
    ]);
    renderTab();
    await screen.findByRole('list', { name: 'Desempenho dos vídeos' });
    const list = videoList();
    const good = within(list).getByRole('link', { name: /Vídeo a/ });
    expect(good).toHaveAttribute('href', 'https://www.tiktok.com/@clinica.tt/video/a');
    expect(good).toHaveAttribute('target', '_blank');
    expect(good).toHaveAttribute('rel', 'noopener noreferrer');
    expect(within(list).getByRole('link', { name: /Vídeo evil/ })).toHaveAttribute('href', '#');
    // No share link: the row shows its numbers without being a link; null views read "—".
    expect(within(list).queryByRole('link', { name: /Vídeo nolink/ })).toBeNull();
    const row = within(list).getByText('Vídeo nolink').closest('li') as HTMLElement;
    expect(row).toHaveTextContent('—');
  });

  it('sorts the video list from the sort sheet', async () => {
    vi.mocked(getTikTokPostsAnalytics).mockResolvedValue([
      vid('a', 300, { likes: 1 }),
      vid('b', 100, { likes: 50 }),
    ]);
    renderTab();
    await screen.findByRole('list', { name: 'Desempenho dos vídeos' });
    fireEvent.click(screen.getByRole('button', { name: /^Ordenar por: Data/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Curtidas' }));
    await waitFor(() =>
      expect(getTikTokPostsAnalytics).toHaveBeenLastCalledWith(12, { days: 30 }, 'likes'),
    );
    await waitFor(() => {
      const labels = within(videoList())
        .getAllByText(/^Vídeo [ab]$/)
        .map((n) => n.textContent);
      expect(labels).toEqual(['Vídeo b', 'Vídeo a']);
    });
  });

  it('not connected: one heading and a link to the Redes sociais tab', async () => {
    vi.mocked(getTikTokOverview).mockRejectedValue(new TikTokNotConnectedError());
    renderTab();
    expect(
      await screen.findByRole('heading', { level: 2, name: 'TikTok não conectado' }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByTestId('shell-tabs')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir para Redes sociais' })).toHaveAttribute(
      'href',
      '/clientes/12/redes-sociais',
    );
  });

  it('feature_disabled shows the locked state with the plans link', async () => {
    vi.mocked(getTikTokOverview).mockRejectedValue(new Error('feature_disabled'));
    renderTab();
    expect(
      await screen.findByText('O Analytics do TikTok não está disponível no seu plano.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver planos' })).toHaveAttribute(
      'href',
      '/configuracao/cobranca',
    );
  });

  it('a failed overview shows the error with a retry, and the period stays changeable', async () => {
    vi.mocked(getTikTokOverview).mockRejectedValueOnce(new Error('boom'));
    renderTab();
    expect(
      await screen.findByText('Não foi possível carregar os dados do TikTok.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Período' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    await screen.findByRole('list', { name: 'Desempenho dos vídeos' });
  });

  it('expired authorization shows the reconnect callout above the data', async () => {
    vi.mocked(getTikTokOverview).mockResolvedValue(overview({}, 'expired'));
    renderTab();
    expect(await screen.findByText('Conexão expirada')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir para Redes sociais' })).toHaveAttribute(
      'href',
      '/clientes/12/redes-sociais',
    );
    expect(await screen.findByRole('list', { name: 'Desempenho dos vídeos' })).toBeInTheDocument();
  });

  it('posts that fail to load show an error with a retry, not the empty copy', async () => {
    vi.mocked(getTikTokPostsAnalytics).mockRejectedValueOnce(new Error('boom'));
    renderTab();
    const retry = await screen.findByRole('button', { name: 'Tentar novamente' });
    expect(screen.queryByText('Nenhum vídeo publicado neste período.')).toBeNull();
    fireEvent.click(retry);
    await screen.findByRole('list', { name: 'Desempenho dos vídeos' });
  });

  it('sync button syncs and refetches', async () => {
    vi.mocked(syncTikTokData).mockResolvedValue(undefined as never);
    renderTab();
    await screen.findByRole('list', { name: 'Desempenho dos vídeos' });
    const calls = vi.mocked(getTikTokOverview).mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Sincronizar' }));
    await waitFor(() => expect(syncTikTokData).toHaveBeenCalledWith(12));
    await waitFor(() =>
      expect(vi.mocked(getTikTokOverview).mock.calls.length).toBeGreaterThan(calls),
    );
  });

  it('AI analysis caps a long custom window at 365 days and uses the TikTok labels', async () => {
    vi.mocked(getTikTokAIAnalysis).mockResolvedValue({
      analysis: {
        performanceMap: { topPerformer: 'O vídeo A', worstPerformer: 'O vídeo B' },
        captionDiagnostic: 'Títulos curtos',
      },
      generatedAt: '2026-10-28T12:00:00Z',
    } as never);
    renderTab();
    await screen.findByRole('list', { name: 'Desempenho dos vídeos' });
    const period = screen.getByRole('radiogroup', { name: 'Período' });
    fireEvent.click(within(period).getByRole('radio', { name: 'Personalizado' }));
    fireEvent.change(await screen.findByLabelText('Período personalizado em dias'), {
      target: { value: '700' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));
    await waitFor(() => expect(getTikTokOverview).toHaveBeenLastCalledWith(12, { days: 700 }));
    await screen.findByRole('list', { name: 'Desempenho dos vídeos' });

    fireEvent.click(screen.getByRole('button', { name: 'Gerar Análise IA' }));
    await waitFor(() => expect(getTikTokAIAnalysis).toHaveBeenCalledWith(12, 365));
    expect(await screen.findByText('Melhor vídeo')).toBeInTheDocument();
    expect(screen.getByText('Pior vídeo')).toBeInTheDocument();
    expect(screen.getByText('Diagnóstico de títulos')).toBeInTheDocument();
  });

  it('AI and best times locked by plan show the plans link instead', async () => {
    limits.value = {
      features: { feature_tiktok: true, feature_instagram_ai: false, feature_best_times: false },
    };
    renderTab();
    await screen.findByRole('list', { name: 'Desempenho dos vídeos' });
    expect(
      screen.getByText('A análise com IA não está disponível no seu plano.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Melhores horários não está disponível no seu plano.'),
    ).toBeInTheDocument();
    expect(getTikTokBestTimes).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Gerar Análise IA' })).toBeNull();
  });

  it('follower history that fails to load shows a retry', async () => {
    vi.mocked(getTikTokFollowerHistory).mockRejectedValueOnce(new Error('boom'));
    renderTab();
    const card = await screen.findByRole('region', { name: 'Crescimento de seguidores' });
    fireEvent.click(await within(card).findByRole('button', { name: 'Tentar novamente' }));
    expect(
      await screen.findByText('Ainda não há histórico de seguidores para este período.'),
    ).toBeInTheDocument();
    expect(getTikTokFollowerHistory).toHaveBeenCalledTimes(2);
  });

  it('best times that fail to load show a retry', async () => {
    vi.mocked(getTikTokBestTimes).mockRejectedValueOnce(new Error('boom'));
    renderTab();
    const section = await screen.findByRole('region', { name: 'Melhor horário para postar' });
    fireEvent.click(await within(section).findByRole('button', { name: 'Tentar novamente' }));
    expect(
      await within(section).findByText('Publique mais vídeos para ver os melhores horários.'),
    ).toBeInTheDocument();
    expect(getTikTokBestTimes).toHaveBeenCalledTimes(2);
  });

  it('best times render the phone heatmap and slots in TikTok wording', async () => {
    const grid = () => Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
    const heatmap = grid();
    const counts = grid();
    heatmap[0][18] = 6.5;
    counts[0][18] = 3;
    heatmap[2][9] = 2;
    counts[2][9] = 3;
    vi.mocked(getTikTokBestTimes).mockResolvedValue({
      heatmap,
      counts,
      topSlots: [{ day: 0, hour: 18, value: 6.5, postCount: 3 }],
      totalPosts: 6,
      labels_days: ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'],
      labels_hours: Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}h`),
    });
    renderTab();
    const section = await screen.findByRole('region', { name: 'Melhor horário para postar' });
    const heat = await within(section).findByRole('group', { name: 'Mapa de calor de horários' });
    // The top slot is read out first, per view and in videos.
    expect(
      within(section).getByText('Segunda 18h a 20h: 6,5% eng. por visualização (3 vídeos)'),
    ).toBeInTheDocument();
    expect(
      within(heat).getByRole('button', {
        name: 'Qua 9h: 2,0% de engajamento por visualização, 3 vídeos',
      }),
    ).toBeInTheDocument();
    fireEvent.click(within(heat).getByRole('button', { name: 'Ter 0h: sem vídeos' }));
    expect(within(section).getByText('Terça 0h: sem vídeos')).toBeInTheDocument();
    expect(within(section).getByText('Segunda às 18h')).toBeInTheDocument();
    expect(within(section).getByText('6,5% eng. por visualização · 3 vídeos')).toBeInTheDocument();
    expect(within(section).queryByText(/posts?\b/)).toBeNull();
  });

  it('Ver todos opens the videos sheet from a strip', async () => {
    vi.mocked(getTikTokPostsAnalytics).mockResolvedValue(
      ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => vid(id, 1000 - i * 100)),
    );
    renderTab();
    const heading = await screen.findByRole('heading', { level: 2, name: 'Melhores vídeos' });
    const strip = heading.closest('section') as HTMLElement;
    fireEvent.click(within(strip).getByRole('button', { name: 'Ver todos' }));
    const sheet = await screen.findByRole('dialog', { name: 'Todos os vídeos' });
    expect(within(sheet).getAllByText(/6 de 6 vídeos/).length).toBeGreaterThan(0);
    expect(within(sheet).getByRole('link', { name: /Vídeo f/ })).toHaveAttribute(
      'href',
      'https://www.tiktok.com/@clinica.tt/video/f',
    );
  });
});
