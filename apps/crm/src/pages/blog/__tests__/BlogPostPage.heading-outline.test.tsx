import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: null, loading: false, profile: null, role: 'owner' }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import BlogPostPage from '../BlogPostPage';
import { BLOG_AUTHOR, CATEGORY_LABEL } from '@/content/blog';
import { BLOG_POSTS, postBySlug } from '@/content/blog.client';
import { renderBlogPostHtml } from '@/content/blog.seo';

// A visitor from Google gets renderBlogPostHtml's static markup first; React
// then replaces it with BlogPostPage. If the two ever disagree on heading
// structure or visible text, crawlers and readers see a different document
// for the same URL. This is the pin for Part B (items 4-6): it fails if the
// lede, the byline role, or the author-card heading ever drift apart again.
describe('BlogPostPage vs renderBlogPostHtml alignment', () => {
  it('emit the same number of h1s and the same ordered h2 texts', () => {
    const post = postBySlug('mesaas-vs-aprova-post');
    if (!post) throw new Error('pilot post missing');

    const { container } = render(
      <MemoryRouter initialEntries={['/blog/mesaas-vs-aprova-post']}>
        <Routes>
          <Route path="/blog/:slug" element={<BlogPostPage />} />
        </Routes>
      </MemoryRouter>,
    );
    const reactH1 = container.querySelectorAll('h1');
    const reactH2 = Array.from(container.querySelectorAll('h2')).map((el) =>
      el.textContent?.trim(),
    );

    const staticHtml = renderBlogPostHtml(post, BLOG_POSTS);
    const staticDoc = new DOMParser().parseFromString(staticHtml, 'text/html');
    const staticH1 = staticDoc.querySelectorAll('h1');
    const staticH2 = Array.from(staticDoc.querySelectorAll('h2')).map((el) =>
      el.textContent?.trim(),
    );

    // Item 6: the mirror's author card must not carry an "Sobre o autor" h2
    // the React card doesn't have — same # of h1s, same ordered h2 list.
    expect(reactH1).toHaveLength(1);
    expect(staticH1).toHaveLength(1);
    expect(reactH2).toEqual(staticH2);

    // Item 4: the mirror's <p>{description}</p> lede under the h1 must also
    // be visible on the React page (.blog-lede), not silently dropped.
    expect(container.querySelector('.blog-lede')?.textContent).toBe(post.description);
    expect(staticDoc.body.textContent).toContain(post.description);

    // Item 5: both bylines must credit the author's role, not just the name.
    expect(container.textContent).toContain(BLOG_AUTHOR.role);
    expect(staticDoc.body.textContent).toContain(BLOG_AUTHOR.role);

    // The category pill was React-only until the Task 6 review caught it: a
    // crawler reading the static snapshot never learned the post's category.
    // Anchored to the elements on purpose — a textContent match would pass on
    // the pilot article regardless, since its body has a "Comparativo" heading.
    const label = CATEGORY_LABEL[post.category];
    expect(container.querySelector('.blog-cat')?.textContent).toBe(label);
    expect(staticDoc.querySelector('article > p')?.textContent).toBe(label);
  });
});
