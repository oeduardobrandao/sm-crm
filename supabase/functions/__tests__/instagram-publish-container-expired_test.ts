// supabase/functions/__tests__/instagram-publish-container-expired_test.ts
//
// Review finding (Task 4 fix): when a STORY segment's container expires between
// creation and publish, media_publish fails with a Graph "does not exist, cannot
// be loaded due to missing permissions" error (classifyPublishError -> CONTAINER_EXPIRED).
// The publish-now catch clears the top-level instagram_container_id, but stories keep
// their containers per-segment in story_segments — without also clearing the dead
// segment's container_id, createMissingStorySegmentContainers would skip it forever
// (it only builds a container for segments that don't already have one), so every
// retry would hammer the same expired container and fail identically. The fix clears
// container_id on every segment WITHOUT a media_id, and leaves already-published
// segments (media_id set) untouched.

import { assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import type { QueryCall } from "../../../test/shared/supabaseMock.ts";

Deno.env.set("TOKEN_ENCRYPTION_KEY", "test-token-key");
Deno.env.set("R2_ACCOUNT_ID", "acct");
Deno.env.set("R2_ACCESS_KEY_ID", "akid");
Deno.env.set("R2_SECRET_ACCESS_KEY", "secret");
Deno.env.set("R2_BUCKET", "bucket");

const { createPublishHandler } = await import("../instagram-publish/handler.ts");

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

function rpcCalls(db: ReturnType<typeof createSupabaseQueryMock>, name: string) {
  return db.calls.filter((c: QueryCall) => c.table === `rpc:${name}`);
}

function callsFor(db: ReturnType<typeof createSupabaseQueryMock>, table: string, operation: string) {
  return db.calls.filter((c: QueryCall) => c.table === table && c.operation === operation);
}

// media_publish always fails with a Graph error shaped like a real expired-container
// response (classifies as CONTAINER_EXPIRED); anything else (status polling) is FINISHED.
function stubGraphFetchWithExpiredContainer() {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method === "POST" && url.includes("media_publish")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            error: {
              message:
                "Unsupported post request. Object with ID 'container-1' does not exist, cannot be loaded due to missing permissions, or does not support this operation",
              code: 100,
            },
          }),
        ),
      );
    }
    // container status polling
    return Promise.resolve(new Response(JSON.stringify({ status_code: "FINISHED" })));
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

Deno.test("instagram-publish publish-now (stories): CONTAINER_EXPIRED clears the unpublished segment's container_id, preserves the published one", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });

  const encToken = await encryptedToken();
  const postRow = {
    id: 1,
    status: "aprovado_cliente",
    workflow_id: 9,
    scheduled_at: "2030-01-01T12:00:00Z",
    ig_caption: null,
    instagram_container_id: null,
    publish_retry_count: 1,
    tipo: "stories",
  };

  // Persisted state going in: segment 10 already published in a prior cycle (has
  // media_id); segment 11 already has a container from a prior cycle, but that
  // container is the one that turns out to be expired.
  const segmentsBefore = [
    { file_id: 10, container_id: "container-old", media_id: "media-old" },
    { file_id: 11, container_id: "container-1", media_id: null },
  ];

  db.queue("workflow_posts", "select", { data: postRow, error: null }); // handler access check
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queueRpc("effective_plan_feature", { data: true, error: null });

  db.queue("workflow_posts", "select", { data: postRow, error: null }); // validateForScheduling
  const storyLinks = [
    {
      sort_order: 0,
      files: {
        id: 10, kind: "image", mime_type: "image/jpeg", size_bytes: 1000,
        width: 1080, height: 1920, duration_seconds: null, r2_key: "img/10.jpg", thumbnail_r2_key: null,
      },
    },
    {
      sort_order: 1,
      files: {
        id: 11, kind: "image", mime_type: "image/jpeg", size_bytes: 1000,
        width: 1080, height: 1920, duration_seconds: null, r2_key: "img/11.jpg", thumbnail_r2_key: null,
      },
    },
  ];
  db.queue("post_file_links", "select", { data: storyLinks, error: null }); // validateForScheduling
  db.queue("workflows", "select", { data: { cliente_id: 5 }, error: null });
  db.queue("instagram_accounts", "select", {
    data: {
      encrypted_access_token: encToken,
      instagram_user_id: "ig-user",
      token_expires_at: "2030-01-01T12:00:00Z",
      authorization_status: "connected",
    },
    error: null,
  });

  db.queueRpc("record_post_status_change", { data: null, error: null }); // processing marker

  // createMissingStorySegmentContainers: both segments already carry a container_id,
  // so it does nothing but the two reads it always performs.
  db.queue("workflow_posts", "select", { data: { story_segments: segmentsBefore }, error: null }); // ensureStorySegments
  db.queue("post_file_links", "select", { data: storyLinks, error: null }); // fetchPostMedia

  // publishReadyStorySegments: re-reads segments; segment 10 is skipped (already has
  // media_id), segment 11 gets polled (FINISHED) then fails at media_publish.
  db.queue("workflow_posts", "select", { data: { story_segments: segmentsBefore }, error: null }); // ensureStorySegments

  // publish-now's catch handler re-reads story_segments to clear the dead one.
  db.queue("workflow_posts", "select", { data: { story_segments: segmentsBefore }, error: null });

  const restoreFetch = stubGraphFetchWithExpiredContainer();
  const handler = makeHandler(db);
  let res: Response;
  try {
    res = await handler(publishNowRequest(1));
  } finally {
    restoreFetch();
  }

  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body, { error: "Internal server error" });

  // record_post_status_change -> falha_publicacao, classified CONTAINER_EXPIRED
  const statusCalls = rpcCalls(db, "record_post_status_change").filter(
    (c: QueryCall) => (c.payload as Record<string, unknown>).p_new_status === "falha_publicacao",
  );
  assertEquals(statusCalls.length, 1);
  const failFields = (statusCalls[0].payload as Record<string, unknown>).p_fields as Record<string, unknown>;
  assertEquals(failFields.publish_error_code, "CONTAINER_EXPIRED");

  // The unpublished segment's container_id must be cleared so a retry rebuilds it
  // instead of re-publishing the same expired container; the published segment
  // (media_id set) must be left exactly as it was.
  const updates = callsFor(db, "workflow_posts", "update");
  const segmentUpdate = updates.find(
    (u) => (u.payload as Record<string, unknown>).story_segments !== undefined,
  );
  assertEquals(segmentUpdate !== undefined, true, "expected an update clearing story_segments");
  assertEquals((segmentUpdate!.payload as { story_segments: unknown }).story_segments, [
    { file_id: 10, container_id: "container-old", media_id: "media-old" },
    { file_id: 11, container_id: null, media_id: null },
  ]);
});
