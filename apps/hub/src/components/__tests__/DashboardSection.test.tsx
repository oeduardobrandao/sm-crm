import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '@mesaas/i18n';
import { HubContext } from '../../HubContext';
import type {
  DashboardPlatform,
  HubAccountSummary,
  HubDashboardResponse,
  DashboardTopVideo,
} from '../../types';

vi.mock('../../api', () => ({ fetchDashboard: vi.fn() }));
vi.mock('../dashboard/DashboardCharts', () => ({
  default: (props: unknown) => <div data-testid="charts">{JSON.stringify(props)}</div>,
}));

import { fetchDashboard } from '../../api';
import { DashboardSection } from '../dashboard/DashboardSection';

const dashboard = vi.mocked(fetchDashboard);

const igAccount: HubAccountSummary = {
  platform: 'instagram',
  state: 'connected',
  username: 'clinica',
  followerCount: 1000,
  followersDelta: null,
  lastSyncedAt: '2026-11-10T10:00:00Z',
  instagram: { reach28d: 1, impressions28d: 2, mediaCount: 3 },
};
const ttAccount: HubAccountSummary = {
  platform: 'tiktok',
  state: 'connected',
  username: 'clinica_tt',
  followerCount: 500,
  followersDelta: null,
  lastSyncedAt: '2026-11-10T10:00:00Z',
  tiktok: { views30d: 10, likesTotal: 5, videoCount: 2 },
};

const topVideo: DashboardTopVideo = {
  id: 'v1',
  coverUrl: null,
  shareUrl: null,
  postedAt: null,
  durationSeconds: null,
  views: 100,
  likes: 1,
  comments: 1,
  shares: 1,
  engagementRate: 2,
};

const igBody = (extra: Partial<HubDashboardResponse> = {}): HubDashboardResponse => ({
  topPosts: [
    {
      id: 'p1',
      thumbnailUrl: null,
      mediaType: 'IMAGE',
      permalink: 'https://instagram.com/p/1',
      postedAt: '2026-11-01T00:00:00Z',
      likes: 1,
      comments: 1,
      reach: 1,
      impressions: 1,
      saved: 1,
      shares: 1,
      engagementRate: 1,
    },
  ],
  followerHistory: [{ date: '2026-10-12', followerCount: 900 }],
  reachHistory: [],
  account: {
    followerCount: 1000,
    followingCount: 1,
    mediaCount: 3,
    reach28d: 1,
    impressions28d: 2,
    lastSyncedAt: '2026-11-10T10:00:00Z',
  },
  period: 30,
  platform: 'instagram',
  accounts: [igAccount, ttAccount],
  ...extra,
});

const ttBody = (
  history = [{ date: '2026-10-12', followerCount: 400 }],
  extra: Partial<HubDashboardResponse> = {},
): HubDashboardResponse => ({
  topPosts: [],
  followerHistory: [],
  reachHistory: [],
  account: null,
  period: 30,
  platform: 'tiktok',
  accounts: [igAccount, ttAccount],
  tiktok: { topVideos: [topVideo], followerHistory: history, viewsHistory: [] },
  ...extra,
});

function mockApi(opts: { ig?: HubDashboardResponse; tt?: HubDashboardResponse } = {}) {
  dashboard.mockImplementation(async (_t, _p, platform) => {
    if (platform === 'tiktok') return opts.tt ?? ttBody();
    return opts.ig ?? igBody();
  });
}

function Harness({ onSelect }: { onSelect?: (p: DashboardPlatform | null) => void }) {
  const [platform, setPlatform] = useState<DashboardPlatform | null>(null);
  return (
    <DashboardSection
      selectedPlatform={platform}
      onSelectPlatform={(p) => {
        onSelect?.(p);
        setPlatform(p);
      }}
    />
  );
}

function renderSection(ui: React.ReactElement = <Harness />) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <HubContext.Provider value={{ token: 'tok', bootstrap: {}, workspace: 'w' } as never}>
        {ui}
      </HubContext.Provider>
    </QueryClientProvider>,
  );
}

const chartProps = async () =>
  JSON.parse((await screen.findByTestId('charts')).textContent ?? '{}') as Record<string, unknown>;

describe('DashboardSection', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 10, 12));
    dashboard.mockReset();
    await i18n.changeLanguage('pt');
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("with one Instagram account: no switch, the account line, and today's content", async () => {
    mockApi({ ig: igBody({ accounts: [igAccount] }) });
    renderSection();
    expect(await screen.findByText('Melhores Posts')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Plataforma' })).toBeNull();
    expect(screen.getByText('@clinica')).toBeInTheDocument();
    expect(screen.getByText('Conectada')).toBeInTheDocument();
  });

  it('with two accounts: the switch appears with Instagram pressed', async () => {
    mockApi();
    renderSection();
    const group = await screen.findByRole('group', { name: 'Plataforma' });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Instagram' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'TikTok' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('choosing TikTok requests platform=tiktok and shows Melhores vídeos', async () => {
    mockApi();
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'TikTok' }));
    expect(await screen.findByText('Melhores vídeos')).toBeInTheDocument();
    expect(dashboard).toHaveBeenCalledWith('tok', 30, 'tiktok');
    expect((await chartProps()).platform).toBe('tiktok');
  });

  it('choosing the default platform again does not refetch', async () => {
    mockApi();
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'TikTok' }));
    await screen.findByText('Melhores vídeos');
    fireEvent.click(screen.getByRole('button', { name: 'Instagram' }));
    await screen.findByText('Melhores Posts');
    const before = dashboard.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'TikTok' }));
    await screen.findByText('Melhores vídeos');
    fireEvent.click(screen.getByRole('button', { name: 'Instagram' }));
    await screen.findByText('Melhores Posts');
    expect(dashboard.mock.calls.length).toBe(before);
  });

  it('a TikTok-only client lands on TikTok from the plain request', async () => {
    mockApi({ ig: ttBody(undefined, { accounts: [ttAccount] }) });
    renderSection();
    expect(await screen.findByText('Melhores vídeos')).toBeInTheDocument();
    expect(dashboard).toHaveBeenCalledTimes(1);
    expect(dashboard).toHaveBeenCalledWith('tok', 30, undefined);
  });

  it('changing the period keeps the platform', async () => {
    mockApi();
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'TikTok' }));
    await screen.findByText('Melhores vídeos');
    fireEvent.click(screen.getByRole('button', { name: '60d' }));
    await waitFor(() => expect(dashboard).toHaveBeenCalledWith('tok', 60, 'tiktok'));
  });

  it('falls back to the first account when the tiktok block is missing', async () => {
    mockApi({ tt: ttBody(undefined, { tiktok: undefined }) });
    const onSelect = vi.fn();
    renderSection(<Harness onSelect={onSelect} />);
    fireEvent.click(await screen.findByRole('button', { name: 'TikTok' }));
    await waitFor(() => expect(onSelect).toHaveBeenLastCalledWith(null));
    expect(await screen.findByText('Melhores Posts')).toBeInTheDocument();
  });

  it('an account that needs reconnection shows the pill and "Última atualização em"', async () => {
    mockApi({
      ig: igBody({
        accounts: [
          { ...igAccount, state: 'needs_reconnect', lastSyncedAt: '2026-11-02T15:00:00Z' },
        ],
      }),
    });
    renderSection();
    expect(await screen.findByText('Reconexão necessária')).toBeInTheDocument();
    expect(screen.getByText('Última atualização em 02/11')).toBeInTheDocument();
    expect(screen.getByText('Melhores Posts')).toBeInTheDocument();
  });

  it('passes the follower caption only when history starts more than a day after the period', async () => {
    mockApi({ tt: ttBody([{ date: '2026-10-30', followerCount: 400 }]) });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'TikTok' }));
    expect((await chartProps()).followerCaption).toBe('Histórico disponível desde 30/10.');
    cleanup();

    dashboard.mockReset();
    mockApi({ tt: ttBody([{ date: '2026-10-12', followerCount: 400 }]) });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'TikTok' }));
    await screen.findByText('Melhores vídeos');
    expect((await chartProps()).followerCaption).toBeUndefined();
  });

  it('a response without `accounts` behaves as before: no switch, no account line', async () => {
    mockApi({ ig: igBody({ accounts: undefined, platform: undefined }) });
    renderSection();
    expect(await screen.findByText('Melhores Posts')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Plataforma' })).toBeNull();
    expect(screen.queryByText('@clinica')).toBeNull();
    expect((await chartProps()).platform).toBe('instagram');
  });

  it('no account at all keeps the "Conecte o Instagram" card', async () => {
    mockApi({ ig: igBody({ account: null, accounts: [] }) });
    renderSection();
    expect(
      await screen.findByText('Conecte o Instagram para ver métricas de desempenho.'),
    ).toBeInTheDocument();
  });

  it('renders with the section id used by the strip', async () => {
    mockApi();
    const { container } = renderSection();
    await screen.findByText('Melhores Posts');
    expect(container.querySelector('#hub-desempenho')).not.toBeNull();
  });

  it('keeps the header mounted, focused and pressed while the picked platform loads', async () => {
    let release: (v: HubDashboardResponse) => void = () => {};
    dashboard.mockImplementation((_t, _p, platform) =>
      platform === 'tiktok'
        ? new Promise<HubDashboardResponse>((r) => {
            release = r;
          })
        : Promise.resolve(igBody()),
    );
    renderSection();
    const tiktok = await screen.findByRole('button', { name: 'TikTok' });
    tiktok.focus();
    fireEvent.click(tiktok);
    await waitFor(() => expect(dashboard).toHaveBeenCalledWith('tok', 30, 'tiktok'));
    const same = screen.getByRole('button', { name: 'TikTok' });
    expect(same).toBe(tiktok);
    expect(document.activeElement).toBe(tiktok);
    expect(same).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Instagram' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    // Neither platform's content shows under the other's label while pending.
    expect(screen.queryByText('Melhores Posts')).toBeNull();
    expect(screen.queryByText('Melhores vídeos')).toBeNull();
    release(ttBody());
    expect(await screen.findByText('Melhores vídeos')).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'TikTok' }));
  });

  it('keeps the period selector mounted and focused while a new period loads', async () => {
    let release: (v: HubDashboardResponse) => void = () => {};
    dashboard.mockImplementation((_t, period) =>
      period === 60
        ? new Promise<HubDashboardResponse>((r) => {
            release = r;
          })
        : Promise.resolve(igBody()),
    );
    renderSection();
    const btn = await screen.findByRole('button', { name: '60d' });
    btn.focus();
    fireEvent.click(btn);
    await waitFor(() => expect(dashboard).toHaveBeenCalledWith('tok', 60, undefined));
    expect(screen.getByRole('button', { name: '60d' })).toBe(btn);
    expect(document.activeElement).toBe(btn);
    release(igBody({ period: 60 }));
    expect(await screen.findByText('Melhores Posts')).toBeInTheDocument();
  });

  it('a TikTok answer without its block and no pick shows Instagram only when it carries detail', async () => {
    mockApi({ ig: igBody({ platform: 'tiktok' }) });
    renderSection();
    expect(await screen.findByText('Melhores Posts')).toBeInTheDocument();
    expect(screen.queryByText('@clinica_tt')).toBeNull();
    expect(screen.queryByText('Melhores vídeos')).toBeNull();
  });

  it('a TikTok answer without its block and no usable detail renders nothing', async () => {
    mockApi({ ig: ttBody(undefined, { tiktok: undefined }) });
    const { container } = renderSection();
    await waitFor(() => expect(dashboard).toHaveBeenCalled());
    await waitFor(() => expect(container.querySelector('#hub-desempenho')).toBeNull());
    expect(screen.queryByText('Melhores Posts')).toBeNull();
    expect(screen.queryByText('@clinica_tt')).toBeNull();
  });

  it('falls back to the default view when the explicit platform request fails', async () => {
    dashboard.mockImplementation(async (_t, _p, platform) => {
      if (platform === 'tiktok') throw new Error('boom');
      return igBody();
    });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'TikTok' }));
    await waitFor(() => expect(dashboard).toHaveBeenCalledWith('tok', 30, 'tiktok'));
    expect(await screen.findByText('Melhores Posts')).toBeInTheDocument();
  });

  it('after a failed TikTok request the controls match the default data and a click retries', async () => {
    let failing = true;
    dashboard.mockImplementation(async (_t, _p, platform) => {
      if (platform === 'tiktok') {
        if (failing) throw new Error('boom');
        return ttBody();
      }
      return igBody();
    });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'TikTok' }));
    await waitFor(() => expect(dashboard).toHaveBeenCalledWith('tok', 30, 'tiktok'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Instagram' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );
    expect(screen.getByRole('button', { name: '30d' })).toHaveAttribute('data-active', 'true');
    const calls = dashboard.mock.calls.filter((c) => c[2] === 'tiktok').length;
    failing = false;
    fireEvent.click(screen.getByRole('button', { name: 'TikTok' }));
    expect(await screen.findByText('Melhores vídeos')).toBeInTheDocument();
    expect(dashboard.mock.calls.filter((c) => c[2] === 'tiktok').length).toBeGreaterThan(calls);
  });

  it('a failed period request puts the selector back on 30d', async () => {
    dashboard.mockImplementation(async (_t, period) => {
      if (period === 60) throw new Error('boom');
      return igBody();
    });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: '60d' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '30d' })).toHaveAttribute('data-active', 'true'),
    );
    expect(screen.getByText('Melhores Posts')).toBeInTheDocument();
  });

  it('resets a stored pick whose account is gone', async () => {
    mockApi({ ig: igBody({ accounts: [igAccount] }) });
    const onSelect = vi.fn();
    renderSection(<DashboardSection selectedPlatform="tiktok" onSelectPlatform={onSelect} />);
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(null));
  });

  it('a failed background refetch keeps the selected view on screen', async () => {
    mockApi();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <HubContext.Provider value={{ token: 'tok', bootstrap: {}, workspace: 'w' } as never}>
          <Harness />
        </HubContext.Provider>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'TikTok' }));
    await screen.findByText('Melhores vídeos');
    dashboard.mockRejectedValue(new Error('boom'));
    await qc.refetchQueries({ queryKey: ['hub-dashboard', 'tok', 30, 'tiktok'] }).catch(() => {});
    await waitFor(() =>
      expect(qc.getQueryState(['hub-dashboard', 'tok', 30, 'tiktok'])?.status).toBe('error'),
    );
    expect(screen.getByText('Melhores vídeos')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'TikTok' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('the section wrapper keeps a scroll margin for the fixed mobile header', async () => {
    mockApi();
    const { container } = renderSection();
    await screen.findByText('Melhores Posts');
    const el = container.querySelector('#hub-desempenho') as HTMLElement;
    expect(el.className.split(/\s+/)).toEqual(
      expect.arrayContaining(['scroll-mt-24', 'md:scroll-mt-6']),
    );
  });

  it('first load makes exactly one request when the strip and the section share a client', async () => {
    mockApi();
    const { ConnectedAccounts } = await import('../dashboard/ConnectedAccounts');
    renderSection(
      <>
        <ConnectedAccounts onOpenPlatform={() => {}} />
        <Harness />
      </>,
    );
    await screen.findByText('Melhores Posts');
    await screen.findByRole('heading', { name: 'Contas conectadas' });
    expect(dashboard).toHaveBeenCalledTimes(1);
  });
});
