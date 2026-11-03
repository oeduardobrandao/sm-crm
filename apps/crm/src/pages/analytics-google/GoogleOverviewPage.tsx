import { useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowUpDown, Eye, MapPin, MessageSquarePlus, MousePointerClick, Star } from 'lucide-react';
import { StatCard, type StatDelta } from '@/components/StatCard';
import { StatCardGrid } from '@/components/StatCardGrid';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { makeDelta } from '../../services/analytics';
import {
  getGbpPortfolio,
  type GbpKpiEntry,
  type GbpPortfolio,
  type GbpPortfolioDays,
} from '../../services/gbpAnalytics';
import {
  formatGbpCount,
  formatNoteDate,
  formatRating,
  formatRatingDelta,
  windowDays,
} from '../analytics-conta/google/gbpTabFormat';
import {
  AttentionReviews,
  AttentionUnits,
  GBP_PORTFOLIO_PERIODS,
  UNIT_SORT_KEY,
  highlightCards,
  reconnectHref,
  unitHref,
  updatedAgo,
  viewsChange,
  type ClientOption,
} from './GbpOverviewSections';
import {
  attentionUnits,
  sortUnits,
  specialtyStatsFor,
  type GbpSpecialtyStat,
  type GbpUnitSortCol,
} from './gbpOverviewModel';
import { GoogleOverviewPhone } from './phone/GoogleOverviewPhone';

/** `/analytics/google`: every Google Meu Negócio unit of the workspace's active clients. */
export default function GoogleOverviewPage() {
  const { features, isLoading } = useWorkspaceLimits();
  // Ships dark behind feature_google_business: without it the page does not exist (no paywall;
  // ProtectedRoute already gates feature_analytics_reports). An unresolved plan never fetches.
  if (isLoading) return <PageSkeleton body="report" />;
  if (features?.feature_google_business !== true) return <Navigate to="/analytics" replace />;
  return <GoogleOverviewContent />;
}

function GoogleOverviewContent() {
  const { t, i18n } = useTranslation('analyticsGoogle');
  const navigate = useNavigate();
  const [days, setDays] = useState<GbpPortfolioDays>(30);
  const [clientId, setClientId] = useState<number | null>(null);
  const [sortColumn, setSortColumn] = useState<GbpUnitSortCol>('profileViews');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [clientOptions, setClientOptions] = useState<ClientOption[]>([]);
  // Phones (below 768px) get the phone layout; tablet and desktop keep this one.
  const isPhone = !useIsDesktop(768);

  const { data, isLoading, error, refetch, isPlaceholderData } = useQuery({
    queryKey: ['gbp-portfolio', days, clientId],
    queryFn: () => (clientId === null ? getGbpPortfolio(days) : getGbpPortfolio(days, clientId)),
    placeholderData: keepPreviousData,
  });

  // The server narrows the response to the filtered client, so the filter's options come from
  // the last unfiltered answer.
  useEffect(() => {
    if (!data || isPlaceholderData || clientId !== null) return;
    const byId = new Map<number, string>();
    for (const u of data.units) byId.set(u.clientId, u.clientName);
    setClientOptions(
      [...byId.entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    );
  }, [data, isPlaceholderData, clientId]);

  const filterControls = (
    <>
      <Select
        value={clientId === null ? 'all' : String(clientId)}
        onValueChange={(v) => setClientId(v === 'all' ? null : parseInt(v, 10))}
      >
        <SelectTrigger
          aria-label={t('overview.clientFilter')}
          className="!rounded-full !text-xs h-9 px-4 mb-0 w-auto"
        >
          <SelectValue placeholder={t('overview.allClients')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t('overview.allClients')}</SelectItem>
          {clientOptions.map((c) => (
            <SelectItem key={c.id} value={String(c.id)}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={String(days)} onValueChange={(v) => setDays(Number(v) as GbpPortfolioDays)}>
        <SelectTrigger
          aria-label={t('overview.period')}
          className="!rounded-full !text-xs h-9 px-4 mb-0 w-auto min-w-[130px] shrink-0"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {GBP_PORTFOLIO_PERIODS.map((p) => (
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

  const units = data.units;
  const sortedUnits = sortUnits(units, sortColumn, sortDirection, t('filters.untitledUnit'));
  const highlights = highlightCards(t, units);
  const attention = attentionUnits(units);
  const specialtyStats = specialtyStatsFor(units);
  const span = windowDays(data.window);
  const dataThroughNote = data.dataThrough
    ? t('overview.dataThrough', { date: formatNoteDate(data.dataThrough, i18n.language) })
    : null;
  // Nothing connected at all (not just an empty filter): say where to connect.
  const empty = clientId === null && units.length === 0 && !isPlaceholderData;

  const kpiGrid = <PortfolioKpis portfolio={data} windowDays={span} />;

  if (isPhone) {
    return (
      <GoogleOverviewPhone
        portfolio={data}
        empty={empty}
        sortedUnits={sortedUnits}
        clientOptions={clientOptions}
        clientId={clientId}
        onClientId={setClientId}
        days={days}
        onDays={setDays}
        kpis={kpiGrid}
        highlights={highlights}
        attention={attention}
        specialtyStats={specialtyStats}
        dataThroughNote={dataThroughNote}
        sortColumn={sortColumn}
        sortDirection={sortDirection}
        onSortColumn={(col) => {
          setSortColumn(col);
          setSortDirection(col === 'title' ? 'asc' : 'desc');
        }}
        onToggleDirection={() => setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))}
        dimmed={isPlaceholderData}
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

  if (empty) {
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

  const handleSort = (col: GbpUnitSortCol) => {
    if (sortColumn === col) setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    else {
      setSortColumn(col);
      setSortDirection(col === 'title' ? 'asc' : 'desc');
    }
  };

  const renderSortableHead = (col: GbpUnitSortCol, align: 'left' | 'right' = 'right') => (
    <TableHead
      aria-sort={
        sortColumn === col ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'
      }
      style={{ whiteSpace: 'nowrap', textAlign: align }}
    >
      {/* A real button, so the sort works from the keyboard too. */}
      <button
        type="button"
        onClick={() => handleSort(col)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          background: 'none',
          border: 0,
          padding: 0,
          font: 'inherit',
          color: 'inherit',
          cursor: 'pointer',
        }}
      >
        {t(UNIT_SORT_KEY[col])}
        <ArrowUpDown
          aria-hidden="true"
          className="h-3 w-3"
          style={{
            opacity: sortColumn === col ? 1 : 0.3,
            transform: sortColumn === col && sortDirection === 'desc' ? 'scaleY(-1)' : 'none',
          }}
        />
      </button>
    </TableHead>
  );

  const num = (v: number) => formatGbpCount(v);
  const right = { textAlign: 'right' as const };

  return (
    <div
      className="page-content"
      style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
      aria-busy={isPlaceholderData}
    >
      {header}

      {/* Under Vidro the filters sit in the toolbar (actions), not on a row of their own. */}
      {!inToolbar && (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>{filterControls}</div>
      )}

      {dataThroughNote && (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: 0 }}>
          {dataThroughNote}
        </p>
      )}

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
          opacity: isPlaceholderData ? 0.6 : 1,
          transition: 'opacity 150ms',
        }}
      >
        {kpiGrid}

        {highlights.length > 0 && (
          <section aria-label={t('overview.highlights')} className="animate-up">
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem' }}>
              {t('overview.highlights')}
            </h3>
            <StatCardGrid maxCols={4}>
              {highlights.map((h) => (
                <StatCard
                  key={h.key}
                  label={h.label}
                  icon={h.icon}
                  tone={h.tone}
                  compactValue
                  value={h.name}
                  sub={`${h.clientName} · ${h.sub}`}
                />
              ))}
            </StatCardGrid>
          </section>
        )}

        <AttentionReviews reviews={data.reviewsAttention} days={days} />

        <AttentionUnits units={attention} />

        <div className="card animate-up" style={{ minWidth: 0 }}>
          <div className="dashboard-hub-card-header">
            <div>
              <h3>{t('overview.unitsTitle')}</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '0.25rem 0 0' }}>
                {t('overview.unitsSub')}
              </p>
            </div>
          </div>
          {units.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', marginTop: '1rem' }}>
              {t('overview.unitsEmpty')}
            </p>
          ) : (
            <div className="overflow-x-auto" style={{ marginTop: '1rem' }}>
              <Table>
                <TableHeader>
                  <TableRow>
                    {renderSortableHead('title', 'left')}
                    {renderSortableHead('profileViews')}
                    {renderSortableHead('calls')}
                    {renderSortableHead('directions')}
                    {renderSortableHead('websiteClicks')}
                    {renderSortableHead('messages')}
                    {renderSortableHead('avgRating')}
                    {renderSortableHead('newReviews')}
                    {renderSortableHead('lastSyncedAt')}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedUnits.map((u) => {
                    const change = viewsChange(u);
                    return (
                      <TableRow
                        key={u.id}
                        onClick={() => navigate(unitHref(u.clientId))}
                        style={{ cursor: 'pointer' }}
                      >
                        <TableCell>
                          <Link
                            to={unitHref(u.clientId)}
                            onClick={(e) => e.stopPropagation()}
                            style={{ color: 'inherit', textDecoration: 'none', fontWeight: 600 }}
                          >
                            {u.title || t('filters.untitledUnit')}
                          </Link>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {u.clientName}
                          </div>
                        </TableCell>
                        <TableCell style={{ ...right, whiteSpace: 'nowrap' }}>
                          {num(u.profileViews)}
                          {change && (
                            <span
                              style={{
                                marginLeft: 6,
                                fontSize: '0.75rem',
                                color: change.startsWith('+')
                                  ? 'var(--success)'
                                  : change.startsWith('-')
                                    ? 'var(--danger-text)'
                                    : 'var(--text-muted)',
                              }}
                            >
                              {change}
                            </span>
                          )}
                        </TableCell>
                        <TableCell style={right}>{num(u.calls)}</TableCell>
                        <TableCell style={right}>{num(u.directions)}</TableCell>
                        <TableCell style={right}>{num(u.websiteClicks)}</TableCell>
                        <TableCell style={right}>{num(u.messages)}</TableCell>
                        <TableCell style={{ ...right, whiteSpace: 'nowrap' }}>
                          {u.avgRating === null
                            ? t('units.noRating')
                            : `★ ${formatRating(u.avgRating)}`}
                        </TableCell>
                        <TableCell style={right}>
                          {u.newReviews === null ? t('states.noData') : num(u.newReviews)}
                        </TableCell>
                        <TableCell style={{ ...right, whiteSpace: 'nowrap' }}>
                          {u.status === 'revoked' ? (
                            <Link
                              to={reconnectHref(u.clientId)}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {t('overview.attentionReconnect')}
                            </Link>
                          ) : (
                            <>
                              {u.stale && (
                                <Badge variant="warning" size="sm" style={{ marginRight: 6 }}>
                                  {t('overview.attentionStale')}
                                </Badge>
                              )}
                              <span style={{ color: 'var(--text-muted)' }}>
                                {updatedAgo(u, t, i18n.language)}
                              </span>
                            </>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {specialtyStats.length > 0 && (
          <div className="card animate-up">
            <div className="dashboard-hub-card-header">
              <h3>{t('overview.bySpecialty')}</h3>
            </div>
            <div style={{ marginTop: '0.75rem' }}>
              {specialtyStats.map((s) => (
                <SpecialtyRow key={s.specialty} stat={s} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Pieces ─────────────────────────────────────────────────────────────

function deltaOf(entry: GbpKpiEntry, caption: string, asDiff = false): StatDelta | undefined {
  if (entry.value === null || entry.prev === null) return undefined;
  const { direction, deltaPercent, delta } = makeDelta(entry.value, entry.prev);
  return { direction, percent: asDiff ? delta : deltaPercent, caption };
}

/** The five portfolio KPIs (board 2): the same rules as the client tab's cards. */
function PortfolioKpis({
  portfolio,
  windowDays: span,
}: {
  portfolio: GbpPortfolio;
  windowDays: number;
}) {
  const { t } = useTranslation('analyticsGoogle');
  const { kpis } = portfolio;
  const caption = t('kpi.vsPrevious', { count: span });
  const count = (e: GbpKpiEntry) =>
    e.value === null ? t('states.noData') : formatGbpCount(e.value);

  const views = deltaOf(kpis.profileViews, caption);
  const actions = deltaOf(kpis.actions, caption);
  // New reviews are a small count: the difference ("+5"), not a percent, as on the client tab.
  const newReviews = deltaOf(kpis.newReviews, caption, true);
  const rating = kpis.avgRating;
  const ratingCompared = rating.value !== null && rating.prev !== null;

  return (
    <StatCardGrid className="analytics-kpi-scroll animate-up" maxCols={5}>
      <StatCard
        label={t('overview.kpiUnits')}
        icon={MapPin}
        tone="blue"
        value={kpis.units}
        sub={
          kpis.revokedUnits > 0
            ? t('overview.kpiUnitsReconnect', { count: kpis.revokedUnits })
            : t('overview.kpiUnitsAllActive')
        }
      />
      <StatCard
        label={t('overview.kpiViews')}
        icon={Eye}
        tone="violet"
        value={count(kpis.profileViews)}
        delta={views}
        unit="%"
        sub={t('overview.kpiViewsSub')}
        footNote={views ? <span>{t('overview.kpiViewsSub')}</span> : undefined}
      />
      <StatCard
        label={t('overview.kpiActions')}
        icon={MousePointerClick}
        tone="green"
        value={count(kpis.actions)}
        delta={actions}
        unit="%"
        sub={t('overview.kpiActionsSub')}
        footNote={actions ? <span>{t('overview.kpiActionsSub')}</span> : undefined}
      />
      <StatCard
        label={t('overview.kpiRating')}
        icon={Star}
        tone="amber"
        value={rating.value === null ? t('states.noData') : formatRating(rating.value)}
        sub={t('overview.kpiRatingSub')}
        footNote={
          ratingCompared ? (
            <span>
              {t('kpi.ratingDelta', {
                count: span,
                delta: formatRatingDelta((rating.value as number) - (rating.prev as number)),
              })}
            </span>
          ) : undefined
        }
      />
      <StatCard
        label={t('overview.kpiNewReviews')}
        icon={MessageSquarePlus}
        tone="pink"
        value={count(kpis.newReviews)}
        delta={newReviews}
        unit=""
        sub={t('overview.kpiNewReviewsSub')}
        footNote={newReviews ? <span>{t('overview.kpiNewReviewsSub')}</span> : undefined}
      />
    </StatCardGrid>
  );
}

function SpecialtyRow({ stat }: { stat: GbpSpecialtyStat }) {
  const { t } = useTranslation('analyticsGoogle');
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1rem',
        padding: '0.5rem 0',
        borderBottom: '1px solid var(--border-color)',
      }}
    >
      <div>
        <strong>{stat.specialty}</strong>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
          {t('overview.specialtyUnits', { count: stat.count })}
        </span>
      </div>
      <div style={{ textAlign: 'right', fontSize: '0.8rem' }}>
        <div>
          {stat.avgRating === null ? t('units.noRating') : `★ ${formatRating(stat.avgRating)}`}
        </div>
        <div style={{ color: 'var(--text-muted)' }}>
          {t('overview.specialtyViews', { value: formatGbpCount(Math.round(stat.viewsPerUnit)) })}
          {' · '}
          {t('overview.specialtyActions', {
            value: formatGbpCount(Math.round(stat.actionsPerUnit)),
          })}
        </div>
      </div>
    </div>
  );
}
