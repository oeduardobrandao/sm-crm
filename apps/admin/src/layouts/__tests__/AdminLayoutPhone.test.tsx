import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserRouter, createMemoryRouter, RouterProvider } from 'react-router-dom';
import { mockPhone } from '../../__tests__/phone';

const { signOut, glass } = vi.hoisted(() => ({
  signOut: vi.fn(),
  glass: { enabled: false, toggle: vi.fn() },
}));
vi.mock('../../context/AdminAuthContext', () => ({
  useAdminAuth: () => ({ adminEmail: 'admin@mesaas.com.br', signOut }),
}));
vi.mock('../../liquidglass/LiquidGlassProvider', () => ({ useLiquidGlassContext: () => glass }));
vi.mock('../../liquidglass/LiquidBackdrop', () => ({ LiquidBackdrop: () => null }));

import AdminLayout from '../AdminLayout';

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      {
        path: '/admin',
        element: <AdminLayout />,
        children: [
          { index: true, element: <p>dash</p> },
          { path: 'workspaces', element: <p>lista</p> },
          { path: 'workspaces/:id', element: <p>detalhe</p> },
          { path: 'plans', element: <p>planos</p> },
          { path: 'kb-articles/new', element: <p>editor</p> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

/**
 * A matchMedia whose `matches` can change and whose change listeners are captured, so a test
 * can cross 768px the way rotating an iPhone to landscape does. `restore` (from mockPhone in
 * beforeEach) still puts the original back. Starts in phone mode.
 */
function controllableMatchMedia() {
  const listeners: Array<() => void> = [];
  let matches = true;
  window.matchMedia = ((query: string) => ({
    get matches() {
      return matches;
    },
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: (_: string, cb: () => void) => listeners.push(cb),
    removeEventListener: (_: string, cb: () => void) => {
      const i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    },
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  return (phone: boolean) => {
    matches = phone;
    listeners.slice().forEach((l) => l());
  };
}

/** Real window.history (createMemoryRouter never writes it), starting at `/admin`. */
function renderOnRealHistory() {
  window.history.replaceState(null, '', '/admin');
  const router = createBrowserRouter([
    {
      path: '/admin',
      element: <AdminLayout />,
      children: [
        { index: true, element: <p>dash</p> },
        { path: 'plans', element: <p>planos</p> },
      ],
    },
  ]);
  render(<RouterProvider router={router} />);
  return router;
}

function historyIdx(): number {
  return (window.history.state as { idx: number }).idx;
}

describe('AdminLayout on phones', () => {
  let restore: () => void;
  beforeEach(() => {
    restore = mockPhone();
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    glass.enabled = false;
    glass.toggle.mockClear();
    signOut.mockClear();
  });
  afterEach(() => restore());

  it('shows the tab bar, no sidebar', () => {
    renderAt('/admin');
    const nav = screen.getByRole('navigation', { name: 'Navegação principal' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Dashboard', 'Métricas', 'Workspaces', 'Afiliados']);
    expect(within(nav).getByRole('button', { name: 'Mais' })).toBeInTheDocument();
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('marks the parent tab on a child route and leaves Mais unmarked', () => {
    renderAt('/admin/workspaces/42');
    expect(screen.getByRole('link', { name: 'Workspaces' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: 'Mais' })).not.toHaveAttribute('aria-current');
  });

  it('Mais is current on a Mais route', () => {
    renderAt('/admin/plans');
    expect(screen.getByRole('button', { name: 'Mais' })).toHaveAttribute('aria-current', 'page');
  });

  it('hides the tab bar on pushed editors', () => {
    renderAt('/admin/kb-articles/new');
    expect(screen.getByText('editor')).toBeInTheDocument();
    expect(
      screen.queryByRole('navigation', { name: 'Navegação principal' }),
    ).not.toBeInTheDocument();
  });

  it('Mais lists the other pages, account and Sair; a row navigates and closes', async () => {
    const router = renderAt('/admin');
    fireEvent.click(screen.getByRole('button', { name: 'Mais' }));
    const sheet = screen.getByRole('dialog');
    for (const label of [
      'Planos',
      'Admins',
      'Integrações',
      'Banners',
      'Popups',
      'Artigos',
      'Vídeos',
      'Sair',
    ]) {
      expect(within(sheet).getByText(label)).toBeInTheDocument();
    }
    expect(within(sheet).getByText('admin@mesaas.com.br')).toBeInTheDocument();
    fireEvent.click(within(sheet).getByText('Planos'));
    expect(await screen.findByText('planos')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/admin/plans');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('a Mais row replaces the sheet entry in real history, so Back returns to the dashboard', async () => {
    renderOnRealHistory();
    const start = historyIdx();
    fireEvent.click(screen.getByRole('button', { name: 'Mais' }));
    expect(historyIdx()).toBe(start + 1);
    fireEvent.click(within(screen.getByRole('dialog')).getByText('Planos'));
    await waitFor(() => expect(window.location.pathname).toBe('/admin/plans'));
    expect(await screen.findByText('planos')).toBeInTheDocument();
    // One step forward from where the sheet opened: no dead sheet entry left behind.
    expect(historyIdx()).toBe(start + 1);
    act(() => window.history.back());
    await waitFor(() => expect(window.location.pathname).toBe('/admin'));
    expect(historyIdx()).toBe(start);
  });

  it('crossing 768px with Mais open pops the sheet entry', async () => {
    const flip = controllableMatchMedia();
    renderOnRealHistory();
    const start = historyIdx();
    fireEvent.click(screen.getByRole('button', { name: 'Mais' }));
    expect(historyIdx()).toBe(start + 1);

    await act(async () => flip(false));

    expect(screen.getByRole('complementary')).toBeInTheDocument();
    expect(document.querySelector('.admin-tab-bar')).toBeNull();
    await waitFor(() => expect(historyIdx()).toBe(start));
    expect(window.location.pathname).toBe('/admin');
  });

  it('Sair in Mais signs out', () => {
    renderAt('/admin');
    fireEvent.click(screen.getByRole('button', { name: 'Mais' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByText('Sair'));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('theme switch only shows with glass off; glass switch calls toggle', () => {
    renderAt('/admin');
    fireEvent.click(screen.getByRole('button', { name: 'Mais' }));
    const themeSwitch = screen.getByRole('switch', { name: /Tema escuro/ });
    expect(themeSwitch).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(themeSwitch);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('admin-theme')).toBe('light');
    fireEvent.click(screen.getByRole('switch', { name: /Liquid Glass/ }));
    expect(glass.toggle).toHaveBeenCalled();
  });

  it('hides the theme switch while glass is on', () => {
    glass.enabled = true;
    renderAt('/admin');
    fireEvent.click(screen.getByRole('button', { name: 'Mais' }));
    expect(screen.getByRole('switch', { name: /Liquid Glass/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.queryByRole('switch', { name: /Tema escuro/ })).not.toBeInTheDocument();
  });

  it('keeps the outlet mounted when the breakpoint flips', () => {
    const flip = controllableMatchMedia();

    renderAt('/admin');
    const before = screen.getByText('dash');
    expect(screen.getByRole('navigation', { name: 'Navegação principal' })).toHaveClass(
      'admin-tab-bar',
    );
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();

    act(() => {
      flip(false);
    });

    // The flip really happened: desktop chrome is up, the tab bar is gone.
    expect(screen.getByRole('complementary')).toBeInTheDocument();
    expect(document.querySelector('.admin-tab-bar')).toBeNull();
    // And the route element is the very same DOM node.
    expect(screen.getByText('dash')).toBe(before);

    act(() => {
      flip(true);
    });
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    expect(screen.getByText('dash')).toBe(before);
  });
});
