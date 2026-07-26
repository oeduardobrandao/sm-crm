import { describe, expect, test } from 'vitest';
import {
  blogIndexJsonLd,
  blogPostingJsonLd,
  breadcrumbJsonLd,
  faqPageJsonLd,
  organizationJsonLd,
  softwareApplicationJsonLd,
  webSiteJsonLd,
} from '../jsonld';
import { parsePost } from '../blog.schema';

describe('jsonld builders', () => {
  test('Organization has name, url, logo and the brand profiles in sameAs', () => {
    const org = organizationJsonLd() as Record<string, unknown>;
    expect(org['@type']).toBe('Organization');
    expect(org.name).toBe('Mesaas');
    expect(org.url).toBe('https://www.mesaas.com.br/');
    expect(org.logo).toContain('https://www.mesaas.com.br/');
    expect(org.sameAs).toEqual(['https://www.instagram.com/mesaas.com.br/']);
  });

  test('WebSite is pt-BR', () => {
    const site = webSiteJsonLd() as Record<string, unknown>;
    expect(site['@type']).toBe('WebSite');
    expect(site.inLanguage).toBe('pt-BR');
  });

  test('SoftwareApplication offers a free BRL tier', () => {
    const app = softwareApplicationJsonLd() as { offers: Record<string, unknown> };
    expect(app.offers.priceCurrency).toBe('BRL');
    expect(app.offers.price).toBe('0');
  });

  test('FAQPage maps q/a to Question/Answer', () => {
    const faq = faqPageJsonLd([{ q: 'Pergunta?', a: 'Resposta.' }]) as {
      mainEntity: Array<{ name: string; acceptedAnswer: { text: string } }>;
    };
    expect(faq.mainEntity[0].name).toBe('Pergunta?');
    expect(faq.mainEntity[0].acceptedAnswer.text).toBe('Resposta.');
  });

  test('BreadcrumbList positions are 1-based and absolute', () => {
    const bc = breadcrumbJsonLd([
      { name: 'Mesaas', path: '/' },
      { name: 'Preços', path: '/precos' },
    ]) as { itemListElement: Array<{ position: number; item: string }> };
    expect(bc.itemListElement[0].position).toBe(1);
    expect(bc.itemListElement[1].item).toBe('https://www.mesaas.com.br/precos');
  });
});

const post = parsePost(
  [
    '---',
    'title: Mesaas ou Aprova Post: qual usar na sua agência em 2026',
    'h1: Mesaas ou Aprova Post',
    'description: Comparamos Mesaas e Aprova Post na aprovação de posts com o cliente: link sem login, fluxo de revisão, agendamento no Instagram e gestão da agência.',
    'date: 2026-07-25',
    'updated: 2026-07-26',
    'category: comparativo',
    '---',
    '',
    '## Seção',
  ].join('\n'),
  'artigo',
);

describe('blog jsonld', () => {
  test('BlogPosting carries dates, author, publisher and canonical id', () => {
    const ld = blogPostingJsonLd(post) as Record<string, any>;
    expect(ld['@type']).toBe('BlogPosting');
    expect(ld.headline).toBe('Mesaas ou Aprova Post');
    expect(ld.datePublished).toBe('2026-07-25');
    expect(ld.dateModified).toBe('2026-07-26');
    expect(ld.inLanguage).toBe('pt-BR');
    expect(ld.mainEntityOfPage['@id']).toBe('https://www.mesaas.com.br/blog/artigo');
    expect(ld.author.name).toBe('Eduardo Brandão');
    expect(ld.publisher.name).toBe('Mesaas');
    expect(ld.image).toBe('https://www.mesaas.com.br/og/blog/artigo.png');
  });

  test('Blog index lists its posts', () => {
    const ld = blogIndexJsonLd([post]) as Record<string, any>;
    expect(ld['@type']).toBe('Blog');
    expect(ld.blogPost).toHaveLength(1);
    expect(ld.blogPost[0].url).toBe('https://www.mesaas.com.br/blog/artigo');
  });
});
