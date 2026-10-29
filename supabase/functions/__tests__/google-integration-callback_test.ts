// google-integration: GET /auth/:clientId and GET /callback. DI handler + createSupabaseQueryMock
// (tiktok-integration_test.ts's convention) and a routed globalThis.fetch stub, since
// _shared/google.ts calls the global fetch.
import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createGoogleIntegrationHandler } from "../google-integration/handlers.ts";
import { createGoogleState } from "../google-integration/oauth-state.ts";
import { decryptGoogleToken, GOOGLE_PRODUCT_SCOPES, type GoogleProduct } from "../_shared/google.ts";

Deno.env.set("TOKEN_ENCRYPTION_KEY", "test-google-integration-key-32ch");
Deno.env.set("GOOGLE_OAUTH_CLIENT_ID", "test-client-id");
Deno.env.set("GOOGLE_OAUTH_CLIENT_SECRET", "test-client-secret");
Deno.env.set("SUPABASE_URL", "https://proj.supabase.co");
Deno.env.delete("GOOGLE_REDIRECT_URI");
Deno.env.set("OAUTH_REDIRECT_BASE", "https://app.example.com");

const CONTA = "conta-1";
const USER = "user-1";
const CLIENT = 42;
const CONNECTION_ID = "6f1c1f0e-0000-4000-8000-000000000001";
const TARGET = `https://app.example.com/clientes/${CLIENT}/redes-sociais`;
const FN = "https://proj.supabase.co/functions/v1/google-integration";

type Mock = ReturnType<typeof createSupabaseQueryMock>;

function makeHandler(db: Mock) {
  return createGoogleIntegrationHandler({
    buildCorsHeaders: () => ({}),
    // deno-lint-ignore no-explicit-any
    createServiceDb: () => db as any,
  });
}

// ─── Fetch stub ─────────────────────────────────────────────────────────────────

const YT_SCOPE_STRING = ["openid", "https://www.googleapis.com/auth/userinfo.email", ...GOOGLE_PRODUCT_SCOPES.youtube].join(" ");
const GBP_SCOPE_STRING = ["openid", ...GOOGLE_PRODUCT_SCOPES.gbp].join(" ");

const CHANNEL = {
  id: "UC123",
  snippet: { title: "Canal X", customUrl: "@canalx", thumbnails: { default: { url: "https://yt3.ggpht.com/a.jpg" } } },
  statistics: { subscriberCount: "1500", hiddenSubscriberCount: false, viewCount: "99000", videoCount: "42" },
  contentDetails: { relatedPlaylists: { uploads: "UU123" } },
};

interface StubOpts {
  token?: Record<string, unknown>;
  channels?: unknown;
  userinfo?: Record<string, unknown>;
}

function stubGoogle(opts: StubOpts = {}) {
  const original = globalThis.fetch;
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = ((input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const ok = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    if (url === "https://oauth2.googleapis.com/token") {
      return ok(opts.token ?? { access_token: "at-1", refresh_token: "rt-1", expires_in: 3599, scope: YT_SCOPE_STRING });
    }
    if (url === "https://openidconnect.googleapis.com/v1/userinfo") {
      return ok(opts.userinfo ?? { sub: "sub-1", email: "agencia@example.com", name: "Agência" });
    }
    if (url === "https://oauth2.googleapis.com/revoke") return Promise.resolve(new Response("", { status: 200 }));
    if (url.startsWith("https://www.googleapis.com/youtube/v3/channels")) {
      return ok(opts.channels ?? { items: [CHANNEL] });
    }
    return Promise.reject(new Error(`unexpected fetch ${url}`));
  }) as typeof fetch;
  return {
    calls,
    count: (prefix: string) => calls.filter((c) => c.url.startsWith(prefix)).length,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function authedDb(): Mock {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: USER });
  db.queue("profiles", "select", { data: { active_workspace_id: CONTA } });
  db.queue("workspace_members", "select", { data: { user_id: USER } });
  return db;
}

function authRequest(path: string): Request {
  return new Request(`${FN}${path}`, { headers: { Authorization: "Bearer jwt-1" } });
}

async function mintState(product: GoogleProduct, consentRetry = false): Promise<string> {
  const mint = createSupabaseQueryMock();
  mint.queue("oauth_states", "delete", { data: null });
  mint.queue("oauth_states", "insert", { data: null });
  return createGoogleState(
    { clientId: String(CLIENT), userId: USER, contaId: CONTA, product, consentRetry },
    // deno-lint-ignore no-explicit-any
    mint as any,
  );
}

/** Callback db: nonce consumed + client still in the workspace. */
function callbackDb(clientInTenant = true): Mock {
  const db = createSupabaseQueryMock();
  db.queue("oauth_states", "update", { data: { id: "state-row" } });
  db.queue("clientes", "select", { data: clientInTenant ? { id: CLIENT, nome: "Cliente A" } : null });
  return db;
}

function callbackRequest(state: string, extra = "code=code-1"): Request {
  return new Request(`${FN}/callback?${extra}&state=${encodeURIComponent(state)}`);
}

function rpcCalls(db: Mock, name: string) {
  return db.calls.filter((c) => c.table === `rpc:${name}`);
}

// ─── GET /auth/:clientId ────────────────────────────────────────────────────────

Deno.test("auth_requires_flag: flag off returns 403 feature_disabled", async () => {
  const db = authedDb();
  db.queue("clientes", "select", { data: { id: CLIENT, nome: "Cliente A" } });
  db.queueRpc("effective_plan_feature", { data: false });
  const res = await makeHandler(db)(authRequest(`/auth/${CLIENT}?product=youtube`));
  assertEquals(res.status, 403);
  assertEquals(await res.json(), { error: "feature_disabled", feature: "feature_youtube" });
  assertEquals(rpcCalls(db, "effective_plan_feature")[0].payload, { ws_id: CONTA, feature_key: "feature_youtube" });

  const gbp = authedDb();
  gbp.queue("clientes", "select", { data: { id: CLIENT, nome: "Cliente A" } });
  gbp.queueRpc("effective_plan_feature", { data: false });
  const gres = await makeHandler(gbp)(authRequest(`/auth/${CLIENT}?product=gbp`));
  assertEquals(await gres.json(), { error: "feature_disabled", feature: "feature_google_business" });
});

Deno.test("auth_other_workspace_client: client outside the tenant returns 404", async () => {
  const db = authedDb();
  db.queue("clientes", "select", { data: null });
  const res = await makeHandler(db)(authRequest(`/auth/${CLIENT}?product=youtube`));
  assertEquals(res.status, 404);
  const clientQuery = db.calls.find((c) => c.table === "clientes")!;
  const filters = clientQuery.modifiers.map((m) => `${m.method}:${m.args[0]}:${m.args[1]}`);
  assert(filters.includes(`eq:conta_id:${CONTA}`), `client must be scoped to the tenant: ${filters}`);
  assertEquals(rpcCalls(db, "effective_plan_feature").length, 0);
});

Deno.test("auth_url_shape: 200 with the Google URL (select_account, YouTube scopes, state row)", async () => {
  const db = authedDb();
  db.queue("clientes", "select", { data: { id: CLIENT, nome: "Cliente A" } });
  db.queueRpc("effective_plan_feature", { data: true });
  const res = await makeHandler(db)(authRequest(`/auth/${CLIENT}?product=youtube`));
  assertEquals(res.status, 200);
  const { url } = await res.json();
  const u = new URL(url);
  assertEquals(`${u.origin}${u.pathname}`, "https://accounts.google.com/o/oauth2/v2/auth");
  assertEquals(u.searchParams.get("prompt"), "select_account");
  assertEquals(u.searchParams.get("redirect_uri"), `${FN}/callback`);
  const scopes = u.searchParams.get("scope")!.split(" ");
  for (const s of GOOGLE_PRODUCT_SCOPES.youtube) assert(scopes.includes(s), `missing ${s}`);
  const insert = db.calls.find((c) => c.table === "oauth_states" && c.operation === "insert")!;
  assertEquals((insert.payload as Record<string, unknown>).provider, "google");
});

Deno.test("auth_invalid_product: unknown or missing product returns 400 invalid_product", async () => {
  const res = await makeHandler(authedDb())(authRequest(`/auth/${CLIENT}?product=tiktok`));
  assertEquals(res.status, 400);
  assertEquals(await res.json(), { error: "invalid_product" });
  const missing = await makeHandler(authedDb())(authRequest(`/auth/${CLIENT}`));
  assertEquals(missing.status, 400);
  // The edge runtime's own path shape (no /functions/v1 prefix) routes the same.
  const edge = await makeHandler(authedDb())(
    new Request(`https://edge.local/google-integration/auth/${CLIENT}?product=tiktok`, {
      headers: { Authorization: "Bearer jwt-1" },
    }),
  );
  assertEquals(await edge.json(), { error: "invalid_product" });
});

Deno.test("auth_extra_segments: /auth/:clientId/anything returns 404", async () => {
  const db = authedDb();
  const res = await makeHandler(db)(authRequest(`/auth/${CLIENT}/anything?product=youtube`));
  assertEquals(res.status, 404);
  assertEquals(db.calls.filter((c) => c.table === "oauth_states").length, 0);
});

Deno.test("auth_requires_tenant: no JWT or no membership returns 401", async () => {
  const anon = await makeHandler(createSupabaseQueryMock())(new Request(`${FN}/auth/${CLIENT}?product=youtube`));
  assertEquals(anon.status, 401);
  const db = createSupabaseQueryMock();
  db.withAuth({ id: USER });
  db.queue("profiles", "select", { data: { active_workspace_id: CONTA } });
  db.queue("workspace_members", "select", { data: null });
  const res = await makeHandler(db)(authRequest(`/auth/${CLIENT}?product=youtube`));
  assertEquals(res.status, 401);
});

// ─── GET /callback ──────────────────────────────────────────────────────────────

Deno.test("callback_missing_scope: partial grant with no connection for the sub is revoked, redirects missing_scope", async () => {
  const state = await mintState("youtube");
  const db = callbackDb();
  db.queue("google_connections", "select", { data: [] });
  const f = stubGoogle({
    token: { access_token: "at-1", refresh_token: "rt-1", expires_in: 3599, scope: "openid https://www.googleapis.com/auth/youtube.readonly" },
  });
  try {
    const res = await makeHandler(db)(callbackRequest(state));
    assertEquals(res.status, 302);
    assertEquals(res.headers.get("Location"), `${TARGET}?yt_error=missing_scope`);
    assertEquals(f.count("https://oauth2.googleapis.com/revoke"), 1);
    const revoke = f.calls.find((c) => c.url === "https://oauth2.googleapis.com/revoke")!;
    assertEquals(new URLSearchParams(String(revoke.init?.body)).get("token"), "rt-1");
    assertEquals(rpcCalls(db, "google_connection_upsert").length, 0);
    const lookup = db.calls.find((c) => c.table === "google_connections")!;
    assert(
      lookup.modifiers.some((m) => m.method === "eq" && m.args[0] === "google_sub" && m.args[1] === "sub-1"),
      "lookup must be by google_sub across workspaces",
    );
    assert(!lookup.modifiers.some((m) => m.args[0] === "conta_id"), "lookup must not be scoped to one workspace");
  } finally {
    f.restore();
  }
});

Deno.test("callback_missing_scope_in_use: a connection row for the sub (any workspace) skips the revoke", async () => {
  const state = await mintState("youtube");
  const db = callbackDb();
  db.queue("google_connections", "select", { data: [{ id: "other-conn" }] });
  const f = stubGoogle({
    token: { access_token: "at-1", refresh_token: "rt-1", expires_in: 3599, scope: "openid https://www.googleapis.com/auth/youtube.readonly" },
  });
  try {
    const res = await makeHandler(db)(callbackRequest(state));
    assertEquals(res.headers.get("Location"), `${TARGET}?yt_error=missing_scope`);
    assertEquals(f.count("https://oauth2.googleapis.com/revoke"), 0);
  } finally {
    f.restore();
  }
});

Deno.test("callback_missing_scope_lookup_error: a failed connection lookup skips the revoke", async () => {
  const state = await mintState("youtube");
  const db = callbackDb();
  db.queue("google_connections", "select", { data: null, error: { message: "timeout" } });
  const f = stubGoogle({
    token: { access_token: "at-1", refresh_token: "rt-1", expires_in: 3599, scope: "openid https://www.googleapis.com/auth/youtube.readonly" },
  });
  try {
    const res = await makeHandler(db)(callbackRequest(state));
    assertEquals(res.headers.get("Location"), `${TARGET}?yt_error=missing_scope`);
    assertEquals(f.count("https://oauth2.googleapis.com/revoke"), 0);
  } finally {
    f.restore();
  }
});

Deno.test("callback_no_email: userinfo without email (unticked on consent) -> missing_scope, unused grant revoked", async () => {
  const state = await mintState("youtube");
  const db = callbackDb();
  db.queue("google_connections", "select", { data: [] });
  const f = stubGoogle({ userinfo: { sub: "sub-1", name: "Agência" } });
  try {
    const res = await makeHandler(db)(callbackRequest(state));
    assertEquals(res.status, 302);
    assertEquals(res.headers.get("Location"), `${TARGET}?yt_error=missing_scope`);
    assertEquals(f.count("https://oauth2.googleapis.com/revoke"), 1);
    const revoke = f.calls.find((c) => c.url === "https://oauth2.googleapis.com/revoke")!;
    assertEquals(new URLSearchParams(String(revoke.init?.body)).get("token"), "rt-1");
    assertEquals(f.count("https://www.googleapis.com/youtube/v3/channels"), 0, "no product call");
    assertEquals(rpcCalls(db, "google_connection_upsert").length, 0);
    const lookup = db.calls.find((c) => c.table === "google_connections")!;
    assert(lookup.modifiers.some((m) => m.method === "eq" && m.args[0] === "google_sub" && m.args[1] === "sub-1"));
  } finally {
    f.restore();
  }

  // The same Google account already backs a connection: R9a keeps the grant.
  const state2 = await mintState("gbp");
  const used = callbackDb();
  used.queue("google_connections", "select", { data: [{ id: "other-conn" }] });
  const f2 = stubGoogle({
    token: { access_token: "at-1", refresh_token: "rt-1", expires_in: 3599, scope: GBP_SCOPE_STRING },
    userinfo: { sub: "sub-1" },
  });
  try {
    const res = await makeHandler(used)(callbackRequest(state2));
    assertEquals(res.headers.get("Location"), `${TARGET}?gmn_error=missing_scope`);
    assertEquals(f2.count("https://oauth2.googleapis.com/revoke"), 0);
    assertEquals(rpcCalls(used, "google_connection_upsert").length, 0);
  } finally {
    f2.restore();
  }
});

Deno.test("callback_client_gone: client no longer in the workspace redirects unknown, no token exchange", async () => {
  const state = await mintState("youtube");
  const db = callbackDb(false);
  const f = stubGoogle();
  try {
    const res = await makeHandler(db)(callbackRequest(state));
    assertEquals(res.status, 302);
    assertEquals(res.headers.get("Location"), `${TARGET}?yt_error=unknown`);
    assertEquals(f.calls.length, 0);
  } finally {
    f.restore();
  }
});

Deno.test("callback_denied: Google error=access_denied redirects denied without a token exchange", async () => {
  const state = await mintState("gbp");
  const f = stubGoogle();
  try {
    const res = await makeHandler(callbackDb())(callbackRequest(state, "error=access_denied"));
    assertEquals(res.headers.get("Location"), `${TARGET}?gmn_error=denied`);
    assertEquals(f.calls.length, 0);
  } finally {
    f.restore();
  }
});

Deno.test("callback_gbp_with_youtube_only_refresh: GMN, no refresh token, stored token lacks business.manage -> consent", async () => {
  const state = await mintState("gbp");
  const db = callbackDb();
  db.queueRpc("google_connection_refresh_covers", { data: false });
  db.queue("oauth_states", "delete", { data: null });
  db.queue("oauth_states", "insert", { data: null });
  const f = stubGoogle({ token: { access_token: "at-1", expires_in: 3599, scope: GBP_SCOPE_STRING } });
  try {
    const res = await makeHandler(db)(callbackRequest(state));
    assertEquals(res.status, 302);
    const loc = new URL(res.headers.get("Location")!);
    assertEquals(`${loc.origin}${loc.pathname}`, "https://accounts.google.com/o/oauth2/v2/auth");
    assertEquals(loc.searchParams.get("prompt"), "consent");
    assertEquals(rpcCalls(db, "google_connection_refresh_covers")[0].payload, {
      p_conta_id: CONTA,
      p_sub: "sub-1",
      p_scopes: GOOGLE_PRODUCT_SCOPES.gbp,
    });
    assertEquals(rpcCalls(db, "google_connection_upsert").length, 0);
  } finally {
    f.restore();
  }
});

Deno.test("callback_no_refresh_retries_once: consent retry first, then no_refresh_token", async () => {
  const first = await mintState("youtube", false);
  const db = callbackDb();
  db.queueRpc("google_connection_refresh_covers", { data: false });
  db.queue("oauth_states", "delete", { data: null });
  db.queue("oauth_states", "insert", { data: null });
  const f = stubGoogle({ token: { access_token: "at-1", expires_in: 3599, scope: YT_SCOPE_STRING } });
  try {
    const res = await makeHandler(db)(callbackRequest(first));
    const loc = new URL(res.headers.get("Location")!);
    assertEquals(loc.searchParams.get("prompt"), "consent");
    const newState = db.calls.find((c) => c.table === "oauth_states" && c.operation === "insert");
    assert(newState, "a fresh state row must be minted for the retry");

    const retry = await mintState("youtube", true);
    const db2 = callbackDb();
    db2.queueRpc("google_connection_refresh_covers", { data: false });
    const res2 = await makeHandler(db2)(callbackRequest(retry));
    assertEquals(res2.headers.get("Location"), `${TARGET}?yt_error=no_refresh_token`);
    assertEquals(rpcCalls(db2, "google_connection_upsert").length, 0);
  } finally {
    f.restore();
  }
});

Deno.test("callback_no_refresh_but_stored: refresh_covers true upserts with p_refresh_enc null and continues", async () => {
  const state = await mintState("youtube");
  const db = callbackDb();
  db.queueRpc("google_connection_refresh_covers", { data: true });
  db.queueRpc("google_connection_upsert", { data: CONNECTION_ID });
  db.queue("youtube_channels", "upsert", { data: null });
  const f = stubGoogle({ token: { access_token: "at-1", expires_in: 3599, scope: YT_SCOPE_STRING } });
  try {
    const res = await makeHandler(db)(callbackRequest(state));
    assertEquals(res.headers.get("Location"), `${TARGET}?yt_connected=1`);
    const upsert = rpcCalls(db, "google_connection_upsert")[0].payload as Record<string, unknown>;
    assertEquals(upsert.p_refresh_enc, null);
  } finally {
    f.restore();
  }
});

Deno.test("callback_youtube_success: upserts the connection and the channel, audits, yt_connected=1", async () => {
  const state = await mintState("youtube");
  const db = callbackDb();
  db.queueRpc("google_connection_upsert", { data: CONNECTION_ID });
  db.queue("youtube_channels", "upsert", { data: null });
  const f = stubGoogle({
    channels: {
      items: [{ ...CHANNEL, statistics: { ...CHANNEL.statistics, hiddenSubscriberCount: true } }],
    },
  });
  try {
    const res = await makeHandler(db)(callbackRequest(state));
    assertEquals(res.status, 302);
    assertEquals(res.headers.get("Location"), `${TARGET}?yt_connected=1`);

    const tokenCall = f.calls.find((c) => c.url === "https://oauth2.googleapis.com/token")!;
    assertEquals(new URLSearchParams(String(tokenCall.init?.body)).get("redirect_uri"), `${FN}/callback`);
    const ytCall = f.calls.find((c) => c.url.startsWith("https://www.googleapis.com/youtube/v3/channels"))!;
    assertEquals(ytCall.url, "https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics,contentDetails&mine=true");
    assertEquals(new Headers(ytCall.init?.headers).get("Authorization"), "Bearer at-1");

    const up = rpcCalls(db, "google_connection_upsert")[0].payload as Record<string, unknown>;
    assertEquals(up.p_conta_id, CONTA);
    assertEquals(up.p_sub, "sub-1");
    assertEquals(up.p_email, "agencia@example.com");
    assertEquals(up.p_display_name, "Agência");
    assertEquals(await decryptGoogleToken(up.p_access_enc as string, "access"), "at-1");
    assertEquals(await decryptGoogleToken(up.p_refresh_enc as string, "refresh"), "rt-1");
    assertEquals(up.p_scopes, YT_SCOPE_STRING.split(" "));
    assert(typeof up.p_expires_at === "string");
    assertEquals(rpcCalls(db, "google_connection_refresh_covers").length, 0, "refresh token present: no covers check");

    const channel = db.calls.find((c) => c.table === "youtube_channels" && c.operation === "upsert")!;
    const row = channel.payload as Record<string, unknown>;
    assertEquals(row.conta_id, CONTA);
    assertEquals(row.client_id, CLIENT);
    assertEquals(row.connection_id, CONNECTION_ID);
    assertEquals(row.channel_id, "UC123");
    assertEquals(row.title, "Canal X");
    assertEquals(row.handle, "@canalx");
    assertEquals(row.avatar_url, "https://yt3.ggpht.com/a.jpg");
    assertEquals(row.uploads_playlist_id, "UU123");
    assertEquals(row.subscriber_count, null, "hidden subscriber count is stored as null");
    assertEquals(row.view_count, 99000);
    assertEquals(row.video_count, 42);
    assertEquals(row.authorization_status, "active");
    assertEquals((channel.options as Record<string, unknown>).onConflict, "client_id");

    const audit = db.calls.find((c) => c.table === "audit_log" && c.operation === "insert")!;
    const entry = audit.payload as Record<string, unknown>;
    assertEquals(entry.action, "google-connect");
    assertEquals(entry.resource_type, "google_connection");
    assertEquals(entry.conta_id, CONTA);
    assertEquals(entry.metadata, { product: "youtube", client_id: CLIENT });
  } finally {
    f.restore();
  }
});

Deno.test("callback_no_channel: no channel redirects no_channel before any write, revokes an unused grant", async () => {
  const state = await mintState("youtube");
  const db = callbackDb();
  db.queue("google_connections", "select", { data: [] });
  const f = stubGoogle({ channels: { items: [] } });
  try {
    const res = await makeHandler(db)(callbackRequest(state));
    assertEquals(res.headers.get("Location"), `${TARGET}?yt_error=no_channel`);
    assertEquals(db.calls.filter((c) => c.table === "youtube_channels").length, 0);
    assertEquals(rpcCalls(db, "google_connection_upsert").length, 0, "no connection row for a failed product step");
    assertEquals(f.count("https://oauth2.googleapis.com/revoke"), 1);
  } finally {
    f.restore();
  }

  const used = callbackDb();
  used.queue("google_connections", "select", { data: [{ id: "conn-elsewhere" }] });
  const f2 = stubGoogle({ channels: { items: [] } });
  try {
    const res = await makeHandler(used)(callbackRequest(await mintState("youtube")));
    assertEquals(res.headers.get("Location"), `${TARGET}?yt_error=no_channel`);
    assertEquals(f2.count("https://oauth2.googleapis.com/revoke"), 0, "grant in use elsewhere is kept");
  } finally {
    f2.restore();
  }
});

Deno.test("callback_channel_in_use: pre-check names the other client before any write, revokes an unused grant", async () => {
  const state = await mintState("youtube");
  const db = callbackDb();
  db.queue("youtube_channels", "select", { data: [{ client_id: 7 }] });
  db.queue("clientes", "select", { data: { id: 7, nome: "Clínica X" } });
  db.queue("google_connections", "select", { data: [] });
  const f = stubGoogle();
  try {
    const res = await makeHandler(db)(callbackRequest(state));
    assertEquals(res.status, 302);
    assertEquals(res.headers.get("Location"), `${TARGET}?yt_error=channel_in_use&yt_other=Cl%C3%ADnica%20X`);
    assertEquals(rpcCalls(db, "google_connection_upsert").length, 0);
    assertEquals(db.calls.filter((c) => c.table === "youtube_channels" && c.operation === "upsert").length, 0);
    assertEquals(db.calls.filter((c) => c.table === "audit_log").length, 0);
    assertEquals(f.count("https://oauth2.googleapis.com/revoke"), 1);

    const lookup = db.calls.find((c) => c.table === "youtube_channels" && c.operation === "select")!;
    const filters = lookup.modifiers.map((m) => `${m.method}:${m.args[0]}:${m.args[1]}`);
    assert(filters.includes(`eq:conta_id:${CONTA}`), `collision lookup must be tenant-scoped: ${filters}`);
    assert(filters.includes("eq:channel_id:UC123"), `channel filter missing: ${filters}`);
    assert(filters.includes(`neq:client_id:${CLIENT}`), `own client must be excluded: ${filters}`);
    const nameLookup = db.calls.filter((c) => c.table === "clientes")[1];
    assert(
      nameLookup.modifiers.some((m) => m.method === "eq" && m.args[0] === "conta_id" && m.args[1] === CONTA),
      "other client's name must be read inside the tenant",
    );
  } finally {
    f.restore();
  }
});

Deno.test("callback_channel_in_use_race: 23505 on the channel upsert still names the other client, no revoke", async () => {
  const state = await mintState("youtube");
  const db = callbackDb();
  db.queue("youtube_channels", "select", { data: [] }, { data: { client_id: 7 } });
  db.queueRpc("google_connection_upsert", { data: CONNECTION_ID });
  db.queue("youtube_channels", "upsert", { data: null, error: { code: "23505", message: "duplicate key" } });
  db.queue("clientes", "select", { data: { id: 7, nome: "Clínica X" } });
  const f = stubGoogle();
  try {
    const res = await makeHandler(db)(callbackRequest(state));
    assertEquals(res.headers.get("Location"), `${TARGET}?yt_error=channel_in_use&yt_other=Cl%C3%ADnica%20X`);
    assertEquals(f.count("https://oauth2.googleapis.com/revoke"), 0, "the connection row now exists: keep the grant");
    const backstop = db.calls.filter((c) => c.table === "youtube_channels" && c.operation === "select")[1];
    assert(backstop.modifiers.some((m) => m.method === "eq" && m.args[0] === "conta_id" && m.args[1] === CONTA));
  } finally {
    f.restore();
  }
});

Deno.test("callback_gbp_redirects_to_picker: GMN success redirects gbp_pick=<connectionId>", async () => {
  const state = await mintState("gbp");
  const db = callbackDb();
  db.queueRpc("google_connection_upsert", { data: CONNECTION_ID });
  const f = stubGoogle({ token: { access_token: "at-1", refresh_token: "rt-1", expires_in: 3599, scope: GBP_SCOPE_STRING } });
  try {
    const res = await makeHandler(db)(callbackRequest(state));
    assertEquals(res.status, 302);
    assertEquals(res.headers.get("Location"), `${TARGET}?gbp_pick=${CONNECTION_ID}`);
    assertEquals(f.count("https://www.googleapis.com/youtube"), 0);
    const audit = db.calls.find((c) => c.table === "audit_log")!;
    assertEquals((audit.payload as Record<string, unknown>).metadata, { product: "gbp", client_id: CLIENT });
  } finally {
    f.restore();
  }
});

Deno.test("callback_upstream_failure: an unexpected error after the state verified redirects unknown", async () => {
  const state = await mintState("gbp");
  const db = callbackDb();
  db.queueRpc("google_connection_upsert", { data: null, error: { message: "boom" } });
  const f = stubGoogle({ token: { access_token: "at-1", refresh_token: "rt-1", expires_in: 3599, scope: GBP_SCOPE_STRING } });
  try {
    const res = await makeHandler(db)(callbackRequest(state));
    assertEquals(res.headers.get("Location"), `${TARGET}?gmn_error=unknown`);
  } finally {
    f.restore();
  }
});

Deno.test("callback_replayed_state: a consumed nonce returns 400 text, no token exchange", async () => {
  const state = await mintState("youtube");
  const db = createSupabaseQueryMock();
  db.queue("oauth_states", "update", { data: null }); // already consumed
  const f = stubGoogle();
  try {
    const res = await makeHandler(db)(callbackRequest(state));
    assertEquals(res.status, 400);
    assertEquals(await res.text(), "Link inválido ou expirado");
    assertEquals(res.headers.get("Location"), null);
    assertEquals(f.calls.length, 0);
  } finally {
    f.restore();
  }
  const garbage = await makeHandler(createSupabaseQueryMock())(callbackRequest("not-a-state"));
  assertEquals(garbage.status, 400);
});
