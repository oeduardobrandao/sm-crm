import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { BlogPost } from '@/content/blog.schema';

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: null, loading: false, profile: null, role: 'owner' }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// The repo currently ships one real post, so relatedPosts(post, BLOG_POSTS)
// always returns [] against real content and the "Leia também" branch never
// runs in BlogPostPage.test.tsx. Mock the post loader here (only in this
// file) so the page sees two posts and the block has something to render.
const { POST_A, POST_B } = vi.hoisted(() => {
  const POST_A: BlogPost = {
    slug: 'post-a-de-teste',
    title: 'Título de teste A usado só para o teste de posts relacionados',
    h1: 'H1 de teste do post A',
    description:
      'Descrição de teste do post A, usada só para verificar o bloco "Leia também" do BlogPostPage com dois posts.',
    date: '2026-07-20',
    updated: '2026-07-20',
    category: 'comparativo',
    body: 'Corpo de teste do post A.',
    readingMinutes: 1,
  };
  const POST_B: BlogPost = {
    slug: 'post-b-de-teste',
    title: 'Título de teste B usado só para o teste de posts relacionados',
    h1: 'H1 de teste do post B',
    description:
      'Descrição de teste do post B, usada só para verificar o bloco "Leia também" do BlogPostPage com dois posts.',
    date: '2026-07-10',
    updated: '2026-07-10',
    category: 'guia',
    body: 'Corpo de teste do post B.',
    readingMinutes: 1,
  };
  return { POST_A, POST_B };
});

vi.mock('@/content/blog.client', () => ({
  BLOG_POSTS: [POST_A, POST_B],
  postBySlug: (slug: string) => [POST_A, POST_B].find((p) => p.slug === slug),
}));

import BlogPostPage from '../BlogPostPage';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/blog/:slug" element={<BlogPostPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('BlogPostPage "Leia também"', () => {
  it('renders a link to the other post when more than one post exists', () => {
    renderAt(`/blog/${POST_A.slug}`);
    expect(screen.getByRole('heading', { name: 'Leia também' })).toBeInTheDocument();
    const link = screen.getByRole('link', { name: POST_B.h1 });
    expect(link).toHaveAttribute('href', `/blog/${POST_B.slug}`);
  });
});
