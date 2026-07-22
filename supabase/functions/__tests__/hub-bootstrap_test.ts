import { assertEquals, assertInstanceOf, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createHubBootstrapHandler } from "../hub-bootstrap/handler.ts";
import { makeTouchToken } from "../hub-bootstrap/touch.ts";

const cors = () => ({});
const NOW = "2026-07-16T12:00:00.000Z";
const TOKEN = "49ded0d7-0c34-4b88-8a60-f9d459113f3c";

function makeDb(tokenRow: unknown) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: tokenRow }) }),
          maybeSingle: async () => ({
            data: table === "workspaces"
              ? { id: "ws-1", name: "WS", logo_url: null, brand_color: "#111", hub_enabled: true }
              : tokenRow,
          }),
          gt: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: tokenRow }) }),
            maybeSingle: async () => ({ data: tokenRow }),
          }),
          single: async () => ({ data: { nome: "Vanessa" } }),
        }),
      }),
      // effective_plan_feature is reached through rpc, below
    }),
    rpc: async () => ({ data: true, error: null }),
  };
}

const req = () =>
  new Request(`https://x/?workspace=dk-marketing-medico&token=${TOKEN}`, { method: "GET" });

Deno.test("touchToken is called when the token resolves", async () => {
  const calls: string[] = [];
  const handler = createHubBootstrapHandler({
    buildCorsHeaders: cors,
    createDb: () => makeDb({ cliente_id: 15, conta_id: "ws-1", is_active: true }) as any,
    now: () => NOW,
    touchToken: async (t: string) => { calls.push(t); },
  });
  const res = await handler(req());
  assertEquals(res.status, 200);
  assertEquals(calls, [TOKEN]);
});

Deno.test("touchToken is NOT called when the token does not resolve", async () => {
  const calls: string[] = [];
  const handler = createHubBootstrapHandler({
    buildCorsHeaders: cors,
    createDb: () => makeDb(null) as any,
    now: () => NOW,
    touchToken: async (t: string) => { calls.push(t); },
  });
  const res = await handler(req());
  assertEquals(res.status, 404);
  assertEquals(calls, []);
});

Deno.test("a throwing touchToken must NOT break the client's portal", async () => {
  const handler = createHubBootstrapHandler({
    buildCorsHeaders: cors,
    createDb: () => makeDb({ cliente_id: 15, conta_id: "ws-1", is_active: true }) as any,
    now: () => NOW,
    touchToken: async () => { throw new Error("renewal exploded"); },
  });
  const res = await handler(req());
  assertEquals(res.status, 200);
});

Deno.test("feature_mensagens reflects the effective_plan_feature RPC result", async () => {
  const handler = createHubBootstrapHandler({
    buildCorsHeaders: cors,
    createDb: () => makeDb({ cliente_id: 15, conta_id: "ws-1", is_active: true }) as any,
    now: () => NOW,
    touchToken: async () => {},
  });
  const res = await handler(req());
  const body = await res.json();
  assertEquals(body.feature_mensagens, true);
});

Deno.test("feature_mensagens defaults to false and does NOT break the response when the RPC errors", async () => {
  function makeDbWithFailingRpc(tokenRow: unknown) {
    const db = makeDb(tokenRow);
    // Only the feature_mensagens lookup fails — feature_hub_portal (checked earlier,
    // inside resolveHubToken) must keep succeeding so the token resolves and this test
    // actually reaches the code path it's meant to exercise.
    return {
      ...db,
      rpc: async (_fn: string, params: Record<string, unknown>) =>
        params.feature_key === "feature_mensagens"
          ? { data: null, error: { message: "function does not exist" } }
          : { data: true, error: null },
    };
  }
  const handler = createHubBootstrapHandler({
    buildCorsHeaders: cors,
    createDb: () => makeDbWithFailingRpc({ cliente_id: 15, conta_id: "ws-1", is_active: true }) as any,
    now: () => NOW,
    touchToken: async () => {},
  });
  const res = await handler(req());
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.feature_mensagens, false);
});

// --- makeTouchToken (the real factory wired in index.ts) -------------------------------
//
// The tests above inject a synthetic `touchToken` mock straight into `handler.ts`, so they
// never exercise the actual hang guard. These tests build a fake PostgREST-style builder
// that mimics how `abortSignal()` behaves for real: the request "hangs" (never settles on
// its own) until the bound AbortSignal fires, at which point it rejects — exactly what
// supabase-js does when a signal aborts a real in-flight fetch.

/** A `.rpc()` result that never resolves by itself. Only rejects once the AbortSignal
 *  passed to `.abortSignal()` actually fires, simulating a hung PostgREST request that
 *  gets cancelled. `capture.signal` lets a test inspect the exact signal that was bound. */
function makeHangingBuilder(capture: { signal?: AbortSignal }) {
  let rejectFn: ((reason?: unknown) => void) | undefined;
  const builder = {
    abortSignal(signal: AbortSignal) {
      capture.signal = signal;
      signal.addEventListener("abort", () => {
        rejectFn?.(new DOMException("The operation was aborted.", "AbortError"));
      });
      return builder;
    },
    then(resolve: (v: unknown) => void, reject: (reason?: unknown) => void) {
      rejectFn = reject;
      // Deliberately never calls resolve — this is the "hung request" being simulated.
    },
  };
  return builder;
}

Deno.test("makeTouchToken resolves within the timeout even when the RPC never settles (hang guard)", async () => {
  const capture: { signal?: AbortSignal } = {};
  const touchToken = makeTouchToken(
    () => ({ rpc: () => makeHangingBuilder(capture) as any }),
    50,
  );

  const start = performance.now();
  await touchToken("some-token"); // must neither hang nor throw
  const elapsed = performance.now() - start;

  assert(elapsed < 1000, `expected makeTouchToken to resolve well under 1s, took ${elapsed}ms`);
});

Deno.test("makeTouchToken actually applies an AbortSignal that fires by the deadline", async () => {
  const capture: { signal?: AbortSignal } = {};
  const touchToken = makeTouchToken(
    () => ({ rpc: () => makeHangingBuilder(capture) as any }),
    30,
  );

  await touchToken("some-token");

  assertInstanceOf(capture.signal, AbortSignal);
  assert(capture.signal!.aborted, "expected the bound AbortSignal to have fired by the deadline");
});

// This models the abort/cancel path specifically: a bound AbortSignal firing
// on a hung request rejects the underlying fetch (see makeHangingBuilder
// above). makeTouchToken must tolerate that without throwing.
Deno.test("makeTouchToken swallows a rejecting RPC without throwing", async () => {
  const touchToken = makeTouchToken(() => ({
    rpc: () => ({
      abortSignal: () => Promise.reject(new Error("rpc exploded")),
    }),
  }));

  await touchToken("some-token"); // must not throw
});

// --- faithful postgrest-js failure model ------------------------------------------------
//
// Real postgrest-js has `shouldThrowOnError = false` by default: a query/RPC error
// RESOLVES with `{ data: null, error }` — it does NOT reject. A fake builder that only
// simulates failure via rejection (above) models a failure mode that can't happen in
// production and misses the one that does: a missing function, a revoked grant, or a
// renamed RPC all surface as a *resolved* `{ error }`, not a thrown/rejected promise.
//
// This builder is faithful to that: `.abortSignal()` returns a thenable that RESOLVES
// with `{ data: null, error }`, exactly like a real supabase-js RPC call that failed.
function makeErrorResolvingBuilder(error: { message: string; code?: string }) {
  const builder = {
    abortSignal(_signal: AbortSignal) {
      return builder;
    },
    then(resolve: (v: { data: null; error: typeof error }) => void) {
      resolve({ data: null, error });
    },
  };
  return builder;
}

Deno.test("makeTouchToken never throws AND logs when the RPC resolves with a postgrest-style error", async () => {
  const originalConsoleError = console.error;
  const calls: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    calls.push(args);
  };

  try {
    const touchToken = makeTouchToken(() => ({
      rpc: () =>
        makeErrorResolvingBuilder({
          message: 'function hub_token_touch(p_token => text) does not exist',
          code: "PGRST202",
        }) as any,
    }));

    await touchToken("super-secret-token-value"); // must not throw

    assert(calls.length > 0, "expected the RPC error to be logged for diagnosis — a silent failure is the bug this test guards against");

    const loggedText = calls.map((args) => args.map(String).join(" ")).join(" | ");
    assert(loggedText.includes("hub_token_touch"), "expected the log to mention the failing RPC for diagnosis");
    assert(!loggedText.includes("super-secret-token-value"), "the bearer token value must NEVER be logged");
  } finally {
    console.error = originalConsoleError;
  }
});
