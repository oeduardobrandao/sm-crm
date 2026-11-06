import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { parsePost } from '../blog.schema';
import {
  blogRevisionMetaTag,
  renderBlogIndexHtml,
  renderBlogPostHtml,
  renderPostBodyHtml,
} from '../blog.seo';
import { BLOG_FEATURES } from '../blog.features';
import { BlogPostArticle } from '../../pages/blog/BlogPostArticle';
import { DB_POST_META, dbPostLazy, dbPostWithBody } from './blogDbFixture';

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
    const html = renderPostBodyHtml(post.body ?? '');
    expect(html).toContain('<h2>Seção</h2>');
    expect(html).toContain('href="/precos"');
    expect(html).toContain('<table>');
  });

  // The comparison articles link out to competitors, so an outbound link must
  // never pass ranking signal. This block is the regression net for
  // MARKDOWN_COMPONENTS, which Task 6's page renderer shares.
  test('marks external links nofollow and leaves internal links plain', () => {
    const html = renderPostBodyHtml(
      'Veja o [site oficial](https://exemplo.com.br) e os [planos](/precos).',
    );
    expect(html).toMatch(/<a href="https:\/\/exemplo\.com\.br"[^>]*rel="nofollow noopener"/);
    expect(html).toMatch(/<a href="https:\/\/exemplo\.com\.br"[^>]*target="_blank"/);
    expect(html).toContain('<a href="/precos">');
  });

  test('never leaks react-markdown internals onto the rendered anchor', () => {
    const html = renderPostBodyHtml('[interno](/precos) e [externo](https://exemplo.com.br)');
    expect(html).not.toContain('node=');
    expect(html).not.toContain('[object Object]');
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

describe('static mirror vs React article parity (DB post)', () => {
  const db = dbPostWithBody();
  const mirror = renderBlogPostHtml(db, [db, post]);
  const page = renderToStaticMarkup(<BlogPostArticle post={db} body={db.body} />);
  const text = (html: string) =>
    new DOMParser().parseFromString(html, 'text/html').body.textContent ?? '';

  test.each([
    ['mirror', mirror],
    ['page', page],
  ])('%s carries every piece of the article', (_name, html) => {
    const t = text(html);
    expect(t).toContain(DB_POST_META.lede);
    // Credit line of the cover and of the inline `img:` figure.
    expect(t).toContain(`Foto: ${DB_POST_META.cover.credit}`);
    expect(t).toContain(`Foto: ${DB_POST_META.images[0].credit}`);
    expect(html).toContain(DB_POST_META.cover.url);
    expect(html).toContain(DB_POST_META.images[0].url);
    // The infographic is HTML text, every label readable.
    expect(t).toContain('Tempo médio até a aprovação');
    expect(t).toContain('Aprovação pelo WhatsApp');
    expect(t).toContain('Aprovação por link');
    expect(t).toContain('Fontes');
    for (const source of DB_POST_META.sources) expect(t).toContain(source.title);
    expect(t).toContain(BLOG_FEATURES['aprovacao-de-post'].titulo);
    expect(t).toContain('Equipe Mesaas');
    expect(html).not.toContain('—');
  });

  test('the organization byline carries no person role or bio', () => {
    for (const html of [mirror, page]) {
      expect(text(html)).not.toContain('Eduardo Brandão');
      expect(text(html)).not.toContain('Fundador do Mesaas');
    }
  });

  test('the mirror refuses a post whose body was not loaded', () => {
    expect(() => renderBlogPostHtml(dbPostLazy(), [])).toThrow(/body not loaded/);
  });

  test('the file-post mirror carries no em dash either', () => {
    expect(renderBlogPostHtml(post, [post])).not.toContain('—');
  });
});

describe('blogRevisionMetaTag', () => {
  test('marks a DB post with its revision', () => {
    expect(blogRevisionMetaTag(dbPostWithBody())).toBe(
      '<meta name="mesaas-blog-rev" content="3" />',
    );
  });

  test('is empty for a file post (no revision)', () => {
    expect(blogRevisionMetaTag(post)).toBe('');
  });
});
