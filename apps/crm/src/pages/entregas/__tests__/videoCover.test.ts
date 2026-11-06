import { describe, expect, it } from 'vitest';
import {
  formatCoverTimestamp,
  isCustomVideoCover,
  mediaPreviewAspect,
  videoCoverChipLabel,
  videoCoverChipShortLabel,
  videoCoverDescription,
  videoCoverState,
} from '../videoCover';

describe('videoCoverState', () => {
  it('reads the source and frame stored on the file', () => {
    expect(videoCoverState({ thumbnail_source: 'auto', thumbnail_frame_ms: 500 })).toEqual({
      kind: 'default',
      frameMs: 500,
    });
    expect(videoCoverState({ thumbnail_source: 'frame', thumbnail_frame_ms: 12300 })).toEqual({
      kind: 'frame',
      frameMs: 12300,
    });
    expect(videoCoverState({ thumbnail_source: 'image', thumbnail_frame_ms: null })).toEqual({
      kind: 'image',
    });
    // Files from before thumbnail_source, and responses from an older function.
    expect(videoCoverState({ thumbnail_source: null, thumbnail_frame_ms: null })).toEqual({
      kind: 'unknown',
    });
    expect(videoCoverState({})).toEqual({ kind: 'unknown' });
  });

  it('counts a picked frame or an image as a chosen cover', () => {
    expect(isCustomVideoCover({ kind: 'frame', frameMs: 1 })).toBe(true);
    expect(isCustomVideoCover({ kind: 'image' })).toBe(true);
    expect(isCustomVideoCover({ kind: 'default', frameMs: 500 })).toBe(false);
    expect(isCustomVideoCover({ kind: 'unknown' })).toBe(false);
  });
});

describe('cover labels', () => {
  it('names each state on the tile chip', () => {
    expect(videoCoverChipLabel({ kind: 'default', frameMs: 500 })).toBe('Capa padrão');
    expect(videoCoverChipLabel({ kind: 'frame', frameMs: 12300 })).toBe('Capa 0:12.3');
    expect(videoCoverChipLabel({ kind: 'frame', frameMs: null })).toBe('Capa: quadro');
    expect(videoCoverChipLabel({ kind: 'image' })).toBe('Capa: imagem');
    expect(videoCoverChipLabel({ kind: 'unknown' })).toBe('Capa');
  });

  it('has a short form for the narrow phone tiles', () => {
    expect(videoCoverChipShortLabel({ kind: 'default', frameMs: 500 })).toBe('Padrão');
    expect(videoCoverChipShortLabel({ kind: 'frame', frameMs: 75_900 })).toBe('1:15.9');
    expect(videoCoverChipShortLabel({ kind: 'image' })).toBe('Imagem');
  });

  it('describes the state in a sentence', () => {
    expect(videoCoverDescription({ kind: 'frame', frameMs: 12300 })).toBe(
      'Capa escolhida: o quadro em 0:12.3.',
    );
    expect(videoCoverDescription({ kind: 'unknown' })).toMatch(/antes desta versão/);
  });

  it('formats a frame as m:ss.s', () => {
    expect(formatCoverTimestamp(0)).toBe('0:00.0');
    expect(formatCoverTimestamp(3250)).toBe('0:03.2');
    expect(formatCoverTimestamp(75_900)).toBe('1:15.9');
  });
});

describe('mediaPreviewAspect', () => {
  it('follows the file, so 1080×1440 and 1080×1920 are not squares', () => {
    expect(mediaPreviewAspect({ width: 1080, height: 1440 })).toBeCloseTo(0.75);
    expect(mediaPreviewAspect({ width: 1080, height: 1920 })).toBeCloseTo(0.5625);
    expect(mediaPreviewAspect({ width: 1920, height: 1080 })).toBeCloseTo(1.778, 3);
  });

  it('clamps extreme shapes to 1:2 … 2:1 and falls back to square without dimensions', () => {
    expect(mediaPreviewAspect({ width: 100, height: 1000 })).toBe(0.5);
    expect(mediaPreviewAspect({ width: 3000, height: 1000 })).toBe(2);
    expect(mediaPreviewAspect({ width: null, height: 1080 })).toBe(1);
    expect(mediaPreviewAspect({ width: 1080, height: 0 })).toBe(1);
  });
});
