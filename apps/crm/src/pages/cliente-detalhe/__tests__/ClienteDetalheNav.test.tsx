import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Cliente } from '../../../store';

vi.mock('../../../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from '../../../context/AuthContext';
import { ClienteDetalheNav } from '../ClienteDetalheNav';

const mockedUseAuth = vi.mocked(useAuth);

const CLIENTE = { id: 42, nome: 'Aurora' } as Cliente;

function setAuth(workspaceRole: string | null, canSeeFinancials: boolean | 'unknown' = true) {
  mockedUseAuth.mockReturnValue({ workspaceRole, canSeeFinancials } as never);
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

  it('hides relatorios and financeiro for an agent', () => {
    setAuth('agent', false);
    renderNav('/clientes/42/visao-geral');
    const links = screen.getAllByRole('link').map((l) => l.textContent);
    expect(links).not.toContain('Relatórios');
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
});
