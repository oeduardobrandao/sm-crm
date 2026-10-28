import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { enUS, ptBR } from 'date-fns/locale';
import { AlertTriangle, Lock, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { PageSkeleton } from '@/components/ui/skeletons';
import { syncTikTokData } from '../../../services/tiktok';
import {
  getTikTokAIAnalysis,
  isTikTokFeatureDisabled,
  TikTokNotConnectedError,
  TikTokRateLimitedError,
  type AnalyticsRange,
  type TikTokPostSort,
} from '../../../services/tiktokAnalytics';
import type { BestPostingTimes } from '../../../services/analytics';
import { sanitizeUrl } from '../../../utils/security';
import { AISection, BestTimesHeatmap, FollowerChart } from '../AnalyticsContaPage';
import { TikTokKpiGrid } from './TikTokKpiGrid';
import { TikTokPeriodBar } from './TikTokPeriodBar';
import { TikTokRankedVideos } from './TikTokRankedVideos';
import { TikTokVideosTable, type VideoTableSort } from './TikTokVideosTable';
import { aiDays, formatRate, periodTag } from './tiktokTabFormat';
import { isTikTokTabQuery, useTikTokTabData } from './useTikTokTabData';

/** TikTok's brand pink, for the follower line. */
const TIKTOK_COLOR = '#FE2C55';
const BILLING_PATH = '/configuracao/cobranca';
/** Same floor the Instagram heatmap uses before it ranks time slots. */
const MIN_BEST_TIME_VIDEOS = 5;

/** `/analytics/:id/tiktok`: the client's TikTok numbers, one period control for the whole tab. */
export function TikTokAnalyticsTab({ clientId }: { clientId: number }) {
  const { t, i18n } = useTranslation('analyticsTiktok');
  const qc = useQueryClient();
  const [range, setRange] = useState<AnalyticsRange>({ days: 30 });
  const [sort, setSort] = useState<VideoTableSort>({ col: 'posted_at', dir: 'desc' });
  const [syncing, setSyncing] = useState(false);
  const { overview, history, posts, bestTimes, bestTimesLocked, aiLocked } = useTikTokTabData(
    clientId,
    range,
    sort.col as TikTokPostSort,
  );
  const redesSociais = `/clientes/${clientId}/redes-sociais`;

  if (overview.isPending) return <PageSkeleton body="report" header={false} />;

  if (overview.isError && !overview.data) {
    const err = overview.error;
    if (err instanceof TikTokNotConnectedError) {
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
    if (isTikTokFeatureDisabled(err)) {
      return (
        <StateCard
          title={t('states.locked')}
          action={
            <Button asChild variant="outline">
              <Link to={BILLING_PATH}>{t('states.lockedAction')}</Link>
            </Button>
          }
        />
      );
    }
    return (
      <StateCard
        title={t('states.error')}
        action={
          <Button variant="outline" onClick={() => overview.refetch()}>
            {t('states.retry')}
          </Button>
        }
      />
    );
  }

  const data = overview.data!;
  const account = data.account;
  const period = periodTag(range, i18n.language);
  const dateLocale = i18n.language.startsWith('en') ? enUS : ptBR;

  const handleSync = async () => {
    setSyncing(true);
    try {
      await syncTikTokData(clientId);
      toast.success(t('states.syncSuccess'));
      await Promise.all([
        qc.invalidateQueries({ predicate: isTikTokTabQuery(clientId) }),
        qc.invalidateQueries({ queryKey: ['ttSummary', clientId] }),
      ]);
    } catch (e) {
      toast.error(
        e instanceof Error && e.message === 'TOKEN_EXPIRED'
          ? t('states.expiredBody')
          : t('states.syncError'),
      );
    } finally {
      setSyncing(false);
    }
  };

  // AISection shows a thrown error's message, so every failure leaves here as copy. The AI
  // route takes `days` only (1-365): a longer custom window is capped.
  const loadAI = async () => {
    try {
      const result = await getTikTokAIAnalysis(clientId, aiDays(range));
      // `{error: true, raw}`: a fixed marker, or unparseable model output (never shown).
      if (result.analysis?.error) {
        const raw = result.analysis.raw;
        throw new AIMessage(
          raw === 'ai_unavailable'
            ? t('ai.unavailable')
            : raw === 'Nenhum vídeo no período'
              ? t('states.noVideos')
              : t('ai.error'),
        );
      }
      return result;
    } catch (e) {
      if (e instanceof AIMessage) throw e;
      if (e instanceof TikTokRateLimitedError) throw new AIMessage(t('ai.rateLimited'));
      if (isTikTokFeatureDisabled(e)) throw new AIMessage(t('ai.locked'));
      throw new AIMessage(t('ai.error'));
    }
  };

  const avatar = account.avatar_url?.startsWith('https://') ? account.avatar_url : null;
  const handle = account.username ?? account.display_name ?? '';
  const videos = posts.data ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div className="flex flex-wrap items-center justify-between gap-3 animate-up">
        <p className="flex flex-wrap items-center gap-2" style={{ margin: 0 }}>
          {avatar && (
            <img
              src={avatar}
              alt=""
              style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover' }}
            />
          )}
          {account.username ? (
            <a
              href={sanitizeUrl(`https://www.tiktok.com/@${encodeURIComponent(account.username)}`)}
              target="_blank"
              rel="noopener noreferrer"
              className="conta-identity__handle-link"
            >
              @{account.username}
            </a>
          ) : (
            <span>{handle}</span>
          )}
          <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
            {account.last_synced_at
              ? t('clientTab.syncedAgo', {
                  time: formatDistanceToNow(new Date(account.last_synced_at), {
                    locale: dateLocale,
                  }),
                })
              : t('overview.neverSynced')}
          </span>
        </p>
        <div className="header-actions">
          <Button variant="outline" disabled={syncing} onClick={handleSync}>
            {syncing ? <Spinner size="sm" /> : <RefreshCw className="h-4 w-4" />}
            {t('overview.sync')}
          </Button>
        </div>
      </div>

      {account.authorization_status === 'expired' && (
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
            <span className="analytics-callout__title">{t('states.expiredTitle')}</span>
            <p className="analytics-callout__text">{t('states.expiredBody')}</p>
            <Button asChild size="sm" variant="outline" style={{ alignSelf: 'flex-start' }}>
              <Link to={redesSociais}>{t('states.connectAction')}</Link>
            </Button>
          </div>
        </div>
      )}

      <TikTokPeriodBar range={range} onChange={setRange} />

      <TikTokKpiGrid kpis={data.kpis} period={period} />

      {posts.isPending ? <LoadingCard /> : <TikTokRankedVideos videos={videos} period={period} />}

      <div className="card animate-up">
        <div className="dashboard-hub-card-header">
          <h3>{t('followers.title')}</h3>
        </div>
        {history.isPending ? (
          <LoadingBody />
        ) : (
          <FollowerChart
            history={history.data ?? []}
            postDates={[]}
            color={TIKTOK_COLOR}
            emptyText={t('followers.empty')}
          />
        )}
      </div>

      {posts.isPending ? (
        <LoadingCard />
      ) : (
        <TikTokVideosTable videos={videos} sort={sort} onSort={setSort} />
      )}

      <BestTimesCard
        locked={bestTimesLocked}
        loading={bestTimes.isPending && !bestTimesLocked}
        data={bestTimes.data ?? null}
      />

      {aiLocked ? (
        <LockedCard title={t('ai.title')} body={t('ai.locked')} />
      ) : (
        <AISection clientId={clientId} days={aiDays(range)} load={loadAI} title={t('ai.title')} />
      )}
    </div>
  );
}

/** An already-translated AI message, passed through the loader's catch as-is. */
class AIMessage extends Error {}

function StateCard({ title, body, action }: { title: string; body?: string; action: ReactNode }) {
  return (
    <div className="card animate-up" style={{ textAlign: 'center', padding: '2.5rem 1.5rem' }}>
      <h3 style={{ marginBottom: '0.5rem' }}>{title}</h3>
      {body && <p style={{ color: 'var(--text-muted)', marginBottom: '1.25rem' }}>{body}</p>}
      {action}
    </div>
  );
}

function LoadingBody() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem 0' }}>
      <Spinner />
    </div>
  );
}

function LoadingCard() {
  return (
    <div className="card animate-up">
      <LoadingBody />
    </div>
  );
}

/** A section the plan does not include: what it is, and where to upgrade. */
function LockedCard({ title, body }: { title: string; body: string }) {
  const { t } = useTranslation('analyticsTiktok');
  return (
    <div className="card animate-up">
      <div className="dashboard-hub-card-header">
        <h3>{title}</h3>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          flexWrap: 'wrap',
          marginTop: '0.75rem',
        }}
      >
        <Lock className="h-4 w-4" style={{ color: 'var(--text-muted)' }} aria-hidden="true" />
        <p style={{ color: 'var(--text-muted)', margin: 0, flex: 1 }}>{body}</p>
        <Button asChild size="sm" variant="outline">
          <Link to={BILLING_PATH}>{t('states.lockedAction')}</Link>
        </Button>
      </div>
    </div>
  );
}

function BestTimesCard({
  locked,
  loading,
  data,
}: {
  locked: boolean;
  loading: boolean;
  data: BestPostingTimes | null;
}) {
  const { t } = useTranslation('analyticsTiktok');
  if (locked) return <LockedCard title={t('bestTimes.title')} body={t('bestTimes.locked')} />;
  const top = data?.topSlots[0];
  const enough = !!data && data.totalPosts >= MIN_BEST_TIME_VIDEOS;
  const videosLabel = (count: number) => t('bestTimes.postCount', { count });
  return (
    <div className="card animate-up">
      {enough && top ? (
        <div className="an-insight">
          <h3 className="an-insight-kpi">
            {t('clientTab.bestSlot', {
              day: data.labels_days[top.day],
              hour: data.labels_hours[top.hour],
            })}
          </h3>
          <div className="an-insight-sub">
            {t('clientTab.bestSlotSub', {
              rate: formatRate(top.value),
              videos: videosLabel(data.totalPosts),
            })}
          </div>
        </div>
      ) : (
        <div className="dashboard-hub-card-header">
          <h3>{t('bestTimes.title')}</h3>
        </div>
      )}
      {loading ? (
        <LoadingBody />
      ) : !enough ? (
        <p style={{ color: 'var(--text-muted)', marginTop: '1rem' }}>{t('bestTimes.empty')}</p>
      ) : (
        <div style={{ marginTop: '0.5rem' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: '0 0 0.5rem' }}>
            {t('bestTimes.subtitle')} ({t('bestTimes.timezone')})
          </p>
          <BestTimesHeatmap data={data} countLabel={videosLabel} />
          {data.topSlots.length > 0 && (
            <div style={{ marginTop: '1.2rem' }}>
              <h4 className="an-mini-h" style={{ margin: '0 0 0.5rem' }}>
                {t('clientTab.recommendedSlots')}
              </h4>
              {data.topSlots.map((s, i) => (
                <div key={i} className="an-slot-row">
                  <span className={`an-slot-rank${i === 0 ? ' r1' : ''}`}>{i + 1}</span>
                  <span className="an-slot-when">
                    {t('clientTab.slotWhen', {
                      day: data.labels_days[s.day],
                      hour: data.labels_hours[s.hour],
                    })}
                  </span>
                  <span className="an-slot-meta">
                    {formatRate(s.value)} · {videosLabel(s.postCount)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
