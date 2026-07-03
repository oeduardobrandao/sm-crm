// Toggleable IG safe-zone overlay (docs/estudio-design.md §6.6, plan T2.6/T2.7). Editor-only —
// NEVER written into the design doc (`DesignDoc`/`NormalizedPage` have no field for this), purely
// a visual sibling layer inside the same canvas-box wrapper CanvasStage builds, entirely separate
// from the SatoriPreview SVG content satori actually renders. The toggle's on/off state is owned
// by the parent as local component state (NOT persisted this PR — that's plan task T7.5).
//
// Exact numbers per §6.6 (do not invent different ones):
//  - format 'feed' | 'carrossel' AT 4:5 ONLY (canvas 1080x1350): a top danger zone ~150px tall
//    (username chip) and a bottom danger zone ~250px tall (caption/CTA), both measured from
//    their respective canvas edge. §6.6 scopes these values to the 4:5 display (they derive
//    from IG's chrome placement over a 1350px-tall image) — a 1:1 canvas gets NO zones rather
//    than misleading ones the spec never defined.
//  - format 'carrossel' additionally shows a carousel-dots strip guide near the very bottom.
//    §6.6 gives no exact px value for this one — JUDGMENT CALL (flagged for review): a 40px
//    strip, visually distinct from (and inside/overlapping) the 250px caption/CTA zone, since
//    IG's carousel dot indicator sits inside that same bottom danger band, just closer to the
//    edge.
//  - format 'reel_cover' (canvas 1080x1920): the center 3:4 (1080x1440) grid-crop box, centered
//    vertically — IG crops reel covers to this region in the profile-grid view, so
//    titles/important content must live inside it.
import type { DesignFormat } from '../../types';

const TOP_DANGER_ZONE_PX = 150;
const BOTTOM_DANGER_ZONE_PX = 250;
// JUDGMENT CALL — see header comment: §6.6 doesn't specify this value.
const CAROUSEL_DOTS_STRIP_PX = 40;
const REEL_COVER_CROP_WIDTH = 1080;
const REEL_COVER_CROP_HEIGHT = 1440;

export interface SafeZoneGuidesProps {
  format: DesignFormat;
  canvasHeight: number;
  visible: boolean;
  /** This component is rendered inside CanvasStage's "canvas box", which is sized in SCREEN
   * space (`doc.canvas.width * scale` etc — see CanvasStage.tsx's header comment). The pixel
   * constants above are canvas-space values, so every one of them must be multiplied by `scale`
   * before use as a CSS length, or the guides render at their native canvas-space size regardless
   * of how large the box actually is on screen (correct only by coincidence when scale === 1). */
  scale: number;
}

const dangerZoneStyle: React.CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  backgroundColor: 'rgba(245, 90, 66, 0.12)',
  borderTop: '1px dashed rgba(245, 90, 66, 0.6)',
  borderBottom: '1px dashed rgba(245, 90, 66, 0.6)',
  pointerEvents: 'none',
};

const cropBoxStyle: React.CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  border: '1px dashed rgba(234, 179, 8, 0.85)',
  backgroundColor: 'rgba(234, 179, 8, 0.06)',
  pointerEvents: 'none',
};

export function SafeZoneGuides({ format, canvasHeight, visible, scale }: SafeZoneGuidesProps) {
  if (!visible) return null;

  if (format === 'reel_cover') {
    const top = ((canvasHeight - REEL_COVER_CROP_HEIGHT) / 2) * scale;
    return (
      <div
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        data-testid="safe-zone-guides"
      >
        <div
          style={{
            ...cropBoxStyle,
            top,
            height: REEL_COVER_CROP_HEIGHT * scale,
            width: REEL_COVER_CROP_WIDTH * scale,
          }}
          data-testid="safe-zone-reel-crop"
        />
      </div>
    );
  }

  // feed | carrossel — §6.6's zones are defined for the 4:5 (1080x1350) display only; on a 1:1
  // canvas the 4:5-derived pixel bands don't correspond to real IG chrome, so show nothing.
  if (canvasHeight !== 1350) return null;

  return (
    <div
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      data-testid="safe-zone-guides"
    >
      <div
        style={{ ...dangerZoneStyle, top: 0, height: TOP_DANGER_ZONE_PX * scale }}
        data-testid="safe-zone-top"
      />
      <div
        style={{ ...dangerZoneStyle, bottom: 0, height: BOTTOM_DANGER_ZONE_PX * scale }}
        data-testid="safe-zone-bottom"
      />
      {format === 'carrossel' && (
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: CAROUSEL_DOTS_STRIP_PX * scale,
            backgroundColor: 'rgba(245, 90, 66, 0.22)',
            borderTop: '1px dashed rgba(245, 90, 66, 0.8)',
            pointerEvents: 'none',
          }}
          data-testid="safe-zone-carousel-dots"
        />
      )}
    </div>
  );
}
