// Renders a satori-produced SVG string, filling its parent's box (docs/estudio-design.md §6.3).
// `dangerouslySetInnerHTML` is a first-of-its-kind pattern in this codebase — safe here because
// `svg` is never third-party or cross-tenant markup: it's satori's OWN serialization of the
// current user's own design doc, rendered client-side from the same tree builder the edge render
// pipeline uses. satori treats layer/run text as plain string content (escaped into SVG
// text/tspan nodes by its own serializer), never as embedded markup — this is trusted-library
// output, not a pass-through of arbitrary HTML.
//
// This component deliberately owns NO sizing of its own (no width*scale/height*scale) — it fills
// whatever "canvas box" wrapper the caller (CanvasStage) sizes and positions, so that box can
// also host InteractionOverlay/LayerHandles/SafeZoneGuides as absolutely-positioned siblings
// sharing the exact same coordinate frame. See CanvasStage.tsx's header comment for the layout
// rationale.
interface SatoriPreviewProps {
  svg: string;
}

export function SatoriPreview({ svg }: SatoriPreviewProps) {
  return (
    <>
      {/* Satori's SVG carries its own fixed width/height attrs (the doc's native canvas size) —
          this scopes it down to fill the canvas-box wrapper (already sized at width*scale x
          height*scale by CanvasStage), preserving aspect ratio since the wrapper itself is
          sized at that same ratio. */}
      <style>
        {
          '.estudio-satori-preview { position: absolute; inset: 0; } .estudio-satori-preview > svg { display: block; width: 100%; height: 100%; }'
        }
      </style>
      <div className="estudio-satori-preview" dangerouslySetInnerHTML={{ __html: svg }} />
    </>
  );
}
