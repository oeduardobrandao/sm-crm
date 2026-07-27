import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: null, loading: false, profile: null, role: 'owner' }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import BlogIndexPage from '../BlogIndexPage';
import { BLOG_POSTS } from '@/content/blog.client';
import { renderBlogIndexHtml } from '@/content/blog.seo';

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
  // Note what carries the weight here. Both assertions below now discriminate
  // on their own: the posts carry distinct dates, so a reversed render breaks
  // the monotonic-dates check as well as the slug sequence. Keep both. The
  // dates one states the intent; the slug sequence survives a future pair of
  // posts published on the same day, when date order alone stops deciding.
  //
  // The expected order is computed here (date desc, slug asc) rather than by
  // reusing the sortPosts the page's own data already went through — a test
  // that sorts with the code under test asserts nothing about the sort.
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

// The article page had this invariant pinned from the start; the index did
// not, and an external review found the static mirror shipping a CTA the
// React page dropped the moment it mounted. Crawlers and readers must get the
// same document for the same URL.
describe('BlogIndexPage vs renderBlogIndexHtml alignment', () => {
  it('renders the same call to action the static mirror emits', () => {
    const { container } = render(
      <MemoryRouter>
        <BlogIndexPage />
      </MemoryRouter>,
    );
    const staticDoc = new DOMParser().parseFromString(renderBlogIndexHtml(BLOG_POSTS), 'text/html');

    const staticCta = staticDoc.querySelector('section:last-of-type h2')?.textContent?.trim();
    expect(staticCta).toBeTruthy();
    expect(container.querySelector('.cta-final-card h2')?.textContent?.trim()).toBe(staticCta);

    const signupHref = '/login?tab=register';
    expect(staticDoc.querySelector(`a[href="${signupHref}"]`)).not.toBeNull();
    expect(container.querySelector(`a[href="${signupHref}"]`)).not.toBeNull();
  });

  it('still emits exactly one h1 with the CTA present', () => {
    render(
      <MemoryRouter>
        <BlogIndexPage />
      </MemoryRouter>,
    );
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });
});
