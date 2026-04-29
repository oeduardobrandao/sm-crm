import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { HubContext } from '../../HubContext';

vi.mock('../../hooks/useTheme', () => ({
  useTheme: vi.fn(),
}));

import { useTheme } from '../../hooks/useTheme';
import { HubNav } from '../HubNav';

const mockedUseTheme = vi.mocked(useTheme);

const bootstrap = {
  workspace: {
    name: 'Mesaas',
    logo_url: 'https://cdn.mesaas.com/logo.png',
    brand_color: '#0f766e',
  },
  cliente_nome: 'Clínica Aurora',
  is_active: true,
  cliente_id: 14,
};

function renderHubNav(pathname: string, logoUrl = bootstrap.workspace.logo_url) {
  return render(
    <HubContext.Provider value={{ bootstrap: { ...bootstrap, workspace: { ...bootstrap.workspace, logo_url: logoUrl } }, token: 'token-publico', workspace: 'mesaas' }}>
      <MemoryRouter initialEntries={[pathname]}>
        <Routes>
          <Route path="/:workspace/hub/:token/*" element={<HubNav />} />
        </Routes>
      </MemoryRouter>
    </HubContext.Provider>,
  );
}

describe('HubNav', () => {
  it('renders workspace branding, client details, and the route-aware links', () => {
    mockedUseTheme.mockReturnValue({
      theme: 'dark',
      toggleTheme: vi.fn(),
    });

    renderHubNav('/mesaas/hub/token-publico/paginas/42');

    expect(screen.getAllByText('Mesaas')).toHaveLength(2);
    expect(screen.getAllByText('Clínica Aurora')).toHaveLength(2);
    expect(screen.getAllByAltText('Mesaas')).toHaveLength(2);

    const paginasLinks = screen.getAllByRole('link', { name: 'Páginas' });
    expect(paginasLinks[0]).toHaveAttribute('href', '/mesaas/hub/token-publico/paginas');
    expect(paginasLinks[0]).toHaveClass('bg-white/10');

    expect(screen.getAllByRole('button', { name: 'Modo Claro' })).toHaveLength(2);
  });

  it('marks the home route as active and toggles the theme when requested', () => {
    const toggleTheme = vi.fn();
    mockedUseTheme.mockReturnValue({
      theme: 'light',
      toggleTheme,
    });

    renderHubNav('/mesaas/hub/token-publico', null);

    const homeLinks = screen.getAllByRole('link', { name: 'Home' });
    expect(homeLinks[0]).toHaveAttribute('href', '/mesaas/hub/token-publico');
    expect(homeLinks[0]).toHaveClass('bg-white/10');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Modo Escuro' })[0]);
    expect(toggleTheme).toHaveBeenCalled();
  });
});
