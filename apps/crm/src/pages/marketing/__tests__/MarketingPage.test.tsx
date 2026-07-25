import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { MarketingPageContent } from '@/content/paginas';

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: null, loading: false, profile: null, role: 'owner' }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import MarketingPage from '../MarketingPage';

const SAMPLE: MarketingPageContent = {
  slug: 'exemplo',
  eyebrow: 'Recurso',
  h1: 'Título da página',
  sub: 'Subtítulo da página.',
  sections: [{ h2: 'Seção', paragraphs: ['Par.'], bullets: ['Item A'] }],
  faq: [{ q: 'P?', a: 'R.' }],
  cta: { title: 'Pronto?', sub: 'Comece grátis.' },
};

describe('MarketingPage', () => {
  it('renders h1, sections, faq and CTA from content', () => {
    render(
      <MemoryRouter>
        <MarketingPage page={SAMPLE} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Título da página' })).toBeInTheDocument();
    expect(screen.getByText('Seção')).toBeInTheDocument();
    expect(screen.getByText('P?')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /Criar conta grátis/ }).length).toBeGreaterThan(0);
  });
});
