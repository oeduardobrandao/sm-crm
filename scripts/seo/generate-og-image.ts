// Generates the default OG image plus one per blog post (1200x630). Rerun and
// re-commit when the tagline or a post title changes: npm run og:image
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { loadPostsFromDisk } from './blog-fs';

const CATEGORY_LABEL: Record<string, string> = { comparativo: 'Comparativo', guia: 'Guia' };

const STYLE = `
  * { margin: 0; box-sizing: border-box; }
  body {
    width: 1200px; height: 630px; display: flex; flex-direction: column;
    justify-content: center; padding: 96px; background: #12151a; color: #e8eaf0;
    font-family: 'DM Sans', -apple-system, 'Segoe UI', sans-serif;
  }
  .logo { color: #eab308; font-size: 54px; font-weight: 900; letter-spacing: -1px; }
  .eyebrow { color: #eab308; font-size: 24px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
  h1 { font-size: 60px; font-weight: 800; line-height: 1.14; margin: 24px 0 20px; max-width: 1000px; }
  p { font-size: 28px; color: #9ca3af; max-width: 900px; }
`;

function page(body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body>${body}</body></html>`;
}

function esc(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] as string);
}

const browser = await chromium.launch();
const tab = await browser.newPage({ viewport: { width: 1200, height: 630 } });

async function shoot(html: string, path: string): Promise<void> {
  await tab.setContent(html, { waitUntil: 'networkidle' });
  await tab.screenshot({ path });
  console.log(`Wrote ${path}`);
}

await shoot(
  page(
    `<div class="logo">Mesaas</div>` +
      `<h1>CRM para agências e gestores de social media</h1>` +
      `<p>Clientes, aprovações, agendamento no Instagram e relatórios — em um só lugar.</p>`,
  ),
  'public/og-image.png',
);

mkdirSync('public/og/blog', { recursive: true });
for (const post of loadPostsFromDisk()) {
  await shoot(
    page(
      `<div class="eyebrow">${esc(CATEGORY_LABEL[post.category] ?? 'Blog')}</div>` +
        `<h1>${esc(post.h1)}</h1>` +
        `<p>Mesaas · Blog</p>`,
    ),
    `public/og/blog/${post.slug}.png`,
  );
}

await browser.close();
