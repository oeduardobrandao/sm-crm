// tiktok-refresh-cron (Task A6) — mirrors the sibling cron test convention (handler.ts's
// timingSafeEqual auth gate tested in isolation, retention-radar-cron_test.ts) plus DI'd
// business-logic tests via the shared supabaseMock (tiktok-token-refresh_test.ts's convention).
// getFreshTikTokToken and reportCronFailure are injected so this suite never touches the real
// _shared/tiktok.ts refresh flow or _shared/triage.ts network calls — both are already covered
// by their own test files.
import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createTikTokRefreshCronHandler } from "../tiktok-refresh-cron/handler.ts";
import { runTikTokRefreshCron } from "../tiktok-refresh-cron/core.ts";
import { TikTokApiError } from "../_shared/tiktok.ts";

const timingSafeEqual = (a: string, b: string) => a === b;

function isoInHours(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function isoInDays(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

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

// ── (a) auth gate rejects before any DB access ──────────────────────────────────

Deno.test("tiktok-refresh-cron: missing x-cron-secret returns 401 before any DB access", async () => {
  const db = createSupabaseQueryMock();
  const { fn: reportCronFailure } = fakeReportCronFailure();
  const handler = createTikTokRefreshCronHandler({
    cronSecret: "segredo-cron",
    timingSafeEqual,
    run: async () =>
      runTikTokRefreshCron({
        svc: db as never,
        getFreshTikTokToken: async () => {
          throw new Error("must not be called");
        },
        reportCronFailure,
      }),
  });

  const response = await handler(new Request("https://example.test/tiktok-refresh-cron"));
  assertEquals(response.status, 401);
  assertEquals(db.calls.length, 0, "no query should run before the secret check");
});

Deno.test("tiktok-refresh-cron: wrong x-cron-secret returns 401 before any DB access", async () => {
  const db = createSupabaseQueryMock();
  const { fn: reportCronFailure } = fakeReportCronFailure();
  const handler = createTikTokRefreshCronHandler({
    cronSecret: "segredo-cron",
    timingSafeEqual,
    run: async () =>
      runTikTokRefreshCron({
        svc: db as never,
        getFreshTikTokToken: async () => {
          throw new Error("must not be called");
        },
        reportCronFailure,
      }),
  });

  const response = await handler(
    new Request("https://example.test/tiktok-refresh-cron", {
      headers: { "x-cron-secret": "errado" },
    }),
  );
  assertEquals(response.status, 401);
  assertEquals(db.calls.length, 0, "no query should run before the secret check");
});

// ── (b) expiring account triggers refresh via the shared helper ────────────────

Deno.test("tiktok-refresh-cron: expiring account is refreshed via getFreshTikTokToken", async () => {
  const db = createSupabaseQueryMock();
  db.queue("tiktok_accounts", "select", {
    data: [
      {
        id: "acct-1",
        client_id: 101,
        avatar_url: null,
        access_token_expires_at: isoInHours(2), // < 12h
        refresh_token_expires_at: isoInDays(200), // well outside 30d warning window
      },
    ],
  });

  const refreshedAccountIds: string[] = [];
  const { fn: reportCronFailure, calls: failureCalls } = fakeReportCronFailure();

  const response = await runTikTokRefreshCron({
    svc: db as never,
    // deno-lint-ignore no-explicit-any
    getFreshTikTokToken: async (_svc: any, accountId: string) => {
      refreshedAccountIds.push(accountId);
      return { accessToken: "fresh-token", openId: "open-1" };
    },
    reportCronFailure,
  });

  assertEquals(response.status, 200);
  assertEquals(refreshedAccountIds, ["acct-1"]);
  assertEquals(failureCalls.length, 0, "no failures expected");

  // Selection criteria: authorization_status='active' AND access_token_expires_at <= now()+12h.
  const selectCall = db.calls.find((c) => c.table === "tiktok_accounts" && c.operation === "select");
  assert(selectCall, "expected a select against tiktok_accounts");
  const eqModifiers = selectCall!.modifiers.filter((m) => m.method === "eq");
  assert(
    eqModifiers.some((m) => m.args[0] === "authorization_status" && m.args[1] === "active"),
    "must filter authorization_status='active'",
  );
  const lteModifiers = selectCall!.modifiers.filter((m) => m.method === "lte");
  assert(
    lteModifiers.some((m) => m.args[0] === "access_token_expires_at"),
    "must filter access_token_expires_at <= now()+12h",
  );
});

Deno.test("tiktok-refresh-cron: refresh_token_expires_at within 30 days is logged only, no status/column write", async () => {
  const db = createSupabaseQueryMock();
  db.queue("tiktok_accounts", "select", {
    data: [
      {
        id: "acct-1",
        client_id: 101,
        avatar_url: null,
        access_token_expires_at: isoInHours(2),
        refresh_token_expires_at: isoInDays(10), // inside the 30-day warning window
      },
    ],
  });
  const { fn: reportCronFailure } = fakeReportCronFailure();

  const response = await runTikTokRefreshCron({
    svc: db as never,
    getFreshTikTokToken: async () => ({ accessToken: "fresh-token", openId: "open-1" }),
    reportCronFailure,
  });

  assertEquals(response.status, 200);
  const updateCalls = db.calls.filter((c) => c.table === "tiktok_accounts" && c.operation === "update");
  assertEquals(updateCalls.length, 0, "UI reads refresh_token_expires_at directly — no status change expected");
});

// ── (c) helper throwing TOKEN_EXPIRED does not stop the batch or double-mark ───

Deno.test("tiktok-refresh-cron: TOKEN_EXPIRED on one account does not crash the batch, and the cron does not itself write authorization_status (the helper already did)", async () => {
  const db = createSupabaseQueryMock();
  db.queue("tiktok_accounts", "select", {
    data: [
      {
        id: "acct-expired",
        client_id: 101,
        avatar_url: null,
        access_token_expires_at: isoInHours(1),
        refresh_token_expires_at: isoInDays(200),
      },
      {
        id: "acct-ok",
        client_id: 102,
        avatar_url: null,
        access_token_expires_at: isoInHours(3),
        refresh_token_expires_at: isoInDays(200),
      },
    ],
  });

  const processedAccountIds: string[] = [];
  const { fn: reportCronFailure, calls: failureCalls } = fakeReportCronFailure();

  const response = await runTikTokRefreshCron({
    svc: db as never,
    // deno-lint-ignore no-explicit-any
    getFreshTikTokToken: async (_svc: any, accountId: string) => {
      processedAccountIds.push(accountId);
      if (accountId === "acct-expired") {
        // Mirrors _shared/tiktok.ts: the helper itself already flipped authorization_status
        // to 'expired' before throwing — the cron must not duplicate that write.
        throw new TikTokApiError("refresh token expired", "TOKEN_EXPIRED", false);
      }
      return { accessToken: "fresh-token", openId: "open-2" };
    },
    reportCronFailure,
  });

  assertEquals(response.status, 200, "one account failing must not crash the whole cron run");
  assertEquals(processedAccountIds, ["acct-expired", "acct-ok"], "both accounts must be processed");

  const updateCalls = db.calls.filter((c) => c.table === "tiktok_accounts" && c.operation === "update");
  assertEquals(
    updateCalls.length,
    0,
    "the cron itself must never write authorization_status/etc — getFreshTikTokToken already handled it",
  );

  assertEquals(failureCalls.length, 1, "the failed account should be reported via reportCronFailure");
  const detail = failureCalls[0].detail;
  assertEquals(detail.failed, 1);
  assert(
    detail.errors?.some((e: { accountId?: string }) => e.accountId === "acct-expired"),
    "failure detail should reference the failed account",
  );
});

// ── (d) outer failure path reports via reportCronFailure ───────────────────────

Deno.test("tiktok-refresh-cron: a broken account query is reported via reportCronFailure and returns 500", async () => {
  const db = createSupabaseQueryMock();
  db.queue("tiktok_accounts", "select", { data: null, error: { message: "connection reset" } });
  const { fn: reportCronFailure, calls: failureCalls } = fakeReportCronFailure();

  const response = await runTikTokRefreshCron({
    svc: db as never,
    getFreshTikTokToken: async () => {
      throw new Error("must not be called — the select itself failed");
    },
    reportCronFailure,
  });

  assertEquals(response.status, 500);
  assertEquals(failureCalls.length, 1, "outer catch must still be wired to reportCronFailure");
  assertEquals(failureCalls[0].cronName, "tiktok-refresh-cron");
});

Deno.test("tiktok-refresh-cron: no accounts due for refresh returns 200 without reporting a failure", async () => {
  const db = createSupabaseQueryMock();
  db.queue("tiktok_accounts", "select", { data: [] });
  const { fn: reportCronFailure, calls: failureCalls } = fakeReportCronFailure();

  const response = await runTikTokRefreshCron({
    svc: db as never,
    getFreshTikTokToken: async () => {
      throw new Error("must not be called");
    },
    reportCronFailure,
  });

  assertEquals(response.status, 200);
  assertEquals(failureCalls.length, 0);
});

// ── (e) avatar re-cache (design: "Re-caches avatar") ────────────────────────────

Deno.test("tiktok-refresh-cron: successfully refreshed account re-caches its avatar via the shared helper", async () => {
  const db = createSupabaseQueryMock();
  db.queue("tiktok_accounts", "select", {
    data: [
      {
        id: "acct-1",
        client_id: 101,
        avatar_url: "https://old-cached-url/tiktok/101.jpg",
        access_token_expires_at: isoInHours(2),
        refresh_token_expires_at: isoInDays(200),
      },
    ],
  });
  db.queue("tiktok_accounts", "update", { data: null }); // avatar_url persist

  const cacheAvatarCalls: unknown[][] = [];
  const tiktokFetchCalls: unknown[][] = [];

  const response = await runTikTokRefreshCron({
    svc: db as never,
    getFreshTikTokToken: async () => ({ accessToken: "fresh-token", openId: "open-1" }),
    reportCronFailure: fakeReportCronFailure().fn,
    // deno-lint-ignore no-explicit-any
    cacheAvatar: async (...args: any[]) => {
      cacheAvatarCalls.push(args);
      return "https://cached.example/tiktok/101.jpg";
    },
    // deno-lint-ignore no-explicit-any
    tiktokFetch: async (...args: any[]) => {
      tiktokFetchCalls.push(args);
      return { user: { avatar_url: "https://p16-tiktok.cdn/raw-avatar.jpg" } };
    },
  });

  assertEquals(response.status, 200);
  assertEquals(tiktokFetchCalls.length, 1);
  assertEquals(cacheAvatarCalls.length, 1);
  // cacheAvatar(fetchImpl, storage, accountKey, avatarUrl) — accountKey is the stable client_id,
  // avatarUrl is the freshly-fetched raw TikTok CDN url (not the already-cached one).
  assertEquals(cacheAvatarCalls[0][2], 101);
  assertEquals(cacheAvatarCalls[0][3], "https://p16-tiktok.cdn/raw-avatar.jpg");

  const updateCalls = db.calls.filter((c) => c.table === "tiktok_accounts" && c.operation === "update");
  assertEquals(updateCalls.length, 1);
  assertEquals((updateCalls[0].payload as Record<string, unknown>).avatar_url, "https://cached.example/tiktok/101.jpg");
});

Deno.test("tiktok-refresh-cron: avatar re-cache failure is non-fatal and does not affect the refreshed count", async () => {
  const db = createSupabaseQueryMock();
  db.queue("tiktok_accounts", "select", {
    data: [
      {
        id: "acct-1",
        client_id: 101,
        avatar_url: null,
        access_token_expires_at: isoInHours(2),
        refresh_token_expires_at: isoInDays(200),
      },
    ],
  });
  const { fn: reportCronFailure, calls: failureCalls } = fakeReportCronFailure();

  const response = await runTikTokRefreshCron({
    svc: db as never,
    getFreshTikTokToken: async () => ({ accessToken: "fresh-token", openId: "open-1" }),
    reportCronFailure,
    cacheAvatar: async () => {
      throw new Error("avatar network blew up");
    },
    tiktokFetch: async () => {
      throw new Error("tiktok API blew up");
    },
  });

  assertEquals(response.status, 200);
  assertEquals(failureCalls.length, 0, "avatar failure must not count as an account failure");
  const updateCalls = db.calls.filter((c) => c.table === "tiktok_accounts" && c.operation === "update");
  assertEquals(updateCalls.length, 0);
});
