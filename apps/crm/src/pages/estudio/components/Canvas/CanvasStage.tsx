// Hosts the satori render loop + the interaction layer inside a fit-to-container stage (docs/
// estudio-design.md §6.1 Canvas/ — CanvasStage, plan T2.6/T2.7).
//
// LAYOUT: `SatoriPreview` is centered (not top-left-anchored) inside this component's outer flex
// container by `useCanvasTransform`'s fit-to-container behavior. Because of that centering gap,
// `InteractionOverlay` cannot be a sibling of the outer centered flex container — pointer
// coordinates relative to THAT container would be offset by the centering gap and every
// hit-test/drag would be wrong except by coincidence. Instead, this component introduces a
// "canvas box" wrapper — a `position: relative` div sized at EXACTLY
// `{ width: doc.canvas.width * scale, height: doc.canvas.height * scale }` — that contains the
// satori SVG content AND InteractionOverlay/SafeZoneGuides as stacked, absolutely-positioned
// (`inset: 0`) siblings. A pointer event's position relative to that box's own
// `getBoundingClientRect()` then feeds directly into `screenToCanvas` (divide by scale, no extra
// offset math needed).
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSatoriRenderer } from '../../hooks/useSatoriRenderer';
import { useCanvasTransform } from '../../hooks/useCanvasTransform';
import { useGuidesPreference } from '../../hooks/useGuidesPreference';
import { SatoriPreview } from './SatoriPreview';
import { InteractionOverlay, type InteractionOverlayProps } from './InteractionOverlay';
import { SafeZoneGuides } from './SafeZoneGuides';
import type { GetTextHeight } from '../../lib/layerGeometry';
import type { DesignDoc, NormalizedLayer } from '../../types';

export interface CanvasStageProps {
  doc: DesignDoc;
  pageIndex: number;
  /** Layer ids selected on the active page — single-select only in this PR (plan scope), though
   * the reducer's field is an array for future multi-select. */
  selection: string[];
  /** Replaces the current selection (empty array deselects). */
  select: (selection: string[]) => void;
  /** Commits a layer patch — called exactly once per drag/resize gesture, on pointerup, never
   * mid-gesture. Narrower than exposing the raw `dispatch` so InteractionOverlay doesn't need to
   * know about action shapes/pageId plumbing. */
  onUpdateLayer: (layerId: string, patch: Partial<NormalizedLayer>) => void;
  /** Resolves a text layer's emergent height (design-doc.ts: text has no schema `h`) — threaded
   * down from `useTextMeasurement` at the call site so this component stays measurement-agnostic. */
  getTextHeight: GetTextHeight;
  /** Passed straight through to InteractionOverlay's own `onEditingChange` — see that prop's doc
   * comment. Optional: callers that don't need the signal (e.g. existing tests) simply omit it. */
  onEditingChange?: (isEditing: boolean) => void;
  /** Reports the live view state (effective scale + a stable reset) upward so the TopToolbar's
   * zoom control — which lives OUTSIDE this component (design §6.1) — can display and reset it
   * without lifting the whole transform out of the stage. Optional: tests omit it. */
  onViewChange?: (view: { scale: number; resetView: () => void }) => void;
  /** Threaded to InteractionOverlay — live wrapped-height preview for text side-resizes. */
  measureTextAt?: InteractionOverlayProps['measureTextAt'];
}

export function CanvasStage({
  doc,
  pageIndex,
  selection,
  select,
  onUpdateLayer,
  getTextHeight,
  onEditingChange,
  onViewChange,
  measureTextAt,
}: CanvasStageProps) {
  const { t } = useTranslation('estudio');
  const { svg, error } = useSatoriRenderer(doc, pageIndex);
  const { containerRef, scale, offset, screenToCanvas, canvasToScreen, resetView } =
    useCanvasTransform(doc.canvas.width, doc.canvas.height);
  // T7.5: user-scoped, localStorage-persisted (absent = ON). Replaces the old ephemeral useState.
  const [safeZonesVisible, setSafeZonesVisible] = useGuidesPreference();

  useEffect(() => {
    onViewChange?.({ scale, resetView });
  }, [scale, resetView, onViewChange]);

  const layers = doc.pages[pageIndex]?.layers ?? [];

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {error ? (
        <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{t('editor.renderError')}</p>
      ) : svg ? (
        <div
          data-testid="canvas-box"
          style={{
            position: 'relative',
            width: doc.canvas.width * scale,
            height: doc.canvas.height * scale,
            flexShrink: 0,
            // Pan is a pure translate of the (still flex-centered) box — inner coordinate math
            // is box-relative and never sees it. No transition: panning must track 1:1.
            transform:
              offset.x !== 0 || offset.y !== 0
                ? `translate(${offset.x}px, ${offset.y}px)`
                : undefined,
          }}
        >
          <SatoriPreview svg={svg} />
          <SafeZoneGuides
            format={doc.format}
            canvasHeight={doc.canvas.height}
            visible={safeZonesVisible}
            scale={scale}
          />
          <InteractionOverlay
            layers={layers}
            selection={selection}
            select={select}
            onUpdateLayer={onUpdateLayer}
            getTextHeight={getTextHeight}
            canvasWidth={doc.canvas.width}
            canvasHeight={doc.canvas.height}
            scale={scale}
            screenToCanvas={screenToCanvas}
            canvasToScreen={canvasToScreen}
            onEditingChange={onEditingChange}
            measureTextAt={measureTextAt}
          />
        </div>
      ) : (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{t('editor.rendering')}</p>
      )}
      {svg && (
        <button
          type="button"
          onClick={() => setSafeZonesVisible(!safeZonesVisible)}
          title={t('editor.safeZoneToggle')}
          aria-pressed={safeZonesVisible}
          style={{
            position: 'absolute',
            bottom: '1rem',
            right: '1rem',
            padding: '0.4rem 0.75rem',
            borderRadius: 8,
            border: '1px solid var(--border-color)',
            backgroundColor: safeZonesVisible ? 'var(--primary-color)' : 'var(--card-bg, #fff)',
            color: safeZonesVisible ? '#12151a' : 'var(--text-muted)',
            fontSize: '0.7rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          {t('editor.safeZoneToggle')}
        </button>
      )}
    </div>
  );
}
