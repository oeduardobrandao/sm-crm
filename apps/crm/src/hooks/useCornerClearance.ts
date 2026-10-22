import { useEffect, type RefObject } from 'react';

const VAR = '--corner-clearance';

/**
 * For a bar pinned to the bottom of the content (a chat composer): publishes how far
 * its top edge sits above the bottom of the viewport as `--corner-clearance` on
 * <html>, so the floating bottom-right corner (related articles, Guia pill, see
 * style.css) stacks above the bar instead of covering its send button. Tracks the
 * bar's growth (a multi-line draft, attachments) and window resizes; cleared on
 * unmount.
 */
export function useCornerClearance(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const update = () => {
      const clearance = Math.max(0, window.innerHeight - el.getBoundingClientRect().top);
      root.style.setProperty(VAR, `${Math.round(clearance)}px`);
    };
    update();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    observer?.observe(el);
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
      root.style.removeProperty(VAR);
    };
  }, [ref]);
}
