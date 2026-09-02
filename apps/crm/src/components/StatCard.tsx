import type { ReactNode } from 'react';
import { TrendingUp, TrendingDown, Minus, type LucideIcon } from 'lucide-react';

export type StatTone = 'green' | 'red' | 'blue' | 'amber' | 'violet' | 'pink' | 'slate';

export interface StatDelta {
  direction: 'up' | 'down' | 'stable';
  /** Percentage change; rendered as an absolute value next to the arrow. */
  percent: number;
  /** Comparison caption, e.g. "vs período anterior". */
  caption?: string;
}

interface StatCardProps {
  label: string;
  value: ReactNode;
  icon?: LucideIcon;
  tone?: StatTone;
  /** Trend row. Only pass this when a real comparison exists. */
  delta?: StatDelta;
  /** Descriptive footer used when there is no comparison to show. */
  sub?: ReactNode;
  /** Extra muted line below the footer (previous value, period chip, …). */
  footNote?: ReactNode;
  /** Overrides the value's colour (used by the finance strips). */
  valueColor?: string;
  /** Shrinks the value — for cards whose value is a name rather than a number. */
  compactValue?: boolean;
  /** Renders the card as a button and fires this on click. */
  onClick?: () => void;
  /** Marks the card as the applied filter (ring). Only meaningful with `onClick`. */
  active?: boolean;
  /** Flips which delta direction reads as "good" (e.g. a falling average time). */
  invertDelta?: boolean;
}

const DIRECTION_ICON = {
  up: TrendingUp,
  down: TrendingDown,
  stable: Minus,
} as const;

/**
 * KPI card: label + tinted icon bubble, a large value, and a footer that is
 * either a trend delta or a plain descriptive line.
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  tone = 'slate',
  delta,
  sub,
  footNote,
  valueColor,
  compactValue,
  onClick,
  active,
  invertDelta,
}: StatCardProps) {
  const DirectionIcon = delta ? DIRECTION_ICON[delta.direction] : null;
  const good =
    delta && delta.direction !== 'stable'
      ? (delta.direction === 'up') !== Boolean(invertDelta)
      : undefined;

  const content = (
    <>
      <div className="kpi-card-head">
        <span className="kpi-label">{label}</span>
        {Icon && (
          <span className="kpi-icon" data-tone={tone} aria-hidden>
            <Icon className="h-5 w-5" />
          </span>
        )}
      </div>
      <span
        className="kpi-value"
        style={{
          ...(valueColor ? { color: valueColor } : {}),
          ...(compactValue ? { fontSize: '1.25rem' } : {}),
        }}
      >
        {value}
      </span>
      {(delta || sub) && (
        <div className="kpi-foot">
          {delta && DirectionIcon ? (
            <>
              <span
                className="kpi-delta"
                data-direction={delta.direction}
                data-good={good === undefined ? undefined : String(good)}
              >
                <DirectionIcon className="h-3.5 w-3.5" />
                {Math.abs(delta.percent).toFixed(1)}%
              </span>
              {delta.caption && <span className="kpi-delta-caption">{delta.caption}</span>}
            </>
          ) : (
            <span className="kpi-sub">{sub}</span>
          )}
        </div>
      )}
      {footNote && <div className="kpi-footnote">{footNote}</div>}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className="kpi-card kpi-card--clickable"
        data-active={active || undefined}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }

  return <div className="kpi-card">{content}</div>;
}
