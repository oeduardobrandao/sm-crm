// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { render } from '../entry-server';

// The landing's build-time server render (scripts/seo/prerender.tsx writes it into
// dist/index.html, and main.tsx hydrates it). Runs without DOM globals, like the prerender.
describe('entry-server render', () => {
  it('renders the landing page, not the Suspense fallback', async () => {
    expect(typeof window).toBe('undefined');
    const { html } = await render('/');
    expect(html).toContain('class="lp2-hero"');
    expect(html).toContain('Começar teste grátis');
    expect(html).toContain('cookie-banner');
    // Hydration markers: `prerender` keeps the Suspense boundaries hydrateRoot expects.
    expect(html).toContain('<!--$-->');
    // The text-only crawler mirror is not part of the real page.
    expect(html).not.toContain('lp-ssr');
    // hydrate={false}: the client's createBrowserRouter runs no loaders to rehydrate.
    expect(html).not.toContain('__staticRouterHydrationData');
  });

  it('is deterministic across renders', async () => {
    const first = await render('/');
    const second = await render('/');
    expect(second.html).toBe(first.html);
  });
});
