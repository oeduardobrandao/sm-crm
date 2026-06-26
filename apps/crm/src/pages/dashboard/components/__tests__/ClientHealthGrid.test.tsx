import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { ClientHealthGrid } from '../ClientHealthGrid';
import type { ClientHealth } from '../../../../services/clientHealth';

vi.mock('../../../../services/instagram', () => ({
  getInstagramAuthUrl: vi.fn(),
  syncInstagramData: vi.fn(),
}));

const mk = (over: Partial<ClientHealth>): ClientHealth =>
  ({
    client_id: 1,
    client_name: 'Alpha',
    client_sigla: 'A',
    client_cor: '#000',
    username: 'alpha',
    profile_picture_url: null,
    connected: true,
    follower_count: 10,
    follower_delta: 1,
    follower_delta_pct: 1,
    follower_series: [9, 10],
    engagement_rate: 3,
    reach_28d: 100,
    reach_trend_pct: 5,
    days_since_last_post: 2,
    pipeline: { agendados: 1, em_producao: 0, agente: 0, falha: 0 },
    authorization_status: 'active',
    token_expires_at: null,
    last_synced_at: new Date().toISOString(),
    status: 'saudavel',
    score: 70,
    ...over,
  }) as ClientHealth;

const base = {
  clients: [] as ClientHealth[],
  isLoading: false,
  isError: false,
  filter: 'todos' as const,
  search: '',
  sort: 'nome' as const,
};

const renderGrid = (props: Partial<typeof base>) =>
  render(
    <MemoryRouter>
      <ClientHealthGrid {...base} {...props} />
    </MemoryRouter>,
  );

describe('ClientHealthGrid', () => {
  it('shows skeletons while loading', () => {
    const { container } = renderGrid({ isLoading: true });
    expect(container.querySelectorAll('[data-testid="health-skeleton"]').length).toBeGreaterThan(0);
  });

  it('shows an error message on error', () => {
    renderGrid({ isError: true });
    expect(screen.getByText(/Não foi possível carregar/)).toBeTruthy();
  });

  it('shows the no-clients empty state', () => {
    renderGrid({ clients: [] });
    expect(screen.getByText(/Nenhum cliente ativo/)).toBeTruthy();
  });

  it('renders a card per client and applies the filter', () => {
    renderGrid({
      clients: [mk({ client_id: 1, client_name: 'Alpha', status: 'saudavel' }), mk({ client_id: 2, client_name: 'Bravo', status: 'em_queda' })],
      filter: 'atencao',
    });
    expect(screen.queryByText('Alpha')).toBeNull();
    expect(screen.getByText('Bravo')).toBeTruthy();
  });
});
