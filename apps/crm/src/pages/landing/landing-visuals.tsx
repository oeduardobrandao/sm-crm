import { useEffect, useRef } from 'react';

const LID_SCROLL_RANGE = 320;
const LID_MIN_VIEWPORT = 981;

/** Hero device mockups for the landing page (dark renders). On desktop the
 * MacBook "opens" as the visitor scrolls: `--lp2-lid` goes 0 -> 1 over the
 * first LID_SCROLL_RANGE px and landing-v2.css maps it to a tilt. */
export function HeroDevicesDark() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const media = window.matchMedia(
      `(min-width: ${LID_MIN_VIEWPORT}px) and (prefers-reduced-motion: no-preference)`,
    );
    let raf = 0;
    const update = () => {
      raf = 0;
      if (!media.matches) {
        el.style.removeProperty('--lp2-lid');
        return;
      }
      // Measured from the element, not window.scrollY: the landing scrolls
      // inside body (overflow-y: auto), so window.scrollY is not reliable.
      const top = el.getBoundingClientRect().top;
      const travelled = window.innerHeight * 0.95 - top;
      const p = Math.min(1, Math.max(0, travelled / LID_SCROLL_RANGE));
      el.style.setProperty('--lp2-lid', p.toFixed(3));
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    // Capture phase: scroll events do not bubble, and the scroller is body.
    document.addEventListener('scroll', schedule, { passive: true, capture: true });
    window.addEventListener('resize', schedule);
    media.addEventListener('change', schedule);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      document.removeEventListener('scroll', schedule, { capture: true });
      window.removeEventListener('resize', schedule);
      media.removeEventListener('change', schedule);
    };
  }, []);
  return (
    <div className="lp2-hd" ref={ref}>
      <img
        className="lp2-hd-macbook"
        src="/landing/hero-macbook-dark.webp"
        width={1800}
        height={1087}
        alt="MacBook com o quadro de entregas do Mesaas: fluxos por etapa, do briefing à aprovação do cliente"
        loading="eager"
        fetchPriority="high"
        decoding="async"
      />
      <img
        className="lp2-hd-iphone"
        src="/landing/hero-iphone-dark.webp"
        width={560}
        height={1160}
        alt="iPhone com o Hub do cliente: aprovações pendentes e próximo post"
        loading="eager"
        decoding="async"
      />
    </div>
  );
}
