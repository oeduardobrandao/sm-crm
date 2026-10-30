// gbp-sync-cron (plan Task 8): the hourly GMN batch plus the privacy deletion duties. Mirrors
// tiktok-sync-cron_test.ts: handler.ts's secret gate in isolation, core.ts through the shared
// supabaseMock with every dependency injected. Dependencies a test does not expect to run throw
// "must not be called".
import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createGbpSyncCronHandler } from "../gbp-sync-cron/handler.ts";
import { type GbpSyncCronDeps, runGbpSyncCron } from "../gbp-sync-cron/core.ts";
import type { GbpLocationRow } from "../_shared/gbp-sync.ts";
import * as realApi from "../_shared/gbp-api.ts";
import { GoogleApiError } from "../_shared/google.ts";

type Db = ReturnType<typeof createSupabaseQueryMock>;

const NOW = new Date("2026-10-30T15:40:00Z");
const timingSafeEqual = (a: string, b: string) => a === b;

function unit(id: string, contaId: string, overrides: Partial<GbpLocationRow> = {}): GbpLocationRow {
  return {
    id,
    conta_id: contaId,
    client_id: 101,
    connection_id: "conn-1",
    account_name: "accounts/1",
    location_name: `locations/${id}`,
    title: "Loja",
    has_voice_of_merchant: false,
    average_rating: null,
    total_review_count: null,
    status: "active",
    data_through: "2026-10-20",
    last_synced_at: null,
    last_sync_attempt_at: null,
    maps_uri: null,
    ...overrides,
  };
}

function trapApi() {
  const trap = () => {
    throw new Error("must not be called");
  };
  return {
    ...realApi,
    fetchDailyMetrics: trap,
    fetchMonthlyKeywords: trap,
    listReviews: trap,
    getLocation: trap,
  } as unknown as typeof realApi;
}

function baseDeps(db: Db, overrides: Partial<GbpSyncCronDeps> = {}) {
  const reports: Array<{ cronName: string; detail: Record<string, unknown> }> = [];
  const revocationCalls: unknown[] = [];
  const decisions: unknown[] = [];
  const deps: GbpSyncCronDeps = {
    svc: db as never,
    getFreshGoogleToken: async () => {
      throw new Error("must not be called");
    },
    reportCronFailure: async (_svc, cronName, detail) => {
      reports.push({ cronName, detail: detail as Record<string, unknown> });
    },
    effectivePlanFeature: async () => {
      throw new Error("must not be called");
    },
    fetchInternalWorkspaceIds: async () => new Set<string>(),
    api: trapApi(),
    syncLocation: async () => {
      throw new Error("must not be called");
    },
    retryPendingRevocations: async (_svc, opts) => {
      revocationCalls.push(opts);
      return { revoked: 0, failed: 0, gaveUp: 0 };
    },
    processUnlinkDecisionData: async (_svc, data) => {
      decisions.push(data);
    },
    now: () => NOW,
    sleep: async () => {},
    ...overrides,
  };
  return { deps, reports, revocationCalls, decisions };
}

/** Default answers for the three duty RPCs: nothing expired, no orphan subs. */
function queueQuietDuties(db: Db) {
  db.queueRpc("google_expire_units", { data: [{ gbp_locations_deleted: 0, youtube_channels_deleted: 0 }] });
  db.queueRpc("google_orphan_subs", { data: [] });
}

const allFlagsOn = async () => true;

// ── Handler ─────────────────────────────────────────────────────────────────────

Deno.test("gbp-sync-cron: a missing x-cron-secret returns 401 with no DB call", async () => {
  const db = createSupabaseQueryMock();
  const handler = createGbpSyncCronHandler({
    cronSecret: "segredo",
    timingSafeEqual,
    run: () => runGbpSyncCron(baseDeps(db).deps),
  });
  const res = await handler(new Request("https://x.test/gbp-sync-cron"));
  assertEquals(res.status, 401);
  assertEquals(db.calls.length, 0);
});

Deno.test("gbp-sync-cron: a wrong x-cron-secret returns 401 with no DB call", async () => {
  const db = createSupabaseQueryMock();
  const handler = createGbpSyncCronHandler({
    cronSecret: "segredo",
    timingSafeEqual,
    run: () => runGbpSyncCron(baseDeps(db).deps),
  });
  const res = await handler(new Request("https://x.test/gbp-sync-cron", { headers: { "x-cron-secret": "errado" } }));
  assertEquals(res.status, 401);
  assertEquals(db.calls.length, 0);
});

// ── Candidates ──────────────────────────────────────────────────────────────────

Deno.test("gbp-sync-cron: candidates are active, connected and not synced in 20 h, least recently attempted first", async () => {
  const db = createSupabaseQueryMock();
  db.queue("gbp_locations", "select", { data: [] });
  queueQuietDuties(db);
  const res = await runGbpSyncCron(baseDeps(db).deps);
  assertEquals(res.status, 200);

  const select = db.calls.find((c) => c.table === "gbp_locations" && c.operation === "select")!;
  const mods = select.modifiers;
  assert(mods.some((m) => m.method === "eq" && m.args[0] === "status" && m.args[1] === "active"));
  assert(mods.some((m) => m.method === "not" && m.args[0] === "connection_id" && m.args[1] === "is" && m.args[2] === null));
  const cutoff = new Date(NOW.getTime() - 20 * 3600_000).toISOString();
  assert(mods.some((m) => m.method === "or" && m.args[0] === `last_synced_at.is.null,last_synced_at.lt.${cutoff}`));
  const orders = mods.filter((m) => m.method === "order").map((m) => m.args);
  assertEquals(orders, [["last_sync_attempt_at", { ascending: true, nullsFirst: true }], ["id", { ascending: true }]]);
  assert(!String(select.selectArgs[0][0]).includes("token"), "never select token columns");
});

Deno.test("gbp-sync-cron: a workspace without feature_auto_sync_cron or feature_google_business is skipped, and so is an internal one", async () => {
  const db = createSupabaseQueryMock();
  db.queue("gbp_locations", "select", {
    data: [unit("a", "ws-no-auto"), unit("b", "ws-no-gbp"), unit("c", "ws-internal"), unit("d", "ws-ok")],
  });
  queueQuietDuties(db);
  const synced: string[] = [];
  const checked: string[] = [];
  const { deps } = baseDeps(db, {
    effectivePlanFeature: async (_svc, ws, feature) => {
      checked.push(`${ws}:${feature}`);
      if (ws === "ws-no-auto") return feature !== "feature_auto_sync_cron";
      if (ws === "ws-no-gbp") return feature !== "feature_google_business";
      return true;
    },
    fetchInternalWorkspaceIds: async () => new Set(["ws-internal"]),
    syncLocation: async (_d, loc) => {
      synced.push(loc.id);
      return { status: "synced", backfill: false };
    },
  });
  const body = await (await runGbpSyncCron(deps)).json();
  assertEquals(synced, ["d"]);
  assertEquals(body.synced, 1);
  assert(checked.includes("ws-ok:feature_google_business"));
  assert(checked.includes("ws-ok:feature_auto_sync_cron"));
});

Deno.test("gbp-sync-cron: the batch stamp lands before any sync and covers every candidate examined", async () => {
  const db = createSupabaseQueryMock();
  const order: string[] = [];
  db.queue("gbp_locations", "select", { data: [unit("a", "ws-free"), unit("b", "ws-paid")] });
  db.queue("gbp_locations", "update", () => {
    order.push("stamp");
    return { data: null };
  });
  queueQuietDuties(db);
  const { deps } = baseDeps(db, {
    effectivePlanFeature: async (_svc, ws) => ws === "ws-paid",
    syncLocation: async () => {
      order.push("sync");
      return { status: "synced", backfill: false };
    },
  });
  await runGbpSyncCron(deps);
  assertEquals(order, ["stamp", "sync"]);
  const stamp = db.calls.find((c) => c.table === "gbp_locations" && c.operation === "update")!;
  assertEquals(stamp.payload, { last_sync_attempt_at: NOW.toISOString() });
  assertEquals(stamp.modifiers.find((m) => m.method === "in")!.args, ["id", ["a", "b"]]);
});

Deno.test("gbp-sync-cron: 26 ineligible candidates ahead of an eligible one do not starve it; all 27 are stamped (I1)", async () => {
  const db = createSupabaseQueryMock();
  const free = Array.from({ length: 26 }, (_, i) => unit(`f-${i}`, "ws-free"));
  // Page size 25: the eligible unit is only on the second page.
  db.queue("gbp_locations", "select", { data: free.slice(0, 25) }, { data: [...free.slice(25), unit("paid", "ws-paid")] });
  queueQuietDuties(db);
  const synced: string[] = [];
  const { deps } = baseDeps(db, {
    candidatePageSize: 25,
    batchLimit: 25,
    effectivePlanFeature: async (_svc, ws) => ws === "ws-paid",
    syncLocation: async (_d, loc) => {
      synced.push(loc.id);
      return { status: "synced", backfill: false };
    },
  });
  const body = await (await runGbpSyncCron(deps)).json();
  assertEquals(synced, ["paid"]);
  assertEquals(body.synced, 1);
  const pages = db.calls.filter((c) => c.table === "gbp_locations" && c.operation === "select");
  assertEquals(pages.map((p) => p.modifiers.find((m) => m.method === "range")!.args), [[0, 24], [25, 49]]);
  const stamp = db.calls.find((c) => c.table === "gbp_locations" && c.operation === "update")!;
  const ids = stamp.modifiers.find((m) => m.method === "in")!.args[1] as string[];
  assertEquals(ids.length, 27);
  assert(ids.includes("paid"));
});

Deno.test("gbp-sync-cron: the batch is capped at GOOGLE_SYNC_BATCH_LIMIT and a deferred eligible unit is not stamped", async () => {
  const db = createSupabaseQueryMock();
  db.queue("gbp_locations", "select", {
    data: [unit("a", "ws"), unit("x", "ws-free"), unit("b", "ws"), unit("c", "ws")],
  });
  queueQuietDuties(db);
  const synced: string[] = [];
  const { deps } = baseDeps(db, {
    batchLimit: 2,
    effectivePlanFeature: async (_svc, ws) => ws === "ws",
    syncLocation: async (_d, loc) => {
      synced.push(loc.id);
      return { status: "synced", backfill: false };
    },
  });
  const body = await (await runGbpSyncCron(deps)).json();
  assertEquals(synced, ["a", "b"]);
  assertEquals(body.total, 2);
  // The batch and the ineligible candidate are stamped; "c" (eligible, deferred) keeps its place.
  const stamps = db.calls.filter((c) => c.table === "gbp_locations" && c.operation === "update");
  assertEquals(stamps.length, 1);
  assertEquals(stamps[0].modifiers.find((m) => m.method === "in")!.args, ["id", ["a", "x", "b"]]);
});

Deno.test("gbp-sync-cron: concurrency is capped at 4", async () => {
  const db = createSupabaseQueryMock();
  db.queue("gbp_locations", "select", { data: Array.from({ length: 10 }, (_, i) => unit(`u-${i}`, "ws")) });
  queueQuietDuties(db);
  let inFlight = 0;
  let peak = 0;
  const { deps } = baseDeps(db, {
    concurrency: 10,
    effectivePlanFeature: allFlagsOn,
    syncLocation: async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return { status: "synced", backfill: false };
    },
  });
  await runGbpSyncCron(deps);
  assertEquals(peak, 4);
});

// ── Outcomes ────────────────────────────────────────────────────────────────────

Deno.test("gbp-sync-cron: NOT_APPROVED gives no failure report and no history or status writes (RF1)", async () => {
  const db = createSupabaseQueryMock();
  db.queue("gbp_locations", "select", { data: [unit("a", "ws")] });
  queueQuietDuties(db);
  const { deps, reports } = baseDeps(db, {
    effectivePlanFeature: allFlagsOn,
    getFreshGoogleToken: async () => "tok",
    api: {
      ...trapApi(),
      fetchDailyMetrics: async () => {
        throw new GoogleApiError("NOT_APPROVED", 403, "quota 0", false);
      },
    },
    syncLocation: undefined, // the real syncGbpLocation
  });
  const body = await (await runGbpSyncCron(deps)).json();
  assertEquals(body.notApproved, 1);
  assertEquals(body.failed, 0);
  assertEquals(reports.length, 0);
  const writes = db.calls.filter((c) => ["insert", "update", "upsert", "delete"].includes(c.operation));
  assertEquals(writes.length, 1, "only the batch stamp");
  assertEquals(writes[0].payload, { last_sync_attempt_at: NOW.toISOString() });
});

Deno.test("gbp-sync-cron: TOKEN_INVALID is counted as skipped with no failure report (I2)", async () => {
  const db = createSupabaseQueryMock();
  db.queue("gbp_locations", "select", { data: [unit("a", "ws")] });
  queueQuietDuties(db);
  const { deps, reports } = baseDeps(db, {
    effectivePlanFeature: allFlagsOn,
    getFreshGoogleToken: async () => {
      throw new GoogleApiError("TOKEN_INVALID", 401, "no refresh token", false);
    },
    syncLocation: undefined,
  });
  const body = await (await runGbpSyncCron(deps)).json();
  assertEquals(body.skipped, 1);
  assertEquals(body.failed, 0);
  assertEquals(reports.length, 0);
});

Deno.test("gbp-sync-cron: QUOTA_EXCEEDED on one unit does not stop the others and is not a failure", async () => {
  const db = createSupabaseQueryMock();
  db.queue("gbp_locations", "select", { data: [unit("a", "ws"), unit("b", "ws")] });
  queueQuietDuties(db);
  const { deps, reports } = baseDeps(db, {
    concurrency: 1,
    effectivePlanFeature: allFlagsOn,
    syncLocation: async (_d, loc) =>
      loc.id === "a" ? { status: "quota_skipped", backfill: false } : { status: "synced", backfill: false },
  });
  const body = await (await runGbpSyncCron(deps)).json();
  assertEquals(body.quotaSkipped, 1);
  assertEquals(body.synced, 1);
  assertEquals(reports.length, 0);
});

Deno.test("gbp-sync-cron: a REVOKED connection skips its other units without another token call (RF2)", async () => {
  const db = createSupabaseQueryMock();
  db.queue("gbp_locations", "select", {
    data: [unit("a", "ws"), unit("b", "ws"), unit("c", "ws", { connection_id: "conn-2" })],
  });
  queueQuietDuties(db);
  const tokenCalls: string[] = [];
  const { deps, reports } = baseDeps(db, {
    concurrency: 1,
    effectivePlanFeature: allFlagsOn,
    getFreshGoogleToken: async (_svc, connectionId) => {
      tokenCalls.push(connectionId);
      throw new GoogleApiError("REVOKED", 401, "invalid_grant", false);
    },
    syncLocation: undefined,
  });
  const body = await (await runGbpSyncCron(deps)).json();
  assertEquals(tokenCalls, ["conn-1", "conn-2"]);
  assertEquals(body.revoked, 2);
  assertEquals(body.skipped, 1);
  assertEquals(body.failed, 0);
  assertEquals(reports.length, 0);
});

Deno.test("gbp-sync-cron: an unexpected error fails that unit only and reaches reportCronFailure", async () => {
  const db = createSupabaseQueryMock();
  db.queue("gbp_locations", "select", { data: [unit("a", "ws"), unit("b", "ws")] });
  queueQuietDuties(db);
  const { deps, reports } = baseDeps(db, {
    concurrency: 1,
    effectivePlanFeature: allFlagsOn,
    syncLocation: async (_d, loc) => {
      if (loc.id === "a") throw new Error("boom");
      return { status: "synced", backfill: false };
    },
  });
  const body = await (await runGbpSyncCron(deps)).json();
  assertEquals(body.failed, 1);
  assertEquals(body.synced, 1);
  assertEquals(reports.length, 1);
  assertEquals(reports[0].cronName, "gbp-sync-cron");
});

// ── Deletion duties ─────────────────────────────────────────────────────────────

Deno.test("gbp-sync-cron: with every flag off the deletion duties still run", async () => {
  const db = createSupabaseQueryMock();
  db.queue("gbp_locations", "select", { data: [unit("a", "ws-free")] });
  db.queueRpc("google_expire_units", {
    data: [{ gbp_locations_deleted: 2, youtube_channels_deleted: 1, orphan_youtube_rows_deleted: 7, orphan_gbp_rows_deleted: 4 }],
  });
  db.queueRpc("google_orphan_subs", { data: ["sub-1"] });
  db.queueRpc("google_release_sub", { data: [{ should_revoke: true, revocation_id: "rev-1" }] });
  const { deps, revocationCalls, decisions } = baseDeps(db, {
    effectivePlanFeature: async () => false,
    retryPendingRevocations: async (_svc, opts) => {
      revocationCalls.push(opts);
      return { revoked: 3, failed: 0, gaveUp: 0 };
    },
  });
  const res = await runGbpSyncCron(deps);
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.synced, 0);
  assertEquals(db.calls.filter((c) => c.table === "rpc:google_expire_units").length, 1);
  assertEquals(revocationCalls, [{ limit: 50, maxAttempts: 10 }]);
  assertEquals(db.calls.find((c) => c.table === "rpc:google_orphan_subs")!.payload, { p_limit: 25 });
  assertEquals(decisions, [[{ should_revoke: true, revocation_id: "rev-1" }]]);
  assertEquals(body.expired, { gbpLocations: 2, youtubeChannels: 1, orphanYoutubeRows: 7, orphanGbpRows: 4 });
  assertEquals(body.revocations, { revoked: 3, failed: 0, gaveUp: 0 });
  assertEquals(body.orphansReleased, 1);
});

Deno.test("gbp-sync-cron: the duties run when there are no candidates and when the candidate query fails", async () => {
  for (const selectResult of [{ data: [] }, { data: null, error: { message: "boom" } }]) {
    const db = createSupabaseQueryMock();
    db.queue("gbp_locations", "select", selectResult);
    queueQuietDuties(db);
    const { deps, revocationCalls, reports } = baseDeps(db);
    await runGbpSyncCron(deps);
    assertEquals(db.calls.filter((c) => c.table === "rpc:google_expire_units").length, 1);
    assertEquals(revocationCalls.length, 1);
    assertEquals(db.calls.filter((c) => c.table === "rpc:google_orphan_subs").length, 1);
    assertEquals(reports.length, selectResult.error ? 1 : 0);
  }
});

Deno.test("gbp-sync-cron: two orphan subs are released by two separate google_release_sub calls (P4)", async () => {
  const db = createSupabaseQueryMock();
  db.queue("gbp_locations", "select", { data: [] });
  db.queueRpc("google_expire_units", { data: [{ gbp_locations_deleted: 0, youtube_channels_deleted: 0 }] });
  db.queueRpc("google_orphan_subs", { data: ["sub-1", "sub-2"] });
  db.queueRpc(
    "google_release_sub",
    { data: [{ should_revoke: true, revocation_id: "rev-1" }] },
    { data: [{ should_revoke: false, revocation_id: null }] },
  );
  const { deps, decisions } = baseDeps(db);
  const body = await (await runGbpSyncCron(deps)).json();
  const releases = db.calls.filter((c) => c.table === "rpc:google_release_sub");
  assertEquals(releases.map((c) => c.payload), [{ p_sub: "sub-1" }, { p_sub: "sub-2" }]);
  assertEquals(decisions.length, 2);
  assertEquals(body.orphansReleased, 2);
});

Deno.test("gbp-sync-cron: a failing duty does not stop the others, and the failures are reported", async () => {
  const db = createSupabaseQueryMock();
  db.queue("gbp_locations", "select", { data: [] });
  db.queueRpc("google_expire_units", { data: null, error: { message: "expire boom" } });
  db.queueRpc("google_orphan_subs", { data: ["sub-1", "sub-2"] });
  db.queueRpc("google_release_sub", { data: null, error: { message: "lock timeout on sub-1", code: "55P03" } }, {
    data: [{ should_revoke: true, revocation_id: "rev-2" }],
  });
  const logged: string[] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  };
  const { deps, revocationCalls, decisions, reports } = baseDeps(db, {
    retryPendingRevocations: async (_svc, opts) => {
      revocationCalls.push(opts);
      throw new Error("revocations boom");
    },
  });
  let res: Response;
  try {
    res = await runGbpSyncCron(deps);
  } finally {
    console.error = originalError;
  }
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(revocationCalls.length, 1);
  assertEquals(db.calls.filter((c) => c.table === "rpc:google_release_sub").length, 2);
  assertEquals(decisions, [[{ should_revoke: true, revocation_id: "rev-2" }]]);
  assertEquals(body.orphansReleased, 1);
  assertEquals(reports.length, 1);
  const errors = reports[0].detail.errors as Array<{ error: string }>;
  assertEquals(errors.length, 3);
  // A sub is a Google account id: the raw database message (which may quote it) is neither
  // logged nor reported; the generic line carries the error code.
  assert(!JSON.stringify(reports[0].detail).includes("sub-1"));
  assert(!JSON.stringify(reports[0].detail).includes("lock timeout"));
  assert(errors.some((e) => e.error === "google_release_sub failed (code 55P03)"));
  const releaseLog = logged.find((l) => l.includes("orphan release failed"));
  assertEquals(releaseLog, "[gbp-sync-cron] orphan release failed: google_release_sub failed (code 55P03)");
  assert(!logged.some((l) => l.includes("sub-1")));
});

Deno.test("gbp-sync-cron: revocations that failed or gave up are reported", async () => {
  const db = createSupabaseQueryMock();
  db.queue("gbp_locations", "select", { data: [] });
  queueQuietDuties(db);
  const { deps, reports } = baseDeps(db, {
    retryPendingRevocations: async () => ({ revoked: 1, failed: 1, gaveUp: 1 }),
  });
  const body = await (await runGbpSyncCron(deps)).json();
  assertEquals(body.revocations, { revoked: 1, failed: 1, gaveUp: 1 });
  assertEquals(reports.length, 1);
});
