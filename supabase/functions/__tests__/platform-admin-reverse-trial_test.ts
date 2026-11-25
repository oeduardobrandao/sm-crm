import { assert, assertEquals } from "./assert.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  handleEndReverseTrial,
  handleExtendReverseTrial,
  validateExtendEndsAt,
} from "../platform-admin/reverse-trial.ts";
import { callsTo, HEADERS, makeFakeDb } from "./platform-admin-fake-db.ts";

const NOW = new Date("2026-12-05T12:00:00Z");
const STARTED = "2026-12-01T15:00:00Z";
const ENDS = "2026-12-15T15:00:00Z";
const USER_ID = "user-1";

const trialRow = {
  plan_source: "trial",
  reverse_trial_started_at: STARTED,
  reverse_trial_ends_at: ENDS,
  reverse_trial_ended_at: null,
};

function asSvc(db: unknown) {
  return db as unknown as SupabaseClient;
}

// ─── validation ───────────────────────────────────────────────

Deno.test("validateExtendEndsAt: accepts a future date up to started_at + 30 days (inclusive)", () => {
  assertEquals(validateExtendEndsAt("2026-12-31T15:00:00Z", STARTED, NOW), { ok: true, endsAt: "2026-12-31T15:00:00.000Z" });
  assertEquals(validateExtendEndsAt("2026-12-20T15:00:00Z", STARTED, NOW).ok, true);
});

Deno.test("validateExtendEndsAt: refuses unparseable, past and beyond 30 days", () => {
  assertEquals(validateExtendEndsAt("amanhã", STARTED, NOW).ok, false);
  assertEquals(validateExtendEndsAt(undefined, STARTED, NOW).ok, false);
  assertEquals(validateExtendEndsAt("2026-12-04T12:00:00Z", STARTED, NOW).ok, false);
  assertEquals(validateExtendEndsAt("2026-12-31T15:00:01Z", STARTED, NOW).ok, false);
  assertEquals(validateExtendEndsAt("2026-12-20T15:00:00Z", null, NOW).ok, false);
});

// ─── extend ───────────────────────────────────────────────────

Deno.test("extend_refused_after_conversion", async () => {
  const { db, calls } = makeFakeDb({
    workspaces: [{ data: { ...trialRow, plan_source: "stripe", reverse_trial_ended_at: "2026-12-04T00:00:00Z" }, error: null }],
  });
  const res = await handleExtendReverseTrial(
    asSvc(db),
    { workspace_id: "ws-1", ends_at: "2026-12-20T15:00:00Z" },
    USER_ID,
    HEADERS,
    NOW,
  );
  assertEquals(res.status, 409);
  const body = await res.json();
  assertEquals(body.code, "not_in_trial");
  assert(typeof body.error === "string" && body.error.length > 0, "pt-BR message");
  assertEquals(callsTo(calls, "rpc:admin_extend_reverse_trial", "rpc").length, 0);
  assertEquals(callsTo(calls, "audit_log", "insert").length, 0);
});

Deno.test("extend_refused_when_ended", async () => {
  // Downgraded by the sweep: plan_source is no longer 'trial'.
  const { db, calls } = makeFakeDb({
    workspaces: [{ data: { ...trialRow, plan_source: "system", reverse_trial_ended_at: "2026-12-15T15:00:00Z" }, error: null }],
  });
  const res = await handleExtendReverseTrial(
    asSvc(db),
    { workspace_id: "ws-1", ends_at: "2026-12-20T15:00:00Z" },
    USER_ID,
    HEADERS,
    NOW,
  );
  assertEquals(res.status, 409);
  assertEquals((await res.json()).code, "not_in_trial");
  assertEquals(callsTo(calls, "audit_log", "insert").length, 0);
});

Deno.test("extend: RPC false (raced with the sweep) is 409 not_in_trial, no audit", async () => {
  const { db, calls } = makeFakeDb(
    { workspaces: [{ data: trialRow, error: null }] },
    { admin_extend_reverse_trial: [{ data: false, error: null }] },
  );
  const res = await handleExtendReverseTrial(
    asSvc(db),
    { workspace_id: "ws-1", ends_at: "2026-12-20T15:00:00Z" },
    USER_ID,
    HEADERS,
    NOW,
  );
  assertEquals(res.status, 409);
  assertEquals((await res.json()).code, "not_in_trial");
  assertEquals(callsTo(calls, "audit_log", "insert").length, 0);
});

Deno.test("extend: a date beyond 30 days is 400, not a misleading not_in_trial", async () => {
  const { db, calls } = makeFakeDb({ workspaces: [{ data: trialRow, error: null }] });
  const res = await handleExtendReverseTrial(
    asSvc(db),
    { workspace_id: "ws-1", ends_at: "2027-01-05T15:00:00Z" },
    USER_ID,
    HEADERS,
    NOW,
  );
  assertEquals(res.status, 400);
  assertEquals(callsTo(calls, "rpc:admin_extend_reverse_trial", "rpc").length, 0);
});

Deno.test("extend: success calls the RPC and writes an audit row without conta_id", async () => {
  const { db, calls } = makeFakeDb(
    { workspaces: [{ data: trialRow, error: null }] },
    { admin_extend_reverse_trial: [{ data: true, error: null }] },
  );
  const res = await handleExtendReverseTrial(
    asSvc(db),
    { workspace_id: "ws-1", ends_at: "2026-12-20T15:00:00Z" },
    USER_ID,
    HEADERS,
    NOW,
  );
  assertEquals(res.status, 200);
  const rpc = callsTo(calls, "rpc:admin_extend_reverse_trial", "rpc")[0];
  assertEquals(rpc.args[0], { p_workspace: "ws-1", p_ends_at: "2026-12-20T15:00:00.000Z" });
  const audit = callsTo(calls, "audit_log", "insert")[0]?.args[0] as Record<string, unknown>;
  assert(audit, "audit row expected");
  assertEquals(audit.action, "admin-extend-reverse-trial");
  assertEquals(audit.actor_user_id, USER_ID);
  assertEquals(audit.resource_id, "ws-1");
  assertEquals("conta_id" in audit, false);
  assertEquals((audit.metadata as Record<string, unknown>).previous_ends_at, ENDS);
});

Deno.test("extend: missing workspace_id is 400", async () => {
  const { db } = makeFakeDb();
  const res = await handleExtendReverseTrial(asSvc(db), { workspace_id: "", ends_at: "x" }, USER_ID, HEADERS, NOW);
  assertEquals(res.status, 400);
});

// ─── end now ──────────────────────────────────────────────────

Deno.test("end_now_sets_ended_by_admin", async () => {
  const { db, calls } = makeFakeDb({}, { end_reverse_trial: [{ data: true, error: null }] });
  const res = await handleEndReverseTrial(asSvc(db), { workspace_id: "ws-1" }, USER_ID, HEADERS);
  assertEquals(res.status, 200);
  const rpc = callsTo(calls, "rpc:end_reverse_trial", "rpc")[0];
  assertEquals(rpc.args[0], { p_workspace: "ws-1", p_outcome: "ended_by_admin" });
  const audit = callsTo(calls, "audit_log", "insert")[0]?.args[0] as Record<string, unknown>;
  assertEquals(audit.action, "admin-end-reverse-trial");
  assertEquals("conta_id" in audit, false);
});

Deno.test("end now: RPC false is 409 not_in_trial without audit", async () => {
  const { db, calls } = makeFakeDb({}, { end_reverse_trial: [{ data: false, error: null }] });
  const res = await handleEndReverseTrial(asSvc(db), { workspace_id: "ws-1" }, USER_ID, HEADERS);
  assertEquals(res.status, 409);
  assertEquals((await res.json()).code, "not_in_trial");
  assertEquals(callsTo(calls, "audit_log", "insert").length, 0);
});

Deno.test("end now: RPC error throws (index.ts maps it to a generic 500)", async () => {
  const { db, calls } = makeFakeDb({}, { end_reverse_trial: [{ data: null, error: { message: "boom" } }] });
  let threw = false;
  try {
    await handleEndReverseTrial(asSvc(db), { workspace_id: "ws-1" }, USER_ID, HEADERS);
  } catch {
    threw = true;
  }
  assert(threw, "expected a throw");
  assertEquals(callsTo(calls, "audit_log", "insert").length, 0);
});
