import { LANDING } from './landing.content';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ESC[c]);
}

/** Escape, then restore the <strong> emphasis markers that
 * landing.content.ts embeds as literal markup (see its doc comment). */
function emph(s: string): string {
  return esc(s)
    .replace(/&lt;strong&gt;/g, '<strong>')
    .replace(/&lt;\/strong&gt;/g, '</strong>');
}

function bullets(items: string[]): string {
  return items.length ? `<ul>${items.map((b) => `<li>${emph(b)}</li>`).join('')}</ul>` : '';
}

/** Minimal, escaped, semantic HTML mirror of the landing page for crawlers.
 * Same pattern as changelog.seo.ts. Copy comes from landing.content.ts, so
 * the mirror can never drift from what React renders. */
export function renderLandingHtml(): string {
  const { hero, features, featuresTitle, featuresSub, agente, how, faq } = LANDING;
  const h1 = `${esc(hero.titleBefore)}<em>${esc(hero.titleEm)}</em>${esc(hero.titleAfter)}`;
  const featureBlocks = features
    .map(
      (f) =>
        `<article><h3>${esc(f.title)}</h3><p>${emph(f.description)}</p>${bullets(f.bullets)}</article>`,
    )
    .join('');
  const steps = how.steps
    .map((s) => `<article><h3>${esc(s.title)}</h3><p>${esc(s.description)}</p></article>`)
    .join('');
  const faqBlocks = faq
    .map((i) => `<article><h3>${esc(i.q)}</h3><p>${esc(i.a)}</p></article>`)
    .join('');
  const nav = [
    ['/aprovacao-de-post', 'Aprovação de posts'],
    ['/portal-do-cliente', 'Portal do cliente'],
    ['/agente-de-conteudo-ia', 'Agente de conteúdo IA'],
    ['/precos', 'Planos e preços'],
    ['/sobre', 'Sobre o Mesaas'],
    ['/novidades', 'Novidades'],
  ]
    .map(([href, label]) => `<a href="${href}">${label}</a>`)
    .join(' · ');
  return [
    `<h1>${h1}</h1>`,
    `<p>${esc(hero.sub)}</p>`,
    `<section><h2>${esc(featuresTitle)}</h2><p>${esc(featuresSub)}</p>${featureBlocks}</section>`,
    `<section><h2>${esc(agente.title)}</h2>${agente.paragraphs.map((p) => `<p>${emph(p)}</p>`).join('')}${bullets(agente.bullets)}</section>`,
    `<section><h2>${esc(how.title)}</h2>${steps}</section>`,
    `<section><h2>Perguntas frequentes</h2>${faqBlocks}</section>`,
    `<nav>${nav}</nav>`,
  ].join('');
}
