import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { HubMobileNav } from '../HubMobileNav';
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

function renderMobileNav() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/ws/hub/tok']}>
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
            <Route path="/:workspace/hub/:token/*" element={<HubMobileNav />} />
          </Routes>
        </HubContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('HubMobileNav', () => {
  it('opens a right-side drawer with all nine destinations and closes on Escape', () => {
    renderMobileNav();
    fireEvent.click(screen.getByRole('button', { name: /abrir menu|open menu/i }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('Mensagens')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
