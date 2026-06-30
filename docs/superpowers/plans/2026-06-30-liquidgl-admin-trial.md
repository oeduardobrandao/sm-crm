# liquidGL Admin Trial Implementation Plan

> **⚠️ Historical.** This plan implemented the real WebGL liquidGL library. During the live trial that approach proved unworkable for UI (liquidGL hides any element it targets via `opacity:0` and is a decorative overlay only), so the shipped result **pivoted to CSS frosted glass** (`backdrop-filter`). Tasks 1–8 below are kept as a record; the final code retired the WebGL machinery. See the PR description.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trial the real WebGL liquidGL "liquid glass" aesthetic on the internal admin portal (`apps/admin/`), behind a toggle, so the owner can decide whether to roll it out app-wide.

**Architecture:** Vendor the real `liquidGL.js` + `html2canvas` (pinned commit) into `apps/admin/public/vendor/`, lazy-loaded only when enabled. All integration lives under `apps/admin/src/liquidglass/` (a context provider, a route-aware hook, a non-fixed animated backdrop, and pure helpers), keeping the third-party imperative API isolated behind a thin adapter. The chrome (sidebar + a new topbar) and the Dashboard cards become `.liquidGL` panes refracting the backdrop.

**Tech Stack:** React 19.2 + react-router-dom + Tailwind (shadcn HSL tokens) + Vite (admin root, base `/admin/`) + Vitest/jsdom. liquidGL (vanilla JS global) + html2canvas.

## Global Constraints

- **Library is the real WebGL liquidGL**, MIT (README grant). Vendor from pinned commit `dbb6e54eec72994407d5fb7a6e0b7790af30cb92`, **not** `main`. Vendored source stays **unmodified** (all dedup logic lives in our wrapper).
- **liquidGL public API is only:** `window.liquidGL(options)`, `window.liquidGL.registerDynamic(selector)`, `window.liquidGL.syncWith(...)`. There is **no** `destroy`/`refresh`/`removeLens`. "Refresh" = the renderer's `captureSnapshot()`. Disable/toggle-OFF = `window.location.reload()`.
- **html2canvas excludes `position:fixed` elements from the snapshot.** Refracted elements (the backdrop) must be **non-fixed**; lens panes must not sit in their own stacking context (no `position:fixed`/`transform` on the lens element itself).
- **The shared canvas is `pointer-events:none`, appended to `body`.** Clicks pass through — no interaction handling needed at layout level. On each lens, the library overwrites `backdrop-filter`/`background-image` to `none` and sets `pointer-events:none`; CSS on a `.liquidGL` element styles only the glass-OFF fallback + geometry.
- **Injected script `src` must be `import.meta.env.BASE_URL + 'vendor/…'`** (resolves under `/admin/` in prod; a leading-slash `/vendor/…` would 404).
- **Default ON; static backdrop by default** (animation is opt-in — `@keyframes` is the html2canvas perf cliff); **dark mode only when glass is ON**.
- **Admin tests use RELATIVE imports** (vitest's `@` alias points at `apps/crm/src`, not admin). Test env is jsdom; place tests under `apps/admin/src/liquidglass/__tests__/*.test.ts`.
- **CI gates that must stay green:** `npm run build:admin` (tsc + vite), `npm run lint` (eslint), `npm run format:check` (prettier, ts/tsx only). `apps/admin` is excluded from the coverage ratchet.

---

### Task 1: Vendor the library + dependency, types, and eslint ignore

**Files:**
- Create: `apps/admin/public/vendor/liquidGL.js` (downloaded, pinned SHA)
- Create: `apps/admin/public/vendor/html2canvas.min.js` (downloaded, pinned SHA)
- Create: `apps/admin/public/vendor/LICENSE-liquidGL.txt`
- Create: `apps/admin/src/liquidglass/liquidgl.d.ts`
- Modify: `eslint.config.js:7` (add `apps/admin/public/` to `ignores`)

**Interfaces:**
- Produces: `window.liquidGL` / `window.html2canvas` ambient types (see `liquidgl.d.ts` below); vendored assets served by Vite at `${BASE_URL}vendor/*`.

- [ ] **Step 1: Download the vendored library + dependency at the pinned commit**

Run:
```bash
SHA=dbb6e54eec72994407d5fb7a6e0b7790af30cb92
mkdir -p apps/admin/public/vendor
curl -fsSL "https://raw.githubusercontent.com/naughtyduk/liquidGL/$SHA/scripts/liquidGL.js" -o apps/admin/public/vendor/liquidGL.js
curl -fsSL "https://raw.githubusercontent.com/naughtyduk/liquidGL/$SHA/scripts/html2canvas.min.js" -o apps/admin/public/vendor/html2canvas.min.js
ls -l apps/admin/public/vendor/
```
Expected: `liquidGL.js` (~67 KB) and `html2canvas.min.js` (~199 KB) present.

- [ ] **Step 2: Save the license notice**

Create `apps/admin/public/vendor/LICENSE-liquidGL.txt`:
```text
liquidGL — MIT © NaughtyDuk
Source: https://github.com/naughtyduk/liquidGL
Pinned commit: dbb6e54eec72994407d5fb7a6e0b7790af30cb92
The README states: "liquidGL is free to use for both non-commercial and
commercial purposes." Released under the MIT License.

Bundled dependency: html2canvas — MIT © Niklas von Hertzen
https://github.com/niklasvh/html2canvas
```

- [ ] **Step 3: Add ambient TypeScript declarations**

Create `apps/admin/src/liquidglass/liquidgl.d.ts`:
```ts
export {};

interface LiquidGLOptions {
  snapshot?: string | HTMLElement;
  target?: string;
  resolution?: number;
  refraction?: number;
  bevelDepth?: number;
  bevelWidth?: number;
  frost?: number;
  shadow?: boolean;
  specular?: boolean;
  reveal?: string;
  tilt?: boolean;
  tiltFactor?: number;
  magnify?: number;
  on?: { init?: (instance: unknown) => void };
}

interface LiquidGLStatic {
  (options: LiquidGLOptions): unknown;
  registerDynamic: (selector: string | HTMLElement) => void;
  syncWith?: (scroller: unknown) => void;
}

declare global {
  interface Window {
    liquidGL?: LiquidGLStatic;
    html2canvas?: unknown;
  }
}
```

- [ ] **Step 4: Ignore the vendored JS in eslint**

Modify `eslint.config.js` line 7 — change:
```js
  { ignores: ["dist/", "node_modules/", "supabase/functions/"] },
```
to:
```js
  { ignores: ["dist/", "node_modules/", "supabase/functions/", "apps/admin/public/"] },
```

- [ ] **Step 5: Verify lint + typecheck stay green**

Run:
```bash
npm run lint && npm run build:admin
```
Expected: both succeed. (Lint must NOT report `no-undef` from the vendored JS; build must compile with the new `.d.ts`.)

- [ ] **Step 6: Commit**

```bash
git add apps/admin/public/vendor apps/admin/src/liquidglass/liquidgl.d.ts eslint.config.js
git commit -m "feat(admin): vendor liquidGL + html2canvas (pinned) with eslint ignore + types"
```

---

### Task 2: `loadVendorScripts` — memoized, ordered, idempotent loader

**Files:**
- Create: `apps/admin/src/liquidglass/loadVendorScripts.ts`
- Test: `apps/admin/src/liquidglass/__tests__/loadVendorScripts.test.ts`

**Interfaces:**
- Produces: `loadVendorScripts(): Promise<void>` (resolves once both globals exist) and `__resetVendorScriptsCache(): void` (test-only).

- [ ] **Step 1: Write the failing test**

Create `apps/admin/src/liquidglass/__tests__/loadVendorScripts.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { loadVendorScripts, __resetVendorScriptsCache } from '../loadVendorScripts';

const flush = () => new Promise((r) => setTimeout(r, 0));

function fireLoad(id: string) {
  const el = document.getElementById(id) as HTMLScriptElement;
  el.dataset.loaded = 'true';
  el.dispatchEvent(new Event('load'));
}

describe('loadVendorScripts', () => {
  beforeEach(() => {
    __resetVendorScriptsCache();
    document.head.innerHTML = '';
    delete (window as unknown as Record<string, unknown>).html2canvas;
    delete (window as unknown as Record<string, unknown>).liquidGL;
  });

  it('injects html2canvas first, then liquidGL, resolving when both globals exist', async () => {
    (window as unknown as Record<string, unknown>).html2canvas = () => {};
    (window as unknown as Record<string, unknown>).liquidGL = Object.assign(() => {}, {
      registerDynamic() {},
    });
    const p = loadVendorScripts();
    expect(document.getElementById('lgl-html2canvas')).toBeTruthy();
    fireLoad('lgl-html2canvas');
    await flush();
    expect(document.getElementById('lgl-liquidgl')).toBeTruthy();
    fireLoad('lgl-liquidgl');
    await expect(p).resolves.toBeUndefined();
  });

  it('memoizes: repeat calls return the same promise and inject once', () => {
    (window as unknown as Record<string, unknown>).html2canvas = () => {};
    (window as unknown as Record<string, unknown>).liquidGL = Object.assign(() => {}, {
      registerDynamic() {},
    });
    const p1 = loadVendorScripts();
    const p2 = loadVendorScripts();
    expect(p1).toBe(p2);
    expect(document.querySelectorAll('#lgl-html2canvas').length).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run apps/admin/src/liquidglass/__tests__/loadVendorScripts.test.ts`
Expected: FAIL — `Cannot find module '../loadVendorScripts'`.

- [ ] **Step 3: Implement the loader**

Create `apps/admin/src/liquidglass/loadVendorScripts.ts`:
```ts
const H2C_ID = 'lgl-html2canvas';
const LGL_ID = 'lgl-liquidgl';

let cached: Promise<void> | null = null;

function injectScript(id: string, src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.getElementById(id) as HTMLScriptElement | null;
    if (existing) {
      if (existing.dataset.loaded === 'true') {
        resolve();
        return;
      }
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error(`failed to load ${id}`)));
      return;
    }
    const el = document.createElement('script');
    el.id = id;
    el.src = src;
    el.async = false; // preserve order: html2canvas must define its global before liquidGL
    el.addEventListener('load', () => {
      el.dataset.loaded = 'true';
      resolve();
    });
    el.addEventListener('error', () => reject(new Error(`failed to load ${id}`)));
    document.head.appendChild(el);
  });
}

export function loadVendorScripts(): Promise<void> {
  if (cached) return cached;
  const base = import.meta.env.BASE_URL; // '/admin/' in prod, '/' in dev
  cached = injectScript(H2C_ID, `${base}vendor/html2canvas.min.js`)
    .then(() => injectScript(LGL_ID, `${base}vendor/liquidGL.js`))
    .then(() => {
      if (typeof window.html2canvas === 'undefined' || typeof window.liquidGL === 'undefined') {
        throw new Error('liquidGL globals missing after load');
      }
    });
  return cached;
}

/** Test-only: clear the module-level memo between tests. */
export function __resetVendorScriptsCache(): void {
  cached = null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run apps/admin/src/liquidglass/__tests__/loadVendorScripts.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/admin/src/liquidglass/loadVendorScripts.ts apps/admin/src/liquidglass/__tests__/loadVendorScripts.test.ts
git commit -m "feat(admin): memoized ordered loader for liquidGL vendor scripts"
```

---

### Task 3: Enabled-state storage helpers + `LiquidGlassProvider`

**Files:**
- Create: `apps/admin/src/liquidglass/storage.ts`
- Create: `apps/admin/src/liquidglass/LiquidGlassProvider.tsx`
- Test: `apps/admin/src/liquidglass/__tests__/storage.test.ts`

**Interfaces:**
- Consumes: `loadVendorScripts` (Task 2).
- Produces: `readEnabled(storage)`, `writeEnabled(storage, value)`, `LIQUID_GLASS_STORAGE_KEY`; `<LiquidGlassProvider>` and `useLiquidGlassContext(): { enabled: boolean; ready: boolean; toggle: () => void }`.

- [ ] **Step 1: Write the failing test for storage helpers**

Create `apps/admin/src/liquidglass/__tests__/storage.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { readEnabled, writeEnabled, LIQUID_GLASS_STORAGE_KEY } from '../storage';

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    _map: map,
  };
}

describe('liquid glass storage', () => {
  it('defaults to enabled when nothing is stored', () => {
    expect(readEnabled(fakeStorage())).toBe(true);
  });

  it('reads a stored false as disabled', () => {
    expect(readEnabled(fakeStorage({ [LIQUID_GLASS_STORAGE_KEY]: 'false' }))).toBe(false);
  });

  it('persists the boolean as a string', () => {
    const s = fakeStorage();
    writeEnabled(s, false);
    expect(s._map.get(LIQUID_GLASS_STORAGE_KEY)).toBe('false');
    writeEnabled(s, true);
    expect(s._map.get(LIQUID_GLASS_STORAGE_KEY)).toBe('true');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run apps/admin/src/liquidglass/__tests__/storage.test.ts`
Expected: FAIL — `Cannot find module '../storage'`.

- [ ] **Step 3: Implement the storage helpers**

Create `apps/admin/src/liquidglass/storage.ts`:
```ts
export const LIQUID_GLASS_STORAGE_KEY = 'admin-liquid-glass';

export function readEnabled(storage: Pick<Storage, 'getItem'>): boolean {
  const v = storage.getItem(LIQUID_GLASS_STORAGE_KEY);
  if (v === null) return true; // default ON
  return v !== 'false';
}

export function writeEnabled(storage: Pick<Storage, 'setItem'>, value: boolean): void {
  storage.setItem(LIQUID_GLASS_STORAGE_KEY, value ? 'true' : 'false');
}
```

- [ ] **Step 4: Run the storage tests to verify they pass**

Run: `npx vitest run apps/admin/src/liquidglass/__tests__/storage.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Implement the provider**

Create `apps/admin/src/liquidglass/LiquidGlassProvider.tsx`:
```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { readEnabled, writeEnabled } from './storage';
import { loadVendorScripts } from './loadVendorScripts';

interface LiquidGlassContextValue {
  enabled: boolean;
  ready: boolean; // vendor scripts loaded
  toggle: () => void;
}

const LiquidGlassContext = createContext<LiquidGlassContextValue | null>(null);

export function LiquidGlassProvider({ children }: { children: ReactNode }) {
  // Fixed for the session: toggling reloads the page (the library has no teardown).
  const [enabled] = useState(() => readEnabled(window.localStorage));
  const [ready, setReady] = useState(false);

  // Expose the on/off state to CSS (glass-off fallback + dark-only-when-on).
  useEffect(() => {
    document.documentElement.dataset.liquidGlass = enabled ? 'on' : 'off';
  }, [enabled]);

  // Lazy-load vendor scripts only when enabled (zero cost before first activation).
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    loadVendorScripts()
      .then(() => {
        if (active) setReady(true);
      })
      .catch((err) => console.error('[liquidGL] vendor load failed', err));
    return () => {
      active = false;
    };
  }, [enabled]);

  const toggle = () => {
    writeEnabled(window.localStorage, !enabled);
    window.location.reload(); // only way to reclaim the WebGL context / stop the rAF loop
  };

  return (
    <LiquidGlassContext.Provider value={{ enabled, ready, toggle }}>
      {children}
    </LiquidGlassContext.Provider>
  );
}

export function useLiquidGlassContext(): LiquidGlassContextValue {
  const ctx = useContext(LiquidGlassContext);
  if (!ctx) throw new Error('useLiquidGlassContext must be used within <LiquidGlassProvider>');
  return ctx;
}
```

- [ ] **Step 6: Verify build + tests**

Run: `npm run build:admin && npx vitest run apps/admin/src/liquidglass/__tests__/storage.test.ts`
Expected: build passes; storage tests PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/liquidglass/storage.ts apps/admin/src/liquidglass/LiquidGlassProvider.tsx apps/admin/src/liquidglass/__tests__/storage.test.ts
git commit -m "feat(admin): liquid glass enabled-state storage + provider"
```

---

### Task 4: Pure integration helpers — dedupe, double-rAF, options, adapter

**Files:**
- Create: `apps/admin/src/liquidglass/dedupe.ts`
- Create: `apps/admin/src/liquidglass/scheduleRefresh.ts`
- Create: `apps/admin/src/liquidglass/options.ts`
- Create: `apps/admin/src/liquidglass/liquidGLAdapter.ts`
- Test: `apps/admin/src/liquidglass/__tests__/dedupe.test.ts`
- Test: `apps/admin/src/liquidglass/__tests__/scheduleRefresh.test.ts`

**Interfaces:**
- Produces: `stripBoundAndTagNew(root: ParentNode): number`; `doubleRaf(cb, raf?)`; `LIQUID_GL_OPTIONS`; adapter `initLiquidGL()`, `registerDynamic(selector)`, `refreshLiquidGL()`.

- [ ] **Step 1: Write the failing tests**

Create `apps/admin/src/liquidglass/__tests__/dedupe.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { stripBoundAndTagNew } from '../dedupe';

describe('stripBoundAndTagNew', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('tags all unbound panes on first pass and reports them as fresh', () => {
    document.body.innerHTML = `<div class="liquidGL" id="a"></div><div class="liquidGL" id="b"></div>`;
    expect(stripBoundAndTagNew(document)).toBe(2);
    expect(document.getElementById('a')!.dataset.lglBound).toBe('true');
    expect(document.getElementById('a')!.classList.contains('liquidGL')).toBe(true);
  });

  it('on a later pass strips already-bound panes and tags only new ones', () => {
    document.body.innerHTML = `<div class="liquidGL" id="chrome"></div>`;
    stripBoundAndTagNew(document); // bind chrome
    // a new route mounts a fresh tile:
    document.body.insertAdjacentHTML('beforeend', `<div class="liquidGL" id="tile"></div>`);
    const fresh = stripBoundAndTagNew(document);
    expect(fresh).toBe(1);
    // chrome had its class stripped so a re-scan won't re-bind it:
    expect(document.getElementById('chrome')!.classList.contains('liquidGL')).toBe(false);
    // the new tile keeps the class so the re-scan binds it:
    expect(document.getElementById('tile')!.classList.contains('liquidGL')).toBe(true);
    expect(document.getElementById('tile')!.dataset.lglBound).toBe('true');
  });
});
```

Create `apps/admin/src/liquidglass/__tests__/scheduleRefresh.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { doubleRaf } from '../scheduleRefresh';

describe('doubleRaf', () => {
  it('invokes the callback after two animation frames', () => {
    const calls: string[] = [];
    const fakeRaf = (cb: FrameRequestCallback) => {
      calls.push('raf');
      cb(0);
      return 0;
    };
    let ran = false;
    doubleRaf(() => {
      ran = true;
    }, fakeRaf);
    expect(calls.length).toBe(2);
    expect(ran).toBe(true);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run apps/admin/src/liquidglass/__tests__/dedupe.test.ts apps/admin/src/liquidglass/__tests__/scheduleRefresh.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement dedupe + scheduleRefresh**

Create `apps/admin/src/liquidglass/dedupe.ts`:
```ts
/**
 * Tag-and-skip dedup for liquidGL's class-based target scan (the library has no
 * removeLens and `liquidGL()` re-scans `.liquidGL` with no dedup).
 * - Unbound panes: mark `data-lgl-bound` and KEEP the class so the next
 *   `liquidGL()` scan binds them. Counted as "fresh".
 * - Already-bound panes: REMOVE the `.liquidGL` class so the next scan ignores
 *   them (their existing lens keeps the element reference and is unaffected).
 * Returns the number of fresh panes found.
 */
export function stripBoundAndTagNew(root: ParentNode): number {
  const panes = root.querySelectorAll<HTMLElement>('.liquidGL');
  let fresh = 0;
  panes.forEach((el) => {
    if (el.dataset.lglBound === 'true') {
      el.classList.remove('liquidGL');
    } else {
      el.dataset.lglBound = 'true';
      fresh += 1;
    }
  });
  return fresh;
}
```

Create `apps/admin/src/liquidglass/scheduleRefresh.ts`:
```ts
/** Run `cb` after two animation frames (lets a route's new content paint first). */
export function doubleRaf(
  cb: () => void,
  raf: (cb: FrameRequestCallback) => number = requestAnimationFrame,
): void {
  raf(() => raf(() => cb()));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run apps/admin/src/liquidglass/__tests__/dedupe.test.ts apps/admin/src/liquidglass/__tests__/scheduleRefresh.test.ts`
Expected: PASS (3 tests total).

- [ ] **Step 5: Define tuned options**

Create `apps/admin/src/liquidglass/options.ts`:
```ts
/** Tuned for a dark backdrop; resolution kept modest for perf. */
export const LIQUID_GL_OPTIONS = {
  snapshot: '#admin-snapshot', // wrapper that includes backdrop + content, excludes the canvas
  target: '.liquidGL',
  resolution: 1.2,
  refraction: 0.012,
  bevelDepth: 0.08,
  bevelWidth: 0.15,
  frost: 0.04,
  shadow: true,
  specular: true,
  reveal: 'fade',
  tilt: true,
  tiltFactor: 4,
  magnify: 1.05,
} as const;
```
- [ ] **Step 6: Implement the adapter (CONFIRM internal method against the vendored source)**

First inspect the source to confirm how to reach `captureSnapshot()` and what `liquidGL()` returns:
```bash
grep -nE "captureSnapshot|return (this|renderer|instance)|class |_capturing|registerDynamic" apps/admin/public/vendor/liquidGL.js | head -40
```
Then create `apps/admin/src/liquidglass/liquidGLAdapter.ts`:
```ts
import { LIQUID_GL_OPTIONS } from './options';

let instance: unknown = null;

export function initLiquidGL(): void {
  if (!window.liquidGL) return;
  instance = window.liquidGL(LIQUID_GL_OPTIONS);
}

export function registerDynamic(selector: string): void {
  window.liquidGL?.registerDynamic?.(selector);
}

/**
 * Re-rasters the page snapshot. CONFIRM the exact path from the grep in Step 6:
 * the review found the renderer exposes `captureSnapshot()`. It is reached here
 * via the returned instance or its `.renderer`. Adjust this body to match the
 * real source if neither path is correct.
 */
export function refreshLiquidGL(): void {
  const handle = instance as
    | { captureSnapshot?: () => void; renderer?: { captureSnapshot?: () => void } }
    | null;
  if (handle?.captureSnapshot) handle.captureSnapshot();
  else handle?.renderer?.captureSnapshot?.();
}
```

- [ ] **Step 7: Verify build + tests**

Run: `npm run build:admin && npx vitest run apps/admin/src/liquidglass/__tests__/`
Expected: build passes; all liquidglass tests PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/admin/src/liquidglass/dedupe.ts apps/admin/src/liquidglass/scheduleRefresh.ts apps/admin/src/liquidglass/options.ts apps/admin/src/liquidglass/liquidGLAdapter.ts apps/admin/src/liquidglass/__tests__/dedupe.test.ts apps/admin/src/liquidglass/__tests__/scheduleRefresh.test.ts
git commit -m "feat(admin): liquidGL integration helpers (dedupe, double-rAF, adapter, options)"
```

---

### Task 5: `useLiquidGlass` hook (init + route-aware refresh)

**Files:**
- Create: `apps/admin/src/liquidglass/useLiquidGlass.ts`

**Interfaces:**
- Consumes: `useLiquidGlassContext` (Task 3), `stripBoundAndTagNew` + `doubleRaf` (Task 4), adapter `initLiquidGL`/`refreshLiquidGL` (Task 4), `useLocation` (react-router-dom).
- Produces: `useLiquidGlass(): void` — call once inside `AdminLayout`.

- [ ] **Step 1: Implement the hook**

Create `apps/admin/src/liquidglass/useLiquidGlass.ts`:
```ts
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useLiquidGlassContext } from './LiquidGlassProvider';
import { stripBoundAndTagNew } from './dedupe';
import { doubleRaf } from './scheduleRefresh';
import { initLiquidGL, refreshLiquidGL } from './liquidGLAdapter';

// Module-level so React 19 StrictMode's dev double-invoke can't double-initialize.
let didInit = false;

export function useLiquidGlass(): void {
  const { enabled, ready } = useLiquidGlassContext();
  const location = useLocation();

  // One-time init after vendor scripts are ready.
  useEffect(() => {
    if (!enabled || !ready || didInit) return;
    didInit = true;
    doubleRaf(() => {
      stripBoundAndTagNew(document); // tag every initial pane as bound
      initLiquidGL(); // scan binds them all
    });
  }, [enabled, ready]);

  // Route change: bind any newly-mounted tiles (deduped) and re-snapshot.
  useEffect(() => {
    if (!enabled || !ready || !didInit) return;
    doubleRaf(() => {
      const fresh = stripBoundAndTagNew(document); // strip chrome, tag new tiles
      if (fresh > 0) initLiquidGL(); // re-scan binds only the new tiles
      refreshLiquidGL(); // re-raster the snapshot for the new page
    });
  }, [location.pathname, enabled, ready]);
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build:admin`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/admin/src/liquidglass/useLiquidGlass.ts
git commit -m "feat(admin): useLiquidGlass hook (idempotent init + route-aware refresh)"
```

> **Note for the integrator (Task 7):** `initLiquidGL()` re-binding new tiles assumes `window.liquidGL()` reuses a singleton renderer and appends to its lens list (matches the review's finding: `this.lenses` is push-only, no dedup). Confirm during Task 7 with the grep from Task 4 Step 6. **If `liquidGL()` instead creates a NEW renderer/canvas per call**, do not re-init on route change — fall back to a single init (chrome + whatever is mounted on first load); Dashboard tiles then glassify only when the Dashboard is the first page loaded. Note this in the PR.

---

### Task 6: `LiquidBackdrop` + `glass.css`

**Files:**
- Create: `apps/admin/src/liquidglass/LiquidBackdrop.tsx`
- Create: `apps/admin/src/liquidglass/glass.css`

**Interfaces:**
- Produces: `<LiquidBackdrop />` (a non-fixed, in-flow backdrop element) and the `glass.css` rules (`.liquid-backdrop`, `.liquidGL` geometry, glass-off fallback, motion gating).

- [ ] **Step 1: Implement the backdrop component**

Create `apps/admin/src/liquidglass/LiquidBackdrop.tsx`:
```tsx
/**
 * Non-fixed (absolute) brand-colored mesh-gradient backdrop. It MUST NOT be
 * position:fixed — liquidGL's html2canvas excludes fixed elements from the
 * snapshot, so a fixed backdrop would refract nothing. Static by default;
 * motion is opt-in via `data-liquid-anim="on"` on <html> and respects
 * prefers-reduced-motion (see glass.css).
 */
export function LiquidBackdrop() {
  return <div className="liquid-backdrop" aria-hidden="true" />;
}
```

- [ ] **Step 2: Implement glass.css**

Create `apps/admin/src/liquidglass/glass.css`:
```css
/* ── Liquid glass trial (admin) ─────────────────────────────────────────── */

/* Non-fixed backdrop: the thing liquidGL refracts. Sits behind all content. */
.liquid-backdrop {
  position: absolute;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background-color: #0a0c0f;
  background-image:
    radial-gradient(42rem 42rem at 12% 18%, rgba(234, 179, 8, 0.30), transparent 60%),
    radial-gradient(38rem 38rem at 85% 22%, rgba(57, 132, 255, 0.28), transparent 60%),
    radial-gradient(40rem 40rem at 75% 88%, rgba(245, 66, 200, 0.22), transparent 60%),
    radial-gradient(36rem 36rem at 22% 82%, rgba(106, 201, 208, 0.22), transparent 60%);
  background-repeat: no-repeat;
}

/* Animation is OFF by default (CSS @keyframes is html2canvas's perf cliff).
   Opt in by setting data-liquid-anim="on" on <html>, and only when the user
   has not asked to reduce motion. */
@media (prefers-reduced-motion: no-preference) {
  html[data-liquid-anim='on'] .liquid-backdrop {
    animation: liquid-drift 36s ease-in-out infinite alternate;
  }
}

@keyframes liquid-drift {
  0% { background-position: 0 0, 0 0, 0 0, 0 0; }
  100% { background-position: 3% 4%, -3% 2%, 2% -3%, -2% -2%; }
}

/* Content must sit ABOVE the backdrop. The snapshot wrapper is the stacking root. */
#admin-snapshot { position: relative; }
#admin-snapshot > .liquid-content { position: relative; z-index: 1; }

/* Geometry only — the WebGL render provides the actual glass fill when ON.
   liquidGL overwrites background-image/backdrop-filter to none and sets
   pointer-events:none on each lens, so do NOT rely on CSS for the ON look. */
.liquidGL { border-radius: 1rem; }

/* Glass-OFF fallback: existing Tailwind classes already render solid cards/
   chrome, so panes look normal when the toggle is off. Nothing needed here
   beyond keeping geometry. (Hook for future tweaks:) */
html[data-liquid-glass='off'] .liquid-backdrop { display: none; }
```

- [ ] **Step 3: Verify build**

Run: `npm run build:admin`
Expected: PASS (CSS imported in Task 7; this step just confirms TS/JSX compiles).

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/liquidglass/LiquidBackdrop.tsx apps/admin/src/liquidglass/glass.css
git commit -m "feat(admin): non-fixed liquid backdrop + glass.css (static default, motion gated)"
```

---

### Task 7: Wire the chrome — provider in `main.tsx` + `AdminLayout` (backdrop, topbar, sidebar lens, toggle)

**Files:**
- Modify: `apps/admin/src/main.tsx`
- Modify: `apps/admin/src/layouts/AdminLayout.tsx`

**Interfaces:**
- Consumes: `<LiquidGlassProvider>`, `useLiquidGlassContext` (Task 3); `useLiquidGlass` (Task 5); `<LiquidBackdrop>` + `glass.css` (Task 6).

- [ ] **Step 1: Confirm the singleton-renderer assumption (gates Task 5's route re-init)**

Run: `grep -nE "captureSnapshot|new LiquidGL|return new|class LiquidGL|window.liquidGL *=|let .*renderer|const .*renderer" apps/admin/public/vendor/liquidGL.js | head -40`
Confirm `liquidGL()` reuses a shared renderer (re-init adds lenses to it). If it creates a new renderer per call, apply the fallback from Task 5's note (single init, no route re-init).

- [ ] **Step 2: Wrap the app in the provider**

Modify `apps/admin/src/main.tsx` — add the import and wrap `<RouterProvider>`:
```tsx
import { LiquidGlassProvider } from './liquidglass/LiquidGlassProvider';
import './liquidglass/glass.css';
```
Change the render tree so the provider wraps the router (keep the existing providers):
```tsx
    <QueryClientProvider client={queryClient}>
      <AdminAuthProvider>
        <LiquidGlassProvider>
          <Toaster />
          <RouterProvider router={router} />
          <Analytics />
        </LiquidGlassProvider>
      </AdminAuthProvider>
    </QueryClientProvider>
```

- [ ] **Step 3: Add the snapshot wrapper, backdrop, topbar, hook, and toggle to AdminLayout**

Modify `apps/admin/src/layouts/AdminLayout.tsx`:

(a) Add imports at the top:
```tsx
import { LiquidBackdrop } from '../liquidglass/LiquidBackdrop';
import { useLiquidGlass } from '../liquidglass/useLiquidGlass';
import { useLiquidGlassContext } from '../liquidglass/LiquidGlassProvider';
import { Sparkles } from 'lucide-react';
import { useLocation } from 'react-router-dom';
```

(b) Inside the component body, before `return`:
```tsx
  useLiquidGlass();
  const { enabled: glassEnabled, toggle: toggleGlass } = useLiquidGlassContext();
  const location = useLocation();
  const pageTitle =
    NAV_ITEMS.find((i) => (i.to === '/admin' ? location.pathname === '/admin' : location.pathname.startsWith(i.to)))
      ?.label ?? 'Admin';
```

(c) Replace the outer wrapper `<div className="flex min-h-screen">` with a relative snapshot wrapper containing the backdrop and a content layer. The backdrop is non-fixed; everything else goes inside `.liquid-content`:
```tsx
  return (
    <div id="admin-snapshot" className="relative min-h-screen">
      <LiquidBackdrop />
      <div className="liquid-content flex min-h-screen">
        {/* ...existing hamburger, backdrop overlay, <aside>, <main>... */}
      </div>
    </div>
  );
```

(d) Sidebar lens (C1): the `<aside>` keeps fixed positioning but must NOT be the lens itself (fixed + z + transform = its own stacking context). On desktop, drop the `md:translate-x-0` transform and add a non-transformed inner `.liquidGL` lens that holds the sidebar content. Change the `<aside>` className from:
```tsx
        className={`w-[220px] bg-[#12151a] border-r border-[#1e2430] flex flex-col fixed inset-y-0 left-0 z-50 transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}
```
to (mobile still uses transform to slide; desktop uses `md:left-0` with no transform, and only the desktop lens gets `.liquidGL`):
```tsx
        className={`w-[220px] border-r border-[#1e2430] flex flex-col fixed inset-y-0 left-0 z-50 transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0`}
```
and wrap the existing sidebar children (logo block + `<nav>` + footer) in an inner lens div that carries the dark fill and, on desktop, the `.liquidGL` class:
```tsx
        <div className="liquidGL md:[&]:bg-transparent bg-[#12151a] flex flex-col flex-1 min-h-0">
          {/* existing logo header, <nav>, and footer block unchanged */}
        </div>
```
> The `.liquidGL` lens is a non-fixed inner child. **Verify in Step 5 that it actually refracts**; if the fixed `<aside>` ancestor still traps it (no magnification visible), apply the fallback in Step 6.

(e) Add a sticky glass topbar at the top of `<main>` (page title only — no theme toggle), and keep the existing `<main>` content:
```tsx
      <main className="md:ml-[220px] flex-1 min-h-screen">
        <div className="liquidGL sticky top-0 z-30 mx-4 mt-4 md:mx-8 md:mt-6 rounded-2xl py-3 pl-14 pr-5 md:px-5 flex items-center">
          <h1 className="text-sm font-medium tracking-wide text-foreground">{pageTitle}</h1>
        </div>
        <div className="p-4 pt-6 md:p-8">
          <Outlet />
        </div>
      </main>
```
(Remove the old `pt-16` padding from `<main>` since the hamburger now overlaps the topbar area; keep the mobile hamburger button as-is.)

(f) Add the "Liquid Glass" toggle in the sidebar footer, next to the theme toggle (inside the footer `div`, after the theme button):
```tsx
            <button
              onClick={toggleGlass}
              className={`p-1.5 rounded-lg transition-colors ${glassEnabled ? 'text-[#eab308]' : 'text-[#9ca3af]'} hover:bg-[#1e2430]`}
              title={glassEnabled ? 'Liquid Glass: ON (click to disable — reloads)' : 'Liquid Glass: OFF (click to enable — reloads)'}
            >
              <Sparkles size={14} />
            </button>
```

(g) Enforce dark-only while glass is ON (light-mode glass looks muddy — spec decision). Add an effect after the existing theme effect:
```tsx
  // The trial is tuned for dark; force dark while glass is on.
  useEffect(() => {
    if (glassEnabled) setTheme('dark');
  }, [glassEnabled]);
```
and render the existing light/dark theme toggle only when glass is OFF — wrap that existing footer button in:
```tsx
            {!glassEnabled && (
              <button
                onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
                className="p-1.5 rounded-lg text-[#9ca3af] hover:text-[#eab308] hover:bg-[#1e2430] transition-colors"
                title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
              >
                {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
              </button>
            )}
```

- [ ] **Step 4: Verify build + lint + format**

Run: `npm run build:admin && npm run lint && npm run format:check`
Expected: all pass. (If `format:check` flags the modified files, run `npm run format` and re-commit.)

- [ ] **Step 5: Manual acceptance (dev)**

Run: `npm run dev:admin`, log in, and verify:
- The sidebar and topbar show **real lens magnification/distortion** of the colorful backdrop (not just translucency). 
- Nav links, the theme toggle, the sign-out link, and the Liquid Glass toggle all **click normally** (canvas is pointer-events:none).
- Navigating between pages (Dashboard ↔ Workspaces ↔ Plans) keeps the chrome glass intact with **no duplicate/darkening lenses** building up.
- Clicking the Liquid Glass toggle **reloads** to a clean non-glass admin (solid chrome); toggling back restores glass.

- [ ] **Step 6: If the sidebar lens does not refract — documented fallback**

If Step 5 shows the sidebar as broken/non-refracting (fixed-ancestor stacking trap), remove `.liquidGL` from the sidebar inner lens (keep the solid `bg-[#12151a]`) and keep glass on the **topbar + Dashboard cards** only. This is still a valid trial. Note the limitation in the PR description.

- [ ] **Step 7: Commit**

```bash
git add apps/admin/src/main.tsx apps/admin/src/layouts/AdminLayout.tsx
git commit -m "feat(admin): liquid glass chrome — backdrop, glass topbar + sidebar lens, toggle"
```

---

### Task 8: Dashboard showcase + full verification

**Files:**
- Modify: `apps/admin/src/pages/DashboardPage.tsx`

**Interfaces:**
- Consumes: `.liquidGL` class + `glass.css` geometry (Tasks 4–6), the running chrome (Task 7).

- [ ] **Step 1: Glassify the KPI cards and the Recent Workspaces panel**

Modify `apps/admin/src/pages/DashboardPage.tsx`:

(a) KPI card (line 40) — add `liquidGL` to the className:
```tsx
          <div key={kpi.label} className="liquidGL bg-card border border-border rounded-2xl p-5">
```

(b) Recent Workspaces panel (line 49) — add `liquidGL`:
```tsx
      <div className="liquidGL bg-card border border-border rounded-2xl p-5">
```
(Leave the inner table rows untouched — only the outer panel is a lens.)

- [ ] **Step 2: Verify build + lint + format + tests**

Run: `npm run build:admin && npm run lint && npm run format:check && npx vitest run apps/admin/src/liquidglass/__tests__/`
Expected: all pass.

- [ ] **Step 3: Production-mode verification (the `/admin/` base path)**

Run:
```bash
npm run build:admin
npx vite preview --config apps/admin/vite.config.ts --outDir ../../dist/admin
```
Open the previewed admin URL and confirm the vendored scripts load from `/admin/vendor/...` (Network tab: 200, not 404) and the effect renders. (This is the path that would break if the `src` were a leading-slash `/vendor/...`.)

- [ ] **Step 4: Manual acceptance (dashboard)**

With `npm run dev:admin`: on the Dashboard, the 4 KPI cards and the Recent Workspaces panel render as floating glass tiles with hover-tilt; navigating away and back keeps them correct (or, per Task 5's fallback note, are glassy on first load).

- [ ] **Step 5: Final full-suite check**

Run: `npm run build:admin && npm run lint && npm run format:check && npm run test`
Expected: all pass. (`npm run test` runs the whole vitest suite — confirms no regressions.)

- [ ] **Step 6: Commit**

```bash
git add apps/admin/src/pages/DashboardPage.tsx
git commit -m "feat(admin): glassify Dashboard KPI cards + recent-workspaces panel"
```

---

## Notes on testing posture

This is a visual WebGL trial. The **pure logic** (script loader memoization/ordering, enabled-state storage, tag-and-skip dedup, double-rAF scheduling) is unit-tested (Tasks 2–4). The **rendered effect** (refraction, stacking, pointer pass-through, route refresh, toggle reload) is verified by the manual acceptance + production-preview steps (Tasks 7–8) — there is no meaningful automated test for WebGL output, and `apps/admin` is excluded from the coverage ratchet, so this is by design, not an omission.

## Post-merge

This branch is a self-contained trial. After the owner evaluates it, either (a) keep it behind the toggle, or (b) remove it: delete `apps/admin/src/liquidglass/` + `apps/admin/public/vendor/` and revert the diffs in `main.tsx`, `AdminLayout.tsx`, `DashboardPage.tsx`, and `eslint.config.js`.
