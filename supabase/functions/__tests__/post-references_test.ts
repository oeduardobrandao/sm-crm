import { assert, assertEquals, readJson } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createPostReferencesHandler } from "../post-references/handler.ts";

type Db = ReturnType<typeof createSupabaseQueryMock>;

function makeHandler(db: Db) {
  return createPostReferencesHandler({
    buildCorsHeaders: () => ({ "Access-Control-Allow-Origin": "https://app.mesaas.com" }),
    createDb: () => db as never,
    signGetUrl: async (key: string, _exp?: number, name?: string) =>
      `https://get.example.com/${key}${name ? `?dl=${encodeURIComponent(name)}` : ""}`,
  });
}

function setupAuth(db: Db, contaId: string | null = "conta-1") {
  db.withAuth({ id: "user-1" });
  db.queue("profiles", "select", { data: { conta_id: contaId }, error: null });
}

function req(method: string, path: string) {
  return new Request(`https://x.test/post-references${path}`, {
    method,
    headers: { Authorization: "Bearer jwt" },
  });
}

const FILE_ROW = {
  id: 7, kind: "file", file_id: 70, url: null, link_title: null, note: "Use esta foto",
  post_approval_id: 501, created_at: "2026-10-08T11:00:00.000Z", can_remove: false,
  name: "Relatório (v2).pdf", mime_type: "application/pdf", file_kind: "document", size_bytes: 5000,
  width: null, height: null, duration_seconds: null, r2_key: "contas/conta-1/files/u.pdf",
  thumbnail_r2_key: null, blur_data_url: null,
};
const LINK_ROW = {
  ...FILE_ROW, id: 8, kind: "link", file_id: null, url: "https://exemplo.com/x", link_title: "X",
  name: null, mime_type: null, file_kind: null, size_bytes: null, r2_key: null, post_approval_id: null,
};

Deno.test("post-references: missing or invalid auth is 401", async () => {
  const db = createSupabaseQueryMock();
  assertEquals((await makeHandler(db)(new Request("https://x.test/post-references?post_id=99"))).status, 401);
  const db2 = createSupabaseQueryMock();
  db2.withAuth(null, { message: "bad jwt" });
  assertEquals((await makeHandler(db2)(req("GET", "?post_id=99"))).status, 401);
});

Deno.test("post-references: profile without conta_id is 403", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db, null);
  assertEquals((await makeHandler(db)(req("GET", "?post_id=99"))).status, 403);
});

Deno.test("post-references: GET lists items with a download URL on files only", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("workflow_posts", "select", { data: { id: 99 }, error: null });
  db.queueRpc("post_reference_list", { data: [FILE_ROW, LINK_ROW], error: null });
  const res = await makeHandler(db)(req("GET", "?post_id=99"));
  assertEquals(res.status, 200);
  const { items } = await readJson(res);
  assertEquals(items.length, 2);
  assertEquals(items[0].url, "https://get.example.com/contas/conta-1/files/u.pdf");
  assertEquals(
    items[0].download_url,
    `https://get.example.com/contas/conta-1/files/u.pdf?dl=${encodeURIComponent("Relatório (v2).pdf")}`,
  );
  assertEquals(items[0].post_approval_id, 501);
  assertEquals(items[1].kind, "link");
  assertEquals(items[1].download_url, null);

  const postLookup = db.calls.find((c) => c.table === "workflow_posts");
  assert(postLookup?.modifiers.some((m) => m.method === "eq" && m.args[0] === "conta_id" && m.args[1] === "conta-1"));
  assertEquals(db.calls.find((c) => c.table === "rpc:post_reference_list")?.payload, { p_post_id: 99, p_conta: "conta-1" });
});

Deno.test("post-references: GET for a post outside the workspace is 404 and never lists", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("workflow_posts", "select", { data: null, error: null });
  const res = await makeHandler(db)(req("GET", "?post_id=99"));
  assertEquals(res.status, 404);
  assertEquals((await readJson(res)).error, "not_found");
  assertEquals(db.calls.find((c) => c.table === "rpc:post_reference_list"), undefined);
});

Deno.test("post-references: DELETE requires entregas/editar", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queueRpc("has_permission_for", { data: false, error: null });
  const res = await makeHandler(db)(req("DELETE", "/7"));
  assertEquals(res.status, 403);
  assertEquals(await readJson(res), { error: "forbidden" });
  assertEquals(db.calls.find((c) => c.table === "post_references" && c.operation === "delete"), undefined);
  assertEquals(db.calls.find((c) => c.table === "rpc:has_permission_for")?.payload, {
    p_user: "user-1", p_workspace: "conta-1", p_module: "entregas", p_action: "editar",
  });
});

Deno.test("post-references: DELETE removes the row filtered by id and conta_id", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("post_references", "delete", { data: [{ id: 7, post_id: 99, kind: "file" }], error: null });
  const res = await makeHandler(db)(req("DELETE", "/7"));
  assertEquals(res.status, 200);
  assertEquals(await readJson(res), { ok: true });
  const del = db.calls.find((c) => c.table === "post_references" && c.operation === "delete");
  assertEquals(del?.modifiers.filter((m) => m.method === "eq"), [
    { method: "eq", args: ["id", 7] },
    { method: "eq", args: ["conta_id", "conta-1"] },
  ]);
  const audit = db.calls.find((c) => c.table === "audit_log");
  assertEquals((audit?.payload as { action: string }).action, "delete_post_reference");
});

Deno.test("post-references: DELETE of a missing or foreign row is 404", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("post_references", "delete", { data: [], error: null });
  const res = await makeHandler(db)(req("DELETE", "/7"));
  assertEquals(res.status, 404);
  assertEquals((await readJson(res)).error, "not_found");
});

Deno.test("post-references: DELETE with a non-numeric id is 404 without a permission check", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const res = await makeHandler(db)(req("DELETE", "/abc"));
  assertEquals(res.status, 404);
  assertEquals(db.calls.find((c) => c.table === "rpc:has_permission_for"), undefined);
});

Deno.test("post-references: a DB error on delete is a generic 500", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("post_references", "delete", { data: null, error: { message: "permission denied for table" } });
  const res = await makeHandler(db)(req("DELETE", "/7"));
  assertEquals(res.status, 500);
  assertEquals(await readJson(res), { error: "internal" });
});
