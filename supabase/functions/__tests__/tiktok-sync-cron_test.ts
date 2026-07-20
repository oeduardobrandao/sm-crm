// tiktok-sync-cron (Task C4) — mirrors tiktok-refresh-cron_test.ts's DI convention (handler.ts's
// timingSafeEqual auth gate tested in isolation, business logic tested via the shared
// supabaseMock with getFreshTikTokToken/reportCronFailure/tiktokFetch/effectivePlanFeature and
// the tiktok-integration/import.ts helpers all injected — this suite never touches the real
// _shared/tiktok.ts refresh flow, _shared/triage.ts network calls, or real video import/thumb
// caching (already covered by tiktok-shared_test.ts / tiktok-integration_test.ts).
import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createTikTokSyncCronHandler } from "../tiktok-sync-cron/handler.ts";
import { runTikTokSyncCron, type TikTokSyncCronDeps } from "../tiktok-sync-cron/core.ts";
import { TikTokApiError } from "../_shared/tiktok.ts";

const timingSafeEqual = (a: string, b: string) => a === b;

interface ReportedFailure {
  cronName: string;
  // deno-lint-ignore no-explicit-any
  detail: any;
}

function fakeReportCronFailure() {
  const calls: ReportedFailure[] = [];
  return {
    // deno-lint-ignore no-explicit-any
    fn: async (_svc: any, cronName: string, detail: any) => {
      calls.push({ cronName, detail });
    },
    calls,
  };
}

function isoHoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

/** Baseline deps: every account-touching DI is a "must not be called" trap so a test that
 * expects zero accounts to be processed fails loudly if that assumption breaks. Individual
 * tests override only what they need. */
function baseDeps(db: ReturnType<typeof createSupabaseQueryMock>): TikTokSyncCronDeps {
  const { fn: reportCronFailure } = fakeReportCronFailure();
  return {
    svc: db as never,
    getFreshTikTokToken: async () => {
      throw new Error("must not be called");
    },
    reportCronFailure,
    tiktokFetch: async () => {
      throw new Error("must not be called");
    },
    effectivePlanFeature: async () => {
      throw new Error("must not be called");
    },
    importTikTokVideos: async () => {
      throw new Error("must not be called");
    },
    refreshStoredPostMetrics: async () => {
      throw new Error("must not be called");
    },
  };
}

function queueDefaultWebhookPurge(db: ReturnType<typeof createSupabaseQueryMock>) {
  db.queue("tiktok_webhook_events", "delete", { data: null });
}

// ── (a) auth gate rejects before any DB access ──────────────────────────────────

Deno.test("tiktok-sync-cron: missing x-cron-secret returns 401 before any DB access", async () => {
  const db = createSupabaseQueryMock();
  const handler = createTikTokSyncCronHandler({
    cronSecret: "segredo-cron",
    timingSafeEqual,
    run: async () => runTikTokSyncCron(baseDeps(db)),
  });

  const response = await handler(new Request("https://example.test/tiktok-sync-cron"));
  assertEquals(response.status, 401);
  assertEquals(db.calls.length, 0, "no query should run before the secret check");
});

Deno.test("tiktok-sync-cron: wrong x-cron-secret returns 401 before any DB access", async () => {
  const db = createSupabaseQueryMock();
  const handler = createTikTokSyncCronHandler({
    cronSecret: "segredo-cron",
    timingSafeEqual,
    run: async () => runTikTokSyncCron(baseDeps(db)),
  });

  const response = await handler(
    new Request("https://example.test/tiktok-sync-cron", { headers: { "x-cron-secret": "errado" } }),
  );
  assertEquals(response.status, 401);
  assertEquals(db.calls.length, 0, "no query should run before the secret check");
});

// ── (b) account selection filters ───────────────────────────────────────────────

Deno.test("tiktok-sync-cron: selects active + auto_sync_enabled accounts not synced in the last 6h", async () => {
  const db = createSupabaseQueryMock();
  db.queue("tiktok_accounts", "select", { data: [] });
  queueDefaultWebhookPurge(db);

  const response = await runTikTokSyncCron(baseDeps(db));
  assertEquals(response.status, 200);

  const selectCall = db.calls.find((c) => c.table === "tiktok_accounts" && c.operation === "select");
  assert(selectCall, "expected a select against tiktok_accounts");
  const eqModifiers = selectCall!.modifiers.filter((m) => m.method === "eq");
  assert(
    eqModifiers.some((m) => m.args[0] === "authorization_status" && m.args[1] === "active"),
    "must filter authorization_status='active'",
  );
  assert(
    eqModifiers.some((m) => m.args[0] === "auto_sync_enabled" && m.args[1] === true),
    "must filter auto_sync_enabled=true",
  );
  const orModifiers = selectCall!.modifiers.filter((m) => m.method === "or");
  assert(
    orModifiers.some((m) => String(m.args[0]).includes("last_synced_at")),
    "must filter on last_synced_at (null or older than the sync window)",
  );
});

// ── (c) workspace feature gate ──────────────────────────────────────────────────

Deno.test("tiktok-sync-cron: account in a workspace without feature_auto_sync_cron is skipped entirely", async () => {
  const db = createSupabaseQueryMock();
  db.queue("tiktok_accounts", "select", {
    data: [
      {
        id: "acct-1",
        client_id: 101,
        follower_count: 10,
        following_count: 1,
        likes_count: 100,
        video_count: 5,
        clientes: { conta_id: "ws-no-feature" },
      },
    ],
  });
  queueDefaultWebhookPurge(db);

  const deps = baseDeps(db);
  deps.effectivePlanFeature = async () => false;

  const response = await runTikTokSyncCron(deps);
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.synced, 0);
  assertEquals(body.failed, 0);
  // getFreshTikTokToken/tiktokFetch are the "must not be called" traps in baseDeps — reaching
  // them would already throw. This assertion double-checks no account write happened either.
  const updateCalls = db.calls.filter((c) => c.table === "tiktok_accounts" && c.operation === "update");
  assertEquals(updateCalls.length, 0);
});

// ── (d) happy path: profile stats, snapshot, follower history, envelope nesting ─

function happyPathDeps(
  db: ReturnType<typeof createSupabaseQueryMock>,
  overrides: Partial<TikTokSyncCronDeps> = {},
): TikTokSyncCronDeps {
  const importCalls: unknown[][] = [];
  const refreshCalls: unknown[][] = [];
  return {
    svc: db as never,
    getFreshTikTokToken: async () => ({ accessToken: "fresh-token", openId: "open-1" }),
    reportCronFailure: fakeReportCronFailure().fn,
    effectivePlanFeature: async () => true,
    // Realistic TikTok envelope: tiktokFetch already unwraps the outer `{data: ...}` envelope,
    // but the profile fields are still nested ONE level deeper under `user` — the A6 bug was
    // reading fields off the top-level result directly instead of `.user`.
    tiktokFetch: async () => ({
      user: { follower_count: 500, following_count: 20, likes_count: 9000, video_count: 42 },
    }),
    // deno-lint-ignore no-explicit-any
    importTikTokVideos: async (...args: any[]) => {
      importCalls.push(args);
      return 3;
    },
    // deno-lint-ignore no-explicit-any
    refreshStoredPostMetrics: async (...args: any[]) => {
      refreshCalls.push(args);
      return 3;
    },
    ...overrides,
  };
}

Deno.test("tiktok-sync-cron: profile stats are read through the `user` envelope and written to tiktok_accounts", async () => {
  const db = createSupabaseQueryMock();
  db.queue("tiktok_accounts", "select", {
    data: [
      {
        id: "acct-1",
        client_id: 101,
        follower_count: 1,
        following_count: 1,
        likes_count: 1,
        video_count: 1,
        clientes: { conta_id: "ws-1" },
      },
    ],
  });
  db.queue("tiktok_follower_history", "select", { data: null });
  db.queue("tiktok_accounts", "update", { data: null });
  db.queue("tiktok_follower_history", "upsert", { data: null });
  db.queue("tiktok_account_metrics_daily", "upsert", { data: null });
  queueDefaultWebhookPurge(db);

  const response = await runTikTokSyncCron(happyPathDeps(db));
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.synced, 1);
  assertEquals(body.failed, 0);

  const updateCall = db.calls.find((c) => c.table === "tiktok_accounts" && c.operation === "update");
  assert(updateCall, "expected an update against tiktok_accounts");
  const payload = updateCall!.payload as Record<string, unknown>;
  assertEquals(payload.follower_count, 500);
  assertEquals(payload.following_count, 20);
  assertEquals(payload.likes_count, 9000);
  assertEquals(payload.video_count, 42);
  assert(typeof payload.last_synced_at === "string", "last_synced_at must be updated");
});

Deno.test("tiktok-sync-cron: writes the daily snapshot row exactly once with the fresh profile fields", async () => {
  const db = createSupabaseQueryMock();
  db.queue("tiktok_accounts", "select", {
    data: [
      {
        id: "acct-1",
        client_id: 101,
        follower_count: 1,
        following_count: 1,
        likes_count: 1,
        video_count: 1,
        clientes: { conta_id: "ws-1" },
      },
    ],
  });
  db.queue("tiktok_follower_history", "select", { data: null });
  db.queue("tiktok_accounts", "update", { data: null });
  db.queue("tiktok_follower_history", "upsert", { data: null });
  db.queue("tiktok_account_metrics_daily", "upsert", { data: null });
  queueDefaultWebhookPurge(db);

  const response = await runTikTokSyncCron(happyPathDeps(db));
  assertEquals(response.status, 200);

  const snapshotCalls = db.calls.filter(
    (c) => c.table === "tiktok_account_metrics_daily" && c.operation === "upsert",
  );
  assertEquals(snapshotCalls.length, 1, "snapshot must be written exactly once per account per run");
  const payload = snapshotCalls[0].payload as Record<string, unknown>;
  assertEquals(payload.tiktok_account_id, "acct-1");
  assertEquals(payload.follower_count, 500);
  assertEquals(payload.following_count, 20);
  assertEquals(payload.likes_count, 9000);
  assertEquals(payload.video_count, 42);
  assert(typeof payload.snapshot_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(payload.snapshot_date as string));
  assertEquals(
    (snapshotCalls[0].options as { onConflict?: string })?.onConflict,
    "tiktok_account_id,snapshot_date",
  );
});

// ── (e) follower history: manual row protected, api row absent triggers insert ──

Deno.test("tiktok-sync-cron: an existing manual follower_history row for today is NOT overwritten", async () => {
  const db = createSupabaseQueryMock();
  db.queue("tiktok_accounts", "select", {
    data: [
      {
        id: "acct-1",
        client_id: 101,
        follower_count: 1,
        following_count: 1,
        likes_count: 1,
        video_count: 1,
        clientes: { conta_id: "ws-1" },
      },
    ],
  });
  db.queue("tiktok_follower_history", "select", { data: { source: "manual" } });
  db.queue("tiktok_accounts", "update", { data: null });
  db.queue("tiktok_account_metrics_daily", "upsert", { data: null });
  queueDefaultWebhookPurge(db);

  const response = await runTikTokSyncCron(happyPathDeps(db));
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.failed, 0);

  const historyUpsertCalls = db.calls.filter(
    (c) => c.table === "tiktok_follower_history" && c.operation === "upsert",
  );
  assertEquals(historyUpsertCalls.length, 0, "a manual row must never be overwritten by the cron");
});

Deno.test("tiktok-sync-cron: no follower_history row for today (api or absent) triggers an api-sourced insert", async () => {
  const db = createSupabaseQueryMock();
  db.queue("tiktok_accounts", "select", {
    data: [
      {
        id: "acct-1",
        client_id: 101,
        follower_count: 1,
        following_count: 1,
        likes_count: 1,
        video_count: 1,
        clientes: { conta_id: "ws-1" },
      },
    ],
  });
  db.queue("tiktok_follower_history", "select", { data: null });
  db.queue("tiktok_accounts", "update", { data: null });
  db.queue("tiktok_follower_history", "upsert", { data: null });
  db.queue("tiktok_account_metrics_daily", "upsert", { data: null });
  queueDefaultWebhookPurge(db);

  const response = await runTikTokSyncCron(happyPathDeps(db));
  assertEquals(response.status, 200);

  const historyUpsertCalls = db.calls.filter(
    (c) => c.table === "tiktok_follower_history" && c.operation === "upsert",
  );
  assertEquals(historyUpsertCalls.length, 1);
  const payload = historyUpsertCalls[0].payload as Record<string, unknown>;
  assertEquals(payload.tiktok_account_id, "acct-1");
  assertEquals(payload.source, "api");
  assertEquals(payload.follower_count, 500);
  assertEquals(
    (historyUpsertCalls[0].options as { onConflict?: string })?.onConflict,
    "tiktok_account_id,date",
  );
});

// ── (f) per-account isolation + TOKEN_EXPIRED (helper already marked the account) ─

Deno.test("tiktok-sync-cron: one account's TOKEN_EXPIRED does not crash the batch and the cron does not duplicate the status write", async () => {
  const db = createSupabaseQueryMock();
  db.queue("tiktok_accounts", "select", {
    data: [
      {
        id: "acct-expired",
        client_id: 101,
        follower_count: 1,
        following_count: 1,
        likes_count: 1,
        video_count: 1,
        clientes: { conta_id: "ws-1" },
      },
      {
        id: "acct-ok",
        client_id: 102,
        follower_count: 1,
        following_count: 1,
        likes_count: 1,
        video_count: 1,
        clientes: { conta_id: "ws-1" },
      },
    ],
  });
  db.queue("tiktok_follower_history", "select", { data: null });
  db.queue("tiktok_accounts", "update", { data: null });
  db.queue("tiktok_follower_history", "upsert", { data: null });
  db.queue("tiktok_account_metrics_daily", "upsert", { data: null });
  queueDefaultWebhookPurge(db);

  const processedAccountIds: string[] = [];
  const { fn: reportCronFailure, calls: failureCalls } = fakeReportCronFailure();

  const deps = happyPathDeps(db, {
    reportCronFailure,
    getFreshTikTokToken: async (_svc, accountId: string) => {
      processedAccountIds.push(accountId);
      if (accountId === "acct-expired") {
        // Mirrors _shared/tiktok.ts: the helper itself already flipped authorization_status to
        // 'expired' before throwing — the cron must not duplicate that write.
        throw new TikTokApiError("refresh token expired", "TOKEN_EXPIRED", false);
      }
      return { accessToken: "fresh-token", openId: "open-2" };
    },
  });

  const response = await runTikTokSyncCron(deps);
  const body = await response.json();

  assertEquals(response.status, 200, "one account failing must not crash the whole cron run");
  assertEquals(body.synced, 1);
  assertEquals(body.failed, 1);
  assertEquals(processedAccountIds.sort(), ["acct-expired", "acct-ok"]);

  const updateCalls = db.calls.filter((c) => c.table === "tiktok_accounts" && c.operation === "update");
  assertEquals(updateCalls.length, 1, "only the successful account should have been written");
  assertEquals((updateCalls[0] as { modifiers: Array<{ method: string; args: unknown[] }> }).modifiers
    .find((m) => m.method === "eq")?.args[1], "acct-ok");

  assertEquals(failureCalls.length, 1);
  assert(
    failureCalls[0].detail.errors?.some((e: { accountId?: string }) => e.accountId === "acct-expired"),
    "failure detail should reference the failed account",
  );
});

// ── (g) outer failure path ──────────────────────────────────────────────────────

Deno.test("tiktok-sync-cron: a broken account query is reported via reportCronFailure and returns 500", async () => {
  const db = createSupabaseQueryMock();
  db.queue("tiktok_accounts", "select", { data: null, error: { message: "connection reset" } });
  const { fn: reportCronFailure, calls: failureCalls } = fakeReportCronFailure();

  const deps = baseDeps(db);
  deps.reportCronFailure = reportCronFailure;

  const response = await runTikTokSyncCron(deps);
  assertEquals(response.status, 500);
  assertEquals(failureCalls.length, 1, "outer catch must still be wired to reportCronFailure");
  assertEquals(failureCalls[0].cronName, "tiktok-sync-cron");
});

// ── (h) webhook-event purge ──────────────────────────────────────────────────────

Deno.test("tiktok-sync-cron: purges only processed tiktok_webhook_events older than 30 days", async () => {
  const db = createSupabaseQueryMock();
  db.queue("tiktok_accounts", "select", { data: [] });
  db.queue("tiktok_webhook_events", "delete", { data: null });

  const response = await runTikTokSyncCron(baseDeps(db));
  assertEquals(response.status, 200);

  const purgeCall = db.calls.find((c) => c.table === "tiktok_webhook_events" && c.operation === "delete");
  assert(purgeCall, "expected a delete against tiktok_webhook_events");

  const ltModifiers = purgeCall!.modifiers.filter((m) => m.method === "lt");
  assert(
    ltModifiers.some((m) => m.args[0] === "received_at"),
    "must filter received_at < 30 days ago",
  );
  const notModifiers = purgeCall!.modifiers.filter((m) => m.method === "not");
  assert(
    notModifiers.some((m) => m.args[0] === "processed_at" && m.args[1] === "is" && m.args[2] === null),
    "must only purge PROCESSED rows (processed_at IS NOT NULL) — unprocessed rows are evidence of trouble",
  );
});

Deno.test("tiktok-sync-cron: purge runs even when there are zero accounts to sync", async () => {
  const db = createSupabaseQueryMock();
  db.queue("tiktok_accounts", "select", { data: [] });
  db.queue("tiktok_webhook_events", "delete", { data: null });

  const response = await runTikTokSyncCron(baseDeps(db));
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.synced, 0);
  assertEquals(body.failed, 0);

  const purgeCall = db.calls.find((c) => c.table === "tiktok_webhook_events" && c.operation === "delete");
  assert(purgeCall, "purge must run regardless of account-selection outcome");
});
