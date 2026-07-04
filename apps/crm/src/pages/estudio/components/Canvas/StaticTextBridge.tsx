// The post-edit "bridge" (review finding on the hideLayerId feature): when a text edit commits,
// TextEditOverlay unmounts immediately but the on-screen satori SVG was rendered WITHOUT the
// edited layer — and the re-render that includes it again is debounced 150ms + render latency.
// Without a stand-in, the text visibly vanished on EVERY commit. This static div replicates the
// committed layer's appearance (same technique/styles as TextEditOverlay, minus TipTap) and is
// mounted by CanvasStage only for that gap — from commit until the current SVG's renderedDoc
// includes the layer again.
import type { NormalizedTextLayer } from '../../types';

export function StaticTextBridge({ layer, scale }: { layer: NormalizedTextLayer; scale: number }) {
  const base: React.CSSProperties = {
    position: 'absolute',
    left: layer.x * scale,
    top: layer.y * scale,
    width: layer.w * scale,
    height: 'auto',
    transform: layer.rotation ? `rotate(${layer.rotation}deg)` : undefined,
    fontFamily: `estudio-edit-${layer.font_key}-${layer.font_weight}-${
      layer.font_style ?? 'normal'
    }`.replace(/[^a-zA-Z0-9-]/g, '_'),
    fontWeight: layer.font_weight,
    fontStyle: layer.font_style ?? 'normal',
    fontSize: layer.font_size * scale,
    lineHeight: layer.line_height,
    letterSpacing: layer.letter_spacing * scale,
    textAlign: layer.align,
    color: layer.color,
    opacity: layer.opacity,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    pointerEvents: 'none',
    ...(layer.pill
      ? {
          background: layer.pill.color,
          padding: `${layer.pill.padding_y * scale}px ${layer.pill.padding_x * scale}px`,
          borderRadius: layer.pill.radius * scale,
        }
      : {}),
    ...(layer.shadow
      ? {
          textShadow: `${layer.shadow.x * scale}px ${layer.shadow.y * scale}px ${
            layer.shadow.blur * scale
          }px ${layer.shadow.color}`,
        }
      : {}),
  };

  return (
    <div data-testid="static-text-bridge" style={base}>
      {layer.runs && layer.runs.length > 0
        ? layer.runs.map((run, i) => (
            <span
              key={i}
              style={{
                fontWeight: run.font_weight ?? layer.font_weight,
                fontStyle: run.font_style ?? layer.font_style ?? 'normal',
                color: run.color ?? layer.color,
                ...(run.highlight
                  ? {
                      backgroundColor: run.highlight.color,
                      paddingLeft: (run.highlight.padding_x ?? 0) * scale,
                      paddingRight: (run.highlight.padding_x ?? 0) * scale,
                      borderRadius: (run.highlight.radius ?? 0) * scale,
                    }
                  : {}),
              }}
            >
              {run.text}
            </span>
          ))
        : (layer.text ?? '')}
    </div>
  );
}
