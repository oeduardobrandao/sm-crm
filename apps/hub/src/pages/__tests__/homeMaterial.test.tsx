import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HubContext } from '../../HubContext';

vi.mock('../../api', () => ({
  fetchPosts: vi.fn(),
  fetchPostsInRange: vi.fn(),
  fetchAgenda: vi.fn(),
  fetchAgendaPeriodo: vi.fn(),
  fetchDashboard: vi.fn(),
  responderAgenda: vi.fn(),
  cancelarRemarcacao: vi.fn(),
  agendaIcsUrl: () => '',
}));
vi.mock('../../services/materialRequests', () => ({ fetchMaterialRequests: vi.fn() }));
vi.mock('../../components/dashboard/DashboardSection', () => ({ DashboardSection: () => null }));
vi.mock('../../components/PostCalendar', () => ({ PostCalendar: () => <div>cal</div> }));

import { fetchPosts, fetchDashboard } from '../../api';
import { fetchMaterialRequests } from '../../services/materialRequests';
import { HomePage } from '../HomePage';

const material = vi.mocked(fetchMaterialRequests);

const req = (id: number, dones: boolean[]) => ({
  post_id: id,
  request: { id, post_id: id, items: dones.map((done, i) => ({ id: id * 10 + i, done })) },
});

function renderHome(pauta: boolean) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const value = {
    bootstrap: {
      workspace: { name: 'M', logo_url: '', brand_color: '#0f766e' },
      cliente_nome: 'Ana Souza',
      cliente_foto_url: null,
      is_active: true,
      cliente_id: 14,
      feature_hub_pauta: pauta,
    },
    token: 'tk',
    workspace: 'mesaas',
  };
  const ui: ReactNode = (
    <QueryClientProvider client={qc}>
      <HubContext.Provider value={value as never}>
        <MemoryRouter initialEntries={['/mesaas/hub/tk']}>
          <Routes>
            <Route path="/:workspace/hub/:token/*" element={<HomePage />} />
          </Routes>
        </MemoryRouter>
      </HubContext.Provider>
    </QueryClientProvider>
  );
  render(ui);
}

describe.each([
  ['classic', false],
  ['pauta', true],
])('Home material banner (%s)', (_name, pauta) => {
  beforeEach(() => {
    vi.mocked(fetchPosts)
      .mockReset()
      .mockResolvedValue({ posts: [], historyCutoff: null } as never);
    vi.mocked(fetchDashboard).mockReset();
    vi.mocked(fetchDashboard).mockResolvedValue({
      topPosts: [],
      followerHistory: [],
      reachHistory: [],
      account: null,
      period: 30,
      platform: 'instagram',
      accounts: [],
    });
    material.mockReset();
  });
  afterEach(cleanup);

  it('sums missing items over requests', async () => {
    material.mockResolvedValue([
      req(1, [false, false]),
      req(2, [false, true]),
      req(3, [false, false]),
    ] as never);
    renderHome(pauta);
    const link = await screen.findByRole('link', {
      name: 'A equipe está esperando 5 itens seus em 3 posts',
    });
    expect(link).toHaveAttribute('href', '/mesaas/hub/tk/aprovacoes?aba=material');
  });

  it('uses singular forms', async () => {
    material.mockResolvedValue([req(1, [false])] as never);
    renderHome(pauta);
    expect(
      await screen.findByRole('link', { name: 'A equipe está esperando 1 item seu em 1 post' }),
    ).toBeInTheDocument();
  });

  it('reads correctly with mixed plurals', async () => {
    material.mockResolvedValue([req(1, [false, false])] as never);
    renderHome(pauta);
    expect(
      await screen.findByRole('link', { name: 'A equipe está esperando 2 itens seus em 1 post' }),
    ).toBeInTheDocument();
  });

  it('is hidden at zero missing items', async () => {
    material.mockResolvedValue([req(1, [true])] as never);
    renderHome(pauta);
    await waitFor(() => expect(material).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(/A equipe está esperando/)).toBeNull();
  });

  it('is hidden when the query errors', async () => {
    material.mockRejectedValue(new Error('boom'));
    renderHome(pauta);
    await waitFor(() => expect(material).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(/A equipe está esperando/)).toBeNull();
  });
});
