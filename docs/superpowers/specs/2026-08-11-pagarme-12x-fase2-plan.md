# Fase 2 — Pagar.me 12x: ownership guard + admin provider-aware + year-guard

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Blindar o código Stripe existente contra a chegada do segundo provider (Pagar.me):
webhooks Stripe nunca escrevem numa linha que não possuem, o admin nunca sobrescreve o mirror de
uma linha Pagar.me com dados Stripe, e o checkout Stripe anual recusa quando o plano migrou para
12x.

**Architecture:** A Fase 1 criou as colunas (`workspace_subscriptions.provider`,
`pagarme_subscription_id`, `plans.pagarme_12x_enabled`) e as funções puras
(`canWebhookWrite`, `isPaidThrough` em `_shared/pagarme-logic.ts`) com 38 testes — nada disso
está ligado ainda. A Fase 2 FIA essas funções nos três pontos de escrita/leitura Stripe:
`stripe-webhook` (guard de ownership), `platform-admin` (pricing e detail provider-aware) e
`billing-checkout` (rejeição do anual sob o gate). Nenhum fluxo Pagar.me novo nasce aqui.

**Tech Stack:** Deno edge functions (Supabase), TypeScript, React 19 (admin), Deno.test +
Vitest.

## Global Constraints

- **Invisível com o gate desligado.** `plans.pagarme_12x_enabled` é `false` em todos os
  ambientes; todo fluxo Stripe legítimo (bind via `checkout.session.completed`, updates com id
  registrado, payment_failed do sub registrado) deve se comportar EXATAMENTE como hoje. As
  únicas mudanças de comportamento permitidas são as defensivas descritas nas tasks (eventos
  com id não registrado ou provider alheio viram no-op logado).
- Edge functions rodam em **Deno** (imports `npm:` ou relativos `.ts`). Lógica de decisão nova
  vai para módulos puros em `supabase/functions/_shared/` (sem Stripe/Supabase/env — padrão de
  `_shared/billing-logic.ts`); handlers inline no `Deno.serve` não são unit-testáveis, então
  toda decisão testável DEVE estar numa função pura.
- Testes Deno em `supabase/functions/__tests__/<nome>_test.ts` com `Deno.test` e
  `assertEquals` de `./assert.ts`. Depois de rodar `npm run test:functions`, o `deno.lock` da
  raiz fica sujo: rode `git checkout -- deno.lock` antes de commitar.
- Mensagens de erro voltadas ao usuário em PT-BR, **sem travessão (em-dash)** — use ponto,
  dois-pontos ou "·". Mensagens genéricas para fora, detalhe só no log interno.
- Commits pequenos por task, mensagem em inglês no padrão do repo
  (`feat(billing): ...` / `fix(billing): ...`), terminando com
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Trabalhe SEMPRE dentro do worktree
  `/Users/eduardosouza/Projects/sm-crm/.claude/worktrees/instagram-post-lookback-406f72`
  (confira com `pwd` e `git branch --show-current` = `claude/pagarme-12x-fase2-ownership`
  antes de editar qualquer arquivo).
- Contract changes quebram testes existentes nas DUAS suítes: ao mudar a assinatura de
  `resolveMirrorAmount`/`PriceableSub`, atualize `platform-admin-pricing_test.ts` na mesma
  task; ao mudar interfaces do admin, rode `npx tsc -p apps/admin/tsconfig.json --noEmit`.
- Fatos já decididos (não re-questionar): `canWebhookWrite` é a regra central de ownership e
  já está testada; webhook NUNCA troca provider; `checkout.session.completed` é o único evento
  Stripe autorizado a fazer (re)bind; linha Pagar.me usa o amount-mirror (preenchido no
  checkout da Fase 3) e nunca live-fetch da Stripe.

---

### Task 1: Ownership guard no stripe-webhook

**Files:**
- Modify: `supabase/functions/_shared/billing-logic.ts` (novo helper puro no fim do arquivo)
- Modify: `supabase/functions/stripe-webhook/index.ts:91-155` (`syncSubscription`) e `:157-188`
  (`handlePaymentFailed`)
- Test: `supabase/functions/__tests__/billing-logic_test.ts` (estender)

**Interfaces:**
- Consumes: `canWebhookWrite(existing, incoming, now)` de `../_shared/pagarme-logic.ts`
  (já existe, já testada — assinatura em `pagarme-logic.ts:59-96`).
- Produces: `extractInvoiceSubscriptionId(invoice): string | null` em `_shared/billing-logic.ts`
  (a Fase 4 do plano geral reusa no pagarme-webhook? Não — é Stripe-specific; nenhuma task
  futura depende dela além deste handler).

**Contexto:** hoje `syncSubscription` faz upsert incondicional por `workspace_id` e
`handlePaymentFailed` resolve a linha só por `stripe_customer_id`. Quando o Pagar.me passar a
possuir linhas (Fase 3), um evento Stripe atrasado (ex.: `customer.subscription.deleted` da
assinatura antiga) sobrescreveria a linha do novo provider. O guard usa `canWebhookWrite`:
provider igual E subscription id igual ao registrado; (re)bind só quando o evento veio de
`checkout.session.completed` (o único que carrega `session`, autorizado pelo workspace via
`client_reference_id`).

Efeitos defensivos aceitos (e desejados) fora do fluxo legítimo:
- `customer.subscription.updated/deleted` de um id que NÃO bate com o registrado → no-op
  logado (antes: sobrescrevia).
- `invoice.payment_failed` cujo `subscription` não bate com o registrado, ou de linha possuída
  pelo Pagar.me, ou de linha ainda sem bind → no-op logado (antes: marcava past_due e mandava
  e-mail de dunning).
- `customer.subscription.updated` chegando ANTES de `checkout.session.completed` numa linha
  ainda sem bind → no-op; o `checkout.session.completed` seguinte faz o retrieve completo e
  sincroniza tudo (ordem de eventos Stripe não é garantida; nada se perde).

- [ ] **Step 1: Testes do helper puro (failing)**

Adicionar ao fim de `supabase/functions/__tests__/billing-logic_test.ts`:

```ts
import { extractInvoiceSubscriptionId } from "../_shared/billing-logic.ts";

Deno.test("extractInvoiceSubscriptionId reads the root string shape (acacia)", () => {
  assertEquals(extractInvoiceSubscriptionId({ subscription: "sub_123" }), "sub_123");
});

Deno.test("extractInvoiceSubscriptionId reads an expanded subscription object", () => {
  assertEquals(extractInvoiceSubscriptionId({ subscription: { id: "sub_123" } }), "sub_123");
});

Deno.test("extractInvoiceSubscriptionId reads the basil parent shape", () => {
  assertEquals(
    extractInvoiceSubscriptionId({
      parent: { subscription_details: { subscription: "sub_456" } },
    }),
    "sub_456",
  );
});

Deno.test("extractInvoiceSubscriptionId prefers the root shape over parent", () => {
  assertEquals(
    extractInvoiceSubscriptionId({
      subscription: "sub_root",
      parent: { subscription_details: { subscription: "sub_parent" } },
    }),
    "sub_root",
  );
});

Deno.test("extractInvoiceSubscriptionId returns null for a non-subscription invoice", () => {
  assertEquals(extractInvoiceSubscriptionId({}), null);
  assertEquals(extractInvoiceSubscriptionId({ subscription: null }), null);
  assertEquals(extractInvoiceSubscriptionId({ subscription: {} }), null);
});
```

Obs: o arquivo já importa `assertEquals` de `./assert.ts`; adicione
`extractInvoiceSubscriptionId` ao import existente de `../_shared/billing-logic.ts` em vez de
duplicar a linha de import.

- [ ] **Step 2: Rodar e ver falhar**

Run: `deno test supabase/functions/__tests__/billing-logic_test.ts`
Expected: FAIL (`extractInvoiceSubscriptionId` não exportada)

- [ ] **Step 3: Implementar o helper**

Ao fim de `supabase/functions/_shared/billing-logic.ts`:

```ts
// ─── Invoice → subscription id ─────────────────────────────────────────────

export interface InvoiceSubscriptionSource {
  subscription?: string | { id?: string | null } | null;
  parent?: {
    subscription_details?: { subscription?: string | { id?: string | null } | null } | null;
  } | null;
}

/**
 * Extracts the subscription id from a Stripe invoice payload. Webhook payloads use the
 * ACCOUNT's API version regardless of the SDK pin: older versions (acacia) carry
 * `invoice.subscription` at the root, basil (2025-03-31+) moved it to
 * `invoice.parent.subscription_details.subscription`, and either shape may be an expanded
 * object instead of a string. Null means the invoice is not tied to a subscription.
 */
export function extractInvoiceSubscriptionId(invoice: InvoiceSubscriptionSource): string | null {
  const raw = invoice.subscription ?? invoice.parent?.subscription_details?.subscription ?? null;
  if (raw == null) return null;
  return typeof raw === "string" ? raw : (raw.id ?? null);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `deno test supabase/functions/__tests__/billing-logic_test.ts`
Expected: PASS (todos, incluindo os pré-existentes)

- [ ] **Step 5: Fiar o guard em `syncSubscription`**

Em `supabase/functions/stripe-webhook/index.ts`, adicionar aos imports:

```ts
import { canWebhookWrite } from "../_shared/pagarme-logic.ts";
import { extractInvoiceSubscriptionId } from "../_shared/billing-logic.ts";
```

(`extractInvoiceSubscriptionId` entra no import já existente de `billing-logic.ts`.)

Em `syncSubscription`, logo DEPOIS do resolve do workspace
(`if (!workspaceId) throw ...`, linha ~97) e ANTES de qualquer outra chamada, inserir:

```ts
  // Ownership guard: a Stripe webhook may only write a row Stripe owns, and only for the
  // subscription id registered on it. (Re)binding a new id is allowed only when the event came
  // from checkout.session.completed (`session` non-null) — the sole event authorized by the
  // workspace itself via client_reference_id. Everything else (late events from an old
  // subscription, rows owned by Pagar.me) is an intentional no-op: retrying cannot change
  // ownership, so we ack instead of erroring.
  const { data: existingRow, error: existingErr } = await svc
    .from("workspace_subscriptions")
    .select(
      "provider, stripe_subscription_id, pagarme_subscription_id, status, cancel_at_period_end, current_period_end",
    )
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (existingErr) {
    // A failed read must NOT masquerade as "no row": canWebhookWrite(null, ...) authorizes a
    // bind, which could write over a row another provider owns. Throw → 5xx → redelivery.
    throw new Error(`ownership read failed for workspace ${workspaceId}: ${existingErr.message}`);
  }
  const allowed = canWebhookWrite(
    existingRow ?? null,
    { provider: "stripe", subscriptionId: sub.id, isAuthorizedBind: session != null },
    new Date(),
  );
  if (!allowed) {
    console.warn(
      `[stripe-webhook] write denied for subscription ${sub.id} on workspace ${workspaceId}: row not owned by this stripe subscription`,
    );
    return;
  }
```

E SUBSTITUIR o bloco de escrita (o `await svc.from("workspace_subscriptions").upsert({...})`
das linhas ~136-149) por um write com CAS (compare-and-set) no provider:

```ts
  const columns = {
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    // The guard above authorized this write, so stamping ownership is both safe and REQUIRED:
    // an authorized reclaim of a churned Pagar.me row must flip the row back to Stripe, or
    // every later Stripe event for it would be denied by the guard and the admin would keep
    // labeling a live Stripe subscription as Pagar.me. Stripe subscriptions have no card
    // installments, so a leftover from a Pagar.me era is cleared in the same write.
    provider: "stripe",
    installments: null,
    status: sub.status,
    plan_id: resolved?.plan_id ?? null,
    billing_interval: resolved?.interval ?? null,
    current_period_end: periodEndUnix
      ? new Date(periodEndUnix * 1000).toISOString() : null,
    cancel_at_period_end: sub.cancel_at_period_end ?? false,
    ...amountCols,
    ...recovery,
    updated_at: new Date().toISOString(),
  };

  if (existingRow) {
    // Compare-and-set on the provider observed at guard time: if a concurrent writer (e.g. a
    // pagarme-checkout binding this row in Fase 3+) switched ownership between our read and
    // this write, zero rows match. Throwing turns that into a 5xx → Stripe redelivers → the
    // next attempt re-reads fresh state and re-decides. Errors are propagated for the same
    // reason: a silently failed write must not ack the event.
    const { data: updated, error: updateErr } = await svc
      .from("workspace_subscriptions")
      .update(columns)
      .eq("workspace_id", workspaceId)
      .eq("provider", existingRow.provider ?? "stripe")
      .select("workspace_id");
    if (updateErr) {
      throw new Error(`subscription write failed for workspace ${workspaceId}: ${updateErr.message}`);
    }
    if (!updated?.length) {
      throw new Error(`concurrent ownership change on workspace ${workspaceId}, retrying via redelivery`);
    }
  } else {
    // Plain INSERT, deliberately NOT an upsert: if a concurrent writer created the row between
    // our "no row" read and this statement (e.g. a pagarme-checkout bind in Fase 3+), an upsert
    // with onConflict would resolve by UPDATING that fresh row with Stripe columns — bypassing
    // the ownership decision in exactly the race the CAS exists for. The unique violation
    // throws instead: 5xx → Stripe redelivers → the next attempt reads the row and re-decides.
    const { error: insertErr } = await svc
      .from("workspace_subscriptions")
      .insert({ workspace_id: workspaceId, ...columns });
    if (insertErr) {
      throw new Error(`subscription insert failed for workspace ${workspaceId}: ${insertErr.message}`);
    }
  }
```

O `statusToPlanId`/`writeWorkspacePlan` no fim da função permanece byte-idêntico.
(Nota: o upsert original nem checava `error` — uma escrita falhada ackava o evento e a Stripe
nunca reentregava. A propagação acima corrige isso de carona, deliberadamente.)

- [ ] **Step 6: Fiar o guard em `handlePaymentFailed`**

Substituir o corpo de `handlePaymentFailed` (linhas ~157-188) por:

```ts
async function handlePaymentFailed(svc: SupabaseClient, invoice: Stripe.Invoice) {
  const customerId = typeof invoice.customer === "string"
    ? invoice.customer : invoice.customer?.id;
  if (!customerId) return;

  // A failed invoice with no subscription (one-off invoice) has no dunning to run.
  const invoiceSubId = extractInvoiceSubscriptionId(invoice as InvoiceSubscriptionSource);
  if (!invoiceSubId) return;

  // past_due_since is selected so buildFailureEpisode can coalesce against its own prior value.
  // The ownership columns are selected so canWebhookWrite can refuse a failure event that does
  // not belong to the registered subscription (old sub after a rebind, or a Pagar.me-owned row).
  const { data: row } = await svc
    .from("workspace_subscriptions")
    .select(
      "workspace_id, past_due_since, provider, stripe_subscription_id, pagarme_subscription_id, status, cancel_at_period_end, current_period_end",
    )
    .eq("stripe_customer_id", customerId).maybeSingle();
  if (!row?.workspace_id) throw new Error(`No workspace for failed-invoice customer ${customerId}`);

  // payment_failed never binds: an unbound row or a mismatched id is a deliberate no-op.
  const allowed = canWebhookWrite(
    row,
    { provider: "stripe", subscriptionId: invoiceSubId, isAuthorizedBind: false },
    new Date(),
  );
  if (!allowed) {
    console.warn(
      `[stripe-webhook] payment_failed ignored for subscription ${invoiceSubId} on workspace ${row.workspace_id}: not the registered subscription`,
    );
    return;
  }

  const nextAttempt = invoice.next_payment_attempt ?? null;
  const episode = buildFailureEpisode(
    (row.past_due_since as string | null) ?? null,
    invoice.attempt_count ?? 0,
    nextAttempt,
    new Date(),
  );

  // CAS on provider (same rationale as syncSubscription): if ownership changed between the
  // guard read and this write, zero rows match → throw → redelivery re-decides. The dunning
  // e-mail below only fires after a successful write.
  const { data: updated, error: updateErr } = await svc.from("workspace_subscriptions").update({
    status: "past_due",
    ...episode,
    updated_at: new Date().toISOString(),
  }).eq("workspace_id", row.workspace_id).eq("provider", "stripe").select("workspace_id");
  if (updateErr) {
    throw new Error(`past_due write failed for workspace ${row.workspace_id}: ${updateErr.message}`);
  }
  if (!updated?.length) {
    throw new Error(`concurrent ownership change on workspace ${row.workspace_id}, retrying via redelivery`);
  }

  await notifyOwnerOfFailure(
    svc,
    row.workspace_id as string,
    { attemptCount: invoice.attempt_count ?? 0, nextPaymentAttempt: nextAttempt },
    episode,
  );
}
```

Nota: o `.eq("provider", "stripe")` é seguro porque o guard só deixa chegar aqui quando a
linha era stripe com id registrado batendo; o CAS apenas afirma que isso continua verdade no
instante da escrita.

Adicionar `InvoiceSubscriptionSource` ao import de `billing-logic.ts` (import de tipo). O cast
`invoice as InvoiceSubscriptionSource` é necessário porque o tipo `Stripe.Invoice` do SDK v17
(acacia) não declara `parent` — mas o payload em runtime segue a versão da CONTA, que pode ser
basil.

- [ ] **Step 7: Typecheck da function + suíte completa**

Run: `deno check supabase/functions/stripe-webhook/index.ts && npm run test:functions`
Expected: check limpo; suíte inteira PASS (nenhum teste existente muda nesta task).

- [ ] **Step 8: Reverter deno.lock e commitar**

```bash
git checkout -- deno.lock
git add supabase/functions/_shared/billing-logic.ts supabase/functions/stripe-webhook/index.ts supabase/functions/__tests__/billing-logic_test.ts
git commit -m "feat(billing): stripe-webhook ownership guard via canWebhookWrite

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: platform-admin provider-aware (pricing + detail)

**Files:**
- Modify: `supabase/functions/platform-admin/pricing.ts` (`PriceableSub`, `resolveMirrorAmount`,
  `priceSubscriptionRows`)
- Modify: `supabase/functions/platform-admin/index.ts` (`buildSubscriptionDetail` :394-477;
  selects de `handleGetMrr` :516-521 e `handleGetTrials` :588-593)
- Test: `supabase/functions/__tests__/platform-admin-pricing_test.ts` (atualizar fixtures +
  novos testes)

**Interfaces:**
- Consumes: colunas `provider`, `pagarme_subscription_id`, `installments` de
  `workspace_subscriptions` (migration `20260812000001`, já em prod/staging).
- Produces: `resolveMirrorAmount(s, planMeta)` onde `s` ganha `provider: string | null` e o
  retorno tem `amount_source: "stripe" | "pagarme" | "catalog" | null`; response do
  `get-workspace` (`subscription`) ganha `provider: "stripe" | "pagarme"`,
  `pagarme_subscription_id: string | null`, `installments: number | null` — a Task 3 tipa isso
  no frontend do admin.

**Contexto:** hoje `buildSubscriptionDetail` faz live-fetch na Stripe sempre que
`stripe_subscription_id` existe e ESCREVE o resultado de volta no mirror. Uma linha que migrou
para o Pagar.me ainda carrega o `stripe_subscription_id` antigo: abrir o workspace no admin
sobrescreveria o mirror Pagar.me com o valor da assinatura Stripe morta (clobber). Igualmente,
`resolveMirrorAmount` rotula todo mirror como `"stripe"` e pede live-fetch para qualquer linha
com `stripe_subscription_id`. A regra nova: **provider decide** — linha `pagarme` lê só o
mirror (preenchido sincronamente no checkout da Fase 3), nunca live-fetch, nunca write-back,
sem dashboard URL.

- [ ] **Step 1: Atualizar fixtures existentes + testes novos (failing)**

Em `supabase/functions/__tests__/platform-admin-pricing_test.ts`:

1. Adicionar `provider: "stripe"` a TODOS os objetos passados como primeiro argumento de
   `resolveMirrorAmount` e às rows do teste de `priceSubscriptionRows` (o campo vira
   obrigatório; sem ele o teste nem compila).
2. Adicionar ao fim:

```ts
Deno.test("pagarme mirror-priced row labels amount_source pagarme, no live fetch", () => {
  const r = resolveMirrorAmount(
    {
      provider: "pagarme",
      amount_cents: 95900,
      currency: "brl",
      amount_interval: "year",
      discount_label: null,
      billing_interval: "year",
      stripe_subscription_id: null,
    },
    PRO,
  );
  assertEquals(r, {
    amount_cents: 95900,
    interval: "year",
    discount_label: null,
    amount_source: "pagarme",
    needsLiveFetch: false,
  });
});

Deno.test("unpriced pagarme row with a stale stripe id NEVER asks for a live fetch", () => {
  // A row that switched providers still carries the old stripe_subscription_id. Fetching it
  // live would price the DEAD Stripe subscription and write it over the Pagar.me mirror.
  const r = resolveMirrorAmount(
    {
      provider: "pagarme",
      amount_cents: null,
      currency: null,
      amount_interval: null,
      discount_label: null,
      billing_interval: "year",
      stripe_subscription_id: "sub_dead",
    },
    PRO,
  );
  assertEquals(r.needsLiveFetch, false);
  assertEquals(r.amount_cents, 99000);
  assertEquals(r.amount_source, "catalog");
});

Deno.test("null provider (legacy row) keeps stripe semantics", () => {
  const r = resolveMirrorAmount(
    {
      provider: null,
      amount_cents: 9900,
      currency: "brl",
      amount_interval: "month",
      discount_label: null,
      billing_interval: "month",
      stripe_subscription_id: "sub_1",
    },
    PRO,
  );
  assertEquals(r.amount_source, "stripe");
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `deno test supabase/functions/__tests__/platform-admin-pricing_test.ts`
Expected: FAIL (erro de tipo: `provider` não existe em `PriceableSub`)

- [ ] **Step 3: Implementar em pricing.ts**

Em `supabase/functions/platform-admin/pricing.ts`:

1. `PriceableSub` ganha, logo após `workspace_id`:

```ts
  /** Which provider owns this row ('stripe' | 'pagarme'). NOT NULL in the db (default
   * 'stripe'); nullable here so a missing select surfaces as stripe semantics, never a crash. */
  provider: string | null;
```

2. `resolveMirrorAmount`: incluir `"provider"` no `Pick<...>` do parâmetro `s`; o tipo de
   retorno muda `amount_source` para `"stripe" | "pagarme" | "catalog" | null`; corpo vira:

```ts
  const isPagarme = s.provider === "pagarme";
  if (s.amount_cents != null) {
    return {
      amount_cents: s.amount_cents,
      interval: s.amount_interval ?? s.billing_interval,
      discount_label: s.discount_label,
      amount_source: isPagarme ? "pagarme" : "stripe",
      needsLiveFetch: false,
    };
  }
  const catalog = planMeta
    ? (s.billing_interval === "year" ? planMeta.price_brl_annual : planMeta.price_brl)
    : null;
  return {
    amount_cents: catalog ?? null,
    interval: s.billing_interval,
    discount_label: null,
    amount_source: catalog != null ? "catalog" : null,
    // A Pagar.me row is priced synchronously at checkout; its stripe_subscription_id (if any)
    // is a leftover from before the switch — fetching it would price a dead subscription and
    // write it back over the Pagar.me mirror.
    needsLiveFetch: !isPagarme && !!s.stripe_subscription_id,
  };
```

3. `priceSubscriptionRows`: o tipo de retorno declara
   `amount_source: "stripe" | "pagarme" | "catalog" | null`. E o write-back dentro de
   `liveFetch` ganha CAS no provider — a leitura decidiu `needsLiveFetch` num instante, mas o
   `await` da Stripe abre janela para um bind Pagar.me concorrente trocar o dono da linha;
   sem o predicado, o write-back gravaria o amount Stripe stale por cima do mirror novo:

```ts
      // Write back so the next load reads the mirror instead of Stripe. CAS on provider: if a
      // concurrent Pagar.me bind took the row while the Stripe fetch was in flight, zero rows
      // match — this is an opportunistic cache refresh, so we just skip and log (the in-memory
      // result for THIS response still shows the read-time snapshot, which is acceptable).
      const { data: written, error } = await svc
        .from("workspace_subscriptions")
        .update(buildAmountColumns(amt))
        .eq("workspace_id", r.row.workspace_id)
        .eq("provider", "stripe")
        .select("workspace_id");
      if (error) {
        console.error("[platform-admin] amount write-back failed:", error.message);
      } else if (!written?.length) {
        console.warn(
          `[platform-admin] amount write-back skipped for workspace ${r.row.workspace_id}: provider changed mid-fetch`,
        );
      }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `deno test supabase/functions/__tests__/platform-admin-pricing_test.ts`
Expected: PASS (fixtures atualizadas + 3 novos)

- [ ] **Step 5: buildSubscriptionDetail provider-aware**

Em `supabase/functions/platform-admin/index.ts`, substituir `buildSubscriptionDetail`
(linhas ~394-477) por:

```ts
async function buildSubscriptionDetail(
  svc: ReturnType<typeof createClient>,
  workspaceId: string,
) {
  const { data: row } = await svc
    .from("workspace_subscriptions")
    .select(
      "status, plan_id, billing_interval, current_period_end, cancel_at_period_end, failed_payment_count, stripe_customer_id, stripe_subscription_id, provider, pagarme_subscription_id, installments, amount_cents, gross_cents, currency, amount_interval, discount_label",
    )
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!row) return null;

  let planName: string | null = null;
  if (row.plan_id) {
    const { data: plan } = await svc.from("plans").select("name").eq("id", row.plan_id).single();
    planName = plan?.name ?? null;
  }

  const provider: "stripe" | "pagarme" = row.provider === "pagarme" ? "pagarme" : "stripe";
  const info = {
    provider,
    status: row.status ?? null,
    plan_id: row.plan_id ?? null,
    plan_name: planName,
    billing_interval: row.billing_interval ?? null,
    current_period_end: row.current_period_end ?? null,
    cancel_at_period_end: row.cancel_at_period_end ?? false,
    failed_payment_count: row.failed_payment_count ?? 0,
    stripe_customer_id: row.stripe_customer_id ?? null,
    stripe_subscription_id: row.stripe_subscription_id ?? null,
    pagarme_subscription_id: row.pagarme_subscription_id ?? null,
    installments: (row.installments as number | null) ?? null,
    amount_cents: null as number | null,
    gross_cents: null as number | null,
    currency: null as string | null,
    interval: row.billing_interval ?? null,
    discount_label: null as string | null,
    amount_source: null as "stripe" | "pagarme" | "catalog" | null,
    stripe_dashboard_url: null as string | null,
  };

  // A Pagar.me-owned row reads ONLY the mirror (written synchronously at checkout). Never a
  // Stripe live-fetch (its stripe_subscription_id, if present, is a dead pre-switch leftover
  // whose price would clobber the mirror on write-back) and no dashboard URL in v1.
  if (provider === "pagarme") {
    if (row.amount_cents != null) {
      info.amount_cents = row.amount_cents as number;
      info.gross_cents = (row.gross_cents as number | null) ?? null;
      info.currency = (row.currency as string | null) ?? null;
      info.interval = (row.amount_interval as string | null) ?? row.billing_interval ?? null;
      info.discount_label = (row.discount_label as string | null) ?? null;
      info.amount_source = "pagarme";
      return info;
    }
    return applyCatalogFallback(svc, info, row.plan_id ?? null, row.billing_interval ?? null);
  }

  if (row.stripe_subscription_id) {
    try {
      const { stripe } = await import("../_shared/stripe.ts");
      const amt = await fetchStripeAmount(stripe, row.stripe_subscription_id, row.billing_interval ?? null);
      info.amount_cents = amt.amount_cents;
      info.gross_cents = amt.gross_cents;
      info.currency = amt.currency;
      info.interval = amt.interval;
      info.discount_label = amt.discount_label;
      info.amount_source = "stripe";
      info.stripe_dashboard_url = stripeDashboardUrl(
        amt.livemode,
        "subscriptions",
        row.stripe_subscription_id,
      );
      // Opportunistic refresh: viewing a workspace updates its cached amount, so
      // the list/MRR pages keep reading a mirror that tracks live Stripe. CAS on provider:
      // if a concurrent Pagar.me bind took the row while the Stripe fetch was in flight,
      // zero rows match — skip and log rather than clobbering the fresh Pagar.me mirror.
      const { data: writtenBack, error: writeBackError } = await svc
        .from("workspace_subscriptions")
        .update(buildAmountColumns(amt))
        .eq("workspace_id", workspaceId)
        .eq("provider", "stripe")
        .select("workspace_id");
      if (writeBackError) {
        console.error("[platform-admin] amount write-back failed:", writeBackError.message);
      } else if (!writtenBack?.length) {
        console.warn(
          `[platform-admin] amount write-back skipped for workspace ${workspaceId}: provider changed mid-fetch`,
        );
      }
      return info;
    } catch (err) {
      console.error("[platform-admin] stripe fetch failed:", (err as Error).message);
    }
  }

  return applyCatalogFallback(svc, info, row.plan_id ?? null, row.billing_interval ?? null);
}

/** Fills amount from the plan's list price when neither mirror nor live fetch produced one. */
async function applyCatalogFallback<
  T extends {
    amount_cents: number | null;
    currency: string | null;
    amount_source: "stripe" | "pagarme" | "catalog" | null;
  },
>(
  svc: ReturnType<typeof createClient>,
  info: T,
  planId: string | null,
  billingInterval: string | null,
): Promise<T> {
  if (!planId) return info;
  const { data: plan } = await svc
    .from("plans")
    .select("price_brl, price_brl_annual")
    .eq("id", planId)
    .single();
  const cents = billingInterval === "year" ? plan?.price_brl_annual : plan?.price_brl;
  if (cents != null) {
    info.amount_cents = cents as number;
    info.currency = "brl";
    info.amount_source = "catalog";
  }
  return info;
}
```

(O bloco de catalog-fallback existente no fim da função é REMOVIDO — vira o helper
`applyCatalogFallback`, chamado nos dois pontos.)

- [ ] **Step 6: Selects de MRR e trials ganham provider**

Em `handleGetMrr` (linha ~516) e `handleGetTrials` (linha ~588), adicionar `provider` à
string do `.select(...)` de `workspace_subscriptions` (em ambos, logo após `workspace_id,`).
ATENÇÃO: o client supabase-js aqui é não-tipado (`data` é `any`), então esquecer o select NÃO
falha no typecheck — o campo chega `undefined`, `resolveMirrorAmount` trata como stripe e uma
linha pagarme sem preço voltaria a pedir live-fetch (o clobber que esta task elimina). Este
step é obrigatório e o reviewer deve conferir as duas strings de select.

- [ ] **Step 7: Typecheck + suíte completa**

Run: `deno check supabase/functions/platform-admin/index.ts && npm run test:functions`
Expected: check limpo; suíte inteira PASS.

- [ ] **Step 8: Reverter deno.lock e commitar**

```bash
git checkout -- deno.lock
git add supabase/functions/platform-admin/pricing.ts supabase/functions/platform-admin/index.ts supabase/functions/__tests__/platform-admin-pricing_test.ts
git commit -m "feat(billing): platform-admin prices by provider, never live-fetches pagarme rows

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Tipos e labels do admin (frontend)

**Files:**
- Modify: `apps/admin/src/lib/subscription.ts` (`SubscriptionInfo`)
- Modify: `apps/admin/src/lib/api.ts:306` (`PayingWorkspace.amount_source`)
- Modify: `apps/admin/src/pages/WorkspaceDetailPage.tsx:249-302` (título do card + valor)

**Interfaces:**
- Consumes: response do `get-workspace` da Task 2 (`provider`, `pagarme_subscription_id`,
  `installments`, `amount_source` com `'pagarme'`).
- Produces: nada consumido por tasks futuras desta fase.

**Contexto:** o backend agora devolve `provider`; sem os tipos o admin nem compila contra o
contrato novo, e o card fica mentindo "Assinatura Stripe" para uma linha Pagar.me. Mudança de
UI deliberadamente mínima (a gestão completa de assinante Pagar.me é Fase 6): título dinâmico,
sufixo "12x" no valor quando houver parcelas, e o link "Abrir no Stripe" já some sozinho
(backend manda `stripe_dashboard_url: null` para pagarme).

- [ ] **Step 1: Tipos**

Em `apps/admin/src/lib/subscription.ts`, dentro de `SubscriptionInfo` (linhas 19-37):

- Adicionar como primeiro campo:

```ts
  /** Which billing provider owns this subscription row. */
  provider: 'stripe' | 'pagarme';
```

- Após `stripe_subscription_id`:

```ts
  pagarme_subscription_id: string | null;
  /** Card installments on the annual charge (12 for the Pagar.me 12x plan). */
  installments: number | null;
```

- Trocar a linha `amount_source: 'stripe' | 'catalog' | null;` por
  `amount_source: 'stripe' | 'pagarme' | 'catalog' | null;`

Em `apps/admin/src/lib/api.ts:306`, trocar
`amount_source: 'stripe' | 'catalog' | null;` por
`amount_source: 'stripe' | 'pagarme' | 'catalog' | null;`

- [ ] **Step 2: Card no WorkspaceDetailPage**

Em `apps/admin/src/pages/WorkspaceDetailPage.tsx`:

1. Comentário e título do card (linhas 249-253): trocar

```tsx
      {/* Stripe subscription — the customer's real billing, even when an admin has
          manually comped the effective plan above. */}
      <div className="min-w-0 bg-card border border-border rounded-2xl p-5 mb-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="font-semibold">Assinatura Stripe</h2>
```

por

```tsx
      {/* Provider subscription — the customer's real billing, even when an admin has
          manually comped the effective plan above. */}
      <div className="min-w-0 bg-card border border-border rounded-2xl p-5 mb-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="font-semibold">
            {data.subscription?.provider === 'pagarme' ? 'Assinatura Pagar.me' : 'Assinatura Stripe'}
          </h2>
```

2. No `Field label="Valor"` (linha ~284), logo após `{intervalSuffix(data.subscription.interval)}`:

```tsx
                  {data.subscription.installments != null &&
                    data.subscription.installments > 1 &&
                    ` · ${data.subscription.installments}x`}
```

- [ ] **Step 3: Typecheck + vitest do admin**

Run: `npx tsc -p apps/admin/tsconfig.json --noEmit && npx vitest run apps/admin`
Expected: tsc limpo; testes do admin PASS (nenhum asserta o título do card hoje).

- [ ] **Step 4: Commit**

```bash
git add apps/admin/src/lib/subscription.ts apps/admin/src/lib/api.ts apps/admin/src/pages/WorkspaceDetailPage.tsx
git commit -m "feat(admin): provider-aware subscription types and detail card labels

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Year-guard no billing-checkout

**Files:**
- Modify: `supabase/functions/_shared/billing-logic.ts` (novo helper puro)
- Modify: `supabase/functions/billing-checkout/index.ts:59-64`
- Test: `supabase/functions/__tests__/billing-logic_test.ts` (estender)

**Interfaces:**
- Consumes: coluna `plans.pagarme_12x_enabled` (migration `20260812000001`, default `false`).
- Produces: `annualCheckoutBlocked(interval, plan): boolean` em `_shared/billing-logic.ts`.

**Contexto:** quando o gate ligar (Fase 7), o toggle anual do frontend abre o dialog Pagar.me —
mas uma aba carregada ANTES do flip ainda chamaria `billing-checkout` com `interval: "year"` e
abriria uma assinatura anual à vista na Stripe, exatamente o produto que o 12x substitui. O
guard server-side fecha essa janela. Com o gate desligado (hoje, em todo ambiente), nada muda.

- [ ] **Step 1: Testes do helper (failing)**

Adicionar ao fim de `supabase/functions/__tests__/billing-logic_test.ts` (incluir
`annualCheckoutBlocked` no import de `../_shared/billing-logic.ts`):

```ts
Deno.test("annualCheckoutBlocked blocks year only when the plan is on pagarme 12x", () => {
  assertEquals(annualCheckoutBlocked("year", { pagarme_12x_enabled: true }), true);
  assertEquals(annualCheckoutBlocked("year", { pagarme_12x_enabled: false }), false);
  assertEquals(annualCheckoutBlocked("month", { pagarme_12x_enabled: true }), false);
  assertEquals(annualCheckoutBlocked("year", { pagarme_12x_enabled: null }), false);
  assertEquals(annualCheckoutBlocked("year", null), false);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `deno test supabase/functions/__tests__/billing-logic_test.ts`
Expected: FAIL (`annualCheckoutBlocked` não exportada)

- [ ] **Step 3: Implementar o helper**

Em `supabase/functions/_shared/billing-logic.ts`, após `hasEverSubscribed`:

```ts
/**
 * Once a plan's annual price is sold as 12x via Pagar.me (pagarme_12x_enabled), the Stripe
 * annual checkout must refuse: a tab loaded before the cutover could otherwise still open a
 * one-shot annual Stripe subscription. Monthly plans stay on Stripe and are never blocked.
 * Fail-open on a missing plan/flag: the gate defaulting to off is the rollout switch.
 */
export function annualCheckoutBlocked(
  interval: "month" | "year",
  plan: { pagarme_12x_enabled?: boolean | null } | null | undefined,
): boolean {
  return interval === "year" && plan?.pagarme_12x_enabled === true;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `deno test supabase/functions/__tests__/billing-logic_test.ts`
Expected: PASS

- [ ] **Step 5: Fiar no billing-checkout**

Em `supabase/functions/billing-checkout/index.ts`:

1. Import: adicionar `annualCheckoutBlocked` ao import existente de
   `../_shared/billing-logic.ts` (linha 11).
2. Select do plano (linha ~61): trocar
   `.select("id, stripe_price_id, stripe_price_id_annual")` por
   `.select("id, stripe_price_id, stripe_price_id_annual, pagarme_12x_enabled")`.
3. Entre o select do plano e o resolve do `priceId` (antes da linha
   `const priceId = ...`), inserir:

```ts
    // Post-cutover, the annual plan is sold as 12x via Pagar.me; a pre-cutover tab must not
    // open a one-shot annual Stripe subscription. Monthly is unaffected.
    if (annualCheckoutBlocked(interval, plan)) {
      return json(
        { error: "O plano anual agora é parcelado em 12x no cartão. Atualize a página para assinar." },
        400,
        headers,
      );
    }
```

- [ ] **Step 6: Typecheck + suíte completa**

Run: `deno check supabase/functions/billing-checkout/index.ts && npm run test:functions`
Expected: check limpo; suíte inteira PASS.

- [ ] **Step 7: Reverter deno.lock e commitar**

```bash
git checkout -- deno.lock
git add supabase/functions/_shared/billing-logic.ts supabase/functions/billing-checkout/index.ts supabase/functions/__tests__/billing-logic_test.ts
git commit -m "feat(billing): billing-checkout refuses annual interval for pagarme-12x plans

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Verificação final da fase (antes do PR)

Bateria completa de CI local, na ordem:

```bash
npm run lint
npm run format:check
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
npm run test:functions
git checkout -- deno.lock
```

Deploy (após merge): `db push` não é necessário (nenhuma migration nova); functions afetadas =
`stripe-webhook`, `platform-admin`, `billing-checkout` (`--no-verify-jwt --use-api`), prod E
staging.
