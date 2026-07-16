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

Deno.test("makeTouchToken swallows a rejecting RPC without throwing", async () => {
  const touchToken = makeTouchToken(() => ({
    rpc: () => ({
      abortSignal: () => Promise.reject(new Error("rpc exploded")),
    }),
  }));

  await touchToken("some-token"); // must not throw
});
