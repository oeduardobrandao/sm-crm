/** Post-build prerender for all public marketing routes.
 * - dist/app.html    = SPA shell + noindex meta (served for app routes via vercel.json)
 * - dist/404.html    = branded 404 (Vercel serves it with HTTP 404 for unmatched paths)
 * - dist/<file>.html = shell + per-route head tags + semantic HTML in #root
 * - dist/sitemap.xml, dist/llms.txt
 * Legal pages are rendered from their real React components (pure JSX) via
 * renderToStaticMarkup; the other routes use their .seo.ts mirrors.
 * Run AFTER `vite build` (needs dist/index.html), BEFORE hub/admin builds. */
import { readFileSync, writeFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { PUBLIC_ROUTES } from '../../apps/crm/src/content/site-meta';
import { buildHeadTags } from '../../apps/crm/src/content/seo-head';
import { jsonLdForPath } from '../../apps/crm/src/content/route-jsonld';
import { buildSitemapXml } from '../../apps/crm/src/content/sitemap';
import { buildLlmsTxt } from '../../apps/crm/src/content/llms';
import { renderLandingHtml } from '../../apps/crm/src/content/landing.seo';
import { renderPrecosHtml } from '../../apps/crm/src/content/precos.seo';
import { MARKETING_PAGES, marketingPageBySlug } from '../../apps/crm/src/content/paginas';
import { renderMarketingPageHtml } from '../../apps/crm/src/content/paginas.seo';
import { changelogSchema } from '../../apps/crm/src/content/changelog.schema';
import { renderChangelogHtml } from '../../apps/crm/src/content/changelog.seo';
import PoliticaPage from '../../apps/crm/src/pages/politica-privacidade/PoliticaPage';
import TermosPage from '../../apps/crm/src/pages/termos-de-uso/TermosPage';
import LgpdPage from '../../apps/crm/src/pages/lgpd/LgpdPage';

const rawChangelog = JSON.parse(readFileSync('apps/crm/src/content/changelog.json', 'utf8'));
const parsed = changelogSchema.safeParse(rawChangelog);
const releases = parsed.success ? parsed.data.releases : [];

function bodyFor(path: string): string | undefined {
  if (path === '/') return renderLandingHtml();
  if (path === '/precos') return renderPrecosHtml();
  if (path === '/novidades') return renderChangelogHtml(releases);
  if (path === '/politica-de-privacidade') return renderToStaticMarkup(<PoliticaPage />);
  if (path === '/termos-de-uso') return renderToStaticMarkup(<TermosPage />);
  if (path === '/lgpd') return renderToStaticMarkup(<LgpdPage />);
  const page = marketingPageBySlug(path.slice(1));
  return page ? renderMarketingPageHtml(page) : undefined;
}

const shell = readFileSync('dist/index.html', 'utf8');

/** All prerender injections use String.replace against markers in the built
 * shell (title/description regexes, `</head>`, `<div id="root"></div>`). If
 * the shell's markup ever drifts, a plain `.replace()` silently no-ops and
 * ships a broken page while the build stays green. This wrapper makes that
 * failure loud: it throws unless the replacement actually changed the html. */
function mustReplace(
  html: string,
  pattern: string | RegExp,
  replacement: string,
  label: string,
): string {
  const out = html.replace(pattern, replacement);
  if (out === html) throw new Error(`prerender: marker not found: ${label}`);
  return out;
}

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
  html = mustReplace(
    html,
    '</head>',
    `    ${buildHeadTags(route, jsonLdForPath(route.path))}\n  </head>`,
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

writeFileSync('dist/sitemap.xml', buildSitemapXml(PUBLIC_ROUTES));
writeFileSync('dist/llms.txt', buildLlmsTxt(PUBLIC_ROUTES));
console.log(
  `Prerendered ${written} routes (+app.html, 404.html, sitemap.xml, llms.txt). Marketing pages: ${MARKETING_PAGES.length}.`,
);
