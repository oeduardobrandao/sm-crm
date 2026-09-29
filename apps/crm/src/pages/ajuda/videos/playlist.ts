import { normalize } from '@/lib/normalizeText';
import type { KbVideo, KbVideoProgress, KbVideoSeries } from '@/store/kbVideos';

export type ProgressMap = ReadonlyMap<number, KbVideoProgress>;

export interface PlaylistSelection {
  seriesId: string;
  videoId: number;
}

export interface VideoSearchHit {
  video: KbVideo;
  seriesTitle: string;
}

/** A video counts as watched from this fraction of its duration on. */
export const COMPLETION_RATIO = 0.9;

export function toProgressMap(rows: KbVideoProgress[]): ProgressMap {
  return new Map(rows.map((r) => [r.video_id, r]));
}

export function isCompleted(progress: ProgressMap, videoId: number): boolean {
  return !!progress.get(videoId)?.completed_at;
}

export function completedCount(series: KbVideoSeries, progress: ProgressMap): number {
  return series.videos.filter((v) => isCompleted(progress, v.id)).length;
}

export function allCompleted(series: KbVideoSeries[], progress: ProgressMap): boolean {
  const videos = series.flatMap((s) => s.videos);
  return videos.length > 0 && videos.every((v) => isCompleted(progress, v.id));
}

export function firstUnwatched(series: KbVideoSeries, progress: ProgressMap): KbVideo | null {
  return series.videos.find((v) => !isCompleted(progress, v.id)) ?? null;
}

export function pickInitial(
  series: KbVideoSeries[],
  progress: ProgressMap,
  requestedSlug?: string | null,
): PlaylistSelection | null {
  if (requestedSlug) {
    for (const s of series) {
      const hit = s.videos.find((v) => v.slug === requestedSlug);
      if (hit) return { seriesId: s.id, videoId: hit.id };
    }
  }
  for (const s of series) {
    const next = firstUnwatched(s, progress);
    if (next) return { seriesId: s.id, videoId: next.id };
  }
  const first = series[0];
  return first && first.videos[0] ? { seriesId: first.id, videoId: first.videos[0].id } : null;
}

export function resolveSelection(
  series: KbVideoSeries[],
  selection: PlaylistSelection | null,
): { series: KbVideoSeries; video: KbVideo } | null {
  if (!selection) return null;
  const s = series.find((x) => x.id === selection.seriesId);
  const video = s?.videos.find((x) => x.id === selection.videoId);
  return s && video ? { series: s, video } : null;
}

export function nextInSeries(series: KbVideoSeries, videoId: number): KbVideo | null {
  const index = series.videos.findIndex((v) => v.id === videoId);
  return index >= 0 ? (series.videos[index + 1] ?? null) : null;
}

export function reachedCompletion(currentTime: number, duration: number): boolean {
  return Number.isFinite(duration) && duration > 0 && currentTime >= duration * COMPLETION_RATIO;
}

/** Saved position to resume from, or null for a finished or never-started video. */
export function resumePosition(progress: ProgressMap, videoId: number): number | null {
  const p = progress.get(videoId);
  if (!p || p.completed_at || !(p.position_seconds > 0)) return null;
  return p.position_seconds;
}

/** Optimistic cache update mirroring save_kb_video_progress: last position wins, completed_at
 * is never cleared. */
export function mergeProgress(
  rows: KbVideoProgress[],
  videoId: number,
  position: number,
  completed: boolean,
  nowIso: string,
): KbVideoProgress[] {
  const existing = rows.find((r) => r.video_id === videoId);
  const next: KbVideoProgress = {
    video_id: videoId,
    position_seconds: Math.max(0, position),
    completed_at: existing?.completed_at ?? (completed ? nowIso : null),
  };
  return existing ? rows.map((r) => (r.video_id === videoId ? next : r)) : [...rows, next];
}

export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '';
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Busca da Central de Ajuda sobre os vídeos: título ou descrição, sem diferenciar acentos. */
export function filterVideos(series: KbVideoSeries[], search: string): VideoSearchHit[] {
  const q = normalize(search.trim());
  if (!q) return [];
  return series.flatMap((s) =>
    s.videos
      .filter((v) => normalize(v.title).includes(q) || normalize(v.description ?? '').includes(q))
      .map((video) => ({ video, seriesTitle: s.title })),
  );
}
