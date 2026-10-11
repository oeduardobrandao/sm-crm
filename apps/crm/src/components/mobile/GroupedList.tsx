import { useId, type HTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface GroupedListProps {
  /** Section title above the card (rendered uppercase, 13px). */
  header?: ReactNode;
  /** Small print under the card. */
  footer?: ReactNode;
  /** Heading level for `header`. */
  headerAs?: 'h2' | 'h3' | 'h4';
  /** Accessible name when there is no visible header. */
  'aria-label'?: string;
  className?: string;
  children: ReactNode;
}

/** iOS inset-grouped list: optional header, a rounded white card of `Cell`s, optional footer. */
export function GroupedList({
  header,
  footer,
  headerAs: Heading = 'h2',
  className,
  children,
  'aria-label': ariaLabel,
}: GroupedListProps) {
  const headerId = useId();
  return (
    <section className={cn('phone-kit phone-group', className)}>
      {header && (
        <Heading id={headerId} className="phone-group__header">
          {header}
        </Heading>
      )}
      <ul
        className="phone-group__list"
        aria-labelledby={header ? headerId : undefined}
        aria-label={header ? undefined : ariaLabel}
      >
        {children}
      </ul>
      {footer && <p className="phone-group__footer">{footer}</p>}
    </section>
  );
}

interface CellSwitch {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

export interface CellProps extends Omit<HTMLAttributes<HTMLElement>, 'onClick'> {
  label: ReactNode;
  /** Second line under the label. */
  subtitle?: ReactNode;
  /** Leading icon. With `iconColor` it sits on a 30px coloured tile, as in iOS Settings. */
  icon?: ReactNode;
  iconColor?: string;
  /** Trailing value text ("Todos", "Café Aurora"). */
  value?: ReactNode;
  /** Trailing element before the chevron (a count badge, a lock). */
  accessory?: ReactNode;
  /** Shows the disclosure chevron. Defaults to true for `to` rows. */
  chevron?: boolean;
  /** Red label for destructive rows ("Sair", "Excluir"). */
  destructive?: boolean;
  disabled?: boolean;
  /** Marks the row as the current page/selection. */
  current?: boolean;
  /** Route to navigate to: renders a link. */
  to?: string;
  onClick?: () => void;
  /** Renders an iOS switch; the whole row toggles it. */
  switch?: CellSwitch;
}

/**
 * One row of a `GroupedList`. Renders a link (`to`), a button (`onClick`), a switch row
 * (`switch`) or plain text. Extra HTML attributes (id, data-testid, aria-*) go on the
 * interactive element.
 */
export function Cell({
  label,
  subtitle,
  icon,
  iconColor,
  value,
  accessory,
  chevron,
  destructive,
  disabled,
  current,
  to,
  onClick,
  switch: switchProps,
  className,
  ...rest
}: CellProps) {
  const labelId = useId();
  const showChevron = chevron ?? Boolean(to);

  const content = (
    <>
      {icon && (
        <span
          className={cn('phone-cell__icon', iconColor && 'phone-cell__icon--tile')}
          style={iconColor ? { background: iconColor } : undefined}
          aria-hidden="true"
        >
          {icon}
        </span>
      )}
      <span className="phone-cell__body">
        <span className="phone-cell__text">
          <span id={labelId} className="phone-cell__label">
            {label}
          </span>
          {subtitle && <span className="phone-cell__subtitle">{subtitle}</span>}
        </span>
        {value != null && value !== '' && <span className="phone-cell__value">{value}</span>}
        {accessory}
        {switchProps && (
          <button
            type="button"
            role="switch"
            aria-checked={switchProps.checked}
            aria-labelledby={labelId}
            disabled={disabled}
            className="phone-switch"
            onClick={(e) => {
              e.stopPropagation();
              switchProps.onCheckedChange(!switchProps.checked);
            }}
          >
            <span className="phone-switch__thumb" aria-hidden="true" />
          </button>
        )}
        {showChevron && <ChevronRight className="phone-cell__chevron" aria-hidden="true" />}
      </span>
    </>
  );

  const mainClass = cn(
    'phone-cell__main',
    destructive && 'phone-cell__main--destructive',
    current && 'phone-cell__main--current',
    className,
  );

  if (switchProps) {
    // The switch button is the keyboard/screen-reader control; tapping anywhere on the
    // row toggles it too, like iOS.
    return (
      <li className="phone-cell">
        <div
          {...rest}
          className={mainClass}
          aria-disabled={disabled || undefined}
          onClick={() => {
            if (!disabled) switchProps.onCheckedChange(!switchProps.checked);
          }}
        >
          {content}
        </div>
      </li>
    );
  }

  if (to && !disabled) {
    return (
      <li className="phone-cell">
        <Link
          {...rest}
          to={to}
          className={mainClass}
          aria-current={current ? 'page' : undefined}
          onClick={onClick ? () => onClick() : undefined}
        >
          {content}
        </Link>
      </li>
    );
  }

  if (onClick) {
    return (
      <li className="phone-cell">
        <button
          {...rest}
          type="button"
          className={mainClass}
          disabled={disabled}
          aria-current={current ? 'page' : undefined}
          onClick={() => onClick()}
        >
          {content}
        </button>
      </li>
    );
  }

  return (
    <li className="phone-cell">
      <div {...rest} className={mainClass} aria-disabled={disabled || undefined}>
        {content}
      </div>
    </li>
  );
}
