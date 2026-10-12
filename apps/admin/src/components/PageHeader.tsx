import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { BrandMark, LargeTitleHeader } from '@mesaas/ios-kit';
import { useIsPhone } from '../hooks/useIsPhone';
import { AdminNavBar } from './shell/AdminNavBar';

interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  /** Desktop actions (pill buttons). */
  actions?: ReactNode;
  /** Phone actions (round PhoneIconButtons) in the header row. */
  phoneActions?: ReactNode;
  /** Pushed screen: desktop back link, phone nav bar. */
  back?: { to: string; label: string };
  /** Under the title: segmented control, chips. */
  children?: ReactNode;
}

export function PageHeader({
  title,
  description,
  actions,
  phoneActions,
  back,
  children,
}: PageHeaderProps) {
  const isPhone = useIsPhone();

  if (isPhone && back) {
    return (
      <>
        <AdminNavBar title={title} back={back} trailing={phoneActions} />
        {(description || children) && (
          <div className="phone-kit mb-4">
            {description && <p className="phone-large-title__subtitle">{description}</p>}
            {children}
          </div>
        )}
      </>
    );
  }

  if (isPhone) {
    return (
      <LargeTitleHeader
        title={title}
        subtitle={description}
        leading={<BrandMark />}
        trailing={phoneActions}
      >
        {children}
      </LargeTitleHeader>
    );
  }

  return (
    <div className="mb-5">
      {back && (
        <Link
          to={back.to}
          className="mb-1.5 inline-flex items-center gap-0.5 text-[15px] text-primary hover:underline"
        >
          <ChevronLeft size={18} aria-hidden="true" />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-sf text-[34px] font-bold leading-[1.1] tracking-[-0.01em]">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 text-[15px] text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}
