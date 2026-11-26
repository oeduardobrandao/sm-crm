import i18n from 'i18next';
import { getIntlLocale } from '@mesaas/i18n';
import {
  bandLabel,
  formatMetric,
  highlightLine,
  roundedSampleLabel,
  verdictFor,
  type FollowerBand,
  type HealthMetricKey,
  type Verdict,
  type VerdictTone,
} from '@mesaas/report-blocks/health';

// The shared health package (also used by the PDF report block) only speaks Portuguese, so the
// CRM card localizes at the call site: Portuguese delegates to it, English reads its own copy.
const isEn = () => getIntlLocale() === 'en-US';
const tr = (key: string, opts?: Record<string, unknown>) =>
  i18n.t(`analyticsAccount:health.${key}`, opts);

export function healthVerdict(pct: number): Verdict {
  const v = verdictFor(pct);
  return isEn() ? { ...v, label: tr(`verdict.${v.tone}`) } : v;
}

export function healthVerdictLabel(tone: VerdictTone): string {
  return tr(`verdict.${tone}`);
}

export function healthMetricTitle(key: HealthMetricKey, ptTitle: string): string {
  return isEn() ? tr(`metric.${key}`) : ptTitle;
}

export function healthNullReason(key: HealthMetricKey, ptReason: string | null): string | null {
  if (!isEn() || ptReason === null) return ptReason;
  return tr(`nullReason.${key}`);
}

export function healthBandLabel(band: FollowerBand): string {
  return isEn() ? tr(`band.${band}`) : bandLabel(band);
}

export function healthSampleLabel(n: number): string {
  if (!isEn()) return roundedSampleLabel(n);
  const step = n > 100 ? 100 : 10;
  return tr('sample', { n: Math.floor((n - 1) / step) * step });
}

export function healthMetricText(key: HealthMetricKey, v: number): string {
  if (!isEn()) return formatMetric(key, v);
  switch (key) {
    case 'engagement_rate':
      return new Intl.NumberFormat('en-US', {
        style: 'percent',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(v);
    case 'reels_share':
      return new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 0 }).format(
        v,
      );
    default:
      return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(v);
  }
}

export function healthHighlight(key: HealthMetricKey, v: string, p: string): string {
  if (!isEn()) return highlightLine(key, v, p);
  if (key === 'posts_30d') return tr('highlight.posts_30d', { v, p, count: v === '1' ? 1 : 2 });
  return tr(`highlight.${key}`, { v, p });
}

export function healthRatio(ratio: number): string {
  return new Intl.NumberFormat(getIntlLocale(), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(ratio);
}
