import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: null, loading: false, profile: null, role: 'owner' }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import BlogIndexPage from '../BlogIndexPage';

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

  it('sets the document title from the manifest', () => {
    render(
      <MemoryRouter>
        <BlogIndexPage />
      </MemoryRouter>,
    );
    expect(document.title).toContain('Blog do Mesaas');
  });
});
