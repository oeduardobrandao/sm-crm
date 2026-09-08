import type { ButtonHTMLAttributes, MouseEvent } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { cn } from '../lib/utils';

/**
 * Primary-cell trigger inside a clickable row. The row keeps its onClick for the mouse;
 * this element gives keyboard and screen-reader users a real link/button, and stops
 * propagation so activating it does not also fire the row's handler.
 */
export const ROW_TRIGGER_CLASS =
  'rounded-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

export function RowLink({ className, onClick, ...props }: LinkProps) {
  return (
    <Link
      className={cn(ROW_TRIGGER_CLASS, className)}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        e.stopPropagation();
        onClick?.(e);
      }}
      {...props}
    />
  );
}

export function RowButton({
  className,
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(ROW_TRIGGER_CLASS, 'text-left', className)}
      onClick={(e: MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation();
        onClick?.(e);
      }}
      {...props}
    />
  );
}
