import { describe, expect, test } from 'vitest';
import { APP_ROUTE_PREFIXES, PUBLIC_ROUTES, routeMetaFor, SITE_URL } from '../site-meta';

describe('site-meta', () => {
  test('canonical origin is www', () => {
    expect(SITE_URL).toBe('https://www.mesaas.com.br');
  });

  test('routes are unique by path and title', () => {
    const paths = PUBLIC_ROUTES.map((r) => r.path);
    const titles = PUBLIC_ROUTES.map((r) => r.title);
    expect(new Set(paths).size).toBe(paths.length);
    expect(new Set(titles).size).toBe(titles.length);
  });

  test('every public route is prerendered', () => {
    for (const r of PUBLIC_ROUTES) expect(r.file, `${r.path} must have a file`).toBeTruthy();
  });

  test.each(PUBLIC_ROUTES.map((r) => [r.path, r] as const))(
    '%s meta respects the audit SERP ranges',
    (_path, r) => {
      expect(r.title.length).toBeGreaterThanOrEqual(50);
      expect(r.title.length).toBeLessThanOrEqual(60);
      expect(r.description.length).toBeGreaterThanOrEqual(120);
      expect(r.description.length).toBeLessThanOrEqual(160);
      expect(r.lastmod).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.file).toMatch(/\.html$/);
    },
  );

  test('routeMetaFor resolves and misses correctly', () => {
    expect(routeMetaFor('/precos')?.file).toBe('precos.html');
    expect(routeMetaFor('/')?.file).toBe('index.html');
    expect(routeMetaFor('/dashboard')).toBeUndefined();
  });

  test('app-route prefixes do not collide with public routes', () => {
    for (const prefix of APP_ROUTE_PREFIXES) {
      expect(PUBLIC_ROUTES.some((r) => r.path === `/${prefix}`)).toBe(false);
    }
  });
});
