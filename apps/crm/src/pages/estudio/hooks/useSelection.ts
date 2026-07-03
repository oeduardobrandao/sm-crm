// Thin click-to-select wrapper (docs/estudio-design.md §6.2, plan T2.6/T2.7). Plan scope for
// this PR is SINGLE-select only — no shift-click multi-select, no marquee-select yet — even
// though the reducer's `selection` field is an array (future PRs extend it). This hook exists so
// `InteractionOverlay.tsx`'s pointer handlers stay declarative: hand it a canvas-space point, it
// hit-tests via `layerGeometry.ts` and calls the reducer's `select()` for you.
import { useCallback } from 'react';
import { hitTestLayers, type CanvasPoint, type GetTextHeight } from '../lib/layerGeometry';
import type { NormalizedLayer } from '../types';

export interface UseSelectionOptions {
  layers: NormalizedLayer[];
  getTextHeight: GetTextHeight;
  select: (selection: string[]) => void;
}

export interface UseSelectionResult {
  /** Hit-tests `point` (canvas-space) against `layers` and selects the topmost unlocked hit, or
   * clears the selection when nothing is hit (e.g. a click on empty canvas background). Returns
   * the hit layer (or `null`) so callers can immediately act on it (e.g. begin a drag) without a
   * second hit-test. */
  selectAtPoint: (point: CanvasPoint) => NormalizedLayer | null;
  /** Hit-tests without mutating selection — used to decide "did the pointerdown land on the
   * already-selected layer's body" before starting a drag gesture. */
  hitTest: (point: CanvasPoint) => NormalizedLayer | null;
  /** Clears the current selection (click on empty canvas background). */
  clearSelection: () => void;
}

export function useSelection({
  layers,
  getTextHeight,
  select,
}: UseSelectionOptions): UseSelectionResult {
  const hitTest = useCallback(
    (point: CanvasPoint) => hitTestLayers(point, layers, getTextHeight),
    [layers, getTextHeight],
  );

  const selectAtPoint = useCallback(
    (point: CanvasPoint) => {
      const hit = hitTest(point);
      select(hit ? [hit.id] : []);
      return hit;
    },
    [hitTest, select],
  );

  const clearSelection = useCallback(() => select([]), [select]);

  return { selectAtPoint, hitTest, clearSelection };
}
