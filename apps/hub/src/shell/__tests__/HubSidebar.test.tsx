import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HubSidebar } from '../HubSidebar';
import { HubContext } from '../../HubContext';
import type { HubBootstrap } from '../../types';
import { fetchMensagensUnread, fetchPosts } from '../../api';

vi.mock('../../api', () => ({
  fetchPosts: vi.fn().mockResolvedValue({ posts: [], postApprovals: [], instagramProfile: null }),
  fetchMensagensUnread: vi.fn().mockResolvedValue({ unread: 0 }),
}));

const BOOTSTRAP: HubBootstrap = {
  workspace: { name: 'Café da Manhã', logo_url: null, brand_color: '#171717' },
  cliente_nome: 'Débora Lima',
  is_active: true,
  cliente_id: 1,
  feature_mensagens: true,
  feature_agenda: false,
};

function renderSidebar(pathname: string, bootstrap: HubBootstrap = BOOTSTRAP) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[pathname]}>
        <HubContext.Provider
          value={{
            bootstrap,
            token: 'tok',
            workspace: 'ws',
            theme: 'light',
            toggleTheme: vi.fn(),
          }}
        >
          <Routes>
            <Route path="/:workspace/hub/:token/*" element={<HubSidebar />} />
          </Routes>
        </HubContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('HubSidebar', () => {
  // The global afterEach(vi.restoreAllMocks) wipes the factory defaults, so
  // re-arm them: a bare vi.fn() resolves undefined and react-query complains.
  beforeEach(() => {
    vi.mocked(fetchPosts).mockResolvedValue({
      posts: [],
      postApprovals: [],
      instagramProfile: null,
    } as never);
    vi.mocked(fetchMensagensUnread).mockResolvedValue({ unread: 0 } as never);
  });

  it('renders all nine destinations including the new Mensagens item', () => {
    renderSidebar('/ws/hub/tok');
    for (const label of [
      'Início',
      'Aprovações',
      'Postagens',
      'Páginas',
      'Briefing',
      'Marca',
      'Ideias',
      'Relatórios',
      'Mensagens',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('shows the workspace name and client name, with no account-switcher or notifications row', () => {
    renderSidebar('/ws/hub/tok');
    expect(screen.getByText('Café da Manhã')).toBeInTheDocument();
    expect(screen.getByText('Débora Lima')).toBeInTheDocument();
    expect(screen.queryByText('Atualizações')).not.toBeInTheDocument();
    expect(screen.queryByText('Configurações')).not.toBeInTheDocument();
  });

  it('hides Mensagens when feature_mensagens is false, keeping every other destination', () => {
    renderSidebar('/ws/hub/tok', { ...BOOTSTRAP, feature_mensagens: false });
    expect(screen.queryByText('Mensagens')).not.toBeInTheDocument();
    for (const label of ['Início', 'Aprovações', 'Postagens', 'Relatórios']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('shows Agenda right after Postagens only when feature_agenda is on', () => {
    const { unmount } = renderSidebar('/ws/hub/tok');
    expect(screen.queryByText('Agenda')).not.toBeInTheDocument();
    unmount();
    renderSidebar('/ws/hub/tok', { ...BOOTSTRAP, feature_agenda: true });
    const agenda = screen.getByText('Agenda').closest('a');
    expect(agenda).toHaveAttribute('href', '/ws/hub/tok/agenda');
    const labels = screen.getAllByRole('link').map((a) => a.textContent);
    expect(labels.indexOf('Agenda')).toBe(labels.indexOf('Postagens') + 1);
  });

  it('hides Agenda when an older hub-bootstrap omits feature_agenda', () => {
    const { feature_agenda: _omit, ...antigo } = BOOTSTRAP;
    renderSidebar('/ws/hub/tok', antigo);
    expect(screen.queryByText('Agenda')).not.toBeInTheDocument();
  });

  it('marks the active nav item with hub-nav-active (color: var(--hub-primary), a no-op in neutral)', () => {
    renderSidebar('/ws/hub/tok');
    const activeLink = screen.getByText('Início').closest('a');
    expect(activeLink?.className).toContain('hub-nav-active');
    const inactiveLink = screen.getByText('Postagens').closest('a');
    expect(inactiveLink?.className).not.toContain('hub-nav-active');
  });

  it('Pauta: active item uses hub-nav-pill and the aside has no right border', async () => {
    renderSidebar('/ws/hub/tok', { ...BOOTSTRAP, feature_hub_pauta: true });
    const active = await screen.findByRole('link', { name: /início/i });
    expect(active).toHaveClass('hub-nav-pill');
    expect(document.querySelector('aside')).not.toHaveClass('border-r');
  });

  it('classic: active item keeps hub-nav-active hub-bg-soft', async () => {
    renderSidebar('/ws/hub/tok');
    const active = await screen.findByRole('link', { name: /início/i });
    expect(active).toHaveClass('hub-nav-active', 'hub-bg-soft');
    expect(active).not.toHaveClass('hub-nav-pill');
  });

  it('Pauta: the nav counter is brand-tinted inline, never hub-btn-primary', async () => {
    vi.mocked(fetchPosts).mockResolvedValue({
      posts: [{ id: 1, status: 'enviado_cliente' }],
      postApprovals: [],
      instagramProfile: null,
    } as never);
    renderSidebar('/ws/hub/tok/aprovacoes', { ...BOOTSTRAP, feature_hub_pauta: true });
    const link = await screen.findByRole('link', { name: /aprovações/i });
    const badge = await within(link).findByText('1');
    expect(badge).not.toHaveClass('hub-btn-primary');
    expect(badge.style.borderRadius).toBe('var(--hub-r-chip)');
    // Active item: inverted pair.
    expect(badge.style.background).toBe('var(--hub-primary-fg)');
  });
});
