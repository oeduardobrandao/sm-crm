import { useCallback, useEffect, useRef, type ReactNode, type RefObject } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '@/lib/utils';
import { useSheetHistory } from './useSheetHistory';
import { useReturnFocus } from './useReturnFocus';

export interface ActionSheetAction {
  label: ReactNode;
  onSelect: () => void;
  /** Red, for the irreversible choice ("Excluir", "Descartar"). */
  destructive?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  /**
   * Run `onSelect` inside the tap, then close, instead of after the sheet's history
   * entry is popped. For actions that need the user gesture itself (clipboard writes on
   * iOS Safari) and never navigate.
   */
  immediate?: boolean;
}

export interface ActionSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Short title over the actions. Visually hidden when `hideTitle`. */
  title: ReactNode;
  hideTitle?: boolean;
  /** One or two lines explaining the choice. */
  message?: ReactNode;
  actions: ActionSheetAction[];
  cancelLabel?: string;
  /**
   * Closed without choosing an action: Cancelar, the backdrop, Escape or Back. Not
   * called when an action was picked, nor when the parent closes the sheet itself.
   * Lets a confirmation tell "dismissed" from "confirmed", since a chosen action only
   * runs after `onOpenChange(false)` (see `closeThen`).
   */
  onDismiss?: () => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
}

/**
 * iOS action sheet: a floating group of choices with a separate "Cancelar" under it.
 * For confirmations (advance/revert a stage, client approval) and short choice lists.
 * Choosing an action closes the sheet first and runs the action once its history entry
 * is gone, so an action that navigates doesn't leave a dead Back step.
 */
export function ActionSheet({
  open,
  onOpenChange,
  title,
  hideTitle,
  message,
  actions,
  cancelLabel = 'Cancelar',
  onDismiss,
  returnFocusRef,
  className,
}: ActionSheetProps) {
  // Set when an action is picked, so the close that precedes it isn't a dismissal.
  const choseRef = useRef(false);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  useEffect(() => {
    if (open) choseRef.current = false;
  }, [open]);
  const close = useCallback(() => {
    if (!choseRef.current) onDismissRef.current?.();
    onOpenChange(false);
  }, [onOpenChange]);
  const { closeThen } = useSheetHistory(open, close);
  const onCloseAutoFocus = useReturnFocus(open, returnFocusRef);
  const contentRef = useRef<HTMLDivElement>(null);

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="phone-kit phone-sheet-overlay" />
        <DialogPrimitive.Content
          className={cn('phone-kit phone-action-sheet', className)}
          ref={contentRef}
          onCloseAutoFocus={onCloseAutoFocus}
          // Focus the sheet itself, not the first action: Enter must never confirm a
          // destructive choice by accident, and a screen reader reads the title first.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            contentRef.current?.focus();
          }}
          {...(message ? {} : { 'aria-describedby': undefined })}
        >
          <div className="phone-action-sheet__group">
            <div className={cn('phone-action-sheet__head', hideTitle && !message && 'sr-only')}>
              <DialogPrimitive.Title
                className={cn('phone-action-sheet__title', hideTitle && 'sr-only')}
              >
                {title}
              </DialogPrimitive.Title>
              {message && (
                <DialogPrimitive.Description className="phone-action-sheet__message">
                  {message}
                </DialogPrimitive.Description>
              )}
            </div>
            {actions.map((action, i) => (
              <button
                key={i}
                type="button"
                className={cn(
                  'phone-action-sheet__action',
                  action.destructive && 'phone-action-sheet__action--destructive',
                )}
                disabled={action.disabled}
                onClick={() => {
                  choseRef.current = true;
                  if (action.immediate) {
                    action.onSelect();
                    close();
                  } else {
                    closeThen(action.onSelect);
                  }
                }}
              >
                {action.icon && (
                  <span className="phone-action-sheet__icon" aria-hidden="true">
                    {action.icon}
                  </span>
                )}
                {action.label}
              </button>
            ))}
          </div>
          <DialogPrimitive.Close className="phone-action-sheet__cancel">
            {cancelLabel}
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
