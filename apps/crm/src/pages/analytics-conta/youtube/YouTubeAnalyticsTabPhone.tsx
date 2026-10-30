import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { formatDistanceToNow } from 'date-fns';
import { enUS, ptBR } from 'date-fns/locale';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { PhoneNavBar } from '@/components/mobile/PhoneNavBar';
import { PhoneIconButton } from '@/components/mobile/LargeTitleHeader';
import { SegmentedControl } from '@/components/mobile/SegmentedControl';
import { PageSkeleton } from '@/components/ui/skeletons';
import {
  YouTubeNotConnectedError,
  type AnalyticsRange,
  type YouTubeContentType,
  type YtOverview,
} from '../../../services/youtubeAnalytics';
import { sanitizeUrl } from '../../../utils/security';
import { Avatar } from '../../analytics/phone/shared';
import { PeriodSegmented } from '../../analytics/phone/PeriodControl';
import { BILLING_PATH } from '../AnalyticsStateCards';
import { cardState } from './YouTubeCardFrame';
import { YouTubeKpiGrid } from './YouTubeKpiGrid';
import { YouTubeDailyViewsChart } from './YouTubeDailyViewsChart';
import { YouTubeSplitCard } from './YouTubeSplitCard';
import { YouTubeTrafficCard } from './YouTubeTrafficCard';
import { YouTubeAudienceCard } from './YouTubeAudienceCard';
import { YouTubeTopShorts } from './YouTubeTopShorts';
import { YouTubeVideosTable, type YtVideoTableSort } from './YouTubeVideosTable';
import {
  channelUrl,
  dimmed,
  formatCount,
  throughInSentence,
  lagging,
  windowDaysOf,
  YT_MAX_CUSTOM_DAYS,
  YT_PERIOD_PRESETS,
  customRange,
  presetDays,
  rangeDays,
} from './youtubeTabFormat';
import type { useYouTubeTabData } from './useYouTubeTabData';

/** Who the page is about, plus the shell's tab control (same shape as the TikTok frame). */
export interface YouTubePhoneFrame {
  nome: string;
  cor?: string | null;
  /** Photo candidates, best first. */
  photo: readonly (string | null | undefined)[];
  tabs: ReactNode;
}

export interface YouTubeAnalyticsTabPhoneProps {
  clientId: number;
  frame: YouTubePhoneFrame;
  /** The desktop tab's queries: one data layer for both variants. */
  data: ReturnType<typeof useYouTubeTabData>;
  range: AnalyticsRange;
  onRange: (range: AnalyticsRange) => void;
  type: YouTubeContentType;
  onType: (type: YouTubeContentType) => void;
  sort: YtVideoTableSort;
  onSort: (sort: YtVideoTableSort) => void;
  syncing: boolean;
  onSync: () => void;
}

/** `/analytics/:id/youtube` below 768px: the TikTok phone pattern. */
export function YouTubeAnalyticsTabPhone(props: YouTubeAnalyticsTabPhoneProps) {
  const { t } = useTranslation('analyticsYoutube');
  const { clientId, frame, data, range, onRange, syncing, onSync } = props;
  const { overview } = data;
  const redesSociais = `/clientes/${clientId}/redes-sociais`;

  if (overview.isPending) {
    return (
      <Frame frame={frame}>
        <PageSkeleton body="report" header={false} />
      </Frame>
    );
  }

  if (overview.isError && !overview.data) {
    if (overview.error instanceof YouTubeNotConnectedError) {
      return (
        <Frame frame={frame}>
          <StateBlock
            title={t('states.notConnectedTitle')}
            body={t('states.notConnectedBody')}
            action={
              <Link to={redesSociais} className="phone-an-link-button">
                {t('states.connectAction')}
              </Link>
            }
          />
        </Frame>
      );
    }
    if (data.locked) {
      return (
        <Frame frame={frame}>
          <StateBlock
            title={t('states.locked')}
            action={
              <Link to={BILLING_PATH} className="phone-an-link-button">
                {t('states.lockedAction')}
              </Link>
            }
          />
        </Frame>
      );
    }
    return (
      <Frame frame={frame}>
        <PhonePeriod range={range} onRange={onRange} anchor={null} />
        <StateBlock
          title={t('states.error')}
          action={
            <button
              type="button"
              className="phone-an-link-button"
              onClick={() => overview.refetch()}
            >
              {t('states.retry')}
            </button>
          }
        />
      </Frame>
    );
  }

  const channel = overview.data!.channel;
  const revoked = channel.authorizationStatus === 'revoked';
  return (
    <Frame frame={frame} channel={channel} syncing={syncing} onSync={revoked ? undefined : onSync}>
      <PhoneBody {...props} overviewData={overview.data!} />
    </Frame>
  );
}

/** Nav bar (back, sync), the identity heading, the shell's tabs, then the tab's content. */
function Frame({
  frame,
  channel,
  syncing,
  onSync,
  children,
}: {
  frame: YouTubePhoneFrame;
  channel?: YtOverview['channel'];
  syncing?: boolean;
  onSync?: () => void;
  children: ReactNode;
}) {
  const { t, i18n } = useTranslation('analyticsYoutube');
  const dateLocale = i18n.language.startsWith('en') ? enUS : ptBR;
  const url = channel ? channelUrl(channel.handle) : null;
  const channelName = channel?.title ?? channel?.handle ?? '';
  return (
    <div className="phone-kit phone-an">
      <PhoneNavBar
        fallbackTo="/analytics"
        backLabel={t('header.back')}
        trailing={
          onSync ? (
            <PhoneIconButton
              label={t('header.sync')}
              onClick={onSync}
              disabled={syncing}
              aria-busy={syncing || undefined}
            >
              <RefreshCw aria-hidden="true" className={syncing ? 'phone-an-spin' : undefined} />
            </PhoneIconButton>
          ) : undefined
        }
      />

      <div className="phone-an-identity">
        <Avatar
          src={[
            ...frame.photo,
            channel?.avatarUrl?.startsWith('https://') ? channel.avatarUrl : null,
          ]}
          initials={frame.nome.slice(0, 2).toUpperCase()}
          color={frame.cor}
          large
        />
        <div className="phone-an-identity__text">
          <h1 className="phone-an-identity__name">{frame.nome}</h1>
          {channel && (
            <p className="phone-an-identity__meta">
              {url ? (
                <a href={sanitizeUrl(url)} target="_blank" rel="noopener noreferrer">
                  {channelName}
                </a>
              ) : (
                channelName
              )}
              <span className="phone-an-tone--muted">
                {channel.subscriberCount !== null &&
                  ` · ${t('header.subscribers', { value: formatCount(channel.subscriberCount) })}`}
                {' · '}
                {channel.lastSyncedAt
                  ? t('header.syncedAgo', {
                      time: formatDistanceToNow(new Date(channel.lastSyncedAt), {
                        locale: dateLocale,
                      }),
                    })
                  : t('header.neverSynced')}
              </span>
            </p>
          )}
        </div>
      </div>

      {frame.tabs}
      {children}
    </div>
  );
}

function StateBlock({ title, body, action }: { title: string; body?: string; action: ReactNode }) {
  return (
    <section className="phone-an-empty">
      <h2>{title}</h2>
      {body && <p>{body}</p>}
      {action}
    </section>
  );
}

/**
 * 7d / 28d / 90d plus Personalizado: a day count (1-365) ending at the channel's last data
 * day. Without that day (an overview error) only the presets show.
 */
function PhonePeriod({
  range,
  onRange,
  anchor,
}: {
  range: AnalyticsRange;
  onRange: (range: AnalyticsRange) => void;
  /** The channel's `dataThrough`: where a custom window ends. */
  anchor: string | null;
}) {
  const { t } = useTranslation('analyticsYoutube');
  const preset = presetDays(range);
  return (
    <PeriodSegmented
      aria-label={t('period.label')}
      presets={YT_PERIOD_PRESETS.map((d) => ({
        value: String(d),
        label: t('period.short', { count: d }),
      }))}
      value={preset === null ? null : String(preset)}
      onChange={(v) => onRange({ days: parseInt(v, 10) })}
      custom={
        anchor
          ? {
              days: preset === null ? rangeDays(range) : null,
              min: 1,
              max: YT_MAX_CUSTOM_DAYS,
              onApply: (d) => onRange(customRange(d, anchor)),
            }
          : undefined
      }
    />
  );
}

function PhoneBody({
  clientId,
  data,
  range,
  onRange,
  type,
  onType,
  sort,
  onSort,
  overviewData,
}: YouTubeAnalyticsTabPhoneProps & { overviewData: YtOverview }) {
  const { t, i18n } = useTranslation('analyticsYoutube');
  const { overview, daily, traffic, demographics, videos, topShorts } = data;
  const channel = overviewData.channel;
  const revoked = channel.authorizationStatus === 'revoked';
  const redesSociais = `/clientes/${clientId}/redes-sociais`;
  const windowDays = windowDaysOf(overviewData, range);
  const contentLag = lagging(channel.contentTypeThrough, channel.dataThrough);
  const trafficLag = lagging(channel.trafficThrough, channel.dataThrough);
  const videosLag = lagging(channel.videosThrough, channel.dataThrough);

  return (
    <>
      {revoked && (
        <section className="phone-an-callout" role="status" aria-label={t('states.revokedTitle')}>
          <div className="phone-an-callout__head">
            <AlertTriangle aria-hidden="true" />
            <h2 className="phone-an-callout__title">{t('states.revokedTitle')}</h2>
          </div>
          <p className="phone-an-callout__text">{t('states.revokedBody')}</p>
          <Link to={redesSociais} className="phone-an-link-button">
            {t('states.reconnectAction')}
          </Link>
        </section>
      )}

      {!channel.dataThrough ? (
        revoked ? null : (
          <StateBlock
            title={t('states.firstSyncTitle')}
            body={t('states.firstSyncBody')}
            action={null}
          />
        )
      ) : (
        <>
          <PhonePeriod range={range} onRange={onRange} anchor={channel.dataThrough} />
          <SegmentedControl
            aria-label={t('contentType.label')}
            options={(['all', 'shorts', 'long'] as const).map((c) => ({
              value: c,
              label: t(`contentType.${c}`),
            }))}
            value={type}
            onChange={onType}
          />
          <p className="phone-an-tone--muted" style={{ fontSize: '0.8rem', margin: '0.5rem 0' }}>
            {t('header.dataThrough', {
              date: throughInSentence(channel.dataThrough, i18n.language),
            })}
          </p>

          <div style={dimmed(overview.isPlaceholderData)} aria-busy={overview.isPlaceholderData}>
            <YouTubeKpiGrid kpis={overviewData.kpis} windowDays={windowDays} daily={daily.data} />
          </div>

          <YouTubeDailyViewsChart
            phone
            daily={daily.data ?? []}
            type={type}
            windowDays={windowDays}
            lagThrough={contentLag}
            state={cardState(daily)}
          />
          <YouTubeSplitCard phone split={overviewData.split} lagThrough={contentLag} />
          <YouTubeTrafficCard
            phone
            rows={traffic.data ?? []}
            lagThrough={trafficLag}
            state={cardState(traffic)}
          />
          <YouTubeAudienceCard
            phone
            rows={demographics.data ?? []}
            state={cardState(demographics)}
          />
          <YouTubeTopShorts
            phone
            shorts={topShorts.data ?? []}
            lagThrough={videosLag}
            state={cardState(topShorts)}
          />
          <YouTubeVideosTable
            phone
            videos={videos.data ?? []}
            sort={sort}
            onSort={onSort}
            lagThrough={videosLag}
            state={cardState(videos)}
          />

          <p className="phone-an-tone--muted" style={{ fontSize: '0.75rem', margin: '1rem 0' }}>
            {t('footer')}
          </p>
        </>
      )}
    </>
  );
}
