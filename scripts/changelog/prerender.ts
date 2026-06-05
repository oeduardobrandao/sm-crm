import { readFileSync, writeFileSync } from 'node:fs';
import { changelogSchema } from '../../apps/crm/src/content/changelog.schema';
import { renderChangelogHtml } from '../../apps/crm/src/content/changelog.seo';

const SITE_URL = process.env.SITE_URL ?? 'https://app.mesaas.com';
const DIST = 'dist/index.html';
const OUT = 'dist/novidades.html';

const raw = JSON.parse(readFileSync('apps/crm/src/content/changelog.json', 'utf8'));
const parsed = changelogSchema.safeParse(raw);
const releases = parsed.success ? parsed.data.releases : [];
const content = renderChangelogHtml(releases);

const meta = [
  `<title>Novidades — Mesaas</title>`,
  `<meta name="description" content="As novidades e funcionalidades mais recentes do Mesaas, atualizadas toda semana." />`,
  `<link rel="canonical" href="${SITE_URL}/novidades" />`,
  `<meta property="og:type" content="website" />`,
  `<meta property="og:title" content="Novidades — Mesaas" />`,
  `<meta property="og:description" content="Veja o que há de novo no Mesaas." />`,
  `<meta property="og:url" content="${SITE_URL}/novidades" />`,
].join('\n    ');

let html = readFileSync(DIST, 'utf8');
html = html.replace(/<title>[\s\S]*?<\/title>/, ''); // strip whatever title index.html ships
html = html.replace('</head>', `    ${meta}\n  </head>`);
html = html.replace('<div id="root"></div>', `<div id="root">${content}</div>`);
writeFileSync(OUT, html);
console.log(`Wrote ${OUT} (${releases.length} release blocks)`);
