// Thin wrapper around `lib/snapMath.ts` for use during an active drag/resize gesture (docs/
// estudio-design.md §6.2/§6.3, plan T2.6/T2.7). Owns the screen-space -> canvas-space threshold
// conversion (snapMath.ts's documented contract: "feels like Npx" must stay constant across
// zoom, so the caller converts via `threshold = screenThresholdPx / scale`) so
// `InteractionOverlay.tsx` never has to think about that math itself.
import { useCallback } from 'react';
import { collectSnapCandidates, snapBBox, type SnapLine, type SnapResult } from '../lib/snapMath';
import type { GetTextHeight, LayerBBox } from '../lib/layerGeometry';
import type { NormalizedLayer } from '../types';

/** Screen-space snap threshold, in CSS pixels — constant regardless of zoom (converted to
 * canvas-space via `/scale` before being handed to `snapMath.ts`). */
const SNAP_THRESHOLD_SCREEN_PX = 8;

export interface UseSnappingOptions {
  layers: NormalizedLayer[];
  canvasWidth: number;
  canvasHeight: number;
  getTextHeight: GetTextHeight;
  /** Current fit scale from `useCanvasTransform` — required to convert the screen-space
   * threshold into canvas-space pixels. */
  scale: number;
}

export interface UseSnappingResult {
  /** Snaps a proposed bbox (mid-drag, BEFORE snapping — see `lib/snapMath.ts`'s `ownEdges` for
   * why this is drag-only) against every other layer on the page plus the canvas's own
   * edges/center, excluding `movingLayerId` itself. `rotationDeg` is the moving layer's own
   * rotation, needed so its OWN edges are matched from its rotated extent too (not just other
   * layers' candidate lines). Returns the (possibly axis-adjusted) bbox and which guide line(s)
   * matched, for the overlay to render. */
  snap: (proposedBBox: LayerBBox, rotationDeg: number, movingLayerId: string) => SnapResult;
}

export function useSnapping({
  layers,
  canvasWidth,
  canvasHeight,
  getTextHeight,
  scale,
}: UseSnappingOptions): UseSnappingResult {
  const snap = useCallback(
    (proposedBBox: LayerBBox, rotationDeg: number, movingLayerId: string): SnapResult => {
      const candidates: SnapLine[] = collectSnapCandidates(
        layers,
        movingLayerId,
        canvasWidth,
        canvasHeight,
        getTextHeight,
      );
      const threshold = scale > 0 ? SNAP_THRESHOLD_SCREEN_PX / scale : SNAP_THRESHOLD_SCREEN_PX;
      return snapBBox(proposedBBox, rotationDeg, candidates, threshold);
    },
    [layers, canvasWidth, canvasHeight, getTextHeight, scale],
  );

  return { snap };
}
