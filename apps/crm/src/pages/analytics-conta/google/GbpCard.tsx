// Shared building blocks of the Google Meu Negócio tab's cards: one frame per variant
// (desktop `.card`, phone `.phone-an-card`), a segmented control and a query body.
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { UseQueryResult } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { SegmentedControl } from '@/components/mobile/SegmentedControl';
import type { GbpLocation, GbpUnitRow } from '../../../services/gbpAnalytics';
import { dimmed } from '../tiktok/tiktokTabFormat';

export function GbpCard({
  title,
  sub,
  trailing,
  phone,
  children,
}: {
  title: string;
  sub?: ReactNode;
  /** A control in the header row (month, filter). */
  trailing?: ReactNode;
  phone?: boolean;
  children: ReactNode;
}) {
  if (phone) {
    return (
      <section className="phone-an-card" aria-label={title}>
        <div className="phone-an-card__top">
          <h2 className="phone-group__header">{title}</h2>
        </div>
        {sub && <p className="phone-an-footnote">{sub}</p>}
        {trailing && <div style={{ margin: '6px 0 10px' }}>{trailing}</div>}
        {children}
      </section>
    );
  }
  return (
    <div className="card animate-up" style={{ minWidth: 0 }}>
      <div
        className="dashboard-hub-card-header"
        style={{ flexWrap: 'wrap', gap: '0.75rem', alignItems: 'flex-start' }}
      >
        <div style={{ minWidth: 0 }}>
          <h3>{title}</h3>
          {sub && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '0.25rem 0 0' }}>
              {sub}
            </p>
          )}
        </div>
        {trailing}
      </div>
      <div style={{ marginTop: '1rem' }}>{children}</div>
    </div>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

/** Desktop: the app's inline page tabs. Phone: the iOS segmented control. */
export function Segments<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  phone,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  phone?: boolean;
}) {
  if (phone) {
    return (
      <SegmentedControl
        aria-label={ariaLabel}
        options={options}
        value={value}
        onChange={onChange}
      />
    );
  }
  return (
    <div className="page-tabs page-tabs--inline" role="tablist" aria-label={ariaLabel}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            className={`page-tab${active ? ' active' : ''}`}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** The tab's queries: their retry callback types the error as `unknown`. */
export type GbpQuery<T> = UseQueryResult<T, unknown>;

type QueryState<T> = Pick<
  GbpQuery<T>,
  'isPending' | 'isError' | 'data' | 'refetch' | 'isPlaceholderData'
>;

/** A card's body: spinner, "couldn't load" with a retry, or the data (dimmed while stale). */
export function QueryBody<T>({
  query,
  children,
}: {
  query: QueryState<T>;
  children: (data: T) => ReactNode;
}) {
  const { t } = useTranslation('analyticsGoogle');
  if (query.isPending) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '1.5rem 0' }}>
        <Spinner />
      </div>
    );
  }
  if (query.isError && query.data === undefined) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <p style={{ color: 'var(--text-muted)', margin: 0 }}>{t('states.error')}</p>
        <Button size="sm" variant="outline" onClick={() => query.refetch()}>
          {t('states.retry')}
        </Button>
      </div>
    );
  }
  return (
    <div style={dimmed(query.isPlaceholderData)} aria-busy={query.isPlaceholderData}>
      {children(query.data as T)}
    </div>
  );
}

/** "★★★★☆" read as "4 de 5 estrelas". */
export function Stars({ rating, small }: { rating: number; small?: boolean }) {
  const { t } = useTranslation('analyticsGoogle');
  const n = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <span
      role="img"
      aria-label={t('rating.starsAria', { n })}
      style={{ color: '#d97706', letterSpacing: '0.05em', fontSize: small ? '0.8rem' : undefined }}
    >
      {'★'.repeat(n)}
      <span style={{ color: 'var(--border-color)' }}>{'★'.repeat(5 - n)}</span>
    </span>
  );
}

/** More units than this become a select instead of segments. */
const MAX_UNIT_SEGMENTS = 4;

/** The client's linked units (the server returns only `active` and `revoked` ones). */
export const visibleUnits = (units: GbpUnitRow[] | undefined): GbpUnitRow[] => units ?? [];

/** "Todas as unidades (n)" plus one segment per unit, a select past four; hidden for one unit. */
export function UnitControl({
  units,
  value,
  onChange,
  forceSelect,
}: {
  units: GbpUnitRow[];
  value: GbpLocation;
  onChange: (value: GbpLocation) => void;
  /** Phones always get the select: unit names do not fit as segments. */
  forceSelect?: boolean;
}) {
  const { t } = useTranslation('analyticsGoogle');
  if (units.length < 2) return null;
  const options = [
    { value: 'all', label: t('filters.allUnits', { count: units.length }) },
    ...units.map((u) => ({ value: u.id, label: u.title || t('filters.untitledUnit') })),
  ];
  if (forceSelect || units.length > MAX_UNIT_SEGMENTS) {
    return (
      <select
        aria-label={t('filters.unitAria')}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 rounded-full border px-3 text-sm bg-transparent"
        style={{ borderColor: 'var(--border-color)', maxWidth: '100%' }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }
  return (
    <Segments
      ariaLabel={t('filters.unitAria')}
      value={value}
      onChange={onChange}
      options={options}
    />
  );
}
