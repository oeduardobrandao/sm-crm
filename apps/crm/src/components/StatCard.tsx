import { createContext, useContext, type ReactNode } from 'react';
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
  /**
   * Shrinks the value — for cards whose value is a name or a currency amount.
   * A string value's non-breaking spaces become plain ones, so "R$ 49.500,00"
   * can wrap after the symbol in a narrow card instead of overflowing it.
   */
  compactValue?: boolean;
  /** Renders the card as a button and fires this on click. */
  onClick?: () => void;
  /** Marks the card as the applied filter (ring). Only meaningful with `onClick`. */
  active?: boolean;
  /** Flips which delta direction reads as "good" (e.g. a falling average time). */
  invertDelta?: boolean;
  /**
   * Unit printed straight after the delta number.
   *
   * The default '%' keeps one decimal, because a relative change genuinely has
   * a fractional part. Any other unit renders as a whole number: 'pts' carries
   * a difference between two percentages that the server already rounded, so
   * "8.0pts" would be inventing a decimal the data never had.
   */
  unit?: string;
}

/**
 * Set by `StatCardGrid` below 768px: its cards render as compact phone tiles. A card
 * outside a grid keeps the desktop card at every width.
 */
export const StatCardPhoneContext = createContext(false);

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
  unit = '%',
}: StatCardProps) {
  const phone = useContext(StatCardPhoneContext);
  const DirectionIcon = delta ? DIRECTION_ICON[delta.direction] : null;
  const good =
    delta && delta.direction !== 'stable'
      ? (delta.direction === 'up') !== Boolean(invertDelta)
      : undefined;
  const deltaText = delta
    ? unit === '%'
      ? Math.abs(delta.percent).toFixed(1)
      : Math.round(Math.abs(delta.percent))
    : null;
  const shownValue =
    compactValue && typeof value === 'string' ? value.replace(/\u00a0/g, ' ') : value;

  if (phone) {
    // Phone tile (ChartViewPhone / FAnalytics mockups): label, value with the delta
    // beside it, then the caption or sub line and the footnote. Same facts as the
    // card; the icon bubble is decoration and is left out.
    const tileContent = (
      <>
        <span className="phone-stat-tile__label">{label}</span>
        <span className="phone-stat-tile__value-row">
          <span
            className={
              compactValue
                ? 'phone-stat-tile__value phone-stat-tile__value--compact'
                : 'phone-stat-tile__value'
            }
            style={valueColor ? { color: valueColor } : undefined}
          >
            {shownValue}
          </span>
          {delta && DirectionIcon && (
            <span
              className="phone-stat-tile__delta"
              data-direction={delta.direction}
              data-good={good === undefined ? undefined : String(good)}
            >
              <DirectionIcon aria-hidden="true" />
              {deltaText}
              {unit}
            </span>
          )}
        </span>
        {delta
          ? delta.caption && <span className="phone-stat-tile__sub">{delta.caption}</span>
          : sub && <span className="phone-stat-tile__sub">{sub}</span>}
        {footNote && <span className="phone-stat-tile__footnote">{footNote}</span>}
      </>
    );
    if (onClick) {
      return (
        <button
          type="button"
          className={active ? 'phone-stat-tile phone-stat-tile--active' : 'phone-stat-tile'}
          data-active={active || undefined}
          aria-pressed={active ?? false}
          onClick={onClick}
        >
          {tileContent}
        </button>
      );
    }
    return <div className="phone-stat-tile">{tileContent}</div>;
  }

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
        className={compactValue ? 'kpi-value kpi-value--compact' : 'kpi-value'}
        style={valueColor ? { color: valueColor } : undefined}
      >
        {shownValue}
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
                {deltaText}
                {unit}
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
        // The ring is the sighted cue for "this filter is applied"; aria-pressed
        // is the same fact for a screen reader, and it has to be present (false)
        // even while off or the card reads as a plain action button.
        aria-pressed={active ?? false}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }

  return <div className="kpi-card">{content}</div>;
}
