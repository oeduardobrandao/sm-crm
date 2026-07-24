// Relative import on purpose: this module is in the prerender script's
// import graph, which cannot resolve the @/ alias.
import type { MarketingPageContent } from './paginas';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ESC[c]);
}

/** Static mirror of a marketing subpage (/<slug>). Mirrors MarketingPage.tsx's
 * semantic structure (single h1, one <section> per content section, FAQ,
 * CTA) for the prerender snapshot and crawlers without JS. */
export function renderMarketingPageHtml(page: MarketingPageContent): string {
  const sections = page.sections
    .map((s) => {
      const paras = s.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('');
      const list = s.bullets?.length
        ? `<ul>${s.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>`
        : '';
      return `<section><h2>${esc(s.h2)}</h2>${paras}${list}</section>`;
    })
    .join('');
  const faq = page.faq.length
    ? `<section><h2>Perguntas frequentes</h2>${page.faq
        .map((i) => `<article><h3>${esc(i.q)}</h3><p>${esc(i.a)}</p></article>`)
        .join('')}</section>`
    : '';
  return [
    `<h1>${esc(page.h1)}</h1>`,
    `<p>${esc(page.sub)}</p>`,
    sections,
    faq,
    `<section><h2>${esc(page.cta.title)}</h2><p>${esc(page.cta.sub)}</p><a href="/login?tab=register">Criar conta grátis</a></section>`,
    `<nav><a href="/">Mesaas</a> · <a href="/precos">Planos e preços</a> · <a href="/novidades">Novidades</a></nav>`,
  ].join('');
}
