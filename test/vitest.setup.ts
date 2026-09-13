import { afterEach, expect, vi } from 'vitest';
import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup, configure } from '@testing-library/react';
import { initI18n } from '@mesaas/i18n';

expect.extend(matchers);

// CI's coverage-instrumented run is slow enough that testing-library's 1s
// default for findBy*/waitFor flakes on unrelated tests (ImportarPage,
// revocation, LoginPage all tripped it on 2026-07-30). More headroom in CI
// only; local runs keep the tight default so slow waits still surface.
if (process.env.CI) {
  configure({ asyncUtilTimeout: 10_000 });
}
import ptCommon from '../packages/i18n/locales/pt/common.json';
import enCommon from '../packages/i18n/locales/en/common.json';
import ptDashboard from '../packages/i18n/locales/pt/dashboard.json';
import enDashboard from '../packages/i18n/locales/en/dashboard.json';
import ptClients from '../packages/i18n/locales/pt/clients.json';
import enClients from '../packages/i18n/locales/en/clients.json';
import ptLeads from '../packages/i18n/locales/pt/leads.json';
import enLeads from '../packages/i18n/locales/en/leads.json';
import ptPosts from '../packages/i18n/locales/pt/posts.json';
import enPosts from '../packages/i18n/locales/en/posts.json';
import ptAuth from '../packages/i18n/locales/pt/auth.json';
import enAuth from '../packages/i18n/locales/en/auth.json';
import ptBrand from '../packages/i18n/locales/pt/brand.json';
import enBrand from '../packages/i18n/locales/en/brand.json';

initI18n({
  pt: {
    common: ptCommon,
    dashboard: ptDashboard,
    clients: ptClients,
    leads: ptLeads,
    posts: ptPosts,
    auth: ptAuth,
    brand: ptBrand,
  },
  en: {
    common: enCommon,
    dashboard: enDashboard,
    clients: enClients,
    leads: enLeads,
    posts: enPosts,
    auth: enAuth,
    brand: enBrand,
  },
});

// jsdom has no ResizeObserver — cmdk (FontPicker) and other floating-ui consumers observe
// their anchors with it. A no-op implementation is enough for tests.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// jsdom is also missing the DOM geometry APIs ProseMirror's EditorView calls on every
// real click/keystroke inside a contenteditable it manages (posAtCoords -> elementFromPoint,
// scrollToSelection -> coordsAtPos -> Range.getClientRects/getBoundingClientRect). Without
// these, `userEvent.click`/`.type` against a mounted TipTap editor throws uncaught exceptions
// mid-transaction and the resulting document silently never receives the typed text (proven
// empirically while writing PaginaRichTextEditor.test.tsx, Task 9 of the portal-cliente-layout
// plan). Zero-sized stubs are enough: tests don't assert real screen coordinates, they only
// need ProseMirror to finish applying the transaction instead of throwing.
if (!document.elementFromPoint) {
  document.elementFromPoint = () => null;
}
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    toJSON() {
      return {};
    },
  });
}
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () =>
    ({
      length: 0,
      item: () => null,
      [Symbol.iterator]: function* () {},
    }) as unknown as DOMRectList;
}

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
