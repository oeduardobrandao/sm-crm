// youtube-sync-cron (Phase 2 Task 7): handler auth gate, candidate paging + flag gate + batch
// stamp, per-connection revoke short-circuit, outcome accounting and the PDF purge drain. The DB
// is the shared query mock; the YouTube API, the token path, the flag lookup, the internal
// workspace lookup, the drain and reportCronFailure are injected fakes. Unused fakes throw
// "must not be called". Cron tests run with concurrency 1 so mock queues are consumed in order.
import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { GoogleApiError } from "../_shared/google.ts";
import type { YoutubeApi, YoutubeChannelRow } from "../_shared/youtube-sync.ts";
import type { YtChannel } from "../_shared/youtube-api.ts";
import { createYouTubeSyncCronHandler } from "../youtube-sync-cron/handler.ts";
import { runYouTubeSyncCron, type YouTubeSyncCronDeps } from "../youtube-sync-cron/core.ts";

type Db = ReturnType<typeof createSupabaseQueryMock>;

const NOW = new Date("2026-10-30T12:00:00Z");
const timingSafeEqual = (a: string, b: string) => a === b;

function trap(name: string) {
  return () => {
    throw new Error(`${name} must not be called`);
  };
}

function row(id: string, overrides: Partial<YoutubeChannelRow> = {}): YoutubeChannelRow {
  return {
    id,
    conta_id: "conta-a",
    client_id: 10,
    connection_id: "conn-1",
    channel_id: `UC-${id}`,
    title: "Canal",
    handle: "@canal",
    avatar_url: null,
    uploads_playlist_id: null,
    subscriber_count: 1,
    view_count: 1,
    video_count: 1,
    authorization_status: "active",
    last_synced_at: null,
    last_sync_attempt_at: null,
    data_through: "2026-10-28",
    content_type_through: "2026-10-28",
    traffic_through: "2026-10-28",
    videos_through: "2026-10-28",
    ...overrides,
  };
}

function ytChannel(id: string): YtChannel {
  return {
    id,
    title: "Canal",
    handle: "@canal",
    avatarUrl: null,
    uploadsPlaylistId: null,
    subscriberCount: 1,
    viewCount: 1,
    videoCount: 1,
  };
}

/** Records call order into `order`; getMyChannel answers with the channel id the token "owns". */
function fakeApi(order: string[], overrides: Partial<Record<keyof YoutubeApi, unknown>> = {}): YoutubeApi {
  const base: Record<string, unknown> = {
    getMyChannel: trap("getMyChannel"),
    listUploads: trap("listUploads"),
    getVideos: async () => [],
    channelDaily: async () => [],
    trafficDaily: async () => [],
    demographics: async () => [],
    videoDaily: async () => [],
    videoContentTypes: async () => new Map(),
    ...overrides,
  };
  const api: Record<string, unknown> = {};
  for (const [name, fn] of Object.entries(base)) {
    api[name] = (...args: unknown[]) => {
      order.push(`api:${name}`);
      return (fn as (...a: unknown[]) => unknown)(...args);
    };
  }
  return api as unknown as YoutubeApi;
}

function queueGuardPass(db: Db, n = 300) {
  for (let i = 0; i < n; i++) db.queue("youtube_channels", "update", { data: [{ id: "x" }] });
}

function fakeReport() {
  // deno-lint-ignore no-explicit-any
  const calls: Array<{ cronName: string; detail: any }> = [];
  return {
    // deno-lint-ignore no-explicit-any
    fn: async (_svc: unknown, cronName: string, detail: any) => {
      calls.push({ cronName, detail });
    },
    calls,
  };
}

interface Harness {
  deps: YouTubeSyncCronDeps;
  report: ReturnType<typeof fakeReport>;
  order: string[];
  tokenCalls: string[];
  drainCalls: unknown[];
}

function harness(db: Db, opts: {
  api?: Partial<Record<keyof YoutubeApi, unknown>>;
  token?: (connectionId: string) => Promise<string>;
  flags?: (ws: string, key: string) => boolean;
  internal?: string[];
  batchLimit?: number;
} = {}): Harness {
  const order: string[] = [];
  const tokenCalls: string[] = [];
  const drainCalls: unknown[] = [];
  const report = fakeReport();
  const deps: YouTubeSyncCronDeps = {
    svc: db as never,
    api: fakeApi(order, opts.api),
    getFreshGoogleToken: async (_svc, connectionId) => {
      tokenCalls.push(connectionId);
      order.push(`token:${connectionId}`);
      if (!opts.token) throw new Error("getFreshGoogleToken must not be called");
      return opts.token(connectionId);
    },
    reportCronFailure: report.fn,
    effectivePlanFeature: async (_svc, ws, key) => {
      if (!opts.flags) throw new Error("effectivePlanFeature must not be called");
      return opts.flags(ws, key);
    },
    fetchInternalWorkspaceIds: async () => new Set(opts.internal ?? []),
    drainYoutubePdfPurges: async (_svc, o) => {
      drainCalls.push(o);
      return { removed: 0, failed: 0, gaveUp: 0 };
    },
    storage: { from: () => ({ remove: async () => ({ error: null }) }) },
    now: () => NOW,
    concurrency: 1,
    batchLimit: opts.batchLimit,
  };
  return { deps, report, order, tokenCalls, drainCalls };
}

const allFlags = () => true;

// ── handler ─────────────────────────────────────────────────────────────────────

Deno.test("youtube-sync-cron: missing x-cron-secret returns 401 with zero DB calls", async () => {
  const db = createSupabaseQueryMock();
  const h = harness(db);
  const handler = createYouTubeSyncCronHandler({ cronSecret: "s", timingSafeEqual, run: () => runYouTubeSyncCron(h.deps) });
  const res = await handler(new Request("https://x.test/youtube-sync-cron"));
  assertEquals(res.status, 401);
  assertEquals(db.calls.length, 0);
});

Deno.test("youtube-sync-cron: wrong x-cron-secret returns 401 with zero DB calls", async () => {
  const db = createSupabaseQueryMock();
  const h = harness(db);
  const handler = createYouTubeSyncCronHandler({ cronSecret: "s", timingSafeEqual, run: () => runYouTubeSyncCron(h.deps) });
  const res = await handler(new Request("https://x.test/youtube-sync-cron", { headers: { "x-cron-secret": "nope" } }));
  assertEquals(res.status, 401);
  assertEquals(db.calls.length, 0);
});

// ── candidates ──────────────────────────────────────────────────────────────────

Deno.test("youtube-sync-cron: candidate query filters active + (stale, never synced, or data_through null), ordered by attempt then id", async () => {
  const db = createSupabaseQueryMock();
  db.queue("youtube_channels", "select", { data: [] });
  const h = harness(db);
  const res = await runYouTubeSyncCron(h.deps);
  assertEquals(res.status, 200);
  const sel = db.calls.find((c) => c.table === "youtube_channels" && c.operation === "select")!;
  assert(sel.modifiers.some((m) => m.method === "eq" && m.args[0] === "authorization_status" && m.args[1] === "active"));
  const or = String(sel.modifiers.find((m) => m.method === "or")!.args[0]);
  const cutoff = new Date(NOW.getTime() - 20 * 3600 * 1000).toISOString();
  assertEquals(or, `last_synced_at.is.null,last_synced_at.lt.${cutoff},data_through.is.null`);
  const orders = sel.modifiers.filter((m) => m.method === "order").map((m) => m.args);
  assertEquals(orders, [["last_sync_attempt_at", { ascending: true, nullsFirst: true }], ["id", { ascending: true }]]);
  assert(sel.modifiers.some((m) => m.method === "range" && m.args[0] === 0 && m.args[1] === 199));
  assertEquals(h.drainCalls.length, 1, "the PDF drain runs even with nothing to sync");
});

Deno.test("youtube-sync-cron: a reconnected channel (recent last_synced_at, data_through null) is a candidate and backfills", async () => {
  const db = createSupabaseQueryMock();
  db.queue("youtube_channels", "select", {
    data: [row("a", { last_synced_at: "2026-10-30T10:00:00Z", data_through: null, content_type_through: null })],
  });
  queueGuardPass(db);
  const ranges: { start: string }[] = [];
  const h = harness(db, {
    flags: allFlags,
    token: async () => "tok",
    api: {
      getMyChannel: async () => ytChannel("UC-a"),
      channelDaily: async (_t: string, r: { start: string }) => {
        ranges.push(r);
        return [];
      },
    },
  });
  const body = await (await runYouTubeSyncCron(h.deps)).json();
  assertEquals(body.synced, 1);
  assertEquals(ranges[0].start, "2025-10-30");
});

// ── flags ───────────────────────────────────────────────────────────────────────

Deno.test("youtube-sync-cron: a workspace without feature_auto_sync_cron is skipped, one flag lookup set per workspace", async () => {
  const db = createSupabaseQueryMock();
  db.queue("youtube_channels", "select", {
    data: [row("a", { conta_id: "ws-off" }), row("b", { conta_id: "ws-off", connection_id: "conn-2" })],
  });
  const lookups: string[] = [];
  const h = harness(db, {
    flags: (ws, key) => {
      lookups.push(`${ws}:${key}`);
      return key !== "feature_auto_sync_cron";
    },
  });
  const body = await (await runYouTubeSyncCron(h.deps)).json();
  assertEquals(body.synced, 0);
  assertEquals(h.tokenCalls.length, 0);
  assertEquals(lookups.sort(), ["ws-off:feature_auto_sync_cron", "ws-off:feature_youtube"]);
});

Deno.test("youtube-sync-cron: a workspace without feature_youtube is skipped", async () => {
  const db = createSupabaseQueryMock();
  db.queue("youtube_channels", "select", { data: [row("a")] });
  const h = harness(db, { flags: (_ws, key) => key !== "feature_youtube" });
  const body = await (await runYouTubeSyncCron(h.deps)).json();
  assertEquals(body.synced, 0);
  assertEquals(h.tokenCalls.length, 0);
});

Deno.test("youtube-sync-cron: an internal workspace is skipped without a flag lookup", async () => {
  const db = createSupabaseQueryMock();
  db.queue("youtube_channels", "select", { data: [row("a", { conta_id: "ws-internal" })] });
  const h = harness(db, { internal: ["ws-internal"] });
  const body = await (await runYouTubeSyncCron(h.deps)).json();
  assertEquals(body.synced, 0);
  assertEquals(h.tokenCalls.length, 0);
});

// ── stamp + starvation ──────────────────────────────────────────────────────────

Deno.test("youtube-sync-cron: the batch stamp precedes every token and API call", async () => {
  const db = createSupabaseQueryMock();
  db.queue("youtube_channels", "select", { data: [row("a")] });
  queueGuardPass(db);
  const h = harness(db, { flags: allFlags, token: async () => "tok", api: { getMyChannel: async () => ytChannel("UC-a") } });
  // Mirror DB calls into the same timeline as token/API calls.
  const origFrom = db.from.bind(db);
  (db as unknown as { from: (t: string) => unknown }).from = (t: string) => {
    const builder = origFrom(t) as unknown as Record<string, (...a: unknown[]) => unknown>;
    const origUpdate = builder.update.bind(builder);
    builder.update = (payload: unknown) => {
      if (t === "youtube_channels" && payload && typeof payload === "object" && "last_sync_attempt_at" in payload) {
        h.order.push("stamp");
      }
      return origUpdate(payload);
    };
    return builder;
  };
  await runYouTubeSyncCron(h.deps);
  const stampAt = h.order.indexOf("stamp");
  assert(stampAt >= 0, "expected a stamp");
  assert(h.order.length > 1);
  assertEquals(stampAt, 0, `stamp must come first, got ${JSON.stringify(h.order)}`);
  const stamp = db.calls.find((c) => c.table === "youtube_channels" && c.operation === "update" &&
    "last_sync_attempt_at" in (c.payload as object))!;
  assertEquals((stamp.payload as { last_sync_attempt_at: string }).last_sync_attempt_at, NOW.toISOString());
});

Deno.test("youtube-sync-cron: starvation (I1): 26 ineligible ahead of one eligible -> it syncs, all 27 stamped", async () => {
  const db = createSupabaseQueryMock();
  const ineligible = Array.from({ length: 26 }, (_, i) => row(`off${i}`, { conta_id: "ws-off", connection_id: `c-off${i}` }));
  const eligible = row("on", { conta_id: "ws-on", connection_id: "c-on" });
  db.queue("youtube_channels", "select", { data: [...ineligible, eligible] });
  queueGuardPass(db);
  const h = harness(db, {
    flags: (ws) => ws === "ws-on",
    token: async () => "tok",
    api: { getMyChannel: async () => ytChannel("UC-on") },
    batchLimit: 25,
  });
  const body = await (await runYouTubeSyncCron(h.deps)).json();
  assertEquals(body.synced, 1);
  assertEquals(h.tokenCalls, ["c-on"]);
  const stamped = db.calls
    .filter((c) => c.table === "youtube_channels" && c.operation === "update" && "last_sync_attempt_at" in (c.payload as object))
    .flatMap((c) => (c.modifiers.find((m) => m.method === "in")!.args[1] as string[]));
  assertEquals(stamped.length, 27);
  assert(stamped.includes("on"));
});

Deno.test("youtube-sync-cron: pages until the batch fills (second page reached when the first is all ineligible)", async () => {
  const db = createSupabaseQueryMock();
  const page1 = Array.from({ length: 200 }, (_, i) => row(`off${i}`, { conta_id: "ws-off" }));
  db.queue("youtube_channels", "select", { data: page1 }, { data: [row("on", { conta_id: "ws-on", connection_id: "c-on" })] });
  queueGuardPass(db);
  const h = harness(db, {
    flags: (ws) => ws === "ws-on",
    token: async () => "tok",
    api: { getMyChannel: async () => ytChannel("UC-on") },
  });
  const body = await (await runYouTubeSyncCron(h.deps)).json();
  assertEquals(body.synced, 1);
  const ranges = db.calls.filter((c) => c.table === "youtube_channels" && c.operation === "select")
    .map((c) => c.modifiers.find((m) => m.method === "range")!.args);
  assertEquals(ranges, [[0, 199], [200, 399]]);
});

Deno.test("youtube-sync-cron: a failed stamp is logged, the run continues", async () => {
  const db = createSupabaseQueryMock();
  db.queue("youtube_channels", "select", { data: [row("a")] });
  db.queue("youtube_channels", "update", { data: null, error: { message: "stamp boom" } });
  queueGuardPass(db);
  const h = harness(db, { flags: allFlags, token: async () => "tok", api: { getMyChannel: async () => ytChannel("UC-a") } });
  const body = await (await runYouTubeSyncCron(h.deps)).json();
  assertEquals(body.synced, 1);
});

// ── outcomes ────────────────────────────────────────────────────────────────────

Deno.test("youtube-sync-cron: REVOKED on channel 1 skips channel 2 on the same connection without a token call (Review Focus 2)", async () => {
  const db = createSupabaseQueryMock();
  db.queue("youtube_channels", "select", { data: [row("a"), row("b"), row("c", { connection_id: "conn-2" })] });
  queueGuardPass(db);
  const h = harness(db, {
    flags: allFlags,
    token: async (conn) => {
      if (conn === "conn-1") throw new GoogleApiError("REVOKED", 400, "invalid_grant", false);
      return "tok";
    },
    api: { getMyChannel: async () => ytChannel("UC-c") },
  });
  const body = await (await runYouTubeSyncCron(h.deps)).json();
  assertEquals(h.tokenCalls, ["conn-1", "conn-2"]);
  assertEquals(body, { success: true, synced: 1, revoked: 1, quotaSkipped: 0, skipped: 1, failed: 0, total: 3 });
  assertEquals(h.report.calls.length, 0);
});

Deno.test("youtube-sync-cron: QUOTA_EXCEEDED on getMyChannel -> quota_skipped, no failure report, no status write (Review Focus 1)", async () => {
  const db = createSupabaseQueryMock();
  db.queue("youtube_channels", "select", { data: [row("a"), row("b", { connection_id: "conn-2" })] });
  queueGuardPass(db);
  const h = harness(db, {
    flags: allFlags,
    token: async () => "tok",
    api: {
      getMyChannel: async () => {
        throw new GoogleApiError("QUOTA_EXCEEDED", 403, "quotaExceeded");
      },
    },
  });
  const body = await (await runYouTubeSyncCron(h.deps)).json();
  assertEquals(body.quotaSkipped, 2, "quota on one unit never aborts the others");
  assertEquals(body.failed, 0);
  assertEquals(h.report.calls.length, 0);
  for (const c of db.calls.filter((c) => c.table === "youtube_channels" && c.operation === "update")) {
    const p = c.payload as Record<string, unknown>;
    assert(!("authorization_status" in p) && !("last_synced_at" in p));
  }
});

Deno.test("youtube-sync-cron: TOKEN_INVALID -> skipped, no reportCronFailure (I2)", async () => {
  const db = createSupabaseQueryMock();
  db.queue("youtube_channels", "select", { data: [row("a")] });
  queueGuardPass(db);
  const h = harness(db, {
    flags: allFlags,
    token: async () => {
      throw new GoogleApiError("TOKEN_INVALID", 401, "no refresh token", false);
    },
  });
  const body = await (await runYouTubeSyncCron(h.deps)).json();
  assertEquals(body.skipped, 1);
  assertEquals(body.failed, 0);
  assertEquals(h.report.calls.length, 0);
});

Deno.test("youtube-sync-cron: a channel-id mismatch on channel 1 does not skip channel 2 on the same connection", async () => {
  const db = createSupabaseQueryMock();
  db.queue("youtube_channels", "select", { data: [row("a"), row("b")] });
  queueGuardPass(db);
  const h = harness(db, { flags: allFlags, token: async () => "tok", api: { getMyChannel: async () => ytChannel("UC-b") } });
  const body = await (await runYouTubeSyncCron(h.deps)).json();
  assertEquals(h.tokenCalls, ["conn-1", "conn-1"]);
  assertEquals(body.skipped, 1, "mismatch counts as skipped");
  assertEquals(body.synced, 1);
  assertEquals(h.report.calls.length, 0);
});

Deno.test("youtube-sync-cron: an unexpected error is failed, reported once, and does not stop the batch", async () => {
  const db = createSupabaseQueryMock();
  db.queue("youtube_channels", "select", { data: [row("a"), row("b", { connection_id: "conn-2" })] });
  queueGuardPass(db);
  const h = harness(db, {
    flags: allFlags,
    token: async () => "tok",
    api: {
      getMyChannel: async () => ytChannel("UC-b"),
      channelDaily: async () => {
        throw new GoogleApiError("UPSTREAM", 500, "boom");
      },
    },
  });
  const body = await (await runYouTubeSyncCron(h.deps)).json();
  // a: mismatch (skipped); b: analytics 500 (failed).
  assertEquals(body.failed, 1);
  assertEquals(body.skipped, 1);
  assertEquals(h.report.calls.length, 1);
  assertEquals(h.report.calls[0].cronName, "youtube-sync-cron");
  assertEquals(h.report.calls[0].detail.failed, 1);
});

Deno.test("youtube-sync-cron: drains PDF purges with limit 50; failed + gaveUp are reported", async () => {
  const db = createSupabaseQueryMock();
  db.queue("youtube_channels", "select", { data: [] });
  const h = harness(db);
  h.deps.drainYoutubePdfPurges = async (_svc, o) => {
    h.drainCalls.push(o);
    return { removed: 1, failed: 1, gaveUp: 1 };
  };
  const body = await (await runYouTubeSyncCron(h.deps)).json();
  assertEquals((h.drainCalls[0] as { limit: number; maxAttempts: number }).limit, 50);
  assertEquals((h.drainCalls[0] as { limit: number; maxAttempts: number }).maxAttempts, 10);
  assertEquals(body.failed, 2);
  assertEquals(h.report.calls.length, 1);
});

Deno.test("youtube-sync-cron: a broken candidate query returns 500 and reports", async () => {
  const db = createSupabaseQueryMock();
  db.queue("youtube_channels", "select", { data: null, error: { message: "db down" } });
  const h = harness(db);
  const res = await runYouTubeSyncCron(h.deps);
  assertEquals(res.status, 500);
  assertEquals(await res.json(), { error: "Internal server error" });
  assertEquals(h.report.calls.length, 1);
});
