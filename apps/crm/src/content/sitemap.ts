import type { RouteMeta } from './site-meta';
import { canonicalUrl } from './seo-head';

export function buildSitemapXml(routes: RouteMeta[]): string {
  const urls = routes
    .map((r) => `  <url><loc>${canonicalUrl(r.path)}</loc><lastmod>${r.lastmod}</lastmod></url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
