import { describe, it, expect } from 'vitest';
import {
  CLIENTE_TABS,
  canAccessClienteTab,
  visibleClienteTabs,
  financeiroTabGuardOutcome,
} from '../clienteTabs.model';
import { makeCan, fakeMembership } from '@/test/makeCan';

const ownerCan = makeCan(fakeMembership({ role: 'owner' }));
const adminCan = makeCan(fakeMembership({ role: 'admin', can_see_financials: true }));
const restrictedAdminCan = makeCan(fakeMembership({ role: 'admin', can_see_financials: false }));
const agentCan = makeCan(fakeMembership({ role: 'agent' }));
// Unresolved membership -- the real-world equivalent of the old
// `canSeeFinancials: 'unknown'` synthetic input, but now it fails EVERY
// can()-gated tab uniformly, not just financeiro.
const unresolvedCan = makeCan(null);

describe('CLIENTE_TABS', () => {
  it('declares the seven tabs, grouped Cliente / Canais e análise / Gestão, in order', () => {
    expect(CLIENTE_TABS.map((t) => [t.key, t.group])).toEqual([
      ['visao-geral', 'cliente'],
      ['entregas', 'cliente'],
      ['redes-sociais', 'canais'],
      ['relatorios', 'canais'],
      ['hub', 'gestao'],
      ['arquivos', 'gestao'],
      ['financeiro', 'gestao'],
    ]);
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
  it('shows all seven tabs to an owner with financial access', () => {
    const keys = visibleClienteTabs(ownerCan).map((t) => t.key);
    expect(keys).toEqual([
      'visao-geral',
      'entregas',
      'redes-sociais',
      'relatorios',
      'hub',
      'arquivos',
      'financeiro',
    ]);
  });

  // Task 12 divergence from the OLD role-list model, both directions:
  // `relatorios` now maps to {analytics,ver}, and the legacy agent preset
  // already grants 'ver' there (it did before this task too, for the
  // top-level /analytics route) -- so an agent GAINS the tab. `hub` now maps
  // to {configuracoes,editar}, which the legacy agent preset has always
  // lacked ('none') -- so an agent LOSES the tab it used to reach (and see a
  // RoleRestrictionNotice inside). Both are directed by the task-12 brief,
  // not incidental.
  it('shows relatorios (agent preset already grants analytics:ver) but hides hub (agent preset has configuracoes:none) and financeiro', () => {
    const keys = visibleClienteTabs(agentCan).map((t) => t.key);
    expect(keys).toContain('relatorios');
    expect(keys).not.toContain('hub');
    expect(keys).not.toContain('financeiro');
    expect(keys).toContain('redes-sociais');
  });

  it('hides financeiro from a restricted admin but keeps relatorios and hub (admin is unconditional true outside financeiro/contratos)', () => {
    const keys = visibleClienteTabs(restrictedAdminCan).map((t) => t.key);
    expect(keys).not.toContain('financeiro');
    expect(keys).toContain('relatorios');
    expect(keys).toContain('hub');
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

  it('denies hub to an agent, allows it to an admin (configuracoes:editar)', () => {
    expect(canAccessClienteTab('hub', agentCan)).toBe(false);
    expect(canAccessClienteTab('hub', adminCan)).toBe(true);
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
