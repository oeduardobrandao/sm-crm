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
      localStorage.setItem('hub-theme-explicit', '1');
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

    it('DOES apply the agency dark default for a returning client with a stored theme value but no explicit-choice marker', async () => {
      // Regression for the auto-persisted-default bug: useTheme's mount effect
      // persists 'hub-theme' on every visit (including the unchosen default
      // 'light'), so a stored value alone must never be read as "the client
      // chose". Only the explicit marker (set by toggleTheme) should suppress
      // the agency's configured dark default.
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
        expect(document.querySelector('.hub-root')?.getAttribute('data-theme')).toBe('dark');
      });
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

    it('ignores non-default preset fields when customized is false (client-side defense in depth)', async () => {
      // hub-bootstrap already fails closed server-side, but the client must not
      // trust surface/font_display/font_body/radius/card_style whenever
      // customized reads false — only customized: true unlocks them. A
      // malformed/stale payload with customized: false alongside non-default
      // fields must still render pixel-identical to the no-hub_theme fallback.
      mockedFetchBootstrap.mockResolvedValue({
        workspace: { name: 'Mesaas', logo_url: null, brand_color: '#0f766e' },
        cliente_nome: 'Clínica Aurora',
        is_active: true,
        cliente_id: 14,
        feature_mensagens: true,
        hub_theme: {
          customized: false,
          surface: 'cool',
          font_display: 'space-grotesk',
          font_body: 'manrope',
          radius: 'pill',
          card_style: 'outline',
          logo_style: 'wordmark',
          logo_dark_url: 'https://cdn.mesaas.com/dark.png',
          hide_branding: true,
          // Left at the neutral 'light' default deliberately — this test isolates
          // the surface/font/radius/card_style preset gating that Finding 1 fixes;
          // default_appearance/hide_branding/logo_* aren't part of that gate (the
          // brief scoped the client-side fix to resolveHubTheme's config inputs
          // only), so keeping this field neutral avoids conflating the two.
          default_appearance: 'light',
        },
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

      // Neutral surface vars, not the 'cool' surface's.
      const styleTag = document.querySelector('style');
      expect(styleTag?.textContent).toContain('--hub-bg: #FAFAFA;');
      expect(styleTag?.textContent).toContain('--hub-primary: var(--hub-txt);');
      // No custom font stylesheet loaded for the (ignored) space-grotesk/manrope pick.
      expect(document.getElementById('hub-custom-fonts')).toBeNull();
    });
  });
});
