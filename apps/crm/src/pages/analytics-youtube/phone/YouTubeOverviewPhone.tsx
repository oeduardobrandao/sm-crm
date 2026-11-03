import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowUpDown, Check } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { PhonePageHeader } from '@/components/mobile/PhonePageHeader';
import { GroupedList, Cell } from '@/components/mobile/GroupedList';
import { ActionSheet } from '@/components/mobile/ActionSheet';
import type { YtPortfolioChannel, YtPortfolioDays } from '../../../services/youtubeAnalytics';
import { Avatar, PickerChip, SectionHead } from '../../analytics/phone/shared';
import { dimmed as dimmedStyle } from '../../analytics-conta/youtube/youtubeTabFormat';
import { initialsOf } from '../../analytics-tiktok/overviewModel';
import {
  SORT_COLS,
  channelName,
  formatMetric,
  syncedAgo,
  type YtChannelSortCol,
  type YtStatusFilter,
} from '../youtubeOverviewModel';

const PERIODS: readonly YtPortfolioDays[] = [7, 28, 90];

export interface YouTubeOverviewPhoneProps {
  /** Every channel of the workspace, before any filter. */
  total: number;
  /** The filtered, sorted rows. */
  channels: YtPortfolioChannel[];
  clientOptions: YtPortfolioChannel[];
  query: string;
  onQuery: (q: string) => void;
  clientFilter: string;
  onClientFilter: (v: string) => void;
  days: YtPortfolioDays;
  onDays: (d: YtPortfolioDays) => void;
  status: YtStatusFilter;
  onStatus: (s: YtStatusFilter) => void;
  counts: Record<YtStatusFilter, number>;
  sortColumn: YtChannelSortCol;
  sortDirection: 'asc' | 'desc';
  onSortColumn: (c: YtChannelSortCol) => void;
  onToggleDirection: () => void;
  /** A period change is loading: the previous rows stay on screen, dimmed. */
  dimmed: boolean;
}

/** The trailing value of a cell: the sorted column's number (views when sorting by name). */
function cellValue(c: YtPortfolioChannel, col: YtChannelSortCol, language: string): string {
  if (col === 'title') return formatMetric(c, 'views');
  if (col === 'lastSyncedAt') return syncedAgo(c.lastSyncedAt, language) ?? '';
  return formatMetric(c, col);
}

/** /analytics/youtube below 768px. The page keeps every hook and number. */
export function YouTubeOverviewPhone(props: YouTubeOverviewPhoneProps) {
  const {
    total,
    channels,
    clientOptions,
    query,
    onQuery,
    clientFilter,
    onClientFilter,
    days,
    onDays,
    status,
    onStatus,
    counts,
    sortColumn,
    sortDirection,
    onSortColumn,
    onToggleDirection,
    dimmed,
  } = props;
  const { t, i18n } = useTranslation('analyticsYoutube');
  const [sortOpen, setSortOpen] = useState(false);
  const sortButtonRef = useRef<HTMLButtonElement>(null);

  const clientLabel =
    clientFilter === 'all'
      ? t('overview.allClients')
      : (clientOptions.find((c) => String(c.clientId) === clientFilter)?.clientName ??
        t('overview.allClients'));
  const statusLabel = (s: YtStatusFilter) =>
    s === 'all'
      ? t('overview.statusAll', { count: counts.all })
      : t('overview.statusRevoked', { count: counts.revoked });
  const sortLabel = t(`overview.column.${sortColumn}`);

  const header = (
    <PhonePageHeader
      title={t('overview.title')}
      subtitle={`${t('overview.connected', { count: total })} · ${t('overview.periodDays', { count: days })}`}
    />
  );

  if (total === 0) {
    return (
      <div className="phone-kit phone-an">
        {header}
        <section className="phone-an-empty">
          <h2>{t('overview.emptyTitle')}</h2>
          <p>{t('overview.emptyBody')}</p>
          <Link to="/clientes" className="phone-an-link-button">
            {t('overview.emptyAction')}
          </Link>
        </section>
      </div>
    );
  }

  return (
    <div className="phone-kit phone-an">
      {header}

      <Input
        type="search"
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        aria-label={t('overview.search')}
        placeholder={t('overview.search')}
        className="h-10 rounded-full"
      />

      <div className="phone-an-chips">
        <PickerChip<string>
          label={t('overview.clientFilter')}
          valueLabel={clientLabel}
          options={clientOptions.map((c) => ({ value: String(c.clientId), label: c.clientName }))}
          value={clientFilter === 'all' ? null : clientFilter}
          onChange={(v) => onClientFilter(v ?? 'all')}
          emptyOption={{ label: t('overview.allClients') }}
          searchable={clientOptions.length > 8}
        />
        <PickerChip<number>
          label={t('overview.period')}
          valueLabel={t('overview.periodDays', { count: days })}
          options={PERIODS.map((p) => ({
            value: p,
            label: t('overview.periodDays', { count: p }),
          }))}
          value={days}
          onChange={(v) => v !== null && onDays(v as YtPortfolioDays)}
        />
        <PickerChip<YtStatusFilter>
          label={t('overview.statusFilter')}
          valueLabel={statusLabel(status)}
          options={(['all', 'revoked'] as const).map((s) => ({ value: s, label: statusLabel(s) }))}
          value={status}
          onChange={(v) => v !== null && onStatus(v)}
        />
      </div>

      <SectionHead
        large
        title={t('overview.channels')}
        trailing={
          channels.length > 0 ? (
            <button
              ref={sortButtonRef}
              type="button"
              className="phone-an-sort"
              aria-haspopup="dialog"
              aria-label={`${t('overview.sortBy')}: ${sortLabel}, ${sortDirection === 'asc' ? t('overview.sortAsc') : t('overview.sortDesc')}`}
              onClick={() => setSortOpen(true)}
            >
              <ArrowUpDown aria-hidden="true" />
              {sortLabel}
            </button>
          ) : undefined
        }
      />

      <div style={dimmedStyle(dimmed)} aria-busy={dimmed || undefined}>
        {channels.length === 0 ? (
          <p className="phone-an-tone--muted">{t('overview.noMatch')}</p>
        ) : (
          <GroupedList aria-label={t('overview.channels')}>
            {channels.map((c) => {
              const name = channelName(c) ?? c.clientName;
              const revoked = c.authorizationStatus === 'revoked';
              return (
                <Cell
                  key={c.clientId}
                  to={`/analytics/${c.clientId}/youtube`}
                  icon={<Avatar src={c.avatarUrl} initials={initialsOf(name)} />}
                  label={name}
                  subtitle={
                    <>
                      {c.clientName} ·{' '}
                      {revoked ? (
                        <span className="phone-an-badge phone-an-badge--warn">
                          {t('overview.reconnect')}
                        </span>
                      ) : (
                        (syncedAgo(c.lastSyncedAt, i18n.language) ?? t('overview.neverSynced'))
                      )}
                    </>
                  }
                  value={
                    <span className="phone-an-row-value">
                      {cellValue(c, sortColumn, i18n.language)}
                    </span>
                  }
                />
              );
            })}
          </GroupedList>
        )}
      </div>

      <p className="phone-an-tone--muted" style={{ fontSize: '0.75rem', margin: '0.75rem 0 0' }}>
        {t('overview.perChannel')}
      </p>
      <p className="phone-an-tone--muted" style={{ fontSize: '0.75rem', margin: '0.25rem 0 0' }}>
        {t('footer')}
      </p>

      <ActionSheet
        open={sortOpen}
        onOpenChange={setSortOpen}
        title={t('overview.sortBy')}
        returnFocusRef={sortButtonRef}
        actions={[
          ...SORT_COLS.map((col) => ({
            label: t(`overview.column.${col}`),
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
