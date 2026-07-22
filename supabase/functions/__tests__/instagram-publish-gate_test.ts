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
