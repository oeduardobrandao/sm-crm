import { describe, expect, test } from 'vitest';
import vercelConfig from '../../../../../vercel.json';
import { APP_ROUTE_PREFIXES, PUBLIC_ROUTES } from '../site-meta';

const rewrites = vercelConfig.rewrites as Array<{ source: string; destination: string }>;
const headers = vercelConfig.headers as Array<{
  source: string;
  headers: Array<{ key: string; value: string }>;
}>;

describe('vercel.json routing contract', () => {
  test('every app-route prefix is captured by the app-shell rewrite', () => {
    const appShell = rewrites.find((r) => r.destination === '/app.html');
    expect(appShell).toBeDefined();
    for (const prefix of APP_ROUTE_PREFIXES) {
      expect(appShell!.source, `prefix ${prefix} missing from app-shell rewrite`).toContain(prefix);
    }
  });

  test('every prerendered route has an explicit rewrite (or is the filesystem root)', () => {
    for (const r of PUBLIC_ROUTES.filter((r) => r.file && r.path !== '/')) {
      expect(
        rewrites.some((w) => w.source === r.path && w.destination === `/${r.file}`),
        `missing rewrite for ${r.path}`,
      ).toBe(true);
    }
  });

  test('no broad SPA catch-all remains (unknown URLs must 404)', () => {
    expect(rewrites.some((r) => r.source.includes('(?!hub/'))).toBe(false);
  });

  test('app shell and app routes carry X-Robots-Tag noindex', () => {
    const noindexSources = headers
      .filter((h) => h.headers.some((x) => x.key === 'X-Robots-Tag' && /noindex/.test(x.value)))
      .map((h) => h.source);
    const appShell = rewrites.find((r) => r.destination === '/app.html');
    expect(appShell).toBeDefined();

    expect(noindexSources).toContain('/app.html');
    expect(noindexSources).toContain(appShell!.source);
    expect(noindexSources).toContain('/admin(/.*)?');
    // Hub URLs need TWO exact header entries — a single `:token(/.*)?` source
    // does not match real hub URLs under Vercel's path-to-regexp routing, so
    // both the bare and nested-path shapes (mirroring the hub rewrites) must
    // be present.
    expect(noindexSources).toContain('/:workspace/hub/:token');
    expect(noindexSources).toContain('/:workspace/hub/:token/(.*)');
  });
});
