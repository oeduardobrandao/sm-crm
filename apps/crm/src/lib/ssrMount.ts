let ssrMount = false;

/**
 * Called by main.tsx before `hydrateRoot` when the document is the prerendered landing. Lets
 * components tell "this page load hydrated server HTML" apart from a plain `createRoot` mount
 * (a cold open of another route, or an SPA navigation), where `useIsHydrated()` is `true` from
 * the first render either way. The `value` parameter exists for tests.
 */
export function markSsrMount(value = true): void {
  ssrMount = value;
}

/** `true` when this page load hydrated the prerendered landing. */
export function isSsrMount(): boolean {
  return ssrMount;
}
