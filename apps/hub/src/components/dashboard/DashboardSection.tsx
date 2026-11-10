import { lazy, Suspense, useEffect, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useHub } from '../../HubContext';
import { hubDashboardQuery } from '../../queries';
import { formatDayMonth, syncAge } from '../../lib/dashboardFormat';
import type { DashboardPlatform, HubAccountSummary, HubDashboardResponse } from '../../types';
import { PeriodSelector } from './PeriodSelector';
import { TopPostsRow } from './TopPostsRow';
import { TopVideosRow } from './TopVideosRow';
import { PlatformSwitch } from './PlatformSwitch';
import { AccountStatusPill } from './AccountStatusPill';
import { DASHBOARD_SECTION_ID } from './useDashboardPlatform';
import { SectionHeader } from '../SectionHeader';

const loadCharts = () => import('./DashboardCharts');
const DashboardCharts = lazy(loadCharts);

const chartSkeleton = (
  <>
    <div className="h-[280px] rounded-2xl hub-bg-soft animate-pulse" />
    <div className="h-[280px] rounded-2xl hub-bg-soft animate-pulse" />
  </>
);

/** Calendar-day difference b - a for two YYYY-MM-DD strings, DST-proof. */
function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

function localDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function AccountLine({ account, locale }: { account: HubAccountSummary; locale: string }) {
  const { t } = useTranslation('hubHome');
  const age = syncAge(account.lastSyncedAt, new Date());
  const day = (iso: string) => formatDayMonth(iso, locale);
  let sync: string | null;
  if (account.state === 'needs_reconnect') {
    sync = account.lastSyncedAt
      ? t('accounts.sync.last', 'Última atualização em {{date}}', {
          date: day(account.lastSyncedAt),
        })
      : null;
  } else if (age.kind === 'minutes') {
    sync = t('accounts.sync.minutes', 'Atualizado há {{n}} min', { n: age.n });
  } else if (age.kind === 'hours') {
    sync = t('accounts.sync.hours', 'Atualizado há {{n}} h', { n: age.n });
  } else if (age.kind === 'date') {
    sync = t('accounts.sync.date', 'Atualizado em {{date}}', { date: day(age.iso) });
  } else {
    sync = t('accounts.sync.never', 'Aguardando a primeira atualização');
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-5">
      {account.username && (
        <span className="min-w-0 truncate text-[13px] font-medium hub-tx2">
          @{account.username}
        </span>
      )}
      <AccountStatusPill state={account.state} />
      {sync && <span className="ml-auto text-[12.5px] hub-tx3">{sync}</span>}
    </div>
  );
}

const bodySkeleton = (
  <>
    <div className="flex gap-3 mb-6">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="min-w-[160px] h-[220px] rounded-2xl hub-bg-soft animate-pulse flex-shrink-0"
        />
      ))}
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{chartSkeleton}</div>
  </>
);

interface View {
  data: HubDashboardResponse;
  platform: DashboardPlatform;
}

/**
 * What a response can show. A TikTok answer without its `tiktok` block has no TikTok content:
 * it shows Instagram only when the response really carries Instagram detail, else nothing.
 * Instagram content never renders under a TikTok account line.
 */
function resolveView(data: HubDashboardResponse | undefined): View | null {
  if (!data) return null;
  if (data.platform !== 'tiktok') return { data, platform: 'instagram' };
  if (data.tiktok) return { data, platform: 'tiktok' };
  return data.account ? { data, platform: 'instagram' } : null;
}

export function DashboardSection({
  sectionNumber,
  selectedPlatform = null,
  onSelectPlatform,
}: {
  sectionNumber?: number;
  selectedPlatform?: DashboardPlatform | null;
  onSelectPlatform?: (p: DashboardPlatform | null) => void;
} = {}) {
  const { t, i18n } = useTranslation('hubHome');
  const locale = i18n.language === 'en' ? 'en-US' : 'pt-BR';
  const { token } = useHub();
  const [period, setPeriod] = useState(30);

  // Download the chart chunk alongside the dashboard request rather than after it.
  useEffect(() => {
    loadCharts().catch(() => {});
  }, []);

  // The strip's query: tells which platform is the default and, at period 30 with no
  // explicit pick, is the very cache entry this section reads (one request per visit).
  const base = useQuery(hubDashboardQuery(token, 30));
  const defaultPlatform = base.data?.platform;
  const requestKey: DashboardPlatform | 'default' =
    !selectedPlatform || !defaultPlatform || selectedPlatform === defaultPlatform
      ? 'default'
      : selectedPlatform;
  // The previous answer stays on screen as a placeholder while a new platform or period
  // loads, so the header (and the focused control in it) never unmounts.
  const own = useQuery({
    ...hubDashboardQuery(token, period, requestKey),
    placeholderData: keepPreviousData,
  });
  const pending = own.isPlaceholderData;

  // A failed explicit request falls back to the default view when that is available.
  // Only an error with nothing to show counts: a failed refetch keeps the data on screen.
  const ownView = own.isLoadingError ? null : resolveView(own.data);
  const view = ownView ?? resolveView(base.data);

  // The explicit request failed outright (not the shared default one): the data on screen is
  // the 30-day default, so put the controls back in line with it. The next click then issues
  // a fresh request instead of being a dead click on an already-selected value.
  const ownIsBase = period === 30 && requestKey === 'default';
  const resetAfterFailure = own.isLoadingError && !ownIsBase;
  useEffect(() => {
    if (!resetAfterFailure) return;
    setPeriod(30);
    onSelectPlatform?.(null);
  }, [resetAfterFailure, onSelectPlatform]);

  // A stored pick whose account is gone (disconnected mid-session).
  const baseAccounts = base.data?.accounts;
  const pickGone =
    !!selectedPlatform &&
    !!baseAccounts &&
    !baseAccounts.some((a) => a.platform === selectedPlatform);
  useEffect(() => {
    if (pickGone) onSelectPlatform?.(null);
  }, [pickGone, onSelectPlatform]);

  // A pick whose settled answer has no TikTok detail: back to the default.
  const pickMissing =
    selectedPlatform === 'tiktok' &&
    !pending &&
    own.data?.platform === 'tiktok' &&
    !own.data.tiktok;
  useEffect(() => {
    if (pickMissing) onSelectPlatform?.(null);
  }, [pickMissing, onSelectPlatform]);

  if (own.isLoading) {
    return (
      <div id={DASHBOARD_SECTION_ID} className="mb-12 scroll-mt-24 md:scroll-mt-6">
        <div className="flex justify-between items-center mb-5">
          <div className="h-7 w-36 rounded-lg hub-bg-soft animate-pulse" />
          <div className="h-8 w-32 rounded-lg hub-bg-soft animate-pulse" />
        </div>
        {bodySkeleton}
      </div>
    );
  }

  if (!view) return null;
  const { data, platform } = view;

  if (platform !== 'tiktok' && !data.account) {
    return (
      <div
        id={DASHBOARD_SECTION_ID}
        className="mb-12 scroll-mt-24 md:scroll-mt-6 hub-card p-8 text-center"
      >
        <p className="text-sm hub-tx3">
          {t('dashboard.connectInstagram', 'Conecte o Instagram para ver métricas de desempenho.')}
        </p>
      </div>
    );
  }

  const accounts = data.accounts ?? [];
  const account = accounts.find((a) => a.platform === platform);
  // The pick shows immediately; the data catches up once it arrives.
  const switchValue: DashboardPlatform = pending && selectedPlatform ? selectedPlatform : platform;

  const controls = (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {accounts.length === 2 && (
        <PlatformSwitch value={switchValue} onChange={(p) => onSelectPlatform?.(p)} />
      )}
      <PeriodSelector value={period} onChange={setPeriod} />
    </div>
  );

  let followerCaption: string | undefined;
  if (platform === 'tiktok' && data.tiktok) {
    const first = data.tiktok.followerHistory[0]?.date;
    if (first) {
      const start = new Date();
      start.setDate(start.getDate() - (period - 1));
      if (dayDiff(localDay(start), first) > 1) {
        followerCaption = t('followerChart.historySince', 'Histórico disponível desde {{date}}.', {
          date: formatDayMonth(first, locale),
        });
      }
    }
  }

  return (
    <div id={DASHBOARD_SECTION_ID} className="mb-12 scroll-mt-24 md:scroll-mt-6">
      {sectionNumber !== undefined ? (
        <SectionHeader
          number={sectionNumber}
          label={t('home.pauta.section.results', 'Resultados')}
          title={t('dashboard.title', 'Desempenho')}
          action={controls}
        />
      ) : (
        <div className="flex flex-wrap justify-between items-center gap-3 mb-5">
          <h2 className="font-display text-xl font-semibold tracking-tight hub-txt">
            {t('dashboard.title', 'Desempenho')}
          </h2>
          {controls}
        </div>
      )}

      {pending ? (
        <div aria-busy="true">{bodySkeleton}</div>
      ) : (
        <>
          {account && <AccountLine account={account} locale={locale} />}

          {platform === 'tiktok' && data.tiktok ? (
            <>
              <div className="mb-6">
                <h3 className="text-[13px] font-semibold hub-tx2 mb-3">
                  {t('dashboard.topVideosTitle', 'Melhores vídeos')}
                </h3>
                <TopVideosRow videos={data.tiktok.topVideos} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Suspense fallback={chartSkeleton}>
                  <DashboardCharts
                    platform="tiktok"
                    followerHistory={data.tiktok.followerHistory}
                    viewsHistory={data.tiktok.viewsHistory}
                    followerCaption={followerCaption}
                  />
                </Suspense>
              </div>
            </>
          ) : (
            <>
              <div className="mb-6">
                <h3 className="text-[13px] font-semibold hub-tx2 mb-3">
                  {t('dashboard.topPostsTitle', 'Melhores Posts')}
                </h3>
                <TopPostsRow posts={data.topPosts} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Suspense fallback={chartSkeleton}>
                  <DashboardCharts
                    platform="instagram"
                    followerHistory={data.followerHistory}
                    reachHistory={data.reachHistory}
                  />
                </Suspense>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
