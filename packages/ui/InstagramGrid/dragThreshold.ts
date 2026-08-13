/**
 * Local copy of the drag-intent threshold (kept out of apps/hub so this package
 * stays self-contained — it must not import from either app's src). A pointer
 * move only counts as a reorder once it's a deliberate horizontal drag, so a
 * vertical gesture stays a scroll and never swaps publish dates.
 */

export const DRAG_INTENT_THRESHOLD_PX = 8;

export function crossedDragThreshold(dx: number, dy: number): boolean {
  return Math.abs(dx) > DRAG_INTENT_THRESHOLD_PX && Math.abs(dx) > Math.abs(dy);
}
