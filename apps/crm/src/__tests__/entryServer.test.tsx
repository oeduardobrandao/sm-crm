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

  // One process renders both landings (scripts/seo/prerender.tsx), and the i18n singleton is
  // shared: each render must set its own language, whatever ran before it.
  it('renders / in Portuguese and /en in English, in either order', async () => {
    const PT_HERO = 'Começar teste grátis';
    const EN_NOTE = '14 days of Pro free, no card required.';
    const pt1 = await render('/');
    const en1 = await render('/en');
    const en2 = await render('/en');
    const pt2 = await render('/');
    for (const { html } of [pt1, pt2]) {
      expect(html).toContain('class="lp2-hero"');
      expect(html).toContain(PT_HERO);
      expect(html).not.toContain(EN_NOTE);
    }
    for (const { html } of [en1, en2]) {
      expect(html).toContain('class="lp2-hero"');
      expect(html).toContain(EN_NOTE);
      expect(html).not.toContain(PT_HERO);
      expect(html).not.toContain('__staticRouterHydrationData');
    }
    expect(pt2.html).toBe(pt1.html);
    expect(en2.html).toBe(en1.html);
  });

  it('is deterministic across renders', async () => {
    const first = await render('/');
    const second = await render('/');
    expect(second.html).toBe(first.html);
  });
});
