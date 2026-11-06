import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useOverlayHistoryEntry } from '@/hooks/useOverlayHistoryEntry';

/** The phone shell's scroll container (`.main-content` scrolls, not the window). */
function scroller(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.main-content');
}

/**
 * An in-page pushed screen of a Configurações tab (a role, a member, a Hub section):
 * the tab keeps its state and renders the sub-screen in place of its list while
 * `screen` is set. Opening registers a history entry, so Back (the nav bar's, the
 * browser's, the iOS edge swipe) returns to the list; the list's scroll position comes
 * back with it. No route and no dialog: nothing stays mounted while it's closed.
 *
 * One hook per level. Switching from one screen to another of the same level keeps the
 * entry (`open` stays true); a second level needs its own hook.
 */
export function useConfigSubScreen<T>() {
  const [screen, setScreen] = useState<T | null>(null);
  const savedScroll = useRef(0);
  const wasOpen = useRef(false);

  const close = useCallback(() => setScreen(null), []);
  useOverlayHistoryEntry(screen !== null, close);

  const open = useCallback((next: T) => {
    if (!wasOpen.current) savedScroll.current = scroller()?.scrollTop ?? 0;
    setScreen(next);
  }, []);

  const isOpen = screen !== null;
  useLayoutEffect(() => {
    if (isOpen === wasOpen.current) return;
    wasOpen.current = isOpen;
    const el = scroller();
    if (!el) return;
    el.scrollTop = isOpen ? 0 : savedScroll.current;
  }, [isOpen]);

  return { screen, open, close };
}
