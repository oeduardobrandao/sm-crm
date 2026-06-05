import type { ChangelogRelease } from './changelog.schema';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ESC[c]);
}

/** Minimal, escaped, semantic HTML for crawlers. Mirrors the page's text content. */
export function renderChangelogHtml(releases: ChangelogRelease[]): string {
  if (!releases.length) return '<h1>Novidades</h1><p>Em breve, novidades por aqui.</p>';
  const sections = releases
    .map((r) => {
      const items = r.items
        .map((i) => `<article><h3>${esc(i.title)}</h3><p>${esc(i.description)}</p></article>`)
        .join('');
      const summary = r.summary ? `<p>${esc(r.summary)}</p>` : '';
      return `<section><h2>${esc(r.date)}</h2>${summary}${items}</section>`;
    })
    .join('');
  return `<h1>Novidades</h1>${sections}`;
}
