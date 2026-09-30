import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

const DESKTOP_QUERY = '(min-width: 768px)';
/** Below `md` the fixed HubMobileNav owns the top 70px (its in-flow spacer is h-[70px]). */
const MOBILE_TOP = 70;
const DESKTOP_TOP = 12;

function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(DESKTOP_QUERY).matches
      : true,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => setDesktop(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return desktop;
}

/**
 * Postagens filter row that detaches into a floating, blurred card once the page scrolls
 * past it, in the style of HubMobileNav and the CRM report editor header.
 *
 * Deliberately `fixed`, not `sticky`: main.tsx pulls in the CRM's global stylesheet, whose
 * `overflow-x: hidden` on #root turns #root into a scroll container as tall as its content,
 * so a sticky descendant never sticks. One DOM instance toggles to `fixed` (instead of a
 * portalled copy) so focus survives the flip; that needs every ancestor to be free of
 * transforms, which is why the page keeps `.hub-fade-up` off this bar's ancestors and puts it
 * on the bar itself (an element's own transform does not trap its own `fixed` box).
 *
 * The in-flow slot keeps the bar's height while it floats, and its measured rect gives the
 * floating bar the content column's left edge and width. Padding and border are constant
 * (transparent at rest) so the flip never shifts layout. The sentinel's rootMargin matches
 * the floating `top`, so the flip happens exactly when the bar would scroll under it. jsdom
 * has no IntersectionObserver: there the bar simply stays in flow.
 */
export function FloatingFilterBar({ children }: { children: ReactNode }) {
  const sentinelRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const top = useIsDesktop() ? DESKTOP_TOP : MOBILE_TOP;
  const [stuck, setStuck] = useState(false);
  const [box, setBox] = useState<{ left: number; width: number } | null>(null);
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      ([entry]) =>
        // Leaving through the BOTTOM of the viewport is not "scrolled past".
        setStuck(!entry.isIntersecting && entry.boundingClientRect.top < top),
      { rootMargin: `-${top}px 0px 0px 0px` },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [top]);

  useLayoutEffect(() => {
    const slot = slotRef.current;
    const bar = barRef.current;
    if (!slot || !bar) return;
    const measure = () => {
      const r = slot.getBoundingClientRect();
      setBox({ left: r.left, width: r.width });
      setHeight(bar.offsetHeight);
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(slot);
    ro?.observe(bar);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  const floating = stuck && box !== null;

  return (
    <>
      <div ref={sentinelRef} aria-hidden="true" className="h-px -mb-px" />
      <div
        ref={slotRef}
        className="-mx-2 mb-4"
        style={floating && height !== null ? { height } : undefined}
      >
        <div
          ref={barRef}
          data-floating={floating || undefined}
          className={`hub-fade-up rounded-2xl border px-2 py-2 transition-[background-color,border-color,box-shadow] duration-200 ${
            floating
              ? 'hub-border shadow-[0_10px_30px_-12px_rgba(0,0,0,.35)]'
              : 'border-transparent'
          }`}
          style={
            floating
              ? {
                  position: 'fixed',
                  top,
                  left: box.left,
                  width: box.width,
                  zIndex: 15,
                  background: 'color-mix(in srgb, var(--hub-card) 80%, transparent)',
                  backdropFilter: 'saturate(180%) blur(14px)',
                  WebkitBackdropFilter: 'saturate(180%) blur(14px)',
                }
              : undefined
          }
        >
          {/* One scrolling row on phones so the floating card never eats half the screen;
              wraps from lg up, where the whole set fits on one line. */}
          <div className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:flex-wrap lg:overflow-visible">
            {children}
          </div>
        </div>
      </div>
    </>
  );
}
