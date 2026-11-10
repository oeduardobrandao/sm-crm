import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '@mesaas/i18n';
import { HubContext } from '../../HubContext';
import type { HubAccountSummary, HubDashboardResponse } from '../../types';

vi.mock('../../api', () => ({ fetchDashboard: vi.fn() }));

import { fetchDashboard } from '../../api';
import { ConnectedAccounts } from '../dashboard/ConnectedAccounts';

const dashboard = vi.mocked(fetchDashboard);

const NOW = new Date('2026-11-10T12:00:00Z');

function makeAccount(overrides: Partial<HubAccountSummary> = {}): HubAccountSummary {
  return {
    platform: 'instagram',
    state: 'connected',
    username: 'drahelenaprado',
    followerCount: 12480,
    followersDelta: { value: 312, since: '2026-10-12', fullWindow: true },
    lastSyncedAt: '2026-11-10T10:00:00Z',
    instagram: { reach28d: 48200, impressions28d: 126000, mediaCount: 214 },
    ...overrides,
  };
}

function makeTikTok(overrides: Partial<HubAccountSummary> = {}): HubAccountSummary {
  return {
    platform: 'tiktok',
    state: 'connected',
    username: 'drahelenaprado',
    followerCount: 3822,
    followersDelta: { value: 84, since: '2026-10-30', fullWindow: false },
    lastSyncedAt: '2026-11-10T10:00:00Z',
    tiktok: { views30d: 9100, likesTotal: 15200, videoCount: 41 },
    ...overrides,
  };
}

function respond(accounts: HubAccountSummary[] | undefined) {
  const body = {
    topPosts: [],
    followerHistory: [],
    reachHistory: [],
    account: null,
    period: 30,
    platform: 'instagram',
    ...(accounts ? { accounts } : {}),
  } as HubDashboardResponse;
  dashboard.mockResolvedValue(body);
}

function renderStrip(onOpenPlatform = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <HubContext.Provider value={{ token: 'tok', bootstrap: {}, workspace: 'w' } as never}>
        <ConnectedAccounts onOpenPlatform={onOpenPlatform} />
      </HubContext.Provider>
    </QueryClientProvider>,
  );
  return onOpenPlatform;
}

describe('ConnectedAccounts', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    dashboard.mockReset();
    await i18n.changeLanguage('pt');
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it('renders a card per account, Instagram first', async () => {
    respond([makeAccount(), makeTikTok()]);
    renderStrip();
    const names = await screen.findAllByRole('heading', { level: 4 });
    expect(names.map((n) => n.textContent)).toEqual(['Instagram', 'TikTok']);
    expect(screen.getAllByText('@drahelenaprado')).toHaveLength(2);
    expect(screen.getByRole('heading', { name: 'Contas conectadas' })).toBeInTheDocument();
  });

  it('connected Instagram card shows followers, change, three numbers and sync age', async () => {
    respond([makeAccount()]);
    renderStrip();
    expect(await screen.findByText('12.480')).toBeInTheDocument();
    expect(screen.getByText('seguidores')).toBeInTheDocument();
    expect(screen.getByText('+312 em 30 dias')).toBeInTheDocument();
    expect(screen.getByText('48,2 mil')).toBeInTheDocument();
    expect(screen.getByText('Alcance, 28 dias')).toBeInTheDocument();
    expect(screen.getByText('126 mil')).toBeInTheDocument();
    expect(screen.getByText('Visualizações, 28 dias')).toBeInTheDocument();
    expect(screen.getByText('214')).toBeInTheDocument();
    expect(screen.getByText('Publicações')).toBeInTheDocument();
    expect(screen.getByText('Atualizado há 2 h')).toBeInTheDocument();
    expect(screen.getByText('Conectada')).toBeInTheDocument();
  });

  it('TikTok card shows its own three numbers and "desde" when history starts later', async () => {
    respond([makeTikTok()]);
    renderStrip();
    expect(await screen.findByText('+84 desde 30/10')).toBeInTheDocument();
    expect(screen.getByText('Visualizações, 30 dias')).toBeInTheDocument();
    expect(screen.getByText('Curtidas no total')).toBeInTheDocument();
    expect(screen.getByText('Vídeos')).toBeInTheDocument();
    expect(screen.getByText('9,1 mil')).toBeInTheDocument();
    expect(screen.getByText('41')).toBeInTheDocument();
  });

  it('needs-reconnect card shows the warning and hides change and numbers', async () => {
    respond([makeTikTok({ state: 'needs_reconnect', lastSyncedAt: '2026-11-02T15:00:00Z' })]);
    renderStrip();
    expect(await screen.findByText('Reconexão necessária')).toBeInTheDocument();
    expect(screen.getByText('seguidores em 02/11')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Os números pararam de atualizar em 02/11. Fale com a sua agência para reconectar a conta.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Última atualização em 02/11')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver histórico' })).toBeInTheDocument();
    expect(screen.queryByText(/em 30 dias/)).toBeNull();
    expect(screen.queryByText(/desde/)).toBeNull();
    expect(screen.queryByText('Visualizações, 30 dias')).toBeNull();
  });

  it('needs-reconnect without a sync date uses the "never" sentence', async () => {
    respond([makeAccount({ state: 'needs_reconnect', lastSyncedAt: null })]);
    renderStrip();
    expect(
      await screen.findByText(
        'Os números não estão sendo atualizados. Fale com a sua agência para reconectar a conta.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('seguidores')).toBeInTheDocument();
    expect(screen.queryByText(/Última atualização/)).toBeNull();
  });

  it('a loss shows a minus sign without a success colour, and zero says "Sem variação em 30 dias"', async () => {
    respond([
      makeAccount({ followersDelta: { value: -12, since: '2026-10-12', fullWindow: true } }),
    ]);
    renderStrip();
    const loss = await screen.findByText('-12 em 30 dias');
    expect(loss.className).not.toMatch(/emerald|green|red/);
    cleanup();

    respond([makeAccount({ followersDelta: { value: 0, since: '2026-10-12', fullWindow: true } })]);
    renderStrip();
    expect(await screen.findByText('Sem variação em 30 dias')).toBeInTheDocument();
    cleanup();

    respond([makeAccount()]);
    renderStrip();
    expect((await screen.findByText('+312 em 30 dias')).className).toMatch(/emerald/);
  });

  it('null figures render as a dash, never "null" or "NaN"', async () => {
    respond([
      makeAccount({
        followerCount: null,
        followersDelta: null,
        instagram: { reach28d: null, impressions28d: null, mediaCount: null },
      }),
    ]);
    renderStrip();
    await screen.findByText('Alcance, 28 dias');
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4);
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/null|NaN|undefined/);
  });

  it('a null username shows the platform name alone; a 60-character username keeps the pill visible', async () => {
    respond([makeAccount({ username: null })]);
    renderStrip();
    await screen.findByRole('heading', { level: 4, name: 'Instagram' });
    expect(screen.queryByText(/^@/)).toBeNull();
    cleanup();

    const long = 'a'.repeat(60);
    respond([makeAccount({ username: long })]);
    renderStrip();
    const handle = await screen.findByText(`@${long}`);
    expect(handle).toHaveClass('truncate');
    expect(handle.parentElement).toHaveClass('min-w-0');
    expect(screen.getByText('Conectada')).toBeInTheDocument();
  });

  it('one account uses the wide layout; two use the carousel with dots', async () => {
    respond([makeAccount()]);
    renderStrip();
    await screen.findByText('12.480');
    expect(screen.queryByRole('button', { name: /Ir para conta/ })).toBeNull();
    cleanup();

    respond([makeAccount(), makeTikTok()]);
    renderStrip();
    await screen.findByText('12.480');
    expect(screen.getAllByRole('button', { name: /Ir para conta/ })).toHaveLength(2);
  });

  it('clicking "Ver desempenho" calls onOpenPlatform with that platform', async () => {
    respond([makeAccount(), makeTikTok()]);
    const onOpen = renderStrip();
    await screen.findByText('12.480');
    const cards = screen.getAllByRole('article');
    fireEvent.click(within(cards[1]).getByRole('button', { name: 'Ver desempenho' }));
    expect(onOpen).toHaveBeenCalledWith('tiktok');
    fireEvent.click(within(cards[0]).getByRole('button', { name: 'Ver desempenho' }));
    expect(onOpen).toHaveBeenLastCalledWith('instagram');
  });

  it('renders nothing with no accounts, with a response lacking `accounts`, and on error', async () => {
    respond([]);
    renderStrip();
    await waitFor(() => expect(dashboard).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Contas conectadas' })).toBeNull(),
    );
    cleanup();

    respond(undefined);
    renderStrip();
    await waitFor(() => expect(dashboard).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Contas conectadas' })).toBeNull(),
    );
    cleanup();

    dashboard.mockRejectedValue(new Error('boom'));
    renderStrip();
    await waitFor(() => expect(dashboard).toHaveBeenCalledTimes(3));
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Contas conectadas' })).toBeNull(),
    );
  });

  it('requests period 30 without a platform', async () => {
    respond([makeAccount()]);
    renderStrip();
    await screen.findByText('12.480');
    expect(fetchDashboard).toHaveBeenCalledWith('tok', 30, undefined);
  });
});
