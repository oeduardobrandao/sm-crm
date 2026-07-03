import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDoc } from './fixtures';

// Fake timers + async hook state updates land outside RTL's auto-`act` tracking unless the
// advance itself is wrapped — used everywhere below instead of a bare
// `vi.advanceTimersByTimeAsync` so React never warns about an unwrapped state update.
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const satoriDefault = vi.fn(async () => '<svg>rendered</svg>');
const satoriInit = vi.fn(async () => {});
vi.mock('satori/standalone', () => ({
  default: (...args: unknown[]) => satoriDefault(...args),
  init: (...args: unknown[]) => satoriInit(...args),
}));

const fontManifestState = { data: undefined as unknown, error: null as unknown };
const imageUrlsState = { data: undefined as unknown, error: null as unknown };
vi.mock('../hooks/useFontManifest', () => ({
  useFontManifest: () => fontManifestState,
}));
vi.mock('../hooks/useImageUrls', () => ({
  useImageUrls: () => imageUrlsState,
}));

import { useSatoriRenderer } from '../hooks/useSatoriRenderer';

describe('useSatoriRenderer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    satoriDefault.mockClear();
    satoriInit.mockClear();
    satoriDefault.mockResolvedValue('<svg>rendered</svg>');
    fontManifestState.data = [
      { name: 'dm-sans', data: new ArrayBuffer(1), weight: 400, style: 'normal' },
    ];
    fontManifestState.error = null;
    imageUrlsState.data = new Map();
    imageUrlsState.error = null;
    global.fetch = vi.fn(
      async () => new Response(new ArrayBuffer(4), { status: 200 }),
    ) as typeof fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not render while doc is undefined', async () => {
    renderHook(() => useSatoriRenderer(undefined, 0));
    await advance(500);
    expect(satoriDefault).not.toHaveBeenCalled();
  });

  it('does not render while fonts are still loading', async () => {
    fontManifestState.data = undefined;
    renderHook(() => useSatoriRenderer(makeDoc(), 0));
    await advance(500);
    expect(satoriDefault).not.toHaveBeenCalled();
  });

  it('does not render while images are still loading', async () => {
    imageUrlsState.data = undefined;
    renderHook(() => useSatoriRenderer(makeDoc(), 0));
    await advance(500);
    expect(satoriDefault).not.toHaveBeenCalled();
  });

  it('renders after the 150ms debounce once every dependency is ready', async () => {
    const { result } = renderHook(() => useSatoriRenderer(makeDoc(), 0));
    await advance(149);
    expect(satoriDefault).not.toHaveBeenCalled();
    await advance(1);
    expect(satoriDefault).toHaveBeenCalledTimes(1);
    expect(result.current.svg).toBe('<svg>rendered</svg>');
    expect(result.current.error).toBeNull();
  });

  it('collapses rapid consecutive doc changes into a single render (real debounce, not per-change)', async () => {
    const doc = makeDoc();
    const { rerender } = renderHook(({ doc, pageIndex }) => useSatoriRenderer(doc, pageIndex), {
      initialProps: { doc, pageIndex: 0 },
    });
    await advance(50);
    rerender({ doc: makeDoc({ pages: [...doc.pages] }), pageIndex: 0 });
    await advance(50);
    rerender({ doc: makeDoc({ pages: [...doc.pages] }), pageIndex: 0 });
    await advance(150);
    expect(satoriDefault).toHaveBeenCalledTimes(1);
  });

  it('a slow render superseded by a newer commit never overwrites the newer result (generation guard)', async () => {
    let resolveFirst!: (svg: string) => void;
    satoriDefault.mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)));

    const { result, rerender } = renderHook(({ doc }) => useSatoriRenderer(doc, 0), {
      initialProps: { doc: makeDoc() },
    });
    await advance(150); // first render's timer fires, satori call is now in flight (unresolved)
    expect(satoriDefault).toHaveBeenCalledTimes(1);

    // A second, newer commit arrives and completes BEFORE the first (stale) call resolves.
    satoriDefault.mockResolvedValueOnce('<svg>second</svg>');
    rerender({ doc: makeDoc({ pages: [{ ...makeDoc().pages[0], id: 'page-2' }] }) });
    await advance(150);
    expect(result.current.svg).toBe('<svg>second</svg>');

    // The stale first call finally resolves — it must NOT clobber the newer, already-applied result.
    await act(async () => resolveFirst('<svg>stale-first</svg>'));
    expect(result.current.svg).toBe('<svg>second</svg>');
  });

  it('surfaces a font-manifest error without ever calling satori', async () => {
    fontManifestState.data = undefined;
    fontManifestState.error = new Error('unknown font variant');
    const { result } = renderHook(() => useSatoriRenderer(makeDoc(), 0));
    await advance(500);
    expect(satoriDefault).not.toHaveBeenCalled();
    expect(result.current.error).toMatchObject({ message: 'unknown font variant' });
  });

  it('surfaces an unresolved-image error thrown from the resolveImageSrc callback', async () => {
    const doc = makeDoc({
      pages: [
        {
          id: 'page-1',
          background: { type: 'image', file_id: 999, fit: 'cover' },
          layers: [],
        },
      ],
    });
    imageUrlsState.data = new Map(); // 999 deliberately unresolved
    const { result } = renderHook(() => useSatoriRenderer(doc, 0));
    await advance(150);
    expect(result.current.error).toMatchObject({ message: expect.stringContaining('999') });
    expect(satoriDefault).not.toHaveBeenCalled();
  });
});
