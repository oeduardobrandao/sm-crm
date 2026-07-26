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
    expect(txt).toContain('https://www.mesaas.com.br/blog/artigo');
  });

  test('omits the blog section when there are no posts', () => {
    expect(buildLlmsTxt([])).not.toContain('## Blog');
  });
});
