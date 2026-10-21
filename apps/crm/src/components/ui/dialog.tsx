import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUnsavedWork } from '@mesaas/app-lifecycle';
import { usePhoneLayout } from '@/components/layout/PhoneLayoutContext';
import { useReturnFocus } from '@/components/mobile/useReturnFocus';
import {
  PhoneOverlayHistory,
  composeRefs,
  useOverlayRootState,
  useSheetDismissDrag,
  type OverlayRootState,
} from '@/components/ui/phone-overlay';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

/** Open state of the root, so the content's phone face can register history and return focus. */
const DialogRootContext = React.createContext<OverlayRootState | null>(null);

/**
 * Radix `Dialog.Root`, holding the open state itself (controlled or not) so `DialogContent`
 * can read it. Same props and behaviour as the Radix root.
 */
function Dialog({
  open: openProp,
  defaultOpen,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  const state = useOverlayRootState(openProp, defaultOpen, onOpenChange);
  return (
    <DialogRootContext.Provider value={state}>
      <DialogPrimitive.Root {...props} open={state.open} onOpenChange={state.onOpenChange} />
    </DialogRootContext.Provider>
  );
}
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    data-slot="dialog-overlay"
    className={cn(
      'fixed inset-0 z-[9010] bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

/**
 * Shared with callers that render their own copy of the guard (e.g. a Cancelar button whose
 * confirm must read identically to the X/Escape one). Retyping the string instead of importing it
 * lets the two silently diverge on a future copy edit.
 */
export const CONFIRM_CLOSE_MSG = 'Você tem alterações não salvas. Deseja fechar mesmo assim?';
export const CONFIRM_CLOSE_TITLE = 'Fechar sem salvar?';
export const CONFIRM_CLOSE_KEEP_EDITING = 'Continuar editando';
export const CONFIRM_CLOSE_DISCARD = 'Fechar mesmo assim';

/**
 * Holds the unsaved-work registry while a dirty dialog is on screen. Rendered inside the
 * Radix content on purpose: the DialogContent wrapper itself stays mounted (and keeps
 * rendering) while the dialog is closed, so a hook there would hold over an invisible form.
 */
function UnsavedWorkHold({ active }: { active: boolean }) {
  useUnsavedWork(active);
  return null;
}

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    /** Pass the close handler only when there are unsaved changes that need confirmation. */
    onConfirmClose?: () => void;
    /** When true, closing always prompts; when false/undefined, closes immediately. */
    confirmClose?: boolean;
    /** Extra classes for the overlay — e.g. a higher z-index when nested above a drawer. */
    overlayClassName?: string;
    /** `fullscreen` covers the viewport edge to edge with no built-in Close button (the
     *  caller renders its own, e.g. the agenda event editor). Defaults to the centered box. */
    layout?: 'default' | 'fullscreen';
    /**
     * Phones (below 768px inside the CRM shell): the dialog becomes a bottom sheet with a
     * grabber, swipe-down, Back and the X. `false` keeps the desktop box for a dialog that
     * must stay as it is. `fullscreen` dialogs never become sheets.
     */
    phoneSheet?: boolean;
    /** Sheet height on phones: `large` (default, nearly full) or `fit` (the content's own,
     *  capped at large) for short dialogs. */
    phoneDetent?: 'large' | 'fit';
  }
>(
  (
    {
      className,
      children,
      onConfirmClose,
      confirmClose,
      overlayClassName,
      layout = 'default',
      phoneSheet = true,
      phoneDetent = 'large',
      onInteractOutside,
      onEscapeKeyDown,
      onOpenAutoFocus,
      onCloseAutoFocus,
      style,
      ...props
    },
    ref,
  ) => {
    const [confirmOpen, setConfirmOpen] = React.useState(false);

    // Guard is active only when the caller says there are unsaved changes
    const isDirty = confirmClose === true;
    const fullscreen = layout === 'fullscreen';
    const { isPhone } = usePhoneLayout();
    const root = React.useContext(DialogRootContext);
    const phone = isPhone && phoneSheet && !fullscreen;
    const open = root?.open ?? false;
    const contentRef = React.useRef<HTMLDivElement | null>(null);
    const closeRef = React.useRef<HTMLButtonElement | null>(null);
    const returnFocus = useReturnFocus(phone && open);

    /**
     * Back and swipe-down close the way the X does: a click on it, which the unsaved-changes
     * guard can intercept. Returns `false` when it did (the prompt is now open).
     */
    const requestClose = React.useCallback((): void | boolean => {
      const button = closeRef.current;
      if (!button) return;
      const proceeded = button.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
      return proceeded ? undefined : false;
    }, []);
    const drag = useSheetDismissDrag(requestClose);

    const handleConfirmTrigger = React.useCallback(
      (e: { preventDefault: () => void }) => {
        if (isDirty && onConfirmClose) {
          e.preventDefault();
          setConfirmOpen(true);
        }
      },
      [isDirty, onConfirmClose],
    );

    const handleInteractOutside: React.ComponentPropsWithoutRef<
      typeof DialogPrimitive.Content
    >['onInteractOutside'] = (e) => {
      const target = e.target as Element | null;
      if (
        target?.closest('[data-radix-alert-dialog-overlay]') ||
        target?.closest('[role="alertdialog"]')
      ) {
        e.preventDefault();
        return;
      }
      if (isDirty && onConfirmClose) {
        handleConfirmTrigger(e);
      } else {
        onInteractOutside?.(e);
      }
    };
    const handleEscapeKeyDown: React.ComponentPropsWithoutRef<
      typeof DialogPrimitive.Content
    >['onEscapeKeyDown'] = (e) => {
      if (isDirty && onConfirmClose) {
        handleConfirmTrigger(e);
      } else {
        onEscapeKeyDown?.(e);
      }
    };

    const confirmDialog = onConfirmClose && (
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{CONFIRM_CLOSE_TITLE}</AlertDialogTitle>
            <AlertDialogDescription>{CONFIRM_CLOSE_MSG}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{CONFIRM_CLOSE_KEEP_EDITING}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false);
                onConfirmClose();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {CONFIRM_CLOSE_DISCARD}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );

    if (phone) {
      // Kit sheet look through CSS classes (style.css, "Dialog primitives as sheets"): the
      // caller's className stays for its own hooks, but `.phone-kit.phone-dialog` outranks
      // the utilities it may carry (max-w-*, w-[..], p-*, z-*), and inline `style` (desktop
      // widths) is dropped. The confirm renders after this portal, so at the same z-index
      // it sits on top.
      return (
        <>
          <DialogPortal>
            <DialogPrimitive.Overlay className="phone-kit phone-sheet-overlay phone-dialog-overlay" />
            <DialogPrimitive.Content
              ref={composeRefs(ref, contentRef)}
              className={cn('phone-kit phone-sheet phone-dialog', className)}
              data-detent={phoneDetent}
              data-dragging={drag.dragging || undefined}
              style={drag.dragY ? { transform: `translateY(${drag.dragY}px)` } : undefined}
              onInteractOutside={handleInteractOutside}
              onEscapeKeyDown={handleEscapeKeyDown}
              // Focus the sheet, not its first field: on iOS that would raise the keyboard
              // over a form the user hasn't touched yet.
              onOpenAutoFocus={(e) => {
                onOpenAutoFocus?.(e);
                if (e.defaultPrevented) return;
                e.preventDefault();
                contentRef.current?.focus();
              }}
              onCloseAutoFocus={(e) => {
                onCloseAutoFocus?.(e);
                if (!e.defaultPrevented) returnFocus(e);
              }}
              {...props}
            >
              <UnsavedWorkHold active={isDirty} />
              <div className="phone-dialog__grab" {...drag.handlers}>
                <span className="phone-sheet__grabber" aria-hidden="true" />
              </div>
              <DialogPrimitive.Close
                ref={closeRef}
                onClick={handleConfirmTrigger}
                className="phone-sheet__close phone-dialog__close"
                aria-label="Fechar"
              >
                <X aria-hidden="true" />
              </DialogPrimitive.Close>
              {/* `relative` and `data-dialog-scroll`: see the desktop wrapper below. */}
              <div className="phone-dialog__body" data-dialog-scroll>
                {children}
              </div>
            </DialogPrimitive.Content>
          </DialogPortal>
          {confirmDialog}
          <PhoneOverlayHistory open={open} onBack={requestClose} />
        </>
      );
    }

    return (
      <>
        <DialogPortal>
          <DialogOverlay className={overlayClassName} />
          <DialogPrimitive.Content
            ref={ref}
            data-slot="dialog-content"
            data-layout={fullscreen ? 'fullscreen' : 'default'}
            className={cn(
              fullscreen
                ? 'fixed inset-0 z-[9011] h-[100dvh] w-screen max-w-none overflow-hidden rounded-none border-0 bg-[var(--bg-color)] p-0 shadow-none duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0'
                : 'fixed left-[50%] top-[50%] z-[9011] w-full max-w-lg max-h-[85vh] overflow-hidden translate-x-[-50%] translate-y-[-50%] border bg-background shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg',
              className,
            )}
            onInteractOutside={handleInteractOutside}
            onEscapeKeyDown={handleEscapeKeyDown}
            onOpenAutoFocus={onOpenAutoFocus}
            onCloseAutoFocus={onCloseAutoFocus}
            style={style}
            {...props}
          >
            <UnsavedWorkHold active={isDirty} />
            {/*
             * `relative` is otherwise a no-op here (no top/left/right/bottom
             * is ever set on this div itself) -- it exists purely to make
             * this wrapper the containing block for a `position: absolute`
             * descendant. Without it, the browser still visually shifts an
             * absolutely-positioned descendant with THIS div's scroll (it's
             * the nearest scrolling ancestor) even while resolving its
             * top/left against a farther, non-scrolling containing block --
             * doubling any scroll-driven repositioning that JS also applies.
             * `data-dialog-scroll` gives such a descendant (see TourOverlay)
             * an unambiguous selector for this exact element.
             */}
            <div
              className={
                fullscreen
                  ? 'relative flex h-full flex-col'
                  : 'relative grid gap-4 p-6 overflow-y-auto max-h-[85vh]'
              }
              data-dialog-scroll
            >
              {children}
            </div>
            {!fullscreen && (
              <DialogPrimitive.Close
                onClick={handleConfirmTrigger}
                className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground"
              >
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </DialogPrimitive.Close>
            )}
          </DialogPrimitive.Content>
        </DialogPortal>

        {confirmDialog}
      </>
    );
  },
);
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    data-dialog-header=""
    className={cn('flex flex-col space-y-1.5 text-center sm:text-left', className)}
    {...props}
  />
);
DialogHeader.displayName = 'DialogHeader';

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    data-dialog-footer=""
    className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)}
    {...props}
  />
);
DialogFooter.displayName = 'DialogFooter';

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-xl font-bold leading-none tracking-[-0.05em]', className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
