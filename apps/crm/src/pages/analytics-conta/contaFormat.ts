import i18n from 'i18next';
import { getIntlLocale } from '@mesaas/i18n';
import type { StatDelta } from '@/components/StatCard';
import { makeDelta, type BestPostingTimes } from '../../services/analytics';
import {
  MIN_SAMPLE,
  quartiles,
  selectRateSamples,
  type RateDistributions,
  type RateKey,
} from '../../lib/ig-rates';

/** "2026-09" → "Set 2026" (legacy monthly reports). */
export function formatReportMonth(month: string): string {
  const [y, m] = month.split('-');
  return `${i18n.t(`analyticsAccount:format.month.${parseInt(m)}`)} ${y}`;
}

/** Cards that render via StatCard directly: the KpiDelta → StatDelta mapping KpiCard does. */
export function toStatDelta(
  current: number | undefined,
  previous: number | null | undefined,
): StatDelta | undefined {
  if (current == null || previous == null) return undefined;
  const { direction, deltaPercent } = makeDelta(current, previous);
  return {
    direction,
    percent: deltaPercent,
    caption: i18n.t('analyticsAccount:format.vsPrevious'),
  };
}

export const BEST_TIME_BUCKET_STARTS = [0, 3, 6, 9, 12, 15, 18, 21];

/**
 * The API returns a 7x24 grid but posts are sparse, so cells are aggregated into 3h
 * buckets (weighted by post count); otherwise slots at e.g. 1h or 23h would be invisible
 * in a grid that samples only every 3rd hour.
 */
export function bucketBestTimes(data: BestPostingTimes) {
  const cols = data.heatmap[0]?.length ?? 0;
  const bucketSize = cols >= 24 ? 3 : 1;
  const buckets = data.labels_days.map((_, d) =>
    BEST_TIME_BUCKET_STARTS.map((start, b) => {
      let eng = 0;
      let n = 0;
      for (let i = 0; i < bucketSize; i++) {
        const h = bucketSize === 3 ? start + i : b;
        eng += (data.heatmap[d]?.[h] ?? 0) * (data.counts[d]?.[h] ?? 0);
        n += data.counts[d]?.[h] ?? 0;
      }
      return { value: n > 0 ? eng / n : 0, count: n };
    }),
  );
  const max = Math.max(...buckets.flat().map((c) => c.value), 0.1);
  const topSlot = data.topSlots[0];
  const topCell = topSlot
    ? { day: topSlot.day, bucket: bucketSize === 3 ? Math.floor(topSlot.hour / 3) : topSlot.hour }
    : null;
  return { buckets, bucketSize, max, topCell };
}

/** Engagement rate (%) from which a post's rate reads as good (painted green). */
export const GOOD_ENGAGEMENT_RATE = 3;

export function formatMediaType(type: string): string {
  switch (type) {
    case 'VIDEO':
    case 'CAROUSEL_ALBUM':
    case 'IMAGE':
    case 'STORY':
      return i18n.t(`analyticsAccount:mediaType.${type}`);
    default:
      return type;
  }
}

/** Weekday label from the API ("Seg", "Sáb"...): Portuguese stays as sent, English is translated. */
export function dayShort(label: string): string {
  if (getIntlLocale() !== 'en-US') return label;
  return i18n.t(`analyticsAccount:days.short.${dayKey(label)}`, { defaultValue: label });
}

/** Full weekday name for an API weekday label ("Sab" or "Sáb" → "Sábado" / "Saturday"). */
export function dayFull(label: string): string {
  return i18n.t(`analyticsAccount:days.full.${dayKey(label)}`, { defaultValue: label });
}

function dayKey(label: string): string {
  return label.replace('á', 'a');
}

/** Hour label from the API ("14h"): Portuguese stays as sent, English reads "14:00". */
export function hourText(label: string): string {
  if (getIntlLocale() !== 'en-US') return label;
  const n = parseInt(label, 10);
  return Number.isNaN(n) ? label : i18n.t('analyticsAccount:hm.hour', { h: n });
}

export function mediaAccentColor(type: string): string {
  switch (type) {
    case 'VIDEO':
      return '#8b5cf6';
    case 'CAROUSEL_ALBUM':
      return '#10b981';
    case 'IMAGE':
      return '#3b82f6';
    default:
      return '#64748b';
  }
}

function publishedAtFormat(): Intl.DateTimeFormat {
  const en = getIntlLocale() === 'en-US';
  return new Intl.DateTimeFormat(getIntlLocale(), {
    timeZone: 'America/Sao_Paulo',
    day: en ? 'numeric' : '2-digit',
    month: 'short',
    hour: en ? 'numeric' : '2-digit',
    minute: '2-digit',
    ...(en ? { hour12: true } : { hourCycle: 'h23' as const }),
  });
}

/** "21 de nov. às 18:02", always in São Paulo time. */
export function formatPublishedDateTime(iso: string): string {
  const parts = Object.fromEntries(
    publishedAtFormat()
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  );
  const time = parts.dayPeriod
    ? `${parts.hour}:${parts.minute} ${parts.dayPeriod}`
    : `${parts.hour}:${parts.minute}`;
  return i18n.t('analyticsAccount:format.publishedDateTime', {
    day: parts.day,
    month: parts.month,
    time,
  });
}

/** "Publicado em 21 de nov. às 18:02", always in São Paulo time. */
export function formatPublishedAt(iso: string): string {
  return i18n.t('analyticsAccount:format.publishedAt', { when: formatPublishedDateTime(iso) });
}

/** "Atualizado há 2 h"; null when the post was never synced. */
export function formatSyncedAgo(iso: string | null, now: Date = new Date()): string | null {
  if (!iso) return null;
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return i18n.t('analyticsAccount:format.syncedNow');
  if (minutes < 60) return i18n.t('analyticsAccount:format.syncedMinutes', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return i18n.t('analyticsAccount:format.syncedHours', { count: hours });
  return i18n.t('analyticsAccount:format.syncedDays', { count: Math.floor(hours / 24) });
}

/**
 * Median and p75 of the sample selectRateSamples picks (format first, overall fallback).
 * Null without distributions or when that sample is under MIN_SAMPLE.
 */
export function rateBenchmark(
  dists: RateDistributions | undefined,
  mediaType: string,
  key: RateKey,
): { p50: number; p75: number } | null {
  if (!dists) return null;
  const sample = selectRateSamples(mediaType, dists)[key];
  if (sample.length < MIN_SAMPLE) return null;
  const q = quartiles(sample);
  return q ? { p50: q.p50, p75: q.p75 } : null;
}
