import { act, useSyncExternalStore } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { markSsrMount } from '@/lib/ssrMount';

type AuthState = { user: { id: string } | null; loading: boolean };

// A tiny external store, so a test can resolve auth after mount and the landing re-renders.
const auth = vi.hoisted(() => {
  let state: AuthState = { user: null, loading: true };
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next: AuthState) {
      state = next;
      listeners.forEach((l) => l());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => {
    const state = useSyncExternalStore(auth.subscribe, auth.get, auth.get);
    return { user: state.user, loading: state.loading, profile: null };
  },
}));

vi.mock('@/services/billing', () => ({
  listPublicPricingPlans: vi.fn(() => new Promise(() => {})),
}));

import LandingPage from '../LandingPage';

function tree() {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

let container: HTMLDivElement;
let root: Root | null = null;
let consoleError: MockInstance<typeof console.error>;
const originalMatchMedia = window.matchMedia;

function serverHtml(): string {
  const saved = auth.get();
  // The server never knows the user.
  auth.set({ user: null, loading: true });
  const html = renderToString(tree());
  auth.set(saved);
  return html;
}

/** React 19 reports attribute/className/text mismatches through console.error, not only
 * through onRecoverableError. */
function hydrationConsoleErrors(): unknown[][] {
  return consoleError.mock.calls.filter((args) =>
    /hydrat|did not match|mismatch/i.test(args.map((a) => String(a)).join(' ')),
  );
}

/** The auth-dependent CTAs: header actions, hero primary CTA, final CTA row. */
function ctaLinks(): string[] {
  const selectors = ['.hdr-actions a', '.hero-ctas a', '.lp2-cta-row a'];
  return selectors.flatMap((sel) =>
    [...container.querySelectorAll(sel)].map((a) => a.textContent?.trim() ?? ''),
  );
}

beforeEach(() => {
  consoleError = vi.spyOn(console, 'error');
  container = document.createElement('div');
  container.id = 'root';
  document.body.appendChild(container);
  localStorage.setItem('mesaas_promo_dismissed', '1');
  localStorage.setItem(
    'consent_v1',
    JSON.stringify({ analytics: true, support: true, decidedAt: '2026-10-01T00:00:00.000Z' }),
  );
  document.documentElement.setAttribute('data-theme', 'dark');
  // Testimonials subscribes to prefers-reduced-motion; its markup does not depend on it.
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container.remove();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  window.matchMedia = originalMatchMedia;
  markSsrMount(false);
  auth.set({ user: null, loading: true });
  consoleError.mockRestore();
});

async function hydrate(spy: (e: unknown) => void) {
  markSsrMount(true);
  await act(async () => {
    root = hydrateRoot(container, tree(), { onRecoverableError: spy });
  });
}

describe('landing hydration', () => {
  it('hydrates stored-state visitors with no recoverable error', async () => {
    auth.set({ user: null, loading: true });
    container.innerHTML = serverHtml();
    container.setAttribute('data-ssr', 'landing');
    expect(container.querySelector('.promo-banner')).not.toBeNull();

    const spy = vi.fn();
    await hydrate(spy);

    expect(spy).not.toHaveBeenCalled();
    expect(hydrationConsoleErrors()).toEqual([]);
    expect(container.querySelector('.promo-banner')).toBeNull();
    expect(container.hasAttribute('data-ssr')).toBe(false);
  });

  it('hydrates when auth already knows the user, then shows the signed-in CTA', async () => {
    auth.set({ user: { id: 'u' }, loading: false });
    container.innerHTML = serverHtml();
    container.setAttribute('data-ssr', 'landing');

    const spy = vi.fn();
    await hydrate(spy);

    expect(spy).not.toHaveBeenCalled();
    expect(hydrationConsoleErrors()).toEqual([]);
    expect(container.textContent).toContain('Acessar painel');
    expect(container.textContent).toContain('Bem-vindo de volta');
  });

  it('keeps the anonymous CTAs after hydration while auth is loading, then flips', async () => {
    auth.set({ user: null, loading: true });
    container.innerHTML = serverHtml();
    container.setAttribute('data-ssr', 'landing');
    const serverCtas = ctaLinks();
    expect(serverCtas).toEqual(
      expect.arrayContaining(['Entrar', 'Criar conta grátis', 'Começar teste grátis']),
    );

    const spy = vi.fn();
    await hydrate(spy);

    expect(spy).not.toHaveBeenCalled();
    expect(hydrationConsoleErrors()).toEqual([]);
    // Still loading: the server HTML's CTAs stay, they do not vanish.
    expect(ctaLinks()).toEqual(serverCtas);
    expect(container.textContent).not.toContain('Acessar painel');

    await act(async () => auth.set({ user: { id: 'u' }, loading: false }));
    expect(ctaLinks()).toContain('Acessar painel');
    expect(ctaLinks()).not.toContain('Entrar');
  });
});

describe('landing createRoot mount (not server-rendered)', () => {
  async function render() {
    markSsrMount(false);
    await act(async () => {
      root = createRoot(container);
      root.render(tree());
    });
  }

  it('renders no auth CTA while auth loads, then the signed-in one', async () => {
    auth.set({ user: { id: 'u' }, loading: true });
    await render();
    expect(ctaLinks()).toEqual([]);

    await act(async () => auth.set({ user: { id: 'u' }, loading: false }));
    expect(ctaLinks()).toContain('Acessar painel');
    expect(ctaLinks()).not.toContain('Entrar');
    expect(ctaLinks()).not.toContain('Criar conta grátis');
  });

  it('renders no auth CTA while auth loads, then the anonymous ones', async () => {
    auth.set({ user: null, loading: true });
    await render();
    expect(ctaLinks()).toEqual([]);

    await act(async () => auth.set({ user: null, loading: false }));
    expect(ctaLinks()).toEqual(
      expect.arrayContaining(['Entrar', 'Criar conta grátis', 'Começar teste grátis']),
    );
    expect(ctaLinks()).not.toContain('Acessar painel');
  });
});
