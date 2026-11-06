/** Post-build prerender for all public marketing routes.
 * - dist/app.html    = SPA shell + noindex meta (served for app routes via vercel.json)
 * - dist/404.html    = branded 404 (Vercel serves it with HTTP 404 for unmatched paths)
 * - dist/<file>.html = shell + per-route head tags + semantic HTML in #root
 * - dist/sitemap.xml, dist/llms.txt
 * `/` is the real landing page, server-rendered from apps/crm/src/entry-server.tsx: this
 * script first runs a Vite SSR build of it (apps/crm/vite.ssr.config.ts) into
 * node_modules/.cache/landing-ssr, never dist/, then imports that bundle. The client hydrates
 * the markup (main.tsx), so landing render code must be hydration-stable: no render-time
 * browser reads, the "anonymous first visit" state on the server and the first client render.
 * The SSR bundle is single-file (inlineDynamicImports), so every CRM module's top-level code,
 * every lazy page and not just the landing, runs in Node at prerender: a module-level
 * window/document/localStorage access anywhere breaks the Vercel build (the
 * landing-prerender-smoke CI job catches it).
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
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'vite';
import { PUBLIC_ROUTES } from '../../apps/crm/src/content/site-meta';
import { buildHeadTags } from '../../apps/crm/src/content/seo-head';
import { jsonLdForPath } from '../../apps/crm/src/content/route-jsonld';
import {
  buildSitemapXml,
  routesWithDerivedDates,
  sitemapRoutes,
} from '../../apps/crm/src/content/sitemap';
import { buildLlmsTxt } from '../../apps/crm/src/content/llms';
import { renderPrecosHtml } from '../../apps/crm/src/content/precos.seo';
import { marketingPageBySlug } from '../../apps/crm/src/content/paginas';
import { renderMarketingPageHtml } from '../../apps/crm/src/content/paginas.seo';
import { changelogSchema } from '../../apps/crm/src/content/changelog.schema';
import { renderChangelogHtml } from '../../apps/crm/src/content/changelog.seo';
import { loadPostsFromDisk } from './blog-fs';
import { mustReplace } from './mustReplace';
import {
  deferEntryScript,
  imagePreloadTag,
  routePreloadTags,
  type BuildManifest,
} from './routePreload';
import {
  HERO_MACBOOK_SIZES,
  HERO_MACBOOK_SRCSET,
} from '../../apps/crm/src/pages/landing/landing-visuals';
import {
  blogRevisionMetaTag,
  renderBlogIndexHtml,
  renderBlogPostHtml,
} from '../../apps/crm/src/content/blog.seo';
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

// Must match build.outDir + entryFileNames in apps/crm/vite.ssr.config.ts.
const LANDING_SSR_ENTRY = resolve('node_modules/.cache/landing-ssr/entry-server.mjs');

interface LandingServerEntry {
  render(url: string): Promise<{ html: string }>;
}

async function renderLanding(): Promise<string> {
  await build({ configFile: resolve('apps/crm/vite.ssr.config.ts'), logLevel: 'warn' });
  const entry = (await import(pathToFileURL(LANDING_SSR_ENTRY).href)) as LandingServerEntry;
  const { html } = await entry.render('/');
  // entry-server already throws on a render error; these guard the contract main.tsx hydrates.
  if (!html.includes('lp2-hero')) {
    throw new Error('prerender: server-rendered landing has no lp2-hero (Suspense fallback?)');
  }
  if (html.includes('__staticRouterHydrationData')) {
    throw new Error('prerender: landing must render with hydrate={false}');
  }
  return html;
}

const landingHtml = await renderLanding();

function bodyFor(path: string): string | undefined {
  if (path === '/') return landingHtml;
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
// Written by `vite build` (build.manifest in apps/crm/vite.config.ts). Only the
// prerendered marketing routes get preload hints; app.html and 404.html stay
// on the pristine shell.
const manifest = JSON.parse(readFileSync('dist/build-manifest.json', 'utf8')) as BuildManifest;

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
  // The landing is always dark, so its LCP image is the dark MacBook render.
  const preload = [
    route.path === '/' ? imagePreloadTag(HERO_MACBOOK_SRCSET, HERO_MACBOOK_SIZES) : '',
    // `/` is server-rendered: it paints from HTML + CSS, so only its stylesheets are preloaded
    // and its JS starts after the first paint (deferEntryScript below).
    routePreloadTags(manifest, route.path, { scripts: route.path !== '/' }),
  ]
    .filter(Boolean)
    .join('\n    ');
  html = mustReplace(
    html,
    '</head>',
    `    ${buildHeadTags(route, jsonLd)}\n${preload ? `    ${preload}\n` : ''}  </head>`,
    `${route.path}:head`,
  );
  if (route.path === '/') {
    // `data-ssr` tells main.tsx to hydrate; LandingPage removes it on mount. `landing-page` on
    // <body> is what LandingChrome adds on mount, present from the first paint here.
    html = mustReplace(html, '<body>', '<body class="landing-page">', '/:body-class');
    html = deferEntryScript(html);
    html = mustReplace(
      html,
      '<div id="root"></div>',
      `<div id="root" data-ssr="landing">${body}</div>`,
      '/:body',
    );
  } else {
    html = mustReplace(
      html,
      '<div id="root"></div>',
      `<div id="root">${body}</div>`,
      `${route.path}:body`,
    );
  }
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
  // DB posts also carry their revision, which the Admin reads back to see
  // when a published edit is live.
  const revMeta = blogRevisionMetaTag(post);
  let html = stripBaseMeta(shell);
  html = mustReplace(
    html,
    '</head>',
    `    ${buildHeadTags(meta, jsonLd)}\n${revMeta ? `    ${revMeta}\n` : ''}  </head>`,
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
// The server bundle's module graph (Supabase client, timers) can keep Node alive.
process.exit(0);
