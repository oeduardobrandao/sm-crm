import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from '../../../context/AuthContext';
import ConfiguracaoLayout from '../ConfiguracaoLayout';

const mockedUseAuth = vi.mocked(useAuth);

function setAuth(role: string | null, { loading = false, signedIn = true } = {}) {
  mockedUseAuth.mockReturnValue({
    user: signedIn ? { id: 'u1', email: 'a@b.c' } : null,
    profile: { nome: 'Débora Kristin' },
    role,
    loading,
    signOut: vi.fn(),
    refetchProfile: vi.fn(),
  } as never);
}

function PathProbe() {
  return <span data-testid="path">{useLocation().pathname}</span>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/configuracao" element={<ConfiguracaoLayout />}>
          <Route path="perfil" element={<div>conteudo perfil</div>} />
          <Route path="membros" element={<div>conteudo membros</div>} />
          <Route path="cobranca" element={<div>conteudo cobranca</div>} />
        </Route>
      </Routes>
      <PathProbe />
    </MemoryRouter>,
  );
}

function tabLabels() {
  return screen.queryAllByRole('link').map((el) => el.textContent);
}

describe('ConfiguracaoLayout', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders one tab per section an owner may see', () => {
    setAuth('owner');
    renderAt('/configuracao/perfil');
    expect(tabLabels()).toEqual([
      'Perfil',
      'Workspace',
      'Membros',
      'Relatórios',
      'Claude (MCP)',
      'Plano & Cobrança',
    ]);
  });

  it('hides billing from an admin', () => {
    setAuth('admin');
    renderAt('/configuracao/perfil');
    expect(tabLabels()).not.toContain('Plano & Cobrança');
    expect(tabLabels()).toContain('Membros');
  });

  it('renders no tab strip for an agent, who has only one section', () => {
    setAuth('agent');
    renderAt('/configuracao/perfil');
    expect(tabLabels()).toEqual([]);
    expect(screen.getByText('conteudo perfil')).toBeInTheDocument();
  });

  it('redirects an agent who opens a staff-only tab by URL', () => {
    setAuth('agent');
    renderAt('/configuracao/membros');
    expect(screen.getByTestId('path')).toHaveTextContent('/configuracao/perfil');
    expect(screen.queryByText('conteudo membros')).not.toBeInTheDocument();
  });

  it('redirects an admin away from the owner-only billing tab', () => {
    setAuth('admin');
    renderAt('/configuracao/cobranca');
    expect(screen.getByTestId('path')).toHaveTextContent('/configuracao/perfil');
    expect(screen.queryByText('conteudo cobranca')).not.toBeInTheDocument();
  });

  it('lets an owner open billing directly', () => {
    setAuth('owner');
    renderAt('/configuracao/cobranca');
    expect(screen.getByText('conteudo cobranca')).toBeInTheDocument();
  });

  it('marks the current tab active', () => {
    setAuth('owner');
    renderAt('/configuracao/membros');
    const active = screen.getAllByRole('link').filter((el) => el.className.includes('active'));
    expect(active.map((el) => el.textContent)).toEqual(['Membros']);
  });

  it('waits for the role instead of flashing the agent-sized strip', () => {
    // role is briefly null while the profile loads; rendering then would show an
    // owner a one-tab strip and bounce them off tabs they are allowed to see.
    setAuth(null, { loading: true });
    renderAt('/configuracao/membros');
    expect(tabLabels()).toEqual([]);
    expect(screen.getByTestId('path')).toHaveTextContent('/configuracao/membros');
  });
});
