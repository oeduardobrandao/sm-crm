import { useState, useRef, useEffect, useMemo, type ImgHTMLAttributes } from 'react';

const DEFAULT_WIDTHS = [400, 800, 1200, 1600, 2400];

export interface OptimizedImageProps
  extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'srcSet' | 'loading' | 'decoding'> {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  sizes?: string;
  /** When true, loads eagerly with fetchpriority=high and injects a preload link */
  priority?: boolean;
  /** Base64 data URL for blur-up placeholder */
  blurDataURL?: string;
  /** Image fit mode appended to transform URL */
  fit?: 'cover' | 'contain' | 'scale-down';
}

function isMediaProxyUrl(src: string): boolean {
  try {
    const url = new URL(src);
    return url.searchParams.has('sig') && url.searchParams.has('exp');
  } catch {
    return false;
  }
}

export function buildSrcSet(
  src: string,
  widths: number[],
  sourceWidth?: number,
): string {
  if (!isMediaProxyUrl(src)) return '';
  let applicable = sourceWidth
    ? widths.filter(w => w < sourceWidth)
    : widths;
  if (sourceWidth && !applicable.includes(sourceWidth)) {
    applicable = [...applicable, sourceWidth];
  }
  if (applicable.length === 0) return '';
  return applicable
    .map(w => {
      const sep = src.includes('?') ? '&' : '?';
      return `${src}${sep}w=${w} ${w}w`;
    })
    .join(', ');
}

export function buildFormatSource(
  src: string,
  format: 'avif' | 'webp',
  widths: number[],
  sourceWidth?: number,
): string {
  if (!isMediaProxyUrl(src)) return '';
  let applicable = sourceWidth
    ? widths.filter(w => w < sourceWidth)
    : widths;
  if (sourceWidth && !applicable.includes(sourceWidth)) {
    applicable = [...applicable, sourceWidth];
  }
  if (applicable.length === 0) return '';
  return applicable
    .map(w => {
      const sep = src.includes('?') ? '&' : '?';
      return `${src}${sep}w=${w}&f=${format} ${w}w`;
    })
    .join(', ');
}

export function OptimizedImage({
  src,
  alt,
  width,
  height,
  sizes,
  priority = false,
  blurDataURL,
  fit,
  className,
  style,
  ...rest
}: OptimizedImageProps) {
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const preloadInjected = useRef(false);

  useEffect(() => {
    if (imgRef.current?.complete) setLoaded(true);
  }, []);

  useEffect(() => {
    if (!priority || preloadInjected.current || !src) return;
    preloadInjected.current = true;
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.href = src;
    link.setAttribute('fetchpriority', 'high');
    const srcSet = buildSrcSet(src, DEFAULT_WIDTHS, width ?? undefined);
    if (srcSet) link.setAttribute('imagesrcset', srcSet);
    if (sizes) link.setAttribute('imagesizes', sizes);
    document.head.appendChild(link);
    return () => { link.remove(); };
  }, [priority, src, width, sizes]);

  const srcSet = useMemo(() => buildSrcSet(src, DEFAULT_WIDTHS, width ?? undefined), [src, width]);

  const avifSrcSet = useMemo(
    () => buildFormatSource(src, 'avif', DEFAULT_WIDTHS, width ?? undefined),
    [src, width],
  );
  const webpSrcSet = useMemo(
    () => buildFormatSource(src, 'webp', DEFAULT_WIDTHS, width ?? undefined),
    [src, width],
  );

  const useProxy = isMediaProxyUrl(src);

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
    ...(priority ? { fetchpriority: 'high' } : {}),
    ...(width != null ? { width } : {}),
    ...(height != null ? { height } : {}),
    ...(sizes ? { sizes } : {}),
    ...(srcSet ? { srcSet } : {}),
    ...rest,
  };

  if (useProxy && (avifSrcSet || webpSrcSet)) {
    return (
      <picture>
        {avifSrcSet && (
          <source type="image/avif" srcSet={avifSrcSet} sizes={sizes} />
        )}
        {webpSrcSet && (
          <source type="image/webp" srcSet={webpSrcSet} sizes={sizes} />
        )}
        <img {...imgProps} />
      </picture>
    );
  }

  return <img {...imgProps} />;
}
