import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import './blog.css';
// After blog.css: the render pieces' rules must win the ties (see its header).
import '@mesaas/ui/blog/blog-render.css';
import '../landing/landing-styles';
import { LandingFooter, LandingHeader, useLandingChrome } from '../landing/LandingChrome';
import NotFoundPage from '../not-found/NotFoundPage';
import { BLOG_POSTS, loadPostBody, postBySlug } from '@/content/blog.client';
import type { BlogPost } from '@/content/blog.schema';
import {
  blogPostRouteMeta,
  CATEGORY_LABEL,
  postPath,
  postThumb,
  relatedPosts,
} from '@/content/blog';
import { blogPostingJsonLd, breadcrumbJsonLd } from '@/content/jsonld';
import { usePageMetaFor } from '@/lib/usePageMeta';
import { ArrowRight } from 'lucide-react';
import { BlogPostArticle, type BodyStatus } from './BlogPostArticle';

/** File posts carry their body; DB posts load it from a lazy chunk. The header
 * renders at once either way, the body when it arrives. */
function usePostBody(post: BlogPost): {
  body: string | null;
  status: BodyStatus;
  retry: () => void;
} {
  const [loaded, setLoaded] = useState<{ slug: string; body: string } | null>(null);
  const [failedSlug, setFailedSlug] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (post.body !== null) return;
    let live = true;
    loadPostBody(post.slug).then(
      (body) => {
        if (live) setLoaded({ slug: post.slug, body });
      },
      () => {
        if (live) setFailedSlug(post.slug);
      },
    );
    return () => {
      live = false;
    };
  }, [post.slug, post.body, attempt]);

  const retry = useCallback(() => {
    setFailedSlug(null);
    setAttempt((n) => n + 1);
  }, []);

  const body = post.body ?? (loaded?.slug === post.slug ? loaded.body : null);
  const status: BodyStatus =
    body !== null ? 'ready' : failedSlug === post.slug ? 'error' : 'loading';
  return { body, status, retry };
}

function BlogPostView({ post }: { post: BlogPost }) {
  useLandingChrome();
  const meta = useMemo(() => blogPostRouteMeta(post), [post]);
  const jsonLd = useMemo(
    () => [
      blogPostingJsonLd(post),
      breadcrumbJsonLd([
        { name: 'Início', path: '/' },
        { name: 'Blog', path: '/blog' },
        { name: post.h1, path: postPath(post) },
      ]),
    ],
    [post],
  );
  usePageMetaFor(meta, jsonLd);
  const related = useMemo(() => relatedPosts(post, BLOG_POSTS), [post]);
  const { body, status, retry } = usePostBody(post);

  return (
    <>
      <LandingHeader variant="subpage" />
      <main id="main-content" tabIndex={-1}>
        <section className="lp-pad blog-post-section" id="top">
          <div className="lp-container">
            <BlogPostArticle post={post} body={body} status={status} onRetry={retry} />
            {related.length > 0 && (
              <section className="blog-related">
                <h2>Continue lendo</h2>
                <ul>
                  {related.map((r) => {
                    const thumb = postThumb(r);
                    return (
                      <li key={r.slug}>
                        <a href={postPath(r)} className="blog-next-card">
                          <span className="blog-next-thumb">
                            {thumb && <img src={thumb} alt="" loading="lazy" decoding="async" />}
                          </span>
                          <span className="blog-next-cat">{CATEGORY_LABEL[r.category]}</span>
                          <span className="blog-next-title">{r.h1}</span>
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
          </div>
        </section>
        <section className="cta-final-wrap">
          <div className="lp-container">
            <div className="cta-final-card">
              <h2>Organize a operação da sua agência</h2>
              <p>Clientes, aprovações, agendamento no Instagram e financeiro em um só lugar.</p>
              <a href="/login?tab=register" className="lp-btn lp-btn-primary lg">
                Criar conta grátis <ArrowRight size={16} />
              </a>
            </div>
          </div>
        </section>
      </main>
      <LandingFooter />
    </>
  );
}

export default function BlogPostPage() {
  const { slug = '' } = useParams();
  const post = postBySlug(slug);
  if (!post) return <NotFoundPage />;
  return <BlogPostView post={post} />;
}
