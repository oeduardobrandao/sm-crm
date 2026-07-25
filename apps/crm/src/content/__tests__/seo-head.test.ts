import { describe, expect, test } from 'vitest';
import { buildHeadTags, canonicalUrl } from '../seo-head';
import type { RouteMeta } from '../site-meta';

const META: RouteMeta = {
  path: '/precos',
  file: 'precos.html',
  title: 'Título de teste com <aspas> & "escapes" p/ verificação ok',
  description:
    'Descrição de teste suficientemente longa para simular um caso real de metadados na página de preços do produto.',
  lastmod: '2026-07-24',
};

describe('seo-head', () => {
  test('canonicalUrl handles root and subpaths', () => {
    expect(canonicalUrl('/')).toBe('https://www.mesaas.com.br/');
    expect(canonicalUrl('/precos')).toBe('https://www.mesaas.com.br/precos');
  });

  test('buildHeadTags emits title, description, canonical, OG and Twitter', () => {
    const head = buildHeadTags(META);
    expect(head).toContain('<title>');
    expect(head).toContain('&lt;aspas&gt;');
    expect(head).toContain('<link rel="canonical" href="https://www.mesaas.com.br/precos" />');
    expect(head).toContain('property="og:title"');
    expect(head).toContain('property="og:image"');
    expect(head).toContain('property="og:locale" content="pt_BR"');
    expect(head).toContain('name="twitter:card" content="summary_large_image"');
  });

  test('JSON-LD blocks are tagged for client swap and serialized with < escaped', () => {
    const head = buildHeadTags(META, [{ '@type': 'Thing', name: 'a</script>b' }]);
    expect(head).toContain('<script type="application/ld+json" data-seo="jsonld">');
    expect(head).not.toContain('</script>b');
  });
});
