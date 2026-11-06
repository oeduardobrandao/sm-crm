/** Static mirrors of the blog pages for the prerender snapshot and crawlers
 * without JS. The article content goes through the same shared render pieces
 * (packages/ui/blog) the React page uses, so only the chrome is hand-written
 * here.
 * Relative imports on purpose: this module is in the prerender import graph. */
import { renderToStaticMarkup } from 'react-dom/server';
import { BlogMarkdown, type BlogRenderPost } from '../../../../packages/ui/blog/markdown';
import { FeatureCta } from '../../../../packages/ui/blog/FeatureCta';
import { Fontes } from '../../../../packages/ui/blog/Fontes';
import { PostFigure } from '../../../../packages/ui/blog/PostFigure';
import type { BlogPost } from './blog.schema';
import { BLOG_FEATURES } from './blog.features';
import {
  CATEGORY_LABEL,
  formatPostDate,
  postAuthor,
  postLede,
  postPath,
  relatedPosts,
} from './blog';

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ESC[c]);
}

/** A body through the same pipeline the React page uses (`<BlogMarkdown>`:
 * GFM, the shared overrides and the `img:` transform). `post` supplies the
 * images and sources the body references. */
export function renderPostBodyHtml(body: string, post: BlogRenderPost = {}): string {
  return renderToStaticMarkup(<BlogMarkdown post={post} body={body} />);
}

/** `<meta name="mesaas-blog-rev">` for a DB post: the Admin compares it with
 * the row's `revision` to tell when a published edit is live. Empty for file
 * posts, which have no revision. */
export function blogRevisionMetaTag(post: BlogPost): string {
  return post.revision === undefined
    ? ''
    : `<meta name="mesaas-blog-rev" content="${post.revision}" />`;
}

const CTA =
  '<section><h2>Organize a operação da sua agência</h2>' +
  '<p>Clientes, aprovações, agendamento no Instagram e financeiro em um só lugar.</p>' +
  '<a href="/login?tab=register">Criar conta grátis</a></section>';

const FOOTER_NAV =
  '<nav><a href="/">Mesaas</a> · <a href="/blog">Blog</a> · ' +
  '<a href="/precos">Planos e preços</a> · <a href="/sobre">Sobre</a></nav>';

/** The crawler's copy of an article. Same content as the React page
 * (`BlogPostArticle`), lighter chrome: the shared pieces draw the cover,
 * body, Fontes and feature CTA in both. */
export function renderBlogPostHtml(post: BlogPost, all: BlogPost[]): string {
  // Shipping the mirror without the body would publish an empty page, so a
  // lazy post (body not read from disk) fails the build here.
  if (post.body === null) throw new Error(`blog/${post.slug}: body not loaded for prerender`);
  const related = relatedPosts(post, all);
  const author = postAuthor(post);
  const feature = post.featureSlug ? BLOG_FEATURES[post.featureSlug] : undefined;
  const byline = author.kind === 'person' ? `${author.name}, ${author.role}` : author.name;
  const after = renderToStaticMarkup(
    <>
      {post.sources && post.sources.length > 0 && <Fontes sources={post.sources} />}
      {feature && <FeatureCta feature={feature} />}
    </>,
  );
  return [
    `<nav><a href="/">Início</a> · <a href="/blog">Blog</a></nav>`,
    '<article>',
    `<p>${esc(CATEGORY_LABEL[post.category])}</p>`,
    `<h1>${esc(post.h1)}</h1>`,
    `<p>${esc(postLede(post))}</p>`,
    `<p>Por ${esc(byline)} · ${esc(formatPostDate(post.date))} · ${post.readingMinutes} min de leitura</p>`,
    post.cover ? renderToStaticMarkup(<PostFigure image={post.cover} priority />) : '',
    renderPostBodyHtml(post.body, post),
    after,
    author.bio
      ? `<section><p><strong>${esc(author.name)}</strong>, ${esc(author.role)}</p><p>${esc(author.bio)}</p></section>`
      : '',
    '</article>',
    related.length
      ? `<section><h2>Continue lendo</h2><ul>${related
          .map(
            (r) =>
              `<li><a href="${postPath(r)}">${esc(r.h1)}</a> (${esc(CATEGORY_LABEL[r.category])})</li>`,
          )
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
            `<article><p>${esc(CATEGORY_LABEL[p.category])}</p>` +
            `<h2><a href="${postPath(p)}">${esc(p.h1)}</a></h2>` +
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
