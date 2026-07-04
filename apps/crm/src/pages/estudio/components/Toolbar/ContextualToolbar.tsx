// T2.12 ContextualToolbar (docs/estudio-plan.md line 151, docs/estudio-design.md §6.4). The
// property panel for the currently-selected layer. Slice 3 (T3.4/T3.5) replaced the stopgap
// font <select> and hex inputs with the real shared FontPicker/ColorPicker (brand-aware via the
// brandFonts/brandColors props); the remaining discrete controls (weight, size, align, toggles)
// keep the original plain-HTML-styled-by-CSS-vars convention.
//
// COMMIT BOUNDARY (see InteractionOverlay.tsx's header comment for the general "why this matters"
// reasoning — drag/resize gestures buffer a transient delta and dispatch exactly once on
// pointerup so satori doesn't re-render per pointermove). This component's version of that same
// discipline: selects/toggles/button-groups are discrete, already-debounced-by-the-DOM events, so
// they commit immediately on change/click. Free-text and number inputs (hex color, font_size,
// radius) commit on blur or Enter instead of on every keystroke, so typing "48" into font_size
// doesn't push three separate undo entries ("4", "48", done) — one commit per edit, not one per
// keystroke.
import { useEffect, useRef, useState } from 'react';
import {
  AlignHorizontalJustifyStart,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignVerticalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { findFamily, buildFontFamilyPatch } from '../../hooks/useFontManifest';
import { alignLayerToCanvas, getLayerBBox, type AlignAxis } from '../../lib/layerGeometry';
import { ColorPicker, FontPicker, type BrandFontEntry } from '../shared';
import type {
  FontWeight,
  NormalizedImageLayer,
  NormalizedLayer,
  NormalizedShapeLayer,
  NormalizedTextLayer,
} from '../../types';

export interface ContextualToolbarProps {
  layer: NormalizedLayer | null;
  onUpdateLayer: (layerId: string, patch: Partial<NormalizedLayer>) => void;
  onReplaceImage?: (layerId: string) => void;
  /** Client brand hexes, pinned as the ColorPicker's "Marca" swatches. */
  brandColors?: string[];
  /** Client brand fonts (matcher-resolved), pinned as the FontPicker's "Marca" group. */
  brandFonts?: BrandFontEntry[];
  /** Canvas dims + text-height resolver for the align-to-canvas row (T7.2). Omit to hide it. */
  canvasWidth?: number;
  canvasHeight?: number;
  getTextHeight?: (layer: NormalizedTextLayer) => number;
}

const DEFAULT_SHADOW = { x: 2, y: 2, blur: 4, color: '#00000080' };
const DEFAULT_PILL = { color: '#000000', padding_x: 16, padding_y: 8, radius: 8 };
const DEFAULT_IMAGE_BORDER = { width: 2, color: '#ffffff' };
const DEFAULT_SHAPE_STROKE = { width: 2, color: '#000000' };

const FONT_WEIGHT_LABELS: Record<FontWeight, string> = {
  400: '400 · Regular',
  500: '500 · Medium',
  600: '600 · SemiBold',
  700: '700 · Bold',
  800: '800 · ExtraBold',
  900: '900 · Black',
};

const rowStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
  minWidth: 120,
};

const labelStyle: React.CSSProperties = {
  fontSize: '0.65rem',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--text-muted)',
};

const inputStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  padding: '0.4rem 0.6rem',
  borderRadius: 8,
  border: '1px solid var(--border-color)',
  background: 'var(--surface-main)',
  color: 'var(--text-main)',
  fontSize: '0.8rem',
};

function toggleButtonStyle(active: boolean): React.CSSProperties {
  return {
    padding: '0.4rem 0.75rem',
    borderRadius: 8,
    border: `1px solid ${active ? 'var(--primary-color)' : 'var(--border-color)'}`,
    background: active ? 'var(--primary-color)' : 'var(--surface-main)',
    color: active ? '#12151a' : 'var(--text-main)',
    fontSize: '0.75rem',
    fontWeight: 600,
    cursor: 'pointer',
  };
}

/** Free-text/number "commit on blur or Enter" input — local draft state so keystrokes don't
 * dispatch, matching this component's commit-boundary discipline (see header comment). */
function CommitInput({
  value,
  onCommit,
  type = 'text',
  style,
  ...rest
}: {
  value: string;
  onCommit: (value: string) => void;
  type?: string;
  style?: React.CSSProperties;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur' | 'type'>) {
  const [draft, setDraft] = useState(value);

  // Keep the draft in sync when the underlying layer value changes from outside this input
  // (undo/redo, or an external patch to the SAME still-selected layer).
  useEffect(() => {
    setDraft(value);
  }, [value]);

  function commit() {
    if (draft !== value) onCommit(draft);
  }

  // Flush an uncommitted draft on unmount rather than silently discarding it. Without this, the
  // effect above (`setDraft(value)`) would ALSO fire when a DIFFERENT layer becomes selected and
  // this exact control gets reused for it (e.g. font_size's CommitInput is the same mounted DOM
  // node regardless of which layer is selected) — overwriting an in-progress, never-committed
  // edit with the new layer's value with no warning and no dispatch. The caller (ContextualToolbar,
  // below) forces a real unmount/remount on layer switch via `key={layer.id}` on each variant, so
  // this cleanup is what actually flushes the stale draft — using refs (updated every render,
  // read only from the unmount cleanup) rather than effect dependencies, since a cleanup tied to
  // `[]` only runs once, on the real unmount, and must not read stale closed-over values.
  const latestRef = useRef({ draft, value, onCommit });
  latestRef.current = { draft, value, onCommit };
  useEffect(() => {
    return () => {
      const latest = latestRef.current;
      if (latest.draft !== latest.value) latest.onCommit(latest.draft);
    };
  }, []);

  return (
    <input
      {...rest}
      type={type}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          setDraft(value);
          e.currentTarget.blur();
        }
      }}
      style={{ ...inputStyle, ...style }}
    />
  );
}

function ToolbarShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'flex-end',
        gap: '1rem',
        padding: '0.75rem clamp(1.25rem, 3vw, 2.5rem)',
        borderBottom: '1px solid var(--border-color)',
        background: 'var(--card-bg)',
        flexShrink: 0,
      }}
    >
      {children}
    </div>
  );
}

function TextVariant({
  layer,
  onUpdateLayer,
  brandColors,
  brandFonts,
}: {
  layer: NormalizedTextLayer;
  onUpdateLayer: ContextualToolbarProps['onUpdateLayer'];
  brandColors?: string[];
  brandFonts?: BrandFontEntry[];
}) {
  const { t } = useTranslation('estudio');
  const currentFamily = findFamily(layer.font_key);
  const style = layer.font_style ?? 'normal';
  // Restrict the weight <select> to the variants the currently-selected font actually ships,
  // filtered by the layer's current font_style so italic/normal stay consistent (per task brief —
  // switching families never leaves font_weight pointing at a variant that doesn't exist).
  const availableWeights = (currentFamily?.variants ?? [])
    .filter((v) => v.style === style)
    .map((v) => v.weight as FontWeight)
    .sort((a, b) => a - b);

  const hasShadow = !!layer.shadow;
  const hasPill = !!layer.pill;

  return (
    <>
      <div style={rowStyle}>
        <label style={labelStyle} htmlFor="toolbar-font-key">
          {t('toolbar.text.font')}
        </label>
        <FontPicker
          id="toolbar-font-key"
          value={layer.font_key}
          brandFonts={brandFonts}
          onSelect={(key) =>
            // buildFontFamilyPatch owns the weight/style fallback so a family switch never
            // leaves (font_key, font_weight, font_style) pointing at a nonexistent variant.
            onUpdateLayer(layer.id, buildFontFamilyPatch(key, layer))
          }
        />
      </div>

      <div style={rowStyle}>
        <label style={labelStyle} htmlFor="toolbar-font-weight">
          {t('toolbar.text.weight')}
        </label>
        <select
          id="toolbar-font-weight"
          style={inputStyle}
          value={layer.font_weight}
          onChange={(e) =>
            onUpdateLayer(layer.id, { font_weight: Number(e.target.value) as FontWeight })
          }
        >
          {availableWeights.map((w) => (
            <option key={w} value={w}>
              {FONT_WEIGHT_LABELS[w]}
            </option>
          ))}
        </select>
      </div>

      <div style={rowStyle}>
        <label style={labelStyle} htmlFor="toolbar-font-size">
          {t('toolbar.text.size')}
        </label>
        <CommitInput
          id="toolbar-font-size"
          value={String(layer.font_size)}
          type="number"
          style={{ width: 80 }}
          onCommit={(v) => {
            const n = Number(v);
            if (Number.isFinite(n) && n > 0) onUpdateLayer(layer.id, { font_size: n });
          }}
        />
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>{t('toolbar.text.color')}</span>
        <ColorPicker
          value={layer.color}
          label={t('toolbar.text.color')}
          brandColors={brandColors}
          onChange={(hex) => onUpdateLayer(layer.id, { color: hex })}
        />
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>{t('toolbar.text.align')}</span>
        <div
          style={{ display: 'flex', gap: '0.25rem' }}
          role="group"
          aria-label={t('toolbar.text.align')}
        >
          {(['left', 'center', 'right'] as const).map((align) => (
            <button
              key={align}
              type="button"
              aria-pressed={layer.align === align}
              style={toggleButtonStyle(layer.align === align)}
              onClick={() => onUpdateLayer(layer.id, { align })}
            >
              {t(`toolbar.text.align_${align}`)}
            </button>
          ))}
        </div>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>{t('toolbar.text.shadow')}</span>
        <button
          type="button"
          aria-pressed={hasShadow}
          aria-label={t('toolbar.text.shadow')}
          style={toggleButtonStyle(hasShadow)}
          onClick={() =>
            onUpdateLayer(layer.id, { shadow: hasShadow ? undefined : DEFAULT_SHADOW })
          }
        >
          {hasShadow ? t('toolbar.on') : t('toolbar.off')}
        </button>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>{t('toolbar.text.pill')}</span>
        <button
          type="button"
          aria-pressed={hasPill}
          aria-label={t('toolbar.text.pill')}
          style={toggleButtonStyle(hasPill)}
          onClick={() => onUpdateLayer(layer.id, { pill: hasPill ? undefined : DEFAULT_PILL })}
        >
          {hasPill ? t('toolbar.on') : t('toolbar.off')}
        </button>
      </div>
    </>
  );
}

function ImageVariant({
  layer,
  onUpdateLayer,
  onReplaceImage,
}: {
  layer: NormalizedImageLayer;
  onUpdateLayer: ContextualToolbarProps['onUpdateLayer'];
  onReplaceImage?: (layerId: string) => void;
}) {
  const { t } = useTranslation('estudio');
  const hasBorder = !!layer.border;

  return (
    <>
      <div style={rowStyle}>
        <label style={labelStyle} htmlFor="toolbar-image-fit">
          {t('toolbar.image.fit')}
        </label>
        <select
          id="toolbar-image-fit"
          style={inputStyle}
          value={layer.fit}
          onChange={(e) =>
            onUpdateLayer(layer.id, { fit: e.target.value as NormalizedImageLayer['fit'] })
          }
        >
          <option value="cover">{t('toolbar.image.fitCover')}</option>
          <option value="contain">{t('toolbar.image.fitContain')}</option>
        </select>
      </div>

      <div style={rowStyle}>
        <label style={labelStyle} htmlFor="toolbar-image-radius">
          {t('toolbar.image.radius')}
        </label>
        <CommitInput
          id="toolbar-image-radius"
          value={String(layer.radius ?? 0)}
          type="number"
          style={{ width: 80 }}
          onCommit={(v) => {
            const n = Number(v);
            if (Number.isFinite(n) && n >= 0) onUpdateLayer(layer.id, { radius: n });
          }}
        />
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>{t('toolbar.image.border')}</span>
        <button
          type="button"
          aria-pressed={hasBorder}
          aria-label={t('toolbar.image.border')}
          style={toggleButtonStyle(hasBorder)}
          onClick={() =>
            onUpdateLayer(layer.id, { border: hasBorder ? undefined : DEFAULT_IMAGE_BORDER })
          }
        >
          {hasBorder ? t('toolbar.on') : t('toolbar.off')}
        </button>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>&nbsp;</span>
        <button
          type="button"
          style={toggleButtonStyle(false)}
          onClick={() => onReplaceImage?.(layer.id)}
        >
          {t('toolbar.image.replace')}
        </button>
      </div>
    </>
  );
}

function ShapeVariant({
  layer,
  onUpdateLayer,
  brandColors,
}: {
  layer: NormalizedShapeLayer;
  onUpdateLayer: ContextualToolbarProps['onUpdateLayer'];
  brandColors?: string[];
}) {
  const { t } = useTranslation('estudio');
  const hasStroke = !!layer.stroke;
  // Solid color only for v1 — editing a gradient fill (NormalizedFillGradient) needs a
  // multi-stop gradient editor that doesn't exist yet; a shape whose fill is already a
  // gradient just doesn't show a color value here.
  const fillColor = layer.fill?.type === 'solid' ? layer.fill.color : '#000000';
  const radiusDisabled = layer.shape === 'ellipse';

  return (
    <>
      <div style={rowStyle}>
        <span style={labelStyle}>{t('toolbar.shape.fill')}</span>
        <ColorPicker
          value={fillColor}
          label={t('toolbar.shape.fill')}
          brandColors={brandColors}
          onChange={(hex) => onUpdateLayer(layer.id, { fill: { type: 'solid', color: hex } })}
        />
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>{t('toolbar.shape.stroke')}</span>
        <button
          type="button"
          aria-pressed={hasStroke}
          aria-label={t('toolbar.shape.stroke')}
          style={toggleButtonStyle(hasStroke)}
          onClick={() =>
            onUpdateLayer(layer.id, { stroke: hasStroke ? undefined : DEFAULT_SHAPE_STROKE })
          }
        >
          {hasStroke ? t('toolbar.on') : t('toolbar.off')}
        </button>
      </div>

      <div style={rowStyle}>
        <label
          style={{ ...labelStyle, opacity: radiusDisabled ? 0.5 : 1 }}
          htmlFor="toolbar-shape-radius"
          title={radiusDisabled ? t('toolbar.shape.radiusDisabledHint') : undefined}
        >
          {t('toolbar.shape.radius')}
        </label>
        <CommitInput
          id="toolbar-shape-radius"
          value={String(layer.radius ?? 0)}
          type="number"
          disabled={radiusDisabled}
          style={{ width: 80, opacity: radiusDisabled ? 0.5 : 1 }}
          title={radiusDisabled ? t('toolbar.shape.radiusDisabledHint') : undefined}
          onCommit={(v) => {
            const n = Number(v);
            if (Number.isFinite(n) && n >= 0) onUpdateLayer(layer.id, { radius: n });
          }}
        />
      </div>
    </>
  );
}

/** Align-to-canvas row (T7.2) — layer-type-agnostic (applies to text, image, and shape).
 * Alignment is a pure position update: compute the new top-left via the rotated-AABB math and
 * commit `{x, y}`. */
function AlignRow({
  layer,
  onUpdateLayer,
  canvasWidth,
  canvasHeight,
  getTextHeight,
}: {
  layer: NormalizedLayer;
  onUpdateLayer: ContextualToolbarProps['onUpdateLayer'];
  canvasWidth: number;
  canvasHeight: number;
  getTextHeight: (layer: NormalizedTextLayer) => number;
}) {
  const { t } = useTranslation('estudio');
  const apply = (axis: AlignAxis) => {
    const bbox = getLayerBBox(layer, getTextHeight);
    const { x, y } = alignLayerToCanvas(bbox, layer.rotation, canvasWidth, canvasHeight, axis);
    onUpdateLayer(layer.id, { x, y });
  };
  const buttons: Array<{ axis: AlignAxis; icon: React.ReactNode }> = [
    { axis: 'left', icon: <AlignHorizontalJustifyStart size={16} /> },
    { axis: 'hcenter', icon: <AlignHorizontalJustifyCenter size={16} /> },
    { axis: 'right', icon: <AlignHorizontalJustifyEnd size={16} /> },
    { axis: 'top', icon: <AlignVerticalJustifyStart size={16} /> },
    { axis: 'vcenter', icon: <AlignVerticalJustifyCenter size={16} /> },
    { axis: 'bottom', icon: <AlignVerticalJustifyEnd size={16} /> },
  ];
  return (
    <div style={rowStyle}>
      <span style={labelStyle}>{t('toolbar.align.label')}</span>
      <div
        style={{ display: 'flex', gap: '0.25rem' }}
        role="group"
        aria-label={t('toolbar.align.label')}
      >
        {buttons.map(({ axis, icon }) => (
          <button
            key={axis}
            type="button"
            aria-label={t(`toolbar.align.${axis}`)}
            title={t(`toolbar.align.${axis}`)}
            data-testid={`align-${axis}`}
            style={toggleButtonStyle(false)}
            onClick={() => apply(axis)}
          >
            {icon}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function ContextualToolbar({
  layer,
  onUpdateLayer,
  onReplaceImage,
  brandColors,
  brandFonts,
  canvasWidth,
  canvasHeight,
  getTextHeight,
}: ContextualToolbarProps) {
  if (!layer) return null;

  return (
    <ToolbarShell>
      {/* `key={layer.id}` forces a full unmount/remount of the active variant when the SELECTED
          LAYER changes (not just when one of its field values changes) — without this, switching
          from layer A to layer B reuses the same mounted CommitInput DOM nodes, and their own
          `useEffect(() => setDraft(value), [value])` would silently overwrite an uncommitted draft
          for layer A with layer B's value. Forcing a real unmount here is what makes CommitInput's
          unmount-flush safety net (see that component) actually fire. */}
      {layer.type === 'text' && (
        <TextVariant
          key={layer.id}
          layer={layer}
          onUpdateLayer={onUpdateLayer}
          brandColors={brandColors}
          brandFonts={brandFonts}
        />
      )}
      {layer.type === 'image' && (
        <ImageVariant
          key={layer.id}
          layer={layer}
          onUpdateLayer={onUpdateLayer}
          onReplaceImage={onReplaceImage}
        />
      )}
      {layer.type === 'shape' && (
        <ShapeVariant
          key={layer.id}
          layer={layer}
          onUpdateLayer={onUpdateLayer}
          brandColors={brandColors}
        />
      )}
      {canvasWidth !== undefined && canvasHeight !== undefined && getTextHeight && (
        <AlignRow
          layer={layer}
          onUpdateLayer={onUpdateLayer}
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
          getTextHeight={getTextHeight}
        />
      )}
    </ToolbarShell>
  );
}
