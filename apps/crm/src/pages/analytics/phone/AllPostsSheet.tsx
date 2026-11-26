import { useRef, useState, type ReactNode, type RefObject } from 'react';
import { ChevronLeft, SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BottomSheet } from '@/components/mobile/BottomSheet';
import { CheckList } from '@/components/mobile/CheckList';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
import { FormRow } from '@/components/mobile/FormRow';
import { SegmentedControl } from '@/components/mobile/SegmentedControl';
import { InstagramLinkButton, hasInstagramLink } from '@/components/instagram/InstagramLinkButton';
import { sanitizeUrl } from '../../../utils/security';
import { PostThumb } from './shared';

/** One row of the list, already formatted by the page. */
export interface AllPostsRow {
  key: string | number;
  href: string;
  thumbnailUrl?: string | null;
  mediaType: string;
  title: string;
  /** "2 de out · Reels". */
  meta: string;
  /** The numbers line (views, engagement, likes...). */
  metrics: ReactNode;
  /**
   * Opens the post in the page: the row becomes a button and `href` moves to an Instagram chip
   * at its end. Without it the whole row links to `href`.
   */
  onSelect?: () => void;
}

interface Option {
  value: string;
  label: string;
}

export interface AllPostsFilters {
  orderOptions: Option[];
  orderBy: string;
  onOrderBy: (value: string) => void;
  asc: boolean;
  onAsc: (asc: boolean) => void;
  /** Omit (with `format`/`onFormat`) for a platform with no format to filter by. */
  formatOptions?: Option[];
  /** 'all' = every format. */
  format?: string;
  onFormat?: (value: string) => void;
  /** Portfolio only: one client or 'all'. */
  clientOptions?: Option[];
  client?: string;
  onClient?: (value: string) => void;
  dateFrom: string;
  dateTo: string;
  onDateFrom: (value: string) => void;
  onDateTo: (value: string) => void;
}

export interface AllPostsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** "12 de 40 posts". */
  countLabel: string;
  /** Extra line under the count (e.g. the rate-sort caveat). */
  note?: string;
  rows: AllPostsRow[];
  emptyText: string;
  filters: AllPostsFilters;
}

type Page = 'main' | 'order' | 'format' | 'client';

/**
 * The phone face of the "Todos os posts" drawer of both analytics pages: a large sheet
 * with the ranked list, and a filters sub-sheet (order, direction, format, client, date
 * range) that applies each change at once, so the list behind it is always current.
 */
export function AllPostsSheet({
  open,
  onOpenChange,
  title,
  countLabel,
  note,
  rows,
  emptyText,
  filters,
}: AllPostsSheetProps) {
  const { t } = useTranslation('analyticsPhone');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersButtonRef = useRef<HTMLButtonElement>(null);
  const orderLabel =
    filters.orderOptions.find((o) => o.value === filters.orderBy)?.label ?? filters.orderBy;
  const active =
    (filters.formatOptions && filters.format && filters.format !== 'all' ? 1 : 0) +
    (filters.client && filters.client !== 'all' ? 1 : 0) +
    (filters.dateFrom || filters.dateTo ? 1 : 0);

  return (
    <>
      <BottomSheet
        open={open}
        onOpenChange={(next) => {
          if (!next) setFiltersOpen(false);
          onOpenChange(next);
        }}
        title={title}
        description={countLabel}
        detents={['large']}
        className="phone-an-sheet"
        headerLeading={
          <button
            ref={filtersButtonRef}
            type="button"
            className="phone-text-button"
            aria-haspopup="dialog"
            onClick={() => setFiltersOpen(true)}
          >
            <SlidersHorizontal aria-hidden="true" />
            {active > 0 ? t('sheet.filtersCount', { n: active }) : t('sheet.filters')}
          </button>
        }
      >
        <div className="phone-an-sheet__body">
          <p className="phone-an-sheet__summary">
            {countLabel} · {orderLabel}, {filters.asc ? t('sheet.asc') : t('sheet.desc')}
            {note && (
              <>
                <br />
                {note}
              </>
            )}
          </p>
          {rows.length === 0 ? (
            <p className="phone-an-empty">{emptyText}</p>
          ) : (
            <GroupedList aria-label={title}>
              {rows.map((row, i) => {
                const content = (
                  <>
                    <span className="phone-an-rank" aria-hidden="true">
                      {i + 1}
                    </span>
                    <PostThumb url={row.thumbnailUrl} mediaType={row.mediaType} />
                    <span className="phone-cell__body">
                      <span className="phone-cell__text">
                        <span className="phone-cell__label">{row.title}</span>
                        <span className="phone-an-cell-sub">{row.meta}</span>
                        <span className="phone-an-metrics">{row.metrics}</span>
                      </span>
                    </span>
                  </>
                );
                if (row.onSelect) {
                  return (
                    <li
                      key={row.key}
                      className={`phone-cell phone-an-post-row${hasInstagramLink(row.href || null) ? ' phone-an-post-row--ig' : ''}`}
                    >
                      <button type="button" className="phone-cell__main" onClick={row.onSelect}>
                        {content}
                      </button>
                      <InstagramLinkButton
                        permalink={row.href || null}
                        size={36}
                        shape="square"
                        className="phone-an-post-row__ig"
                      />
                    </li>
                  );
                }
                return (
                  <li key={row.key} className="phone-cell">
                    <a
                      href={sanitizeUrl(row.href)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="phone-cell__main"
                    >
                      {content}
                    </a>
                  </li>
                );
              })}
            </GroupedList>
          )}
        </div>
      </BottomSheet>
      {open && (
        <PostsFiltersSheet
          open={filtersOpen}
          onOpenChange={setFiltersOpen}
          filters={filters}
          active={active}
          resultCount={rows.length}
          returnFocusRef={filtersButtonRef}
        />
      )}
    </>
  );
}

function PostsFiltersSheet({
  open,
  onOpenChange,
  filters,
  active,
  resultCount,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: AllPostsFilters;
  active: number;
  resultCount: number;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
}) {
  const { t } = useTranslation('analyticsPhone');
  const [page, setPage] = useState<Page>('main');
  const close = (next: boolean) => {
    if (!next) setPage('main');
    onOpenChange(next);
  };
  const labelOf = (options: Option[], value: string | undefined, all: string) =>
    value === undefined || value === 'all'
      ? all
      : (options.find((o) => o.value === value)?.label ?? value);

  const clear = () => {
    filters.onFormat?.('all');
    filters.onClient?.('all');
    filters.onDateFrom('');
    filters.onDateTo('');
  };

  let body: ReactNode;
  if (page === 'order') {
    body = (
      <CheckList<string>
        header={t('sheet.sortBy')}
        options={filters.orderOptions}
        value={filters.orderBy}
        onChange={(v) => v !== null && filters.onOrderBy(v)}
        onPicked={() => setPage('main')}
      />
    );
  } else if (page === 'format' && filters.formatOptions && filters.onFormat) {
    const onFormat = filters.onFormat;
    body = (
      <CheckList<string>
        header={t('sheet.format')}
        emptyOption={{ label: t('sheet.allFormats') }}
        options={filters.formatOptions}
        value={!filters.format || filters.format === 'all' ? null : filters.format}
        onChange={(v) => onFormat(v ?? 'all')}
        onPicked={() => setPage('main')}
      />
    );
  } else if (page === 'client' && filters.clientOptions && filters.onClient) {
    const onClient = filters.onClient;
    body = (
      <CheckList<string>
        header={t('sheet.client')}
        searchable={filters.clientOptions.length > 8}
        emptyOption={{ label: t('sheet.allClients') }}
        options={filters.clientOptions}
        value={!filters.client || filters.client === 'all' ? null : filters.client}
        onChange={(v) => onClient(v ?? 'all')}
        onPicked={() => setPage('main')}
      />
    );
  } else {
    body = (
      <>
        <GroupedList header={t('sheet.order')}>
          <Cell
            label={t('sheet.sortBy')}
            value={labelOf(filters.orderOptions, filters.orderBy, '')}
            chevron
            onClick={() => setPage('order')}
          />
          <li className="phone-cell">
            <div className="phone-an-inline-segment">
              <SegmentedControl<'desc' | 'asc'>
                aria-label={t('sheet.direction')}
                options={[
                  { value: 'desc', label: t('sheet.descCap') },
                  { value: 'asc', label: t('sheet.ascCap') },
                ]}
                value={filters.asc ? 'asc' : 'desc'}
                onChange={(v) => filters.onAsc(v === 'asc')}
              />
            </div>
          </li>
        </GroupedList>
        <GroupedList header={t('sheet.filters')}>
          {filters.formatOptions && (
            <Cell
              label={t('sheet.format')}
              value={labelOf(filters.formatOptions, filters.format, t('sheet.all'))}
              chevron
              onClick={() => setPage('format')}
            />
          )}
          {filters.clientOptions && filters.onClient && (
            <Cell
              label={t('sheet.client')}
              value={labelOf(filters.clientOptions, filters.client, t('sheet.all'))}
              chevron
              onClick={() => setPage('client')}
            />
          )}
        </GroupedList>
        <GroupedList
          header={t('sheet.publishedBetween')}
          footer={
            filters.dateFrom || filters.dateTo ? (
              <button
                type="button"
                className="phone-text-button"
                onClick={() => {
                  filters.onDateFrom('');
                  filters.onDateTo('');
                }}
              >
                {t('sheet.clearDates')}
              </button>
            ) : undefined
          }
        >
          <FormRow
            label={t('sheet.from')}
            input={{
              type: 'date',
              value: filters.dateFrom,
              onChange: (e) => filters.onDateFrom(e.target.value),
            }}
          />
          <FormRow
            label={t('sheet.to')}
            input={{
              type: 'date',
              value: filters.dateTo,
              onChange: (e) => filters.onDateTo(e.target.value),
            }}
          />
        </GroupedList>
      </>
    );
  }

  return (
    <BottomSheet
      open={open}
      onOpenChange={close}
      title={t('sheet.filters')}
      detents={['large']}
      className="phone-an-sheet"
      returnFocusRef={returnFocusRef}
      headerLeading={
        page !== 'main' ? (
          <button type="button" className="phone-text-button" onClick={() => setPage('main')}>
            <ChevronLeft aria-hidden="true" />
            {t('sheet.filters')}
          </button>
        ) : (
          <button
            type="button"
            className="phone-text-button"
            disabled={active === 0}
            onClick={clear}
          >
            {t('sheet.clear')}
          </button>
        )
      }
      headerTrailing={
        <button
          type="button"
          className="phone-text-button phone-text-button--strong"
          onClick={() => close(false)}
        >
          {t('sheet.show', { n: resultCount })}
        </button>
      }
    >
      <div className="phone-an-sheet__body">{body}</div>
    </BottomSheet>
  );
}
