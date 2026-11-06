import { assert, assertEquals } from "./assert.ts";
import {
  type CronReportDetail,
  type LifecycleCronDeps,
  runLifecycleEmailCron,
  runNurturePreview,
} from "../lifecycle-email-cron/handler.ts";

/**
 * Fake of the two supabase surfaces the handler touches: .rpc(name) and the
 * .from("lifecycle_emails") claim-upsert / delivered-update chains. Rows live
 * in-memory with the same (email_type, key) uniqueness as the real constraints.
 * Staleness (the 1-hour gate) lives in the real RPCs' SQL, so the fake models
 * it directly: candidates are subjects with no row, or an undelivered row
 * marked stale via `markStale`.
 */
function makeFakeDb(opts: {
  welcomeCandidates?: Array<{ user_id: string; email: string; nome: string | null }>;
  thankCandidates?: Array<{
    workspace_id: string;
    workspace_name: string;
    owner_email: string;
    owner_nome: string | null;
    plan_name?: string | null;
    sub_status?: string | null;
    billing_interval?: string | null;
    stripe_subscription_id?: string | null;
  }>;
  trialCandidates?: Array<{
    workspace_id: string;
    workspace_name?: string;
    owner_email?: string;
    owner_nome?: string | null;
    plan_name?: string | null;
    provider?: string;
    amount_cents?: number | null;
    amount_interval?: string | null;
    billing_interval?: string | null;
    first_charge_at: string;
  }>;
  trialRpcError?: string;
  nurtureCandidates?: Array<{
    user_id: string;
    workspace_id: string;
    email: string;
    nome?: string | null;
    workspace_name?: string;
    workspace_created_at?: string;
    step: string;
    attempts?: number;
    client_count?: number;
    first_client_name?: string | null;
    has_instagram?: boolean;
  }>;
  nurtureRpcError?: string;
  /** claim_nurture_email result keyed `${workspace_id}/${step}`; default attempts + 1. */
  claimResults?: Record<string, number | null>;
  claimError?: string;
}) {
  type Row = {
    email_type: string;
    user_id?: string;
    workspace_id?: string;
    ref_at?: string;
    meta?: Record<string, unknown>;
    delivered: boolean;
    stale: boolean;
    attempts: number;
  };
  const rows: Row[] = [];
  const keyOf = (r: { user_id?: string; workspace_id?: string }) => r.user_id ?? r.workspace_id!;
  const find = (email_type: string, key: string) =>
    rows.find((r) => r.email_type === email_type && keyOf(r) === key);

  const rpcCalls: Array<{ name: string; args?: Record<string, unknown> }> = [];
  const nurtureUpdates: Array<{ patch: { delivered_at: string }; filters: Record<string, string> }> =
    [];
  const fromCalls: string[] = [];
  const db = {
    rows,
    rpcCalls,
    nurtureUpdates,
    fromCalls,
    markStale(email_type: string, key: string) {
      const r = find(email_type, key);
      if (r) r.stale = true;
    },
    rpc(name: string, args?: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      if (name === "get_nurture_candidates") {
        if (opts.nurtureRpcError) {
          return Promise.resolve({ data: null, error: { message: opts.nurtureRpcError } });
        }
        return Promise.resolve({
          data: (opts.nurtureCandidates ?? []).map((c) => ({
            nome: "Ana Souza",
            workspace_name: "Agencia N",
            workspace_created_at: "2026-09-01T10:00:00+00:00",
            attempts: 0,
            client_count: 0,
            first_client_name: null,
            has_instagram: false,
            ...c,
            email_type: `nurture_${c.step}`,
          })),
          error: null,
        });
      }
      if (name === "claim_nurture_email") {
        if (opts.claimError) {
          return Promise.resolve({ data: null, error: { message: opts.claimError } });
        }
        const key = `${args?.p_workspace_id}/${args?.p_step}`;
        const c = (opts.nurtureCandidates ?? []).find(
          (x) => x.workspace_id === args?.p_workspace_id && x.step === args?.p_step,
        );
        const result = opts.claimResults && key in opts.claimResults
          ? opts.claimResults[key]
          : (c?.attempts ?? 0) + 1;
        return Promise.resolve({ data: result, error: null });
      }
      // Mirrors the SQL: eligible = no row, or an undelivered stale row under
      // the 30-attempt cap; the RPC returns the current attempts count.
      const eligible = (email_type: string, key: string) => {
        const r = find(email_type, key);
        return !r || (!r.delivered && r.stale && r.attempts < 30);
      };
      const attemptsOf = (email_type: string, key: string) =>
        find(email_type, key)?.attempts ?? 0;
      if (name === "get_welcome_email_candidates") {
        return Promise.resolve({
          data: (opts.welcomeCandidates ?? [])
            .filter((c) => eligible("welcome", c.user_id))
            .map((c) => ({ ...c, attempts: attemptsOf("welcome", c.user_id) })),
          error: null,
        });
      }
      if (name === "get_thankyou_email_candidates") {
        return Promise.resolve({
          data: (opts.thankCandidates ?? [])
            .filter((c) => eligible("subscription_thanks", c.workspace_id))
            .map((c) => ({ ...c, attempts: attemptsOf("subscription_thanks", c.workspace_id) })),
          error: null,
        });
      }
      if (name === "get_trial_reminder_candidates") {
        if (opts.trialRpcError) {
          return Promise.resolve({ data: null, error: { message: opts.trialRpcError } });
        }
        return Promise.resolve({
          data: (opts.trialCandidates ?? [])
            .filter((c) => eligible("trial_reminder", c.workspace_id))
            .map((c) => ({
              workspace_name: "Agencia X",
              owner_email: "dono@x.test",
              owner_nome: "Bruno Lima",
              plan_name: "Pro",
              provider: "stripe",
              amount_cents: 13990,
              amount_interval: "month",
              billing_interval: "month",
              ...c,
              attempts: attemptsOf("trial_reminder", c.workspace_id),
            })),
          error: null,
        });
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    from(table: string) {
      fromCalls.push(table);
      if (table === "nurture_emails") {
        return {
          update(patch: { delivered_at: string }) {
            const filters: Record<string, string> = {};
            const chain = {
              eq(col: string, val: string) {
                filters[col] = val;
                return chain;
              },
              then(resolve: (v: { error: null }) => void) {
                nurtureUpdates.push({ patch, filters });
                resolve({ error: null });
              },
            };
            return chain;
          },
        };
      }
      assert(table === "lifecycle_emails");
      return {
        upsert(
          row: {
            email_type: string;
            user_id?: string;
            workspace_id?: string;
            sent_at: string;
            attempts: number;
            ref_at?: string;
            delivered_at?: null;
            meta?: Record<string, unknown>;
          },
          o: { onConflict: string },
        ) {
          assert(
            o.onConflict === "email_type,user_id" || o.onConflict === "email_type,workspace_id",
            `bad onConflict ${o.onConflict}`,
          );
          assert(typeof row.sent_at === "string", "claim must refresh sent_at");
          assert(typeof row.attempts === "number", "claim must write the attempt count");
          const existing = find(row.email_type, keyOf(row));
          if (existing) {
            existing.stale = false;
            existing.attempts = row.attempts;
            existing.ref_at = row.ref_at;
            existing.meta = row.meta;
          } else rows.push({ ...row, delivered: false, stale: false });
          return Promise.resolve({ error: null });
        },
        update(patch: { delivered_at: string }) {
          assert(typeof patch.delivered_at === "string");
          const filters: Record<string, string> = {};
          const chain = {
            eq(col: string, val: string) {
              filters[col] = val;
              return chain;
            },
            then(resolve: (v: { error: null }) => void) {
              const r = find(filters.email_type, filters.user_id ?? filters.workspace_id);
              if (r) r.delivered = true;
              resolve({ error: null });
            },
          };
          return chain;
        },
      };
    },
  };
  return db;
}

function makeDeps(db: ReturnType<typeof makeFakeDb>, overrides?: Partial<LifecycleCronDeps>) {
  const sent: Array<{ kind: string; to: string; firstName: string | null; key: string }> = [];
  const reminders: Array<{ to: string; subject: string; html: string; key: string }> = [];
  const founderSent: Array<{ kind: string; key: string; payload: Record<string, unknown> }> = [];
  const nurtureSent: Array<{
    to: string;
    subject: string;
    html: string;
    idempotencyKey: string;
    headers: Record<string, string>;
    tags: Record<string, string>;
  }> = [];
  const deps: LifecycleCronDeps = {
    db: db as unknown as LifecycleCronDeps["db"],
    appBaseUrl: "https://x.test",
    now: () => new Date("2026-07-30T12:00:00Z"),
    sendWelcome: (p) => {
      sent.push({ kind: "welcome", to: p.to, firstName: p.firstName, key: p.idempotencyKey });
      return Promise.resolve();
    },
    sendThanks: (p) => {
      sent.push({ kind: "thanks", to: p.to, firstName: p.firstName, key: p.idempotencyKey });
      return Promise.resolve();
    },
    sendFounderSignup: (p) => {
      founderSent.push({ kind: "founder_signup", key: p.idempotencyKey, payload: { ...p } });
      return Promise.resolve();
    },
    sendFounderSubscription: (p) => {
      founderSent.push({ kind: "founder_subscription", key: p.idempotencyKey, payload: { ...p } });
      return Promise.resolve();
    },
    sendTrialReminder: (p) => {
      reminders.push({ to: p.to, subject: p.subject, html: p.html, key: p.idempotencyKey });
      return Promise.resolve();
    },
    nurtureEnabled: false,
    nurtureUnsubLinks: (userId) =>
      Promise.resolve({ page: `https://app.test/descadastrar/${userId}`, oneClick: `https://unsub.test/${userId}` }),
    whatsappUrl: null,
    sendNurture: (p) => {
      nurtureSent.push({ ...p });
      return Promise.resolve();
    },
    report: () => Promise.resolve(),
    ...overrides,
  };
  return { deps, sent, founderSent, reminders, nurtureSent };
}

Deno.test("welcome sweep claims, sends with first name + key, marks delivered", async () => {
  const db = makeFakeDb({
    welcomeCandidates: [{ user_id: "u1", email: "ana@x.test", nome: "Ana Paula Souza" }],
  });
  const { deps, sent } = makeDeps(db);
  const result = await runLifecycleEmailCron(deps);
  assert(result.welcomeSent === 1 && result.failed === 0);
  assert(sent.length === 1 && sent[0].kind === "welcome");
  assert(sent[0].to === "ana@x.test" && sent[0].firstName === "Ana");
  assert(sent[0].key === "welcome/u1", `key was ${sent[0].key}`);
  const row = db.rows[0];
  assert(row.email_type === "welcome" && row.user_id === "u1" && row.delivered);
});

Deno.test("delivered subjects are not re-sent", async () => {
  const db = makeFakeDb({
    welcomeCandidates: [{ user_id: "u1", email: "ana@x.test", nome: "Ana" }],
  });
  const { deps, sent } = makeDeps(db);
  await runLifecycleEmailCron(deps);
  await runLifecycleEmailCron(deps);
  assert(sent.length === 1, "delivered subject was re-sent");
});

Deno.test("failed send leaves an undelivered claim; stale retry uses the same key", async () => {
  const db = makeFakeDb({
    welcomeCandidates: [{ user_id: "u1", email: "ana@x.test", nome: "Ana" }],
  });
  let calls = 0;
  const { deps, sent } = makeDeps(db, {
    sendWelcome: (p) => {
      calls++;
      if (calls === 1) return Promise.reject(new Error("resend down"));
      sent.push({ kind: "welcome", to: p.to, firstName: p.firstName, key: p.idempotencyKey });
      return Promise.resolve();
    },
  });
  const first = await runLifecycleEmailCron(deps);
  assert(first.welcomeSent === 0 && first.failed === 1);
  assert(db.rows.length === 1 && !db.rows[0].delivered, "claim missing or wrongly delivered");

  // Fresh claim: not yet a candidate again.
  const second = await runLifecycleEmailCron(deps);
  assert(second.welcomeSent === 0 && sent.length === 0, "fresh claim was retried early");

  // After the 1h stale window (modeled by the fake), it retries with the SAME key
  // and increments the attempt count (1st attempt wrote 1, the retry writes 2).
  db.markStale("welcome", "u1");
  const third = await runLifecycleEmailCron(deps);
  assert(third.welcomeSent === 1);
  assert(sent[0].key === "welcome/u1", "retry did not reuse the idempotency key");
  assert(db.rows[0].attempts === 2, `attempts was ${db.rows[0].attempts}`);
});

Deno.test("thank-you sweep sends once per workspace with its key", async () => {
  const db = makeFakeDb({
    thankCandidates: [{
      workspace_id: "w1",
      workspace_name: "Agencia X",
      owner_email: "dono@x.test",
      owner_nome: "Bruno Lima",
    }],
  });
  const { deps, sent } = makeDeps(db);
  const first = await runLifecycleEmailCron(deps);
  const second = await runLifecycleEmailCron(deps);
  assert(first.thanksSent === 1 && second.thanksSent === 0);
  assert(sent.length === 1 && sent[0].kind === "thanks" && sent[0].firstName === "Bruno");
  assert(sent[0].key === "subscription_thanks/w1");
});

Deno.test("one candidate failing does not stop the rest of the batch", async () => {
  const db = makeFakeDb({
    welcomeCandidates: [
      { user_id: "u1", email: "a@x.test", nome: "A" },
      { user_id: "u2", email: "b@x.test", nome: "B" },
    ],
  });
  const { deps, sent } = makeDeps(db, {
    sendWelcome: (p) =>
      p.to === "a@x.test" ? Promise.reject(new Error("boom")) : (
        sent.push({ kind: "welcome", to: p.to, firstName: p.firstName, key: p.idempotencyKey }),
          Promise.resolve()
      ),
  });
  const result = await runLifecycleEmailCron(deps);
  assert(result.welcomeSent === 1 && result.failed === 1);
});

Deno.test("failures are reported through the triage dep", async () => {
  const db = makeFakeDb({
    welcomeCandidates: [{ user_id: "u1", email: "a@x.test", nome: "A" }],
  });
  let reported: CronReportDetail | null = null;
  const { deps } = makeDeps(db, {
    sendWelcome: () => Promise.reject(new Error("boom")),
    report: (detail: CronReportDetail) => {
      reported = detail;
      return Promise.resolve();
    },
  });
  await runLifecycleEmailCron(deps);
  assert(reported !== null, "triage report missing");
  assert((reported as CronReportDetail).failed === 1);
});

Deno.test("founder notices go out alongside both user-facing emails", async () => {
  const db = makeFakeDb({
    welcomeCandidates: [{ user_id: "u1", email: "ana@x.test", nome: "Ana" }],
    thankCandidates: [{
      workspace_id: "w1",
      workspace_name: "Agencia X",
      owner_email: "dono@x.test",
      owner_nome: "Bruno",
      plan_name: "Pro",
      sub_status: "trialing",
      billing_interval: "month",
      stripe_subscription_id: "sub_123",
    }],
  });
  const { deps, founderSent } = makeDeps(db);
  await runLifecycleEmailCron(deps);
  assert(founderSent.length === 2, `expected 2 founder notices, got ${founderSent.length}`);
  const signup = founderSent.find((f) => f.kind === "founder_signup")!;
  assert(signup.key === "founder_signup/u1");
  assert(signup.payload.userEmail === "ana@x.test" && signup.payload.nome === "Ana");
  const sub = founderSent.find((f) => f.kind === "founder_subscription")!;
  assert(sub.key === "founder_subscription/w1");
  assert(sub.payload.workspaceName === "Agencia X" && sub.payload.ownerEmail === "dono@x.test");
  assert(sub.payload.planName === "Pro" && sub.payload.subStatus === "trialing");
  assert(sub.payload.billingInterval === "month");
  assert(sub.payload.stripeSubscriptionId === "sub_123");
});

Deno.test("pre-migration thank candidates (no plan fields) pass nulls through", async () => {
  const db = makeFakeDb({
    thankCandidates: [{
      workspace_id: "w1",
      workspace_name: "Agencia X",
      owner_email: "dono@x.test",
      owner_nome: null,
    }],
  });
  const { deps, founderSent } = makeDeps(db);
  const result = await runLifecycleEmailCron(deps);
  assert(result.thanksSent === 1 && result.failed === 0);
  const sub = founderSent.find((f) => f.kind === "founder_subscription")!;
  assert(sub.payload.planName === null && sub.payload.subStatus === null);
  assert(sub.payload.billingInterval === null);
  assert(sub.payload.stripeSubscriptionId === null);
});

Deno.test("founder-notice failure leaves the claim undelivered; retry re-sends both", async () => {
  const db = makeFakeDb({
    welcomeCandidates: [{ user_id: "u1", email: "ana@x.test", nome: "Ana" }],
  });
  let founderCalls = 0;
  const founderSent: Array<{ key: string }> = [];
  const { deps, sent } = makeDeps(db, {
    sendFounderSignup: (p) => {
      founderCalls++;
      if (founderCalls === 1) return Promise.reject(new Error("resend down"));
      founderSent.push({ key: p.idempotencyKey });
      return Promise.resolve();
    },
  });
  const first = await runLifecycleEmailCron(deps);
  assert(first.welcomeSent === 0 && first.failed === 1);
  assert(sent.length === 1, "user email should have been sent before the notice failed");
  assert(db.rows.length === 1 && !db.rows[0].delivered, "claim wrongly delivered");

  db.markStale("welcome", "u1");
  const second = await runLifecycleEmailCron(deps);
  assert(second.welcomeSent === 1 && second.failed === 0);
  // The user email retried with the SAME key (Resend dedupes it) and the
  // founder notice finally went out with its own stable key.
  const totalUserSends: number = sent.length;
  assert(totalUserSends === 2 && sent[1].key === "welcome/u1");
  assert(founderSent.length === 1 && founderSent[0].key === "founder_signup/u1");
  assert(db.rows[0].delivered, "claim not delivered after successful retry");
});

// ─── Trial reminder sweep ───────────────────────────────────────────────────
// makeDeps pins now() to 2026-07-30T12:00:00Z.

Deno.test("trial reminder sweep claims with ref_at, sends with its key, marks delivered", async () => {
  const chargeAt = "2026-08-06T12:00:00Z"; // exactly 7 days out
  const db = makeFakeDb({ trialCandidates: [{ workspace_id: "w1", first_charge_at: chargeAt }] });
  const { deps, reminders } = makeDeps(db);
  const result = await runLifecycleEmailCron(deps);
  assert(result.trialRemindersSent === 1 && result.failed === 0);
  assert(reminders.length === 1 && reminders[0].to === "dono@x.test");
  assert(reminders[0].key === `trial_reminder/w1/${chargeAt}`, `key was ${reminders[0].key}`);
  assert(reminders[0].subject === "Seu teste do Mesaas Pro termina em 7 dias", reminders[0].subject);
  assert(reminders[0].html.includes("Oi, Bruno,"));
  assert(reminders[0].html.includes("R$ 139,90 por mês"));
  const row = db.rows.find((r) => r.email_type === "trial_reminder")!;
  assert(row.workspace_id === "w1" && row.ref_at === chargeAt && row.delivered);
  assert(row.attempts === 1);
  assertEquals(row.meta, {
    to: "dono@x.test",
    amount_cents: 13990,
    amount_interval: "month",
    provider: "stripe",
    first_charge_at: chargeAt,
  });
});

Deno.test("trial reminder: ledger meta records the Pagar.me installment, not the annual total", async () => {
  const chargeAt = "2026-08-06T12:00:00Z";
  const db = makeFakeDb({
    trialCandidates: [{
      workspace_id: "w1",
      provider: "pagarme",
      amount_cents: 155880,
      amount_interval: "year",
      billing_interval: "year",
      first_charge_at: chargeAt,
    }],
  });
  const { deps, reminders } = makeDeps(db);
  await runLifecycleEmailCron(deps);
  assert(reminders[0].html.includes("12x de R$ 129,90"));
  const row = db.rows.find((r) => r.email_type === "trial_reminder")!;
  assertEquals(row.meta, {
    to: "dono@x.test",
    amount_cents: 12990,
    amount_interval: "month",
    provider: "pagarme",
    first_charge_at: chargeAt,
  });
});

Deno.test("trial reminder: ledger meta amount is null when no amount is announced", async () => {
  const db = makeFakeDb({
    trialCandidates: [{ workspace_id: "w1", first_charge_at: "2026-08-06T12:00:00Z", amount_cents: null }],
  });
  const { deps } = makeDeps(db);
  await runLifecycleEmailCron(deps);
  const row = db.rows.find((r) => r.email_type === "trial_reminder")!;
  assert(row.meta?.amount_cents === null && row.meta?.amount_interval === null);
});

Deno.test("trial reminder: a null plan_name is claimed, sent without a plan name, and delivered", async () => {
  const db = makeFakeDb({
    trialCandidates: [{ workspace_id: "w1", plan_name: null, first_charge_at: "2026-08-06T12:00:00Z" }],
  });
  const { deps, reminders } = makeDeps(db);
  const result = await runLifecycleEmailCron(deps);
  assert(result.trialRemindersSent === 1 && result.failed === 0);
  assertEquals(reminders[0].subject, "Seu teste do Mesaas termina em 7 dias");
  assert(!reminders[0].html.includes("null") && !reminders[0].html.includes("undefined"));
  assert(reminders[0].html.includes("Seu teste grátis no workspace Agencia X termina em"));
  const row = db.rows.find((r) => r.email_type === "trial_reminder")!;
  assert(row.delivered && row.attempts === 1);
});

Deno.test("trial reminder: a send 7d30m before the charge still says 7 dias", async () => {
  const db = makeFakeDb({
    trialCandidates: [{ workspace_id: "w1", first_charge_at: "2026-08-06T12:30:00Z" }],
  });
  const { deps, reminders } = makeDeps(db);
  await runLifecycleEmailCron(deps);
  assert(reminders[0].subject === "Seu teste do Mesaas Pro termina em 7 dias", reminders[0].subject);
});

Deno.test("trial reminder: a late send (under 7d) says the rounded days left", async () => {
  const db = makeFakeDb({
    trialCandidates: [{ workspace_id: "w1", first_charge_at: "2026-08-03T10:00:00Z" }],
  });
  const { deps, reminders } = makeDeps(db);
  await runLifecycleEmailCron(deps);
  assert(reminders[0].subject === "Seu teste do Mesaas Pro termina em 4 dias", reminders[0].subject);
});

Deno.test("trial reminder: no amount still sends, with the generic charge line", async () => {
  const db = makeFakeDb({
    trialCandidates: [{ workspace_id: "w1", first_charge_at: "2026-08-06T12:00:00Z", amount_cents: null }],
  });
  const { deps, reminders } = makeDeps(db);
  const result = await runLifecycleEmailCron(deps);
  assert(result.trialRemindersSent === 1);
  assert(reminders[0].html.includes("valor do seu plano"));
});

Deno.test("trial reminder: delivered workspaces are not re-sent", async () => {
  const db = makeFakeDb({
    trialCandidates: [{ workspace_id: "w1", first_charge_at: "2026-08-06T12:00:00Z" }],
  });
  const { deps, reminders } = makeDeps(db);
  await runLifecycleEmailCron(deps);
  await runLifecycleEmailCron(deps);
  assert(reminders.length === 1);
});

Deno.test("trial reminder: a send failure on one candidate does not stop the next", async () => {
  const db = makeFakeDb({
    trialCandidates: [
      { workspace_id: "w1", owner_email: "a@x.test", first_charge_at: "2026-08-06T12:00:00Z" },
      { workspace_id: "w2", owner_email: "b@x.test", first_charge_at: "2026-08-06T12:00:00Z" },
    ],
  });
  const delivered: string[] = [];
  const { deps } = makeDeps(db, {
    sendTrialReminder: (p) => {
      if (p.to === "a@x.test") return Promise.reject(new Error("resend down"));
      delivered.push(p.idempotencyKey);
      return Promise.resolve();
    },
  });
  const result = await runLifecycleEmailCron(deps);
  assert(result.trialRemindersSent === 1 && result.failed === 1);
  assert(delivered.length === 1 && delivered[0].startsWith("trial_reminder/w2/"));
  const w1 = db.rows.find((r) => r.workspace_id === "w1")!;
  assert(!w1.delivered, "failed send must leave an undelivered claim");
});

Deno.test("trial reminder: an RPC error is reported and the other sweeps still run", async () => {
  const db = makeFakeDb({
    welcomeCandidates: [{ user_id: "u1", email: "ana@x.test", nome: "Ana" }],
    thankCandidates: [{
      workspace_id: "w9",
      workspace_name: "Agencia Y",
      owner_email: "dono@x.test",
      owner_nome: "Bruno",
    }],
    trialRpcError: "function does not exist",
  });
  let reported: CronReportDetail | null = null;
  const { deps } = makeDeps(db, {
    report: (d: CronReportDetail) => {
      reported = d;
      return Promise.resolve();
    },
  });
  const result = await runLifecycleEmailCron(deps);
  assert(result.welcomeSent === 1 && result.thanksSent === 1 && result.trialRemindersSent === 0);
  assert(result.failed === 1);
  assert(
    (reported as CronReportDetail | null)?.errors[0].error?.includes("trial reminder candidates"),
  );
});

// --- Nurture sweep ----------------------------------------------------------

const B1 = {
  user_id: "11111111-1111-1111-1111-111111111111",
  workspace_id: "ws-b1",
  email: "dona@x.test",
  step: "b1",
  client_count: 1,
  first_client_name: "Studio Bela",
};

Deno.test("nurture off never calls the rpc", async () => {
  const db = makeFakeDb({ nurtureCandidates: [B1] });
  const { deps, nurtureSent } = makeDeps(db);
  const result = await runLifecycleEmailCron(deps);
  assertEquals(result.nurtureSent, 0);
  assert(!db.rpcCalls.some((c) => c.name === "get_nurture_candidates"));
  assert(!db.rpcCalls.some((c) => c.name === "claim_nurture_email"));
  assertEquals(nurtureSent.length, 0);
});

Deno.test("nurture on sends claimed steps", async () => {
  const db = makeFakeDb({ nurtureCandidates: [B1] });
  const { deps, nurtureSent } = makeDeps(db, { nurtureEnabled: true });
  const nowIso = deps.now().toISOString();
  const result = await runLifecycleEmailCron(deps);
  assertEquals(result.nurtureSent, 1);
  assertEquals(result.failed, 0);

  const candCall = db.rpcCalls.find((c) => c.name === "get_nurture_candidates");
  assertEquals(candCall?.args, { p_now: nowIso });
  const claimCall = db.rpcCalls.find((c) => c.name === "claim_nurture_email");
  assertEquals(claimCall?.args, {
    p_workspace_id: "ws-b1",
    p_step: "b1",
    p_recipient_user_id: B1.user_id,
    p_now: nowIso,
  });

  assertEquals(nurtureSent.length, 1);
  const m = nurtureSent[0];
  const url = `https://unsub.test/${B1.user_id}`;
  const pageUrl = `https://app.test/descadastrar/${B1.user_id}`;
  assertEquals(m.to, "dona@x.test");
  assertEquals(m.idempotencyKey, "nurture_b1/ws-b1");
  assertEquals(m.tags, { type: "nurture_b1" });
  assertEquals(m.headers["List-Unsubscribe"], `<${url}>`);
  assertEquals(m.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert(m.html.includes(pageUrl), "footer must link the CRM confirmation page");
  assert(!m.html.includes(url), "footer must not link the function (gateway serves it as text/plain)");
  assert(m.html.includes("Ana"), "first name from nome");
  assert(m.subject.length > 0);

  assertEquals(db.nurtureUpdates.length, 1);
  assertEquals(db.nurtureUpdates[0].filters, { workspace_id: "ws-b1", step: "b1" });
  assertEquals(db.nurtureUpdates[0].patch.delivered_at, nowIso);
});

Deno.test("nurture: claim refused skips send", async () => {
  const db = makeFakeDb({ nurtureCandidates: [B1], claimResults: { "ws-b1/b1": null } });
  let reported = false;
  const { deps, nurtureSent } = makeDeps(db, {
    nurtureEnabled: true,
    report: () => {
      reported = true;
      return Promise.resolve();
    },
  });
  const result = await runLifecycleEmailCron(deps);
  assertEquals(result.nurtureSent, 0);
  assertEquals(result.failed, 0);
  assertEquals(nurtureSent.length, 0);
  assertEquals(db.nurtureUpdates.length, 0);
  assert(!reported, "a refused claim is not an error");
});

Deno.test("nurture: send failure is reported, not delivered", async () => {
  const db = makeFakeDb({ nurtureCandidates: [B1] });
  let reported: CronReportDetail | null = null;
  const { deps } = makeDeps(db, {
    nurtureEnabled: true,
    sendNurture: () => Promise.reject(new Error("resend down")),
    report: (d: CronReportDetail) => {
      reported = d;
      return Promise.resolve();
    },
  });
  const result = await runLifecycleEmailCron(deps);
  assertEquals(result.nurtureSent, 0);
  assertEquals(result.failed, 1);
  assertEquals((reported as CronReportDetail | null)?.errors[0].accountId, "ws-b1");
  assertEquals(db.nurtureUpdates.length, 0);
});

Deno.test("nurture: candidate rpc error is reported, other sweeps still run", async () => {
  const db = makeFakeDb({
    welcomeCandidates: [{ user_id: "u1", email: "ana@x.test", nome: "Ana" }],
    nurtureRpcError: "function does not exist",
  });
  let reported: CronReportDetail | null = null;
  const { deps } = makeDeps(db, {
    nurtureEnabled: true,
    report: (d: CronReportDetail) => {
      reported = d;
      return Promise.resolve();
    },
  });
  const result = await runLifecycleEmailCron(deps);
  assertEquals(result.welcomeSent, 1);
  assertEquals(result.failed, 1);
  assert(
    (reported as CronReportDetail | null)?.errors[0].error?.startsWith("nurture candidates: "),
  );
});

Deno.test("nurture: empty email is reported and never claimed or sent", async () => {
  const db = makeFakeDb({ nurtureCandidates: [{ ...B1, email: "" }] });
  let reported: CronReportDetail | null = null;
  const { deps, nurtureSent } = makeDeps(db, {
    nurtureEnabled: true,
    report: (d: CronReportDetail) => {
      reported = d;
      return Promise.resolve();
    },
  });
  const result = await runLifecycleEmailCron(deps);
  assertEquals(result.nurtureSent, 0);
  assertEquals(result.failed, 1);
  assertEquals((reported as CronReportDetail | null)?.errors[0].accountId, "ws-b1");
  assert(!db.rpcCalls.some((c) => c.name === "claim_nurture_email"));
  assertEquals(nurtureSent.length, 0);
});

Deno.test("nurture: unknown step is reported and never claimed", async () => {
  const db = makeFakeDb({ nurtureCandidates: [{ ...B1, step: "c9" }] });
  const { deps, nurtureSent } = makeDeps(db, { nurtureEnabled: true });
  const result = await runLifecycleEmailCron(deps);
  assertEquals(result.failed, 1);
  assert(!db.rpcCalls.some((c) => c.name === "claim_nurture_email"));
  assertEquals(nurtureSent.length, 0);
});

Deno.test("nurture: blank nome sends without a first name", async () => {
  const db = makeFakeDb({ nurtureCandidates: [{ ...B1, nome: "   " }] });
  const { deps, nurtureSent } = makeDeps(db, { nurtureEnabled: true });
  await runLifecycleEmailCron(deps);
  assertEquals(nurtureSent.length, 1);
  assert(nurtureSent[0].html.includes(">Agencia N já está no Mesaas."));
});

Deno.test("nurture preview sends 8 without touching ledgers", async () => {
  const db = makeFakeDb({ nurtureCandidates: [B1] });
  // Preview must work with the sweep switched off (deploy step 5).
  const { deps, nurtureSent } = makeDeps(db, { nurtureEnabled: false });
  const result = await runNurturePreview(deps, "e@x");
  assertEquals(result.previewSent, 8);
  assertEquals(nurtureSent.length, 8);
  assert(nurtureSent.every((m) => m.to === "e@x"));
  assertEquals(
    nurtureSent.map((m) => m.tags.type),
    ["a1", "a2", "a3", "a4", "b1", "b2", "b3", "b4"].map((s) => `nurture_${s}`),
  );
  const day = deps.now().toISOString().slice(0, 10);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("e@x"));
  const who = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 12);
  assertEquals(
    nurtureSent.map((m) => m.idempotencyKey),
    ["a1", "a2", "a3", "a4", "b1", "b2", "b3", "b4"].map((s) =>
      `nurture_preview/${s}/${day}/${who}`
    ),
  );
  const previewUrl = "https://unsub.test/00000000-0000-0000-0000-000000000000";
  assert(nurtureSent.every((m) => m.headers["List-Unsubscribe"] === `<${previewUrl}>`));
  assert(nurtureSent.every((m) => m.html.includes("https://app.test/descadastrar/00000000-0000-0000-0000-000000000000")));
  assertEquals(nurtureSent[0].subject, "Seu primeiro cliente no Mesaas leva 3 minutos");
  assertEquals(db.rpcCalls.length, 0);
  assertEquals(db.fromCalls.length, 0);
});

Deno.test("nurture preview key differs per recipient, ignoring case", async () => {
  const db = makeFakeDb({});
  const { deps, nurtureSent } = makeDeps(db);
  await runNurturePreview(deps, "e@x");
  await runNurturePreview(deps, "E@X");
  await runNurturePreview(deps, "other@x");
  assertEquals(nurtureSent[0].idempotencyKey, nurtureSent[8].idempotencyKey);
  assert(nurtureSent[0].idempotencyKey !== nurtureSent[16].idempotencyKey);
});

Deno.test("nurture: unsub signing failure is reported, nothing sent, other sweeps intact", async () => {
  const db = makeFakeDb({
    welcomeCandidates: [{ user_id: "u1", email: "ana@x.test", nome: "Ana" }],
    trialCandidates: [{ workspace_id: "w1", first_charge_at: "2026-08-06T12:00:00Z" }],
    nurtureCandidates: [B1],
  });
  let reported: CronReportDetail | null = null;
  const { deps, nurtureSent } = makeDeps(db, {
    nurtureEnabled: true,
    nurtureUnsubLinks: () => Promise.reject(new Error("NURTURE_UNSUB_SECRET is required")),
    report: (d: CronReportDetail) => {
      reported = d;
      return Promise.resolve();
    },
  });
  const result = await runLifecycleEmailCron(deps);
  assertEquals(result.welcomeSent, 1);
  assertEquals(result.trialRemindersSent, 1);
  assertEquals(result.nurtureSent, 0);
  assertEquals(result.failed, 1);
  const err = (reported as CronReportDetail | null)?.errors[0];
  assertEquals(err?.accountId, "ws-b1");
  assert(err?.error?.includes("NURTURE_UNSUB_SECRET"));
  assertEquals(nurtureSent.length, 0);
  assert(!db.rpcCalls.some((c) => c.name === "claim_nurture_email"), "no claim spent");
  assertEquals(db.nurtureUpdates.length, 0);
});

Deno.test("nurture: claim rpc error is reported, no send", async () => {
  const db = makeFakeDb({ nurtureCandidates: [B1], claimError: "permission denied" });
  let reported: CronReportDetail | null = null;
  const { deps, nurtureSent } = makeDeps(db, {
    nurtureEnabled: true,
    report: (d: CronReportDetail) => {
      reported = d;
      return Promise.resolve();
    },
  });
  const result = await runLifecycleEmailCron(deps);
  assertEquals(result.nurtureSent, 0);
  assertEquals(result.failed, 1);
  const err = (reported as CronReportDetail | null)?.errors[0];
  assertEquals(err?.accountId, "ws-b1");
  assert(err?.error?.includes("permission denied"));
  assertEquals(nurtureSent.length, 0);
  assertEquals(db.nurtureUpdates.length, 0);
});
