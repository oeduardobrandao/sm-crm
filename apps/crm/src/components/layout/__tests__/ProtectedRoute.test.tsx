import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('../../../context/AuthContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../../hooks/useWorkspaceLimits', () => ({
  useWorkspaceLimits: vi.fn(),
}));

import { useAuth } from '../../../context/AuthContext';
import { useWorkspaceLimits } from '../../../hooks/useWorkspaceLimits';
import ProtectedRoute from '../ProtectedRoute';
import { makeCan, fakeMembership } from '@/test/makeCan';

const mockedUseWorkspaceLimits = vi.mocked(useWorkspaceLimits);

const mockedUseAuth = vi.mocked(useAuth);

// Real derivePermission-backed `can()`, one per role/membership shape used
// below — ProtectedRoute now calls `can(gate.module, gate.action)` for every
// permission-mapped route, so every mocked useAuth() return value needs a
// working `can`, not a role string alone.
const agentCan = makeCan(fakeMembership({ role: 'agent' }));
const ownerCan = makeCan(fakeMembership({ role: 'owner' }));
// Restricted admin: legacy, no custom role, can_see_financials false.
const restrictedAdminCan = makeCan(fakeMembership({ role: 'admin', can_see_financials: false }));
// Every permission check resolves 'unknown' — the real shape of an
// unresolved membership, mid-hydration or after a lookup error.
const unknownCan = () => 'unknown' as const;

const defaultLimits = {
  limits: null,
  features: null,
  planName: null,
  isLoading: false,
  isUnlimited: true,
};

beforeEach(() => {
  mockedUseWorkspaceLimits.mockReturnValue(defaultLimits);
});

function renderRoute(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <Routes>
        <Route path="/login" element={<div>Tela de login</div>} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <div>Área protegida: dashboard</div>
            </ProtectedRoute>
          }
        />
        <Route
          path="/workspace-setup"
          element={
            <ProtectedRoute>
              <div>Área protegida: setup</div>
            </ProtectedRoute>
          }
        />
        <Route
          path="*"
          element={
            <ProtectedRoute>
              <div>Área protegida</div>
            </ProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute', () => {
  it('redirects unauthenticated users to the login screen', () => {
    mockedUseAuth.mockReturnValue({
      user: null,
      profile: null,
      role: 'agent',
      can: agentCan,
      loading: false,
      refetchProfile: vi.fn(),
      signOut: vi.fn(),
    });

    renderRoute('/financeiro');

    expect(screen.getByText('Tela de login')).toBeInTheDocument();
  });

  it('redirects blocked agent routes back to the dashboard', () => {
    mockedUseAuth.mockReturnValue({
      user: { id: 'user-7' } as never,
      profile: { id: 'user-7', role: 'agent' } as never,
      role: 'agent',
      can: agentCan,
      loading: false,
      refetchProfile: vi.fn(),
      signOut: vi.fn(),
    });

    renderRoute('/equipe');

    expect(screen.getByText('Área protegida: dashboard')).toBeInTheDocument();
  });

  it('renders a loading spinner while the auth session is hydrating', () => {
    mockedUseAuth.mockReturnValue({
      user: null,
      profile: null,
      role: 'agent',
      can: agentCan,
      loading: true,
      refetchProfile: vi.fn(),
      signOut: vi.fn(),
    });

    const { container } = renderRoute('/dashboard');

    // While loading, neither the protected children nor the login redirect render.
    expect(screen.queryByText(/Área protegida/)).not.toBeInTheDocument();
    expect(screen.queryByText('Tela de login')).not.toBeInTheDocument();
    // The loading path renders the Spinner wrapper div.
    expect(container.firstChild).not.toBeNull();
  });

  it.each(['/leads', '/equipe'])('redirects agent away from %s to the dashboard', (blocked) => {
    mockedUseAuth.mockReturnValue({
      user: { id: 'u' } as never,
      profile: { id: 'u', role: 'agent' } as never,
      role: 'agent',
      can: agentCan,
      loading: false,
      refetchProfile: vi.fn(),
      signOut: vi.fn(),
    });

    renderRoute(blocked);

    expect(screen.getByText('Área protegida: dashboard')).toBeInTheDocument();
  });

  describe('/financeiro and /contratos are AppLayout territory, not this gate', () => {
    // These two paths are deliberately EXEMPT from the permission-gate
    // redirect above (see the comment in ProtectedRoute.tsx): AppLayout's own
    // `financialGuardOutcome` (content/loading/denied ->
    // FinancialRestrictionScreen) is the real, sole gate for them, for EVERY
    // role -- not just agents. This test tree never renders AppLayout (the
    // routes here render a plain div instead), so "renders the raw children"
    // below stands in for "control passes to AppLayout, which is not
    // exercised in this file" -- it is NOT a claim that these paths are open
    // to everyone. `AppLayout.test.tsx`/`financialRouteGuard.test.ts` own the
    // actual access-decision coverage for these two paths.
    it.each(['/financeiro', '/contratos'])(
      'a legacy agent at %s is NOT redirected here (falls through to AppLayout)',
      (path) => {
        mockedUseAuth.mockReturnValue({
          user: { id: 'u' } as never,
          profile: { id: 'u', role: 'agent' } as never,
          role: 'agent',
          can: agentCan,
          loading: false,
          refetchProfile: vi.fn(),
          signOut: vi.fn(),
        });

        renderRoute(path);

        expect(screen.getByText('Área protegida')).toBeInTheDocument();
        expect(screen.queryByText('Área protegida: dashboard')).toBeNull();
      },
    );

    it('a restricted admin at /financeiro is NOT redirected here (falls through to AppLayout, which renders FinancialRestrictionScreen in the real app)', () => {
      // The Task-12 regression this restores: can('financeiro','ver') is
      // false for a restricted admin, and the permission gate alone would
      // have redirected to /dashboard, silently replacing AppLayout's
      // dedicated restriction screen with a bare bounce.
      mockedUseAuth.mockReturnValue({
        user: { id: 'admin-1' } as never,
        profile: { id: 'admin-1', role: 'admin' } as never,
        role: 'admin',
        can: restrictedAdminCan,
        loading: false,
        refetchProfile: vi.fn(),
        signOut: vi.fn(),
      });

      renderRoute('/financeiro');

      expect(screen.getByText('Área protegida')).toBeInTheDocument();
      expect(screen.queryByText('Área protegida: dashboard')).toBeNull();
    });

    it('exemption is case-insensitive: /Financeiro (capitalized) behaves the same as /financeiro for an agent', () => {
      mockedUseAuth.mockReturnValue({
        user: { id: 'u' } as never,
        profile: { id: 'u', role: 'agent' } as never,
        role: 'agent',
        can: agentCan,
        loading: false,
        refetchProfile: vi.fn(),
        signOut: vi.fn(),
      });

      renderRoute('/Financeiro');

      expect(screen.getByText('Área protegida')).toBeInTheDocument();
      expect(screen.queryByText('Área protegida: dashboard')).toBeNull();
    });
  });

  it('allows an agent to reach non-blocked routes', () => {
    mockedUseAuth.mockReturnValue({
      user: { id: 'u' } as never,
      profile: { id: 'u', role: 'agent' } as never,
      role: 'agent',
      can: agentCan,
      loading: false,
      refetchProfile: vi.fn(),
      signOut: vi.fn(),
    });

    renderRoute('/dashboard');

    expect(screen.getByText('Área protegida: dashboard')).toBeInTheDocument();
  });

  // Positive parity: every route the legacy agent preset actually grants,
  // beyond the single /dashboard case above. Mirrors the AGENT_ROLE_PRESET
  // truth table in lib/permissions.ts (clientes/entregas/calendario/
  // aprovacoes/arquivos/ideias/tarefas: 'editar'; analytics: 'ver';
  // automacoes: 'editar') for every module that has a real CRM route --
  // 'aprovacoes' has none today (see routePermissions.ts), so it's excluded
  // here. leads/financeiro/contratos/equipe are covered by the blocked
  // it.each above and the financial-exemption describe block, not repeated.
  it.each([
    '/calendario',
    '/clientes',
    '/entregas',
    '/post-express',
    '/tarefas',
    '/arquivos',
    '/ideias',
    '/mensagens',
    '/analytics',
    '/analytics-fluxos',
    '/automacoes',
  ])('renders children (no redirect) for an agent at %s', (path) => {
    mockedUseAuth.mockReturnValue({
      user: { id: 'u' } as never,
      profile: { id: 'u', role: 'agent' } as never,
      role: 'agent',
      can: agentCan,
      loading: false,
      refetchProfile: vi.fn(),
      signOut: vi.fn(),
    });

    renderRoute(path);

    expect(screen.getByText('Área protegida')).toBeInTheDocument();
  });

  describe('fail-mode: unmapped route', () => {
    it('redirects to /dashboard and logs a console.error in DEV', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockedUseAuth.mockReturnValue({
        user: { id: 'u' } as never,
        profile: { id: 'u', role: 'owner', empresa: 'Mesaas' } as never,
        role: 'owner',
        can: ownerCan,
        loading: false,
        refetchProfile: vi.fn(),
        signOut: vi.fn(),
      });

      renderRoute('/uma-rota-que-nao-existe-no-mapa');

      expect(screen.getByText('Área protegida: dashboard')).toBeInTheDocument();
      // import.meta.env.DEV is true under vitest, so the DEV-only branch runs.
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('/uma-rota-que-nao-existe-no-mapa'),
      );
      errorSpy.mockRestore();
    });
  });

  describe("fail-mode: can() === 'unknown'", () => {
    it("renders children (neutral, does not redirect) for a gated route when can() reports 'unknown'", () => {
      // Mirrors AppLayout's financial guard: an unresolved membership fails
      // NEUTRAL at the route layer, not closed -- otherwise hydration or a
      // transient lookup error would bounce a real owner to /dashboard.
      mockedUseAuth.mockReturnValue({
        user: { id: 'u' } as never,
        profile: { id: 'u', role: 'owner', empresa: 'Mesaas' } as never,
        role: 'owner',
        can: unknownCan,
        loading: false,
        refetchProfile: vi.fn(),
        signOut: vi.fn(),
      });

      renderRoute('/entregas');

      expect(screen.getByText('Área protegida')).toBeInTheDocument();
    });
  });

  describe('ordering: permission gate runs before the feature-gate loop', () => {
    it('redirects an agent to /dashboard at a route that is BOTH permission-blocked and feature-gated, instead of showing the upgrade screen', () => {
      // /leads is permission-blocked for the legacy agent preset
      // (leads: 'none') AND feature-gated (feature_leads). Pre-permission-
      // model, AGENT_BLOCKED ran before FEATURE_GATED, so an agent always
      // got redirected here regardless of the plan's feature flags. If the
      // feature-gate loop ran first, this agent would see the upgrade screen
      // instead -- a route an agent should never reach in the first place.
      mockedUseAuth.mockReturnValue({
        user: { id: 'u' } as never,
        profile: { id: 'u', role: 'agent' } as never,
        role: 'agent',
        can: agentCan,
        loading: false,
        refetchProfile: vi.fn(),
        signOut: vi.fn(),
      });

      mockedUseWorkspaceLimits.mockReturnValue({
        limits: null,
        features: { feature_leads: false },
        planName: 'starter',
        isLoading: false,
        isUnlimited: false,
      });

      renderRoute('/leads');

      expect(screen.getByText('Área protegida: dashboard')).toBeInTheDocument();
      expect(screen.queryByText(/Leads não está no seu plano/)).toBeNull();
    });
  });

  it('redirects owner without empresa to workspace-setup', () => {
    mockedUseAuth.mockReturnValue({
      user: { id: 'owner-1' } as never,
      profile: { id: 'owner-1', role: 'owner' } as never,
      role: 'owner',
      can: ownerCan,
      loading: false,
      refetchProfile: vi.fn(),
      signOut: vi.fn(),
    });

    renderRoute('/dashboard');

    expect(screen.getByText('Área protegida: setup')).toBeInTheDocument();
  });

  it('does not loop owner already on workspace-setup', () => {
    mockedUseAuth.mockReturnValue({
      user: { id: 'owner-1' } as never,
      profile: { id: 'owner-1', role: 'owner' } as never,
      role: 'owner',
      can: ownerCan,
      loading: false,
      refetchProfile: vi.fn(),
      signOut: vi.fn(),
    });

    renderRoute('/workspace-setup');

    expect(screen.getByText('Área protegida: setup')).toBeInTheDocument();
  });

  it('lets owner with empresa into the protected area', () => {
    mockedUseAuth.mockReturnValue({
      user: { id: 'owner-1' } as never,
      profile: { id: 'owner-1', role: 'owner', empresa: 'Mesaas' } as never,
      role: 'owner',
      can: ownerCan,
      loading: false,
      refetchProfile: vi.fn(),
      signOut: vi.fn(),
    });

    renderRoute('/dashboard');

    expect(screen.getByText('Área protegida: dashboard')).toBeInTheDocument();
  });

  it('shows upgrade screen (not dashboard redirect) when owner visits /leads with feature_leads:false', () => {
    mockedUseAuth.mockReturnValue({
      user: { id: 'owner-1' } as never,
      profile: { id: 'owner-1', role: 'owner', empresa: 'Mesaas' } as never,
      role: 'owner',
      can: ownerCan,
      loading: false,
      refetchProfile: vi.fn(),
      signOut: vi.fn(),
    });

    mockedUseWorkspaceLimits.mockReturnValue({
      limits: null,
      features: {
        feature_instagram: true,
        feature_instagram_ai: false,
        feature_analytics_reports: false,
        feature_best_times: false,
        feature_audience_demographics: false,
        feature_hub_portal: false,
        feature_leads: false,
        feature_financial: false,
        feature_contracts: false,
        feature_ideas: false,
        feature_workflow_gantt: false,
        feature_workflow_recurrence: false,
        feature_csv_import: false,
        feature_custom_properties: false,
        feature_post_scheduling: false,
        feature_auto_sync_cron: false,
        feature_post_tagging: false,
        feature_brand_customization: false,
      },
      planName: 'starter',
      isLoading: false,
      isUnlimited: false,
    });

    renderRoute('/leads');

    expect(screen.getByText(/Leads não está no seu plano/)).toBeInTheDocument();
    expect(screen.queryByText('Área protegida: dashboard')).toBeNull();
  });

  it('shows the upgrade screen for a capitalized gated path (/Leads), not the raw children', () => {
    // React Router matches /Leads to the same lowercase route as /leads (no
    // caseSensitive routes in App.tsx). FEATURE_GATED previously matched
    // against the raw, non-lowercased location.pathname, so a capitalized
    // URL slipped past the gate and rendered the plan-gated page directly.
    mockedUseAuth.mockReturnValue({
      user: { id: 'owner-1' } as never,
      profile: { id: 'owner-1', role: 'owner', empresa: 'Mesaas' } as never,
      role: 'owner',
      can: ownerCan,
      loading: false,
      refetchProfile: vi.fn(),
      signOut: vi.fn(),
    });

    mockedUseWorkspaceLimits.mockReturnValue({
      limits: null,
      features: {
        feature_instagram: true,
        feature_instagram_ai: false,
        feature_analytics_reports: false,
        feature_best_times: false,
        feature_audience_demographics: false,
        feature_hub_portal: false,
        feature_leads: false,
        feature_financial: false,
        feature_contracts: false,
        feature_ideas: false,
        feature_workflow_gantt: false,
        feature_workflow_recurrence: false,
        feature_csv_import: false,
        feature_custom_properties: false,
        feature_post_scheduling: false,
        feature_auto_sync_cron: false,
        feature_post_tagging: false,
        feature_brand_customization: false,
      },
      planName: 'starter',
      isLoading: false,
      isUnlimited: false,
    });

    renderRoute('/Leads');

    expect(screen.getByText(/Leads não está no seu plano/)).toBeInTheDocument();
    expect(screen.queryByText('Área protegida')).toBeNull();
  });

  it('shows upgrade screen (not children) when owner visits /mensagens with feature_mensagens:false', () => {
    mockedUseAuth.mockReturnValue({
      user: { id: 'owner-1' } as never,
      profile: { id: 'owner-1', role: 'owner', empresa: 'Mesaas' } as never,
      role: 'owner',
      can: ownerCan,
      loading: false,
      refetchProfile: vi.fn(),
      signOut: vi.fn(),
    });

    mockedUseWorkspaceLimits.mockReturnValue({
      limits: null,
      features: {
        feature_instagram: true,
        feature_instagram_ai: false,
        feature_analytics_reports: false,
        feature_best_times: false,
        feature_audience_demographics: false,
        feature_hub_portal: false,
        feature_leads: false,
        feature_financial: false,
        feature_contracts: false,
        feature_ideas: false,
        feature_workflow_gantt: false,
        feature_workflow_recurrence: false,
        feature_csv_import: false,
        feature_custom_properties: false,
        feature_post_scheduling: false,
        feature_auto_sync_cron: false,
        feature_post_tagging: false,
        feature_brand_customization: false,
        feature_mensagens: false,
      },
      planName: 'starter',
      isLoading: false,
      isUnlimited: false,
    });

    renderRoute('/mensagens');

    expect(screen.getByText(/Mensagens não está no seu plano/)).toBeInTheDocument();
    expect(screen.queryByText('Área protegida')).toBeNull();
  });

  it('renders children at /mensagens when feature_mensagens is true', () => {
    mockedUseAuth.mockReturnValue({
      user: { id: 'owner-1' } as never,
      profile: { id: 'owner-1', role: 'owner', empresa: 'Mesaas' } as never,
      role: 'owner',
      can: ownerCan,
      loading: false,
      refetchProfile: vi.fn(),
      signOut: vi.fn(),
    });

    mockedUseWorkspaceLimits.mockReturnValue({
      limits: null,
      features: {
        feature_instagram: true,
        feature_instagram_ai: false,
        feature_analytics_reports: false,
        feature_best_times: false,
        feature_audience_demographics: false,
        feature_hub_portal: false,
        feature_leads: false,
        feature_financial: false,
        feature_contracts: false,
        feature_ideas: false,
        feature_workflow_gantt: false,
        feature_workflow_recurrence: false,
        feature_csv_import: false,
        feature_custom_properties: false,
        feature_post_scheduling: false,
        feature_auto_sync_cron: false,
        feature_post_tagging: false,
        feature_brand_customization: false,
        feature_mensagens: true,
      },
      planName: 'starter',
      isLoading: false,
      isUnlimited: false,
    });

    renderRoute('/mensagens');

    expect(screen.getByText('Área protegida')).toBeInTheDocument();
  });

  it('renders children at /mensagens when features is missing (unlimited workspace)', () => {
    // defaultLimits from beforeEach: features: null, isUnlimited: true — the
    // gate loop is skipped entirely, so the route falls through to children.
    mockedUseAuth.mockReturnValue({
      user: { id: 'owner-1' } as never,
      profile: { id: 'owner-1', role: 'owner', empresa: 'Mesaas' } as never,
      role: 'owner',
      can: ownerCan,
      loading: false,
      refetchProfile: vi.fn(),
      signOut: vi.fn(),
    });

    renderRoute('/mensagens');

    expect(screen.getByText('Área protegida')).toBeInTheDocument();
  });

  it('does NOT redirect a non-agent (owner) at a capitalized blocked path', () => {
    // /Financeiro is in AGENT_BLOCKED, but AGENT_BLOCKED only applies to the
    // 'agent' role. A guard that over-matched on the lowercased pathname
    // (e.g. redirecting every role instead of just agents) would send an
    // owner to /dashboard too, and this test would catch it.
    mockedUseAuth.mockReturnValue({
      user: { id: 'owner-1' } as never,
      profile: { id: 'owner-1', role: 'owner', empresa: 'Mesaas' } as never,
      role: 'owner',
      can: ownerCan,
      loading: false,
      refetchProfile: vi.fn(),
      signOut: vi.fn(),
    });

    renderRoute('/Financeiro');

    expect(screen.getByText('Área protegida')).toBeInTheDocument();
    expect(screen.queryByText('Área protegida: dashboard')).toBeNull();
  });
});
