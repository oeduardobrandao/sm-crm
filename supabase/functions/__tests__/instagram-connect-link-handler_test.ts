import { assertEquals } from "./assert.ts";
import { createConnectLinkHandler } from "../instagram-connect-link/handler.ts";

const BASE = "https://app.mesaas.com.br";
const NOW = "2026-08-06T12:00:00.000Z";
const FUTURE = "2026-09-05T12:00:00.000Z";
const USER = "11111111-1111-1111-1111-111111111111";
const CONTA = "22222222-2222-2222-2222-222222222222";
const OTHER_CONTA = "33333333-3333-3333-3333-333333333333";

/** Minimal chainable stub. Each table returns whatever the fixture says. */
function makeDb(fixture: {
  profiles?: unknown;
  clientes?: unknown;
  links?: unknown;
  rpc?: Record<string, unknown>;
  onRpc?: (fn: string, params: Record<string, unknown>) => void;
  onUpdate?: (table: string, values: Record<string, unknown>) => void;
}) {
  const rows: Record<string, unknown> = {
    profiles: fixture.profiles ?? null,
    clientes: fixture.clientes ?? null,
    instagram_connect_links: fixture.links ?? null,
  };
  const build = (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "gt", "order", "limit"]) {
      chain[m] = () => chain;
    }
    chain.update = (values: Record<string, unknown>) => {
      fixture.onUpdate?.(table, values);
      return chain;
    };
    chain.maybeSingle = () => Promise.resolve({ data: rows[table], error: null });
    chain.single = () => Promise.resolve({ data: rows[table], error: null });
    return chain;
  };
  return {
    from: (table: string) => build(table),
    rpc: (fn: string, params: Record<string, unknown>) => {
      fixture.onRpc?.(fn, params);
      return Promise.resolve({ data: fixture.rpc?.[fn] ?? null, error: null });
    },
  };
}

function makeDeps(over: Record<string, unknown> = {}) {
  return {
    buildCorsHeaders: () => ({ "Access-Control-Allow-Origin": BASE }),
    createDb: () => makeDb({}),
    now: () => NOW,
    appBaseUrl: () => BASE,
    verifyUser: (_t: string) => Promise.resolve({ id: USER }),
    planFeature: (_db: unknown, _c: string, _f: string) => Promise.resolve(true),
    rateLimit: (_db: unknown, _k: string, _m: number, _w: number) => Promise.resolve(true),
    sendClientEmail: (_p: unknown) => Promise.resolve(),
    createSignedState: () => Promise.resolve("signed.state"),
    metaAppId: () => "app-id",
    metaRedirectUri: () => "https://x/functions/v1/instagram-integration",
    ...over,
  };
}

function req(method: string, path: string, body?: unknown, auth = "Bearer tok") {
  return new Request(`https://x/instagram-connect-link${path}`, {
    method,
    headers: { Authorization: auth, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

Deno.test("agency GET: 401 without a bearer token", async () => {
  const h = createConnectLinkHandler(makeDeps());
  const res = await h(req("GET", "?cliente_id=42", undefined, ""));
  assertEquals(res.status, 401);
});

Deno.test("agency GET: 403 when the client belongs to another workspace", async () => {
  const h = createConnectLinkHandler(makeDeps({
    createDb: () => makeDb({ profiles: { conta_id: CONTA }, clientes: { conta_id: OTHER_CONTA } }),
  }));
  const res = await h(req("GET", "?cliente_id=42"));
  assertEquals(res.status, 403);
});

Deno.test("agency GET: 403 when feature_instagram is off", async () => {
  const h = createConnectLinkHandler(makeDeps({
    createDb: () => makeDb({ profiles: { conta_id: CONTA }, clientes: { conta_id: CONTA } }),
    planFeature: () => Promise.resolve(false),
  }));
  const res = await h(req("GET", "?cliente_id=42"));
  assertEquals(res.status, 403);
  assertEquals((await res.json()).error, "feature_disabled");
});

Deno.test("agency GET: returns null when there is no live link", async () => {
  const h = createConnectLinkHandler(makeDeps({
    createDb: () => makeDb({ profiles: { conta_id: CONTA }, clientes: { conta_id: CONTA }, links: null }),
  }));
  const res = await h(req("GET", "?cliente_id=42"));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { link: null });
});

Deno.test("agency GET: an expired-but-unrevoked row is not reported as a live link", async () => {
  // O índice único só enforça revoked_at IS NULL, então uma linha expirada
  // continua ocupando o slot. A metade "não expirado" é checada aqui.
  const h = createConnectLinkHandler(makeDeps({
    createDb: () => makeDb({
      profiles: { conta_id: CONTA },
      clientes: { conta_id: CONTA },
      links: { token: "t", expires_at: "2026-08-01T00:00:00.000Z", revoked_at: null, created_by: USER },
    }),
  }));
  const res = await h(req("GET", "?cliente_id=42"));
  assertEquals(await res.json(), { link: null });
});

Deno.test("agency GET: returns url and expiry for a live link", async () => {
  const h = createConnectLinkHandler(makeDeps({
    createDb: () => makeDb({
      profiles: { conta_id: CONTA },
      clientes: { conta_id: CONTA },
      links: { token: "tok-9", expires_at: FUTURE, revoked_at: null, created_by: USER },
    }),
  }));
  const res = await h(req("GET", "?cliente_id=42"));
  assertEquals(await res.json(), {
    link: { url: `${BASE}/conectar/tok-9`, expires_at: FUTURE },
  });
});

Deno.test("agency POST: calls the RPC and returns the new link", async () => {
  let seen: Record<string, unknown> | null = null;
  const h = createConnectLinkHandler(makeDeps({
    createDb: () => makeDb({
      profiles: { conta_id: CONTA },
      clientes: { conta_id: CONTA },
      rpc: { create_instagram_connect_link: [{ token: "new-tok", expires_at: FUTURE }] },
      onRpc: (_fn, params) => { seen = params; },
    }),
  }));
  const res = await h(req("POST", "", { cliente_id: 42 }));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { link: { url: `${BASE}/conectar/new-tok`, expires_at: FUTURE } });
  assertEquals(seen, { p_cliente_id: 42, p_conta_id: CONTA, p_created_by: USER, p_ttl_days: 30 });
});

Deno.test("agency DELETE: revokes and returns ok", async () => {
  let updated: Record<string, unknown> | null = null;
  const h = createConnectLinkHandler(makeDeps({
    createDb: () => makeDb({
      profiles: { conta_id: CONTA },
      clientes: { conta_id: CONTA },
      onUpdate: (_t, values) => { updated = values; },
    }),
  }));
  const res = await h(req("DELETE", "?cliente_id=42"));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true });
  assertEquals(updated, { revoked_at: NOW });
});

Deno.test("agency POST /email: rejects a malformed address before sending", async () => {
  let sent = 0;
  const h = createConnectLinkHandler(makeDeps({
    createDb: () => makeDb({
      profiles: { conta_id: CONTA },
      clientes: { conta_id: CONTA, nome: "Clínica X" },
      links: { token: "tok-9", expires_at: FUTURE, revoked_at: null, created_by: USER },
    }),
    sendClientEmail: () => { sent++; return Promise.resolve(); },
  }));
  const res = await h(req("POST", "/email", { cliente_id: 42, email: "sem-arroba" }));
  assertEquals(res.status, 400);
  assertEquals(sent, 0);
});

Deno.test("agency POST /email: 429 when rate limited, and nothing is sent", async () => {
  let sent = 0;
  const h = createConnectLinkHandler(makeDeps({
    createDb: () => makeDb({
      profiles: { conta_id: CONTA },
      clientes: { conta_id: CONTA, nome: "Clínica X" },
      links: { token: "tok-9", expires_at: FUTURE, revoked_at: null, created_by: USER },
    }),
    rateLimit: () => Promise.resolve(false),
    sendClientEmail: () => { sent++; return Promise.resolve(); },
  }));
  const res = await h(req("POST", "/email", { cliente_id: 42, email: "c@x.com" }));
  assertEquals(res.status, 429);
  assertEquals(sent, 0);
});
