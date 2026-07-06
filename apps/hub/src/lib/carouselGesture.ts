/**
 * Pure geometry for a finger-following media carousel. Kept free of React/DOM so
 * distance, velocity, edge resistance, and tap-vs-drag logic are unit-testable.
 */

/** Minimum horizontal travel (px) before a pointer gesture counts as a swipe (vs a tap/scroll). */
export const DRAG_INTENT_THRESHOLD_PX = 8;
/** Fraction of out-of-bounds drag distance that is still applied at the carousel edges. */
export const EDGE_RESISTANCE = 0.3;
/** Advance to the next slide once the drag passes this fraction of the card width. */
const DISTANCE_RATIO = 0.18;
/** …or once the flick exceeds this velocity, in px/ms. */
const VELOCITY_THRESHOLD = 0.45;

function clamp(index: number, count: number): number {
  return Math.max(0, Math.min(count - 1, index));
}

/**
 * Resolve which slide a released drag should settle on. Advances by one slide in
 * the drag direction when either the distance or velocity threshold is crossed;
 * otherwise stays on the current slide. Result is clamped to [0, count-1].
 * Convention: negative deltaX/velocity = content dragged left = next slide.
 */
export function resolveTarget(opts: {
  currentIndex: number;
  count: number;
  deltaX: number;
  width: number;
  velocity: number;
}): number {
  const { currentIndex, count, deltaX, width, velocity } = opts;
  const passedDistance = width > 0 && Math.abs(deltaX) > width * DISTANCE_RATIO;
  const passedVelocity = Math.abs(velocity) > VELOCITY_THRESHOLD;
  if (!passedDistance && !passedVelocity) return clamp(currentIndex, count);
  const direction = (deltaX || velocity) < 0 ? 1 : -1;
  return clamp(currentIndex + direction, count);
}

/**
 * Damp drag that would pull past the first or last slide so the edge feels
 * rubber-banded instead of exposing empty space. In-range drags are unchanged.
 */
export function applyEdgeResistance(deltaX: number, currentIndex: number, count: number): number {
  const atFirst = currentIndex === 0 && deltaX > 0;
  const atLast = currentIndex === count - 1 && deltaX < 0;
  if (atFirst || atLast) return deltaX * EDGE_RESISTANCE;
  return deltaX;
}

/** True once a pointer move is a deliberate horizontal swipe (not a tap or vertical scroll). */
export function crossedDragThreshold(dx: number, dy: number): boolean {
  return Math.abs(dx) > DRAG_INTENT_THRESHOLD_PX && Math.abs(dx) > Math.abs(dy);
}
