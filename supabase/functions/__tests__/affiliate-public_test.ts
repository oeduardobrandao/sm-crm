import { assert, assertEquals, readJson } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { createAffiliatePublicHandler } from "../affiliate-public/handler.ts";
import {
  buildAffiliateCode,
  commissionSituacao,
  referralSituacao,
  sha256Hex,
  validateSignup,
} from "../affiliate-public/logic.ts";
import { type AffiliateConnectGateway, ConnectError } from "../_shared/affiliate-connect.ts";
import { buildAffiliateLinkEmail } from "../affiliate-public/email.ts";

const NOW = new Date("2026-10-10T12:00:00Z");
const TOKEN = "A".repeat(43);

const AFFILIATE = {
  id: "aff-1",
  nome: "Ana Souza",
  email: "ana@x.com",
  code: "ana7k3f",
  status: "active",
  stripe_account_id: null as string | null,
  stripe_details_submitted: false,
  stripe_transfers_active: false,
};

function fakeConnect(overrides: Partial<AffiliateConnectGateway> = {}) {
  const calls: string[] = [];
  const gateway: AffiliateConnectGateway = {
    createExpressAccount: (p) => (calls.push(`create:${p.affiliateId}`), Promise.resolve("acct_new")),
    createOnboardingLink: (p) => (calls.push(`link:${p.accountId}:${p.returnUrl}`), Promise.resolve("https://connect.stripe.com/setup/x")),
    createDashboardLink: (id) => (calls.push(`dash:${id}`), Promise.resolve("https://connect.stripe.com/express/x")),
    retrieveAccountStatus: (id) => (calls.push(`status:${id}`), Promise.resolve({ detailsSubmitted: true, transfersActive: true })),
    findTransferByGroup: () => Promise.resolve(null),
    createTransfer: () => Promise.resolve("tr_1"),
    ...overrides,
  };
  return { gateway, calls };
}

function setup(
  opts: { rateLimited?: boolean; emailFails?: boolean; connect?: AffiliateConnectGateway | null } = {},
) {
  const db = createSupabaseQueryMock();
  const emails: Array<{ to: string; nome: string; link: string }> = [];
  const rateKeys: string[] = [];
  const handler = createAffiliatePublicHandler({
    buildCorsHeaders: () => ({ "Access-Control-Allow-Origin": "https://www.mesaas.com.br" }),
    db: db as unknown as SupabaseClient,
    rateLimit: (key) => {
      rateKeys.push(key);
      return Promise.resolve(!opts.rateLimited);
    },
    getClientIP: () => "1.2.3.4",
    sendLinkEmail: (p) => {
      if (opts.emailFails) return Promise.reject(new Error("resend down"));
      emails.push(p);
      return Promise.resolve();
    },
    appBaseUrl: () => "https://www.mesaas.com.br/",
    now: () => NOW,
    randomBytes: (n) => new Uint8Array(n).fill(7),
    connect: opts.connect === undefined ? fakeConnect().gateway : opts.connect,
    minPayoutCents: 5000,
  });
  return { db, emails, rateKeys, handler };
}

function post(body: unknown) {
  return new Request("https://fn.local/affiliate-public", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------------------
// logic

Deno.test("validateSignup: requires nome, valid email and the terms", () => {
  assertEquals(validateSignup({ nome: "  Ana   Souza ", email: " ANA@X.com ", aceite_termos: true }), {
    ok: true,
    value: { nome: "Ana Souza", email: "ana@x.com", telefone: null },
  });
  assert(!validateSignup({ nome: "Ana", email: "ana@x.com" }).ok);
  assert(!validateSignup({ nome: "", email: "ana@x.com", aceite_termos: true }).ok);
  assert(!validateSignup({ nome: "Ana", email: "nope", aceite_termos: true }).ok);
  assert(!validateSignup({ nome: "Ana", email: "ana@x.com", telefone: "123", aceite_termos: true }).ok);
  const withPhone = validateSignup({ nome: "Ana", email: "a@x.com", telefone: "(11) 98888-7777", aceite_termos: true });
  assert(withPhone.ok && withPhone.value.telefone === "11988887777");
});

Deno.test("buildAffiliateCode: accent-free first name + 4 chars, matches the DB check", () => {
  const code = buildAffiliateCode("Álvaro José", new Uint8Array([0, 1, 2, 3]));
  assertEquals(code, "alvaroabcd");
  assert(/^[a-z0-9]{4,32}$/.test(code));
  assertEquals(buildAffiliateCode("😀", new Uint8Array([0, 0, 0, 0])), "mesaasaaaa");
});

Deno.test("referralSituacao / commissionSituacao", () => {
  assertEquals(referralSituacao(null), "cadastrado");
  assertEquals(referralSituacao({ provider: "stripe", status: null }), "cadastrado");
  assertEquals(referralSituacao({ provider: "stripe", status: "trialing" }), "trial");
  assertEquals(referralSituacao({ provider: "stripe", status: "past_due" }), "ativo");
  assertEquals(referralSituacao({ provider: "stripe", status: "canceled" }), "cancelado");
  assertEquals(referralSituacao({ provider: "pagarme", status: "active" }), "outro_meio");
  const base = { net_cents: 100, disputed: false, available_at: "2026-11-01T00:00:00Z" };
  assertEquals(commissionSituacao(base, NOW), "pendente");
  assertEquals(commissionSituacao({ ...base, available_at: "2026-10-01T00:00:00Z" }, NOW), "disponivel");
  assertEquals(commissionSituacao({ ...base, net_cents: 0 }, NOW), "estornada");
  assertEquals(commissionSituacao({ ...base, disputed: true }, NOW), "contestada");
});

Deno.test("buildAffiliateLinkEmail escapes the name and the link", () => {
  const html = buildAffiliateLinkEmail({ nome: "<b>Ana</b>", link: "https://x/?a=1&b=2" });
  assert(!html.includes("<b>Ana</b>"));
  assert(html.includes("&amp;b=2"));
});

// ---------------------------------------------------------------------------------------
// handler

Deno.test("signup: new e-mail creates the affiliate, stores only the token hash, e-mails the link", async () => {
  const { db, emails, handler } = setup();
  db.queue("affiliates", "select", { data: null });
  db.queue("affiliates", "insert", { data: AFFILIATE });
  db.queue("affiliate_access_tokens", "insert", { data: null });

  const res = await handler(post({ action: "signup", nome: "Ana Souza", email: "ANA@x.com", aceite_termos: true }));
  assertEquals(res.status, 200);
  assertEquals(await readJson(res), { ok: true });

  const insert = db.calls.find((c) => c.table === "affiliates" && c.operation === "insert");
  const payload = insert!.payload as Record<string, unknown>;
  assertEquals(payload.email, "ana@x.com");
  assert(/^[a-z0-9]{4,32}$/.test(payload.code as string));
  assertEquals(payload.terms_accepted_at, NOW.toISOString());

  assertEquals(emails.length, 1);
  // Link mágico: token no fragmento, kind 'login', 15 minutos.
  const token = emails[0].link.split("/afiliados/entrar#")[1];
  assert(emails[0].link.startsWith("https://www.mesaas.com.br/afiliados/entrar#"), emails[0].link);
  assertEquals(token.length, 43);
  const tok = db.calls.find((c) => c.table === "affiliate_access_tokens")!.payload as Record<string, unknown>;
  assertEquals(tok.token_hash, await sha256Hex(token));
  assert(tok.token_hash !== token);
  assertEquals(tok.kind, "login");
  assertEquals(tok.expires_at, "2026-10-10T12:15:00.000Z");
});

Deno.test("signup: existing e-mail only re-sends the link, same response", async () => {
  const { db, emails, handler } = setup();
  db.queue("affiliates", "select", { data: AFFILIATE });
  db.queue("affiliate_access_tokens", "insert", { data: null });
  const res = await handler(post({ action: "signup", nome: "Outro Nome", email: "ana@x.com", aceite_termos: true }));
  assertEquals(res.status, 200);
  assertEquals(await readJson(res), { ok: true });
  assert(!db.calls.some((c) => c.table === "affiliates" && c.operation === "insert"));
  assertEquals(emails[0].nome, "Ana Souza");
});

Deno.test("signup: a code collision retries with another code", async () => {
  const { db, handler } = setup();
  db.queue("affiliates", "select", { data: null }, { data: null });
  db.queue("affiliates", "insert", { data: null, error: { code: "23505", message: "dup code" } }, { data: AFFILIATE });
  db.queue("affiliate_access_tokens", "insert", { data: null });
  const res = await handler(post({ action: "signup", nome: "Ana", email: "ana@x.com", aceite_termos: true }));
  assertEquals(res.status, 200);
  assertEquals(db.calls.filter((c) => c.table === "affiliates" && c.operation === "insert").length, 2);
});

Deno.test("signup: invalid input is a 400 before any DB call", async () => {
  const { db, handler } = setup();
  const res = await handler(post({ action: "signup", nome: "Ana", email: "ana@x.com" }));
  assertEquals(res.status, 400);
  assertEquals(db.calls.length, 0);
});

Deno.test("signup: rate limited is a 429", async () => {
  const { handler, rateKeys } = setup({ rateLimited: true });
  const res = await handler(post({ action: "signup", nome: "Ana", email: "ana@x.com", aceite_termos: true }));
  assertEquals(res.status, 429);
  assertEquals(rateKeys[0], "affiliate-signup:ip:1.2.3.4");
});

Deno.test("signup: e-mail failure is a 502", async () => {
  const { db, handler } = setup({ emailFails: true });
  db.queue("affiliates", "select", { data: AFFILIATE });
  db.queue("affiliate_access_tokens", "insert", { data: null });
  const res = await handler(post({ action: "signup", nome: "Ana", email: "ana@x.com", aceite_termos: true }));
  assertEquals(res.status, 502);
});

Deno.test("send_link: unknown e-mail answers exactly like a known one", async () => {
  const unknown = setup();
  unknown.db.queue("affiliates", "select", { data: null });
  const r1 = await unknown.handler(post({ action: "send_link", email: "who@x.com" }));

  const known = setup({ emailFails: true });
  known.db.queue("affiliates", "select", { data: AFFILIATE });
  known.db.queue("affiliate_access_tokens", "insert", { data: null });
  const r2 = await known.handler(post({ action: "send_link", email: "ana@x.com" }));

  assertEquals(r1.status, 200);
  assertEquals(r2.status, 200);
  assertEquals(await readJson(r1), await readJson(r2));
  assertEquals(unknown.emails.length, 0);
});

Deno.test("dashboard: malformed token is a 404 without touching the DB", async () => {
  const { db, handler } = setup();
  const res = await handler(post({ action: "dashboard", token: "short" }));
  assertEquals(res.status, 404);
  assertEquals(db.calls.length, 0);
});

Deno.test("dashboard: unknown/expired token is a 404", async () => {
  const { db, handler } = setup();
  db.queue("affiliate_access_tokens", "select", { data: null });
  const res = await handler(post({ action: "dashboard", token: TOKEN }));
  assertEquals(res.status, 404);
  const read = db.calls[0];
  assert(read.modifiers.some((m) => m.method === "eq" && m.args[0] === "token_hash"));
  assert(read.modifiers.some((m) => m.method === "gt" && m.args[0] === "expires_at"));
  // Só sessão abre o painel: um token de login (do e-mail) nunca serve aqui.
  assert(read.modifiers.some((m) => m.method === "eq" && m.args[0] === "kind" && m.args[1] === "session"));
});

Deno.test("dashboard: shapes summary, anonymised referrals and commission states", async () => {
  const { db, handler } = setup();
  db.queue("affiliate_access_tokens", "select", { data: { affiliate_id: "aff-1" } });
  db.queue("affiliates", "select", { data: AFFILIATE });
  db.queueRpc("affiliate_summaries", {
    data: {
      referrals_count: 2, trialing_count: 1, paying_count: 1, pending_cents: "1998",
      released_cents: "0", paid_out_cents: "0", available_cents: "0", lifetime_cents: "1998",
    },
  });
  db.queue("affiliate_referrals", "select", {
    data: [
      { workspace_id: "ws-1", created_at: "2026-09-01T00:00:00Z" },
      { workspace_id: "ws-2", created_at: "2026-09-05T00:00:00Z" },
    ],
  });
  db.queue("affiliate_commissions", "select", {
    data: [{
      paid_at: "2026-10-01T00:00:00Z", invoice_amount_cents: 9990, commission_cents: 1998,
      net_cents: 1998, disputed: false, available_at: "2026-10-31T00:00:00Z",
    }],
  });
  db.queue("affiliate_payouts", "select", { data: [] });
  db.queue("workspace_subscriptions", "select", {
    data: [{ workspace_id: "ws-1", provider: "stripe", status: "active" }, { workspace_id: "ws-2", provider: "stripe", status: "trialing" }],
  });

  const res = await handler(post({ action: "dashboard", token: TOKEN }));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.affiliate.code, "ana7k3f");
  assertEquals(body.affiliate.stripe, { connected: false, details_submitted: false, transfers_active: false });
  assertEquals(body.min_payout_cents, 5000);
  assert(!JSON.stringify(body).includes("ws-1"), "workspace ids must not leak");
  assertEquals(body.summary.pending_cents, 1998);
  assertEquals(body.referrals, [
    { numero: 1, created_at: "2026-09-01T00:00:00Z", situacao: "ativo" },
    { numero: 2, created_at: "2026-09-05T00:00:00Z", situacao: "trial" },
  ]);
  assertEquals(body.commissions[0].situacao, "pendente");
});

Deno.test("dashboard: an account not yet able to receive is re-read from Stripe", async () => {
  const { gateway, calls } = fakeConnect();
  const { db, handler } = setup({ connect: gateway });
  db.queue("affiliate_access_tokens", "select", { data: { affiliate_id: "aff-1" } });
  db.queue("affiliates", "select", { data: { ...AFFILIATE, stripe_account_id: "acct_1" } });
  db.queue("affiliates", "update", { data: null });
  const res = await handler(post({ action: "dashboard", token: TOKEN }));
  assertEquals(res.status, 200);
  assertEquals((await readJson(res)).affiliate.stripe, { connected: true, details_submitted: true, transfers_active: true });
  assertEquals(calls, ["status:acct_1"]);
  const upd = db.calls.find((c) => c.table === "affiliates" && c.operation === "update")!;
  assertEquals((upd.payload as Record<string, unknown>).stripe_transfers_active, true);
});

Deno.test("dashboard: a Stripe outage still serves the panel with the stored status", async () => {
  const { gateway } = fakeConnect({ retrieveAccountStatus: () => Promise.reject(new ConnectError("unknown", "timeout")) });
  const { db, handler } = setup({ connect: gateway });
  db.queue("affiliate_access_tokens", "select", { data: { affiliate_id: "aff-1" } });
  db.queue("affiliates", "select", { data: { ...AFFILIATE, stripe_account_id: "acct_1", stripe_details_submitted: true } });
  const res = await handler(post({ action: "dashboard", token: TOKEN }));
  assertEquals(res.status, 200);
  assertEquals((await readJson(res)).affiliate.stripe, { connected: true, details_submitted: true, transfers_active: false });
});

Deno.test("connect_start: creates the Express account once (CAS) and returns the onboarding link", async () => {
  const { gateway, calls } = fakeConnect();
  const { db, handler } = setup({ connect: gateway });
  db.queue("affiliate_access_tokens", "select", { data: { affiliate_id: "aff-1" } });
  db.queue("affiliates", "select", { data: AFFILIATE });
  db.queue("affiliates", "update", { data: [{ stripe_account_id: "acct_new" }] });
  const res = await handler(post({ action: "connect_start", token: TOKEN }));
  assertEquals(res.status, 200);
  assertEquals(await readJson(res), { url: "https://connect.stripe.com/setup/x" });
  assertEquals(calls[0], "create:aff-1");
  // Sem token na URL que o Stripe guarda.
  assertEquals(calls[1], "link:acct_new:https://www.mesaas.com.br/afiliados/painel?stripe=retorno");
  const upd = db.calls.find((c) => c.table === "affiliates" && c.operation === "update")!;
  assert(upd.modifiers.some((m) => m.method === "is" && m.args[0] === "stripe_account_id" && m.args[1] === null));
});

Deno.test("connect_start: an existing account only gets a new link", async () => {
  const { gateway, calls } = fakeConnect();
  const { db, handler } = setup({ connect: gateway });
  db.queue("affiliate_access_tokens", "select", { data: { affiliate_id: "aff-1" } });
  db.queue("affiliates", "select", { data: { ...AFFILIATE, stripe_account_id: "acct_1" } });
  const res = await handler(post({ action: "connect_start", token: TOKEN }));
  assertEquals(res.status, 200);
  assertEquals(calls.length, 1);
  assert(calls[0].startsWith("link:acct_1:"));
});

Deno.test("connect_start: suspended affiliate, Stripe off or Stripe error", async () => {
  const suspended = setup();
  suspended.db.queue("affiliate_access_tokens", "select", { data: { affiliate_id: "aff-1" } });
  suspended.db.queue("affiliates", "select", { data: { ...AFFILIATE, status: "suspended" } });
  assertEquals((await suspended.handler(post({ action: "connect_start", token: TOKEN }))).status, 403);

  const off = setup({ connect: null });
  off.db.queue("affiliate_access_tokens", "select", { data: { affiliate_id: "aff-1" } });
  off.db.queue("affiliates", "select", { data: AFFILIATE });
  assertEquals((await off.handler(post({ action: "connect_start", token: TOKEN }))).status, 503);

  const { gateway } = fakeConnect({ createExpressAccount: () => Promise.reject(new ConnectError("rejected", "invalid")) });
  const broken = setup({ connect: gateway });
  broken.db.queue("affiliate_access_tokens", "select", { data: { affiliate_id: "aff-1" } });
  broken.db.queue("affiliates", "select", { data: AFFILIATE });
  const res = await broken.handler(post({ action: "connect_start", token: TOKEN }));
  assertEquals(res.status, 502);
  assert(!JSON.stringify(await readJson(res)).includes("invalid"));
});

Deno.test("connect_dashboard: needs a submitted account", async () => {
  const notYet = setup();
  notYet.db.queue("affiliate_access_tokens", "select", { data: { affiliate_id: "aff-1" } });
  notYet.db.queue("affiliates", "select", { data: { ...AFFILIATE, stripe_account_id: "acct_1" } });
  assertEquals((await notYet.handler(post({ action: "connect_dashboard", token: TOKEN }))).status, 400);

  const { gateway, calls } = fakeConnect();
  const ready = setup({ connect: gateway });
  ready.db.queue("affiliate_access_tokens", "select", { data: { affiliate_id: "aff-1" } });
  ready.db.queue("affiliates", "select", {
    data: { ...AFFILIATE, stripe_account_id: "acct_1", stripe_details_submitted: true },
  });
  const res = await ready.handler(post({ action: "connect_dashboard", token: TOKEN }));
  assertEquals(res.status, 200);
  assertEquals(await readJson(res), { url: "https://connect.stripe.com/express/x" });
  assertEquals(calls, ["dash:acct_1"]);
});

Deno.test("exchange: spends the login token atomically and returns a new session token", async () => {
  const { db, handler, rateKeys } = setup();
  db.queueRpc("affiliate_exchange_login", { data: "aff-1" });
  const res = await handler(post({ action: "exchange", login_token: TOKEN }));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(typeof body.session_token, "string");
  assertEquals(body.session_token.length, 43);
  assert(body.session_token !== TOKEN);
  const call = db.calls.find((c) => c.table === "rpc:affiliate_exchange_login")!;
  const params = call.payload as Record<string, unknown>;
  assertEquals(params.p_login_hash, await sha256Hex(TOKEN));
  assertEquals(params.p_session_hash, await sha256Hex(body.session_token));
  assertEquals(params.p_session_expires_at, "2026-11-09T12:00:00.000Z");
  assert(rateKeys.includes("affiliate-exchange:ip:1.2.3.4"));
});

Deno.test("exchange: used, expired or unknown login token is the same 404", async () => {
  const { db, handler } = setup();
  db.queueRpc("affiliate_exchange_login", { data: null });
  const res = await handler(post({ action: "exchange", login_token: TOKEN }));
  assertEquals(res.status, 404);
  assertEquals((await readJson(res)).error, "Link inválido ou expirado. Peça um novo link de acesso.");
});

Deno.test("exchange: malformed token is a 404 without touching the DB", async () => {
  const { db, handler } = setup();
  assertEquals((await handler(post({ action: "exchange", login_token: "short" }))).status, 404);
  assertEquals((await handler(post({ action: "exchange" }))).status, 404);
  assertEquals(db.calls.length, 0);
});

Deno.test("exchange: rate limited is a 429", async () => {
  const { handler } = setup({ rateLimited: true });
  assertEquals((await handler(post({ action: "exchange", login_token: TOKEN }))).status, 429);
});

Deno.test("logout: deletes only that session; always 200", async () => {
  const { db, handler } = setup();
  db.queue("affiliate_access_tokens", "delete", { data: null });
  const res = await handler(post({ action: "logout", token: TOKEN }));
  assertEquals(res.status, 200);
  const del = db.calls.find((c) => c.table === "affiliate_access_tokens" && c.operation === "delete")!;
  assert(del.modifiers.some((m) => m.method === "eq" && m.args[0] === "token_hash"));
  assert(del.modifiers.some((m) => m.method === "eq" && m.args[0] === "kind" && m.args[1] === "session"));

  const bad = setup();
  assertEquals((await bad.handler(post({ action: "logout", token: "short" }))).status, 200);
  assertEquals(bad.db.calls.length, 0);
});

Deno.test("buildAffiliateLinkEmail: says the link is single-use and no longer mentions PIX", () => {
  const html = buildAffiliateLinkEmail({ nome: "Ana Souza", link: "https://x/afiliados/entrar#t" });
  assert(html.includes("15 minutos"));
  assert(!html.includes("PIX"));
  assert(html.includes("Olá, Ana!"));
});

Deno.test("unknown action / bad body / wrong method", async () => {
  const { handler } = setup();
  assertEquals((await handler(post({ action: "nope" }))).status, 400);
  assertEquals((await handler(post([1, 2]))).status, 400);
  assertEquals((await handler(new Request("https://fn.local/x", { method: "GET" }))).status, 405);
  assertEquals((await handler(new Request("https://fn.local/x", { method: "OPTIONS" }))).status, 200);
});

Deno.test("a DB failure is a generic 500", async () => {
  const { db, handler } = setup();
  db.queue("affiliates", "select", { data: null, error: { message: "secret detail" } });
  const res = await handler(post({ action: "send_link", email: "ana@x.com" }));
  assertEquals(res.status, 500);
  const body = await readJson(res);
  assertEquals(body, { error: "Internal server error" });
});

Deno.test("affiliate e-mail: new shell, first name, button", () => {
  const html = buildAffiliateLinkEmail({ nome: "Ana <Souza>", link: "https://app.test/afiliados/entrar#x" });
  assert(html.includes("Olá, Ana!") && html.includes("Programa de afiliados") && html.includes("Entrar no painel"));
  assert(html.includes("logo-black-email.png") && !html.includes("#1a3d2b"));
});
