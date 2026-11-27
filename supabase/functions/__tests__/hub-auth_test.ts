import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createHubAuthHandler } from "../hub-auth/handler.ts";
import { CODE_RE, generateLoginCode, normalizeEmail } from "../hub-auth/logic.ts";
import { buildLoginCodeEmail } from "../hub-auth/email.ts";
import { sha256Hex } from "../_shared/hub-token.ts";

const NOW = "2026-11-23T12:00:00.000Z";
const TOKEN = "49ded0d7-0c34-4b88-8a60-f9d459113f3c";
const CODE = "482913";
const SESSION = "sess_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
const IP = "203.0.113.7";

const WORKSPACE_ROW = {
  id: "ws-1",
  name: "Agência Sol",
  logo_url: "https://cdn.example.com/logo.png",
  brand_color: "#ff6600",
  hub_enabled: true,
};
const TOKEN_ROW = { cliente_id: 15, conta_id: "ws-1", is_active: true };

type RpcCall = { fn: string; params: Record<string, unknown> };

interface DbOpts {
  workspace?: unknown;
  tokenRow?: unknown;
  issue?: { data: unknown; error: unknown };
  verify?: { data: unknown; error: unknown };
  sessionDelete?: { data: unknown; error: unknown };
  paused?: boolean;
}

function makeDb(opts: DbOpts = {}) {
  const rpcCalls: RpcCall[] = [];
  const workspace = "workspace" in opts ? opts.workspace : WORKSPACE_ROW;
  const tokenRow = "tokenRow" in opts ? opts.tokenRow : TOKEN_ROW;
  const tokenQuery = {
    eq: () => tokenQuery,
    gt: () => tokenQuery,
    maybeSingle: async () => ({ data: tokenRow }),
  };
  return {
    rpcCalls,
    from: (table: string) => ({
      select: () =>
        table === "workspaces"
          ? {
            eq: () => ({
              maybeSingle: async () => ({ data: workspace }),
            }),
          }
          : tokenQuery,
    }),
    rpc: async (fn: string, params: Record<string, unknown>) => {
      if (fn === "effective_plan_feature") return { data: true, error: null };
      if (fn === "hub_workspace_paused") return { data: opts.paused === true, error: null };
      rpcCalls.push({ fn, params });
      if (fn === "hub_login_issue") return opts.issue ?? { data: true, error: null };
      if (fn === "hub_login_verify") return opts.verify ?? { data: { ok: true }, error: null };
      if (fn === "hub_session_delete") return opts.sessionDelete ?? { data: null, error: null };
      return { data: null, error: { message: `unexpected rpc ${fn}` } };
    },
  };
}

type Db = ReturnType<typeof makeDb>;
type SendInput = {
  to: string;
  code: string;
  workspaceName: string;
  brandColor: string | null;
  logoUrl: string | null;
  lang?: string;
};

function setup(
  opts: DbOpts & {
    rateLimit?: (key: string) => boolean;
    sendCodeEmail?: (input: SendInput) => Promise<void>;
  } = {},
) {
  const db = makeDb(opts);
  const limits: Array<{ key: string; max: number; win: number }> = [];
  const sent: SendInput[] = [];
  const deferred: Promise<unknown>[] = [];
  const handler = createHubAuthHandler({
    buildCorsHeaders: () => ({}),
    createDb: () => db as any,
    now: () => NOW,
    rateLimit: async (_db, key, max, win) => {
      limits.push({ key, max, win });
      return opts.rateLimit ? opts.rateLimit(key) : true;
    },
    generateCode: () => CODE,
    generateSessionToken: () => SESSION,
    sendCodeEmail: opts.sendCodeEmail ?? (async (input) => {
      sent.push(input);
    }),
    defer: (work) => {
      deferred.push(work);
    },
  });
  const flush = () => Promise.all(deferred);
  return { db, limits, sent, deferred, flush, handler };
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://x/hub-auth", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": IP, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const reqCode = (email: unknown, extra: Record<string, unknown> = {}) =>
  post({ action: "request_code", workspace: "agencia-sol", token: TOKEN, email, ...extra });
const verify = (code: unknown, email: unknown = "marina@clinica.com") =>
  post({ action: "verify_code", workspace: "agencia-sol", token: TOKEN, email, code });

const issueCalls = (db: Db) => db.rpcCalls.filter((c) => c.fn === "hub_login_issue");

// ---------------------------------------------------------------- logic

Deno.test("generateLoginCode: rejects draws above the unbiased limit, then uses the next", () => {
  const draws = [
    new Uint8Array([0xff, 0xff, 0xff, 0xff]), // 4294967295 >= 4294000000: rejected
    new Uint8Array([0x00, 0x01, 0xe2, 0x40]), // 123456
  ];
  const sizes: number[] = [];
  const code = generateLoginCode((n) => {
    sizes.push(n);
    return draws.shift()!;
  });
  assertEquals(code, "123456");
  assertEquals(sizes, [4, 4]);
});

Deno.test("generateLoginCode: boundary of the unbiased range, zero-padded output", () => {
  // 4293999999 is the last accepted value: 4293999999 % 1e6 = 999999.
  const big = new Uint8Array(4);
  new DataView(big.buffer).setUint32(0, 4293999999);
  assertEquals(generateLoginCode(() => big), "999999");
  // 4294000000 is the first rejected value.
  const rejected = new Uint8Array(4);
  new DataView(rejected.buffer).setUint32(0, 4294000000);
  const queue = [rejected, new Uint8Array([0, 0, 0, 42])];
  assertEquals(generateLoginCode(() => queue.shift()!), "000042");
  assertEquals(queue.length, 0);
});

Deno.test("generateLoginCode with real randomness always matches CODE_RE", () => {
  for (let i = 0; i < 200; i++) {
    assert(CODE_RE.test(generateLoginCode((n) => crypto.getRandomValues(new Uint8Array(n)))));
  }
  assert(!CODE_RE.test("12345"));
  assert(!CODE_RE.test("1234567"));
  assert(!CODE_RE.test("12a456"));
});

Deno.test("normalizeEmail matches the SQL side (lower(btrim)) and rejects malformed input", () => {
  assertEquals(normalizeEmail(" Marina@Clinica.com "), "marina@clinica.com");
  assertEquals(normalizeEmail("a@b"), null);
  assertEquals(normalizeEmail("a b@c.com"), null);
  assertEquals(normalizeEmail(42), null);
  assertEquals(normalizeEmail(`${"a".repeat(250)}@b.co`), null);
});

Deno.test("buildLoginCodeEmail: subject, copy and code", () => {
  const { subject, html } = buildLoginCodeEmail({
    code: "123456",
    workspaceName: "Agência <Sol>",
    brandColor: "#ff6600",
    logoUrl: null,
    lang: "pt",
  });
  assertEquals(subject, "Seu código de acesso");
  assert(!subject.includes("123456"), "o código não vai no assunto");
  assert(html.includes("Use este código para entrar no portal da Agência &lt;Sol&gt;."));
  assert(html.includes("123456"));
  assert(html.includes("O código vale por 10 minutos."));
  assert(html.includes("Se você não pediu este código, ignore este e-mail."));
  assert(!html.includes("Agência <Sol>"));
  assert(!html.includes("—"), "no em dashes");
});

// ---------------------------------------------------------------- request_code

Deno.test("request_code, listed email: { ok: true }, normalized email + code, email sent through defer", async () => {
  const t = setup();
  const res = await t.handler(reqCode(" Marina@Clinica.com "));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true });
  assertEquals(t.deferred.length, 1);
  await t.flush();
  assertEquals(issueCalls(t.db), [{
    fn: "hub_login_issue",
    params: { p_cliente_id: 15, p_email: "marina@clinica.com", p_code: CODE },
  }]);
  assertEquals(t.sent, [{
    to: "marina@clinica.com",
    code: CODE,
    workspaceName: "Agência Sol",
    brandColor: "#ff6600",
    logoUrl: "https://cdn.example.com/logo.png",
    lang: "pt",
  }]);
});

Deno.test("request_code, unlisted email: same status and same body bytes, no email", async () => {
  const listed = setup();
  const resListed = await listed.handler(reqCode("marina@clinica.com"));
  await listed.flush();

  const unlisted = setup({ issue: { data: false, error: null } });
  const resUnlisted = await unlisted.handler(reqCode("ninguem@clinica.com"));
  await unlisted.flush();

  assertEquals(resUnlisted.status, resListed.status);
  assertEquals(await resUnlisted.text(), await resListed.text());
  assertEquals(issueCalls(unlisted.db).length, 1);
  assertEquals(unlisted.sent.length, 0);
});

Deno.test("request_code, sendCodeEmail rejects: still { ok: true }", async () => {
  const t = setup({ sendCodeEmail: () => Promise.reject(new Error("RESEND_API_KEY not configured")) });
  const errors: unknown[][] = [];
  const orig = console.error;
  console.error = (...args: unknown[]) => errors.push(args);
  try {
    const res = await t.handler(reqCode("marina@clinica.com"));
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { ok: true });
    await t.flush(); // the deferred work never rejects
  } finally {
    console.error = orig;
  }
  assertEquals(errors.length, 1);
});

Deno.test("request_code, hub_login_issue fails: same response, generic log", async () => {
  const listed = setup();
  const okText = await (await listed.handler(reqCode("marina@clinica.com"))).text();
  await listed.flush();

  const t = setup({ issue: { data: null, error: { code: "XX000", message: "boom" } } });
  const errors: unknown[][] = [];
  const orig = console.error;
  console.error = (...args: unknown[]) => errors.push(args);
  try {
    const res = await t.handler(reqCode("marina@clinica.com"));
    assertEquals(res.status, 200);
    assertEquals(await res.text(), okText);
    await t.flush();
  } finally {
    console.error = orig;
  }
  assertEquals(t.sent.length, 0);
  assertEquals(errors.length, 1);
});

Deno.test("request_code, malformed email: { ok: true }, same bytes, no RPC, no defer", async () => {
  const listed = setup();
  const okText = await (await listed.handler(reqCode("marina@clinica.com"))).text();
  await listed.flush();

  for (const bad of ["not-an-email", "", 42, null]) {
    const t = setup();
    const res = await t.handler(reqCode(bad));
    assertEquals(res.status, 200);
    assertEquals(await res.text(), okText);
    assertEquals(t.db.rpcCalls.length, 0);
    assertEquals(t.deferred.length, 0);
  }
});

Deno.test("request_code rate limits: email (5, 3600) and ip (20, 3600) keys", async () => {
  const t = setup();
  await t.handler(reqCode(" Marina@Clinica.com "));
  await t.flush();
  assertEquals(t.limits, [
    { key: `hub-auth-req:ip:${IP}`, max: 20, win: 3600 },
    { key: "hub-auth-req:email:15:marina@clinica.com", max: 5, win: 3600 },
  ]);
});

Deno.test("request_code: either limit false -> 429, nothing issued", async () => {
  for (const prefix of ["hub-auth-req:ip:", "hub-auth-req:email:"]) {
    const t = setup({ rateLimit: (key) => !key.startsWith(prefix) });
    const res = await t.handler(reqCode("marina@clinica.com"));
    assertEquals(res.status, 429);
    assertEquals(await res.json(), { error: "Muitas tentativas. Aguarde alguns minutos." });
    assertEquals(t.db.rpcCalls.length, 0);
    assertEquals(t.deferred.length, 0);
  }
});

Deno.test("request_code: the email limit applies to unlisted emails too (no 429 oracle)", async () => {
  const t = setup({
    issue: { data: false, error: null },
    rateLimit: (key) => !key.startsWith("hub-auth-req:email:"),
  });
  const res = await t.handler(reqCode("ninguem@clinica.com"));
  assertEquals(res.status, 429);
  await res.body?.cancel();
});

// ---------------------------------------------------------------- verify_code

Deno.test("verify_code happy path: 200 with the session token, RPC gets only its hash", async () => {
  const t = setup();
  const res = await t.handler(verify(CODE, " Marina@Clinica.com "));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { session_token: SESSION });
  assertEquals(t.db.rpcCalls, [{
    fn: "hub_login_verify",
    params: {
      p_cliente_id: 15,
      p_email: "marina@clinica.com",
      p_code: CODE,
      p_session_hash: await sha256Hex(SESSION),
    },
  }]);
  assert(!JSON.stringify(t.db.rpcCalls).includes(SESSION));
});

Deno.test("verify_code, RPC ok:false -> 400 invalid_code", async () => {
  const t = setup({ verify: { data: { ok: false }, error: null } });
  const res = await t.handler(verify(CODE));
  assertEquals(res.status, 400);
  assertEquals(await res.json(), { error: "Código inválido ou expirado.", code: "invalid_code" });
});

Deno.test("verify_code, code not matching CODE_RE -> 400 without calling the RPC", async () => {
  for (const bad of ["12345", "1234567", "12a456", 123456, null]) {
    const t = setup();
    const res = await t.handler(verify(bad));
    assertEquals(res.status, 400);
    assertEquals(await res.json(), { error: "Código inválido ou expirado.", code: "invalid_code" });
    assertEquals(t.db.rpcCalls.length, 0);
  }
});

Deno.test("verify_code, malformed email -> 400 invalid_code without calling the RPC", async () => {
  const t = setup();
  const res = await t.handler(verify(CODE, "nope"));
  assertEquals(res.status, 400);
  assertEquals(await res.json(), { error: "Código inválido ou expirado.", code: "invalid_code" });
  assertEquals(t.db.rpcCalls.length, 0);
});

Deno.test("verify_code, RPC error -> 500 generic", async () => {
  const t = setup({ verify: { data: null, error: { code: "XX000", message: "boom" } } });
  const orig = console.error;
  console.error = () => {};
  try {
    const res = await t.handler(verify(CODE));
    assertEquals(res.status, 500);
    assertEquals(await res.json(), { error: "Erro interno." });
  } finally {
    console.error = orig;
  }
});

Deno.test("verify_code rate limit: key hub-auth-verify:ip:<ip> (10, 600); false -> 429", async () => {
  const t = setup();
  const ok = await t.handler(verify(CODE));
  await ok.body?.cancel();
  assertEquals(t.limits, [{ key: `hub-auth-verify:ip:${IP}`, max: 10, win: 600 }]);

  const limited = setup({ rateLimit: () => false });
  const res = await limited.handler(verify(CODE));
  assertEquals(res.status, 429);
  assertEquals(await res.json(), { error: "Muitas tentativas. Aguarde alguns minutos." });
  assertEquals(limited.db.rpcCalls.length, 0);
});

// ---------------------------------------------------------------- link resolution

Deno.test("invalid token or slug mismatch -> 404 for both actions, hub-badtoken debited", async () => {
  for (const make of [() => reqCode("marina@clinica.com"), () => verify(CODE)]) {
    const t = setup({ tokenRow: null });
    const res = await t.handler(make());
    assertEquals(res.status, 404);
    assertEquals(await res.json(), { error: "Link inválido." });
    assertEquals(t.limits, [{ key: `hub-badtoken:${IP}`, max: 30, win: 600 }]);
    assertEquals(t.db.rpcCalls.length, 0);
    assertEquals(t.deferred.length, 0);
  }
});

Deno.test("hub_auth_paused_returns_hub_paused: both actions -> 403 with the agency name, nothing issued", async () => {
  for (const make of [() => reqCode("marina@clinica.com"), () => verify(CODE)]) {
    const t = setup({ paused: true });
    const res = await t.handler(make());
    assertEquals(res.status, 403);
    assertEquals(await res.json(), { error: "Portal pausado.", code: "hub_paused", agency_name: "Agência Sol" });
    assertEquals(t.limits, []);
    assertEquals(t.db.rpcCalls.length, 0);
    assertEquals(t.deferred.length, 0);
    assertEquals(t.sent.length, 0);
  }
});

Deno.test("invalid token with hub-badtoken exhausted -> 429", async () => {
  const t = setup({ tokenRow: null, rateLimit: () => false });
  const res = await t.handler(verify(CODE));
  assertEquals(res.status, 429);
  await res.body?.cancel();
});

Deno.test("unknown workspace slug -> 404 like bootstrap; hub disabled -> 403", async () => {
  const missing = setup({ workspace: null });
  const res = await missing.handler(reqCode("marina@clinica.com"));
  assertEquals(res.status, 404);
  await res.body?.cancel();
  assertEquals(missing.db.rpcCalls.length, 0);

  const disabled = setup({ workspace: { ...WORKSPACE_ROW, hub_enabled: false } });
  const res2 = await disabled.handler(verify(CODE));
  assertEquals(res2.status, 403);
  await res2.body?.cancel();
  assertEquals(disabled.db.rpcCalls.length, 0);
});

// ---------------------------------------------------------------- logout

Deno.test("logout: hub_session_delete called with the header's hash", async () => {
  const t = setup();
  const res = await t.handler(post({ action: "logout" }, { "x-hub-session": SESSION }));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true });
  assertEquals(t.db.rpcCalls, [{
    fn: "hub_session_delete",
    params: { p_session_hash: await sha256Hex(SESSION) },
  }]);
});

Deno.test("logout without the header (or an oversized one): { ok: true }, no RPC", async () => {
  const cases: Record<string, string>[] = [{}, { "x-hub-session": "x".repeat(201) }];
  for (const headers of cases) {
    const t = setup();
    const res = await t.handler(post({ action: "logout" }, headers));
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { ok: true });
    assertEquals(t.db.rpcCalls.length, 0);
  }
});

Deno.test("logout, RPC error: still { ok: true }", async () => {
  const t = setup({ sessionDelete: { data: null, error: { code: "XX000", message: "boom" } } });
  const orig = console.error;
  console.error = () => {};
  try {
    const res = await t.handler(post({ action: "logout" }, { "x-hub-session": SESSION }));
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { ok: true });
  } finally {
    console.error = orig;
  }
});

// ---------------------------------------------------------------- logging

Deno.test("nothing sensitive is logged", async () => {
  const logged: unknown[] = [];
  const origErr = console.error;
  const origLog = console.log;
  const origWarn = console.warn;
  console.error = (...a: unknown[]) => logged.push(...a);
  console.log = (...a: unknown[]) => logged.push(...a);
  console.warn = (...a: unknown[]) => logged.push(...a);
  const hash = await sha256Hex(SESSION);
  try {
    // Failing verify (RPC error whose message echoes the inputs).
    const v = setup({
      verify: { data: null, error: { code: "23505", message: `dup ${hash} ${CODE}`, details: hash } },
    });
    await (await v.handler(verify(CODE))).body?.cancel();
    // Failing issue, same.
    const i = setup({ issue: { data: null, error: { code: "XX000", message: `bad ${CODE}` } } });
    await (await i.handler(reqCode("marina@clinica.com"))).body?.cancel();
    await i.flush();
    // Failing send whose error carries the code.
    const s = setup({ sendCodeEmail: () => Promise.reject(new Error(`subject: Seu código de acesso: ${CODE}`)) });
    await (await s.handler(reqCode("marina@clinica.com"))).body?.cancel();
    await s.flush();
    // Failing logout.
    const l = setup({ sessionDelete: { data: null, error: { code: "XX000", message: `bad ${hash}` } } });
    await (await l.handler(post({ action: "logout" }, { "x-hub-session": SESSION }))).body?.cancel();
  } finally {
    console.error = origErr;
    console.log = origLog;
    console.warn = origWarn;
  }
  assert(logged.length > 0, "the failures were logged");
  const text = logged.map((a) => {
    if (a instanceof Error) return `${a.message} ${a.stack}`;
    return typeof a === "string" ? a : JSON.stringify(a);
  }).join("\n");
  assert(!text.includes(CODE), "code logged");
  assert(!text.includes(SESSION), "session token logged");
  assert(!text.includes(hash), "session hash logged");
});

// ---------------------------------------------------------------- method / action

Deno.test("OPTIONS -> 200; GET -> 405; unknown action -> 400; bad JSON -> 400", async () => {
  const t = setup();
  const opt = await t.handler(new Request("https://x/hub-auth", { method: "OPTIONS" }));
  assertEquals(opt.status, 200);
  await opt.body?.cancel();
  const get = await t.handler(new Request("https://x/hub-auth", { method: "GET" }));
  assertEquals(get.status, 405);
  await get.body?.cancel();
  const unknown = await t.handler(post({ action: "nope" }));
  assertEquals(unknown.status, 400);
  await unknown.body?.cancel();
  const bad = await t.handler(post("{not json"));
  assertEquals(bad.status, 400);
  await bad.body?.cancel();
  assertEquals(t.db.rpcCalls.length, 0);
});

Deno.test("request_code / verify_code without workspace or token -> 400", async () => {
  const t = setup();
  const res = await t.handler(post({ action: "request_code", email: "a@b.co" }));
  assertEquals(res.status, 400);
  await res.body?.cancel();
  const res2 = await t.handler(post({ action: "verify_code", workspace: "x", code: CODE }));
  assertEquals(res2.status, 400);
  await res2.body?.cancel();
});


// ---------------------------------------------------------------- language

Deno.test("language: an en workspace gets English messages and the code e-mail lang; codes and statuses stay", async () => {
  const t = setup({ workspace: { ...WORKSPACE_ROW, language: "en" } });
  await t.handler(reqCode("marina@clinica.com"));
  await t.flush();
  assertEquals(t.sent.length, 1);
  assertEquals((t.sent[0] as { lang?: string }).lang, "en");

  const bad = await t.handler(verify("12"));
  assertEquals(bad.status, 400);
  assertEquals(await bad.json(), { error: "Invalid or expired code.", code: "invalid_code" });

  const limited = setup({ workspace: { ...WORKSPACE_ROW, language: "en" }, rateLimit: () => false });
  const res = await limited.handler(reqCode("marina@clinica.com"));
  assertEquals(res.status, 429);
  assertEquals(await res.json(), { error: "Too many attempts. Please wait a few minutes." });

  const off = setup({ workspace: { ...WORKSPACE_ROW, language: "en", hub_enabled: false } });
  const r2 = await off.handler(reqCode("a@b.co"));
  assertEquals(r2.status, 403);
  assertEquals(await r2.json(), { error: "This portal is unavailable." });
});

Deno.test("language: missing or unknown workspace language, and an unknown workspace, stay pt", async () => {
  const t = setup({ workspace: { ...WORKSPACE_ROW, language: "fr" } });
  await t.handler(reqCode("marina@clinica.com"));
  await t.flush();
  assertEquals((t.sent[0] as { lang?: string }).lang, "pt");
  const bad = await t.handler(verify("12"));
  assertEquals(await bad.json(), { error: "Código inválido ou expirado.", code: "invalid_code" });
  const none = setup({ workspace: null });
  const r = await none.handler(reqCode("a@b.co"));
  assertEquals(r.status, 404);
  assertEquals(await r.json(), { error: "Workspace não encontrado." });
  const malformed = await t.handler(post("not json"));
  assertEquals(await malformed.json(), { error: "Requisição inválida." });
});

