import { BlogMarkdown } from '@mesaas/ui/blog/markdown';
import { FeatureCta } from '@mesaas/ui/blog/FeatureCta';
import { Fontes } from '@mesaas/ui/blog/Fontes';
import { PostFigure } from '@mesaas/ui/blog/PostFigure';
import { BLOG_FEATURES } from '@/content/blog.features';
import type { BlogPost } from '@/content/blog.schema';
import { CATEGORY_LABEL, formatPostDate, postAuthor, postLede } from '@/content/blog';

export type BodyStatus = 'ready' | 'loading' | 'error';

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');
}

/** The article itself, without the site chrome: header, cover, body, Fontes,
 * feature CTA and author card. Presentational: `BlogPostPage` owns the lazy
 * body load and passes its state in. The static mirror (content/blog.seo.tsx)
 * draws the same pieces, and a parity test holds the two together. */
export function BlogPostArticle({
  post,
  body,
  status = 'ready',
  onRetry,
}: {
  post: BlogPost;
  body: string | null;
  status?: BodyStatus;
  onRetry?: () => void;
}) {
  const author = postAuthor(post);
  const feature = post.featureSlug ? BLOG_FEATURES[post.featureSlug] : undefined;

  return (
    <article className="blog-article">
      <header className="blog-head">
        <nav className="blog-crumbs" aria-label="Trilha de navegação">
          <a href="/">Início</a>
          <span aria-hidden="true">/</span>
          <a href="/blog">Blog</a>
        </nav>
        <div className="blog-kicker">
          <span className="blog-cat">{CATEGORY_LABEL[post.category]}</span>
          <span>{formatPostDate(post.date)}</span>
          <span aria-hidden="true">·</span>
          <span>{post.readingMinutes} min de leitura</span>
        </div>
        <h1 className="blog-title">{post.h1}</h1>
        <p className="blog-lede">{postLede(post)}</p>
        <div className="blog-byline">
          <span
            className={`blog-avatar${author.kind === 'organization' ? ' blog-avatar--org' : ''}`}
            aria-hidden="true"
          >
            {initials(author.name)}
          </span>
          <span className="blog-byline-text">
            <span className="blog-byline-name">Por {author.name}</span>
            {author.kind === 'person' && <span className="blog-byline-role">{author.role}</span>}
          </span>
        </div>
      </header>

      {post.cover && (
        <div className="blog-cover">
          <PostFigure image={post.cover} priority />
        </div>
      )}

      <div className="blog-prose">
        {body !== null ? (
          <BlogMarkdown post={post} body={body} />
        ) : status === 'error' ? (
          <div className="blog-load-error" role="alert">
            <p>Não foi possível carregar o artigo.</p>
            <button type="button" className="blog-retry" onClick={onRetry}>
              Tentar novamente
            </button>
          </div>
        ) : (
          <div className="blog-skeleton" role="status" aria-label="Carregando o artigo">
            {[92, 100, 96, 70, 0, 100, 88, 94, 60].map((width, i) =>
              width === 0 ? (
                <span key={i} className="blog-skeleton-gap" />
              ) : (
                <span key={i} className="blog-skeleton-line" style={{ width: `${width}%` }} />
              ),
            )}
          </div>
        )}
      </div>

      {body !== null && (
        <div className="blog-after">
          {post.sources && post.sources.length > 0 && <Fontes sources={post.sources} />}
          {feature && <FeatureCta feature={feature} />}
          {author.bio && (
            <aside className="blog-author">
              <span className="blog-author-name">{author.name}</span>
              <span className="blog-author-role">{author.role}</span>
              <p>{author.bio}</p>
            </aside>
          )}
        </div>
      )}
    </article>
  );
}
