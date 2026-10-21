import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Loading placeholders shaped like the content they stand in for. Every block is a
 * `hub-skeleton` bar (a tint of the text colour, so it reads on any surface in both themes)
 * that pulses unless the user asked for reduced motion. Each composition is announced once to assistive tech
 * through `SkeletonStatus`; the bars themselves are aria-hidden.
 */
export function Skeleton({ className = '', style }: { className?: string; style?: CSSProperties }) {
  return (
    <div
      className={`hub-skeleton motion-safe:animate-pulse rounded-[var(--hub-r-chip)] ${className}`}
      style={style}
    />
  );
}

export function SkeletonStatus({
  children,
  className = '',
  testId,
}: {
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      aria-busy="true"
      data-testid={testId ?? 'hub-skeleton'}
      className={className}
    >
      <span className="sr-only">{t('common:hub.loading', 'Carregando…')}</span>
      <div aria-hidden="true">{children}</div>
    </div>
  );
}

/** Stacked card rows: Páginas, Ideias, Agenda. */
export function ListSkeleton({
  rows = 4,
  className = '',
  testId,
}: {
  rows?: number;
  className?: string;
  testId?: string;
}) {
  return (
    <SkeletonStatus className={className} testId={testId}>
      <div className="space-y-2.5">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="hub-card flex items-center gap-4 px-5 py-4">
            <div className="flex-1 min-w-0 space-y-2">
              <Skeleton className="h-4" style={{ width: `${62 - (i % 3) * 12}%` }} />
              <Skeleton className="h-3 w-28" />
            </div>
            <Skeleton className="h-6 w-16 shrink-0" />
          </div>
        ))}
      </div>
    </SkeletonStatus>
  );
}

/** Instagram-profile tile grid, same columns and gutters as PostGrid. */
export function PostGridSkeleton({ tiles = 6 }: { tiles?: number }) {
  return (
    <SkeletonStatus>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
        {Array.from({ length: tiles }, (_, i) => (
          <Skeleton key={i} className="aspect-[4/5] !rounded-none" />
        ))}
      </div>
    </SkeletonStatus>
  );
}

/** Card grid: Relatórios. */
export function CardGridSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <SkeletonStatus>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: cards }, (_, i) => (
          <div key={i} className="hub-card p-5 space-y-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-20 w-full mt-2" />
          </div>
        ))}
      </div>
    </SkeletonStatus>
  );
}

/** Long-form text: Briefing, Página, Convite, Marca. */
export function DocSkeleton({
  title = true,
  className = '',
}: {
  title?: boolean;
  className?: string;
}) {
  const widths = ['100%', '94%', '97%', '62%'];
  return (
    <SkeletonStatus className={className}>
      <div className="space-y-8">
        {title && <Skeleton className="h-8 w-2/3 max-w-sm" />}
        {[0, 1].map((block) => (
          <div key={block} className="space-y-3">
            <Skeleton className="h-4 w-40" />
            {widths.map((w, i) => (
              <Skeleton key={i} className="h-3" style={{ width: w }} />
            ))}
          </div>
        ))}
      </div>
    </SkeletonStatus>
  );
}

/** A report page: header strip, KPI row and a chart-sized block. */
export function ReportSkeleton() {
  return (
    <SkeletonStatus className="max-w-5xl mx-auto">
      <div className="space-y-4">
        <Skeleton className="h-8 w-1/2 max-w-xs" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
        <Skeleton className="h-[280px]" />
      </div>
    </SkeletonStatus>
  );
}

/** Month calendar, matching PostCalendar's 7-column grid. */
export function CalendarSkeleton() {
  return (
    <SkeletonStatus>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-7 w-16" />
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {Array.from({ length: 35 }, (_, i) => (
            <Skeleton key={i} className="h-12 md:h-16" />
          ))}
        </div>
      </div>
    </SkeletonStatus>
  );
}

/**
 * The whole Hub before bootstrap resolves: sidebar on desktop, then a page header and a few
 * cards. The page being opened is unknown here, so it is a silhouette, not a content mirror.
 */
export function ShellSkeleton() {
  return (
    <SkeletonStatus className="hub-root min-h-screen">
      <aside className="hidden md:flex fixed inset-y-0 left-0 w-[240px] flex-col gap-3 border-r hub-border px-5 py-8">
        <Skeleton className="h-8 w-32 mb-6" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="h-5" style={{ width: `${70 - (i % 3) * 10}%` }} />
        ))}
      </aside>
      <main className="flex-1 md:pl-[240px]">
        <div className="mx-auto w-full max-w-5xl px-5 sm:px-8 py-8 sm:py-12 space-y-8">
          <div className="space-y-3">
            <Skeleton className="h-9 w-64 max-w-full" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
          <Skeleton className="h-64" />
        </div>
      </main>
    </SkeletonStatus>
  );
}
