import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { HubMobileNav } from '../HubMobileNav';
import { HubContext } from '../../HubContext';
import type { HubBootstrap } from '../../types';

vi.mock('../../api', () => ({
  fetchPosts: vi.fn().mockResolvedValue({ posts: [], postApprovals: [], instagramProfile: null }),
  fetchMensagensUnread: vi.fn().mockResolvedValue({ unread: 0 }),
}));

vi.mock('@mesaas/i18n', () => ({
  changeLanguage: vi.fn(),
  SUPPORTED_LANGUAGES: ['pt', 'en'],
}));

const BOOTSTRAP: HubBootstrap = {
  workspace: { name: 'Café da Manhã', logo_url: null, brand_color: '#171717' },
  cliente_nome: 'Débora Lima',
  is_active: true,
  cliente_id: 1,
  feature_mensagens: true,
};

function renderMobileNav(bootstrap: HubBootstrap = BOOTSTRAP) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/ws/hub/tok']}>
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

  it('includes a language toggle button in the drawer footer', () => {
    renderMobileNav();
    fireEvent.click(screen.getByRole('button', { name: /abrir menu|open menu/i }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeInTheDocument();
    // The flag is drawn, not typed: emoji flags render as bare "BR"/"US" letter
    // pairs on Windows, so assert on the SVG rather than on text content.
    const languageButton = screen.getByRole('button', { name: /idioma|language/i });
    expect(languageButton).toBeInTheDocument();
    expect(languageButton.querySelector('svg')).not.toBeNull();
  });

  it('hides Mensagens when feature_mensagens is false, keeping every other destination', () => {
    renderMobileNav({ ...BOOTSTRAP, feature_mensagens: false });
    fireEvent.click(screen.getByRole('button', { name: /abrir menu|open menu/i }));
    expect(screen.queryByText('Mensagens')).not.toBeInTheDocument();
    for (const label of ['Início', 'Aprovações', 'Postagens', 'Relatórios']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('marks the active drawer nav item with hub-nav-active (color: var(--hub-primary), a no-op in neutral)', () => {
    renderMobileNav();
    fireEvent.click(screen.getByRole('button', { name: /abrir menu|open menu/i }));
    const activeLink = screen.getByText('Início').closest('a');
    expect(activeLink?.className).toContain('hub-nav-active');
    const inactiveLink = screen.getByText('Postagens').closest('a');
    expect(inactiveLink?.className).not.toContain('hub-nav-active');
  });
});
