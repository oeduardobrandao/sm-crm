import { describe, expect, it } from 'vitest';
import { planDownscale } from '../downscalePlan';
import { scaleVideoArguments } from '../geometry';

describe('scaleVideoArguments', () => {
  const plan = planDownscale(
    { width: 2160, height: 3840, sizeBytes: 1, durationSeconds: 30 },
    { maxBytes: 300 * 2 ** 20 },
  )!;
  const args = scaleVideoArguments(plan);
  const has = (...seq: string[]) => args.some((_, i) => seq.every((s, j) => args[i + j] === s));

  it('maps streams and scales with even dimensions', () => {
    expect(has('-map', '0:v:0')).toBe(true);
    expect(has('-map', '0:a:0?')).toBe(true);
    expect(has('-vf', 'scale=1080:1920:force_divisible_by=2')).toBe(true);
    expect(has('-pix_fmt', 'yuv420p')).toBe(true);
    expect(has('-b:v', '8000000')).toBe(true);
    expect(has('-c:a', 'aac')).toBe(true);
    expect(has('-movflags', '+faststart')).toBe(true);
    expect(args.at(-1)).toBe('output.mp4');
  });

  it('does not crop, pad, blur or change the frame rate', () => {
    expect(args).not.toContain('-r');
    const joined = args.join(' ');
    for (const word of ['crop', 'pad', 'boxblur']) expect(joined).not.toContain(word);
  });
});
