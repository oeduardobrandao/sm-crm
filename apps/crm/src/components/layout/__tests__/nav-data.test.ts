import { describe, it, expect } from 'vitest';
import { getNavGroups, getMoreSheetGroups, getPhoneNav, isNavRouteActive } from '../nav-data';
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
  // Ids with no NAV_MODULE entry at all (dashboard,
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
      'post-express',
      'analytics-fluxos',
      'automacoes',
      'tarefas',
      'arquivos',
      'analytics',
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

describe('TikTok analytics nav item', () => {
  const ON = { feature_tiktok: true, feature_analytics_reports: true };

  it('TikTok item shows under feature_tiktok + feature_analytics_reports', () => {
    const got = ids(getNavGroups(ON, 'owner', ownerCan));
    expect(got).toContain('analytics-tiktok');
    // Right after Instagram, in the Analytics group.
    expect(got.indexOf('analytics-tiktok')).toBe(got.indexOf('analytics') + 1);
    const group = getNavGroups(ON, 'owner', ownerCan).find((g) => g.id === 'analytics-group');
    expect(group?.items.find((i) => i.id === 'analytics-tiktok')).toMatchObject({
      route: '/analytics/tiktok',
      label: 'TikTok',
      labelKey: 'nav.tiktok',
      icon: 'ph-tiktok-logo',
    });
  });

  it('TikTok item hidden when features null', () => {
    expect(ids(getNavGroups(null, 'owner', ownerCan))).not.toContain('analytics-tiktok');
    expect(ids(getNavGroups(null, 'agent', agentCan))).not.toContain('analytics-tiktok');
    expect(ids(getMoreSheetGroups(null, 'owner', ownerCan))).not.toContain('analytics-tiktok');
  });

  it('TikTok item hidden when feature_tiktok false', () => {
    const got = ids(getNavGroups({ ...ON, feature_tiktok: false }, 'owner', ownerCan));
    expect(got).not.toContain('analytics-tiktok');
    expect(got).toContain('analytics');
  });

  it('TikTok item hidden when feature_tiktok is missing (fail-closed)', () => {
    expect(ids(getNavGroups({ feature_analytics_reports: true }, 'owner', ownerCan))).not.toContain(
      'analytics-tiktok',
    );
  });

  it('TikTok item hidden when feature_analytics_reports false', () => {
    expect(
      ids(getNavGroups({ ...ON, feature_analytics_reports: false }, 'owner', ownerCan)),
    ).not.toContain('analytics-tiktok');
  });

  it('TikTok item needs analytics.ver', () => {
    const can = makeCan(
      fakeMembership({
        role: 'agent',
        role_id: 'role-1',
        permissions: { analytics: 'none', clientes: 'ver' } as never,
      }),
    );
    expect(ids(getNavGroups(ON, 'agent', can))).not.toContain('analytics-tiktok');
  });
});

describe('isNavRouteActive', () => {
  it('does not light Instagram on the TikTok overview', () => {
    expect(isNavRouteActive('/analytics/tiktok', '/analytics', 'analytics')).toBe(false);
  });

  it('does not light Instagram on a client TikTok tab', () => {
    expect(isNavRouteActive('/analytics/12/tiktok', '/analytics', 'analytics')).toBe(false);
  });

  it('lights TikTok on the overview and on a client TikTok tab', () => {
    expect(isNavRouteActive('/analytics/tiktok', '/analytics/tiktok', 'analytics-tiktok')).toBe(
      true,
    );
    expect(isNavRouteActive('/analytics/12/tiktok', '/analytics/tiktok', 'analytics-tiktok')).toBe(
      true,
    );
  });

  it('lights Instagram on the client Instagram and Relatórios tabs, not TikTok', () => {
    expect(isNavRouteActive('/analytics/12/instagram', '/analytics', 'analytics')).toBe(true);
    expect(isNavRouteActive('/analytics/12/relatorios', '/analytics', 'analytics')).toBe(true);
    expect(isNavRouteActive('/analytics/12', '/analytics', 'analytics')).toBe(true);
    expect(isNavRouteActive('/analytics', '/analytics', 'analytics')).toBe(true);
    expect(
      isNavRouteActive('/analytics/12/instagram', '/analytics/tiktok', 'analytics-tiktok'),
    ).toBe(false);
    expect(isNavRouteActive('/analytics', '/analytics/tiktok', 'analytics-tiktok')).toBe(false);
  });

  it('keeps the prefix boundary: /analytics-fluxos is not /analytics', () => {
    expect(isNavRouteActive('/analytics-fluxos', '/analytics', 'analytics')).toBe(false);
    expect(isNavRouteActive('/analytics-fluxos', '/analytics')).toBe(false);
  });

  it('without an item id, every /analytics* child path matches /analytics (phone tab)', () => {
    expect(isNavRouteActive('/analytics/tiktok', '/analytics')).toBe(true);
    expect(isNavRouteActive('/analytics/12/tiktok', '/analytics')).toBe(true);
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

describe('getPhoneNav (D18 phone tab bar)', () => {
  const tabIds = (nav: ReturnType<typeof getPhoneNav>) => nav.tabs.map((t) => t.navId);

  it('prefers Início, Entregas, Agenda, Mensagens and moves Clientes/Analytics to the top of Mais', () => {
    const nav = getPhoneNav({ feature_mensagens: true }, 'owner', ownerCan, {
      agendaEnabled: true,
    });
    expect(tabIds(nav)).toEqual(['dashboard', 'entregas', 'calendario', 'mensagens']);
    expect(nav.tabs.map((t) => t.label)).toEqual(['Início', 'Entregas', 'Agenda', 'Mensagens']);
    expect(nav.tabs[2].route).toBe('/calendario');
    expect(nav.shortcuts.map((s) => [s.id, s.label])).toEqual([
      ['clientes', 'Clientes'],
      ['analytics', 'Analytics'],
    ]);
    const more = ids(nav.moreGroups);
    for (const id of [
      'dashboard',
      'entregas',
      'calendario',
      'mensagens',
      'clientes',
      'analytics',
    ]) {
      expect(more).not.toContain(id);
    }
    expect(more).toContain('analytics-fluxos');
  });

  it('keeps the editorial Calendário in Mais and gives its slot to Clientes without the Agenda', () => {
    const nav = getPhoneNav(null, 'owner', ownerCan, { agendaEnabled: false });
    expect(tabIds(nav)).toEqual(['dashboard', 'entregas', 'clientes', 'mensagens']);
    expect(nav.shortcuts.map((s) => s.id)).toEqual(['analytics']);
    expect(ids(nav.moreGroups)).toContain('calendario');
  });

  it('uses Clientes then Analytics when both Agenda and Mensagens are unavailable', () => {
    const nav = getPhoneNav({ feature_mensagens: false }, 'owner', ownerCan, {
      agendaEnabled: false,
    });
    expect(tabIds(nav)).toEqual(['dashboard', 'entregas', 'clientes', 'analytics']);
    expect(nav.shortcuts).toEqual([]);
  });

  it('respects the plan flag on the Analytics fallback, like the sidebar', () => {
    const nav = getPhoneNav(
      { feature_mensagens: false, feature_analytics_reports: false },
      'owner',
      ownerCan,
      { agendaEnabled: false },
    );
    expect(tabIds(nav)).toEqual(['dashboard', 'entregas', 'clientes']);
  });

  it('does not touch the desktop nav: Calendário stays a sidebar item on every plan', () => {
    const groups = getNavGroups({ feature_agenda: false }, 'owner', ownerCan);
    expect(ids(groups)).toContain('calendario');
  });

  it('shows only Início while the membership is unresolved (fails closed, like the sidebar)', () => {
    const nav = getPhoneNav(null, 'owner', unresolvedCan, { agendaEnabled: true });
    expect(tabIds(nav)).toEqual(['dashboard']);
  });

  it('keeps a legacy agent on Início, Entregas, Clientes, Mensagens without the Agenda', () => {
    const nav = getPhoneNav(null, 'agent', agentCan, { agendaEnabled: false });
    expect(tabIds(nav)).toEqual(['dashboard', 'entregas', 'clientes', 'mensagens']);
  });
});

describe('mensagens nav item: array flag (feature_mensagens OR feature_team_chat)', () => {
  it('stays visible when only feature_team_chat is true (feature_mensagens explicitly false)', () => {
    const got = ids(
      getNavGroups({ feature_mensagens: false, feature_team_chat: true }, 'owner', ownerCan),
    );
    expect(got).toContain('mensagens');
  });

  it('is hidden when both feature_mensagens and feature_team_chat are false', () => {
    const got = ids(
      getNavGroups({ feature_mensagens: false, feature_team_chat: false }, 'owner', ownerCan),
    );
    expect(got).not.toContain('mensagens');
  });

  it('stays visible when feature_mensagens is true and feature_team_chat is undefined (legacy flag alone still governs)', () => {
    const got = ids(getNavGroups({ feature_mensagens: true }, 'owner', ownerCan));
    expect(got).toContain('mensagens');
  });

  // Rollout-window regression guard: before workspace-limits is redeployed
  // with the new feature_team_chat column, BOTH flags are simply absent from
  // the features map (not `false`). feature_mensagens is the legacy,
  // fail-open flag in the pair, so its own absence must not hide the item.
  it('stays visible when both flags are undefined (pre-redeploy legacy behaviour)', () => {
    const got = ids(getNavGroups({}, 'owner', ownerCan));
    expect(got).toContain('mensagens');
  });

  it('gives the phone tab bar its Mensagens tab with only the team chat', () => {
    const nav = getPhoneNav(
      { feature_mensagens: false, feature_team_chat: true },
      'owner',
      ownerCan,
      {
        agendaEnabled: true,
      },
    );
    expect(nav.tabs.map((t) => t.navId)).toContain('mensagens');
  });
});
