import type { ReferenceItem } from '@/store/postReferences';
import { MESES_ABREV } from '@/utils/postDate';

const pad2 = (n: number) => String(n).padStart(2, '0');

/** "2,4 MB" / "300 KB" (pt-BR decimal comma). Null when unknown. */
export function formatReferenceSize(bytes: number | null | undefined): string | null {
  if (bytes == null || !Number.isFinite(bytes) || bytes <= 0) return null;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** "hoje, 14:32", "ontem, 09:05", "3 out, 08:00" (year only when not the current one). */
export function formatReferenceDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (sameLocalDay(d, now)) return `hoje, ${time}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameLocalDay(d, yesterday)) return `ontem, ${time}`;
  const ano = d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : '';
  return `${d.getDate()} ${MESES_ABREV[d.getMonth()]}${ano}, ${time}`;
}

/** "0:42" / "1:02:05". Null when unknown. */
export function formatReferenceDuration(seconds: number | null | undefined): string | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return null;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s)}` : `${m}:${pad2(s)}`;
}

/** Images and videos open in the in-app viewer; PDFs and links open in a new tab. */
export function isViewableReference(item: ReferenceItem): boolean {
  return (
    item.kind === 'file' &&
    (item.file_kind === 'image' || item.file_kind === 'video') &&
    !!item.url
  );
}

export function referenceLabel(item: ReferenceItem): string {
  if (item.kind === 'link') return item.link_title?.trim() || item.link_domain || 'Link';
  return item.name?.trim() || 'Arquivo';
}
