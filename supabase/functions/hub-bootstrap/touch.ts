export const TOUCH_TIMEOUT_MS = 1500;

type TouchDbClient = {
  rpc: (fn: string, params: Record<string, unknown>) => { abortSignal: (signal: AbortSignal) => PromiseLike<unknown> };
};

/**
 * Sliding-window renewal. Never throws (best-effort — errors are swallowed here AND
 * caught again in handler.ts as defence in depth).
 *
 * The edge runtime can hang on I/O and kill the isolate with no error logs, bypassing
 * `catch` entirely under a ~2s CPU ceiling. A plain `Promise.race([rpc, timeout])` only
 * stops *waiting* on a hung request — the request itself keeps running in the background
 * and still consumes the isolate's budget. Instead this binds an `AbortSignal.timeout(...)`
 * to the request itself so it is actually CANCELLED, not just abandoned. Same mitigation
 * as `_shared/r2.ts` (getObjectBytes) for the identical failure mode.
 */
export function makeTouchToken(
  createDb: () => TouchDbClient,
  timeoutMs = TOUCH_TIMEOUT_MS,
) {
  return async (token: string): Promise<void> => {
    try {
      await createDb()
        .rpc("hub_token_touch", { p_token: token })
        .abortSignal(AbortSignal.timeout(timeoutMs));
    } catch {
      // Renewal is best-effort. Never surface to the client.
    }
  };
}
