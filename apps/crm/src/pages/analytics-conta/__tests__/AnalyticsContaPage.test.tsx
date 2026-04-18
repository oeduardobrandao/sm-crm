import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  paramsState,
  navigateMock,
  queryClientMock,
  queryState,
  toastSuccessMock,
  toastErrorMock,
  accountAIMock,
  chartCalls,
} = vi.hoisted(() => {
  const queryState: Record<string, { data?: unknown; isLoading?: boolean; error?: unknown }> = {};
  const chartCalls: Array<unknown[]> = [];

  class ChartMock {
    static register = vi.fn();
    destroy = vi.fn();
    constructor(...args: unknown[]) {
      chartCalls.push(args);
    }
  }

  return {
    paramsState: { id: '42' },
    navigateMock: vi.fn(),
    queryClientMock: { invalidateQueries: vi.fn() },
    queryState,
    toastSuccessMock: vi.fn(),
    toastErrorMock: vi.fn(),
    accountAIMock: vi.fn(),
    chartCalls,
    ChartMock,
  };
});

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
  useParams: () => paramsState,
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn((options: { queryKey: unknown[] }) => {
    const key = String(options.queryKey[0]);
    return queryState[key] ?? { data: undefined, isLoading: false, error: undefined };
  }),
  useQueryClient: () => queryClientMock,
}));

vi.mock('chart.js', () => {
  class ChartMock {
    static register = vi.fn();
    destroy = vi.fn();
    constructor(...args: unknown[]) {
      chartCalls.push(args);
    }
  }

  return { Chart: ChartMock, registerables: [] };
});

vi.mock('sonner', () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
  },
}));

vi.mock('../../../store', () => ({
  getClientes: vi.fn(),
  getCurrentWorkspace: vi.fn(),
}));

vi.mock('../../../services/instagram', () => ({
  getInstagramSummary: vi.fn(),
  syncInstagramData: vi.fn(),
}));

vi.mock('../../../services/analytics', () => ({
  getAnalyticsOverview: vi.fn(),
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
  getAccountAIAnalysis: accountAIMock,
  upsertManualFollowerCount: vi.fn(),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    type = 'button',
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button type={type} {...props}>
      {children}
    </button>
  ),
}));

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('@/components/ui/label', () => ({
  Label: ({ children }: { children: React.ReactNode }) => <label>{children}</label>,
}));

vi.mock('@/components/ui/spinner', () => ({
  Spinner: ({ size }: { size?: string }) => <div data-testid={`spinner-${size ?? 'md'}`}>Spinner</div>,
}));

vi.mock('@/components/ui/dialog', async () => {
  const ReactModule = await vi.importActual<typeof import('react')>('react');

  interface DialogContextValue {
    open: boolean;
  }

  const DialogContext = ReactModule.createContext<DialogContextValue>({ open: false });

  function Dialog({
    open = false,
    children,
  }: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    children: React.ReactNode;
  }) {
    return (
      <DialogContext.Provider value={{ open }}>
        <div>{children}</div>
      </DialogContext.Provider>
    );
  }

  function DialogContent({ children }: { children: React.ReactNode }) {
    const { open } = ReactModule.useContext(DialogContext);
    return open ? <div role="dialog">{children}</div> : null;
  }

  function DialogHeader({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>;
  }

  function DialogFooter({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>;
  }

  function DialogTitle({ children }: { children: React.ReactNode }) {
    return <h2>{children}</h2>;
  }

  return {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogFooter,
    DialogTitle,
  };
});

import AnalyticsContaPage from '../AnalyticsContaPage';
import { getAccountAIAnalysis, getClientReports, getTags, getBestPostingTimes, getAudienceDemographics, getFollowerHistory, getPostsAnalytics, getAnalyticsOverview } from '../../../services/analytics';
import { getClientes, getCurrentWorkspace } from '../../../store';
import { getInstagramSummary } from '../../../services/instagram';

const mockedGetClientes = vi.mocked(getClientes);
const mockedGetInstagramSummary = vi.mocked(getInstagramSummary);
const mockedGetAnalyticsOverview = vi.mocked(getAnalyticsOverview);
const mockedGetPostsAnalytics = vi.mocked(getPostsAnalytics);
const mockedGetFollowerHistory = vi.mocked(getFollowerHistory);
const mockedGetTags = vi.mocked(getTags);
const mockedGetClientReports = vi.mocked(getClientReports);
const mockedGetAudienceDemographics = vi.mocked(getAudienceDemographics);
const mockedGetBestPostingTimes = vi.mocked(getBestPostingTimes);
const mockedGetCurrentWorkspace = vi.mocked(getCurrentWorkspace);
const mockedGetAccountAIAnalysis = vi.mocked(getAccountAIAnalysis);

function resetQueryState() {
  for (const key of Object.keys(queryState)) delete queryState[key];
}

function seedCommonAnalyticsData() {
  const client = { id: 42, nome: 'Clinica Aurora' };
  const account = { username: 'clinicaaurora', profile_picture_url: 'https://example.com/avatar.jpg' };

  queryState.clientes = { data: [client] };
  queryState['ig-summary'] = { data: { account } };
  queryState['analytics-overview'] = {
    data: {
      fromCache: false,
      fetchedAt: '2026-04-18T12:00:00Z',
      data: {
        followerCount: 1234,
        followers: { direction: 'up', deltaPercent: 12.5, current: 140, previous: 124 },
        engagement: { direction: 'up', deltaPercent: 3.2, current: 12.34, previous: 11.9 },
        reach: { direction: 'down', deltaPercent: -4.1, current: 4567, previous: 4800 },
        profileViews: { direction: 'up', deltaPercent: 8.1, current: 98, previous: 90 },
        websiteClicks: { direction: 'flat', deltaPercent: 0, current: 17, previous: 17 },
        savesRate: { direction: 'up', deltaPercent: 2.2, current: 6.78, previous: 6.1 },
        postsPublished: { direction: 'up', deltaPercent: 25, current: 8, previous: 6 },
      },
    },
  };
  queryState['analytics-posts'] = {
    data: {
      posts: [
        {
          id: 1,
          posted_at: '2026-04-15T12:00:00Z',
          media_type: 'VIDEO',
          reach: 2500,
          impressions: 4000,
          engagement_rate: 7.2,
          likes: 320,
        saved: 48,
        saves_rate: 12.4,
        comments: 12,
        shares: 5,
          caption: 'Post em reels com alta performance',
          thumbnail_url: 'https://example.com/1.jpg',
          permalink: 'https://instagram.com/p/1',
          tags: [{ id: 1, tag_name: 'Educação', color: '#3ecf8e' }],
        },
        {
          id: 2,
          posted_at: '2026-04-12T12:00:00Z',
          media_type: 'IMAGE',
          reach: 1700,
          impressions: 2100,
          engagement_rate: 4.6,
          likes: 180,
        saved: 36,
        saves_rate: 8.9,
        comments: 8,
          shares: 3,
          caption: 'Conteúdo institucional',
          thumbnail_url: 'https://example.com/2.jpg',
          permalink: 'https://instagram.com/p/2',
          tags: [{ id: 2, tag_name: 'Institucional', color: '#f5a342' }],
        },
      ],
    },
  };
  queryState['analytics-history'] = {
    data: {
      history: [
        { date: '2026-04-16T00:00:00Z', follower_count: 1200 },
        { date: '2026-04-17T00:00:00Z', follower_count: 1234 },
      ],
      postDates: [{ date: '2026-04-15T00:00:00Z' }],
    },
  };
  queryState['analytics-tags'] = {
    data: [
      { id: 1, tag_name: 'Educação', color: '#3ecf8e' },
      { id: 2, tag_name: 'Institucional', color: '#f5a342' },
    ],
  };
  queryState['analytics-reports'] = {
    data: [
      {
        id: 10,
        report_month: '2026-04',
        generated_at: '2026-04-17T09:00:00Z',
        status: 'ready',
        report_url: 'https://example.com/report.pdf',
      },
    ],
  };
  queryState['analytics-demo'] = {
    data: {
      data: {
        gender_split: { male: 41, female: 59 },
        age_gender: [
          { age_range: '18-24', male: 12, female: 18 },
          { age_range: '25-34', male: 20, female: 26 },
        ],
        cities: [
          { name: 'Fortaleza', count: 310 },
          { name: 'Recife', count: 180 },
        ],
        countries: [
          { code: 'BR', count: 500 },
        ],
      },
    },
  };
  queryState['analytics-times'] = {
    data: {
      data: {
        totalPosts: 4,
        labels_days: ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'],
        labels_hours: ['00h', '03h', '06h', '09h', '12h', '15h', '18h', '21h'],
        heatmap: [
          [0, 0, 1, 2, 0, 0, 3, 1],
          [1, 2, 0, 4, 0, 0, 1, 0],
          [0, 1, 0, 2, 4, 0, 0, 1],
          [0, 0, 3, 5, 2, 1, 0, 0],
          [0, 1, 0, 0, 3, 4, 0, 0],
          [0, 0, 2, 0, 1, 3, 4, 0],
          [1, 0, 0, 0, 2, 0, 3, 5],
        ],
        counts: [
          [0, 0, 1, 1, 0, 0, 2, 1],
          [1, 1, 0, 1, 0, 0, 1, 0],
          [0, 1, 0, 1, 1, 0, 0, 1],
          [0, 0, 1, 2, 1, 1, 0, 0],
          [0, 1, 0, 0, 1, 1, 0, 0],
          [0, 0, 1, 0, 1, 1, 1, 0],
          [1, 0, 0, 0, 1, 0, 1, 1],
        ],
        topSlots: [],
      },
    },
  };
  return { client, account };
}

beforeEach(() => {
  resetQueryState();
  navigateMock.mockReset();
  toastSuccessMock.mockReset();
  toastErrorMock.mockReset();
  accountAIMock.mockReset();
  queryClientMock.invalidateQueries.mockReset();
  mockedGetClientes.mockReset();
  mockedGetInstagramSummary.mockReset();
  mockedGetAnalyticsOverview.mockReset();
  mockedGetPostsAnalytics.mockReset();
  mockedGetFollowerHistory.mockReset();
  mockedGetTags.mockReset();
  mockedGetClientReports.mockReset();
  mockedGetAudienceDemographics.mockReset();
  mockedGetBestPostingTimes.mockReset();
  mockedGetCurrentWorkspace.mockReset();
  mockedGetAccountAIAnalysis.mockReset();
  chartCalls.length = 0;

  mockedGetClientes.mockResolvedValue([{ id: 42, nome: 'Clinica Aurora' }]);
  mockedGetInstagramSummary.mockResolvedValue({ account: { username: 'clinicaaurora', profile_picture_url: 'https://example.com/avatar.jpg' } });
  mockedGetAnalyticsOverview.mockResolvedValue({ data: {} });
  mockedGetPostsAnalytics.mockResolvedValue({ posts: [] });
  mockedGetFollowerHistory.mockResolvedValue({ history: [], postDates: [] });
  mockedGetTags.mockResolvedValue([]);
  mockedGetClientReports.mockResolvedValue([]);
  mockedGetAudienceDemographics.mockResolvedValue({ data: null });
  mockedGetBestPostingTimes.mockResolvedValue({ data: null });
  mockedGetCurrentWorkspace.mockResolvedValue({ name: 'Workspace', logo_url: '' });
  mockedGetAccountAIAnalysis.mockResolvedValue({ analysis: {}, generatedAt: '2026-04-18T12:00:00Z' });
});

describe('AnalyticsContaPage', () => {
  it('shows a loading spinner while the initial queries are pending', () => {
    queryState.clientes = { isLoading: true };

    render(<AnalyticsContaPage />);

    expect(screen.getByTestId('spinner-lg')).toBeTruthy();
  });

  it('shows the Instagram token recovery state when the summary query fails with TOKEN_EXPIRED', () => {
    queryState.clientes = { data: [{ id: 42, nome: 'Clinica Aurora' }] };
    queryState['ig-summary'] = { error: new Error('TOKEN_EXPIRED') };

    render(<AnalyticsContaPage />);

    expect(screen.getByText('Token do Instagram expirado')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Reconectar Conta/i }));
    expect(navigateMock).toHaveBeenCalledWith('/cliente/42');
  });

  it('shows the disconnected state when the Instagram summary is missing', () => {
    queryState.clientes = { data: [{ id: 42, nome: 'Clinica Aurora' }] };
    queryState['ig-summary'] = { data: null };

    render(<AnalyticsContaPage />);

    expect(screen.getByText('Instagram não conectado')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Ir para o perfil do cliente/i }));
    expect(navigateMock).toHaveBeenCalledWith('/cliente/42');
  });

  it('renders the main summaries and generates the AI analysis on demand', async () => {
    const { client, account } = seedCommonAnalyticsData();
    mockedGetAccountAIAnalysis.mockResolvedValue({
      analysis: {
        healthScore: {
          score: 82,
          summary: 'Conta saudável e consistente.',
          breakdown: {
            engagement: 'bom',
            audience: 'crescendo',
          },
        },
        performanceMap: {
          topPerformer: 'Reels com taxa de salvamento forte',
          worstPerformer: 'Posts institucionais com baixa retenção',
          contentMix: 'Manter mix com mais reels educativos',
        },
        captionDiagnostic: 'Captações curtas e objetivas estão performando melhor.',
        growthAnalysis: {
          trajectory: 'Crescimento estável nas ultimas semanas.',
          projection: 'Mantendo o ritmo, a conta tende a seguir crescendo.',
        },
        actionPlan: [
          { prioridade: 'alta', acao: 'Publicar mais reels', porque: 'Eles puxam o melhor engajamento.' },
        ],
      },
      generatedAt: '2026-04-18T12:00:00Z',
    });

    render(<AnalyticsContaPage />);

    expect(screen.getByText(client.nome)).toBeTruthy();
    expect(screen.getByText(`@${account.username}`)).toBeTruthy();
    expect(screen.getByText('SEGUIDORES')).toBeTruthy();
    expect(screen.getByText('1.234')).toBeTruthy();
    expect(screen.getByText('12.34%')).toBeTruthy();
    expect(screen.getByText('Taxa de Salvamentos')).toBeTruthy();
    expect(screen.getByText('Relatórios Gerados')).toBeTruthy();
    expect(screen.getByText('Abr 2026')).toBeTruthy();
    await waitFor(() => {
      expect(chartCalls.length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole('button', { name: /Gerar Análise IA/i }));

    await waitFor(() => {
      expect(mockedGetAccountAIAnalysis).toHaveBeenCalledWith(42, 30);
    });

    expect(await screen.findByText('82')).toBeTruthy();
    expect(screen.getByText('Conta saudável e consistente.')).toBeTruthy();
    expect(screen.getByText('Publicar mais reels')).toBeTruthy();
  });
});
