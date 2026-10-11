import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { GroupedList } from './GroupedList';

export interface BarListItem {
  key: string;
  label: ReactNode;
  value: number;
  /** Text for the value ("12,4%", "R$ 1.200"). Defaults to the number in pt-BR. */
  valueLabel?: ReactNode;
  /** Second series (e.g. the previous period), drawn as a thinner bar under the first. */
  secondary?: number;
  secondaryLabel?: ReactNode;
  /** Line under the label. */
  subtitle?: ReactNode;
  /** Bar colour for this row; defaults to the list's `color`. */
  color?: string;
  onClick?: () => void;
}

export interface BarListProps {
  items: BarListItem[];
  /** Value of a full bar. Defaults to the largest value in the list. */
  max?: number;
  header?: ReactNode;
  footer?: ReactNode;
  'aria-label'?: string;
  /** Primary bar colour (any CSS colour or var). */
  color?: string;
  secondaryColor?: string;
  /** Series names. Shown as a legend under the list, and read before each value. */
  series?: { primary: string; secondary?: string };
  /** Shown instead of the list when there are no items. */
  emptyText?: ReactNode;
  className?: string;
}

const fmt = (n: number) => n.toLocaleString('pt-BR');
const pct = (value: number, max: number) =>
  `${Math.max(0, Math.min(100, (Math.max(0, value) / max) * 100))}%`;

/**
 * Small charts on phones: one row per item with label, value and a proportional CSS
 * bar (the look of the Visão geral rows in Entregas). The numbers are text, so the
 * bars are decoration for screen readers.
 */
export function BarList({
  items,
  max,
  header,
  footer,
  'aria-label': ariaLabel,
  color,
  secondaryColor,
  series,
  emptyText,
  className,
}: BarListProps) {
  if (items.length === 0 && emptyText) {
    return (
      <section className={cn('phone-kit phone-bar-list', className)}>
        {header && <h2 className="phone-group__header">{header}</h2>}
        <p className="phone-bar-list__empty">{emptyText}</p>
      </section>
    );
  }

  const top = max ?? Math.max(1, ...items.map((i) => Math.max(i.value, i.secondary ?? 0)));
  const hasSecondary = items.some((i) => i.secondary != null);
  const legend =
    series &&
    (hasSecondary && series.secondary ? (
      <p className="phone-bar-list__legend" aria-hidden="true">
        <span className="phone-bar-list__legend-item">
          <span className="phone-bar-list__dot" style={{ background: color }} />
          {series.primary}
        </span>
        <span className="phone-bar-list__legend-item">
          <span
            className="phone-bar-list__dot phone-bar-list__dot--secondary"
            style={{ background: secondaryColor }}
          />
          {series.secondary}
        </span>
      </p>
    ) : null);

  return (
    <div className={cn('phone-kit phone-bar-list', className)}>
      <GroupedList header={header} footer={footer} aria-label={ariaLabel}>
        {items.map((item) => {
          const body = (
            <span className="phone-cell__body phone-bar-row">
              <span className="phone-bar-row__top">
                <span className="phone-bar-row__text">
                  <span className="phone-bar-row__label">{item.label}</span>
                  {item.subtitle && (
                    <span className="phone-bar-row__subtitle">{item.subtitle}</span>
                  )}
                </span>
                <span className="phone-bar-row__values">
                  <span className="phone-bar-row__value">
                    {series && <span className="sr-only">{series.primary}: </span>}
                    {item.valueLabel ?? fmt(item.value)}
                  </span>
                  {item.secondary != null && (
                    <span className="phone-bar-row__value phone-bar-row__value--secondary">
                      {series?.secondary && <span className="sr-only">{series.secondary}: </span>}
                      {item.secondaryLabel ?? fmt(item.secondary)}
                    </span>
                  )}
                </span>
              </span>
              <span className="phone-bar-row__track" aria-hidden="true">
                <span
                  className="phone-bar-row__fill"
                  style={{ width: pct(item.value, top), background: item.color ?? color }}
                />
              </span>
              {item.secondary != null && (
                <span
                  className="phone-bar-row__track phone-bar-row__track--secondary"
                  aria-hidden="true"
                >
                  <span
                    className="phone-bar-row__fill phone-bar-row__fill--secondary"
                    style={{ width: pct(item.secondary, top), background: secondaryColor }}
                  />
                </span>
              )}
            </span>
          );
          return (
            <li key={item.key} className="phone-cell">
              {item.onClick ? (
                <button type="button" className="phone-cell__main" onClick={() => item.onClick?.()}>
                  {body}
                </button>
              ) : (
                <div className="phone-cell__main">{body}</div>
              )}
            </li>
          );
        })}
      </GroupedList>
      {legend}
    </div>
  );
}
