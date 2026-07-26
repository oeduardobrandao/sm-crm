import { useMemo } from 'react';
import './blog.css';
import '../landing/landing.css';
import { LandingFooter, LandingHeader, useLandingChrome } from '../landing/LandingChrome';
import { BLOG_POSTS } from '@/content/blog.client';
import { BLOG_INDEX_PATH, formatPostDate, postPath } from '@/content/blog';
import { blogIndexJsonLd } from '@/content/jsonld';
import { routeMetaFor } from '@/content/site-meta';
import { usePageMetaFor } from '@/lib/usePageMeta';

const CATEGORY_LABEL = { comparativo: 'Comparativo', guia: 'Guia' } as const;

export default function BlogIndexPage() {
  useLandingChrome();
  const meta = routeMetaFor(BLOG_INDEX_PATH);
  const jsonLd = useMemo(() => [blogIndexJsonLd(BLOG_POSTS)], []);
  usePageMetaFor(meta, jsonLd);

  return (
    <>
      <LandingHeader variant="subpage" />
      <main>
        <section className="lp-pad" id="top">
          <div className="lp-container">
            <div className="section-head">
              <span className="eyebrow-pill">Blog</span>
              <h1 className="hero-title">Blog do Mesaas</h1>
              <p className="hero-sub">
                Guias práticos de gestão de social media: aprovação de posts, briefing, precificação
                e rotina de entregas.
              </p>
            </div>
            <div className="blog-list">
              {BLOG_POSTS.map((post) => (
                <a key={post.slug} href={postPath(post)} className="blog-card">
                  <span className="blog-cat">{CATEGORY_LABEL[post.category]}</span>
                  <h2>{post.h1}</h2>
                  <p>{post.description}</p>
                  <div className="blog-meta">
                    <span>{formatPostDate(post.date)}</span>
                    <span>·</span>
                    <span>{post.readingMinutes} min de leitura</span>
                  </div>
                </a>
              ))}
            </div>
          </div>
        </section>
      </main>
      <LandingFooter />
    </>
  );
}
