import { LIQUID_GL_OPTIONS } from './options';

/**
 * Source-confirmed: window.liquidGL() returns a liquidGLLens instance (or array),
 * NOT the renderer. The renderer is stored at window.__liquidGLRenderer__ by the
 * library itself. captureSnapshot() lives on the renderer, so refreshLiquidGL()
 * reads it from there. The brief's defensive fallback through the returned instance
 * is kept as a secondary guard, but the primary path is __liquidGLRenderer__.
 */

let _instance: unknown = null;

export function initLiquidGL(): void {
  if (!window.liquidGL) return;
  _instance = window.liquidGL(LIQUID_GL_OPTIONS);
}

export function registerDynamic(selector: string): void {
  window.liquidGL?.registerDynamic?.(selector);
}

/**
 * Re-rasters the page snapshot.
 * Primary path (source-confirmed): window.__liquidGLRenderer__.captureSnapshot()
 * Secondary guard: if instance somehow has it directly or via .renderer
 */
export function refreshLiquidGL(): void {
  // Primary: the renderer is stored globally by the library
  const renderer = (window as Window & { __liquidGLRenderer__?: { captureSnapshot?: () => void } }).__liquidGLRenderer__;
  if (renderer?.captureSnapshot) {
    renderer.captureSnapshot();
    return;
  }
  // Defensive fallback via the returned instance (brief's original approach)
  const handle = _instance as
    | { captureSnapshot?: () => void; renderer?: { captureSnapshot?: () => void } }
    | null;
  if (handle?.captureSnapshot) handle.captureSnapshot();
  else handle?.renderer?.captureSnapshot?.();
}
