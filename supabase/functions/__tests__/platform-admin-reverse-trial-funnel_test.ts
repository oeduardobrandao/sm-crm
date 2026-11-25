import { assertEquals } from "./assert.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { computeReverseTrialFunnel, type FunnelTrialRow } from "../platform-admin/reverse-trial-funnel-logic.ts";
import { handleGetReverseTrialFunnel } from "../platform-admin/reverse-trial-funnel.ts";
import { callsTo, HEADERS, makeFakeDb } from "./platform-admin-fake-db.ts";

const NOW = new Date("2026-12-20T12:00:00Z");

function trial(id: string, over: Partial<FunnelTrialRow> = {}): FunnelTrialRow {
  return {
    id,
    is_internal: false,
    demo_created_at: null,
    plan_source: "trial",
    reverse_trial_started_at: "2026-12-01T12:00:00Z",
    reverse_trial_ended_at: null,
    reverse_trial_outcome: null,
    reverse_trial_card_added_at: null,
    reverse_trial_first_paid_at: null,
    ...over,
  };
}

Deno.test("funnel logic: stages from the columns, activation needs a client AND a post by day 7", () => {
  const trials = [
    trial("a"), // client + post on day 2: activated
    trial("b"), // client on day 2, post on day 9: not activated
    trial("c", { reverse_trial_card_added_at: "2026-12-05T00:00:00Z", reverse_trial_first_paid_at: "2026-12-15T12:00:00Z", reverse_trial_outcome: "converted", plan_source: "stripe" }),
    trial("d", { reverse_trial_outcome: "downgraded", plan_source: "system", reverse_trial_ended_at: "2026-12-15T12:00:00Z" }),
    trial("e", { reverse_trial_started_at: "2026-12-18T12:00:00Z" }), // younger than 7 days
    trial("f", { reverse_trial_outcome: "ended_by_admin", plan_source: "manual" }),
  ];
  const clients = [
    { conta_id: "a", created_at: "2026-12-03T00:00:00Z" },
    { conta_id: "b", created_at: "2026-12-03T00:00:00Z" },
    { conta_id: "e", created_at: "2026-12-19T00:00:00Z" },
  ];
  const posts = [
    { conta_id: "a", created_at: "2026-12-03T01:00:00Z" },
    { conta_id: "b", created_at: "2026-12-10T00:00:00Z" },
    { conta_id: "e", created_at: "2026-12-19T01:00:00Z" },
  ];
  assertEquals(computeReverseTrialFunnel(trials, clients, posts, NOW), {
    started: 6,
    running: 3, // a, b and e are still in the trial
    matured_d7: 5,
    activated_d7: 2, // a and e (e already did both within its first 7 days)
    card_added: 1,
    paid: 1,
    downgraded: 1,
    ended_by_admin: 1,
  });
});

Deno.test("funnel logic: the day-7 bound is inclusive and per workspace", () => {
  const t = trial("a");
  const exact = "2026-12-08T12:00:00.000Z";
  const late = "2026-12-08T12:00:00.001Z";
  const f1 = computeReverseTrialFunnel([t], [{ conta_id: "a", created_at: exact }], [{ conta_id: "a", created_at: exact }], NOW);
  assertEquals(f1.activated_d7, 1);
  const f2 = computeReverseTrialFunnel([t], [{ conta_id: "a", created_at: exact }], [{ conta_id: "a", created_at: late }], NOW);
  assertEquals(f2.activated_d7, 0);
});

Deno.test("funnel logic: internal and demo workspaces are excluded", () => {
  const f = computeReverseTrialFunnel(
    [trial("a", { is_internal: true }), trial("b", { demo_created_at: "2026-12-01T00:00:00Z" }), trial("c", { plan_source: "demo" }), trial("d")],
    [],
    [],
    NOW,
  );
  assertEquals(f.started, 1);
});

Deno.test("funnel handler: batched reads of clientes and workflow_posts, bounded by the day-7 cutoff", async () => {
  const { db, calls } = makeFakeDb({
    workspaces: [
      { data: [trial("a"), trial("x", { is_internal: true })], error: null },
      { data: [], error: null },
    ],
    clientes: [{ data: [{ conta_id: "a", created_at: "2026-12-02T00:00:00Z" }], error: null }, { data: [], error: null }],
    workflow_posts: [{ data: [{ conta_id: "a", created_at: "2026-12-02T00:00:00Z" }], error: null }, { data: [], error: null }],
  });
  const res = await handleGetReverseTrialFunnel(db as unknown as SupabaseClient, HEADERS, NOW);
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.started, 1);
  assertEquals(body.activated_d7, 1);

  // Internal workspace never reaches the per-workspace reads.
  const clientIn = callsTo(calls, "clientes", "in")[0];
  assertEquals(clientIn.args, ["conta_id", ["a"]]);
  // Bounded by the chunk's latest day-7 cutoff.
  const clientLte = callsTo(calls, "clientes", "lte")[0];
  assertEquals(clientLte.args, ["created_at", "2026-12-08T12:00:00.000Z"]);
  assertEquals(callsTo(calls, "workflow_posts", "in")[0].args, ["conta_id", ["a"]]);
});

Deno.test("funnel handler: no trials means no per-workspace reads", async () => {
  const { db, calls } = makeFakeDb({ workspaces: [{ data: [], error: null }] });
  const res = await handleGetReverseTrialFunnel(db as unknown as SupabaseClient, HEADERS, NOW);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).started, 0);
  assertEquals(callsTo(calls, "clientes", "from").length, 0);
});
