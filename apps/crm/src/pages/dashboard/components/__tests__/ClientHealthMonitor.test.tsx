import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../services/instagram', () => ({
  getInstagramAuthUrl: vi.fn(),
  syncInstagramData: vi.fn(),
}));
vi.mock('../../../../services/clientHealth', () => ({
  getClientHealthMonitor: vi.fn().mockResolvedValue({
    clients: [
      {
        client_id: 1,
        client_name: 'Dr. Ana',
        client_sigla: 'DA',
        client_cor: '#000',
        username: 'ana',
        profile_picture_url: null,
        connected: true,
        follower_count: 100,
        follower_delta: 10,
        follower_delta_pct: 11,
        follower_series: [90, 100],
        engagement_rate: 4,
        reach_28d: 1000,
        reach_trend_pct: 5,
        days_since_last_post: 2,
        pipeline: { agendados: 1, em_producao: 0, agente: 0, falha: 0 },
        authorization_status: 'active',
        token_expires_at: null,
        last_synced_at: new Date().toISOString(),
        status: 'saudavel',
        score: 70,
      },
    ],
    summary: { total: 1, atencao: 0, saudaveis: 1, estaveis: 0, conexao: 0, precisamAtencao: 0 },
  }),
}));

import { ClientHealthMonitor } from '../ClientHealthMonitor';
import { VidroToolbarHarness } from '@/test/vidroToolbar';

function renderMonitor() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ClientHealthMonitor />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ClientHealthMonitor', () => {
  it('renders the title and a client card after loading', async () => {
    renderMonitor();
    expect(screen.getByText('Saúde dos clientes')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Dr. Ana')).toBeTruthy());
  });

  it('titles the section with a level-2 heading under the Vidro toolbar, which owns the page h1', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <VidroToolbarHarness>
            <ClientHealthMonitor />
          </VidroToolbarHarness>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Saúde dos clientes' })).toBeTruthy();
    // The page h1 comes from DashboardPage's toolbar spec; the monitor must not add a second one.
    expect(screen.queryAllByRole('heading', { level: 1 })).toHaveLength(0);
  });

  it('keeps the level-1 heading without the Vidro toolbar', () => {
    renderMonitor();
    expect(screen.getByRole('heading', { level: 1, name: 'Saúde dos clientes' })).toBeTruthy();
    expect(screen.queryAllByRole('heading', { level: 2 })).toHaveLength(0);
  });
});
