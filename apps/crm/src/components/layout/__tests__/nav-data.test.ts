import { describe, it, expect } from 'vitest';
import { getNavGroups, getMoreSheetGroups } from '../nav-data';
import { deriveFinancialAccess } from '@/lib/financialAccess';
import { makeCan, fakeMembership } from '@/test/makeCan';
import type { MyMembership } from '@/store/workspace';

const ids = (groups: ReturnType<typeof getNavGroups>) =>
  groups.flatMap((g) => g.items.map((i) => i.id));

const ownerCan = makeCan(fakeMembership({ role: 'owner' }));
const agentCan = makeCan(fakeMembership({ role: 'agent' }));
const unresolvedCan = makeCan(null);

describe('getNavGroups financial capability', () => {
  it('shows financeiro and contratos to an authorized admin', () => {
    const can = makeCan(fakeMembership({ role: 'admin', can_see_financials: true }));
    const got = ids(getNavGroups('admin', null, true, 'admin', can));
    expect(got).toContain('financeiro');
    expect(got).toContain('contratos');
  });

  it('hides financeiro and contratos from a restricted admin', () => {
    const can = makeCan(fakeMembership({ role: 'admin', can_see_financials: false }));
    const got = ids(getNavGroups('admin', null, false, 'admin', can));
    expect(got).not.toContain('financeiro');
    expect(got).not.toContain('contratos');
  });

  // Nav fails closed alongside values: an unresolved capability must not flash
  // financial nav items at a restricted admin. The real-world equivalent of
  // "capability unknown" is an unresolved membership -- `can()` then reports
  // 'unknown' for every module, not just financeiro/contratos.
  it('hides them while the capability is unknown', () => {
    const got = ids(getNavGroups('admin', null, 'unknown', 'admin', unresolvedCan));
    expect(got).not.toContain('financeiro');
    expect(got).not.toContain('contratos');
  });

  // `deriveFinancialAccess` (lib/financialAccess.ts) always maps
  // membership.role === 'owner' to `true`, and both real callers
  // (Sidebar.tsx, MobileNav.tsx) source `canSeeFinancials` and
  // `workspaceRole` from the SAME useAuth() membership snapshot -- so
  // `workspaceRole: 'owner'` paired with `canSeeFinancials: false` cannot
  // occur through the app's actual derivation. Proven directly below rather
  // than asserted in prose.
  it('deriveFinancialAccess never produces false for an owner (documents why the case below is synthetic)', () => {
    const access = deriveFinancialAccess({
      role: 'owner',
      can_see_financials: false,
      role_id: null,
      permissions: null,
    } as MyMembership);
    expect(access).toBe(true);
  });

  // Because that combination is unreachable via deriveFinancialAccess, this
  // input is synthetic -- not a simulation of real app state. It is kept as
  // a defense-in-depth check on getNavGroups' OWN contract: the function is
  // exported and callable directly (as this test does) with no compile-time
  // link to deriveFinancialAccess, so a future caller -- or a bug that
  // decouples the two values -- must still not be able to hide financial
  // nav from a confirmed workspace owner. `can` itself is real here (built
  // from an owner membership), so `can('financeiro'|'contratos', 'ver')`
  // resolves true unconditionally regardless of the (wrongly false)
  // canSeeFinancials param passed alongside it.
  it('exempts a confirmed owner from the financial gate even if canSeeFinancials were wrongly false (defense-in-depth; synthetic input)', () => {
    const got = ids(getNavGroups('owner', null, false, 'owner', ownerCan));
    expect(got).toContain('financeiro');
    expect(got).toContain('contratos');
  });

  // Regression: the owner exemption must key off workspaceRole (the ACTIVE
  // workspace's workspace_members row), not the profile-derived `role`.
  // switchWorkspace never writes profiles.role, so an owner in workspace A who
  // is a restricted admin in workspace B previously kept seeing
  // Financeiro/Contratos while working in B — the link then bounced to the
  // restriction screen.
  it('hides financeiro/contratos from a profile-owner who is a restricted admin in the active workspace', () => {
    const can = makeCan(fakeMembership({ role: 'admin', can_see_financials: false }));
    const got = ids(getNavGroups('owner', null, false, 'admin', can));
    expect(got).not.toContain('financeiro');
    expect(got).not.toContain('contratos');
  });

  // Hydration case: workspaceRole/membership is null until it resolves.
  // Accepted cost is a brief flicker (financial items appear a beat later for
  // a real owner) rather than a persistently wrong nav for multi-workspace
  // users.
  it('hides financeiro/contratos for a profile-owner while workspaceRole is still unresolved', () => {
    const got = ids(getNavGroups('owner', null, 'unknown', null, unresolvedCan));
    expect(got).not.toContain('financeiro');
    expect(got).not.toContain('contratos');
  });

  it('keeps equipe for an authorized admin', () => {
    const can = makeCan(fakeMembership({ role: 'admin', can_see_financials: true }));
    expect(ids(getNavGroups('admin', null, true, 'admin', can))).toContain('equipe');
  });

  // Pre-existing mismatch this task fixes: ProtectedRoute blocks agents from
  // /equipe, but nav-data kept rendering the link, so agents saw an item that
  // bounced them to /dashboard.
  it('hides equipe from agents, who are route-blocked from it', () => {
    expect(ids(getNavGroups('agent', null, true, 'agent', agentCan))).not.toContain('equipe');
  });

  it('still hides leads and financials from agents', () => {
    const got = ids(getNavGroups('agent', null, true, 'agent', agentCan));
    expect(got).not.toContain('leads');
    expect(got).not.toContain('financeiro');
    expect(got).not.toContain('contratos');
  });

  it('applies the capability to the more-sheet too', () => {
    const can = makeCan(fakeMembership({ role: 'admin', can_see_financials: false }));
    expect(ids(getMoreSheetGroups('admin', null, false, 'admin', can))).not.toContain('financeiro');
  });
});

describe('locked nav items (showLockedWhenGated)', () => {
  const FEATURES_OFF = { feature_instagram_automation: false };

  it('flag false: automacoes fica visível com locked=true em vez de sumir', () => {
    const items = getNavGroups('owner', FEATURES_OFF, true, 'owner', ownerCan).flatMap(
      (g) => g.items,
    );
    const auto = items.find((i) => i.id === 'automacoes');
    expect(auto).toBeDefined();
    expect(auto?.locked).toBe(true);
  });

  it('flag true: item normal, sem locked', () => {
    const items = getNavGroups(
      'owner',
      { feature_instagram_automation: true },
      true,
      'owner',
      ownerCan,
    ).flatMap((g) => g.items);
    expect(items.find((i) => i.id === 'automacoes')?.locked).toBeUndefined();
  });

  it('itens gateados SEM showLockedWhenGated continuam sendo escondidos', () => {
    const items = getNavGroups('owner', { feature_leads: false }, true, 'owner', ownerCan).flatMap(
      (g) => g.items,
    );
    expect(items.find((i) => i.id === 'leads')).toBeUndefined();
  });

  it('features null (carregando/ilimitado) não marca nada', () => {
    const items = getNavGroups('owner', null, true, 'owner', ownerCan).flatMap((g) => g.items);
    expect(items.find((i) => i.id === 'automacoes')?.locked).toBeUndefined();
  });
});
