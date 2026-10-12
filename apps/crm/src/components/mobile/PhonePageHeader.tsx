import type { ReactNode } from 'react';
import { PhoneShellActions } from '@/components/layout/PhoneShellHeader';
import { usePhoneChrome } from '@/components/layout/PhoneLayoutContext';
import { BrandMark } from './BrandMark';
import { LargeTitleHeader } from './LargeTitleHeader';

export interface PhonePageHeaderProps {
  title: ReactNode;
  /** One line under the title (counts, period, plan usage). */
  subtitle?: ReactNode;
  /** Left side of the header row, above the title. Defaults to the Mesaas mark. */
  leading?: ReactNode;
  /** The page's round header buttons (search, filters, the ink "+"), before the bell. */
  actions?: ReactNode;
  /** Below the subtitle: segmented control, chips. */
  children?: ReactNode;
  className?: string;
  titleId?: string;
}

/**
 * Header of a root screen on phones (D26): one 44px row with the Mesaas mark on the left
 * and the page's actions followed by the shell's related-articles button and bell on the
 * right, then the large title. While mounted it
 * hides the shell's own bell bar (`usePhoneChrome({ pageHeader: true })`), so the page
 * shows a single header row. Render it only in the page's phone branch.
 */
export function PhonePageHeader({
  title,
  subtitle,
  leading,
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
      leading={leading ?? <BrandMark />}
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
