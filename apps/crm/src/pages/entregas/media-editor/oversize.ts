import {
  STORY_VIDEO_MAX_BYTES,
  VIDEO_MAX_BYTES,
  validateMedia,
  type PostMediaLike,
} from '../instagramLimits';
import { probeVideo } from '@/services/postMedia';

export type OversizeReason = 'width' | 'size';

export function videoMaxBytes(forStories: boolean): number {
  return forStories ? STORY_VIDEO_MAX_BYTES : VIDEO_MAX_BYTES;
}

/** Eligible only when every validation error is a width or size overage, i.e. a
 *  downscale alone would make the video publishable. */
export function oversizeOnly(
  m: PostMediaLike,
  opts: { forStories?: boolean; isCarousel?: boolean },
): { eligible: boolean; reasons: OversizeReason[] } {
  const reasons: OversizeReason[] = [];
  for (const e of validateMedia([m], opts)) {
    // Match on the stable code: `message` is translated.
    if (e.code === 'width') reasons.push('width');
    else if (e.code === 'size') reasons.push('size');
    else return { eligible: false, reasons: [] };
  }
  reasons.sort((a, b) => (a === b ? 0 : a === 'width' ? -1 : 1));
  return { eligible: reasons.length > 0, reasons };
}

export const PROBE_TIMEOUT_MS = 10_000;

/** probeVideo raced with a timeout; resolves null on rejection, timeout or a non-object result. */
export async function probeWithTimeout(
  file: File,
  ms: number = PROBE_TIMEOUT_MS,
): Promise<{ width: number; height: number; duration_seconds: number } | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      probeVideo(file),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
    return result && typeof result === 'object' ? result : null;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
