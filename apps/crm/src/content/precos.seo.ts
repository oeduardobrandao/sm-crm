import { PRECOS } from './precos.content';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ESC[c]);
}

/** Static mirror of /precos. Live price values are client-fetched, so the
 * mirror carries plan names + positioning copy, not numbers. */
export function renderPrecosHtml(): string {
  const plans = PRECOS.plans
    .map((p) => `<article><h3>${esc(p.name)}</h3><p>${esc(p.description)}</p></article>`)
    .join('');
  const faq = PRECOS.faq
    .map((i) => `<article><h3>${esc(i.q)}</h3><p>${esc(i.a)}</p></article>`)
    .join('');
  return [
    `<h1>${esc(PRECOS.h1)}</h1>`,
    `<p>${esc(PRECOS.sub)}</p>`,
    `<section><h2>Compare os planos</h2>${plans}</section>`,
    `<section><h2>Perguntas frequentes</h2>${faq}</section>`,
    `<nav><a href="/">Mesaas</a> · <a href="/aprovacao-de-post">Aprovação de posts</a> · <a href="/portal-do-cliente">Portal do cliente</a> · <a href="/agente-de-conteudo-ia">Agente de conteúdo IA</a></nav>`,
  ].join('');
}
