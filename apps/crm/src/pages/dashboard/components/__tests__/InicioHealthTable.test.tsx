import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientHealth } from '../../../../services/clientHealth';

const { getMonitorMock, getAuthUrlMock, syncMock } = vi.hoisted(() => ({
  getMonitorMock: vi.fn(),
  getAuthUrlMock: vi.fn(),
  syncMock: vi.fn(),
}));

vi.mock('../../../../services/clientHealth', () => ({
  getClientHealthMonitor: getMonitorMock,
}));
vi.mock('../../../../services/instagram', () => ({
  getInstagramAuthUrl: getAuthUrlMock,
  syncInstagramData: syncMock,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { InicioHealthTable, healthReason } from '../InicioHealthTable';

const NOW = Date.parse('2026-08-17T12:00:00Z');

function client(over: Partial<ClientHealth>): ClientHealth {
  return {
    client_id: 1,
    client_name: 'Cliente',
    client_sigla: 'CL',
    client_cor: '#0f766e',
    username: 'cliente',
    profile_picture_url: null,
    connected: true,
    follower_count: 1200,
    follower_delta: 10,
    follower_delta_pct: 0.8,
    follower_series: [],
    engagement_rate: 2.4,
    reach_28d: 5400,
    reach_trend_pct: 3,
    days_since_last_post: 2,
    pipeline: { agendados: 2, em_producao: 1, agente: 0, falha: 0 },
    authorization_status: 'active',
    token_expires_at: null,
    last_synced_at: '2026-08-17T08:00:00Z',
    status: 'saudavel',
    score: 70,
    ...over,
  };
}

const clients = [
  client({ client_id: 1, client_name: 'Alfa', status: 'saudavel' }),
  client({ client_id: 2, client_name: 'Beta', status: 'reconectar' }),
  client({
    client_id: 3,
    client_name: 'Gama',
    status: 'em_queda',
    reach_trend_pct: -40,
    score: 15,
  }),
  client({ client_id: 4, client_name: 'Delta', status: 'inativo', days_since_last_post: 23 }),
];

function renderTable() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <InicioHealthTable />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const rowNames = () =>
  Array.from(document.querySelectorAll('.inicio-health__name')).map((e) => e.textContent);

describe('InicioHealthTable', () => {
  beforeEach(() => {
    getMonitorMock.mockResolvedValue({
      clients,
      summary: { total: 4, atencao: 2, saudaveis: 1, estaveis: 0, conexao: 1, precisamAtencao: 3 },
    });
  });

  it('opens on the clients that need action, most urgent first, each with its reason', async () => {
    renderTable();

    expect(
      await screen.findByRole('button', { name: /Pedem ação 3/, pressed: true }),
    ).toBeInTheDocument();
    expect(rowNames()).toEqual(['Beta', 'Delta', 'Gama']);
    const rows = screen.getAllByRole('row').slice(1);
    expect(within(rows[0]).getByText('Beta')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Autorização expirada ou revogada')).toBeInTheDocument();
    expect(within(rows[0]).getByRole('button', { name: 'Reconectar' })).toBeInTheDocument();
    expect(screen.getByText('Alcance caiu 40%')).toBeInTheDocument();
    expect(screen.getByText('23 dias sem postar')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Entregas' })).toHaveAttribute(
      'href',
      '/clientes/4/entregas',
    );
    expect(screen.queryByText('Alfa')).not.toBeInTheDocument();
  });

  it('shows everyone under Todos and filters by search', async () => {
    renderTable();
    fireEvent.click(await screen.findByRole('button', { name: /Todos 4/ }));
    expect(screen.getByText('Alfa')).toBeInTheDocument();
    expect(screen.getByText('Mostrando 4 de 4')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Buscar cliente…' }), {
      target: { value: 'gam' },
    });
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(screen.getByText('Gama')).toBeInTheDocument();
  });

  it('starts on Todos when nobody needs action', async () => {
    getMonitorMock.mockResolvedValue({
      clients: [clients[0]],
      summary: { total: 1, atencao: 0, saudaveis: 1, estaveis: 0, conexao: 0, precisamAtencao: 0 },
    });
    renderTable();
    expect(
      await screen.findByRole('button', { name: /Todos 1/, pressed: true }),
    ).toBeInTheDocument();
    expect(screen.getByText('Alfa')).toBeInTheDocument();
  });
});

describe('healthReason', () => {
  it('explains each attention state and stays quiet for healthy clients', () => {
    expect(healthReason(client({ status: 'saudavel' }), NOW)).toBeNull();
    expect(
      healthReason(
        client({ status: 'sem_sincronizar', last_synced_at: '2026-08-13T12:00:00Z' }),
        NOW,
      ),
    ).toEqual({
      key: 'inicio.health.why.sem_sincronizar',
      values: { count: 4 },
    });
    expect(healthReason(client({ status: 'inativo', days_since_last_post: null }), NOW)).toEqual({
      key: 'inicio.health.why.inativoNever',
    });
    expect(
      healthReason(
        client({ status: 'atencao', reach_trend_pct: -2, follower_delta_pct: -1.84 }),
        NOW,
      ),
    ).toEqual({ key: 'inicio.health.why.followers', values: { pct: 1.8 } });
    expect(
      healthReason(
        client({
          status: 'atencao',
          reach_trend_pct: 0,
          follower_delta_pct: 1,
          days_since_last_post: 11,
        }),
        NOW,
      ),
    ).toEqual({ key: 'inicio.health.why.lastPost', values: { count: 11 } });
    expect(
      healthReason(
        client({
          status: 'atencao',
          reach_trend_pct: 0,
          follower_delta_pct: 1,
          days_since_last_post: 1,
        }),
        NOW,
      ),
    ).toEqual({ key: 'inicio.health.why.generic' });
  });
});
