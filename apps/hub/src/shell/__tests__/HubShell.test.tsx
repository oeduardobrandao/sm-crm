import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router-dom';

vi.mock('../../api', () => ({
  fetchBootstrap: vi.fn(),
}));
vi.mock('../HubSidebar', () => ({
  HubSidebar: () => <nav>Hub sidebar</nav>,
}));
vi.mock('../HubMobileNav', () => ({
  HubMobileNav: () => <nav>Hub mobile nav</nav>,
}));

import { fetchBootstrap } from '../../api';
import { HubShell } from '../HubShell';

const mockedFetchBootstrap = vi.mocked(fetchBootstrap);

describe('HubShell', () => {
  beforeEach(() => {
    mockedFetchBootstrap.mockReset();
    document.head.innerHTML = '';
    localStorage.clear();
  });

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
      feature_mensagens: true,
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
    expect(screen.getByText('Hub sidebar')).toBeInTheDocument();
    expect(screen.getByText('Hub mobile nav')).toBeInTheDocument();
    await waitFor(() => {
      expect(document.querySelector("link[rel='icon']")).toHaveAttribute(
        'href',
        'https://cdn.mesaas.com/logo.png',
      );
    });
  });

  it('injects resolved --hub-* CSS variables based on workspace brand_color and theme', async () => {
    mockedFetchBootstrap.mockResolvedValue({
      workspace: {
        name: 'Mesaas',
        logo_url: null,
        brand_color: '#0f766e',
      },
      cliente_nome: 'Clínica Aurora',
      is_active: true,
      cliente_id: 14,
      feature_mensagens: true,
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

    const styleTag = document.querySelector('style');
    expect(styleTag?.textContent).toContain('--hub-acc:');
    expect(styleTag?.textContent).toContain('--hub-bg:');
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

  it('renders the disabled state when the hub access is inactive', async () => {
    mockedFetchBootstrap.mockResolvedValue({
      workspace: {
        name: 'Mesaas',
        logo_url: 'https://cdn.mesaas.com/logo.png',
        brand_color: '#0f766e',
      },
      cliente_nome: 'Clínica Aurora',
      is_active: false,
      cliente_id: 14,
      feature_mensagens: true,
    });

    render(
      <MemoryRouter initialEntries={['/mesaas/hub/token-desativado']}>
        <Routes>
          <Route path="/:workspace/hub/:token" element={<HubShell />}>
            <Route index element={<Outlet />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Acesso desativado.')).toBeInTheDocument();
    });

    expect(screen.getByText('Entre em contato com a agência.')).toBeInTheDocument();
  });

  describe('hub_theme customization', () => {
    const CUSTOM_THEME_BASE = {
      customized: true,
      surface: 'neutral' as const,
      font_display: 'fraunces',
      font_body: 'instrument-sans',
      radius: 'soft' as const,
      card_style: 'filled' as const,
      logo_style: 'round' as const,
      logo_dark_url: null,
      hide_branding: false,
      default_appearance: 'light' as const,
    };

    it('renders with neutral defaults when hub_theme is absent (old-function fallback lock)', async () => {
      mockedFetchBootstrap.mockResolvedValue({
        workspace: { name: 'Mesaas', logo_url: null, brand_color: '#0f766e' },
        cliente_nome: 'Clínica Aurora',
        is_active: true,
        cliente_id: 14,
        feature_mensagens: true,
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

      const styleTag = document.querySelector('style');
      expect(styleTag?.textContent).toContain('--hub-primary: var(--hub-txt);');
      expect(screen.getByText('powered by')).toBeInTheDocument();
      expect(document.getElementById('hub-custom-fonts')).toBeNull();
    });

    it('hides the powered-by mark when hide_branding is true', async () => {
      mockedFetchBootstrap.mockResolvedValue({
        workspace: { name: 'Mesaas', logo_url: null, brand_color: '#0f766e' },
        cliente_nome: 'Clínica Aurora',
        is_active: true,
        cliente_id: 14,
        feature_mensagens: true,
        hub_theme: { ...CUSTOM_THEME_BASE, hide_branding: true },
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

      expect(screen.queryByText('powered by')).not.toBeInTheDocument();
    });

    it('shows the powered-by mark when hide_branding is false', async () => {
      mockedFetchBootstrap.mockResolvedValue({
        workspace: { name: 'Mesaas', logo_url: null, brand_color: '#0f766e' },
        cliente_nome: 'Clínica Aurora',
        is_active: true,
        cliente_id: 14,
        feature_mensagens: true,
        hub_theme: { ...CUSTOM_THEME_BASE, hide_branding: false },
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

      expect(screen.getByText('powered by')).toBeInTheDocument();
    });

    it('applies the dark default appearance on first visit (no stored preference)', async () => {
      localStorage.clear();
      mockedFetchBootstrap.mockResolvedValue({
        workspace: { name: 'Mesaas', logo_url: null, brand_color: '#0f766e' },
        cliente_nome: 'Clínica Aurora',
        is_active: true,
        cliente_id: 14,
        feature_mensagens: true,
        hub_theme: { ...CUSTOM_THEME_BASE, default_appearance: 'dark' },
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
        expect(document.querySelector('.hub-root')?.getAttribute('data-theme')).toBe('dark');
      });
    });

    it('does NOT override an explicit stored preference with the agency dark default', async () => {
      localStorage.setItem('hub-theme', 'light');
      mockedFetchBootstrap.mockResolvedValue({
        workspace: { name: 'Mesaas', logo_url: null, brand_color: '#0f766e' },
        cliente_nome: 'Clínica Aurora',
        is_active: true,
        cliente_id: 14,
        feature_mensagens: true,
        hub_theme: { ...CUSTOM_THEME_BASE, default_appearance: 'dark' },
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

      expect(document.querySelector('.hub-root')?.getAttribute('data-theme')).toBeNull();
    });

    it('appends a font <link> for non-default fonts', async () => {
      mockedFetchBootstrap.mockResolvedValue({
        workspace: { name: 'Mesaas', logo_url: null, brand_color: '#0f766e' },
        cliente_nome: 'Clínica Aurora',
        is_active: true,
        cliente_id: 14,
        feature_mensagens: true,
        hub_theme: { ...CUSTOM_THEME_BASE, font_display: 'space-grotesk', font_body: 'manrope' },
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

      await waitFor(() => {
        const link = document.getElementById('hub-custom-fonts') as HTMLLinkElement | null;
        expect(link).not.toBeNull();
        expect(link?.href).toContain('Space+Grotesk');
        expect(link?.href).toContain('Manrope');
      });
    });

    it('does not append a font <link> for the default font pairing', async () => {
      mockedFetchBootstrap.mockResolvedValue({
        workspace: { name: 'Mesaas', logo_url: null, brand_color: '#0f766e' },
        cliente_nome: 'Clínica Aurora',
        is_active: true,
        cliente_id: 14,
        feature_mensagens: true,
        hub_theme: CUSTOM_THEME_BASE,
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

      expect(document.getElementById('hub-custom-fonts')).toBeNull();
    });
  });
});
