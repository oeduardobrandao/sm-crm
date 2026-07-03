import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDoc, makePage, makeTextLayer } from './fixtures';

// Fake timers aren't strictly needed here (no debounce in this hook), but every async hook
// state update must still be wrapped in `act` so React never warns about an unwrapped update —
// same helper/pattern as useSatoriRenderer.test.tsx.
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

const satoriDefault = vi.fn(async () => '<svg width="200" height="40"></svg>');
vi.mock('satori/standalone', () => ({
  default: (...args: unknown[]) => satoriDefault(...args),
  init: vi.fn(async () => {}),
}));

const fontManifestState = { data: undefined as unknown, error: null as unknown };
vi.mock('../hooks/useFontManifest', () => ({
  useFontManifest: () => fontManifestState,
}));

// `ensureSatoriReady` lives in useSatoriRenderer.ts; useTextMeasurement re-exports/reuses it, so
// this mock must intercept the SAME module useTextMeasurement.ts imports from — the real
// singleton is never exercised here (unit test, not the real-browser WASM spike).
const ensureSatoriReady = vi.fn(async () => ({ default: satoriDefault }));
vi.mock('../hooks/useSatoriRenderer', () => ({
  ensureSatoriReady: (...args: unknown[]) => ensureSatoriReady(...args),
}));

import {
  __resetMeasurementCacheForTests,
  measurementCacheKey,
  useTextMeasurement,
} from '../hooks/useTextMeasurement';

// The hook reads `getBBox()` (the SVG content's actual rendered ink extents), NEVER
// `getBoundingClientRect()` (the element's declared viewport/layout box — for satori's
// measurement-tree output that's the wrapper's `width="{layer.w}" height="100000"`, an
// intentionally-huge unbounded value, not the real text geometry). This mock stubs ONLY
// `getBBox()` so a regression back to `getBoundingClientRect()` would leave every measurement
// undefined/erroring rather than silently passing with a coincidentally-plausible fake value —
// confirmed live in a real browser during PR 2.B2 that using `getBoundingClientRect()` here
// produces a ~100000px-tall result for every text layer.
function mockGetBBox(width: number, height: number) {
  return vi.fn(() => ({
    x: 0,
    y: 0,
    width,
    height,
  })) as unknown as typeof SVGGraphicsElement.prototype.getBBox;
}

describe('useTextMeasurement', () => {
  beforeEach(() => {
    __resetMeasurementCacheForTests();
    satoriDefault.mockClear();
    satoriDefault.mockResolvedValue('<svg width="200" height="40"></svg>');
    ensureSatoriReady.mockClear();
    fontManifestState.data = [
      { name: 'dm-sans', data: new ArrayBuffer(1), weight: 400, style: 'normal' },
    ];
    fontManifestState.error = null;
    SVGElement.prototype.getBBox = mockGetBBox(200, 40);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('measures a text layer and returns its height', async () => {
    const doc = makeDoc();
    const { result } = renderHook(() => useTextMeasurement(doc, 0));
    await flush();

    expect(satoriDefault).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
    expect(result.current.heights.get('layer-1')).toEqual({ width: 200, height: 40 });
  });

  it("reads the measured height from getBBox, not from the SVG wrapper's own declared (huge, unbounded) width/height attributes", async () => {
    // buildTextMeasurementTree wraps every measured layer in a box with height:100000 so
    // satori/yoga never clips it (see @mesaas/design-render-tree's own doc comment) — satori's
    // output SVG therefore legitimately carries a huge declared height. This test's `satoriDefault`
    // mock returns exactly that shape (a big wrapper size) while `getBBox` (stubbed separately,
    // simulating the real content's much smaller ink extents) reports the true, small content
    // size — proving the hook reports getBBox's value, not the wrapper's declared attributes.
    satoriDefault.mockResolvedValueOnce('<svg width="900" height="100000"></svg>');
    SVGElement.prototype.getBBox = mockGetBBox(857.6, 240.7);

    const doc = makeDoc();
    const { result } = renderHook(() => useTextMeasurement(doc, 0));
    await flush();

    expect(result.current.heights.get('layer-1')).toEqual({ width: 857.6, height: 240.7 });
  });

  it('caches identical (content, style, w) tuples across two different layer ids', async () => {
    const doc = makeDoc({
      pages: [
        makePage({
          layers: [
            makeTextLayer({ id: 'a' }),
            makeTextLayer({ id: 'b' }), // identical content/style/w, different id
          ],
        }),
      ],
    });
    const { result } = renderHook(() => useTextMeasurement(doc, 0));
    await flush();

    // Both layers resolve, but satori was only invoked once — the second hit the cache.
    expect(satoriDefault).toHaveBeenCalledTimes(1);
    expect(result.current.heights.get('a')).toEqual({ width: 200, height: 40 });
    expect(result.current.heights.get('b')).toEqual({ width: 200, height: 40 });
  });

  it('re-measures when content changes', async () => {
    const doc = makeDoc();
    const { rerender } = renderHook(({ doc }) => useTextMeasurement(doc, 0), {
      initialProps: { doc },
    });
    await flush();
    expect(satoriDefault).toHaveBeenCalledTimes(1);

    const changedDoc = makeDoc({
      pages: [makePage({ layers: [makeTextLayer({ text: 'texto diferente' })] })],
    });
    rerender({ doc: changedDoc });
    await flush();
    expect(satoriDefault).toHaveBeenCalledTimes(2);
  });

  it('re-measures when w changes', async () => {
    const doc = makeDoc();
    const { rerender } = renderHook(({ doc }) => useTextMeasurement(doc, 0), {
      initialProps: { doc },
    });
    await flush();
    expect(satoriDefault).toHaveBeenCalledTimes(1);

    const widerDoc = makeDoc({
      pages: [makePage({ layers: [makeTextLayer({ w: 400 })] })],
    });
    rerender({ doc: widerDoc });
    await flush();
    expect(satoriDefault).toHaveBeenCalledTimes(2);
  });

  it('does not re-measure when an unrelated field (x/y/rotation) changes', async () => {
    const doc = makeDoc();
    const { rerender } = renderHook(({ doc }) => useTextMeasurement(doc, 0), {
      initialProps: { doc },
    });
    await flush();
    expect(satoriDefault).toHaveBeenCalledTimes(1);

    const movedDoc = makeDoc({
      pages: [makePage({ layers: [makeTextLayer({ x: 500, y: 500, rotation: 15 })] })],
    });
    rerender({ doc: movedDoc });
    await flush();
    expect(satoriDefault).toHaveBeenCalledTimes(1); // still cached — geometry didn't change
  });

  it('handles a satori render error without crashing, surfacing it via `error`', async () => {
    satoriDefault.mockRejectedValueOnce(new Error('satori boom'));
    const doc = makeDoc({
      pages: [makePage({ layers: [makeTextLayer({ id: 'will-fail', text: 'unique text' })] })],
    });
    const { result } = renderHook(() => useTextMeasurement(doc, 0));
    await flush();

    expect(result.current.error).toMatchObject({ message: 'satori boom' });
    expect(result.current.heights.get('will-fail')).toBeUndefined();
  });

  it('surfaces a font-manifest error without ever calling satori', async () => {
    fontManifestState.data = undefined;
    fontManifestState.error = new Error('unknown font variant');
    const doc = makeDoc();
    const { result } = renderHook(() => useTextMeasurement(doc, 0));
    await flush();

    expect(satoriDefault).not.toHaveBeenCalled();
    expect(result.current.error).toMatchObject({ message: 'unknown font variant' });
  });

  it('returns an empty map (no satori calls) when the active page has no text layers', async () => {
    const doc = makeDoc({
      pages: [
        makePage({
          layers: [
            { ...makeTextLayer({ id: 'shape' }), type: 'shape', h: 50, shape: 'rect' } as never,
          ],
        }),
      ],
    });
    const { result } = renderHook(() => useTextMeasurement(doc, 0));
    await flush();

    expect(satoriDefault).not.toHaveBeenCalled();
    expect(result.current.heights.size).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it('measurementCacheKey ignores id/x/y/rotation/opacity/locked but includes content+style+w', () => {
    const a = makeTextLayer({ id: 'a', x: 0, y: 0, rotation: 0, opacity: 1, locked: false });
    const b = makeTextLayer({ id: 'b', x: 999, y: 999, rotation: 45, opacity: 0.5, locked: true });
    expect(measurementCacheKey(a)).toBe(measurementCacheKey(b));

    const c = makeTextLayer({ id: 'c', text: 'different text' });
    expect(measurementCacheKey(a)).not.toBe(measurementCacheKey(c));
  });
});
