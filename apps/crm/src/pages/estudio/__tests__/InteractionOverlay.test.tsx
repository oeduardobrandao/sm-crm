// RTL tests for the T2.6/T2.7 interaction layer: CanvasStage (canvas-box wrapper) +
// InteractionOverlay (click-to-select, drag/resize gesture commit discipline) + LayerHandles +
// SafeZoneGuides. Mirrors this codebase's established conventions (PostPicker.test.tsx,
// useCanvasTransform.test.tsx): stub `clientWidth`/`clientHeight`/`getBoundingClientRect` on
// HTMLDivElement.prototype since jsdom never lays anything out, mock `useSatoriRenderer` so this
// file stays focused on interaction logic rather than the real satori/yoga pipeline (that's
// useSatoriRenderer.test.tsx's concern).
import { render, screen, fireEvent } from '@testing-library/react';
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

  it('does not render LayerHandles when nothing is selected', () => {
    renderStage({ layers: [makeTextLayer({ id: 'a' })], selection: [] });
    expect(screen.queryByTestId('layer-handles')).not.toBeInTheDocument();
  });
});

describe('SafeZoneGuides toggle', () => {
  beforeEach(() => {
    stubContainerAndBoxGeometry();
    satoriRendererState.svg = '<svg width="1000" height="1000"></svg>';
    satoriRendererState.error = null;
  });

  it('safe-zone guides are visible by default and toggle off/on via the corner button', () => {
    renderStage();
    expect(screen.getByTestId('safe-zone-guides')).toBeInTheDocument();

    const toggle = screen.getByRole('button');
    fireEvent.click(toggle);
    expect(screen.queryByTestId('safe-zone-guides')).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.getByTestId('safe-zone-guides')).toBeInTheDocument();
  });

  it('renders top/bottom danger zones (no carousel strip) for feed format', () => {
    renderStage({ format: 'feed' });
    expect(screen.getByTestId('safe-zone-top')).toBeInTheDocument();
    expect(screen.getByTestId('safe-zone-bottom')).toBeInTheDocument();
    expect(screen.queryByTestId('safe-zone-carousel-dots')).not.toBeInTheDocument();
    expect(screen.queryByTestId('safe-zone-reel-crop')).not.toBeInTheDocument();
  });

  it('renders an additional carousel-dots strip guide for carrossel format', () => {
    renderStage({ format: 'carrossel' });
    expect(screen.getByTestId('safe-zone-top')).toBeInTheDocument();
    expect(screen.getByTestId('safe-zone-bottom')).toBeInTheDocument();
    expect(screen.getByTestId('safe-zone-carousel-dots')).toBeInTheDocument();
  });

  it('renders the center 3:4 grid-crop box (not top/bottom danger zones) for reel_cover format', () => {
    renderStage({ format: 'reel_cover', canvasHeight: 1920 });
    expect(screen.getByTestId('safe-zone-reel-crop')).toBeInTheDocument();
    expect(screen.queryByTestId('safe-zone-top')).not.toBeInTheDocument();
    expect(screen.queryByTestId('safe-zone-bottom')).not.toBeInTheDocument();
    expect(screen.queryByTestId('safe-zone-carousel-dots')).not.toBeInTheDocument();
  });

  it('renders the danger zones at their exact canvas-space pixel size when scale is 1', () => {
    // stubContainerAndBoxGeometry's 1064x1064 container against a 1000x1000 doc canvas resolves
    // to scale===1 (see that helper's own comment) — this pins down the un-scaled baseline before
    // the next test proves the values genuinely scale down at a smaller fit.
    renderStage({ format: 'feed' });
    expect(screen.getByTestId('safe-zone-top')).toHaveStyle({ height: '150px' });
    expect(screen.getByTestId('safe-zone-bottom')).toHaveStyle({ height: '250px' });
  });

  it('scales every safe-zone pixel value by the actual fit scale, not the raw canvas-space constant', () => {
    // A 500x500 container against a 1000x1000 doc canvas: availableWidth/Height = 500 - 64 = 436,
    // fitScale = min(436/1000, 436/1000, 1) = 0.436. SafeZoneGuides is rendered inside a canvas-box
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
    const expectedScale = 436 / 1000;

    renderStage({ format: 'feed' });
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
    const expectedScale = 436 / 1000; // 1000x1000 doc canvas (renderStage's default)

    renderStage({ format: 'carrossel' });
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
});
