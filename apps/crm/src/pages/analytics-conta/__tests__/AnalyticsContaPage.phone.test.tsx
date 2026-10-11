import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom's matchMedia matches nothing, so the page renders its phone branch (below 768px).

vi.mock('chart.js', () => {
  class ChartMock {
    static register = vi.fn();
    destroy = vi.fn();
  }
  return { Chart: ChartMock, registerables: [] };
});

vi.mock('@/components/layout/PhoneShellHeader', () => ({
  PhoneShellActions: () => <div data-testid="shell-actions" />,
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(() => 'toast-1'),
  }),
}));

vi.mock('../../../store', () => ({ getClientes: vi.fn() }));

vi.mock('../../../services/instagram', () => ({
  getInstagramSummary: vi.fn(),
  syncInstagramData: vi.fn(),
}));

vi.mock('../../../services/analytics', () => ({
  getAnalyticsOverview: vi.fn(),
  getAccountMetrics: vi.fn(),
  makeDelta: (current: number, previous: number) => ({
    current,
    previous,
    delta: current - previous,
    deltaPercent: previous !== 0 ? ((current - previous) / Math.abs(previous)) * 100 : 0,
    direction: current > previous ? 'up' : current < previous ? 'down' : 'stable',
  }),
  getPostsAnalytics: vi.fn(),
  getFollowerHistory: vi.fn(),
  getAudienceDemographics: vi.fn(),
  getBestPostingTimes: vi.fn(),
  getTags: vi.fn(),
  createTag: vi.fn(),
  deleteTag: vi.fn(),
  assignTagToPost: vi.fn(),
  removeTagFromPost: vi.fn(),
  getClientReports: vi.fn(),
  getAccountAIAnalysis: vi.fn(),
  upsertManualFollowerCount: vi.fn(),
  sendReportEmail: vi.fn(),
  getReportDownloadUrl: vi.fn(),
  getClientRateBaseline: vi.fn(),
  getStoriesAnalytics: vi.fn(),
}));

vi.mock('../../../services/reportDocs', () => ({
  listReportDocs: vi.fn(),
  deleteReportDoc: vi.fn(),
}));

vi.mock('../components/NewReportDialog', () => ({
  NewReportDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="Novo relatório" /> : null,
}));

import AnalyticsContaPage from '../AnalyticsContaPage';
import { getClientes } from '../../../store';
import { getInstagramSummary } from '../../../services/instagram';
import {
  assignTagToPost,
  createTag,
  getAccountMetrics,
  getAnalyticsOverview,
  getAudienceDemographics,
  getBestPostingTimes,
  getClientRateBaseline,
  getClientReports,
  getFollowerHistory,
  getPostsAnalytics,
  getStoriesAnalytics,
  getTags,
  removeTagFromPost,
  type PostAnalytics,
} from '../../../services/analytics';
import { deleteReportDoc, listReportDocs } from '../../../services/reportDocs';
import { getReportDownloadUrl } from '../../../services/analytics';
import { toast } from 'sonner';

const kpi = (current: number, previous: number) => ({
  current,
  previous,
  delta: current - previous,
  deltaPercent: 10,
  direction: 'up' as const,
});

function post(overrides: Partial<PostAnalytics>): PostAnalytics {
  return {
    id: 1,
    instagram_post_id: 'ig1',
    caption: 'Post sobre botox',
    media_type: 'IMAGE',
    permalink: 'https://instagram.com/p/1',
    posted_at: '2026-09-20T12:00:00Z',
    likes: 10,
    comments: 2,
    reach: 500,
    impressions: 800,
    saved: 4,
    shares: 1,
    views: 900,
    profile_visits: 3,
    follows: 2,
    bio_link_clicks: null,
    follows_per_mil_reach: 4,
    rates: { share_rate: null, like_rate: null, save_rate: null, comment_rate: null },
    unavailable_metrics: [],
    ig_score: 70,
    thumbnail_url: null,
    engagement_rate: 3.2,
    saves_rate: 0.8,
    tags: [],
    ...overrides,
  } as PostAnalytics;
}

const TAG = { id: 9, tag_name: 'Educativo', color: '#3ecf8e' };

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/analytics/42']}>
        <Routes>
          <Route path="/analytics/:id" element={<AnalyticsContaPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function ready() {
  return screen.findByRole('heading', { level: 1, name: 'Clínica Aurora' });
}

describe('AnalyticsContaPage (phone)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getClientes).mockResolvedValue([{ id: 42, nome: 'Clínica Aurora' } as never]);
    vi.mocked(getInstagramSummary).mockResolvedValue({
      account: { username: 'clinica.aurora', profile_picture_url: null },
    } as never);
    vi.mocked(getAnalyticsOverview).mockResolvedValue({
      data: {
        engagement: kpi(3.1, 2.8),
        savesRate: kpi(0.9, 0.7),
        postsPublished: kpi(6, 5),
      },
      fromCache: true,
      fetchedAt: '2026-10-01T15:00:00Z',
    } as never);
    vi.mocked(getAccountMetrics).mockResolvedValue({ current: null, previous: null } as never);
    vi.mocked(getClientRateBaseline).mockRejectedValue(new Error('sem baseline'));
    vi.mocked(getPostsAnalytics).mockResolvedValue({
      posts: [
        post({ id: 1, tags: [TAG] }),
        post({
          id: 2,
          caption: 'Reel de bastidores',
          media_type: 'VIDEO',
          profile_visits: null,
          follows: null,
        }),
      ],
    } as never);
    vi.mocked(getFollowerHistory).mockResolvedValue({
      history: [
        { date: '2026-09-01', follower_count: 1000, source: 'api' },
        { date: '2026-09-15', follower_count: 1040, source: 'manual' },
      ],
      postDates: [],
    } as never);
    vi.mocked(getTags).mockResolvedValue([TAG, { id: 10, tag_name: 'Dicas', color: '#f5a342' }]);
    vi.mocked(getClientReports).mockResolvedValue([
      {
        id: 5,
        report_month: '2026-08',
        status: 'failed',
        generation_error: 'Conta sem permissão de insights',
        include_ai: false,
        generated_at: null,
        storage_path: null,
      } as never,
    ]);
    vi.mocked(listReportDocs).mockResolvedValue([
      {
        id: 'doc-1',
        title: 'Relatório de setembro',
        period_start: '2026-09-01',
        status: 'ready',
        created_at: '2026-10-02T10:00:00Z',
      } as never,
    ]);
    vi.mocked(getAudienceDemographics).mockResolvedValue({
      data: {
        age_gender: [{ age_range: '25-34', male: 80, female: 120 }],
        cities: [{ name: 'São Paulo, SP', count: 150 }],
        countries: [],
        gender_split: { male: 40, female: 60 },
      },
      fromCache: false,
      fetchedAt: '',
    });
    vi.mocked(getBestPostingTimes).mockResolvedValue(null);
    vi.mocked(getStoriesAnalytics).mockResolvedValue(null);
  });

  it('renders the nav bar, identity and KPI strip instead of the desktop header', async () => {
    const { container } = renderPage();
    await ready();
    expect(container.querySelector('.header')).toBeNull();
    expect(screen.getByRole('link', { name: '@clinica.aurora' })).toHaveAttribute(
      'href',
      'https://instagram.com/clinica.aurora',
    );
    expect(screen.getByText(/Dados de/)).toBeInTheDocument();
    expect(container.querySelector('.phone-stat-grid--scroll')).not.toBeNull();
    // The nav bar's round button and the row in Relatórios gerados.
    expect(screen.getAllByRole('button', { name: 'Gerar relatório' })).toHaveLength(2);
    expect(screen.getByText('+40 no período')).toBeInTheDocument();
  });

  it('opens the report dialog from the nav bar', async () => {
    renderPage();
    await ready();
    fireEvent.click(screen.getAllByRole('button', { name: 'Gerar relatório' })[0]);
    expect(await screen.findByRole('dialog', { name: 'Novo relatório' })).toBeInTheDocument();
  });

  it('sorts the posts through an action sheet', async () => {
    renderPage();
    await ready();
    fireEvent.click(await screen.findByRole('button', { name: /Ordenar posts: Data/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Alcance' }));
    await waitFor(() =>
      expect(getPostsAnalytics).toHaveBeenLastCalledWith(
        42,
        30,
        'reach',
        'desc',
        undefined,
        undefined,
      ),
    );
  });

  it('shows a post in a sheet with visible missing-metric reasons and tag toggles', async () => {
    renderPage();
    await ready();
    const list = await screen.findByRole('list', { name: 'Performance de conteúdo' });
    fireEvent.click(within(list).getByRole('button', { name: /Reel de bastidores/ }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('Reel de bastidores')).toBeInTheDocument();
    expect(
      within(sheet).getByText(/Visitas ao perfil: O Instagram não fornece este dado para Reels/),
    ).toBeInTheDocument();
    expect(within(sheet).getByRole('link', { name: 'Ver no Instagram' })).toBeInTheDocument();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Educativo' }));
    await waitFor(() => expect(assignTagToPost).toHaveBeenCalledWith(2, 9));
  });

  it('removes a tag from a post by toggling it off', async () => {
    renderPage();
    await ready();
    const list = await screen.findByRole('list', { name: 'Performance de conteúdo' });
    fireEvent.click(within(list).getByRole('button', { name: /Post sobre botox/ }));
    const sheet = await screen.findByRole('dialog');
    const toggle = within(sheet).getByRole('button', { name: 'Educativo' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(toggle);
    await waitFor(() => expect(removeTagFromPost).toHaveBeenCalledWith(1, 9));
  });

  it('creates a tag in a sheet instead of prompt()', async () => {
    const promptSpy = vi.spyOn(window, 'prompt');
    vi.mocked(createTag).mockResolvedValue({ id: 11, tag_name: 'Bastidores', color: '#000' });
    renderPage();
    await ready();
    const list = await screen.findByRole('list', { name: 'Performance de conteúdo' });
    fireEvent.click(within(list).getByRole('button', { name: /Post sobre botox/ }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Nova tag' }));
    const input = await screen.findByPlaceholderText('Nome da tag');
    fireEvent.change(input, { target: { value: 'Bastidores' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar tag' }));
    await waitFor(() => expect(createTag).toHaveBeenCalledWith('Bastidores', expect.any(String)));
    expect(promptSpy).not.toHaveBeenCalled();
    promptSpy.mockRestore();
  });

  it('deletes a report through a confirm sheet instead of window.confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    renderPage();
    await ready();
    fireEvent.click(await screen.findByRole('button', { name: /Relatório de setembro/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Excluir' }));
    expect(await screen.findByText('Excluir este relatório?')).toBeInTheDocument();
    expect(screen.getByText('O PDF exportado também é removido.')).toBeInTheDocument();
    const buttons = await screen.findAllByRole('button', { name: 'Excluir' });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(deleteReportDoc).toHaveBeenCalledWith('doc-1'));
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('shows why a legacy report failed as text', async () => {
    renderPage();
    await ready();
    expect(await screen.findByText('Falha: Conta sem permissão de insights')).toBeInTheDocument();
  });

  it('downloads a legacy PDF through a toast tap (no window.open after the await)', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    vi.mocked(getClientReports).mockResolvedValue([
      {
        id: 6,
        report_month: '2026-07',
        status: 'ready',
        generation_error: null,
        include_ai: false,
        generated_at: '2026-08-01T10:00:00Z',
        storage_path: 'reports/6.pdf',
      } as never,
    ]);
    vi.mocked(getReportDownloadUrl).mockResolvedValue('https://files.example.com/6.pdf');
    renderPage();
    await ready();
    fireEvent.click(await screen.findByRole('button', { name: /Jul 2026/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Baixar PDF' }));
    await waitFor(() => expect(toast.loading).toHaveBeenCalledWith('Preparando PDF…'));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        'PDF pronto.',
        expect.objectContaining({ id: 'toast-1', action: expect.any(Object) }),
      ),
    );
    expect(openSpy).not.toHaveBeenCalled();
    const { action } = vi.mocked(toast.success).mock.calls.at(-1)![1] as {
      action: { onClick: () => void };
    };
    action.onClick();
    expect(openSpy).toHaveBeenCalledWith(
      'https://files.example.com/6.pdf',
      '_blank',
      'noopener,noreferrer',
    );
    openSpy.mockRestore();
  });

  it('applies a custom period from a sheet with an explicit Aplicar', async () => {
    renderPage();
    await ready();
    fireEvent.click(screen.getByRole('radio', { name: 'Personalizado' }));
    const input = await screen.findByLabelText('Período personalizado em dias');
    fireEvent.change(input, { target: { value: '45' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar' }));
    await waitFor(() => expect(getAnalyticsOverview).toHaveBeenLastCalledWith(42, 45, undefined));
    expect(await screen.findByText('Últimos 45 dias')).toBeInTheDocument();
  });

  it('shows the audience by age with exact counts in its section sheet', async () => {
    renderPage();
    await ready();
    fireEvent.click(await screen.findByRole('button', { name: /Demografia da audiência/ }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('Mulheres 120 · Homens 80')).toBeInTheDocument();
    expect(within(sheet).getByText('60%')).toBeInTheDocument();
  });
});
