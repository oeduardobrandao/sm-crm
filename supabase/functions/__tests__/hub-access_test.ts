import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  hubAccessDenied,
  resolveHubAccess,
  sha256Hex,
} from "../_shared/hub-token.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { hubAccessRpc } from "./hub-access-mock.ts";

const NOW = "2026-07-16T12:00:00.000Z";
const TOKEN = "49ded0d7-0c34-4b88-8a60-f9d459113f3c";
const TOKEN_ROW = { cliente_id: 7, conta_id: "ws-1", is_active: true };
const PERSON = { id: "p-1", nome: "Ana", email: "ana@example.com" };

interface Call { fn: string; args: Record<string, unknown> }

function makeDb(opts: {
  tokenRow?: unknown;
  access?: unknown;
  accessError?: unknown;
  paused?: boolean;
  agencyName?: string | null;
} = {}) {
  const calls: Call[] = [];
  const tokenRow = "tokenRow" in opts ? opts.tokenRow : TOKEN_ROW;
  const workspacesSelect = {
    eq: () => ({
      maybeSingle: async () => ({
        data: { name: "agencyName" in opts ? opts.agencyName : "Agência Sol" },
      }),
    }),
  };
  const db = {
    from: (t: string) => ({
      select: () => t === "workspaces" ? workspacesSelect : ({
        eq: () => ({
          gt: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: tokenRow }) }),
            maybeSingle: async () => ({ data: tokenRow }),
          }),
        }),
      }),
    }),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      if (fn === "hub_access_context" && opts.accessError) {
        return { data: null, error: opts.accessError };
      }
      if (fn === "hub_workspace_paused") return { data: opts.paused === true, error: null };
      const r = hubAccessRpc(fn, opts.access);
      if (r) return r;
      return { data: true, error: null }; // effective_plan_feature
    },
  };
  // deno-lint-ignore no-explicit-any
  return { db: db as any, calls };
}

const req = (session?: string) =>
  new Request("http://x", { headers: session === undefined ? {} : { "x-hub-session": session } });
const accessCalls = (calls: Call[]) => calls.filter((c) => c.fn === "hub_access_context");

Deno.test("switch off, no session -> ok, person null, requireLogin false", async () => {
  const { db, calls } = makeDb();
  const r = await resolveHubAccess(db, req(), TOKEN, NOW);
  assert(r.ok);
  if (r.ok) {
    assertEquals(r.person, null);
    assertEquals(r.requireLogin, false);
    assertEquals(r.token.cliente_id, 7);
  }
  assertEquals(accessCalls(calls).length, 1);
  assertEquals(accessCalls(calls)[0].args.p_cliente_id, 7);
  assertEquals(accessCalls(calls)[0].args.p_session_hash, null);
});

Deno.test("switch off, valid session -> ok with person", async () => {
  const { db } = makeDb({ access: { require_login: false, person: PERSON } });
  const r = await resolveHubAccess(db, req("abc"), TOKEN, NOW);
  assert(r.ok);
  if (r.ok) {
    assertEquals(r.person, PERSON);
    assertEquals(r.requireLogin, false);
  }
});

Deno.test("switch on, no session -> login_required", async () => {
  const { db } = makeDb({ access: { require_login: true, person: null } });
  const r = await resolveHubAccess(db, req(), TOKEN, NOW);
  assertEquals(r, { ok: false, reason: "login_required" });
});

Deno.test("switch on, valid session -> ok with person", async () => {
  const { db } = makeDb({ access: { require_login: true, person: PERSON } });
  const r = await resolveHubAccess(db, req("abc"), TOKEN, NOW);
  assert(r.ok);
  if (r.ok) {
    assertEquals(r.person, PERSON);
    assertEquals(r.requireLogin, true);
  }
});

Deno.test("switch on, session for an email not on this client -> login_required", async () => {
  const { db } = makeDb({ access: { require_login: true, person: null } });
  const r = await resolveHubAccess(db, req("other-client-session"), TOKEN, NOW);
  assertEquals(r, { ok: false, reason: "login_required" });
});

Deno.test("session header is hashed; over 200 chars is treated as absent", async () => {
  const a = makeDb();
  await resolveHubAccess(a.db, req("abc"), TOKEN, NOW);
  assertEquals(accessCalls(a.calls)[0].args.p_session_hash, await sha256Hex("abc"));
  assertEquals(
    await sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );

  const b = makeDb();
  await resolveHubAccess(b.db, req("x".repeat(201)), TOKEN, NOW);
  assertEquals(accessCalls(b.calls)[0].args.p_session_hash, null);

  const c = makeDb();
  await resolveHubAccess(c.db, req("x".repeat(200)), TOKEN, NOW);
  assertEquals(accessCalls(c.calls)[0].args.p_session_hash, await sha256Hex("x".repeat(200)));
});

Deno.test("rpc error -> reason error", async () => {
  const { db } = makeDb({ accessError: { message: "boom" } });
  const orig = console.error;
  console.error = () => {};
  try {
    assertEquals(await resolveHubAccess(db, req(), TOKEN, NOW), { ok: false, reason: "error" });
  } finally {
    console.error = orig;
  }
});

Deno.test("malformed rpc data -> reason error (fail closed)", async () => {
  const bad: unknown[] = [
    true,
    null,
    [],
    { require_login: "yes", person: null },
    { person: null },
    { require_login: false, person: "x" },
    { require_login: false, person: { id: "p", nome: "A" } },
    { require_login: false, person: { id: 1, nome: "A", email: "a@b" } },
  ];
  const orig = console.error;
  console.error = () => {};
  try {
    for (const access of bad) {
      // null would fall back to the default via `??`, so wrap via a custom db
      const { db } = makeDb();
      const origRpc = db.rpc;
      db.rpc = async (fn: string, args: Record<string, unknown>) =>
        fn === "hub_access_context" ? { data: access, error: null } : origRpc(fn, args);
      assertEquals(
        await resolveHubAccess(db, req(), TOKEN, NOW),
        { ok: false, reason: "error" },
        JSON.stringify(access),
      );
    }
  } finally {
    console.error = orig;
  }
});

Deno.test("missing token row -> invalid, rpc not called", async () => {
  const { db, calls } = makeDb({ tokenRow: null });
  assertEquals(await resolveHubAccess(db, req(), TOKEN, NOW), { ok: false, reason: "invalid" });
  assertEquals(accessCalls(calls).length, 0);
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

Deno.test("hubAccessDenied: invalid -> 404 with hub-badtoken rate limit", async () => {
  const keys: string[] = [];
  const rateLimit = async (_db: unknown, key: string, max: number, win: number) => {
    keys.push(`${key}|${max}|${win}`);
    return true;
  };
  const res = await hubAccessDenied("invalid", {
    db: {}, req: new Request("http://x", { headers: { "x-forwarded-for": "1.2.3.4" } }), json, rateLimit,
  });
  assertEquals(res.status, 404);
  assertEquals((await res.json()).error, "Link inválido.");
  assertEquals(keys.length, 1);
  assert(keys[0].startsWith("hub-badtoken:"));
  assert(keys[0].endsWith("|30|600"));
});

Deno.test("hubAccessDenied: invalid over the limit -> 429", async () => {
  const res = await hubAccessDenied("invalid", {
    db: {}, req: new Request("http://x"), json, rateLimit: async () => false,
  });
  assertEquals(res.status, 429);
  await res.body?.cancel();
});

Deno.test("hubAccessDenied: login_required -> 401 with code, error -> 500", async () => {
  let called = 0;
  const rateLimit = async () => { called++; return true; };
  const ctx = { db: {}, req: new Request("http://x"), json, rateLimit };
  const a = await hubAccessDenied("login_required", ctx);
  assertEquals(a.status, 401);
  assertEquals(await a.json(), { error: "Login necessário.", code: "login_required" });
  const b = await hubAccessDenied("error", ctx);
  assertEquals(b.status, 500);
  assertEquals(await b.json(), { error: "Erro interno." });
  assertEquals(called, 0);
});

Deno.test("hubAccessDenied: a refused session debits hub-badsession per IP; past the budget it answers 429", async () => {
  const keys: string[] = [];
  let allow = true;
  const rateLimit = async (_db: unknown, key: string, max: number, windowSeconds: number) => {
    keys.push(`${key}|${max}|${windowSeconds}`);
    return allow;
  };
  const req = new Request("http://x", { headers: { "x-hub-session": "stale", "x-forwarded-for": "9.9.9.9" } });
  const a = await hubAccessDenied("login_required", { db: {}, req, json, rateLimit });
  assertEquals(a.status, 401);
  assertEquals(await a.json(), { error: "Login necessário.", code: "login_required" });
  assertEquals(keys, ["hub-badsession:9.9.9.9|30|600"]);

  allow = false;
  const b = await hubAccessDenied("login_required", { db: {}, req, json, rateLimit });
  assertEquals(b.status, 429);
  // No login_required code: the Hub clears its stored session only on that code.
  assertEquals(await b.json(), { error: "Muitas tentativas. Aguarde alguns minutos." });
});

Deno.test("paused_workspace_returns_paused: resolveHubAccess -> paused with the agency name, no access rpc", async () => {
  const { db, calls } = makeDb({ paused: true });
  const r = await resolveHubAccess(db, req("abc"), TOKEN, NOW);
  assertEquals(r, { ok: false, reason: "paused", agencyName: "Agência Sol" });
  assertEquals(accessCalls(calls).length, 0);
  // Paused is decided before the feature gate.
  assertEquals(calls.filter((c) => c.fn === "effective_plan_feature").length, 0);
  assertEquals(calls.find((c) => c.fn === "hub_workspace_paused")?.args, { p_conta: "ws-1" });
});

Deno.test("paused_keeps_session: stored session + paused workspace -> 403 hub_paused, nothing cleared", async () => {
  const { db, calls } = makeDb({ paused: true, access: { require_login: true, person: PERSON } });
  const request = req("live-session");
  const access = await resolveHubAccess(db, request, TOKEN, NOW);
  assert(!access.ok);
  let limited = 0;
  const res = await hubAccessDenied(access.reason, {
    db,
    req: request,
    json,
    rateLimit: async () => {
      limited++;
      return true;
    },
  });
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body, { error: "Portal pausado.", code: "hub_paused", agency_name: "Agência Sol" });
  // Not login_required (the Hub clears its stored session only on that code),
  // no session rpc, no session header, bad-token budget untouched.
  assertEquals(calls.filter((c) => c.fn.startsWith("hub_session")).length, 0);
  assertEquals(res.headers.get("x-hub-session"), null);
  assertEquals(limited, 0);
});

Deno.test("hubAccessDenied: paused with an explicit name wins; unknown request -> agency_name null", async () => {
  const ctx = { db: {}, req: new Request("http://x"), json, rateLimit: async () => true };
  const a = await hubAccessDenied("paused", ctx, "Agência Lua");
  assertEquals(a.status, 403);
  assertEquals((await a.json()).agency_name, "Agência Lua");
  const b = await hubAccessDenied("paused", ctx);
  assertEquals(await b.json(), { error: "Portal pausado.", code: "hub_paused", agency_name: null });
});

Deno.test("not paused -> normal access", async () => {
  const { db } = makeDb({ paused: false });
  const r = await resolveHubAccess(db, req(), TOKEN, NOW);
  assert(r.ok);
});

Deno.test("cors allows the x-hub-session header", () => {
  const h = buildCorsHeaders(new Request("http://x"))["Access-Control-Allow-Headers"];
  assert(h.includes("x-hub-session"));
});

Deno.test("resolveHubToken: a failed token lookup throws (never 'invalid'); resolveHubAccess answers error", async () => {
  const failing = {
    from: () => {
      const q: Record<string, unknown> = {};
      q.select = () => q; q.eq = () => q; q.gt = () => q;
      q.maybeSingle = async () => ({ data: null, error: { code: "57014" } });
      return q;
    },
    rpc: async () => ({ data: null, error: null }),
  };
  // deno-lint-ignore no-explicit-any
  const r = await resolveHubAccess(failing as any, new Request("http://x"), "tok", new Date().toISOString());
  assertEquals(r, { ok: false, reason: "error" });
});

Deno.test("resolveHubToken: a token that is not a uuid (22P02) stays an invalid link", async () => {
  const malformed = {
    from: () => {
      const q: Record<string, unknown> = {};
      q.select = () => q; q.eq = () => q; q.gt = () => q;
      q.maybeSingle = async () => ({ data: null, error: { code: "22P02" } });
      return q;
    },
    rpc: async () => ({ data: null, error: null }),
  };
  // deno-lint-ignore no-explicit-any
  const r = await resolveHubAccess(malformed as any, new Request("http://x"), "abc", new Date().toISOString());
  assertEquals(r, { ok: false, reason: "invalid" });
});
