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
  AlignLeft,
  AlignCenter,
  AlignRight,
  Contrast,
  Minus,
  Plus,
  RectangleHorizontal,
  Frame,
  Square,
  Replace,
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
  /** `opts.coalesceKey` flows into the reducer's `layer/update` coalescing — high-frequency
   * commit sources (color drags, stepper bursts) share a key per session so a whole burst is
   * ONE undo entry. Discrete commits pass no key. */
  onUpdateLayer: (
    layerId: string,
    patch: Partial<NormalizedLayer>,
    opts?: { coalesceKey?: string },
  ) => void;
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
  gap: '0.2rem',
  // No squishing inside the fixed-height, nowrap shell — overflow scrolls instead.
  flexShrink: 0,
};

const labelStyle: React.CSSProperties = {
  fontSize: '0.65rem',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--text-muted)',
};

// A toggle icon-button sitting next to the color swatch it reveals when the effect is on.
const toggleWithColorStyle: React.CSSProperties = {
  display: 'flex',
  gap: '0.25rem',
  alignItems: 'center',
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

// Every consumer of this style now renders a lucide icon (T7 toolbar iconification) — inline-flex
// centering keeps the glyph optically centered without the baseline gap a raw inline SVG leaves.
function toggleButtonStyle(active: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0.45rem 0.6rem',
    borderRadius: 8,
    border: `1px solid ${active ? 'var(--primary-color)' : 'var(--border-color)'}`,
    background: active ? 'var(--primary-color)' : 'var(--surface-main)',
    color: active ? '#12151a' : 'var(--text-main)',
    cursor: 'pointer',
  };
}

/** Fixed toolbar height — the shell renders at this height whether or not a layer is selected,
 * so selecting/deselecting NEVER resizes the canvas container (which would re-fit the zoom and
 * read as the whole UI "zooming in/out" on every selection). Wide variants scroll horizontally
 * inside the fixed row instead of wrapping taller. */
export const CONTEXTUAL_TOOLBAR_HEIGHT = 64;

// Distinct per stepper burst across all NumberField instances (mirrors ColorPicker's drag
// sessions): a burst of ±steps shares one coalesce key → one undo entry; after the idle window
// the next step opens a fresh entry.
let numberStepSessionCounter = 0;
const STEP_COALESCE_IDLE_MS = 600;

/** Numeric control with real stepper buttons and arrow-key support. Steps COMMIT IMMEDIATELY
 * (burst-coalesced) — the old bare `<input type=number>` let the native spinner change the
 * visible value without ever dispatching, which read as "font size only works when I press
 * Return". Typed edits keep the commit-on-blur/Enter discipline (a half-typed "4" of "48" must
 * not flash 4px text on canvas). */
function NumberField({
  id,
  value,
  onCommit,
  min = 0,
  max = 10000,
  step = 1,
  disabled,
  title,
  decrementLabel,
  incrementLabel,
}: {
  id?: string;
  value: number;
  onCommit: (next: number, opts?: { coalesceKey?: string }) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  title?: string;
  decrementLabel: string;
  incrementLabel: string;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const sessionRef = useRef<{ key: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const clamp = (n: number) => Math.min(max, Math.max(min, n));

  const stepBy = (delta: number) => {
    const base = Number(draft);
    const next = clamp((Number.isFinite(base) ? base : value) + delta);
    setDraft(String(next));
    if (sessionRef.current) clearTimeout(sessionRef.current.timer);
    const key = sessionRef.current?.key ?? `numfield:${++numberStepSessionCounter}`;
    sessionRef.current = {
      key,
      timer: setTimeout(() => {
        sessionRef.current = null;
      }, STEP_COALESCE_IDLE_MS),
    };
    onCommit(next, { coalesceKey: key });
  };

  const commitTyped = () => {
    const n = Number(draft);
    if (draft.trim() !== '' && Number.isFinite(n)) {
      const clamped = clamp(n);
      setDraft(String(clamped));
      if (clamped !== value) onCommit(clamped);
    } else {
      setDraft(String(value)); // unparseable → revert, never dispatch garbage
    }
  };

  // Unmount-flush: a typed-but-uncommitted draft flushes instead of being silently discarded
  // when the variant remounts for another layer (`key={layer.id}` in the default export forces
  // that remount). Refs, not effect deps — the `[]` cleanup must read live values on unmount.
  const latestRef = useRef({ draft, value, commitTyped });
  latestRef.current = { draft, value, commitTyped };
  useEffect(() => {
    return () => {
      const latest = latestRef.current;
      if (latest.draft !== String(latest.value)) latest.commitTyped();
    };
  }, []);

  const stepButtonStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 26,
    alignSelf: 'stretch',
    border: '1px solid var(--border-color)',
    borderRadius: 6,
    background: 'var(--surface-main)',
    color: 'var(--text-main)',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    padding: 0,
  };

  return (
    <div style={{ display: 'flex', gap: '0.2rem', alignItems: 'stretch' }} title={title}>
      <button
        type="button"
        aria-label={decrementLabel}
        title={decrementLabel}
        disabled={disabled || value <= min}
        style={stepButtonStyle}
        onClick={(e) => stepBy(-(e.shiftKey ? step * 10 : step))}
      >
        <Minus size={12} />
      </button>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        disabled={disabled}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitTyped}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            setDraft(String(value));
            e.currentTarget.blur();
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            stepBy(e.shiftKey ? step * 10 : step);
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            stepBy(-(e.shiftKey ? step * 10 : step));
          }
        }}
        style={{ ...inputStyle, width: 56, textAlign: 'center', opacity: disabled ? 0.5 : 1 }}
      />
      <button
        type="button"
        aria-label={incrementLabel}
        title={incrementLabel}
        disabled={disabled || value >= max}
        style={stepButtonStyle}
        onClick={(e) => stepBy(e.shiftKey ? step * 10 : step)}
      >
        <Plus size={12} />
      </button>
    </div>
  );
}

function ToolbarShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      data-testid="contextual-toolbar"
      style={{
        display: 'flex',
        flexWrap: 'nowrap',
        alignItems: 'center',
        gap: '1rem',
        height: CONTEXTUAL_TOOLBAR_HEIGHT,
        padding: '0 clamp(1.25rem, 3vw, 2.5rem)',
        overflowX: 'auto',
        overflowY: 'hidden',
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

  // Captured as locals (not `layer.shadow` inline) so TS narrows them inside the ColorPicker
  // onChange closures — property-access narrowing doesn't survive into a nested callback.
  const shadow = layer.shadow;
  const pill = layer.pill;
  const hasShadow = !!shadow;
  const hasPill = !!pill;

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
        <NumberField
          id="toolbar-font-size"
          value={layer.font_size}
          min={1}
          max={1000}
          decrementLabel={t('toolbar.stepDown')}
          incrementLabel={t('toolbar.stepUp')}
          onCommit={(n, opts) => onUpdateLayer(layer.id, { font_size: n }, opts)}
        />
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>{t('toolbar.text.color')}</span>
        <ColorPicker
          value={layer.color}
          label={t('toolbar.text.color')}
          brandColors={brandColors}
          onChange={(hex, opts) => onUpdateLayer(layer.id, { color: hex }, opts)}
        />
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>{t('toolbar.text.align')}</span>
        <div
          style={{ display: 'flex', gap: '0.25rem' }}
          role="group"
          aria-label={t('toolbar.text.align')}
        >
          {(['left', 'center', 'right'] as const).map((align) => {
            const AlignIcon =
              align === 'left' ? AlignLeft : align === 'center' ? AlignCenter : AlignRight;
            const label = t(`toolbar.text.align_${align}`);
            return (
              <button
                key={align}
                type="button"
                aria-pressed={layer.align === align}
                aria-label={label}
                title={label}
                style={toggleButtonStyle(layer.align === align)}
                onClick={() => onUpdateLayer(layer.id, { align })}
              >
                <AlignIcon size={16} />
              </button>
            );
          })}
        </div>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>{t('toolbar.text.shadow')}</span>
        <div style={toggleWithColorStyle}>
          <button
            type="button"
            aria-pressed={hasShadow}
            aria-label={t('toolbar.text.shadow')}
            title={t('toolbar.text.shadow')}
            style={toggleButtonStyle(hasShadow)}
            onClick={() =>
              onUpdateLayer(layer.id, { shadow: hasShadow ? undefined : DEFAULT_SHADOW })
            }
          >
            <Contrast size={16} />
          </button>
          {shadow && (
            <ColorPicker
              value={shadow.color}
              label={t('toolbar.text.shadowColor')}
              brandColors={brandColors}
              onChange={(hex, opts) =>
                onUpdateLayer(layer.id, { shadow: { ...shadow, color: hex } }, opts)
              }
            />
          )}
        </div>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>{t('toolbar.text.pill')}</span>
        <div style={toggleWithColorStyle}>
          <button
            type="button"
            aria-pressed={hasPill}
            aria-label={t('toolbar.text.pill')}
            title={t('toolbar.text.pill')}
            style={toggleButtonStyle(hasPill)}
            onClick={() => onUpdateLayer(layer.id, { pill: hasPill ? undefined : DEFAULT_PILL })}
          >
            <RectangleHorizontal size={16} />
          </button>
          {pill && (
            <ColorPicker
              value={pill.color}
              label={t('toolbar.text.pillColor')}
              brandColors={brandColors}
              onChange={(hex, opts) =>
                onUpdateLayer(layer.id, { pill: { ...pill, color: hex } }, opts)
              }
            />
          )}
        </div>
      </div>
    </>
  );
}

function ImageVariant({
  layer,
  onUpdateLayer,
  onReplaceImage,
  brandColors,
}: {
  layer: NormalizedImageLayer;
  onUpdateLayer: ContextualToolbarProps['onUpdateLayer'];
  onReplaceImage?: (layerId: string) => void;
  brandColors?: string[];
}) {
  const { t } = useTranslation('estudio');
  const border = layer.border;
  const hasBorder = !!border;

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
        <NumberField
          id="toolbar-image-radius"
          value={layer.radius ?? 0}
          min={0}
          max={1000}
          decrementLabel={t('toolbar.stepDown')}
          incrementLabel={t('toolbar.stepUp')}
          onCommit={(n, opts) => onUpdateLayer(layer.id, { radius: n }, opts)}
        />
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>{t('toolbar.image.border')}</span>
        <div style={toggleWithColorStyle}>
          <button
            type="button"
            aria-pressed={hasBorder}
            aria-label={t('toolbar.image.border')}
            title={t('toolbar.image.border')}
            style={toggleButtonStyle(hasBorder)}
            onClick={() =>
              onUpdateLayer(layer.id, { border: hasBorder ? undefined : DEFAULT_IMAGE_BORDER })
            }
          >
            <Frame size={16} />
          </button>
          {border && (
            <ColorPicker
              value={border.color}
              label={t('toolbar.image.borderColor')}
              brandColors={brandColors}
              onChange={(hex, opts) =>
                onUpdateLayer(layer.id, { border: { ...border, color: hex } }, opts)
              }
            />
          )}
        </div>
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>{t('toolbar.image.replace')}</span>
        <button
          type="button"
          aria-label={t('toolbar.image.replace')}
          title={t('toolbar.image.replace')}
          style={toggleButtonStyle(false)}
          onClick={() => onReplaceImage?.(layer.id)}
        >
          <Replace size={16} />
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
  const stroke = layer.stroke;
  const hasStroke = !!stroke;
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
          onChange={(hex, opts) =>
            onUpdateLayer(layer.id, { fill: { type: 'solid', color: hex } }, opts)
          }
        />
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>{t('toolbar.shape.stroke')}</span>
        <div style={toggleWithColorStyle}>
          <button
            type="button"
            aria-pressed={hasStroke}
            aria-label={t('toolbar.shape.stroke')}
            title={t('toolbar.shape.stroke')}
            style={toggleButtonStyle(hasStroke)}
            onClick={() =>
              onUpdateLayer(layer.id, { stroke: hasStroke ? undefined : DEFAULT_SHAPE_STROKE })
            }
          >
            <Square size={16} />
          </button>
          {stroke && (
            <ColorPicker
              value={stroke.color}
              label={t('toolbar.shape.strokeColor')}
              brandColors={brandColors}
              onChange={(hex, opts) =>
                onUpdateLayer(layer.id, { stroke: { ...stroke, color: hex } }, opts)
              }
            />
          )}
        </div>
      </div>

      <div style={rowStyle}>
        <label
          style={{ ...labelStyle, opacity: radiusDisabled ? 0.5 : 1 }}
          htmlFor="toolbar-shape-radius"
          title={radiusDisabled ? t('toolbar.shape.radiusDisabledHint') : undefined}
        >
          {t('toolbar.shape.radius')}
        </label>
        <NumberField
          id="toolbar-shape-radius"
          value={layer.radius ?? 0}
          min={0}
          max={1000}
          disabled={radiusDisabled}
          title={radiusDisabled ? t('toolbar.shape.radiusDisabledHint') : undefined}
          decrementLabel={t('toolbar.stepDown')}
          incrementLabel={t('toolbar.stepUp')}
          onCommit={(n, opts) => onUpdateLayer(layer.id, { radius: n }, opts)}
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
  const { t } = useTranslation('estudio');

  // The shell ALWAYS renders at its fixed height (see CONTEXTUAL_TOOLBAR_HEIGHT) — an empty
  // toolbar disappearing/reappearing with selection is exactly the canvas-container resize that
  // read as the UI "zooming" on select/deselect.
  if (!layer) {
    return (
      <ToolbarShell>
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          {t('toolbar.emptyHint')}
        </span>
      </ToolbarShell>
    );
  }

  return (
    <ToolbarShell>
      {/* `key={layer.id}` forces a full unmount/remount of the active variant when the SELECTED
          LAYER changes (not just when one of its field values changes) — without this, switching
          from layer A to layer B reuses the same mounted NumberField DOM nodes, and their own
          `useEffect(() => setDraft(value), [value])` would silently overwrite an uncommitted draft
          for layer A with layer B's value. Forcing a real unmount here is what makes NumberField's
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
          brandColors={brandColors}
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
