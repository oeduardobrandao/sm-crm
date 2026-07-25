import { describe, expect, test } from 'vitest';
import { jsonLdForPath } from '../route-jsonld';

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
});
