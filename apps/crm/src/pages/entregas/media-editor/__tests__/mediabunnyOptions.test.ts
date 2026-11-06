import { describe, expect, it } from 'vitest';
import { planDownscale } from '../downscalePlan';
import {
  assertUsableConversion,
  buildConversionOptions,
  EngineUnavailable,
} from '../mediabunnyOptions';

const plan = planDownscale(
  { width: 2160, height: 3840, sizeBytes: 1, durationSeconds: 30 },
  { maxBytes: 300 * 2 ** 20 },
)!;

describe('buildConversionOptions', () => {
  const { video, audio, videoQuality } = buildConversionOptions(plan);

  it('scales to the plan in H.264 without rotation metadata', () => {
    expect(video).toEqual({
      codec: 'avc',
      width: 1080,
      height: 1920,
      fit: 'fill',
      allowTransformationMetadata: false,
    });
    expect(video).not.toHaveProperty('bitrate');
    expect(video).not.toHaveProperty('quality');
  });

  it('carries the plan bitrate as quantitative quality', () => {
    expect(videoQuality).toEqual({ bitrate: 8_000_000, bitrateMode: 'variable' });
  });

  it('re-encodes audio to AAC', () => {
    expect(audio).toEqual({ codec: 'aac' });
  });
});

describe('assertUsableConversion', () => {
  it('rejects a conversion that discarded a track', () => {
    expect(() => assertUsableConversion({ isValid: true, discardedTracks: [{}] })).toThrow(
      EngineUnavailable,
    );
  });
  it('rejects an invalid conversion', () => {
    expect(() => assertUsableConversion({ isValid: false, discardedTracks: [] })).toThrow(
      EngineUnavailable,
    );
  });
  it('accepts a valid conversion that kept every track', () => {
    expect(() => assertUsableConversion({ isValid: true, discardedTracks: [] })).not.toThrow();
  });
});
