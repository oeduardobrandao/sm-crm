import { describe, expect, test } from 'vitest';
import {
  breadcrumbJsonLd,
  faqPageJsonLd,
  organizationJsonLd,
  softwareApplicationJsonLd,
  webSiteJsonLd,
} from '../jsonld';

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
