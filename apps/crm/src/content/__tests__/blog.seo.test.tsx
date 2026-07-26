import { describe, expect, test } from 'vitest';
import { parsePost } from '../blog.schema';
import { renderBlogIndexHtml, renderBlogPostHtml, renderPostBodyHtml } from '../blog.seo';

const post = parsePost(
  [
    '---',
    'title: Mesaas ou Aprova Post: qual usar na sua agência em 2026',
    'h1: Título do artigo <de teste>',
    'description: Comparamos Mesaas e Aprova Post na aprovação de posts com o cliente: link sem login, fluxo de revisão, agendamento no Instagram e gestão da agência.',
    'date: 2026-07-25',
    'category: comparativo',
    '---',
    '',
    '## Seção',
    '',
    'Parágrafo com [link](/precos).',
    '',
    '| A | B |',
    '| --- | --- |',
    '| 1 | 2 |',
  ].join('\n'),
  'artigo',
);

describe('renderPostBodyHtml', () => {
  test('renders markdown headings, links and GFM tables', () => {
    const html = renderPostBodyHtml(post.body);
    expect(html).toContain('<h2>Seção</h2>');
    expect(html).toContain('href="/precos"');
    expect(html).toContain('<table>');
  });
});

describe('renderBlogPostHtml', () => {
  const html = renderBlogPostHtml(post, [post]);

  test('emits exactly one h1 and escapes it', () => {
    expect(html.match(/<h1>/g)).toHaveLength(1);
    expect(html).toContain('&lt;de teste&gt;');
  });

  test('carries breadcrumbs, byline and the rendered body', () => {
    expect(html).toContain('href="/blog"');
    expect(html).toContain('Eduardo Brandão');
    expect(html).toContain('<h2>Seção</h2>');
  });
});

describe('renderBlogIndexHtml', () => {
  test('lists every post with a link and a description', () => {
    const html = renderBlogIndexHtml([post]);
    expect(html).toContain('href="/blog/artigo"');
    expect(html).toContain('Comparamos Mesaas e Aprova Post');
    expect(html.match(/<h1>/g)).toHaveLength(1);
  });

  test('handles an empty blog without crashing', () => {
    expect(renderBlogIndexHtml([])).toContain('<h1>');
  });
});
