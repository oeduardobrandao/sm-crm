import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

// jsdom's matchMedia reports false (phone). The tab-strip suites below are desktop;
// the phone suite at the end flips this.
const viewport = vi.hoisted(() => ({ desktop: true }));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => viewport.desktop }));

// The real actions need the KB query and notifications; their own suites cover them.
vi.mock('@/components/layout/PhoneShellHeader', () => ({
  PhoneShellActions: () => <div data-testid="shell-actions" />,
}));

import { useAuth } from '../../../context/AuthContext';
import ConfiguracaoLayout from '../ConfiguracaoLayout';
import ConfiguracaoIndex from '../ConfiguracaoIndex';
import { makeCan, fakeMembership } from '@/test/makeCan';
import { VidroToolbarHarness } from '@/test/vidroToolbar';

const mockedUseAuth = vi.mocked(useAuth);

/**
 * `can` mirrors the real AuthContext: it is derived from the SAME
 * `workspaceRole` this layout gates on (never from the stale `staleProfileRole`
 * below), and is 'unknown' for every module while `workspaceRole` is null —
 * matching the fact that `membership` and `workspaceRole` are always set
 * together in the real AuthContext (see AuthContext.tsx).
 */
function canFor(workspaceRole: string | null) {
  return makeCan(
    workspaceRole === null
      ? null
      : fakeMembership({ role: workspaceRole as 'owner' | 'admin' | 'agent' }),
  );
}

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
    can: canFor(workspaceRole),
    loading,
    signOut: vi.fn(),
    refetchProfile: vi.fn(),
  } as never);
}

function PathProbe() {
  return <span data-testid="path">{useLocation().pathname}</span>;
}

function renderAt(path: string, { vidroShell }: { vidroShell?: boolean } = {}) {
  const routes = (
    <Routes>
      <Route path="/configuracao" element={<ConfiguracaoLayout />}>
        <Route index element={<ConfiguracaoIndex />} />
        <Route path="perfil" element={<div>conteudo perfil</div>} />
        <Route path="membros" element={<div>conteudo membros</div>} />
        <Route path="cobranca" element={<div>conteudo cobranca</div>} />
      </Route>
    </Routes>
  );
  return render(
    <MemoryRouter initialEntries={[path]}>
      {vidroShell === undefined ? (
        routes
      ) : (
        <VidroToolbarHarness vidroShell={vidroShell}>{routes}</VidroToolbarHarness>
      )}
      <PathProbe />
    </MemoryRouter>,
  );
}

function tabLabels() {
  return screen.queryAllByRole('link').map((el) => el.textContent);
}

describe('ConfiguracaoLayout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    viewport.desktop = true;
  });

  it('sends /configuracao to Perfil on desktop', () => {
    setAuth('owner');
    renderAt('/configuracao');
    expect(screen.getByTestId('path')).toHaveTextContent('/configuracao/perfil');
    expect(screen.getByText('conteudo perfil')).toBeInTheDocument();
  });

  it('renders one tab per section an owner may see', () => {
    setAuth('owner');
    renderAt('/configuracao/perfil');
    expect(tabLabels()).toEqual([
      'Perfil',
      'Notificações',
      'Workspace',
      'Membros',
      'Papéis',
      'Relatórios',
      'Status de posts',
      'Hub',
      'Armazenamento',
      'Agentes (MCP)',
      'Plano & Cobrança',
    ]);
  });

  it('hides billing from an admin', () => {
    setAuth('admin');
    renderAt('/configuracao/perfil');
    expect(tabLabels()).not.toContain('Plano & Cobrança');
    expect(tabLabels()).not.toContain('Armazenamento');
    expect(tabLabels()).not.toContain('Papéis');
    expect(tabLabels()).toContain('Membros');
  });

  it('renders the Conta tab strip for an agent, who only sees Perfil and Notificações', () => {
    setAuth('agent');
    renderAt('/configuracao/perfil');
    expect(tabLabels()).toEqual(['Perfil', 'Notificações']);
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
      // before their real role arrives. WHICH terminal UI renders (skeleton,
      // the "removed" card, or the "couldn't confirm" card) is asserted by
      // the dedicated tests below; this one only guards the tab logic
      // itself, and previously only ever exercised the `loading:false`
      // case despite its title claiming to cover "loading or resolved" too
      // -- its three assertions held identically for the skeleton and the
      // card, so it could never have failed for the thing its title named.
      setAuth(null, { loading, membershipResolved });
      renderAt('/configuracao/membros');
      expect(tabLabels()).toEqual([]);
      expect(screen.queryByText('conteudo membros')).not.toBeInTheDocument();
      expect(screen.getByTestId('path')).toHaveTextContent('/configuracao/membros');
    },
  );

  it('shows a short explanatory message instead of loading forever once workspaceRole resolves to no membership', () => {
    // Regression: live revocation sets workspaceRole to null when a
    // membership row disappears mid-session. Gating the skeleton on
    // `workspaceRole === null` (same as the `loading` case above) left a
    // removed user stuck on the skeleton indefinitely, since nothing was ever
    // going to make workspaceRole non-null again. `loading:false` is the
    // signal that the lookup has actually settled, so this state must render
    // a message, not the skeleton. `membershipResolved:true` is what makes
    // this the DEFINITIVE "removed" card rather than the "couldn't confirm"
    // one below -- see that test for the errored-lookup case.
    setAuth(null, { loading: false, membershipResolved: true });
    const { container } = renderAt('/configuracao/membros');
    expect(screen.getByText('Sem acesso a este workspace')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="crm-skeleton"]')).not.toBeInTheDocument();
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
    expect(container.querySelector('[data-testid="crm-skeleton"]')).not.toBeInTheDocument();
  });

  it('shows the skeleton (not either message card) while still loading', () => {
    setAuth(null, { loading: true, membershipResolved: false });
    const { container } = renderAt('/configuracao/membros');
    expect(screen.queryByText('Sem acesso a este workspace')).not.toBeInTheDocument();
    expect(screen.queryByText('Não foi possível confirmar seu acesso')).not.toBeInTheDocument();
    expect(container.querySelector('[data-testid="crm-skeleton"]')).toBeInTheDocument();
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
    expect(tabLabels()).toEqual(['Perfil', 'Notificações']);
    expect(screen.queryByText('conteudo membros')).not.toBeInTheDocument();
    expect(screen.getByTestId('path')).toHaveTextContent('/configuracao/perfil');
  });
});

describe('ConfiguracaoLayout in the Vidro toolbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    viewport.desktop = true;
  });

  it('puts the title in the toolbar and keeps the section nav in the content', () => {
    setAuth('owner');
    const { container } = renderAt('/configuracao/perfil', { vidroShell: true });
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0].closest('.vidro-toolbar')).not.toBeNull();
    expect(h1s[0]).toHaveTextContent('Configurações');
    expect(container.querySelector('.config-shell-header')).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Seções de configurações' })).toBeInTheDocument();
    expect(screen.getByText('conteudo perfil')).toBeInTheDocument();
  });

  it('hides the skeleton header while auth loads, keeping the toolbar title', () => {
    setAuth(null, { loading: true, membershipResolved: false });
    const { container } = renderAt('/configuracao/membros', { vidroShell: true });
    expect(container.querySelector('[data-testid="crm-skeleton"]')).toBeInTheDocument();
    expect(container.querySelector('.config-shell-header')).toBeNull();
    expect(container.querySelector('.config-nav')).not.toBeNull();
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0].closest('.vidro-toolbar')).not.toBeNull();
  });

  it('keeps the in-page header when the Vidro shell is off', () => {
    setAuth('owner');
    const { container } = renderAt('/configuracao/perfil', { vidroShell: false });
    expect(container.querySelector('.vidro-toolbar')).toBeNull();
    const h1 = screen.getByRole('heading', { level: 1, name: 'Configurações' });
    expect(h1.closest('.config-shell-header')).not.toBeNull();
  });
});

describe('ConfiguracaoLayout on phones', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    viewport.desktop = false;
  });

  function groupNames() {
    return screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
  }

  it('renders the Settings list at /configuracao instead of redirecting', () => {
    setAuth('owner');
    renderAt('/configuracao');
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/configuracao$/);
    expect(screen.getByRole('heading', { level: 1, name: 'Configurações' })).toBeInTheDocument();
    expect(groupNames()).toEqual(['Conta', 'Workspace', 'Avançado']);
    // The profile row stands in for Perfil, named after the person.
    expect(screen.getByRole('link', { name: 'Perfil: Débora Kristin' })).toHaveAttribute(
      'href',
      '/configuracao/perfil',
    );
    expect(screen.getByRole('link', { name: /Plano & Cobrança/ })).toHaveAttribute(
      'href',
      '/configuracao/cobranca',
    );
    // No desktop strip.
    expect(screen.queryByRole('navigation', { name: 'Seções de configurações' })).toBeNull();
  });

  it('lists only the sections the role may open', () => {
    setAuth('agent');
    renderAt('/configuracao');
    expect(groupNames()).toEqual(['Conta']);
    expect(screen.getAllByRole('link').map((el) => el.getAttribute('href'))).toEqual([
      '/configuracao/perfil',
      '/configuracao/notificacoes',
    ]);
  });

  it('renders a tab without the strip or the card shell', () => {
    setAuth('owner');
    const { container } = renderAt('/configuracao/membros');
    expect(screen.getByText('conteudo membros')).toBeInTheDocument();
    expect(container.querySelector('.config-shell')).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Seções de configurações' })).toBeNull();
  });

  it('still bounces a role off a tab it may not open', () => {
    setAuth('agent');
    renderAt('/configuracao/membros');
    expect(screen.getByTestId('path')).toHaveTextContent('/configuracao/perfil');
    expect(screen.queryByText('conteudo membros')).not.toBeInTheDocument();
  });

  it('draws the tab screen silhouette with its title while auth loads', () => {
    setAuth(null, { loading: true, membershipResolved: false });
    const { container } = renderAt('/configuracao/membros');
    expect(screen.getByRole('heading', { level: 1, name: 'Membros' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Voltar para Configurações' })).toBeInTheDocument();
    expect(container.querySelector('[data-testid="crm-skeleton"]')).toBeInTheDocument();
    expect(container.querySelector('.config-shell')).toBeNull();
  });

  it('keeps the removed and could-not-confirm cards', () => {
    setAuth(null, { loading: false, membershipResolved: true });
    renderAt('/configuracao/membros');
    expect(screen.getByText('Sem acesso a este workspace')).toBeInTheDocument();
  });
});
