import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildFontFamilyPatch,
  collectDocFontVariants,
  useFontManifest,
} from '../hooks/useFontManifest';
import { makeDoc, makePage, makeTextLayer } from './fixtures';

describe('collectDocFontVariants', () => {
  it('collects the layer-level variant for a plain-text layer', () => {
    const doc = makeDoc();
    expect(collectDocFontVariants(doc)).toEqual([
      { fontKey: 'dm-sans', weight: 400, style: 'normal' },
    ]);
  });

  it('dedupes identical variants across layers and pages', () => {
    const doc = makeDoc({
      pages: [
        makePage({ id: 'p1', layers: [makeTextLayer({ id: 'a' }), makeTextLayer({ id: 'b' })] }),
        makePage({ id: 'p2', layers: [makeTextLayer({ id: 'c' })] }),
      ],
    });
    expect(collectDocFontVariants(doc)).toEqual([
      { fontKey: 'dm-sans', weight: 400, style: 'normal' },
    ]);
  });

  it('collects a distinct variant per styled run, falling back to the layer for unset fields', () => {
    const doc = makeDoc({
      pages: [
        makePage({
          layers: [
            makeTextLayer({
              id: 'a',
              text: undefined,
              runs: [
                { text: 'plain' },
                { text: 'bold', font_weight: 700 },
                { text: 'italic', font_style: 'italic' },
              ],
            }),
          ],
        }),
      ],
    });
    expect(collectDocFontVariants(doc)).toEqual([
      { fontKey: 'dm-sans', weight: 400, style: 'normal' },
      { fontKey: 'dm-sans', weight: 700, style: 'normal' },
      { fontKey: 'dm-sans', weight: 400, style: 'italic' },
    ]);
  });

  it('ignores non-text layers', () => {
    const doc = makeDoc({
      pages: [
        makePage({
          layers: [
            { ...makeTextLayer({ id: 'shape' }), type: 'shape', h: 50, shape: 'rect' } as never,
          ],
        }),
      ],
    });
    expect(collectDocFontVariants(doc)).toEqual([]);
  });
});

describe('useFontManifest', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      // Every real (font_key, weight, style) variant ships both a `latin` and a `latinExt` TTF
      // file — matching any `/fonts/estudio/**/*.ttf` path keeps this mock honest about that
      // rather than only covering the `latin` file and silently missing the second fetch.
      if (url.includes('/fonts/estudio/') && url.includes('.ttf')) {
        return new Response(new ArrayBuffer(8), { status: 200 });
      }
      return new Response(null, { status: 404 });
    }) as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function renderWithClient(doc: Parameters<typeof useFontManifest>[0]) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return renderHook(() => useFontManifest(doc), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    });
  }

  it('loads the doc font plus the fallback family (dm-sans is not the fallback)', async () => {
    const { result } = renderWithClient(makeDoc());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const names = result.current.data!.map((f) => f.name);
    expect(names).toContain('dm-sans');
    expect(names).toContain('inter'); // fallbackKey per the real manifest fixture
  });

  it('does not double-fetch the fallback family when the doc already uses it', async () => {
    const doc = makeDoc({ pages: [makePage({ layers: [makeTextLayer({ font_key: 'inter' })] })] });
    const { result } = renderWithClient(doc);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // inter's 400/normal variant ships 2 files (latin + latinExt) — both become separate satori
    // entries sharing one name/weight/style, per satori's own per-glyph fallback convention. If
    // the fallback-append logic's dedup check were broken, this would be 4 (the doc-driven load
    // PLUS a second, redundant fallback-triggered load of the same variant).
    const interEntries = result.current.data!.filter((f) => f.name === 'inter');
    expect(interEntries).toHaveLength(2);
  });

  it('is disabled (no fetch) when doc is undefined', () => {
    renderWithClient(undefined);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('rejects with a clear error for an unknown font variant', async () => {
    const doc = makeDoc({
      pages: [makePage({ layers: [makeTextLayer({ font_key: 'not-a-real-font' })] })],
    });
    const { result } = renderWithClient(doc);
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({
      message: expect.stringContaining('not-a-real-font'),
    });
  });
});

describe('buildFontFamilyPatch (T3.4 — single ownership of the family-switch fallback)', () => {
  it('keeps the current weight when the new family ships it at the current style', () => {
    expect(buildFontFamilyPatch('playfair-display', { font_weight: 700 })).toEqual({
      font_key: 'playfair-display',
      font_weight: 700,
    });
  });

  it('falls back to the first available weight when the current one is unsupported', () => {
    // dm-serif-display ships only 400/normal.
    expect(buildFontFamilyPatch('dm-serif-display', { font_weight: 700 })).toEqual({
      font_key: 'dm-serif-display',
      font_weight: 400,
    });
  });

  it("resets font_style to normal when the new family doesn't ship the current style", () => {
    // bebas-neue ships no italic at all.
    expect(buildFontFamilyPatch('bebas-neue', { font_weight: 400, font_style: 'italic' })).toEqual({
      font_key: 'bebas-neue',
      font_weight: 400,
      font_style: 'normal',
    });
  });

  it('does NOT touch font_style when the new family ships it', () => {
    expect(
      buildFontFamilyPatch('playfair-display', { font_weight: 400, font_style: 'italic' }),
    ).toEqual({ font_key: 'playfair-display', font_weight: 400 });
  });
});
