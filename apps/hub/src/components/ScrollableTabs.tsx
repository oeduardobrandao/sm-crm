import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/** Sub-pixel rounding slack when comparing scrollLeft against the scroll extents. */
const EDGE_TOLERANCE = 2;
/** Breathing room kept between the active tab and the faded edge. */
const ACTIVE_TAB_PADDING = 28;

/**
 * Scroll to `left`, smoothly where that is supported. Not every engine honours
 * smooth programmatic scrolling — some drop the scroll entirely rather than
 * jumping — so if nothing has moved two frames later, snap there instead.
 * `onSettled` re-reads the edges, for engines that skip the `scroll` event too.
 */
function scrollHorizontallyTo(el: HTMLElement, left: number, onSettled: () => void) {
  const target = Math.max(0, Math.min(left, el.scrollWidth - el.clientWidth));
  const from = el.scrollLeft;
  if (from === target) return;
  if (typeof el.scrollTo === 'function') el.scrollTo({ left: target, behavior: 'smooth' });
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (el.scrollLeft === from) el.scrollLeft = target;
      onSettled();
    }),
  );
}

/**
 * Horizontal tab strip that tells the reader there is more to see: the
 * overflowing side gets a gradient fade, and pointer devices also get a chevron
 * button to scroll. Tabs marked `data-active="true"` are kept in view.
 */
export function ScrollableTabs({
  children,
  label,
  activeKey,
  className = '',
}: {
  children: ReactNode;
  label: string;
  /** Changes to this value scroll the `data-active` tab back into view. */
  activeKey?: string | number;
  className?: string;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const sync = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setCanScrollLeft(el.scrollLeft > EDGE_TOLERANCE);
    setCanScrollRight(el.scrollLeft < max - EDGE_TOLERANCE);
  }, []);

  // Re-measure when either the viewport or the tab row itself changes width.
  useEffect(() => {
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(scroller);
    ro.observe(content);
    return () => ro.disconnect();
  }, [sync]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    const active = scroller?.querySelector<HTMLElement>('[data-active="true"]');
    if (!scroller || !active) return;
    const a = active.getBoundingClientRect();
    const s = scroller.getBoundingClientRect();
    const from = scroller.scrollLeft;
    if (a.left < s.left + ACTIVE_TAB_PADDING) {
      scrollHorizontallyTo(scroller, from + a.left - s.left - ACTIVE_TAB_PADDING, sync);
    } else if (a.right > s.right - ACTIVE_TAB_PADDING) {
      scrollHorizontallyTo(scroller, from + a.right - s.right + ACTIVE_TAB_PADDING, sync);
    }
  }, [activeKey, sync]);

  function scrollByPage(direction: -1 | 1) {
    const el = scrollerRef.current;
    if (!el) return;
    scrollHorizontallyTo(el, el.scrollLeft + direction * el.clientWidth * 0.75, sync);
  }

  return (
    <div className={`relative ${className}`}>
      <div
        ref={scrollerRef}
        onScroll={sync}
        role="tablist"
        aria-label={label}
        className="overflow-x-auto no-scrollbar border-b hub-border"
      >
        <div ref={contentRef} className="flex gap-1 w-max">
          {children}
        </div>
      </div>

      {canScrollLeft && <span className="hub-tabs-fade hub-tabs-fade-left" aria-hidden="true" />}
      {canScrollRight && <span className="hub-tabs-fade hub-tabs-fade-right" aria-hidden="true" />}

      {canScrollLeft && (
        <ScrollButton side="left" label="Ver seções anteriores" onClick={() => scrollByPage(-1)} />
      )}
      {canScrollRight && (
        <ScrollButton side="right" label="Ver mais seções" onClick={() => scrollByPage(1)} />
      )}
    </div>
  );
}

function ScrollButton({
  side,
  label,
  onClick,
}: {
  side: 'left' | 'right';
  label: string;
  onClick: () => void;
}) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={label}
      onClick={onClick}
      className={`hub-tabs-arrow ${side === 'left' ? 'hub-tabs-arrow-left' : 'hub-tabs-arrow-right'}`}
    >
      <Icon size={15} strokeWidth={2.25} />
    </button>
  );
}
