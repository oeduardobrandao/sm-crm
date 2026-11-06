import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mb = vi.hoisted(() => {
  class ConversionCanceledError extends Error {}
  const state = {
    canEncode: true as boolean,
    hdr: (async () => false) as () => Promise<boolean>,
    track: true,
    isValid: true,
    discardedTracks: [] as unknown[],
    outputBytes: 1000,
    execute: null as null | (() => Promise<void>),
    initOptions: null as null | Record<string, unknown>,
    canEncodeArgs: null as null | unknown[],
    cancel: vi.fn(),
    dispose: vi.fn(),
    onProgress: undefined as undefined | ((p: number) => void),
    rejectExecute: null as null | ((e: Error) => void),
  };
  return { state, ConversionCanceledError };
});

vi.mock('mediabunny', () => {
  const { state, ConversionCanceledError } = mb;
  class Quality {
    constructor(public options: unknown) {}
  }
  class BlobSource {
    constructor(public blob: Blob) {}
  }
  class BufferTarget {
    buffer: ArrayBuffer | null = null;
  }
  class Mp4OutputFormat {}
  class Input {
    constructor(public options: unknown) {}
    async getPrimaryVideoTrack() {
      return state.track ? { hasHighDynamicRange: () => state.hdr() } : null;
    }
    dispose = state.dispose;
  }
  class Output {
    constructor(public options: { target: BufferTarget }) {}
  }
  const Conversion = {
    async init(options: Record<string, unknown>) {
      state.initOptions = options;
      const output = options.output as Output;
      const conversion = {
        isValid: state.isValid,
        discardedTracks: state.discardedTracks,
        onProgress: undefined as undefined | ((p: number) => void),
        state: 'idle',
        cancel: async () => {
          state.cancel();
          state.rejectExecute?.(new ConversionCanceledError('canceled'));
        },
        async execute() {
          state.onProgress = conversion.onProgress;
          conversion.state = 'executing';
          if (state.execute) await state.execute();
          else
            await new Promise<void>((resolve, reject) => {
              state.rejectExecute = reject;
              queueMicrotask(() => {
                if (state.rejectExecute === reject) {
                  conversion.onProgress?.(0.5);
                  resolve();
                }
              });
            });
          output.options.target.buffer = new ArrayBuffer(state.outputBytes);
          conversion.state = 'done';
        },
      };
      return conversion;
    },
  };
  return {
    Quality,
    BlobSource,
    BufferTarget,
    Mp4OutputFormat,
    Input,
    Output,
    Conversion,
    ConversionCanceledError,
    ALL_FORMATS: [],
    canEncodeVideo: async (...args: unknown[]) => {
      state.canEncodeArgs = args;
      return state.canEncode;
    },
  };
});

const ffmpeg = vi.hoisted(() => ({ runFfmpegScale: vi.fn() }));
vi.mock('../exportVideo', () => ({ runFfmpegScale: ffmpeg.runFfmpegScale }));

const probe = vi.hoisted(() => ({ probeVideo: vi.fn() }));
vi.mock('@/services/postMedia', () => ({ probeVideo: probe.probeVideo }));

import { planDownscale } from '../downscalePlan';
import { scaleVideoArguments } from '../geometry';
import { downscaleVideo, EngineUnavailable, inspectForDownscale } from '../downscaleVideo';

const MB = 1024 * 1024;
const plan = planDownscale(
  { width: 2160, height: 3840, sizeBytes: 400 * MB, durationSeconds: 30 },
  { maxBytes: 300 * MB },
)!;

function bigFile(name: string, size: number): File {
  const f = new File([new Uint8Array(8)], name, { type: 'video/quicktime' });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

const opts = (signal = new AbortController().signal) => ({
  forStories: false,
  signal,
  onProgress: vi.fn(),
});

beforeEach(() => {
  Object.assign(mb.state, {
    canEncode: true,
    hdr: async () => false,
    track: true,
    isValid: true,
    discardedTracks: [],
    outputBytes: 1000,
    execute: null,
    initOptions: null,
    canEncodeArgs: null,
    onProgress: undefined,
    rejectExecute: null,
  });
  mb.state.cancel.mockReset();
  mb.state.dispose.mockReset();
  vi.stubGlobal('VideoEncoder', class {});
  probe.probeVideo.mockResolvedValue({ width: 1080, height: 1920, duration_seconds: 30 });
  ffmpeg.runFfmpegScale.mockImplementation(
    async (_f: File, _a: string[], _m: number, _s: AbortSignal, _p: unknown, name: string) =>
      new File([new Uint8Array(500)], name, { type: 'video/mp4' }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('downscaleVideo', () => {
  it('(a) converts with WebCodecs and names the output after the plan', async () => {
    const o = opts();
    const result = await downscaleVideo(bigFile('clip.mov', 400 * MB), plan, o);
    expect(result.engine).toBe('webcodecs');
    expect(result.file.name).toBe('clip (1080p).mp4');
    expect(result.file.type).toBe('video/mp4');
    expect(result.file.size).toBe(1000);
    expect(result).toMatchObject({ width: 1080, height: 1920, hdr: false });
    expect(ffmpeg.runFfmpegScale).not.toHaveBeenCalled();
    expect(mb.state.initOptions).toMatchObject({ tracks: 'primary', showWarnings: false });
    const video = mb.state.initOptions!.video as Record<string, unknown>;
    expect(video).toMatchObject({ codec: 'avc', width: 1080, height: 1920, fit: 'fill' });
    expect((video.quality as { options: unknown }).options).toEqual({
      bitrate: plan.bitrate,
      bitrateMode: 'variable',
    });
    expect(mb.state.canEncodeArgs![1]).toMatchObject({ width: 1080, height: 1920 });
    expect(o.onProgress).toHaveBeenCalledWith(50);
    expect(o.onProgress).toHaveBeenLastCalledWith(100);
    expect(mb.state.dispose).toHaveBeenCalled();
  });

  it('(b) falls back to the scale-only ffmpeg run when a track is discarded', async () => {
    mb.state.discardedTracks = [{ reason: 'undecodable_source_codec' }];
    const file = bigFile('clip.mov', 400 * MB);
    const o = opts();
    const result = await downscaleVideo(file, plan, o);
    expect(result.engine).toBe('ffmpeg');
    expect(ffmpeg.runFfmpegScale).toHaveBeenCalledWith(
      file,
      scaleVideoArguments(plan),
      plan.maxBytes,
      o.signal,
      o.onProgress,
      'clip (1080p).mp4',
    );
    expect(mb.state.dispose).toHaveBeenCalled();
  });

  it('(b2) falls back when the WebCodecs run throws', async () => {
    mb.state.execute = async () => {
      throw new Error('decoder crashed');
    };
    const result = await downscaleVideo(bigFile('clip.mov', 400 * MB), plan, opts());
    expect(result.engine).toBe('ffmpeg');
  });

  it('(c) rejects with EngineUnavailable without WebCodecs above the ffmpeg ceiling', async () => {
    vi.unstubAllGlobals();
    await expect(
      downscaleVideo(bigFile('clip.mov', 600 * MB), plan, opts()),
    ).rejects.toBeInstanceOf(EngineUnavailable);
    expect(ffmpeg.runFfmpegScale).not.toHaveBeenCalled();
  });

  it('(c2) uses the lower iOS ceiling', async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
      maxTouchPoints: 5,
    });
    await expect(
      downscaleVideo(bigFile('clip.mov', 300 * MB), plan, opts()),
    ).rejects.toBeInstanceOf(EngineUnavailable);
  });

  it('(d) rejects an output above the size limit without retrying in ffmpeg', async () => {
    mb.state.outputBytes = plan.maxBytes + 1;
    await expect(downscaleVideo(bigFile('clip.mov', 400 * MB), plan, opts())).rejects.toThrow();
    expect(ffmpeg.runFfmpegScale).not.toHaveBeenCalled();
  });

  it('(e) rejects an output that still breaks the Instagram limits', async () => {
    probe.probeVideo.mockResolvedValue({ width: 3840, height: 2160, duration_seconds: 30 });
    await expect(downscaleVideo(bigFile('clip.mov', 400 * MB), plan, opts())).rejects.toThrow(
      /1920/,
    );
  });

  it('(f) cancels the conversion on abort and rejects with the abort reason', async () => {
    const controller = new AbortController();
    const reason = new Error('user canceled');
    let started: () => void = () => {};
    const running = new Promise<void>((r) => (started = r));
    mb.state.execute = () =>
      new Promise<void>((_resolve, reject) => {
        mb.state.rejectExecute = reject;
        started();
      });
    const pending = downscaleVideo(bigFile('clip.mov', 400 * MB), plan, opts(controller.signal));
    await running;
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(mb.state.cancel).toHaveBeenCalled();
    expect(ffmpeg.runFfmpegScale).not.toHaveBeenCalled();
  });

  it('(h) treats a failing HDR probe as SDR and still converts', async () => {
    mb.state.hdr = async () => {
      throw new Error('no color info');
    };
    const result = await downscaleVideo(bigFile('clip.mov', 400 * MB), plan, opts());
    expect(result).toMatchObject({ engine: 'webcodecs', hdr: false });
  });

  it('reports HDR sources', async () => {
    mb.state.hdr = async () => true;
    const result = await downscaleVideo(bigFile('clip.mov', 400 * MB), plan, opts());
    expect(result.hdr).toBe(true);
  });
});

describe('inspectForDownscale', () => {
  it('(g) picks WebCodecs when the encoder accepts the plan', async () => {
    mb.state.hdr = async () => true;
    await expect(inspectForDownscale(bigFile('a.mov', 400 * MB), plan)).resolves.toEqual({
      engine: 'webcodecs',
      hdr: true,
    });
  });

  it('(g) picks ffmpeg when the encoder refuses and the file fits the ceiling', async () => {
    mb.state.canEncode = false;
    await expect(inspectForDownscale(bigFile('a.mov', 400 * MB), plan)).resolves.toEqual({
      engine: 'ffmpeg',
      hdr: false,
    });
  });

  it('(g) reports none when neither engine can take the file', async () => {
    mb.state.canEncode = false;
    await expect(inspectForDownscale(bigFile('a.mov', 600 * MB), plan)).resolves.toEqual({
      engine: 'none',
      hdr: false,
    });
  });

  it('(g) skips WebCodecs when the browser has no VideoEncoder', async () => {
    vi.unstubAllGlobals();
    const support = await inspectForDownscale(bigFile('a.mov', 400 * MB), plan);
    expect(support.engine).toBe('ffmpeg');
  });
});
