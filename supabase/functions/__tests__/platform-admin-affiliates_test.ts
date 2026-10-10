import { assert, assertEquals, readJson } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  handleCreateAffiliatePayout,
  handleGetAffiliate,
  handleListAffiliates,
  handleUpdateAffiliate,
  validateAffiliateUpdate,
  validatePayout,
} from "../platform-admin/affiliates.ts";

const H = { "Content-Type": "application/json" };
const AFF = "11111111-1111-4111-8111-111111111111";
const ADMIN = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-10-10T12:00:00Z");

Deno.test("validateAffiliateUpdate: status enum, integer bps in range, something to change", () => {
  assertEquals(validateAffiliateUpdate({ affiliate_id: AFF, status: "suspended" }), {
    ok: true, id: AFF, patch: { status: "suspended" },
  });
  assertEquals(validateAffiliateUpdate({ affiliate_id: AFF, commission_rate_bps: 2500 }), {
    ok: true, id: AFF, patch: { commission_rate_bps: 2500 },
  });
  assert(!validateAffiliateUpdate({ affiliate_id: AFF }).ok);
  assert(!validateAffiliateUpdate({ affiliate_id: "x", status: "active" }).ok);
  assert(!validateAffiliateUpdate({ affiliate_id: AFF, status: "deleted" }).ok);
  assert(!validateAffiliateUpdate({ affiliate_id: AFF, commission_rate_bps: 20.5 }).ok);
  assert(!validateAffiliateUpdate({ affiliate_id: AFF, commission_rate_bps: 10001 }).ok);
});

Deno.test("validatePayout: positive integer cents, no future date, trimmed text", () => {
  const ok = validatePayout({ affiliate_id: AFF, amount_cents: 1998, reference: "  E2E123 ", note: "" }, NOW);
  assert(ok.ok);
  assertEquals(ok.value, {
    affiliate_id: AFF, amount_cents: 1998, reference: "E2E123", note: null, paid_at: NOW.toISOString(),
  });
  assert(!validatePayout({ affiliate_id: AFF, amount_cents: 0 }, NOW).ok);
  assert(!validatePayout({ affiliate_id: AFF, amount_cents: 10.5 }, NOW).ok);
  assert(!validatePayout({ affiliate_id: AFF, amount_cents: 100, paid_at: "2027-01-01" }, NOW).ok);
  assert(!validatePayout({ affiliate_id: AFF, amount_cents: 100, paid_at: "garbage" }, NOW).ok);
  const past = validatePayout({ affiliate_id: AFF, amount_cents: 100, paid_at: "2026-10-01T00:00:00Z" }, NOW);
  assert(past.ok && past.value.paid_at === "2026-10-01T00:00:00.000Z");
});

Deno.test("list-affiliates merges the summaries and coerces bigint strings", async () => {
  const db = createSupabaseQueryMock();
  db.queue("affiliates", "select", {
    data: [{ id: AFF, code: "ana7k3f", nome: "Ana", email: "a@x.com", status: "active", commission_rate_bps: 2000, pix_key_type: "cpf", created_at: "2026-10-01" }],
  });
  db.queueRpc("affiliate_summaries", {
    data: [{ affiliate_id: AFF, referrals_count: 3, trialing_count: 1, paying_count: 2, pending_cents: "500", available_cents: "1998", paid_out_cents: "0", lifetime_cents: "2498" }],
  });
  const res = await handleListAffiliates(db as unknown as SupabaseClient, H);
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.affiliates[0].has_pix, true);
  assertEquals(body.affiliates[0].summary.available_cents, 1998);
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

Deno.test("create-affiliate-payout refuses more than the available balance", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("affiliate_summaries", { data: { available_cents: "1000" } });
  const res = await handleCreateAffiliatePayout(
    db as unknown as SupabaseClient, { affiliate_id: AFF, amount_cents: 1001 }, ADMIN, H, NOW,
  );
  assertEquals(res.status, 400);
  assert(!db.calls.some((c) => c.table === "affiliate_payouts"));
});

Deno.test("create-affiliate-payout inserts, stamps the admin and audits", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("affiliate_summaries", { data: { available_cents: "1998" } });
  db.queue("affiliate_payouts", "insert", { data: { id: "p1", amount_cents: 1998 } });
  const res = await handleCreateAffiliatePayout(
    db as unknown as SupabaseClient, { affiliate_id: AFF, amount_cents: 1998, reference: "E2E1" }, ADMIN, H, NOW,
  );
  assertEquals(res.status, 201);
  const ins = db.calls.find((c) => c.table === "affiliate_payouts")!.payload as Record<string, unknown>;
  assertEquals(ins.created_by, ADMIN);
  assertEquals(ins.method, "pix");
  assertEquals(ins.reference, "E2E1");
  const audit = db.calls.find((c) => c.table === "audit_log")!.payload as Record<string, unknown>;
  assertEquals(audit.action, "admin-create-affiliate-payout");
  assertEquals((audit.metadata as Record<string, unknown>).payout_id, "p1");
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
