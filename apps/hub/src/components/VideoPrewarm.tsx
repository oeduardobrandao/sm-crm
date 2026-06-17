import { useEffect, useRef, useState } from 'react';

interface VideoPrewarmProps {
  /** Master video URL to warm. Pass null to render nothing. */
  src: string | null | undefined;
}

/**
 * Warms a video so click-to-play starts smoothly. Renders a 1px, visually
 * hidden <video> as its own viewport sentinel; once it nears the viewport it
 * sets `src` with `preload="metadata"`, which makes the browser fetch the
 * container header/index (for non-faststart .mov files this includes the
 * end-of-file moov round-trip) ahead of time. The bytes land in the HTTP cache
 * (the media worker serves them `immutable`), so when the lightbox opens the
 * same URL it starts without the initial stutter / A-V desync.
 *
 * Only warms metadata — never downloads the whole file — so warming many cards
 * on a list page stays cheap.
 */
export function VideoPrewarm({ src }: VideoPrewarmProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const [warm, setWarm] = useState(false);

  useEffect(() => {
    if (warm || !src) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setWarm(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setWarm(true);
      },
      // Warm a little before the card scrolls into view.
      { rootMargin: '400px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [warm, src]);

  if (!src) return null;

  return (
    <video
      ref={ref}
      src={warm ? src : undefined}
      preload={warm ? 'metadata' : 'none'}
      muted
      playsInline
      tabIndex={-1}
      aria-hidden
      // Present in layout (so the sentinel has a position to observe) but
      // visually inert.
      style={{
        position: 'absolute',
        width: 1,
        height: 1,
        top: 0,
        left: 0,
        opacity: 0,
        pointerEvents: 'none',
      }}
    />
  );
}
