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
    const got = ids(getNavGroups(null, 'admin', can));
    expect(got).toContain('financeiro');
    expect(got).toContain('contratos');
  });

  it('hides financeiro and contratos from a restricted admin', () => {
    const can = makeCan(fakeMembership({ role: 'admin', can_see_financials: false }));
    const got = ids(getNavGroups(null, 'admin', can));
    expect(got).not.toContain('financeiro');
    expect(got).not.toContain('contratos');
  });

  // Nav fails closed alongside values: an unresolved capability must not flash
  // financial nav items at a restricted admin. The real-world equivalent of
  // "capability unknown" is an unresolved membership -- `can()` then reports
  // 'unknown' for every module, not just financeiro/contratos.
  it('hides them while the capability is unknown', () => {
    const got = ids(getNavGroups(null, 'admin', unresolvedCan));
    expect(got).not.toContain('financeiro');
    expect(got).not.toContain('contratos');
  });

  // `deriveFinancialAccess` (lib/financialAccess.ts) always maps
  // membership.role === 'owner' to `true`. Proven directly below rather than
  // asserted in prose.
  it('deriveFinancialAccess never produces false for an owner (documents why the case below matters)', () => {
    const access = deriveFinancialAccess({
      role: 'owner',
      can_see_financials: false,
      role_id: null,
      permissions: null,
    } as MyMembership);
    expect(access).toBe(true);
  });

  // Defense-in-depth check on getNavGroups' OWN contract: the function is
  // exported and callable directly (as this test does), so a future caller --
  // or a bug in the owner branch of derivePermission -- must still not be
  // able to hide financial nav from a confirmed workspace owner. `can` is
  // built from a real owner membership, so `can('financeiro'|'contratos',
  // 'ver')` resolves true unconditionally.
  it('exempts a confirmed owner from the financial gate (defense-in-depth)', () => {
    const got = ids(getNavGroups(null, 'owner', ownerCan));
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
    const got = ids(getNavGroups(null, 'admin', can));
    expect(got).not.toContain('financeiro');
    expect(got).not.toContain('contratos');
  });

  // Hydration case: workspaceRole/membership is null until it resolves.
  // Accepted cost is a brief flicker (financial items appear a beat later for
  // a real owner) rather than a persistently wrong nav for multi-workspace
  // users.
  it('hides financeiro/contratos for a profile-owner while workspaceRole is still unresolved', () => {
    const got = ids(getNavGroups(null, null, unresolvedCan));
    expect(got).not.toContain('financeiro');
    expect(got).not.toContain('contratos');
  });

  it('keeps equipe for an authorized admin', () => {
    const can = makeCan(fakeMembership({ role: 'admin', can_see_financials: true }));
    expect(ids(getNavGroups(null, 'admin', can))).toContain('equipe');
  });

  // Pre-existing mismatch this task fixes: ProtectedRoute blocks agents from
  // /equipe, but nav-data kept rendering the link, so agents saw an item that
  // bounced them to /dashboard.
  it('hides equipe from agents, who are route-blocked from it', () => {
    expect(ids(getNavGroups(null, 'agent', agentCan))).not.toContain('equipe');
  });

  it('still hides leads and financials from agents', () => {
    const got = ids(getNavGroups(null, 'agent', agentCan));
    expect(got).not.toContain('leads');
    expect(got).not.toContain('financeiro');
    expect(got).not.toContain('contratos');
  });

  it('applies the capability to the more-sheet too', () => {
    const can = makeCan(fakeMembership({ role: 'admin', can_see_financials: false }));
    expect(ids(getMoreSheetGroups(null, 'admin', can))).not.toContain('financeiro');
  });
});

describe('getNavGroups legacy-agent positive parity', () => {
  // Full, positive truth table for a legacy agent: every id the
  // AGENT_ROLE_PRESET (lib/permissions.ts) actually grants, in the exact
  // group/item order ALL_NAV_GROUPS declares them, verified against the real
  // nav item ids (`grep -n "id: '" nav-data.ts`) -- NOT the permission
  // catalog's module names, some of which (aprovacoes, importar) have no
  // corresponding CRM nav item today and so can never appear in this output
  // regardless of permission, even though NAV_MODULE carries forward-looking
  // entries for them.
  //
  // AGENT_ROLE_PRESET grants 'editar' (satisfies 'ver'-gated nav items) for
  // clientes/entregas/calendario/arquivos/ideias/tarefas/automacoes, 'ver'
  // for analytics, and 'none' (hidden) for leads/financeiro/contratos/equipe.
  // Ids with no NAV_MODULE entry at all (dashboard, analytics-tiktok,
  // novidades, ajuda, configuracao, politica-de-privacidade) always pass
  // through regardless of permission.
  it('shows exactly the agent-visible id set, in declaration order', () => {
    expect(ids(getNavGroups(null, 'agent', agentCan))).toEqual([
      'dashboard',
      'calendario',
      'clientes',
      'ideias',
      'mensagens',
      'entregas',
      'tarefas',
      'post-express',
      'automacoes',
      'arquivos',
      'analytics',
      'analytics-tiktok',
      'analytics-fluxos',
      'novidades',
      'ajuda',
      'configuracao',
      'politica-de-privacidade',
    ]);
  });

  it('owner sees every id (superset of the agent list above)', () => {
    const ownerIds = ids(getNavGroups(null, 'owner', ownerCan));
    expect(ownerIds).toEqual(
      expect.arrayContaining(['leads', 'financeiro', 'contratos', 'equipe']),
    );
  });
});

describe('locked nav items (showLockedWhenGated)', () => {
  const FEATURES_OFF = { feature_instagram_automation: false };

  it('flag false: automacoes fica visível com locked=true em vez de sumir', () => {
    const items = getNavGroups(FEATURES_OFF, 'owner', ownerCan).flatMap((g) => g.items);
    const auto = items.find((i) => i.id === 'automacoes');
    expect(auto).toBeDefined();
    expect(auto?.locked).toBe(true);
  });

  it('flag true: item normal, sem locked', () => {
    const items = getNavGroups({ feature_instagram_automation: true }, 'owner', ownerCan).flatMap(
      (g) => g.items,
    );
    expect(items.find((i) => i.id === 'automacoes')?.locked).toBeUndefined();
  });

  it('itens gateados SEM showLockedWhenGated continuam sendo escondidos', () => {
    const items = getNavGroups({ feature_leads: false }, 'owner', ownerCan).flatMap((g) => g.items);
    expect(items.find((i) => i.id === 'leads')).toBeUndefined();
  });

  it('features null (carregando/ilimitado) não marca nada', () => {
    const items = getNavGroups(null, 'owner', ownerCan).flatMap((g) => g.items);
    expect(items.find((i) => i.id === 'automacoes')?.locked).toBeUndefined();
  });
});
