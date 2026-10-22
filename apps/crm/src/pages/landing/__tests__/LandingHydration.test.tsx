import { act } from 'react';
import { hydrateRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

function serverHtml(): string {
  const saved = { ...authState };
  // The server never knows the user.
  authState.user = null;
  authState.loading = true;
  const html = renderToString(tree());
  Object.assign(authState, saved);
  return html;
}

beforeEach(() => {
  container = document.createElement('div');
  container.id = 'root';
  document.body.appendChild(container);
  localStorage.setItem('mesaas_promo_dismissed', '1');
  localStorage.setItem(
    'consent_v1',
    JSON.stringify({ analytics: true, support: true, decidedAt: '2026-10-01T00:00:00.000Z' }),
  );
  document.documentElement.setAttribute('data-theme', 'dark');
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('reduce'),
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
});

async function hydrate(spy: (e: unknown) => void) {
  await act(async () => {
    root = hydrateRoot(container, tree(), { onRecoverableError: spy });
  });
}

describe('landing hydration', () => {
  it('hydrates stored-state visitors with no recoverable error', async () => {
    authState.user = null;
    authState.loading = true;
    container.innerHTML = serverHtml();
    container.setAttribute('data-ssr', 'landing');
    expect(container.querySelector('.promo-banner')).not.toBeNull();

    const spy = vi.fn();
    await hydrate(spy);

    expect(spy).not.toHaveBeenCalled();
    expect(container.querySelector('.promo-banner')).toBeNull();
    expect(container.hasAttribute('data-ssr')).toBe(false);
  });

  it('hydrates when auth already knows the user, then shows the signed-in CTA', async () => {
    authState.user = { id: 'u' };
    authState.loading = false;
    container.innerHTML = serverHtml();
    container.setAttribute('data-ssr', 'landing');

    const spy = vi.fn();
    await hydrate(spy);

    expect(spy).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Acessar painel');
    expect(container.textContent).toContain('Bem-vindo de volta');
  });
});
