import { describe, expect, test } from 'vitest';
import { renderMarketingPageHtml } from '../paginas.seo';
import { MARKETING_PAGES } from '../paginas';
import { PUBLIC_ROUTES } from '../site-meta';
import type { MarketingPageContent } from '../paginas';

const SAMPLE: MarketingPageContent = {
  slug: 'exemplo',
  eyebrow: 'Recurso',
  h1: 'Título da página',
  sub: 'Subtítulo da página.',
  sections: [{ h2: 'Seção', paragraphs: ['Par.'], bullets: ['Item A'] }],
  faq: [{ q: 'P?', a: 'R.' }],
  cta: { title: 'Pronto?', sub: 'Comece grátis.' },
};

describe('renderMarketingPageHtml', () => {
  const html = renderMarketingPageHtml(SAMPLE);
  test('semantic structure: single h1, sections, faq, CTA link', () => {
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('<h2>Seção</h2>');
    expect(html).toContain('<li>Item A</li>');
    expect(html).toContain('P?');
    expect(html).toContain('href="/login?tab=register"');
  });
});

describe('MARKETING_PAGES registry', () => {
  test('every page has a matching PUBLIC_ROUTES entry', () => {
    for (const p of MARKETING_PAGES) {
      expect(PUBLIC_ROUTES.some((r) => r.path === `/${p.slug}`)).toBe(true);
    }
  });
  test('sobre page renders with organization copy', () => {
    const sobre = MARKETING_PAGES.find((p) => p.slug === 'sobre');
    expect(sobre).toBeDefined();
    expect(renderMarketingPageHtml(sobre!)).toContain('contato@mesaas.com.br');
  });
});
