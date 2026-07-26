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
});
