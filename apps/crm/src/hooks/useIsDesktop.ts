import { useEffect, useState } from 'react';

/**
 * True at or above `minWidth` px, tracking live viewport changes.
 * jsdom's matchMedia stub always reports false, so tests render the
 * mobile branch of any layout gated on this hook.
 */
export function useIsDesktop(minWidth = 768): boolean {
  const query = `(min-width: ${minWidth}px)`;
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    setIsDesktop(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [query]);
  return isDesktop;
}
