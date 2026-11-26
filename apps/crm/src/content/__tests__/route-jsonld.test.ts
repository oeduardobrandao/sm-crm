import { describe, expect, test } from 'vitest';
import { jsonLdForPath } from '../route-jsonld';
import { LANDING_EN } from '../landing.content.en';

function types(blocks: object[]): string[] {
  return blocks.map((b) => (b as { '@type': string })['@type']);
}

describe('jsonLdForPath', () => {
  test('landing gets Organization, WebSite, SoftwareApplication and FAQPage', () => {
    expect(types(jsonLdForPath('/'))).toEqual([
      'Organization',
      'WebSite',
      'SoftwareApplication',
      'FAQPage',
    ]);
  });

  test('precos gets SoftwareApplication and FAQPage', () => {
    expect(types(jsonLdForPath('/precos'))).toContain('SoftwareApplication');
    expect(types(jsonLdForPath('/precos'))).toContain('FAQPage');
  });

  test('marketing page with FAQ gets FAQPage; sobre (no FAQ) does not', () => {
    expect(types(jsonLdForPath('/aprovacao-de-post'))).toContain('FAQPage');
    expect(types(jsonLdForPath('/sobre'))).not.toContain('FAQPage');
  });

  test('legal pages get the base Organization/WebSite pair', () => {
    expect(types(jsonLdForPath('/politica-de-privacidade'))).toEqual(['Organization', 'WebSite']);
  });

  test('/en is English with USD pricing and the English FAQ', () => {
    const blocks = jsonLdForPath('/en') as Array<Record<string, any>>;
    expect(types(blocks)).toEqual(['Organization', 'WebSite', 'SoftwareApplication', 'FAQPage']);
    const app = blocks.find((b) => b['@type'] === 'SoftwareApplication')!;
    expect(app.offers.priceCurrency).toBe('USD');
    expect(app.description).toMatch(/social media/);
    expect(app.description).not.toMatch(/agências/);
    expect(blocks.find((b) => b['@type'] === 'WebSite')!.inLanguage).toBe('en-US');
    const faq = blocks.find((b) => b['@type'] === 'FAQPage')!;
    expect(faq.mainEntity[0].name).toBe(LANDING_EN.faq[0].q);
  });

  test('/en/pricing is English with USD pricing', () => {
    const blocks = jsonLdForPath('/en/pricing') as Array<Record<string, any>>;
    expect(types(blocks)).toContain('FAQPage');
    expect(blocks.find((b) => b['@type'] === 'SoftwareApplication')!.offers.priceCurrency).toBe(
      'USD',
    );
  });

  test('Portuguese landing stays in BRL', () => {
    const blocks = jsonLdForPath('/') as Array<Record<string, any>>;
    expect(blocks.find((b) => b['@type'] === 'SoftwareApplication')!.offers.priceCurrency).toBe(
      'BRL',
    );
    expect(blocks.find((b) => b['@type'] === 'WebSite')!.inLanguage).toBe('pt-BR');
  });
});
