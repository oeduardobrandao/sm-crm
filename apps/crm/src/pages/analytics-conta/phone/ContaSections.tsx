import { Fragment, useState } from 'react';
import i18n from 'i18next';
import { useTranslation } from 'react-i18next';
import { getIntlLocale } from '@mesaas/i18n';
import { ChevronRight, Eye, Film, MessageCircle, Plus, Trash2 } from 'lucide-react';
import { Cell, GroupedList } from '@/components/mobile/GroupedList';
import { BarList } from '@/components/mobile/BarList';
import { StatCard } from '@/components/StatCard';
import { StatCardGrid } from '@/components/StatCardGrid';
import { cn } from '@/lib/utils';
import type {
  AudienceDemographics,
  BestPostingTimes,
  PostAnalytics,
  PostTag,
  StoriesAnalyticsResponse,
} from '../../../services/analytics';
import { formatRate, IG_RATE_WEIGHTS, type Baseline, type RateKey } from '../../../lib/ig-rates';
import {
  BEST_TIME_BUCKET_STARTS,
  bucketBestTimes,
  dayFull,
  dayShort,
  hourText,
  toStatDelta,
} from '../contaFormat';
import { fmtNumber } from '../../analytics/phone/shared';
import { priorityTone, type AIAnalysisView } from '../../analytics/phone/AIAnalysisPhone';

const tr = (key: string, opts?: Record<string, unknown>) => i18n.t(`analyticsAccount:${key}`, opts);

export const formatPct = (v: number) =>
  getIntlLocale() === 'en-US' ? v.toFixed(1) : v.toFixed(1).replace('.', ',');

const fmtDay = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return getIntlLocale() === 'en-US' ? `${m}/${d}/${y}` : `${d}/${m}/${y}`;
};

/* ---------------- Follower growth ---------------- */

/**
 * The follower line chart as compact columns: the latest count, the change over the
 * window, and tap-a-bar for a day's value (a canvas tooltip on desktop).
 */
export function FollowerGrowthCard({
  history,
  onManual,
  title: titleProp,
  emptyText: emptyTextProp,
}: {
  history: { date: string; follower_count: number; source: string }[];
  /** Omit where the platform takes no manual count (TikTok). */
  onManual?: () => void;
  title?: string;
  emptyText?: string;
}) {
  const { t } = useTranslation('analyticsAccount');
  const title = titleProp ?? t('ps.followersTitle');
  const emptyText = emptyTextProp ?? t('fc.empty');
  const [picked, setPicked] = useState<number | null>(null);
  const manualButton = onManual ? (
    <button type="button" className="phone-text-button" onClick={onManual}>
      {t('ps.manual')}
    </button>
  ) : (
    <span />
  );

  if (history.length < 2) {
    return (
      <section className="phone-an-card" aria-labelledby="conta-followers-title">
        <div className="phone-an-card__top">
          <h2 id="conta-followers-title" className="phone-group__header">
            {title}
          </h2>
        </div>
        <p className="phone-an-card__readout">{emptyText}</p>
        {onManual && (
          <div className="phone-an-card__bottom">
            <span />
            {manualButton}
          </div>
        )}
      </section>
    );
  }

  const points = history.slice(-30);
  const first = history[0];
  const last = history[history.length - 1];
  const delta = last.follower_count - first.follower_count;
  const values = points.map((p) => p.follower_count);
  const min = Math.min(...values);
  const span = Math.max(...values) - min || 1;
  const pickedPoint = picked !== null ? points[picked] : null;

  return (
    <section className="phone-an-card" aria-labelledby="conta-followers-title">
      <div className="phone-an-card__top">
        <h2 id="conta-followers-title" className="phone-group__header">
          {title}
        </h2>
      </div>
      <div className="phone-an-card__top">
        <span className="phone-an-card__big">{fmtNumber(last.follower_count)}</span>
        <span
          className={cn(
            'phone-an-card__delta',
            delta > 0
              ? 'phone-an-tone--up'
              : delta < 0
                ? 'phone-an-tone--down'
                : 'phone-an-tone--muted',
          )}
        >
          {t('ps.deltaPeriod', { delta: `${delta > 0 ? '+' : ''}${fmtNumber(delta)}` })}
        </span>
      </div>
      <div className="phone-an-spark" role="group" aria-label={t('ps.perDay')}>
        {points.map((p, i) => (
          <button
            key={p.date}
            type="button"
            className={cn(
              'phone-an-spark__bar',
              i === points.length - 1 && picked === null && 'phone-an-spark__bar--last',
            )}
            style={{ height: `${15 + ((p.follower_count - min) / span) * 85}%` }}
            aria-pressed={picked === i}
            aria-label={t('ps.dayAria', {
              day: fmtDay(p.date),
              value: fmtNumber(p.follower_count),
            })}
            onClick={() => setPicked(picked === i ? null : i)}
          />
        ))}
      </div>
      <p className="phone-an-card__readout" aria-live="polite">
        {pickedPoint
          ? t(pickedPoint.source === 'manual' ? 'ps.readoutManual' : 'ps.readout', {
              day: fmtDay(pickedPoint.date),
              value: fmtNumber(pickedPoint.follower_count),
            })
          : t('ps.tapBar')}
      </p>
      <div className="phone-an-card__bottom">
        <span>{t('ps.range', { from: fmtDay(points[0].date), to: fmtDay(last.date) })}</span>
        {manualButton}
      </div>
    </section>
  );
}

/* ---------------- Demographics ---------------- */

export function DemographicsSection({ data }: { data: AudienceDemographics | null }) {
  const { t } = useTranslation('analyticsAccount');
  if (!data) {
    return <p className="phone-an-empty">{t('demo.unavailable')}</p>;
  }
  const groups = data.age_gender;
  const total = groups.reduce((s, a) => s + a.male + a.female, 0);
  const cities = data.cities.slice(0, 5);
  return (
    <>
      <GroupedList header={t('ps.gender')}>
        <Cell label={t('demo.femaleLabel')} value={`${data.gender_split.female}%`} />
        <Cell label={t('demo.maleLabel')} value={`${data.gender_split.male}%`} />
      </GroupedList>
      {groups.length > 0 && (
        <BarList
          header={t('demo.ageRange')}
          color="var(--an-female)"
          secondaryColor="var(--an-male)"
          items={groups.map((a) => ({
            key: a.age_range,
            label: a.age_range,
            value: a.female,
            valueLabel:
              total > 0
                ? t('age.peak', { share: Math.round(((a.male + a.female) / total) * 100) })
                : fmtNumber(a.male + a.female),
            secondary: a.male,
            subtitle: t('ps.ageSub', { female: fmtNumber(a.female), male: fmtNumber(a.male) }),
          }))}
          footer={t('ps.ageFooter')}
        />
      )}
      {cities.length > 0 && (
        <BarList
          header={t('demo.topCities')}
          items={cities.map((c) => {
            const [name, region] = c.name.split(/,\s*/, 2);
            return {
              key: c.name,
              label: name,
              subtitle: region,
              value: c.count,
              valueLabel: fmtNumber(c.count),
            };
          })}
        />
      )}
    </>
  );
}

/* ---------------- Best times ---------------- */

/** Wording of the best-times section; a platform with other units (TikTok) overrides it. */
export interface BestTimesLabels {
  /** Fewer than 5 posts/videos. */
  empty: string;
  /** Readout before a cell is picked. */
  tapHint: string;
  header: string;
  footer: (bucketHours: number) => string;
  heatmapAria: string;
  /** A slot with nothing posted. `day` is short in the cell label, full in the readout. */
  emptySlot: (day: string, hour: number) => string;
  cellAria: (day: string, hour: number, value: number, count: number) => string;
  readout: (day: string, from: number, to: number, value: number, count: number) => string;
  recommended: string;
  slotLabel: (day: string, hour: string) => string;
  slotValue: (value: number, count: number) => string;
}

const posts = (n: number) => tr('count.posts', { count: n });
const hourLabel = (h: number) => tr('hm.hour', { h });

// Built at call time so the wording follows the language.
const instagramBestTimes = (): BestTimesLabels => ({
  empty: tr('best.insufficient'),
  tapHint: tr('ps.tapSlot'),
  header: tr('ps.hmHeader'),
  footer: (h) => tr('ps.hmFooter', { h }),
  heatmapAria: tr('ps.hmAria'),
  emptySlot: (day, hour) => tr('hm.empty', { day, hour: hourLabel(hour) }),
  cellAria: (day, hour, value, count) =>
    tr('ps.cellAria', {
      day,
      hour: hourLabel(hour),
      pct: formatPct(value),
      count: posts(count),
    }),
  readout: (day, from, to, value, count) =>
    tr('ps.hmReadout', {
      day,
      from: hourLabel(from),
      to: hourLabel(to),
      pct: formatPct(value),
      count: posts(count),
    }),
  recommended: tr('best.recommended'),
  slotLabel: (day, hour) => tr('best.when', { day, hour: hourText(hour) }),
  slotValue: (value, count) => tr('best.meta', { pct: formatPct(value), count }),
});

export function BestTimesSection({
  data,
  labels: labelsProp,
}: {
  data: BestPostingTimes | null;
  labels?: BestTimesLabels;
}) {
  useTranslation('analyticsAccount');
  const labels = labelsProp ?? instagramBestTimes();
  const [picked, setPicked] = useState<{ d: number; b: number } | null>(null);
  if (!data || data.totalPosts < 5) {
    return <p className="phone-an-empty">{labels.empty}</p>;
  }
  const { buckets, bucketSize, max, topCell } = bucketBestTimes(data);
  const readout = (() => {
    const cell = picked ?? (topCell ? { d: topCell.day, b: topCell.bucket } : null);
    if (!cell) return labels.tapHint;
    const c = buckets[cell.d]?.[cell.b];
    const day = data.labels_days[cell.d];
    const start = BEST_TIME_BUCKET_STARTS[cell.b];
    if (!c || c.count === 0) return labels.emptySlot(dayFull(day), start);
    return labels.readout(dayFull(day), start, start + bucketSize - 1, c.value, c.count);
  })();

  return (
    <>
      <GroupedList header={labels.header} footer={labels.footer(bucketSize)}>
        <li className="phone-cell">
          <div className="phone-an-hm" role="group" aria-label={labels.heatmapAria}>
            <span />
            {BEST_TIME_BUCKET_STARTS.map((h) => (
              <span key={h} className="phone-an-hm__label">
                {hourLabel(h)}
              </span>
            ))}
            {data.labels_days.map((day, d) => (
              <Fragment key={day}>
                <span className="phone-an-hm__label">{dayShort(day)}</span>
                {buckets[d].map((cell, b) => {
                  const step = cell.value > 0 ? 1 + Math.round((cell.value / max) * 7) : 0;
                  const isTop = topCell !== null && topCell.day === d && topCell.bucket === b;
                  const isPicked = picked?.d === d && picked?.b === b;
                  return (
                    <button
                      key={b}
                      type="button"
                      className={cn(
                        'phone-an-hm__cell',
                        isTop && !picked && 'phone-an-hm__cell--top',
                      )}
                      style={{ background: `var(--an-heat-${Math.min(step, 8)})` }}
                      aria-pressed={isPicked}
                      aria-label={
                        cell.count > 0
                          ? labels.cellAria(
                              dayShort(day),
                              BEST_TIME_BUCKET_STARTS[b],
                              cell.value,
                              cell.count,
                            )
                          : labels.emptySlot(dayShort(day), BEST_TIME_BUCKET_STARTS[b])
                      }
                      onClick={() => setPicked(isPicked ? null : { d, b })}
                    />
                  );
                })}
              </Fragment>
            ))}
          </div>
          <p className="phone-an-readout" aria-live="polite">
            {readout}
          </p>
        </li>
      </GroupedList>
      {data.topSlots.length > 0 && (
        <GroupedList header={labels.recommended}>
          {data.topSlots.map((s, i) => (
            <Cell
              key={i}
              icon={<span className="phone-an-rank">{i + 1}</span>}
              label={labels.slotLabel(dayFull(data.labels_days[s.day]), data.labels_hours[s.hour])}
              value={labels.slotValue(s.value, s.postCount)}
            />
          ))}
        </GroupedList>
      )}
    </>
  );
}

/* ---------------- Saves ---------------- */

export function SavesSection({ posts }: { posts: PostAnalytics[] }) {
  const { t } = useTranslation('analyticsAccount');
  return (
    <>
      <p className="phone-an-sheet__summary">{t('ps.savesHelp')}</p>
      <GroupedList aria-label={t('ps.topSaved')}>
        {posts.map((p) => (
          <Cell
            key={p.id}
            label={p.caption || t('page.noCaption')}
            subtitle={t('ps.saveRate', { rate: formatPct(p.saves_rate) })}
            value={t('ps.savedShort', { value: fmtNumber(p.saved) })}
          />
        ))}
      </GroupedList>
    </>
  );
}

/* ---------------- Type + topic ---------------- */

export function TypeTopicSection({
  typeBreakdown,
  topicStats,
  tags,
  days,
  onRemoveTag,
  onNewTag,
}: {
  typeBreakdown: { type: string; count: number; avgEngagement: number }[];
  topicStats: (PostTag & { avgEngagement: number; count: number })[];
  tags: PostTag[];
  days: number;
  onRemoveTag: (tag: PostTag) => void;
  onNewTag: () => void;
}) {
  const { t } = useTranslation('analyticsAccount');
  return (
    <>
      {typeBreakdown.length === 0 ? (
        <p className="phone-an-empty">{t('page.noData')}</p>
      ) : (
        <BarList
          header={t('ps.byType')}
          footer={t('ps.avgDays', { days })}
          items={typeBreakdown.map((row) => ({
            key: row.type,
            label: row.type,
            subtitle: t('count.posts', { count: row.count }),
            value: row.avgEngagement,
            valueLabel: `${formatPct(row.avgEngagement)}%`,
          }))}
        />
      )}
      {topicStats.length > 0 ? (
        <BarList
          header={t('ps.byTopic')}
          items={topicStats.map((topic) => ({
            key: String(topic.id),
            label: topic.tag_name,
            subtitle: t('count.posts', { count: topic.count }),
            value: topic.avgEngagement,
            valueLabel: `${
              getIntlLocale() === 'en-US'
                ? topic.avgEngagement.toFixed(2)
                : topic.avgEngagement.toFixed(2).replace('.', ',')
            }%`,
            color: topic.color,
          }))}
        />
      ) : (
        <p className="phone-an-sheet__summary">
          {tags.length === 0 ? t('topic.hintNoTags') : t('topic.hintAssign')}
        </p>
      )}
      <GroupedList header={t('ps.tags')} footer={tags.length > 0 ? t('ps.tagsFooter') : undefined}>
        {tags.map((tag) => (
          <Cell
            key={tag.id}
            icon={<span className="phone-an-tag__dot" style={{ background: tag.color }} />}
            label={tag.tag_name}
            accessory={<Trash2 aria-hidden="true" className="phone-an-tone--muted" />}
            aria-label={t('ps.removeTagAria', { name: tag.tag_name })}
            aria-haspopup="dialog"
            onClick={() => onRemoveTag(tag)}
          />
        ))}
        <Cell icon={<Plus />} label={t('ps.newTag')} aria-haspopup="dialog" onClick={onNewTag} />
      </GroupedList>
    </>
  );
}

/* ---------------- Stories ---------------- */

export function StoriesSectionPhone({ data }: { data: StoriesAnalyticsResponse }) {
  const { t } = useTranslation('analyticsAccount');
  const { current, previous } = data.kpis;
  return (
    <>
      <StatCardGrid maxCols={4}>
        <StatCard
          label={t('stories.published')}
          value={current.stories_count}
          icon={Film}
          tone="blue"
          delta={toStatDelta(current.stories_count, previous?.stories_count)}
        />
        <StatCard
          label={t('stories.reach')}
          value={fmtNumber(current.total_reach)}
          icon={Eye}
          tone="violet"
          delta={toStatDelta(current.total_reach, previous?.total_reach)}
        />
        <StatCard
          label={t('stories.retention')}
          value={`${(current.avg_retention_rate * 100).toFixed(1)}%`}
          icon={ChevronRight}
          tone="green"
          delta={toStatDelta(current.avg_retention_rate, previous?.avg_retention_rate)}
        />
        <StatCard
          label={t('stories.replies')}
          value={current.total_replies}
          icon={MessageCircle}
          tone="pink"
          delta={toStatDelta(current.total_replies, previous?.total_replies)}
        />
      </StatCardGrid>
      {data.stories.length > 0 && (
        <GroupedList header={t('stories.breakdown')} footer={t('ps.storiesBreakdownFooter')}>
          {[...data.stories]
            .sort((a, b) => new Date(b.posted_at).getTime() - new Date(a.posted_at).getTime())
            .map((s) => {
              const tone = s.retention_rate > 0.7 ? 'up' : s.retention_rate > 0.5 ? 'warn' : 'down';
              return (
                <Cell
                  key={s.instagram_media_id}
                  label={new Date(s.posted_at).toLocaleDateString(getIntlLocale(), {
                    day: '2-digit',
                    month: 'short',
                  })}
                  subtitle={
                    <span className="phone-an-cell-sub phone-an-cell-sub--wrap">
                      {t('ps.storyRow', {
                        reach: fmtNumber(s.reach),
                        impressions: fmtNumber(s.impressions),
                        forward: s.taps_forward,
                        back: s.taps_back,
                        exits: s.exits,
                        replies: s.replies,
                      })}
                    </span>
                  }
                  value={
                    <span className={`phone-an-badge phone-an-badge--${tone}`}>
                      {(s.retention_rate * 100).toFixed(1)}%
                    </span>
                  }
                />
              );
            })}
        </GroupedList>
      )}
    </>
  );
}

/* ---------------- Baseline ---------------- */

export function BaselineSection({ baseline }: { baseline: Baseline }) {
  const { t } = useTranslation('analyticsAccount');
  return (
    <GroupedList
      header={t('ps.baselineHeader', { count: baseline.sample_size })}
      footer={t('ps.baselineFooter')}
    >
      {(['share_rate', 'like_rate', 'save_rate', 'comment_rate'] as RateKey[]).map((key) => {
        const q = baseline.overall[key].quartiles;
        const scaleMax = q ? (q.p75 || 0) * 1.5 || 1 : 1;
        const pct = (v: number) => Math.max(0, Math.min(100, (v / scaleMax) * 100));
        const perFormat = Object.entries(baseline.by_format)
          .map(([fmt, m]) => {
            const fq = m[key].quartiles;
            return `${['VIDEO', 'CAROUSEL_ALBUM', 'IMAGE'].includes(fmt) ? t(`baseline.format.${fmt}`) : fmt} ${fq ? formatRate(fq.p50) : 'n<5'}`;
          })
          .join(' · ');
        return (
          <li key={key} className="phone-cell">
            <div className="phone-an-strip-rate">
              <div className="phone-an-strip-rate__top">
                <span>
                  <strong>{t(`baseline.rate.${key}`)}</strong>{' '}
                  <span className="phone-an-tone--muted">
                    {t('baseline.weight', { pct: Math.round(IG_RATE_WEIGHTS[key] * 100) })}
                  </span>
                </span>
                <span>
                  <strong>{q ? formatRate(q.p50) : t('ps.noData')}</strong>{' '}
                  <span className="phone-an-tone--muted">{t('baseline.median')}</span>
                </span>
              </div>
              <div className="phone-an-strip-rate__track" aria-hidden="true">
                {q && (
                  <>
                    <span
                      className="phone-an-strip-rate__band"
                      style={{
                        left: `${pct(q.p25)}%`,
                        width: `${Math.max(0, pct(q.p75) - pct(q.p25))}%`,
                      }}
                    />
                    <span
                      className="phone-an-strip-rate__median"
                      style={{ left: `${pct(q.p50)}%` }}
                    />
                  </>
                )}
              </div>
              <div className="phone-an-strip-rate__meta">
                {q
                  ? tr('ps.quartiles', { p25: formatRate(q.p25), p75: formatRate(q.p75) })
                  : t('ps.insufficient')}
                {perFormat}
              </div>
            </div>
          </li>
        );
      })}
    </GroupedList>
  );
}

/* ---------------- AI ---------------- */

const titleCase = (key: string) => {
  const spaced = key.replace(/([A-Z])/g, ' $1');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

/** Section titles a platform renames (TikTok: "Melhor vídeo", "Diagnóstico de títulos"). */
export interface ContaAILabels {
  topPerformer: string;
  worstPerformer: string;
  captionDiagnostic: string;
}

const contaAILabels = (): ContaAILabels => ({
  topPerformer: tr('ps.aiTopPerformer'),
  worstPerformer: tr('ps.aiWorstPerformer'),
  captionDiagnostic: tr('ps.aiCaptionDiagnostic'),
});

/** The account analysis payload (untyped JSON) in the shared phone shape. */
export function contaAIView(
  a: any,
  labels: ContaAILabels = contaAILabels(),
): AIAnalysisView | null {
  if (!a) return null;
  return {
    score: a.healthScore
      ? {
          value: a.healthScore.score ?? 0,
          label: tr('ai.healthScore'),
          summary: String(a.healthScore.summary ?? ''),
        }
      : undefined,
    facts: a.healthScore?.breakdown
      ? Object.entries(a.healthScore.breakdown).map(([key, val]) => ({
          label: titleCase(key),
          value: typeof val === 'string' ? val : val === null ? 'N/A' : String(val),
        }))
      : undefined,
    sections: [
      { title: labels.topPerformer, text: a.performanceMap?.topPerformer },
      { title: labels.worstPerformer, text: a.performanceMap?.worstPerformer },
      { title: tr('ps.aiContentMix'), text: a.performanceMap?.contentMix },
      { title: labels.captionDiagnostic, text: a.captionDiagnostic },
      { title: tr('ps.aiTrajectory'), text: a.growthAnalysis?.trajectory },
      { title: tr('ai.projection'), text: a.growthAnalysis?.projection },
    ],
    actions: Array.isArray(a.actionPlan)
      ? {
          title: tr('ps.aiActionPlan'),
          items: a.actionPlan.map((p: any) => ({
            badge: String(p.prioridade ?? ''),
            tone: priorityTone(p.prioridade),
            title: String(p.acao ?? ''),
            detail: p.porque ? String(p.porque) : undefined,
          })),
        }
      : undefined,
    generatedAt: a.generatedAt,
  };
}
