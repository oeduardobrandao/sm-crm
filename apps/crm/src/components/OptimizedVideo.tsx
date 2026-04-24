import { useEffect, type VideoHTMLAttributes } from 'react';

export interface OptimizedVideoProps
  extends Omit<VideoHTMLAttributes<HTMLVideoElement>, 'preload'> {
  src: string;
  poster?: string;
  preload?: 'none' | 'metadata' | 'auto';
}

export function OptimizedVideo({
  src,
  poster,
  preload = 'metadata',
  ...rest
}: OptimizedVideoProps) {
  useEffect(() => {
    if (import.meta.env.DEV && !poster) {
      console.warn('[OptimizedVideo] Missing poster prop — provide a poster image for better perceived performance.');
    }
  }, [poster]);

  return (
    <video
      src={src}
      poster={poster}
      preload={preload}
      {...rest}
    />
  );
}
