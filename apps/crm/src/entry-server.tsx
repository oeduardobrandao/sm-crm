/** Build-time server render of the landing page (`/`).
 *
 * Built by Vite in SSR mode (apps/crm/vite.ssr.config.ts) into node_modules/.cache/landing-ssr,
 * never into dist/, and imported by scripts/seo/prerender.tsx, which writes the result into
 * dist/index.html inside `<div id="root" data-ssr="landing">`. main.tsx then hydrates it.
 *
 * The tree must equal the client's: the same `[{ path: '*', element: <App /> }]` data route
 * that main.tsx gives createBrowserRouter, the same i18n resources, language `pt`. Everything
 * the landing reads from the browser at render time renders its "anonymous first visit" state
 * here and on the hydrating client's first render, so hydration finds no mismatch. */
import { prerender } from 'react-dom/static';
import {
  createStaticHandler,
  createStaticRouter,
  StaticRouterProvider,
  type RouteObject,
} from 'react-router-dom';
import i18n from 'i18next';
import { initI18n } from '@mesaas/i18n';
import { I18N_LAZY, I18N_RESOURCES } from './boot/i18nResources';
import App, { preloadLanding } from './App';

const routes: RouteObject[] = [{ path: '*', element: <App /> }];

export async function render(url: string): Promise<{ html: string }> {
  // Once per process. Vitest's setup already initialised the shared singleton in `pt`.
  if (!i18n.isInitialized) {
    initI18n(I18N_RESOURCES, { lazy: I18N_LAZY, initialLanguage: 'pt' });
  }
  // Same fast path the client takes on `/` before its first render, so both render the
  // resolved landing component rather than one suspending and the other not.
  if (url === '/') await preloadLanding();

  const handler = createStaticHandler(routes);
  // createStaticHandler needs an absolute URL; the origin is never rendered.
  const context = await handler.query(new Request(`http://localhost${url}`));
  if (context instanceof Response) {
    throw new Error(`entry-server: ${url} answered a ${context.status} redirect/response`);
  }
  const router = createStaticRouter(handler.dataRoutes, context);

  // `prerender` (not renderToStaticMarkup) waits for every lazy() and keeps the Suspense
  // markers hydrateRoot needs. hydrate={false}: no __staticRouterHydrationData script, the
  // client router has no loader data to pick up. A component that throws makes React fall
  // back to client rendering for its boundary and still resolve, so errors are collected and
  // rethrown: a broken server render must fail the build, not ship the Suspense fallback.
  const errors: unknown[] = [];
  const { prelude } = await prerender(
    <StaticRouterProvider router={router} context={context} hydrate={false} />,
    { onError: (error) => void errors.push(error) },
  );
  const html = await new Response(prelude).text();
  if (errors.length > 0) {
    const first = errors[0];
    const detail = first instanceof Error ? (first.stack ?? first.message) : String(first);
    throw new Error(`entry-server: server render of ${url} failed: ${detail}`);
  }
  return { html };
}
