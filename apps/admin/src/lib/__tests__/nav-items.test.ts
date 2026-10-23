import { describe, expect, it } from 'vitest';
import { NAV_GROUPS, PHONE_TABS, MAIS_GROUPS, hidesTabBar, isRouteActive } from '../nav-items';

describe('nav-items', () => {
  it('lists the 12 admin routes once, in four groups', () => {
    const all = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.to));
    expect(all).toEqual([
      '/admin',
      '/admin/metricas',
      '/admin/workspaces',
      '/admin/afiliados',
      '/admin/plans',
      '/admin/admins',
      '/admin/integrations',
      '/admin/banners',
      '/admin/popups',
      '/admin/blog',
      '/admin/kb-articles',
      '/admin/kb-videos',
    ]);
    expect(NAV_GROUPS.map((g) => g.label)).toEqual([
      null,
      'Plataforma',
      'Comunicação',
      'Central de Ajuda',
    ]);
  });
  it('phone tabs are the unlabelled group; Mais holds the rest', () => {
    expect(PHONE_TABS.map((t) => t.label)).toEqual([
      'Dashboard',
      'Métricas',
      'Workspaces',
      'Afiliados',
    ]);
    expect(MAIS_GROUPS.flatMap((g) => g.items).length).toBe(8);
  });
  it('isRouteActive: Dashboard only on /admin; others on their subtree', () => {
    expect(isRouteActive('/admin', '/admin')).toBe(true);
    expect(isRouteActive('/admin/workspaces', '/admin')).toBe(false);
    expect(isRouteActive('/admin/workspaces/abc', '/admin/workspaces')).toBe(true);
    expect(isRouteActive('/admin/workspaces-x', '/admin/workspaces')).toBe(false);
  });
  it('hidesTabBar only on the pushed KB editors', () => {
    expect(hidesTabBar('/admin/kb-articles/new')).toBe(true);
    expect(hidesTabBar('/admin/kb-articles/123/edit')).toBe(true);
    expect(hidesTabBar('/admin/kb-videos/new')).toBe(true);
    expect(hidesTabBar('/admin/kb-videos/9/edit')).toBe(true);
    expect(hidesTabBar('/admin/kb-articles')).toBe(false);
    expect(hidesTabBar('/admin/workspaces/1')).toBe(false);
  });
});
