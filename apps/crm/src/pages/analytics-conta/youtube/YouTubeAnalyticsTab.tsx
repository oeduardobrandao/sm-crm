import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { enUS, ptBR } from 'date-fns/locale';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { PageSkeleton } from '@/components/ui/skeletons';
import { GoogleServiceError, syncGoogleProduct } from '../../../services/google';
import {
  YouTubeNotConnectedError,
  type AnalyticsRange,
  type YouTubeContentType,
  type YtOverview,
} from '../../../services/youtubeAnalytics';
import { sanitizeUrl } from '../../../utils/security';
import { LockedCard, StateCard } from '../AnalyticsStateCards';
import { cardState } from './YouTubeCardFrame';
import { YouTubeKpiGrid } from './YouTubeKpiGrid';
import { YouTubeDailyViewsChart } from './YouTubeDailyViewsChart';
import { YouTubeSplitCard } from './YouTubeSplitCard';
import { YouTubeTrafficCard } from './YouTubeTrafficCard';
import { YouTubeAudienceCard } from './YouTubeAudienceCard';
import { YouTubeTopShorts } from './YouTubeTopShorts';
import {
  DEFAULT_VIDEO_SORT,
  YouTubeVideosTable,
  type YtVideoTableSort,
} from './YouTubeVideosTable';
import { YouTubeAnalyticsTabPhone, type YouTubePhoneFrame } from './YouTubeAnalyticsTabPhone';
import {
  channelUrl,
  dimmed,
  formatCount,
  throughInSentence,
  lagging,
  windowDaysOf,
  YT_DEFAULT_RANGE,
  YT_MAX_CUSTOM_DAYS,
  YT_PERIOD_PRESETS,
  customRange,
  presetDays,
  rangeDays,
} from './youtubeTabFormat';
import { isYouTubeTabQuery, useYouTubeTabData } from './useYouTubeTabData';

const CONTENT_TYPES: YouTubeContentType[] = ['all', 'shorts', 'long'];

/**
 * `/analytics/:id/youtube`: the client's YouTube channel (mockup board 3). One period and one
 * content type for the whole tab. Below 768px it renders `YouTubeAnalyticsTabPhone`, which
 * owns the phone frame and shares this tab's state, queries and sync.
 */
export function YouTubeAnalyticsTab({
  clientId,
  phoneFrame,
}: {
  clientId: number;
  /** Phone only: who the page is about and the shell's tab control. */
  phoneFrame?: YouTubePhoneFrame;
}) {
  const { t, i18n } = useTranslation('analyticsYoutube');
  const qc = useQueryClient();
  const isPhone = !useIsDesktop(768);
  const [range, setRange] = useState<AnalyticsRange>(YT_DEFAULT_RANGE);
  const [type, setType] = useState<YouTubeContentType>('all');
  const [sort, setSort] = useState<YtVideoTableSort>(DEFAULT_VIDEO_SORT);
  const [syncing, setSyncing] = useState(false);
  const data = useYouTubeTabData(clientId, range, type, sort.col);
  const { overview, daily, traffic, demographics, videos, topShorts } = data;
  const redesSociais = `/clientes/${clientId}/redes-sociais`;

  const handleSync = async () => {
    setSyncing(true);
    try {
      await syncGoogleProduct('youtube', clientId);
      toast.success(t('states.syncSuccess'));
      await Promise.all([
        qc.invalidateQueries({ predicate: isYouTubeTabQuery(clientId) }),
        // The Redes sociais card's last sync.
        qc.invalidateQueries({ queryKey: ['googleSummary', clientId] }),
      ]);
    } catch (e) {
      const code = e instanceof GoogleServiceError ? e.code : null;
      toast.error(
        code === 'rate_limited'
          ? t('states.syncRateLimited')
          : code === 'reconnect'
            ? t('states.revokedBody')
            : t('states.syncError'),
      );
      // The overview carries authorizationStatus: refetch it so the reconnect callout shows.
      if (code === 'reconnect') await qc.invalidateQueries({ queryKey: ['yt-overview', clientId] });
    } finally {
      setSyncing(false);
    }
  };

  // The shell always passes the frame on phones; without one there is no identity to head the page.
  if (isPhone && phoneFrame) {
    return (
      <YouTubeAnalyticsTabPhone
        clientId={clientId}
        frame={phoneFrame}
        data={data}
        range={range}
        onRange={setRange}
        type={type}
        onType={setType}
        sort={sort}
        onSort={setSort}
        syncing={syncing}
        onSync={handleSync}
      />
    );
  }

  if (overview.isPending) return <PageSkeleton body="report" header={false} />;

  if (overview.isError && !overview.data) {
    if (overview.error instanceof YouTubeNotConnectedError) {
      return (
        <StateCard
          title={t('states.notConnectedTitle')}
          body={t('states.notConnectedBody')}
          action={
            <Button asChild>
              <Link to={redesSociais}>{t('states.connectAction')}</Link>
            </Button>
          }
        />
      );
    }
    if (data.locked) {
      return (
        <LockedCard
          title={t('states.lockedTitle')}
          body={t('states.locked')}
          actionLabel={t('states.lockedAction')}
        />
      );
    }
    // The period may be what failed (a long custom window), so it stays changeable.
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <YouTubePeriodBar range={range} onChange={setRange} anchor={null} />
        <StateCard
          title={t('states.error')}
          action={
            <Button variant="outline" onClick={() => overview.refetch()}>
              {t('states.retry')}
            </Button>
          }
        />
      </div>
    );
  }

  const ov = overview.data!;
  const channel = ov.channel;
  const revoked = channel.authorizationStatus === 'revoked';
  const windowDays = windowDaysOf(ov, range);
  const contentLag = lagging(channel.contentTypeThrough, channel.dataThrough);
  // Data, but no Shorts x long split yet: those cards say so instead of reading 0%.
  const splitUnavailable = !!channel.dataThrough && !channel.contentTypeThrough;
  const trafficLag = lagging(channel.trafficThrough, channel.dataThrough);
  const videosLag = lagging(channel.videosThrough, channel.dataThrough);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div className="flex flex-wrap items-center justify-between gap-3 animate-up">
        <ChannelIdentity channel={channel} />
        <div className="flex flex-wrap items-center gap-3">
          {!revoked && channel.dataThrough && (
            <YouTubePeriodBar range={range} onChange={setRange} anchor={channel.dataThrough} />
          )}
          {!revoked && (
            <Button variant="outline" size="sm" disabled={syncing} onClick={handleSync}>
              {syncing ? <Spinner size="sm" /> : <RefreshCw className="h-4 w-4" />}
              {t('header.sync')}
            </Button>
          )}
        </div>
      </div>

      {revoked && (
        <div
          className="analytics-callout analytics-callout--with-icon animate-up"
          role="status"
          style={{ borderColor: 'var(--warning)' }}
        >
          <AlertTriangle
            className="h-5 w-5 analytics-callout__icon"
            style={{ color: 'var(--warning)' }}
            aria-hidden
          />
          <div className="analytics-callout__body">
            <span className="analytics-callout__title">{t('states.revokedTitle')}</span>
            <p className="analytics-callout__text">{t('states.revokedBody')}</p>
            <Button asChild size="sm" variant="outline" style={{ alignSelf: 'flex-start' }}>
              <Link to={redesSociais}>{t('states.reconnectAction')}</Link>
            </Button>
          </div>
        </div>
      )}

      {!channel.dataThrough ? (
        // A revoked channel's history is purged: the callout above is the whole state.
        revoked ? null : (
          <StateCard
            title={t('states.firstSyncTitle')}
            body={t('states.firstSyncBody')}
            action={null}
          />
        )
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 animate-up">
            <ContentTypeTabs type={type} onChange={setType} />
            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
              {t('header.dataThrough', {
                date: throughInSentence(channel.dataThrough, i18n.language),
              })}
            </span>
          </div>

          <div style={dimmed(overview.isPlaceholderData)} aria-busy={overview.isPlaceholderData}>
            <YouTubeKpiGrid
              kpis={ov.kpis}
              windowDays={windowDays}
              // A type's series ends at contentTypeThrough: only the full one sums the window.
              daily={type === 'all' ? daily.data : undefined}
            />
          </div>

          <YouTubeDailyViewsChart
            daily={daily.data ?? []}
            type={type}
            windowDays={windowDays}
            lagThrough={contentLag}
            splitUnavailable={splitUnavailable}
            state={cardState(daily)}
          />

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: '1.5rem',
              alignItems: 'start',
            }}
          >
            <div style={dimmed(overview.isPlaceholderData)}>
              <YouTubeSplitCard
                split={ov.split}
                lagThrough={contentLag}
                unavailable={splitUnavailable}
              />
            </div>
            <YouTubeTrafficCard
              rows={traffic.data ?? []}
              lagThrough={trafficLag}
              state={cardState(traffic)}
            />
            <YouTubeAudienceCard rows={demographics.data ?? []} state={cardState(demographics)} />
          </div>

          <YouTubeTopShorts
            shorts={topShorts.data ?? []}
            lagThrough={videosLag}
            state={cardState(topShorts)}
          />

          <YouTubeVideosTable
            videos={videos.data ?? []}
            sort={sort}
            onSort={setSort}
            lagThrough={videosLag}
            state={cardState(videos)}
          />

          <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', margin: 0 }}>
            {t('footer')}
          </p>
        </>
      )}
    </div>
  );
}

/** Avatar, channel name (linking to the channel), subscriber count and last sync. */
function ChannelIdentity({ channel }: { channel: YtOverview['channel'] }) {
  const { t, i18n } = useTranslation('analyticsYoutube');
  const dateLocale = i18n.language.startsWith('en') ? enUS : ptBR;
  const avatar = channel.avatarUrl?.startsWith('https://') ? channel.avatarUrl : null;
  const url = channelUrl(channel.handle);
  const name = channel.title ?? channel.handle ?? '';
  return (
    <p className="flex flex-wrap items-center gap-2" style={{ margin: 0 }}>
      {avatar && (
        <img
          src={sanitizeUrl(avatar)}
          alt=""
          style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }}
        />
      )}
      {url ? (
        <a
          href={sanitizeUrl(url)}
          target="_blank"
          rel="noopener noreferrer"
          className="conta-identity__handle-link"
        >
          {name}
        </a>
      ) : (
        <span>{name}</span>
      )}
      {channel.subscriberCount !== null && (
        <span style={{ color: 'var(--text-muted)' }}>
          {`· ${t('header.subscribers', { value: formatCount(channel.subscriberCount) })}`}
        </span>
      )}
      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
        {channel.lastSyncedAt
          ? t('header.syncedAgo', {
              time: formatDistanceToNow(new Date(channel.lastSyncedAt), { locale: dateLocale }),
            })
          : t('header.neverSynced')}
      </span>
    </p>
  );
}

/**
 * 7 / 28 / 90 dias and Personalizado: a day count (1-365, committed on Enter) ending at the
 * channel's last data day. Without that day (an overview error) only the presets show.
 */
function YouTubePeriodBar({
  range,
  onChange,
  anchor,
}: {
  range: AnalyticsRange;
  onChange: (range: AnalyticsRange) => void;
  /** The channel's `dataThrough`: where a custom window ends. */
  anchor: string | null;
}) {
  const { t } = useTranslation('analyticsYoutube');
  const preset = presetDays(range);
  const [customOpen, setCustomOpen] = useState(preset === null);
  const customActive = !!anchor && (customOpen || preset === null);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="page-tabs page-tabs--inline" role="tablist" aria-label={t('period.label')}>
        {YT_PERIOD_PRESETS.map((d) => {
          const active = !customActive && preset === d;
          return (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={active}
              className={`page-tab${active ? ' active' : ''}`}
              onClick={() => {
                setCustomOpen(false);
                onChange({ days: d });
              }}
            >
              {t('period.days', { count: d })}
            </button>
          );
        })}
        {anchor && (
          <button
            type="button"
            role="tab"
            aria-selected={customActive}
            className={`page-tab${customActive ? ' active' : ''}`}
            onClick={() => setCustomOpen(true)}
          >
            {t('period.custom')}
          </button>
        )}
      </div>
      {customActive && anchor && (
        <Input
          type="number"
          min={1}
          max={YT_MAX_CUSTOM_DAYS}
          defaultValue={preset === null ? rangeDays(range) : undefined}
          placeholder={t('period.customPlaceholder')}
          aria-label={t('period.customAria')}
          className="!rounded-full !text-xs h-9 w-[130px] mb-0"
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            const val = parseInt((e.target as HTMLInputElement).value, 10);
            if (isNaN(val) || val < 1 || val > YT_MAX_CUSTOM_DAYS) {
              toast.error(t('period.customInvalid'));
              return;
            }
            onChange(customRange(val, anchor));
          }}
        />
      )}
    </div>
  );
}

/** Tudo / Shorts / Vídeos longos: scopes the KPIs, the daily chart and the overview. */
function ContentTypeTabs({
  type,
  onChange,
}: {
  type: YouTubeContentType;
  onChange: (type: YouTubeContentType) => void;
}) {
  const { t } = useTranslation('analyticsYoutube');
  return (
    <div className="page-tabs page-tabs--inline" role="tablist" aria-label={t('contentType.label')}>
      {CONTENT_TYPES.map((c) => (
        <button
          key={c}
          type="button"
          role="tab"
          aria-selected={type === c}
          className={`page-tab${type === c ? ' active' : ''}`}
          onClick={() => onChange(c)}
        >
          {t(`contentType.${c}`)}
        </button>
      ))}
    </div>
  );
}
