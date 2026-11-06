import './blog-preview.css';
import '@mesaas/ui/blog/blog-render.css';
import { BlogMarkdown } from '@mesaas/ui/blog/markdown';
import { FeatureCta } from '@mesaas/ui/blog/FeatureCta';
import { Fontes } from '@mesaas/ui/blog/Fontes';
import { PostFigure } from '@mesaas/ui/blog/PostFigure';
import { BLOG_FEATURES, type FeatureSlug } from '@mesaas/ui/blog/features';
import { formatIsoDatePtBR } from '@mesaas/ui/blog/format';
import type { MouseEvent } from 'react';
import { cn } from '../../lib/utils';
import { CATEGORY_LABEL, type BlogPostDetail } from './blog-view';

export type BlogPreviewPost = Pick<
  BlogPostDetail,
  | 'category'
  | 'date'
  | 'h1'
  | 'lede'
  | 'body_md'
  | 'cover_image'
  | 'images'
  | 'sources'
  | 'feature_slug'
>;

/** The post as the public page draws it: header, cover, body, Fontes and the feature CTA.
 * Mirrors the composition of apps/crm/src/pages/blog/BlogPostArticle.tsx with the same shared
 * render pieces (the Admin cannot import the CRM). The body goes through <BlogMarkdown> so
 * `img:<key>` images and infographics render. */
/** Site-relative links in a post point at the public site, not the Admin. */
const PUBLIC_ORIGIN = 'https://www.mesaas.com.br';

/** No link inside the preview may navigate the Admin away from a review or an edit: every
 * link opens in a new tab, relative ones resolved on the public site. In-page anchors stay. */
function openLinksElsewhere(e: MouseEvent<HTMLElement>) {
  const a = (e.target as Element | null)?.closest?.('a');
  const href = a?.getAttribute('href');
  if (!a || !href || href.startsWith('#')) return;
  e.preventDefault();
  let url: URL;
  try {
    url = new URL(href, PUBLIC_ORIGIN);
  } catch {
    return;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  window.open(url.toString(), '_blank', 'noopener,noreferrer');
}

export function BlogPreview({ post, className }: { post: BlogPreviewPost; className?: string }) {
  const feature = post.feature_slug ? BLOG_FEATURES[post.feature_slug as FeatureSlug] : undefined;
  const sources = post.sources ?? [];
  const renderPost = { images: post.images ?? [], sources };

  return (
    <article
      className={cn('blog-preview', className)}
      aria-label="Prévia do post"
      onClickCapture={openLinksElsewhere}
    >
      <header className="blog-head">
        <div className="blog-kicker">
          <span className="blog-cat">{CATEGORY_LABEL[post.category] ?? post.category}</span>
          <span>{post.date ? formatIsoDatePtBR(post.date) : 'Data definida ao aprovar'}</span>
        </div>
        <h1 className="blog-title">{post.h1}</h1>
        {post.lede && <p className="blog-lede">{post.lede}</p>}
        <div className="blog-byline">Por Equipe Mesaas</div>
      </header>

      {post.cover_image && (
        <div className="blog-cover">
          <PostFigure image={post.cover_image} />
        </div>
      )}

      <div className="blog-prose">
        <BlogMarkdown post={renderPost} body={post.body_md} />
      </div>

      <div className="blog-after">
        {sources.length > 0 && <Fontes sources={sources} />}
        {feature && <FeatureCta feature={feature} />}
      </div>
    </article>
  );
}
