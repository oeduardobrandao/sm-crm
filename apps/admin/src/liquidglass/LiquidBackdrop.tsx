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
