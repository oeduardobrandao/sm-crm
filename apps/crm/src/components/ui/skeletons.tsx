import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Skeleton } from './skeleton';

/**
 * Loading placeholders shaped like the content they stand in for, replacing the page- and
 * section-level spinners. Each composition is announced once to assistive tech through
 * `SkeletonStatus` ("Carregando…"); the bars themselves are aria-hidden. Busy indicators on
 * buttons and in-flight operations (saving, syncing, importing) keep their `Spinner`: a skeleton
 * says "content is on its way", not "your action is running".
 *
 * Tests find a skeleton by `data-testid="crm-skeleton"` (or the `testId` passed in).
 */

const widths = ['72%', '58%', '66%', '50%', '62%'];
const widthAt = (i: number) => widths[i % widths.length];

export function SkeletonStatus({
  children,
  className,
  style,
  testId,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  testId?: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      aria-busy="true"
      data-testid={testId ?? 'crm-skeleton'}
      className={className}
      style={style}
    >
      <span className="sr-only">{t('common:loading', 'Carregando…')}</span>
      <div aria-hidden="true">{children}</div>
    </div>
  );
}

/** The `.header` row every page opens with: title, subtitle and an action button. */
function HeaderBars({ action = true }: { action?: boolean }) {
  return (
    <div className="header">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-48 max-w-[60vw]" />
        <Skeleton className="h-3.5 w-64 max-w-[70vw]" />
      </div>
      {action && <Skeleton className="hidden sm:block h-9 w-32 shrink-0" />}
    </div>
  );
}

function TableBars({ rows, columns }: { rows: number; columns: number }) {
  return (
    <div className="card" style={{ padding: '0.25rem 0' }}>
      <div className="flex items-center gap-6 px-4 py-3 border-b border-[var(--border-color)]">
        {Array.from({ length: columns }, (_, c) => (
          <Skeleton key={c} className={cn('h-3', c === 0 ? 'flex-[2]' : 'flex-1')} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div
          key={r}
          className="flex items-center gap-6 px-4 py-3.5 border-b last:border-b-0 border-[var(--border-color)]"
        >
          <div className="flex flex-[2] items-center gap-3 min-w-0">
            <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
            <Skeleton className="h-3.5" style={{ width: widthAt(r) }} />
          </div>
          {Array.from({ length: columns - 1 }, (_, c) => (
            <div key={c} className="flex-1 min-w-0">
              <Skeleton className="h-3" style={{ width: widthAt(r + c + 1) }} />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function CardListBars({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="card flex items-center gap-3" style={{ padding: '1rem 1.25rem' }}>
          <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
          <div className="flex-1 min-w-0 flex flex-col gap-2">
            <Skeleton className="h-3.5" style={{ width: widthAt(i) }} />
            <Skeleton className="h-3 w-28" />
          </div>
          <Skeleton className="h-6 w-16 shrink-0" />
        </div>
      ))}
    </div>
  );
}

function RowBars({ rows, avatar }: { rows: number; avatar: boolean }) {
  return (
    <div className="flex flex-col gap-3.5">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3">
          {avatar && <Skeleton className="h-8 w-8 shrink-0 rounded-full" />}
          <div className="flex-1 min-w-0 flex flex-col gap-1.5">
            <Skeleton className="h-3.5" style={{ width: widthAt(i) }} />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}

function CardGridBars({ cards }: { cards: number }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: cards }, (_, i) => (
        <div key={i} className="card flex flex-col gap-3" style={{ padding: '1.25rem' }}>
          <Skeleton className="h-4" style={{ width: widthAt(i) }} />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-20 w-full mt-1" />
        </div>
      ))}
    </div>
  );
}

function BoardBars({ columns }: { columns: number }) {
  return (
    <div className="flex gap-4 overflow-hidden">
      {Array.from({ length: columns }, (_, c) => (
        <div key={c} className="flex min-w-[285px] max-w-[320px] flex-[1_0_285px] flex-col gap-3">
          <Skeleton className="h-4 w-28" />
          {Array.from({ length: 3 - (c % 2) }, (_, i) => (
            <div key={i} className="card flex flex-col gap-2.5" style={{ padding: '0.9rem 1rem' }}>
              <Skeleton className="h-3.5" style={{ width: widthAt(c + i) }} />
              <Skeleton className="h-3 w-20" />
              <div className="flex items-center justify-between pt-1">
                <Skeleton className="h-5 w-14" />
                <Skeleton className="h-6 w-6 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function ReportBars() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card flex flex-col gap-2.5" style={{ padding: '1rem 1.25rem' }}>
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-24" />
          </div>
        ))}
      </div>
      <div className="card" style={{ padding: '1.25rem' }}>
        <Skeleton className="h-4 w-40 mb-4" />
        <Skeleton className="h-[260px] w-full" />
      </div>
    </div>
  );
}

function DocBars() {
  const lines = ['100%', '94%', '97%', '62%'];
  return (
    <div className="flex flex-col gap-8">
      {[0, 1].map((block) => (
        <div key={block} className="flex flex-col gap-3">
          <Skeleton className="h-4 w-40" />
          {lines.map((w, i) => (
            <Skeleton key={i} className="h-3" style={{ width: w }} />
          ))}
        </div>
      ))}
    </div>
  );
}

function CalendarBars() {
  return (
    <div className="card flex flex-col gap-3" style={{ padding: '1rem' }}>
      <div className="flex items-center justify-between">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-8 w-24" />
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {Array.from({ length: 35 }, (_, i) => (
          <Skeleton key={i} className="h-14 md:h-20" />
        ))}
      </div>
    </div>
  );
}

function PostGridBars({ tiles }: { tiles: number }) {
  return (
    <div className="grid grid-cols-3 gap-1">
      {Array.from({ length: tiles }, (_, i) => (
        <Skeleton key={i} className="aspect-[4/5] !rounded-sm" />
      ))}
    </div>
  );
}

type Common = { className?: string; style?: CSSProperties; testId?: string };

/** A desktop table: header row, then rows led by an avatar. */
export function TableSkeleton({
  rows = 6,
  columns = 4,
  ...rest
}: Common & { rows?: number; columns?: number }) {
  return (
    <SkeletonStatus {...rest}>
      <TableBars rows={rows} columns={columns} />
    </SkeletonStatus>
  );
}

/** Stacked cards: the mobile rendering of a table, or any card-per-item list. */
export function CardListSkeleton({ rows = 4, ...rest }: Common & { rows?: number }) {
  return (
    <SkeletonStatus {...rest}>
      <CardListBars rows={rows} />
    </SkeletonStatus>
  );
}

/** Bare rows for inside a card, popover or section that already draws its own frame. */
export function ListSkeleton({
  rows = 3,
  avatar = false,
  ...rest
}: Common & { rows?: number; avatar?: boolean }) {
  return (
    <SkeletonStatus {...rest}>
      <RowBars rows={rows} avatar={avatar} />
    </SkeletonStatus>
  );
}

/** A grid of cards: Ideias, Central de Ajuda, report lists. */
export function CardGridSkeleton({ cards = 6, ...rest }: Common & { cards?: number }) {
  return (
    <SkeletonStatus {...rest}>
      <CardGridBars cards={cards} />
    </SkeletonStatus>
  );
}

/** Kanban columns of cards. */
export function BoardSkeleton({ columns = 4, ...rest }: Common & { columns?: number }) {
  return (
    <SkeletonStatus {...rest}>
      <BoardBars columns={columns} />
    </SkeletonStatus>
  );
}

/** Analytics: a KPI row over a chart-sized card. */
export function ReportSkeleton(props: Common) {
  return (
    <SkeletonStatus {...props}>
      <ReportBars />
    </SkeletonStatus>
  );
}

/** Long-form text: Central de Ajuda articles, report and model editors. */
export function DocSkeleton({ title = true, ...rest }: Common & { title?: boolean }) {
  return (
    <SkeletonStatus {...rest}>
      {title && <Skeleton className="h-8 w-2/3 max-w-sm mb-8" />}
      <DocBars />
    </SkeletonStatus>
  );
}

/** A month grid. */
export function CalendarSkeleton(props: Common) {
  return (
    <SkeletonStatus {...props}>
      <CalendarBars />
    </SkeletonStatus>
  );
}

/** Instagram-profile tile grid. */
export function PostGridSkeleton({ tiles = 6, ...rest }: Common & { tiles?: number }) {
  return (
    <SkeletonStatus {...rest}>
      <PostGridBars tiles={tiles} />
    </SkeletonStatus>
  );
}

export type PageSkeletonBody =
  | 'table'
  | 'cards'
  | 'list'
  | 'board'
  | 'report'
  | 'doc'
  | 'calendar'
  | 'blocks';

function Body({ body }: { body: PageSkeletonBody }) {
  switch (body) {
    case 'table':
      return <TableBars rows={6} columns={4} />;
    case 'cards':
      return <CardGridBars cards={6} />;
    case 'list':
      return <CardListBars rows={5} />;
    case 'board':
      return <BoardBars columns={4} />;
    case 'report':
      return <ReportBars />;
    case 'doc':
      return <DocBars />;
    case 'calendar':
      return <CalendarBars />;
    case 'blocks':
      return (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-20" />
            ))}
          </div>
          <Skeleton className="h-64" />
        </div>
      );
  }
}

/**
 * A whole page before its data arrives: the `.header` row, then a body shaped like the page.
 * Used where a page used to return a lone spinner (losing its header), and as the route-level
 * fallback inside the app shell, where the page is unknown (`blocks`).
 */
export function PageSkeleton({
  body = 'blocks',
  header = true,
  ...rest
}: Common & { body?: PageSkeletonBody; header?: boolean }) {
  return (
    <SkeletonStatus {...rest}>
      {header && <HeaderBars />}
      <Body body={body} />
    </SkeletonStatus>
  );
}

/**
 * A detail page (client, member): identity header with avatar, a tab strip, then content.
 */
export function DetailSkeleton(props: Common) {
  return (
    <SkeletonStatus {...props}>
      <div className="flex items-center gap-4 mb-5">
        <Skeleton className="h-14 w-14 shrink-0 rounded-full" />
        <div className="flex flex-col gap-2 min-w-0 flex-1">
          <Skeleton className="h-7 w-56 max-w-full" />
          <Skeleton className="h-3.5 w-40 max-w-full" />
        </div>
      </div>
      <div className="flex gap-5 mb-6 border-b border-[var(--border-color)] pb-3">
        {[64, 56, 88, 72, 48].map((w, i) => (
          <Skeleton key={i} className="h-4" style={{ width: w }} />
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Skeleton className="h-48 lg:col-span-2" />
        <Skeleton className="h-48" />
      </div>
    </SkeletonStatus>
  );
}
