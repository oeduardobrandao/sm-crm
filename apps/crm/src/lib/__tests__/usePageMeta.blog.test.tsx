import { render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import type { RouteMeta } from '@/content/site-meta';
import { usePageMetaFor } from '@/lib/usePageMeta';

const META: RouteMeta = {
  path: '/blog/artigo',
  title: 'Mesaas ou Aprova Post: qual usar na sua agência em 2026',
  description:
    'Comparamos Mesaas e Aprova Post na aprovação de posts com o cliente: link sem login, fluxo de revisão, agendamento no Instagram e gestão da agência.',
  lastmod: '2026-07-25',
  ogImage: 'https://www.mesaas.com.br/og/blog/artigo.png',
};

function Probe({ meta, jsonLd }: { meta?: RouteMeta; jsonLd: object[] }) {
  usePageMetaFor(meta, jsonLd);
  return null;
}

describe('usePageMetaFor', () => {
  test('writes title, canonical, og:image and the JSON-LD blocks', () => {
    render(<Probe meta={META} jsonLd={[{ '@type': 'BlogPosting' }]} />);
    expect(document.title).toBe(META.title);
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      'https://www.mesaas.com.br/blog/artigo',
    );
    expect(document.querySelector('meta[property="og:image"]')?.getAttribute('content')).toBe(
      META.ogImage,
    );
    expect(document.querySelectorAll('script[data-seo="jsonld"]')).toHaveLength(1);
  });

  test('is a no-op without metadata (unknown slug)', () => {
    document.title = 'inalterado';
    render(<Probe meta={undefined} jsonLd={[]} />);
    expect(document.title).toBe('inalterado');
  });

  test('does not rewrite the JSON-LD script when the same meta/jsonLd references come back on re-render', () => {
    const jsonLd = [{ '@type': 'BlogPosting' }];

    const { rerender } = render(<Probe meta={META} jsonLd={jsonLd} />);
    const scriptBefore = document.querySelector('script[data-seo="jsonld"]');
    expect(scriptBefore).not.toBeNull();

    // Re-render with the exact same `meta` and `jsonLd` references (as a
    // memoized caller would pass). The effect's dependency array is
    // unchanged, so the effect must not re-run: the <script> node must be
    // the very same DOM node, not a remove+reappend with equal content.
    rerender(<Probe meta={META} jsonLd={jsonLd} />);
    const scriptAfter = document.querySelector('script[data-seo="jsonld"]');
    expect(scriptAfter).toBe(scriptBefore);
  });
});
