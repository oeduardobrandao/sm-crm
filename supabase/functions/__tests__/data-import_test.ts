import { assert, assertEquals, readJson } from "./assert.ts";
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

// --- modifier assertions -----------------------------------------------------
// The mock keys its response queue on `${table}:${operation}` only, so a queued
// response comes back no matter which filters the handler applied (or dropped).
// db.calls[].modifiers is where the filters actually land, so every LOAD-BEARING
// filter is asserted there — otherwise deleting `.eq("conta_id", ...)` or
// `.eq("merged", false)` from the handler leaves every test green.
type Call = ReturnType<typeof createSupabaseQueryMock>["calls"][number];

function callsFor(db: ReturnType<typeof createSupabaseQueryMock>, table: string, operation: string): Call[] {
  return db.calls.filter((c) => c.table === table && c.operation === operation);
}

function oneCall(db: ReturnType<typeof createSupabaseQueryMock>, table: string, operation: string, nth = 0): Call {
  const found = callsFor(db, table, operation)[nth];
  assert(found, `expected a ${operation} on ${table} (#${nth})`);
  return found;
}

function hasModifier(call: Call, method: string, args: unknown[]): boolean {
  return call.modifiers.some((m) => m.method === method && JSON.stringify(m.args) === JSON.stringify(args));
}

function assertModifier(call: Call, method: string, args: unknown[]) {
  assert(
    hasModifier(call, method, args),
    `${call.table}:${call.operation} is missing .${method}(${JSON.stringify(args).slice(1, -1)}) — got ${JSON.stringify(call.modifiers)}`,
  );
}

function post(path: string, body: unknown) {
  return new Request(`https://x.test/data-import/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer jwt" },
    body: JSON.stringify(body),
  });
}

/** commit now verifies job ownership before touching a row; queue that lookup. */
function queueJobOwned(db: ReturnType<typeof createSupabaseQueryMock>) {
  db.queue("import_jobs", "select", { data: { id: 7 }, error: null });
}

Deno.test("data-import: rejects when feature_csv_import is off", async () => {
  const db = createSupabaseQueryMock();
  authAs(db);
  const gated = { ...ENTITLED, features: { feature_csv_import: false } };
  const res = await makeHandler(db, gated)(post("start", { source: "csv", totalRows: 1 }));
  assertEquals(res.status, 403);
});

Deno.test("data-import: rejects a request with no Authorization header", async () => {
  const db = createSupabaseQueryMock();
  authAs(db);
  const req = new Request("https://x.test/data-import/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: "csv" }),
  });
  const res = await makeHandler(db)(req);
  assertEquals(res.status, 401);
  assertEquals(await readJson(res), { error: "Unauthorized" });
  // nothing was queried on the caller's behalf
  assertEquals(db.calls.length, 0);
});

Deno.test("data-import: an unknown action is a 404, not a mis-routed real action", async () => {
  const db = createSupabaseQueryMock();
  authAs(db);
  const res = await makeHandler(db)(post("bogus", {}));
  assertEquals(res.status, 404);
  assertEquals(await readJson(res), { error: "Unknown action" });
});

Deno.test("data-import: a path without the function segment does not fall through to parts[0]", async () => {
  // `parts.indexOf("data-import")` returns -1 when the segment is absent; an
  // unguarded `parts[idx + 1]` reads parts[0] and would route /start to `start`.
  const db = createSupabaseQueryMock();
  authAs(db);
  db.queue("import_jobs", "insert", { data: { id: 7 }, error: null });
  const req = new Request("https://x.test/start", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer jwt" },
    body: JSON.stringify({ source: "csv", totalRows: 1 }),
  });
  const res = await makeHandler(db)(req);
  assertEquals(res.status, 404);
  assertEquals(callsFor(db, "import_jobs", "insert").length, 0);
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
  // db is the service-role client: an unscoped count returns a PLATFORM-WIDE
  // total and would warn (or not) on other tenants' data.
  assertModifier(oneCall(db, "clientes", "select"), "eq", ["conta_id", "conta-1"]);
  assertModifier(oneCall(db, "clientes", "select"), "eq", ["status", "ativo"]);
});

Deno.test("data-import: preview scopes the workflow_templates count to the caller", async () => {
  const db = createSupabaseQueryMock();
  authAs(db);
  db.queue("workflow_templates", "select", { data: null, error: null, count: 10 });
  const rows = [{ kind: "template", sourceKey: "t", nome: "T", etapas: [] }];
  const res = await makeHandler(db)(post("preview", { rows }));
  const body = await readJson(res);
  assertEquals(body.warnings.length, 1); // 10 + 1 > 10
  assertModifier(oneCall(db, "workflow_templates", "select"), "eq", ["conta_id", "conta-1"]);
});

Deno.test("data-import: preview rejects a non-array rows payload instead of 500-ing", async () => {
  const db = createSupabaseQueryMock();
  authAs(db);
  const res = await makeHandler(db)(post("preview", { rows: "abc" }));
  assertEquals(res.status, 400);
  assertEquals(await readJson(res), { error: "Invalid payload" });
});

Deno.test("data-import: preview caps the row count", async () => {
  const db = createSupabaseQueryMock();
  authAs(db);
  const rows = Array.from({ length: 5001 }, (_, i) => ({ kind: "cliente", sourceKey: String(i), nome: "X" }));
  const res = await makeHandler(db)(post("preview", { rows }));
  assertEquals(res.status, 400);
  assertEquals(await readJson(res), { error: "Batch too large" });
});

Deno.test("data-import: commit calls the RPC per row and reports skips", async () => {
  const db = createSupabaseQueryMock();
  authAs(db);
  queueJobOwned(db);
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
  // the ownership probe must be scoped to BOTH the job and the caller
  const probe = oneCall(db, "import_jobs", "select");
  assertModifier(probe, "eq", ["id", 7]);
  assertModifier(probe, "eq", ["conta_id", "conta-1"]);
});

Deno.test("data-import: commit rejects a foreign jobId before processing any row", async () => {
  // db is the service-role client (RLS bypassed). Without this gate a foreign
  // jobId still reached the `final` update below and flipped ANOTHER workspace's
  // job row to 'completed'.
  const db = createSupabaseQueryMock();
  authAs(db);
  db.queue("import_jobs", "select", { data: null, error: null }); // not ours
  const rows = [{ kind: "cliente", sourceKey: "a", nome: "Ana" }];
  const res = await makeHandler(db)(post("commit", { jobId: 999, rows, final: true }));
  assertEquals(res.status, 404);
  assertEquals(await readJson(res), { error: "Job not found" });
  // no row was committed and, critically, no job row was written
  assertEquals(db.calls.filter((c) => c.operation === "rpc").length, 0);
  assertEquals(callsFor(db, "import_jobs", "update").length, 0);
  assertEquals(callsFor(db, "audit_log", "insert").length, 0);
});

Deno.test("data-import: commit with final marks the job completed, conta-scoped", async () => {
  const db = createSupabaseQueryMock();
  authAs(db);
  queueJobOwned(db);
  db.queueRpc("import_commit_row", { data: { skipped: false, table: "clientes", row_id: "3" }, error: null });
  db.queue("import_jobs", "update", { data: null, error: null });
  db.queue("audit_log", "insert", { data: null, error: null });
  const rows = [{ kind: "cliente", sourceKey: "a", nome: "Ana" }];
  const res = await makeHandler(db)(post("commit", { jobId: 7, rows, final: true }));
  assertEquals(res.status, 200);
  const update = oneCall(db, "import_jobs", "update");
  assertEquals(update.payload, { status: "completed" });
  assertModifier(update, "eq", ["id", 7]);
  assertModifier(update, "eq", ["conta_id", "conta-1"]);
});

Deno.test("data-import: commit without final leaves the job status alone", async () => {
  const db = createSupabaseQueryMock();
  authAs(db);
  queueJobOwned(db);
  db.queueRpc("import_commit_row", { data: { skipped: false, table: "clientes", row_id: "3" }, error: null });
  db.queue("audit_log", "insert", { data: null, error: null });
  const rows = [{ kind: "cliente", sourceKey: "a", nome: "Ana" }];
  await makeHandler(db)(post("commit", { jobId: 7, rows }));
  assertEquals(callsFor(db, "import_jobs", "update").length, 0);
});

Deno.test("data-import: commit rejects an oversized batch", async () => {
  const db = createSupabaseQueryMock();
  authAs(db);
  const rows = Array.from({ length: 201 }, (_, i) => ({ kind: "cliente", sourceKey: String(i), nome: "X" }));
  const res = await makeHandler(db)(post("commit", { jobId: 7, rows }));
  assertEquals(res.status, 400);
  assertEquals(await readJson(res), { error: "Batch too large" });
  assertEquals(db.calls.filter((c) => c.operation === "rpc").length, 0);
});

Deno.test("data-import: commit forwards conta_id so the RPC can reject foreign clientes", async () => {
  // Tenant isolation lives in import_resolve_cliente (it raises when clienteId
  // belongs to another workspace); this asserts the handler actually passes the
  // caller's conta_id through, and surfaces the rejection as a failed row.
  const db = createSupabaseQueryMock();
  authAs(db);
  queueJobOwned(db);
  db.queueRpc("import_commit_row", { data: null, error: { message: "cliente 99 does not belong to this workspace" } });
  db.queue("audit_log", "insert", { data: null, error: null });
  const rows = [
    { kind: "ideia", sourceKey: "x", clienteRef: { type: "existing", clienteId: 99 }, titulo: "T", descricao: "", provenance: {} },
  ];
  const res = await makeHandler(db)(post("commit", { jobId: 7, rows }));
  const body = await readJson(res);
  assertEquals(body.results[0].failed, true);
  assertEquals(lastRpcArgs(db, "import_commit_row").p_conta_id, "conta-1");
  // the DB's message must never reach the client
  assertEquals(body.results[0].reason, "error");
});

Deno.test("data-import: commit reports per-row failures without aborting the batch", async () => {
  const db = createSupabaseQueryMock();
  authAs(db);
  queueJobOwned(db);
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
  queueJobOwned(db);
  db.queueRpc("import_commit_row", { data: null, error: { message: "plan_limit_exceeded:max_clients" } });
  db.queue("audit_log", "insert", { data: null, error: null });
  const rows = [{ kind: "cliente", sourceKey: "a", nome: "Ana" }];
  const res = await makeHandler(db)(post("commit", { jobId: 7, rows }));
  const body = await readJson(res);
  assertEquals(body.results[0].reason, "plan_limit:max_clients");
});

// --- undo --------------------------------------------------------------------

function queueOwnedJob(db: ReturnType<typeof createSupabaseQueryMock>, over: Record<string, unknown> = {}) {
  db.queue("import_jobs", "select", {
    data: {
      id: 7,
      conta_id: "conta-1",
      status: "completed",
      created_at: new Date().toISOString(),
      ...over,
    },
    error: null,
  });
}

Deno.test("data-import: undo refuses a job that is not the caller's", async () => {
  const db = createSupabaseQueryMock();
  authAs(db);
  db.queue("import_jobs", "select", { data: null, error: null });
  const res = await makeHandler(db)(post("undo", { jobId: 7 }));
  assertEquals(res.status, 404);
  assertEquals(await readJson(res), { error: "Job not found" });
  const probe = oneCall(db, "import_jobs", "select");
  assertModifier(probe, "eq", ["conta_id", "conta-1"]);
  assertEquals(callsFor(db, "import_job_items", "select").length, 0);
});

Deno.test("data-import: undo refuses an already-undone job", async () => {
  const db = createSupabaseQueryMock();
  authAs(db);
  queueOwnedJob(db, { status: "undone" });
  const res = await makeHandler(db)(post("undo", { jobId: 7 }));
  assertEquals(res.status, 400);
  assertEquals(await readJson(res), { error: "Already undone" });
  assertEquals(callsFor(db, "import_job_items", "select").length, 0);
});

Deno.test("data-import: undo refuses a job older than the 7-day window", async () => {
  const db = createSupabaseQueryMock();
  authAs(db);
  queueOwnedJob(db, { created_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() });
  const res = await makeHandler(db)(post("undo", { jobId: 7 }));
  assertEquals(res.status, 400);
  assertEquals(await readJson(res), { error: "Undo window expired" });
  assertEquals(callsFor(db, "import_job_items", "select").length, 0);
});

Deno.test("data-import: undo deletes recorded rows in order, skips published posts", async () => {
  const db = createSupabaseQueryMock();
  authAs(db);
  queueOwnedJob(db);
  db.queue("import_job_items", "select", {
    data: [
      { table_name: "workflow_posts", row_id: "31", source_row_key: "p1", ordinal: 0, merged: false },
      { table_name: "workflow_posts", row_id: "32", source_row_key: "p2", ordinal: 0, merged: false },
      { table_name: "workflows", row_id: "9", source_row_key: "container:1:0", ordinal: 0, merged: false },
      { table_name: "workflow_etapas", row_id: "77", source_row_key: "e1", ordinal: 1, merged: false },
      { table_name: "clientes", row_id: "3", source_row_key: "a", ordinal: 0, merged: false },
    ],
    error: null,
  });
  // published-post guard: one of the two posts has a platform id
  db.queue("workflow_posts", "select", {
    data: [{ id: 31, instagram_media_id: "ig1", tiktok_post_id: null }],
    error: null,
  });
  db.queue("workflow_posts", "delete", { data: [{ id: 32 }], error: null });
  // container-guard lookup: workflow 9 still holds the surviving published post
  db.queue("workflow_posts", "select", { data: [{ workflow_id: 9 }], error: null });
  // clientes guard: workflow 9 survived, so cliente 3 is still referenced
  db.queue("workflows", "select", { data: [{ cliente_id: 3 }], error: null });
  db.queue("ideias", "select", { data: [], error: null });
  db.queue("import_jobs", "update", { data: null, error: null });
  db.queue("audit_log", "insert", { data: null, error: null });
  const res = await makeHandler(db)(post("undo", { jobId: 7 }));
  const body = await readJson(res);
  assertEquals(body.skippedPublished, ["31"]);
  // workflow 9 is NOT deleted: cascading it would destroy published post 31.
  assertEquals(body.skippedWorkflows, ["9"]);
  // ...and neither is cliente 3: clientes -> workflows -> workflow_posts all
  // cascade, so deleting it would destroy the published post the first two
  // guards just protected.
  assertEquals(body.skippedClientes, ["3"]);
  // only post 32 actually went. workflow_etapas is never deleted explicitly (no
  // conta_id column; cascades from workflows) — asserting it is absent from
  // UNDO_ORDER is the point of including an etapa item in the fixture above.
  assertEquals(body.deleted, 1);
  assertEquals(callsFor(db, "clientes", "delete").length, 0);
  assertEquals(callsFor(db, "workflows", "delete").length, 0);

  // --- load-bearing filters on the item read -------------------------------
  const itemRead = oneCall(db, "import_job_items", "select");
  assertModifier(itemRead, "eq", ["job_id", 7]);
  assertModifier(itemRead, "eq", ["conta_id", "conta-1"]);
  // `merged: false` is what stops undo from deleting a PRE-EXISTING cliente the
  // import merged into — the fixture rows carry merged:false so a dropped filter
  // is invisible in the data; only this assertion catches it.
  assertModifier(itemRead, "eq", ["merged", false]);
  assertModifier(itemRead, "range", [0, 499]);

  // --- every guard and delete is conta-scoped by hand ----------------------
  assertModifier(oneCall(db, "workflow_posts", "select", 0), "eq", ["conta_id", "conta-1"]);
  assertModifier(oneCall(db, "workflow_posts", "select", 1), "eq", ["conta_id", "conta-1"]);
  assertModifier(oneCall(db, "workflows", "select"), "eq", ["conta_id", "conta-1"]);
  assertModifier(oneCall(db, "ideias", "select"), "eq", ["workspace_id", "conta-1"]);
  const del = oneCall(db, "workflow_posts", "delete");
  assertModifier(del, "eq", ["conta_id", "conta-1"]);
  assertModifier(del, "in", ["id", [32]]);
  const jobUpdate = oneCall(db, "import_jobs", "update");
  assertEquals(jobUpdate.payload, { status: "undone" });
  assertModifier(jobUpdate, "eq", ["conta_id", "conta-1"]);
});

Deno.test("data-import: undo keeps a cliente that still holds a user-created ideia", async () => {
  const db = createSupabaseQueryMock();
  authAs(db);
  queueOwnedJob(db);
  db.queue("import_job_items", "select", {
    data: [{ table_name: "clientes", row_id: "3", source_row_key: "a", ordinal: 0, merged: false }],
    error: null,
  });
  db.queue("workflows", "select", { data: [], error: null });
  // an ideia the user wrote under the imported cliente AFTER the import: it is
  // not in import_job_items, and ideias.cliente_id is ON DELETE CASCADE.
  db.queue("ideias", "select", { data: [{ cliente_id: 3 }], error: null });
  db.queue("import_jobs", "update", { data: null, error: null });
  db.queue("audit_log", "insert", { data: null, error: null });
  const res = await makeHandler(db)(post("undo", { jobId: 7 }));
  const body = await readJson(res);
  assertEquals(body.skippedClientes, ["3"]);
  assertEquals(body.deleted, 0);
  assertEquals(callsFor(db, "clientes", "delete").length, 0);
});

Deno.test("data-import: undo does delete a cliente nothing else references", async () => {
  const db = createSupabaseQueryMock();
  authAs(db);
  queueOwnedJob(db);
  db.queue("import_job_items", "select", {
    data: [{ table_name: "clientes", row_id: "3", source_row_key: "a", ordinal: 0, merged: false }],
    error: null,
  });
  db.queue("workflows", "select", { data: [], error: null });
  db.queue("ideias", "select", { data: [], error: null });
  db.queue("clientes", "delete", { data: [{ id: 3 }], error: null });
  db.queue("import_jobs", "update", { data: null, error: null });
  db.queue("audit_log", "insert", { data: null, error: null });
  const res = await makeHandler(db)(post("undo", { jobId: 7 }));
  const body = await readJson(res);
  assertEquals(body.skippedClientes, []);
  assertEquals(body.deleted, 1);
});

Deno.test("data-import: undo counts rows actually removed, not rows attempted", async () => {
  // The scope guard on the delete can filter a row out server-side (or it may be
  // gone already). Counting `ids.length` would report a deletion that never
  // happened; the returned representation is the only honest source.
  const db = createSupabaseQueryMock();
  authAs(db);
  queueOwnedJob(db);
  db.queue("import_job_items", "select", {
    data: [
      { table_name: "clientes", row_id: "3", source_row_key: "a", ordinal: 0, merged: false },
      { table_name: "clientes", row_id: "4", source_row_key: "b", ordinal: 0, merged: false },
    ],
    error: null,
  });
  db.queue("workflows", "select", { data: [], error: null });
  db.queue("ideias", "select", { data: [], error: null });
  db.queue("clientes", "delete", { data: [{ id: 3 }], error: null }); // 4 was already gone
  db.queue("import_jobs", "update", { data: null, error: null });
  db.queue("audit_log", "insert", { data: null, error: null });
  const res = await makeHandler(db)(post("undo", { jobId: 7 }));
  const body = await readJson(res);
  assertEquals(body.deleted, 1);
});

Deno.test("data-import: undo pages the item read past the REST max-rows cap", async () => {
  // An unpaged read is silently truncated at the project's max-rows setting.
  // Undo would delete only the first page and STILL mark the job undone, making
  // the remainder permanently un-undoable.
  const db = createSupabaseQueryMock();
  authAs(db);
  queueOwnedJob(db);
  const page1 = Array.from({ length: 500 }, (_, i) => ({
    table_name: "clientes",
    row_id: String(i + 1),
    source_row_key: `k${i}`,
    ordinal: 0,
    merged: false,
  }));
  db.queue("import_job_items", "select", { data: page1, error: null });
  db.queue("import_job_items", "select", {
    data: [{ table_name: "clientes", row_id: "501", source_row_key: "k500", ordinal: 0, merged: false }],
    error: null,
  });
  // guard SELECTs and deletes are chunked at 500, so 501 ids = 2 of each
  db.queue("workflows", "select", { data: [], error: null }, { data: [], error: null });
  db.queue("ideias", "select", { data: [], error: null }, { data: [], error: null });
  db.queue(
    "clientes",
    "delete",
    { data: page1.map((r) => ({ id: Number(r.row_id) })), error: null },
    { data: [{ id: 501 }], error: null },
  );
  db.queue("import_jobs", "update", { data: null, error: null });
  db.queue("audit_log", "insert", { data: null, error: null });
  const res = await makeHandler(db)(post("undo", { jobId: 7 }));
  const body = await readJson(res);
  assertEquals(body.deleted, 501);
  const reads = callsFor(db, "import_job_items", "select");
  assertEquals(reads.length, 2);
  assertModifier(reads[0], "range", [0, 499]);
  assertModifier(reads[1], "range", [500, 999]);
  // chunked `.in()` lists: 500 + 1
  const deletes = callsFor(db, "clientes", "delete");
  assertEquals(deletes.length, 2);
  assertModifier(deletes[1], "in", ["id", [501]]);
  assertEquals(callsFor(db, "workflows", "select").length, 2);
  assertEquals(callsFor(db, "ideias", "select").length, 2);
});

Deno.test("data-import: undo never leaks a database message to the client", async () => {
  const db = createSupabaseQueryMock();
  authAs(db);
  queueOwnedJob(db);
  db.queue("import_job_items", "select", { data: null, error: { message: 'relation "x" does not exist' } });
  const res = await makeHandler(db)(post("undo", { jobId: 7 }));
  assertEquals(res.status, 500);
  assertEquals(await readJson(res), { error: "Internal error" });
});
