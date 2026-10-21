import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  createAffiliatePayoutCronHandler,
  runAffiliatePayouts,
  transferGroupFor,
} from "../affiliate-payout-cron/handler.ts";
import {
  accountStatusFrom,
  type AffiliateConnectGateway,
  classifyStripeError,
  ConnectError,
} from "../_shared/affiliate-connect.ts";
import { resolveMinPayoutCents } from "../_shared/affiliate-commission.ts";

const NOW = new Date("2026-11-05T11:47:00Z");

function gateway(overrides: Partial<AffiliateConnectGateway> = {}) {
  const transfers: Array<{ amountCents: number; accountId: string; transferGroup: string; idempotencyKey: string }> = [];
  const g: AffiliateConnectGateway = {
    createExpressAccount: () => Promise.resolve("acct_x"),
    createOnboardingLink: () => Promise.resolve("https://x"),
    createDashboardLink: () => Promise.resolve("https://x"),
    retrieveAccountStatus: () => Promise.resolve({ detailsSubmitted: true, transfersActive: true }),
    findTransferByGroup: () => Promise.resolve(null),
    createTransfer: (p) => (transfers.push(p), Promise.resolve(`tr_${transfers.length}`)),
    ...overrides,
  };
  return { g, transfers };
}

function run(db: ReturnType<typeof createSupabaseQueryMock>, g: AffiliateConnectGateway) {
  return runAffiliatePayouts({
    db: db as unknown as SupabaseClient,
    connect: g,
    now: () => NOW,
    minPayoutCents: 5000,
  });
}

function updates(db: ReturnType<typeof createSupabaseQueryMock>) {
  return db.calls
    .filter((c) => c.table === "affiliate_payouts" && c.operation === "update")
    .map((c) => c.payload as Record<string, unknown>);
}

Deno.test("accountStatusFrom / classifyStripeError / resolveMinPayoutCents", () => {
  assertEquals(accountStatusFrom({ details_submitted: true, capabilities: { transfers: "active" } }), {
    detailsSubmitted: true, transfersActive: true,
  });
  assertEquals(accountStatusFrom({ details_submitted: true, capabilities: { transfers: "pending" } }).transfersActive, false);
  assertEquals(accountStatusFrom({}), { detailsSubmitted: false, transfersActive: false });

  assertEquals(classifyStripeError({ statusCode: 400, code: "balance_insufficient" }).kind, "rejected");
  assertEquals(classifyStripeError({ statusCode: 400, code: "balance_insufficient" }).code, "balance_insufficient");
  assertEquals(classifyStripeError({ statusCode: 429 }).kind, "unknown");
  assertEquals(classifyStripeError({ statusCode: 500 }).kind, "unknown");
  assertEquals(classifyStripeError(new Error("network")).kind, "unknown");

  assertEquals(resolveMinPayoutCents(undefined), 5000);
  assertEquals(resolveMinPayoutCents("10000"), 10000);
  assertEquals(resolveMinPayoutCents("50"), 5000);
  assertEquals(resolveMinPayoutCents("abc"), 5000);
});

Deno.test("pays the available balance: pending row first, then the transfer, then paid", async () => {
  const db = createSupabaseQueryMock();
  db.queue("affiliate_payouts", "select", { data: [] });
  db.queue("affiliates", "select", { data: [{ id: "aff-1", stripe_account_id: "acct_1", stripe_transfers_active: true }] });
  db.queueRpc("affiliate_summaries", { data: [{ affiliate_id: "aff-1", available_cents: "7491" }] });
  db.queue("affiliates", "update", { data: null });
  db.queue("affiliate_payouts", "insert", {
    data: { id: "p1", affiliate_id: "aff-1", amount_cents: 7491, stripe_account_id: "acct_1" },
  });
  db.queue("affiliate_payouts", "update", { data: null });
  const { g, transfers } = gateway();

  const result = await run(db, g);
  assertEquals(result.paid, 1);
  assertEquals(result.errors, []);
  const ins = db.calls.find((c) => c.table === "affiliate_payouts" && c.operation === "insert")!.payload as Record<string, unknown>;
  assertEquals(ins, { affiliate_id: "aff-1", amount_cents: 7491, status: "pending", stripe_account_id: "acct_1" });
  assertEquals(transfers, [{
    amountCents: 7491,
    accountId: "acct_1",
    transferGroup: transferGroupFor("p1"),
    idempotencyKey: "affiliate-payout:p1",
    metadata: { affiliate_id: "aff-1", payout_id: "p1" },
  } as never]);
  assertEquals(updates(db)[0].status, "paid");
  assertEquals(updates(db)[0].stripe_transfer_id, "tr_1");
});

Deno.test("below the minimum or account not ready: no payout", async () => {
  const db = createSupabaseQueryMock();
  db.queue("affiliate_payouts", "select", { data: [] });
  db.queue("affiliates", "select", {
    data: [
      { id: "low", stripe_account_id: "acct_low", stripe_transfers_active: true },
      { id: "pending-kyc", stripe_account_id: "acct_kyc", stripe_transfers_active: false },
    ],
  });
  db.queueRpc("affiliate_summaries", {
    data: [{ affiliate_id: "low", available_cents: 4999 }, { affiliate_id: "pending-kyc", available_cents: 9000 }],
  });
  db.queue("affiliates", "update", { data: null });
  const { g, transfers } = gateway({ retrieveAccountStatus: () => Promise.resolve({ detailsSubmitted: true, transfersActive: false }) });
  const result = await run(db, g);
  assertEquals(result.skippedNotReady, 1);
  assertEquals(transfers.length, 0);
  assert(!db.calls.some((c) => c.table === "affiliate_payouts" && c.operation === "insert"));
});

Deno.test("a rejected transfer marks the payout failed (balance returns next month)", async () => {
  const db = createSupabaseQueryMock();
  db.queue("affiliate_payouts", "select", { data: [] });
  db.queue("affiliates", "select", { data: [{ id: "aff-1", stripe_account_id: "acct_1" }] });
  db.queueRpc("affiliate_summaries", { data: [{ affiliate_id: "aff-1", available_cents: 6000 }] });
  db.queue("affiliates", "update", { data: null });
  db.queue("affiliate_payouts", "insert", { data: { id: "p1", affiliate_id: "aff-1", amount_cents: 6000, stripe_account_id: "acct_1" } });
  db.queue("affiliate_payouts", "update", { data: null });
  const { g } = gateway({ createTransfer: () => Promise.reject(new ConnectError("rejected", "balance_insufficient")) });
  const result = await run(db, g);
  assertEquals(result.failed, 1);
  assertEquals(updates(db)[0], { status: "failed", failure_code: "balance_insufficient", updated_at: NOW.toISOString() });
});

Deno.test("an unknown outcome keeps the payout pending (never failed)", async () => {
  const db = createSupabaseQueryMock();
  db.queue("affiliate_payouts", "select", { data: [] });
  db.queue("affiliates", "select", { data: [{ id: "aff-1", stripe_account_id: "acct_1" }] });
  db.queueRpc("affiliate_summaries", { data: [{ affiliate_id: "aff-1", available_cents: 6000 }] });
  db.queue("affiliates", "update", { data: null });
  db.queue("affiliate_payouts", "insert", { data: { id: "p1", affiliate_id: "aff-1", amount_cents: 6000, stripe_account_id: "acct_1" } });
  const { g } = gateway({ createTransfer: () => Promise.reject(new ConnectError("unknown", "timeout")) });
  const result = await run(db, g);
  assertEquals(result.leftPending, 1);
  assertEquals(updates(db).length, 0);
});

Deno.test("reconcile: a pending payout whose transfer exists is marked paid without a new transfer", async () => {
  const db = createSupabaseQueryMock();
  db.queue("affiliate_payouts", "select", {
    data: [{ id: "p0", affiliate_id: "aff-1", amount_cents: 6000, stripe_account_id: "acct_1" }],
  });
  db.queue("affiliate_payouts", "update", { data: null });
  db.queue("affiliates", "select", { data: [{ id: "aff-1", stripe_account_id: "acct_1" }] });
  // Even with a (stale) available balance, the affiliate with a reconciled pending row is
  // skipped in this run.
  db.queueRpc("affiliate_summaries", { data: [{ affiliate_id: "aff-1", available_cents: 9000 }] });
  const groups: string[] = [];
  const { g, transfers } = gateway({
    findTransferByGroup: (grp) => (groups.push(grp), Promise.resolve("tr_existing")),
  });
  const result = await run(db, g);
  assertEquals(result.reconciled, 1);
  assertEquals(groups, ["affiliate_payout_p0"]);
  assertEquals(transfers.length, 0);
  assertEquals(updates(db)[0].stripe_transfer_id, "tr_existing");
  assert(!db.calls.some((c) => c.table === "affiliate_payouts" && c.operation === "insert"));
});

Deno.test("reconcile: no transfer found retries with the same idempotency key", async () => {
  const db = createSupabaseQueryMock();
  db.queue("affiliate_payouts", "select", {
    data: [{ id: "p0", affiliate_id: "aff-1", amount_cents: 6000, stripe_account_id: "acct_1" }],
  });
  db.queue("affiliate_payouts", "update", { data: null });
  db.queue("affiliates", "select", { data: [] });
  db.queueRpc("affiliate_summaries", { data: [] });
  const { g, transfers } = gateway();
  const result = await run(db, g);
  assertEquals(result.reconciled, 1);
  assertEquals(transfers[0].idempotencyKey, "affiliate-payout:p0");
});

Deno.test("cron handler rejects a wrong secret", async () => {
  let ran = false;
  const handler = createAffiliatePayoutCronHandler({
    cronSecret: "s3cret",
    timingSafeEqual: (a, b) => a === b,
    run: () => ((ran = true), Promise.resolve(new Response("ok"))),
  });
  const bad = await handler(new Request("https://fn.local", { method: "POST", headers: { "x-cron-secret": "nope" } }));
  assertEquals(bad.status, 401);
  assertEquals(ran, false);
  const ok = await handler(new Request("https://fn.local", { method: "POST", headers: { "x-cron-secret": "s3cret" } }));
  assertEquals(ok.status, 200);
  assertEquals(ran, true);
});
