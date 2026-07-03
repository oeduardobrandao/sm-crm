import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDoc, makePage } from './fixtures';

// Same fake-timers + act-wrapped-advance pattern as useSatoriRenderer.test.tsx — async hook
// state updates land outside RTL's auto-`act` tracking unless the timer advance itself is
// wrapped.
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

import { usePageThumbnails } from '../hooks/usePageThumbnails';

describe('usePageThumbnails', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    satoriDefault.mockClear();
    satoriInit.mockClear();
    let callCount = 0;
    satoriDefault.mockImplementation(async () => `<svg>rendered-${callCount++}</svg>`);
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
    renderHook(() => usePageThumbnails(undefined));
    await advance(500);
    expect(satoriDefault).not.toHaveBeenCalled();
  });

  it('does not render while fonts are still loading', async () => {
    fontManifestState.data = undefined;
    renderHook(() => usePageThumbnails(makeDoc()));
    await advance(500);
    expect(satoriDefault).not.toHaveBeenCalled();
  });

  it('does not render while images are still loading', async () => {
    imageUrlsState.data = undefined;
    renderHook(() => usePageThumbnails(makeDoc()));
    await advance(500);
    expect(satoriDefault).not.toHaveBeenCalled();
  });

  it('renders one thumbnail per page, keyed by page id, after the debounce', async () => {
    const doc = makeDoc({
      format: 'carrossel',
      pages: [makePage({ id: 'page-1' }), makePage({ id: 'page-2' }), makePage({ id: 'page-3' })],
    });
    const { result } = renderHook(() => usePageThumbnails(doc));
    await advance(149);
    expect(satoriDefault).not.toHaveBeenCalled();
    await advance(1);

    expect(satoriDefault).toHaveBeenCalledTimes(3);
    expect(result.current.thumbnails.size).toBe(3);
    expect(result.current.thumbnails.has('page-1')).toBe(true);
    expect(result.current.thumbnails.has('page-2')).toBe(true);
    expect(result.current.thumbnails.has('page-3')).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('renders a single page for a non-carrossel (single-page) doc', async () => {
    const doc = makeDoc({ format: 'feed', pages: [makePage({ id: 'only-page' })] });
    const { result } = renderHook(() => usePageThumbnails(doc));
    await advance(150);

    expect(satoriDefault).toHaveBeenCalledTimes(1);
    expect(result.current.thumbnails.size).toBe(1);
    expect(result.current.thumbnails.has('only-page')).toBe(true);
  });

  it('re-renders when doc.pages changes (page added)', async () => {
    const doc = makeDoc({ format: 'carrossel', pages: [makePage({ id: 'page-1' })] });
    const { result, rerender } = renderHook(({ doc }) => usePageThumbnails(doc), {
      initialProps: { doc },
    });
    await advance(150);
    expect(result.current.thumbnails.size).toBe(1);
    satoriDefault.mockClear();

    const nextDoc = makeDoc({
      format: 'carrossel',
      pages: [makePage({ id: 'page-1' }), makePage({ id: 'page-2' })],
    });
    rerender({ doc: nextDoc });
    await advance(150);

    expect(satoriDefault).toHaveBeenCalledTimes(2);
    expect(result.current.thumbnails.size).toBe(2);
    expect(result.current.thumbnails.has('page-1')).toBe(true);
    expect(result.current.thumbnails.has('page-2')).toBe(true);
  });

  it('collapses rapid consecutive doc changes into a single render pass', async () => {
    const doc = makeDoc({ format: 'carrossel', pages: [makePage({ id: 'page-1' })] });
    const { rerender } = renderHook(({ doc }) => usePageThumbnails(doc), {
      initialProps: { doc },
    });
    await advance(50);
    rerender({ doc: makeDoc({ format: 'carrossel', pages: [makePage({ id: 'page-1' })] }) });
    await advance(50);
    rerender({ doc: makeDoc({ format: 'carrossel', pages: [makePage({ id: 'page-1' })] }) });
    await advance(150);
    expect(satoriDefault).toHaveBeenCalledTimes(1);
  });

  it('a slow render pass superseded by a newer commit never overwrites the newer result', async () => {
    let resolveFirst!: (svg: string) => void;
    satoriDefault.mockImplementationOnce(() => new Promise((resolve) => (resolveFirst = resolve)));

    const doc = makeDoc({ format: 'carrossel', pages: [makePage({ id: 'page-1' })] });
    const { result, rerender } = renderHook(({ doc }) => usePageThumbnails(doc), {
      initialProps: { doc },
    });
    await advance(150); // first pass's timer fires, satori call in flight (unresolved)
    expect(satoriDefault).toHaveBeenCalledTimes(1);

    // The second pass renders TWO pages (page-1 + page-2) via Promise.all, so it issues two
    // satori calls in page order — queue distinct resolved values for both.
    satoriDefault.mockResolvedValueOnce('<svg>second-page-1</svg>');
    satoriDefault.mockResolvedValueOnce('<svg>second-page-2</svg>');
    rerender({
      doc: makeDoc({
        format: 'carrossel',
        pages: [makePage({ id: 'page-1' }), makePage({ id: 'page-2' })],
      }),
    });
    await advance(150);
    expect(result.current.thumbnails.get('page-1')).toBe('<svg>second-page-1</svg>');
    expect(result.current.thumbnails.get('page-2')).toBe('<svg>second-page-2</svg>');

    await act(async () => resolveFirst('<svg>stale-first</svg>'));
    // Stale first-pass result must not clobber the newer, already-applied map.
    expect(result.current.thumbnails.get('page-1')).toBe('<svg>second-page-1</svg>');
    expect(result.current.thumbnails.get('page-2')).toBe('<svg>second-page-2</svg>');
  });

  it('surfaces a font-manifest error without ever calling satori', async () => {
    fontManifestState.data = undefined;
    fontManifestState.error = new Error('unknown font variant');
    const { result } = renderHook(() => usePageThumbnails(makeDoc()));
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
    const { result } = renderHook(() => usePageThumbnails(doc));
    await advance(150);
    expect(result.current.error).toMatchObject({ message: expect.stringContaining('999') });
    expect(satoriDefault).not.toHaveBeenCalled();
  });
});
