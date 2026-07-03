import { render } from '@testing-library/react';
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
    screenToCanvas: (x: number, y: number) => CanvasPoint;
    canvasToScreen: (x: number, y: number) => CanvasPoint;
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
});
