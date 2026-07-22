import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { HubSidebar } from '../HubSidebar';
import { HubContext } from '../../HubContext';
import type { HubBootstrap } from '../../types';

vi.mock('../../api', () => ({
  fetchPosts: vi.fn().mockResolvedValue({ posts: [], postApprovals: [], instagramProfile: null }),
}));

const BOOTSTRAP: HubBootstrap = {
  workspace: { name: 'Café da Manhã', logo_url: null, brand_color: '#171717' },
  cliente_nome: 'Débora Lima',
  is_active: true,
  cliente_id: 1,
};

function renderSidebar(pathname: string) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[pathname]}>
        <HubContext.Provider
          value={{
            bootstrap: BOOTSTRAP,
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
});
