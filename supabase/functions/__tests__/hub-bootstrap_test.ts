import { assertEquals, assertInstanceOf, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createHubBootstrapHandler } from "../hub-bootstrap/handler.ts";
import { makeTouchToken } from "../hub-bootstrap/touch.ts";

const cors = () => ({});
const NOW = "2026-07-16T12:00:00.000Z";
const TOKEN = "49ded0d7-0c34-4b88-8a60-f9d459113f3c";

// Non-default hub_* values so gating (entitled vs unentitled) is actually
// observable — if the mock used the column defaults, a gating bug that leaked
// stored columns to an unentitled workspace would look identical to correct
// fail-closed behaviour.
const WORKSPACE_ROW = {
  id: "ws-1",
  name: "WS",
  logo_url: null,
  brand_color: "#111",
  hub_enabled: true,
  hub_surface_theme: "warm",
  hub_font_display: "sora",
  hub_font_body: "inter",
  hub_radius: "pill",
  hub_card_style: "outline",
  hub_logo_style: "wordmark",
  hub_logo_dark_url: "https://example.com/dark-logo.png",
  hub_hide_branding: true,
  hub_default_appearance: "dark",
};

const NEUTRAL_HUB_THEME = {
  customized: false,
  surface: "neutral",
  font_display: "fraunces",
  font_body: "instrument-sans",
  radius: "soft",
  card_style: "filled",
  logo_style: "round",
  logo_dark_url: null,
  hide_branding: false,
  default_appearance: "light",
};

function makeDb(tokenRow: unknown) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: tokenRow }) }),
          maybeSingle: async () => ({
            data: table === "workspaces" ? WORKSPACE_ROW : tokenRow,
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

// Discriminates by feature_key so feature_mensagens and
// feature_brand_customization can be granted/denied independently, mirroring
// how effectivePlanFeature actually calls the RPC.
function makeDbWithFeatureFlags(
  tokenRow: unknown,
  flags: Record<string, boolean>,
) {
  const db = makeDb(tokenRow);
  return {
    ...db,
    rpc: async (_fn: string, params: Record<string, unknown>) => {
      const key = params.feature_key as string;
      return key in flags
        ? { data: flags[key], error: null }
        : { data: true, error: null };
    },
  };
}

function makeDbWithThrowingFeature(tokenRow: unknown, throwingKey: string) {
  const db = makeDb(tokenRow);
  return {
    ...db,
    rpc: async (_fn: string, params: Record<string, unknown>) => {
      if (params.feature_key === throwingKey) {
        return { data: null, error: { message: "function does not exist" } };
      }
      return { data: true, error: null };
    },
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

// --- hub_theme (feature_brand_customization gate) ---------------------------------------

Deno.test("hub_theme reflects the workspace's stored columns when feature_brand_customization is entitled", async () => {
  const handler = createHubBootstrapHandler({
    buildCorsHeaders: cors,
    createDb: () =>
      makeDbWithFeatureFlags(
        { cliente_id: 15, conta_id: "ws-1", is_active: true },
        { feature_brand_customization: true },
      ) as any,
    now: () => NOW,
    touchToken: async () => {},
  });
  const res = await handler(req());
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.hub_theme, {
    customized: true,
    surface: "warm",
    font_display: "sora",
    font_body: "inter",
    radius: "pill",
    card_style: "outline",
    logo_style: "wordmark",
    logo_dark_url: "https://example.com/dark-logo.png",
    hide_branding: true,
    default_appearance: "dark",
  });
});

Deno.test("hub_theme falls back to neutral defaults (hide_branding: false) when feature_brand_customization is NOT entitled, even though the row says hide_branding true", async () => {
  const handler = createHubBootstrapHandler({
    buildCorsHeaders: cors,
    createDb: () =>
      makeDbWithFeatureFlags(
        { cliente_id: 15, conta_id: "ws-1", is_active: true },
        { feature_brand_customization: false },
      ) as any,
    now: () => NOW,
    touchToken: async () => {},
  });
  const res = await handler(req());
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.hub_theme, NEUTRAL_HUB_THEME);
});

Deno.test("hub_theme falls back to neutral defaults (fail closed) when the feature_brand_customization RPC throws", async () => {
  const handler = createHubBootstrapHandler({
    buildCorsHeaders: cors,
    createDb: () =>
      makeDbWithThrowingFeature(
        { cliente_id: 15, conta_id: "ws-1", is_active: true },
        "feature_brand_customization",
      ) as any,
    now: () => NOW,
    touchToken: async () => {},
  });
  const res = await handler(req());
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.hub_theme, NEUTRAL_HUB_THEME);
});

Deno.test("feature_mensagens and feature_brand_customization are resolved independently, and existing top-level fields are unchanged by hub_theme", async () => {
  const handler = createHubBootstrapHandler({
    buildCorsHeaders: cors,
    createDb: () =>
      makeDbWithFeatureFlags(
        { cliente_id: 15, conta_id: "ws-1", is_active: true },
        { feature_brand_customization: true, feature_mensagens: false },
      ) as any,
    now: () => NOW,
    touchToken: async () => {},
  });
  const res = await handler(req());
  assertEquals(res.status, 200);
  const body = await res.json();

  // feature_brand_customization: true, feature_mensagens: false — proves the two
  // flags are resolved independently, not from a single shared toggle.
  assertEquals(body.feature_mensagens, false);
  assertEquals(body.hub_theme.customized, true);

  // Every existing field, byte-identical — deployed frontends must not notice.
  assertEquals(body.workspace, { name: "WS", logo_url: null, brand_color: "#111" });
  assertEquals(body.cliente_nome, "Vanessa");
  assertEquals(body.cliente_foto_url, null);
  assertEquals(body.is_active, true);
  assertEquals(body.cliente_id, 15);
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
