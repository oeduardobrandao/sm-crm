import { describe, expect, it } from 'vitest';
import { getVisibleNavItems } from '../navItems';

describe('getVisibleNavItems', () => {
  it('includes Mensagens when feature_mensagens is true', () => {
    const items = getVisibleNavItems(true);
    expect(items.some((i) => i.path === '/mensagens')).toBe(true);
  });

  it('excludes Mensagens when feature_mensagens is false', () => {
    const items = getVisibleNavItems(false);
    expect(items.some((i) => i.path === '/mensagens')).toBe(false);
  });

  it('always includes every other destination regardless of the flag', () => {
    const withFlag = getVisibleNavItems(true).map((i) => i.path);
    const withoutFlag = getVisibleNavItems(false).map((i) => i.path);
    const alwaysPresent = [
      '',
      '/aprovacoes',
      '/postagens',
      '/paginas',
      '/briefing',
      '/marca',
      '/ideias',
      '/relatorios',
    ];
    for (const path of alwaysPresent) {
      expect(withFlag).toContain(path);
      expect(withoutFlag).toContain(path);
    }
  });
});
