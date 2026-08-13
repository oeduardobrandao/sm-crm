import { useEffect, useRef, useState } from 'react';
import type { VideoHTMLAttributes } from 'react';

// Shared across the CRM and Hub apps as '@mesaas/ui/VideoPlayer' (see the
// standalone-file pattern documented at the top of packages/ui/index.ts —
// this package intentionally does not use '@/' imports and is never added to
// that barrel).
//
// Plays a Cloudflare Stream HLS manifest when the browser can, falling back
// to a progressive MP4 (the media-proxy URL) when it can't:
//   - Safari/iOS play HLS natively via <video src>, no library needed.
//   - Everywhere else, hls.js is loaded on demand (only when actually needed)
//     and feeds the manifest through Media Source Extensions.
//   - A fatal hls.js error, or an error on the fallback <video> itself, is
//     the two ways this can end up unplayable; only the latter reports
//     onFatalError, since the former still has a fallback left to try.
export interface VideoPlayerProps extends Omit<
  VideoHTMLAttributes<HTMLVideoElement>,
  'src' | 'onError'
> {
  /** Tokenized HLS manifest URL. Absent = plain progressive video, no hls.js involved. */
  hlsSrc?: string | null;
  /** Progressive fallback (current media-proxy URL). Always required. */
  src: string;
  poster?: string;
  /** Fires only when the FALLBACK source also errors -- i.e. nothing left to try. */
  onFatalError?: () => void;
}

type Mode = 'native-hls' | 'hlsjs' | 'fallback';

export function VideoPlayer({ hlsSrc, src, poster, onFatalError, ...rest }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [mode, setMode] = useState<Mode>(() => {
    if (!hlsSrc) return 'fallback';
    const probe = document.createElement('video');
    return probe.canPlayType('application/vnd.apple.mpegurl') ? 'native-hls' : 'hlsjs';
  });

  useEffect(() => {
    if (mode !== 'hlsjs' || !hlsSrc) return;
    const el = videoRef.current;
    if (!el) return;
    let hls: { destroy(): void } | null = null;
    let cancelled = false;
    import('hls.js')
      .then(({ default: Hls }) => {
        if (cancelled) return;
        if (!Hls.isSupported()) {
          setMode('fallback');
          return;
        }
        const instance = new Hls();
        hls = instance;
        instance.on(Hls.Events.ERROR, (_evt: string, data: { fatal: boolean }) => {
          if (data.fatal) {
            instance.destroy();
            hls = null;
            setMode('fallback');
          }
        });
        instance.loadSource(hlsSrc);
        instance.attachMedia(el);
      })
      .catch(() => {
        if (!cancelled) setMode('fallback');
      });
    return () => {
      cancelled = true;
      hls?.destroy();
    };
  }, [mode, hlsSrc]);

  return (
    <video
      key={mode}
      ref={videoRef}
      src={mode === 'hlsjs' ? undefined : mode === 'native-hls' ? (hlsSrc ?? src) : src}
      poster={poster}
      onError={() => {
        if (mode === 'fallback') onFatalError?.();
        else setMode('fallback');
      }}
      {...rest}
    />
  );
}
