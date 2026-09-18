import type { ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';

export type HubDialogCloseReason = 'escape' | 'outside' | 'button';

interface HubDialogProps {
  open: boolean;
  /** The caller owns `open`; this only reports intent so it can guard with a confirm. */
  onRequestClose: (reason: HubDialogCloseReason) => void;
  /** Accessible name (rendered sr-only). */
  title: string;
  children: ReactNode;
  className?: string;
  overlayClassName?: string;
}

/**
 * The Hub's one modal primitive: Radix Dialog with focus trap, scroll lock and
 * focus restore. It portals INTO `.hub-root`, not document.body: index.html scopes
 * every hub-* rule as `.hub-root .hub-*` and useTheme sets data-theme="dark" on
 * `.hub-root`, so a body portal would render unstyled and always light (same
 * reason IdeiasPage's modal portals there). `.hub-root` has no transform, so
 * position:fixed inside it is viewport-relative. `z-[9000]` keeps it under
 * PostMediaLightbox (`z-[9005]`) so the lightbox can open on top of it.
 */
export function HubDialog({
  open,
  onRequestClose,
  title,
  children,
  className = '',
  overlayClassName = '',
}: HubDialogProps) {
  const container =
    typeof document !== 'undefined'
      ? (document.querySelector<HTMLElement>('.hub-root') ?? document.body)
      : undefined;
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onRequestClose('button')}>
      <Dialog.Portal container={container}>
        <Dialog.Overlay
          className={`fixed inset-0 z-[9000] bg-black/70 backdrop-blur-sm ${overlayClassName}`}
        />
        <Dialog.Content
          onEscapeKeyDown={(e) => {
            e.preventDefault();
            onRequestClose('escape');
          }}
          // Content is fixed inset-0, so it IS the scrim: Radix's "outside" events
          // never fire. Swallow them and detect scrim clicks on the wrapper below.
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          className={`fixed inset-0 z-[9000] focus:outline-none ${className}`}
        >
          <Dialog.Title className="sr-only">{title}</Dialog.Title>
          <Dialog.Description className="sr-only">{title}</Dialog.Description>
          <div
            data-testid="hub-dialog-scrim"
            className="w-full h-full flex items-center justify-center p-0 md:p-6"
            onClick={(e) => {
              if (e.target === e.currentTarget) onRequestClose('outside');
            }}
          >
            {children}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
