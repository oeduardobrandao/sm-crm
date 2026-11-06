import { useSyncExternalStore } from 'react';

const subscribeNoop = () => () => {};

/**
 * `false` on the server and during the hydrating render, `true` after (and on
 * every plain client render, e.g. a `createRoot` mount or an SPA navigation).
 *
 * The prerendered landing is hydrated, so its first client render must match
 * the server HTML. Gate anything that depends on client-only state (the signed-in
 * user, storage) on this. React re-renders with `true` right after hydration commits, but that
 * re-check runs in the passive-effect phase and can follow a paint, so a frame of the server
 * state may show. Whatever must not flash in that gap is hidden by pre-paint CSS
 * (`html[data-*] #root[data-ssr]`), which LandingPage lifts in the same passive flush.
 */
export function useIsHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
}
