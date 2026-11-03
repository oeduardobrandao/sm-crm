import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowUpDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PageSkeleton } from '@/components/ui/skeletons';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { usePageToolbar } from '@/components/layout/PageToolbarContext';
import { PhonePageHeader } from '@/components/mobile/PhonePageHeader';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useWorkspaceLimits } from '../../hooks/useWorkspaceLimits';
import {
  getYouTubePortfolio,
  type YtPortfolioChannel,
  type YtPortfolioDays,
} from '../../services/youtubeAnalytics';
import { sanitizeUrl } from '../../utils/security';
import { initialsOf } from '../analytics-tiktok/overviewModel';
import { MISSING } from '../analytics-conta/youtube/youtubeTabFormat';
import {
  METRIC_COLS,
  channelName,
  filterChannels,
  formatMetric,
  metricOf,
  shortsPct,
  sortChannels,
  statusCounts,
  syncedAgo,
  type YtChannelSortCol,
  type YtStatusFilter,
} from './youtubeOverviewModel';
import { YouTubeOverviewPhone } from './phone/YouTubeOverviewPhone';

const PERIODS: readonly YtPortfolioDays[] = [7, 28, 90];

/** `/analytics/youtube`: one row per channel, each over its own window. */
export default function YouTubeOverviewPage() {
  const { features, isLoading } = useWorkspaceLimits();
  // Same gate as the TikTok overview: without feature_youtube the page does not exist, and an
  // unresolved plan never reaches the fetch (ProtectedRoute gates feature_analytics_reports).
  if (isLoading) return <PageSkeleton body="report" />;
  if (features?.feature_youtube !== true) return <Navigate to="/analytics" replace />;
  return <YouTubeOverviewContent />;
}

function YouTubeOverviewContent() {
  const { t, i18n } = useTranslation('analyticsYoutube');
  const navigate = useNavigate();
  const [days, setDays] = useState<YtPortfolioDays>(28);
  const [query, setQuery] = useState('');
  const [clientFilter, setClientFilter] = useState('all');
  const [status, setStatus] = useState<YtStatusFilter>('all');
  const [sortColumn, setSortColumn] = useState<YtChannelSortCol>('views');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  // Phones (below 768px) get the phone layout; tablet and desktop keep this one.
  const isPhone = !useIsDesktop(768);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['youtube-portfolio', days],
    queryFn: () => getYouTubePortfolio(days),
  });

  const all = useMemo(() => data ?? [], [data]);
  const clientOptions = useMemo(
    () => [...all].sort((a, b) => a.clientName.localeCompare(b.clientName, 'pt-BR')),
    [all],
  );
  // The status chips count what the search and the client filter left, so each chip says how
  // many rows it would show.
  const counts = statusCounts(
    filterChannels(all, { query, clientId: clientFilter, status: 'all' }),
  );
  const sorted = sortChannels(
    filterChannels(all, { query, clientId: clientFilter, status }),
    sortColumn,
    sortDirection,
  );

  const searchInput = (
    <Input
      type="search"
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      aria-label={t('overview.search')}
      placeholder={t('overview.search')}
      className="!rounded-full !text-xs h-9 px-4 mb-0 w-[220px]"
    />
  );

  const filterControls = (
    <>
      {searchInput}
      <Select value={clientFilter} onValueChange={setClientFilter}>
        <SelectTrigger
          aria-label={t('overview.clientFilter')}
          className="!rounded-full !text-xs h-9 px-4 mb-0 w-auto"
        >
          <SelectValue placeholder={t('overview.allClients')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t('overview.allClients')}</SelectItem>
          {clientOptions.map((c) => (
            <SelectItem key={c.clientId} value={String(c.clientId)}>
              {c.clientName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={String(days)} onValueChange={(v) => setDays(Number(v) as YtPortfolioDays)}>
        <SelectTrigger
          aria-label={t('overview.period')}
          className="!rounded-full !text-xs h-9 px-4 mb-0 w-auto min-w-[110px] shrink-0"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PERIODS.map((p) => (
            <SelectItem key={p} value={String(p)}>
              {t('overview.periodDays', { count: p })}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );

  const inToolbar = usePageToolbar(
    isLoading ? null : { title: t('overview.title'), actions: filterControls },
  );

  if (isLoading) return <PageSkeleton body="report" />;

  if (error || !data) {
    const retry = (
      <Button variant="outline" size="sm" onClick={() => refetch()}>
        {t('states.retry')}
      </Button>
    );
    if (isPhone) {
      return (
        <div className="phone-kit phone-an">
          <PhonePageHeader title={t('overview.title')} />
          <p className="phone-an-error" role="alert">
            {t('states.error')}
          </p>
          {retry}
        </div>
      );
    }
    return (
      <div className="card" style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
        <p role="alert" style={{ color: 'var(--danger-text)', margin: 0 }}>
          {t('states.error')}
        </p>
        {retry}
      </div>
    );
  }

  if (isPhone) {
    return (
      <YouTubeOverviewPhone
        total={data.length}
        channels={sorted}
        clientOptions={clientOptions}
        query={query}
        onQuery={setQuery}
        clientFilter={clientFilter}
        onClientFilter={setClientFilter}
        days={days}
        onDays={setDays}
        status={status}
        onStatus={setStatus}
        counts={counts}
        sortColumn={sortColumn}
        sortDirection={sortDirection}
        onSortColumn={(col) => {
          setSortColumn(col);
          setSortDirection(col === 'title' ? 'asc' : 'desc');
        }}
        onToggleDirection={() => setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))}
      />
    );
  }

  const header = !inToolbar && (
    <header className="header header--flush animate-up">
      <div className="header-title">
        <h1>{t('overview.title')}</h1>
      </div>
    </header>
  );

  // Nothing connected: say where to connect instead of an empty table.
  if (data.length === 0) {
    return (
      <div
        className="page-content"
        style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
      >
        {header}
        <div className="card animate-up" style={{ textAlign: 'center', padding: '3rem 1.5rem' }}>
          <h3>{t('overview.emptyTitle')}</h3>
          <p style={{ color: 'var(--text-muted)', margin: '0.5rem auto 1.25rem', maxWidth: 440 }}>
            {t('overview.emptyBody')}
          </p>
          <Button asChild>
            <Link to="/clientes">{t('overview.emptyAction')}</Link>
          </Button>
        </div>
      </div>
    );
  }

  const handleSort = (col: YtChannelSortCol) => {
    if (sortColumn === col) setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    else {
      setSortColumn(col);
      setSortDirection(col === 'title' ? 'asc' : 'desc');
    }
  };

  const renderSortableHead = (col: YtChannelSortCol, numeric: boolean) => {
    const active = sortColumn === col;
    return (
      <TableHead
        key={col}
        aria-sort={active ? (sortDirection === 'asc' ? 'ascending' : 'descending') : undefined}
        style={{ whiteSpace: 'nowrap', textAlign: numeric ? 'right' : 'left' }}
      >
        <button
          type="button"
          onClick={() => handleSort(col)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            font: 'inherit',
            color: 'inherit',
            background: 'none',
            border: 0,
            padding: 0,
            cursor: 'pointer',
          }}
        >
          {t(`overview.column.${col}`)}
          <ArrowUpDown
            className="h-3 w-3"
            aria-hidden
            style={{
              opacity: active ? 1 : 0.3,
              transform: active && sortDirection === 'desc' ? 'scaleY(-1)' : 'none',
            }}
          />
        </button>
      </TableHead>
    );
  };

  const statusButton = (value: YtStatusFilter, label: string) => (
    <Button
      size="sm"
      variant={status === value ? 'default' : 'outline'}
      aria-pressed={status === value}
      onClick={() => setStatus(value)}
      className="mb-0"
    >
      {label}
    </Button>
  );

  return (
    <div className="page-content" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {header}
      <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '0.875rem' }}>
        {t('overview.description')}
      </p>

      {/* Under Vidro the filters sit in the toolbar (actions), not on a row of their own. */}
      {!inToolbar && (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {filterControls}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '0.75rem',
          flexWrap: 'wrap',
        }}
      >
        <div
          role="group"
          aria-label={t('overview.statusFilter')}
          style={{ display: 'flex', gap: '0.5rem' }}
        >
          {statusButton('all', t('overview.statusAll', { count: counts.all }))}
          {statusButton('revoked', t('overview.statusRevoked', { count: counts.revoked }))}
        </div>
        <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
          {t('overview.connected', { count: data.length })}
        </span>
      </div>

      <div className="card animate-up">
        {sorted.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', margin: 0 }}>{t('overview.noMatch')}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {renderSortableHead('title', false)}
                  {METRIC_COLS.map((col) => renderSortableHead(col, col !== 'shortsShare'))}
                  {renderSortableHead('lastSyncedAt', true)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((c) => (
                  <ChannelRow
                    key={c.clientId}
                    channel={c}
                    language={i18n.language}
                    onOpen={() => navigate(`/analytics/${c.clientId}/youtube`)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: '0.75rem',
          flexWrap: 'wrap',
          fontSize: '0.75rem',
          color: 'var(--text-muted)',
        }}
      >
        <p style={{ margin: 0 }}>{t('overview.perChannel')}</p>
        <p style={{ margin: 0 }}>{t('footer')}</p>
      </div>
    </div>
  );
}

// ─── Pieces ─────────────────────────────────────────────────────────────

const right = { textAlign: 'right', whiteSpace: 'nowrap' } as const;

function ChannelRow({
  channel: c,
  language,
  onOpen,
}: {
  channel: YtPortfolioChannel;
  language: string;
  onOpen: () => void;
}) {
  const { t } = useTranslation('analyticsYoutube');
  const revoked = c.authorizationStatus === 'revoked';
  const net = metricOf(c, 'netSubscribers');
  const share = metricOf(c, 'shortsShare');
  const synced = syncedAgo(c.lastSyncedAt, language);
  const href = `/analytics/${c.clientId}/youtube`;
  return (
    <TableRow
      onClick={onOpen}
      style={{ cursor: 'pointer', color: revoked ? 'var(--text-muted)' : undefined }}
    >
      <TableCell data-label={t('overview.column.title')}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
          <ChannelAvatar channel={c} size={32} />
          <div style={{ minWidth: 0 }}>
            <Link
              to={href}
              onClick={(e) => e.stopPropagation()}
              style={{ color: 'var(--text-main)', textDecoration: 'none', fontWeight: 600 }}
            >
              {channelName(c) ?? c.clientName}
            </Link>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{c.clientName}</div>
          </div>
        </div>
      </TableCell>
      <TableCell data-label={t('overview.column.subscriberCount')} style={right}>
        {formatMetric(c, 'subscriberCount')}
      </TableCell>
      <TableCell
        data-label={t('overview.column.netSubscribers')}
        style={{
          ...right,
          color:
            net === null || net === 0
              ? undefined
              : net > 0
                ? 'var(--success)'
                : 'var(--danger-text)',
        }}
      >
        {formatMetric(c, 'netSubscribers')}
      </TableCell>
      <TableCell data-label={t('overview.column.views')} style={right}>
        {formatMetric(c, 'views')}
      </TableCell>
      <TableCell data-label={t('overview.column.watchHours')} style={right}>
        {formatMetric(c, 'watchHours')}
      </TableCell>
      <TableCell data-label={t('overview.column.shortsShare')} style={{ whiteSpace: 'nowrap' }}>
        {share === null ? MISSING : <ShortsBar pct={shortsPct(share)} />}
      </TableCell>
      <TableCell data-label={t('overview.column.avgViewDurationS')} style={right}>
        {formatMetric(c, 'avgViewDurationS')}
      </TableCell>
      <TableCell data-label={t('overview.column.lastSyncedAt')} style={right}>
        {revoked ? (
          <Badge variant="danger" size="sm">
            {t('overview.reconnect')}
          </Badge>
        ) : (
          (synced ?? t('overview.neverSynced'))
        )}
      </TableCell>
    </TableRow>
  );
}

function ShortsBar({ pct }: { pct: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span
        aria-hidden
        style={{
          width: 64,
          height: 6,
          borderRadius: 3,
          background: 'var(--surface-2)',
          overflow: 'hidden',
          display: 'inline-block',
        }}
      >
        <span
          style={{
            display: 'block',
            height: '100%',
            width: `${pct}%`,
            background: 'var(--text-main)',
          }}
        />
      </span>
      {`${pct}%`}
    </span>
  );
}

function ChannelAvatar({ channel, size }: { channel: YtPortfolioChannel; size: number }) {
  if (channel.avatarUrl?.startsWith('https://')) {
    return (
      <img
        src={sanitizeUrl(channel.avatarUrl)}
        alt=""
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover' }}
      />
    );
  }
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: '0.65rem' }}>
      {initialsOf(channelName(channel) ?? channel.clientName)}
    </span>
  );
}
