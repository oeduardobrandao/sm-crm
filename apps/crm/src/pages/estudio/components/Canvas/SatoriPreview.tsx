// Renders a satori-produced SVG string at the current canvas scale (docs/estudio-design.md §6.3).
// `dangerouslySetInnerHTML` is a first-of-its-kind pattern in this codebase — safe here because
// `svg` is never third-party or cross-tenant markup: it's satori's OWN serialization of the
// current user's own design doc, rendered client-side from the same tree builder the edge render
// pipeline uses. satori treats layer/run text as plain string content (escaped into SVG
// text/tspan nodes by its own serializer), never as embedded markup — this is trusted-library
// output, not a pass-through of arbitrary HTML.
interface SatoriPreviewProps {
  svg: string;
  /** Doc's native canvas size (design-doc.ts CANVAS_DIMENSIONS), before scaling. */
  width: number;
  height: number;
  scale: number;
}

export function SatoriPreview({ svg, width, height, scale }: SatoriPreviewProps) {
  return (
    <>
      {/* Satori's SVG carries its own fixed width/height attrs (the doc's native canvas size) —
          this scopes it down to whatever `scale` the container currently fits, preserving the
          aspect ratio (the wrapper div below is sized at the same ratio via width*scale/height*scale). */}
      <style>
        {'.estudio-satori-preview > svg { display: block; width: 100%; height: 100%; }'}
      </style>
      <div
        className="estudio-satori-preview"
        style={{ width: width * scale, height: height * scale, flexShrink: 0 }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </>
  );
}
