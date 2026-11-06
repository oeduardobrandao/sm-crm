import { useEffect, useState } from 'react';

/** The kit's phone threshold, and the Admin's old `md` breakpoint. */
export const PHONE_QUERY = '(max-width: 767px)';

function matchesPhone(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(PHONE_QUERY).matches
    : false;
}

/** True below 768px. jsdom's matchMedia stub reports false, so tests render desktop. */
export function useIsPhone(): boolean {
  const [isPhone, setIsPhone] = useState(matchesPhone);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(PHONE_QUERY);
    const sync = () => setIsPhone(mq.matches);
    sync();
    mq.addEventListener?.('change', sync);
    return () => mq.removeEventListener?.('change', sync);
  }, []);
  return isPhone;
}
