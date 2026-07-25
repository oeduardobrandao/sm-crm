import type { RouteMeta } from './site-meta';
import { DEFAULT_OG_IMAGE, SITE_NAME, SITE_URL } from './site-meta';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ESC[c]);
}

export function canonicalUrl(path: string): string {
  return path === '/' ? `${SITE_URL}/` : `${SITE_URL}${path}`;
}

/** Head block injected by scripts/seo/prerender.tsx. Indentation matches the
 * two-space style of apps/crm/index.html. */
export function buildHeadTags(meta: RouteMeta, jsonLd: object[] = []): string {
  const url = canonicalUrl(meta.path);
  const image = meta.ogImage ?? DEFAULT_OG_IMAGE;
  const tags = [
    `<title>${esc(meta.title)}</title>`,
    `<meta name="description" content="${esc(meta.description)}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:title" content="${esc(meta.title)}" />`,
    `<meta property="og:description" content="${esc(meta.description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:locale" content="pt_BR" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(meta.title)}" />`,
    `<meta name="twitter:description" content="${esc(meta.description)}" />`,
    `<meta name="twitter:image" content="${image}" />`,
  ];
  for (const block of jsonLd) {
    tags.push(
      `<script type="application/ld+json" data-seo="jsonld">${JSON.stringify(block).replace(/</g, '\\u003c')}</script>`,
    );
  }
  return tags.join('\n    ');
}
