import { useState, useRef, useEffect, type ImgHTMLAttributes } from 'react';

export interface OptimizedImageProps extends Omit<
  ImgHTMLAttributes<HTMLImageElement>,
  'srcSet' | 'loading' | 'decoding'
> {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  sizes?: string;
  /** When true, loads eagerly with fetchpriority=high and injects a preload link */
  priority?: boolean;
  /** Base64 data URL for blur-up placeholder */
  blurDataURL?: string;
}

export function OptimizedImage({
  src,
  alt,
  width,
  height,
  sizes,
  priority = false,
  blurDataURL,
  className,
  style,
  ...rest
}: OptimizedImageProps) {
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (imgRef.current?.complete) setLoaded(true);
  }, []);

  useEffect(() => {
    if (!priority || !src) return;
    const link = document.createElement('link');
    link.rel = 'preload';
    link.setAttribute('as', 'image');
    link.href = src;
    link.setAttribute('fetchpriority', 'high');
    if (sizes) link.setAttribute('imagesizes', sizes);
    document.head.appendChild(link);
    return () => {
      link.remove();
    };
  }, [priority, src, sizes]);

  const blurStyle: React.CSSProperties | undefined = blurDataURL
    ? {
        backgroundImage: `url(${blurDataURL})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }
    : undefined;

  const mergedStyle: React.CSSProperties = {
    ...blurStyle,
    ...style,
    ...(blurDataURL && !loaded ? { color: 'transparent' } : {}),
  };

  const imgProps: ImgHTMLAttributes<HTMLImageElement> & Record<string, unknown> = {
    ref: imgRef,
    src,
    alt,
    className,
    style: mergedStyle,
    onLoad: () => setLoaded(true),
    loading: priority ? 'eager' : 'lazy',
    decoding: priority ? 'sync' : 'async',
    ...(priority ? { fetchPriority: 'high' } : {}),
    ...(width != null ? { width } : {}),
    ...(height != null ? { height } : {}),
    ...(sizes ? { sizes } : {}),
    ...rest,
  };

  return <img {...imgProps} />;
}
