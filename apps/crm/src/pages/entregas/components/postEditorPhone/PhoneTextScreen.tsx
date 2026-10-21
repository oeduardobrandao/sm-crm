import { createContext, useCallback, useContext, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useSheetHistory } from '@/components/mobile/useSheetHistory';
import { useVisualViewportBox } from './useVisualViewportBox';

/** True inside an open full-screen text editor (the phone format bar only shows there). */
const PhoneTextScreenContext = createContext(false);
export function usePhoneTextScreenOpen(): boolean {
  return useContext(PhoneTextScreenContext);
}

interface PhoneTextScreenProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Header title ("Roteiro e briefing", "Legenda do Instagram"). */
  title: string;
  /** Closed: render nothing visible (the Roteiro editor, reached from its row) instead of
   *  the field inline (captions). Either way the children stay mounted. */
  hiddenWhenClosed?: boolean;
  /** Next to "OK" (a character count). */
  headerExtra?: ReactNode;
  children: ReactNode;
}

/**
 * Full-screen text editing (EditorTexto mockup) WITHOUT remounting the editor: the same
 * DOM node is restyled into a fixed layer pinned to the visual viewport, so a TipTap
 * instance or a caption draft (and its pending debounced save) survives open and close,
 * and focus survives the switch. Opening pushes a history entry: Back closes the text
 * screen, not the post.
 */
export function PhoneTextScreen({
  open,
  onOpenChange,
  title,
  hiddenWhenClosed = false,
  headerExtra,
  children,
}: PhoneTextScreenProps) {
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  useSheetHistory(open, close);
  const box = useVisualViewportBox(open);

  return (
    <div
      className={cn(
        'phone-text-screen',
        open && 'phone-text-screen--open',
        !open && hiddenWhenClosed && 'phone-text-screen--hidden',
      )}
      style={open && box ? { top: box.top, height: box.height, bottom: 'auto' } : undefined}
      role={open ? 'group' : undefined}
      aria-label={open ? title : undefined}
    >
      {open && (
        <div className="phone-text-screen__header">
          <span className="phone-text-screen__title">{title}</span>
          <span className="phone-text-screen__extra">{headerExtra}</span>
          <button
            type="button"
            className="phone-text-screen__done"
            // Blur first so iOS drops the keyboard together with the screen.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              (document.activeElement as HTMLElement | null)?.blur?.();
              close();
            }}
          >
            OK
          </button>
        </div>
      )}
      <div className="phone-text-screen__body">
        <PhoneTextScreenContext.Provider value={open}>{children}</PhoneTextScreenContext.Provider>
      </div>
    </div>
  );
}
