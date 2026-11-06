import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from './cn';

export interface PhoneIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Accessible name. Icon-only buttons have no visible text. */
  label: string;
  /** `fill` is the grey round button, `ink` the dark primary action (e.g. "Novo"). */
  variant?: 'fill' | 'ink';
  /** Small count on the corner (unread, active filters). Hidden at 0. */
  badge?: number;
  children: ReactNode;
}

/** Round 36px header button from the iOS mockups (search, filters, bell, new). */
export const PhoneIconButton = forwardRef<HTMLButtonElement, PhoneIconButtonProps>(
  function PhoneIconButton(
    { label, variant = 'fill', badge, className, children, type = 'button', ...rest },
    ref,
  ) {
    const count = badge && badge > 0 ? (badge > 99 ? '99+' : String(badge)) : null;
    return (
      <button
        ref={ref}
        type={type}
        aria-label={label}
        className={cn('phone-icon-button', `phone-icon-button--${variant}`, className)}
        {...rest}
      >
        {children}
        {count && (
          <span className="phone-icon-button__badge" aria-hidden="true">
            {count}
          </span>
        )}
      </button>
    );
  },
);

export interface LargeTitleHeaderProps {
  title: ReactNode;
  /** One line under the title (counts, state). */
  subtitle?: ReactNode;
  /** Left side of the toolbar row above the title (e.g. a back button). */
  leading?: ReactNode;
  /** Right side of the toolbar row (round icon buttons). */
  trailing?: ReactNode;
  /** Anything that belongs to the header below the subtitle (segmented control, chips). */
  children?: ReactNode;
  /** Heading level of the title. A page title is h1; a pushed screen inside a dialog may want h2. */
  as?: 'h1' | 'h2';
  className?: string;
  titleId?: string;
}

/**
 * iOS large title: an optional toolbar row (leading / trailing) with the 34px title
 * under it. Static, it scrolls with the page; it is a header, not a fixed bar.
 */
export function LargeTitleHeader({
  title,
  subtitle,
  leading,
  trailing,
  children,
  as: Heading = 'h1',
  className,
  titleId,
}: LargeTitleHeaderProps) {
  return (
    <header className={cn('phone-kit phone-large-title', className)}>
      {(leading || trailing) && (
        <div className="phone-large-title__bar">
          <div className="phone-large-title__leading">{leading}</div>
          <div className="phone-large-title__trailing">{trailing}</div>
        </div>
      )}
      <Heading id={titleId} className="phone-large-title__title">
        {title}
      </Heading>
      {subtitle && <p className="phone-large-title__subtitle">{subtitle}</p>}
      {children}
    </header>
  );
}
