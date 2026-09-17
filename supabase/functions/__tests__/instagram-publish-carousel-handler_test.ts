// Handler-level coverage for the carousel branches of instagram-publish:
//   - publish-now on a carousel whose children are still transcoding leaves the
//     post agendado (lock cleared, scheduled_at = now) instead of failing it;
//   - publish-now on a carousel whose children all FINISH assembles the parent
//     and publishes through the ordinary tail;
//   - cancel clears carousel_children (outside record_post_status_change's
//     p_fields allowlist, so it is a separate update).
// createSupabaseQueryMock is scripted, not stateful: every ensureCarouselChildren
// re-read consumes one queued workflow_posts select + one post_file_links select,
// so those are queued generously below (extra entries are harmless).

import { assert, assertEquals } from "./assert.ts";
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

function request(action: string, postId: number) {
  return new Request(`http://x/instagram-publish/${action}/${postId}`, {
    method: "POST",
    headers: { authorization: "Bearer t" },
  });
}

function rpcCalls(db: ReturnType<typeof createSupabaseQueryMock>, name: string) {
  return db.calls.filter((c: QueryCall) => c.table === `rpc:${name}`);
}

function updates(db: ReturnType<typeof createSupabaseQueryMock>, table: string) {
  return db.calls.filter((c: QueryCall) => c.table === table && c.operation === "update");
}

// Graph stub: POST /media -> {id: c-N}; POST media_publish -> {id: media-1};
// GET ?fields=permalink -> permalink; GET status -> statusFor(containerId).
// deno-lint-ignore no-explicit-any
function stubGraph(statusFor: (id: string) => string) {
  const original = globalThis.fetch;
  // deno-lint-ignore no-explicit-any
  const calls: Array<{ url: string; body: any }> = [];
  let n = 0;
  const ok = (obj: unknown) => Promise.resolve(new Response(JSON.stringify(obj), { status: 200 }));
  globalThis.fetch = ((input: unknown, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    if (!init) {
      if (url.includes("fields=permalink")) return ok({ permalink: "https://instagram.com/p/x" });
      const id = url.split("/").pop()?.split("?")[0] ?? "";
      return ok({ status_code: statusFor(id) });
    }
    if (url.includes("media_publish")) return ok({ id: "media-1" });
    n += 1;
    return ok({ id: `c-${n}` });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

// publish-now polls children 12 x 3s; make timers fire immediately for the test
// and restore afterwards so other test files are unaffected.
function instantTimers() {
  const original = globalThis.setTimeout;
  globalThis.setTimeout = ((fn: () => void) => { fn(); return 0 as unknown as number; }) as typeof setTimeout;
  return () => { globalThis.setTimeout = original; };
}

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
  ig_trial_strategy: null,
};

// Two 1:1 JPEGs: pass validateMedia's carousel rules (aspect 3/4..1.91, <= 8MB).
const carouselLinks = [
  {
    sort_order: 0,
    files: {
      id: 10, kind: "image", mime_type: "image/jpeg", size_bytes: 1000,
      width: 1080, height: 1080, duration_seconds: null, r2_key: "img/10.jpg", thumbnail_r2_key: null,
    },
  },
  {
    sort_order: 1,
    files: {
      id: 11, kind: "image", mime_type: "image/jpeg", size_bytes: 1000,
      width: 1080, height: 1080, duration_seconds: null, r2_key: "img/11.jpg", thumbnail_r2_key: null,
    },
  },
];

async function queuePublishNowPreamble(db: ReturnType<typeof createSupabaseQueryMock>) {
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: postRow, error: null }); // handler access check
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queueRpc("effective_plan_feature", { data: true, error: null });
  db.queue("workflow_posts", "select", { data: postRow, error: null }); // validateForScheduling
  db.queue("post_file_links", "select", { data: carouselLinks, error: null }); // validateForScheduling
  db.queue("instagram_accounts", "select", {
    data: {
      encrypted_access_token: await encryptedToken(),
      instagram_user_id: "ig-user",
      token_expires_at: "2030-01-01T12:00:00Z",
      authorization_status: "connected",
    },
    error: null,
  });
  db.queueRpc("record_post_status_change", { data: null, error: null }); // processing marker
  // Every fetchPostMedia / ensureCarouselChildren read of post_file_links.
  for (let i = 0; i < 8; i++) db.queue("post_file_links", "select", { data: carouselLinks, error: null });
}

Deno.test("instagram-publish publish-now (carousel): children still processing -> stays agendado, no parent, no failure", async () => {
  const db = createSupabaseQueryMock();
  await queuePublishNowPreamble(db);
  // createMissingCarouselChildContainers -> ensureCarouselChildren: nothing persisted yet.
  db.queue("workflow_posts", "select", { data: { carousel_children: null }, error: null });
  // pollCarouselChildrenReady -> ensureCarouselChildren: both children now exist (c-1, c-2).
  db.queue("workflow_posts", "select", {
    data: {
      carousel_children: [
        { file_id: 10, kind: "image", container_id: "c-1", ready: false },
        { file_id: 11, kind: "image", container_id: "c-2", ready: false },
      ],
    },
    error: null,
  });

  const restoreTimers = instantTimers();
  const g = stubGraph((id) => (id === "c-2" ? "IN_PROGRESS" : "FINISHED"));
  let res: Response;
  try {
    res = await makeHandler(db)(request("publish-now", 1));
  } finally {
    g.restore();
    restoreTimers();
  }

  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    ok: true,
    status: "agendado",
    message: "Mídia ainda processando no Instagram. O post será publicado automaticamente em alguns minutos.",
  });
  assert(!g.calls.some((c) => c.body?.media_type === "CAROUSEL"), "parent must not be assembled");
  assert(!g.calls.some((c) => c.url.includes("media_publish")), "nothing published");
  assertEquals(
    rpcCalls(db, "record_post_status_change").filter(
      (c) => (c.payload as Record<string, unknown>).p_new_status === "falha_publicacao",
    ).length,
    0,
    "not-ready must never be recorded as a failure",
  );
  const release = updates(db, "workflow_posts").find(
    (u) => (u.payload as Record<string, unknown>).publish_processing_at === null &&
      "scheduled_at" in (u.payload as Record<string, unknown>),
  );
  assert(release, "lock released and scheduled_at pulled to now so the cron finishes it");
});

Deno.test("instagram-publish publish-now (carousel): all children FINISHED -> parent assembled and published", async () => {
  const db = createSupabaseQueryMock();
  await queuePublishNowPreamble(db);
  db.queue("workflow_posts", "select", { data: { carousel_children: null }, error: null }); // createMissing
  db.queue("workflow_posts", "select", {                                                      // poll
    data: {
      carousel_children: [
        { file_id: 10, kind: "image", container_id: "c-1", ready: false },
        { file_id: 11, kind: "image", container_id: "c-2", ready: false },
      ],
    },
    error: null,
  });
  db.queueRpc("mark_platform_published", { data: null, error: null });

  const restoreTimers = instantTimers();
  const g = stubGraph(() => "FINISHED");
  let res: Response;
  try {
    res = await makeHandler(db)(request("publish-now", 1));
  } finally {
    g.restore();
    restoreTimers();
  }

  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true, status: "postado", instagram_permalink: "https://instagram.com/p/x" });
  const parent = g.calls.find((c) => c.body?.media_type === "CAROUSEL");
  assert(parent, "parent must be assembled");
  assertEquals(parent!.body.children, "c-1,c-2");
  assertEquals(parent!.body.caption, "legenda");
  // Parent is the 3rd POST -> c-3; it is what gets persisted and published.
  const persisted = updates(db, "workflow_posts").find(
    (u) => (u.payload as Record<string, unknown>).instagram_container_id === "c-3",
  );
  assert(persisted, "parent container id must be persisted before polling/publishing it");
  const publish = g.calls.find((c) => c.url.includes("media_publish"));
  assertEquals(publish?.body.creation_id, "c-3");
  const marked = rpcCalls(db, "mark_platform_published");
  assertEquals(marked.length, 1);
  assertEquals(
    ((marked[0].payload as Record<string, unknown>).p_fields as Record<string, unknown>).instagram_media_id,
    "media-1",
  );
});

Deno.test("instagram-publish cancel clears carousel_children with a separate update", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: { ...postRow, status: "agendado" }, error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queueRpc("record_post_status_change", { data: null, error: null });

  const res = await makeHandler(db)(request("cancel", 1));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true, status: "aprovado_cliente" });
  const cleared = updates(db, "workflow_posts").find(
    (u) => (u.payload as Record<string, unknown>).carousel_children === null,
  );
  assert(cleared, "cancel must null carousel_children");
});

Deno.test("instagram-publish retry clears carousel_children with a separate update", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: { ...postRow, status: "falha_publicacao" }, error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queueRpc("record_post_status_change", { data: null, error: null });

  const res = await makeHandler(db)(request("retry", 1));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true, status: "agendado" });
  const cleared = updates(db, "workflow_posts").find(
    (u) => (u.payload as Record<string, unknown>).carousel_children === null,
  );
  assert(cleared, "retry must null carousel_children so the rebuild starts clean");
});
