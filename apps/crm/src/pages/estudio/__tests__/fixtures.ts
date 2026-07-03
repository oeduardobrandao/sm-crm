import type { DesignDoc, NormalizedLayer, NormalizedPage } from '../types';

export function makeTextLayer(overrides: Partial<NormalizedLayer> = {}): NormalizedLayer {
  return {
    id: 'layer-1',
    name: 'Texto 1',
    type: 'text',
    x: 10,
    y: 10,
    w: 200,
    rotation: 0,
    opacity: 1,
    locked: false,
    text: 'Olá mundo',
    font_key: 'dm-sans',
    font_weight: 400,
    font_size: 32,
    line_height: 1.2,
    letter_spacing: 0,
    color: '#000000',
    align: 'left',
    ...overrides,
  } as NormalizedLayer;
}

export function makePage(overrides: Partial<NormalizedPage> = {}): NormalizedPage {
  return {
    id: 'page-1',
    background: { type: 'solid', color: '#ffffff' },
    layers: [makeTextLayer()],
    ...overrides,
  };
}

export function makeDoc(overrides: Partial<DesignDoc> = {}): DesignDoc {
  return {
    version: 1,
    format: 'feed',
    aspect_ratio: '1:1',
    canvas: { width: 1080, height: 1080 },
    pages: [makePage()],
    fileIds: [],
    ...overrides,
  };
}
