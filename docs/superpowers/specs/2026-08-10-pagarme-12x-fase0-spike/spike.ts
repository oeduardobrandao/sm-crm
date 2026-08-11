// Fase 0 spike go/no-go: Pagar.me v5 sandbox probes.
// Uso: deno run --allow-net --allow-env --env-file=$HOME/.pagarme-spike.env spike.ts <step>
// Steps: plan | tokenize | subscribe | subscribe-trial | idempotency | customer-email | cancel <sub_id> | get <sub_id>
//
// ~/.pagarme-spike.env (no HOME, fora de qualquer repo: .pagarme-spike.env NAO casa
// com os padroes .env* do .gitignore, entao dentro do repo seria commitavel):
//   PAGARME_TEST_SECRET_KEY=sk_test_...
//   PAGARME_TEST_PUBLIC_KEY=pk_test_...
//
// Cada step imprime o request e o response JSON completos: o critério de saída da
// Fase 0 exige request/response REAL gravado. Redirecione para um arquivo:
//   deno run ... spike.ts subscribe | tee out/subscribe.json

const BASE = "https://api.pagar.me/core/v5";
const sk = Deno.env.get("PAGARME_TEST_SECRET_KEY");
const pk = Deno.env.get("PAGARME_TEST_PUBLIC_KEY");
if (!sk || !pk) {
  console.error("Defina PAGARME_TEST_SECRET_KEY e PAGARME_TEST_PUBLIC_KEY em .pagarme-spike.env");
  Deno.exit(1);
}
const basic = "Basic " + btoa(`${sk}:`);

// Cartão de teste (doc Pagar.me: simulador aceita qualquer cartão válido por Luhn em sandbox;
// 4000000000000010 costuma autorizar). Ajustar se o simulador exigir números específicos.
const TEST_CARD = {
  // Simulador: ...0010 = aprovado; ...0028 = recusado (para capturar payloads de falha).
  number: Deno.env.get("CARD_NUMBER") ?? "4000000000000010",
  holder_name: "EDUARDO TESTE",
  exp_month: 12,
  exp_year: 2030,
  cvv: "123",
  // Gateway exige billing address ("validation_error | billing | value is required"):
  // segundo requisito de coleta para o checkout (CEP + endereço).
  billing_address: {
    line_1: "1000, Av. Paulista, Bela Vista",
    zip_code: "01310100",
    city: "São Paulo",
    state: "SP",
    country: "BR",
  },
};

const SPIKE_EMAIL = "spike-12x@mesaas.com.br";

async function api(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: basic,
      "Content-Type": "application/json",
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json().catch(() => null);
  console.log(`\n--- ${method} ${path} -> HTTP ${res.status}`);
  if (body !== undefined) console.log("request:", JSON.stringify(body, null, 2));
  console.log("response:", JSON.stringify(json, null, 2));
  return { status: res.status, json };
}

// Critério 3 (fallback já assumido): plano anual com installments [1..12].
// A contradição central está aqui: plans.installments diz "opções de parcelamento
// disponíveis para assinaturas criadas a partir do plano", mas criar-assinatura
// diz "o número de parcelas deverá ser 1 em recorrências".
async function createPlan(): Promise<string> {
  const { json } = await api("POST", "/plans", {
    name: "Spike 12x anual (start)",
    interval: "year",
    interval_count: 1,
    billing_type: "prepaid",
    payment_methods: ["credit_card"],
    installments: [1, 12],
    currency: "BRL",
    items: [
      {
        name: "Plano Start anual",
        quantity: 1,
        pricing_scheme: { scheme_type: "unit", price: 95900 },
      },
    ],
    metadata: { spike: "12x" },
  });
  const id = (json as { id?: string })?.id;
  if (!id) throw new Error("plano nao criado");
  console.log(`\nPLAN_ID=${id}`);
  return id;
}

// Tokenização client-side simulada (Criterio: REST direto com pk, TTL 60s, uso único).
async function tokenize(): Promise<string> {
  const res = await fetch(`${BASE}/tokens?appId=${pk}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" }, // sem Authorization: só a pk na query
    body: JSON.stringify({ type: "card", card: TEST_CARD }),
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json().catch(() => null);
  console.log(`\n--- POST /tokens?appId=pk_... -> HTTP ${res.status}`);
  console.log("response:", JSON.stringify(json, null, 2));
  const id = (json as { id?: string })?.id;
  if (!id) throw new Error("token nao criado");
  return id;
}

async function createCustomer(): Promise<string> {
  const { json } = await api("POST", "/customers", {
    name: "Spike Doze Vezes",
    email: SPIKE_EMAIL,
    document: "11144477735", // CPF de teste válido por dígito verificador
    document_type: "cpf",
    type: "individual",
    // Gateway exige >=1 telefone ("At least one customer phone is required", 412):
    // requisito para o pagarme-checkout coletar telefone do owner.
    phones: {
      mobile_phone: { country_code: "55", area_code: "11", number: "999990000" },
    },
  });
  const id = (json as { id?: string })?.id;
  if (!id) throw new Error("customer nao criado");
  return id;
}

// Critérios 1 e 4: assinatura do plano com installments=12; variante com start_at +30d.
// O TOKEN EXPIRA EM 60s E É DE USO ÚNICO: tokenizar imediatamente antes.
async function subscribe(withTrial: boolean, idempotencyKey?: string) {
  const planId = Deno.env.get("PLAN_ID") ?? (await createPlan());
  const customerId = await createCustomer();
  const cardToken = await tokenize();
  // Fluxo de produção do pagarme-checkout: attach do cartão COM billing_address
  // (o billing_address dentro do token é ignorado, e card_token direto na
  // subscription deduplica para um cartão salvo sem endereço).
  const { json: cardJson } = await api("POST", `/customers/${customerId}/cards`, {
    token: cardToken,
    billing_address: TEST_CARD.billing_address,
  });
  const cardId = (cardJson as { id?: string })?.id;
  if (!cardId) throw new Error("card nao criado");
  const startAt = withTrial
    ? new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10)
    : undefined;
  const { status, json } = await api(
    "POST",
    "/subscriptions",
    {
      plan_id: planId,
      customer_id: customerId,
      payment_method: "credit_card",
      card_id: cardId,
      installments: 12,
      ...(startAt ? { start_at: startAt } : {}),
      metadata: { workspace_id: "spike-ws-1", plan_id: "start" },
    },
    idempotencyKey ? { "Idempotency-key": idempotencyKey } : {},
  );
  console.log("\n>>> CHECAR NO RESPONSE:");
  console.log(">>> status (future|active?), installments ecoado, next_billing_at, current_cycle,");
  console.log(">>> e no dashboard: a charge saiu PARCELADA em 12x ou à vista?");
  if (withTrial) {
    console.log(">>> com start_at futuro: houve autorização no cartão? alguma charge criada?");
  }
  return { status, json };
}

// Critério 5: duas requests concorrentes com a mesma Idempotency-key -> uma criação + um 409?
async function idempotencyTest() {
  const key = `spike-idem-${Date.now()}`;
  console.log(`Idempotency-key: ${key} (sandbox retém só 5 min)`);
  const results = await Promise.all([
    subscribe(false, key).catch((e) => ({ status: -1, json: String(e) })),
    subscribe(false, key).catch((e) => ({ status: -1, json: String(e) })),
  ]);
  console.log(
    "\n>>> Esperado se /subscriptions honra a key: uma 200 e uma 409 (ou duas 200 com o MESMO id).",
  );
  console.log(">>> statuses:", results.map((r) => r.status));
}

// Critério 6: email é único; segundo create com mesmo email deve ATUALIZAR, não duplicar.
async function customerEmailTest() {
  const a = await api("POST", "/customers", {
    name: "Spike Original",
    email: SPIKE_EMAIL,
    document: "11144477735",
    document_type: "cpf",
    type: "individual",
  });
  const b = await api("POST", "/customers", {
    name: "Spike Renomeado",
    email: SPIKE_EMAIL,
    document: "11144477735",
    document_type: "cpf",
    type: "individual",
  });
  const idA = (a.json as { id?: string })?.id;
  const idB = (b.json as { id?: string })?.id;
  console.log(`\n>>> ids: ${idA} vs ${idB} -> ${idA === idB ? "MESMO customer (update)" : "DUPLICOU"}`);
}

// Critério 8: cancelamento (imediato; não existe cancel-at-cycle-end na referência).
async function cancel(subId: string) {
  await api("DELETE", `/subscriptions/${subId}`);
}

async function getSub(subId: string) {
  await api("GET", `/subscriptions/${subId}`);
}

// Inspeciona as cobranças de uma assinatura: a prova do P0 é a charge nascer com
// installments=12 (e, no dashboard, exibir "12x").
async function charges(subId: string) {
  await api("GET", `/charges?subscription_id=${subId}&size=10`);
  await api("GET", `/invoices?subscription_id=${subId}&size=10`);
}

const [step, arg] = Deno.args;
switch (step) {
  case "plan":
    await createPlan();
    break;
  case "tokenize":
    await tokenize();
    break;
  case "subscribe":
    await subscribe(false);
    break;
  case "subscribe-trial":
    await subscribe(true);
    break;
  case "idempotency":
    await idempotencyTest();
    break;
  case "customer-email":
    await customerEmailTest();
    break;
  case "cancel":
    if (!arg) throw new Error("uso: cancel <sub_id>");
    await cancel(arg);
    break;
  case "get":
    if (!arg) throw new Error("uso: get <sub_id>");
    await getSub(arg);
    break;
  case "charges":
    if (!arg) throw new Error("uso: charges <sub_id>");
    await charges(arg);
    break;
  case "hooks":
    await api("GET", "/hooks?size=10");
    break;
  case "hook-create":
    // Criterio 7: tentar registrar webhook via API (a referencia so documenta
    // leitura; se 404/405, a criacao e dashboard-only e o Eduardo configura).
    if (!arg) throw new Error("uso: hook-create <url>");
    await api("POST", "/hooks", {
      url: arg,
      events: [
        "subscription.created",
        "subscription.updated",
        "subscription.canceled",
        "charge.paid",
        "charge.payment_failed",
        "charge.pending",
        "charge.refunded",
        "invoice.created",
        "invoice.paid",
        "invoice.payment_failed",
        "invoice.canceled",
      ],
    });
    break;
  default:
    console.log(
      "steps: plan | tokenize | subscribe | subscribe-trial | idempotency | customer-email | cancel <id> | get <id>",
    );
}
