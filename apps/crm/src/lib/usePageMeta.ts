import { useEffect } from 'react';
// Relative imports on purpose: this hook is in the prerender script's import
// graph (legal pages), which cannot resolve the @/ alias.
import { DEFAULT_OG_IMAGE, routeMetaFor, type RouteMeta } from '../content/site-meta';
import { canonicalUrl } from '../content/seo-head';
import { jsonLdForPath } from '../content/route-jsonld';

function upsertMeta(attr: 'name' | 'property', key: string, content: string): void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

function applyHead(meta: RouteMeta, jsonLd: object[]): void {
  const url = canonicalUrl(meta.path);
  const image = meta.ogImage ?? DEFAULT_OG_IMAGE;
  document.title = meta.title;
  upsertMeta('name', 'description', meta.description);
  upsertMeta('property', 'og:title', meta.title);
  upsertMeta('property', 'og:description', meta.description);
  upsertMeta('property', 'og:url', url);
  upsertMeta('property', 'og:image', image);
  upsertMeta('name', 'twitter:title', meta.title);
  upsertMeta('name', 'twitter:description', meta.description);
  upsertMeta('name', 'twitter:image', image);
  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'canonical';
    document.head.appendChild(link);
  }
  link.href = url;
  document.head.querySelectorAll('script[data-seo="jsonld"]').forEach((el) => el.remove());
  for (const block of jsonLd) {
    const s = document.createElement('script');
    s.type = 'application/ld+json';
    s.dataset.seo = 'jsonld';
    s.textContent = JSON.stringify(block);
    document.head.appendChild(s);
  }
}

/** Keeps head tags in sync on client-side navigation between public pages.
 * Prerendered HTML ships the same values for the initial load. useEffect-only:
 * must stay a no-op under renderToStaticMarkup (legal pages are prerendered
 * by rendering the real components). */
export function usePageMeta(path: string): void {
  useEffect(() => {
    const meta = routeMetaFor(path);
    if (!meta) return;
    applyHead(meta, jsonLdForPath(path));
  }, [path]);
}

/** Same, for routes that are not in the static manifest (blog posts). Callers
 * must memoize both arguments — they are the effect's dependencies. */
export function usePageMetaFor(meta: RouteMeta | undefined, jsonLd: object[]): void {
  useEffect(() => {
    if (!meta) return;
    applyHead(meta, jsonLd);
  }, [meta, jsonLd]);
}
