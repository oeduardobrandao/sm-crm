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

  it('declares badge keys for aprovacoes and mensagens only', () => {
    const items = getVisibleNavItems(true);
    expect(items.find((i) => i.path === '/aprovacoes')?.badge).toBe('aprovacoes');
    expect(items.find((i) => i.path === '/mensagens')?.badge).toBe('mensagens');
    expect(items.filter((i) => i.badge).length).toBe(2);
  });

  it('includes Agenda only when feature_agenda is true, right after Postagens', () => {
    expect(getVisibleNavItems(true).some((i) => i.path === '/agenda')).toBe(false);
    expect(getVisibleNavItems(true, false).some((i) => i.path === '/agenda')).toBe(false);
    const paths = getVisibleNavItems(false, true).map((i) => i.path);
    expect(paths).toContain('/agenda');
    expect(paths.indexOf('/agenda')).toBe(paths.indexOf('/postagens') + 1);
  });

  it('the Agenda item has no badge and uses the nav.agenda label', () => {
    const agenda = getVisibleNavItems(true, true).find((i) => i.path === '/agenda');
    expect(agenda?.labelKey).toBe('nav.agenda');
    expect(agenda?.badge).toBeUndefined();
  });
});
