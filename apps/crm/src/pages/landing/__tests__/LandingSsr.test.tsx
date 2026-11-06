// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({
  user: null as { id: string } | null,
  loading: true,
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: authState.user, loading: authState.loading, profile: null }),
}));

vi.mock('@/services/billing', () => ({
  listPublicPricingPlans: vi.fn(() => new Promise(() => {})),
}));

import LandingPage from '../LandingPage';
import { Testimonials } from '../Testimonials';

function renderLanding(): string {
  const client = new QueryClient();
  return renderToString(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('landing server render', () => {
  it('runs with no window, document or localStorage', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
    expect(typeof localStorage).toBe('undefined');
    authState.user = null;
    authState.loading = true;
    expect(() => renderLanding()).not.toThrow();
  });

  it('renders the logged-out CTAs while auth is loading', () => {
    authState.user = null;
    authState.loading = true;
    const html = renderLanding();
    expect(html).toContain('Começar teste grátis');
    expect(html).toContain('Criar conta grátis');
    expect(html).not.toContain('Acessar painel');
  });

  it('renders the logged-out CTAs even when a user is already known', () => {
    authState.user = { id: 'u' };
    authState.loading = false;
    const html = renderLanding();
    expect(html).toContain('Começar teste grátis');
    expect(html).not.toContain('Acessar painel');
    expect(html).not.toContain('Bem-vindo de volta');
  });

  it('renders the promo banner and the build year in the footer', () => {
    authState.user = null;
    authState.loading = true;
    const html = renderLanding();
    expect(html).toContain('promo-banner');
    expect(html).toContain(`© ${__BUILD_YEAR__} Mesaas`);
  });

  it('renders Testimonials without window.matchMedia', () => {
    expect(() => renderToString(<Testimonials />)).not.toThrow();
  });
});

describe('landing.css SSR contract', () => {
  const css = readFileSync(path.resolve(__dirname, '../landing.css'), 'utf8');

  it('hides reveal sections only once JS has marked the document', () => {
    const hidden = /([^{}]*)\{[^}]*opacity:\s*0[^}]*\}/g;
    const revealSelectors = [...css.matchAll(hidden)]
      .map((m) => m[1].trim())
      .filter((sel) => sel.includes('.reveal'));
    expect(revealSelectors.length).toBeGreaterThan(0);
    for (const sel of revealSelectors) {
      expect(sel.startsWith('html[data-js]')).toBe(true);
      expect(sel).toContain('.reveal:not(.in)');
    }
    expect(css).not.toMatch(/(^|\n)\s*\.lp-root \.reveal\s*\{[^}]*opacity:\s*0/);
  });

  it('pre-paint hides a dismissed promo banner only before hydration', () => {
    expect(css).toMatch(
      /html\[data-promo-dismissed\] #root\[data-ssr\] \.promo-banner\s*\{\s*display:\s*none;?\s*\}/,
    );
  });
});
