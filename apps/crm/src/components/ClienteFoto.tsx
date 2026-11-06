import { useState, type CSSProperties, type ReactNode } from 'react';

type Srcs = readonly (string | null | undefined)[];

/**
 * The first photo URL in `srcs` that has not failed to load, plus the `onError` to put
 * on the `<img>`. A URL that fails (an expired Instagram CDN link, a deleted upload) is
 * skipped for the next candidate; `src` is undefined once every candidate has failed,
 * which is when the caller shows its initials.
 *
 * For surfaces whose avatar markup must stay as is (a Radix `asChild` trigger, say);
 * everywhere else `ClienteFoto` does the same with less code.
 */
export function useFotoFallback(srcs: Srcs) {
  // The URLs that failed, not a boolean: a new URL in `srcs` is a fresh attempt.
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const src = srcs.find((s): s is string => !!s && !failed.has(s));
  const onError = () => {
    if (src) setFailed((prev) => new Set(prev).add(src));
  };
  return { src, onError };
}

interface ClienteFotoProps {
  /** Photo URLs, best first (see `useClienteAvatars`). Empty entries are skipped. */
  srcs: Srcs;
  /** What to render when no URL loads: each surface keeps its own initials chip. */
  fallback: ReactNode;
  className?: string;
  style?: CSSProperties;
  alt?: string;
}

/** A client's photo, or `fallback` (the initials) when none of `srcs` loads. */
export function ClienteFoto({ srcs, fallback, className, style, alt = '' }: ClienteFotoProps) {
  const { src, onError } = useFotoFallback(srcs);
  if (!src) return <>{fallback}</>;
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      style={style}
      loading="lazy"
      decoding="async"
      onError={onError}
    />
  );
}
