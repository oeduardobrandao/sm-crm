// RTL tests for the T2.6/T2.7 interaction layer: CanvasStage (canvas-box wrapper) +
// InteractionOverlay (click-to-select, drag/resize gesture commit discipline) + LayerHandles +
// SafeZoneGuides. Mirrors this codebase's established conventions (PostPicker.test.tsx,
// useCanvasTransform.test.tsx): stub `clientWidth`/`clientHeight`/`getBoundingClientRect` on
// HTMLDivElement.prototype since jsdom never lays anything out, mock `useSatoriRenderer` so this
// file stays focused on interaction logic rather than the real satori/yoga pipeline (that's
// useSatoriRenderer.test.tsx's concern).
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDoc, makePage, makeTextLayer, makeImageLayer } from './fixtures';
import type { NormalizedLayer } from '../types';

// jsdom (26.x, this repo's pinned version) has no native `PointerEvent` constructor at all —
// `fireEvent.pointerDown/Move/Up(el, { clientX, clientY })` silently drops clientX/clientY
// without this polyfill (confirmed: `new window.PointerEvent(...)` throws
// "PointerEvent is not a constructor" in a bare jsdom instance). A minimal MouseEvent-based
// polyfill is enough for this file's purposes — InteractionOverlay only reads
// clientX/clientY/pointerId off the event, never any other Pointer-Events-specific field.
if (
  typeof window !== 'undefined' &&
  typeof (window as unknown as { PointerEvent?: unknown }).PointerEvent === 'undefined'
) {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
    }
  }
  // @ts-expect-error — intentionally patching a missing global for jsdom, not a real PointerEvent.
  window.PointerEvent = PointerEventPolyfill;
}

// ProseMirror (TipTap's engine, now reachable via TextEditOverlay once a double-click enters edit
// mode) needs a handful of DOM range/rect APIs jsdom doesn't implement — same minimal stand-ins as
// TextEditOverlay.test.tsx, scoped here too since this file now transitively mounts it.
if (!('getClientRects' in Range.prototype)) {
  // @ts-expect-error jsdom-only polyfill
  Range.prototype.getClientRects = () => [];
}
Range.prototype.getBoundingClientRect = () =>
  ({
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    x: 0,
    y: 0,
    toJSON() {},
  }) as DOMRect;
// @ts-expect-error jsdom-only polyfill — ProseMirror's view.dom querying uses this in a few paths.
document.elementFromPoint = () => null;

const satoriRendererState: { svg: string | null; error: Error | null } = {
  svg: '<svg width="1000" height="1000"></svg>',
  error: null,
};
vi.mock('../hooks/useSatoriRenderer', () => ({
  useSatoriRenderer: () => ({
    svg: satoriRendererState.svg,
    isRendering: false,
    error: satoriRendererState.error,
  }),
}));

import { CanvasStage } from '../components/Canvas/CanvasStage';

/** Stubs a fixed 1000x1000 container so `useCanvasTransform`'s fit-to-container math resolves to
 * a deterministic scale (1000x1000 canvas at 1000x1000 container - 64px padding => scale < 1,
 * but for a 1000x1000 doc canvas the numbers below use a plain 1:1-friendly container). */
function stubContainerAndBoxGeometry() {
  Object.defineProperty(HTMLDivElement.prototype, 'clientWidth', {
    value: 1064,
    configurable: true,
  });
  Object.defineProperty(HTMLDivElement.prototype, 'clientHeight', {
    value: 1064,
    configurable: true,
  });
  // The canvas-box wrapper (data-testid="canvas-box") and the interaction overlay both need a
  // real `getBoundingClientRect()` for `screenToCanvas`'s conversion — jsdom returns all-zero
  // rects by default, so every element gets a fixed top-left-at-origin rect matching the fit
  // scale computed above (1000x1000 canvas -> availableWidth/Height 1000 -> scale 1).
  HTMLDivElement.prototype.getBoundingClientRect = vi.fn(function (this: HTMLDivElement) {
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 1000,
      bottom: 1000,
      width: 1000,
      height: 1000,
      toJSON: () => {},
    } as DOMRect;
  });
}

afterEach(() => {
  Reflect.deleteProperty(HTMLDivElement.prototype, 'clientWidth');
  Reflect.deleteProperty(HTMLDivElement.prototype, 'clientHeight');
  vi.restoreAllMocks();
});

const getTextHeight = () => 50;

function renderStage(
  overrides: {
    layers?: NormalizedLayer[];
    selection?: string[];
    select?: (s: string[]) => void;
    onUpdateLayer?: (layerId: string, patch: Partial<NormalizedLayer>) => void;
    format?: 'feed' | 'carrossel' | 'reel_cover';
    canvasHeight?: 1080 | 1350 | 1920;
    measureTextAt?: (
      layer: NormalizedLayer,
      w: number,
    ) => Promise<{ width: number; height: number }>;
  } = {},
) {
  const layers = overrides.layers ?? [makeTextLayer({ id: 'a', x: 100, y: 100, w: 200 })];
  const select = overrides.select ?? vi.fn();
  const onUpdateLayer = overrides.onUpdateLayer ?? vi.fn();
  const doc = makeDoc({
    format: overrides.format ?? 'feed',
    canvas: { width: 1000, height: (overrides.canvasHeight ?? 1000) as never },
    pages: [makePage({ layers })],
  });

  const utils = render(
    <CanvasStage
      doc={doc}
      pageIndex={0}
      selection={overrides.selection ?? []}
      select={select}
      onUpdateLayer={onUpdateLayer}
      getTextHeight={getTextHeight}
      measureTextAt={overrides.measureTextAt as never}
    />,
  );
  return { ...utils, select, onUpdateLayer, doc };
}

describe('CanvasStage / InteractionOverlay', () => {
  beforeEach(() => {
    stubContainerAndBoxGeometry();
    satoriRendererState.svg = '<svg width="1000" height="1000"></svg>';
    satoriRendererState.error = null;
  });

  it('clicking a layer selects it', () => {
    const { select } = renderStage({
      layers: [makeTextLayer({ id: 'a', x: 100, y: 100, w: 200 })],
    });
    const overlay = screen.getByTestId('interaction-overlay');

    fireEvent.pointerDown(overlay, { clientX: 150, clientY: 125 });

    expect(select).toHaveBeenCalledWith(['a']);
  });

  it('clicking empty canvas background deselects', () => {
    const { select } = renderStage({
      layers: [makeTextLayer({ id: 'a', x: 100, y: 100, w: 200 })],
      selection: [],
    });
    const overlay = screen.getByTestId('interaction-overlay');

    // Click well outside the layer's bbox (text layer spans x:[100,300] y:[100,150] given
    // getTextHeight=50) -> background.
    fireEvent.pointerDown(overlay, { clientX: 900, clientY: 900 });

    expect(select).toHaveBeenCalledWith([]);
  });

  it('a drag gesture dispatches exactly ONE layer/update on pointerup, and ZERO during pointermove', () => {
    const onUpdateLayer = vi.fn();
    const layer = makeTextLayer({ id: 'a', x: 100, y: 100, w: 200 });
    const { rerender } = renderStage({ layers: [layer], selection: ['a'], onUpdateLayer });

    const overlay = screen.getByTestId('interaction-overlay');

    // Selected layer's body pointerdown begins a drag (layer spans x:[100,300] y:[100,150]).
    fireEvent.pointerDown(overlay, { clientX: 150, clientY: 125 });

    // Multiple intermediate pointermoves during the gesture — none of these may dispatch.
    fireEvent.pointerMove(overlay, { clientX: 160, clientY: 125 });
    fireEvent.pointerMove(overlay, { clientX: 180, clientY: 130 });
    fireEvent.pointerMove(overlay, { clientX: 220, clientY: 140 });
    fireEvent.pointerMove(overlay, { clientX: 260, clientY: 150 });

    expect(onUpdateLayer).not.toHaveBeenCalled();

    fireEvent.pointerUp(overlay, { clientX: 260, clientY: 150 });

    expect(onUpdateLayer).toHaveBeenCalledTimes(1);
    const [calledLayerId, patch] = onUpdateLayer.mock.calls[0];
    expect(calledLayerId).toBe('a');
    // dx = 260-150 = 110, dy = 150-125 = 25 (scale is 1 given the stubbed geometry).
    expect(patch.x).toBeCloseTo(210, 5);
    expect(patch.y).toBeCloseTo(125, 5);

    rerender(<></>);
  });

  it('escape cancels an in-progress drag without dispatching', () => {
    const onUpdateLayer = vi.fn();
    const layer = makeTextLayer({ id: 'a', x: 100, y: 100, w: 200 });
    renderStage({ layers: [layer], selection: ['a'], onUpdateLayer });

    const overlay = screen.getByTestId('interaction-overlay');
    fireEvent.pointerDown(overlay, { clientX: 150, clientY: 125 });
    fireEvent.pointerMove(overlay, { clientX: 300, clientY: 300 });

    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.pointerUp(overlay, { clientX: 300, clientY: 300 });

    expect(onUpdateLayer).not.toHaveBeenCalled();
  });

  it('a pointerup that fires OUTSIDE the overlay (setPointerCapture unsupported / cursor slipped off-element) still commits the gesture, via the window-level fallback', () => {
    // Regression test for a stuck-gesture risk found in review: without `setPointerCapture`
    // support, releasing the pointer outside the overlay's own bounds means the browser hit-tests
    // pointerup to whatever's under the cursor, not this element — so the overlay's own
    // `onPointerUp` never fires. The window-level fallback listener must still end the gesture.
    const onUpdateLayer = vi.fn();
    const layer = makeTextLayer({ id: 'a', x: 100, y: 100, w: 200 });
    renderStage({ layers: [layer], selection: ['a'], onUpdateLayer });

    const overlay = screen.getByTestId('interaction-overlay');
    fireEvent.pointerDown(overlay, { clientX: 150, clientY: 125 });
    fireEvent.pointerMove(overlay, { clientX: 260, clientY: 150 });
    expect(onUpdateLayer).not.toHaveBeenCalled();

    // Fired on `window` directly, NOT on the overlay element — simulates the pointer having left
    // the overlay's hit region before release.
    fireEvent.pointerUp(window, { clientX: 260, clientY: 150 });

    expect(onUpdateLayer).toHaveBeenCalledTimes(1);
    const [calledLayerId, patch] = onUpdateLayer.mock.calls[0];
    expect(calledLayerId).toBe('a');
    expect(patch.x).toBeCloseTo(210, 5); // dx = 260-150 = 110
    expect(patch.y).toBeCloseTo(125, 5); // dy = 150-125 = 25
  });

  it('a resize gesture (image layer, has height) dispatches exactly once with w and h', () => {
    const onUpdateLayer = vi.fn();
    const layer = makeImageLayer({ id: 'img', x: 100, y: 100, w: 200, h: 150 });
    renderStage({ layers: [layer], selection: ['img'], onUpdateLayer });

    const seHandle = screen.getByTestId('resize-handle-se');
    fireEvent.pointerDown(seHandle, { clientX: 300, clientY: 250 });

    const overlay = screen.getByTestId('interaction-overlay');
    fireEvent.pointerMove(overlay, { clientX: 340, clientY: 280 });
    expect(onUpdateLayer).not.toHaveBeenCalled();

    fireEvent.pointerUp(overlay, { clientX: 340, clientY: 280 });

    expect(onUpdateLayer).toHaveBeenCalledTimes(1);
    const [calledLayerId, patch] = onUpdateLayer.mock.calls[0];
    expect(calledLayerId).toBe('img');
    expect(patch.w).toBeGreaterThan(200);
    expect(patch.h).toBeGreaterThan(150);
  });

  it('a text layer resize patch never sets h (width-only)', () => {
    const onUpdateLayer = vi.fn();
    const layer = makeTextLayer({ id: 'a', x: 100, y: 100, w: 200 });
    renderStage({ layers: [layer], selection: ['a'], onUpdateLayer });

    // Text layers hide the vertical-only n/s handles (LayerHandles filters them when
    // hasHeight=false), so only horizontal-component handles should be present.
    expect(screen.queryByTestId('resize-handle-n')).not.toBeInTheDocument();
    expect(screen.queryByTestId('resize-handle-s')).not.toBeInTheDocument();

    const eHandle = screen.getByTestId('resize-handle-e');
    fireEvent.pointerDown(eHandle, { clientX: 300, clientY: 125 });
    const overlay = screen.getByTestId('interaction-overlay');
    fireEvent.pointerMove(overlay, { clientX: 340, clientY: 125 });
    fireEvent.pointerUp(overlay, { clientX: 340, clientY: 125 });

    expect(onUpdateLayer).toHaveBeenCalledTimes(1);
    const [, patch] = onUpdateLayer.mock.calls[0];
    expect(patch.h).toBeUndefined();
    expect(patch.w).toBeGreaterThan(200);
  });

  it('a text CORNER drag scales the whole block: font_size, letter_spacing and pill geometry follow the box (Figma semantics)', () => {
    const onUpdateLayer = vi.fn();
    const layer = makeTextLayer({
      id: 'a',
      x: 100,
      y: 100,
      w: 200,
      font_size: 32,
      letter_spacing: 1,
      pill: { color: '#000000', padding_x: 16, padding_y: 8, radius: 8 },
    });
    renderStage({ layers: [layer], selection: ['a'], onUpdateLayer });

    // bbox is 200x50 (getTextHeight=50); se corner sits at (300, 150). Dragging by the corner's
    // own center-relative vector (100, 25) doubles the diagonal -> uniform scale 2.
    const seHandle = screen.getByTestId('resize-handle-se');
    fireEvent.pointerDown(seHandle, { clientX: 300, clientY: 150 });
    const overlay = screen.getByTestId('interaction-overlay');
    fireEvent.pointerMove(overlay, { clientX: 400, clientY: 175 });
    expect(onUpdateLayer).not.toHaveBeenCalled();
    fireEvent.pointerUp(overlay, { clientX: 400, clientY: 175 });

    expect(onUpdateLayer).toHaveBeenCalledTimes(1);
    const [, patch] = onUpdateLayer.mock.calls[0];
    expect(patch.w).toBeCloseTo(400, 5);
    expect(patch.h).toBeUndefined(); // text height stays emergent
    expect(patch.font_size).toBe(64);
    expect(patch.letter_spacing).toBeCloseTo(2, 5);
    expect(patch.pill).toEqual({ color: '#000000', padding_x: 32, padding_y: 16, radius: 16 });
    expect(patch.x).toBeCloseTo(100, 5); // nw anchor fixed
    expect(patch.y).toBeCloseTo(100, 5);
  });

  it('a text SIDE drag previews the wrapped height live via measureTextAt, and still commits width-only', async () => {
    const onUpdateLayer = vi.fn();
    const measureTextAt = vi.fn(async () => ({ width: 240, height: 123 }));
    const layer = makeTextLayer({ id: 'a', x: 100, y: 100, w: 200 });
    renderStage({ layers: [layer], selection: ['a'], onUpdateLayer, measureTextAt });

    const eHandle = screen.getByTestId('resize-handle-e');
    fireEvent.pointerDown(eHandle, { clientX: 300, clientY: 125 });
    const overlay = screen.getByTestId('interaction-overlay');
    fireEvent.pointerMove(overlay, { clientX: 340, clientY: 125 });

    expect(measureTextAt).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), 240);

    // The ghost outline lifts to the measured height once the async measure resolves: the
    // bottom corners of the layer-handles polygon land at y = 100 + 123 = 223 (scale 1).
    await waitFor(() => {
      const points = screen
        .getByTestId('layer-handles')
        .querySelector('polygon')!
        .getAttribute('points')!;
      const ys = points.split(' ').map((pair) => Number(pair.split(',')[1]));
      expect(Math.max(...ys)).toBeCloseTo(223, 3);
    });

    fireEvent.pointerUp(overlay, { clientX: 340, clientY: 125 });
    expect(onUpdateLayer).toHaveBeenCalledTimes(1);
    const [, patch] = onUpdateLayer.mock.calls[0];
    expect(patch.w).toBeCloseTo(240, 5);
    expect(patch.h).toBeUndefined();
    expect(patch.font_size).toBeUndefined(); // side resize reflows, never rescales the font
  });

  it('an image CORNER drag with Shift held is aspect-locked (uniform w/h scale)', () => {
    const onUpdateLayer = vi.fn();
    const layer = makeImageLayer({ id: 'img', x: 100, y: 100, w: 200, h: 100 });
    renderStage({ layers: [layer], selection: ['img'], onUpdateLayer });

    const seHandle = screen.getByTestId('resize-handle-se');
    fireEvent.pointerDown(seHandle, { clientX: 300, clientY: 200 });
    const overlay = screen.getByTestId('interaction-overlay');
    fireEvent.pointerMove(overlay, { clientX: 400, clientY: 250, shiftKey: true });
    fireEvent.pointerUp(overlay, { clientX: 400, clientY: 250 });

    expect(onUpdateLayer).toHaveBeenCalledTimes(1);
    const [, patch] = onUpdateLayer.mock.calls[0];
    // Delta (100, 50) IS the corner's own center-relative vector (100, 50) -> scale 2 exactly.
    expect(patch.w).toBeCloseTo(400, 5);
    expect(patch.h).toBeCloseTo(200, 5);
    expect((patch.w as number) / (patch.h as number)).toBeCloseTo(2, 5); // aspect preserved
  });

  it('does not render LayerHandles when nothing is selected', () => {
    renderStage({ layers: [makeTextLayer({ id: 'a' })], selection: [] });
    expect(screen.queryByTestId('layer-handles')).not.toBeInTheDocument();
  });

  it('renders NO transform handles for a locked selected layer (T7.4 lock enforcement)', () => {
    // A layer locked via the LayerListPanel can be selected, but must expose no resize/rotate grips.
    renderStage({
      layers: [makeImageLayer({ id: 'img', x: 100, y: 100, w: 200, h: 200, locked: true })],
      selection: ['img'],
    });
    expect(screen.queryByTestId('layer-handles')).not.toBeInTheDocument();
    expect(screen.queryByTestId('rotate-handle')).not.toBeInTheDocument();
    expect(screen.queryByTestId('resize-handle-se')).not.toBeInTheDocument();
  });
});

describe('InteractionOverlay text-edit mode (T2.8)', () => {
  beforeEach(() => {
    stubContainerAndBoxGeometry();
    satoriRendererState.svg = '<svg width="1000" height="1000"></svg>';
    satoriRendererState.error = null;
  });

  it('double-clicking a selected text layer enters edit mode (TextEditOverlay renders) and hides LayerHandles for it', async () => {
    const layer = makeTextLayer({ id: 'a', x: 100, y: 100, w: 200 });
    renderStage({ layers: [layer], selection: ['a'] });

    expect(screen.getByTestId('layer-handles')).toBeInTheDocument();
    expect(screen.queryByTestId('text-edit-overlay')).not.toBeInTheDocument();

    const overlay = screen.getByTestId('interaction-overlay');
    fireEvent.doubleClick(overlay, { clientX: 150, clientY: 125 });

    expect(await screen.findByTestId('text-edit-overlay')).toBeInTheDocument();
    expect(screen.queryByTestId('layer-handles')).not.toBeInTheDocument();
  });

  it('a pointerdown/drag on the layer while editing does NOT start a drag gesture (no gesture-ghost renders)', async () => {
    const onUpdateLayer = vi.fn();
    const layer = makeTextLayer({ id: 'a', x: 100, y: 100, w: 200 });
    renderStage({ layers: [layer], selection: ['a'], onUpdateLayer });

    const overlay = screen.getByTestId('interaction-overlay');
    fireEvent.doubleClick(overlay, { clientX: 150, clientY: 125 });
    await screen.findByTestId('text-edit-overlay');

    fireEvent.pointerDown(overlay, { clientX: 150, clientY: 125 });
    fireEvent.pointerMove(overlay, { clientX: 260, clientY: 150 });
    fireEvent.pointerUp(overlay, { clientX: 260, clientY: 150 });

    expect(screen.queryByTestId('gesture-ghost')).not.toBeInTheDocument();
    expect(onUpdateLayer).not.toHaveBeenCalled();
  });

  it('committing (Enter) exits edit mode and calls onUpdateLayer with the right patch', async () => {
    const onUpdateLayer = vi.fn();
    const layer = makeTextLayer({ id: 'a', x: 100, y: 100, w: 200, text: 'Olá' });
    renderStage({ layers: [layer], selection: ['a'], onUpdateLayer });

    const overlay = screen.getByTestId('interaction-overlay');
    fireEvent.doubleClick(overlay, { clientX: 150, clientY: 125 });
    await screen.findByTestId('text-edit-overlay');

    const editable = screen.getByTestId('text-edit-overlay-editor');
    fireEvent.keyDown(editable, { key: 'Enter' });

    expect(onUpdateLayer).toHaveBeenCalledTimes(1);
    const [calledLayerId, patch] = onUpdateLayer.mock.calls[0];
    expect(calledLayerId).toBe('a');
    expect(patch).toHaveProperty('text');
    expect(screen.queryByTestId('text-edit-overlay')).not.toBeInTheDocument();
  });

  it('Escape while editing exits without calling onUpdateLayer', async () => {
    const onUpdateLayer = vi.fn();
    const layer = makeTextLayer({ id: 'a', x: 100, y: 100, w: 200, text: 'Olá' });
    renderStage({ layers: [layer], selection: ['a'], onUpdateLayer });

    const overlay = screen.getByTestId('interaction-overlay');
    fireEvent.doubleClick(overlay, { clientX: 150, clientY: 125 });
    await screen.findByTestId('text-edit-overlay');

    const editable = screen.getByTestId('text-edit-overlay-editor');
    fireEvent.keyDown(editable, { key: 'Escape' });

    expect(onUpdateLayer).not.toHaveBeenCalled();
    expect(screen.queryByTestId('text-edit-overlay')).not.toBeInTheDocument();
  });
});

describe('SafeZoneGuides toggle', () => {
  beforeEach(() => {
    stubContainerAndBoxGeometry();
    satoriRendererState.svg = '<svg width="1000" height="1000"></svg>';
    satoriRendererState.error = null;
  });

  it('safe-zone guides are visible by default and toggle off/on via the corner button', () => {
    renderStage({ canvasHeight: 1350 });
    expect(screen.getByTestId('safe-zone-guides')).toBeInTheDocument();

    const toggle = screen.getByRole('button');
    fireEvent.click(toggle);
    expect(screen.queryByTestId('safe-zone-guides')).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.getByTestId('safe-zone-guides')).toBeInTheDocument();
  });

  it('renders top/bottom danger zones (no carousel strip) for feed format at 4:5', () => {
    renderStage({ format: 'feed', canvasHeight: 1350 });
    expect(screen.getByTestId('safe-zone-top')).toBeInTheDocument();
    expect(screen.getByTestId('safe-zone-bottom')).toBeInTheDocument();
    expect(screen.queryByTestId('safe-zone-carousel-dots')).not.toBeInTheDocument();
    expect(screen.queryByTestId('safe-zone-reel-crop')).not.toBeInTheDocument();
  });

  it('renders an additional carousel-dots strip guide for carrossel format at 4:5', () => {
    renderStage({ format: 'carrossel', canvasHeight: 1350 });
    expect(screen.getByTestId('safe-zone-top')).toBeInTheDocument();
    expect(screen.getByTestId('safe-zone-bottom')).toBeInTheDocument();
    expect(screen.getByTestId('safe-zone-carousel-dots')).toBeInTheDocument();
  });

  it('renders NO danger zones on a 1:1 canvas — §6.6 scopes the zones to the 4:5 display', () => {
    // Regression: the 150/250px bands derive from IG chrome over a 1350px-tall image; rendering
    // them on 1080x1080 covered ~37% of the canvas with zones the design never defined.
    renderStage({ format: 'feed', canvasHeight: 1080 });
    expect(screen.queryByTestId('safe-zone-guides')).not.toBeInTheDocument();
  });

  it('renders the center 3:4 grid-crop box (not top/bottom danger zones) for reel_cover format', () => {
    renderStage({ format: 'reel_cover', canvasHeight: 1920 });
    expect(screen.getByTestId('safe-zone-reel-crop')).toBeInTheDocument();
    expect(screen.queryByTestId('safe-zone-top')).not.toBeInTheDocument();
    expect(screen.queryByTestId('safe-zone-bottom')).not.toBeInTheDocument();
    expect(screen.queryByTestId('safe-zone-carousel-dots')).not.toBeInTheDocument();
  });

  it('renders the danger zones at their exact canvas-space pixel size when scale is 1', () => {
    // A 1500x1500 container against the 1000x1350 doc canvas resolves to scale===1 — this pins
    // down the un-scaled baseline before the next test proves the values genuinely scale down.
    Object.defineProperty(HTMLDivElement.prototype, 'clientWidth', {
      value: 1500,
      configurable: true,
    });
    Object.defineProperty(HTMLDivElement.prototype, 'clientHeight', {
      value: 1500,
      configurable: true,
    });
    renderStage({ format: 'feed', canvasHeight: 1350 });
    expect(screen.getByTestId('safe-zone-top')).toHaveStyle({ height: '150px' });
    expect(screen.getByTestId('safe-zone-bottom')).toHaveStyle({ height: '250px' });
  });

  it('scales every safe-zone pixel value by the actual fit scale, not the raw canvas-space constant', () => {
    // A 500x500 container against a 1000x1350 doc canvas: availableWidth/Height = 500 - 64 = 436,
    // fitScale = min(436/1000, 436/1350, 1) = 436/1350. SafeZoneGuides is rendered inside a canvas-box
    // wrapper sized at `doc.canvas.width * scale` (screen space) — every one of its own
    // canvas-space pixel constants (150/250/40/1080/1440) must be multiplied by that SAME scale,
    // or the guides render at their native, un-scaled size regardless of how small the box actually
    // is on screen (a real regression this exact test caught during PR 2.B2's adversarial review:
    // SafeZoneGuides had no `scale` prop at all).
    Object.defineProperty(HTMLDivElement.prototype, 'clientWidth', {
      value: 500,
      configurable: true,
    });
    Object.defineProperty(HTMLDivElement.prototype, 'clientHeight', {
      value: 500,
      configurable: true,
    });
    const expectedScale = 436 / 1350;

    renderStage({ format: 'feed', canvasHeight: 1350 });
    const top = screen.getByTestId('safe-zone-top');
    const bottom = screen.getByTestId('safe-zone-bottom');
    expect(top.style.height).toBe(`${150 * expectedScale}px`);
    expect(bottom.style.height).toBe(`${250 * expectedScale}px`);
    // The un-scaled 150px/250px values must NEVER appear once scale !== 1.
    expect(top.style.height).not.toBe('150px');
    expect(bottom.style.height).not.toBe('250px');
  });

  it('scales the carousel-dots strip too', () => {
    Object.defineProperty(HTMLDivElement.prototype, 'clientWidth', {
      value: 500,
      configurable: true,
    });
    Object.defineProperty(HTMLDivElement.prototype, 'clientHeight', {
      value: 500,
      configurable: true,
    });
    const expectedScale = 436 / 1350; // 1000x1350 doc canvas (4:5 — the only height with zones)

    renderStage({ format: 'carrossel', canvasHeight: 1350 });
    expect(screen.getByTestId('safe-zone-carousel-dots').style.height).toBe(
      `${40 * expectedScale}px`,
    );
  });

  it('scales the reel-cover crop box too', () => {
    Object.defineProperty(HTMLDivElement.prototype, 'clientWidth', {
      value: 500,
      configurable: true,
    });
    Object.defineProperty(HTMLDivElement.prototype, 'clientHeight', {
      value: 500,
      configurable: true,
    });
    // canvasHeight=1920 here (renderStage still uses a 1000-wide doc canvas) -> the HEIGHT axis is
    // the binding constraint, not width, so this scale is genuinely different from the other
    // tests in this block: fitScale = min(436/1000, 436/1920, 1) = 436/1920.
    const expectedScale = 436 / 1920;

    renderStage({ format: 'reel_cover', canvasHeight: 1920 });
    const crop = screen.getByTestId('safe-zone-reel-crop');
    expect(crop.style.width).toBe(`${1080 * expectedScale}px`);
    expect(crop.style.height).toBe(`${1440 * expectedScale}px`);
  });

  it('dragging the rotation grip commits ONLY the rotation (position/size untouched), one dispatch on pointerup', () => {
    const onUpdateLayer = vi.fn();
    // Image layer (has an explicit h) centered at (200,125): x=100 y=75 w=200 h=100.
    const layer = makeImageLayer({ id: 'a', x: 100, y: 75, w: 200, h: 100 });
    renderStage({ layers: [layer], selection: ['a'], onUpdateLayer });

    const grip = screen.getByTestId('rotate-handle');
    fireEvent.pointerDown(grip, { clientX: 200, clientY: 53 }); // on the grip stem
    const overlay = screen.getByTestId('interaction-overlay');
    // Pointer to the RIGHT of center (200,125) → 90° clockwise from straight-up.
    fireEvent.pointerMove(overlay, { clientX: 300, clientY: 125 });
    // Live angle badge appears mid-gesture.
    expect(screen.getByTestId('rotation-angle-badge')).toHaveTextContent('90°');
    expect(onUpdateLayer).not.toHaveBeenCalled(); // no commit mid-gesture

    fireEvent.pointerUp(overlay, { clientX: 300, clientY: 125 });
    expect(onUpdateLayer).toHaveBeenCalledTimes(1);
    const [layerId, patch] = onUpdateLayer.mock.calls[0];
    expect(layerId).toBe('a');
    expect(patch).toEqual({ rotation: 90 }); // ONLY rotation, snapped to the 90° stop
  });

  it('Escape cancels an in-progress rotation without dispatching', () => {
    const onUpdateLayer = vi.fn();
    const layer = makeImageLayer({ id: 'a', x: 100, y: 75, w: 200, h: 100 });
    renderStage({ layers: [layer], selection: ['a'], onUpdateLayer });

    const grip = screen.getByTestId('rotate-handle');
    fireEvent.pointerDown(grip, { clientX: 200, clientY: 53 });
    const overlay = screen.getByTestId('interaction-overlay');
    fireEvent.pointerMove(overlay, { clientX: 300, clientY: 125 });
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.pointerUp(overlay, { clientX: 300, clientY: 125 });

    expect(onUpdateLayer).not.toHaveBeenCalled();
  });
});
