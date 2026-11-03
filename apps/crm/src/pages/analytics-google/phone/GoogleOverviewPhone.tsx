import { useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowUpDown, Check } from 'lucide-react';
import { PhonePageHeader } from '@/components/mobile/PhonePageHeader';
import { GroupedList, Cell } from '@/components/mobile/GroupedList';
import { ActionSheet } from '@/components/mobile/ActionSheet';
import { BarList } from '@/components/mobile/BarList';
import type {
  GbpPortfolio,
  GbpPortfolioDays,
  GbpPortfolioUnit,
} from '../../../services/gbpAnalytics';
import { PickerChip, SectionHead } from '../../analytics/phone/shared';
import { formatGbpCount, formatRating } from '../../analytics-conta/google/gbpTabFormat';
import {
  AttentionReviews,
  AttentionUnits,
  GBP_PORTFOLIO_PERIODS,
  UNIT_SORT_KEY,
  unitHref,
  updatedAgo,
  viewsChange,
  type ClientOption,
  type GbpHighlightCard,
} from '../GbpOverviewSections';
import type { GbpSpecialtyStat, GbpUnitSortCol } from '../gbpOverviewModel';

const SORT_COLS: GbpUnitSortCol[] = [
  'profileViews',
  'calls',
  'directions',
  'websiteClicks',
  'messages',
  'avgRating',
  'newReviews',
  'lastSyncedAt',
  'title',
];

export interface GoogleOverviewPhoneProps {
  portfolio: GbpPortfolio;
  /** Nothing connected at all: the empty state replaces the lists. */
  empty: boolean;
  sortedUnits: GbpPortfolioUnit[];
  clientOptions: ClientOption[];
  clientId: number | null;
  onClientId: (id: number | null) => void;
  days: GbpPortfolioDays;
  onDays: (d: GbpPortfolioDays) => void;
  /** The page's KPI grid; `StatCardGrid` renders it as the phone tile strip. */
  kpis: ReactNode;
  highlights: GbpHighlightCard[];
  attention: GbpPortfolioUnit[];
  specialtyStats: GbpSpecialtyStat[];
  dataThroughNote: string | null;
  sortColumn: GbpUnitSortCol;
  sortDirection: 'asc' | 'desc';
  onSortColumn: (c: GbpUnitSortCol) => void;
  onToggleDirection: () => void;
  /** A filter or period change is loading over the previous answer. */
  dimmed: boolean;
}

/** /analytics/google below 768px. The page keeps every hook and number. */
export function GoogleOverviewPhone(props: GoogleOverviewPhoneProps) {
  const {
    portfolio,
    empty,
    sortedUnits,
    clientOptions,
    clientId,
    onClientId,
    days,
    onDays,
    kpis,
    highlights,
    attention,
    specialtyStats,
    dataThroughNote,
    sortColumn,
    sortDirection,
    onSortColumn,
    onToggleDirection,
    dimmed,
  } = props;
  const { t, i18n } = useTranslation('analyticsGoogle');
  const [sortOpen, setSortOpen] = useState(false);
  const sortButtonRef = useRef<HTMLButtonElement>(null);

  const clientLabel =
    clientId === null
      ? t('overview.allClients')
      : (clientOptions.find((c) => c.id === clientId)?.name ?? t('overview.allClients'));
  const sortLabel = t(UNIT_SORT_KEY[sortColumn]);

  const valueOf = (u: GbpPortfolioUnit): string => {
    switch (sortColumn) {
      case 'avgRating':
        return u.avgRating === null ? t('units.noRating') : `★ ${formatRating(u.avgRating)}`;
      case 'newReviews':
        return u.newReviews === null ? t('states.noData') : formatGbpCount(u.newReviews);
      case 'lastSyncedAt':
        return u.status === 'revoked'
          ? t('overview.attentionReconnect')
          : updatedAgo(u, t, i18n.language);
      case 'title':
        return formatGbpCount(u.profileViews);
      default:
        return formatGbpCount(u[sortColumn]);
    }
  };

  return (
    <div className="phone-kit phone-an">
      <PhonePageHeader
        title={t('overview.title')}
        subtitle={
          <>
            {t('overview.unitCount', { count: portfolio.units.length })} ·{' '}
            {t('overview.periodDays', { count: days })}
            {dataThroughNote && <span className="phone-an-subtitle-line">{dataThroughNote}</span>}
          </>
        }
      />

      <div className="phone-an-chips">
        <PickerChip<number>
          label={t('overview.clientFilter')}
          valueLabel={clientLabel}
          sheetTitle={t('overview.clientFilter')}
          options={clientOptions.map((c) => ({ value: c.id, label: c.name }))}
          value={clientId}
          onChange={onClientId}
          emptyOption={{ label: t('overview.allClients') }}
          searchable={clientOptions.length > 8}
        />
        <PickerChip<number>
          label={t('overview.period')}
          valueLabel={t('overview.periodDays', { count: days })}
          options={GBP_PORTFOLIO_PERIODS.map((p) => ({
            value: p,
            label: t('overview.periodDays', { count: p }),
          }))}
          value={days}
          onChange={(v) => v !== null && onDays(v as GbpPortfolioDays)}
        />
      </div>

      {empty ? (
        <section className="phone-an-empty">
          <h2>{t('overview.emptyTitle')}</h2>
          <p>{t('overview.emptyBody')}</p>
          <Link to="/clientes" className="phone-an-link-button">
            {t('overview.emptyAction')}
          </Link>
        </section>
      ) : (
        <div style={{ opacity: dimmed ? 0.6 : 1 }} aria-busy={dimmed}>
          {kpis}

          {highlights.length > 0 && (
            <section aria-label={t('overview.highlights')}>
              <GroupedList header={t('overview.highlights')}>
                {highlights.map((h) => (
                  <Cell
                    key={h.key}
                    label={h.name}
                    subtitle={`${h.label} · ${h.clientName}`}
                    value={<span className="phone-an-row-value">{h.short}</span>}
                  />
                ))}
              </GroupedList>
            </section>
          )}

          <AttentionReviews reviews={portfolio.reviewsAttention} days={days} phone />

          <AttentionUnits units={attention} phone />

          <SectionHead
            large
            title={t('overview.unitsTitle')}
            trailing={
              sortedUnits.length > 0 ? (
                <button
                  ref={sortButtonRef}
                  type="button"
                  className="phone-an-sort"
                  aria-haspopup="dialog"
                  aria-label={`${t('overview.sortUnits')}: ${sortLabel}, ${sortDirection === 'asc' ? t('overview.sortAsc') : t('overview.sortDesc')}`}
                  onClick={() => setSortOpen(true)}
                >
                  <ArrowUpDown aria-hidden="true" />
                  {sortLabel}
                </button>
              ) : undefined
            }
          />
          {sortedUnits.length === 0 ? (
            <p className="phone-an-footnote">{t('overview.unitsEmpty')}</p>
          ) : (
            <GroupedList aria-label={t('overview.unitsTitle')} footer={t('overview.unitsSub')}>
              {sortedUnits.map((u) => {
                const change = viewsChange(u);
                return (
                  <Cell
                    key={u.id}
                    to={unitHref(u.clientId)}
                    label={u.title || t('filters.untitledUnit')}
                    subtitle={
                      <>
                        {u.clientName} · {t('overview.colViews')} {formatGbpCount(u.profileViews)}
                        {change && (
                          <span
                            className={
                              change.startsWith('+')
                                ? 'phone-an-tone--up'
                                : change.startsWith('-')
                                  ? 'phone-an-tone--down'
                                  : undefined
                            }
                          >
                            {' '}
                            {change}
                          </span>
                        )}
                        {u.stale && (
                          <>
                            {' · '}
                            <span className="phone-an-tone--down">
                              {t('overview.attentionStale')}
                            </span>
                          </>
                        )}
                      </>
                    }
                    value={<span className="phone-an-row-value">{valueOf(u)}</span>}
                  />
                );
              })}
            </GroupedList>
          )}

          {specialtyStats.length > 0 && (
            <BarList
              header={t('overview.bySpecialty')}
              items={specialtyStats.map((s) => ({
                key: s.specialty,
                label: s.specialty,
                subtitle: `${t('overview.specialtyUnits', { count: s.count })} · ${t('overview.specialtyActions', { value: formatGbpCount(Math.round(s.actionsPerUnit)) })}`,
                value: s.viewsPerUnit,
                valueLabel: formatGbpCount(Math.round(s.viewsPerUnit)),
              }))}
            />
          )}
        </div>
      )}

      <ActionSheet
        open={sortOpen}
        onOpenChange={setSortOpen}
        title={t('overview.sortUnits')}
        returnFocusRef={sortButtonRef}
        actions={[
          ...SORT_COLS.map((col) => ({
            label: t(UNIT_SORT_KEY[col]),
            icon: sortColumn === col ? <Check /> : <span />,
            onSelect: () => onSortColumn(col),
          })),
          {
            label: sortDirection === 'asc' ? t('overview.sortToDesc') : t('overview.sortToAsc'),
            icon: <ArrowUpDown />,
            onSelect: onToggleDirection,
          },
        ]}
      />
    </div>
  );
}
