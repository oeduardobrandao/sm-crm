import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: null, loading: false, profile: null, role: 'owner' }),
}));

import { LandingFooter, LandingHeader } from '../LandingChrome';

describe('landing chrome links', () => {
  it('footer links to the blog', () => {
    render(<LandingFooter />);
    expect(screen.getByRole('link', { name: 'Blog' })).toHaveAttribute('href', '/blog');
  });

  it('footer section links work from a subpage (absolute hashes)', () => {
    render(<LandingFooter />);
    const sections = [
      ['Funcionalidades', '/#features'],
      ['Como funciona', '/#how'],
      ['Preços', '/#pricing'],
      ['FAQ', '/#faq'],
    ] as const;
    for (const [name, href] of sections) {
      expect(screen.getByRole('link', { name })).toHaveAttribute('href', href);
    }
  });

  it('the subpage logo links home, the landing logo scrolls to top', () => {
    const { unmount } = render(<LandingHeader variant="subpage" />);
    expect(screen.getAllByRole('link', { name: 'Mesaas' })[0]).toHaveAttribute('href', '/');
    unmount();
    render(<LandingHeader variant="landing" />);
    expect(screen.getAllByRole('link', { name: 'Mesaas' })[0]).toHaveAttribute('href', '#top');
  });
});
