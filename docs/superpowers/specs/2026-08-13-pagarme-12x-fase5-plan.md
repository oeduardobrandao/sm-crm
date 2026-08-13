# Pagar.me 12x — Fase 5: pagarme-subscription + billing-downgrade-cron + varredura de órfãs

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the subscriber-management edge function (`pagarme-subscription`: cancel / update_card, owner-gated) and the daily `billing-downgrade-cron` (paid-through downgrade + stale-attempt backstop + the remote orphan sweep that is a HARD precondition of the production flip), plus the pg_cron schedule. Everything ships dark: no frontend calls these yet (Fase 6).

**Architecture:** Both functions follow the Fase 3/4 house shape — `logic.ts` (pure, unit-tested), `gateway.ts` (thin port over `pagarmeFetch`), `handler.ts` (deps-injected `{db, gateway, now?}`), `index.ts` (serve shell: auth/rate-limit for the user function, `x-cron-secret` for the cron). Remote state is authoritative: cancel goes remote-first, the local write is a pinned CAS, and plan grants go through the atomic `grant_pagarme_plan` RPC. The sweep enumerates the WHOLE Pagar.me account (`GET /subscriptions?status=...`) and cancels only subscriptions that carry our `metadata.workspace_id`, are unlinked locally, have no pending checkout attempt, and are older than 60 minutes.

**Tech Stack:** Deno edge functions, Supabase (PostgREST + RPC), Pagar.me core/v5 API, pg_cron + vault.

## Global Constraints

- Every DB call carries `.abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))` with `const DB_TIMEOUT_MS = 10_000;` (house rule; `pagarmeFetch` already hard-caps remote calls at 5s).
- Generic errors to clients (fixed PT-BR strings), details to `console.error` only. Never forward gateway bodies. Never log card data, tokens, or the Authorization header.
- No em-dashes in user-facing PT-BR copy (period/colon/"·" instead).
- CORS via `buildCorsHeaders(req)` for the user-facing function; the cron has no CORS (server-to-server).
- All user-facing writes are CAS-pinned on observed state; plan writes go ONLY through the `grant_pagarme_plan` RPC (never `writeWorkspacePlan`, never a direct `workspaces` update).
- `.eq(col, null)` matches nothing in PostgREST — null pins use `.is()`.
- The webhook (`subscription.canceled` → reconcile) is the safety net for any local write this function loses; losing a CAS after a successful remote cancel is a tolerated no-op, not an error.
- Commit trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Deno tests live in `supabase/functions/__tests__/`, run with `npm run test:functions`; revert `deno.lock` after runs (`git checkout -- deno.lock`).
- New functions need: source dir, `[functions.<name>]\nverify_jwt = false` in `supabase/config.toml`, AND their name in `REQUIRED_FUNCTIONS` of `supabase/functions/__tests__/config-audit_test.ts`.
- `PAGARME_SECRET_KEY` may be ABSENT in an environment (prod is dark). The cron must not crash-loop on that: remote legs are skipped with a logged notice when the key is unset; the local downgrade leg always runs.

---

### Task 1: Shared extractions + sweep decision logic

**Files:**
- Modify: `supabase/functions/_shared/billing-logic.ts` (add `getDefaultPlanId`)
- Modify: `supabase/functions/_shared/pagarme-logic.ts` (add `isDefinitiveGatewayReject`, `shouldSweepRemoteSubscription`, `SWEEP_MIN_AGE_MS`)
- Modify: `supabase/functions/pagarme-webhook/handler.ts` (use shared `getDefaultPlanId`)
- Modify: `supabase/functions/pagarme-checkout/handler.ts:124-126` (use shared `isDefinitiveGatewayReject`)
- Test: `supabase/functions/__tests__/pagarme-logic_test.ts` (extend), `supabase/functions/__tests__/billing-logic_test.ts` (extend if it exists, else create)

**Interfaces:**
- Produces: `getDefaultPlanId(db: SupabaseClient): Promise<string>` in `_shared/billing-logic.ts`; `isDefinitiveGatewayReject(err: unknown): boolean` and `shouldSweepRemoteSubscription(...)` in `_shared/pagarme-logic.ts`. Tasks 2 and 3 import all three.

- [ ] **Step 1: Extract `getDefaultPlanId` to `_shared/billing-logic.ts`**

Move the closure at `supabase/functions/pagarme-webhook/handler.ts:139-150` into `_shared/billing-logic.ts` as an exported function with identical semantics (throws on read error; `"free"` only for a proven-absent default):

```ts
const DB_TIMEOUT_MS = 10_000;

/**
 * The plan a workspace falls back to when it loses its paid subscription. Throws on a read
 * ERROR (a transient failure must not silently downgrade someone to "free"); returns "free"
 * only when the query succeeds and no default plan exists.
 */
export async function getDefaultPlanId(db: SupabaseClient): Promise<string> {
  const { data, error } = await db
    .from("plans")
    .select("id")
    .eq("is_default", true)
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
    .maybeSingle();
  if (error) throw new Error(`default plan read failed: ${error.message}`);
  return (data?.id as string) ?? "free";
}
```

Add the `SupabaseClient` type import if `billing-logic.ts` doesn't have it (`import type { SupabaseClient } from "npm:@supabase/supabase-js@2.45.4";` — match the exact specifier already used in `_shared/plan-writer.ts` or the webhook handler; do NOT introduce a new version). Refactor `pagarme-webhook/handler.ts` to import and call it (`getDefaultPlanId(deps.db)`), deleting the local closure. No behavior change.

- [ ] **Step 2: Add `isDefinitiveGatewayReject` to `_shared/pagarme-logic.ts`**

This predicate exists twice in `pagarme-checkout` (handler.ts:124-126 and, in spirit, logic.ts `mapGatewayFailure`). Extract the exact classification:

```ts
import { PagarmeApiError } from "./pagarme.ts";

/**
 * True when a gateway error is a DEFINITIVE 4xx statement about the target resource —
 * i.e. a DELETE that failed because the subscription is already canceled/gone. 401/403
 * (our credentials) and 429 (throttled) say nothing about the resource and are NOT
 * definitive; neither are 5xx/network/timeout errors.
 */
export function isDefinitiveGatewayReject(err: unknown): boolean {
  return err instanceof PagarmeApiError &&
    err.status >= 400 && err.status < 500 &&
    err.status !== 401 && err.status !== 403 && err.status !== 429;
}
```

Refactor `pagarme-checkout/handler.ts:124-126` to `const settled = isDefinitiveGatewayReject(e);` (keep the local comment). Leave `mapGatewayFailure` in checkout logic.ts untouched (different concern: response mapping).

- [ ] **Step 3: Add the sweep decision to `_shared/pagarme-logic.ts`**

```ts
/** A remote subscription younger than this is never swept: it may be a checkout mid-flight. */
export const SWEEP_MIN_AGE_MS = 60 * 60 * 1000;

export type SweepVerdict =
  | "cancel"
  | "skip_linked"
  | "skip_pending_attempt"
  | "skip_young"
  | "skip_unrecognized";

/**
 * Decides the fate of one remote Pagar.me subscription during the orphan sweep.
 * - linked locally (any workspace_subscriptions row, any provider) -> skip_linked
 * - referenced by a PENDING checkout attempt -> skip_pending_attempt (mid-recovery; the
 *   checkout self-heal or the stale-attempt leg owns it)
 * - created less than SWEEP_MIN_AGE_MS ago -> skip_young (racing an in-flight checkout)
 * - no metadata.workspace_id -> skip_unrecognized (not created by our checkout; a manual
 *   dashboard subscription is not ours to cancel — logged loudly, never touched)
 * - otherwise -> cancel (an orphan our checkout created but never bound)
 */
export function shouldSweepRemoteSubscription(
  sub: {
    id: string;
    created_at?: string | null;
    metadata?: { workspace_id?: string | null } | null;
  },
  linkedSubIds: ReadonlySet<string>,
  pendingAttemptSubIds: ReadonlySet<string>,
  now: Date,
): SweepVerdict {
  if (linkedSubIds.has(sub.id)) return "skip_linked";
  if (pendingAttemptSubIds.has(sub.id)) return "skip_pending_attempt";
  const created = sub.created_at ? Date.parse(sub.created_at) : NaN;
  if (Number.isNaN(created) || now.getTime() - created < SWEEP_MIN_AGE_MS) {
    // An unparseable created_at is treated as young: never cancel on missing evidence.
    return "skip_young";
  }
  if (!sub.metadata?.workspace_id) return "skip_unrecognized";
  return "cancel";
}
```

- [ ] **Step 4: Tests**

Extend `pagarme-logic_test.ts`:
- `isDefinitiveGatewayReject`: true for `new PagarmeApiError(404, {})`, `422`; false for `401`, `403`, `429`, `500`, `new Error("network")`, a plain timeout `DOMException`. (Check `PagarmeApiError`'s real constructor signature in `_shared/pagarme.ts` and build instances the way `pagarme-checkout-handler_test.ts` already does.)
- `shouldSweepRemoteSubscription`: one test per verdict — linked wins over everything; pending-attempt wins over young/unrecognized; young (59 min) vs old (61 min) boundary; missing `created_at` and unparseable `created_at` → `skip_young`; metadata missing / `workspace_id` empty-string → `skip_unrecognized`; full orphan → `cancel`.

For `getDefaultPlanId`: extend or create `billing-logic_test.ts` using a minimal thenable fake db (copy the `makeDb` idiom from `pagarme-checkout-handler_test.ts`): returns the plan id when present, `"free"` when `data` null, throws on `error`.

- [ ] **Step 5: Run and verify existing suites still pass**

Run: `npm run test:functions` (then `git checkout -- deno.lock`).
Expected: PASS, including the untouched `pagarme-webhook-handler_test.ts` and `pagarme-checkout-handler_test.ts` (the refactors are behavior-preserving; if a webhook test stubbed the internal closure, update it to keep asserting the same observable events).

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/_shared/ supabase/functions/pagarme-webhook/ supabase/functions/pagarme-checkout/ supabase/functions/__tests__/
git commit -m "refactor(billing): extract getDefaultPlanId + gateway-reject predicate; add sweep verdict logic"
```

---

### Task 2: `pagarme-subscription` edge function (cancel / update_card)

**Files:**
- Create: `supabase/functions/pagarme-subscription/logic.ts`, `gateway.ts`, `handler.ts`, `index.ts`
- Modify: `supabase/config.toml` (add stanza), `supabase/functions/__tests__/config-audit_test.ts` (REQUIRED_FUNCTIONS)
- Test: `supabase/functions/__tests__/pagarme-subscription-handler_test.ts`, extend `supabase/functions/__tests__/pagarme-subscription-logic_test.ts` (new)

**Interfaces:**
- Consumes: `isDefinitiveGatewayReject`, `getDefaultPlanId` (Task 1); `isInForce` from `_shared/pagarme-logic.ts`; `pagarmeFetch` from `_shared/pagarme.ts`; `grant_pagarme_plan` RPC; auth idiom byte-for-byte from `pagarme-checkout/index.ts` (getUser + profiles.conta_id + workspace_members owner gate + `checkRateLimit`).
- Produces: `POST /functions/v1/pagarme-subscription` contract (below). Fase 6 frontend will call it.

**Contract:**

```
POST /functions/v1/pagarme-subscription   Authorization: Bearer <supabase token>
{ action: "cancel" }
  → 200 { status: "canceled", access_until: string | null }
{ action: "update_card", card_token, billing_address: { cep, line_1, city, state } }
  → 200 { ok: true }
Errors: 400 {error, code:"invalid_request"|"invalid_card"} | 401 | 403 | 404 {error} (no
pagarme subscription) | 409 {error} (already canceled) | 429 | 500 {error, code:"gateway_error"}
```

- [ ] **Step 1: `logic.ts` (pure)**

```ts
// Pure decisions for pagarme-subscription. No network/env/Supabase access.

export type SubscriptionAction =
  | { action: "cancel" }
  | {
    action: "update_card";
    cardToken: string;
    billingAddress: { cep: string; line1: string; city: string; state: string };
  };

export type ParseFailure = { ok: false; status: 400; error: string; code: "invalid_request" };
export type ParseResult = { ok: true; value: SubscriptionAction } | ParseFailure;

function digits(v: unknown): string {
  return typeof v === "string" ? v.replace(/\D/g, "") : "";
}

function fail(error: string): ParseFailure {
  return { ok: false, status: 400, error, code: "invalid_request" };
}

/** Same defensive shape as pagarme-checkout's parseCheckoutBody: req.json() may resolve to anything. */
export function parseSubscriptionBody(raw: unknown): ParseResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return fail("Requisição inválida.");
  }
  const body = raw as Record<string, unknown>;
  if (body.action === "cancel") return { ok: true, value: { action: "cancel" } };
  if (body.action !== "update_card") return fail("Ação inválida.");

  const cardToken = typeof body.card_token === "string" ? body.card_token.trim() : "";
  if (!cardToken) return fail("Dados do cartão inválidos.");
  const addr = (body.billing_address ?? {}) as Record<string, unknown>;
  const cep = digits(addr.cep);
  const line1 = typeof addr.line_1 === "string" ? addr.line_1.trim() : "";
  const city = typeof addr.city === "string" ? addr.city.trim() : "";
  const state = typeof addr.state === "string" ? addr.state.trim().toUpperCase() : "";
  if (cep.length !== 8 || !line1 || !city || !/^[A-Z]{2}$/.test(state)) {
    return fail("Endereço de cobrança inválido.");
  }
  return {
    ok: true,
    value: { action: "update_card", cardToken, billingAddress: { cep, line1, city, state } },
  };
}

/**
 * Local columns for a user-initiated cancel, decided by the OBSERVED status:
 * - active: the year is already charged (12 installments in flight). The user keeps access
 *   until current_period_end (paid-through: cancel_at_period_end=true, period end RETAINED,
 *   never overwritten), and billing-downgrade-cron downgrades after the boundary.
 * - trialing: nothing was charged. Immediate downgrade.
 * - past_due: the charge failed, nothing was collected. Immediate downgrade.
 */
export function buildCancelColumns(
  observedStatus: string,
  nowIso: string,
): { columns: Record<string, unknown>; immediateDowngrade: boolean } {
  const paidThrough = observedStatus === "active";
  return {
    columns: {
      status: "canceled",
      cancel_at_period_end: paidThrough,
      updated_at: nowIso,
    },
    immediateDowngrade: !paidThrough,
  };
}
```

- [ ] **Step 2: `gateway.ts`**

```ts
// Thin port over pagarmeFetch. No decisions here; the handler owns control flow.
import { pagarmeFetch } from "../_shared/pagarme.ts";

export interface PagarmeSubscriptionGateway {
  /** DELETE /subscriptions/{id} — immediate cancellation (spike: no cancel-at-period-end exists). */
  cancelSubscription(subId: string): Promise<unknown>;
  /** POST /customers/{id}/cards — same attach shape as pagarme-checkout's gateway. */
  attachCard(
    customerId: string,
    token: string,
    address: { cep: string; line1: string; city: string; state: string },
  ): Promise<{ id: string }>;
  /** PATCH /subscriptions/{id}/card with the freshly attached card_id. */
  updateSubscriptionCard(subId: string, cardId: string): Promise<unknown>;
}

export function createPagarmeSubscriptionGateway(): PagarmeSubscriptionGateway {
  return {
    cancelSubscription: (subId) => pagarmeFetch("DELETE", `/subscriptions/${subId}`),
    attachCard: (customerId, token, address) =>
      pagarmeFetch<{ id: string }>("POST", `/customers/${customerId}/cards`, {
        token,
        billing_address: {
          line_1: address.line1,
          zip_code: address.cep,
          city: address.city,
          state: address.state,
          country: "BR",
        },
      }),
    updateSubscriptionCard: (subId, cardId) =>
      pagarmeFetch("PATCH", `/subscriptions/${subId}/card`, { card_id: cardId }),
  };
}
```

(Verify `pagarmeFetch`'s DELETE path: `pagarme-checkout/gateway.ts` already issues a DELETE for the compensating cancel — copy its exact call shape.)

- [ ] **Step 3: `handler.ts`**

Deps injection mirrors `pagarme-webhook/handler.ts`: `{ db: SupabaseClient; gateway: PagarmeSubscriptionGateway; now?: () => Date }`. `const DB_TIMEOUT_MS = 10_000;`. Exports `handleSubscriptionAction(deps, ctx: { workspaceId: string }, action: SubscriptionAction): Promise<{ status: number; body: Record<string, unknown> }>`.

Flow:

1. Load the row:
```ts
const { data: row, error: rowErr } = await deps.db
  .from("workspace_subscriptions")
  .select(
    "provider, pagarme_customer_id, pagarme_subscription_id, status, cancel_at_period_end, current_period_end",
  )
  .eq("workspace_id", ctx.workspaceId)
  .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
  .maybeSingle();
if (rowErr) throw new Error(`subscription read failed: ${rowErr.message}`);
```
2. Guards (both actions): `if (!row || row.provider !== "pagarme" || !row.pagarme_subscription_id)` → `404 { error: "Nenhuma assinatura parcelada encontrada para este workspace." }`. Then `if (!isInForce(row.status))` → `409 { error: "Esta assinatura já está cancelada." }`.
3. **cancel:**
   - Remote-first: `try { await deps.gateway.cancelSubscription(subId); } catch (e) { if (!isDefinitiveGatewayReject(e)) { console.error(...); return { status: 500, body: { error: "Erro ao cancelar a assinatura. Tente novamente.", code: "gateway_error" } }; } }` (a definitive 4xx means already canceled remotely: proceed to reconcile locally).
   - Local CAS pinned on everything observed:
```ts
const { columns, immediateDowngrade } = buildCancelColumns(row.status as string, nowIso);
const { data: casRows, error: casErr } = await deps.db
  .from("workspace_subscriptions")
  .update(columns)
  .eq("workspace_id", ctx.workspaceId)
  .eq("provider", "pagarme")
  .eq("pagarme_subscription_id", subId)
  .eq("status", row.status)
  .select("workspace_id")
  .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
if (casErr) throw new Error(`cancel write failed: ${casErr.message}`);
```
   - Zero CAS rows: the remote cancel SUCCEEDED and a concurrent writer (the webhook's `subscription.canceled` reconcile) already moved the row. Tolerated: `console.warn`, skip the grant, and still return success (the remote state is what the user asked for).
   - If `immediateDowngrade` AND the CAS wrote: `const target = await getDefaultPlanId(deps.db);` then the exact RPC idiom from `pagarme-webhook/handler.ts:185-200` with `p_status: "canceled"`, `p_sub: subId`, `p_plan: target`. RPC error → throw. `written === 0` → `console.warn` (concurrent transition or manual comp), not an error.
   - Response: `200 { status: "canceled", access_until: immediateDowngrade ? null : (row.current_period_end ?? null) }`.
4. **update_card:** additionally guard `if (!row.pagarme_customer_id)` → same 404 body. Then:
```ts
let cardId: string;
try {
  const card = await deps.gateway.attachCard(row.pagarme_customer_id, action.cardToken, action.billingAddress);
  cardId = card.id;
} catch (e) {
  console.error("[pagarme-subscription] card attach failed:", e instanceof Error ? e.message : String(e));
  if (isDefinitiveGatewayReject(e)) {
    return { status: 400, body: { error: "Cartão recusado. Confira os dados ou tente outro cartão.", code: "invalid_card" } };
  }
  return { status: 500, body: { error: "Erro ao atualizar o cartão. Tente novamente.", code: "gateway_error" } };
}
try {
  await deps.gateway.updateSubscriptionCard(subId, cardId);
} catch (e) {
  console.error("[pagarme-subscription] card swap failed:", e instanceof Error ? e.message : String(e));
  if (isDefinitiveGatewayReject(e)) {
    return { status: 400, body: { error: "Cartão recusado. Confira os dados ou tente outro cartão.", code: "invalid_card" } };
  }
  return { status: 500, body: { error: "Erro ao atualizar o cartão. Tente novamente.", code: "gateway_error" } };
}
return { status: 200, body: { ok: true } };
```
   No local DB writes (the card is not persisted locally). Pagar.me's own retry schedule uses the new card for a mid-dunning charge; a manual charge-retry endpoint is out of scope (we do not store charge ids).

- [ ] **Step 4: `index.ts` (serve shell)**

Byte-for-byte the `pagarme-checkout/index.ts` structure: OPTIONS/CORS via `buildCorsHeaders(req)`; 405 on non-POST; Authorization → service-role client → `getUser(token)` (401 on failure); `profiles.conta_id` → workspaceId (400 "No workspace"); `workspace_members` owner gate via `isWorkspaceOwner` (403 "Forbidden"); rate limit (update_card attaches a tokenized card, a card-testing target — same limits as checkout):
```ts
const wsAllowed = await checkRateLimit(svc, `pagarme-subscription:ws:${workspaceId}`, 5, 3600);
const ipAllowed = await checkRateLimit(svc, `pagarme-subscription:ip:${getClientIP(req)}`, 10, 3600);
if (!wsAllowed || !ipAllowed) {
  return json({ error: "Muitas tentativas. Aguarde alguns minutos e tente de novo." }, 429, headers);
}
```
Then `parseSubscriptionBody(await req.json().catch(() => null))` → 400 on failure; `handleSubscriptionAction({ db: svc, gateway: createPagarmeSubscriptionGateway() }, { workspaceId }, parsed.value)`; catch-all → log + `500 { error: "Erro interno." }`. (Copy the checkout's `json()` helper and env bootstrap verbatim; user email is NOT required here.)

- [ ] **Step 5: config.toml + config-audit**

Append to `supabase/config.toml` next to the pagarme block:
```toml
[functions.pagarme-subscription]
verify_jwt = false
```
Add `"pagarme-subscription"` to `REQUIRED_FUNCTIONS` in `config-audit_test.ts` under the "Billing (manual auth...)" grouping.

- [ ] **Step 6: Tests**

`pagarme-subscription-logic_test.ts` (pure): parse matrix (non-object, unknown action, cancel ok, update_card missing token, bad cep/state, happy update_card with masked/dirty input normalized); `buildCancelColumns` for active (paid-through, no downgrade), trialing and past_due (immediate downgrade, `cancel_at_period_end: false`), and assert `current_period_end` is NEVER among the columns.

`pagarme-subscription-handler_test.ts`: copy the thenable `makeDb`/`makeGateway` event-recording harness from `pagarme-checkout-handler_test.ts` (events `{op, table, values, filters}` + gateway `calls`). Cases:
1. cancel trialing: gateway DELETE called; CAS update pinned on `provider/pagarme_subscription_id/status='trialing'`; columns `{status:'canceled', cancel_at_period_end:false}`; `grant_pagarme_plan` RPC called with `p_status:'canceled'` and the default plan; 200 with `access_until: null`.
2. cancel active: CAS columns `{status:'canceled', cancel_at_period_end:true}`; NO rpc call; `access_until` = row's `current_period_end`.
3. cancel past_due: immediate downgrade (rpc called).
4. remote DELETE throws definitive 404 → proceeds with local write (success).
5. remote DELETE throws 500 → returns 500, NO local write events.
6. CAS zero rows → warn path: no rpc, still 200.
7. rpc error → throws.
8. no row / provider stripe / null sub id → 404, no gateway calls.
9. status canceled → 409, no gateway calls.
10. update_card happy: attachCard then updateSubscriptionCard with the attached card id; no `workspace_subscriptions` write events; 200 `{ok:true}`.
11. attach 422 → 400 invalid_card; swap never called.
12. swap 500 → 500 gateway_error.
13. update_card with null `pagarme_customer_id` → 404.
14. Every `workspace_subscriptions` op carries an abortSignal (assert on recorded events, as the checkout tests do).

- [ ] **Step 7: Run tests, commit**

Run: `npm run test:functions` (revert `deno.lock`). Expected: PASS.

```bash
git add supabase/functions/pagarme-subscription/ supabase/config.toml supabase/functions/__tests__/
git commit -m "feat(billing): pagarme-subscription edge function (cancel + update_card)"
```

---

### Task 3: `billing-downgrade-cron` (downgrade + stale attempts + orphan sweep)

**Files:**
- Create: `supabase/functions/billing-downgrade-cron/gateway.ts`, `handler.ts`, `index.ts`
- Modify: `supabase/config.toml`, `supabase/functions/__tests__/config-audit_test.ts`
- Test: `supabase/functions/__tests__/billing-downgrade-cron-handler_test.ts`

**Interfaces:**
- Consumes: `getDefaultPlanId`, `isDefinitiveGatewayReject`, `shouldSweepRemoteSubscription`, `SWEEP_MIN_AGE_MS` (Task 1); `grant_pagarme_plan` RPC; `timingSafeEqual` from `_shared/crypto.ts`; `reportCronFailure` from `_shared/triage.ts`; cron auth wrapper shape from `mention-email-cron/handler.ts:306-316`.
- Produces: `POST /functions/v1/billing-downgrade-cron` (x-cron-secret) → `200 { success: true, downgraded, attemptsExpired, orphansCanceled, orphansUnrecognized, sweepTruncated, remoteSkipped, errors }`.

- [ ] **Step 1: `gateway.ts`**

```ts
// Thin port over pagarmeFetch for the cron's remote legs.
import { pagarmeFetch } from "../_shared/pagarme.ts";

export interface RemoteSubListItem {
  id: string;
  status?: string;
  created_at?: string | null;
  metadata?: { workspace_id?: string | null } | null;
}

export interface DowngradeCronGateway {
  /** GET /subscriptions?status=&page=&size= — page/size pagination, {data, paging} envelope. */
  listSubscriptions(
    status: "active" | "future",
    page: number,
    size: number,
  ): Promise<{ data: RemoteSubListItem[]; paging?: { total_pages?: number } }>;
  /** DELETE /subscriptions/{id}. */
  cancelSubscription(subId: string): Promise<unknown>;
}

export function createDowngradeCronGateway(): DowngradeCronGateway {
  return {
    listSubscriptions: (status, page, size) =>
      pagarmeFetch("GET", `/subscriptions?status=${status}&page=${page}&size=${size}`),
    cancelSubscription: (subId) => pagarmeFetch("DELETE", `/subscriptions/${subId}`),
  };
}
```

- [ ] **Step 2: `handler.ts` — three legs**

Deps: `{ db: SupabaseClient; gateway: DowngradeCronGateway | null; now?: () => Date }`. `gateway === null` means `PAGARME_SECRET_KEY` is unset in this environment (dark): legs B's compensating cancel and all of leg C are skipped with `console.warn("[billing-downgrade-cron] PAGARME_SECRET_KEY unset; remote legs skipped")` and `remoteSkipped: true` in the result. Constants: `DB_TIMEOUT_MS = 10_000`, `BATCH_LIMIT = 100`, `STALE_ATTEMPT_MINUTES = 15` (same value as checkout), `SWEEP_PAGE_SIZE = 50`, `SWEEP_MAX_PAGES = 20`.

Export `runBillingDowngradeCron(deps): Promise<CronResult>` where `CronResult = { downgraded: number; attemptsExpired: number; orphansCanceled: number; orphansUnrecognized: number; sweepTruncated: boolean; remoteSkipped: boolean; errors: string[] }`. Per-item failures push a message into `errors` and CONTINUE (one bad row must not starve the rest); each leg wraps its own body so a leg-level crash is also captured into `errors` and later legs still run.

**Leg A — paid-through downgrade (always runs, no gateway needed):**
```ts
const { data: due, error: dueErr } = await deps.db
  .from("workspace_subscriptions")
  .select("workspace_id, pagarme_subscription_id")
  .eq("provider", "pagarme")
  .eq("status", "canceled")
  .eq("cancel_at_period_end", true)
  .lte("current_period_end", nowIso)
  .limit(BATCH_LIMIT)
  .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
if (dueErr) throw new Error(`due rows read failed: ${dueErr.message}`);
```
For each row: (1) `grant_pagarme_plan` RPC (`p_workspace`, `p_plan: defaultPlanId` — resolved ONCE before the loop via `getDefaultPlanId(deps.db)`, `p_sub: row.pagarme_subscription_id`, `p_status: "canceled"`); RPC error → push to `errors`, continue to the NEXT row (no flip). `written === 1` → increment `downgraded`. `written === 0` → `console.warn` (concurrent rebind OR manual comp — indistinguishable from the return value), do NOT count. (2) After ANY error-free RPC (written 1 or 0), attempt the flag flip so the row leaves the daily query — for a manual comp the episode is over and the comp stays preserved, and for a concurrently-changed row the flip's own CAS pins make it a natural zero-row no-op:
```ts
.update({ cancel_at_period_end: false, updated_at: nowIso })
.eq("workspace_id", row.workspace_id)
.eq("provider", "pagarme")
.eq("pagarme_subscription_id", row.pagarme_subscription_id)
.eq("status", "canceled")
.eq("cancel_at_period_end", true)
```
Flip error → push to `errors`; flip zero rows → silent continue (the row moved; next run re-evaluates, and the grant is idempotent). ORDER MATTERS: grant first, flip second — flipping first and failing the grant would strand a paid plan forever (the row leaves the query).

**Leg B — stale checkout attempts (global backstop of checkout's per-workspace self-heal):**
Select `id, workspace_id, pagarme_subscription_id` from `pagarme_checkout_attempts` where `state = 'pending'` and `created_at < now - 15min`, `limit(BATCH_LIMIT)`. For each: if it has a `pagarme_subscription_id` AND `deps.gateway` exists → `cancelSubscription`; a non-definitive failure (`!isDefinitiveGatewayReject`) → push to `errors`, SKIP the expiry (never release a reservation while the remote may be live — same rule as `pagarme-checkout/handler.ts:119-139`); if it has a sub id and `deps.gateway === null` → skip entirely (dark env: leave pending for the env that can check). Attempts with no sub id, or after a settled cancel: expire with the CAS `.update({ state: "expired", updated_at: nowIso }).eq("id", a.id).eq("state", "pending")`. Count `attemptsExpired`.

**Leg C — remote orphan sweep (the flip precondition; runs only with a gateway):**
1. Load local link sets (both reads bounded, errors throw into the leg's catch):
```ts
// ALL known pagarme subscription ids, regardless of current provider: a row Stripe
// reclaimed keeps its legacy pagarme_subscription_id, and that remote sub is still "ours".
const { data: linked } = await deps.db.from("workspace_subscriptions")
  .select("pagarme_subscription_id").not("pagarme_subscription_id", "is", null)
  .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
const { data: pendingAttempts } = await deps.db.from("pagarme_checkout_attempts")
  .select("pagarme_subscription_id").eq("state", "pending").not("pagarme_subscription_id", "is", null)
  .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
```
Build `Set<string>`s from both.
2. For `status` of `["active", "future"]`: page from 1, `listSubscriptions(status, page, SWEEP_PAGE_SIZE)`; iterate `data`; stop when `data.length < SWEEP_PAGE_SIZE` or (paging.total_pages reached) or page > `SWEEP_MAX_PAGES` (then `sweepTruncated = true` and `console.warn` — no silent caps). A list-call failure → push to `errors`, break that status's loop, continue with the next status.
3. Per sub: `shouldSweepRemoteSubscription(sub, linkedIds, pendingIds, deps.now())`:
   - `"cancel"` → `console.error("[billing-downgrade-cron] CRITICAL orphan subscription: canceling", sub.id, "workspace", sub.metadata?.workspace_id)` then `cancelSubscription(sub.id)`; success or definitive reject → `orphansCanceled++`; other failure → push to `errors`.
   - `"skip_unrecognized"` → `orphansUnrecognized++` + `console.warn` with the sub id (a subscription in OUR account that our checkout did not create deserves eyes, but is never touched).
   - other skips → nothing.

- [ ] **Step 3: `index.ts`**

Follow `mention-email-cron/index.ts` exactly: module-load throw on missing `CRON_SECRET`; `timingSafeEqual` gate on `x-cron-secret` (401); service-role client with the 10s global fetch timeout; `const gateway = Deno.env.get("PAGARME_SECRET_KEY") ? createDowngradeCronGateway() : null;`; run → `200 { success: true, ...result }`; if `result.errors.length > 0`, call `reportCronFailure(svc, "billing-downgrade-cron", { failed: result.errors.length, errors: result.errors.map((e) => ({ error: e })) })` best-effort BEFORE returning 200 (partial failure is still a completed run; triage sees it). A thrown error → `reportCronFailure` + `500 { error: "Internal server error" }`. (Match `reportCronFailure`'s real detail shape from `_shared/triage.ts` — copy how mention-email-cron builds it.)

- [ ] **Step 4: config.toml + config-audit**

```toml
[functions.billing-downgrade-cron]
verify_jwt = false
```
Add `"billing-downgrade-cron"` to `REQUIRED_FUNCTIONS` under the "Cron (x-cron-secret)" grouping.

- [ ] **Step 5: Tests**

`billing-downgrade-cron-handler_test.ts`, same fake harness (db events + gateway calls + `rpc` recorder from `pagarme-webhook-handler_test.ts`). Cases:
1. Leg A: two due rows → default plan resolved once; rpc per row with `p_status:'canceled'`; flag-flip CAS pinned on all four observed columns; `downgraded: 2`.
2. Leg A rpc `written: 0` (manual comp / concurrent rebind) → not counted in `downgraded`, flag flip STILL attempted (its CAS pins make it safe), no error collected.
3. Leg A rpc error on row 1 → error collected, row 2 still processed.
4. Leg A flip zero rows → error-free continue.
5. Leg B: attempt with sub id → gateway DELETE then expiry CAS (`state='pending'` pin); attempt without sub id → expiry only, no gateway call.
6. Leg B non-definitive cancel failure (500) → NO expiry, error collected.
7. Leg B definitive 404 → expiry proceeds.
8. `gateway: null` → leg B expires only no-sub-id attempts; leg C skipped entirely; `remoteSkipped: true`; leg A still runs.
9. Leg C: fixture pages — linked sub skipped, pending-attempt sub skipped, young sub skipped, no-metadata sub → `orphansUnrecognized`, true orphan → DELETE called, `orphansCanceled: 1`.
10. Leg C pagination: first page full (size 50 mock → use size from the call), second short page ends the loop; `SWEEP_MAX_PAGES` exceeded → `sweepTruncated: true`.
11. Leg C list failure on "active" → error collected, "future" still listed.
12. Leg order and isolation: leg A read error → error collected, legs B/C still run.

Reuse `PagarmeApiError` fixtures for definitive/non-definitive gateway errors.

- [ ] **Step 6: Run tests, commit**

Run: `npm run test:functions` (revert `deno.lock`). Expected: PASS.

```bash
git add supabase/functions/billing-downgrade-cron/ supabase/config.toml supabase/functions/__tests__/
git commit -m "feat(billing): billing-downgrade-cron (paid-through downgrade + stale attempts + orphan sweep)"
```

---

### Task 4: pg_cron schedule migration + local CI sweep

**Files:**
- Create: `supabase/migrations/20260814000001_schedule_billing_downgrade_cron.sql` (VERIFY the version prefix against `git ls-tree origin/main:supabase/migrations | tail` at PR-open time and renumber ABOVE main's tail — the migration-version-guard CI job and the twice-struck collision gotcha)
- Modify: none

**Interfaces:**
- Consumes: the deployed `billing-downgrade-cron` function name; vault secrets `project_url` + `cron_secret` (already provisioned for the other crons).

- [ ] **Step 1: Write the migration** (exact shape of `20260803000007_schedule_mention_email_cron.sql`, daily at 06:00 UTC = 03:00 BRT, before business hours):

```sql
-- Daily billing downgrade for Pagar.me subscriptions: paid-through rows past their
-- current_period_end lose the paid plan; stale checkout attempts are expired (backstop of
-- the checkout's own self-heal); remote orphan subscriptions (created by our checkout but
-- never bound locally) are canceled at the gateway. 06:00 UTC = 03:00 BRT.
-- NOTE: apply only AFTER the billing-downgrade-cron function is deployed (the schedule
-- fires against the live endpoint).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'billing-downgrade-cron') THEN
    PERFORM cron.unschedule('billing-downgrade-cron');
  END IF;
END $$;

SELECT cron.schedule(
  'billing-downgrade-cron',
  '0 6 * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
            || '/functions/v1/billing-downgrade-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
```

- [ ] **Step 2: Full local CI**

Run, in order: `npm run lint`; `npm run format:check` (fix with `npm run format` if needed); the four tsc commands (`npx tsc -p apps/crm/tsconfig.json --noEmit`, `apps/hub`, `apps/admin`, `tsconfig.scripts.json`); `npm run test`; `npm run test:functions`; `git checkout -- deno.lock`; verify `git status` clean besides intended files.
Expected: all green (nothing frontend changed, but the CI parity run is mandatory before push).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/
git commit -m "feat(cron): schedule billing-downgrade-cron (daily 06:00 UTC)"
```

---

## Deploy notes (execute only on explicit user order; recorded here for the deploy turn)

1. Deploy order per env: `npx supabase functions deploy pagarme-subscription --no-verify-jwt --use-api`, same for `billing-downgrade-cron`, THEN `npx supabase db push --linked` (dry-run first) so the schedule never fires against a missing function. `npm ci` after deploys (deno pollution).
2. `cat supabase/.temp/project-ref` before every linked command (link state flips; PROD=skjzpekeqefvlojenfsw, STAGING=wlyzhyfondykzpsiqsce).
3. The cron runs harmlessly while dark: leg A/B find no rows; leg C is skipped wherever `PAGARME_SECRET_KEY` is unset (`remoteSkipped: true`); once the key exists, leg C starts guarding the account.

## Riscos aceitos / follow-ups

- `update_card` does not retry the failed charge manually (`POST /charges/{id}/retry` exists but we do not persist charge ids); Pagar.me's own retry schedule picks up the new card. Follow-up if support confirms the schedule is too slow.
- The sweep trusts `metadata.workspace_id` as the "ours" marker; a manual dashboard subscription without it is logged (`orphansUnrecognized`) and never canceled.
- `PATCH /subscriptions/{id}/card` with `card_id` is the documented card-swap endpoint; the alternative `/payment-method` endpoint also exists. If staging E2E (Fase 7) hits a 4xx on `/card`, switch the gateway to `PATCH /subscriptions/{id}/payment-method` with `{ payment_method: "credit_card", card_id }` — one line in the gateway.
