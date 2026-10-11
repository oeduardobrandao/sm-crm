import {
  Fragment,
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '@/lib/utils';
import { useLongPress } from './useLongPress';
import { useSheetHistory } from './useSheetHistory';
import { SheetActionsContext } from './sheetActions';
import { rovingIndex } from './roving';

export interface ContextMenuAction {
  label: ReactNode;
  onSelect: () => void;
  icon?: ReactNode;
  destructive?: boolean;
  disabled?: boolean;
  /**
   * Run `onSelect` inside the tap, then close, instead of after the menu's history entry
   * is popped. For actions that need the user gesture itself (opening a file in a new
   * tab, a file picker, `window.open` for an external link) and never navigate in-app. Same
   * as `ActionSheetAction.immediate`.
   */
  immediate?: boolean;
}

export interface ContextMenuTriggerProps {
  ref: Ref<HTMLButtonElement>;
  type: 'button';
  'aria-haspopup': 'menu';
  'aria-expanded': boolean;
  onClick: () => void;
}

export interface ContextMenuProps {
  /** Accessible name of the menu ("Ações do fluxo"). Also the dialog title, visually hidden. */
  label: string;
  /** Groups of actions; a thick separator sits between groups. */
  sections: ContextMenuAction[][];
  /** Lifted copy of the target shown above the menu (a compact card). Decorative. */
  preview?: ReactNode;
  /**
   * The hold target. Pass a function to also get props for an explicit "…" trigger,
   * the way keyboard and screen-reader users reach the menu.
   */
  children: ReactNode | ((api: { triggerProps: ContextMenuTriggerProps }) => ReactNode);
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  /** Classes for the wrapper around the hold target. */
  className?: string;
}

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Long-press menu with a lifted preview, from the EntregasCardMenu mockup.
 *
 * Opens on a ~450ms hold (cancelled by moving more than 8px, so scrolling over the
 * target still scrolls), on right-click, on the ContextMenu key / Shift+F10 while the
 * target has focus, and from an explicit trigger. On phones this is the only thing a
 * hold does: drag lives on handles or a "Reordenar" mode (D20).
 */
export function ContextMenu({
  label,
  sections,
  preview,
  children,
  open: openProp,
  onOpenChange,
  disabled,
  className,
}: ContextMenuProps) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = useCallback(
    (next: boolean) => {
      if (openProp === undefined) setOpenState(next);
      onOpenChange?.(next);
    },
    [openProp, onOpenChange],
  );
  const close = useCallback(() => setOpen(false), [setOpen]);
  const { closeThen } = useSheetHistory(open, close);
  const actions = useMemo(() => ({ close, closeThen }), [close, closeThen]);

  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const openMenu = useCallback(() => {
    if (disabled) return;
    const active = document.activeElement;
    openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
    setOpen(true);
  }, [disabled, setOpen]);

  const bind = useLongPress({ onLongPress: openMenu, disabled });

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault();
      openMenu();
    }
  };

  const triggerProps: ContextMenuTriggerProps = {
    ref: triggerRef,
    type: 'button',
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    onClick: openMenu,
  };

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ??
        [],
    );
    if (items.length === 0) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = rovingIndex(e, current < 0 ? 0 : current, items.length, 'vertical');
    if (next === null) return;
    e.preventDefault();
    items[current < 0 && e.key === 'ArrowDown' ? 0 : next]?.focus();
  };

  return (
    <>
      <div
        ref={wrapperRef}
        className={cn('phone-hold-target', className)}
        onKeyDown={onKeyDown}
        {...bind}
      >
        {typeof children === 'function' ? children({ triggerProps }) : children}
      </div>
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="phone-kit phone-menu-overlay" />
          <DialogPrimitive.Content
            className="phone-kit phone-context-menu"
            aria-describedby={undefined}
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              const target =
                (triggerRef.current?.isConnected && triggerRef.current) ||
                (openerRef.current?.isConnected && openerRef.current) ||
                wrapperRef.current?.querySelector<HTMLElement>(FOCUSABLE);
              target?.focus();
            }}
            onClick={(e) => {
              // Taps on the blurred backdrop or the preview dismiss, like iOS.
              if (!(e.target as HTMLElement).closest('[role="menu"]')) close();
            }}
          >
            <DialogPrimitive.Title className="sr-only">{label}</DialogPrimitive.Title>
            {preview && (
              <div className="phone-context-menu__preview" aria-hidden="true">
                {preview}
              </div>
            )}
            <div
              ref={menuRef}
              role="menu"
              aria-label={label}
              aria-orientation="vertical"
              className="phone-context-menu__list"
              onKeyDown={onMenuKeyDown}
            >
              <SheetActionsContext.Provider value={actions}>
                {sections.map((section, s) => (
                  <Fragment key={s}>
                    {s > 0 && <div role="separator" className="phone-context-menu__separator" />}
                    {section.map((action, i) => (
                      <button
                        key={i}
                        type="button"
                        role="menuitem"
                        disabled={action.disabled}
                        className={cn(
                          'phone-context-menu__item',
                          action.destructive && 'phone-context-menu__item--destructive',
                        )}
                        onClick={() => {
                          if (action.immediate) {
                            action.onSelect();
                            close();
                          } else {
                            closeThen(action.onSelect);
                          }
                        }}
                      >
                        <span>{action.label}</span>
                        {action.icon && (
                          <span className="phone-context-menu__icon" aria-hidden="true">
                            {action.icon}
                          </span>
                        )}
                      </button>
                    ))}
                  </Fragment>
                ))}
              </SheetActionsContext.Provider>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
