/** Static mirrors of the blog pages for the prerender snapshot and crawlers
 * without JS. The article body goes through the same react-markdown call the
 * React page uses, so only the chrome is hand-written here.
 * Relative imports on purpose: this module is in the prerender import graph. */
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { BlogPost } from './blog.schema';
import { BLOG_AUTHOR, formatPostDate, postPath, relatedPosts } from './blog';
import { MARKDOWN_COMPONENTS } from './blog.markdown';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ESC[c]);
}

export function renderPostBodyHtml(body: string): string {
  return renderToStaticMarkup(
    <Markdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
      {body}
    </Markdown>,
  );
}

const CTA =
  '<section><h2>Organize a operação da sua agência</h2>' +
  '<p>Clientes, aprovações, agendamento no Instagram e financeiro em um só lugar.</p>' +
  '<a href="/login?tab=register">Criar conta grátis</a></section>';

const FOOTER_NAV =
  '<nav><a href="/">Mesaas</a> · <a href="/blog">Blog</a> · ' +
  '<a href="/precos">Planos e preços</a> · <a href="/sobre">Sobre</a></nav>';

export function renderBlogPostHtml(post: BlogPost, all: BlogPost[]): string {
  const related = relatedPosts(post, all);
  return [
    `<nav><a href="/">Início</a> · <a href="/blog">Blog</a></nav>`,
    '<article>',
    `<h1>${esc(post.h1)}</h1>`,
    `<p>${esc(post.description)}</p>`,
    `<p>Por ${esc(BLOG_AUTHOR.name)}, ${esc(BLOG_AUTHOR.role)} · ${esc(formatPostDate(post.date))} · ${post.readingMinutes} min de leitura</p>`,
    renderPostBodyHtml(post.body),
    '</article>',
    `<section><p><strong>${esc(BLOG_AUTHOR.name)}</strong> — ${esc(BLOG_AUTHOR.bio)}</p></section>`,
    related.length
      ? `<section><h2>Leia também</h2><ul>${related
          .map((r) => `<li><a href="${postPath(r)}">${esc(r.h1)}</a></li>`)
          .join('')}</ul></section>`
      : '',
    CTA,
    FOOTER_NAV,
  ].join('');
}

export function renderBlogIndexHtml(posts: BlogPost[]): string {
  const items = posts.length
    ? posts
        .map(
          (p) =>
            `<article><h2><a href="${postPath(p)}">${esc(p.h1)}</a></h2>` +
            `<p>${esc(p.description)}</p>` +
            `<p>${esc(formatPostDate(p.date))} · ${p.readingMinutes} min de leitura</p></article>`,
        )
        .join('')
    : '<p>Em breve, artigos por aqui.</p>';
  return [
    '<h1>Blog do Mesaas</h1>',
    '<p>Guias práticos de gestão de social media: aprovação de posts, briefing, precificação e rotina de entregas.</p>',
    items,
    CTA,
    FOOTER_NAV,
  ].join('');
}
