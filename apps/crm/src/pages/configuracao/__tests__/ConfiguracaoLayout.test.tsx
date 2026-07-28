import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

import { useAuth } from '../../../context/AuthContext';
import ConfiguracaoLayout from '../ConfiguracaoLayout';

const mockedUseAuth = vi.mocked(useAuth);

/**
 * `workspaceRole` (from `workspace_members`, correct per workspace) is the
 * source this layout gates on. `role` (from `profiles.role`) goes stale on
 * workspace switch — nothing writes it on switch — so it defaults here to a
 * DIFFERENT value than `workspaceRole` unless a test overrides it, to make
 * sure no assertion could accidentally pass by reading the stale field.
 */
function setAuth(
  workspaceRole: string | null,
  {
    loading = false,
    signedIn = true,
    staleProfileRole = workspaceRole === 'owner' ? 'agent' : 'owner',
  }: { loading?: boolean; signedIn?: boolean; staleProfileRole?: string | null } = {},
) {
  mockedUseAuth.mockReturnValue({
    user: signedIn ? { id: 'u1', email: 'a@b.c' } : null,
    profile: { nome: 'Débora Kristin' },
    role: staleProfileRole,
    workspaceRole,
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

  it('never renders the tab strip or bounces while workspaceRole is null, loading or resolved', () => {
    // Whether workspaceRole is null because loading:true (unresolved) or
    // because loading:false (genuinely no membership row / live-revoked —
    // see the dedicated "removed from workspace" test below), the guard must
    // never run `canAccessConfigTab` with a null role: that would redirect a
    // real owner off /membros before their real role arrives.
    setAuth(null, { loading: false });
    renderAt('/configuracao/membros');
    expect(tabLabels()).toEqual([]);
    expect(screen.queryByText('conteudo membros')).not.toBeInTheDocument();
    expect(screen.getByTestId('path')).toHaveTextContent('/configuracao/membros');
  });

  it('shows a short explanatory message instead of spinning forever once workspaceRole resolves to no membership', () => {
    // Regression: live revocation sets workspaceRole to null when a
    // membership row disappears mid-session. Gating the spinner on
    // `workspaceRole === null` (same as the `loading` case above) left a
    // removed user stuck on the spinner indefinitely, since nothing was ever
    // going to make workspaceRole non-null again. `loading:false` is the
    // signal that the lookup has actually settled, so this state must render
    // a message, not the spinner.
    setAuth(null, { loading: false });
    const { container } = renderAt('/configuracao/membros');
    expect(screen.getByText('Sem acesso a este workspace')).toBeInTheDocument();
    expect(container.querySelector('.animate-spin')).not.toBeInTheDocument();
  });

  it('shows the spinner (not the removed-from-workspace message) while still loading', () => {
    setAuth(null, { loading: true });
    const { container } = renderAt('/configuracao/membros');
    expect(screen.queryByText('Sem acesso a este workspace')).not.toBeInTheDocument();
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('lets a genuine owner reach Membros even when profiles.role is stale ("agent")', () => {
    // The motivating bug: profiles.role never gets rewritten on workspace
    // switch, so an owner who switched workspaces can be stuck reading
    // role: 'agent'. workspaceRole (from workspace_members) is correct and
    // must be what gates the tab strip and the route guard.
    setAuth('owner', { staleProfileRole: 'agent' });
    renderAt('/configuracao/membros');
    expect(tabLabels()).toContain('Membros');
    expect(screen.getByText('conteudo membros')).toBeInTheDocument();
    expect(screen.getByTestId('path')).toHaveTextContent('/configuracao/membros');
  });

  it('blocks a real agent from Membros even when profiles.role stale-reads "owner"', () => {
    // The converse: a stale profiles.role of 'owner' must not grant access
    // to someone whose real, current-workspace role is agent.
    setAuth('agent', { staleProfileRole: 'owner' });
    renderAt('/configuracao/membros');
    expect(tabLabels()).toEqual([]);
    expect(screen.queryByText('conteudo membros')).not.toBeInTheDocument();
    expect(screen.getByTestId('path')).toHaveTextContent('/configuracao/perfil');
  });
});
