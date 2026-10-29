// google-integration: GET /summary, GET|POST /locations, POST /disconnect/youtube. DI handler +
// createSupabaseQueryMock and a routed globalThis.fetch stub (google-integration-callback_test.ts's
// conventions). The SQL RPCs (unlink, rate limit, flags) are mocked by name.
import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createGoogleIntegrationHandler } from "../google-integration/handlers.ts";
import { listEligibleLocations, listGbpLocations } from "../google-integration/locations.ts";
import { encryptGoogleToken } from "../_shared/google.ts";

Deno.env.set("TOKEN_ENCRYPTION_KEY", "test-google-routes-key-32chars!!");
Deno.env.set("GOOGLE_OAUTH_CLIENT_ID", "test-client-id");
Deno.env.set("GOOGLE_OAUTH_CLIENT_SECRET", "test-client-secret");
Deno.env.set("SUPABASE_URL", "https://proj.supabase.co");

const CONTA = "conta-1";
const USER = "user-1";
const CLIENT = 42;
const CONN_1 = "11111111-1111-4111-8111-111111111111";
const CONN_2 = "22222222-2222-4222-8222-222222222222";
const FN = "https://proj.supabase.co/functions/v1/google-integration";
const ACCOUNTS_URL = "https://mybusinessaccountmanagement.googleapis.com/v1/accounts";
const BI_BASE = "https://mybusinessbusinessinformation.googleapis.com/v1/";

type Mock = ReturnType<typeof createSupabaseQueryMock>;

function makeHandler(db: Mock) {
  return createGoogleIntegrationHandler({
    buildCorsHeaders: () => ({}),
    // deno-lint-ignore no-explicit-any
    createServiceDb: () => db as any,
  });
}

/** Tenant + client in tenant (flags/rate limit default to allowed via the mock's rpc default). */
function routeDb(): Mock {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: USER });
  db.queue("profiles", "select", { data: { active_workspace_id: CONTA } });
  db.queue("workspace_members", "select", { data: { user_id: USER } });
  db.queue("clientes", "select", { data: { id: CLIENT, nome: "Cliente A" } });
  return db;
}

/** Connection-in-tenant check + a fresh token for getFreshGoogleToken. */
async function queueConnection(db: Mock, id = CONN_1) {
  db.queue(
    "google_connections",
    "select",
    { data: { id, status: "active" } },
    {
      data: {
        id,
        status: "active",
        encrypted_access_token: await encryptGoogleToken("gbp-access", "access"),
        access_token_expires_at: new Date(Date.now() + 3600_000).toISOString(),
      },
    },
  );
}

function req(method: string, path: string, body?: unknown): Request {
  return new Request(`${FN}${path}`, {
    method,
    headers: { Authorization: "Bearer jwt-1", "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function gbpWrites(db: Mock) {
  return db.calls.filter((c) => c.table === "gbp_locations" && c.operation !== "select");
}

function rpcCalls(db: Mock, name: string) {
  return db.calls.filter((c) => c.table === `rpc:${name}`);
}

function loc(id: string, title: string, voice = true) {
  return {
    name: `locations/${id}`,
    title,
    storefrontAddress: { addressLines: [`Rua ${id}, 10`], locality: "São Paulo" },
    websiteUri: `https://${id}.example.com`,
    metadata: { hasVoiceOfMerchant: voice },
  };
}

interface GoogleStub {
  accounts?: unknown[];
  /** account name -> locations */
  locations?: Record<string, unknown[]>;
  /** status + body returned by the Business Information call */
  biError?: { status: number; body: unknown };
  revokeStatus?: number;
}

function stubGoogle(opts: GoogleStub = {}) {
  const original = globalThis.fetch;
  const calls: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = ((input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    const respond = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
    if (url.startsWith(ACCOUNTS_URL)) {
      return respond({ accounts: opts.accounts ?? [{ name: "accounts/1" }] });
    }
    if (url.startsWith(BI_BASE)) {
      if (opts.biError) return respond(opts.biError.body, opts.biError.status);
      const account = url.slice(BI_BASE.length).split("/locations")[0];
      return respond({ locations: opts.locations?.[account] ?? [] });
    }
    if (url === "https://oauth2.googleapis.com/revoke") {
      return Promise.resolve(new Response("", { status: opts.revokeStatus ?? 200 }));
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

// ─── listEligibleLocations ──────────────────────────────────────────────────────

Deno.test("listEligibleLocations: follows account and location pages, readMask, dedupes by name", async () => {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = ((input: string | URL) => {
    const url = String(input);
    urls.push(url);
    const ok = (b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: 200 }));
    if (url === ACCOUNTS_URL) return ok({ accounts: [{ name: "accounts/1" }], nextPageToken: "p2" });
    if (url === `${ACCOUNTS_URL}?pageToken=p2`) return ok({ accounts: [{ name: "accounts/2" }] });
    if (url.startsWith(`${BI_BASE}accounts/1/locations`)) {
      if (url.includes("pageToken=l2")) return ok({ locations: [loc("b", "B")] });
      return ok({ locations: [loc("a", "A")], nextPageToken: "l2" });
    }
    if (url.startsWith(`${BI_BASE}accounts/2/locations`)) return ok({ locations: [loc("b", "B dup"), { name: "locations/c" }] });
    return Promise.reject(new Error(`unexpected ${url}`));
  }) as typeof fetch;
  try {
    const out = await listEligibleLocations("tok");
    assertEquals(out.map((o) => [o.locationName, o.accountName, o.title]), [
      ["locations/a", "accounts/1", "A"],
      ["locations/b", "accounts/1", "B"],
      ["locations/c", "accounts/2", "locations/c"],
    ]);
    assertEquals(out[0].addressLine, "Rua a, 10, São Paulo");
    assertEquals(out[0].website, "https://a.example.com");
    assertEquals(out[0].hasVoiceOfMerchant, true);
    assertEquals([out[2].addressLine, out[2].website, out[2].hasVoiceOfMerchant], [null, null, false]);
    const first = new URL(urls.find((u) => u.startsWith(`${BI_BASE}accounts/1/locations`))!);
    assertEquals(first.searchParams.get("readMask"), "name,title,storefrontAddress,websiteUri,metadata");
    assertEquals(first.searchParams.get("pageSize"), "100");
  } finally {
    globalThis.fetch = original;
  }
});

// ─── GET /summary/:clientId ─────────────────────────────────────────────────────

Deno.test("summary_shapes: both halves from rows; flag off nulls that half", async () => {
  const db = routeDb();
  db.queueRpc("effective_plan_feature", { data: true }, { data: true });
  db.queue("youtube_channels", "select", {
    data: {
      channel_id: "UC1",
      title: "Canal",
      handle: "@canal",
      avatar_url: "https://yt3/a.jpg",
      subscriber_count: 10,
      view_count: 20,
      video_count: 3,
      authorization_status: "active",
      last_synced_at: null,
      connection_id: CONN_1,
    },
  });
  db.queue(
    "google_connections",
    "select",
    { data: { email: "yt@example.com" } },
    {
      data: [
        { id: CONN_1, email: "a@example.com", status: "active" },
        { id: CONN_2, email: "b@example.com", status: "revoked" },
      ],
    },
  );
  db.queue("gbp_locations", "select", {
    data: [
      { id: "loc-1", title: "Loja", address_line: "Rua 1", average_rating: 4.5, total_review_count: 12, status: "active" },
    ],
  });
  const res = await makeHandler(db)(req("GET", `/summary/${CLIENT}`));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    youtube: {
      channelId: "UC1",
      title: "Canal",
      handle: "@canal",
      avatarUrl: "https://yt3/a.jpg",
      subscriberCount: 10,
      viewCount: 20,
      videoCount: 3,
      authorizationStatus: "active",
      connectionEmail: "yt@example.com",
      lastSyncedAt: null,
    },
    gmn: {
      locations: [{ id: "loc-1", title: "Loja", addressLine: "Rua 1", averageRating: 4.5, totalReviewCount: 12, status: "active" }],
      connections: [
        { id: CONN_1, email: "a@example.com", status: "active" },
        { id: CONN_2, email: "b@example.com", status: "revoked" },
      ],
    },
  });
  const conns = db.calls.filter((c) => c.table === "google_connections")[1];
  assert(
    conns.modifiers.some((m) => m.method === "contains" && JSON.stringify(m.args[1]).includes("business.manage")),
    "connections must be filtered to business.manage",
  );
  assert(conns.modifiers.some((m) => m.method === "eq" && m.args[0] === "conta_id" && m.args[1] === CONTA));

  const off = routeDb();
  off.queueRpc("effective_plan_feature", { data: true }, { data: false });
  off.queue("youtube_channels", "select", { data: null });
  const offRes = await makeHandler(off)(req("GET", `/summary/${CLIENT}`));
  const body = await offRes.json();
  assertEquals(body, { youtube: null, gmn: null });
  assertEquals(off.calls.filter((c) => c.table === "gbp_locations").length, 0, "flag off must not read GMN rows");
});

// ─── GET /locations/:clientId ───────────────────────────────────────────────────

Deno.test("locations_other_workspace_connection_404: foreign connection -> 404, zero fetches", async () => {
  const db = routeDb();
  db.queue("google_connections", "select", { data: null });
  const f = stubGoogle();
  try {
    const res = await makeHandler(db)(req("GET", `/locations/${CLIENT}?connection=${CONN_2}`));
    assertEquals(res.status, 404);
    assertEquals(f.calls.length, 0);
    const q = db.calls.find((c) => c.table === "google_connections")!;
    assert(q.modifiers.some((m) => m.method === "eq" && m.args[0] === "conta_id" && m.args[1] === CONTA));
  } finally {
    f.restore();
  }
});

Deno.test("locations_eligibility: voice-of-merchant and other-client links decide eligible; duplicates collapse", async () => {
  const db = routeDb();
  await queueConnection(db);
  db.queue("gbp_locations", "select", {
    data: [
      { location_name: "locations/c", client_id: 7, connection_id: CONN_1, status: "active" },
      { location_name: "locations/a", client_id: CLIENT, connection_id: CONN_1, status: "active" },
      { location_name: "locations/d", client_id: CLIENT, connection_id: CONN_1, status: "active" },
      { location_name: "locations/not-listed", client_id: 9, connection_id: CONN_2, status: "active" },
    ],
  });
  db.queue("clientes", "select", { data: [{ id: 7, nome: "Clínica X" }, { id: CLIENT, nome: "Cliente A" }] });
  const f = stubGoogle({
    accounts: [{ name: "accounts/1" }, { name: "accounts/2" }],
    locations: {
      "accounts/1": [loc("a", "A"), loc("b", "B", false), loc("c", "C"), loc("d", "D kept", false)],
      "accounts/2": [loc("a", "A again")],
    },
  });
  try {
    const res = await makeHandler(db)(req("GET", `/locations/${CLIENT}?connection=${CONN_1}`));
    assertEquals(res.status, 200);
    const { options } = await res.json();
    assertEquals(options.length, 4, "the duplicate from accounts/2 collapses");
    const byName = Object.fromEntries(options.map((o: Record<string, unknown>) => [o.locationName, o]));
    assertEquals(byName["locations/a"].accountName, "accounts/1");
    assertEquals([byName["locations/a"].eligible, byName["locations/a"].linkedClientId], [true, CLIENT]);
    assertEquals([byName["locations/b"].eligible, byName["locations/b"].linkedClientId], [false, null]);
    assertEquals(
      [byName["locations/c"].eligible, byName["locations/c"].linkedClientId, byName["locations/c"].linkedClientName],
      [false, 7, "Clínica X"],
    );
    assertEquals(
      [byName["locations/d"].eligible, byName["locations/d"].linkedClientId],
      [true, CLIENT],
      "R7: a unit already linked here stays selectable without voice of merchant",
    );
    assertEquals(options.some((o: Record<string, unknown>) => o.locationName === "locations/not-listed"), false);
    const linkedQuery = db.calls.filter((c) => c.table === "gbp_locations")[0];
    assert(!linkedQuery.modifiers.some((m) => m.args[0] === "location_name"), "no listed names in the URL");
    assert(linkedQuery.modifiers.some((m) => m.method === "eq" && m.args[0] === "conta_id" && m.args[1] === CONTA));
    assert(linkedQuery.modifiers.some((m) => m.method === "in" && m.args[0] === "status"));
    const clientLookup = db.calls.filter((c) => c.table === "clientes")[1];
    const ids = clientLookup.modifiers.find((m) => m.method === "in")!.args[1] as number[];
    assertEquals([...ids].sort(), [7, CLIENT].sort(), "only clients of listed units are named");
    const rl = rpcCalls(db, "check_rate_limit")[0].payload as Record<string, unknown>;
    assertEquals([rl.p_key, rl.p_max_requests, rl.p_window_seconds], [`google-locations:${CONTA}`, 20, 60]);
    const auth = f.calls.find((c) => c.url.startsWith(ACCOUNTS_URL))!;
    assertEquals(new Headers(auth.init?.headers).get("Authorization"), "Bearer gbp-access");
  } finally {
    f.restore();
  }
});

Deno.test("locations_not_approved: Business Information 403 quota 0 -> 409 gmn_not_approved", async () => {
  const db = routeDb();
  await queueConnection(db);
  const f = stubGoogle({
    biError: {
      status: 403,
      body: {
        error: {
          code: 403,
          message: "Quota exceeded",
          details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", metadata: { quota_limit_value: "0" } }],
        },
      },
    },
  });
  try {
    const res = await makeHandler(db)(req("GET", `/locations/${CLIENT}?connection=${CONN_1}`));
    assertEquals(res.status, 409);
    assertEquals(await res.json(), { error: "gmn_not_approved" });
  } finally {
    f.restore();
  }
});

Deno.test("locations_upstream_error: other Google errors -> 502 unknown; revoked connection -> 409 reconnect", async () => {
  const db = routeDb();
  await queueConnection(db);
  const f = stubGoogle({ biError: { status: 500, body: { error: { code: 500, message: "boom" } } } });
  try {
    const res = await makeHandler(db)(req("GET", `/locations/${CLIENT}?connection=${CONN_1}`));
    assertEquals(res.status, 502);
    assertEquals(await res.json(), { error: "unknown" });
  } finally {
    f.restore();
  }

  const revoked = routeDb();
  revoked.queue(
    "google_connections",
    "select",
    { data: { id: CONN_1, status: "revoked" } },
    { data: { id: CONN_1, status: "revoked", encrypted_access_token: "x", access_token_expires_at: null } },
  );
  const f2 = stubGoogle();
  try {
    const res = await makeHandler(revoked)(req("GET", `/locations/${CLIENT}?connection=${CONN_1}`));
    assertEquals(res.status, 409);
    assertEquals(await res.json(), { error: "reconnect" });
    assertEquals(f2.calls.length, 0);
  } finally {
    f2.restore();
  }
});

Deno.test("locations_rate_limited: denied -> 429 rate_limited, zero Google fetches", async () => {
  const db = routeDb();
  db.queue("google_connections", "select", { data: { id: CONN_1, status: "active" } });
  db.queueRpc("check_rate_limit", { data: false });
  const f = stubGoogle();
  try {
    const res = await makeHandler(db)(req("GET", `/locations/${CLIENT}?connection=${CONN_1}`));
    assertEquals(res.status, 429);
    assertEquals(await res.json(), { error: "rate_limited" });
    assertEquals(f.calls.length, 0);
  } finally {
    f.restore();
  }
});

// ─── POST /locations/:clientId ──────────────────────────────────────────────────

function linkStub() {
  return stubGoogle({
    locations: { "accounts/1": [loc("a", "A"), loc("b", "B"), loc("c", "C"), loc("n", "No voice", false)] },
  });
}

Deno.test("link_rejects_tampered_name: a name Google did not return -> 409 location_unavailable, no write", async () => {
  const db = routeDb();
  await queueConnection(db);
  db.queue("gbp_locations", "select", { data: [] }, { data: [] });
  const f = linkStub();
  try {
    const res = await makeHandler(db)(
      req("POST", `/locations/${CLIENT}`, { connectionId: CONN_1, locationNames: ["locations/a", "locations/evil"] }),
    );
    assertEquals(res.status, 409);
    assertEquals(await res.json(), { error: "location_unavailable", locationName: "locations/evil" });
    assertEquals(gbpWrites(db).length, 0);
    assertEquals(rpcCalls(db, "google_unlink_gbp_location").length, 0);
  } finally {
    f.restore();
  }
});

Deno.test("link_rejects_ineligible_and_taken: no voice of merchant, or linked to another client -> 409", async () => {
  const db = routeDb();
  await queueConnection(db);
  db.queue("gbp_locations", "select", { data: [] }, { data: [] });
  const f = linkStub();
  try {
    const res = await makeHandler(db)(req("POST", `/locations/${CLIENT}`, { connectionId: CONN_1, locationNames: ["locations/n"] }));
    assertEquals(await res.json(), { error: "location_unavailable", locationName: "locations/n" });
  } finally {
    f.restore();
  }

  const taken = routeDb();
  await queueConnection(taken);
  taken.queue(
    "gbp_locations",
    "select",
    { data: [{ id: "x", location_name: "locations/b", client_id: 7, connection_id: CONN_1, status: "active" }] },
    { data: [] },
  );
  const f2 = linkStub();
  try {
    const res = await makeHandler(taken)(req("POST", `/locations/${CLIENT}`, { connectionId: CONN_1, locationNames: ["locations/b"] }));
    assertEquals(res.status, 409);
    assertEquals(await res.json(), { error: "location_unavailable", locationName: "locations/b" });
    assertEquals(gbpWrites(taken).length, 0);
  } finally {
    f2.restore();
  }
});

Deno.test("link_keeps_already_linked_ineligible (R7): this client's active row on this connection is accepted", async () => {
  const db = routeDb();
  await queueConnection(db);
  db.queue(
    "gbp_locations",
    "select",
    { data: [{ id: "row-n", location_name: "locations/n", client_id: CLIENT, connection_id: CONN_1, status: "active" }] },
    { data: [{ id: "row-n", location_name: "locations/n" }] },
  );
  const f = linkStub(); // Google lists locations/n with hasVoiceOfMerchant false
  try {
    const res = await makeHandler(db)(req("POST", `/locations/${CLIENT}`, { connectionId: CONN_1, locationNames: ["locations/n"] }));
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { linked: 1 });
    assertEquals(rpcCalls(db, "google_unlink_gbp_location").length, 0);
  } finally {
    f.restore();
  }

  // Same name, but the client never linked it: still rejected.
  const fresh = routeDb();
  await queueConnection(fresh);
  fresh.queue("gbp_locations", "select", { data: [] }, { data: [] });
  const f2 = linkStub();
  try {
    const res = await makeHandler(fresh)(req("POST", `/locations/${CLIENT}`, { connectionId: CONN_1, locationNames: ["locations/n"] }));
    assertEquals(res.status, 409);
  } finally {
    f2.restore();
  }
});

Deno.test("link_unlinks_removed: client had A,B; post [A, C] -> A updated, C inserted, then B unlinked", async () => {
  const db = routeDb();
  await queueConnection(db);
  db.queue(
    "gbp_locations",
    "select",
    { data: [{ id: "row-a", location_name: "locations/a", client_id: CLIENT, connection_id: CONN_1, status: "active" }] },
    {
      data: [
        { id: "row-a", location_name: "locations/a" },
        { id: "row-b", location_name: "locations/b" },
      ],
    },
  );
  db.queueRpc("google_unlink_gbp_location", { data: [{ should_revoke: false, revocation_id: null }] });
  const f = linkStub();
  try {
    const res = await makeHandler(db)(
      req("POST", `/locations/${CLIENT}`, { connectionId: CONN_1, locationNames: ["locations/a", "locations/c"] }),
    );
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { linked: 2 });

    const insert = db.calls.find((c) => c.table === "gbp_locations" && c.operation === "insert")!;
    const rows = insert.payload as Array<Record<string, unknown>>;
    assertEquals(rows.map((r) => r.location_name), ["locations/c"], "only names this client did not have are inserted");
    const c = rows[0];
    assert(!("id" in c), "a fresh row, never a reused id");
    assertEquals(c.client_id, CLIENT);
    assertEquals(c.connection_id, CONN_1);
    assertEquals(c.conta_id, CONTA);
    assertEquals(c.account_name, "accounts/1");
    assertEquals(c.title, "C", "title comes from Google, never from the request");
    assertEquals(c.address_line, "Rua c, 10, São Paulo");
    assertEquals([c.status, c.disconnected_at, c.has_voice_of_merchant], ["active", null, true]);
    assertEquals(insert.options, undefined, "plain insert, no onConflict");
    const update = db.calls.find((x) => x.table === "gbp_locations" && x.operation === "update")!;
    const uFilters = update.modifiers.map((m) => `${m.method}:${m.args[0]}:${m.args[1]}`);
    assert(uFilters.includes("eq:id:row-a") && uFilters.includes(`eq:client_id:${CLIENT}`), uFilters.join(","));
    const uPayload = update.payload as Record<string, unknown>;
    assertEquals([uPayload.connection_id, uPayload.status, uPayload.title], [CONN_1, "active", "A"]);

    const unlinks = rpcCalls(db, "google_unlink_gbp_location");
    assertEquals(unlinks.length, 1);
    assertEquals(unlinks[0].payload, { p_conta_id: CONTA, p_location_id: "row-b" });
    const order = db.calls.map((x) => `${x.table}:${x.operation}`);
    assert(
      order.indexOf("gbp_locations:insert") < order.indexOf("rpc:google_unlink_gbp_location:rpc") &&
        order.indexOf("gbp_locations:update") < order.indexOf("rpc:google_unlink_gbp_location:rpc"),
      `writes must precede unlink: ${order}`,
    );
    const mine = db.calls.filter((x) => x.table === "gbp_locations" && x.operation === "select")[1];
    const filters = mine.modifiers.map((m) => `${m.method}:${m.args[0]}:${m.args[1]}`);
    assert(filters.includes(`eq:connection_id:${CONN_1}`), `removal set must be this connection only: ${filters}`);
    assert(filters.includes(`eq:client_id:${CLIENT}`) && filters.includes("eq:status:active"), filters.join(","));

    const audit = db.calls.find((x) => x.table === "audit_log")!;
    const entry = audit.payload as Record<string, unknown>;
    assertEquals([entry.action, entry.resource_type], ["gmn-link", "gbp_location"]);
  } finally {
    f.restore();
  }
});

Deno.test("link_other_connection_untouched: A,B on connection 1; post C via connection 2 -> no unlink", async () => {
  const db = routeDb();
  await queueConnection(db, CONN_2);
  db.queue("gbp_locations", "select", { data: [] }, { data: [] }); // nothing of this client on connection 2
  const f = linkStub();
  try {
    const res = await makeHandler(db)(req("POST", `/locations/${CLIENT}`, { connectionId: CONN_2, locationNames: ["locations/c"] }));
    assertEquals(await res.json(), { linked: 1 });
    const rows = db.calls.find((c) => c.operation === "insert" && c.table === "gbp_locations")!.payload as Array<
      Record<string, unknown>
    >;
    assertEquals(rows.map((r) => [r.location_name, r.connection_id]), [["locations/c", CONN_2]]);
    assertEquals(rpcCalls(db, "google_unlink_gbp_location").length, 0);
  } finally {
    f.restore();
  }
});

Deno.test("link_invalid_body: malformed body -> 400 invalid_body before any fetch", async () => {
  const f = stubGoogle();
  try {
    const res = await makeHandler(routeDb())(req("POST", `/locations/${CLIENT}`, { connectionId: CONN_1, locationNames: "locations/a" }));
    assertEquals(res.status, 400);
    assertEquals(await res.json(), { error: "invalid_body" });
    assertEquals(f.calls.length, 0);
  } finally {
    f.restore();
  }
});

// ─── POST /disconnect/youtube/:clientId ─────────────────────────────────────────

async function revocationRow() {
  return {
    id: "rev-1",
    google_sub: "sub-1",
    encrypted_token: await encryptGoogleToken("refresh-to-revoke", "refresh"),
    token_kind: "refresh",
    attempts: 0,
  };
}

Deno.test("disconnect_revokes_after_commit: should_revoke -> revoke once and delete; HTTP 500 -> attempts 1", async () => {
  const db = routeDb();
  db.queueRpc("google_unlink_youtube", { data: [{ should_revoke: true, revocation_id: "rev-1" }] });
  db.queue("google_revocations", "select", { data: await revocationRow() });
  const f = stubGoogle();
  try {
    const res = await makeHandler(db)(req("POST", `/disconnect/youtube/${CLIENT}`));
    assertEquals(res.status, 200);
    assertEquals(await res.json(), { ok: true });
    assertEquals(rpcCalls(db, "google_unlink_youtube")[0].payload, { p_conta_id: CONTA, p_client_id: CLIENT });
    assertEquals(f.count("https://oauth2.googleapis.com/revoke"), 1);
    const revoke = f.calls.find((c) => c.url === "https://oauth2.googleapis.com/revoke")!;
    assertEquals(new URLSearchParams(String(revoke.init?.body)).get("token"), "refresh-to-revoke");
    const del = db.calls.find((c) => c.table === "google_revocations" && c.operation === "delete")!;
    assert(del.modifiers.some((m) => m.method === "eq" && m.args[0] === "id" && m.args[1] === "rev-1"));
    const audit = db.calls.find((c) => c.table === "audit_log")!.payload as Record<string, unknown>;
    assertEquals([audit.action, audit.resource_type], ["youtube-unlink", "youtube_channel"]);
  } finally {
    f.restore();
  }

  const failing = routeDb();
  failing.queueRpc("google_unlink_youtube", { data: [{ should_revoke: true, revocation_id: "rev-1" }] });
  failing.queue("google_revocations", "select", { data: await revocationRow() });
  const f2 = stubGoogle({ revokeStatus: 500 });
  try {
    const res = await makeHandler(failing)(req("POST", `/disconnect/youtube/${CLIENT}`));
    assertEquals(await res.json(), { ok: true }, "the unlink committed; a failed revoke is queued, not an error");
    assertEquals(failing.calls.filter((c) => c.table === "google_revocations" && c.operation === "delete").length, 0);
    const upd = failing.calls.find((c) => c.table === "google_revocations" && c.operation === "update")!;
    const payload = upd.payload as Record<string, unknown>;
    assertEquals(payload.attempts, 1);
    assert(typeof payload.last_error === "string" && payload.last_error.length > 0);
  } finally {
    f2.restore();
  }
});

Deno.test("disconnect_youtube_no_revoke_and_404: should_revoke false -> no revoke; P0002 -> 404", async () => {
  const db = routeDb();
  db.queueRpc("google_unlink_youtube", { data: [{ should_revoke: false, revocation_id: null }] });
  const f = stubGoogle();
  try {
    const res = await makeHandler(db)(req("POST", `/disconnect/youtube/${CLIENT}`));
    assertEquals(await res.json(), { ok: true });
    assertEquals(f.calls.length, 0);
    assertEquals(db.calls.filter((c) => c.table === "google_revocations").length, 0);
  } finally {
    f.restore();
  }

  const missing = routeDb();
  missing.queueRpc("google_unlink_youtube", { data: null, error: { code: "P0002", message: "not found" } });
  const res = await makeHandler(missing)(req("POST", `/disconnect/youtube/${CLIENT}`));
  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "not_found" });
});

Deno.test("link_empty_set_unlinks_all: [] unlinks every unit of this client on this connection, revokes per decision", async () => {
  const db = routeDb();
  await queueConnection(db);
  db.queue("gbp_locations", "select", {
    data: [
      { id: "row-a", location_name: "locations/a" },
      { id: "row-b", location_name: "locations/b" },
    ],
  });
  db.queueRpc(
    "google_unlink_gbp_location",
    { data: [{ should_revoke: false, revocation_id: null }] },
    { data: [{ should_revoke: true, revocation_id: "rev-1" }] },
  );
  db.queue("google_revocations", "select", { data: await revocationRow() });
  const f = linkStub();
  try {
    const res = await makeHandler(db)(req("POST", `/locations/${CLIENT}`, { connectionId: CONN_1, locationNames: [] }));
    assertEquals(await res.json(), { linked: 0 });
    assertEquals(gbpWrites(db).length, 0);
    assertEquals(
      rpcCalls(db, "google_unlink_gbp_location").map((c) => (c.payload as Record<string, unknown>).p_location_id),
      ["row-a", "row-b"],
    );
    assertEquals(f.count("https://oauth2.googleapis.com/revoke"), 1);
    assertEquals(db.calls.filter((c) => c.table === "google_revocations" && c.operation === "delete").length, 1);
  } finally {
    f.restore();
  }
});

// ─── Fix round: R11, bounded walk, POST guards, summary email ───────────────────

Deno.test("link_replaces_foreign_disconnected_row (R11): old row deleted, a new row inserted for this client", async () => {
  const db = routeDb();
  await queueConnection(db);
  db.queue(
    "gbp_locations",
    "select",
    { data: [{ id: "old-row", location_name: "locations/c", client_id: 7, connection_id: CONN_2, status: "disconnected" }] },
    { data: [] },
  );
  const f = linkStub();
  try {
    const res = await makeHandler(db)(req("POST", `/locations/${CLIENT}`, { connectionId: CONN_1, locationNames: ["locations/c"] }));
    assertEquals(await res.json(), { linked: 1 });
    const del = db.calls.find((c) => c.table === "gbp_locations" && c.operation === "delete")!;
    const dFilters = del.modifiers.map((m) => `${m.method}:${m.args[0]}:${m.args[1]}`);
    assert(
      dFilters.includes("eq:id:old-row") && dFilters.includes("eq:client_id:7") &&
        dFilters.includes("eq:status:disconnected") && dFilters.includes(`eq:conta_id:${CONTA}`),
      dFilters.join(","),
    );
    const ins = db.calls.find((c) => c.table === "gbp_locations" && c.operation === "insert")!;
    const row = (ins.payload as Array<Record<string, unknown>>)[0];
    assertEquals([row.location_name, row.client_id, row.connection_id], ["locations/c", CLIENT, CONN_1]);
    assert(!("id" in row), "the new row gets its own id");
    assertEquals(db.calls.filter((c) => c.table === "gbp_locations" && c.operation === "update").length, 0);
    const order = gbpWrites(db).map((c) => c.operation);
    assertEquals(order, ["delete", "insert"]);
  } finally {
    f.restore();
  }
});

Deno.test("link_insert_conflict: 23505 on the insert -> 409 location_unavailable, no unlink runs", async () => {
  const db = routeDb();
  await queueConnection(db);
  db.queue(
    "gbp_locations",
    "select",
    { data: [] },
    { data: [{ id: "row-b", location_name: "locations/b" }] }, // B would be unlinked on success
    { data: [{ location_name: "locations/c", client_id: 7 }] }, // who took it
  );
  db.queue("gbp_locations", "insert", { data: null, error: { code: "23505", message: "duplicate key" } });
  const f = linkStub();
  try {
    const res = await makeHandler(db)(req("POST", `/locations/${CLIENT}`, { connectionId: CONN_1, locationNames: ["locations/c"] }));
    assertEquals(res.status, 409);
    assertEquals(await res.json(), { error: "location_unavailable", locationName: "locations/c" });
    assertEquals(rpcCalls(db, "google_unlink_gbp_location").length, 0);
    assertEquals(db.calls.filter((c) => c.table === "audit_log").length, 0);
  } finally {
    f.restore();
  }
});

Deno.test("link_foreign_connection_404: POST with another workspace's connection -> 404, zero fetches", async () => {
  const db = routeDb();
  db.queue("google_connections", "select", { data: null });
  const f = stubGoogle();
  try {
    const res = await makeHandler(db)(req("POST", `/locations/${CLIENT}`, { connectionId: CONN_2, locationNames: ["locations/a"] }));
    assertEquals(res.status, 404);
    assertEquals(f.calls.length, 0);
    assertEquals(gbpWrites(db).length, 0);
  } finally {
    f.restore();
  }
});

Deno.test("link_rate_limited: POST denied -> 429 rate_limited, zero fetches", async () => {
  const db = routeDb();
  db.queue("google_connections", "select", { data: { id: CONN_1, status: "active" } });
  db.queueRpc("check_rate_limit", { data: false });
  const f = stubGoogle();
  try {
    const res = await makeHandler(db)(req("POST", `/locations/${CLIENT}`, { connectionId: CONN_1, locationNames: ["locations/a"] }));
    assertEquals(res.status, 429);
    assertEquals(await res.json(), { error: "rate_limited" });
    assertEquals(f.calls.length, 0);
  } finally {
    f.restore();
  }
});

Deno.test("locations_truncated_account_cap: 30 accounts -> 25 walked, truncated: true", async () => {
  const db = routeDb();
  await queueConnection(db);
  const accounts = Array.from({ length: 30 }, (_, i) => ({ name: `accounts/${i + 1}` }));
  const f = stubGoogle({ accounts, locations: { "accounts/1": [loc("a", "A")] } });
  try {
    const res = await makeHandler(db)(req("GET", `/locations/${CLIENT}?connection=${CONN_1}`));
    const body = await res.json();
    assertEquals(body.truncated, true);
    assertEquals(body.options.length, 1);
    assertEquals(f.count(BI_BASE), 25);
  } finally {
    f.restore();
  }
});

Deno.test("listGbpLocations: stops at the time budget and reports truncated", async () => {
  const original = globalThis.fetch;
  let clock = 0;
  const biCalls: string[] = [];
  globalThis.fetch = ((input: string | URL) => {
    const url = String(input);
    const ok = (b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: 200 }));
    if (url === ACCOUNTS_URL) return ok({ accounts: [{ name: "accounts/1" }, { name: "accounts/2" }, { name: "accounts/3" }] });
    biCalls.push(url);
    clock += 15_000; // each account walk takes 15 s
    return ok({ locations: [loc(String(biCalls.length), `L${biCalls.length}`)] });
  }) as typeof fetch;
  try {
    const out = await listGbpLocations("tok", { now: () => clock });
    assertEquals(out.truncated, true);
    assertEquals(biCalls.length, 2, "the third account starts after the 20 s budget and is skipped");
    assertEquals(out.options.length, 2);
    const full = await listGbpLocations("tok", { now: () => 0 });
    assertEquals(full.truncated, false);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("summary_connection_email_error: logged, email null, summary still 200", async () => {
  const db = routeDb();
  db.queueRpc("effective_plan_feature", { data: true }, { data: false });
  db.queue("youtube_channels", "select", {
    data: { channel_id: "UC1", title: "Canal", authorization_status: "active", connection_id: CONN_1 },
  });
  db.queue("google_connections", "select", { data: null, error: { message: "timeout" } });
  const original = console.error;
  const logged: string[] = [];
  console.error = (...args: unknown[]) => logged.push(args.map(String).join(" "));
  try {
    const res = await makeHandler(db)(req("GET", `/summary/${CLIENT}`));
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.youtube.connectionEmail, null);
    assert(logged.some((l) => l.includes("connection email")), `expected a log line, got ${logged}`);
  } finally {
    console.error = original;
  }
});

// ─── Fix round 2: truncated listings never cost a client its units ──────────────

const THIRTY_ACCOUNTS = Array.from({ length: 30 }, (_, i) => ({ name: `accounts/${i + 1}` }));

Deno.test("locations_truncated_keeps_unlisted_linked: this client's unlisted unit on this connection is appended", async () => {
  const db = routeDb();
  await queueConnection(db);
  db.queue("gbp_locations", "select", {
    data: [
      {
        location_name: "locations/z",
        client_id: CLIENT,
        connection_id: CONN_1,
        status: "active",
        account_name: "accounts/30",
        title: "Z stored",
        address_line: "Rua Z, 1",
        website: null,
        has_voice_of_merchant: false,
      },
      { location_name: "locations/other-client", client_id: 7, connection_id: CONN_1, status: "active" },
      { location_name: "locations/other-conn", client_id: CLIENT, connection_id: CONN_2, status: "active" },
    ],
  });
  db.queue("clientes", "select", { data: [{ id: CLIENT, nome: "Cliente A" }] });
  const f = stubGoogle({ accounts: THIRTY_ACCOUNTS, locations: { "accounts/1": [loc("a", "A")] } });
  try {
    const res = await makeHandler(db)(req("GET", `/locations/${CLIENT}?connection=${CONN_1}`));
    const body = await res.json();
    assertEquals(body.truncated, true);
    assertEquals(body.options.map((o: Record<string, unknown>) => o.locationName), ["locations/a", "locations/z"]);
    assertEquals(body.options[1], {
      locationName: "locations/z",
      accountName: "accounts/30",
      title: "Z stored",
      addressLine: "Rua Z, 1",
      website: null,
      hasVoiceOfMerchant: false,
      linkedClientId: CLIENT,
      linkedClientName: "Cliente A",
      eligible: true,
    });
  } finally {
    f.restore();
  }
});

function unlinkScenarioDb() {
  const db = routeDb();
  return (async () => {
    await queueConnection(db);
    db.queue("gbp_locations", "select", {
      data: [
        { id: "row-a", location_name: "locations/a" },
        { id: "row-z", location_name: "locations/z" },
      ],
    });
    db.queueRpc(
      "google_unlink_gbp_location",
      { data: [{ should_revoke: false, revocation_id: null }] },
      { data: [{ should_revoke: false, revocation_id: null }] },
    );
    return db;
  })();
}

Deno.test("link_truncated_never_unlinks_unlisted: a unit Google did not show is kept; listed ones still unlink", async () => {
  const db = await unlinkScenarioDb();
  const f = stubGoogle({ accounts: THIRTY_ACCOUNTS, locations: { "accounts/1": [loc("a", "A")] } });
  try {
    const res = await makeHandler(db)(req("POST", `/locations/${CLIENT}`, { connectionId: CONN_1, locationNames: [] }));
    assertEquals(await res.json(), { linked: 0 });
    const unlinked = rpcCalls(db, "google_unlink_gbp_location").map((c) => (c.payload as Record<string, unknown>).p_location_id);
    assertEquals(unlinked, ["row-a"], "row-z lives in an unwalked account and must not be unlinked");
  } finally {
    f.restore();
  }
});

Deno.test("link_complete_listing_unlinks_unlisted: without truncation the set difference is unchanged", async () => {
  const db = await unlinkScenarioDb();
  const f = stubGoogle({ accounts: [{ name: "accounts/1" }], locations: { "accounts/1": [loc("a", "A")] } });
  try {
    const res = await makeHandler(db)(req("POST", `/locations/${CLIENT}`, { connectionId: CONN_1, locationNames: [] }));
    assertEquals(await res.json(), { linked: 0 });
    const unlinked = rpcCalls(db, "google_unlink_gbp_location").map((c) => (c.payload as Record<string, unknown>).p_location_id);
    assertEquals(unlinked, ["row-a", "row-z"]);
  } finally {
    f.restore();
  }
});
