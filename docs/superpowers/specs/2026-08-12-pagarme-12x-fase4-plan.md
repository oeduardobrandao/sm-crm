# Fase 4 — pagarme-webhook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Webhook reconciliador do Pagar.me (`pagarme-webhook`): dedup por event id, Basic auth +
token no path, fetch-before-trust, paid-through, dunning correlacionado por charge — mais o
hardening do stripe-webhook (checkout negado cancela a subscription Stripe recém-criada) e a
parametrização do log prefix do dunning-notify.

**Architecture:** Mesma estrutura da Fase 3 (`pagarme-checkout`): `logic.ts` puro →
`gateway.ts` (porta sobre `pagarmeFetch`) → `handler.ts` (injeção de `db`/`gateway`/`notify`) →
`index.ts` (serve shell com auth). O webhook NUNCA aplica estado do payload: re-busca a
subscription na API e escreve o estado re-buscado com CAS pinado em provider + subscription id.
Charge.\* é a família autoritativa para estado de pagamento; invoice.\* é ack.

**Tech Stack:** Deno edge functions, `npm:@supabase/supabase-js@2`, `pagarmeFetch` (Fase 1),
`canWebhookWrite`/`mapPagarmeTemporalFields`/`buildChargeDunningKey` (Fase 1),
`plan-writer`/`dunning-logic`/`dunning-notify`/`dunning-email` (extração Fase 1).

## Evidências que fundamentam o desenho (Fase 0, GO-NO-GO.md critério 7)

- Vocabulário real: `subscription.created/updated/canceled`, `invoice.created/paid`,
  `charge.created/paid`. As DUAS famílias disparam para o mesmo ciclo; charge.\* é autoritativa.
- Envelope: `{ id: "hook_...", account, type, created_at, data }` — dedup por `id`.
- Charge payload inclui `invoice` (com `subscriptionId`), `last_transaction` e
  `recurrence_cycle`. **Shape exato do campo de attempt é DESCONHECIDO** (sandbox não produz
  `payment_failed`): extração defensiva, degradação segura first/retry.
- Auth de entrega = **HTTP Basic simples** (user:senha do toggle "Habilitar autenticação" no
  dashboard). Sem HMAC. Fronteira: Basic (timing-safe) + token no path + fetch-before-trust.
- Entregas em rajada no mesmo segundo, ordem NÃO garantida.
- Retentativas: até 3 (config do dashboard). Sub desconhecida → 5xx: corrida com o bind do
  checkout se resolve num retry; sub alheia morre após o budget.
- Cancel response RETÉM `current_cycle` com `status: "billed"` (out/15, out/20) → é o marcador
  de "ciclo pago" para paid-through.
- Sub `future` não tem `next_billing_at` nem `current_cycle` (out/12).
- `POST /hooks` = 405: registro de endpoint é dashboard-only (ação do Eduardo no rollout).

## Global Constraints

Todo task herda estas regras; o reviewer as recebe verbatim.

1. **Deno, não Node**: imports `npm:` ou relativos `.ts`. Nunca CommonJS.
2. **Todo DB call é bounded**: `.abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))` com
   `const DB_TIMEOUT_MS = 10_000;` no módulo (regra da casa; precedente pagarme-checkout).
3. **Nunca logar payload de webhook nem dados de cliente** (LGPD/PCI: payload carrega nome,
   e-mail, last4). Logs só com: envelope id, type, sub/charge ids, workspace id, `err.message`.
   Nunca `console.log(payload)`, nunca o header Authorization recebido.
4. **Respostas HTTP genéricas** ("Unauthorized", "Handler error"); detalhe fica no log interno.
5. **Fetch-before-trust**: nenhum write de estado deriva do payload; só do objeto re-buscado
   via `gateway.fetchSubscription`.
6. **Webhook nunca troca provider**: todo UPDATE é CAS
   `.eq("workspace_id", ...).eq("provider", "pagarme").eq("pagarme_subscription_id", subId)`
   com `.select("workspace_id")`; zero linhas → throw → 5xx → redelivery re-decide.
   Erros de write → throw (write falho nunca dá ack).
7. **`current_period_end` armazenado NUNCA é sobrescrito com null em cancelamento** —
   `isPaidThrough` depende do valor retido.
8. **5xx = redelivery** (sem insert no ledger); ack = 200 + insert em `pagarme_webhook_events`.
9. **Dunning**: e-mail só APÓS write bem-sucedido; mesmo `charge_id:attempt` nunca re-envia nem
   re-avança; `final` só com estado terminal re-buscado dentro do handler de payment_failed;
   cancelamento voluntário nunca dispara e-mail de dunning.
10. **Testes**: fake db no padrão thenable de
    `supabase/functions/__tests__/pagarme-checkout-handler_test.ts` (leia-o antes de escrever
    testes de handler). `npm run test:functions` suja `deno.lock` → `git checkout -- deno.lock`.
    Se prettier/tsc acusarem lixo em arquivos não tocados: `ls node_modules/.deno` (poluição
    deno) → `npm ci` antes de confiar.
11. **Commits**: mensagens `feat(billing):`/`fix(billing):`/etc., terminando com
    `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
12. Sem copy de usuário nesta fase (e-mails reutilizam templates existentes de dunning-email).
    Qualquer string PT-BR nova: sem travessão (em dash).
13. Migration nova: prefixo de versão ÚNICO acima do tail de
    `git ls-tree origin/main:supabase/migrations | tail` — re-verificar na hora do PR
    (migration-version-guard; já mordeu duas vezes).

---

### Task 1: Migration `pagarme_dunning_key` + `pagarme-webhook/logic.ts` puro + testes

**Files:**
- Create: `supabase/migrations/20260813000001_pagarme_dunning_key.sql`
- Create: `supabase/functions/pagarme-webhook/logic.ts`
- Test: `supabase/functions/__tests__/pagarme-webhook-logic_test.ts`

**Interfaces:**
- Consumes: `normalizePagarmeStatus`, `mapPagarmeTemporalFields` de `_shared/pagarme-logic.ts`;
  `buildRecoveryEpisode`, `DunningStage` de `_shared/dunning-logic.ts`.
- Produces (Task 3 depende): `parseWebhookEnvelope(raw): WebhookEnvelope | null`,
  `extractChargeSubscriptionId(data): string | null`, `extractChargeAttempt(data): number | null`,
  `isTerminalRemoteStatus(status): boolean`,
  `selectPagarmeDunningStage(failedCount): "first" | "retry"`,
  `buildReconcileColumns(remote, stored, source, now): ReconcileResult | null`.

- [ ] **Step 1: Migration**

```sql
-- Correlação de dunning do Pagar.me: última chave charge_id:attempt processada.
-- Mesmo par charge+attempt = redelivery (nunca re-avança estágio nem re-envia e-mail);
-- par novo = retry real (avança). Ver buildChargeDunningKey em _shared/pagarme-logic.ts.
alter table workspace_subscriptions add column pagarme_dunning_key text;

comment on column workspace_subscriptions.pagarme_dunning_key is
  'Last processed Pagar.me charge-failure dunning key (charge_id:attempt). Redeliveries repeat the key and never advance the dunning stage.';
```

Antes de commitar: `git ls-tree origin/main:supabase/migrations | tail -3` e confirme que
`20260813000001` é maior que o último prefixo. Se não for, renumere acima.

- [ ] **Step 2: `logic.ts` completo**

```ts
// Pure helpers for pagarme-webhook. No network/env/Supabase dependencies — unit-testable in
// isolation, mirroring pagarme-checkout/logic.ts.

import { buildRecoveryEpisode, type DunningStage } from "../_shared/dunning-logic.ts";
import { mapPagarmeTemporalFields, normalizePagarmeStatus } from "../_shared/pagarme-logic.ts";

/** Envelope real capturado no spike: { id: "hook_...", account, type, created_at, data }. */
export interface WebhookEnvelope {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

/** Null for anything that is not an object carrying non-empty string id/type and an object data. */
export function parseWebhookEnvelope(raw: unknown): WebhookEnvelope | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || r.id.length === 0) return null;
  if (typeof r.type !== "string" || r.type.length === 0) return null;
  if (typeof r.data !== "object" || r.data === null || Array.isArray(r.data)) return null;
  return { id: r.id, type: r.type, data: r.data as Record<string, unknown> };
}

/**
 * Resolves the subscription id carried by a charge event. The spike proved charge payloads embed
 * the invoice (with its subscription pointer) but the exact key casing was not capturable in
 * sandbox, so every plausible path is tried. The sub_ prefix requirement keeps a wrong pick from
 * ever resolving: an unrecognized shape returns null and the event is acked as unhandleable
 * (subscription.* events for the same burst still converge the state).
 */
export function extractChargeSubscriptionId(data: Record<string, unknown>): string | null {
  const candidates: unknown[] = [];
  const invoice = data.invoice;
  if (typeof invoice === "object" && invoice !== null && !Array.isArray(invoice)) {
    const inv = invoice as Record<string, unknown>;
    candidates.push(inv.subscription_id, inv.subscriptionId);
  }
  const subscription = data.subscription;
  if (typeof subscription === "object" && subscription !== null && !Array.isArray(subscription)) {
    candidates.push((subscription as Record<string, unknown>).id);
  }
  candidates.push(data.subscription_id);
  for (const c of candidates) {
    if (typeof c === "string" && c.startsWith("sub_")) return c;
  }
  return null;
}

/** Attempt-count fields are undocumented (support question 5 pending); probe defensively. */
export function extractChargeAttempt(data: Record<string, unknown>): number | null {
  const lastTx = data.last_transaction;
  const candidates: unknown[] = [
    typeof lastTx === "object" && lastTx !== null && !Array.isArray(lastTx)
      ? (lastTx as Record<string, unknown>).attempt_count
      : undefined,
    data.attempt_count,
    data.attempt,
  ];
  for (const c of candidates) {
    if (typeof c === "number" && Number.isFinite(c)) return c;
  }
  return null;
}

/** `failed` nasce quando a cobrança falha terminalmente (achado 3 do spike). */
export function isTerminalRemoteStatus(status: string): boolean {
  return status === "canceled" || status === "failed";
}

/**
 * Pagar.me does not expose a next-retry field (unlike Stripe, whose null next_payment_attempt IS
 * the final signal), so stages degrade to first/retry only. "final" is never selected from
 * counts: it is reserved for a terminal re-fetched subscription status inside the
 * charge.payment_failed handler.
 */
export function selectPagarmeDunningStage(failedCount: number): DunningStage {
  return failedCount <= 1 ? "first" : "retry";
}

export type ReconcileSource = "subscription" | "charge_paid";

export interface RemoteSubscriptionFields {
  status: string;
  start_at?: string | null;
  next_billing_at?: string | null;
  current_cycle?: { end_at?: string | null; status?: string | null } | null;
}

export interface StoredRowSnapshot {
  status: string | null;
  current_period_end: string | null;
}

export interface ReconcileResult {
  status: "trialing" | "active" | "canceled";
  /** True when the caller should also resolve and write the effective plan. */
  planEligible: boolean;
  columns: Record<string, unknown>;
}

/**
 * Columns to CAS-write for a re-fetched subscription. Three rules the tests pin down:
 *
 * 1. A canceled subscription NEVER clobbers the stored current_period_end (isPaidThrough depends
 *    on it), and cancel_at_period_end doubles as our paid-through marker: true only when the
 *    canceled sub's current_cycle.status is "billed" (the year was paid — out/15/20 show the
 *    cycle is retained on cancel). A trial cancel has no cycle → false → immediate downgrade.
 * 2. Payment truth lives in charge.*: a subscription.* event observing remote "active" while the
 *    row is in a dunning episode (status past_due) must NOT reset the episode nor the status —
 *    only charge.paid (source "charge_paid") or a terminal outcome closes an episode.
 * 3. An in-force write resets the dunning episode AND pagarme_dunning_key in the same statement.
 */
export function buildReconcileColumns(
  remote: RemoteSubscriptionFields,
  stored: StoredRowSnapshot,
  source: ReconcileSource,
  now: Date,
): ReconcileResult | null {
  const normalized = normalizePagarmeStatus(remote.status);
  if (normalized === null) return null;

  const mapped = mapPagarmeTemporalFields(remote);
  const current_period_end = mapped.current_period_end ?? stored.current_period_end;
  const cancel_at_period_end = normalized === "canceled"
    ? remote.current_cycle?.status === "billed"
    : false;

  const holdDunning = source === "subscription" &&
    stored.status === "past_due" &&
    normalized === "active";
  if (holdDunning) {
    return {
      status: normalized,
      planEligible: false,
      columns: {
        current_period_end,
        cancel_at_period_end,
        updated_at: now.toISOString(),
      },
    };
  }

  const inForce = normalized === "active" || normalized === "trialing";
  return {
    status: normalized,
    planEligible: true,
    columns: {
      status: normalized,
      current_period_end,
      cancel_at_period_end,
      ...(inForce ? { ...buildRecoveryEpisode(), pagarme_dunning_key: null } : {}),
      updated_at: now.toISOString(),
    },
  };
}
```

- [ ] **Step 3: Testes** (`deno test --allow-env supabase/functions/__tests__/pagarme-webhook-logic_test.ts` — siga o cabeçalho de imports de `pagarme-checkout-logic_test.ts`)

Casos, todos com assert de valor exato:

`parseWebhookEnvelope`:
1. Envelope válido `{id:"hook_1", account:{}, type:"charge.paid", created_at:"...", data:{id:"ch_1"}}` → `{id:"hook_1", type:"charge.paid", data:{id:"ch_1"}}` (account/created_at descartados).
2. `null`, `"str"`, `[]` → null.
3. `{type:"x", data:{}}` (sem id), `{id:"", type:"x", data:{}}`, `{id:"h", data:{}}` (sem type), `{id:"h", type:"x"}` (sem data), `{id:"h", type:"x", data:[]}` → null em todos.

`extractChargeSubscriptionId`:
4. `{invoice:{subscription_id:"sub_A"}}` → "sub_A".
5. `{invoice:{subscriptionId:"sub_B"}}` → "sub_B" (casing alternativo).
6. `{subscription:{id:"sub_C"}}` → "sub_C".
7. `{subscription_id:"sub_D"}` → "sub_D".
8. Precedência: `{invoice:{subscription_id:"sub_A"}, subscription_id:"sub_D"}` → "sub_A".
9. `{invoice:{subscription_id:"inv_X"}}` → null (prefixo errado nunca resolve).
10. `{}` → null.

`extractChargeAttempt`:
11. `{last_transaction:{attempt_count:3}}` → 3.
12. `{attempt_count:2}` → 2; `{attempt:1}` → 1.
13. `{last_transaction:{attempt_count:"3"}}` → null (string não conta); `{}` → null.

`isTerminalRemoteStatus`: 14. "canceled" e "failed" → true; "active", "future", "paused" → false.

`selectPagarmeDunningStage`: 15. 0→"first", 1→"first", 2→"retry", 7→"retry". Nunca "final".

`buildReconcileColumns` (fixe `now = new Date("2026-08-12T12:00:00Z")`):
16. Ativo pleno: remote `{status:"active", current_cycle:{end_at:"2027-08-10T23:59:59Z", status:"billed"}, next_billing_at:"2027-08-11T00:00:00Z"}`, stored `{status:"trialing", current_period_end:"2026-09-11T00:00:00Z"}`, source "subscription" → `planEligible:true`, columns com `status:"active"`, `current_period_end:"2027-08-10T23:59:59Z"`, `cancel_at_period_end:false`, `past_due_since:null`, `next_payment_attempt:null`, `failed_payment_count:0`, `pagarme_dunning_key:null`, `updated_at:"2026-08-12T12:00:00.000Z"`.
17. Trial: remote `{status:"future", start_at:"2026-09-11T00:00:00Z"}`, stored `{status:null, current_period_end:null}` → status "trialing", `current_period_end:"2026-09-11T00:00:00Z"`, recovery presente.
18. Cancel pago (paid-through): remote `{status:"canceled", current_cycle:{end_at:"2027-08-10T23:59:59Z", status:"billed"}}`, stored `{status:"active", current_period_end:"2027-08-10T23:59:59Z"}` → status "canceled", `cancel_at_period_end:true`, `current_period_end:"2027-08-10T23:59:59Z"` (retido; mapPagarmeTemporalFields devolve null para canceled), SEM campos de recovery no objeto columns (`"past_due_since" in columns === false`).
19. Cancel de trial: remote `{status:"canceled"}` (sem current_cycle), stored `{status:"trialing", current_period_end:"2026-09-11T00:00:00Z"}` → `cancel_at_period_end:false`, `current_period_end` retido "2026-09-11T00:00:00Z".
20. Dunning hold: remote `{status:"active", current_cycle:{end_at:"2027-08-10T23:59:59Z", status:"billed"}}`, stored `{status:"past_due", current_period_end:"2026-08-10T00:00:00Z"}`, source "subscription" → `planEligible:false`, `"status" in columns === false`, `"past_due_since" in columns === false`, `current_period_end:"2027-08-10T23:59:59Z"`.
21. Recovery por charge.paid: mesmo remote/stored do caso 20 mas source "charge_paid" → `planEligible:true`, `status:"active"`, recovery presente com `pagarme_dunning_key:null`.
22. Status desconhecido: remote `{status:"paused"}` → null.
23. `failed` remoto: remote `{status:"failed"}`, stored `{status:"past_due", current_period_end:"2026-08-10T00:00:00Z"}` → status "canceled", `cancel_at_period_end:false`, período retido.

- [ ] **Step 4: Rode** `deno test` no arquivo novo (deve passar), depois `git checkout -- deno.lock`.
- [ ] **Step 5: Commit** `feat(billing): pagarme-webhook pure logic + dunning-key column`

---

### Task 2: dunning-notify parametrizado + hardening do checkout negado no stripe-webhook

**Files:**
- Modify: `supabase/functions/_shared/dunning-notify.ts`
- Modify: `supabase/functions/_shared/pagarme-logic.ts` (novo helper no fim do arquivo)
- Modify: `supabase/functions/stripe-webhook/index.ts` (branch de denial em `syncSubscription`
  ~linha 125 e call site do notify ~linha 294)
- Test: `supabase/functions/__tests__/pagarme-logic_test.ts` (append)

**Interfaces:**
- Produces: `notifyOwnerOfFailure(svc, workspaceId, notice: { stage: DunningStage; nextPaymentAttemptIso: string | null }, opts?: { logPrefix?: string })` — Task 3/4 consomem via injeção;
  `shouldCancelDeniedCheckoutSub(hasSession: boolean, remoteStatus: string): boolean`.
- Consumers do contrato antigo (grep já feito): APENAS `stripe-webhook/index.ts`. Não há teste
  de dunning-notify. Re-grep `notifyOwnerOfFailure` em `supabase/` e `apps/` antes de commitar.

- [ ] **Step 1: Novo contrato do `dunning-notify.ts`**

O stage passa a vir do caller (o Pagar.me não tem `nextPaymentAttempt`, então
`selectDunningStage` de Stripe não pode ficar hardcoded aqui) e o log prefix é parametrizado
(gotcha da Fase 1: `[stripe-webhook]` hardcoded mentiria no pagarme-webhook).

```ts
import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { DunningStage } from "./dunning-logic.ts";
import { sendDunningEmail } from "./dunning-email.ts";
import { appBaseUrl } from "./app-url.ts";

/**
 * Tell the owner their payment failed. Swallows everything: a throw here would 500 the handler,
 * the gateway would redeliver, and the customer would get the same mail again.
 *
 * The owner is the only role that can act — billing-checkout and billing-portal are owner-gated.
 * The caller picks the stage: Stripe derives it from attempt_count/next_payment_attempt,
 * Pagar.me from its own failed-count rule (selectPagarmeDunningStage).
 */
// Review de spec (Codex): este arquivo é reescrito nesta fase, então as queries PostgREST
// entram na regra da casa de DB bounded. auth.admin.getUserById é GoTrue (sem API de abort);
// o try/catch envolvente já engole um hang eventual sem derrubar o handler.
const DB_TIMEOUT_MS = 10_000;

export async function notifyOwnerOfFailure(
  svc: SupabaseClient,
  workspaceId: string,
  notice: { stage: DunningStage; nextPaymentAttemptIso: string | null },
  opts?: { logPrefix?: string },
) {
  const logPrefix = opts?.logPrefix ?? "[dunning-notify]";
  try {
    const { data: ws } = await svc
      .from("workspaces").select("name").eq("id", workspaceId)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)).maybeSingle();

    // workspace_members, not profiles.conta_id: profiles has no email column, and conta_id is the
    // legacy single-workspace field. This is the path platform-admin already uses.
    const { data: ownerMember } = await svc
      .from("workspace_members").select("user_id")
      .eq("workspace_id", workspaceId).eq("role", "owner").limit(1)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)).maybeSingle();
    if (!ownerMember?.user_id) return;

    const { data: ownerUser } = await svc.auth.admin.getUserById(ownerMember.user_id as string);
    const to = ownerUser?.user?.email;
    if (!to) return;

    await sendDunningEmail({
      to,
      stage: notice.stage,
      workspaceName: (ws?.name as string | undefined) ?? "seu workspace",
      nextAttemptLabel: formatAttemptLabel(notice.nextPaymentAttemptIso),
      billingUrl: `${appBaseUrl()}/configuracao/cobranca`,
    });
  } catch (e) {
    // Internal log only — CLAUDE.md's "generic message" rule governs client responses, not
    // server logs. Without the workspace id and reason, a dead Resend key looks exactly like a
    // one-off blip, and nobody can tell which owner was never warned before losing access.
    console.error(
      `${logPrefix} dunning notification failed for workspace ${workspaceId}:`,
      e instanceof Error ? e.message : String(e),
    );
  }
}

/** "2026-07-24T10:00:00.000Z" -> "24 de julho". Null when the gateway will not retry again. */
function formatAttemptLabel(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "long" });
}
```

(O import de `selectDunningStage` sai deste arquivo.)

- [ ] **Step 2: Call site no stripe-webhook** — em `handlePaymentFailed`, o bloco final vira:

```ts
await notifyOwnerOfFailure(
  svc,
  row.workspace_id as string,
  {
    stage: selectDunningStage(invoice.attempt_count ?? 0, nextAttempt),
    nextPaymentAttemptIso: episode.next_payment_attempt,
  },
  { logPrefix: "[stripe-webhook]" },
);
```

`selectDunningStage` entra no import de `_shared/dunning-logic.ts` já existente no topo.

- [ ] **Step 3: Helper puro em `_shared/pagarme-logic.ts`** (append no fim):

```ts
/**
 * Enforcement arm of the cross-provider guard, for the ONE event where deny is not enough:
 * checkout.session.completed. With a session present, canWebhookWrite(..., isAuthorizedBind:
 * true) only returns false on the cross-provider in-force/paid-through branch — meaning the
 * customer just PAID for a brand-new Stripe subscription that will never be bound (a Stripe
 * Checkout Session lives 24h, so serializing checkout STARTS cannot prevent this completion).
 * The just-created subscription must be canceled, not acked. `remoteStatus === "canceled"`
 * means a redelivery after a successful cancel: nothing left to do, ack.
 */
export function shouldCancelDeniedCheckoutSub(
  hasSession: boolean,
  remoteStatus: string,
): boolean {
  return hasSession && remoteStatus !== "canceled";
}
```

- [ ] **Step 4: Branch de denial em `syncSubscription`** — substitua o bloco `if (!allowed) {...}` por:

```ts
if (!allowed) {
  if (shouldCancelDeniedCheckoutSub(session != null, sub.status)) {
    // Fase 3 review hardening: a denied checkout.session.completed strands a PAID Stripe
    // subscription (the deny is the cross-provider guard). Cancel it so it never invoices
    // again; a cancel failure throws → 5xx → Stripe redelivers and retries the cancel
    // (the redelivered event re-retrieves the sub; once canceled this branch acks).
    await stripe.subscriptions.cancel(sub.id);
    console.error(
      `[stripe-webhook] CRITICAL: canceled stripe subscription ${sub.id} from denied checkout on workspace ${workspaceId} (cross-provider conflict); check for a first payment to refund manually`,
    );
    return;
  }
  console.warn(
    `[stripe-webhook] write denied for subscription ${sub.id} on workspace ${workspaceId}: row not owned by this stripe subscription`,
  );
  return;
}
```

`shouldCancelDeniedCheckoutSub` entra no import de `_shared/pagarme-logic.ts` já existente.

- [ ] **Step 5: `shouldAdvanceDunning` monotônico** (review de spec, P1): em
  `_shared/pagarme-logic.ts`, substitua o corpo de `shouldAdvanceDunning` (assinatura idêntica):

```ts
/**
 * True only when the incoming charge+attempt key should advance the dunning stage. A repeated
 * key is a redelivery and never advances. When both keys carry the SAME charge id and numeric
 * attempts, only a HIGHER attempt advances: an out-of-order delivery of attempt 1 arriving
 * after attempt 2 must not regress the stored key (a later redelivery of attempt 2 would then
 * advance and e-mail again). Different charge ids or non-numeric attempts ("na") cannot be
 * ordered and keep the plain inequality rule.
 */
export function shouldAdvanceDunning(
  lastKey: string | null | undefined,
  incomingKey: string,
): boolean {
  if (lastKey === incomingKey) return false;
  if (!lastKey) return true;
  const lastSep = lastKey.lastIndexOf(":");
  const inSep = incomingKey.lastIndexOf(":");
  if (lastSep === -1 || inSep === -1) return true;
  if (lastKey.slice(0, lastSep) !== incomingKey.slice(0, inSep)) return true;
  const lastAttempt = Number(lastKey.slice(lastSep + 1));
  const inAttempt = Number(incomingKey.slice(inSep + 1));
  if (!Number.isFinite(lastAttempt) || !Number.isFinite(inAttempt)) return true;
  return inAttempt > lastAttempt;
}
```

  Antes de commitar, grep os testes existentes de `shouldAdvanceDunning` em
  `pagarme-logic_test.ts` e ajuste os que assumirem a regra antiga de desigualdade pura.

- [ ] **Step 6: Testes** em `pagarme-logic_test.ts` (append, siga o estilo do arquivo):
  - `shouldCancelDeniedCheckoutSub(true, "active")` → true; `(true, "trialing")` → true;
    `(true, "incomplete")` → true.
  - `(false, "active")` → false (evento não-checkout nunca cancela).
  - `(true, "canceled")` → false (redelivery pós-cancel dá ack).
  - `shouldAdvanceDunning`: `("ch_1:1","ch_1:2")` → true; `("ch_1:2","ch_1:1")` → false
    (regressão bloqueada); `("ch_1:1","ch_1:1")` → false; `(null,"ch_1:1")` → true;
    `("ch_1:na","ch_1:1")` → true; `("ch_1:1","ch_1:na")` → true; `("ch_1:2","ch_2:1")` → true.
- [ ] **Step 7: Rode** `deno test` em `pagarme-logic_test.ts` (o typecheck das functions é o
  próprio deno); depois `git checkout -- deno.lock`.
- [ ] **Step 8: Commit** `feat(billing): denied checkout cancels stripe sub; dunning-notify caller-driven stage`

---

### Task 3: `pagarme-webhook/gateway.ts` + `handler.ts` + testes de handler

**Files:**
- Create: `supabase/functions/pagarme-webhook/gateway.ts`
- Create: `supabase/functions/pagarme-webhook/handler.ts`
- Modify: `supabase/functions/pagarme-webhook/logic.ts` (append `shouldSendTerminalDunningEmail`)
- Test: `supabase/functions/__tests__/pagarme-webhook-handler_test.ts`
- Test: `supabase/functions/__tests__/pagarme-webhook-logic_test.ts` (append)

**Interfaces:**
- Consumes: tudo de `pagarme-webhook/logic.ts` (Task 1); `canWebhookWrite`,
  `buildChargeDunningKey`, `shouldAdvanceDunning`, `resolvePagarmePlanTarget` de
  `_shared/pagarme-logic.ts`; `buildFailureEpisode` de `_shared/dunning-logic.ts`;
  `writeWorkspacePlan` de `_shared/plan-writer.ts`; `pagarmeFetch` de `_shared/pagarme.ts`.
- Produces (Task 4 consome): `createPagarmeWebhookGateway(): WebhookGateway`;
  `createPagarmeWebhookHandler(deps: { db; gateway; notify; now? }): (envelope: WebhookEnvelope) => Promise<string>`.

- [ ] **Step 1: `gateway.ts`**

```ts
// Thin port over pagarmeFetch so the handler is testable with a fake gateway,
// mirroring pagarme-checkout/gateway.ts.

import { pagarmeFetch } from "../_shared/pagarme.ts";
import type { RemoteSubscriptionFields } from "./logic.ts";

export interface RemoteSubscription extends RemoteSubscriptionFields {
  id: string;
  metadata?: Record<string, string> | null;
}

export interface WebhookGateway {
  /** GET /subscriptions/{id} — fetch-before-trust source of truth. Throws PagarmeApiError/timeout. */
  fetchSubscription(subId: string): Promise<RemoteSubscription>;
}

export function createPagarmeWebhookGateway(): WebhookGateway {
  return {
    fetchSubscription: (subId) =>
      pagarmeFetch<RemoteSubscription>("GET", `/subscriptions/${subId}`),
  };
}
```

- [ ] **Step 2: `handler.ts` completo**

```ts
// Event handler for pagarme-webhook. The serve shell (index.ts) owns auth, dedup and HTTP;
// this module owns event semantics. Every DB call is bounded (house rule). Throws propagate
// to the shell → 5xx → Pagar.me redelivers (up to 3 attempts, dashboard-configured).

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  buildChargeDunningKey,
  canWebhookWrite,
  resolvePagarmePlanTarget,
  shouldAdvanceDunning,
} from "../_shared/pagarme-logic.ts";
import { buildFailureEpisode, type DunningStage } from "../_shared/dunning-logic.ts";
import { writeWorkspacePlan } from "../_shared/plan-writer.ts";
import {
  buildReconcileColumns,
  extractChargeAttempt,
  extractChargeSubscriptionId,
  isTerminalRemoteStatus,
  selectPagarmeDunningStage,
  shouldSendTerminalDunningEmail,
  type ReconcileSource,
  type WebhookEnvelope,
} from "./logic.ts";
import type { RemoteSubscription, WebhookGateway } from "./gateway.ts";

const DB_TIMEOUT_MS = 10_000;

const ROW_COLUMNS =
  "workspace_id, plan_id, provider, stripe_subscription_id, pagarme_subscription_id, status, cancel_at_period_end, current_period_end, past_due_since, failed_payment_count, pagarme_dunning_key";

interface SubscriptionRow {
  workspace_id: string;
  plan_id: string | null;
  provider: string | null;
  stripe_subscription_id: string | null;
  pagarme_subscription_id: string | null;
  status: string | null;
  cancel_at_period_end: boolean | null;
  current_period_end: string | null;
  past_due_since: string | null;
  failed_payment_count: number | null;
  pagarme_dunning_key: string | null;
}

// deno-lint-ignore no-explicit-any
type WebhookDb = any;

export interface PagarmeWebhookDeps {
  db: WebhookDb;
  gateway: WebhookGateway;
  /** Wired to notifyOwnerOfFailure in index.ts; injected so tests capture e-mails. */
  notify: (workspaceId: string, stage: DunningStage) => Promise<void>;
  now?: () => Date;
}

export function createPagarmeWebhookHandler(deps: PagarmeWebhookDeps) {
  const now = deps.now ?? (() => new Date());

  async function loadRow(subId: string): Promise<SubscriptionRow | null> {
    const { data, error } = await deps.db
      .from("workspace_subscriptions")
      .select(ROW_COLUMNS)
      .eq("pagarme_subscription_id", subId)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .maybeSingle();
    if (error) throw new Error(`row read failed for ${subId}: ${error.message}`);
    return (data as SubscriptionRow | null) ?? null;
  }

  /** Null when the write must not happen (ownership/metadata); throws to request redelivery. */
  async function authorize(subId: string): Promise<
    { row: SubscriptionRow; remote: RemoteSubscription } | null
  > {
    const row = await loadRow(subId);
    if (row === null) {
      // Checkout-bind race (resolved by a redelivery) or a subscription this account does not
      // track (dies after Pagar.me's 3-attempt budget). Either way: 5xx, never ack.
      throw new Error(`no local row for subscription ${subId}`);
    }
    const allowed = canWebhookWrite(
      row,
      { provider: "pagarme", subscriptionId: subId, isAuthorizedBind: false },
      now(),
    );
    if (!allowed) {
      console.warn(
        `[pagarme-webhook] write denied for subscription ${subId} on workspace ${row.workspace_id}: row not owned by this pagarme subscription`,
      );
      return null;
    }
    const remote = await deps.gateway.fetchSubscription(subId);
    const metaWs = remote.metadata?.workspace_id;
    if (metaWs && metaWs !== row.workspace_id) {
      console.error(
        `[pagarme-webhook] metadata divergence for subscription ${subId}: remote workspace ${metaWs} != local ${row.workspace_id}; acking without write`,
      );
      return null;
    }
    return { row, remote };
  }

  /**
   * Optional pins (spec-review P1): pinning the observed status serializes concurrent duplicate
   * deliveries on the terminal path (exactly one transitions the row and e-mails); pinning the
   * observed dunning key does the same for stage advances. `.eq(col, null)` matches nothing in
   * PostgREST — null pins MUST use `.is()` (same trap as the Fase 3 CAS).
   */
  async function casWrite(
    row: SubscriptionRow,
    subId: string,
    columns: Record<string, unknown>,
    pins?: { observedStatus?: string | null; observedDunningKey?: string | null },
  ): Promise<void> {
    let update = deps.db
      .from("workspace_subscriptions")
      .update(columns)
      .eq("workspace_id", row.workspace_id)
      .eq("provider", "pagarme")
      .eq("pagarme_subscription_id", subId);
    if (pins && "observedStatus" in pins) {
      update = pins.observedStatus == null
        ? update.is("status", null)
        : update.eq("status", pins.observedStatus);
    }
    if (pins && "observedDunningKey" in pins) {
      update = pins.observedDunningKey == null
        ? update.is("pagarme_dunning_key", null)
        : update.eq("pagarme_dunning_key", pins.observedDunningKey);
    }
    const { data: updated, error } = await update
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .select("workspace_id");
    if (error) {
      throw new Error(`subscription write failed for workspace ${row.workspace_id}: ${error.message}`);
    }
    if (!updated?.length) {
      throw new Error(`concurrent ownership change on workspace ${row.workspace_id}, retrying via redelivery`);
    }
  }

  async function getDefaultPlanId(): Promise<string> {
    const { data, error } = await deps.db
      .from("plans").select("id").eq("is_default", true)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)).maybeSingle();
    if (error) {
      // "free" on a FAILED read would be a stealth downgrade to a possibly wrong plan while
      // still acking the event (spec-review P1). Throw → 5xx → redelivery. The fallback below
      // is only for the proven absence of a default plan row.
      throw new Error(`default plan read failed: ${error.message}`);
    }
    return (data?.id as string) ?? "free";
  }

  async function grantPlan(
    row: SubscriptionRow,
    status: "trialing" | "active" | "canceled",
    columns: Record<string, unknown>,
  ): Promise<void> {
    if (!row.plan_id) {
      // A pagarme row is always born with plan_id at checkout; a null here is corrupted state.
      // Granting default would be a stealth downgrade — log loudly and leave the plan alone.
      console.error(
        `[pagarme-webhook] CRITICAL: pagarme row for workspace ${row.workspace_id} has no plan_id; skipping plan write`,
      );
      return;
    }
    const defaultPlanId = await getDefaultPlanId();
    const target = resolvePagarmePlanTarget(
      status,
      row.plan_id,
      defaultPlanId,
      {
        cancel_at_period_end: columns.cancel_at_period_end as boolean,
        current_period_end: (columns.current_period_end as string | null) ?? null,
      },
      now(),
    );
    if (target !== null) {
      await writeWorkspacePlan(deps.db as SupabaseClient, row.workspace_id, target, "pagarme");
    }
  }

  async function reconcile(subId: string, source: ReconcileSource): Promise<string> {
    const auth = await authorize(subId);
    if (auth === null) return "ignored:ownership";
    const { row, remote } = auth;
    const result = buildReconcileColumns(
      remote,
      { status: row.status, current_period_end: row.current_period_end },
      source,
      now(),
    );
    if (result === null) {
      console.warn(
        `[pagarme-webhook] unknown remote status "${remote.status}" for subscription ${subId}; acking without write`,
      );
      return "ignored:unknown-status";
    }
    await casWrite(row, subId, result.columns);
    if (result.planEligible) {
      await grantPlan(row, result.status, result.columns);
      return source === "charge_paid" ? "reconciled:recovered" : "reconciled";
    }
    return "reconciled:dunning-held";
  }

  async function handleChargeFailed(
    subId: string,
    data: Record<string, unknown>,
  ): Promise<string> {
    const auth = await authorize(subId);
    if (auth === null) return "ignored:ownership";
    const { row, remote } = auth;

    if (isTerminalRemoteStatus(remote.status)) {
      // Terminal outcome confirmed on the re-fetched object: the ONLY path that may send
      // "final". Write first (status-pinned: of two concurrent duplicates exactly one
      // transitions the row), e-mail last, and only when the gate says the cancellation
      // really closed a failing episode (a voluntary cancel racing a late failure event
      // must not e-mail — spec-review P1).
      const result = buildReconcileColumns(
        remote,
        { status: row.status, current_period_end: row.current_period_end },
        "subscription",
        now(),
      );
      if (result === null) return "ignored:unknown-status";
      await casWrite(row, subId, result.columns, { observedStatus: row.status });
      await grantPlan(row, result.status, result.columns);
      if (shouldSendTerminalDunningEmail(remote.status, row)) {
        await deps.notify(row.workspace_id, "final");
        return "dunning:final";
      }
      return "reconciled:terminal";
    }

    const chargeId = typeof data.id === "string" && data.id.length > 0 ? data.id : null;
    if (!chargeId) return "ignored:no-charge-id";
    const key = buildChargeDunningKey(chargeId, extractChargeAttempt(data));
    if (!shouldAdvanceDunning(row.pagarme_dunning_key, key)) {
      return "ignored:duplicate-failure";
    }
    const episode = buildFailureEpisode(
      row.past_due_since,
      (row.failed_payment_count ?? 0) + 1,
      null,
      now(),
    );
    await casWrite(row, subId, {
      status: "past_due",
      ...episode,
      pagarme_dunning_key: key,
      updated_at: now().toISOString(),
    }, { observedDunningKey: row.pagarme_dunning_key });
    // past_due keeps the plan (grace, like statusToPlanId) — no plan write here.
    const stage = selectPagarmeDunningStage(episode.failed_payment_count);
    await deps.notify(row.workspace_id, stage);
    return `dunning:${stage}`;
  }

  return async function handleEvent(envelope: WebhookEnvelope): Promise<string> {
    switch (envelope.type) {
      case "subscription.created":
      case "subscription.updated":
      case "subscription.canceled": {
        const id = envelope.data.id;
        const subId = typeof id === "string" && id.startsWith("sub_") ? id : null;
        if (!subId) return "ignored:no-subscription-id";
        return await reconcile(subId, "subscription");
      }
      case "charge.paid": {
        const subId = extractChargeSubscriptionId(envelope.data);
        if (!subId) return "ignored:no-subscription-id";
        return await reconcile(subId, "charge_paid");
      }
      case "charge.payment_failed": {
        const subId = extractChargeSubscriptionId(envelope.data);
        if (!subId) return "ignored:no-subscription-id";
        return await handleChargeFailed(subId, envelope.data);
      }
      case "charge.refunded": {
        const subId = extractChargeSubscriptionId(envelope.data);
        if (!subId) return "ignored:no-subscription-id";
        // A refund does not prove cancellation — the subscription may keep renewing. Reflect
        // whatever the re-fetched status really is and leave a trail for manual follow-up.
        console.warn(
          `[pagarme-webhook] charge.refunded for subscription ${subId}; reconciling real status, manual follow-up may be needed`,
        );
        return await reconcile(subId, "subscription");
      }
      default:
        // invoice.* (data-only family), charge.created/pending, and anything unknown: ack.
        return "ignored:unhandled-type";
    }
  };
}
```

- [ ] **Step 3: `shouldSendTerminalDunningEmail` em `pagarme-webhook/logic.ts`** (append; review
  de spec, P1 — cancel voluntário em corrida com falha atrasada não pode receber e-mail final):

```ts
/**
 * Whether a terminal outcome inside charge.payment_failed should send the "final" dunning
 * e-mail. Three rules:
 * - A row already canceled was either already notified or voluntarily canceled: never send
 *   (with the status-pinned terminal CAS this also makes concurrent duplicates safe — only
 *   the delivery that transitioned the row e-mails).
 * - Remote status "failed" only ever means payment failure (spike achado 3): always genuine.
 * - Remote "canceled" seen from inside the failure handler may be a voluntary cancellation
 *   racing a late failure event: only an OPEN local episode (past_due status or a
 *   past_due_since stamp) proves the cancellation closed a failing episode.
 */
export function shouldSendTerminalDunningEmail(
  remoteStatus: string,
  row: { status: string | null; past_due_since: string | null },
): boolean {
  if (row.status === "canceled") return false;
  if (remoteStatus === "failed") return true;
  return row.status === "past_due" || row.past_due_since !== null;
}
```

  Testes (append em `pagarme-webhook-logic_test.ts`):
  - `("failed", {status:"trialing", past_due_since:null})` → true (falha terminal da 1ª cobrança).
  - `("canceled", {status:"past_due", past_due_since:"2026-08-11T00:00:00Z"})` → true.
  - `("canceled", {status:"active", past_due_since:null})` → false (cancel voluntário em corrida).
  - `("canceled", {status:"active", past_due_since:"2026-08-11T00:00:00Z"})` → true (episódio aberto).
  - `("failed", {status:"canceled", past_due_since:"2026-08-11T00:00:00Z"})` → false (já processado).

- [ ] **Step 4: Testes do handler** — leia `pagarme-checkout-handler_test.ts` primeiro e reuse o
  padrão de fake db (thenable chain que grava `{table, op, filters, values}` e devolve fixtures
  por tabela/op). Fake gateway: `{ fetchSubscription: (id) => Promise.resolve(fixtures.remote) }`
  com override por teste; fake notify: array `notified: Array<{ws, stage}>`. `now` fixo
  `new Date("2026-08-12T12:00:00Z")`. Fixture de linha padrão:

```ts
const baseRow = {
  workspace_id: "ws-1",
  plan_id: "start",
  provider: "pagarme",
  stripe_subscription_id: null,
  pagarme_subscription_id: "sub_1",
  status: "active",
  cancel_at_period_end: false,
  current_period_end: "2027-08-10T23:59:59Z",
  past_due_since: null,
  failed_payment_count: 0,
  pagarme_dunning_key: null,
};
```

  Casos (todos assertando também os FILTROS do CAS — eq workspace_id/provider/pagarme_subscription_id — e a presença de abortSignal na chain quando o fake registrar):
  1. `subscription.updated` com row ativa e remote active → update em workspace_subscriptions com `status:"active"`, CAS pinado, plan write via workspaces (target "start"), retorno "reconciled".
  2. `subscription.updated` sem linha local → handler LANÇA (mensagem contém "no local row").
  3. Erro no read da linha → lança.
  4. Row com `provider:"stripe"`, `status:"active"` e `pagarme_subscription_id:"sub_1"` (linha reivindicada pela Stripe após churn) → canWebhookWrite nega → retorno "ignored:ownership", NENHUM update, e `fetchSubscription` NÃO foi chamado (authorize nega ANTES do fetch remoto).
  5. Metadata divergente: remote com `metadata:{workspace_id:"ws-OUTRO"}` → retorno "ignored:ownership" (authorize devolve null tanto para deny de ownership quanto para divergência; o contrato é "null = ack sem write"), zero updates, e o console.error de divergência foi emitido (spy opcional).
  6. `subscription.canceled` remoto canceled com `current_cycle.status:"billed"`, row active → update com `status:"canceled"`, `cancel_at_period_end:true`, `current_period_end` retido; plan write NÃO acontece (resolvePagarmePlanTarget devolve null em paid-through); "reconciled".
  7. `subscription.canceled` de trial (remote canceled sem cycle, row trialing, `current_period_end:"2026-09-11T00:00:00Z"` FUTURO mas cape false) → plan write com plano DEFAULT ("free"); "reconciled".
  8. CAS zero linhas (fixture devolve `data: []`) → lança "concurrent ownership change".
  9. Status remoto desconhecido ("paused") → "ignored:unknown-status", zero updates.
  10. `charge.paid` com `{invoice:{subscription_id:"sub_1"}}`, row past_due com episódio → update contém recovery (`past_due_since:null`, `failed_payment_count:0`, `pagarme_dunning_key:null`) e `status:"active"`; "reconciled:recovered".
  11. `subscription.updated` remote active com row past_due → update SEM campo status, SEM recovery; NENHUM plan write; "reconciled:dunning-held".
  12. `charge.payment_failed` remote ainda active, primeira falha (`data:{id:"ch_1", last_transaction:{attempt_count:1}}`) → update `status:"past_due"`, `failed_payment_count:1`, `pagarme_dunning_key:"ch_1:1"`, `past_due_since` = now ISO; o CAS carrega o pin `.is("pagarme_dunning_key", null)` (chave observada era null); notify chamado com ("ws-1","first"); "dunning:first".
  13. Mesma chave repetida (row com `pagarme_dunning_key:"ch_1:1"`, mesmo payload) → "ignored:duplicate-failure", zero updates, zero notify.
  14. Segunda falha real (row `failed_payment_count:1`, `pagarme_dunning_key:"ch_1:1"`, `past_due_since:"2026-08-11T00:00:00Z"`, payload `{id:"ch_1", last_transaction:{attempt_count:2}}`) → `failed_payment_count:2`, key "ch_1:2", `past_due_since` PRESERVADO "2026-08-11T00:00:00Z", CAS com pin `.eq("pagarme_dunning_key","ch_1:1")`, notify ("ws-1","retry"); "dunning:retry".
  14b. Entrega fora de ordem: row `pagarme_dunning_key:"ch_1:2"`, payload attempt 1 → "ignored:duplicate-failure" (regra monotônica), zero updates, zero notify.
  15. Falha terminal: remote `status:"failed"`, row past_due (`past_due_since` não-nulo), período no passado → update canceled com pin `.eq("status","past_due")`, plan write DEFAULT, notify ("ws-1","final"); "dunning:final". Ordem: update ANTES do notify (asserte pela ordem dos eventos gravados).
  15b. Terminal SEM e-mail (cancel voluntário em corrida): remote `status:"canceled"` com `current_cycle:{status:"billed", end_at:"2027-08-10T23:59:59Z"}`, row `{status:"active", past_due_since:null}` → update canceled acontece (pin `.eq("status","active")`), ZERO notify; "reconciled:terminal".
  15c. Terminal idempotente: row `{status:"canceled", past_due_since:"2026-08-11T00:00:00Z"}`, remote failed → CAS pina `.eq("status","canceled")`, write ok, ZERO notify; "reconciled:terminal".
  15d. Default plan read com `error` → handler LANÇA (mensagem contém "default plan read failed").
  16. `charge.payment_failed` sem sub id resolvível (`data:{id:"ch_9"}`) → "ignored:no-subscription-id", zero DB.
  17. `charge.payment_failed` sem charge id (`data:{invoice:{subscription_id:"sub_1"}}`, remote active) → "ignored:no-charge-id", zero updates (mas authorize rodou).
  18. `charge.refunded` → reconcile normal ("reconciled") e zero notify.
  19. `invoice.paid` e `charge.created` → "ignored:unhandled-type", ZERO DB calls.
  20. Gateway lança (timeout) → handler lança (propaga para 5xx).
  21. Plan-writer: workspaces com `plan_source:"manual"` → nenhuma escrita de plan_id (comp preservada), retorno ainda "reconciled".
  22. Row com `plan_id:null` → CRITICAL logado (spy em console.error opcional; no mínimo: nenhuma escrita em workspaces) e reconcile completa.
- [ ] **Step 5: Rode** o teste novo + `pagarme-webhook-logic_test.ts` + `pagarme-logic_test.ts`;
  `git checkout -- deno.lock`.
- [ ] **Step 6: Commit** `feat(billing): pagarme-webhook gateway + handler`

---

### Task 4: `pagarme-webhook/index.ts` + config + bateria completa

**Files:**
- Create: `supabase/functions/pagarme-webhook/index.ts`
- Modify: `supabase/config.toml` (após o bloco `[functions.pagarme-checkout]`)
- Modify: `supabase/functions/__tests__/config-audit_test.ts` (REQUIRED_FUNCTIONS)
- Modify: `CLAUDE.md` (seção Edge functions env vars)

**Interfaces:**
- Consumes: `parseWebhookEnvelope` (Task 1), `createPagarmeWebhookHandler` (Task 3),
  `createPagarmeWebhookGateway` (Task 3), `notifyOwnerOfFailure` (Task 2),
  `timingSafeEqual` de `_shared/crypto.ts`.

- [ ] **Step 1: `index.ts` completo**

```ts
// Serve shell for pagarme-webhook. Trust boundary (spike-validated): secret token in the URL
// path + the dashboard's HTTP Basic delivery auth, both compared timing-safe — Pagar.me has no
// HMAC signature. No CORS on purpose: this is server-to-server, like stripe-webhook.
// Never log the payload or the Authorization header (LGPD/PCI).

import { createClient } from "npm:@supabase/supabase-js@2";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { notifyOwnerOfFailure } from "../_shared/dunning-notify.ts";
import { parseWebhookEnvelope } from "./logic.ts";
import { createPagarmeWebhookGateway } from "./gateway.ts";
import { createPagarmeWebhookHandler } from "./handler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PAGARME_WEBHOOK_TOKEN = Deno.env.get("PAGARME_WEBHOOK_TOKEN") ??
  (() => {
    throw new Error("PAGARME_WEBHOOK_TOKEN environment variable is required");
  })();
// "user:senha" — exactly the credentials typed into the dashboard's "Habilitar autenticação".
const PAGARME_WEBHOOK_BASIC = Deno.env.get("PAGARME_WEBHOOK_BASIC") ??
  (() => {
    throw new Error("PAGARME_WEBHOOK_BASIC environment variable is required");
  })();
const EXPECTED_AUTH = "Basic " + btoa(PAGARME_WEBHOOK_BASIC);

const DB_TIMEOUT_MS = 10_000;

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const segments = new URL(req.url).pathname.split("/").filter(Boolean);
  const pathToken = segments[segments.length - 1] ?? "";
  if (!timingSafeEqual(pathToken, PAGARME_WEBHOOK_TOKEN)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (!timingSafeEqual(auth, EXPECTED_AUTH)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return new Response("Invalid payload", { status: 400 });
  }
  const envelope = parseWebhookEnvelope(raw);
  if (!envelope) return new Response("Invalid payload", { status: 400 });

  const svc = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Dedup: short-circuit known events. Handlers are also idempotent, so this is best-effort —
  // but a FAILED dedup read must not proceed (a redelivered final e-mail is user-visible).
  const { data: dup, error: dupErr } = await svc
    .from("pagarme_webhook_events").select("event_id").eq("event_id", envelope.id)
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)).maybeSingle();
  if (dupErr) {
    console.error(`[pagarme-webhook] dedup read failed for ${envelope.id}: ${dupErr.message}`);
    return new Response("Handler error", { status: 500 });
  }
  if (dup) {
    return new Response(JSON.stringify({ received: true, duplicate: true }), { status: 200 });
  }

  const handler = createPagarmeWebhookHandler({
    db: svc,
    gateway: createPagarmeWebhookGateway(),
    notify: (workspaceId, stage) =>
      notifyOwnerOfFailure(
        svc,
        workspaceId,
        { stage, nextPaymentAttemptIso: null },
        { logPrefix: "[pagarme-webhook]" },
      ),
  });

  let action: string;
  try {
    action = await handler(envelope);
  } catch (err) {
    // Do NOT record the event — return 5xx so Pagar.me redelivers.
    console.error(
      `[pagarme-webhook] handler error for ${envelope.type} ${envelope.id}:`,
      err instanceof Error ? err.message : String(err),
    );
    return new Response("Handler error", { status: 500 });
  }

  const { error: insErr } = await svc
    .from("pagarme_webhook_events").insert({ event_id: envelope.id, type: envelope.type })
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
  if (insErr) {
    // Best-effort like stripe-webhook: the event was handled; a redelivery hits idempotent
    // handlers (and the dunning key gate). Log so a dead ledger is visible.
    console.error(`[pagarme-webhook] ledger insert failed for ${envelope.id}: ${insErr.message}`);
  }
  console.log(`[pagarme-webhook] ${envelope.type} ${envelope.id}: ${action}`);
  return new Response(JSON.stringify({ received: true }), { status: 200 });
});
```

- [ ] **Step 2: `supabase/config.toml`** — adicionar após o bloco pagarme-checkout:

```toml
[functions.pagarme-webhook]
verify_jwt = false
```

- [ ] **Step 3: `config-audit_test.ts`** — adicionar `"pagarme-webhook"` a `REQUIRED_FUNCTIONS`
  (ordem alfabética se a lista seguir uma).
- [ ] **Step 4: CLAUDE.md + .env.example** — no `.env.example`, logo abaixo de
  `PAGARME_SECRET_KEY=sk_test_xxx` (linha 62), adicionar:

```
PAGARME_WEBHOOK_TOKEN=um-token-aleatorio-longo
PAGARME_WEBHOOK_BASIC=usuario:senha-do-toggle-do-dashboard
```

  E no CLAUDE.md, na seção "Edge functions (Deno.env)", adicionar:

```markdown
- `PAGARME_WEBHOOK_TOKEN` -- secret path segment of the Pagar.me webhook URL
  (`/pagarme-webhook/{token}`). REQUIRED by pagarme-webhook, no default -- throws at module load
- `PAGARME_WEBHOOK_BASIC` -- `user:password` pair configured in the Pagar.me dashboard webhook
  "Habilitar autenticação" toggle, verified timing-safe on every delivery. REQUIRED by
  pagarme-webhook, no default -- throws at module load
```

- [ ] **Step 5: Bateria completa** (na worktree; se prettier/tsc acusarem arquivos não tocados,
  `npm ci` primeiro):

```bash
npm run lint
npm run format:check
npx tsc -p apps/crm/tsconfig.json --noEmit
npx tsc -p apps/hub/tsconfig.json --noEmit
npx tsc -p apps/admin/tsconfig.json --noEmit
npx tsc -p tsconfig.scripts.json
npm run test
npm run test:functions && git checkout -- deno.lock
```

- [ ] **Step 6: Commit** `feat(billing): pagarme-webhook serve shell + config`

---

## Fora de escopo desta fase (não implemente)

- `pagarme-subscription` (cancel/update_card) e `billing-downgrade-cron` + varredura remota de
  órfãs → **Fase 5** (requisito duro pré-flip).
- Frontend (dialog, wiring, admin checkbox) → **Fase 6**.
- Registro do webhook no dashboard Pagar.me, secrets em prod/staging, deploy → pós-merge,
  com ações do Eduardo (senha do dashboard). URL: `https://<project-ref>.supabase.co/functions/v1/pagarme-webhook/<token>`,
  auth Basic com o mesmo user:senha de `PAGARME_WEBHOOK_BASIC`, categorias Assinatura+Cobrança+Fatura,
  máximo de tentativas 3. Secrets via file-redirection, nunca argumento de CLI.
- Bounding dos DB calls PRÓPRIOS do stripe-webhook (fora plan-writer) — dívida separada, não
  expandir aqui.

## Adjudicação do review externo de spec (Codex gpt-5.6-terra, 2026-08-12, pré-implementação)

Aceitos e incorporados acima:

1. **P1 dunning fora de ordem/concorrente** → `shouldAdvanceDunning` monotônico por
   charge+attempt (Task 2 Step 5) + CAS do avanço pinado na chave observada
   (`observedDunningKey`, `.is()` para null — Task 3).
2. **P1 e-mail final duplicado** → CAS terminal pinado no status observado: só a entrega que
   TRANSICIONA a linha envia e-mail; redelivery encontra `canceled` e o gate recusa (Task 3).
3. **P1 cancel voluntário em corrida com falha atrasada** → `shouldSendTerminalDunningEmail`
   (remote `failed` = sempre genuíno; remote `canceled` exige episódio local aberto; linha já
   `canceled` nunca re-envia) (Task 3 Step 3).
4. **P1 `getDefaultPlanId` engolia erro** → lança em erro de leitura; fallback "free" só para
   ausência comprovada de default (Task 3).
5. **P2 dunning-notify sem abortSignal** → as duas queries PostgREST bounded;
   `auth.admin.getUserById` não tem API de abort (GoTrue) e o try/catch envolvente cobre (Task 2).
6. **P2 .env.example** → placeholders de `PAGARME_WEBHOOK_TOKEN`/`PAGARME_WEBHOOK_BASIC`
   (Task 4 Step 4).

Rejeitado com evidência:

7. **P3 separar o hardening do stripe-webhook em PR próprio** — o rollback operacional de edge
   functions é POR FUNÇÃO deployada (`supabase functions deploy <nome>`), não por merge commit:
   `stripe-webhook` e `pagarme-webhook` já são implantáveis/reversíveis independentemente mesmo
   saindo do mesmo PR (precedente: hotfixes de função única em todas as fases). O hardening fica
   em commit próprio (Task 2), cherry-pickável/revertável isoladamente, e o master plan
   agendou-o explicitamente na Fase 4 para fechar a corrida de double-checkout na camada certa.

## Post-PR hardening

### Fix round 1 (Task 3 review + Codex externo, 2026-08-12)

Aceitos e corrigidos na branch antes do Task 4:

- **[Task-3 reviewer, Important] reconcile() sem pin de estado observado** (`handler.ts:199`).
  O write de `reconcile()` carregava só os 3 pins de ownership; os caminhos terminal/dunning
  (`:228`/`:249`) já pinam o estado observado. Como `subscription.*` NÃO é autoritativa para
  pagamento (charge.* é), um `subscription.updated` que leu a linha antes de um
  `charge.payment_failed` concorrente commitar reescreve o `past_due` recém-criado com um
  "active" obsoleto (o guard `holdDunning` lê o mesmo snapshot obsoleto). Bursts no mesmo
  segundo, ordem não garantida, estão confirmados no spike. Fix: `casWrite(row, subId,
  result.columns, { observedStatus: row.status })` em `reconcile()` — a corrida falha o CAS →
  5xx → redelivery re-lê o estado fresco e `holdDunning` aplica. Converge; mesmo padrão dos
  outros dois writes. (Gatilho depende da semântica de status do Pagar.me em falha de
  renovação, pergunta 5 ao suporte ainda aberta; o fix é barato e fecha a janela
  independentemente da resposta.)
- **[Codex P2] `shouldCancelDeniedCheckoutSub` não cobre status Stripe terminais**
  (`pagarme-logic.ts:213`). Um checkout negado redelivered depois que a Stripe expirou a sub
  (`incomplete` → ~23h → `incomplete_expired`) chamaria `subscriptions.cancel` num status
  terminal → throw → 5xx em loop infinito. Fix: tratar `canceled` E `incomplete_expired` como
  já-resolvidos (nada a cancelar → ack).

Rejeitado:

- **[Codex P1] "webhook sem entrypoint deployável"** — correto como observação, mas é
  exatamente o **Task 4** (`index.ts` serve shell + `config.toml` + `config-audit` +
  `.env.example`), a próxima task já especificada neste plano. O Codex revisou o branch em
  implementação parcial (SDD faz commits por task); não é lacuna do plano. Nenhuma ação além de
  executar o Task 4.

Recusados sem fix (documentados):

- **[Task-3 reviewer, Minor] branch `.is("status", null)` do casWrite sem teste** — a coluna
  `status` nunca é null numa linha pagarme bindada; o branch gêmeo (`pagarme_dunning_key` null)
  é testado e é estruturalmente idêntico. Sem valor de teste.
- **[Task-3 reviewer, Minor] `getDefaultPlanId` lido mesmo quando o target é descartado**
  (cancels paid-through) — um round-trip desperdiçado, sem impacto de correção;
  `resolvePagarmePlanTarget` exige o default upfront. Não vale reestruturar.

### Fix round 2 (review final whole-branch fable/opus + Codex externo, 2026-08-12)

Review final: **READY TO MERGE (dark)**. Dois achados convergentes (opus Important == Codex P1
#2; + Codex P1 #1 separado), ambos na idempotência de dunning sob redelivery/burst. Aceitos:

- **[Codex P1 #1] recovery zera o marcador de dedup** (`logic.ts:151`). O branch in-force de
  `buildReconcileColumns` gravava `pagarme_dunning_key: null` no recovery. Se o
  `charge.payment_failed` anterior for redelivered DEPOIS do `charge.paid` (o ledger de
  envelope-id é best-effort), `shouldAdvanceDunning(null, oldKey)` trata como novo → volta a
  `past_due` + segundo e-mail. Fix: o recovery reseta o EPISÓDIO (past_due_since,
  next_payment_attempt, failed_payment_count) mas RETÉM `pagarme_dunning_key` — uma redelivery
  do mesmo charge vira `shouldAdvanceDunning(oldKey, oldKey) == false` (ignorada); falha
  genuína do próximo ciclo tem charge id novo → avança normalmente.
- **[opus Important / Codex P1 #2] write de falha não-terminal sem pin de status observado**
  (`handler.ts:255`). Pinava só `observedDunningKey`; um handler de falha que buscou a sub
  ainda `active` pode commitar depois de um `charge.paid`/cancel concorrente quando a chave não
  mudou (ex.: ambas null), ressuscitando a linha para `past_due` com aviso obsoleto. Fix:
  incluir `observedStatus: row.status` nos pins desse write — a entrega atrasada falha o CAS →
  5xx → redelivery re-lê o estado atual (mesmo padrão do reconcile e do terminal).

Nada mais bloqueia. Os itens diferidos (varredura remota de órfãs Fase 5, pagarme-subscription,
downgrade-cron, frontend, registro do webhook + secrets, semântica Q5 de falha de renovação)
foram explicitamente confirmados como pós-merge seguros para um ship dark.
