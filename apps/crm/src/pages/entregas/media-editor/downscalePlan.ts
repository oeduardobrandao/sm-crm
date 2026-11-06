export const DOWNSCALE_SHORT_SIDE = 1080;
const MAX_WIDTH = 1920;
export const FFMPEG_FALLBACK_MAX_INPUT_BYTES = 500 * 1024 * 1024;
export const FFMPEG_FALLBACK_MAX_INPUT_BYTES_IOS = 200 * 1024 * 1024;

export interface DownscaleSource {
  width: number;
  height: number;
  sizeBytes: number;
  durationSeconds: number;
}

export interface DownscalePlan {
  /** Even, display space. */
  width: number;
  height: number;
  /** false = size-only re-encode. */
  resized: boolean;
  /** bps */
  bitrate: number;
  maxBytes: number;
  durationSeconds: number;
}

const evenFloor = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

/** null = the size budget leaves under 100 kbps for the video. */
export function planDownscale(
  src: DownscaleSource,
  opts: { maxBytes: number },
): DownscalePlan | null {
  const { width, height, durationSeconds } = src;
  if (![width, height, durationSeconds].every((v) => Number.isFinite(v) && v > 0)) return null;
  const scale = Math.min(DOWNSCALE_SHORT_SIDE / Math.min(width, height), MAX_WIDTH / width, 1);
  const bitrate = Math.floor(
    Math.min(8_000_000, (opts.maxBytes * 8 * 0.88) / durationSeconds - 128_000),
  );
  if (bitrate < 100_000) return null;
  return {
    width: evenFloor(width * scale),
    height: evenFloor(height * scale),
    resized: scale < 1,
    bitrate,
    maxBytes: opts.maxBytes,
    durationSeconds,
  };
}

export function downscaledFilename(name: string, plan: DownscalePlan): string {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  return plan.resized
    ? `${base} (${Math.min(plan.width, plan.height)}p).mp4`
    : `${base} (otimizado).mp4`;
}

export function ffmpegFallbackMaxBytes(env: { userAgent: string; maxTouchPoints: number }): number {
  const ios =
    /iPhone|iPad|iPod/.test(env.userAgent) ||
    (/Macintosh/.test(env.userAgent) && env.maxTouchPoints > 1);
  return ios ? FFMPEG_FALLBACK_MAX_INPUT_BYTES_IOS : FFMPEG_FALLBACK_MAX_INPUT_BYTES;
}

export type DownscaleEngine = 'webcodecs' | 'ffmpeg';
export type DownscaleSupport = { engine: DownscaleEngine | 'none'; hdr: boolean };
export interface DownscaleResult {
  file: File;
  engine: DownscaleEngine;
  hdr: boolean;
  width: number;
  height: number;
}
