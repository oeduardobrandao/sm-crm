import { assert, assertEquals, readJson } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  handleGetAffiliate,
  handleListAffiliates,
  handleUpdateAffiliate,
  handleUpdateCommissionRule,
  validateAffiliateUpdate,
  validateCommissionRule,
} from "../platform-admin/affiliates.ts";

const H = { "Content-Type": "application/json" };
const AFF = "11111111-1111-4111-8111-111111111111";
const ADMIN = "22222222-2222-4222-8222-222222222222";

Deno.test("validateAffiliateUpdate: status only", () => {
  assertEquals(validateAffiliateUpdate({ affiliate_id: AFF, status: "suspended" }), {
    ok: true, id: AFF, patch: { status: "suspended" },
  });
  assert(!validateAffiliateUpdate({ affiliate_id: AFF }).ok);
  assert(!validateAffiliateUpdate({ affiliate_id: "x", status: "active" }).ok);
  assert(!validateAffiliateUpdate({ affiliate_id: AFF, status: "deleted" }).ok);
});

Deno.test("validateCommissionRule: integer bps 0..10000, months 1..120", () => {
  assertEquals(validateCommissionRule({ plan_id: "start", rate_bps: 3000, months: 3 }), {
    ok: true, value: { plan_id: "start", rate_bps: 3000, months: 3 },
  });
  assert(!validateCommissionRule({ plan_id: "start", rate_bps: 30.5, months: 3 }).ok);
  assert(!validateCommissionRule({ plan_id: "start", rate_bps: 10001, months: 3 }).ok);
  assert(!validateCommissionRule({ plan_id: "start", rate_bps: 3000, months: 0 }).ok);
  assert(!validateCommissionRule({ plan_id: "Start Plan!", rate_bps: 3000, months: 3 }).ok);
});

Deno.test("list-affiliates merges the summaries and coerces bigint strings", async () => {
  const db = createSupabaseQueryMock();
  db.queue("affiliates", "select", {
    data: [{ id: AFF, code: "ana7k3f", nome: "Ana", email: "a@x.com", status: "active", stripe_account_id: "acct_1", stripe_transfers_active: true, created_at: "2026-10-01" }],
  });
  db.queue("plans", "select", {
    data: [
      { id: "free", name: "Free", price_brl: 0, sort_order: 0 },
      { id: "start", name: "Start", price_brl: 4990, sort_order: 1 },
      { id: "max", name: "Max", price_brl: 19990, sort_order: 3 },
    ],
  });
  db.queue("affiliate_commission_rules", "select", { data: [{ plan_id: "start", rate_bps: 3000, months: 3 }] });
  db.queueRpc("affiliate_summaries", {
    data: [{ affiliate_id: AFF, referrals_count: 3, trialing_count: 1, paying_count: 2, pending_cents: "500", available_cents: "1998", paid_out_cents: "0", lifetime_cents: "2498" }],
  });
  const res = await handleListAffiliates(db as unknown as SupabaseClient, H);
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.affiliates[0].stripe_transfers_active, true);
  assertEquals(body.affiliates[0].summary.available_cents, 1998);
  assertEquals(body.rules, [
    { plan_id: "start", plan_name: "Start", price_brl: 4990, rate_bps: 3000, months: 3, configured: true },
    { plan_id: "max", plan_name: "Max", price_brl: 19990, rate_bps: 0, months: 0, configured: false },
  ]);
  assertEquals(body.affiliates[0].summary.paying_count, 2);
});

Deno.test("get-affiliate: 404 for an unknown id, names workspaces for the admin", async () => {
  const missing = createSupabaseQueryMock();
  missing.queue("affiliates", "select", { data: null });
  assertEquals((await handleGetAffiliate(missing as unknown as SupabaseClient, { affiliate_id: AFF }, H)).status, 404);

  const db = createSupabaseQueryMock();
  db.queue("affiliates", "select", { data: { id: AFF, nome: "Ana" } });
  db.queueRpc("affiliate_summaries", { data: { referrals_count: 1 } });
  db.queue("affiliate_referrals", "select", { data: [{ workspace_id: "ws-1", ref_code: "ana7k3f", created_at: "2026-09-01" }] });
  db.queue("affiliate_commissions", "select", { data: [{ id: "c1", workspace_id: "ws-1", net_cents: 1998 }] });
  db.queue("affiliate_payouts", "select", { data: [] });
  db.queue("workspaces", "select", { data: [{ id: "ws-1", name: "Agência X" }] });
  db.queue("workspace_subscriptions", "select", { data: [{ workspace_id: "ws-1", provider: "stripe", status: "active", plan_id: "pro", billing_interval: "month" }] });
  const res = await handleGetAffiliate(db as unknown as SupabaseClient, { affiliate_id: AFF }, H);
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.referrals[0].workspace_name, "Agência X");
  assertEquals(body.referrals[0].status, "active");
  assertEquals(body.commissions[0].workspace_name, "Agência X");
  assertEquals(body.summary.referrals_count, 1);
});

Deno.test("update-affiliate writes the patch and an audit row", async () => {
  const db = createSupabaseQueryMock();
  db.queue("affiliates", "update", { data: { id: AFF, status: "suspended", commission_rate_bps: 2000 } });
  const res = await handleUpdateAffiliate(db as unknown as SupabaseClient, { affiliate_id: AFF, status: "suspended" }, ADMIN, H);
  assertEquals(res.status, 200);
  const upd = db.calls.find((c) => c.table === "affiliates")!;
  assertEquals((upd.payload as Record<string, unknown>).status, "suspended");
  const audit = db.calls.find((c) => c.table === "audit_log")!;
  const entry = audit.payload as Record<string, unknown>;
  assertEquals(entry.action, "admin-update-affiliate");
  assertEquals(entry.actor_user_id, ADMIN);
  assertEquals(entry.resource_id, AFF);
});

Deno.test("update-affiliate-commission-rule upserts and audits; unknown plan is a 404", async () => {
  const missing = createSupabaseQueryMock();
  missing.queue("plans", "select", { data: null });
  const r404 = await handleUpdateCommissionRule(
    missing as unknown as SupabaseClient, { plan_id: "nope", rate_bps: 1000, months: 3 }, ADMIN, H,
  );
  assertEquals(r404.status, 404);

  const db = createSupabaseQueryMock();
  db.queue("plans", "select", { data: { id: "pro" } });
  db.queue("affiliate_commission_rules", "upsert", { data: { plan_id: "pro", rate_bps: 2500, months: 3 } });
  const res = await handleUpdateCommissionRule(
    db as unknown as SupabaseClient, { plan_id: "pro", rate_bps: 2500, months: 3 }, ADMIN, H,
  );
  assertEquals(res.status, 200);
  const up = db.calls.find((c) => c.table === "affiliate_commission_rules")!;
  assertEquals(up.options, { onConflict: "plan_id" });
  assertEquals((up.payload as Record<string, unknown>).rate_bps, 2500);
  const audit = db.calls.find((c) => c.table === "audit_log")!.payload as Record<string, unknown>;
  assertEquals(audit.action, "admin-update-affiliate-commission-rule");
  assertEquals(audit.resource_id, "pro");
});

Deno.test("a DB error throws for index.ts's generic 500", async () => {
  const db = createSupabaseQueryMock();
  db.queue("affiliates", "select", { data: null, error: { message: "boom" } });
  let threw = false;
  try {
    await handleListAffiliates(db as unknown as SupabaseClient, H);
  } catch {
    threw = true;
  }
  assert(threw);
});
