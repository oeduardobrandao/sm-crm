import type {
  ConversionAudioOptions,
  ConversionVideoOptions,
  QuantitativeQualityOptions,
} from 'mediabunny';
import type { DownscalePlan } from './downscalePlan';

/** The browser cannot run this conversion; the caller may fall back to ffmpeg. */
export class EngineUnavailable extends Error {
  constructor(message = 'Downscale engine unavailable') {
    super(message);
    this.name = 'EngineUnavailable';
  }
}

/** Pure: `videoQuality` becomes `new Quality(...)` after the lazy import. */
export function buildConversionOptions(plan: DownscalePlan): {
  video: Omit<ConversionVideoOptions, 'quality'>;
  audio: ConversionAudioOptions;
  videoQuality: QuantitativeQualityOptions;
} {
  return {
    video: {
      codec: 'avc',
      width: plan.width,
      height: plan.height,
      fit: 'fill',
      allowTransformationMetadata: false,
    },
    audio: { codec: 'aac' },
    videoQuality: { bitrate: plan.bitrate, bitrateMode: 'variable' },
  };
}

/** A discarded track means the output would lose audio or video: never ship that. */
export function assertUsableConversion(c: {
  isValid: boolean;
  discardedTracks: readonly unknown[];
}): void {
  if (!c.isValid) throw new EngineUnavailable('Conversion is not valid');
  if (c.discardedTracks.length > 0) throw new EngineUnavailable('Conversion discarded a track');
}
