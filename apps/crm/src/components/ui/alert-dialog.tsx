import * as React from 'react';
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';
import { usePhoneLayout } from '@/components/layout/PhoneLayoutContext';
import { useReturnFocus } from '@/components/mobile/useReturnFocus';
import {
  PhoneOverlayHistory,
  composeRefs,
  useOverlayRootState,
  type OverlayRootState,
} from '@/components/ui/phone-overlay';

/** Open state of the root, so the content's phone face can register history. */
const AlertDialogRootContext = React.createContext<OverlayRootState | null>(null);

/**
 * Radix `AlertDialog.Root`, holding the open state itself (controlled or not) so
 * `AlertDialogContent` can read it. Same props and behaviour as the Radix root.
 */
function AlertDialog({
  open: openProp,
  defaultOpen,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof AlertDialogPrimitive.Root>) {
  const state = useOverlayRootState(openProp, defaultOpen, onOpenChange);
  return (
    <AlertDialogRootContext.Provider value={state}>
      <AlertDialogPrimitive.Root {...props} open={state.open} onOpenChange={state.onOpenChange} />
    </AlertDialogRootContext.Provider>
  );
}
const AlertDialogTrigger = AlertDialogPrimitive.Trigger;
const AlertDialogPortal = AlertDialogPrimitive.Portal;

const AlertDialogOverlay = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Overlay
    className={cn(
      'fixed inset-0 z-[9010] bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className,
    )}
    {...props}
    ref={ref}
  />
));
AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName;

/**
 * Cancel-like controls in a footer: `AlertDialogCancel`, or an outline `Button` some callers
 * use instead (it carries `border-input`). Back clicks the first one, so Back means Cancelar.
 */
const PHONE_CANCEL_SELECTOR = '[data-alert-cancel], [data-alert-footer] > [class*="border-input"]';

const AlertDialogContent = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content> & {
    /**
     * Phones (below 768px inside the CRM shell): the confirm becomes an iOS action sheet,
     * title and actions in one group, destructive actions in red, Cancelar apart below.
     * `false` keeps the centered box.
     */
    phoneSheet?: boolean;
  }
>(({ className, phoneSheet = true, style, onCloseAutoFocus, ...props }, ref) => {
  const { isPhone } = usePhoneLayout();
  const root = React.useContext(AlertDialogRootContext);
  const phone = isPhone && phoneSheet;
  const open = root?.open ?? false;
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const returnFocus = useReturnFocus(phone && open);

  const onBack = React.useCallback(() => {
    const cancel = contentRef.current?.querySelector<HTMLElement>(PHONE_CANCEL_SELECTOR);
    if (cancel) cancel.click();
    else root?.onOpenChange(false);
  }, [root]);

  if (phone) {
    // Styled by CSS classes (style.css, "Dialog primitives as sheets"); `.phone-kit.phone-alert`
    // outranks the caller's width utilities and inline `style` is dropped.
    return (
      <>
        <AlertDialogPortal>
          <AlertDialogPrimitive.Overlay className="phone-kit phone-sheet-overlay" />
          <AlertDialogPrimitive.Content
            ref={composeRefs(ref, contentRef)}
            className={cn('phone-kit phone-alert', className)}
            onCloseAutoFocus={(e) => {
              onCloseAutoFocus?.(e);
              if (!e.defaultPrevented) returnFocus(e);
            }}
            {...props}
          />
        </AlertDialogPortal>
        <PhoneOverlayHistory open={open} onBack={onBack} />
      </>
    );
  }

  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Content
        ref={ref}
        className={cn(
          'fixed left-[50%] top-[50%] z-[9011] grid w-[calc(100%-2rem)] max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] rounded-lg',
          className,
        )}
        style={style}
        onCloseAutoFocus={onCloseAutoFocus}
        {...props}
      />
    </AlertDialogPortal>
  );
});
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName;

const AlertDialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    data-alert-header=""
    className={cn('flex flex-col space-y-2 text-center sm:text-left', className)}
    {...props}
  />
);
AlertDialogHeader.displayName = 'AlertDialogHeader';

const AlertDialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    data-alert-footer=""
    className={cn('flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2', className)}
    {...props}
  />
);
AlertDialogFooter.displayName = 'AlertDialogFooter';

const AlertDialogTitle = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Title
    ref={ref}
    data-alert-title=""
    className={cn('text-lg font-semibold', className)}
    {...props}
  />
));
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName;

const AlertDialogDescription = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Description
    ref={ref}
    data-alert-description=""
    className={cn('text-sm text-muted-foreground', className)}
    {...props}
  />
));
AlertDialogDescription.displayName = AlertDialogPrimitive.Description.displayName;

const AlertDialogAction = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Action>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Action ref={ref} className={cn(buttonVariants(), className)} {...props} />
));
AlertDialogAction.displayName = AlertDialogPrimitive.Action.displayName;

const AlertDialogCancel = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Cancel>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Cancel
    ref={ref}
    data-alert-cancel=""
    className={cn(buttonVariants({ variant: 'outline' }), 'mt-2 sm:mt-0', className)}
    {...props}
  />
));
AlertDialogCancel.displayName = AlertDialogPrimitive.Cancel.displayName;

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
};
