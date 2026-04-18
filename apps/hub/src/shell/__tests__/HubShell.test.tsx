import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';

vi.mock('../../api', () => ({
  fetchBootstrap: vi.fn(),
}));
vi.mock('../HubNav', () => ({
  HubNav: () => <nav>Hub nav</nav>,
}));

import { fetchBootstrap } from '../../api';
import { HubShell } from '../HubShell';

const mockedFetchBootstrap = vi.mocked(fetchBootstrap);

describe('HubShell', () => {
  it('bootstraps the hub context and renders its children', async () => {
    mockedFetchBootstrap.mockResolvedValue({
      workspace: {
        name: 'Mesaas',
        logo_url: 'https://cdn.mesaas.com/logo.png',
        brand_color: '#0f766e',
      },
      cliente_nome: 'Clínica Aurora',
      is_active: true,
      cliente_id: 14,
    });

    render(
      <MemoryRouter initialEntries={['/mesaas/hub/token-publico']}>
        <Routes>
          <Route path="/:workspace/hub/:token" element={<HubShell />}>
            <Route index element={<div>Página inicial do hub</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Página inicial do hub')).toBeInTheDocument();
    });

    expect(mockedFetchBootstrap).toHaveBeenCalledWith('mesaas', 'token-publico');
    expect(screen.getByText('Hub nav')).toBeInTheDocument();
  });

  it('renders the invalid link state when bootstrap fails', async () => {
    mockedFetchBootstrap.mockRejectedValue(new Error('Link inválido.'));

    render(
      <MemoryRouter initialEntries={['/mesaas/hub/token-invalido']}>
        <Routes>
          <Route path="/:workspace/hub/:token" element={<HubShell />}>
            <Route index element={<Outlet />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Link inválido ou expirado.')).toBeInTheDocument();
    });

    expect(screen.getByText('Link inválido.')).toBeInTheDocument();
  });
});
