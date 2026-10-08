import { extractVideoFrame } from '@mesaas/ui/video/frame';
import type { ReferenceFileKind } from '../types/postReferences';
import { generateBlur, generateThumbnail, probeImage } from './ideiaMedia';

/** hub-post-references /upload-url rejects a thumbnail above this. */
export const MAX_REFERENCE_THUMB_BYTES = 512 * 1024;
/**
 * Largest edge first. Smaller edges only when an encode lands over the cap: Safari has no WebP
 * encoder and writes PNG for `toBlob('image/webp')`, which is several times larger.
 */
const THUMB_EDGES = [480, 320, 200] as const;
const VIDEO_PROBE_TIMEOUT_MS = 10_000;
const POSTER_W = 480;
const POSTER_H = 270;

export interface ReferenceMedia {
  /** WebP poster/thumbnail; null for PDFs (the server forbids one there). */
  thumbnail: File | null;
  blurDataUrl?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
}

async function webpThumbUnderCap(source: File): Promise<File> {
  for (const edge of THUMB_EDGES) {
    const thumb = await generateThumbnail(source, edge);
    if (thumb.size <= MAX_REFERENCE_THUMB_BYTES) return thumb;
  }
  throw new Error('thumbnail over cap');
}

/**
 * A neutral 16:9 tile, with a play glyph for videos. Used when the browser cannot decode a
 * frame (HEVC .mov in Chrome) or an image, so the `files_video_requires_thumbnail` CHECK and
 * the server's "thumbnail required for image/video" rule still hold.
 */
export function drawNeutralPoster(play: boolean): Promise<File> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas');
    canvas.width = POSTER_W;
    canvas.height = POSTER_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      reject(new Error('canvas unavailable'));
      return;
    }
    ctx.fillStyle = '#2b2b2b';
    ctx.fillRect(0, 0, POSTER_W, POSTER_H);
    if (play) {
      const cx = POSTER_W / 2;
      const cy = POSTER_H / 2;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      ctx.beginPath();
      ctx.arc(cx, cy, 34, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#2b2b2b';
      ctx.beginPath();
      ctx.moveTo(cx - 10, cy - 18);
      ctx.lineTo(cx + 18, cy);
      ctx.lineTo(cx - 10, cy + 18);
      ctx.closePath();
      ctx.fill();
    }
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(new File([blob], 'thumb.webp', { type: 'image/webp' }))
          : reject(new Error('poster failed')),
      'image/webp',
      0.8,
    );
  });
}

/** Width, height and duration from the container metadata; null when the browser can't read it. */
export function probeVideo(
  file: File,
): Promise<{ width?: number; height?: number; duration?: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    let done = false;
    const finish = (value: { width?: number; height?: number; duration?: number } | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      video.load();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), VIDEO_PROBE_TIMEOUT_MS);
    video.onloadedmetadata = () =>
      finish({
        width: video.videoWidth || undefined,
        height: video.videoHeight || undefined,
        duration:
          Number.isFinite(video.duration) && video.duration > 0
            ? Math.round(video.duration)
            : undefined,
      });
    video.onerror = () => finish(null);
    video.src = url;
  });
}

/** Everything the finalize call needs besides the file itself, computed in the browser. */
export async function prepareReferenceMedia(
  file: File,
  kind: ReferenceFileKind,
): Promise<ReferenceMedia> {
  if (kind === 'document') return { thumbnail: null };

  if (kind === 'image') {
    const [dims, thumbnail, blur] = await Promise.all([
      probeImage(file).catch(() => null),
      webpThumbUnderCap(file).catch(() => drawNeutralPoster(false)),
      generateBlur(file).catch(() => undefined),
    ]);
    return { thumbnail, blurDataUrl: blur, width: dims?.width, height: dims?.height };
  }

  const [meta, frame] = await Promise.all([
    probeVideo(file),
    extractVideoFrame(file).catch(() => null),
  ]);
  let thumbnail: File;
  let blur: string | undefined;
  if (frame) {
    thumbnail = await webpThumbUnderCap(frame).catch(() => drawNeutralPoster(true));
    blur = await generateBlur(frame).catch(() => undefined);
  } else {
    thumbnail = await drawNeutralPoster(true);
  }
  return {
    thumbnail,
    blurDataUrl: blur,
    width: meta?.width,
    height: meta?.height,
    durationSeconds: meta?.duration,
  };
}
