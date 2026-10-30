import { i18n } from '@mesaas/i18n';
import type { PostMedia } from '../../store/posts';

/** What a video's cover is, read from files.thumbnail_source / thumbnail_frame_ms (spec
 * 2026-10-30-tiktok-cover-follows-thumbnail). The gallery chip, the thumbnail editor and the
 * TikTok panel all describe the cover through this, so they never disagree. */
export type VideoCoverState =
  | { kind: 'default'; frameMs: number | null }
  | { kind: 'frame'; frameMs: number | null }
  | { kind: 'image' }
  | { kind: 'unknown' };

export function videoCoverState(
  media: Pick<PostMedia, 'thumbnail_source' | 'thumbnail_frame_ms'>,
): VideoCoverState {
  const frameMs = media.thumbnail_frame_ms ?? null;
  switch (media.thumbnail_source) {
    case 'auto':
      return { kind: 'default', frameMs };
    case 'frame':
      return { kind: 'frame', frameMs };
    case 'image':
      return { kind: 'image' };
    default:
      return { kind: 'unknown' };
  }
}

/** `m:ss.s` for a cover frame in milliseconds. */
export function formatCoverTimestamp(ms: number): string {
  const totalTenths = Math.floor(ms / 100);
  const minutes = Math.floor(totalTenths / 600);
  const seconds = Math.floor((totalTenths % 600) / 10);
  return `${minutes}:${String(seconds).padStart(2, '0')}.${totalTenths % 10}`;
}

/** Short label for the chip on a video tile: "Capa padrão", "Capa 0:12.3", "Capa: imagem". */
export function videoCoverChipLabel(state: VideoCoverState): string {
  switch (state.kind) {
    case 'default':
      return i18n.t('posts:videoCover.chip.default');
    case 'frame':
      return state.frameMs === null
        ? i18n.t('posts:videoCover.chip.frameNoTime')
        : i18n.t('posts:videoCover.chip.frame', { time: formatCoverTimestamp(state.frameMs) });
    case 'image':
      return i18n.t('posts:videoCover.chip.image');
    case 'unknown':
      return i18n.t('posts:videoCover.chip.unknown');
  }
}

/** Shorter chip text for the phone strip, where a 9:16 tile is ~52px wide. */
export function videoCoverChipShortLabel(state: VideoCoverState): string {
  switch (state.kind) {
    case 'default':
      return i18n.t('posts:videoCover.short.default');
    case 'frame':
      return state.frameMs === null
        ? i18n.t('posts:videoCover.short.frameNoTime')
        : formatCoverTimestamp(state.frameMs);
    case 'image':
      return i18n.t('posts:videoCover.short.image');
    case 'unknown':
      return i18n.t('posts:videoCover.short.unknown');
  }
}

/** A cover the person chose (frame or image), as opposed to the default or an unknown one. */
export function isCustomVideoCover(state: VideoCoverState): boolean {
  return state.kind === 'frame' || state.kind === 'image';
}

/** Width / height for a media preview, so a 1080×1440 image is not shown as a square.
 * Clamped to 1:2 … 2:1 (anything past that is an odd file, not a layout to honor);
 * square when the dimensions are unknown. */
export function mediaPreviewAspect(media: Pick<PostMedia, 'width' | 'height'>): number {
  if (!media.width || !media.height) return 1;
  return Math.min(2, Math.max(0.5, media.width / media.height));
}

/** One sentence for the editor and the chip's tooltip: what the cover is right now. */
export function videoCoverDescription(state: VideoCoverState): string {
  switch (state.kind) {
    case 'default':
      return i18n.t('posts:videoCover.describe.default');
    case 'frame':
      return state.frameMs === null
        ? i18n.t('posts:videoCover.describe.frameNoTime')
        : i18n.t('posts:videoCover.describe.frame', { time: formatCoverTimestamp(state.frameMs) });
    case 'image':
      return i18n.t('posts:videoCover.describe.image');
    case 'unknown':
      return i18n.t('posts:videoCover.describe.unknown');
  }
}
