import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Cliente } from '../../../store';

vi.mock('../../../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from '../../../context/AuthContext';
import { ClienteDetalheNav } from '../ClienteDetalheNav';
import { makeCan, fakeMembership } from '@/test/makeCan';

const mockedUseAuth = vi.mocked(useAuth);

const CLIENTE = { id: 42, nome: 'Aurora' } as Cliente;

function setAuth(workspaceRole: string | null, canSeeFinancials: boolean | 'unknown' = true) {
  const can = makeCan(
    workspaceRole === null
      ? null
      : fakeMembership({
          role: workspaceRole as 'owner' | 'admin' | 'agent',
          can_see_financials: canSeeFinancials === true,
        }),
  );
  mockedUseAuth.mockReturnValue({ workspaceRole, canSeeFinancials, can } as never);
}

function renderNav(path = '/clientes/42/entregas') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ClienteDetalheNav clienteId={42} cliente={CLIENTE} />
    </MemoryRouter>,
  );
}

describe('ClienteDetalheNav', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders one link per visible tab, grouped, in order, for an owner', () => {
    setAuth('owner', true);
    renderNav();
    const links = screen.getAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual([
      'Visão geral',
      'Entregas',
      'Redes sociais',
      'Relatórios',
      'Hub',
      'Arquivos',
      'Financeiro',
    ]);
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/clientes/42/visao-geral',
      '/clientes/42/entregas',
      '/clientes/42/redes-sociais',
      '/clientes/42/relatorios',
      '/clientes/42/hub',
      '/clientes/42/arquivos',
      '/clientes/42/financeiro',
    ]);
  });

  it('renders group headings before the first tab of each group only', () => {
    setAuth('owner', true);
    renderNav();
    expect(screen.getByText('Cliente')).toBeInTheDocument();
    expect(screen.getByText('Canais e análise')).toBeInTheDocument();
    expect(screen.getByText('Gestão')).toBeInTheDocument();
  });

  it('shows relatorios (agent preset grants analytics:ver) but hides hub and financeiro for an agent', () => {
    // Task 12: `relatorios` now maps to {analytics,ver}, which the legacy
    // agent preset already grants; `hub` now maps to {configuracoes,editar},
    // which it has never had. See clienteTabs.model.test.ts for the full
    // truth-table coverage of this divergence from the old role-list model.
    setAuth('agent', false);
    renderNav('/clientes/42/visao-geral');
    const links = screen.getAllByRole('link').map((l) => l.textContent);
    expect(links).toContain('Relatórios');
    expect(links).not.toContain('Hub');
    expect(links).not.toContain('Financeiro');
  });

  it('marks the active tab via aria-current, matching the current route', () => {
    setAuth('owner', true);
    renderNav('/clientes/42/entregas');
    expect(screen.getByRole('link', { name: 'Entregas' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Visão geral' })).not.toHaveAttribute('aria-current');
  });

  it('does not use IntersectionObserver or scrollIntoView', () => {
    const observeSpy = vi.fn();
    const originalIO = (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
      observe = observeSpy;
      unobserve = vi.fn();
      disconnect = vi.fn();
    };
    const scrollIntoViewSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoViewSpy;

    setAuth('owner', true);
    renderNav();

    expect(observeSpy).not.toHaveBeenCalled();
    expect(scrollIntoViewSpy).not.toHaveBeenCalled();
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = originalIO;
  });

  describe('mobile scroll-into-view', () => {
    // Layout getters jsdom otherwise hardcodes to 0. Overridden with fixed
    // values (not per-element) so the math below is deterministic:
    // centeredLeft = 800 - (300 - 100) / 2 = 700; maxLeft = 1200 - 300 = 900
    // -> clamped scroll target is 700, distinct from the untouched 0.
    function stubLayout() {
      const offsetLeftDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetLeft');
      const offsetWidthDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
      const clientWidthDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth');
      const scrollWidthDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollWidth');
      Object.defineProperty(HTMLElement.prototype, 'offsetLeft', {
        configurable: true,
        value: 800,
      });
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
        configurable: true,
        value: 100,
      });
      Object.defineProperty(Element.prototype, 'clientWidth', { configurable: true, value: 300 });
      Object.defineProperty(Element.prototype, 'scrollWidth', { configurable: true, value: 1200 });
      return () => {
        const restore = (target: object, prop: string, desc: PropertyDescriptor | undefined) => {
          if (desc) Object.defineProperty(target, prop, desc);
          else delete (target as Record<string, unknown>)[prop];
        };
        restore(HTMLElement.prototype, 'offsetLeft', offsetLeftDesc);
        restore(HTMLElement.prototype, 'offsetWidth', offsetWidthDesc);
        restore(Element.prototype, 'clientWidth', clientWidthDesc);
        restore(Element.prototype, 'scrollWidth', scrollWidthDesc);
      };
    }

    function stubMobileMatchMedia() {
      const original = window.matchMedia;
      window.matchMedia = vi.fn((query: string) => ({
        matches: query === '(max-width: 1100px)',
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })) as unknown as typeof window.matchMedia;
      return () => {
        window.matchMedia = original;
      };
    }

    it('scrolls the active tab into view via scrollTo when it is outside the visible strip', () => {
      const restoreLayout = stubLayout();
      const restoreMatchMedia = stubMobileMatchMedia();
      const scrollToSpy = vi.fn();
      Element.prototype.scrollTo = scrollToSpy;

      setAuth('owner', true);
      renderNav('/clientes/42/financeiro');

      expect(scrollToSpy).toHaveBeenCalledWith({ left: 700, behavior: 'smooth' });

      restoreMatchMedia();
      restoreLayout();
    });

    it('does not scroll above the 1100px breakpoint (static desktop sidebar, no overflow strip)', () => {
      const restoreLayout = stubLayout();
      const scrollToSpy = vi.fn();
      Element.prototype.scrollTo = scrollToSpy;
      // Default test matchMedia mock (test/vitest.setup.ts) always returns
      // matches: false, i.e. simulates a desktop viewport here.

      setAuth('owner', true);
      renderNav('/clientes/42/financeiro');

      expect(scrollToSpy).not.toHaveBeenCalled();

      restoreLayout();
    });
  });
});
