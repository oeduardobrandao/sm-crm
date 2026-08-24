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

  test('print do relatorio reescreve para o hub ANTES do app-shell (que captura relatorios/*)', () => {
    const printIdx = rewrites.findIndex((r) => r.source === '/relatorios/print/:docId');
    const appShellIdx = rewrites.findIndex((r) => r.destination === '/app.html');
    expect(printIdx).toBeGreaterThanOrEqual(0);
    expect(rewrites[printIdx].destination).toBe('/hub/index.html');
    expect(printIdx).toBeLessThan(appShellIdx);
  });

  test('print do relatorio carrega noindex', () => {
    const noindexSources = headers
      .filter((h) => h.headers.some((x) => x.key === 'X-Robots-Tag' && /noindex/.test(x.value)))
      .map((h) => h.source);
    expect(noindexSources).toContain('/relatorios/print/:docId');
  });

  test('blog index and post rewrites exist', () => {
    expect(rewrites).toContainEqual({ source: '/blog', destination: '/blog.html' });
    expect(rewrites).toContainEqual({ source: '/blog/:slug', destination: '/blog/:slug.html' });
  });

  test('the blog is public — never covered by a noindex header', () => {
    const noindexSources = headers
      .filter((h) => h.headers.some((x) => x.key === 'X-Robots-Tag' && /noindex/.test(x.value)))
      .map((h) => h.source);
    for (const source of noindexSources) expect(source).not.toContain('blog');
    expect(APP_ROUTE_PREFIXES as readonly string[]).not.toContain('blog');
  });
});
