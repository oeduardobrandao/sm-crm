import { assert } from "./assert.ts";
import {
  type CronReportDetail,
  type LifecycleCronDeps,
  runLifecycleEmailCron,
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
}) {
  type Row = {
    email_type: string;
    user_id?: string;
    workspace_id?: string;
    delivered: boolean;
    stale: boolean;
    attempts: number;
  };
  const rows: Row[] = [];
  const keyOf = (r: { user_id?: string; workspace_id?: string }) => r.user_id ?? r.workspace_id!;
  const find = (email_type: string, key: string) =>
    rows.find((r) => r.email_type === email_type && keyOf(r) === key);

  const db = {
    rows,
    markStale(email_type: string, key: string) {
      const r = find(email_type, key);
      if (r) r.stale = true;
    },
    rpc(name: string) {
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
      throw new Error(`unexpected rpc ${name}`);
    },
    from(table: string) {
      assert(table === "lifecycle_emails");
      return {
        upsert(
          row: {
            email_type: string;
            user_id?: string;
            workspace_id?: string;
            sent_at: string;
            attempts: number;
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
  const founderSent: Array<{ kind: string; key: string; payload: Record<string, unknown> }> = [];
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
    report: () => Promise.resolve(),
    ...overrides,
  };
  return { deps, sent, founderSent };
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
