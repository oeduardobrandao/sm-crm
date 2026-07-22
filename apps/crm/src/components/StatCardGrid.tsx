import { Children, type CSSProperties, type ReactNode } from 'react';

interface StatCardGridProps {
  children: ReactNode;
  /** Extra classes for the grid element (e.g. animate-up, analytics-kpi-scroll). */
  className?: string;
  /** Most columns to use on desktop. Fewer cards than this = fewer columns. */
  maxCols?: number;
  style?: CSSProperties;
  /** Anchor id — the client page scroll-spy targets this grid. */
  id?: string;
}

/**
 * Lays KPI cards out as ONE seamless block: no gutters, hairline dividers, and
 * rounded corners only on the outer four corners.
 *
 * Columns follow the card count so a row is never left half-empty, and when the
 * count does not divide evenly the remainder of the last row is padded with
 * filler cells — otherwise the grid's divider colour would show through as a
 * solid slab where the missing cards would be.
 */
export function StatCardGrid({ children, className, maxCols = 5, style, id }: StatCardGridProps) {
  const items = Children.toArray(children).filter(Boolean);
  const cols = Math.min(items.length, maxCols) || 1;
  const fillerCount = (cols - (items.length % cols)) % cols;

  return (
    <div
      id={id}
      className={['kpi-grid', className].filter(Boolean).join(' ')}
      style={{ ...style, '--kpi-cols': cols } as CSSProperties}
    >
      {items}
      {Array.from({ length: fillerCount }, (_, i) => (
        <div key={`kpi-filler-${i}`} className="kpi-card kpi-card--filler" aria-hidden />
      ))}
    </div>
  );
}
