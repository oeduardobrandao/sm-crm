import { assert, assertEquals, readJson } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createHubApproveHandler } from "../hub-approve/handler.ts";
import { createHubBootstrapHandler } from "../hub-bootstrap/handler.ts";
import { createHubBrandHandler } from "../hub-brand/handler.ts";
import { createHubBriefingHandler } from "../hub-briefing/handler.ts";
import { createHubIdeiasHandler } from "../hub-ideias/handler.ts";
import { createHubPagesHandler } from "../hub-pages/handler.ts";
import { createHubPostsHandler } from "../hub-posts/handler.ts";
import { createHubInstagramFeedHandler } from "../hub-instagram-feed/handler.ts";

const now = () => "2026-04-17T12:00:00.000Z";
const buildCorsHeaders = () => ({ "Access-Control-Allow-Origin": "https://hub.mesaas.com" });
// hub-bootstrap now requires a touchToken dep (sliding-window renewal). These tests don't
// exercise renewal behavior, so a no-op stub keeps the handler wired without changing any
// assertions in this file.
const noopTouchToken = async () => {};

Deno.test("hub-bootstrap returns workspace metadata for a valid workspace token", async () => {
  const db = createSupabaseQueryMock();
  db.queue("workspaces", "select", {
    data: { id: "conta-1", name: "Mesaas", logo_url: null, brand_color: null, hub_enabled: true },
    error: null,
  });
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, is_active: true },
    error: null,
  });
  db.queue("clientes", "select", {
    data: { nome: "Clínica Aurora" },
    error: null,
  });
  db.queue("instagram_accounts", "select", {
    data: { profile_picture_url: "https://cdn.test/avatars/14.jpg" },
    error: null,
  });

  const handler = createHubBootstrapHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
    touchToken: noopTouchToken,
  });

  const response = await handler(new Request("https://example.test/hub-bootstrap?workspace=mesaas&token=hub-123"));
  const body = await readJson(response);

  assertEquals(response.status, 200);
  assertEquals(body.cliente_nome, "Clínica Aurora");
  assertEquals(body.cliente_foto_url, "https://cdn.test/avatars/14.jpg");
  assertEquals(body.workspace.brand_color, "#1a1a2e");
});

Deno.test("hub-bootstrap serves a null client photo when no Instagram account is linked", async () => {
  const db = createSupabaseQueryMock();
  db.queue("workspaces", "select", {
    data: { id: "conta-1", name: "Mesaas", logo_url: null, brand_color: null, hub_enabled: true },
    error: null,
  });
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, is_active: true },
    error: null,
  });
  db.queue("clientes", "select", { data: { nome: "Clínica Aurora" }, error: null });
  db.queue("instagram_accounts", "select", { data: null, error: null });

  const handler = createHubBootstrapHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
    touchToken: noopTouchToken,
  });

  const response = await handler(new Request("https://example.test/hub-bootstrap?workspace=mesaas&token=hub-123"));
  const body = await readJson(response);

  // A client with no connected account is normal — the portal still loads.
  assertEquals(response.status, 200);
  assertEquals(body.cliente_foto_url, null);
  assertEquals(body.cliente_nome, "Clínica Aurora");
});

Deno.test("hub-bootstrap rejects missing query params", async () => {
  const handler = createHubBootstrapHandler({
    buildCorsHeaders,
    createDb: () => createSupabaseQueryMock() as never,
    now,
    touchToken: noopTouchToken,
  });

  const response = await handler(new Request("https://example.test/hub-bootstrap?workspace=mesaas"));
  assertEquals(response.status, 400);
});

Deno.test("hub-posts returns flattened post data with signed media URLs", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queue("workflows", "select", { data: [{ id: 7 }], error: null });
  db.queue("workflow_posts", "select", {
    data: [
      {
        id: 99,
        titulo: "Post principal",
        tipo: "feed",
        status: "enviado_cliente",
        ordem: 0,
        conteudo_plain: "Legenda aprovada",
        scheduled_at: "2026-04-20T10:00:00.000Z",
        platform: "tiktok",
        workflow_id: 7,
        workflows: { titulo: "Calendário Abril" },
      },
    ],
    error: null,
  });
  db.queue("post_approvals", "select", { data: [], error: null });
  db.queue("post_property_values", "select", { data: [], error: null });
  db.queue("workflow_select_options", "select", { data: [], error: null });
  db.queue("post_file_links", "select", {
    data: [
      {
        id: 1,
        post_id: 99,
        is_cover: true,
        sort_order: 0,
        files: {
          id: 10,
          kind: "image",
          mime_type: "image/png",
          r2_key: "contas/1/post.png",
          thumbnail_r2_key: null,
          width: 1080,
          height: 1350,
          duration_seconds: null,
          blur_data_url: null,
        },
      },
    ],
    error: null,
  });
  db.queue("instagram_accounts", "select", {
    data: { username: "studio_marca", profile_picture_url: "https://cdn.ig/pic.jpg" },
    error: null,
  });

  const handler = createHubPostsHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
    signGetUrl: async (key) => `https://signed.mesaas.com/${key}`,
  });

  const response = await handler(new Request("https://example.test/hub-posts?token=hub-123"));
  const body = await readJson(response);

  assertEquals(response.status, 200);
  assertEquals(body.posts[0].workflow_titulo, "Calendário Abril");
  assertEquals(body.posts[0].cover_media.url, "https://signed.mesaas.com/contas/1/post.png");
  assertEquals(body.posts[0].platform, "tiktok");
  assertEquals(body.posts[0].cover_media.playback, null);
});

Deno.test("hub-posts omits signed URLs and returns media_lost_at for a permanently lost file", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queue("workflows", "select", { data: [{ id: 7 }], error: null });
  db.queue("workflow_posts", "select", {
    data: [
      {
        id: 99,
        titulo: "Post com mídia perdida",
        tipo: "feed",
        status: "enviado_cliente",
        ordem: 0,
        conteudo_plain: "Legenda",
        scheduled_at: "2026-04-20T10:00:00.000Z",
        platform: "instagram",
        workflow_id: 7,
        workflows: { titulo: "Calendário Abril" },
      },
    ],
    error: null,
  });
  db.queue("post_approvals", "select", { data: [], error: null });
  db.queue("post_property_values", "select", { data: [], error: null });
  db.queue("workflow_select_options", "select", { data: [], error: null });
  db.queue("post_file_links", "select", {
    data: [
      {
        id: 1,
        post_id: 99,
        is_cover: true,
        sort_order: 0,
        files: {
          id: 10,
          kind: "image",
          mime_type: "image/png",
          r2_key: "contas/1/lost.png",
          thumbnail_r2_key: "contas/1/lost.thumb.webp",
          width: 1080,
          height: 1350,
          duration_seconds: null,
          blur_data_url: null,
          media_lost_at: "2026-08-14T03:00:00.000Z",
        },
      },
    ],
    error: null,
  });
  db.queue("instagram_accounts", "select", {
    data: { username: "studio_marca", profile_picture_url: "https://cdn.ig/pic.jpg" },
    error: null,
  });

  let signCalls = 0;
  const handler = createHubPostsHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
    signGetUrl: async (key) => {
      signCalls++;
      return `https://signed.mesaas.com/${key}`;
    },
  });

  const response = await handler(new Request("https://example.test/hub-posts?token=hub-123"));
  const body = await readJson(response);

  assertEquals(response.status, 200);
  assertEquals(body.posts[0].cover_media.url, null);
  assertEquals(body.posts[0].cover_media.thumbnail_url, null);
  assertEquals(body.posts[0].cover_media.media_lost_at, "2026-08-14T03:00:00.000Z");
  assertEquals(signCalls, 0);
});

function queueHubPostsVideoFixture(
  db: ReturnType<typeof createSupabaseQueryMock>,
  file: { stream_uid: string | null; stream_status: string | null },
) {
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queue("workflows", "select", { data: [{ id: 7 }], error: null });
  db.queue("workflow_posts", "select", {
    data: [
      {
        id: 99,
        titulo: "Post em vídeo",
        tipo: "reels",
        status: "enviado_cliente",
        ordem: 0,
        conteudo_plain: "Legenda",
        scheduled_at: "2026-04-20T10:00:00.000Z",
        platform: "instagram",
        workflow_id: 7,
        workflows: { titulo: "Calendário Abril" },
      },
    ],
    error: null,
  });
  db.queue("post_approvals", "select", { data: [], error: null });
  db.queue("post_property_values", "select", { data: [], error: null });
  db.queue("workflow_select_options", "select", { data: [], error: null });
  db.queue("post_file_links", "select", {
    data: [
      {
        id: 1,
        post_id: 99,
        is_cover: true,
        sort_order: 0,
        files: {
          id: 10,
          kind: "video",
          mime_type: "video/mp4",
          r2_key: "contas/1/post.mp4",
          thumbnail_r2_key: null,
          width: 1080,
          height: 1920,
          duration_seconds: 12,
          blur_data_url: null,
          stream_uid: file.stream_uid,
          stream_status: file.stream_status,
        },
      },
    ],
    error: null,
  });
  db.queue("instagram_accounts", "select", {
    data: { username: "studio_marca", profile_picture_url: "https://cdn.ig/pic.jpg" },
    error: null,
  });
}

Deno.test("hub-posts includes signed playback for a ready video when signPlayback is configured", async () => {
  const db = createSupabaseQueryMock();
  queueHubPostsVideoFixture(db, { stream_uid: "stream-uid-1", stream_status: "ready" });

  const handler = createHubPostsHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
    signGetUrl: async (key) => `https://signed.mesaas.com/${key}`,
    signPlayback: async (uid) => ({
      hls: `https://stream.example/${uid}.m3u8`,
      expires_at: "2026-04-20T22:00:00.000Z",
    }),
  });

  const response = await handler(new Request("https://example.test/hub-posts?token=hub-123"));
  const body = await readJson(response);

  assertEquals(response.status, 200);
  const media = body.posts[0].cover_media;
  assertEquals(media.playback, {
    hls: "https://stream.example/stream-uid-1.m3u8",
    expires_at: "2026-04-20T22:00:00.000Z",
  });
  assert(!("stream_uid" in media), "stream_uid must not leak to the client");
  assert(!("stream_status" in media), "stream_status must not leak to the client");
});

Deno.test("hub-posts returns playback: null for a video that has not finished processing", async () => {
  const db = createSupabaseQueryMock();
  queueHubPostsVideoFixture(db, { stream_uid: "stream-uid-1", stream_status: "pending" });

  const handler = createHubPostsHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
    signGetUrl: async (key) => `https://signed.mesaas.com/${key}`,
    signPlayback: async (uid) => ({
      hls: `https://stream.example/${uid}.m3u8`,
      expires_at: "2026-04-20T22:00:00.000Z",
    }),
  });

  const response = await handler(new Request("https://example.test/hub-posts?token=hub-123"));
  const body = await readJson(response);

  assertEquals(response.status, 200);
  assertEquals(body.posts[0].cover_media.playback, null);
});

Deno.test("hub-posts returns playback: null when signPlayback is not configured (Stream disabled)", async () => {
  const db = createSupabaseQueryMock();
  queueHubPostsVideoFixture(db, { stream_uid: "stream-uid-1", stream_status: "ready" });

  const handler = createHubPostsHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
    signGetUrl: async (key) => `https://signed.mesaas.com/${key}`,
  });

  const response = await handler(new Request("https://example.test/hub-posts?token=hub-123"));
  const body = await readJson(response);

  assertEquals(response.status, 200);
  assertEquals(body.posts[0].cover_media.playback, null);
});

Deno.test("hub-posts rejects missing tokens", async () => {
  const handler = createHubPostsHandler({
    buildCorsHeaders,
    createDb: () => createSupabaseQueryMock() as never,
    now,
    signGetUrl: async () => "https://signed.example",
  });

  const response = await handler(new Request("https://example.test/hub-posts"));
  assertEquals(response.status, 400);
});

function hubPostsPatchHandler(db: ReturnType<typeof createSupabaseQueryMock>) {
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  return createHubPostsHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
    signGetUrl: async () => "https://signed.example",
  });
}

function patchRequest(updates: unknown) {
  return new Request("https://example.test/hub-posts", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "hub-123", updates }),
  });
}

Deno.test("hub-posts PATCH rejects a malformed updates payload before calling the RPC", async () => {
  const db = createSupabaseQueryMock();
  const handler = hubPostsPatchHandler(db);

  const response = await handler(patchRequest([{ post_id: "not-a-number", scheduled_at: null }]));

  assertEquals(response.status, 400);
  assert(
    !db.calls.some((c: { table: string }) => c.table === "rpc:hub_reorder_post_schedules"),
    "RPC must not run for a malformed payload",
  );
});

Deno.test("hub-posts PATCH maps an RPC ownership error to 403", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("hub_reorder_post_schedules", {
    data: null,
    error: { message: "FORBIDDEN: post outside token scope" },
  });
  const handler = hubPostsPatchHandler(db);

  const response = await handler(patchRequest([{ post_id: 1, scheduled_at: "2026-05-01T10:00:00Z" }]));

  assertEquals(response.status, 403);
});

Deno.test("hub-posts PATCH maps an RPC lock error to 409 with the locked ids", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("hub_reorder_post_schedules", {
    data: null,
    error: { message: "LOCKED: forbidden status: {5,7}" },
  });
  const handler = hubPostsPatchHandler(db);

  const response = await handler(
    patchRequest([
      { post_id: 5, scheduled_at: null },
      { post_id: 7, scheduled_at: null },
    ]),
  );
  const body = await readJson(response);

  assertEquals(response.status, 409);
  assertEquals(body.locked_post_ids, [5, 7]);
});

Deno.test("hub-posts PATCH maps an RPC validation error to 400", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("hub_reorder_post_schedules", {
    data: null,
    error: { message: "BAD_REQUEST: agendado needs a future date" },
  });
  const handler = hubPostsPatchHandler(db);

  const response = await handler(patchRequest([{ post_id: 5, scheduled_at: "2020-01-01T00:00:00Z" }]));

  assertEquals(response.status, 400);
});

Deno.test("hub-posts PATCH swaps dates through the RPC scoped to the token's client/account", async () => {
  const db = createSupabaseQueryMock();
  db.queueRpc("hub_reorder_post_schedules", { data: { ok: true, updated: 2 }, error: null });
  const handler = hubPostsPatchHandler(db);

  const updates = [
    { post_id: 5, scheduled_at: "2026-05-02T10:00:00Z" },
    { post_id: 7, scheduled_at: "2026-05-01T10:00:00Z" },
  ];
  const response = await handler(patchRequest(updates));
  const body = await readJson(response);

  assertEquals(response.status, 200);
  assertEquals(body.updated, 2);
  const rpcCall = db.calls.find(
    (c: { table: string }) => c.table === "rpc:hub_reorder_post_schedules",
  );
  assert(rpcCall, "reorder RPC should be called");
  assertEquals(rpcCall.payload, {
    p_cliente_id: 14,
    p_conta_id: "conta-1",
    p_updates: updates,
  });
});

Deno.test("hub-approve stores an approval for a valid client post", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: { cliente_id: 14, is_active: true }, error: null });
  db.queue("workflow_posts", "select", { data: { id: 99, workflow_id: 7, status: "enviado_cliente" }, error: null });
  db.queue("workflows", "select", { data: { cliente_id: 14 }, error: null });
  db.queue("post_approvals", "insert", { data: null, error: null });
  db.queue("workflow_posts", "update", { data: null, error: null });

  const handler = createHubApproveHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });

  const response = await handler(new Request("https://example.test/hub-approve", {
    method: "POST",
    body: JSON.stringify({ token: "hub-123", post_id: 99, action: "aprovado" }),
  }));

  assertEquals(response.status, 200);
  assertEquals((await readJson(response)).ok, true);

  const rpcCall = db.calls.find((c: { table: string }) => c.table === "rpc:create_post_approval_notification");
  assert(rpcCall, "notification RPC should be called");
  assertEquals(rpcCall.payload, { p_post_id: 99, p_action: "aprovado", p_comentario: null });
});

Deno.test("hub-approve calls notification RPC with comentario for corrections", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: { cliente_id: 14, is_active: true }, error: null });
  db.queue("workflow_posts", "select", { data: { id: 99, workflow_id: 7, status: "enviado_cliente" }, error: null });
  db.queue("workflows", "select", { data: { cliente_id: 14 }, error: null });
  db.queue("post_approvals", "insert", { data: null, error: null });
  db.queue("workflow_posts", "update", { data: null, error: null });

  const handler = createHubApproveHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });

  const response = await handler(new Request("https://example.test/hub-approve", {
    method: "POST",
    body: JSON.stringify({ token: "hub-123", post_id: 99, action: "correcao", comentario: "Trocar imagem" }),
  }));

  assertEquals(response.status, 200);
  const rpcCall = db.calls.find((c: { table: string }) => c.table === "rpc:create_post_approval_notification");
  assert(rpcCall, "notification RPC should be called for corrections");
  assertEquals(rpcCall.payload, { p_post_id: 99, p_action: "correcao", p_comentario: "Trocar imagem" });
});

Deno.test("hub-approve rejects invalid approval actions", async () => {
  const handler = createHubApproveHandler({
    buildCorsHeaders,
    createDb: () => createSupabaseQueryMock() as never,
    now,
  });

  const response = await handler(new Request("https://example.test/hub-approve", {
    method: "POST",
    body: JSON.stringify({ token: "hub-123", post_id: 99, action: "deletar" }),
  }));

  assertEquals(response.status, 400);
});

// validateForScheduling internals (fed through the same queue, in call order):
// workflow_posts → post_file_links → workflows → instagram_accounts. An empty
// encrypted_access_token skips the decrypt step, so no crypto env is needed.
function queueValidateForScheduling(
  db: ReturnType<typeof createSupabaseQueryMock>,
  post: Record<string, unknown>,
) {
  db.queue("workflow_posts", "select", { data: post, error: null });
  db.queue("post_file_links", "select", {
    data: [{
      sort_order: 0,
      files: {
        id: 2,
        kind: "image",
        mime_type: "image/jpeg",
        size_bytes: 1000,
        width: 1080,
        height: 1080,
        duration_seconds: null,
        r2_key: "img/2.jpg",
      },
    }],
    error: null,
  });
  db.queue("workflows", "select", { data: { cliente_id: 14 }, error: null });
  db.queue("instagram_accounts", "select", {
    data: {
      encrypted_access_token: "",
      instagram_user_id: "ig-1",
      token_expires_at: null,
      authorization_status: "connected",
    },
    error: null,
  });
}

Deno.test("hub-approve auto-schedules an approved express post despite the missing date", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: { cliente_id: 14, is_active: true }, error: null });
  db.queue("workflow_posts", "select", {
    data: { id: 99, workflow_id: 7, status: "enviado_cliente", is_express: true },
    error: null,
  });
  db.queue("workflows", "select", { data: { cliente_id: 14 }, error: null });
  db.queue("clientes", "select", { data: { auto_publish_on_approval: true }, error: null });
  // The queued scheduled_at: null passing validation proves skipDateCheck was applied.
  queueValidateForScheduling(db, {
    id: 99,
    scheduled_at: null,
    ig_caption: "legenda",
    workflow_id: 7,
    tipo: "feed",
  });

  const handler = createHubApproveHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });

  const response = await handler(new Request("https://example.test/hub-approve", {
    method: "POST",
    body: JSON.stringify({ token: "hub-123", post_id: 99, action: "aprovado" }),
  }));

  assertEquals(response.status, 200);
  assertEquals((await readJson(response)).scheduled, true);

  const rpcCall = db.calls.find((c: { table: string }) => c.table === "rpc:record_post_status_change");
  assert(rpcCall, "status change RPC should be called");
  assertEquals(rpcCall.payload, {
    p_post_id: 99,
    p_new_status: "agendado",
    p_source: "system",
    p_fields: { scheduled_at: now() },
  });
});

Deno.test("hub-approve reports scheduled: false when the status RPC fails", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: { cliente_id: 14, is_active: true }, error: null });
  db.queue("workflow_posts", "select", {
    data: { id: 99, workflow_id: 7, status: "enviado_cliente", is_express: true },
    error: null,
  });
  db.queue("workflows", "select", { data: { cliente_id: 14 }, error: null });
  db.queue("clientes", "select", { data: { auto_publish_on_approval: true }, error: null });
  queueValidateForScheduling(db, {
    id: 99,
    scheduled_at: null,
    ig_caption: "legenda",
    workflow_id: 7,
    tipo: "feed",
  });
  db.queueRpc("record_post_status_change", { data: null, error: { message: "db offline" } });

  const handler = createHubApproveHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });

  const response = await handler(new Request("https://example.test/hub-approve", {
    method: "POST",
    body: JSON.stringify({ token: "hub-123", post_id: 99, action: "aprovado" }),
  }));

  // The approval itself still succeeds; only the auto-publish must not be
  // reported as scheduled when the transition never happened.
  assertEquals(response.status, 200);
  const body = await readJson(response);
  assertEquals(body.ok, true);
  assertEquals(body.scheduled, false);
});

Deno.test("hub-approve does not schedule an approved express post when auto-publish is off", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: { cliente_id: 14, is_active: true }, error: null });
  db.queue("workflow_posts", "select", {
    data: { id: 99, workflow_id: 7, status: "enviado_cliente", is_express: true },
    error: null,
  });
  db.queue("workflows", "select", { data: { cliente_id: 14 }, error: null });
  db.queue("clientes", "select", { data: { auto_publish_on_approval: false }, error: null });

  const handler = createHubApproveHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });

  const response = await handler(new Request("https://example.test/hub-approve", {
    method: "POST",
    body: JSON.stringify({ token: "hub-123", post_id: 99, action: "aprovado" }),
  }));

  assertEquals(response.status, 200);
  assertEquals((await readJson(response)).scheduled, false);
  const rpcCall = db.calls.find((c: { table: string }) => c.table === "rpc:record_post_status_change");
  assertEquals(rpcCall, undefined);
});

Deno.test("hub-approve still skips auto-publish for a non-express post without a date", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: { cliente_id: 14, is_active: true }, error: null });
  db.queue("workflow_posts", "select", {
    data: { id: 99, workflow_id: 7, status: "enviado_cliente", is_express: false },
    error: null,
  });
  db.queue("workflows", "select", { data: { cliente_id: 14 }, error: null });
  db.queue("clientes", "select", { data: { auto_publish_on_approval: true }, error: null });
  // Non-express keeps the date check: a null scheduled_at fails validation.
  queueValidateForScheduling(db, {
    id: 99,
    scheduled_at: null,
    ig_caption: "legenda",
    workflow_id: 7,
    tipo: "feed",
  });

  const handler = createHubApproveHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });

  const response = await handler(new Request("https://example.test/hub-approve", {
    method: "POST",
    body: JSON.stringify({ token: "hub-123", post_id: 99, action: "aprovado" }),
  }));

  assertEquals(response.status, 200);
  assertEquals((await readJson(response)).scheduled, false);
  const rpcCall = db.calls.find((c: { table: string }) => c.table === "rpc:record_post_status_change");
  assertEquals(rpcCall, undefined);
});

Deno.test("hub-approve does not auto-schedule while a later client-approval etapa is still open", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: { cliente_id: 14, is_active: true }, error: null });
  db.queue("workflow_posts", "select", {
    data: { id: 99, workflow_id: 7, status: "enviado_cliente", is_express: false },
    error: null,
  });
  db.queue("workflows", "select", { data: { cliente_id: 14 }, error: null });
  db.queue("clientes", "select", { data: { auto_publish_on_approval: true }, error: null });
  // Dual-approval fluxo mid-first-cycle: the copy-approval etapa is active and the
  // design-approval etapa still lies ahead.
  db.queue("workflow_etapas", "select", {
    data: [
      { tipo: "padrao", status: "concluido" },
      { tipo: "aprovacao_cliente", status: "ativo" },
      { tipo: "padrao", status: "pendente" },
      { tipo: "aprovacao_cliente", status: "pendente" },
    ],
    error: null,
  });
  // A fully schedulable post: without the etapa guard, validation passes and the
  // post would be wrongly scheduled on this first approval.
  queueValidateForScheduling(db, {
    id: 99,
    scheduled_at: "2030-01-01T10:00:00.000Z",
    ig_caption: "legenda",
    workflow_id: 7,
    tipo: "feed",
  });

  const handler = createHubApproveHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });

  const response = await handler(new Request("https://example.test/hub-approve", {
    method: "POST",
    body: JSON.stringify({ token: "hub-123", post_id: 99, action: "aprovado" }),
  }));

  assertEquals(response.status, 200);
  const body = await readJson(response);
  assertEquals(body.ok, true);
  assertEquals(body.scheduled, false);
  const rpcCall = db.calls.find((c: { table: string }) => c.table === "rpc:record_post_status_change");
  assertEquals(rpcCall, undefined);
});

Deno.test("hub-approve auto-schedules on the final client-approval etapa of a dual-approval fluxo", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: { cliente_id: 14, is_active: true }, error: null });
  db.queue("workflow_posts", "select", {
    data: { id: 99, workflow_id: 7, status: "enviado_cliente", is_express: false },
    error: null,
  });
  db.queue("workflows", "select", { data: { cliente_id: 14 }, error: null });
  db.queue("clientes", "select", { data: { auto_publish_on_approval: true }, error: null });
  // Second cycle: the copy-approval etapa is done; only the design-approval etapa
  // remains open. The legacy null-tipo row must not count as an approval etapa.
  db.queue("workflow_etapas", "select", {
    data: [
      { tipo: "aprovacao_cliente", status: "concluido" },
      { tipo: null, status: "concluido" },
      { tipo: "aprovacao_cliente", status: "ativo" },
    ],
    error: null,
  });
  queueValidateForScheduling(db, {
    id: 99,
    scheduled_at: "2030-01-01T10:00:00.000Z",
    ig_caption: "legenda",
    workflow_id: 7,
    tipo: "feed",
  });

  const handler = createHubApproveHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });

  const response = await handler(new Request("https://example.test/hub-approve", {
    method: "POST",
    body: JSON.stringify({ token: "hub-123", post_id: 99, action: "aprovado" }),
  }));

  assertEquals(response.status, 200);
  assertEquals((await readJson(response)).scheduled, true);
  const rpcCall = db.calls.find((c: { table: string }) => c.table === "rpc:record_post_status_change");
  assert(rpcCall, "status change RPC should be called on the final approval");
  assertEquals(rpcCall.payload, {
    p_post_id: 99,
    p_new_status: "agendado",
    p_source: "system",
  });
});

Deno.test("hub-approve fails closed when the etapa lookup errors: approval stands, no auto-schedule", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: { cliente_id: 14, is_active: true }, error: null });
  db.queue("workflow_posts", "select", {
    data: { id: 99, workflow_id: 7, status: "enviado_cliente", is_express: false },
    error: null,
  });
  db.queue("workflows", "select", { data: { cliente_id: 14 }, error: null });
  db.queue("clientes", "select", { data: { auto_publish_on_approval: true }, error: null });
  // A failed lookup must not read as "zero open approval etapas": that would
  // auto-schedule mid dual-approval, the exact outcome the guard prevents.
  db.queue("workflow_etapas", "select", { data: null, error: { message: "db offline" } });
  // Schedulable post: proves the skip comes from the failed lookup, not validation.
  queueValidateForScheduling(db, {
    id: 99,
    scheduled_at: "2030-01-01T10:00:00.000Z",
    ig_caption: "legenda",
    workflow_id: 7,
    tipo: "feed",
  });

  const handler = createHubApproveHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });

  const response = await handler(new Request("https://example.test/hub-approve", {
    method: "POST",
    body: JSON.stringify({ token: "hub-123", post_id: 99, action: "aprovado" }),
  }));

  assertEquals(response.status, 200);
  const body = await readJson(response);
  assertEquals(body.ok, true);
  assertEquals(body.scheduled, false);
  const rpcCall = db.calls.find((c: { table: string }) => c.table === "rpc:record_post_status_change");
  assertEquals(rpcCall, undefined);
});

Deno.test("hub-posts suspends every workflow when the etapa lookup errors", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queue("workflows", "select", { data: [{ id: 7 }, { id: 8 }], error: null });
  db.queue("workflow_posts", "select", { data: [], error: null });
  db.queue("instagram_accounts", "select", { data: null, error: null });
  db.queue("clientes", "select", { data: { auto_publish_on_approval: true }, error: null });
  // Without the etapa picture the portal must not promise "aprovar = agendar".
  db.queue("workflow_etapas", "select", { data: null, error: { message: "db offline" } });

  const handler = createHubPostsHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
    signGetUrl: async (key: string) => `https://cdn.test/${key}`,
  });

  const response = await handler(new Request("https://example.test/hub-posts?token=hub-123"));
  const body = await readJson(response);

  assertEquals(response.status, 200);
  assertEquals(body.autoPublishOnApproval, true);
  assertEquals(body.autoPublishSuspendedWorkflowIds, [7, 8]);
});

Deno.test("hub-posts flags workflows whose auto-publish is suspended by a later approval etapa", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queue("workflows", "select", { data: [{ id: 7 }, { id: 8 }], error: null });
  db.queue("workflow_posts", "select", { data: [], error: null });
  db.queue("instagram_accounts", "select", { data: null, error: null });
  db.queue("clientes", "select", { data: { auto_publish_on_approval: true }, error: null });
  // Workflow 7 still has two open approval etapas (dual approval, first cycle);
  // workflow 8 is on its final approval cycle.
  db.queue("workflow_etapas", "select", {
    data: [
      { workflow_id: 7, tipo: "aprovacao_cliente", status: "ativo" },
      { workflow_id: 7, tipo: "aprovacao_cliente", status: "pendente" },
      { workflow_id: 8, tipo: "aprovacao_cliente", status: "concluido" },
      { workflow_id: 8, tipo: "aprovacao_cliente", status: "ativo" },
    ],
    error: null,
  });

  const handler = createHubPostsHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
    signGetUrl: async (key: string) => `https://cdn.test/${key}`,
  });

  const response = await handler(new Request("https://example.test/hub-posts?token=hub-123"));
  const body = await readJson(response);

  assertEquals(response.status, 200);
  assertEquals(body.autoPublishOnApproval, true);
  assertEquals(body.autoPublishSuspendedWorkflowIds, [7]);
});

Deno.test("hub-posts skips the etapa lookup when auto-publish is off", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queue("workflows", "select", { data: [{ id: 7 }], error: null });
  db.queue("workflow_posts", "select", { data: [], error: null });
  db.queue("instagram_accounts", "select", { data: null, error: null });
  db.queue("clientes", "select", { data: { auto_publish_on_approval: false }, error: null });

  const handler = createHubPostsHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
    signGetUrl: async (key: string) => `https://cdn.test/${key}`,
  });

  const response = await handler(new Request("https://example.test/hub-posts?token=hub-123"));
  const body = await readJson(response);

  assertEquals(response.status, 200);
  assertEquals(body.autoPublishOnApproval, false);
  assertEquals(body.autoPublishSuspendedWorkflowIds, []);
  const etapaCall = db.calls.find((c: { table: string }) => c.table === "workflow_etapas");
  assertEquals(etapaCall, undefined);
});

Deno.test("hub-brand returns client brand assets from the same workspace", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queue("clientes", "select", { data: { id: 14 }, error: null });
  db.queue("hub_brand", "select", { data: { primary_color: "#0f766e" }, error: null });
  db.queue("hub_brand_files", "select", { data: [{ id: "f1", name: "Manual" }], error: null });

  const handler = createHubBrandHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });

  const response = await handler(new Request("https://example.test/hub-brand?token=hub-123"));
  const body = await readJson(response);

  assertEquals(response.status, 200);
  assertEquals(body.brand.primary_color, "#0f766e");
  assertEquals(body.files.length, 1);
});

Deno.test("hub-brand rejects links when the client does not belong to the workspace", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queue("clientes", "select", { data: null, error: null });

  const handler = createHubBrandHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });

  const response = await handler(new Request("https://example.test/hub-brand?token=hub-123"));
  assertEquals(response.status, 404);
});

Deno.test("hub-pages lists client pages and strips joined workspace metadata", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queue("clientes", "select", { data: { id: 14 }, error: null });
  db.queue("hub_pages", "select", {
    data: [{ id: "page-1", title: "Boas-vindas", display_order: 0, clientes: { conta_id: "conta-1" } }],
    error: null,
  });

  const handler = createHubPagesHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });

  const response = await handler(new Request("https://example.test/hub-pages?token=hub-123"));
  const body = await readJson(response);

  assertEquals(response.status, 200);
  assertEquals(body.pages, [{ id: "page-1", title: "Boas-vindas", display_order: 0 }]);
});

Deno.test("hub-pages returns 404 when a requested page does not exist", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queue("clientes", "select", { data: { id: 14 }, error: null });
  db.queue("hub_pages", "select", { data: null, error: null });

  const handler = createHubPagesHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });

  const response = await handler(new Request("https://example.test/hub-pages?token=hub-123&page_id=page-404"));
  assertEquals(response.status, 404);
});

Deno.test("hub-briefing returns the client questionnaire for a valid token", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, is_active: true, clientes: { conta_id: "conta-1" } },
    error: null,
  });
  db.queue("briefings", "select", {
    data: [{ id: "b1", title: "Briefing", display_order: 0 }],
    error: null,
  });
  db.queue("hub_briefing_questions", "select", {
    data: [
      {
        id: "q1",
        question: "Qual o objetivo principal?",
        answer: null,
        section: null,
        display_order: 0,
        briefing_id: "b1",
      },
    ],
    error: null,
  });

  const handler = createHubBriefingHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });

  const response = await handler(new Request("https://example.test/hub-briefing?token=hub-123"));
  const body = await readJson(response);

  assertEquals(response.status, 200);
  assertEquals(body.briefings.length, 1);
  assertEquals(body.briefings[0].questions.length, 1);
});

Deno.test("hub-briefing validates required POST fields", async () => {
  const handler = createHubBriefingHandler({
    buildCorsHeaders,
    createDb: () => createSupabaseQueryMock() as never,
    now,
  });

  const response = await handler(new Request("https://example.test/hub-briefing", {
    method: "POST",
    body: JSON.stringify({ token: "hub-123", answer: "Queremos mais leads" }),
  }));

  assertEquals(response.status, 400);
});

Deno.test("hub-ideias creates a new idea with filtered links", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, is_active: true, clientes: { conta_id: "conta-1" } },
    error: null,
  });
  db.queue("ideias", "insert", {
    data: { id: "34a7c1ef-9a2e-4707-a833-cb8f871a0df8", titulo: "Campanha de Inverno" },
    error: null,
  });

  const handler = createHubIdeiasHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });

  const response = await handler(new Request("https://example.test/hub-ideias", {
    method: "POST",
    body: JSON.stringify({
      token: "hub-123",
      titulo: "Campanha de Inverno",
      descricao: "Sequência de reels com dicas sazonais.",
      links: ["https://www.notion.so/ideia", "", null],
    }),
  }));
  const body = await readJson(response);

  assertEquals(response.status, 201);
  assertEquals(body.ideia.titulo, "Campanha de Inverno");
});

Deno.test("hub-ideias blocks editing locked ideas", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, is_active: true, clientes: { conta_id: "conta-1" } },
    error: null,
  });
  db.queue("ideias", "select", {
    data: { status: "aprovada", comentario_agencia: null },
    error: null,
  });

  const handler = createHubIdeiasHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });

  const response = await handler(new Request("https://example.test/hub-ideias/34a7c1ef-9a2e-4707-a833-cb8f871a0df8?token=hub-123", {
    method: "PATCH",
    body: JSON.stringify({ titulo: "Nova ideia" }),
  }));

  assertEquals(response.status, 409);
});

// ---------------------------------------------------------------------------
// Error-path coverage (Tier 3)
// ---------------------------------------------------------------------------

Deno.test("hub-bootstrap handles CORS preflight with 200", async () => {
  const handler = createHubBootstrapHandler({
    buildCorsHeaders,
    createDb: () => createSupabaseQueryMock() as never,
    now,
    touchToken: noopTouchToken,
  });
  const response = await handler(new Request("https://example.test/hub-bootstrap", { method: "OPTIONS" }));
  assertEquals(response.status, 200);
});

Deno.test("hub-bootstrap rejects non-GET methods with 405", async () => {
  const handler = createHubBootstrapHandler({
    buildCorsHeaders,
    createDb: () => createSupabaseQueryMock() as never,
    now,
    touchToken: noopTouchToken,
  });
  const response = await handler(new Request("https://example.test/hub-bootstrap?workspace=x&token=y", { method: "POST" }));
  assertEquals(response.status, 405);
});

Deno.test("hub-bootstrap returns 404 when the workspace slug is unknown", async () => {
  const db = createSupabaseQueryMock();
  db.queue("workspaces", "select", { data: null, error: null });

  const handler = createHubBootstrapHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
    touchToken: noopTouchToken,
  });
  const response = await handler(new Request("https://example.test/hub-bootstrap?workspace=nope&token=hub-123"));
  assertEquals(response.status, 404);
});

Deno.test("hub-bootstrap returns 403 when the workspace has the hub disabled", async () => {
  const db = createSupabaseQueryMock();
  db.queue("workspaces", "select", {
    data: { id: "conta-1", name: "Mesaas", logo_url: null, brand_color: null, hub_enabled: false },
    error: null,
  });

  const handler = createHubBootstrapHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
    touchToken: noopTouchToken,
  });
  const response = await handler(new Request("https://example.test/hub-bootstrap?workspace=mesaas&token=hub-123"));
  assertEquals(response.status, 403);
});

Deno.test("hub-bootstrap returns 404 when the hub token is missing or inactive", async () => {
  const db = createSupabaseQueryMock();
  db.queue("workspaces", "select", {
    data: { id: "conta-1", name: "Mesaas", logo_url: null, brand_color: null, hub_enabled: true },
    error: null,
  });
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, is_active: false },
    error: null,
  });

  const handler = createHubBootstrapHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
    touchToken: noopTouchToken,
  });
  const response = await handler(new Request("https://example.test/hub-bootstrap?workspace=mesaas&token=hub-123"));
  assertEquals(response.status, 404);
});

Deno.test("hub-approve rejects non-POST methods with 405", async () => {
  const handler = createHubApproveHandler({
    buildCorsHeaders,
    createDb: () => createSupabaseQueryMock() as never,
    now,
  });
  const response = await handler(new Request("https://example.test/hub-approve", { method: "GET" }));
  assertEquals(response.status, 405);
});

Deno.test("hub-approve rejects missing required fields with 400", async () => {
  const handler = createHubApproveHandler({
    buildCorsHeaders,
    createDb: () => createSupabaseQueryMock() as never,
    now,
  });
  const response = await handler(new Request("https://example.test/hub-approve", {
    method: "POST",
    body: JSON.stringify({ token: "hub-123" }),
  }));
  assertEquals(response.status, 400);
});

Deno.test("hub-approve returns 404 when the post cannot be found", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: { cliente_id: 14, is_active: true }, error: null });
  db.queue("workflow_posts", "select", { data: null, error: null });

  const handler = createHubApproveHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });
  const response = await handler(new Request("https://example.test/hub-approve", {
    method: "POST",
    body: JSON.stringify({ token: "hub-123", post_id: 99, action: "aprovado" }),
  }));
  assertEquals(response.status, 404);
});

Deno.test("hub-approve returns 403 when the post belongs to a different client", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: { cliente_id: 14, is_active: true }, error: null });
  db.queue("workflow_posts", "select", { data: { id: 99, workflow_id: 7, status: "enviado_cliente" }, error: null });
  db.queue("workflows", "select", { data: { cliente_id: 999 }, error: null });

  const handler = createHubApproveHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });
  const response = await handler(new Request("https://example.test/hub-approve", {
    method: "POST",
    body: JSON.stringify({ token: "hub-123", post_id: 99, action: "aprovado" }),
  }));
  assertEquals(response.status, 403);
});

Deno.test("hub-approve returns 500 when recording the approval fails", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: { cliente_id: 14, is_active: true }, error: null });
  db.queue("workflow_posts", "select", { data: { id: 99, workflow_id: 7, status: "enviado_cliente" }, error: null });
  db.queue("workflows", "select", { data: { cliente_id: 14 }, error: null });
  // aprovado/correcao now go through the record_client_approval RPC (atomic
  // insert + status). A failure there must surface as a 500.
  db.queueRpc("record_client_approval", { data: null, error: { message: "constraint violation" } });

  const handler = createHubApproveHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });
  const response = await handler(new Request("https://example.test/hub-approve", {
    method: "POST",
    body: JSON.stringify({ token: "hub-123", post_id: 99, action: "aprovado" }),
  }));
  assertEquals(response.status, 500);
});

Deno.test("hub-approve returns 400 when the post is not awaiting client review", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: { cliente_id: 14, is_active: true }, error: null });
  db.queue("workflow_posts", "select", { data: { id: 99, workflow_id: 7, status: "aprovado_cliente" }, error: null });
  db.queue("workflows", "select", { data: { cliente_id: 14 }, error: null });

  const handler = createHubApproveHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });
  const response = await handler(new Request("https://example.test/hub-approve", {
    method: "POST",
    body: JSON.stringify({ token: "hub-123", post_id: 99, action: "aprovado" }),
  }));
  assertEquals(response.status, 400);
});

Deno.test("hub-posts rejects non-GET methods with 405", async () => {
  const handler = createHubPostsHandler({
    buildCorsHeaders,
    createDb: () => createSupabaseQueryMock() as never,
    now,
    signGetUrl: async () => "https://signed.example",
  });
  const response = await handler(new Request("https://example.test/hub-posts?token=hub-123", { method: "POST" }));
  assertEquals(response.status, 405);
});

Deno.test("hub-posts returns 404 when the hub token is invalid", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: null, error: null });

  const handler = createHubPostsHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
    signGetUrl: async () => "https://signed.example",
  });
  const response = await handler(new Request("https://example.test/hub-posts?token=expired"));
  assertEquals(response.status, 404);
});

Deno.test("hub-posts returns empty collections when the client has no workflows", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queue("workflows", "select", { data: [], error: null });
  db.queue("instagram_accounts", "select", { data: null, error: null });

  const handler = createHubPostsHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
    signGetUrl: async () => "https://signed.example",
  });
  const response = await handler(new Request("https://example.test/hub-posts?token=hub-123"));
  const body = await readJson(response);
  assertEquals(response.status, 200);
  assertEquals(body.posts, []);
  assertEquals(body.postApprovals, []);
  assertEquals(body.instagramProfile, null);
});

Deno.test("hub-posts includes instagramProfile when the client has a linked account", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queue("workflows", "select", { data: [], error: null });
  db.queue("instagram_accounts", "select", {
    data: { username: "studio_marca", profile_picture_url: "https://cdn.ig/pic.jpg" },
    error: null,
  });

  const handler = createHubPostsHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
    signGetUrl: async () => "https://signed.example",
  });
  const response = await handler(new Request("https://example.test/hub-posts?token=hub-123"));
  const body = await readJson(response);

  assertEquals(response.status, 200);
  assertEquals(body.instagramProfile.username, "studio_marca");
  assertEquals(body.instagramProfile.profilePictureUrl, "https://cdn.ig/pic.jpg");
  assertEquals(body.propertyValues, []);
  assertEquals(body.workflowSelectOptions, []);
});

Deno.test("hub-posts returns instagramProfile as null when no account is linked", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queue("workflows", "select", { data: [], error: null });
  db.queue("instagram_accounts", "select", {
    data: null,
    error: null,
  });

  const handler = createHubPostsHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
    signGetUrl: async () => "https://signed.example",
  });
  const response = await handler(new Request("https://example.test/hub-posts?token=hub-123"));
  const body = await readJson(response);

  assertEquals(response.status, 200);
  assertEquals(body.instagramProfile, null);
});

Deno.test("hub-brand rejects missing tokens with 400", async () => {
  const handler = createHubBrandHandler({
    buildCorsHeaders,
    createDb: () => createSupabaseQueryMock() as never,
    now,
  });
  const response = await handler(new Request("https://example.test/hub-brand"));
  assertEquals(response.status, 400);
});

Deno.test("hub-brand returns 404 for an invalid hub token", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: null, error: null });

  const handler = createHubBrandHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });
  const response = await handler(new Request("https://example.test/hub-brand?token=expired"));
  assertEquals(response.status, 404);
});

Deno.test("hub-pages rejects non-GET methods with 405", async () => {
  const handler = createHubPagesHandler({
    buildCorsHeaders,
    createDb: () => createSupabaseQueryMock() as never,
    now,
  });
  const response = await handler(new Request("https://example.test/hub-pages?token=hub-123", { method: "POST" }));
  assertEquals(response.status, 405);
});

Deno.test("hub-pages rejects missing tokens with 400", async () => {
  const handler = createHubPagesHandler({
    buildCorsHeaders,
    createDb: () => createSupabaseQueryMock() as never,
    now,
  });
  const response = await handler(new Request("https://example.test/hub-pages"));
  assertEquals(response.status, 400);
});

Deno.test("hub-pages returns 404 when the client does not belong to the workspace", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queue("clientes", "select", { data: null, error: null });

  const handler = createHubPagesHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });
  const response = await handler(new Request("https://example.test/hub-pages?token=hub-123"));
  assertEquals(response.status, 404);
});

Deno.test("hub-briefing rejects malformed JSON on POST with 400", async () => {
  const handler = createHubBriefingHandler({
    buildCorsHeaders,
    createDb: () => createSupabaseQueryMock() as never,
    now,
  });
  const response = await handler(new Request("https://example.test/hub-briefing", {
    method: "POST",
    body: "{not-json",
  }));
  assertEquals(response.status, 400);
});

Deno.test("hub-briefing rejects unknown HTTP methods with 405", async () => {
  const handler = createHubBriefingHandler({
    buildCorsHeaders,
    createDb: () => createSupabaseQueryMock() as never,
    now,
  });
  const response = await handler(new Request("https://example.test/hub-briefing", { method: "DELETE" }));
  assertEquals(response.status, 405);
});

Deno.test("hub-briefing returns 404 when the target question is missing", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, is_active: true, clientes: { conta_id: "conta-1" } },
    error: null,
  });
  db.queue("hub_briefing_questions", "select", { data: null, error: null });

  const handler = createHubBriefingHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });
  const response = await handler(new Request("https://example.test/hub-briefing", {
    method: "POST",
    body: JSON.stringify({ token: "hub-123", question_id: "q-missing", answer: "resposta" }),
  }));
  assertEquals(response.status, 404);
});

Deno.test("hub-ideias rejects missing tokens with 400", async () => {
  const handler = createHubIdeiasHandler({
    buildCorsHeaders,
    createDb: () => createSupabaseQueryMock() as never,
    now,
  });
  const response = await handler(new Request("https://example.test/hub-ideias", {
    method: "POST",
    body: JSON.stringify({ titulo: "x" }),
  }));
  assertEquals(response.status, 400);
});

Deno.test("hub-ideias returns 404 for expired or inactive hub tokens", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: null, error: null });

  const handler = createHubIdeiasHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });
  const response = await handler(new Request("https://example.test/hub-ideias?token=expired"));
  assertEquals(response.status, 404);
});

Deno.test("hub-ideias rejects POSTs missing titulo with 400", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, is_active: true, clientes: { conta_id: "conta-1" } },
    error: null,
  });

  const handler = createHubIdeiasHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });
  const response = await handler(new Request("https://example.test/hub-ideias", {
    method: "POST",
    body: JSON.stringify({ token: "hub-123", descricao: "só a descrição" }),
  }));
  assertEquals(response.status, 400);
});

Deno.test("hub-ideias rejects POSTs missing descricao with 400", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, is_active: true, clientes: { conta_id: "conta-1" } },
    error: null,
  });

  const handler = createHubIdeiasHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });
  const response = await handler(new Request("https://example.test/hub-ideias", {
    method: "POST",
    body: JSON.stringify({ token: "hub-123", titulo: "só o título" }),
  }));
  assertEquals(response.status, 400);
});

Deno.test("hub-ideias returns 500 when the insert reports an error", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, is_active: true, clientes: { conta_id: "conta-1" } },
    error: null,
  });
  db.queue("ideias", "insert", { data: null, error: { message: "db offline" } });

  const handler = createHubIdeiasHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });
  const response = await handler(new Request("https://example.test/hub-ideias", {
    method: "POST",
    body: JSON.stringify({ token: "hub-123", titulo: "Ideia", descricao: "descrição" }),
  }));
  assertEquals(response.status, 500);
  assertEquals(await readJson(response), { error: "Internal server error" });
});

Deno.test("hub-ideias returns 404 when PATCH targets a non-existent idea", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, is_active: true, clientes: { conta_id: "conta-1" } },
    error: null,
  });
  db.queue("ideias", "select", { data: null, error: null });

  const handler = createHubIdeiasHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });
  const response = await handler(new Request("https://example.test/hub-ideias/34a7c1ef-9a2e-4707-a833-cb8f871a0df8?token=hub-123", {
    method: "PATCH",
    body: JSON.stringify({ titulo: "Novo" }),
  }));
  assertEquals(response.status, 404);
});

Deno.test("hub-ideias returns 404 for unsupported routes", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, is_active: true, clientes: { conta_id: "conta-1" } },
    error: null,
  });

  const handler = createHubIdeiasHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });
  const response = await handler(new Request("https://example.test/hub-ideias?token=hub-123", { method: "PUT" }));
  assertEquals(response.status, 404);
});

Deno.test("hub-instagram-feed returns profile and recent posts for a valid token", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queue("instagram_accounts", "select", {
    data: {
      id: "ig-acc-1",
      username: "studio_marca",
      profile_picture_url: "https://cdn.ig/pic.jpg",
      follower_count: 15300,
      following_count: 892,
      media_count: 42,
    },
    error: null,
  });
  db.queue("instagram_posts", "select", {
    data: [
      {
        instagram_post_id: "ig-post-1",
        thumbnail_url: "https://cdn.ig/thumb1.jpg",
        media_type: "IMAGE",
        permalink: "https://instagram.com/p/abc",
        posted_at: "2026-04-20T10:00:00.000Z",
        impressions: 5292,
      },
      {
        instagram_post_id: "ig-post-2",
        thumbnail_url: null,
        media_type: "CAROUSEL_ALBUM",
        permalink: "https://instagram.com/p/def",
        posted_at: "2026-04-18T14:00:00.000Z",
        impressions: 4555,
      },
    ],
    error: null,
  });

  const handler = createHubInstagramFeedHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });

  const response = await handler(new Request("https://example.test/hub-instagram-feed?token=hub-123"));
  const body = await readJson(response);

  assertEquals(response.status, 200);
  assertEquals(body.profile.username, "studio_marca");
  assertEquals(body.profile.followerCount, 15300);
  assertEquals(body.recentPosts.length, 2);
  assertEquals(body.recentPosts[0].id, "ig-post-1");
  assertEquals(body.recentPosts[1].thumbnailUrl, null);
});

Deno.test("hub-instagram-feed returns 404 when no Instagram account is linked", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queue("instagram_accounts", "select", {
    data: null,
    error: null,
  });

  const handler = createHubInstagramFeedHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });

  const response = await handler(new Request("https://example.test/hub-instagram-feed?token=hub-123"));
  assertEquals(response.status, 404);
});

Deno.test("hub-instagram-feed rejects missing tokens with 400", async () => {
  const handler = createHubInstagramFeedHandler({
    buildCorsHeaders,
    createDb: () => createSupabaseQueryMock() as never,
    now,
  });

  const response = await handler(new Request("https://example.test/hub-instagram-feed"));
  assertEquals(response.status, 400);
});

Deno.test("hub-instagram-feed returns 404 for invalid tokens", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: null, error: null });

  const handler = createHubInstagramFeedHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });

  const response = await handler(new Request("https://example.test/hub-instagram-feed?token=expired"));
  assertEquals(response.status, 404);
});

// ---------------------------------------------------------------------------
// R2 key filtering (security regression)
// ---------------------------------------------------------------------------

Deno.test("hub-posts: filters out R2 keys from other workspaces", async () => {
  const db = createSupabaseQueryMock();

  // Token validation
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });

  // Workflows
  db.queue("workflows", "select", { data: [{ id: 7 }], error: null });

  // Posts — content with two R2 keys: one safe (same workspace), one cross-tenant
  const contentWithMixedKeys = {
    type: "doc",
    content: [
      { type: "inlineImage", attrs: { r2Key: "contas/conta-1/files/safe.png" } },
      { type: "inlineImage", attrs: { r2Key: "contas/other-ws/files/stolen.png" } },
    ],
  };
  db.queue("workflow_posts", "select", {
    data: [
      {
        id: 1,
        titulo: "Post com R2",
        tipo: "feed",
        status: "enviado_cliente",
        ordem: 0,
        conteudo: contentWithMixedKeys,
        conteudo_plain: "",
        scheduled_at: null,
        ig_caption: null,
        instagram_permalink: null,
        published_at: null,
        publish_error: null,
        workflow_id: 7,
        workflows: { titulo: "Cal", created_at: "2026-04-01" },
      },
    ],
    error: null,
  });

  // Post approvals
  db.queue("post_approvals", "select", { data: [], error: null });

  // Property values
  db.queue("post_property_values", "select", { data: [], error: null });

  // Workflow select options
  db.queue("workflow_select_options", "select", { data: [], error: null });

  // Post file links (no media files for simplicity)
  db.queue("post_file_links", "select", { data: [], error: null });

  // Files table validation — only the safe key exists
  db.queue("files", "select", {
    data: [{ r2_key: "contas/conta-1/files/safe.png" }],
    error: null,
  });

  // Instagram account
  db.queue("instagram_accounts", "select", { data: null, error: null });

  // Client auto_publish_on_approval
  db.queue("clientes", "select", { data: { auto_publish_on_approval: false }, error: null });

  const signedKeys: string[] = [];
  const handler = createHubPostsHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
    signGetUrl: async (key) => {
      signedKeys.push(key);
      return `https://signed/${key}`;
    },
  });

  const res = await handler(new Request("https://example.test/hub-posts?token=hub-123"));
  assertEquals(res.status, 200);
  assertEquals(signedKeys.length, 1);
  assertEquals(signedKeys[0], "contas/conta-1/files/safe.png");
});

Deno.test("hub-posts: skips R2 keys not found in files table", async () => {
  const db = createSupabaseQueryMock();

  // Token validation
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });

  // Workflows
  db.queue("workflows", "select", { data: [{ id: 7 }], error: null });

  // Posts — content with one R2 key that matches prefix but is not in files table
  const content = {
    type: "doc",
    content: [
      { type: "inlineImage", attrs: { r2Key: "contas/conta-1/files/nonexistent.png" } },
    ],
  };
  db.queue("workflow_posts", "select", {
    data: [
      {
        id: 1,
        titulo: "Post fantasma",
        tipo: "feed",
        status: "enviado_cliente",
        ordem: 0,
        conteudo: content,
        conteudo_plain: "",
        scheduled_at: null,
        ig_caption: null,
        instagram_permalink: null,
        published_at: null,
        publish_error: null,
        workflow_id: 7,
        workflows: { titulo: "Cal", created_at: "2026-04-01" },
      },
    ],
    error: null,
  });

  // Post approvals
  db.queue("post_approvals", "select", { data: [], error: null });

  // Property values
  db.queue("post_property_values", "select", { data: [], error: null });

  // Workflow select options
  db.queue("workflow_select_options", "select", { data: [], error: null });

  // Post file links (no media files)
  db.queue("post_file_links", "select", { data: [], error: null });

  // Files table validation — key not in files table
  db.queue("files", "select", { data: [], error: null });

  // Instagram account
  db.queue("instagram_accounts", "select", { data: null, error: null });

  // Client auto_publish_on_approval
  db.queue("clientes", "select", { data: { auto_publish_on_approval: false }, error: null });

  const signedKeys: string[] = [];
  const handler = createHubPostsHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
    signGetUrl: async (key) => {
      signedKeys.push(key);
      return `https://signed/${key}`;
    },
  });

  const res = await handler(new Request("https://example.test/hub-posts?token=hub-123"));
  assertEquals(res.status, 200);
  assertEquals(signedKeys.length, 0);
});
