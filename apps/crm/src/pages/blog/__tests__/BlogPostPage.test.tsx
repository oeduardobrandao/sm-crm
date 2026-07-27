import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: null, loading: false, profile: null, role: 'owner' }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import BlogPostPage from '../BlogPostPage';
import { BLOG_AUTHOR } from '@/content/blog';

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
