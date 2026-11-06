import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { useSheetHistory } from '@/components/mobile/useSheetHistory';

export interface PhoneEditorScreenApi {
  /** Closes the screen (pops its history entry). */
  close: () => void;
  /**
   * Closes the screen and runs `fn` once its history entry is gone. For actions whose
   * outcome can close the drawer underneath or swap the post (Mover, Desmembrar,
   * Anexar a fluxo): run them over the drawer, not over a screen that is about to go.
   */
  closeThen: (fn: () => void) => void;
}

const PhoneEditorScreenContext = createContext<PhoneEditorScreenApi | null>(null);

/** Inside a `PhoneEditorScreen`: close it, optionally then run an action. */
export function usePhoneEditorScreen(): PhoneEditorScreenApi | null {
  return useContext(PhoneEditorScreenContext);
}

export interface PhoneEditorScreenProps {
  /** Mount it once per host and toggle this: the history entry is popped on close only
   *  while the component is still mounted (useOverlayHistoryEntry never pops on unmount). */
  open: boolean;
  onClose: () => void;
  /** Accessible name of the screen ("Editor do post"). */
  label: string;
  /**
   * Push a history entry of its own. False where the host already owns one for the same
   * layer: on phones StandalonePostDrawer IS this screen, and EntregasPage's drawer
   * entry already covers it.
   */
  historyEntry?: boolean;
  className?: string;
  /** Lets the host reach `closeThen` from callbacks it builds outside the screen. */
  apiRef?: MutableRefObject<PhoneEditorScreenApi | null>;
  children: ReactNode;
}

/**
 * Full-screen pushed screen for the post editor on phones (D21). Portaled to the body
 * above the drawer (z 9003: above `.drawer-panel` 9001, below the kit sheets, menus and
 * dialogs at 9010+, which therefore stack over it).
 *
 * Deliberately not a `role="dialog"`: the editor can stay open for a long editing
 * session, and `isDocumentBusy` (silent deploy swaps) treats any open dialog as unsaved
 * work. The real unsaved state is registered by the editor itself (caption drafts,
 * content saves), exactly as on desktop.
 *
 * History: the entry is armed one commit after `open` turns true. A `?post=` deep link
 * opens the drawer and this screen in the same commit, and child effects run before the
 * page's: pushing right away would put this entry UNDER the drawer's, so Back would close
 * the drawer and strand this one.
 */
export function PhoneEditorScreen({
  open,
  onClose,
  label,
  historyEntry = true,
  className,
  apiRef,
  children,
}: PhoneEditorScreenProps) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    setArmed(open);
  }, [open]);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const close = useCallback(() => onCloseRef.current(), []);
  const { closeThen } = useSheetHistory(historyEntry && armed, close);
  const api = useRef<PhoneEditorScreenApi>({ close, closeThen });
  api.current.closeThen = closeThen;
  if (apiRef) apiRef.current = api.current;

  const rootRef = useRef<HTMLDivElement>(null);
  // Focus the screen when it opens, so a screen reader starts at its heading and Tab
  // doesn't wander through the drawer underneath. Where focus was before is restored
  // on close.
  const openerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    openerRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
    rootRef.current?.focus({ preventScroll: true });
    return () => {
      const opener = openerRef.current;
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <PhoneEditorScreenContext.Provider value={api.current}>
      <div
        ref={rootRef}
        role="region"
        aria-label={label}
        tabIndex={-1}
        className={cn('phone-kit phone-editor-screen', className)}
        data-testid="phone-editor-screen"
      >
        {children}
      </div>
    </PhoneEditorScreenContext.Provider>,
    document.body,
  );
}
