import { describe, expect, test } from 'vitest';
import { buildLlmsTxt } from '../llms';
import { PUBLIC_ROUTES } from '../site-meta';

describe('buildLlmsTxt', () => {
  const txt = buildLlmsTxt(PUBLIC_ROUTES);
  test('opens with the brand block and lists every page', () => {
    expect(txt.startsWith('# Mesaas')).toBe(true);
    expect(txt).toContain('> CRM para agências e gestores de social media');
    for (const r of PUBLIC_ROUTES) {
      expect(txt).toContain(`](https://www.mesaas.com.br${r.path === '/' ? '/' : r.path})`);
    }
  });

  test('lists blog posts under their own section', () => {
    const txt = buildLlmsTxt(
      [{ path: '/', file: 'index.html', title: 'T', description: 'D', lastmod: '2026-07-25' }],
      [
        {
          slug: 'artigo',
          title: 'Mesaas ou Aprova Post: qual usar na sua agência em 2026',
          h1: 'Mesaas ou Aprova Post',
          description: 'Descrição do artigo.',
          date: '2026-07-25',
          updated: '2026-07-25',
          category: 'comparativo',
          body: '',
          readingMinutes: 1,
        },
      ],
    );
    expect(txt).toContain('## Blog');
    // Exact bullet: h1 (not the longer SEO `title`) as the link text, and a
    // `: <description>` suffix — pins both fields so swapping p.h1 -> p.title
    // or dropping the description suffix fails this assertion.
    expect(txt).toContain(
      '- [Mesaas ou Aprova Post](https://www.mesaas.com.br/blog/artigo): Descrição do artigo.',
    );
    expect(txt).not.toContain('Mesaas ou Aprova Post: qual usar na sua agência em 2026');
  });

  test('collapses newlines in titles and descriptions so a post cannot inject lines', () => {
    const txt = buildLlmsTxt(
      [{ path: '/', file: 'index.html', title: 'T', description: 'D', lastmod: '2026-07-25' }],
      [
        {
          slug: 'artigo',
          title: 'Título',
          h1: 'Primeira linha\n## Injetado\r\n- [mal](https://evil.example)',
          description: 'Descrição\n\n  em   partes.',
          date: '2026-07-25',
          updated: '2026-07-25',
          category: 'guia',
          body: '',
          readingMinutes: 1,
        },
      ],
    );
    expect(txt).toContain(
      '- [Primeira linha ## Injetado - [mal](https://evil.example)](https://www.mesaas.com.br/blog/artigo): Descrição em partes.',
    );
    expect(txt.split('\n').filter((l) => l.startsWith('## '))).toEqual(['## Páginas', '## Blog']);
    expect(txt.split('\n').filter((l) => l.startsWith('- ['))).toHaveLength(2);
  });

  test('omits the blog section when there are no posts', () => {
    expect(buildLlmsTxt([])).not.toContain('## Blog');
  });
});
