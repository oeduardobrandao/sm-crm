import type { TFunction } from 'i18next';
import type { ReferenceItem } from '../../../types/postReferences';

const MB = 1024 * 1024;

/** Inputs in the reference forms: 16px on phones so iOS does not zoom into the field. */
export const REFERENCE_FIELD =
  'w-full border hub-border rounded-lg px-3 py-2.5 text-[16px] md:text-[14px] outline-none hub-bg-card hub-txt placeholder:text-[var(--hub-tx3)] hub-focus-accent focus:ring-2';

/** "2,4 MB" under 10 MB, "38 MB" above. A non-empty file never shows as 0 MB. */
export function formatMegabytes(bytes: number, locale: string): string {
  const mb = bytes <= 0 ? 0 : Math.max(bytes / MB, 0.1);
  const value = new Intl.NumberFormat(locale, {
    maximumFractionDigits: mb < 10 ? 1 : 0,
  }).format(mb);
  return `${value} MB`;
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "hoje, 14:32", "ontem, 09:05", else "12 de out., 14:32". */
export function formatReferenceWhen(
  iso: string,
  locale: string,
  t: TFunction<'hubPosts'>,
  now: Date = new Date(),
): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (days === 0) return t('references.today', 'hoje, {{time}}', { time });
  if (days === 1) return t('references.yesterday', 'ontem, {{time}}', { time });
  const date = d.toLocaleDateString(locale, { day: '2-digit', month: 'short' });
  return t('references.dateTime', '{{date}}, {{time}}', { date, time });
}

export function referenceTitle(item: ReferenceItem): string {
  if (item.kind === 'link') return item.link_title || item.link_domain || item.link_url || '';
  return item.name ?? '';
}
