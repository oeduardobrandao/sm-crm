import { assert, assertEquals } from "./assert.ts";
import { type LoopsCronDeps, runLoopsSyncCron } from "../loops-sync-cron/handler.ts";

type Sent = { email: string; eventName: string; properties: Record<string, unknown>; idempotencyKey: string };

function makeDeps(over: Partial<LoopsCronDeps> = {}): LoopsCronDeps & {
  sent: Sent[];
  claimed: string[];
  deleted: string[];
  traits: Array<{ email: string; traits: Record<string, unknown> }>;
} {
  const sent: Sent[] = [];
  const claimed: string[] = [];
  const deleted: string[] = [];
  const traits: Array<{ email: string; traits: Record<string, unknown> }> = [];
  const base = {
    sent,
    claimed,
    deleted,
    traits,
    rpc: (_name: string) => Promise.resolve({ data: [], error: null }),
    claim: (type: string, wsId: string) => {
      claimed.push(`${type}/${wsId}`);
      return Promise.resolve(true);
    },
    markDelivered: () => Promise.resolve(),
    recordContactSync: () => Promise.resolve(),
    markContactDeleted: () => Promise.resolve(),
    sendEvent: (p: Sent) => {
      sent.push(p);
      return Promise.resolve();
    },
    updateContact: (p: { email: string; traits: Record<string, unknown> }) => {
      traits.push(p);
      return Promise.resolve();
    },
    deleteContact: (p: { email: string }) => {
      deleted.push(p.email);
      return Promise.resolve();
    },
    capture: () => Promise.resolve(),
    report: () => Promise.resolve(),
  };
  return { ...base, ...over } as LoopsCronDeps & typeof base;
}

const PAYWALL_ROW = {
  workspace_id: "ws-1",
  workspace_name: "Agência A",
  owner_user_id: "user-1",
  owner_email: "a@b.com",
  owner_nome: "Ana Silva",
  plan_name: "Free",
  client_count: 3,
  feature: "feature_hub_portal",
  clicked_upgrade: true,
  attempts: 0,
};

Deno.test("sends a paywall_hit event with a deterministic idempotency key", async () => {
  const deps = makeDeps({
    rpc: (name: string) =>
      Promise.resolve({
        data: name === "get_paywall_hit_candidates" ? [PAYWALL_ROW] : [],
        error: null,
      }),
  });
  const res = await runLoopsSyncCron(deps);

  assertEquals(res.eventsSent, 1);
  assertEquals(deps.sent[0].eventName, "paywall_hit");
  assertEquals(deps.sent[0].idempotencyKey, "paywall_hit/ws-1");
  assertEquals(deps.sent[0].email, "a@b.com");
  assertEquals(deps.sent[0].properties.feature, "feature_hub_portal");
  assertEquals(deps.sent[0].properties.clickedUpgrade, true);
  assertEquals(deps.sent[0].properties.workspaceName, "Agência A");
  assertEquals(deps.sent[0].properties.clientCount, 3);
});

// Regression guard. dormant_signup's ledger row keys on user_id and its
// workspace_id MOVES when the reported workspace changes, so a workspace-scoped
// key would change between a send and its retry, Loops would not dedupe, and the
// person would get a second email. See the comment in handler.ts.
Deno.test("dormant_signup uses a USER-scoped idempotency key, not workspace-scoped", async () => {
  const deps = makeDeps({
    rpc: (name: string) =>
      Promise.resolve({
        data: name === "get_dormant_signup_candidates"
          ? [{
            workspace_id: "ws-9",
            workspace_name: "Agência B",
            owner_user_id: "user-7",
            owner_email: "d@e.com",
            owner_nome: "Bruno",
            days_since_signup: 5,
            attempts: 0,
          }]
          : [],
        error: null,
      }),
  });
  await runLoopsSyncCron(deps);

  assertEquals(deps.sent[0].idempotencyKey, "dormant_signup/user-7");
  assert(
    !deps.sent[0].idempotencyKey.includes("ws-9"),
    "dormant key must not be scoped to the workspace",
  );
});

Deno.test("claims before sending", async () => {
  const order: string[] = [];
  const deps = makeDeps({
    rpc: (name: string) =>
      Promise.resolve({
        data: name === "get_paywall_hit_candidates" ? [PAYWALL_ROW] : [],
        error: null,
      }),
    claim: () => {
      order.push("claim");
      return Promise.resolve(true);
    },
    sendEvent: () => {
      order.push("send");
      return Promise.resolve();
    },
  });
  await runLoopsSyncCron(deps);
  assertEquals(order, ["claim", "send"]);
});

Deno.test("a lost claim skips the send entirely (72h cap arbitration)", async () => {
  const deps = makeDeps({
    rpc: (name: string) =>
      Promise.resolve({
        data: name === "get_paywall_hit_candidates" ? [PAYWALL_ROW] : [],
        error: null,
      }),
    claim: () => Promise.resolve(false),
  });
  const res = await runLoopsSyncCron(deps);
  assertEquals(res.eventsSent, 0);
  assertEquals(deps.sent.length, 0);
  assertEquals(res.failed, 0, "a refused claim is an arbitration outcome, not a failure");
});

Deno.test("a failed send leaves the claim undelivered and is counted as failed", async () => {
  let delivered = 0;
  const deps = makeDeps({
    rpc: (name: string) =>
      Promise.resolve({
        data: name === "get_paywall_hit_candidates" ? [PAYWALL_ROW] : [],
        error: null,
      }),
    sendEvent: () => Promise.reject(new Error("Loops 500")),
    markDelivered: () => {
      delivered++;
      return Promise.resolve();
    },
  });
  const res = await runLoopsSyncCron(deps);
  assertEquals(res.eventsSent, 0);
  assertEquals(res.failed, 1);
  assertEquals(delivered, 0, "must not mark delivered after a failed send");
});

// markDelivered's (keyCol, keyVal) mapping must mirror the idempotency-key
// scoping rule above it byte-for-byte: paywall_hit stamps workspace_id,
// dormant_signup stamps user_id. Deleting the markDelivered call, or
// inverting keyCol/keyVal, leaves every other test in this file green -- these
// two are the only ones that exercise the mapping on the success path.
Deno.test("markDelivered stamps workspace_id for a workspace-scoped type (paywall_hit)", async () => {
  const calls: Array<[string, string, string]> = [];
  const deps = makeDeps({
    rpc: (name: string) =>
      Promise.resolve({
        data: name === "get_paywall_hit_candidates" ? [PAYWALL_ROW] : [],
        error: null,
      }),
    markDelivered: (emailType: string, keyCol: "user_id" | "workspace_id", keyVal: string) => {
      calls.push([emailType, keyCol, keyVal]);
      return Promise.resolve();
    },
  });
  await runLoopsSyncCron(deps);
  assertEquals(calls, [["paywall_hit", "workspace_id", "ws-1"]]);
});

Deno.test("markDelivered stamps user_id for the user-scoped type (dormant_signup)", async () => {
  const calls: Array<[string, string, string]> = [];
  const deps = makeDeps({
    rpc: (name: string) =>
      Promise.resolve({
        data: name === "get_dormant_signup_candidates"
          ? [{
            workspace_id: "ws-9",
            workspace_name: "Agência B",
            owner_user_id: "user-7",
            owner_email: "d@e.com",
            owner_nome: "Bruno",
            days_since_signup: 5,
            attempts: 0,
          }]
          : [],
        error: null,
      }),
    markDelivered: (emailType: string, keyCol: "user_id" | "workspace_id", keyVal: string) => {
      calls.push([emailType, keyCol, keyVal]);
      return Promise.resolve();
    },
  });
  await runLoopsSyncCron(deps);
  assertEquals(calls, [["dormant_signup", "user_id", "user-7"]]);
});

Deno.test("a PostHog capture failure cannot fail an already-sent email", async () => {
  const deps = makeDeps({
    rpc: (name: string) =>
      Promise.resolve({
        data: name === "get_paywall_hit_candidates" ? [PAYWALL_ROW] : [],
        error: null,
      }),
    capture: () => Promise.reject(new Error("posthog down")),
  });
  const res = await runLoopsSyncCron(deps);
  assertEquals(res.eventsSent, 1);
  assertEquals(res.failed, 0);
});

// Regression guard for the reordering fix: trait sync is `limit 200` with no
// ledger exclusion and the cheapest to lose gracefully (self-heals next run),
// while contact deletions are LGPD consent revocations and the trigger
// sweeps are the revenue path -- both must run before trait sync so a slow
// invocation drops enrichment first, not consent deletions or revenue email.
Deno.test("sweeps run consent deletions, then trigger sweeps, then trait sync last", async () => {
  const order: string[] = [];
  const deps = makeDeps({
    rpc: (name: string) => {
      order.push(name);
      return Promise.resolve({ data: [], error: null });
    },
  });
  await runLoopsSyncCron(deps);
  assertEquals(order, [
    "get_loops_contact_deletions",
    "get_paywall_hit_candidates",
    "get_abandoned_checkout_candidates",
    "get_dormant_signup_candidates",
    "get_loops_trait_candidates",
  ]);
});

Deno.test("one failing candidate does not abort the rest of the sweep", async () => {
  const second = { ...PAYWALL_ROW, workspace_id: "ws-2", owner_email: "c@d.com" };
  let calls = 0;
  const deps = makeDeps({
    rpc: (name: string) =>
      Promise.resolve({
        data: name === "get_paywall_hit_candidates" ? [PAYWALL_ROW, second] : [],
        error: null,
      }),
    sendEvent: (p: Sent) => {
      calls++;
      if (calls === 1) return Promise.reject(new Error("boom"));
      return Promise.resolve();
    },
  });
  const res = await runLoopsSyncCron(deps);
  assertEquals(res.eventsSent, 1);
  assertEquals(res.failed, 1);
});

Deno.test("syncs traits and records the synced email", async () => {
  const recorded: Array<{ userId: string; email: string }> = [];
  const deps = makeDeps({
    rpc: (name: string) =>
      Promise.resolve({
        data: name === "get_loops_trait_candidates"
          ? [{
            user_id: "user-1",
            email: "a@b.com",
            nome: "Ana Silva",
            days_since_signup: 5,
            workspace_count: 2,
            any_free: true,
          }]
          : [],
        error: null,
      }),
    recordContactSync: (userId: string, email: string) => {
      recorded.push({ userId, email });
      return Promise.resolve();
    },
  });
  const res = await runLoopsSyncCron(deps);
  assertEquals(res.traitsSynced, 1);
  assertEquals(deps.traits[0].traits.firstName, "Ana");
  assertEquals(deps.traits[0].traits.workspaceCount, 2);
  assertEquals(deps.traits[0].traits.anyFree, true);
  assertEquals(recorded, [{ userId: "user-1", email: "a@b.com" }]);
});

Deno.test("traits carry no workspace-specific facts", async () => {
  const deps = makeDeps({
    rpc: (name: string) =>
      Promise.resolve({
        data: name === "get_loops_trait_candidates"
          ? [{
            user_id: "user-1",
            email: "a@b.com",
            nome: "Ana",
            days_since_signup: 5,
            workspace_count: 2,
            any_free: true,
          }]
          : [],
        error: null,
      }),
  });
  await runLoopsSyncCron(deps);
  const keys = Object.keys(deps.traits[0].traits);
  for (const forbidden of ["workspaceName", "planName", "clientCount", "hasInstagram"]) {
    assert(!keys.includes(forbidden), `${forbidden} must not be a contact trait`);
  }
});

Deno.test("deletes revoked contacts by their synced email and marks them deleted", async () => {
  const marked: string[] = [];
  const deps = makeDeps({
    rpc: (name: string) =>
      Promise.resolve({
        data: name === "get_loops_contact_deletions"
          ? [{ id: "lc-1", synced_email: "old@b.com" }]
          : [],
        error: null,
      }),
    markContactDeleted: (id: string) => {
      marked.push(id);
      return Promise.resolve();
    },
  });
  const res = await runLoopsSyncCron(deps);
  assertEquals(res.contactsDeleted, 1);
  assertEquals(deps.deleted, ["old@b.com"]);
  assertEquals(marked, ["lc-1"]);
});

Deno.test("an RPC error is reported and does not throw", async () => {
  const deps = makeDeps({
    rpc: (name: string) =>
      name === "get_paywall_hit_candidates"
        ? Promise.resolve({ data: null, error: { message: "boom" } })
        : Promise.resolve({ data: [], error: null }),
  });
  const res = await runLoopsSyncCron(deps);
  assertEquals(res.failed, 1);
});

Deno.test("no candidates is a clean no-op", async () => {
  const deps = makeDeps();
  const res = await runLoopsSyncCron(deps);
  assertEquals(res, { traitsSynced: 0, eventsSent: 0, contactsDeleted: 0, failed: 0 });
});
