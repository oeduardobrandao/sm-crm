import { useEffect, useRef, useState, type FocusEvent, type ReactNode } from 'react';
import type React from 'react';
import { cn } from './cn';
import { LONG_PRESS_TOLERANCE_PX } from './useLongPress';

export interface SwipeAction {
  label: string;
  icon?: ReactNode;
  onAction: () => void;
  /** Background: grey `neutral`, green `success`, dark `ink`, red `destructive`. */
  tone?: 'neutral' | 'success' | 'ink' | 'destructive';
}

export interface SwipeRowProps {
  /** Revealed by swiping right (left edge). */
  leadingActions?: SwipeAction[];
  /** Revealed by swiping left (right edge). */
  trailingActions?: SwipeAction[];
  children: ReactNode;
  className?: string;
  /** Element for the row root, e.g. `li` inside a list. */
  as?: 'div' | 'li';
}

export const SWIPE_ACTION_WIDTH = 76;
type Side = 'leading' | 'trailing' | null;

/**
 * Row with actions behind it, revealed by a horizontal swipe.
 *
 * - The content carries `touch-action: pan-y`, so the browser keeps vertical scrolling;
 *   the row only takes over once the movement is clearly horizontal (past 8px, more x
 *   than y). A vertical start abandons the gesture for that touch.
 * - Releasing past half the actions' width snaps open, otherwise it springs back.
 * - While open, a tap on the content closes it instead of activating it; a tap outside
 *   the row closes it too.
 * - The action buttons are always in the DOM: tabbing to one slides its side open, so
 *   keyboard and screen-reader users reach the same actions without swiping.
 */
export function SwipeRow({
  leadingActions = [],
  trailingActions = [],
  children,
  className,
  as: Root = 'div',
}: SwipeRowProps) {
  const leadingWidth = leadingActions.length * SWIPE_ACTION_WIDTH;
  const trailingWidth = trailingActions.length * SWIPE_ACTION_WIDTH;
  const [openSide, setOpenSide] = useState<Side>(null);
  const [dragOffset, setDragOffset] = useState<number | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);
  const gestureRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    base: number;
    axis: 'x' | 'y' | null;
  } | null>(null);
  const swallowClickRef = useRef(false);

  const restingOffset =
    openSide === 'leading' ? leadingWidth : openSide === 'trailing' ? -trailingWidth : 0;
  const offset = dragOffset ?? restingOffset;

  useEffect(() => {
    if (!openSide) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpenSide(null);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [openSide]);

  const clamp = (value: number) => {
    const min = -trailingWidth;
    const max = leadingWidth;
    // Past the actions the row resists instead of stopping dead.
    if (value > max) return max + (value - max) / 4;
    if (value < min) return min + (value - min) / 4;
    return value;
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // A swipe whose click never came (pointer capture can eat it) must not swallow this tap.
    swallowClickRef.current = false;
    gestureRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      base: restingOffset,
      axis: null,
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    if (!g || g.pointerId !== e.pointerId || g.axis === 'y') return;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (g.axis === null) {
      if (Math.abs(dx) < LONG_PRESS_TOLERANCE_PX && Math.abs(dy) < LONG_PRESS_TOLERANCE_PX) return;
      if (Math.abs(dy) >= Math.abs(dx)) {
        g.axis = 'y';
        return;
      }
      g.axis = 'x';
      const el = e.currentTarget;
      if (typeof el.setPointerCapture === 'function') el.setPointerCapture(e.pointerId);
    }
    setDragOffset(clamp(g.base + dx));
  };

  const onPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gestureRef.current = null;
    if (g.axis !== 'x') return;
    swallowClickRef.current = true;
    const final = clamp(g.base + (e.clientX - g.startX));
    setDragOffset(null);
    if (leadingWidth > 0 && final > leadingWidth / 2) setOpenSide('leading');
    else if (trailingWidth > 0 && final < -trailingWidth / 2) setOpenSide('trailing');
    else setOpenSide(null);
  };

  const onClickCapture = (e: React.MouseEvent) => {
    if (swallowClickRef.current || openSide) {
      swallowClickRef.current = false;
      e.preventDefault();
      e.stopPropagation();
      if (openSide) setOpenSide(null);
    }
  };

  const onBlur = (e: FocusEvent<HTMLElement>) => {
    if (openSide && !e.currentTarget.contains(e.relatedTarget as Node | null)) setOpenSide(null);
  };

  const renderActions = (actions: SwipeAction[], side: 'leading' | 'trailing') =>
    actions.length > 0 && (
      <div
        className={cn('phone-swipe-row__actions', `phone-swipe-row__actions--${side}`)}
        style={{ width: side === 'leading' ? leadingWidth : trailingWidth }}
      >
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            className={cn(
              'phone-swipe-row__action',
              `phone-swipe-row__action--${action.tone ?? 'neutral'}`,
            )}
            onFocus={() => setOpenSide(side)}
            onClick={() => {
              setOpenSide(null);
              action.onAction();
            }}
          >
            {action.icon && <span aria-hidden="true">{action.icon}</span>}
            <span>{action.label}</span>
          </button>
        ))}
      </div>
    );

  return (
    <Root
      ref={(el: HTMLElement | null) => {
        rootRef.current = el;
      }}
      className={cn('phone-kit phone-swipe-row', className)}
      data-open={openSide ?? undefined}
      onBlur={onBlur}
    >
      {renderActions(leadingActions, 'leading')}
      {renderActions(trailingActions, 'trailing')}
      <div
        className="phone-swipe-row__content"
        data-dragging={dragOffset !== null || undefined}
        style={offset ? { transform: `translateX(${offset}px)` } : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={() => {
          gestureRef.current = null;
          setDragOffset(null);
        }}
        onClickCapture={onClickCapture}
      >
        {children}
      </div>
    </Root>
  );
}
