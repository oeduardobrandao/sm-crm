import { describe, expect, it } from 'vitest';
import { PUBLIC_ROUTES } from '../site-meta';
import { isPortugueseSitePage, siteLocaleForPath } from '../siteLocale';

describe('isPortugueseSitePage', () => {
  it('covers every Portuguese public route', () => {
    for (const route of PUBLIC_ROUTES.filter((r) => (r.locale ?? 'pt') === 'pt')) {
      expect(isPortugueseSitePage(route.path), route.path).toBe(true);
    }
  });

  it('never covers an English route', () => {
    for (const route of PUBLIC_ROUTES.filter((r) => r.locale === 'en')) {
      expect(isPortugueseSitePage(route.path), route.path).toBe(false);
      expect(siteLocaleForPath(route.path)).toBe('en');
    }
  });

  it('covers blog posts and tolerates a trailing slash', () => {
    expect(isPortugueseSitePage('/blog/como-aprovar-posts')).toBe(true);
    expect(isPortugueseSitePage('/precos/')).toBe(true);
  });

  it('leaves signup, the app and other pages to the saved language', () => {
    for (const path of ['/login', '/dashboard', '/workspace-setup', '/comecar', '/afiliados']) {
      expect(isPortugueseSitePage(path), path).toBe(false);
    }
    expect(isPortugueseSitePage('/blog/a/b')).toBe(false);
  });
});
