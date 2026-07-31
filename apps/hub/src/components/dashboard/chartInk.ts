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
