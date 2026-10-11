import type { ReactNode } from 'react';
import { PhoneShellActions } from '@/components/layout/PhoneShellHeader';
import { usePhoneChrome } from '@/components/layout/PhoneLayoutContext';
import { LargeTitleHeader } from './LargeTitleHeader';

export interface PhonePageHeaderProps {
  title: ReactNode;
  /** One line under the title (counts, period, plan usage). */
  subtitle?: ReactNode;
  /** The page's round header buttons (search, filters, the ink "+"), before the bell. */
  actions?: ReactNode;
  /** Below the subtitle: segmented control, chips. */
  children?: ReactNode;
  className?: string;
  titleId?: string;
}

/**
 * Header of a root screen on phones (D26): one 44px row with the page's actions followed
 * by the shell's related-articles button and bell, then the large title. While mounted it
 * hides the shell's own bell bar (`usePhoneChrome({ pageHeader: true })`), so the page
 * shows a single header row. Render it only in the page's phone branch.
 */
export function PhonePageHeader({
  title,
  subtitle,
  actions,
  children,
  className,
  titleId,
}: PhonePageHeaderProps) {
  usePhoneChrome({ pageHeader: true });
  return (
    <LargeTitleHeader
      title={title}
      subtitle={subtitle}
      className={className ? `phone-page-header ${className}` : 'phone-page-header'}
      titleId={titleId}
      trailing={
        <>
          {actions}
          <PhoneShellActions />
        </>
      }
    >
      {children}
    </LargeTitleHeader>
  );
}
