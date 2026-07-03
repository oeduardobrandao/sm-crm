// Renders every page in `doc.pages` to a small SVG thumbnail via satori, for SlideStrip (T2.10,
// docs/estudio-design.md §6.4/§6.1 SlideStrip). Reuses the exact same building blocks
// `useSatoriRenderer.ts` uses (`ensureSatoriReady`, `buildPageTree`, `useFontManifest`,
// `useImageUrls`) — see that file's header comment for the pinned-parity rationale — but instead
// of rendering a single `pageIndex`, this hook loops over ALL pages inside one debounced effect
// (`Promise.all`, not N hook calls: hooks can't be called in a loop or conditionally).
//
// Renders at the doc's real `canvas.width`/`height` (satori is cheap, ~5ms/page per
// docs/estudio-design.md §5.1, and pages are capped at 10 by the schema) — the on-screen
// thumbnail SIZE is a CSS concern for the consuming component (scale the SVG down inside a small
// wrapper div), not something baked into the satori render call itself.
import { useEffect, useRef, useState } from 'react';
import { buildPageTree, loadTwemojiAsset } from '@mesaas/design-render-tree';
import type { DesignDoc } from '../types';
import { ensureSatoriReady, type SatoriStandalone } from './useSatoriRenderer';
import { useFontManifest } from './useFontManifest';
import { useImageUrls } from './useImageUrls';

const RENDER_DEBOUNCE_MS = 150;

export interface UsePageThumbnailsResult {
  /** page.id -> rendered SVG string. Pages whose render hasn't resolved yet (or that no longer
   * exist in `doc.pages`) are simply absent — never a stale/broken entry. */
  thumbnails: Map<string, string>;
  isLoading: boolean;
  error: Error | null;
}

/** Renders one thumbnail SVG per page in `doc.pages`, debounced ~150ms after each commit (same
 * debounce window as `useSatoriRenderer`, so a rapid page-add/reorder burst collapses into a
 * single render pass rather than one per intermediate doc). Previous thumbnails stay on screen
 * (map is only ever replaced wholesale once a full new pass resolves) rather than flashing blank
 * while a newer pass renders. */
export function usePageThumbnails(doc: DesignDoc | undefined): UsePageThumbnailsResult {
  const fontsQuery = useFontManifest(doc);
  const imagesQuery = useImageUrls(doc);
  const [thumbnails, setThumbnails] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<Error | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const generationRef = useRef(0);

  const fonts = fontsQuery.data;
  const images = imagesQuery.data;
  // Stable dep so the effect only re-runs when the actual set/order of pages changes, not on
  // every unrelated doc mutation (e.g. a layer drag on the active page shouldn't re-render every
  // OTHER page's thumbnail too).
  const pagesKey = doc?.pages.map((p) => p.id).join(',') ?? '';

  useEffect(() => {
    if (!doc || !fonts || !images) return;
    if (doc.pages.length === 0) {
      setThumbnails(new Map());
      return;
    }

    const generation = ++generationRef.current;
    const timer = setTimeout(() => {
      setIsLoading(true);
      (async () => {
        const satoriMod = await ensureSatoriReady();
        if (generation !== generationRef.current) return; // superseded while satori/yoga loaded

        const entries = await Promise.all(
          doc.pages.map(async (page, pageIndex) => {
            const tree = buildPageTree(doc, pageIndex, (fileId) => {
              const url = images.get(fileId);
              if (!url) throw new Error(`usePageThumbnails: unresolved file_id ${fileId}`);
              return url;
            });
            const svg = await satoriMod.default(
              tree as unknown as Parameters<SatoriStandalone['default']>[0],
              {
                width: doc.canvas.width,
                height: doc.canvas.height,
                fonts,
                loadAdditionalAsset: loadTwemojiAsset,
              },
            );
            return [page.id, svg] as const;
          }),
        );
        return new Map(entries);
      })()
        .then((map) => {
          if (generation !== generationRef.current) return;
          setThumbnails(map ?? new Map());
          setError(null);
        })
        .catch((e: unknown) => {
          if (generation !== generationRef.current) return;
          setError(e instanceof Error ? e : new Error(String(e)));
        })
        .finally(() => {
          if (generation === generationRef.current) setIsLoading(false);
        });
    }, RENDER_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [doc, pagesKey, fonts, images]);

  return {
    thumbnails,
    isLoading,
    error:
      error ?? (fontsQuery.error as Error | null) ?? (imagesQuery.error as Error | null) ?? null,
  };
}
