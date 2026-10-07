import { useLayoutEffect, useState, type RefObject } from 'react';

/** Below this the screen is too short for an inner-scrolling layout: the page
 *  scrolls as a whole again (the calendar keeps its fixed per-view height). */
const ALTURA_MINIMA = 520;

/**
 * Height from the element's top to the bottom of its scrolling `.main-content`
 * (minus that container's bottom padding), so the element fills the rest of the
 * screen and the page itself never scrolls. Google Calendar-style layout: the
 * Agenda sidebar and the time grid each scroll on their own.
 *
 * Measured against the element's position inside the scroller (scroll offset
 * included), so it is stable while the page is scrolled. `null` when disabled,
 * when there is no `.main-content` ancestor, or when the result would be under
 * ALTURA_MINIMA.
 */
export function useAlturaAteOFim(
  ref: RefObject<HTMLElement | null>,
  ativo: boolean,
): number | null {
  const [altura, setAltura] = useState<number | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    const scroller = el?.closest<HTMLElement>('.main-content');
    if (!ativo || !el || !scroller) {
      setAltura(null);
      return;
    }
    const medir = () => {
      const topo =
        el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      const paddingBaixo = parseFloat(getComputedStyle(scroller).paddingBottom) || 0;
      const h = Math.floor(scroller.clientHeight - topo - paddingBaixo);
      setAltura(h >= ALTURA_MINIMA ? h : null);
    };
    medir();
    // The scroller resizes with the window and with banners (--banner-height);
    // its first child resizes when the page header above the Agenda wraps.
    const ro = new ResizeObserver(medir);
    ro.observe(scroller);
    if (scroller.firstElementChild) ro.observe(scroller.firstElementChild);
    return () => ro.disconnect();
  }, [ref, ativo]);

  return altura;
}
