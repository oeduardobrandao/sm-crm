// Client-side satori render loop (docs/estudio-design.md §6.3). Dynamic-imports
// `satori/standalone` and initializes it with satori's own packaged `satori/yoga.wasm` binary —
// module-scope singletons (once per browser tab, not per hook instance), reset-on-failure so a
// transient network blip doesn't wedge every future render for the rest of the session (mirrors
// `design-render-core.ts`'s `ensureWasmInit` pattern on the edge side).
//
// Pinned parity with the edge: same satori version (package.json "satori": "0.26.0" here,
// `npm:satori@0.26.0` there), same `@mesaas/design-render-tree` tree builder, same Twemoji pin —
// same layouter + same inputs ⇒ identical geometry (verified bit-for-bit by the T2.5 spike).
import { useEffect, useRef, useState } from 'react';
import { buildPageTree, loadTwemojiAsset } from '@mesaas/design-render-tree';
import type { DesignDoc } from '../types';
import { useFontManifest } from './useFontManifest';
import { useImageUrls } from './useImageUrls';

const RENDER_DEBOUNCE_MS = 150;

type SatoriStandalone = typeof import('satori/standalone');

let satoriModulePromise: Promise<SatoriStandalone> | null = null;
let yogaInitPromise: Promise<void> | null = null;

async function ensureSatoriReady(): Promise<SatoriStandalone> {
  if (!satoriModulePromise) {
    satoriModulePromise = import('satori/standalone');
  }
  const mod = await satoriModulePromise;
  if (!yogaInitPromise) {
    yogaInitPromise = (async () => {
      const yogaWasmUrl = new URL('satori/yoga.wasm', import.meta.url);
      const res = await fetch(yogaWasmUrl);
      if (!res.ok) throw new Error(`yoga.wasm fetch failed: ${res.status}`);
      await mod.init(res);
    })().catch((e) => {
      yogaInitPromise = null; // a cold-blip shouldn't wedge every future render this session
      throw e;
    });
  }
  await yogaInitPromise;
  return mod;
}

export interface UseSatoriRendererResult {
  svg: string | null;
  isRendering: boolean;
  error: Error | null;
}

/** Renders `doc.pages[pageIndex]` to an SVG string, debounced ~150ms after each commit (never
 * per-mousemove — design.md §6.3: gestures move a CSS-transformed ghost, the reducer/this hook
 * only ever sees committed docs). Returns `svg: null` until the first render completes; a later
 * doc/page change re-renders and replaces it once the new render resolves (the previous SVG
 * stays on screen during that window rather than flashing blank). */
export function useSatoriRenderer(
  doc: DesignDoc | undefined,
  pageIndex: number,
): UseSatoriRendererResult {
  const fontsQuery = useFontManifest(doc);
  const imagesQuery = useImageUrls(doc);
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const generationRef = useRef(0);

  const page = doc?.pages[pageIndex];
  const fonts = fontsQuery.data;
  const images = imagesQuery.data;

  useEffect(() => {
    if (!doc || !page || !fonts || !images) return;

    const generation = ++generationRef.current;
    const timer = setTimeout(() => {
      setIsRendering(true);
      (async () => {
        const satoriMod = await ensureSatoriReady();
        if (generation !== generationRef.current) return; // superseded while satori/yoga loaded

        const tree = buildPageTree(doc, pageIndex, (fileId) => {
          const url = images.get(fileId);
          if (!url) throw new Error(`useSatoriRenderer: unresolved file_id ${fileId}`);
          return url;
        });

        const result = await satoriMod.default(
          // satori's own React-shaped tree type vs. this repo's dependency-free SatoriNode —
          // structurally identical (same {type, props: {style, children}} shape), see
          // design-render-tree.ts's header comment for why this module has zero satori/React dep.
          tree as unknown as Parameters<SatoriStandalone['default']>[0],
          {
            width: doc.canvas.width,
            height: doc.canvas.height,
            fonts,
            loadAdditionalAsset: loadTwemojiAsset,
          },
        );
        return result;
      })()
        .then((result) => {
          if (generation !== generationRef.current) return;
          setSvg(result ?? null);
          setError(null);
        })
        .catch((e: unknown) => {
          if (generation !== generationRef.current) return;
          setError(e instanceof Error ? e : new Error(String(e)));
        })
        .finally(() => {
          if (generation === generationRef.current) setIsRendering(false);
        });
    }, RENDER_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [doc, pageIndex, page, fonts, images]);

  return {
    svg,
    isRendering,
    error:
      error ?? (fontsQuery.error as Error | null) ?? (imagesQuery.error as Error | null) ?? null,
  };
}
