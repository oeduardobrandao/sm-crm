import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import type React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from './cn';
import { useSheetHistory } from './useSheetHistory';
import { useReturnFocus } from './useReturnFocus';
import { SheetActionsContext } from './sheetActions';

/**
 * `medium` is 55% of the screen, `large` nearly full height, `fit` the content's own height
 * (capped at `large`): for short sheets such as a help text.
 */
export type SheetDetent = 'medium' | 'large' | 'fit';

/** Drag distance (px) past which releasing steps down a detent or dismisses. */
const DISMISS_DISTANCE = 110;
/** Downward speed (px/ms) that dismisses regardless of distance (a flick). */
const DISMISS_VELOCITY = 0.6;
const EXPAND_DISTANCE = 50;

export interface BottomSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Dialog title. Always present for screen readers; `hideTitle` keeps it visually hidden. */
  title: ReactNode;
  hideTitle?: boolean;
  description?: ReactNode;
  /** Heights the sheet can rest at. Dragging the handle moves between them. */
  detents?: SheetDetent[];
  initialDetent?: SheetDetent;
  /** Left of the header row (e.g. "Limpar"). */
  headerLeading?: ReactNode;
  /** Right of the header row (e.g. a primary "Ver 6"). Replaces the close button unless `showClose`. */
  headerTrailing?: ReactNode;
  showClose?: boolean;
  /** Where focus goes on close. Defaults to whatever had focus when the sheet opened. */
  returnFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
  overlayClassName?: string;
  id?: string;
  /**
   * Re-push the sheet's history entry when a Back-triggered close is refused by the parent
   * (a dirty-form confirm answered "cancel", a save in flight), so the next Back still
   * targets the sheet instead of leaving the page. Default off.
   */
  repushIfStillOpen?: boolean;
  children: ReactNode;
}

/**
 * iOS-style bottom sheet on the Radix Dialog (focus trap, Escape, outside click).
 *
 * - Grabber + header are the drag zone: drag down to step from large to medium or to
 *   dismiss, drag up to expand. The body scrolls normally.
 * - Opening pushes a history entry, so Back closes the sheet and not the page.
 * - Content is unmounted while closed (no `forceMount`): an always-present
 *   `role="dialog"` would look like unsaved work to the silent-update check.
 */
export function BottomSheet({
  open,
  onOpenChange,
  title,
  hideTitle,
  description,
  detents = ['large'],
  initialDetent,
  headerLeading,
  headerTrailing,
  showClose,
  returnFocusRef,
  className,
  overlayClassName,
  id,
  repushIfStillOpen,
  children,
}: BottomSheetProps) {
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  const { closeThen } = useSheetHistory(
    open,
    close,
    repushIfStillOpen ? { repushIfStillOpen: true } : undefined,
  );
  const onCloseAutoFocus = useReturnFocus(open, returnFocusRef);
  const startDetent = initialDetent && detents.includes(initialDetent) ? initialDetent : detents[0];
  const [detent, setDetent] = useState<SheetDetent>(startDetent);
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    pointerId: number;
    startY: number;
    lastY: number;
    lastT: number;
    velocity: number;
  } | null>(null);

  useEffect(() => {
    if (open) setDetent(startDetent);
    // Only on (re)open: a detent change while open must not snap back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const canExpand = detent === 'medium' && detents.includes('large');
  const canShrink = detent === 'large' && detents.includes('medium');
  const actions = useMemo(() => ({ close, closeThen }), [close, closeThen]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    // Buttons in the header stay buttons; only the grabber itself and empty header space drag.
    if (target.closest('button, a, input, textarea, select') && !target.closest('[data-grabber]'))
      return;
    dragRef.current = {
      pointerId: e.pointerId,
      startY: e.clientY,
      lastY: e.clientY,
      lastT: e.timeStamp,
      velocity: 0,
    };
    const el = e.currentTarget;
    if (typeof el.setPointerCapture === 'function') el.setPointerCapture(e.pointerId);
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dt = Math.max(1, e.timeStamp - drag.lastT);
    drag.velocity = (e.clientY - drag.lastY) / dt;
    drag.lastY = e.clientY;
    drag.lastT = e.timeStamp;
    const dy = e.clientY - drag.startY;
    // Upward drags resist: the sheet can't leave its top edge behind.
    setDragY(dy > 0 ? dy : dy / 4);
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    dragRef.current = null;
    const el = e.currentTarget;
    if (typeof el.releasePointerCapture === 'function' && el.hasPointerCapture?.(e.pointerId)) {
      el.releasePointerCapture(e.pointerId);
    }
    const dy = e.clientY - drag.startY;
    setDragging(false);
    setDragY(0);
    if (cancelled) return;
    if (dy > DISMISS_DISTANCE || drag.velocity > DISMISS_VELOCITY) {
      if (canShrink && dy < DISMISS_DISTANCE * 2.5) setDetent('medium');
      else close();
    } else if (dy < -EXPAND_DISTANCE && canExpand) {
      setDetent('large');
    }
  };

  const multipleDetents = detents.length > 1;
  const closeVisible = showClose ?? !headerTrailing;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn('phone-kit phone-sheet-overlay', overlayClassName)}
        />
        <DialogPrimitive.Content
          id={id}
          className={cn('phone-kit phone-sheet', className)}
          data-detent={detent}
          data-dragging={dragging || undefined}
          style={dragY ? { transform: `translateY(${dragY}px)` } : undefined}
          onCloseAutoFocus={onCloseAutoFocus}
          {...(description ? {} : { 'aria-describedby': undefined })}
        >
          <div
            className="phone-sheet__drag-zone"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(e) => endDrag(e)}
            onPointerCancel={(e) => endDrag(e, true)}
          >
            {multipleDetents ? (
              <button
                type="button"
                data-grabber
                className="phone-sheet__grabber"
                aria-label={canExpand ? 'Expandir' : 'Recolher'}
                onClick={() => setDetent(canExpand ? 'large' : 'medium')}
              />
            ) : (
              <span data-grabber className="phone-sheet__grabber" aria-hidden="true" />
            )}
            <div className="phone-sheet__header">
              <div className="phone-sheet__header-side">{headerLeading}</div>
              <DialogPrimitive.Title className={cn('phone-sheet__title', hideTitle && 'sr-only')}>
                {title}
              </DialogPrimitive.Title>
              <div className="phone-sheet__header-side phone-sheet__header-side--end">
                {headerTrailing}
                {closeVisible && (
                  <DialogPrimitive.Close className="phone-sheet__close" aria-label="Fechar">
                    <X aria-hidden="true" />
                  </DialogPrimitive.Close>
                )}
              </div>
            </div>
          </div>
          {description && (
            <DialogPrimitive.Description className="sr-only">
              {description}
            </DialogPrimitive.Description>
          )}
          <div className="phone-sheet__body">
            <SheetActionsContext.Provider value={actions}>{children}</SheetActionsContext.Provider>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
