import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './blog.css';
import '../landing/landing.css';
import { LandingFooter, LandingHeader, useLandingChrome } from '../landing/LandingChrome';
import NotFoundPage from '../not-found/NotFoundPage';
import { BLOG_POSTS, postBySlug } from '@/content/blog.client';
import { MARKDOWN_COMPONENTS } from '@/content/blog.markdown';
import type { BlogPost } from '@/content/blog.schema';
import {
  BLOG_AUTHOR,
  blogPostRouteMeta,
  formatPostDate,
  postPath,
  relatedPosts,
} from '@/content/blog';
import { blogPostingJsonLd, breadcrumbJsonLd } from '@/content/jsonld';
import { usePageMetaFor } from '@/lib/usePageMeta';
import { ArrowRight } from 'lucide-react';

const CATEGORY_LABEL = { comparativo: 'Comparativo', guia: 'Guia' } as const;

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

  return (
    <>
      <LandingHeader variant="subpage" />
      <main>
        <section className="lp-pad" id="top">
          <div className="lp-container">
            <div className="blog-head">
              <nav className="blog-crumbs" aria-label="Trilha de navegação">
                <a href="/">Início</a>
                <span>·</span>
                <a href="/blog">Blog</a>
              </nav>
              <span className="blog-cat">{CATEGORY_LABEL[post.category]}</span>
              <h1 className="hero-title" style={{ marginTop: 14 }}>
                {post.h1}
              </h1>
              <p className="blog-lede">{post.description}</p>
              <div className="blog-meta">
                <span>
                  Por {BLOG_AUTHOR.name}, {BLOG_AUTHOR.role}
                </span>
                <span>·</span>
                <span>{formatPostDate(post.date)}</span>
                <span>·</span>
                <span>{post.readingMinutes} min de leitura</span>
              </div>
            </div>
            <article className="blog-prose" style={{ marginTop: 40 }}>
              <Markdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
                {post.body}
              </Markdown>
            </article>
            <aside className="blog-author">
              <span className="blog-author-name">{BLOG_AUTHOR.name}</span>
              <span className="blog-author-role">{BLOG_AUTHOR.role}</span>
              <p>{BLOG_AUTHOR.bio}</p>
            </aside>
            {related.length > 0 && (
              <section className="blog-related">
                <h2>Leia também</h2>
                <ul>
                  {related.map((r) => (
                    <li key={r.slug}>
                      <a href={postPath(r)}>{r.h1}</a>
                    </li>
                  ))}
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
