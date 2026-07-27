import { assertEquals, readJson } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createDataImportHandler } from "../data-import/handler.ts";

const buildCorsHeaders = () => ({ "Access-Control-Allow-Origin": "https://app.mesaas.com" });

const ENTITLED = {
  planName: "pro",
  limits: { max_clients: 10, max_workflow_templates: 10, max_posts_per_workflow: 100 },
  features: { feature_csv_import: true },
};

function makeHandler(db: ReturnType<typeof createSupabaseQueryMock>, entitlements: unknown = ENTITLED) {
  return createDataImportHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    resolveEntitlements: async () => entitlements as never,
    geminiKey: null,
  });
}

// createSupabaseQueryMock has no setUser — the sibling tests (e.g.
// post-media-manage_test.ts) authenticate via withAuth(user) + queuing the
// profiles lookup the handler performs right after. Mirrored here rather than
// inventing a new mock method.
function authAs(db: ReturnType<typeof createSupabaseQueryMock>) {
  db.withAuth({ id: "user-1" });
  db.queue("profiles", "select", { data: { conta_id: "conta-1" }, error: null });
}

// The mock has no lastRpcArgs() accessor; db.calls already records every rpc
// call as { table: "rpc:<name>", operation: "rpc", payload: <params> }, so we
// read the last matching call instead of extending the mock's public API.
function lastRpcArgs(db: ReturnType<typeof createSupabaseQueryMock>, name: string): Record<string, unknown> {
  const calls = db.calls.filter((c) => c.table === `rpc:${name}`);
  const last = calls[calls.length - 1];
  return last?.payload as Record<string, unknown>;
}

function post(path: string, body: unknown) {
  return new Request(`https://x.test/data-import/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer jwt" },
    body: JSON.stringify(body),
  });
}

Deno.test("data-import: rejects when feature_csv_import is off", async () => {
  const db = createSupabaseQueryMock();
  authAs(db);
  const gated = { ...ENTITLED, features: { feature_csv_import: false } };
  const res = await makeHandler(db, gated)(post("start", { source: "csv", totalRows: 1 }));
  assertEquals(res.status, 403);
});

Deno.test("data-import: start creates a job", async () => {
  const db = createSupabaseQueryMock();
  authAs(db);
  db.queue("import_jobs", "insert", { data: { id: 7 }, error: null });
  const res = await makeHandler(db)(post("start", { source: "trello", totalRows: 42 }));
  assertEquals(res.status, 200);
  assertEquals(await readJson(res), { jobId: 7 });
});

Deno.test("data-import: preview counts rows and warns on max_clients", async () => {
  const db = createSupabaseQueryMock();
  authAs(db);
  db.queue("clientes", "select", { data: null, error: null, count: 9 }); // 9 existing, cap 10
  const rows = [
    { kind: "cliente", sourceKey: "a", nome: "Ana" },
    { kind: "cliente", sourceKey: "b", nome: "Bia" },
  ];
  const res = await makeHandler(db)(post("preview", { rows }));
  const body = await readJson(res);
  assertEquals(body.counts.clientes, 2);
  assertEquals(body.limits.maxPostsPerWorkflow, 100);
  assertEquals(body.warnings.length, 1); // 9 + 2 > 10
});

Deno.test("data-import: commit calls the RPC per row and reports skips", async () => {
  const db = createSupabaseQueryMock();
  authAs(db);
  db.queueRpc("import_commit_row", { data: { skipped: false, table: "clientes", row_id: "3" }, error: null });
  db.queueRpc("import_commit_row", { data: { skipped: true, table: "clientes", row_id: "3" }, error: null });
  db.queue("audit_log", "insert", { data: null, error: null });
  const rows = [
    { kind: "cliente", sourceKey: "a", nome: "Ana" },
    { kind: "cliente", sourceKey: "a", nome: "Ana" },
  ];
  const res = await makeHandler(db)(post("commit", { jobId: 7, rows }));
  const body = await readJson(res);
  assertEquals(body.results, [
    { sourceKey: "a", table: "clientes", rowId: "3", skipped: false },
    { sourceKey: "a", table: "clientes", rowId: "3", skipped: true },
  ]);
});

Deno.test("data-import: commit forwards conta_id so the RPC can reject foreign clientes", async () => {
  // Tenant isolation lives in import_resolve_cliente (it raises when clienteId
  // belongs to another workspace); this asserts the handler actually passes the
  // caller's conta_id through, and surfaces the rejection as a failed row.
  const db = createSupabaseQueryMock();
  authAs(db);
  db.queueRpc("import_commit_row", { data: null, error: { message: "cliente 99 does not belong to this workspace" } });
  db.queue("audit_log", "insert", { data: null, error: null });
  const rows = [
    { kind: "ideia", sourceKey: "x", clienteRef: { type: "existing", clienteId: 99 }, titulo: "T", descricao: "", provenance: {} },
  ];
  const res = await makeHandler(db)(post("commit", { jobId: 7, rows }));
  const body = await readJson(res);
  assertEquals(body.results[0].failed, true);
  assertEquals(lastRpcArgs(db, "import_commit_row").p_conta_id, "conta-1");
});

Deno.test("data-import: commit reports per-row failures without aborting the batch", async () => {
  const db = createSupabaseQueryMock();
  authAs(db);
  db.queueRpc("import_commit_row", { data: null, error: { message: "boom" } });
  db.queueRpc("import_commit_row", { data: { skipped: false, table: "ideias", row_id: "u-1" }, error: null });
  db.queue("audit_log", "insert", { data: null, error: null });
  const rows = [
    { kind: "ideia", sourceKey: "x", clienteRef: { type: "existing", clienteId: 1 }, titulo: "T", descricao: "", provenance: {} },
    { kind: "ideia", sourceKey: "y", clienteRef: { type: "existing", clienteId: 1 }, titulo: "U", descricao: "", provenance: {} },
  ];
  const res = await makeHandler(db)(post("commit", { jobId: 7, rows }));
  const body = await readJson(res);
  assertEquals(body.results[0].failed, true);
  assertEquals(body.results[1].rowId, "u-1");
});

Deno.test("data-import: a plan-limit trigger becomes a legible reason, not a generic failure", async () => {
  const db = createSupabaseQueryMock();
  authAs(db);
  db.queueRpc("import_commit_row", { data: null, error: { message: "plan_limit_exceeded:max_clients" } });
  db.queue("audit_log", "insert", { data: null, error: null });
  const rows = [{ kind: "cliente", sourceKey: "a", nome: "Ana" }];
  const res = await makeHandler(db)(post("commit", { jobId: 7, rows }));
  const body = await readJson(res);
  assertEquals(body.results[0].reason, "plan_limit:max_clients");
});

Deno.test("data-import: undo deletes recorded rows in order, skips published posts", async () => {
  const db = createSupabaseQueryMock();
  authAs(db);
  db.queue("import_jobs", "select", {
    data: { id: 7, conta_id: "conta-1", status: "completed", created_at: new Date().toISOString() },
    error: null,
  });
  db.queue("import_job_items", "select", {
    data: [
      { table_name: "workflow_posts", row_id: "31", source_row_key: "p1", ordinal: 0 },
      { table_name: "workflow_posts", row_id: "32", source_row_key: "p2", ordinal: 0 },
      { table_name: "workflows", row_id: "9", source_row_key: "container:1:0", ordinal: 0 },
      { table_name: "workflow_etapas", row_id: "77", source_row_key: "e1", ordinal: 1 },
      { table_name: "clientes", row_id: "3", source_row_key: "a", ordinal: 0 },
    ],
    error: null,
  });
  // published-post guard: one of the two posts has a platform id
  db.queue("workflow_posts", "select", {
    data: [{ id: 31, instagram_media_id: "ig1", tiktok_post_id: null }],
    error: null,
  });
  db.queue("workflow_posts", "delete", { data: null, error: null });
  // container-guard lookup: workflow 9 still holds the surviving published post
  db.queue("workflow_posts", "select", { data: [{ workflow_id: 9 }], error: null });
  db.queue("clientes", "delete", { data: null, error: null });
  db.queue("import_jobs", "update", { data: null, error: null });
  db.queue("audit_log", "insert", { data: null, error: null });
  const res = await makeHandler(db)(post("undo", { jobId: 7 }));
  const body = await readJson(res);
  assertEquals(body.skippedPublished, ["31"]);
  // workflow 9 is NOT deleted: cascading it would destroy published post 31.
  assertEquals(body.skippedWorkflows, ["9"]);
  // deleted = post 32 + cliente 3. workflow_etapas is never deleted explicitly
  // (no conta_id column; cascades from workflows) — asserting it is absent from
  // UNDO_ORDER is the point of including an etapa item in the fixture above.
  assertEquals(body.deleted, 2);
});
