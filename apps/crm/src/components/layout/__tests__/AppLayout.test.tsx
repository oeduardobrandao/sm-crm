import { act, fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../Sidebar', () => ({
  default: ({ isDrawer, isOpen }: { isDrawer?: boolean; isOpen?: boolean }) => (
    <div
      data-testid="sidebar"
      data-drawer={String(Boolean(isDrawer))}
      data-open={String(Boolean(isOpen))}
    >
      Sidebar
    </div>
  ),
}));

vi.mock('../MobileNav', () => ({
  default: () => <div data-testid="mobile-nav">Mobile nav</div>,
}));

vi.mock('../TopBar', () => ({
  default: ({ showHamburger, isDrawerOpen, onHamburgerClick }: {
    showHamburger?: boolean;
    isDrawerOpen?: boolean;
    onHamburgerClick?: () => void;
  }) => (
    <div data-testid="topbar">
      {showHamburger && (
        <button
          type="button"
          onClick={onHamburgerClick}
          aria-label={isDrawerOpen ? 'Fechar menu' : 'Abrir menu'}
        >
          Menu
        </button>
      )}
    </div>
  ),
}));

vi.mock('../GlobalBannerContainer', () => ({
  default: () => null,
}));

import AppLayout from '../AppLayout';

function setViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  });
}

function createMediaQuery(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();

  return {
    get matches() { return matches; },
    media: '',
    addEventListener: vi.fn((_event: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    }),
    removeEventListener: vi.fn((_event: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    }),
    dispatch(nextMatches: boolean) {
      matches = nextMatches;
      listeners.forEach((listener) => listener({ matches: nextMatches } as MediaQueryListEvent));
    },
  };
}

function mockMatchMedia(tabletMatches: boolean) {
  const tabletQuery = createMediaQuery(tabletMatches);
  const mobileQuery = createMediaQuery(false);

  vi.stubGlobal('matchMedia', vi.fn((query: string) => {
    if (query.includes('max-width: 767px')) return mobileQuery;
    return tabletQuery;
  }));

  return tabletQuery;
}

function renderLayout(pathname = '/dashboard') {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route
            path="/dashboard"
            element={(
              <div>
                <div>Dashboard screen</div>
                <Link to="/clientes">Ir para clientes</Link>
              </div>
            )}
          />
          <Route path="/clientes" element={<div>Clientes screen</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('AppLayout', () => {
  it('renders the desktop shell without tablet drawer controls', () => {
    setViewport(1280);
    mockMatchMedia(false);

    renderLayout();

    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-drawer', 'false');
    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-open', 'false');
    expect(screen.queryByRole('button', { name: 'Abrir menu' })).not.toBeInTheDocument();
    expect(screen.getByTestId('mobile-nav')).toBeInTheDocument();
  });

  it('opens and closes the tablet drawer, then resets when leaving tablet mode', () => {
    setViewport(900);
    const mediaQueryList = mockMatchMedia(true);

    renderLayout();

    expect(screen.getByRole('button', { name: 'Abrir menu' })).toBeInTheDocument();
    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-drawer', 'true');
    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-open', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Abrir menu' }));
    expect(screen.getByRole('button', { name: 'Fechar menu' })).toBeInTheDocument();
    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-open', 'true');
    expect(document.querySelector('.tablet-drawer-backdrop')).not.toBeNull();

    fireEvent.click(document.querySelector('.tablet-drawer-backdrop')!);
    expect(screen.getByRole('button', { name: 'Abrir menu' })).toBeInTheDocument();
    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-open', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Abrir menu' }));
    act(() => {
      mediaQueryList.dispatch(false);
    });

    expect(screen.queryByRole('button', { name: 'Fechar menu' })).not.toBeInTheDocument();
    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-drawer', 'false');
    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-open', 'false');
    expect(document.querySelector('.tablet-drawer-backdrop')).toBeNull();
  });

  it('scrolls the main content back to the top when the route changes', () => {
    setViewport(1280);
    mockMatchMedia(false);

    const { container } = renderLayout();
    const main = container.querySelector('#app') as HTMLDivElement;

    main.scrollTop = 180;
    fireEvent.click(screen.getByText('Ir para clientes'));

    expect(screen.getByText('Clientes screen')).toBeInTheDocument();
    expect(main.scrollTop).toBe(0);
  });
});
