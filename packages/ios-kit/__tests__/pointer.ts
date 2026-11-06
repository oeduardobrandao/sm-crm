import { fireEvent } from '@testing-library/react';

/**
 * jsdom (26) has no PointerEvent, and testing-library then falls back to a plain Event
 * that drops clientX/pointerId. A MouseEvent subclass carries them.
 */
export function installPointerEvent(): void {
  if (typeof window.PointerEvent === 'function') return;
  class FakePointerEvent extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? 'touch';
    }
  }
  (window as unknown as { PointerEvent: unknown }).PointerEvent = FakePointerEvent;
}

type Point = { x: number; y: number };
const base = { pointerId: 1, pointerType: 'touch', button: 0, bubbles: true };

export function pointerDown(el: Element, p: Point, extra: Partial<PointerEventInit> = {}) {
  fireEvent.pointerDown(el, { ...base, clientX: p.x, clientY: p.y, ...extra });
}
export function pointerMove(el: Element, p: Point) {
  fireEvent.pointerMove(el, { ...base, clientX: p.x, clientY: p.y });
}
export function pointerUp(el: Element, p: Point) {
  fireEvent.pointerUp(el, { ...base, clientX: p.x, clientY: p.y });
}
