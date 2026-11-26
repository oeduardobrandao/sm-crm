import { describe, expect, test } from 'vitest';
import { buildHeadTags, canonicalUrl } from '../seo-head';
import { routeMetaFor, type RouteMeta } from '../site-meta';

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

  describe('hreflang and locale (/en)', () => {
    const alts = (head: string) => head.match(/<link rel="alternate"[^>]*>/g) ?? [];

    test('/en uses en_US and declares the en, pt-BR and x-default alternates', () => {
      const head = buildHeadTags(routeMetaFor('/en')!);
      expect(head).toContain('property="og:locale" content="en_US"');
      expect(head).toContain('<link rel="canonical" href="https://www.mesaas.com.br/en" />');
      expect(alts(head)).toEqual([
        '<link rel="alternate" hreflang="en" href="https://www.mesaas.com.br/en" />',
        '<link rel="alternate" hreflang="pt-BR" href="https://www.mesaas.com.br/" />',
        '<link rel="alternate" hreflang="x-default" href="https://www.mesaas.com.br/" />',
      ]);
    });

    test('the Portuguese pair partner carries the same three alternates', () => {
      const head = buildHeadTags(routeMetaFor('/')!);
      expect(head).toContain('property="og:locale" content="pt_BR"');
      expect(alts(head)).toEqual([
        '<link rel="alternate" hreflang="en" href="https://www.mesaas.com.br/en" />',
        '<link rel="alternate" hreflang="pt-BR" href="https://www.mesaas.com.br/" />',
        '<link rel="alternate" hreflang="x-default" href="https://www.mesaas.com.br/" />',
      ]);
    });

    test('/en/pricing and /precos pair up', () => {
      expect(alts(buildHeadTags(routeMetaFor('/en/pricing')!))).toContain(
        '<link rel="alternate" hreflang="pt-BR" href="https://www.mesaas.com.br/precos" />',
      );
      expect(alts(buildHeadTags(routeMetaFor('/precos')!))).toContain(
        '<link rel="alternate" hreflang="en" href="https://www.mesaas.com.br/en/pricing" />',
      );
    });

    test('legal pages have no alternates', () => {
      expect(alts(buildHeadTags(routeMetaFor('/lgpd')!))).toEqual([]);
      expect(alts(buildHeadTags(routeMetaFor('/politica-de-privacidade')!))).toEqual([]);
    });
  });
});
