import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: null, loading: false, profile: null, role: 'owner' }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import BlogIndexPage from '../BlogIndexPage';
import { BLOG_POSTS } from '@/content/blog.client';

describe('BlogIndexPage', () => {
  it('renders the heading and one linked card per post', () => {
    render(
      <MemoryRouter>
        <BlogIndexPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1, name: /Blog do Mesaas/ })).toBeInTheDocument();
    const links = screen.getAllByRole('link', { name: /Aprova Post/ });
    expect(links.length).toBeGreaterThan(0);
    expect(links[0]).toHaveAttribute('href', '/blog/mesaas-vs-aprova-post');
  });

  // The post field is literally named `h1`, which makes rendering it as one on
  // the card an easy mistake — and two h1s on an index page is an SEO defect
  // no other test here would catch.
  it('emits exactly one h1, whatever the cards render', () => {
    render(
      <MemoryRouter>
        <BlogIndexPage />
      </MemoryRouter>,
    );
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  // The index is only useful if the newest post is on top, and the page gets
  // that for free by mapping an already-sorted list — which is exactly why it
  // is easy to break later with a `.reverse()`, a `.sort()` on the render
  // list, or a switch to an unsorted source.
  //
  // Note what carries the weight here. Every post currently shares the date
  // 2026-07-25, so "the dates never increase" holds even if the list renders
  // backwards; that check is necessary but blind on its own. The exact slug
  // sequence is the assertion that actually fails on a reversal, and it is
  // compared against an ordering computed here (date desc, slug asc) instead
  // of reusing the sortPosts the page's own data already went through.
  it('renders the cards newest-first', () => {
    const { container } = render(
      <MemoryRouter>
        <BlogIndexPage />
      </MemoryRouter>,
    );

    const hrefs = [...container.querySelectorAll('a.blog-card')].map((a) => a.getAttribute('href'));
    // With a single card any order is trivially correct, so the assertions
    // below would prove nothing.
    expect(hrefs.length).toBeGreaterThan(1);

    const expected = [...BLOG_POSTS]
      .sort((a, b) =>
        a.date === b.date ? a.slug.localeCompare(b.slug) : b.date.localeCompare(a.date),
      )
      .map((p) => `/blog/${p.slug}`);
    expect(hrefs).toEqual(expected);

    const dates = hrefs.map((href) => BLOG_POSTS.find((p) => `/blog/${p.slug}` === href)?.date);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it('sets the document title from the manifest', () => {
    render(
      <MemoryRouter>
        <BlogIndexPage />
      </MemoryRouter>,
    );
    expect(document.title).toContain('Blog do Mesaas');
  });
});
