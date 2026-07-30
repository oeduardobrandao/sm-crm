import { assert } from "./assert.ts";
import {
  buildFounderSignupNotice,
  buildFounderSubscriptionNotice,
  buildThankYouEmail,
  buildWelcomeEmail,
  firstNameFrom,
  FOUNDER_NOTICE_FROM,
  LIFECYCLE_FROM,
  sendFounderSignupNotice,
  sendFounderSubscriptionNotice,
  sendThankYouEmail,
  sendWelcomeEmail,
  THANKYOU_SUBJECT,
  WELCOME_SUBJECT,
} from "../_shared/lifecycle-emails.ts";

const BASE = "https://app.example.test";

Deno.test("firstNameFrom takes the first word and trims", () => {
  assert(firstNameFrom("  Ana Paula Souza ") === "Ana");
  assert(firstNameFrom("eduardo") === "eduardo");
  assert(firstNameFrom("") === null);
  assert(firstNameFrom("   ") === null);
  assert(firstNameFrom(null) === null);
  assert(firstNameFrom(undefined) === null);
});

Deno.test("buildWelcomeEmail greets by first name and escapes it", () => {
  const html = buildWelcomeEmail({ firstName: "<b>Ana</b>", appBaseUrl: BASE });
  assert(html.includes("Olá, &lt;b&gt;Ana&lt;/b&gt;!"), "escaped name greeting missing");
  assert(!html.includes("<b>Ana</b>"), "raw name leaked");
});

Deno.test("buildWelcomeEmail falls back to a nameless greeting", () => {
  const html = buildWelcomeEmail({ firstName: null, appBaseUrl: BASE });
  assert(html.includes("Olá!"), "nameless greeting missing");
  assert(!html.includes("Olá, "), "name greeting rendered without a name");
});

Deno.test("both emails carry the logo and never an em-dash", () => {
  for (
    const html of [
      buildWelcomeEmail({ firstName: "Ana", appBaseUrl: BASE }),
      buildThankYouEmail({ firstName: "Ana", workspaceName: "X", appBaseUrl: BASE }),
    ]
  ) {
    assert(html.includes(`src="${BASE}/logo-white-email.png"`), "logo img missing");
    assert(html.includes('alt="Mesaas"'), "logo alt missing");
    assert(!html.includes("—"), "em-dash found in email copy");
  }
});

Deno.test("buildWelcomeEmail carries the core content and links", () => {
  const html = buildWelcomeEmail({ firstName: "Ana", appBaseUrl: BASE });
  // positioning + feature cards
  assert(html.includes("plataforma de gestão para agências de social media"));
  assert(html.includes("Clientes &amp; CRM"));
  assert(html.includes("kanban"));
  assert(html.includes("Hub do cliente"));
  assert(html.includes("Analytics de Instagram"));
  // 3 steps + import wizard
  assert(html.includes("Comece em 3 passos"));
  assert(html.includes("Notion"));
  assert(html.includes("Trello"));
  assert(html.includes("ClickUp"));
  assert(html.includes("CSV"));
  assert(html.includes(`${BASE}/importar`));
  // resources
  assert(html.includes(`${BASE}/ajuda`));
  assert(html.includes(`${BASE}/novidades`));
  // reply invitation
  assert(html.includes("responder este e-mail"));
});

Deno.test("buildWelcomeEmail escapes the base URL in attribute context", () => {
  const html = buildWelcomeEmail({ firstName: null, appBaseUrl: "https://x.test/?a=1&b=2" });
  assert(html.includes("https://x.test/?a=1&amp;b=2"), "URL ampersand not entity-encoded");
  assert(!html.includes('href="https://x.test/?a=1&b='), "raw ampersand in href");
});

Deno.test("buildThankYouEmail thanks by name, escapes workspace, links plan settings", () => {
  const html = buildThankYouEmail({
    firstName: "Ana",
    workspaceName: "<script>Agencia</script>",
    appBaseUrl: BASE,
  });
  assert(html.includes("Olá, Ana!"));
  assert(html.includes("&lt;script&gt;Agencia&lt;/script&gt;"), "workspace not escaped");
  assert(!html.includes("<script>Agencia"), "raw workspace leaked");
  assert(html.includes(`${BASE}/configuracao`));
  assert(html.includes(`${BASE}/importar`));
  assert(html.includes("confiança"));
});

Deno.test("subjects are the spec'd strings", () => {
  assert(WELCOME_SUBJECT === "Bem-vindo ao Mesaas 👋");
  assert(THANKYOU_SUBJECT === "Obrigado pela confiança 💚");
});

Deno.test("thank-you copy has no charge language (works for trials)", () => {
  const html = buildThankYouEmail({ firstName: null, workspaceName: "X", appBaseUrl: BASE });
  for (const word of ["cobrança", "cobranca", "pagamento", "fatura"]) {
    assert(!html.toLowerCase().includes(word), `charge word present: ${word}`);
  }
});

Deno.test("sendWelcomeEmail posts to Resend with founder from + idempotency key", async () => {
  const original = globalThis.fetch;
  Deno.env.set("RESEND_API_KEY", "test-key");
  let capturedBody = "";
  let capturedKey: string | null = null;
  let capturedSignal: unknown = null;
  globalThis.fetch = ((_i: unknown, init?: RequestInit) => {
    capturedBody = String(init?.body ?? "");
    capturedKey = new Headers(init?.headers).get("Idempotency-Key");
    capturedSignal = init?.signal ?? null;
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  try {
    await sendWelcomeEmail({
      to: "ana@example.test",
      firstName: "Ana",
      appBaseUrl: "https://x.test",
      idempotencyKey: "welcome/u1",
    });
  } finally {
    globalThis.fetch = original;
  }
  const payload = JSON.parse(capturedBody);
  assert(payload.from === LIFECYCLE_FROM);
  assert(payload.from === "Eduardo do Mesaas <eduardo@mesaas.com.br>");
  assert(payload.to[0] === "ana@example.test");
  assert(payload.subject === WELCOME_SUBJECT);
  assert(payload.html.includes("Olá, Ana!"));
  assert(capturedKey === "welcome/u1", `Idempotency-Key was ${capturedKey}`);
  assert(capturedSignal instanceof AbortSignal, "fetch is not bounded by an AbortSignal");
});

Deno.test("send helpers treat Resend 409 (payload drift on same key) as success", async () => {
  const original = globalThis.fetch;
  Deno.env.set("RESEND_API_KEY", "test-key");
  globalThis.fetch = (() =>
    Promise.resolve(new Response('{"name":"invalid_idempotent_request"}', { status: 409 }))) as typeof fetch;
  try {
    // Must NOT throw: the key's existence means the original send was accepted.
    await sendWelcomeEmail({
      to: "a@b.test",
      firstName: null,
      appBaseUrl: "https://x.test",
      idempotencyKey: "welcome/u1",
    });
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("sendThankYouEmail sets its idempotency key and throws on non-2xx", async () => {
  const original = globalThis.fetch;
  Deno.env.set("RESEND_API_KEY", "test-key");
  let capturedKey: string | null = null;
  globalThis.fetch = ((_i: unknown, init?: RequestInit) => {
    capturedKey = new Headers(init?.headers).get("Idempotency-Key");
    return Promise.resolve(new Response("nope", { status: 422 }));
  }) as typeof fetch;
  let threw = false;
  try {
    await sendThankYouEmail({
      to: "a@b.test",
      firstName: null,
      workspaceName: "X",
      appBaseUrl: "https://x.test",
      idempotencyKey: "subscription_thanks/w1",
    });
  } catch {
    threw = true;
  } finally {
    globalThis.fetch = original;
  }
  assert(threw, "expected non-2xx to throw");
  assert(capturedKey === "subscription_thanks/w1");
});

Deno.test("send helpers throw when RESEND_API_KEY is missing", async () => {
  const prev = Deno.env.get("RESEND_API_KEY");
  Deno.env.delete("RESEND_API_KEY");
  let threw = false;
  try {
    await sendWelcomeEmail({
      to: "a@b.test",
      firstName: null,
      appBaseUrl: "https://x.test",
      idempotencyKey: "welcome/u1",
    });
  } catch {
    threw = true;
  } finally {
    if (prev !== undefined) Deno.env.set("RESEND_API_KEY", prev);
  }
  assert(threw, "expected missing key to throw");
});

// --- Founder notices ---------------------------------------------------------

Deno.test("buildFounderSignupNotice carries nome + email, escaped, with fallback", () => {
  const withName = buildFounderSignupNotice({
    userEmail: "ana@x.test",
    nome: "<b>Ana</b> Souza",
  });
  assert(withName.subject === "[Mesaas] Novo cadastro: ana@x.test");
  assert(withName.html.includes("&lt;b&gt;Ana&lt;/b&gt; Souza"), "nome not escaped");
  assert(!withName.html.includes("<b>Ana</b>"), "raw nome leaked");
  assert(withName.html.includes("ana@x.test"));

  const noName = buildFounderSignupNotice({ userEmail: "b@x.test", nome: "  " });
  assert(noName.html.includes("(sem nome)"), "missing-nome fallback absent");
});

Deno.test("buildFounderSubscriptionNotice renders plan, labels, owner; escapes", () => {
  const { subject, html } = buildFounderSubscriptionNotice({
    workspaceName: "<i>Agencia X</i>",
    ownerEmail: "dono@x.test",
    ownerNome: "Bruno Lima",
    planName: "Pro",
    subStatus: "trialing",
    billingInterval: "month",
  });
  assert(subject === "[Mesaas] Nova assinatura: <i>Agencia X</i> (Pro)");
  assert(html.includes("&lt;i&gt;Agencia X&lt;/i&gt;"), "workspace not escaped");
  assert(!html.includes("<i>Agencia X</i>"), "raw workspace leaked");
  assert(html.includes("Pro"));
  assert(html.includes("Trial"), "trialing status label missing");
  assert(html.includes("Mensal"), "month interval label missing");
  assert(html.includes("Bruno Lima") && html.includes("dono@x.test"));
});

Deno.test("buildFounderSubscriptionNotice fallbacks: null plan/status, absent interval", () => {
  const { subject, html } = buildFounderSubscriptionNotice({
    workspaceName: "X",
    ownerEmail: "d@x.test",
    ownerNome: null,
    planName: null,
    subStatus: null,
    billingInterval: null,
  });
  assert(subject === "[Mesaas] Nova assinatura: X ((plano desconhecido))");
  assert(html.includes("(plano desconhecido)"));
  assert(html.includes("(desconhecido)"), "null status fallback missing");
  assert(!html.includes("Cobrança"), "interval row rendered without an interval");
  assert(html.includes("(sem nome)"));
  // active labels + raw passthroughs
  const active = buildFounderSubscriptionNotice({
    workspaceName: "X",
    ownerEmail: "d@x.test",
    ownerNome: null,
    planName: "Pro",
    subStatus: "active",
    billingInterval: "week",
  });
  assert(active.html.includes("Ativa"), "active status label missing");
  assert(active.html.includes("week"), "unknown interval should pass through raw");
});

Deno.test("founder notice subjects strip control chars and bound length", () => {
  const { subject } = buildFounderSubscriptionNotice({
    workspaceName: "Agencia\r\nX: Injected\theader",
    ownerEmail: "d@x.test",
    ownerNome: null,
    planName: "P".repeat(200),
    subStatus: "active",
    billingInterval: null,
  });
  assert(!/[\r\n\t]/.test(subject), "control characters survived in subject");
  assert(subject.includes("Agencia X: Injected header"), "whitespace not collapsed");
  assert(subject.length < 200, `subject not bounded: ${subject.length}`);
});

Deno.test("founder notices are a silent no-op without ALERT_EMAIL", async () => {
  const prev = Deno.env.get("ALERT_EMAIL");
  Deno.env.delete("ALERT_EMAIL");
  const original = globalThis.fetch;
  let fetched = false;
  globalThis.fetch = (() => {
    fetched = true;
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  try {
    await sendFounderSignupNotice({ userEmail: "a@x.test", nome: null, idempotencyKey: "k" });
    await sendFounderSubscriptionNotice({
      workspaceName: "X",
      ownerEmail: "d@x.test",
      ownerNome: null,
      planName: null,
      subStatus: null,
      billingInterval: null,
      idempotencyKey: "k",
    });
  } finally {
    globalThis.fetch = original;
    if (prev !== undefined) Deno.env.set("ALERT_EMAIL", prev);
  }
  assert(!fetched, "notice sent without ALERT_EMAIL configured");
});

Deno.test("sendFounderSignupNotice posts to ALERT_EMAIL from the alerts sender", async () => {
  const prevAlert = Deno.env.get("ALERT_EMAIL");
  Deno.env.set("ALERT_EMAIL", "founder@inbox.test");
  Deno.env.set("RESEND_API_KEY", "test-key");
  const original = globalThis.fetch;
  let capturedBody = "";
  let capturedKey: string | null = null;
  globalThis.fetch = ((_i: unknown, init?: RequestInit) => {
    capturedBody = String(init?.body ?? "");
    capturedKey = new Headers(init?.headers).get("Idempotency-Key");
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  try {
    await sendFounderSignupNotice({
      userEmail: "ana@x.test",
      nome: "Ana",
      idempotencyKey: "founder_signup/u1",
    });
  } finally {
    globalThis.fetch = original;
    if (prevAlert !== undefined) Deno.env.set("ALERT_EMAIL", prevAlert);
    else Deno.env.delete("ALERT_EMAIL");
  }
  const payload = JSON.parse(capturedBody);
  assert(payload.from === FOUNDER_NOTICE_FROM);
  assert(payload.from === "Mesaas Alerts <alertas@mesaas.com.br>");
  assert(payload.to[0] === "founder@inbox.test");
  assert(payload.subject === "[Mesaas] Novo cadastro: ana@x.test");
  assert(capturedKey === "founder_signup/u1", `Idempotency-Key was ${capturedKey}`);
});

Deno.test("sendFounderSubscriptionNotice throws on non-2xx (claim retries)", async () => {
  const prevAlert = Deno.env.get("ALERT_EMAIL");
  Deno.env.set("ALERT_EMAIL", "founder@inbox.test");
  Deno.env.set("RESEND_API_KEY", "test-key");
  const original = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response("nope", { status: 500 }))) as typeof fetch;
  let threw = false;
  try {
    await sendFounderSubscriptionNotice({
      workspaceName: "X",
      ownerEmail: "d@x.test",
      ownerNome: null,
      planName: "Pro",
      subStatus: "active",
      billingInterval: "month",
      idempotencyKey: "founder_subscription/w1",
    });
  } catch {
    threw = true;
  } finally {
    globalThis.fetch = original;
    if (prevAlert !== undefined) Deno.env.set("ALERT_EMAIL", prevAlert);
    else Deno.env.delete("ALERT_EMAIL");
  }
  assert(threw, "expected non-2xx to throw");
});
