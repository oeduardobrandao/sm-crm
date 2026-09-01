import { assertEquals, readJson } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createPublishHandler } from "../instagram-publish/handler.ts";

// The handler uses both createDb(token) (user-scoped, RLS) and createServiceDb()
// (service role). We hand it the SAME mock for both: the shared mock keys its
// queues by table / rpc name, not by client instance, so a single mock can serve
// reads issued through either db.

function makeHandler(db: ReturnType<typeof createSupabaseQueryMock>) {
  return createPublishHandler({
    buildCorsHeaders: () => ({}),
    createDb: () => db as never,
    createServiceDb: () => db as never,
  });
}

function publishRequest(action: string, postId: number, token = "t") {
  return new Request(`http://x/instagram-publish/${action}/${postId}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
}

// Queues the two reads every gated/ungated action performs before branching:
//   workflow_posts .select().eq().single()  -> the post row (with `status`)
//   profiles       .select("conta_id").eq().single() -> caller workspace
function setupPostAndProfile(
  db: ReturnType<typeof createSupabaseQueryMock>,
  status: string,
  contaId = "ws-1",
) {
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: { id: 1, status }, error: null });
  db.queue("profiles", "select", { data: { conta_id: contaId }, error: null });
}

// ─── schedule: feature OFF → 403, before any IG util ──────────────

Deno.test("instagram-publish: schedule with feature OFF returns 403 feature_disabled", async () => {
  const db = createSupabaseQueryMock();
  setupPostAndProfile(db, "aprovado_cliente");
  db.queueRpc("effective_plan_feature", { data: false, error: null });
  const handler = makeHandler(db);
  const res = await handler(publishRequest("schedule", 1));
  assertEquals(res.status, 403);
  const body = await readJson(res);
  assertEquals(body, { error: "feature_disabled", feature: "feature_post_scheduling" });
});

// ─── publish-now: feature OFF → 403 ───────────────────────────────

Deno.test("instagram-publish: publish-now with feature OFF returns 403 feature_disabled", async () => {
  const db = createSupabaseQueryMock();
  setupPostAndProfile(db, "aprovado_cliente");
  db.queueRpc("effective_plan_feature", { data: false, error: null });
  const handler = makeHandler(db);
  const res = await handler(publishRequest("publish-now", 1));
  assertEquals(res.status, 403);
  const body = await readJson(res);
  assertEquals(body, { error: "feature_disabled", feature: "feature_post_scheduling" });
});

// ─── cancel: NOT gated even with feature OFF ──────────────────────

Deno.test("instagram-publish: cancel is not gated (feature OFF) → 200", async () => {
  const db = createSupabaseQueryMock();
  setupPostAndProfile(db, "agendado");
  // Feature gate must NOT be consulted for cancel; queue it false anyway to prove
  // it is ignored (if cancel were gated, this would 403).
  db.queueRpc("effective_plan_feature", { data: false, error: null });
  db.queueRpc("record_post_status_change", { data: null, error: null });
  const handler = makeHandler(db);
  const res = await handler(publishRequest("cancel", 1));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body, { ok: true, status: "aprovado_cliente" });
});

// ─── retry: NOT gated even with feature OFF ───────────────────────

Deno.test("instagram-publish: retry is not gated (feature OFF) → 200", async () => {
  const db = createSupabaseQueryMock();
  setupPostAndProfile(db, "falha_publicacao");
  db.queueRpc("effective_plan_feature", { data: false, error: null });
  db.queueRpc("record_post_status_change", { data: null, error: null });
  const handler = makeHandler(db);
  const res = await handler(publishRequest("retry", 1));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body, { ok: true, status: "agendado" });
});

// ─── schedule: feature ON, wrong status → 422 (gate passed) ───────

Deno.test("instagram-publish: schedule with feature ON but status rascunho → 422", async () => {
  const db = createSupabaseQueryMock();
  // status is NOT aprovado_cliente, so the post-status guard rejects with 422
  // *after* the feature gate passes — proving the gate let it through without
  // ever calling validateForScheduling (which would hit the network).
  setupPostAndProfile(db, "rascunho");
  db.queueRpc("effective_plan_feature", { data: true, error: null });
  const handler = makeHandler(db);
  const res = await handler(publishRequest("schedule", 1));
  assertEquals(res.status, 422);
});

// ─── schedule: feature ON, status OK, validateForScheduling fails (no media)
//     → 422 with details array ──────────────────────────────────────────────

Deno.test("instagram-publish: schedule with no media fails validateForScheduling → 422 with details", async () => {
  const db = createSupabaseQueryMock();
  // Post row read TWICE: once by the handler's access check (userDb), once by
  // validateForScheduling's own lookup (svcDb) — same mock serves both.
  const post = {
    id: 1,
    status: "aprovado_cliente",
    workflow_id: 9,
    cliente_id: 5,
    scheduled_at: "2030-01-01T12:00:00Z",
    ig_caption: "cap",
    instagram_container_id: null,
    publish_retry_count: 0,
    tipo: "feed",
  };
  db.withAuth({ id: "actor-1" });
  db.queue("workflow_posts", "select", { data: post, error: null });
  db.queue("workflow_posts", "select", { data: post, error: null });
  db.queue("profiles", "select", { data: { conta_id: "ws-1" }, error: null });
  db.queueRpc("effective_plan_feature", { data: true, error: null });
  // No media attached → validateForScheduling's media check fails.
  db.queue("post_file_links", "select", { data: [], error: null });
  db.queue("instagram_accounts", "select", {
    data: {
      encrypted_access_token: null,
      instagram_user_id: "ig",
      token_expires_at: null,
      authorization_status: "connected",
    },
    error: null,
  });

  const handler = makeHandler(db);
  const res = await handler(publishRequest("schedule", 1));

  assertEquals(res.status, 422);
  const body = await readJson(res);
  assertEquals(Array.isArray(body.details), true);
  assertEquals(body.details.length > 0, true);
  assertEquals(
    body.details.includes("Post precisa de pelo menos uma mídia."),
    true,
  );
});
