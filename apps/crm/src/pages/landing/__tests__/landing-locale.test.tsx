import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/billing', () => ({
  listPublicPricingPlans: vi.fn().mockResolvedValue([]),
  getEffectivePlanWithSource: vi.fn().mockResolvedValue(null),
  getWorkspaceSubscription: vi.fn().mockResolvedValue(null),
  hasUsedTrial: () => false,
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: null, loading: false, profile: null, role: 'owner' }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import LandingPage from '../LandingPage';

function html(node: React.ReactElement): string {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  ).replace(`\u00a9 ${__BUILD_YEAR__}`, '\u00a9 YEAR');
}

describe('LandingPage baseline (pt)', () => {
  it('renders the Portuguese landing as it ships', () => {
    expect(html(<LandingPage />)).toMatchSnapshot();
  });
});

describe('LandingPage locale en', () => {
  const en = html(<LandingPage locale="en" />);
  const doc = new DOMParser().parseFromString(en, 'text/html');

  it('shows the pinned hero note and the English copy', () => {
    expect(doc.querySelector('.lp2-offer-text')?.textContent).toBe(
      '14 days of Pro free, no card required. At the end, you decide whether to stay.',
    );
    expect(doc.querySelector('h1')?.textContent).toContain('Stop running social media clients');
  });

  it('links to the Portuguese version and shows the pinned entity line', () => {
    const link = [...doc.querySelectorAll('footer a')].find(
      (a) => a.textContent === 'Versão em português',
    );
    expect(link?.getAttribute('href')).toBe('/');
    expect(doc.querySelector('.footer-bottom span')?.textContent).toBe(
      '\u00a9 YEAR Mesaas, operated by EBS IT SOLUTIONS (Salvador, Brazil)',
    );
  });

  it('has the English legal links and the two privacy buttons', () => {
    const footer = doc.querySelector('footer')!;
    const links = new Map(
      [...footer.querySelectorAll('a')].map((a) => [a.textContent, a.getAttribute('href')]),
    );
    expect(links.get('Pricing')).toBe('/en/pricing');
    expect(links.get('Privacy Policy')).toBe('/en/privacy');
    expect(links.get('Terms of Service')).toBe('/en/terms');
    const buttons = [...footer.querySelectorAll('button')].map((b) => b.textContent);
    expect(buttons).toContain('Cookie settings');
    expect(buttons).toContain('Do Not Sell or Share My Personal Information');
  });

  it('adds market=us to every signup link', () => {
    const signups = [...doc.querySelectorAll('a')].filter((a) =>
      (a.getAttribute('href') ?? '').startsWith('/login?tab=register'),
    );
    expect(signups.length).toBeGreaterThan(0);
    for (const a of signups) expect(a.getAttribute('href')).toContain('market=us');
  });

  it('renders no testimonials, CNPJ, LGPD or Portuguese chrome', () => {
    expect(doc.querySelector('.quote-wrap')).toBeNull();
    expect(en).not.toContain('Débora Kristin');
    expect(en).not.toContain('Jennifer Araripe');
    expect(en).not.toContain('CNPJ');
    expect(en).not.toContain('LGPD');
    expect(en).not.toContain('Todos os direitos');
    expect(en).not.toContain('—');
  });

  it('keeps image sources on /landing/ and only uses /landing/en/ for files that exist', () => {
    const enDir = join(process.cwd(), 'apps/crm/public/landing/en');
    const available = existsSync(enDir) ? readdirSync(enDir) : [];
    const urls = [...doc.querySelectorAll('img')].flatMap((img) => [
      img.getAttribute('src') ?? '',
      ...(img.getAttribute('srcset') ?? '').split(',').map((c) => c.trim().split(' ')[0]),
    ]);
    const landing = urls.filter((u) => u.startsWith('/landing/'));
    expect(landing.length).toBeGreaterThan(0);
    for (const u of landing) {
      if (u.startsWith('/landing/en/')) expect(available).toContain(u.split('/').pop());
      else expect(available).not.toContain(u.split('/').pop());
    }
  });
});

describe('LandingPage pt footer', () => {
  it('links to the English version', () => {
    const doc = new DOMParser().parseFromString(html(<LandingPage />), 'text/html');
    const link = [...doc.querySelectorAll('footer a')].find((a) => a.textContent === 'English');
    expect(link?.getAttribute('href')).toBe('/en');
  });
});
