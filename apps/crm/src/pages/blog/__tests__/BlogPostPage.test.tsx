import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: null, loading: false, profile: null, role: 'owner' }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// The real posts plus one DB post whose body loads lazily: file posts keep
// rendering synchronously from the real loader, the DB one goes through the
// mocked `loadPostBody`.
const { loadPostBody } = vi.hoisted(() => ({
  loadPostBody: vi.fn<(slug: string) => Promise<string>>(),
}));
vi.mock('@/content/blog.client', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/content/blog.client')>();
  const { dbPostLazy } = await import('@/content/__tests__/blogDbFixture');
  const all = [...real.BLOG_POSTS, dbPostLazy()];
  return {
    ...real,
    BLOG_POSTS: all,
    postBySlug: (slug: string) => all.find((p) => p.slug === slug),
    loadPostBody,
  };
});

import BlogPostPage from '../BlogPostPage';
import { BLOG_AUTHOR } from '@/content/blog';
import { DB_POST_BODY, DB_POST_META } from '@/content/__tests__/blogDbFixture';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/blog/:slug" element={<BlogPostPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('BlogPostPage', () => {
  it('renders the article h1, the markdown body and the author card', () => {
    renderAt('/blog/mesaas-vs-aprova-post');
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThan(0);
    // The name appears twice (byline + author card), so assert on the bio,
    // which is unique to the card.
    expect(screen.getByText(BLOG_AUTHOR.bio)).toBeInTheDocument();
    expect(screen.getAllByText(new RegExp(BLOG_AUTHOR.name))).toHaveLength(2);
  });

  it('renders a file post body synchronously, without the lazy loader', () => {
    loadPostBody.mockClear();
    const { container } = renderAt('/blog/mesaas-vs-aprova-post');
    expect(container.querySelector('.blog-prose h2')).not.toBeNull();
    expect(container.querySelector('.blog-skeleton')).toBeNull();
    expect(loadPostBody).not.toHaveBeenCalled();
  });

  it('sets the post title and canonical on mount', () => {
    renderAt('/blog/mesaas-vs-aprova-post');
    expect(document.title).toContain('Aprova Post');
    expect(document.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      'https://www.mesaas.com.br/blog/mesaas-vs-aprova-post',
    );
    expect(document.querySelectorAll('script[data-seo="jsonld"]').length).toBe(2);
  });

  it('renders the 404 page for an unknown slug', () => {
    renderAt('/blog/nao-existe');
    expect(screen.getByText(/não encontrada/i)).toBeInTheDocument();
    expect(document.body.classList.contains('landing-page')).toBe(false);
  });

  // Regression net for MARKDOWN_COMPONENTS — the page must pass the shared
  // overrides in, not just render markdown some other way that happens to
  // look the same. The pilot article links out to a competitor
  // (aprovapost.com.br) and internally (/precos).
  it('applies the shared markdown link overrides: nofollow external, plain internal', () => {
    const { container } = renderAt('/blog/mesaas-vs-aprova-post');
    const external = container.querySelector('.blog-prose a[href="https://aprovapost.com.br"]');
    expect(external).toHaveAttribute('rel', 'nofollow noopener');
    expect(external).toHaveAttribute('target', '_blank');
    const internal = container.querySelector('.blog-prose a[href="/precos"]');
    expect(internal).not.toBeNull();
    expect(internal).not.toHaveAttribute('rel');
    expect(internal).not.toHaveAttribute('target');
  });

  // Regression net for the useMemo around jsonLd: usePageMetaFor's effect
  // deps are [meta, jsonLd], so an unmemoized jsonLd array is a new
  // reference on every render, which reruns the head-writing effect (it
  // removes and recreates the <script> node). Memoized, re-rendering with
  // the same post must leave the DOM node's identity untouched.
  it('keeps the jsonld script node identity stable across a re-render', () => {
    const { rerender } = renderAt('/blog/mesaas-vs-aprova-post');
    const before = document.querySelector('script[data-seo="jsonld"]');
    expect(before).not.toBeNull();
    rerender(
      <MemoryRouter initialEntries={['/blog/mesaas-vs-aprova-post']}>
        <Routes>
          <Route path="/blog/:slug" element={<BlogPostPage />} />
        </Routes>
      </MemoryRouter>,
    );
    const after = document.querySelector('script[data-seo="jsonld"]');
    expect(after).toBe(before);
  });
});

describe('BlogPostPage, database post', () => {
  const path = `/blog/${DB_POST_META.slug}`;

  it('shows the header at once, a skeleton, then the loaded body', async () => {
    loadPostBody.mockReset();
    loadPostBody.mockResolvedValueOnce(DB_POST_BODY);
    const { container } = renderAt(path);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(DB_POST_META.h1);
    expect(container.querySelector('.blog-lede')).toHaveTextContent(DB_POST_META.lede);
    expect(screen.getAllByText(/Equipe Mesaas/).length).toBeGreaterThan(0);
    expect(container.querySelector('.blog-skeleton')).not.toBeNull();

    expect(await screen.findByText('Texto de fechamento do artigo.')).toBeInTheDocument();
    expect(container.querySelector('.blog-skeleton')).toBeNull();
    expect(loadPostBody).toHaveBeenCalledWith(DB_POST_META.slug);
    expect(screen.getByText('Tempo médio até a aprovação')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Fontes' })).toBeInTheDocument();
  });

  it('shows the retry copy when the body fails to load, and retries', async () => {
    loadPostBody.mockReset();
    const failure = new Error('chunk failed');
    loadPostBody.mockRejectedValueOnce(failure);
    loadPostBody.mockResolvedValueOnce(DB_POST_BODY);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderAt(path);

    expect(await screen.findByText('Não foi possível carregar o artigo.')).toBeInTheDocument();
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining(DB_POST_META.slug), failure);
    consoleError.mockRestore();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Texto de fechamento do artigo.')).toBeInTheDocument();
    expect(loadPostBody).toHaveBeenCalledTimes(2);
  });
});
