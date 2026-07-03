import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useCanvasTransform, type CanvasPoint } from '../hooks/useCanvasTransform';

/** jsdom never lays anything out — `clientWidth`/`clientHeight` are always 0 on every element
 * unless stubbed. Stubbing at the prototype level (rather than per-instance) means the hook's
 * `containerRef.current` — a real DOM node React attaches before the mount effect runs — reports
 * the fake size the moment `recomputeFit()` reads it, with no ref-timing race to work around. */
function stubClientSize(width: number, height: number) {
  Object.defineProperty(HTMLDivElement.prototype, 'clientWidth', {
    value: width,
    configurable: true,
  });
  Object.defineProperty(HTMLDivElement.prototype, 'clientHeight', {
    value: height,
    configurable: true,
  });
}

afterEach(() => {
  Reflect.deleteProperty(HTMLDivElement.prototype, 'clientWidth');
  Reflect.deleteProperty(HTMLDivElement.prototype, 'clientHeight');
});

interface TestStageProps {
  canvasWidth: number;
  canvasHeight: number;
  onReady?: (transform: {
    scale: number;
    offset: { x: number; y: number };
    isFitView: boolean;
    screenToCanvas: (x: number, y: number) => CanvasPoint;
    canvasToScreen: (x: number, y: number) => CanvasPoint;
    zoomAtPoint: (clientX: number, clientY: number, factor: number) => void;
    panBy: (dx: number, dy: number) => void;
    resetView: () => void;
  }) => void;
}

function TestStage({ canvasWidth, canvasHeight, onReady }: TestStageProps) {
  const transform = useCanvasTransform(canvasWidth, canvasHeight);
  onReady?.(transform);
  return (
    <div ref={transform.containerRef} data-testid="scale">
      {transform.scale}
    </div>
  );
}

describe('useCanvasTransform', () => {
  it('fits a canvas smaller than the container at 1:1 scale (never upscales)', () => {
    stubClientSize(2000, 2000);
    const { getByTestId } = render(<TestStage canvasWidth={1080} canvasHeight={1350} />);
    expect(getByTestId('scale').textContent).toBe('1');
  });

  it('shrinks a canvas larger than the container, bound by the tighter axis', () => {
    // 400x400 container minus 32px padding each side -> 336x336 available.
    // width-bound scale = 336/1080, height-bound = 336/1350 — the smaller of the two wins so the
    // whole canvas stays visible rather than overflowing on one axis.
    stubClientSize(400, 400);
    const { getByTestId } = render(<TestStage canvasWidth={1080} canvasHeight={1350} />);
    const expected = Math.min(336 / 1080, 336 / 1350);
    expect(Number(getByTestId('scale').textContent)).toBeCloseTo(expected, 5);
  });

  it('screenToCanvas and canvasToScreen round-trip correctly at a non-1 fit scale', () => {
    stubClientSize(400, 400);
    let latest: Parameters<NonNullable<TestStageProps['onReady']>>[0] | undefined;
    render(<TestStage canvasWidth={1080} canvasHeight={1350} onReady={(t) => (latest = t)} />);

    expect(latest!.scale).toBeLessThan(1);
    const canvasPoint = latest!.screenToCanvas(100, 50);
    expect(canvasPoint).toEqual({ x: 100 / latest!.scale, y: 50 / latest!.scale });
    expect(latest!.canvasToScreen(canvasPoint.x, canvasPoint.y).x).toBeCloseTo(100, 10);
    expect(latest!.canvasToScreen(canvasPoint.x, canvasPoint.y).y).toBeCloseTo(50, 10);
  });

  it('does not throw and defaults to scale=1 when canvas dimensions are zero', () => {
    const { getByTestId } = render(<TestStage canvasWidth={0} canvasHeight={0} />);
    expect(getByTestId('scale').textContent).toBe('1');
  });

  describe('zoom/pan (PR 2.D)', () => {
    /** getBoundingClientRect stub so zoomAtPoint's container-rect math has real numbers. */
    function stubBoundingRect(width: number, height: number) {
      Object.defineProperty(HTMLDivElement.prototype, 'getBoundingClientRect', {
        configurable: true,
        value: () =>
          ({ left: 0, top: 0, right: width, bottom: height, width, height, x: 0, y: 0 }) as DOMRect,
      });
    }
    afterEach(() => {
      Reflect.deleteProperty(HTMLDivElement.prototype, 'getBoundingClientRect');
    });

    function mount(canvasWidth = 1000, canvasHeight = 1000, container = 1064) {
      stubClientSize(container, container);
      stubBoundingRect(container, container);
      let latest: Parameters<NonNullable<TestStageProps['onReady']>>[0] | undefined;
      render(
        <TestStage
          canvasWidth={canvasWidth}
          canvasHeight={canvasHeight}
          onReady={(t) => (latest = t)}
        />,
      );
      return () => latest!;
    }

    it('zoomAtPoint multiplies the effective scale and keeps the anchored canvas point stationary', () => {
      // 1064x1064 container, 1000x1000 canvas -> fitScale 1, box top-left at (32, 32).
      const get = mount();
      expect(get().scale).toBe(1);

      // Anchor on the canvas point (468, 468) — screen (500, 500).
      act(() => get().zoomAtPoint(500, 500, 2));
      expect(get().scale).toBeCloseTo(2, 10);

      // The anchored canvas point must still sit at screen (500, 500):
      // boxLeft' = (1064 - 1000*2)/2 + offset.x ; boxLeft' + 468*2 === 500.
      const boxLeft = (1064 - 1000 * get().scale) / 2 + get().offset.x;
      expect(boxLeft + 468 * get().scale).toBeCloseTo(500, 6);
      expect(get().isFitView).toBe(false);
    });

    it('clamps the effective scale to the 5%-400% range', () => {
      const get = mount();
      act(() => get().zoomAtPoint(500, 500, 1000));
      expect(get().scale).toBe(4);
      act(() => get().zoomAtPoint(500, 500, 1e-9));
      expect(get().scale).toBe(0.05);
    });

    it('panBy accumulates offsets and resetView restores the fit view', () => {
      const get = mount();
      act(() => get().panBy(40, -25));
      act(() => get().panBy(10, 5));
      expect(get().offset).toEqual({ x: 50, y: -20 });
      expect(get().isFitView).toBe(false);

      act(() => get().resetView());
      expect(get().offset).toEqual({ x: 0, y: 0 });
      expect(get().scale).toBe(1);
      expect(get().isFitView).toBe(true);
    });

    it('conversion helpers track the zoomed scale (canvas-box contract unchanged)', () => {
      const get = mount();
      act(() => get().zoomAtPoint(532, 532, 2));
      const p = get().screenToCanvas(200, 100);
      expect(p).toEqual({ x: 100, y: 50 });
      expect(get().canvasToScreen(100, 50)).toEqual({ x: 200, y: 100 });
    });
  });
});
