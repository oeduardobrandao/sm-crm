import { describe, it, expect } from 'vitest';
import {
  CLIENTE_TABS,
  CLIENTE_TAB_GROUP_LABELS,
  canAccessClienteTab,
  visibleClienteTabs,
  financeiroTabGuardOutcome,
} from '../clienteTabs.model';
import { makeCan, fakeMembership } from '@/test/makeCan';
import pt from '../../../../../../packages/i18n/locales/pt/clients.json';
import en from '../../../../../../packages/i18n/locales/en/clients.json';

function lookup(bundle: unknown, dotted: string): unknown {
  return dotted
    .split('.')
    .reduce<unknown>((acc, k) => (acc as Record<string, unknown> | undefined)?.[k], bundle);
}

const ownerCan = makeCan(fakeMembership({ role: 'owner' }));
const adminCan = makeCan(fakeMembership({ role: 'admin', can_see_financials: true }));
const restrictedAdminCan = makeCan(fakeMembership({ role: 'admin', can_see_financials: false }));
const agentCan = makeCan(fakeMembership({ role: 'agent' }));
// Unresolved membership -- the real-world equivalent of the old
// `canSeeFinancials: 'unknown'` synthetic input, but now it fails EVERY
// can()-gated tab uniformly, not just financeiro.
const unresolvedCan = makeCan(null);

// The five `hub/*` routes that replaced the single `hub` tab. They carry the
// SAME gate that tab did after Task 12 -- `configuracoes:editar` -- so every
// assertion that used to be written about `hub` now applies to all five.
const PORTAL_KEYS = [
  'hub/acesso',
  'hub/briefing',
  'hub/marca',
  'hub/paginas',
  'hub/ideias',
] as const;

describe('CLIENTE_TABS', () => {
  it('declares the eleven tabs, grouped, in order', () => {
    expect(CLIENTE_TABS.map((t) => [t.key, t.group])).toEqual([
      ['visao-geral', 'cliente'],
      ['entregas', 'cliente'],
      ['redes-sociais', 'canais'],
      ['relatorios', 'canais'],
      ['hub/acesso', 'portal'],
      ['hub/briefing', 'portal'],
      ['hub/marca', 'portal'],
      ['hub/paginas', 'portal'],
      ['hub/ideias', 'portal'],
      ['arquivos', 'gestao'],
      ['financeiro', 'gestao'],
    ]);
  });

  it('no longer declares a bare hub tab', () => {
    expect(CLIENTE_TABS.some((t) => t.key === 'hub')).toBe(false);
  });

  // The five portal routes inherit the gate the single `hub` tab carried
  // after Task 12. Asserted structurally so a future entry cannot quietly
  // ship with a laxer gate than the tab it replaced.
  it('gates every portal tab on configuracoes:editar', () => {
    for (const key of PORTAL_KEYS) {
      const tab = CLIENTE_TABS.find((t) => t.key === key);
      expect(tab?.permission, key).toEqual({ module: 'configuracoes', action: 'editar' });
    }
  });

  it('keeps tabs of the same group adjacent', () => {
    const groups = CLIENTE_TABS.map((t) => t.group);
    const seen = new Set<string>();
    let previous: string | null = null;
    for (const g of groups) {
      if (g !== previous) {
        expect(seen.has(g)).toBe(false);
        seen.add(g);
      }
      previous = g;
    }
  });
});

describe('visibleClienteTabs', () => {
  it('shows all eleven tabs to an owner with financial access', () => {
    const keys = visibleClienteTabs(ownerCan).map((t) => t.key);
    expect(keys).toEqual([
      'visao-geral',
      'entregas',
      'redes-sociais',
      'relatorios',
      'hub/acesso',
      'hub/briefing',
      'hub/marca',
      'hub/paginas',
      'hub/ideias',
      'arquivos',
      'financeiro',
    ]);
  });

  // Task 12 divergence from the OLD role-list model, both directions:
  // `relatorios` now maps to {analytics,ver}, and the legacy agent preset
  // already grants 'ver' there (it did before this task too, for the
  // top-level /analytics route) -- so an agent GAINS the tab. The portal
  // tabs now map to {configuracoes,editar}, which the legacy agent preset
  // has always lacked ('none') -- so an agent LOSES the tab it used to reach
  // (and see a RoleRestrictionNotice inside). Both are directed by the
  // task-12 brief, not incidental.
  it('shows relatorios (agent preset already grants analytics:ver) but hides the portal tabs (agent preset has configuracoes:none) and financeiro', () => {
    const keys = visibleClienteTabs(agentCan).map((t) => t.key);
    expect(keys).toContain('relatorios');
    expect(keys).not.toContain('financeiro');
    for (const key of PORTAL_KEYS) {
      expect(keys, key).not.toContain(key);
    }
    expect(keys).toContain('redes-sociais');
  });

  it('hides financeiro from a restricted admin but keeps relatorios and the portal tabs (admin is unconditional true outside financeiro/contratos)', () => {
    const keys = visibleClienteTabs(restrictedAdminCan).map((t) => t.key);
    expect(keys).not.toContain('financeiro');
    expect(keys).toContain('relatorios');
    for (const key of PORTAL_KEYS) {
      expect(keys, key).toContain(key);
    }
  });

  it('hides every can()-gated tab while membership is unresolved, keeping only the permission:null tabs (no flash, no premature show)', () => {
    const keys = visibleClienteTabs(unresolvedCan).map((t) => t.key);
    expect(keys).toEqual(['visao-geral', 'entregas', 'redes-sociais', 'arquivos']);
  });
});

describe('canAccessClienteTab', () => {
  it('denies an unknown tab key', () => {
    expect(canAccessClienteTab('bogus', ownerCan)).toBe(false);
  });

  it('denies the portal tabs to an agent, allows them to an admin (configuracoes:editar)', () => {
    for (const key of PORTAL_KEYS) {
      expect(canAccessClienteTab(key, agentCan), key).toBe(false);
      expect(canAccessClienteTab(key, adminCan), key).toBe(true);
      expect(canAccessClienteTab(key, ownerCan), key).toBe(true);
    }
  });

  // Same hydration rule the route guard and HubRoleGate follow: 'unknown' is
  // not a yes. A portal tab must not become reachable by URL before the
  // membership that authorizes it has actually resolved.
  it('denies the portal tabs while membership is unresolved', () => {
    for (const key of PORTAL_KEYS) {
      expect(canAccessClienteTab(key, unresolvedCan), key).toBe(false);
    }
  });

  // The custom-role case the coarse chassis check used to get wrong: a role
  // whose `workspaceRole` reads 'agent' but whose role_id permissions grant
  // configuracoes:editar clears the gate. HubRoleGate reads the same can(),
  // so the screen inside never contradicts this.
  it('allows the portal tabs to a custom role granting configuracoes:editar', () => {
    const customCan = makeCan(
      fakeMembership({
        role: 'agent',
        role_id: 'role-1',
        permissions: { configuracoes: 'editar' },
      }),
    );
    for (const key of PORTAL_KEYS) {
      expect(canAccessClienteTab(key, customCan), key).toBe(true);
    }
  });

  it('allows relatorios to an agent (analytics:ver, already granted by the legacy preset) and to an admin', () => {
    expect(canAccessClienteTab('relatorios', agentCan)).toBe(true);
    expect(canAccessClienteTab('relatorios', adminCan)).toBe(true);
  });

  it('denies financeiro unless can(financeiro, ver) resolves literally true', () => {
    expect(canAccessClienteTab('financeiro', unresolvedCan)).toBe(false);
    expect(canAccessClienteTab('financeiro', restrictedAdminCan)).toBe(false);
    expect(canAccessClienteTab('financeiro', ownerCan)).toBe(true);
    expect(canAccessClienteTab('financeiro', adminCan)).toBe(true);
    // Unlike the old role-list model (roles: ALL, canSeeFinancials the only
    // real gate — a synthetic "agent + canSeeFinancials:true" was
    // expressible even though never reachable in the real app), the legacy
    // agent preset now denies financeiro UNCONDITIONALLY ('none'), matching
    // the one value `deriveFinancialAccess` could ever actually produce for
    // an agent.
    expect(canAccessClienteTab('financeiro', agentCan)).toBe(false);
  });

  it('allows visao-geral/entregas/redes-sociais/arquivos to every membership state (permission: null)', () => {
    for (const can of [ownerCan, adminCan, restrictedAdminCan, agentCan, unresolvedCan]) {
      for (const key of ['visao-geral', 'entregas', 'redes-sociais', 'arquivos']) {
        expect(canAccessClienteTab(key, can)).toBe(true);
      }
    }
  });
});

describe('financeiroTabGuardOutcome', () => {
  it('returns content only for a literal true', () => {
    expect(financeiroTabGuardOutcome(true)).toBe('content');
  });

  it('returns loading (not denied) for unknown — fails neutral, never flashes a redirect', () => {
    expect(financeiroTabGuardOutcome('unknown')).toBe('loading');
  });

  it('returns denied for a resolved false', () => {
    expect(financeiroTabGuardOutcome(false)).toBe('denied');
  });
});

describe('i18n coverage', () => {
  it('has a pt and en string for every tab label and group label', () => {
    for (const tab of CLIENTE_TABS) {
      expect(lookup(pt, tab.labelKey), `pt ${tab.labelKey}`).toBeTypeOf('string');
      expect(lookup(en, tab.labelKey), `en ${tab.labelKey}`).toBeTypeOf('string');
    }
    for (const key of Object.values(CLIENTE_TAB_GROUP_LABELS)) {
      expect(lookup(pt, key), `pt ${key}`).toBeTypeOf('string');
      expect(lookup(en, key), `en ${key}`).toBeTypeOf('string');
    }
  });
});
