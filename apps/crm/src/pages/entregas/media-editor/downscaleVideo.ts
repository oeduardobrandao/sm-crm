import type { InputVideoTrack } from 'mediabunny';
import { probeVideo } from '@/services/postMedia';
import { validateMedia } from '../instagramLimits';
import {
  downscaledFilename,
  ffmpegFallbackMaxBytes,
  type DownscalePlan,
  type DownscaleResult,
  type DownscaleSupport,
} from './downscalePlan';
import { runFfmpegScale } from './exportVideo';
import { scaleVideoArguments } from './geometry';
import {
  assertUsableConversion,
  buildConversionOptions,
  EngineUnavailable,
} from './mediabunnyOptions';

export type { DownscaleEngine, DownscaleSupport, DownscaleResult } from './downscalePlan';
export { EngineUnavailable } from './mediabunnyOptions';

/** The converted file came out, but still breaks a limit; another engine would not fix it. */
export class DownscaleOutputInvalid extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DownscaleOutputInvalid';
  }
}

type DownscaleOptions = {
  forStories: boolean;
  signal: AbortSignal;
  onProgress: (pct: number) => void;
};

// Browser globals are read at call time: the SSR prerender runs this module's top level in Node.
function fallbackCeiling(): number {
  return ffmpegFallbackMaxBytes({
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
  });
}

const hasWebCodecs = () => 'VideoEncoder' in globalThis;

async function readHdr(track: InputVideoTrack | null): Promise<boolean> {
  if (!track) return false;
  try {
    return await track.hasHighDynamicRange();
  } catch {
    return false;
  }
}

export async function inspectForDownscale(
  file: File,
  plan: DownscalePlan,
): Promise<DownscaleSupport> {
  const fallback = file.size <= fallbackCeiling() ? 'ffmpeg' : 'none';
  let hdr = false;
  let input: { dispose(): void } | null = null;
  try {
    const mb = await import('mediabunny');
    const opened = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
    input = opened;
    hdr = await readHdr(await opened.getPrimaryVideoTrack());
    if (hasWebCodecs()) {
      const quality = new mb.Quality(buildConversionOptions(plan).videoQuality);
      const ok = await mb.canEncodeVideo('avc', {
        width: plan.width,
        height: plan.height,
        quality,
      });
      if (ok) return { engine: 'webcodecs', hdr };
    }
  } catch {
    // Unreadable container or no mediabunny: only ffmpeg is left.
  } finally {
    input?.dispose();
  }
  return { engine: fallback, hdr };
}

/** Throws EngineUnavailable for any WebCodecs failure; the caller decides on fallback. */
async function runWebCodecs(
  file: File,
  plan: DownscalePlan,
  outputName: string,
  opts: DownscaleOptions,
  setHdr: (hdr: boolean) => void,
): Promise<File> {
  const { signal, onProgress } = opts;
  if (!hasWebCodecs()) throw new EngineUnavailable('WebCodecs is not available');
  const mb = await import('mediabunny');
  const { video, audio, videoQuality } = buildConversionOptions(plan);
  const quality = new mb.Quality(videoQuality);
  const supported = await mb.canEncodeVideo('avc', {
    width: plan.width,
    height: plan.height,
    quality,
  });
  if (!supported) throw new EngineUnavailable('H.264 encoder refused the plan');
  signal.throwIfAborted();

  let input: InstanceType<typeof mb.Input> | null = new mb.Input({
    source: new mb.BlobSource(file),
    formats: mb.ALL_FORMATS,
  });
  let target: InstanceType<typeof mb.BufferTarget> | null = new mb.BufferTarget();
  let conversion: Awaited<ReturnType<typeof mb.Conversion.init>> | null = null;
  const cancel = () => {
    void conversion?.cancel();
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    setHdr(await readHdr(await input.getPrimaryVideoTrack()));
    const output = new mb.Output({ format: new mb.Mp4OutputFormat(), target });
    conversion = await mb.Conversion.init({
      input,
      output,
      tracks: 'primary',
      video: { ...video, quality },
      audio,
      showWarnings: false,
    });
    signal.throwIfAborted();
    assertUsableConversion(conversion);
    conversion.onProgress = (p) => onProgress(Math.max(0, Math.min(99, Math.floor(p * 100))));
    await conversion.execute();
    signal.throwIfAborted();
    const buffer = target.buffer;
    if (!buffer || !buffer.byteLength) throw new EngineUnavailable('Empty conversion output');
    return new File([buffer], outputName, { type: 'video/mp4' });
  } catch (error) {
    if (conversion?.state === 'executing') await conversion.cancel().catch(() => {});
    throw error;
  } finally {
    signal.removeEventListener('abort', cancel);
    input.dispose();
    input = null;
    target = null;
    conversion = null;
  }
}

async function assertPublishable(out: File, plan: DownscalePlan, forStories: boolean) {
  if (out.size > plan.maxBytes)
    throw new DownscaleOutputInvalid('O vídeo reduzido ainda excede o limite de tamanho.');
  const meta = await probeVideo(out);
  const errors = validateMedia(
    [
      {
        id: 0,
        kind: 'video',
        mime_type: out.type,
        size_bytes: out.size,
        width: meta.width,
        height: meta.height,
        duration_seconds: meta.duration_seconds,
      },
    ],
    { forStories },
  );
  if (errors.length) throw new DownscaleOutputInvalid(errors[0].message);
}

export async function downscaleVideo(
  file: File,
  plan: DownscalePlan,
  opts: DownscaleOptions,
): Promise<DownscaleResult> {
  const { signal, onProgress } = opts;
  signal.throwIfAborted();
  const outputName = downscaledFilename(file.name, plan);
  // Decided against the original before anything runs, so a failed attempt can't change it.
  const ffmpegEligible = file.size <= fallbackCeiling();
  let hdr = false;
  let out: File;
  let engine: DownscaleResult['engine'];
  try {
    out = await runWebCodecs(file, plan, outputName, opts, (v) => (hdr = v));
    engine = 'webcodecs';
  } catch (error) {
    signal.throwIfAborted();
    if (!ffmpegEligible)
      throw error instanceof EngineUnavailable ? error : new EngineUnavailable(String(error));
    out = await runFfmpegScale(
      file,
      scaleVideoArguments(plan),
      plan.maxBytes,
      signal,
      onProgress,
      outputName,
    );
    engine = 'ffmpeg';
  }
  signal.throwIfAborted();
  await assertPublishable(out, plan, opts.forStories);
  onProgress(100);
  return { file: out, engine, hdr, width: plan.width, height: plan.height };
}
