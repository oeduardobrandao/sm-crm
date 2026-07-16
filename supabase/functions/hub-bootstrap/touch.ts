export const TOUCH_TIMEOUT_MS = 1500;

type TouchRpcError = { message?: string; code?: string } | null | undefined;

type TouchDbClient = {
  rpc: (
    fn: string,
    params: Record<string, unknown>,
  ) => { abortSignal: (signal: AbortSignal) => PromiseLike<{ data: unknown; error: TouchRpcError }> };
};

/**
 * Sliding-window renewal. Never throws (best-effort — a renewal failure must never
 * break the client's portal; handler.ts wraps this in a catch too, as defence in depth).
 *
 * postgrest-js defaults to `shouldThrowOnError = false`, so a failed RPC call RESOLVES
 * with `{ data, error }` — it does NOT reject. Only capturing the value and ignoring it
 * (as this used to) means a missing function, a revoked grant, or a renamed RPC fails
 * with no signal anywhere, forever. Every failure path here is logged server-side so a
 * broken renewal is never silent again — but never re-thrown, and never with the token
 * value (a bearer credential) in the log.
 *
 * The edge runtime can hang on I/O and kill the isolate with no error logs, bypassing
 * `catch` entirely under a ~2s CPU ceiling. A plain `Promise.race([rpc, timeout])` only
 * stops *waiting* on a hung request — the request itself keeps running in the background
 * and still consumes the isolate's budget. Instead this binds an `AbortSignal.timeout(...)`
 * to the request itself so it is actually CANCELLED, not just abandoned. Same mitigation
 * as `_shared/r2.ts` (getObjectBytes) for the identical failure mode. A cancelled request
 * surfaces as either a resolved `{ error }` or a rejection depending on the client — both
 * are handled below.
 */
export function makeTouchToken(
  createDb: () => TouchDbClient,
  timeoutMs = TOUCH_TIMEOUT_MS,
) {
  return async (token: string): Promise<void> => {
    try {
      const { error } = await createDb()
        .rpc("hub_token_touch", { p_token: token })
        .abortSignal(AbortSignal.timeout(timeoutMs));

      if (error) {
        console.error(
          "[hub-bootstrap:touch] hub_token_touch RPC returned an error:",
          error.message ?? error,
          error.code ? `(code: ${error.code})` : "",
        );
      }
    } catch (err) {
      // Renewal is best-effort — never surface to the client — but still log so a
      // hard failure (e.g. the abort firing as a rejection) isn't silent either.
      console.error(
        "[hub-bootstrap:touch] hub_token_touch threw:",
        (err as Error)?.message ?? err,
      );
    }
  };
}
