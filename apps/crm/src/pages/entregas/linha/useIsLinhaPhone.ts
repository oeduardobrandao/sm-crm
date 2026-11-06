import { useEffect, useState } from 'react';

const QUERY = '(max-width: 767.98px)';

/**
 * True below 768px, the same phone breakpoint as `useIsPhoneEditor` and EntregasPage's
 * `isPhone` (`!useIsDesktop(768)`), asked the other way round: jsdom's matchMedia never
 * matches, so a positive phone query keeps every desktop suite that renders
 * `LinhaEditorialView` on the table without having to mock the hook.
 */
export function useIsLinhaPhone(): boolean {
  const [phone, setPhone] = useState(
    () => typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(QUERY);
    setPhone(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setPhone(e.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return phone;
}
