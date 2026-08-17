import { describe, it, expect } from 'vitest';
import {
  CLIENTE_TABS,
  canAccessClienteTab,
  canAccessClienteTabRole,
  visibleClienteTabs,
  financeiroTabGuardOutcome,
} from '../clienteTabs.model';

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
    const keys = visibleClienteTabs('owner', true).map((t) => t.key);
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

  it('hides relatorios and financeiro from an agent', () => {
    const keys = visibleClienteTabs('agent', false).map((t) => t.key);
    expect(keys).not.toContain('relatorios');
    expect(keys).not.toContain('financeiro');
    expect(keys).toContain('hub');
    expect(keys).toContain('redes-sociais');
  });

  it('hides financeiro from a restricted admin but keeps relatorios', () => {
    const keys = visibleClienteTabs('admin', false).map((t) => t.key);
    expect(keys).not.toContain('financeiro');
    expect(keys).toContain('relatorios');
  });

  it('hides financeiro while canSeeFinancials is unknown (no flash, no premature show)', () => {
    const keys = visibleClienteTabs('owner', 'unknown').map((t) => t.key);
    expect(keys).not.toContain('financeiro');
  });

  it('shows nothing for a null workspaceRole', () => {
    expect(visibleClienteTabs(null, 'unknown')).toEqual([]);
  });
});

describe('canAccessClienteTab', () => {
  it('denies an unknown tab key', () => {
    expect(canAccessClienteTab('bogus', 'owner', true)).toBe(false);
  });

  it('denies relatorios to an agent, allows it to an admin', () => {
    expect(canAccessClienteTab('relatorios', 'agent', false)).toBe(false);
    expect(canAccessClienteTab('relatorios', 'admin', false)).toBe(true);
  });

  it('denies financeiro unless canSeeFinancials is literally true', () => {
    expect(canAccessClienteTab('financeiro', 'owner', 'unknown')).toBe(false);
    expect(canAccessClienteTab('financeiro', 'owner', false)).toBe(false);
    expect(canAccessClienteTab('financeiro', 'owner', true)).toBe(true);
    expect(canAccessClienteTab('financeiro', 'admin', true)).toBe(true);
    expect(canAccessClienteTab('financeiro', 'agent', true)).toBe(true); // role list is ALL by design; canSeeFinancials is the real gate
  });

  it('allows visao-geral/entregas/redes-sociais/hub/arquivos to every role', () => {
    for (const key of ['visao-geral', 'entregas', 'redes-sociais', 'hub', 'arquivos']) {
      expect(canAccessClienteTab(key, 'agent', false)).toBe(true);
    }
  });
});

describe('canAccessClienteTabRole', () => {
  it('ignores canSeeFinancials entirely — even for financeiro', () => {
    expect(canAccessClienteTabRole('financeiro', 'owner')).toBe(true);
    expect(canAccessClienteTabRole('relatorios', 'agent')).toBe(false);
    expect(canAccessClienteTabRole('relatorios', 'admin')).toBe(true);
  });

  it('denies an unknown tab key', () => {
    expect(canAccessClienteTabRole('bogus', 'owner')).toBe(false);
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
