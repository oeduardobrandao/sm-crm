// _shared/google.ts: OAuth URL/exchange, token crypto, the googleFetch error mapper and the
// lock-serialized getFreshGoogleToken. Mocks `svc` via the shared supabaseMock and `fetch` via a
// local stubFetch (tiktok-token-refresh_test.ts's conventions; ./assert.ts stays tiny).
import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import {
  buildGoogleAuthUrl,
  decryptGoogleToken,
  encryptGoogleToken,
  exchangeGoogleCode,
  fetchGoogleUserInfo,
  getFreshGoogleToken,
  GOOGLE_BASE_SCOPES,
  GOOGLE_PRODUCT_SCOPES,
  GoogleApiError,
  googleFetch,
  googleRedirectUri,
  hasRequiredScopes,
  requireGoogleClientCredentials,
  revokeGoogleToken,
} from "../_shared/google.ts";

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
  globalThis.fetch = ((url: string | URL, init?: RequestInit) => {
    const call = { url: String(url), init };
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

function jsonResponse(body: unknown, status = 200): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status }));
}

const TEST_KEY = "test-google-encryption-key-32chr";
const CONNECTION_ID = "conn-1";
const SUPABASE_URL = "https://proj.supabase.co";
const FALLBACK_REDIRECT = `${SUPABASE_URL}/functions/v1/google-integration/callback`;
const YT = GOOGLE_PRODUCT_SCOPES.youtube;

Deno.env.set("TOKEN_ENCRYPTION_KEY", TEST_KEY);
Deno.env.set("GOOGLE_OAUTH_CLIENT_ID", "test-client-id");
Deno.env.set("GOOGLE_OAUTH_CLIENT_SECRET", "test-client-secret");
Deno.env.set("SUPABASE_URL", SUPABASE_URL);
Deno.env.delete("GOOGLE_REDIRECT_URI");

function isoInMinutes(min: number): string {
  return new Date(Date.now() + min * 60_000).toISOString();
}

// ── Scopes and credentials ──────────────────────────────────────────────────────

Deno.test("google-shared: product and base scopes are the full Google URLs", () => {
  assertEquals(GOOGLE_PRODUCT_SCOPES.youtube, [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.readonly",
    "https://www.googleapis.com/auth/yt-analytics.readonly",
  ]);
  assertEquals(GOOGLE_PRODUCT_SCOPES.gbp, ["https://www.googleapis.com/auth/business.manage"]);
  assertEquals(GOOGLE_BASE_SCOPES, ["openid", "email", "profile"]);
});

Deno.test("google-shared: requireGoogleClientCredentials throws when a credential is missing", async () => {
  assertEquals(requireGoogleClientCredentials(), { clientId: "test-client-id", clientSecret: "test-client-secret" });
  Deno.env.delete("GOOGLE_OAUTH_CLIENT_SECRET");
  try {
    await assertRejects(() => Promise.resolve().then(() => requireGoogleClientCredentials()));
  } finally {
    Deno.env.set("GOOGLE_OAUTH_CLIENT_SECRET", "test-client-secret");
  }
});

Deno.test("google-shared: googleRedirectUri falls back to the SUPABASE_URL callback, honours the override", () => {
  assertEquals(googleRedirectUri(), FALLBACK_REDIRECT);
  Deno.env.set("GOOGLE_REDIRECT_URI", "https://example.com/cb");
  try {
    assertEquals(googleRedirectUri(), "https://example.com/cb");
  } finally {
    Deno.env.delete("GOOGLE_REDIRECT_URI");
  }
});

// ── buildGoogleAuthUrl ──────────────────────────────────────────────────────────

Deno.test("google-shared: buildGoogleAuthUrl carries offline access, incremental scopes and select_account", () => {
  const url = new URL(buildGoogleAuthUrl({ product: "youtube", state: "st-1", consent: false }));
  assertEquals(`${url.origin}${url.pathname}`, "https://accounts.google.com/o/oauth2/v2/auth");
  const p = url.searchParams;
  assertEquals(p.get("client_id"), "test-client-id");
  assertEquals(p.get("redirect_uri"), FALLBACK_REDIRECT);
  assertEquals(p.get("response_type"), "code");
  assertEquals(p.get("access_type"), "offline");
  assertEquals(p.get("include_granted_scopes"), "true");
  assertEquals(p.get("prompt"), "select_account");
  assertEquals(p.get("state"), "st-1");
  const scopes = p.get("scope")!.split(" ");
  for (const s of [...YT, ...GOOGLE_BASE_SCOPES]) assert(scopes.includes(s), `missing scope ${s}`);
  assert(!scopes.includes(GOOGLE_PRODUCT_SCOPES.gbp[0]), "youtube URL must not ask for business.manage");
});

Deno.test("google-shared: buildGoogleAuthUrl uses prompt=consent when asked and gbp scopes for gbp", () => {
  const url = new URL(buildGoogleAuthUrl({ product: "gbp", state: "st-2", consent: true }));
  assertEquals(url.searchParams.get("prompt"), "consent");
  const scopes = url.searchParams.get("scope")!.split(" ");
  assertEquals(scopes.sort(), [...GOOGLE_PRODUCT_SCOPES.gbp, ...GOOGLE_BASE_SCOPES].sort());
});

// ── hasRequiredScopes ───────────────────────────────────────────────────────────

Deno.test("google-shared: hasRequiredScopes is false when a YouTube product scope is missing", () => {
  const granted = [
    "openid",
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.readonly",
  ];
  assertEquals(hasRequiredScopes("youtube", granted), false);
  assertEquals(hasRequiredScopes("youtube", [...granted, "https://www.googleapis.com/auth/yt-analytics.readonly"]), true);
});

Deno.test("google-shared: hasRequiredScopes ignores the echoed userinfo base scopes", () => {
  assertEquals(
    hasRequiredScopes("gbp", [
      "openid",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://www.googleapis.com/auth/business.manage",
    ]),
    true,
  );
  assertEquals(hasRequiredScopes("gbp", ["openid", "https://www.googleapis.com/auth/userinfo.email"]), false);
});

// ── Token crypto ────────────────────────────────────────────────────────────────

Deno.test("google-shared: encryptGoogleToken round-trips; an access ciphertext does not decrypt as refresh", async () => {
  const encAccess = await encryptGoogleToken("access-value", "access");
  assertEquals(await decryptGoogleToken(encAccess, "access"), "access-value");
  const encRefresh = await encryptGoogleToken("refresh-value", "refresh");
  assertEquals(await decryptGoogleToken(encRefresh, "refresh"), "refresh-value");
  await assertRejects(() => decryptGoogleToken(encAccess, "refresh"));
});

Deno.test("google-shared: token crypto throws without TOKEN_ENCRYPTION_KEY", async () => {
  Deno.env.delete("TOKEN_ENCRYPTION_KEY");
  try {
    await assertRejects(() => encryptGoogleToken("x", "access"));
  } finally {
    Deno.env.set("TOKEN_ENCRYPTION_KEY", TEST_KEY);
  }
});

// ── googleFetch error mapping ───────────────────────────────────────────────────

async function mappedCode(status: number, body: unknown): Promise<GoogleApiError> {
  const f = stubFetch(() =>
    Promise.resolve(new Response(typeof body === "string" ? body : JSON.stringify(body), { status })),
  );
  try {
    const err = await assertRejects(() => googleFetch("https://api.example/x", "tok"), GoogleApiError);
    return err as GoogleApiError;
  } finally {
    f.restore();
  }
}

const QUOTA_ZERO_DETAILS = {
  error: {
    code: 429,
    message: "Quota exceeded for quota metric 'Requests' and limit 'Requests per minute'",
    status: "RESOURCE_EXHAUSTED",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        reason: "RATE_LIMIT_EXCEEDED",
        domain: "googleapis.com",
        metadata: { quota_limit_value: "0", quota_metric: "mybusinessaccountmanagement.googleapis.com/default_requests" },
      },
    ],
  },
};

Deno.test("google-shared: googleFetch maps 401 to TOKEN_INVALID", async () => {
  const e = await mappedCode(401, { error: { code: 401, message: "Invalid Credentials" } });
  assertEquals([e.code, e.status, e.retryable], ["TOKEN_INVALID", 401, false]);
});

Deno.test("google-shared: googleFetch maps plain 429 to retryable RATE_LIMITED", async () => {
  const e = await mappedCode(429, { error: { code: 429, message: "Too many" } });
  assertEquals([e.code, e.status, e.retryable], ["RATE_LIMITED", 429, true]);
});

Deno.test("google-shared: googleFetch maps 403 quotaExceeded / dailyLimitExceeded to non-retryable QUOTA_EXCEEDED", async () => {
  for (const reason of ["quotaExceeded", "dailyLimitExceeded"]) {
    const e = await mappedCode(403, {
      error: { code: 403, message: "The request cannot be completed", errors: [{ reason, message: "quota" }] },
    });
    assertEquals([e.code, e.status, e.retryable], ["QUOTA_EXCEEDED", 403, false], reason);
  }
});

Deno.test("google-shared: googleFetch maps the google.rpc quota shapes (403 RESOURCE_EXHAUSTED, details QUOTA_EXCEEDED) to QUOTA_EXCEEDED", async () => {
  const byStatus403 = await mappedCode(403, {
    error: { code: 403, message: "Quota exceeded", status: "RESOURCE_EXHAUSTED" },
  });
  assertEquals(byStatus403.code, "QUOTA_EXCEEDED");
  const byDetails = await mappedCode(429, {
    error: {
      code: 429,
      message: "Quota exceeded",
      details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "QUOTA_EXCEEDED" }],
    },
  });
  assertEquals(byDetails.code, "QUOTA_EXCEEDED");
});

Deno.test("google-shared: a bare 429 RESOURCE_EXHAUSTED (no reason) is a per-minute throttle: retryable RATE_LIMITED", async () => {
  const e = await mappedCode(429, {
    error: { code: 429, message: "Quota exceeded", status: "RESOURCE_EXHAUSTED" },
  });
  assertEquals([e.code, e.status, e.retryable], ["RATE_LIMITED", 429, true]);
});

Deno.test("google-shared: 429/RESOURCE_EXHAUSTED with a rate-limit reason maps to RATE_LIMITED", async () => {
  for (const reason of ["RATE_LIMIT_EXCEEDED", "rateLimitExceeded", "userRateLimitExceeded"]) {
    const byDetails = await mappedCode(429, {
      error: {
        code: 429,
        message: "Quota exceeded for quota metric 'Requests' and limit 'Requests per minute'",
        status: "RESOURCE_EXHAUSTED",
        details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason, metadata: { quota_limit_value: "300" } }],
      },
    });
    assertEquals([byDetails.code, byDetails.retryable], ["RATE_LIMITED", true], `details ${reason}`);
    const byErrors = await mappedCode(429, {
      error: { code: 429, message: "Rate limit", status: "RESOURCE_EXHAUSTED", errors: [{ reason, message: "rate" }] },
    });
    assertEquals(byErrors.code, "RATE_LIMITED", `errors ${reason}`);
    // A 403 carrying a rate-limit reason (YouTube Data API's userRateLimitExceeded) is a throttle too.
    const by403 = await mappedCode(403, {
      error: { code: 403, message: "Rate limit", errors: [{ reason, message: "rate" }] },
    });
    assertEquals([by403.code, by403.retryable], ["RATE_LIMITED", true], `403 ${reason}`);
  }
});

Deno.test("google-shared: quota reasons on a 429 RESOURCE_EXHAUSTED stay QUOTA_EXCEEDED", async () => {
  for (const reason of ["quotaExceeded", "dailyLimitExceeded", "QUOTA_EXCEEDED"]) {
    const byDetails = await mappedCode(429, {
      error: {
        code: 429,
        message: "Quota exceeded",
        status: "RESOURCE_EXHAUSTED",
        details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason }],
      },
    });
    assertEquals([byDetails.code, byDetails.retryable], ["QUOTA_EXCEEDED", false], `details ${reason}`);
    const byErrors = await mappedCode(429, {
      error: { code: 429, message: "Quota exceeded", status: "RESOURCE_EXHAUSTED", errors: [{ reason, message: "q" }] },
    });
    assertEquals(byErrors.code, "QUOTA_EXCEEDED", `errors ${reason}`);
  }
});

Deno.test("google-shared: a quota-zero 403/429 stays NOT_APPROVED even when it also reads as exhausted", async () => {
  const body = structuredClone(QUOTA_ZERO_DETAILS);
  body.error.code = 403;
  const e = await mappedCode(403, body);
  assertEquals(e.code, "NOT_APPROVED");
  const e429 = await mappedCode(429, QUOTA_ZERO_DETAILS); // status RESOURCE_EXHAUSTED + quota 0
  assertEquals(e429.code, "NOT_APPROVED");
});

Deno.test("google-shared: googleFetch maps 429 with quota_limit_value 0 to NOT_APPROVED", async () => {
  const e = await mappedCode(429, QUOTA_ZERO_DETAILS);
  assertEquals([e.code, e.status, e.retryable], ["NOT_APPROVED", 429, false]);
});

Deno.test("google-shared: googleFetch maps 403 with quota_limit_value 0 to NOT_APPROVED", async () => {
  const body = structuredClone(QUOTA_ZERO_DETAILS);
  body.error.code = 403;
  const e = await mappedCode(403, body);
  assertEquals(e.code, "NOT_APPROVED");
});

Deno.test("google-shared: googleFetch maps 403 SERVICE_DISABLED (details or message) to API_DISABLED", async () => {
  const byReason = await mappedCode(403, {
    error: {
      code: 403,
      message: "Some API is disabled",
      status: "PERMISSION_DENIED",
      details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "SERVICE_DISABLED" }],
    },
  });
  assertEquals([byReason.code, byReason.retryable], ["API_DISABLED", false]);

  const byMessage = await mappedCode(403, {
    error: {
      code: 403,
      message: "YouTube Data API v3 has not been used in project 123 before or it is disabled.",
      errors: [{ reason: "accessNotConfigured" }],
    },
  });
  assertEquals(byMessage.code, "API_DISABLED");

  const byEnabledMessage = await mappedCode(403, {
    error: { code: 403, message: "The API has not been enabled for this project." },
  });
  assertEquals(byEnabledMessage.code, "API_DISABLED");
});

Deno.test("google-shared: googleFetch maps other 403 to FORBIDDEN", async () => {
  const e = await mappedCode(403, {
    error: { code: 403, message: "The caller does not have permission", status: "PERMISSION_DENIED" },
  });
  assertEquals([e.code, e.status, e.retryable], ["FORBIDDEN", 403, false]);
});

Deno.test("google-shared: googleFetch maps 404 to NOT_FOUND and 503 (non-JSON) to retryable UPSTREAM", async () => {
  const nf = await mappedCode(404, { error: { code: 404, message: "Not found" } });
  assertEquals([nf.code, nf.retryable], ["NOT_FOUND", false]);
  const up = await mappedCode(503, "<html>Service Unavailable</html>");
  assertEquals([up.code, up.status, up.retryable], ["UPSTREAM", 503, true]);
});

Deno.test("google-shared: googleFetch maps an unmapped 400 to non-retryable UPSTREAM keeping the status", async () => {
  const e = await mappedCode(400, { error: { code: 400, message: "Bad request" } });
  assertEquals([e.code, e.status, e.retryable], ["UPSTREAM", 400, false]);
});

Deno.test("google-shared: googleFetch sends the bearer token and an AbortSignal, returns parsed JSON", async () => {
  const f = stubFetch(() => jsonResponse({ items: [1] }));
  try {
    const out = await googleFetch("https://api.example/ok", "tok-123", { timeoutMs: 5000 });
    assertEquals(out, { items: [1] });
    assertEquals(f.captured.length, 1);
    const init = f.captured[0].init!;
    assert(init.signal instanceof AbortSignal, "signal must be an AbortSignal");
    assertEquals(new Headers(init.headers).get("Authorization"), "Bearer tok-123");
    assert(!("timeoutMs" in init), "timeoutMs must not leak into fetch init");
  } finally {
    f.restore();
  }
});

Deno.test("google-shared: googleFetch returns null on an empty 204 body", async () => {
  const f = stubFetch(() => Promise.resolve(new Response(null, { status: 204 })));
  try {
    assertEquals(await googleFetch("https://api.example/del", "tok", { method: "DELETE" }), null);
  } finally {
    f.restore();
  }
});

// ── exchangeGoogleCode / fetchGoogleUserInfo / revokeGoogleToken ───────────────

Deno.test("google-shared: exchangeGoogleCode POSTs the code with the same redirect URI and parses the grant", async () => {
  const f = stubFetch(() =>
    jsonResponse({
      access_token: "at-1",
      refresh_token: "rt-1",
      expires_in: 3599,
      scope: "openid https://www.googleapis.com/auth/business.manage",
      token_type: "Bearer",
    }),
  );
  try {
    const before = Date.now();
    const out = await exchangeGoogleCode("code-xyz");
    assertEquals(out.accessToken, "at-1");
    assertEquals(out.refreshToken, "rt-1");
    assertEquals(out.scopes, ["openid", "https://www.googleapis.com/auth/business.manage"]);
    assert(Math.abs(out.expiresAt.getTime() - (before + 3599_000)) < 5000);
    const call = f.captured[0];
    assertEquals(call.url, "https://oauth2.googleapis.com/token");
    assertEquals(call.init?.method, "POST");
    assert(call.init?.signal instanceof AbortSignal);
    const body = new URLSearchParams(String(call.init?.body));
    assertEquals(body.get("grant_type"), "authorization_code");
    assertEquals(body.get("code"), "code-xyz");
    assertEquals(body.get("redirect_uri"), FALLBACK_REDIRECT);
    assertEquals(body.get("client_id"), "test-client-id");
    assertEquals(body.get("client_secret"), "test-client-secret");
  } finally {
    f.restore();
  }
});

Deno.test("google-shared: exchangeGoogleCode returns refreshToken null when Google omits it, throws on error", async () => {
  const ok = stubFetch(() => jsonResponse({ access_token: "at-2", expires_in: 3600, scope: "openid" }));
  try {
    assertEquals((await exchangeGoogleCode("c")).refreshToken, null);
  } finally {
    ok.restore();
  }
  const bad = stubFetch(() => jsonResponse({ error: "invalid_grant" }, 400));
  try {
    const e = (await assertRejects(() => exchangeGoogleCode("c"), GoogleApiError)) as GoogleApiError;
    assertEquals([e.code, e.status], ["UPSTREAM", 400]);
  } finally {
    bad.restore();
  }
});

Deno.test("google-shared: fetchGoogleUserInfo reads sub/email/name from the OIDC userinfo endpoint", async () => {
  const f = stubFetch(() => jsonResponse({ sub: "sub-1", email: "a@b.com", name: "Ana" }));
  try {
    assertEquals(await fetchGoogleUserInfo("tok"), { sub: "sub-1", email: "a@b.com", name: "Ana" });
    assertEquals(f.captured[0].url, "https://openidconnect.googleapis.com/v1/userinfo");
  } finally {
    f.restore();
  }
  const noName = stubFetch(() => jsonResponse({ sub: "sub-1", email: "a@b.com" }));
  try {
    assertEquals((await fetchGoogleUserInfo("tok")).name, null);
  } finally {
    noName.restore();
  }
  // Email unticked on granular consent: sub alone still identifies the grant (the callback
  // treats it as missing_scope and decides the revoke by sub).
  const noEmail = stubFetch(() => jsonResponse({ sub: "sub-1", name: "Ana" }));
  try {
    assertEquals(await fetchGoogleUserInfo("tok"), { sub: "sub-1", email: null, name: "Ana" });
  } finally {
    noEmail.restore();
  }
  const noSub = stubFetch(() => jsonResponse({ email: "a@b.com" }));
  try {
    await assertRejects(() => fetchGoogleUserInfo("tok"), GoogleApiError);
  } finally {
    noSub.restore();
  }
});

Deno.test("google-shared: revokeGoogleToken is true on 200 and on 400 invalid_token, false otherwise, never throws", async () => {
  const ok = stubFetch(() => Promise.resolve(new Response("", { status: 200 })));
  try {
    assertEquals(await revokeGoogleToken("t"), true);
    assertEquals(ok.captured[0].url, "https://oauth2.googleapis.com/revoke");
    assertEquals(new URLSearchParams(String(ok.captured[0].init?.body)).get("token"), "t");
    assert(ok.captured[0].init?.signal instanceof AbortSignal);
  } finally {
    ok.restore();
  }
  const gone = stubFetch(() => jsonResponse({ error: "invalid_token" }, 400));
  try {
    assertEquals(await revokeGoogleToken("t"), true);
  } finally {
    gone.restore();
  }
  const fail = stubFetch(() => Promise.resolve(new Response("oops", { status: 500 })));
  try {
    assertEquals(await revokeGoogleToken("t"), false);
  } finally {
    fail.restore();
  }
  const net = stubFetch(() => Promise.reject(new TypeError("network down")));
  try {
    assertEquals(await revokeGoogleToken("t"), false);
  } finally {
    net.restore();
  }
});

// ── getFreshGoogleToken ─────────────────────────────────────────────────────────

Deno.test("getFreshGoogleToken: token with >5 min left is returned decrypted, no fetch, no writes", async () => {
  const db = createSupabaseQueryMock();
  db.queue("google_connections", "select", {
    data: {
      id: CONNECTION_ID,
      status: "active",
      encrypted_access_token: await encryptGoogleToken("still-valid", "access"),
      access_token_expires_at: isoInMinutes(20),
    },
  });
  const f = stubFetch(() => Promise.reject(new Error("must not call fetch")));
  try {
    assertEquals(await getFreshGoogleToken(db as never, CONNECTION_ID), "still-valid");
    assertEquals(f.captured.length, 0);
    assertEquals(db.calls.filter((c) => c.operation === "update").length, 0);
  } finally {
    f.restore();
  }
});

Deno.test("getFreshGoogleToken: a revoked connection throws REVOKED without refreshing", async () => {
  const db = createSupabaseQueryMock();
  db.queue("google_connections", "select", {
    data: {
      id: CONNECTION_ID,
      status: "revoked",
      encrypted_access_token: await encryptGoogleToken("x", "access"),
      access_token_expires_at: isoInMinutes(20),
    },
  });
  const f = stubFetch(() => Promise.reject(new Error("must not call fetch")));
  try {
    const e = (await assertRejects(() => getFreshGoogleToken(db as never, CONNECTION_ID), GoogleApiError)) as GoogleApiError;
    assertEquals(e.code, "REVOKED");
    assertEquals(f.captured.length, 0);
  } finally {
    f.restore();
  }
});

Deno.test("getFreshGoogleToken: missing connection throws NOT_FOUND", async () => {
  const db = createSupabaseQueryMock();
  db.queue("google_connections", "select", { data: null });
  const e = (await assertRejects(() => getFreshGoogleToken(db as never, CONNECTION_ID), GoogleApiError)) as GoogleApiError;
  assertEquals(e.code, "NOT_FOUND");
});

Deno.test("getFreshGoogleToken: expiring token refreshes and keeps the stored refresh token when none comes back", async () => {
  const db = createSupabaseQueryMock();
  db.queue("google_connections", "select", {
    data: { id: CONNECTION_ID, status: "active", encrypted_access_token: "old", access_token_expires_at: isoInMinutes(3) },
  });
  db.queue("google_connections", "update", {
    data: { id: CONNECTION_ID, encrypted_refresh_token: await encryptGoogleToken("stored-refresh", "refresh") },
  });
  db.queue("google_connections", "update", { data: null }); // persist
  const f = stubFetch(() => jsonResponse({ access_token: "new-access", expires_in: 3599, scope: "openid", token_type: "Bearer" }));
  try {
    const before = Date.now();
    assertEquals(await getFreshGoogleToken(db as never, CONNECTION_ID), "new-access");

    assertEquals(f.captured.length, 1);
    const call = f.captured[0];
    assertEquals(call.url, "https://oauth2.googleapis.com/token");
    assertEquals(call.init?.method, "POST");
    assert(call.init?.signal instanceof AbortSignal);
    const body = new URLSearchParams(String(call.init?.body));
    assertEquals(body.get("grant_type"), "refresh_token");
    assertEquals(body.get("refresh_token"), "stored-refresh");
    assertEquals(body.get("client_id"), "test-client-id");
    assertEquals(body.get("client_secret"), "test-client-secret");

    const updates = db.calls.filter((c) => c.table === "google_connections" && c.operation === "update");
    assertEquals(updates.length, 2, "claim + persist");
    const claim = updates[0];
    assert(typeof (claim.payload as Record<string, unknown>).refresh_lock_at === "string");
    assert(
      claim.selectArgs.some((a) => String(a[0]).includes("refresh_lock_at")),
      "claim projection must keep refresh_lock_at (prod PostgREST 42703)",
    );
    const persist = updates[1].payload as Record<string, unknown>;
    assertEquals(persist.refresh_lock_at, null);
    assert(!("encrypted_refresh_token" in persist), "stored refresh token must be kept, not overwritten");
    assertEquals(await decryptGoogleToken(persist.encrypted_access_token as string, "access"), "new-access");
    const expiresAt = new Date(persist.access_token_expires_at as string).getTime();
    assert(Math.abs(expiresAt - (before + 3599_000)) < 5000);
  } finally {
    f.restore();
  }
});

Deno.test("getFreshGoogleToken: a refresh that returns a new refresh token persists it", async () => {
  const db = createSupabaseQueryMock();
  db.queue("google_connections", "select", {
    data: { id: CONNECTION_ID, status: "active", encrypted_access_token: "old", access_token_expires_at: isoInMinutes(-1) },
  });
  db.queue("google_connections", "update", {
    data: { id: CONNECTION_ID, encrypted_refresh_token: await encryptGoogleToken("stored-refresh", "refresh") },
  });
  db.queue("google_connections", "update", { data: null });
  const f = stubFetch(() => jsonResponse({ access_token: "new-access", refresh_token: "rotated", expires_in: 3599 }));
  try {
    await getFreshGoogleToken(db as never, CONNECTION_ID);
    const persist = db.calls.filter((c) => c.operation === "update")[1].payload as Record<string, unknown>;
    assertEquals(await decryptGoogleToken(persist.encrypted_refresh_token as string, "refresh"), "rotated");
  } finally {
    f.restore();
  }
});

Deno.test("getFreshGoogleToken: invalid_grant calls google_mark_revoked, throws REVOKED, releases the lock", async () => {
  const db = createSupabaseQueryMock();
  db.queue("google_connections", "select", {
    data: { id: CONNECTION_ID, status: "active", encrypted_access_token: "old", access_token_expires_at: isoInMinutes(2) },
  });
  db.queue("google_connections", "update", {
    data: { id: CONNECTION_ID, encrypted_refresh_token: await encryptGoogleToken("dead-refresh", "refresh") },
  });
  db.queue("google_connections", "update", { data: null }); // lock release
  db.queueRpc("google_mark_revoked", { data: null, error: null });
  const f = stubFetch(() =>
    jsonResponse({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400),
  );
  try {
    const e = (await assertRejects(() => getFreshGoogleToken(db as never, CONNECTION_ID), GoogleApiError)) as GoogleApiError;
    assertEquals(e.code, "REVOKED");
    const rpc = db.calls.filter((c) => c.table === "rpc:google_mark_revoked");
    assertEquals(rpc.length, 1);
    assertEquals(rpc[0].payload, { p_connection_id: CONNECTION_ID });
    const updates = db.calls.filter((c) => c.operation === "update");
    assertEquals(updates.length, 2, "claim + ownership-guarded release");
    assertEquals((updates[1].payload as Record<string, unknown>).refresh_lock_at, null);
  } finally {
    f.restore();
  }
});

Deno.test("getFreshGoogleToken: another error from the token endpoint throws UPSTREAM and releases the lock", async () => {
  const db = createSupabaseQueryMock();
  db.queue("google_connections", "select", {
    data: { id: CONNECTION_ID, status: "active", encrypted_access_token: "old", access_token_expires_at: isoInMinutes(2) },
  });
  db.queue("google_connections", "update", {
    data: { id: CONNECTION_ID, encrypted_refresh_token: await encryptGoogleToken("r", "refresh") },
  });
  db.queue("google_connections", "update", { data: null });
  const f = stubFetch(() => jsonResponse({ error: "internal_failure" }, 503));
  try {
    const e = (await assertRejects(() => getFreshGoogleToken(db as never, CONNECTION_ID), GoogleApiError)) as GoogleApiError;
    assertEquals([e.code, e.retryable], ["UPSTREAM", true]);
    assertEquals(db.calls.filter((c) => c.table === "rpc:google_mark_revoked").length, 0);
    assertEquals(db.calls.filter((c) => c.operation === "update").length, 2);
  } finally {
    f.restore();
  }
});

Deno.test("getFreshGoogleToken: losing the claim polls the row instead of refreshing", async () => {
  const db = createSupabaseQueryMock();
  db.queue(
    "google_connections",
    "select",
    { data: { id: CONNECTION_ID, status: "active", encrypted_access_token: "old", access_token_expires_at: isoInMinutes(1) } },
    { data: { id: CONNECTION_ID, status: "active", encrypted_access_token: "old", access_token_expires_at: isoInMinutes(1) } },
    {
      data: {
        id: CONNECTION_ID,
        status: "active",
        encrypted_access_token: await encryptGoogleToken("refreshed-by-peer", "access"),
        access_token_expires_at: isoInMinutes(60),
      },
    },
  );
  db.queue("google_connections", "update", { data: null }); // claim lost
  const sleeps: number[] = [];
  const f = stubFetch(() => Promise.reject(new Error("must not call fetch")));
  try {
    const out = await getFreshGoogleToken(db as never, CONNECTION_ID, {
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
    });
    assertEquals(out, "refreshed-by-peer");
    assertEquals(sleeps.length, 2);
    assertEquals(f.captured.length, 0);
  } finally {
    f.restore();
  }
});

// ── Hardening: every helper failure stays inside GoogleApiError ────────────────

function brokenBodyResponse(status: number): Promise<Response> {
  const body = new ReadableStream({
    start(controller) {
      controller.error(new Error("connection dropped mid-body"));
    },
  });
  return Promise.resolve(new Response(body, { status }));
}

Deno.test("google-shared: a body-read failure becomes retryable UPSTREAM status 0 (googleFetch, exchange, refresh)", async () => {
  const f1 = stubFetch(() => brokenBodyResponse(200));
  try {
    const e = (await assertRejects(() => googleFetch("https://api.example/x", "tok"), GoogleApiError)) as GoogleApiError;
    assertEquals([e.code, e.status, e.retryable], ["UPSTREAM", 0, true]);
  } finally {
    f1.restore();
  }
  const f2 = stubFetch(() => brokenBodyResponse(200));
  try {
    const e = (await assertRejects(() => exchangeGoogleCode("c"), GoogleApiError)) as GoogleApiError;
    assertEquals([e.code, e.status, e.retryable], ["UPSTREAM", 0, true]);
  } finally {
    f2.restore();
  }
  const db = createSupabaseQueryMock();
  db.queue("google_connections", "select", {
    data: { id: CONNECTION_ID, status: "active", encrypted_access_token: "old", access_token_expires_at: isoInMinutes(1) },
  });
  db.queue("google_connections", "update", {
    data: { id: CONNECTION_ID, encrypted_refresh_token: await encryptGoogleToken("r", "refresh") },
  });
  db.queue("google_connections", "update", { data: null }); // lock release
  const f3 = stubFetch(() => brokenBodyResponse(200));
  try {
    const e = (await assertRejects(() => getFreshGoogleToken(db as never, CONNECTION_ID), GoogleApiError)) as GoogleApiError;
    assertEquals([e.code, e.status, e.retryable], ["UPSTREAM", 0, true]);
    assertEquals(db.calls.filter((c) => c.operation === "update").length, 2, "claim + guarded release");
  } finally {
    f3.restore();
  }
  const f4 = stubFetch(() => brokenBodyResponse(400));
  try {
    assertEquals(await revokeGoogleToken("t"), false, "revoke still never throws");
  } finally {
    f4.restore();
  }
});

Deno.test("getFreshGoogleToken: a select error is retryable UPSTREAM, not NOT_FOUND (initial read and poll)", async () => {
  const db = createSupabaseQueryMock();
  db.queue("google_connections", "select", { data: null, error: { message: "connection reset" } });
  const e = (await assertRejects(() => getFreshGoogleToken(db as never, CONNECTION_ID), GoogleApiError)) as GoogleApiError;
  assertEquals([e.code, e.retryable], ["UPSTREAM", true]);

  const polled = createSupabaseQueryMock();
  polled.queue(
    "google_connections",
    "select",
    { data: { id: CONNECTION_ID, status: "active", encrypted_access_token: "old", access_token_expires_at: isoInMinutes(1) } },
    { data: null, error: { message: "connection reset" } },
  );
  polled.queue("google_connections", "update", { data: null }); // claim lost
  const pe = (await assertRejects(
    () => getFreshGoogleToken(polled as never, CONNECTION_ID, { sleep: () => Promise.resolve() }),
    GoogleApiError,
  )) as GoogleApiError;
  assertEquals([pe.code, pe.retryable], ["UPSTREAM", true]);
});
