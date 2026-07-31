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
    // Defaults to a fully-resolved membership: the vast majority of cases
    // here (owner/admin/agent, or loading:true) don't care about this value
    // at all. Only the null-workspaceRole tests below set it explicitly to
    // distinguish "genuinely removed" (true) from "lookup errored" ('error').
    membershipResolved = true as boolean | 'error',
  }: {
    loading?: boolean;
    signedIn?: boolean;
    staleProfileRole?: string | null;
    membershipResolved?: boolean | 'error';
  } = {},
) {
  mockedUseAuth.mockReturnValue({
    user: signedIn ? { id: 'u1', email: 'a@b.c' } : null,
    profile: { nome: 'Débora Kristin' },
    role: staleProfileRole,
    workspaceRole,
    membershipResolved,
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
      'Hub',
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

  it.each([
    { loading: true, membershipResolved: false as const, label: 'still hydrating' },
    { loading: false, membershipResolved: true as const, label: 'resolved: genuinely removed' },
    { loading: false, membershipResolved: 'error' as const, label: 'resolved: lookup errored' },
  ])(
    'never renders the tab strip or bounces while workspaceRole is null ($label)',
    ({ loading, membershipResolved }) => {
      // Whatever the reason workspaceRole is null -- still hydrating,
      // genuinely removed, or a transient lookup error -- the guard must
      // never run `canAccessConfigTab`/render tabs with a null role: that
      // would either flash tabs or redirect a real owner off /membros
      // before their real role arrives. WHICH terminal UI renders (spinner,
      // the "removed" card, or the "couldn't confirm" card) is asserted by
      // the dedicated tests below; this one only guards the tab logic
      // itself, and previously only ever exercised the `loading:false`
      // case despite its title claiming to cover "loading or resolved" too
      // -- its three assertions held identically for the spinner and the
      // card, so it could never have failed for the thing its title named.
      setAuth(null, { loading, membershipResolved });
      renderAt('/configuracao/membros');
      expect(tabLabels()).toEqual([]);
      expect(screen.queryByText('conteudo membros')).not.toBeInTheDocument();
      expect(screen.getByTestId('path')).toHaveTextContent('/configuracao/membros');
    },
  );

  it('shows a short explanatory message instead of spinning forever once workspaceRole resolves to no membership', () => {
    // Regression: live revocation sets workspaceRole to null when a
    // membership row disappears mid-session. Gating the spinner on
    // `workspaceRole === null` (same as the `loading` case above) left a
    // removed user stuck on the spinner indefinitely, since nothing was ever
    // going to make workspaceRole non-null again. `loading:false` is the
    // signal that the lookup has actually settled, so this state must render
    // a message, not the spinner. `membershipResolved:true` is what makes
    // this the DEFINITIVE "removed" card rather than the "couldn't confirm"
    // one below -- see that test for the errored-lookup case.
    setAuth(null, { loading: false, membershipResolved: true });
    const { container } = renderAt('/configuracao/membros');
    expect(screen.getByText('Sem acesso a este workspace')).toBeInTheDocument();
    expect(container.querySelector('.animate-spin')).not.toBeInTheDocument();
  });

  it('shows a could-not-confirm message with a retry action, not the removed-from-workspace card, when the membership lookup errored', () => {
    // membershipResolved:'error' means the lookup itself blew up (network/
    // RLS blip) -- it never determined membership one way or the other.
    // Rendering the definitive "removed" copy here would tell a real member
    // who hit a transient error that they've been kicked out.
    setAuth(null, { loading: false, membershipResolved: 'error' });
    const { container } = renderAt('/configuracao/membros');
    expect(screen.queryByText('Sem acesso a este workspace')).not.toBeInTheDocument();
    expect(screen.getByText('Não foi possível confirmar seu acesso')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /tentar novamente/i })).toBeInTheDocument();
    expect(container.querySelector('.animate-spin')).not.toBeInTheDocument();
  });

  it('shows the spinner (not either message card) while still loading', () => {
    setAuth(null, { loading: true, membershipResolved: false });
    const { container } = renderAt('/configuracao/membros');
    expect(screen.queryByText('Sem acesso a este workspace')).not.toBeInTheDocument();
    expect(screen.queryByText('Não foi possível confirmar seu acesso')).not.toBeInTheDocument();
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
