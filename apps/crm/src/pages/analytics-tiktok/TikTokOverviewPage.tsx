import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  Eye,
  Film,
  Heart,
  RefreshCw,
  SlidersHorizontal,
  TrendingUp,
  Trophy,
  Users,
  Zap,
} from 'lucide-react';
import { StatCard } from '@/components/StatCard';
import { StatCardGrid } from '@/components/StatCardGrid';
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { UpgradeLockedScreen } from '@/components/paywall/UpgradeLockedScreen';
import { usePageToolbar } from '@/components/layout/PageToolbarContext';
import { PhonePageHeader } from '@/components/mobile/PhonePageHeader';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { HelpTooltip } from '../../components/help/HelpTooltip';
import { useWorkspaceLimits } from '../../hooks/useWorkspaceLimits';
import { syncTikTokData } from '../../services/tiktok';
import {
  getTikTokPortfolio,
  getTikTokPortfolioAI,
  type TikTokPortfolioRow,
  type TikTokPortfolioVideo,
} from '../../services/tiktokAnalytics';
import { sanitizeUrl } from '../../utils/security';
import {
  AIPortfolioSection,
  AnalyticsHighlights,
  BenchmarkChart,
  type AnalyticsHighlight,
} from '../analytics/AnalyticsPage';
import {
  ACCOUNT_SORT_COLS,
  VIDEO_ORDERS,
  daysSince,
  engagementVariant,
  formatDay,
  formatNumber,
  formatPct,
  initialsOf,
  isSilent,
  leaderOf,
  rankVideos,
  sortAccounts,
  specialtyStatsFor,
  syncSummary,
  totalsFor,
  useVideoDrawer,
  type AccountSortCol,
  type SpecialtyStat,
  type SyncResult,
  type TFn,
  type VideoDrawerState,
} from './overviewModel';
import { TikTokOverviewPhone } from './phone/TikTokOverviewPhone';

const PERIODS = [7, 28, 90] as const;

const SORT_KEY: Record<AccountSortCol, string> = {
  client_name: 'table.client',
  follower_count: 'table.followers',
  engagement_rate: 'table.engagementShort',
  views: 'table.views',
  posts_count: 'table.posts',
  last_posted_at: 'table.lastPost',
};

const ORDER_KEY = {
  views: 'drawer.sortViews',
  likes: 'drawer.sortLikes',
  engagement: 'drawer.sortEngagement',
  date: 'drawer.sortDate',
} as const;

/** `/analytics/tiktok`: the TikTok twin of the Instagram portfolio page. */
export default function TikTokOverviewPage() {
  const { t } = useTranslation('analyticsTiktok');
  const { features, isLoading } = useWorkspaceLimits();
  // Same screen ProtectedRoute shows a gated route (it already covers feature_analytics_reports
  // for every /analytics path). Fails closed: an unresolved plan never reaches the fetch.
  if (isLoading) return <PageSkeleton body="report" />;
  if (features?.feature_tiktok !== true) {
    return (
      <UpgradeLockedScreen featureLabel={t('overview.lockedLabel')} feature="feature_tiktok" />
    );
  }
  return <TikTokOverviewContent />;
}

function TikTokOverviewContent() {
  const { t, i18n } = useTranslation('analyticsTiktok');
  const [days, setDays] = useState<number>(28);
  const [clienteFilter, setClienteFilter] = useState('all');
  const [sortColumn, setSortColumn] = useState<AccountSortCol>('engagement_rate');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  // Phones (below 768px) get the phone layout; tablet and desktop keep this one.
  const isPhone = !useIsDesktop(768);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['tiktok-portfolio', days],
    queryFn: () => getTikTokPortfolio(days),
  });

  const ranked = data ? rankVideos(data) : { best: [], worst: [] };
  const drawer = useVideoDrawer(ranked.best, ranked.worst);

  const accounts = data?.accounts ?? [];
  const clientOptions = [...accounts].sort((a, b) =>
    a.client_name.localeCompare(b.client_name, 'pt-BR'),
  );

  const handleSyncAll = async () => {
    // An expired or revoked authorization cannot sync; the card says to reconnect instead.
    const syncable = accounts.filter((a) => a.authorization_status === 'active');
    if (!syncable.length) return;
    setSyncing(true);
    setSyncResult(null);
    let success = 0;
    const failedNames: string[] = [];
    await Promise.allSettled(
      syncable.map((a) =>
        syncTikTokData(a.client_id)
          .then(() => success++)
          .catch(() => failedNames.push(a.client_name)),
      ),
    );
    setSyncing(false);
    setSyncResult({ success, failed: failedNames.length, failedNames });
    refetch();
  };

  const syncResultText = syncResult ? (
    <span
      style={{
        fontSize: '0.8rem',
        color: syncResult.failed > 0 ? 'var(--warning)' : 'var(--success)',
      }}
    >
      {syncSummary(t, syncResult)}
    </span>
  ) : null;
  const canSync = accounts.some((a) => a.authorization_status === 'active');
  const syncButton = (
    <Button onClick={handleSyncAll} disabled={syncing || !canSync} size="sm" variant="outline">
      <RefreshCw className={`h-4 w-4${syncing ? ' animate-spin' : ''}`} />
      {syncing ? t('overview.syncing') : t('overview.sync')}
    </Button>
  );

  const filterControls = (
    <>
      <Select value={clienteFilter} onValueChange={setClienteFilter}>
        <SelectTrigger
          aria-label={t('overview.clientFilter')}
          className="!rounded-full !text-xs h-9 px-4 mb-0 w-auto"
        >
          <SelectValue placeholder={t('overview.allClients')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t('overview.allClients')}</SelectItem>
          {clientOptions.map((a) => (
            <SelectItem key={a.client_id} value={String(a.client_id)}>
              {a.client_name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
        <SelectTrigger
          aria-label={t('overview.period')}
          className="!rounded-full !text-xs h-9 px-4 mb-0 w-auto min-w-[130px] shrink-0"
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
    isLoading
      ? null
      : {
          title: t('overview.title'),
          actions: (
            <>
              {filterControls}
              {syncResultText}
            </>
          ),
          primary: syncButton,
        },
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

  const filteredAccounts =
    clienteFilter === 'all'
      ? data.accounts
      : data.accounts.filter((a) => String(a.client_id) === clienteFilter);
  const sortedAccounts = sortAccounts(filteredAccounts, sortColumn, sortDirection);
  const silentAccounts = filteredAccounts.filter(isSilent);
  const totals = totalsFor(filteredAccounts, data.totals, clienteFilter !== 'all');
  const specialtyStats = specialtyStatsFor(filteredAccounts);
  const needReconnect = filteredAccounts.filter((a) => a.authorization_status !== 'active').length;

  const highlights = buildHighlights(t, filteredAccounts);

  const silentChips = silentAccounts.map((a) => {
    const d = daysSince(a.last_posted_at);
    return (
      <Link
        key={a.client_id}
        to={`/analytics/${a.client_id}/tiktok`}
        className="silent-account-chip"
      >
        <AccountAvatar row={a} size={24} />
        <span>{a.client_name}</span>
        <span className="badge badge-warning badge--sm">
          {d !== null ? t('overview.silentDays', { count: d }) : t('overview.silentNever')}
        </span>
      </Link>
    );
  });

  const kpiGrid = (
    <StatCardGrid
      className="analytics-kpi-scroll animate-up"
      maxCols={inToolbar && highlights.length > 0 ? 6 : 5}
    >
      <StatCard
        label={t('overview.kpiAccounts')}
        icon={Film}
        tone="pink"
        value={totals.accounts}
        sub={
          needReconnect > 0
            ? t('overview.kpiAccountsReconnect', { count: needReconnect })
            : t('overview.kpiAccountsAllActive')
        }
      />
      <StatCard
        label={t('overview.kpiFollowers')}
        icon={Users}
        tone="blue"
        value={totals.followers === null ? t('states.noData') : formatNumber(totals.followers)}
        sub={t('overview.kpiFollowersSub')}
      />
      <StatCard
        label={t('overview.kpiViews')}
        icon={Eye}
        tone="violet"
        value={totals.views === null ? t('states.noData') : formatNumber(totals.views)}
        sub={<ViewsSub text={t('overview.kpiViewsSub')} tooltip={t('kpi.views.tooltip')} />}
      />
      <StatCard
        label={t('overview.kpiEngagement')}
        icon={Heart}
        tone="amber"
        value={formatPct(totals.engagement_rate)}
        sub={
          <ViewsSub text={t('overview.kpiEngagementSub')} tooltip={t('kpi.engagementTooltip')} />
        }
      />
      <StatCard
        label={t('overview.kpiPosts')}
        icon={Film}
        tone="green"
        value={formatNumber(totals.posts_count)}
        sub={t('overview.kpiPostsSub')}
      />
      {inToolbar ? (
        highlights.length > 0 && (
          <AnalyticsHighlights items={highlights} title={t('overview.leaders')} />
        )
      ) : (
        <>
          {highlights.map((h) => (
            <StatCard
              key={h.key}
              label={h.label}
              icon={h.icon}
              tone={h.tone}
              compactValue
              value={h.name}
              sub={h.sub}
            />
          ))}
        </>
      )}
    </StatCardGrid>
  );

  const aiLoader = () => getTikTokPortfolioAI(days);

  if (isPhone) {
    return (
      <TikTokOverviewPhone
        accounts={filteredAccounts}
        sortedAccounts={sortedAccounts}
        clientOptions={clientOptions}
        clienteFilter={clienteFilter}
        onClienteFilter={setClienteFilter}
        days={days}
        onDays={setDays}
        syncing={syncing}
        canSync={canSync}
        onSync={handleSyncAll}
        syncResult={syncResult}
        silentAccounts={silentAccounts}
        kpis={kpiGrid}
        bestVideos={ranked.best}
        worstVideos={ranked.worst}
        sortColumn={sortColumn}
        sortDirection={sortDirection}
        onSortColumn={(col) => {
          setSortColumn(col);
          setSortDirection('desc');
        }}
        onToggleDirection={() => setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))}
        specialtyStats={specialtyStats}
        drawer={drawer}
        aiLoader={aiLoader}
      />
    );
  }

  // Nothing connected: say where to connect instead of an empty dashboard.
  if (data.accounts.length === 0) {
    return (
      <div
        className="page-content"
        style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
      >
        {!inToolbar && (
          <header className="header header--flush animate-up">
            <div className="header-title">
              <h1>{t('overview.title')}</h1>
            </div>
          </header>
        )}
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

  const handleSort = (col: AccountSortCol) => {
    if (sortColumn === col) setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    else {
      setSortColumn(col);
      setSortDirection('desc');
    }
  };

  const renderSortableHead = (col: AccountSortCol) => (
    <TableHead onClick={() => handleSort(col)} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        {t(SORT_KEY[col])}
        <ArrowUpDown
          className="h-3 w-3"
          style={{
            opacity: sortColumn === col ? 1 : 0.3,
            transform: sortColumn === col && sortDirection === 'desc' ? 'scaleY(-1)' : 'none',
          }}
        />
      </div>
    </TableHead>
  );

  const benchmarkEntries = filteredAccounts
    .filter((a) => a.engagement_rate !== null)
    .map((a) => ({ client_name: a.client_name, engagement_rate_avg: a.engagement_rate as number }));

  return (
    <div className="page-content" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {!inToolbar && (
        <header className="header header--flush animate-up">
          <div className="header-title">
            <h1>{t('overview.title')}</h1>
          </div>
          <div className="header-actions">
            {syncResultText}
            {syncButton}
          </div>
        </header>
      )}

      {/* Under Vidro the filters sit in the toolbar (actions), not on a row of their own. */}
      {!inToolbar && (
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>{filterControls}</div>
      )}

      {silentAccounts.length > 0 && inToolbar && (
        <SilentAccountsLine names={silentAccounts.map((a) => a.client_name)}>
          {silentChips}
        </SilentAccountsLine>
      )}
      {silentAccounts.length > 0 && !inToolbar && (
        <div className="analytics-callout analytics-callout--with-icon animate-up" role="status">
          <AlertTriangle className="h-5 w-5 analytics-callout__icon" aria-hidden />
          <div className="analytics-callout__body">
            <div className="analytics-callout__title">
              {t('overview.silentAccounts')}
              <span className="analytics-callout__count">
                {t('overview.silentCount', { count: silentAccounts.length })}
              </span>
            </div>
            <div className="analytics-callout__chips">{silentChips}</div>
          </div>
        </div>
      )}

      {kpiGrid}

      <VideoStrip
        icon={<Trophy className="h-5 w-5" style={{ color: 'var(--success)' }} />}
        title={t('overview.topVideos')}
        help={t('overview.topVideosHint')}
        videos={ranked.best}
        tone="best"
        onSeeAll={() => drawer.open('best')}
      />
      <VideoStrip
        icon={<AlertTriangle className="h-5 w-5" style={{ color: 'var(--warning)' }} />}
        title={t('overview.bottomVideos')}
        help={t('overview.bottomVideosHint')}
        videos={ranked.worst}
        tone="worst"
        onSeeAll={() => drawer.open('worst')}
      />

      {/* Desktop table */}
      <div className="card animate-up analytics-desktop-table">
        <div className="dashboard-hub-card-header" style={{ marginBottom: '1rem' }}>
          <h3>{t('overview.allAccounts')}</h3>
        </div>
        {filteredAccounts.length === 0 ? (
          <p style={{ color: 'var(--text-muted)' }}>{t('table.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {renderSortableHead('client_name')}
                  {renderSortableHead('follower_count')}
                  {renderSortableHead('engagement_rate')}
                  {renderSortableHead('views')}
                  {renderSortableHead('posts_count')}
                  {renderSortableHead('last_posted_at')}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedAccounts.map((a) => {
                  const d = daysSince(a.last_posted_at);
                  const silent = d === null || d > 7;
                  const gained = a.followers_gained ?? 0;
                  return (
                    <TableRow key={a.client_id}>
                      <TableCell data-label={t('table.client')}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <AccountAvatar row={a} size={32} />
                          <div>
                            <Link
                              to={`/analytics/${a.client_id}/tiktok`}
                              style={{ color: 'inherit', textDecoration: 'none' }}
                            >
                              <strong style={{ cursor: 'pointer' }}>{a.client_name}</strong>
                            </Link>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              {a.username ? `@${a.username}` : '—'}
                              {a.authorization_status !== 'active' && (
                                <Badge
                                  variant="warning"
                                  style={{ marginLeft: 6, fontSize: '0.6rem', padding: '0 0.4rem' }}
                                >
                                  {t('states.expiredTitle')}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell data-label={t('table.followers')}>
                        {a.follower_count === null ? '—' : formatNumber(a.follower_count)}
                        {gained !== 0 && (
                          <span
                            style={{
                              color: gained > 0 ? 'var(--success)' : 'var(--danger-text)',
                              fontSize: '0.75rem',
                              marginLeft: 4,
                            }}
                          >
                            {gained > 0 ? '↑' : '↓'}
                            {formatNumber(Math.abs(gained))}
                          </span>
                        )}
                      </TableCell>
                      <TableCell data-label={t('table.engagementShort')}>
                        <Badge variant={engagementVariant(a.engagement_rate)}>
                          {formatPct(a.engagement_rate)}
                        </Badge>
                      </TableCell>
                      <TableCell data-label={t('table.views')}>
                        {a.views === null ? '—' : formatNumber(a.views)}
                      </TableCell>
                      <TableCell data-label={t('table.posts')}>{a.posts_count}</TableCell>
                      <TableCell data-label={t('table.lastPost')}>
                        <span style={{ color: silent ? 'var(--danger-text)' : 'var(--text-main)' }}>
                          {d === null ? t('table.never') : t('table.daysAgo', { count: d })}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Mobile cards */}
      <div className="analytics-mobile-cards">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '0.5rem',
          }}
        >
          <h3
            style={{
              fontFamily: 'var(--font-heading)',
              fontSize: '1.1rem',
              fontWeight: 600,
              margin: 0,
            }}
          >
            {t('overview.allAccounts')}
          </h3>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 shrink-0 mb-0"
                aria-label={t('table.sortBy')}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>{t('table.sortBy')}</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={sortColumn}
                onValueChange={(v) => {
                  setSortColumn(v as AccountSortCol);
                  setSortDirection('desc');
                }}
              >
                {ACCOUNT_SORT_COLS.map((col) => (
                  <DropdownMenuRadioItem key={col} value={col}>
                    {t(SORT_KEY[col])}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))}
              >
                <ArrowUpDown className="h-4 w-4 mr-2" />
                {sortDirection === 'asc' ? t('table.sortDesc') : t('table.sortAsc')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {filteredAccounts.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{t('table.empty')}</p>
        ) : (
          sortedAccounts.map((a) => {
            const d = daysSince(a.last_posted_at);
            const silent = d === null || d > 7;
            const gained = a.followers_gained ?? 0;
            return (
              <Link
                key={a.client_id}
                to={`/analytics/${a.client_id}/tiktok`}
                className="team-card card animate-up"
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                  <AccountAvatar row={a} size={40} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        flexWrap: 'wrap',
                      }}
                    >
                      <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{a.client_name}</span>
                      <Badge
                        variant={engagementVariant(a.engagement_rate)}
                        style={{ fontSize: '0.6rem', padding: '0 0.4rem' }}
                      >
                        {formatPct(a.engagement_rate)}
                      </Badge>
                    </div>
                    <div
                      style={{
                        fontSize: '0.75rem',
                        color: 'var(--text-muted)',
                        display: 'flex',
                        gap: '0.35rem',
                        flexWrap: 'wrap',
                        marginTop: 2,
                      }}
                    >
                      <span>
                        {t('table.followersAbbrev', { value: formatNumber(a.follower_count) })}
                      </span>
                      {gained !== 0 && (
                        <span
                          style={{ color: gained > 0 ? 'var(--success)' : 'var(--danger-text)' }}
                        >
                          {gained > 0 ? '↑' : '↓'}
                          {formatNumber(Math.abs(gained))}
                        </span>
                      )}
                      <span>&bull;</span>
                      <span>{t('table.viewsCount', { value: formatNumber(a.views) })}</span>
                      <span>&bull;</span>
                      <span style={{ color: silent ? 'var(--danger-text)' : undefined }}>
                        {d === null ? t('table.never') : t('table.daysAgo', { count: d })}
                      </span>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })
        )}
      </div>

      {filteredAccounts.length >= 2 && (
        <div className="widgets-grid animate-up">
          <div className="card">
            <div className="dashboard-hub-card-header">
              <h3>{t('overview.benchmark')}</h3>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0.25rem 0 0' }}>
              {t('overview.benchmarkNote')}
            </p>
            <div style={{ marginTop: '1rem' }}>
              <BenchmarkChart accounts={benchmarkEntries} />
            </div>
          </div>

          {specialtyStats.length >= 2 && (
            <div className="card">
              <div className="dashboard-hub-card-header">
                <h3>{t('overview.bySpecialty')}</h3>
              </div>
              <div style={{ marginTop: '1rem' }}>
                {specialtyStats.map((s) => (
                  <SpecialtyRow key={s.specialty ?? '__none'} stat={s} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <AIPortfolioSection accounts={filteredAccounts} loader={aiLoader} />

      <VideosSheet drawer={drawer} language={i18n.language} />
    </div>
  );
}

// ─── Pieces ─────────────────────────────────────────────────────────────

function ViewsSub({ text, tooltip }: { text: string; tooltip: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {text}
      <HelpTooltip content={tooltip} />
    </span>
  );
}

function buildHighlights(t: TFn, rows: TikTokPortfolioRow[]): AnalyticsHighlight[] {
  const out: AnalyticsHighlight[] = [];
  const bestEngagement = leaderOf(rows, (r) => r.engagement_rate);
  if (bestEngagement) {
    out.push({
      key: 'engagement',
      label: t('overview.leaderEngagement'),
      icon: Heart,
      tone: 'green',
      name: bestEngagement.client_name,
      sub: formatPct(bestEngagement.engagement_rate),
      short: formatPct(bestEngagement.engagement_rate),
    });
  }
  const growth = leaderOf(rows, (r) => r.followers_gained);
  if (growth && (growth.followers_gained ?? 0) > 0) {
    const value = formatNumber(growth.followers_gained);
    out.push({
      key: 'growth',
      label: t('overview.leaderGrowth'),
      icon: TrendingUp,
      tone: 'amber',
      name: growth.client_name,
      sub: t('overview.leaderGrowthSub', { value }),
      short: `+${value}`,
    });
  }
  const views = leaderOf(rows, (r) => r.views);
  if (views && (views.views ?? 0) > 0) {
    const value = formatNumber(views.views);
    out.push({
      key: 'views',
      label: t('overview.leaderViews'),
      icon: Eye,
      tone: 'blue',
      name: views.client_name,
      sub: t('overview.leaderViewsSub', { value }),
      short: value,
    });
  }
  const followers = leaderOf(rows, (r) => r.follower_count);
  if (followers) {
    const value = formatNumber(followers.follower_count);
    out.push({
      key: 'followers',
      label: t('overview.leaderFollowers'),
      icon: Users,
      tone: 'violet',
      name: followers.client_name,
      sub: t('overview.leaderFollowersSub', { value }),
      short: value,
    });
  }
  const posts = leaderOf(rows, (r) => r.posts_count);
  if (posts && posts.posts_count > 0) {
    out.push({
      key: 'posts',
      label: t('overview.leaderPosts'),
      icon: Zap,
      tone: 'slate',
      name: posts.client_name,
      sub: t('overview.leaderPostsSub', { count: posts.posts_count }),
      short: String(posts.posts_count),
    });
  }
  return out;
}

function AccountAvatar({ row, size }: { row: TikTokPortfolioRow; size: number }) {
  if (row.avatar_url?.startsWith('https://')) {
    return (
      <img
        src={row.avatar_url}
        alt=""
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover' }}
      />
    );
  }
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size < 30 ? '0.6rem' : '0.65rem' }}
    >
      {initialsOf(row.client_name)}
    </span>
  );
}

function SpecialtyRow({ stat }: { stat: SpecialtyStat }) {
  const { t } = useTranslation('analyticsTiktok');
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0.5rem 0',
        borderBottom: '1px solid var(--border-color,rgba(0,0,0,0.06))',
      }}
    >
      <div>
        <strong>{stat.specialty ?? t('overview.noSpecialty')}</strong>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
          {t('overview.accountCount', { count: stat.count })}
        </span>
      </div>
      <div style={{ textAlign: 'right' }}>
        <Badge variant={engagementVariant(stat.avgEngagement)}>
          {formatPct(stat.avgEngagement)}
        </Badge>
        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
          {t('overview.avgFollowers', { value: formatNumber(stat.avgFollowers) })}
        </div>
      </div>
    </div>
  );
}

const statRow = { display: 'flex', justifyContent: 'space-between' } as const;
const statLabel = { fontSize: '0.7rem', color: 'var(--text-muted)' } as const;
const statValue = { fontSize: '0.7rem', fontWeight: 700, fontFamily: 'var(--font-mono)' } as const;

/** One video of a "Melhores vídeos" / "Precisam de atenção" strip. */
function VideoCard({ video, tone }: { video: TikTokPortfolioVideo; tone: 'best' | 'worst' }) {
  const { t, i18n } = useTranslation('analyticsTiktok');
  const cover = video.cover_image_url ? sanitizeUrl(video.cover_image_url) : null;
  const body = (
    <>
      <div
        style={{
          aspectRatio: '3/4',
          position: 'relative',
          overflow: 'hidden',
          background: 'linear-gradient(135deg, #0f172a, #334155)',
        }}
      >
        {cover && (
          <img
            src={cover}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        )}
      </div>
      <div style={{ padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        <span
          style={{
            fontSize: '0.7rem',
            fontWeight: 600,
            color: 'var(--text-muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {video.client_name}
        </span>
        <span style={{ fontSize: '0.65rem', color: 'var(--text-light)' }}>
          {formatDay(video.posted_at, i18n.language)}
        </span>
        <div style={statRow}>
          <span style={statLabel}>{t('table.views')}</span>
          <span
            style={{
              ...statValue,
              color: tone === 'best' ? 'var(--success)' : 'var(--danger-text)',
            }}
          >
            {formatNumber(video.views)}
          </span>
        </div>
        <div style={statRow}>
          <span style={statLabel}>{t('table.engagementShort')}</span>
          <span style={statValue}>{formatPct(video.engagement_rate)}</span>
        </div>
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 3,
            fontSize: '0.65rem',
            color: 'var(--text-muted)',
            marginTop: 2,
          }}
        >
          <Heart className="h-3 w-3" aria-hidden />
          <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-main)' }}>
            {formatNumber(video.likes)}
          </strong>
        </span>
      </div>
    </>
  );
  // A video the API gave no link for still shows its numbers.
  return video.share_url ? (
    <a
      href={sanitizeUrl(video.share_url)}
      target="_blank"
      rel="noopener noreferrer"
      className="analytics-post-card"
      aria-label={t('drawer.videoLabel', {
        client: video.client_name,
        views: formatNumber(video.views),
      })}
    >
      {body}
    </a>
  ) : (
    <div className="analytics-post-card">{body}</div>
  );
}

function VideoStrip({
  icon,
  title,
  help,
  videos,
  tone,
  onSeeAll,
}: {
  icon: ReactNode;
  title: string;
  help: string;
  videos: TikTokPortfolioVideo[];
  tone: 'best' | 'worst';
  onSeeAll: () => void;
}) {
  const { t } = useTranslation('analyticsTiktok');
  if (videos.length === 0) return null;
  return (
    <div className="card animate-up">
      <div className="dashboard-hub-card-header" style={{ marginBottom: '1rem' }}>
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {icon}
          {title}
          <HelpTooltip content={help} />
        </h3>
        {videos.length > 5 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onSeeAll}
            style={{ fontSize: '0.75rem', gap: '0.25rem' }}
          >
            {t('overview.seeAll')} <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      <div className="analytics-posts-row">
        {videos.slice(0, 5).map((v) => (
          <VideoCard key={`${v.client_id}:${v.tiktok_video_id}`} video={v} tone={tone} />
        ))}
      </div>
    </div>
  );
}

/** The "all videos" side sheet: order, client and date filters. No format filter. */
function VideosSheet({ drawer, language }: { drawer: VideoDrawerState; language: string }) {
  const { t } = useTranslation('analyticsTiktok');
  const best = drawer.mode === 'best';
  return (
    <Sheet
      open={drawer.mode !== null}
      onOpenChange={(open) => {
        if (!open) drawer.close();
      }}
    >
      <SheetContent side="right" className="!w-full !max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {best ? (
              <Trophy className="h-5 w-5" style={{ color: 'var(--success)' }} />
            ) : (
              <AlertTriangle className="h-5 w-5" style={{ color: 'var(--warning)' }} />
            )}
            {best ? t('drawer.titleBest') : t('drawer.titleWorst')}
          </SheetTitle>
          <SheetDescription>
            {t('drawer.count', { shown: drawer.videos.length, total: drawer.total })}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-3 grid gap-2 border-b border-border pb-3">
          <div className="grid grid-cols-[minmax(0,1fr)_2.25rem] items-center gap-2">
            <Select
              value={drawer.orderBy}
              onValueChange={(v) => drawer.setOrderBy(v as (typeof VIDEO_ORDERS)[number])}
            >
              <SelectTrigger aria-label={t('table.sortBy')} className="h-9 rounded-lg text-sm">
                <SelectValue placeholder={t('table.sortBy')} />
              </SelectTrigger>
              <SelectContent>
                {VIDEO_ORDERS.map((o) => (
                  <SelectItem key={o} value={o}>
                    {t(ORDER_KEY[o])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              onClick={() => drawer.setAsc(!drawer.asc)}
              className="mb-0 h-9 w-9 shrink-0 rounded-lg"
              title={drawer.asc ? t('table.sortAsc') : t('table.sortDesc')}
              aria-label={drawer.asc ? t('table.sortAsc') : t('table.sortDesc')}
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
            </Button>
          </div>
          <Select value={drawer.client} onValueChange={drawer.setClient}>
            <SelectTrigger
              aria-label={t('overview.clientFilter')}
              className="h-9 rounded-lg text-sm"
            >
              <SelectValue placeholder={t('overview.clientFilter')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('overview.allClients')}</SelectItem>
              {drawer.clients.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
            <Input
              type="date"
              aria-label={t('table.date')}
              value={drawer.dateFrom}
              onChange={(e) => drawer.setDateFrom(e.target.value)}
              className="h-9 rounded-lg font-mono text-sm"
            />
            <span className="text-sm text-muted-foreground">{t('drawer.until')}</span>
            <Input
              type="date"
              aria-label={`${t('table.date')} (${t('drawer.until')})`}
              value={drawer.dateTo}
              onChange={(e) => drawer.setDateTo(e.target.value)}
              className="h-9 rounded-lg font-mono text-sm"
            />
          </div>
          {(drawer.dateFrom || drawer.dateTo) && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  drawer.setDateFrom('');
                  drawer.setDateTo('');
                }}
                className="text-xs font-medium text-destructive"
              >
                {t('drawer.clearDates')}
              </button>
            </div>
          )}
        </div>

        <div
          style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.75rem' }}
        >
          {drawer.videos.length === 0 && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{t('drawer.empty')}</p>
          )}
          {drawer.videos.map((v, i) => (
            <VideoRow
              key={`${v.client_id}:${v.tiktok_video_id}`}
              video={v}
              rank={i + 1}
              language={language}
            />
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function VideoRow({
  video,
  rank,
  language,
}: {
  video: TikTokPortfolioVideo;
  rank: number;
  language: string;
}) {
  const { t } = useTranslation('analyticsTiktok');
  const cover = video.cover_image_url ? sanitizeUrl(video.cover_image_url) : null;
  const style = {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.6rem 0.75rem',
    borderRadius: 12,
    border: '1px solid var(--border-color)',
    background: 'var(--card-bg)',
    textDecoration: 'none',
    color: 'inherit',
  } as const;
  const content = (
    <>
      <span
        style={{
          fontSize: '0.75rem',
          fontWeight: 700,
          fontFamily: 'var(--font-mono)',
          color: 'var(--text-muted)',
          minWidth: 24,
          textAlign: 'center',
        }}
      >
        {rank}
      </span>
      <span
        style={{
          width: 48,
          height: 48,
          borderRadius: 8,
          flexShrink: 0,
          overflow: 'hidden',
          background: 'linear-gradient(135deg, #0f172a, #334155)',
        }}
      >
        {cover && (
          <img
            src={cover}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        )}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span
            style={{
              fontSize: '0.8rem',
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {video.client_name}
          </span>
          <span style={{ fontSize: '0.65rem', color: 'var(--text-light)', flexShrink: 0 }}>
            {formatDay(video.posted_at, language)}
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            gap: '0.75rem',
            fontSize: '0.7rem',
            color: 'var(--text-muted)',
            marginTop: 2,
            flexWrap: 'wrap',
          }}
        >
          <span>
            {t('table.views')}{' '}
            <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-main)' }}>
              {formatNumber(video.views)}
            </strong>
          </span>
          <span>
            {t('table.engagementShort')}{' '}
            <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-main)' }}>
              {formatPct(video.engagement_rate)}
            </strong>
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
            <Heart className="h-3 w-3" aria-hidden />
            <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-main)' }}>
              {formatNumber(video.likes)}
            </strong>
          </span>
        </div>
      </div>
    </>
  );
  return video.share_url ? (
    <a href={sanitizeUrl(video.share_url)} target="_blank" rel="noopener noreferrer" style={style}>
      {content}
    </a>
  ) : (
    <div style={style}>{content}</div>
  );
}

/** Vidro: "Contas silenciosas" as one line; the account chips open below on demand. */
function SilentAccountsLine({ names, children }: { names: string[]; children: ReactNode }) {
  const { t } = useTranslation('analyticsTiktok');
  const [open, setOpen] = useState(false);
  const shown =
    names.length === 1
      ? names[0]
      : names.length <= 3
        ? t('overview.silentNamesAnd', {
            names: names.slice(0, -1).join(', '),
            last: names[names.length - 1],
          })
        : t('overview.silentNamesMore', {
            names: names.slice(0, 3).join(', '),
            count: names.length - 3,
          });
  return (
    <div className="analytics-silent-line animate-up" role="status">
      <div className="analytics-silent-line__row">
        <AlertTriangle className="h-4 w-4 analytics-silent-line__icon" aria-hidden />
        <strong className="analytics-silent-line__title">
          {t('overview.silentCount', { count: names.length })}
        </strong>
        <span className="analytics-silent-line__names">
          {t('overview.silentSummary', { names: shown })}
        </span>
        <button
          type="button"
          className="analytics-silent-line__toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? t('overview.silentHide') : t('overview.silentShow')}
          <ChevronDown className={`h-3.5 w-3.5${open ? ' rotate-180' : ''}`} aria-hidden />
        </button>
      </div>
      {open && <div className="analytics-callout__chips">{children}</div>}
    </div>
  );
}
