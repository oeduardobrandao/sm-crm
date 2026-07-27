import type { RouteMeta } from './site-meta';
import { canonicalUrl } from './seo-head';
import type { BlogPost } from './blog.schema';
import { blogPostRouteMeta } from './blog';

export function buildSitemapXml(routes: RouteMeta[]): string {
  const urls = routes
    .map((r) => `  <url><loc>${canonicalUrl(r.path)}</loc><lastmod>${r.lastmod}</lastmod></url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

/** Applies the two derived lastmod dates that change without anyone editing
 * the route manifest: `/novidades` from the latest changelog release,
 * `/blog` from the most recently updated post. Every other route keeps its
 * manifest `lastmod` untouched. Also used for llms.txt, which lists routes
 * without the per-post entries `sitemapRoutes` appends below. */
export function routesWithDerivedDates(
  routes: RouteMeta[],
  posts: BlogPost[],
  latestRelease?: string,
): RouteMeta[] {
  const latestPost = posts
    .map((p) => p.updated)
    .sort()
    .slice(-1)[0];
  return routes.map((r) => {
    if (r.path === '/novidades' && latestRelease) return { ...r, lastmod: latestRelease };
    if (r.path === '/blog' && latestPost) return { ...r, lastmod: latestPost };
    return r;
  });
}

/** Full sitemap route list: the manifest routes with derived dates applied,
 * plus one entry per blog post. Pure — the prerender script is the only
 * caller with I/O; this function just assembles data it's handed. */
export function sitemapRoutes(
  routes: RouteMeta[],
  posts: BlogPost[],
  latestRelease?: string,
): RouteMeta[] {
  return [...routesWithDerivedDates(routes, posts, latestRelease), ...posts.map(blogPostRouteMeta)];
}
