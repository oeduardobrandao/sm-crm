import { useEffect, useRef } from 'react';

const LID_SCROLL_RANGE = 320;

/* srcset/sizes mirror landing-v2.css: .lp2-hd is min(100%, 1140px) of the
 * .lp-container content box (20px gutters <=720px, 28px above, 1200px max),
 * and the iPhone is 25% of it <=980px, 20% above. Keep in sync with the
 * <link rel="preload" imagesrcset> in the prerendered HTML. */
export const HERO_MACBOOK_SRCSET =
  '/landing/hero-macbook-dark-760w.webp 760w, /landing/hero-macbook-dark-1200w.webp 1200w, /landing/hero-macbook-dark.webp 1800w';
export const HERO_MACBOOK_SIZES =
  '(max-width: 720px) calc(100vw - 40px), (max-width: 1196px) calc(100vw - 56px), 1140px';
const HERO_IPHONE_SRCSET =
  '/landing/hero-iphone-dark-280w.webp 280w, /landing/hero-iphone-dark-420w.webp 420w, /landing/hero-iphone-dark.webp 560w';
const HERO_IPHONE_SIZES =
  '(max-width: 720px) calc(25vw - 10px), (max-width: 980px) calc(25vw - 14px), (max-width: 1196px) calc(20vw - 11px), 228px';
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
        srcSet={HERO_MACBOOK_SRCSET}
        sizes={HERO_MACBOOK_SIZES}
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
        srcSet={HERO_IPHONE_SRCSET}
        sizes={HERO_IPHONE_SIZES}
        width={560}
        height={1160}
        alt="iPhone com o Hub do cliente: aprovações pendentes e próximo post"
        loading="eager"
        decoding="async"
      />
    </div>
  );
}
