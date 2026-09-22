/**
 * Watchdog for an SDK call whose own transport is a known edge-runtime hang
 * risk (see r2.ts's presign+fetch comments). Resolves `null` on timeout
 * instead of the operation's own return type, so callers can tell "timed out"
 * apart from "completed with a falsy/zero result" and skip writing a
 * checkpoint for a run that may still be in flight.
 *
 * A late settlement of `run()` AFTER the timeout has already resolved the
 * outer promise is deliberately swallowed here rather than re-thrown or
 * re-resolved: the caller has already moved on (the outer promise only
 * settles once), so a late resolve is silently discarded and a late reject is
 * logged instead of becoming an unhandled promise rejection. An earlier
 * version returned `resolve(Promise.reject(e))` from that branch, but by
 * then the executor's `resolve` is a no-op (the promise already settled to
 * `null`), so that freshly-rejected promise was created and never adopted or
 * observed by anyone — a genuine unhandled rejection that can destabilize a
 * reused isolate long after the response returned. Exactly the R2-hang
 * scenario this watchdog exists to contain.
 */
export function withWatchdog<T>(ms: number, run: () => Promise<T>): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      resolve(null);
    }, ms);
    run().then(
      (v) => {
        if (settled) return; // late resolution after timeout: ignore
        settled = true;
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        if (settled) {
          // Late rejection after the timeout already resolved `null` to the
          // caller: log it instead of leaking an unhandled rejection.
          console.error("post-media-cleanup:purge-trash (after watchdog timeout)", e);
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(Promise.reject(e));
      },
    );
  });
}
