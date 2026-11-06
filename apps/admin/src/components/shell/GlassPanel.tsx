import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';

export interface GlassPanelProps {
  title?: ReactNode;
  titleId?: string;
  actions?: ReactNode;
  /** No body padding (tables, lists that run edge to edge). */
  flush?: boolean;
  className?: string;
  children: ReactNode;
}

export function GlassPanel({
  title,
  titleId,
  actions,
  flush,
  className,
  children,
}: GlassPanelProps) {
  return (
    <section
      aria-labelledby={title && titleId ? titleId : undefined}
      className={cn(
        'admin-glass min-w-0 overflow-hidden rounded-[18px] border border-border bg-card text-card-foreground',
        className,
      )}
    >
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 px-[18px] py-3.5">
          {title ? (
            <h2 id={titleId} className="text-[17px] font-semibold">
              {title}
            </h2>
          ) : (
            <span />
          )}
          {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
        </div>
      )}
      <div className={flush ? undefined : 'px-[18px] pb-4'}>{children}</div>
    </section>
  );
}
