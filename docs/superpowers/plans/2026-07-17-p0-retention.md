# P0 Retention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a failed payment reach the owner on a defined timeline, put at-risk workspaces in front of a human weekly, and make the activation funnel measurable.

**Architecture:** Stripe owns the dunning timeline (Smart Retries, then cancel); the app only communicates during it and renders the banner as state derived from `workspace_subscriptions`, never stored. Every decision point (escalation stage, episode fields, radar bucketing, URL assembly) lives in a pure module under `supabase/functions/_shared/` with Deno tests, keeping the webhook and cron bodies thin. The five components are independent and share only `_shared/app-url.ts`.

**Tech Stack:** Deno edge functions (Supabase), `npm:stripe@17`, `npm:@supabase/supabase-js@2`, Resend HTTP API, Postgres + pg_cron, React 19 + TanStack Query, Vitest + RTL, `posthog-js`.

Spec: `docs/superpowers/specs/2026-07-16-p0-retention-design.md`

## Global Constraints

- **All user-facing copy is PT-BR.** Emails, banners, checklist labels.
- **No linter/formatter per CLAUDE.md is wrong — CI enforces both.** Before pushing run: `npm run format`, `npm run lint`, `npm run test`, `npm run test:functions`. CI also gates a coverage ratchet.
- **Typecheck with `npm run build`** (runs `tsc` then `vite build`). There is no separate `typecheck` script.
- **Edge functions are Deno.** Imports use `npm:` specifiers or relative `.ts` paths. Never Node built-ins.
- **Never log or return raw error details to clients** from an edge function. Log generically, return a generic message.
- **Always `escapeHtml()`** (from `_shared/report-template/escape.ts`) when interpolating any value into an HTML string.
- **pg_cron vault access MUST use** `(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = '...')`. The `vault.decrypted_secret(...)` **function form does not exist on this instance** and fails silently — see `20260428000003`.
- **Deploy edge functions with `--use-api`** (the local Docker bundler is broken).
- **A cron function needs `verify_jwt = false` in `config.toml` and must be deployed BEFORE its schedule migration is applied** — the schedule fires immediately.
- **Check `supabase/.temp/project-ref` before any `--linked` command.** The repo defaults to **prod**.
- **Run one edge test file directly** rather than trusting a `--filter` string to match every test in it (a filter matches on test *name*, so `--filter "Dunning"` silently misses `buildFailureEpisode`):
  `npx deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys <path/to/file_test.ts>`
- **`npm run test:functions` dirties the root `deno.lock` every time** (confirmed while writing this plan). After running it: `git checkout -- deno.lock`. Never commit the root lockfile — only `supabase/functions/deno.lock` is committed, and only for an intentional dependency add.
- **`npm run test:functions` also pollutes `node_modules`** via Deno's `--node-modules-dir`, and this bit Task 4 for real. It installs a second copy of packages under `node_modules/.deno/` (e.g. `@tiptap+core@3.28.0` alongside the project's `3.22.4`), and it surfaces **as a `npm run build` typecheck failure** — screens of "Type X is not assignable to type X" naming two different versions of the same package — not as a vitest failure. **Do not diagnose this as pre-existing breakage: `git stash` cannot undo it, because the corruption is in `node_modules`, not your source.** The tell is any path containing `node_modules/.deno/`. Fix: `npm ci`. After it, the build is clean.
- **Commit after every task.** Do not batch.

---

## Deviations from the spec (decided while planning, with reasons)

Three, each recorded here rather than silently applied:

1. **`resolveHubUrl` DOES check `feature_hub_portal`.** The spec deferred this on the grounds that "the extra join is not worth it". Reading the code, it is not a join — `effectivePlanFeature(db, contaId, flag)` already exists in `_shared/entitlements-rpc.ts` and `resolveHubToken` already calls it. The cost is one line, and the failure it prevents (the agency's client clicking a dead "Ver Relatório Completo") damages the exact asset this work protects.
2. **`bucketWorkspace` takes `createdAt`.** The spec said "dormant — lastActivityAt older than 30 days, **or never**". The admin's `describeActivity` does not do that: a never-used workspace younger than 30 days is `cooling`, because it is unproven rather than abandoned. Since the spec requires admin and radar to never disagree, the radar mirrors the admin's actual rule.
3. **`resolveHubUrl` is tested with a stubbed client, not just its pure part.** `hub-token_test.ts` tests only the pure gate, but `hub-bootstrap_test.ts` establishes a `makeDb()` stub pattern. The query filters (`is_active`, `expires_at`) are the risky part and are worth covering.
4. **The spec's `stripe-webhook` tests land at the pure layer instead.** The spec asked for tests that "`past_due_since` [is] set once across redeliveries; recovery clears all three fields". Both behaviours live entirely in `buildFailureEpisode` / `buildRecoveryEpisode` and are tested there in Task 1. There is no `stripe-webhook_test.ts` in the repo and `handlePaymentFailed` is not exported; making the webhook body testable is a refactor this slice does not need to carry.

## Task → PR mapping

The spec calls for five PRs, one per component. Tasks group as:

| PR | Tasks | Ships |
|---|---|---|
| 1 | 1, 2, 3, 4 | Dunning end to end (columns, logic, email, webhook, banner) |
| 2 | 5, 6 | Retention radar cron |
| 3 | 7, 8 | PostHog instrumentation |
| 4 | 9 | Hub link in the report email |
| 5 | 10 | Checklist feature-awareness |

PR 1 first — it is the revenue fix and must not queue behind analytics review. PRs 2, 3 and 5 are independent of each other. PR 4 is gated on the `cron.job` check in Task 9.

---

### Task 1: Dunning data model and pure logic

**Files:**
- Create: `supabase/migrations/20260717000001_dunning_columns.sql`
- Create: `supabase/functions/_shared/dunning-logic.ts`
- Create: `supabase/functions/_shared/app-url.ts`
- Test: `supabase/functions/__tests__/dunning-logic_test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `DunningStage`, `selectDunningStage(attemptCount, nextPaymentAttempt)`, `DunningEpisode`, `buildFailureEpisode(existingPastDueSince, attemptCount, nextPaymentAttempt, now)`, `buildRecoveryEpisode()`, `isRecoveredStatus(status)`, `appBaseUrl()`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260717000001_dunning_columns.sql`:

```sql
-- Dunning episode state on the Stripe mirror.
--
-- past_due_since:       first failure of the current episode. Written coalesced against its own
--                       prior value so a redelivered webhook never restarts the clock. Cleared
--                       when Stripe reports the subscription healthy again.
-- next_payment_attempt: Stripe's next retry, mirrored for display only.
--
-- Both are display/diagnostic state. The authoritative dunning timeline lives in Stripe
-- (Smart Retries + cancel-after-final-failure). The app never decides when access ends: that
-- still happens through customer.subscription.deleted -> statusToPlanId -> default plan.

ALTER TABLE workspace_subscriptions
  ADD COLUMN IF NOT EXISTS past_due_since       timestamptz,
  ADD COLUMN IF NOT EXISTS next_payment_attempt timestamptz;
```

- [ ] **Step 2: Write the failing test**

Create `supabase/functions/__tests__/dunning-logic_test.ts`:

```ts
import { assertEquals } from "./assert.ts";
import {
  buildFailureEpisode,
  buildRecoveryEpisode,
  isRecoveredStatus,
  selectDunningStage,
} from "../_shared/dunning-logic.ts";

// Stripe sends unix seconds. Derived rather than hardcoded so the expectation stays readable.
const NEXT_ATTEMPT_UNIX = Math.floor(Date.UTC(2026, 6, 24, 10, 0, 0) / 1000); // 2026-07-24T10:00:00Z
const NEXT_ATTEMPT_ISO = "2026-07-24T10:00:00.000Z";

Deno.test("selectDunningStage: a first failure with a retry ahead is the soft notice", () => {
  assertEquals(selectDunningStage(1, NEXT_ATTEMPT_UNIX), "first");
});

Deno.test("selectDunningStage: later failures with a retry ahead escalate", () => {
  assertEquals(selectDunningStage(2, NEXT_ATTEMPT_UNIX), "retry");
  assertEquals(selectDunningStage(3, NEXT_ATTEMPT_UNIX), "retry");
});

Deno.test("selectDunningStage: no next attempt is final, whatever the attempt count", () => {
  // Stripe reporting no further retry is the only signal for "final" — the retry schedule is
  // dashboard config and can change without a deploy, so attempt_count cannot be trusted for it.
  assertEquals(selectDunningStage(1, null), "final");
  assertEquals(selectDunningStage(4, null), "final");
});

Deno.test("buildFailureEpisode: stamps past_due_since on the first failure", () => {
  const now = new Date("2026-07-17T10:00:00.000Z");
  const ep = buildFailureEpisode(null, 1, NEXT_ATTEMPT_UNIX, now);
  assertEquals(ep.past_due_since, "2026-07-17T10:00:00.000Z");
  assertEquals(ep.next_payment_attempt, NEXT_ATTEMPT_ISO);
  assertEquals(ep.failed_payment_count, 1);
});

Deno.test("buildFailureEpisode: preserves past_due_since across a redelivery", () => {
  const now = new Date("2026-07-20T10:00:00.000Z");
  const ep = buildFailureEpisode("2026-07-17T10:00:00.000Z", 2, NEXT_ATTEMPT_UNIX, now);
  assertEquals(ep.past_due_since, "2026-07-17T10:00:00.000Z");
});

Deno.test("buildFailureEpisode: a null next attempt stays null", () => {
  const now = new Date("2026-07-30T10:00:00.000Z");
  const ep = buildFailureEpisode("2026-07-17T10:00:00.000Z", 4, null, now);
  assertEquals(ep.next_payment_attempt, null);
  assertEquals(ep.failed_payment_count, 4);
});

Deno.test("buildRecoveryEpisode: clears the whole episode including the counter", () => {
  assertEquals(buildRecoveryEpisode(), {
    past_due_since: null,
    next_payment_attempt: null,
    failed_payment_count: 0,
  });
});

Deno.test("isRecoveredStatus: only active and trialing end an episode", () => {
  assertEquals(isRecoveredStatus("active"), true);
  assertEquals(isRecoveredStatus("trialing"), true);
  for (const s of ["past_due", "canceled", "unpaid", "incomplete", "paused"]) {
    assertEquals(isRecoveredStatus(s), false);
  }
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test:functions -- --filter "selectDunningStage"`
Expected: FAIL — `Module not found "../_shared/dunning-logic.ts"`.

- [ ] **Step 4: Write the implementation**

Create `supabase/functions/_shared/dunning-logic.ts`:

```ts
// Pure helpers for the dunning episode. No Stripe/Supabase/env dependencies — unit-testable in
// isolation, mirroring billing-logic.ts.

export type DunningStage = "first" | "retry" | "final";

/**
 * Picks the escalation stage for a failed invoice.
 *
 * `nextPaymentAttempt === null` is Stripe stating it will not retry again. That, and not a
 * hardcoded attempt count, is the "final notice" signal: the retry schedule is configured in the
 * Stripe dashboard and can change without a deploy.
 */
export function selectDunningStage(
  attemptCount: number,
  nextPaymentAttempt: number | null,
): DunningStage {
  if (nextPaymentAttempt === null) return "final";
  if (attemptCount <= 1) return "first";
  return "retry";
}

export interface DunningEpisode {
  past_due_since: string | null;
  next_payment_attempt: string | null;
  failed_payment_count: number;
}

/**
 * Fields to write on invoice.payment_failed. `past_due_since` coalesces against its own prior
 * value so a redelivered webhook never restarts the episode clock.
 *
 * @param nextPaymentAttempt Stripe's unix seconds, or null when it will not retry again.
 */
export function buildFailureEpisode(
  existingPastDueSince: string | null,
  attemptCount: number,
  nextPaymentAttempt: number | null,
  now: Date,
): DunningEpisode {
  return {
    past_due_since: existingPastDueSince ?? now.toISOString(),
    next_payment_attempt:
      nextPaymentAttempt === null ? null : new Date(nextPaymentAttempt * 1000).toISOString(),
    failed_payment_count: attemptCount,
  };
}

/** Fields to write when Stripe reports the subscription healthy again. */
export function buildRecoveryEpisode(): DunningEpisode {
  return { past_due_since: null, next_payment_attempt: null, failed_payment_count: 0 };
}

/** Statuses that mean the dunning episode is over. */
export function isRecoveredStatus(status: string): boolean {
  return status === "active" || status === "trialing";
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:functions -- --filter "Dunning"`
Expected: PASS, 8 tests.

- [ ] **Step 6: Add the shared base-URL helper**

Create `supabase/functions/_shared/app-url.ts`:

```ts
/**
 * Public base URL of the deployed apps. The CRM lives at `/`, the Hub at `/:workspace/hub/:token`
 * on the same origin (see vercel.json rewrites), so one base serves both.
 *
 * Deliberately NOT OAUTH_REDIRECT_BASE: that variable means "where Meta sends the OAuth callback"
 * and coupling the two would make an OAuth change silently rewrite customer email links.
 */
export function appBaseUrl(): string {
  return Deno.env.get("APP_BASE_URL") ?? "http://localhost:5173";
}
```

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260717000001_dunning_columns.sql \
        supabase/functions/_shared/dunning-logic.ts \
        supabase/functions/_shared/app-url.ts \
        supabase/functions/__tests__/dunning-logic_test.ts
git commit -m "feat(billing): dunning episode columns and pure stage logic"
```

---

### Task 2: Dunning email

**Files:**
- Create: `supabase/functions/_shared/dunning-email.ts`
- Test: `supabase/functions/__tests__/dunning-email_test.ts`

**Interfaces:**
- Consumes: `DunningStage` from `_shared/dunning-logic.ts`; `escapeHtml` from `_shared/report-template/escape.ts`.
- Produces: `buildDunningCopy(stage, workspaceName, nextAttemptLabel)` returning `{ subject, heading, body, cta }`; `buildDunningEmail(params)` returning an HTML string; `sendDunningEmail(params)` returning `Promise<void>` that **never throws**.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/__tests__/dunning-email_test.ts`:

```ts
import { assert, assertEquals } from "./assert.ts";
import { buildDunningCopy, buildDunningEmail } from "../_shared/dunning-email.ts";

Deno.test("buildDunningCopy: the first notice stays soft and names the retry date", () => {
  const copy = buildDunningCopy("first", "Agência DK", "24 de julho");
  assert(copy.subject.includes("Agência DK"));
  assert(copy.body.includes("24 de julho"));
  // The common cause is an expired card, not a refusal — the first mail must not threaten.
  assert(!copy.body.includes("Free"));
});

Deno.test("buildDunningCopy: the final notice states the consequence", () => {
  const copy = buildDunningCopy("final", "Agência DK", null);
  assert(copy.subject.includes("Último aviso"));
  assert(copy.body.includes("Free"));
});

Deno.test("buildDunningCopy: retry copy without a known date omits the date sentence", () => {
  const copy = buildDunningCopy("retry", "Agência DK", null);
  assert(!copy.body.includes("undefined"));
  assert(!copy.body.includes("null"));
});

Deno.test("buildDunningEmail: escapes the workspace name", () => {
  const html = buildDunningEmail({
    stage: "first",
    workspaceName: '<script>alert("x")</script>',
    nextAttemptLabel: "24 de julho",
    billingUrl: "https://app.example.com/configuracao/cobranca",
  });
  assert(!html.includes("<script>"));
  assert(html.includes("&lt;script&gt;"));
});

Deno.test("buildDunningEmail: links the billing page", () => {
  const html = buildDunningEmail({
    stage: "final",
    workspaceName: "Agência DK",
    nextAttemptLabel: null,
    billingUrl: "https://app.example.com/configuracao/cobranca",
  });
  assert(html.includes("https://app.example.com/configuracao/cobranca"));
});

Deno.test("buildDunningCopy: every stage produces a non-empty subject and cta", () => {
  for (const stage of ["first", "retry", "final"] as const) {
    const copy = buildDunningCopy(stage, "WS", "1 de agosto");
    assertEquals(copy.subject.length > 0, true);
    assertEquals(copy.cta.length > 0, true);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/dunning-email_test.ts`
Expected: FAIL — `Module not found "../_shared/dunning-email.ts"`.

- [ ] **Step 3: Write the implementation**

Create `supabase/functions/_shared/dunning-email.ts`:

```ts
import { escapeHtml } from "./report-template/escape.ts";
import type { DunningStage } from "./dunning-logic.ts";

export interface DunningCopy {
  subject: string;
  heading: string;
  body: string;
  cta: string;
}

/**
 * PT-BR copy per stage.
 *
 * `first` deliberately does not threaten: the overwhelmingly common cause of a failed charge is
 * an expired or re-issued card, and treating a healthy customer like a delinquent one costs more
 * goodwill than the mail recovers.
 */
export function buildDunningCopy(
  stage: DunningStage,
  workspaceName: string,
  nextAttemptLabel: string | null,
): DunningCopy {
  const retrySentence = nextAttemptLabel
    ? ` Vamos tentar novamente em ${nextAttemptLabel}.`
    : "";

  switch (stage) {
    case "first":
      return {
        subject: `Não conseguimos processar seu pagamento — ${workspaceName}`,
        heading: "Não conseguimos processar seu pagamento",
        body:
          `A cobrança da assinatura do ${workspaceName} não foi aprovada. ` +
          `Isso normalmente acontece quando o cartão expirou ou foi substituído.` +
          retrySentence,
        cta: "Atualizar forma de pagamento",
      };
    case "retry":
      return {
        subject: `Ainda não conseguimos processar seu pagamento — ${workspaceName}`,
        heading: "Ainda não conseguimos processar seu pagamento",
        body:
          `Continuamos sem conseguir cobrar a assinatura do ${workspaceName}.` +
          retrySentence +
          ` Atualize sua forma de pagamento para manter o acesso.`,
        cta: "Atualizar forma de pagamento",
      };
    case "final":
      return {
        subject: `Último aviso: o acesso ao ${workspaceName} será reduzido`,
        heading: "Último aviso",
        body:
          `Não conseguimos processar o pagamento da assinatura do ${workspaceName} após várias ` +
          `tentativas. Sem uma forma de pagamento válida, o workspace será movido para o plano ` +
          `Free e os recursos do seu plano atual deixarão de funcionar.`,
        cta: "Regularizar agora",
      };
  }
}

export function buildDunningEmail(params: {
  stage: DunningStage;
  workspaceName: string;
  nextAttemptLabel: string | null;
  billingUrl: string;
}): string {
  const copy = buildDunningCopy(
    params.stage,
    escapeHtml(params.workspaceName),
    params.nextAttemptLabel ? escapeHtml(params.nextAttemptLabel) : null,
  );
  const link = escapeHtml(params.billingUrl);
  const accent = params.stage === "final" ? "#f55a42" : "#1a3d2b";

  return `<!DOCTYPE html>
<html lang="pt-BR"><body style="margin:0;background:#f5f3ee;font-family:Arial,Helvetica,sans-serif;color:#1a3d2b">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
    <table width="440" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden">
      <tr><td style="background:${accent};padding:28px;text-align:center;color:#fff;font-size:18px;font-weight:600">
        ${copy.heading}
      </td></tr>
      <tr><td style="padding:28px;font-size:14px;line-height:1.6;color:#444441">
        <p>${copy.body}</p>
        <p style="text-align:center;margin:28px 0">
          <a href="${link}" style="display:inline-block;background:${accent};color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600">${copy.cta}</a>
        </p>
        <p style="font-size:12px;color:#888780">Se você já atualizou seu pagamento, pode ignorar este e-mail.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

/**
 * Send the dunning e-mail via Resend.
 *
 * Best-effort by design, mirroring _shared/notify.ts and NOT _shared/invite-email.ts: stripe-webhook
 * returns 500 on a handler throw and Stripe redelivers the event, so a throwing send would re-send
 * the mail on every redelivery. Returns silently when Resend is not configured.
 */
export async function sendDunningEmail(params: {
  to: string;
  stage: DunningStage;
  workspaceName: string;
  nextAttemptLabel: string | null;
  billingUrl: string;
}): Promise<void> {
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) return;

  const copy = buildDunningCopy(params.stage, params.workspaceName, params.nextAttemptLabel);

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Mesaas <cobranca@mesaas.com.br>",
        to: [params.to],
        subject: copy.subject,
        html: buildDunningEmail({
          stage: params.stage,
          workspaceName: params.workspaceName,
          nextAttemptLabel: params.nextAttemptLabel,
          billingUrl: params.billingUrl,
        }),
      }),
    });
    if (!res.ok) console.error(`[dunning-email] Resend error: ${res.status}`);
  } catch (_e) {
    console.error("[dunning-email] Failed to send dunning email");
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/dunning-email_test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/dunning-email.ts \
        supabase/functions/__tests__/dunning-email_test.ts
git commit -m "feat(billing): escalating PT-BR dunning email template and sender"
```

---

### Task 3: Wire dunning into the Stripe webhook

**Files:**
- Modify: `supabase/functions/stripe-webhook/index.ts`

**Interfaces:**
- Consumes: `buildFailureEpisode`, `buildRecoveryEpisode`, `isRecoveredStatus`, `selectDunningStage`, `DunningEpisode` from `_shared/dunning-logic.ts`; `sendDunningEmail` from `_shared/dunning-email.ts`; `appBaseUrl` from `_shared/app-url.ts`.
- Produces: no new exports. `workspace_subscriptions.past_due_since` / `.next_payment_attempt` are now populated, and `failed_payment_count` resets on recovery.

- [ ] **Step 1: Add the imports**

In `supabase/functions/stripe-webhook/index.ts`, after the existing `billing-logic.ts` import block:

```ts
import {
  buildFailureEpisode,
  buildRecoveryEpisode,
  isRecoveredStatus,
  selectDunningStage,
  type DunningEpisode,
} from "../_shared/dunning-logic.ts";
import { sendDunningEmail } from "../_shared/dunning-email.ts";
import { appBaseUrl } from "../_shared/app-url.ts";
```

- [ ] **Step 2: Replace `handlePaymentFailed`**

Replace the whole existing `handlePaymentFailed` function with:

```ts
async function handlePaymentFailed(svc: SupabaseClient, invoice: Stripe.Invoice) {
  const customerId = typeof invoice.customer === "string"
    ? invoice.customer : invoice.customer?.id;
  if (!customerId) return;

  // past_due_since is selected so buildFailureEpisode can coalesce against its own prior value.
  const { data: row } = await svc
    .from("workspace_subscriptions").select("workspace_id, past_due_since")
    .eq("stripe_customer_id", customerId).maybeSingle();
  if (!row?.workspace_id) throw new Error(`No workspace for failed-invoice customer ${customerId}`);

  const nextAttempt = invoice.next_payment_attempt ?? null;
  const episode = buildFailureEpisode(
    (row.past_due_since as string | null) ?? null,
    invoice.attempt_count ?? 0,
    nextAttempt,
    new Date(),
  );

  await svc.from("workspace_subscriptions").update({
    status: "past_due",
    ...episode,
    updated_at: new Date().toISOString(),
  }).eq("workspace_id", row.workspace_id);

  await notifyOwnerOfFailure(svc, row.workspace_id as string, invoice, nextAttempt, episode);
}

/**
 * Tell the owner their payment failed. Swallows everything: a throw here would 500 the handler,
 * Stripe would redeliver, and the customer would get the same mail again.
 *
 * The owner is the only role that can act — billing-checkout and billing-portal are owner-gated.
 */
async function notifyOwnerOfFailure(
  svc: SupabaseClient,
  workspaceId: string,
  invoice: Stripe.Invoice,
  nextAttempt: number | null,
  episode: DunningEpisode,
) {
  try {
    const { data: ws } = await svc
      .from("workspaces").select("name").eq("id", workspaceId).maybeSingle();

    // workspace_members, not profiles.conta_id: profiles has no email column, and conta_id is the
    // legacy single-workspace field. This is the path platform-admin already uses.
    const { data: ownerMember } = await svc
      .from("workspace_members").select("user_id")
      .eq("workspace_id", workspaceId).eq("role", "owner").limit(1).maybeSingle();
    if (!ownerMember?.user_id) return;

    const { data: ownerUser } = await svc.auth.admin.getUserById(ownerMember.user_id as string);
    const to = ownerUser?.user?.email;
    if (!to) return;

    await sendDunningEmail({
      to,
      stage: selectDunningStage(invoice.attempt_count ?? 0, nextAttempt),
      workspaceName: (ws?.name as string | undefined) ?? "seu workspace",
      nextAttemptLabel: formatAttemptLabel(episode.next_payment_attempt),
      billingUrl: `${appBaseUrl()}/configuracao/cobranca`,
    });
  } catch (e) {
    // Internal log only — CLAUDE.md's "generic message" rule governs client responses, not
    // server logs. Without the workspace id and reason, a dead Resend key looks exactly like a
    // one-off blip, and nobody can tell which owner was never warned before losing access.
    // Message only: never a stack trace, never the whole error object.
    console.error(
      `[stripe-webhook] dunning notification failed for workspace ${workspaceId}:`,
      e instanceof Error ? e.message : String(e),
    );
  }
}

/** "2026-07-24T10:00:00.000Z" -> "24 de julho". Null when Stripe will not retry again. */
function formatAttemptLabel(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "long" });
}
```

- [ ] **Step 3: Clear the episode on recovery in `syncSubscription`**

In `syncSubscription`, replace the existing `await svc.from("workspace_subscriptions").upsert({...})` call with:

```ts
  // Upsert only writes the columns provided, so spreading {} leaves the episode fields untouched
  // for non-recovery statuses. This is also the fix for failed_payment_count never resetting —
  // without it a recovered workspace reads as permanently troubled in the admin.
  const recovery = isRecoveredStatus(sub.status) ? buildRecoveryEpisode() : {};

  await svc.from("workspace_subscriptions").upsert({
    workspace_id: workspaceId,
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    status: sub.status,
    plan_id: resolved?.plan_id ?? null,
    billing_interval: resolved?.interval ?? null,
    current_period_end: periodEndUnix
      ? new Date(periodEndUnix * 1000).toISOString() : null,
    cancel_at_period_end: sub.cancel_at_period_end ?? false,
    ...recovery,
    updated_at: new Date().toISOString(),
  }, { onConflict: "workspace_id" });
```

- [ ] **Step 4: Verify the whole edge suite still passes**

Run: `npm run test:functions`
Expected: PASS. No existing test asserts on `handlePaymentFailed` (there is no `stripe-webhook_test.ts`), so nothing should break.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/stripe-webhook/index.ts
git commit -m "feat(billing): send escalating dunning email and reset episode on recovery"
```

---

### Task 4: Dunning banner in the CRM

**Files:**
- Modify: `apps/crm/src/services/billing.ts:42-47` (interface) and `:126-132` (select)
- Create: `apps/crm/src/components/billing/DunningBanner.tsx`
- Modify: `apps/crm/src/components/layout/AppLayout.tsx:71`
- Test: `apps/crm/src/components/billing/__tests__/DunningBanner.test.tsx`

**Interfaces:**
- Consumes: `getWorkspaceSubscription()` and `WorkspaceSubscription` from `services/billing.ts`; `useAuth()` from `context/AuthContext`.
- Produces: `<DunningBanner />` (default-less named export).

- [ ] **Step 1: Widen the subscription type and select**

In `apps/crm/src/services/billing.ts`, replace the `WorkspaceSubscription` interface with:

```ts
export interface WorkspaceSubscription {
  status: string | null;
  plan_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  past_due_since: string | null;
  next_payment_attempt: string | null;
}
```

and in `getWorkspaceSubscription`, widen the select string:

```ts
    .select(
      'status, plan_id, current_period_end, cancel_at_period_end, past_due_since, next_payment_attempt',
    )
```

- [ ] **Step 2: Write the failing test**

Create `apps/crm/src/components/billing/__tests__/DunningBanner.test.tsx`:

```tsx
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DunningBanner } from '../DunningBanner';

const { getWorkspaceSubscriptionMock, useAuthMock } = vi.hoisted(() => ({
  getWorkspaceSubscriptionMock: vi.fn(),
  useAuthMock: vi.fn(),
}));

vi.mock('../../../services/billing', () => ({
  getWorkspaceSubscription: getWorkspaceSubscriptionMock,
}));

vi.mock('../../../context/AuthContext', () => ({
  useAuth: useAuthMock,
}));

function renderBanner() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DunningBanner />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('DunningBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue({ profile: { role: 'owner', conta_id: 'ws-1' } });
  });

  it('warns the owner when the subscription is past_due', async () => {
    getWorkspaceSubscriptionMock.mockResolvedValue({
      status: 'past_due',
      plan_id: 'pro',
      current_period_end: null,
      cancel_at_period_end: false,
      past_due_since: '2026-07-17T10:00:00.000Z',
      next_payment_attempt: '2026-07-24T10:00:00.000Z',
    });
    renderBanner();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/não conseguimos processar/i)).toBeInTheDocument();
  });

  it('stays silent when the subscription is healthy', async () => {
    getWorkspaceSubscriptionMock.mockResolvedValue({
      status: 'active',
      plan_id: 'pro',
      current_period_end: null,
      cancel_at_period_end: false,
      past_due_since: null,
      next_payment_attempt: null,
    });
    renderBanner();
    await waitFor(() => expect(getWorkspaceSubscriptionMock).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not query or render for a non-owner', async () => {
    // RLS already hides the row from non-owners; this keeps agents from seeing a billing problem
    // they cannot act on, and avoids a guaranteed-empty request on every page load.
    useAuthMock.mockReturnValue({ profile: { role: 'agent', conta_id: 'ws-1' } });
    renderBanner();
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    expect(getWorkspaceSubscriptionMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run apps/crm/src/components/billing/__tests__/DunningBanner.test.tsx`
Expected: FAIL — cannot resolve `../DunningBanner`.

- [ ] **Step 4: Write the component**

Create `apps/crm/src/components/billing/DunningBanner.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { getWorkspaceSubscription } from '../../services/billing';

/**
 * Derived state, deliberately not a global_banners row.
 *
 * global_banners targets a workspace rather than a role (every agent would read the owner's
 * billing failure), is dismissible, and would need create-on-fail / archive-on-recovery lifecycle
 * that can drift from Stripe. Rendering straight from workspace_subscriptions cannot drift: the
 * banner exists exactly while Stripe says the payment is failing.
 */
export function DunningBanner() {
  const { profile } = useAuth();
  const isOwner = profile?.role === 'owner';

  const { data } = useQuery({
    queryKey: ['workspace-subscription-dunning'],
    queryFn: getWorkspaceSubscription,
    enabled: isOwner,
    staleTime: 5 * 60_000,
  });

  if (!isOwner || data?.status !== 'past_due') return null;

  const retryLabel = data.next_payment_attempt
    ? new Date(data.next_payment_attempt).toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: 'long',
      })
    : null;

  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '1rem',
        flexWrap: 'wrap',
        padding: '0.75rem 1.25rem',
        background: 'rgba(245, 90, 66, 0.1)',
        borderBottom: '1px solid var(--danger)',
        color: 'var(--text-main)',
        fontSize: '0.9rem',
      }}
    >
      <span>
        <strong>Não conseguimos processar seu pagamento.</strong>{' '}
        {retryLabel
          ? `Vamos tentar novamente em ${retryLabel}. Atualize sua forma de pagamento para manter o acesso.`
          : 'Atualize sua forma de pagamento para não perder o acesso ao seu plano.'}
      </span>
      <Link
        to="/configuracao/cobranca"
        style={{
          flexShrink: 0,
          background: 'var(--danger)',
          color: '#fff',
          textDecoration: 'none',
          padding: '0.4rem 0.9rem',
          borderRadius: 8,
          fontWeight: 600,
          fontSize: '0.8rem',
        }}
      >
        Regularizar
      </Link>
    </div>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run apps/crm/src/components/billing/__tests__/DunningBanner.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 6: Mount it in the layout**

In `apps/crm/src/components/layout/AppLayout.tsx`, add the import at the top:

```tsx
import { DunningBanner } from '../billing/DunningBanner';
```

and render it immediately before the existing `<GlobalBannerContainer />` (around line 71):

```tsx
        <DunningBanner />
        <GlobalBannerContainer />
```

- [ ] **Step 7: Typecheck, then commit**

```bash
npm run build
git add apps/crm/src/services/billing.ts \
        apps/crm/src/components/billing/DunningBanner.tsx \
        apps/crm/src/components/billing/__tests__/DunningBanner.test.tsx \
        apps/crm/src/components/layout/AppLayout.tsx
git commit -m "feat(billing): owner-only past_due banner derived from subscription state"
```

---

### Task 5: Radar bucketing logic

**Files:**
- Create: `supabase/functions/_shared/radar-logic.ts`
- Test: `supabase/functions/__tests__/radar-logic_test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `RadarBucket` (`'past_due' | 'trial_ending' | 'dormant' | 'cooling'`), `RadarInput` (`{ status, currentPeriodEnd, lastActivityAt, createdAt }`), `bucketWorkspace(row, now)` returning `RadarBucket | null`.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/__tests__/radar-logic_test.ts`:

```ts
import { assertEquals } from "./assert.ts";
import { bucketWorkspace } from "../_shared/radar-logic.ts";

const NOW = new Date("2026-07-17T12:00:00.000Z");
const CREATED_LONG_AGO = "2025-01-01T00:00:00.000Z";

function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * 86_400_000).toISOString();
}
function daysAhead(n: number): string {
  return new Date(NOW.getTime() + n * 86_400_000).toISOString();
}

Deno.test("bucketWorkspace: past_due outranks everything", () => {
  // A failing payment is the most urgent signal even on a workspace in daily use.
  assertEquals(
    bucketWorkspace(
      { status: "past_due", currentPeriodEnd: null, lastActivityAt: daysAgo(1), createdAt: CREATED_LONG_AGO },
      NOW,
    ),
    "past_due",
  );
});

Deno.test("bucketWorkspace: a trial ending within 7 days surfaces", () => {
  assertEquals(
    bucketWorkspace(
      { status: "trialing", currentPeriodEnd: daysAhead(3), lastActivityAt: daysAgo(1), createdAt: CREATED_LONG_AGO },
      NOW,
    ),
    "trial_ending",
  );
});

Deno.test("bucketWorkspace: a trial ending later is not yet urgent", () => {
  assertEquals(
    bucketWorkspace(
      { status: "trialing", currentPeriodEnd: daysAhead(20), lastActivityAt: daysAgo(1), createdAt: CREATED_LONG_AGO },
      NOW,
    ),
    null,
  );
});

Deno.test("bucketWorkspace: active workspaces are not reported", () => {
  assertEquals(
    bucketWorkspace(
      { status: "active", currentPeriodEnd: null, lastActivityAt: daysAgo(2), createdAt: CREATED_LONG_AGO },
      NOW,
    ),
    null,
  );
});

Deno.test("bucketWorkspace: boundaries match the admin's describeActivity exactly", () => {
  // apps/admin/src/pages/workspace-activity.ts: days <= 7 active, days <= 30 cooling, else dormant.
  const base = { status: "active", currentPeriodEnd: null, createdAt: CREATED_LONG_AGO };
  assertEquals(bucketWorkspace({ ...base, lastActivityAt: daysAgo(7) }, NOW), null);
  assertEquals(bucketWorkspace({ ...base, lastActivityAt: daysAgo(8) }, NOW), "cooling");
  assertEquals(bucketWorkspace({ ...base, lastActivityAt: daysAgo(30) }, NOW), "cooling");
  assertEquals(bucketWorkspace({ ...base, lastActivityAt: daysAgo(31) }, NOW), "dormant");
});

Deno.test("bucketWorkspace: a never-used young workspace is cooling, not dormant", () => {
  // Mirrors describeActivity: a workspace created days ago has not had a chance to be used, so it
  // is unproven rather than abandoned.
  assertEquals(
    bucketWorkspace(
      { status: "active", currentPeriodEnd: null, lastActivityAt: null, createdAt: daysAgo(3) },
      NOW,
    ),
    "cooling",
  );
});

Deno.test("bucketWorkspace: a never-used old workspace is dormant", () => {
  assertEquals(
    bucketWorkspace(
      { status: "active", currentPeriodEnd: null, lastActivityAt: null, createdAt: daysAgo(90) },
      NOW,
    ),
    "dormant",
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:functions -- --filter "bucketWorkspace"`
Expected: FAIL — `Module not found "../_shared/radar-logic.ts"`.

- [ ] **Step 3: Write the implementation**

Create `supabase/functions/_shared/radar-logic.ts`:

```ts
// Pure bucketing for the weekly retention radar. No Supabase/env dependencies.
//
// THRESHOLDS ARE MIRRORED FROM apps/admin/src/pages/workspace-activity.ts (describeActivity).
// They cannot be imported — that module is browser code using Intl for its labels, and this runs
// in Deno — so if you change one, change the other. The radar and the admin Workspaces list
// disagreeing about who is dormant would make both untrustworthy.

const DAY_MS = 86_400_000;
const ACTIVE_MAX_DAYS = 7;
const COOLING_MAX_DAYS = 30;
const TRIAL_ENDING_DAYS = 7;

export type RadarBucket = "past_due" | "trial_ending" | "dormant" | "cooling";

export interface RadarInput {
  status: string | null;
  currentPeriodEnd: string | null;
  lastActivityAt: string | null;
  createdAt: string;
}

function wholeDaysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

/**
 * The single worst signal for a workspace, or null when it looks healthy.
 *
 * Precedence is most-urgent-first so a workspace appears exactly once in the digest: a past_due
 * workspace that is also dormant is a billing problem first.
 */
export function bucketWorkspace(row: RadarInput, now: Date): RadarBucket | null {
  if (row.status === "past_due") return "past_due";

  if (row.status === "trialing" && row.currentPeriodEnd) {
    const daysLeft = wholeDaysBetween(now, new Date(row.currentPeriodEnd));
    if (daysLeft <= TRIAL_ENDING_DAYS) return "trial_ending";
  }

  if (row.lastActivityAt === null) {
    const age = wholeDaysBetween(new Date(row.createdAt), now);
    return age > COOLING_MAX_DAYS ? "dormant" : "cooling";
  }

  const days = wholeDaysBetween(new Date(row.lastActivityAt), now);
  if (days <= ACTIVE_MAX_DAYS) return null;
  if (days <= COOLING_MAX_DAYS) return "cooling";
  return "dormant";
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:functions -- --filter "bucketWorkspace"`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/radar-logic.ts \
        supabase/functions/__tests__/radar-logic_test.ts
git commit -m "feat(retention): pure at-risk bucketing mirroring admin activity thresholds"
```

---

### Task 6: Retention radar cron

**Files:**
- Create: `supabase/functions/retention-radar-cron/handler.ts`
- Create: `supabase/functions/retention-radar-cron/email.ts`
- Create: `supabase/functions/retention-radar-cron/index.ts`
- Modify: `supabase/config.toml`
- Create: `supabase/migrations/20260717000002_schedule_retention_radar_cron.sql`
- Test: `supabase/functions/__tests__/retention-radar-cron_test.ts`

**Interfaces:**
- Consumes: `bucketWorkspace`, `RadarBucket`, `RadarInput` from `_shared/radar-logic.ts`; `timingSafeEqual` from `_shared/crypto.ts`; the existing `admin_workspace_last_activity(uuid[])` RPC.
- Produces: `createRetentionRadarCronHandler(deps)`; `buildRadarEmail(rows)`.

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/__tests__/retention-radar-cron_test.ts`:

```ts
import { assert, assertEquals } from "./assert.ts";
import { createRetentionRadarCronHandler } from "../retention-radar-cron/handler.ts";
import { buildRadarEmail } from "../retention-radar-cron/email.ts";

const timingSafeEqual = (a: string, b: string) => a === b;

Deno.test("retention-radar-cron rejects requests without the shared cron secret", async () => {
  const handler = createRetentionRadarCronHandler({
    cronSecret: "segredo-cron",
    timingSafeEqual,
    run: async () => new Response("ok"),
  });
  const response = await handler(new Request("https://example.test/retention-radar-cron"));
  assertEquals(response.status, 401);
});

Deno.test("retention-radar-cron runs with the correct secret", async () => {
  const handler = createRetentionRadarCronHandler({
    cronSecret: "segredo-cron",
    timingSafeEqual,
    run: async () => new Response("ok"),
  });
  const response = await handler(
    new Request("https://example.test/retention-radar-cron", {
      headers: { "x-cron-secret": "segredo-cron" },
    }),
  );
  assertEquals(response.status, 200);
});

Deno.test("buildRadarEmail: groups rows by bucket and escapes names", () => {
  const html = buildRadarEmail([
    {
      bucket: "past_due",
      workspaceName: "<b>DK</b>",
      ownerEmail: "dono@example.com",
      planId: "pro",
      status: "past_due",
      lastActivityAt: "2026-07-16T10:00:00.000Z",
      failedPaymentCount: 2,
    },
    {
      bucket: "dormant",
      workspaceName: "Outra",
      ownerEmail: "b@example.com",
      planId: "start",
      status: "active",
      lastActivityAt: null,
      failedPaymentCount: 0,
    },
  ]);
  assert(html.includes("Pagamento falhando"));
  assert(html.includes("Dormentes"));
  assert(!html.includes("<b>DK</b>"));
  assert(html.includes("&lt;b&gt;DK&lt;/b&gt;"));
});

Deno.test("buildRadarEmail: says so plainly when nothing is at risk", () => {
  const html = buildRadarEmail([]);
  assert(html.includes("Nenhum workspace em risco"));
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/retention-radar-cron_test.ts`
Expected: FAIL — `Module not found "../retention-radar-cron/handler.ts"`.

- [ ] **Step 3: Write the handler**

Create `supabase/functions/retention-radar-cron/handler.ts`:

```ts
interface RetentionRadarCronDeps {
  cronSecret: string;
  run: (req: Request) => Promise<Response>;
  timingSafeEqual: (a: string, b: string) => boolean;
}

export function createRetentionRadarCronHandler(deps: RetentionRadarCronDeps) {
  return async (req: Request): Promise<Response> => {
    if (!deps.timingSafeEqual(req.headers.get("x-cron-secret") ?? "", deps.cronSecret)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    return deps.run(req);
  };
}
```

- [ ] **Step 4: Write the email builder**

Create `supabase/functions/retention-radar-cron/email.ts`:

```ts
import { escapeHtml } from "../_shared/report-template/escape.ts";
import type { RadarBucket } from "../_shared/radar-logic.ts";

export interface RadarRow {
  bucket: RadarBucket;
  workspaceName: string;
  ownerEmail: string;
  planId: string | null;
  status: string | null;
  lastActivityAt: string | null;
  failedPaymentCount: number;
}

// Ordered most-urgent-first — this is the order a human should work the list in.
const SECTIONS: Array<{ bucket: RadarBucket; title: string; hint: string }> = [
  { bucket: "past_due", title: "Pagamento falhando", hint: "Stripe está tentando cobrar. Fale antes do cancelamento." },
  { bucket: "trial_ending", title: "Trial acabando", hint: "Menos de 7 dias para converter." },
  { bucket: "dormant", title: "Dormentes", hint: "Mais de 30 dias sem uso real." },
  { bucket: "cooling", title: "Esfriando", hint: "Entre 7 e 30 dias sem uso real." },
];

function fmtDate(iso: string | null): string {
  if (!iso) return "Nunca";
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

function renderSection(title: string, hint: string, rows: RadarRow[]): string {
  if (rows.length === 0) return "";
  const body = rows
    .map(
      (r) =>
        `<tr>` +
        `<td>${escapeHtml(r.workspaceName)}</td>` +
        `<td>${escapeHtml(r.ownerEmail)}</td>` +
        `<td>${escapeHtml(r.planId ?? "—")}</td>` +
        `<td>${escapeHtml(r.status ?? "—")}</td>` +
        `<td>${escapeHtml(fmtDate(r.lastActivityAt))}</td>` +
        `<td>${escapeHtml(String(r.failedPaymentCount))}</td>` +
        `</tr>`,
    )
    .join("");
  return (
    `<h3 style="margin:24px 0 4px">${escapeHtml(title)} (${rows.length})</h3>` +
    `<p style="margin:0 0 8px;color:#888780;font-size:12px">${escapeHtml(hint)}</p>` +
    `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:13px">` +
    `<tr><th>Workspace</th><th>Dono</th><th>Plano</th><th>Status</th><th>Última atividade</th><th>Falhas</th></tr>` +
    `${body}</table>`
  );
}

export function buildRadarEmail(rows: RadarRow[]): string {
  if (rows.length === 0) {
    return `<p>Nenhum workspace em risco esta semana.</p>`;
  }
  const sections = SECTIONS.map((s) =>
    renderSection(s.title, s.hint, rows.filter((r) => r.bucket === s.bucket)),
  ).join("");
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#1a3d2b">
    <p>${rows.length} workspace(s) precisam de atenção.</p>
    ${sections}
  </div>`;
}
```

- [ ] **Step 5: Write the cron entrypoint**

Create `supabase/functions/retention-radar-cron/index.ts`:

```ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { bucketWorkspace } from "../_shared/radar-logic.ts";
import { createRetentionRadarCronHandler } from "./handler.ts";
import { buildRadarEmail, type RadarRow } from "./email.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? (() => { throw new Error("CRON_SECRET is required"); })();

Deno.serve(createRetentionRadarCronHandler({
  cronSecret: CRON_SECRET,
  timingSafeEqual,
  run: async () => {
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

      // Paying and trialing only. A dormant Free workspace is an activation failure, not churn
      // risk, and would drown the list — PostHog measures that population instead.
      const { data: subs, error: subsErr } = await supabase
        .from("workspace_subscriptions")
        .select("workspace_id, status, plan_id, current_period_end, failed_payment_count")
        .in("status", ["active", "trialing", "past_due"]);
      if (subsErr) throw subsErr;

      const subRows = (subs ?? []) as Array<{
        workspace_id: string;
        status: string | null;
        plan_id: string | null;
        current_period_end: string | null;
        failed_payment_count: number;
      }>;
      if (subRows.length === 0) {
        return new Response(JSON.stringify({ success: true, reported: 0 }), {
          status: 200, headers: { "Content-Type": "application/json" },
        });
      }

      const ids = subRows.map((s) => s.workspace_id);

      const { data: wsData, error: wsErr } = await supabase
        .from("workspaces").select("id, name, created_at").in("id", ids);
      if (wsErr) throw wsErr;
      const wsById = new Map(
        (wsData ?? []).map((w) => [w.id as string, w as { id: string; name: string; created_at: string }]),
      );

      // Reuses the admin's RPC rather than restating its GREATEST-over-work-artifacts logic.
      const { data: activity, error: actErr } = await supabase
        .rpc("admin_workspace_last_activity", { workspace_ids: ids });
      if (actErr) throw actErr;
      const activityById = new Map(
        ((activity ?? []) as Array<{ workspace_id: string; last_activity_at: string | null }>)
          .map((a) => [a.workspace_id, a.last_activity_at]),
      );

      const now = new Date();
      const rows: RadarRow[] = [];

      for (const sub of subRows) {
        const ws = wsById.get(sub.workspace_id);
        if (!ws) continue;

        const bucket = bucketWorkspace({
          status: sub.status,
          currentPeriodEnd: sub.current_period_end,
          lastActivityAt: activityById.get(sub.workspace_id) ?? null,
          createdAt: ws.created_at,
        }, now);
        if (!bucket) continue;

        let ownerEmail = "—";
        const { data: ownerMember } = await supabase
          .from("workspace_members").select("user_id")
          .eq("workspace_id", sub.workspace_id).eq("role", "owner").limit(1).maybeSingle();
        if (ownerMember?.user_id) {
          const { data: ownerUser } = await supabase.auth.admin.getUserById(ownerMember.user_id as string);
          ownerEmail = ownerUser?.user?.email ?? "—";
        }

        rows.push({
          bucket,
          workspaceName: ws.name,
          ownerEmail,
          planId: sub.plan_id,
          status: sub.status,
          lastActivityAt: activityById.get(sub.workspace_id) ?? null,
          failedPaymentCount: sub.failed_payment_count,
        });
      }

      const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
      const ALERT_EMAIL = Deno.env.get("ALERT_EMAIL");
      if (RESEND_API_KEY && ALERT_EMAIL) {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "Mesaas Alerts <alertas@mesaas.com.br>",
            to: [ALERT_EMAIL],
            subject: `[Mesaas] Radar de retenção — ${rows.length} workspace(s) em risco`,
            html: buildRadarEmail(rows),
          }),
        });
        if (!res.ok) console.error(`[retention-radar-cron] Resend error: ${res.status}`);
      }

      return new Response(JSON.stringify({ success: true, reported: rows.length }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("retention-radar-cron failed:", message);
      return new Response(JSON.stringify({ error: "Internal server error" }), {
        status: 500, headers: { "Content-Type": "application/json" },
      });
    }
  },
}));
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx deno test --no-check --node-modules-dir=auto --allow-env --allow-read --allow-net --allow-sys supabase/functions/__tests__/retention-radar-cron_test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 7: Register the function in config.toml**

In `supabase/config.toml`, add alongside the other cron entries:

```toml
[functions.retention-radar-cron]
verify_jwt = false
```

- [ ] **Step 8: Write the schedule migration**

Create `supabase/migrations/20260717000002_schedule_retention_radar_cron.sql`:

```sql
-- Weekly at-risk digest to ALERT_EMAIL: Mondays 12:00 UTC (09:00 Brasília), the same hour as the
-- existing deadline cron.
--
-- Must be applied AFTER supabase/config.toml's [functions.retention-radar-cron] entry has been
-- deployed — the schedule fires immediately.
--
-- Uses the vault.decrypted_secrets subselect form, NOT vault.decrypted_secret(...) (that function
-- form does not exist on this instance — see 20260428000003). pg_cron-layer failures are silent,
-- so getting this wrong produces a cron that simply never runs and never reports.
--
-- Idempotent: safe to apply twice.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'retention-radar-cron') THEN
    PERFORM cron.unschedule('retention-radar-cron');
  END IF;
END $$;

SELECT cron.schedule(
  'retention-radar-cron',
  '0 12 * * 1',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url')
            || '/functions/v1/retention-radar-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
```

- [ ] **Step 9: Commit**

```bash
git add supabase/functions/retention-radar-cron/ \
        supabase/functions/__tests__/retention-radar-cron_test.ts \
        supabase/config.toml \
        supabase/migrations/20260717000002_schedule_retention_radar_cron.sql
git commit -m "feat(retention): weekly at-risk radar digest cron"
```

---

### Task 7: PostHog client and identity

**Files:**
- Modify: `package.json` (add `posthog-js`)
- Create: `apps/crm/src/lib/analytics.ts`
- Modify: `apps/crm/src/main.tsx`
- Modify: `apps/crm/src/context/AuthContext.tsx:114`
- Modify: `apps/crm/src/pages/politica-privacidade/PoliticaPage.tsx`
- Test: `apps/crm/src/lib/__tests__/analytics.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `AnalyticsEvent` (union of the 8 event names), `initAnalytics()`, `identifyWorkspaceUser(userId, props)`, `captureEvent(event, props?)`, `resetAnalytics()`.

- [ ] **Step 1: Install the SDK**

```bash
npm install posthog-js
```

- [ ] **Step 2: Write the failing test**

Create `apps/crm/src/lib/__tests__/analytics.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { posthogMock } = vi.hoisted(() => ({
  posthogMock: {
    init: vi.fn(),
    identify: vi.fn(),
    capture: vi.fn(),
    reset: vi.fn(),
    group: vi.fn(),
  },
}));

vi.mock('posthog-js', () => ({ default: posthogMock }));

describe('analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('no-ops entirely when no key is configured', async () => {
    // Local dev and CI have no key. Analytics must never be a hard dependency of booting the app.
    vi.stubEnv('VITE_POSTHOG_KEY', '');
    const { initAnalytics, captureEvent } = await import('../analytics');
    initAnalytics();
    captureEvent('client_created');
    expect(posthogMock.init).not.toHaveBeenCalled();
    expect(posthogMock.capture).not.toHaveBeenCalled();
  });

  it('initialises against the EU host and only builds identified profiles', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');
    const { initAnalytics } = await import('../analytics');
    initAnalytics();
    expect(posthogMock.init).toHaveBeenCalledWith(
      'phc_test',
      expect.objectContaining({
        api_host: 'https://eu.i.posthog.com',
        person_profiles: 'identified_only',
      }),
    );
  });

  it('captures events once initialised', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');
    const { initAnalytics, captureEvent } = await import('../analytics');
    initAnalytics();
    captureEvent('hub_link_copied', { cliente_id: 7 });
    expect(posthogMock.capture).toHaveBeenCalledWith('hub_link_copied', { cliente_id: 7 });
  });

  it('groups the user by workspace, because retention is a workspace property', async () => {
    vi.stubEnv('VITE_POSTHOG_KEY', 'phc_test');
    const { initAnalytics, identifyWorkspaceUser } = await import('../analytics');
    initAnalytics();
    identifyWorkspaceUser('user-1', { workspace_id: 'ws-1', plan_id: 'pro', role: 'owner' });
    expect(posthogMock.identify).toHaveBeenCalledWith('user-1', {
      workspace_id: 'ws-1',
      plan_id: 'pro',
      role: 'owner',
    });
    expect(posthogMock.group).toHaveBeenCalledWith('workspace', 'ws-1');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run apps/crm/src/lib/__tests__/analytics.test.ts`
Expected: FAIL — cannot resolve `../analytics`.

- [ ] **Step 4: Write the implementation**

Create `apps/crm/src/lib/analytics.ts`:

```ts
import posthog from 'posthog-js';

/**
 * Product analytics. EU cloud region.
 *
 * A closed union rather than free-form strings: an event name typo produces a silently missing
 * funnel step, which is worse than a build error because nobody notices for weeks.
 */
export type AnalyticsEvent =
  | 'signup_completed'
  | 'workspace_setup_completed'
  | 'client_created'
  | 'instagram_connected'
  | 'workflow_created'
  | 'hub_link_copied'
  | 'report_generated'
  | 'invite_sent';

export interface WorkspaceUserProps {
  workspace_id: string;
  plan_id: string | null;
  role: string;
}

const KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const HOST = (import.meta.env.VITE_POSTHOG_HOST as string | undefined) ?? 'https://eu.i.posthog.com';

let enabled = false;

/** Safe to call when unconfigured (local dev, CI, self-hosters): every export then no-ops. */
export function initAnalytics(): void {
  if (!KEY || enabled) return;
  posthog.init(KEY, {
    api_host: HOST,
    // Do not build a person profile for anonymous landing-page traffic — it is noise here, and
    // fewer profiles is the easier LGPD posture to defend.
    person_profiles: 'identified_only',
    capture_pageview: true,
  });
  enabled = true;
}

export function identifyWorkspaceUser(userId: string, props: WorkspaceUserProps): void {
  if (!enabled) return;
  posthog.identify(userId, { ...props });
  // Retention is a property of the workspace, not the individual — an agency churns, not a seat.
  posthog.group('workspace', props.workspace_id);
}

export function captureEvent(event: AnalyticsEvent, props?: Record<string, unknown>): void {
  if (!enabled) return;
  posthog.capture(event, props);
}

export function resetAnalytics(): void {
  if (!enabled) return;
  posthog.reset();
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run apps/crm/src/lib/__tests__/analytics.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Initialise on boot**

In `apps/crm/src/main.tsx`, add the import and call `initAnalytics()` immediately after the existing Sentry initialisation:

```tsx
import { initAnalytics } from './lib/analytics';

initAnalytics();
```

- [ ] **Step 7: Identify on auth**

In `apps/crm/src/context/AuthContext.tsx`, import the helpers:

```tsx
import { identifyWorkspaceUser, resetAnalytics } from '../lib/analytics';
```

Immediately after `setProfile(nextProfile as Profile | null);` (line 114 — the point where both the
user and their profile are resolved, just above the `void healPendingInvite();` call), add:

```tsx
        if (nextProfile) {
          // plan_id is null here on purpose: AuthContext resolves before entitlements load, and
          // blocking identify on a second request would delay every event behind it. Cohorting by
          // plan is a follow-up — enrich the `workspace` group where useEntitlements already has it.
          identifyWorkspaceUser(nextUser.id, {
            workspace_id: (nextProfile as Profile).conta_id,
            plan_id: null,
            role: (nextProfile as Profile).role,
          });
        }
```

In the provider's `signOut` implementation (the one wrapping `supabaseSignOut`), call
`resetAnalytics()` after the sign-out resolves, so the next user on a shared machine is not merged
into the previous identity.

- [ ] **Step 8: Disclose PostHog in the privacy policy**

In `apps/crm/src/pages/politica-privacidade/PoliticaPage.tsx`, add PostHog to the list of
third-party processors. The page is PT-BR; match its existing section markup and tone. Text to add:

> **PostHog** — análise de uso do produto (funis de ativação e retenção). Os dados são processados na região da União Europeia. Coletamos identificador de usuário, workspace, plano e eventos de uso do produto. Não enviamos conteúdo de clientes, mídias ou dados de pagamento.

- [ ] **Step 9: Typecheck, then commit**

```bash
npm run build
git add package.json package-lock.json \
        apps/crm/src/lib/analytics.ts \
        apps/crm/src/lib/__tests__/analytics.test.ts \
        apps/crm/src/main.tsx \
        apps/crm/src/context/AuthContext.tsx \
        apps/crm/src/pages/politica-privacidade/PoliticaPage.tsx
git commit -m "feat(analytics): PostHog EU client, workspace grouping, privacy disclosure"
```

---

### Task 8: Activation event call sites

**Files:**
- Modify: `apps/crm/src/pages/login/LoginPage.tsx`
- Modify: `apps/crm/src/pages/workspace-setup/WorkspaceSetupPage.tsx`
- Modify: `apps/crm/src/pages/clientes/ClientesPage.tsx`
- Modify: `apps/crm/src/pages/entregas/EntregasPage.tsx`
- Modify: `apps/crm/src/pages/cliente-detalhe/HubTab.tsx`
- Modify: `apps/crm/src/pages/analytics-conta/AnalyticsContaPage.tsx`
- Modify: `apps/crm/src/pages/configuracao/ConfiguracaoPage.tsx`

**Interfaces:**
- Consumes: `captureEvent` from `lib/analytics.ts` (Task 7).
- Produces: nothing.

- [ ] **Step 1: Add the seven call sites**

In each file, import the helper:

```tsx
import { captureEvent } from '@/lib/analytics';
```

and fire the event **on the success path only** — never before the mutation resolves, or the funnel counts attempts as successes:

| File | Where | Call |
|---|---|---|
| `LoginPage.tsx` | after `signUp` succeeds (where `setRegisterSuccess(true)` is called) | `captureEvent('signup_completed')` |
| `WorkspaceSetupPage.tsx` | after the workspace save succeeds, before the redirect | `captureEvent('workspace_setup_completed')` |
| `ClientesPage.tsx` | in the create-client mutation's `onSuccess` | `captureEvent('client_created')` |
| `EntregasPage.tsx` | in the create-workflow mutation's `onSuccess` | `captureEvent('workflow_created')` |
| `HubTab.tsx` | in the copy-link handler, after the clipboard write resolves | `captureEvent('hub_link_copied', { cliente_id: clienteId })` |
| `AnalyticsContaPage.tsx` | in the generate-report success path | `captureEvent('report_generated')` |
| `ConfiguracaoPage.tsx` | in `handleInvite` after the invite POST succeeds | `captureEvent('invite_sent')` |

`instagram_connected` fires from the OAuth return handler on `/clientes/:id` — find where the success toast for a connected account is raised and add `captureEvent('instagram_connected')` beside it.

- [ ] **Step 2: Verify nothing broke**

Run: `npm run test`
Expected: PASS. `captureEvent` no-ops without a key, so existing page tests are unaffected.

- [ ] **Step 3: Typecheck, then commit**

```bash
npm run build
git add apps/crm/src/pages/
git commit -m "feat(analytics): capture the eight activation funnel events"
```

---

### Task 9: Hub link in the report email

> **Blocked on a prod check.** Before starting, confirm `analytics-report-cron` is actually
> scheduled and running:
> ```sql
> SELECT jobname, schedule, active FROM cron.job;
> SELECT jobname, status, start_time FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
> ```
> `20260416000001` scheduled it with the broken `vault.decrypted_secret(...)` function form. If it
> is dead, the monthly report email is not being sent at all and repairing the schedule (a new
> migration using the subselect form) must land first — otherwise this task fixes a link in an
> email nobody receives.

**Files:**
- Create: `supabase/functions/_shared/hub-url.ts`
- Modify: `supabase/functions/instagram-analytics/index.ts:1333`
- Modify: `supabase/functions/report-worker/index.ts:207`
- Test: `supabase/functions/__tests__/hub-url_test.ts`

**Interfaces:**
- Consumes: `appBaseUrl` from `_shared/app-url.ts` (Task 1); `effectivePlanFeature` from `_shared/entitlements-rpc.ts`.
- Produces: `buildHubUrl(baseUrl, slug, token)`; `resolveHubUrl(svc, clienteId, contaId)` returning `Promise<string>` (`''` when unavailable).

- [ ] **Step 1: Write the failing test**

Create `supabase/functions/__tests__/hub-url_test.ts`:

```ts
import { assertEquals } from "./assert.ts";
import { buildHubUrl, resolveHubUrl } from "../_shared/hub-url.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

Deno.test("buildHubUrl: assembles the public hub URL", () => {
  assertEquals(
    buildHubUrl("https://app.mesaas.com.br", "agencia-dk", "tok-1"),
    "https://app.mesaas.com.br/agencia-dk/hub/tok-1",
  );
});

Deno.test("buildHubUrl: tolerates a trailing slash on the base", () => {
  assertEquals(
    buildHubUrl("https://app.mesaas.com.br/", "agencia-dk", "tok-1"),
    "https://app.mesaas.com.br/agencia-dk/hub/tok-1",
  );
});

Deno.test("buildHubUrl: returns empty when any part is missing", () => {
  assertEquals(buildHubUrl("https://x.test", null, "tok-1"), "");
  assertEquals(buildHubUrl("https://x.test", "slug", null), "");
});

/** Mirrors the makeDb() stub pattern from hub-bootstrap_test.ts. */
function makeDb(opts: {
  slug: string | null;
  token: string | null;
  featureOn: boolean;
}): SupabaseClient {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: opts.slug ? { slug: opts.slug } : null }),
          eq: () => ({
            eq: () => ({
              gt: () => ({
                order: () => ({
                  limit: () => ({
                    maybeSingle: async () => ({
                      data: opts.token ? { token: opts.token } : null,
                    }),
                  }),
                }),
              }),
            }),
          }),
        }),
      }),
      _table: table,
    }),
    rpc: async () => ({ data: opts.featureOn, error: null }),
  } as unknown as SupabaseClient;
}

Deno.test("resolveHubUrl: returns a link for a live token on an enabled plan", async () => {
  const db = makeDb({ slug: "agencia-dk", token: "tok-1", featureOn: true });
  const url = await resolveHubUrl(db, 7, "ws-1");
  assertEquals(url.endsWith("/agencia-dk/hub/tok-1"), true);
});

Deno.test("resolveHubUrl: returns empty when the workspace has no live token", async () => {
  const db = makeDb({ slug: "agencia-dk", token: null, featureOn: true });
  assertEquals(await resolveHubUrl(db, 7, "ws-1"), "");
});

Deno.test("resolveHubUrl: returns empty when the plan lost feature_hub_portal", async () => {
  // A downgraded workspace can still hold a live token. Emailing the agency's own client a link
  // that hub-bootstrap will reject is worse than omitting the button.
  const db = makeDb({ slug: "agencia-dk", token: "tok-1", featureOn: false });
  assertEquals(await resolveHubUrl(db, 7, "ws-1"), "");
});

Deno.test("resolveHubUrl: returns empty when the workspace has no slug", async () => {
  const db = makeDb({ slug: null, token: "tok-1", featureOn: true });
  assertEquals(await resolveHubUrl(db, 7, "ws-1"), "");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:functions -- --filter "HubUrl"`
Expected: FAIL — `Module not found "../_shared/hub-url.ts"`.

- [ ] **Step 3: Write the implementation**

Create `supabase/functions/_shared/hub-url.ts`:

```ts
import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { effectivePlanFeature } from "./entitlements-rpc.ts";
import { appBaseUrl } from "./app-url.ts";

/** Pure: assembles the public Hub URL. Empty string when any part is missing. */
export function buildHubUrl(baseUrl: string, slug: string | null, token: string | null): string {
  if (!slug || !token) return "";
  return `${baseUrl.replace(/\/+$/, "")}/${slug}/hub/${token}`;
}

/**
 * The client's live Hub URL, or '' when there isn't one.
 *
 * Every caller feeds this straight into buildReportEmail, which hides the button on an empty
 * string — so the failure mode is the status quo (no button) rather than a link that errors in
 * front of the agency's own client.
 *
 * Mirrors resolveHubToken's gates: an unexpired, active token AND feature_hub_portal on the plan.
 * Ordered newest-first rather than maybeSingle() on the bare filter, because nothing in the schema
 * stops a client from holding more than one token row.
 */
export async function resolveHubUrl(
  svc: SupabaseClient,
  clienteId: number,
  contaId: string,
): Promise<string> {
  const { data: ws } = await svc
    .from("workspaces").select("slug").eq("id", contaId).maybeSingle();
  const slug = (ws as { slug: string | null } | null)?.slug ?? null;
  if (!slug) return "";

  const { data: tok } = await svc
    .from("client_hub_tokens")
    .select("token")
    .eq("cliente_id", clienteId)
    .eq("conta_id", contaId)
    .eq("is_active", true)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const token = (tok as { token: string | null } | null)?.token ?? null;
  if (!token) return "";

  const featureOn = await effectivePlanFeature(svc, contaId, "feature_hub_portal");
  if (!featureOn) return "";

  return buildHubUrl(appBaseUrl(), slug, token);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:functions -- --filter "HubUrl"`
Expected: PASS, 7 tests.

- [ ] **Step 5: Use it in the manual send path**

In `supabase/functions/instagram-analytics/index.ts`, add the import near the other `_shared` imports:

```ts
import { resolveHubUrl } from "../_shared/hub-url.ts";
```

and replace line 1333:

```ts
      const hubUrl = ''; // Hub link would need client_hub_tokens lookup — keep simple for now
```

with:

```ts
      const hubUrl = await resolveHubUrl(serviceClient, report.client_id, contaId);
```

- [ ] **Step 6: Use it in the monthly auto-send path**

In `supabase/functions/report-worker/index.ts`, add the same import, then replace the `hubUrl: '',` line inside the `buildReportEmail({...})` call (line ~207) with:

```ts
            hubUrl: await resolveHubUrl(supabase, reportRow.client_id, reportRow.conta_id),
```

- [ ] **Step 7: Run the whole edge suite**

Run: `npm run test:functions`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add supabase/functions/_shared/hub-url.ts \
        supabase/functions/__tests__/hub-url_test.ts \
        supabase/functions/instagram-analytics/index.ts \
        supabase/functions/report-worker/index.ts
git commit -m "feat(reports): link the client's Hub from the monthly report email"
```

---

### Task 10: Checklist feature-awareness

**Files:**
- Modify: `apps/crm/src/components/OnboardingBanner.tsx:28-44`
- Test: `apps/crm/src/components/__tests__/OnboardingBanner.test.tsx`

**Interfaces:**
- Consumes: `useEntitlements()` from `hooks/useEntitlements`.
- Produces: no signature change — `<OnboardingBanner />` keeps its existing props.

- [ ] **Step 1: Write the failing test**

Create `apps/crm/src/components/__tests__/OnboardingBanner.test.tsx`:

```tsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OnboardingBanner } from '../OnboardingBanner';

const { useAuthMock, useEntitlementsMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useEntitlementsMock: vi.fn(),
}));

vi.mock('../../context/AuthContext', () => ({ useAuth: useAuthMock }));
vi.mock('../../hooks/useEntitlements', () => ({ useEntitlements: useEntitlementsMock }));

const EMPTY = { clientes: [], leads: [], membros: [], portfolioAccounts: [], workflows: [] } as never;

function renderBanner(features: Record<string, boolean>) {
  useEntitlementsMock.mockReturnValue({
    hasFeature: (flag: string) => features[flag] !== false,
  });
  return render(
    <MemoryRouter>
      <OnboardingBanner {...EMPTY} />
    </MemoryRouter>,
  );
}

describe('OnboardingBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useAuthMock.mockReturnValue({ profile: { role: 'owner', conta_id: 'ws-1' } });
  });

  it('shows every step on a plan that has every feature', () => {
    renderBanner({ feature_leads: true, feature_analytics_reports: true });
    expect(screen.getByText('Criar primeiro lead')).toBeInTheDocument();
    expect(screen.getByText('Conectar conta do Instagram')).toBeInTheDocument();
    expect(screen.getByText(/de 6/)).toBeInTheDocument();
  });

  it('hides steps the plan cannot complete', () => {
    // On Free these routes are nav-hidden and gated: offering them makes two of six steps
    // permanently uncompletable and walks a new user into a paywall.
    renderBanner({ feature_leads: false, feature_analytics_reports: false });
    expect(screen.queryByText('Criar primeiro lead')).not.toBeInTheDocument();
    expect(screen.queryByText('Conectar conta do Instagram')).not.toBeInTheDocument();
  });

  it('counts progress against the steps the plan actually offers', () => {
    renderBanner({ feature_leads: false, feature_analytics_reports: false });
    // 6 steps minus the 2 gated ones; "Conta criada" is already done.
    expect(screen.getByText('1 de 4')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run apps/crm/src/components/__tests__/OnboardingBanner.test.tsx`
Expected: FAIL — the gated steps still render, and the counter reads "1 de 6".

- [ ] **Step 3: Filter the steps by entitlement**

In `apps/crm/src/components/OnboardingBanner.tsx`, add the import:

```tsx
import { useEntitlements } from '../hooks/useEntitlements';
```

then replace the `const steps = [...]` block (lines 28-35) with:

```tsx
  const { hasFeature } = useEntitlements();

  // Each step carries the flag its destination is gated behind. Without this the checklist offers
  // Free users steps whose routes are nav-hidden and paywalled: the list can never reach 100%,
  // so it never auto-dismisses, and every click lands on an upgrade wall.
  // hasFeature is fail-open while entitlements load, matching the rest of the app.
  const allSteps = [
    { label: 'Conta criada', done: true, to: null, feature: null },
    { label: 'Adicionar primeiro cliente', done: clientes.length > 0, to: '/clientes', feature: null },
    { label: 'Criar primeiro lead', done: leads.length > 0, to: '/leads', feature: 'feature_leads' },
    { label: 'Adicionar membro da equipe', done: membros.length > 0, to: '/equipe', feature: null },
    {
      label: 'Conectar conta do Instagram',
      done: portfolioAccounts.length > 0,
      to: '/analytics',
      feature: 'feature_analytics_reports',
    },
    { label: 'Criar fluxo de entrega', done: workflows.length > 0, to: '/entregas', feature: null },
  ];

  const steps = allSteps.filter((s) => s.feature === null || hasFeature(s.feature));
```

The existing `completedCount`, `firstIncompleteIndex`, `progressPct`, and the auto-dismiss effect all already derive from `steps`, so they pick up the filtered list with no further change.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run apps/crm/src/components/__tests__/OnboardingBanner.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Verify the dashboard still renders**

Run: `npm run test`
Expected: PASS. `DashboardPage` passes the same props; only the internal step list changed.

- [ ] **Step 6: Typecheck, then commit**

```bash
npm run build
git add apps/crm/src/components/OnboardingBanner.tsx \
        apps/crm/src/components/__tests__/OnboardingBanner.test.tsx
git commit -m "fix(onboarding): stop offering checklist steps the plan cannot complete"
```

---

## Pre-push checklist

Run before opening any PR — CI gates all four:

```bash
npm run format
npm run lint
npm run test
npm run test:functions
git checkout -- deno.lock   # test:functions always dirties the root lockfile
npm run build
```

If vitest starts failing strangely right after `test:functions`, Deno's `--node-modules-dir` has polluted `node_modules`: run `npm ci`.

## Deployment runbook

Per component, in order. Component 1 ships first — it is the revenue fix and must not queue behind analytics review.

1. **Confirm the target project.** `cat supabase/.temp/project-ref` — the repo defaults to **prod**.
2. **Component 1:** apply `20260717000001`, set the `APP_BASE_URL` secret, deploy `stripe-webhook --use-api`, deploy the CRM. Then configure Stripe: Smart Retries on, ~4 attempts over ~14 days, terminal action **cancel subscription**, Stripe's own failed-payment emails on. Verify with a test-clock subscription that a failed invoice produces the email and the banner.
3. **Component 2:** deploy `retention-radar-cron --use-api` **first**, then apply `20260717000002`. Confirm with `SELECT jobname, active FROM cron.job WHERE jobname = 'retention-radar-cron';` and trigger once manually with the `x-cron-secret` header to check the digest renders.
4. **Component 3:** set `VITE_POSTHOG_KEY` and `VITE_POSTHOG_HOST` in Vercel, deploy, confirm events land in PostHog EU.
5. **Component 4:** only after the `cron.job` verification above. Deploy `instagram-analytics` and `report-worker` with `--use-api`.
6. **Component 5:** CRM deploy only.
