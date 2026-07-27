/** Post-build prerender for all public marketing routes.
 * - dist/app.html    = SPA shell + noindex meta (served for app routes via vercel.json)
 * - dist/404.html    = branded 404 (Vercel serves it with HTTP 404 for unmatched paths)
 * - dist/<file>.html = shell + per-route head tags + semantic HTML in #root
 * - dist/sitemap.xml, dist/llms.txt
 * Legal pages are rendered from their real React components (pure JSX) via
 * renderToStaticMarkup; the other routes use their .seo.ts mirrors.
 * Run AFTER `vite build` (needs dist/index.html), BEFORE hub/admin builds.
 * NOT idempotent: route `/` overwrites dist/index.html, which is the exact
 * shell this script reads at startup. A second run in a row reads back its
 * own output — whose `<div id="root">` is already filled with the landing
 * page's markup, not empty — so the body-injection marker no longer matches
 * and it dies with "marker not found: 404.html:body". Fails loudly (good),
 * but the fix is a fresh `vite build`, not a retry: run `npm run build`
 * again before re-running `npm run prerender`. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { PUBLIC_ROUTES } from '../../apps/crm/src/content/site-meta';
import { buildHeadTags } from '../../apps/crm/src/content/seo-head';
import { jsonLdForPath } from '../../apps/crm/src/content/route-jsonld';
import {
  buildSitemapXml,
  routesWithDerivedDates,
  sitemapRoutes,
} from '../../apps/crm/src/content/sitemap';
import { buildLlmsTxt } from '../../apps/crm/src/content/llms';
import { renderLandingHtml } from '../../apps/crm/src/content/landing.seo';
import { renderPrecosHtml } from '../../apps/crm/src/content/precos.seo';
import { marketingPageBySlug } from '../../apps/crm/src/content/paginas';
import { renderMarketingPageHtml } from '../../apps/crm/src/content/paginas.seo';
import { changelogSchema } from '../../apps/crm/src/content/changelog.schema';
import { renderChangelogHtml } from '../../apps/crm/src/content/changelog.seo';
import { loadPostsFromDisk } from './blog-fs';
import { mustReplace } from './mustReplace';
import { renderBlogIndexHtml, renderBlogPostHtml } from '../../apps/crm/src/content/blog.seo';
import { blogPostRouteMeta, postPath } from '../../apps/crm/src/content/blog';
import {
  blogIndexJsonLd,
  blogPostingJsonLd,
  breadcrumbJsonLd,
} from '../../apps/crm/src/content/jsonld';
import PoliticaPage from '../../apps/crm/src/pages/politica-privacidade/PoliticaPage';
import TermosPage from '../../apps/crm/src/pages/termos-de-uso/TermosPage';
import LgpdPage from '../../apps/crm/src/pages/lgpd/LgpdPage';

const rawChangelog = JSON.parse(readFileSync('apps/crm/src/content/changelog.json', 'utf8'));
const parsed = changelogSchema.safeParse(rawChangelog);
const releases = parsed.success ? parsed.data.releases : [];
const posts = loadPostsFromDisk();

function bodyFor(path: string): string | undefined {
  if (path === '/') return renderLandingHtml();
  if (path === '/precos') return renderPrecosHtml();
  if (path === '/novidades') return renderChangelogHtml(releases);
  if (path === '/blog') return renderBlogIndexHtml(posts);
  if (path === '/politica-de-privacidade') return renderToStaticMarkup(<PoliticaPage />);
  if (path === '/termos-de-uso') return renderToStaticMarkup(<TermosPage />);
  if (path === '/lgpd') return renderToStaticMarkup(<LgpdPage />);
  const page = marketingPageBySlug(path.slice(1));
  return page ? renderMarketingPageHtml(page) : undefined;
}

const shell = readFileSync('dist/index.html', 'utf8');

function stripBaseMeta(html: string): string {
  let out = mustReplace(html, /<title>[\s\S]*?<\/title>\n?/, '', 'stripBaseMeta:title');
  out = mustReplace(out, /<meta name="description"[^>]*\/>\n?/, '', 'stripBaseMeta:description');
  return out;
}

// App shell: pristine assets, but never indexable.
writeFileSync(
  'dist/app.html',
  mustReplace(
    shell,
    '</head>',
    '    <meta name="robots" content="noindex, nofollow" />\n  </head>',
    'app.html:head',
  ),
);

// Real 404 (Vercel serves dist/404.html with status 404 for unmatched paths).
let notFound = stripBaseMeta(shell);
notFound = mustReplace(
  notFound,
  '</head>',
  '    <title>Página não encontrada — Mesaas</title>\n    <meta name="robots" content="noindex" />\n  </head>',
  '404.html:head',
);
notFound = mustReplace(
  notFound,
  '<div id="root"></div>',
  '<div id="root"><h1>Página não encontrada</h1><p>O endereço que você acessou não existe ou mudou de lugar.</p><p><a href="/">Ir para a página inicial</a> · <a href="/login">Entrar no Mesaas</a></p></div>',
  '404.html:body',
);
writeFileSync('dist/404.html', notFound);

let written = 0;
for (const route of PUBLIC_ROUTES) {
  if (!route.file) continue;
  const body = bodyFor(route.path);
  if (body === undefined) {
    throw new Error(`No body renderer registered for prerendered route ${route.path}`);
  }
  let html = stripBaseMeta(shell);
  const jsonLd = route.path === '/blog' ? [blogIndexJsonLd(posts)] : jsonLdForPath(route.path);
  html = mustReplace(
    html,
    '</head>',
    `    ${buildHeadTags(route, jsonLd)}\n  </head>`,
    `${route.path}:head`,
  );
  html = mustReplace(
    html,
    '<div id="root"></div>',
    `<div id="root">${body}</div>`,
    `${route.path}:body`,
  );
  writeFileSync(`dist/${route.file}`, html);
  written++;
}

mkdirSync('dist/blog', { recursive: true });
for (const post of posts) {
  const meta = blogPostRouteMeta(post);
  const jsonLd = [
    blogPostingJsonLd(post),
    breadcrumbJsonLd([
      { name: 'Início', path: '/' },
      { name: 'Blog', path: '/blog' },
      { name: post.h1, path: postPath(post) },
    ]),
  ];
  let html = stripBaseMeta(shell);
  html = mustReplace(
    html,
    '</head>',
    `    ${buildHeadTags(meta, jsonLd)}\n  </head>`,
    `${meta.path}:head`,
  );
  html = mustReplace(
    html,
    '<div id="root"></div>',
    `<div id="root">${renderBlogPostHtml(post, posts)}</div>`,
    `${meta.path}:body`,
  );
  writeFileSync(`dist/${meta.file}`, html);
}

// Two index pages change without anyone editing the manifest, so their real
// lastmod is derived here: /novidades from the latest release, /blog from the
// most recently updated post. `changelog.json` isn't asserted to be
// newest-first, so the max is computed the same way the post date is below.
const latestRelease = releases
  .map((r) => r.date)
  .sort()
  .at(-1);
const routes = routesWithDerivedDates(PUBLIC_ROUTES, posts, latestRelease);
writeFileSync(
  'dist/sitemap.xml',
  buildSitemapXml(sitemapRoutes(PUBLIC_ROUTES, posts, latestRelease)),
);
writeFileSync('dist/llms.txt', buildLlmsTxt(routes, posts));
console.log(
  `Prerendered ${written} routes + ${posts.length} blog posts (+app.html, 404.html, sitemap.xml, llms.txt).`,
);
