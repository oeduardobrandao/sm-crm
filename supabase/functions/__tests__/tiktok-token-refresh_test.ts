// getFreshTikTokToken — the ONLY code path that reads/refreshes TikTok tokens (Task A4).
// Mocks `svc` via the shared supabaseMock (design-import_test.ts's convention) and `fetch` via a
// local stubFetch (tiktok-shared_test.ts's convention — ./assert.ts deliberately stays tiny).
// A `sleep` override is injected through opts so the lock-contention polling tests don't burn
// real 2s waits (see GetFreshTikTokTokenOptions in _shared/tiktok.ts).
import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import {
  getFreshTikTokToken,
  encryptTikTokToken,
  decryptTikTokToken,
  TikTokApiError,
  TIKTOK_API_BASE,
} from "../_shared/tiktok.ts";

/** Local stand-in for std's assertRejects — mirrors tiktok-shared_test.ts. */
// deno-lint-ignore no-explicit-any
async function assertRejects(fn: () => Promise<unknown>, ErrClass?: new (...a: any[]) => Error): Promise<Error> {
  try {
    await fn();
  } catch (e) {
    if (ErrClass) {
      assert(e instanceof ErrClass, `expected ${ErrClass.name}, got ${(e as Error)?.constructor?.name}`);
    }
    return e as Error;
  }
  throw new Error("expected the function to throw, but it did not");
}

interface CapturedFetchCall {
  url: string;
  init?: RequestInit;
}

function stubFetch(response: (call: CapturedFetchCall, n: number) => Promise<Response>) {
  const original = globalThis.fetch;
  const captured: CapturedFetchCall[] = [];
  let n = 0;
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    const call = { url, init };
    captured.push(call);
    n += 1;
    return response(call, n);
  }) as typeof fetch;
  return {
    restore: () => {
      globalThis.fetch = original;
    },
    captured,
  };
}

/** Records every sleep() call instead of actually waiting — keeps polling tests fast. */
function fakeSleep() {
  const calls: number[] = [];
  return {
    sleep: (ms: number) => {
      calls.push(ms);
      return Promise.resolve();
    },
    calls,
  };
}

const TEST_KEY = "test-tiktok-encryption-key-32ch";
const ACCOUNT_ID = "acct-1";

function isoInMinutes(min: number): string {
  return new Date(Date.now() + min * 60_000).toISOString();
}

Deno.env.set("TOKEN_ENCRYPTION_KEY", TEST_KEY);
Deno.env.set("TIKTOK_CLIENT_KEY", "test-client-key");
Deno.env.set("TIKTOK_CLIENT_SECRET", "test-client-secret");

// ── 1. Valid token fast path ────────────────────────────────────────────────────

Deno.test("getFreshTikTokToken: access token valid >30min returns decrypted token, no refresh call", async () => {
  const db = createSupabaseQueryMock();
  const encAccess = await encryptTikTokToken("still-valid-access", "access");
  db.queue("tiktok_accounts", "select", {
    data: {
      id: ACCOUNT_ID,
      tiktok_open_id: "open-1",
      encrypted_access_token: encAccess,
      access_token_expires_at: isoInMinutes(60),
    },
  });
  const f = stubFetch(() => Promise.reject(new Error("must not call fetch")));
  try {
    const result = await getFreshTikTokToken(db as never, ACCOUNT_ID);
    assertEquals(result, { accessToken: "still-valid-access", openId: "open-1" });
    assertEquals(f.captured.length, 0, "no refresh call expected");
    const updateCalls = db.calls.filter((c) => c.operation === "update");
    assertEquals(updateCalls.length, 0, "no lock/persist writes expected on the fast path");
  } finally {
    f.restore();
  }
});

// ── 2. Expiring token -> refresh -> persist BEFORE returning ───────────────────

function stubSuccessfulRefresh(overrides: Partial<Record<string, unknown>> = {}) {
  return stubFetch((_call) =>
    Promise.resolve(
      new Response(
        JSON.stringify({
          open_id: "open-1",
          access_token: "new-access-token",
          expires_in: 86400,
          refresh_token: "new-refresh-token",
          refresh_expires_in: 31536000,
          scope: "user.info.basic",
          token_type: "Bearer",
          ...overrides,
        }),
        { status: 200 },
      ),
    )
  );
}

Deno.test("getFreshTikTokToken: expiring token refreshes, persists new tokens BEFORE returning, POSTs form body", async () => {
  const db = createSupabaseQueryMock();
  const encOldRefresh = await encryptTikTokToken("old-refresh-token", "refresh");
  db.queue("tiktok_accounts", "select", {
    data: {
      id: ACCOUNT_ID,
      tiktok_open_id: "open-1",
      encrypted_access_token: "irrelevant",
      access_token_expires_at: isoInMinutes(5), // expiring
    },
  });
  db.queue("tiktok_accounts", "update", {
    // claim succeeds
    data: { id: ACCOUNT_ID, encrypted_refresh_token: encOldRefresh, tiktok_open_id: "open-1" },
  });
  db.queue("tiktok_accounts", "update", { data: null }); // final persist (plain eq, no select)

  const f = stubSuccessfulRefresh();
  try {
    const beforeCall = Date.now();
    const result = await getFreshTikTokToken(db as never, ACCOUNT_ID);
    assertEquals(result, { accessToken: "new-access-token", openId: "open-1" });

    // Request shape (A3 review lesson: assert URL/method/body, not just outcome).
    assertEquals(f.captured.length, 1);
    assertEquals(f.captured[0].url, `${TIKTOK_API_BASE}/oauth/token/`);
    assertEquals(f.captured[0].init?.method, "POST");
    const headers = new Headers(f.captured[0].init?.headers);
    assertEquals(headers.get("Content-Type"), "application/x-www-form-urlencoded");
    const body = new URLSearchParams(f.captured[0].init?.body as unknown as string);
    assertEquals(body.get("grant_type"), "refresh_token");
    assertEquals(body.get("client_key"), "test-client-key");
    assertEquals(body.get("client_secret"), "test-client-secret");
    assertEquals(body.get("refresh_token"), "old-refresh-token");

    // Persisted BEFORE returning: by the time the awaited call above resolved, the update
    // must already be recorded with the new encrypted tokens/expiries and a cleared lock.
    const updateCalls = db.calls.filter((c) => c.table === "tiktok_accounts" && c.operation === "update");
    assertEquals(updateCalls.length, 2, "claim update + persist update");
    const persistCall = updateCalls[1];
    const payload = persistCall.payload as Record<string, unknown>;
    assertEquals(payload.refresh_lock_at, null);
    assert(typeof payload.encrypted_access_token === "string");
    assert(typeof payload.encrypted_refresh_token === "string");
    const decryptedAccess = await decryptTikTokToken(payload.encrypted_access_token as string, "access");
    assertEquals(decryptedAccess, "new-access-token");
    assert(typeof payload.access_token_expires_at === "string");
    assert(typeof payload.refresh_token_expires_at === "string");

    // Strengthened assertion (review lesson): the persisted expiry must be the exact instant
    // implied by expires_in, not just "some string" — within a small tolerance for test runtime.
    const expectedExpiresAt = beforeCall + 86400 * 1000;
    const actualExpiresAt = new Date(payload.access_token_expires_at as string).getTime();
    assert(
      Math.abs(actualExpiresAt - expectedExpiresAt) <= 5000,
      `access_token_expires_at should be ~now+expires_in (within 5s), got delta ${actualExpiresAt - expectedExpiresAt}ms`,
    );
  } finally {
    f.restore();
  }
});

// ── 3. Rotated refresh_token is the one persisted ───────────────────────────────

Deno.test("getFreshTikTokToken: rotated refresh_token (different from the input) is what gets persisted", async () => {
  const db = createSupabaseQueryMock();
  const encOldRefresh = await encryptTikTokToken("original-refresh-token", "refresh");
  db.queue("tiktok_accounts", "select", {
    data: {
      id: ACCOUNT_ID,
      tiktok_open_id: "open-1",
      encrypted_access_token: "irrelevant",
      access_token_expires_at: isoInMinutes(1),
    },
  });
  db.queue("tiktok_accounts", "update", {
    data: { id: ACCOUNT_ID, encrypted_refresh_token: encOldRefresh, tiktok_open_id: "open-1" },
  });
  db.queue("tiktok_accounts", "update", { data: null });

  const f = stubSuccessfulRefresh({ refresh_token: "brand-new-rotated-refresh-token" });
  try {
    await getFreshTikTokToken(db as never, ACCOUNT_ID);
    const updateCalls = db.calls.filter((c) => c.table === "tiktok_accounts" && c.operation === "update");
    const persistPayload = updateCalls[1].payload as Record<string, unknown>;
    const decryptedRefresh = await decryptTikTokToken(persistPayload.encrypted_refresh_token as string, "refresh");
    assertEquals(decryptedRefresh, "brand-new-rotated-refresh-token");
    assert(decryptedRefresh !== "original-refresh-token", "must persist the rotated token, not the input");
  } finally {
    f.restore();
  }
});

// ── 4. invalid_grant -> account expired + typed TOKEN_EXPIRED thrown ───────────

Deno.test("getFreshTikTokToken: invalid_grant marks account expired and throws typed TOKEN_EXPIRED", async () => {
  const db = createSupabaseQueryMock();
  const encOldRefresh = await encryptTikTokToken("dead-refresh-token", "refresh");
  db.queue("tiktok_accounts", "select", {
    data: {
      id: ACCOUNT_ID,
      tiktok_open_id: "open-1",
      encrypted_access_token: "irrelevant",
      access_token_expires_at: isoInMinutes(1),
    },
  });
  db.queue("tiktok_accounts", "update", {
    data: { id: ACCOUNT_ID, encrypted_refresh_token: encOldRefresh, tiktok_open_id: "open-1" },
  });
  db.queue("tiktok_accounts", "update", { data: null }); // authorization_status='expired' write

  const f = stubFetch(() =>
    Promise.resolve(
      new Response(
        JSON.stringify({ error: "invalid_grant", error_description: "refresh token expired", log_id: "log-1" }),
        { status: 400 },
      ),
    )
  );
  try {
    const err = await assertRejects(() => getFreshTikTokToken(db as never, ACCOUNT_ID), TikTokApiError);
    assertEquals((err as TikTokApiError).code, "TOKEN_EXPIRED");

    const updateCalls = db.calls.filter((c) => c.table === "tiktok_accounts" && c.operation === "update");
    assertEquals(updateCalls.length, 2, "claim update + expire update");
    const expirePayload = updateCalls[1].payload as Record<string, unknown>;
    assertEquals(expirePayload.authorization_status, "expired");
    assertEquals(expirePayload.refresh_lock_at, null, "lock must be released alongside the expiry write");
  } finally {
    f.restore();
  }
});

// ── 5. Lock contention -> poll -> returns the other process's refreshed token ──

Deno.test("getFreshTikTokToken: lock contention polls the row and returns another process's refreshed token", async () => {
  const db = createSupabaseQueryMock();
  db.queue("tiktok_accounts", "select", {
    data: {
      id: ACCOUNT_ID,
      tiktok_open_id: "open-1",
      encrypted_access_token: "irrelevant",
      access_token_expires_at: isoInMinutes(1),
    },
  });
  db.queue("tiktok_accounts", "update", { data: null }); // claim UPDATE matches 0 rows -> contention

  const encFreshened = await encryptTikTokToken("other-process-access-token", "access");
  // Poll attempt 1: still stale (other process hasn't landed yet).
  db.queue("tiktok_accounts", "select", {
    data: {
      id: ACCOUNT_ID,
      tiktok_open_id: "open-1",
      encrypted_access_token: "irrelevant",
      access_token_expires_at: isoInMinutes(1),
    },
  });
  // Poll attempt 2: the other process's refresh landed.
  db.queue("tiktok_accounts", "select", {
    data: {
      id: ACCOUNT_ID,
      tiktok_open_id: "open-1",
      encrypted_access_token: encFreshened,
      access_token_expires_at: isoInMinutes(120),
    },
  });

  const { sleep, calls: sleepCalls } = fakeSleep();
  const f = stubFetch(() => Promise.reject(new Error("must not call fetch — this process doesn't hold the lock")));
  try {
    const result = await getFreshTikTokToken(db as never, ACCOUNT_ID, { sleep });
    assertEquals(result, { accessToken: "other-process-access-token", openId: "open-1" });
    assertEquals(f.captured.length, 0, "the losing process must not itself call the refresh endpoint");
    assertEquals(sleepCalls.length, 2, "polled twice before the row came back fresh");
    for (const ms of sleepCalls) assertEquals(ms, 2000);
  } finally {
    f.restore();
  }
});

Deno.test("getFreshTikTokToken: lock contention still stale after all polls throws a retryable error", async () => {
  const db = createSupabaseQueryMock();
  db.queue("tiktok_accounts", "select", {
    data: {
      id: ACCOUNT_ID,
      tiktok_open_id: "open-1",
      encrypted_access_token: "irrelevant",
      access_token_expires_at: isoInMinutes(1),
    },
  });
  db.queue("tiktok_accounts", "update", { data: null }); // contention
  const stalePoll = {
    data: {
      id: ACCOUNT_ID,
      tiktok_open_id: "open-1",
      encrypted_access_token: "irrelevant",
      access_token_expires_at: isoInMinutes(1),
    },
  };
  db.queue("tiktok_accounts", "select", stalePoll, stalePoll, stalePoll); // all 3 polls still stale

  const { sleep, calls: sleepCalls } = fakeSleep();
  const f = stubFetch(() => Promise.reject(new Error("must not call fetch")));
  try {
    const err = await assertRejects(() => getFreshTikTokToken(db as never, ACCOUNT_ID, { sleep }), TikTokApiError);
    assertEquals((err as TikTokApiError).retryable, true);
    assertEquals(sleepCalls.length, 3);
  } finally {
    f.restore();
  }
});

// ── 6. Account not found (defensive path) ───────────────────────────────────────

Deno.test("getFreshTikTokToken: unknown account throws a typed, non-retryable error", async () => {
  const db = createSupabaseQueryMock();
  db.queue("tiktok_accounts", "select", { data: null });
  const err = await assertRejects(() => getFreshTikTokToken(db as never, "missing-acct"), TikTokApiError);
  assertEquals((err as TikTokApiError).retryable, false);
});

// ── 7. Lock release on non-invalid_grant refresh failure (finally path) ────────

Deno.test("getFreshTikTokToken: lock is released via finally when the refresh call fails for another reason", async () => {
  const db = createSupabaseQueryMock();
  const encOldRefresh = await encryptTikTokToken("old-refresh-token", "refresh");
  db.queue("tiktok_accounts", "select", {
    data: {
      id: ACCOUNT_ID,
      tiktok_open_id: "open-1",
      encrypted_access_token: "irrelevant",
      access_token_expires_at: isoInMinutes(1),
    },
  });
  db.queue("tiktok_accounts", "update", {
    data: { id: ACCOUNT_ID, encrypted_refresh_token: encOldRefresh, tiktok_open_id: "open-1" },
  });
  db.queue("tiktok_accounts", "update", { data: null }); // finally's lock-release write

  const f = stubFetch(() =>
    Promise.resolve(
      new Response(JSON.stringify({ error: "server_error", error_description: "boom", log_id: "log-2" }), {
        status: 500,
      }),
    )
  );
  try {
    await assertRejects(() => getFreshTikTokToken(db as never, ACCOUNT_ID), TikTokApiError);
    const updateCalls = db.calls.filter((c) => c.table === "tiktok_accounts" && c.operation === "update");
    assertEquals(updateCalls.length, 2, "claim update + finally release update");
    const releasePayload = updateCalls[1].payload as Record<string, unknown>;
    assertEquals(releasePayload.refresh_lock_at, null);
  } finally {
    f.restore();
  }
});

// ── 8. Persist failure must NOT return the new access token (Critical review gap) ──
//
// supabase-js resolves `{ data: null, error: {...} }` on a PostgREST-level failure — it does
// NOT throw. If the persist update silently swallowed that error, getFreshTikTokToken would
// return the new access token while the rotated refresh token was never written to the row,
// so the next refresh would present the now-dead old refresh token and get invalid_grant,
// permanently bricking the account. This regression test locks in that persist errors reject.

Deno.test("getFreshTikTokToken: persist update failing (data:null, error set) rejects and does NOT return a token", async () => {
  const db = createSupabaseQueryMock();
  const encOldRefresh = await encryptTikTokToken("old-refresh-token", "refresh");
  db.queue("tiktok_accounts", "select", {
    data: {
      id: ACCOUNT_ID,
      tiktok_open_id: "open-1",
      encrypted_access_token: "irrelevant",
      access_token_expires_at: isoInMinutes(1),
    },
  });
  db.queue("tiktok_accounts", "update", {
    // claim succeeds
    data: { id: ACCOUNT_ID, encrypted_refresh_token: encOldRefresh, tiktok_open_id: "open-1" },
  });
  // The persist write itself resolves with a PostgREST-level error — supabase-js does NOT throw.
  db.queue("tiktok_accounts", "update", { data: null, error: { message: "boom" } });
  // lockHeld must stay true after the persist error, so finally attempts a release update too.
  db.queue("tiktok_accounts", "update", { data: null });

  const f = stubSuccessfulRefresh();
  try {
    const err = await assertRejects(() => getFreshTikTokToken(db as never, ACCOUNT_ID), TikTokApiError);
    assertEquals((err as TikTokApiError).code, "REFRESH_FAILED");
    assertEquals((err as TikTokApiError).retryable, true);

    const updateCalls = db.calls.filter((c) => c.table === "tiktok_accounts" && c.operation === "update");
    assertEquals(updateCalls.length, 3, "claim update + failed persist update + finally release update");
    const releasePayload = updateCalls[2].payload as Record<string, unknown>;
    assertEquals(releasePayload.refresh_lock_at, null, "finally must still release the lock after a persist failure");
  } finally {
    f.restore();
  }
});
