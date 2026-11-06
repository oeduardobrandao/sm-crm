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

  test('og:type defaults to website when the route has no ogType', () => {
    expect(buildHeadTags(META)).toContain('<meta property="og:type" content="website" />');
  });

  test('og:type is article for routes that set ogType', () => {
    const head = buildHeadTags({ ...META, ogType: 'article' });
    expect(head).toContain('<meta property="og:type" content="article" />');
    expect(head).not.toContain('content="website"');
  });

  test('escapes a hostile og:image (DB cover URL) in every attribute it lands in', () => {
    const head = buildHeadTags({
      ...META,
      ogImage: 'https://cdn.exemplo.com/x.jpg?a="><script>alert(1)</script>',
    });
    expect(head).not.toContain('<script>alert(1)');
    expect(head).not.toContain('"><');
    const escaped =
      'https://cdn.exemplo.com/x.jpg?a=&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;';
    expect(head).toContain(`<meta property="og:image" content="${escaped}" />`);
    expect(head).toContain(`<meta name="twitter:image" content="${escaped}" />`);
  });

  test('escapes the canonical path too', () => {
    const head = buildHeadTags({ ...META, path: '/blog/a"b<c>' });
    expect(head).toContain('href="https://www.mesaas.com.br/blog/a&quot;b&lt;c&gt;"');
    expect(head).toContain(
      'property="og:url" content="https://www.mesaas.com.br/blog/a&quot;b&lt;c&gt;"',
    );
  });
});
