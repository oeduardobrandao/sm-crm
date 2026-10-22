import { useSyncExternalStore } from 'react';

const subscribeNoop = () => () => {};

/**
 * `false` on the server and during the hydrating render, `true` after (and on
 * every plain client render, e.g. a `createRoot` mount or an SPA navigation).
 *
 * The prerendered landing is hydrated, so its first client render must match
 * the server HTML. Gate anything that depends on client-only state (the signed-in
 * user, storage) on this; React re-renders with `true` in the same flush, with
 * no painted frame in between.
 */
export function useIsHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
}
