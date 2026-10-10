import { assert, assertEquals, readJson } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { createAffiliatePublicHandler } from "../affiliate-public/handler.ts";
import {
  buildAffiliateCode,
  commissionSituacao,
  isValidCnpj,
  isValidCpf,
  maskDocumento,
  normalizePixKey,
  referralSituacao,
  sha256Hex,
  validatePayoutInfo,
  validateSignup,
} from "../affiliate-public/logic.ts";
import { buildAffiliateLinkEmail } from "../affiliate-public/email.ts";

const NOW = new Date("2026-10-10T12:00:00Z");
const VALID_CPF = "52998224725";
const VALID_CNPJ = "11222333000181";
const TOKEN = "A".repeat(43);

const AFFILIATE = {
  id: "aff-1",
  nome: "Ana Souza",
  email: "ana@x.com",
  code: "ana7k3f",
  status: "active",
  commission_rate_bps: 2000,
  pix_key_type: null,
  pix_key: null,
  documento: null,
  titular_nome: null,
};

function setup(opts: { rateLimited?: boolean; emailFails?: boolean } = {}) {
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

Deno.test("CPF/CNPJ check digits", () => {
  assert(isValidCpf(VALID_CPF));
  assert(isValidCpf("529.982.247-25"));
  assert(!isValidCpf("52998224724"));
  assert(!isValidCpf("11111111111"));
  assert(isValidCnpj(VALID_CNPJ));
  assert(!isValidCnpj("11222333000180"));
});

Deno.test("normalizePixKey: per-type normalization", () => {
  assertEquals(normalizePixKey("cpf", "529.982.247-25"), VALID_CPF);
  assertEquals(normalizePixKey("cpf", "123"), null);
  assertEquals(normalizePixKey("email", " Ana@X.com "), "ana@x.com");
  assertEquals(normalizePixKey("telefone", "(11) 98888-7777"), "+5511988887777");
  assertEquals(normalizePixKey("telefone", "+55 11 98888-7777"), "+5511988887777");
  assertEquals(normalizePixKey("telefone", "123"), null);
  assertEquals(
    normalizePixKey("aleatoria", "123E4567-E89B-12D3-A456-426614174000"),
    "123e4567-e89b-12d3-a456-426614174000",
  );
  assertEquals(normalizePixKey("aleatoria", "xyz"), null);
});

Deno.test("validatePayoutInfo: documento optional (keeps saved), validated when sent", () => {
  const ok = validatePayoutInfo({ pix_key_type: "email", pix_key: "a@x.com", titular_nome: "Ana" });
  assert(ok.ok && ok.value.documento === null);
  const withDoc = validatePayoutInfo({
    pix_key_type: "cnpj", pix_key: VALID_CNPJ, titular_nome: "Ana ME", documento: "11.222.333/0001-81",
  });
  assert(withDoc.ok && withDoc.value.documento === VALID_CNPJ);
  assert(!validatePayoutInfo({ pix_key_type: "email", pix_key: "a@x.com", titular_nome: "Ana", documento: "1" }).ok);
  assert(!validatePayoutInfo({ pix_key_type: "boleto", pix_key: "x", titular_nome: "Ana" }).ok);
  assert(!validatePayoutInfo({ pix_key_type: "email", pix_key: "a@x.com", titular_nome: "" }).ok);
});

Deno.test("maskDocumento never returns the full number", () => {
  assertEquals(maskDocumento(VALID_CPF), "***.***.247-25");
  assertEquals(maskDocumento(VALID_CNPJ), "**.***.***/0001-81");
  assertEquals(maskDocumento(null), null);
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
  const token = emails[0].link.split("/afiliados/painel/")[1];
  assert(emails[0].link.startsWith("https://www.mesaas.com.br/afiliados/painel/"), emails[0].link);
  assertEquals(token.length, 43);
  const tok = db.calls.find((c) => c.table === "affiliate_access_tokens")!.payload as Record<string, unknown>;
  assertEquals(tok.token_hash, await sha256Hex(token));
  assert(tok.token_hash !== token);
  assertEquals(tok.expires_at, "2027-04-08T12:00:00.000Z");
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
});

Deno.test("dashboard: shapes summary, anonymised referrals and commission states", async () => {
  const { db, handler } = setup();
  db.queue("affiliate_access_tokens", "select", { data: { affiliate_id: "aff-1" } });
  db.queue("affiliates", "select", { data: { ...AFFILIATE, documento: VALID_CPF } });
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
  assertEquals(body.affiliate.documento_mascarado, "***.***.247-25");
  assert(!JSON.stringify(body).includes(VALID_CPF));
  assert(!JSON.stringify(body).includes("ws-1"), "workspace ids must not leak");
  assertEquals(body.summary.pending_cents, 1998);
  assertEquals(body.referrals, [
    { numero: 1, created_at: "2026-09-01T00:00:00Z", situacao: "ativo" },
    { numero: 2, created_at: "2026-09-05T00:00:00Z", situacao: "trial" },
  ]);
  assertEquals(body.commissions[0].situacao, "pendente");
});

Deno.test("update_payout: validates and writes the PIX data for the token's affiliate", async () => {
  const { db, handler } = setup();
  db.queue("affiliate_access_tokens", "select", { data: { affiliate_id: "aff-1" } });
  db.queue("affiliates", "select", { data: AFFILIATE });
  db.queue("affiliates", "update", { data: null });
  const res = await handler(post({
    action: "update_payout", token: TOKEN, pix_key_type: "cpf", pix_key: "529.982.247-25",
    documento: VALID_CPF, titular_nome: "Ana Souza",
  }));
  assertEquals(res.status, 200);
  const upd = db.calls.find((c) => c.table === "affiliates" && c.operation === "update")!;
  const payload = upd.payload as Record<string, unknown>;
  assertEquals(payload.pix_key, VALID_CPF);
  assertEquals(payload.documento, VALID_CPF);
  assert(upd.modifiers.some((m) => m.method === "eq" && m.args[0] === "id" && m.args[1] === "aff-1"));
});

Deno.test("update_payout: first save without documento is refused", async () => {
  const { db, handler } = setup();
  db.queue("affiliate_access_tokens", "select", { data: { affiliate_id: "aff-1" } });
  db.queue("affiliates", "select", { data: AFFILIATE });
  const res = await handler(post({
    action: "update_payout", token: TOKEN, pix_key_type: "email", pix_key: "a@x.com", titular_nome: "Ana",
  }));
  assertEquals(res.status, 400);
  assert(!db.calls.some((c) => c.operation === "update"));
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
