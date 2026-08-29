// supabase/functions/__tests__/instagram-publish-mark-platform-published_test.ts
//
// TikTok Phase B, Task B2: the three Instagram publish-completion call sites move from
// record_post_status_change(..., 'postado', ...) to mark_platform_published(...).
// These tests exercise the FULL publish-now success path (feed/reel + stories) through
// createPublishHandler and assert the new RPC is called with the right shape, that the
// old postado RPC is no longer used for the completion transition, and that the stories
// path selects the first non-null segment media id.
//
// Written test-first: run against the pre-swap handler.ts, these fail (RED) because the
// handler still calls record_post_status_change with p_new_status:"postado" instead of
// mark_platform_published.

import { assert, assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import type { QueryCall } from "../../../test/shared/supabaseMock.ts";

Deno.env.set("TOKEN_ENCRYPTION_KEY", "test-token-key");
Deno.env.set("R2_ACCOUNT_ID", "acct");
Deno.env.set("R2_ACCESS_KEY_ID", "akid");
Deno.env.set("R2_SECRET_ACCESS_KEY", "secret");
Deno.env.set("R2_BUCKET", "bucket");

const { createPublishHandler } = await import("../instagram-publish/handler.ts");
const { selectStoryMediaId } = await import("../_shared/instagram-publish-utils.ts");

async function encryptedToken(value = "ig-token") {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode("test-token-key".padEnd(32, "0").slice(0, 32)),
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const iv = new Uint8Array(12);
  const data = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(value)),
  );
  const combined = new Uint8Array(iv.length + data.length);
  combined.set(iv);
  combined.set(data, iv.length);
  return btoa(String.fromCharCode(...combined));
}

function makeHandler(db: ReturnType<typeof createSupabaseQueryMock>) {
  return createPublishHandler({
    buildCorsHeaders: () => ({}),
    createDb: () => db as never,
    createServiceDb: () => db as never,
  });
}

function publishNowRequest(postId: number, token = "t") {
  return new Request(`http://x/instagram-publish/publish-now/${postId}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
}

// Stubs the Instagram Graph API. Container-creation POSTs (…/media) get sequential ids
// container-1, container-2, …; media_publish echoes back "media-for-<creation_id>" so tests
// can predict the resulting media id from the container id that was published; anything else
// (status polling, permalink) resolves generically.
function stubGraphFetch(opts: { permalink?: string | null } = {}) {
  const original = globalThis.fetch;
  let containerN = 0;
  globalThis.fetch = ((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method === "POST" && url.endsWith("/media")) {
      containerN += 1;
      return Promise.resolve(new Response(JSON.stringify({ id: `container-${containerN}` })));
    }
    if (method === "POST" && url.includes("media_publish")) {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      return Promise.resolve(
        new Response(JSON.stringify({ id: `media-for-${body.creation_id}` })),
      );
    }
    if (url.includes("fields=permalink")) {
      const permalink = opts.permalink === undefined ? "https://instagram.com/p/xyz" : opts.permalink;
      return Promise.resolve(new Response(JSON.stringify({ permalink })));
    }
    // container status polling
    return Promise.resolve(new Response(JSON.stringify({ status_code: "FINISHED" })));
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

function rpcCalls(db: ReturnType<typeof createSupabaseQueryMock>, name: string) {
  return db.calls.filter((c: QueryCall) => c.table === `rpc:${name}`);
}

// ============================================================
// Feed/reel publish-now success → mark_platform_published
// ============================================================

Deno.test("instagram-publish publish-now (feed): success calls mark_platform_published, not record_post_status_change(postado)", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });

  const encToken = await encryptedToken();
  const postRow = {
    id: 1,
    status: "aprovado_cliente",
    workflow_id: 9,
    cliente_id: 5,
    scheduled_at: "2030-01-01T12:00:00Z",
    ig_caption: "legenda",
    instagram_container_id: null,
    publish_retry_count: 0,
    tipo: "feed",
  };

  db.queue("workflow_posts", "select", { data: postRow, error: null }); // handler access check
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queueRpc("effective_plan_feature", { data: true, error: null });

  db.queue("workflow_posts", "select", { data: postRow, error: null }); // validateForScheduling
  const links = [{
    sort_order: 0,
    files: {
      id: 2, kind: "image", mime_type: "image/jpeg", size_bytes: 1000,
      width: 1080, height: 1080, duration_seconds: null, r2_key: "img/2.jpg",
    },
  }];
  db.queue("post_file_links", "select", { data: links, error: null }); // validateForScheduling
  db.queue("instagram_accounts", "select", {
    data: {
      encrypted_access_token: encToken,
      instagram_user_id: "ig-user",
      token_expires_at: "2030-01-01T12:00:00Z",
      authorization_status: "connected",
    },
    error: null,
  });

  db.queueRpc("record_post_status_change", { data: null, error: null }); // processing marker (unchanged)

  db.queue("post_file_links", "select", { data: links, error: null }); // createContainerForPost -> fetchPostMedia

  db.queueRpc("mark_platform_published", { data: null, error: null });

  const restoreFetch = stubGraphFetch({ permalink: "https://instagram.com/p/abc" });
  const handler = makeHandler(db);
  let res: Response;
  try {
    res = await handler(publishNowRequest(1));
  } finally {
    restoreFetch();
  }

  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body, { ok: true, status: "postado", instagram_permalink: "https://instagram.com/p/abc" });

  const markCalls = rpcCalls(db, "mark_platform_published");
  assertEquals(markCalls.length, 1);
  const payload = markCalls[0].payload as Record<string, unknown>;
  assertEquals(payload.p_post_id, 1);
  assertEquals(payload.p_platform, "instagram");
  assertEquals(payload.p_source, "workspace_user");
  assertEquals(payload.p_actor, "actor-1");
  const fields = payload.p_fields as Record<string, unknown>;
  assertEquals(fields.instagram_media_id, "media-for-container-1");
  assert(typeof fields.published_at === "string" && !isNaN(Date.parse(fields.published_at as string)));

  // The old completion RPC must never be called with p_new_status "postado" anymore.
  const oldPostadoCalls = rpcCalls(db, "record_post_status_change").filter(
    (c: QueryCall) => (c.payload as Record<string, unknown>).p_new_status === "postado",
  );
  assertEquals(oldPostadoCalls.length, 0);
});

// ============================================================
// Stories publish-now success (allDone) → mark_platform_published
// with the first non-null segment media id
// ============================================================

Deno.test("instagram-publish publish-now (stories): allDone calls mark_platform_published with the segment media id", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });

  const encToken = await encryptedToken();
  const postRow = {
    id: 1,
    status: "aprovado_cliente",
    workflow_id: 9,
    cliente_id: 5,
    scheduled_at: "2030-01-01T12:00:00Z",
    ig_caption: null,
    instagram_container_id: null,
    publish_retry_count: 0,
    tipo: "stories",
  };

  db.queue("workflow_posts", "select", { data: postRow, error: null }); // handler access check
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queueRpc("effective_plan_feature", { data: true, error: null });

  db.queue("workflow_posts", "select", { data: postRow, error: null }); // validateForScheduling
  const storyLinks = [{
    sort_order: 0,
    files: {
      id: 11, kind: "image", mime_type: "image/jpeg", size_bytes: 1000,
      width: 1080, height: 1920, duration_seconds: null, r2_key: "img/11.jpg", thumbnail_r2_key: null,
    },
  }];
  db.queue("post_file_links", "select", { data: storyLinks, error: null }); // validateForScheduling
  db.queue("instagram_accounts", "select", {
    data: {
      encrypted_access_token: encToken,
      instagram_user_id: "ig-user",
      token_expires_at: "2030-01-01T12:00:00Z",
      authorization_status: "connected",
    },
    error: null,
  });

  db.queueRpc("record_post_status_change", { data: null, error: null }); // processing marker (unchanged)

  // createMissingStorySegmentContainers: ensureStorySegments reads the persisted (empty)
  // segment, then fetchPostMedia resolves the file to build the container.
  db.queue("workflow_posts", "select", {
    data: { story_segments: [{ file_id: 11, container_id: null, media_id: null }] },
    error: null,
  });
  db.queue("post_file_links", "select", { data: storyLinks, error: null });
  db.queueRpc("set_story_segment_field", { data: null, error: null }); // container_id persisted

  // publishReadyStorySegments: re-reads segments (now carrying the container id above).
  db.queue("workflow_posts", "select", {
    data: { story_segments: [{ file_id: 11, container_id: "container-1", media_id: null }] },
    error: null,
  });
  db.queueRpc("set_story_segment_field", { data: null, error: null }); // media_id persisted

  db.queueRpc("mark_platform_published", { data: null, error: null });

  const restoreFetch = stubGraphFetch({ permalink: "https://instagram.com/p/story" });
  const handler = makeHandler(db);
  let res: Response;
  try {
    res = await handler(publishNowRequest(1));
  } finally {
    restoreFetch();
  }

  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body, { ok: true, status: "postado", instagram_permalink: "https://instagram.com/p/story" });

  const markCalls = rpcCalls(db, "mark_platform_published");
  assertEquals(markCalls.length, 1);
  const payload = markCalls[0].payload as Record<string, unknown>;
  assertEquals(payload.p_platform, "instagram");
  const fields = payload.p_fields as Record<string, unknown>;
  assertEquals(fields.instagram_media_id, "media-for-container-1");

  const oldPostadoCalls = rpcCalls(db, "record_post_status_change").filter(
    (c: QueryCall) => (c.payload as Record<string, unknown>).p_new_status === "postado",
  );
  assertEquals(oldPostadoCalls.length, 0);
});

// ============================================================
// selectStoryMediaId — pure unit coverage of the media-id selection
// ============================================================

Deno.test("selectStoryMediaId: returns the first non-null segment media_id", () => {
  const id = selectStoryMediaId([
    { file_id: 1, container_id: "c1", media_id: "m1" },
    { file_id: 2, container_id: "c2", media_id: "m2" },
  ]);
  assertEquals(id, "m1");
});

Deno.test("selectStoryMediaId: skips a leading null and returns the first non-null one found", () => {
  // Not reachable via the real allDone flow (every segment is guaranteed non-null), but the
  // selection itself must not blindly trust index 0.
  const id = selectStoryMediaId([
    { file_id: 1, container_id: "c1", media_id: null },
    { file_id: 2, container_id: "c2", media_id: "m2" },
  ]);
  assertEquals(id, "m2");
});

Deno.test("selectStoryMediaId: returns null when no segment carries a media_id", () => {
  const id = selectStoryMediaId([
    { file_id: 1, container_id: "c1", media_id: null },
    { file_id: 2, container_id: null, media_id: null },
  ]);
  assertEquals(id, null);
});

Deno.test("selectStoryMediaId: returns null for an empty segment list", () => {
  assertEquals(selectStoryMediaId([]), null);
});
