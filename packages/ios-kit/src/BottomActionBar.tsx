import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from './cn';

export interface BottomActionBarProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /**
   * The bar sits above the floating tab bar instead of at the bottom edge. Use it on
   * screens that keep the tab bar; full-screen editors hide the tab bar and leave this off.
   */
  aboveTabBar?: boolean;
}

/**
 * Fixed bar of primary actions at the bottom of a phone screen (the post editor's
 * "Enviar para aprovação", a filter sheet's "Ver 6"). Clears the home indicator, and
 * renders an in-flow spacer of the same height so the end of the page isn't hidden
 * under it. Not a dialog: it stays mounted with the screen.
 */
export function BottomActionBar({
  children,
  aboveTabBar = false,
  className,
  ...rest
}: BottomActionBarProps) {
  return (
    <>
      <div className="phone-bottom-bar__spacer" aria-hidden="true" />
      <div
        {...rest}
        className={cn(
          'phone-kit phone-bottom-bar',
          aboveTabBar && 'phone-bottom-bar--above-tab-bar',
          className,
        )}
      >
        {children}
      </div>
    </>
  );
}
