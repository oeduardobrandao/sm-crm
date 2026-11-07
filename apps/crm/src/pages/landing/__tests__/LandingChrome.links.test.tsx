import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OPEN_PREFERENCES_EVENT } from '@/lib/consent';

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: null, loading: false, profile: null, role: 'owner' }),
}));

import { LandingFooter, LandingHeader } from '../LandingChrome';

describe('landing chrome links', () => {
  it('footer links to the blog', () => {
    render(<LandingFooter />);
    expect(screen.getByRole('link', { name: 'Blog' })).toHaveAttribute('href', '/blog');
  });

  it('footer has a cookie preferences button that opens the consent dialog', () => {
    const handler = vi.fn();
    window.addEventListener(OPEN_PREFERENCES_EVENT, handler);
    render(<LandingFooter />);
    fireEvent.click(screen.getByRole('button', { name: 'Preferências de cookies' }));
    window.removeEventListener(OPEN_PREFERENCES_EVENT, handler);
    expect(handler).toHaveBeenCalledTimes(1);
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

  it.each(['landing', 'subpage'] as const)(
    'the %s header shows Entrar and one accessible name for the signup CTA',
    (variant) => {
      render(<LandingHeader variant={variant} />);
      const header = within(document.querySelector<HTMLElement>('.site-hdr')!);

      expect(header.getByRole('link', { name: 'Entrar' })).toHaveAttribute('href', '/login');

      const signup = header.getAllByRole('link', { name: 'Criar conta grátis' });
      expect(signup).toHaveLength(1);
      expect(signup[0]).toHaveAttribute('href', '/login?tab=register');
      expect(header.queryByRole('link', { name: 'Criar conta' })).not.toBeInTheDocument();

      const short = signup[0].querySelector('.hdr-cta-short');
      expect(short).not.toBeNull();
      expect(short).toHaveAttribute('aria-hidden', 'true');
      expect(signup[0].querySelector('.hdr-cta-long')).toHaveTextContent('Criar conta grátis');
    },
  );

  it('the subpage logo links home, the landing logo scrolls to top', () => {
    const { unmount } = render(<LandingHeader variant="subpage" />);
    expect(screen.getAllByRole('link', { name: 'Mesaas' })[0]).toHaveAttribute('href', '/');
    unmount();
    render(<LandingHeader variant="landing" />);
    expect(screen.getAllByRole('link', { name: 'Mesaas' })[0]).toHaveAttribute('href', '#top');
  });

  it('the subpage header toggles the document theme; the landing header has no toggle', () => {
    document.documentElement.removeAttribute('data-theme');
    const { unmount } = render(<LandingHeader variant="subpage" />);

    fireEvent.click(screen.getByRole('button', { name: 'Alternar tema' }));
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');

    fireEvent.click(screen.getByRole('button', { name: 'Alternar tema' }));
    expect(document.documentElement).not.toHaveAttribute('data-theme');
    unmount();

    render(<LandingHeader variant="landing" />);
    expect(screen.queryByRole('button', { name: 'Alternar tema' })).not.toBeInTheDocument();
  });
});
