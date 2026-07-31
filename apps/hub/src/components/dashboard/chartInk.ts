import { useEffect, useState } from 'react';

/**
 * Chart series colour, as an `r, g, b` triple.
 *
 * Charts draw into a canvas, so they can't use the `--hub-*` CSS variables the
 * rest of the portal styles itself with — Chart.js needs literal colour values
 * and re-reads them only when the dataset is rebuilt. Deriving them from the
 * resolved theme instead of hardcoding keeps the series neutral in both modes
 * (previously they were a fixed gold that ignored dark mode entirely).
 *
 * Returned as a triple rather than a colour string so callers can build their
 * own `rgba(..., alpha)` ramps and gradients from it.
 */
export function chartInk(theme: 'light' | 'dark'): string {
  return theme === 'dark' ? '245, 245, 245' : '23, 23, 23';
}

/**
 * Chart tick-label font, read live off `:root` at call time.
 *
 * Charts render after HubShell has injected the resolved theme's
 * `<style>:root{ --hub-font-sans: ...; }</style>` tag, so `getComputedStyle` on
 * the document root already reflects any custom body font — no prop threading
 * needed. Falls back to the neutral default stack if the variable is somehow
 * unset (e.g. outside a browser environment).
 */
export function chartFont(): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--hub-font-sans').trim();
  return v || "'Instrument Sans', sans-serif";
}

/**
 * Bumps once the browser has finished loading fonts (`document.fonts.ready`).
 *
 * Chart.js draws tick/axis labels directly onto a `<canvas>` at construction
 * time, using whatever `chartFont()` returns right then. When a workspace's
 * custom font comes from an asynchronously-injected Google Fonts stylesheet
 * (see HubShell's font-link effect), that stylesheet can still be loading
 * when the chart first draws — the canvas falls back to the browser's
 * default font and never repaints on its own once the real font arrives,
 * unlike DOM text which reflows automatically.
 *
 * A chart component calls this hook and passes its return value into
 * whatever forces its `data`/`options` to recompute (e.g. just calling the
 * hook is enough if those objects are already rebuilt on every render); the
 * one-time bump after `document.fonts.ready` resolves triggers exactly the
 * extra render needed to redraw with the settled font. Guards `document.fonts`
 * for environments without the CSS Font Loading API (e.g. jsdom in tests).
 */
export function useFontsReady(): number {
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    const fonts = document.fonts;
    if (!fonts?.ready) return;
    let cancelled = false;
    fonts.ready.then(() => {
      if (!cancelled) setGeneration((g) => g + 1);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return generation;
}
