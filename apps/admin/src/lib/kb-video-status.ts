import type { KbVideo, KbVideoSeries } from './api';

export const KB_VIDEOS_KEY = ['admin', 'kb-videos'] as const;
export const KB_VIDEO_SERIES_KEY = ['admin', 'kb-video-series'] as const;
export const kbVideoKey = (id: number | null) => ['admin', 'kb-video', id] as const;

/** A pending upload untouched for this long gets one automatic refresh-kb-video per page load. */
export const AUTO_REFRESH_AFTER_MS = 5 * 60_000;

export interface BadgeSpec {
  label: string;
  variant: 'success' | 'neutral' | 'warning' | 'danger' | 'info';
}

export function publishBadge(status: KbVideo['status'] | KbVideoSeries['status']): BadgeSpec {
  return status === 'published'
    ? { label: 'Publicado', variant: 'success' }
    : { label: 'Rascunho', variant: 'neutral' };
}

export function processingBadge(video: Pick<KbVideo, 'stream_status' | 'stream_uid'>): BadgeSpec {
  if (video.stream_status === 'ready') return { label: 'Pronto', variant: 'success' };
  if (video.stream_status === 'error') {
    return video.stream_uid
      ? { label: 'Erro', variant: 'danger' }
      : { label: 'Envio interrompido', variant: 'warning' };
  }
  return video.stream_uid
    ? { label: 'Processando', variant: 'info' }
    : { label: 'Sem arquivo', variant: 'neutral' };
}

export function needsAutoRefresh(video: KbVideo, nowMs: number): boolean {
  if (video.stream_status !== 'pending' || !video.stream_uid) return false;
  const updated = Date.parse(video.updated_at);
  return Number.isFinite(updated) && nowMs - updated > AUTO_REFRESH_AFTER_MS;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '';
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Moves list[index] by delta and renumbers the whole list (10, 20, 30…), or null at an edge. */
export function reorderedItems(
  list: KbVideo[],
  index: number,
  delta: -1 | 1,
): Array<{ id: number; display_order: number }> | null {
  const target = index + delta;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return null;
  const next = [...list];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return next.map((v, i) => ({ id: v.id, display_order: (i + 1) * 10 }));
}

export function groupBySeries(
  series: KbVideoSeries[],
  videos: KbVideo[],
): Array<{ series: KbVideoSeries; videos: KbVideo[] }> {
  return [...series]
    .sort((a, b) => a.display_order - b.display_order)
    .map((s) => ({
      series: s,
      videos: videos
        .filter((v) => v.series_id === s.id)
        .sort((a, b) => a.display_order - b.display_order || a.id - b.id),
    }));
}
