import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';
import { ClientHealthCard } from '../ClientHealthCard';
import type { ClientHealth } from '../../../../services/clientHealth';

vi.mock('../../../../services/instagram', () => ({
  getInstagramAuthUrl: vi.fn().mockResolvedValue('https://x'),
  syncInstagramData: vi.fn().mockResolvedValue(undefined),
}));

const mk = (over: Partial<ClientHealth>): ClientHealth =>
  ({
    client_id: 7,
    client_name: 'Dr. Ana Costa',
    client_sigla: 'AC',
    client_cor: '#7c5cff',
    username: 'anacosta',
    profile_picture_url: null,
    connected: true,
    follower_count: 12400,
    follower_delta: 312,
    follower_delta_pct: 2.6,
    follower_series: [12000, 12100, 12400],
    engagement_rate: 4.2,
    reach_28d: 38000,
    reach_trend_pct: 10,
    days_since_last_post: 2,
    pipeline: { agendados: 2, em_producao: 1, agente: 1, falha: 0 },
    authorization_status: 'active',
    token_expires_at: null,
    last_synced_at: new Date().toISOString(),
    status: 'saudavel',
    score: 70,
    ...over,
  }) as ClientHealth;

const renderCard = (c: ClientHealth) =>
  render(
    <MemoryRouter>
      <ClientHealthCard client={c} />
    </MemoryRouter>,
  );

describe('ClientHealthCard', () => {
  it('renders name, handle and status badge', () => {
    renderCard(mk({}));
    expect(screen.getByText('Dr. Ana Costa')).toBeTruthy();
    expect(screen.getByText('@anacosta')).toBeTruthy();
    expect(screen.getByText('Saudável')).toBeTruthy();
  });

  it('links to analytics and detail pages', () => {
    renderCard(mk({}));
    const hrefs = Array.from(document.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/analytics/7');
    expect(hrefs).toContain('/clientes/7');
  });

  it('shows the reconnect CTA for a reconectar client', () => {
    renderCard(mk({ status: 'reconectar', score: null }));
    expect(screen.getByText('Reconectar')).toBeTruthy();
  });

  it('shows the connect CTA for a disconnected client', () => {
    renderCard(mk({ status: 'desconectado', score: null, connected: false, username: null }));
    expect(screen.getByText('Conectar Instagram')).toBeTruthy();
  });
});
