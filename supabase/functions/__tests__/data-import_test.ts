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

/** commit now verifies job ownership AND status before touching a row. */
function queueJobOwned(db: ReturnType<typeof createSupabaseQueryMock>, status = "committing") {
  db.queue("import_jobs", "select", { data: { id: 7, status }, error: null });
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
});

Deno.test("data-import: preview's max_clients count matches what the plan trigger enforces (all statuses, no filter)", async () => {
  // trg_limit_clientes -> enforce_plan_count_limit('max_clients', 'direct',
  // 'conta_id', 'conta_id') (20260611130003_count_triggers.sql:3-4) is called with
  // only 4 args, so TG_ARGV[4] (the optional status predicate) is absent and
  // v_pred stays '' inside enforce_plan_count_limit() — the trigger counts EVERY
  // clientes row for the workspace, regardless of status. clientes.status can be
  // 'ativo' | 'pausado' | 'encerrado' (20260301_baseline_schema.sql:49). Preview
  // used to filter its own count to status='ativo', so a workspace with 7 ativo +
  // 3 encerrado clients on a 10-client plan saw no warning here (7 + 2 = 9) and
  // then hit plan_limit:max_clients failures partway through commit.
  const db = createSupabaseQueryMock();
  authAs(db);
  // 7 ativo + 3 encerrado = 10 rows the trigger actually counts.
  db.queue("clientes", "select", { data: null, error: null, count: 10 });
  const rows = [
    { kind: "cliente", sourceKey: "a", nome: "Ana" },
    { kind: "cliente", sourceKey: "b", nome: "Bia" },
  ];
  const res = await makeHandler(db)(post("preview", { rows }));
  const body = await readJson(res);
  assertEquals(body.warnings.length, 1); // 10 + 2 > 10
  const call = oneCall(db, "clientes", "select");
  assertModifier(call, "eq", ["conta_id", "conta-1"]);
  assert(
    !call.modifiers.some((m) => m.method === "eq" && m.args[0] === "status"),
    `preview's max_clients count must not filter by status — the enforcing trigger has no status predicate — got ${JSON.stringify(call.modifiers)}`,
  );
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

// containerKey is the grouping key the commit step chunks on. Preview is called
// with chunking OFF, so every post of one client shares a single containerKey.
function postRow(sourceKey: string, containerKey: string) {
  return {
    kind: "post",
    sourceKey,
    containerKey,
    titulo: "T",
    conteudo: null,
    conteudoPlain: "",
    tipo: "feed",
    status: "rascunho",
    scheduledAt: null,
    publishedAt: null,
    provenance: {},
  };
}

Deno.test("data-import: preview warns when one container exceeds max_posts_per_workflow", async () => {
  // The design promises all THREE caps are checked at preview time so the user
  // sees them up front; maxPostsPerWorkflow was only echoed back in `limits`.
  const db = createSupabaseQueryMock();
  authAs(db);
  const capped = { ...ENTITLED, limits: { ...ENTITLED.limits, max_posts_per_workflow: 2 } };
  const rows = [
    postRow("p1", "container:a:0"),
    postRow("p2", "container:a:0"),
    postRow("p3", "container:a:0"),
    postRow("p4", "container:b:0"), // a second client, within the cap
  ];
  const res = await makeHandler(db, capped)(post("preview", { rows }));
  const body = await readJson(res);
  assertEquals(body.counts.posts, 4);
  assertEquals(body.warnings.length, 1);
  // the warning must name the real numbers and say the import splits rather than fails
  assert(body.warnings[0].includes("3 posts"), `got ${body.warnings[0]}`);
  assert(body.warnings[0].includes("limite de 2"), `got ${body.warnings[0]}`);
  assert(body.warnings[0].includes("divididos"), `got ${body.warnings[0]}`);
});

Deno.test("data-import: preview does not warn when every container is within the cap", async () => {
  const db = createSupabaseQueryMock();
  authAs(db);
  const capped = { ...ENTITLED, limits: { ...ENTITLED.limits, max_posts_per_workflow: 2 } };
  // 4 posts total but never more than 2 in one container: the cap is per
  // container, so a total-count check here would false-positive.
  const rows = [
    postRow("p1", "container:a:0"),
    postRow("p2", "container:a:0"),
    postRow("p3", "container:b:0"),
    postRow("p4", "container:b:0"),
  ];
  const res = await makeHandler(db, capped)(post("preview", { rows }));
  const body = await readJson(res);
  assertEquals(body.warnings, []);
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
  // distinct from commit's cap: preview and commit enforce different limits, so
  // a shared string leaves the client unable to tell which one it hit.
  assertEquals(await readJson(res), { error: "Preview batch too large" });
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
  assertEquals(await readJson(res), { error: "Commit batch too large" });
  assertEquals(db.calls.filter((c) => c.operation === "rpc").length, 0);
});

Deno.test("data-import: commit refuses a job that has already been undone", async () => {
  // The ownership probe used to select only `id`, so an undone job passed it.
  // import_commit_row refuses to write to an undone job, so every row failed —
  // but control still reached the `final` update, flipping undone -> completed
  // and re-arming the undo button on a job that was already undone.
  const db = createSupabaseQueryMock();
  authAs(db);
  queueJobOwned(db, "undone");
  const rows = [{ kind: "cliente", sourceKey: "a", nome: "Ana" }];
  const res = await makeHandler(db)(post("commit", { jobId: 7, rows, final: true }));
  assertEquals(res.status, 400);
  assertEquals(await readJson(res), { error: "Already undone" });
  assertEquals(db.calls.filter((c) => c.operation === "rpc").length, 0);
  assertEquals(callsFor(db, "import_jobs", "update").length, 0);
  assertEquals(callsFor(db, "audit_log", "insert").length, 0);
  // an existence-only probe cannot see the status it must reject on
  const probe = oneCall(db, "import_jobs", "select");
  assert(
    probe.selectArgs.some((a) => String(a[0] ?? "").includes("status")),
    `commit's ownership probe must select status — got ${JSON.stringify(probe.selectArgs)}`,
  );
});

Deno.test("data-import: commit refuses a job an undo has claimed", async () => {
  // Undo flips the job to 'undoing' BEFORE reading its items, so anything
  // committed from here is invisible to the undo in flight and would be orphaned
  // once the job lands 'undone' (a retried undo short-circuits on Already undone).
  const db = createSupabaseQueryMock();
  authAs(db);
  queueJobOwned(db, "undoing");
  const rows = [{ kind: "cliente", sourceKey: "a", nome: "Ana" }];
  const res = await makeHandler(db)(post("commit", { jobId: 7, rows, final: true }));
  assertEquals(res.status, 400);
  assertEquals(await readJson(res), { error: "Undo in progress" });
  assertEquals(db.calls.filter((c) => c.operation === "rpc").length, 0);
  // critically, the `final` update must not fire — it would flip 'undoing' back
  // to 'completed' and cancel the undo's lockout.
  assertEquals(callsFor(db, "import_jobs", "update").length, 0);
  assertEquals(callsFor(db, "audit_log", "insert").length, 0);
});

Deno.test("data-import: the final update cannot resurrect a job an undo claimed mid-batch", async () => {
  // An undo can claim the job WHILE this batch is running: the rows then all fail
  // inside the RPC, but control still reaches the `final` update. Without the
  // status filter that update flips 'undoing'/'undone' back to 'completed'.
  const db = createSupabaseQueryMock();
  authAs(db);
  queueJobOwned(db);
  db.queueRpc("import_commit_row", { data: { skipped: false, table: "clientes", row_id: "3" }, error: null });
  db.queue("import_jobs", "update", { data: null, error: null });
  db.queue("audit_log", "insert", { data: null, error: null });
  const rows = [{ kind: "cliente", sourceKey: "a", nome: "Ana" }];
  await makeHandler(db)(post("commit", { jobId: 7, rows, final: true }));
  const update = oneCall(db, "import_jobs", "update");
  assertModifier(update, "in", ["status", ["committing", "completed"]]);
});

Deno.test("data-import: a future-dated postado post never reaches the RPC with a publishedAt", async () => {
  // The clamp used to only half-execute: status was downgraded to
  // 'aprovado_cliente' but the raw publishedAt was still written, and the CRM
  // reads published_at ALONE as "this is live" (WorkflowDrawer.tsx:1092,
  // `const isPublished = post.published_at != null`) — so the row displayed as
  // "Publicado em <future date>" while sitting unapproved.
  const db = createSupabaseQueryMock();
  authAs(db);
  queueJobOwned(db);
  db.queueRpc("import_commit_row", { data: { skipped: false, table: "workflow_posts", row_id: "5" }, error: null });
  db.queue("audit_log", "insert", { data: null, error: null });
  const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const rows = [{ ...postRow("p1", "container:a:0"), status: "postado", publishedAt: future, scheduledAt: null }];
  await makeHandler(db)(post("commit", { jobId: 7, rows }));
  const payload = lastRpcArgs(db, "import_commit_row").p_payload as Record<string, unknown>;
  assertEquals(payload.status, "aprovado_cliente");
  assertEquals(payload.publishedAt, null);
  // the date is NOT discarded — a downgraded post still needs a calendar day.
  assertEquals(payload.scheduledAt, future);
});

Deno.test("data-import: a past-dated postado post keeps its publishedAt", async () => {
  // The other half of the invariant: the clamp must not blank the date on a row
  // that really is published, or every imported archive lands undated.
  const db = createSupabaseQueryMock();
  authAs(db);
  queueJobOwned(db);
  db.queueRpc("import_commit_row", { data: { skipped: false, table: "workflow_posts", row_id: "5" }, error: null });
  db.queue("audit_log", "insert", { data: null, error: null });
  const past = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const rows = [{ ...postRow("p1", "container:a:0"), status: "postado", publishedAt: past, scheduledAt: null }];
  await makeHandler(db)(post("commit", { jobId: 7, rows }));
  const payload = lastRpcArgs(db, "import_commit_row").p_payload as Record<string, unknown>;
  assertEquals(payload.status, "postado");
  assertEquals(payload.publishedAt, past);
});

Deno.test("data-import: a non-postado post never carries a publishedAt to the RPC", async () => {
  // The invariant is about the STATUS, not about the clamp's downgrade path: a
  // row that arrives already 'aprovado_cliente' with a publishedAt would display
  // as live just the same.
  const db = createSupabaseQueryMock();
  authAs(db);
  queueJobOwned(db);
  db.queueRpc("import_commit_row", { data: { skipped: false, table: "workflow_posts", row_id: "5" }, error: null });
  db.queue("audit_log", "insert", { data: null, error: null });
  const past = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const rows = [
    { ...postRow("p1", "container:a:0"), status: "aprovado_cliente", publishedAt: past, scheduledAt: null },
  ];
  await makeHandler(db)(post("commit", { jobId: 7, rows }));
  const payload = lastRpcArgs(db, "import_commit_row").p_payload as Record<string, unknown>;
  assertEquals(payload.status, "aprovado_cliente");
  assertEquals(payload.publishedAt, null);
  assertEquals(payload.scheduledAt, past);
});

Deno.test("data-import: a failing audit write does not turn a committed batch into a 500", async () => {
  // The audit write happens AFTER the rows have landed, inside the outer try. A
  // rejection there would report Internal error for a batch that committed, and
  // the client would retry work that is already done.
  const db = createSupabaseQueryMock();
  authAs(db);
  queueJobOwned(db);
  db.queueRpc("import_commit_row", { data: { skipped: false, table: "clientes", row_id: "3" }, error: null });
  db.queue("audit_log", "insert", () => {
    throw new Error("audit_log is unreachable");
  });
  const rows = [{ kind: "cliente", sourceKey: "a", nome: "Ana" }];
  const res = await makeHandler(db)(post("commit", { jobId: 7, rows }));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.results[0].rowId, "3");
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
  // The published-post predicate itself: inverting `.not.is.null` to `.is.null`
  // would make undo delete every PUBLISHED post and keep the drafts, and no
  // other assertion here would notice — the fixture would still produce the
  // same shape.
  assertModifier(oneCall(db, "workflow_posts", "select", 0), "or", [
    "instagram_media_id.not.is.null,tiktok_post_id.not.is.null",
  ]);
  assertModifier(oneCall(db, "workflow_posts", "select", 0), "eq", ["conta_id", "conta-1"]);
  assertModifier(oneCall(db, "workflow_posts", "select", 1), "eq", ["conta_id", "conta-1"]);
  assertModifier(oneCall(db, "workflows", "select"), "eq", ["conta_id", "conta-1"]);
  assertModifier(oneCall(db, "ideias", "select"), "eq", ["workspace_id", "conta-1"]);
  const del = oneCall(db, "workflow_posts", "delete");
  assertModifier(del, "eq", ["conta_id", "conta-1"]);
  assertModifier(del, "in", ["id", [32]]);
  // update #0 is the 'undoing' claim (asserted on its own below); #1 is the final
  // 'undone' flip.
  const jobUpdate = oneCall(db, "import_jobs", "update", 1);
  assertEquals(jobUpdate.payload, { status: "undone" });
  assertModifier(jobUpdate, "eq", ["conta_id", "conta-1"]);
});

Deno.test("data-import: undo claims the job as 'undoing' BEFORE reading its items", async () => {
  // Ordering is the whole fix. The item read defines the set of rows this undo
  // will ever delete; a commit batch landing rows after it produces rows that are
  // in no undo's list, and the job still ends 'undone' — after which a retried
  // undo short-circuits on "Already undone" and those rows are orphaned for good.
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
  db.queue("import_jobs", "update", { data: null, error: null }, { data: null, error: null });
  db.queue("audit_log", "insert", { data: null, error: null });
  const res = await makeHandler(db)(post("undo", { jobId: 7 }));
  assertEquals(res.status, 200);

  const updates = callsFor(db, "import_jobs", "update");
  assertEquals(updates.length, 2);
  const claim = updates[0].payload as Record<string, unknown>;
  assertEquals(claim.status, "undoing");
  assert(
    typeof claim.undo_started_at === "string",
    "the claim must stamp undo_started_at, or a killed undo can never be resumed",
  );
  assertModifier(updates[0], "eq", ["id", 7]);
  assertModifier(updates[0], "eq", ["conta_id", "conta-1"]);
  assertEquals(updates[1].payload, { status: "undone" });

  // ...and the claim must come FIRST in the wire order, before the item read.
  const claimIdx = db.calls.indexOf(updates[0]);
  const readIdx = db.calls.indexOf(oneCall(db, "import_job_items", "select"));
  const doneIdx = db.calls.indexOf(updates[1]);
  assert(claimIdx < readIdx, `the 'undoing' claim must precede the item read (${claimIdx} vs ${readIdx})`);
  assert(readIdx < doneIdx, `'undone' must be written after the item read (${readIdx} vs ${doneIdx})`);
});

Deno.test("data-import: undo refuses a job another undo has just claimed", async () => {
  const db = createSupabaseQueryMock();
  authAs(db);
  queueOwnedJob(db, { status: "undoing", undo_started_at: new Date().toISOString() });
  const res = await makeHandler(db)(post("undo", { jobId: 7 }));
  assertEquals(res.status, 400);
  assertEquals(await readJson(res), { error: "Undo in progress" });
  assertEquals(callsFor(db, "import_job_items", "select").length, 0);
  assertEquals(callsFor(db, "import_jobs", "update").length, 0);
});

Deno.test("data-import: undo resumes a job left stuck in 'undoing' by a killed run", async () => {
  // An edge-function kill mid-undo leaves the job 'undoing' with commits locked
  // out. Refusing the retry unconditionally would make that permanently
  // unrecoverable through the wizard; resuming is safe because the item read is
  // redone from scratch, the deletes are id-based and idempotent, and no commit
  // can have added rows while the job sat in 'undoing'.
  const db = createSupabaseQueryMock();
  authAs(db);
  queueOwnedJob(db, {
    status: "undoing",
    undo_started_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  });
  db.queue("import_job_items", "select", {
    data: [{ table_name: "clientes", row_id: "3", source_row_key: "a", ordinal: 0, merged: false }],
    error: null,
  });
  db.queue("workflows", "select", { data: [], error: null });
  db.queue("ideias", "select", { data: [], error: null });
  // the killed run already removed this one: an id-based delete simply returns
  // nothing, so the resumed run reports 0 rather than double-counting.
  db.queue("clientes", "delete", { data: [], error: null });
  db.queue("import_jobs", "update", { data: null, error: null }, { data: null, error: null });
  db.queue("audit_log", "insert", { data: null, error: null });
  const res = await makeHandler(db)(post("undo", { jobId: 7 }));
  assertEquals(res.status, 200);
  assertEquals((await readJson(res)).deleted, 0);
  const updates = callsFor(db, "import_jobs", "update");
  assertEquals(updates[updates.length - 1].payload, { status: "undone" });
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

// --- workflow_templates guard ------------------------------------------------
// workflows.template_id REFERENCES workflow_templates(id) ON DELETE SET NULL
// (20260301_baseline_schema.sql:150). The workflows pass above deliberately
// KEEPS an imported workflow that still holds posts (guardContainerWorkflows);
// without a matching guard here, the very next pass deleted every imported
// workflow_templates row unconditionally, silently nulling template_id on the
// workflow undo just decided to preserve — no error, no skipped* mention.

Deno.test("data-import: undo keeps a template still referenced by a surviving workflow", async () => {
  const db = createSupabaseQueryMock();
  authAs(db);
  queueOwnedJob(db);
  db.queue("import_job_items", "select", {
    data: [{ table_name: "workflow_templates", row_id: "5", source_row_key: "t1", ordinal: 0, merged: false }],
    error: null,
  });
  // A workflow still pointing at template 5 — whether it is one the workflows
  // pass just kept (guardContainerWorkflows) or one never touched by this import
  // at all, it is not this undo's to break.
  db.queue("workflows", "select", { data: [{ template_id: 5 }], error: null });
  db.queue("import_jobs", "update", { data: null, error: null });
  db.queue("audit_log", "insert", { data: null, error: null });
  const res = await makeHandler(db)(post("undo", { jobId: 7 }));
  const body = await readJson(res);
  assertEquals(body.skippedTemplates, ["5"]);
  assertEquals(body.deleted, 0);
  assertEquals(callsFor(db, "workflow_templates", "delete").length, 0);
  const probe = oneCall(db, "workflows", "select");
  assertModifier(probe, "in", ["template_id", [5]]);
  assertModifier(probe, "eq", ["conta_id", "conta-1"]);
});

Deno.test("data-import: undo still deletes a template nothing references", async () => {
  const db = createSupabaseQueryMock();
  authAs(db);
  queueOwnedJob(db);
  db.queue("import_job_items", "select", {
    data: [{ table_name: "workflow_templates", row_id: "5", source_row_key: "t1", ordinal: 0, merged: false }],
    error: null,
  });
  db.queue("workflows", "select", { data: [], error: null });
  db.queue("workflow_templates", "delete", { data: [{ id: 5 }], error: null });
  db.queue("import_jobs", "update", { data: null, error: null });
  db.queue("audit_log", "insert", { data: null, error: null });
  const res = await makeHandler(db)(post("undo", { jobId: 7 }));
  const body = await readJson(res);
  assertEquals(body.skippedTemplates, []);
  assertEquals(body.deleted, 1);
  const del = oneCall(db, "workflow_templates", "delete");
  assertModifier(del, "eq", ["conta_id", "conta-1"]);
  assertModifier(del, "in", ["id", [5]]);
});

// Every table that declares `REFERENCES clientes(id) ON DELETE CASCADE`, as
// verified against supabase/migrations. A cliente still referenced by ANY of them
// must survive undo: those rows were not created by the import, and the cascade
// would destroy them silently — an OAuth-linked Instagram account, the live hub
// token behind the client's link, the client's own briefing answers.
//
// `scope: null` means the table has NO tenant column. Adding `.eq("conta_id", …)`
// there raises `column "conta_id" does not exist` and aborts the ENTIRE undo —
// the same trap that keeps workflow_etapas out of UNDO_ORDER — so the absence is
// asserted, not just the presence.
const CLIENTE_CASCADE_CHILDREN: Array<{ table: string; column: string; scope: string | null }> = [
  { table: "workflows", column: "cliente_id", scope: "conta_id" },
  { table: "ideias", column: "cliente_id", scope: "workspace_id" },
  { table: "instagram_accounts", column: "client_id", scope: null },
  { table: "tiktok_accounts", column: "client_id", scope: null },
  { table: "analytics_reports", column: "client_id", scope: "conta_id" },
  { table: "briefings", column: "cliente_id", scope: "conta_id" },
  { table: "hub_briefing_questions", column: "cliente_id", scope: "conta_id" },
  { table: "client_hub_tokens", column: "cliente_id", scope: "conta_id" },
  { table: "hub_brand", column: "cliente_id", scope: null },
  { table: "hub_brand_files", column: "cliente_id", scope: null },
  { table: "hub_pages", column: "cliente_id", scope: "conta_id" },
];

for (const child of CLIENTE_CASCADE_CHILDREN) {
  Deno.test(`data-import: undo keeps a cliente still referenced by ${child.table}`, async () => {
    const db = createSupabaseQueryMock();
    authAs(db);
    queueOwnedJob(db);
    db.queue("import_job_items", "select", {
      data: [{ table_name: "clientes", row_id: "3", source_row_key: "a", ordinal: 0, merged: false }],
      error: null,
    });
    // ONLY this child still references cliente 3 — every other probe falls
    // through to the mock's empty default, so a missing table in the handler's
    // enumeration shows up as a deleted cliente right here.
    db.queue(child.table, "select", { data: [{ [child.column]: 3 }], error: null });
    db.queue("clientes", "delete", { data: [{ id: 3 }], error: null }); // must go unused
    db.queue("import_jobs", "update", { data: null, error: null });
    db.queue("audit_log", "insert", { data: null, error: null });
    const res = await makeHandler(db)(post("undo", { jobId: 7 }));
    const body = await readJson(res);
    assertEquals(body.skippedClientes, ["3"]);
    assertEquals(body.deleted, 0);
    assertEquals(callsFor(db, "clientes", "delete").length, 0);
    const probe = oneCall(db, child.table, "select");
    assertModifier(probe, "in", [child.column, [3]]);
    if (child.scope) {
      assertModifier(probe, "eq", [child.scope, "conta-1"]);
    } else {
      assert(
        !probe.modifiers.some((m) => m.method === "eq"),
        `${child.table} has no tenant column — a scope filter raises "column does not exist" and aborts the whole undo`,
      );
    }
  });
}

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
  db.queue("import_job_items", "select", { data: [], error: null }); // end of data
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
  // the read stops on an EMPTY page, not a short one, so the last page costs an
  // extra round-trip — that is the price of not depending on PAGE_SIZE matching
  // the project's max-rows setting.
  const reads = callsFor(db, "import_job_items", "select");
  assertEquals(reads.length, 3);
  assertModifier(reads[0], "range", [0, 499]);
  assertModifier(reads[1], "range", [500, 999]);
  assertModifier(reads[2], "range", [501, 1000]);
  // chunked `.in()` lists: 500 + 1
  const deletes = callsFor(db, "clientes", "delete");
  assertEquals(deletes.length, 2);
  assertModifier(deletes[1], "in", ["id", [501]]);
  assertEquals(callsFor(db, "workflows", "select").length, 2);
  assertEquals(callsFor(db, "ideias", "select").length, 2);
});

Deno.test("data-import: undo keeps paging when a page comes back shorter than PAGE_SIZE", async () => {
  // PAGE_SIZE must be genuinely independent of the project's PostgREST max-rows.
  // If max-rows is ever set below PAGE_SIZE, EVERY page comes back short —
  // breaking on `length < PAGE_SIZE` would stop after the first one, and undo
  // would delete a subset while still marking the job `undone`, making the rest
  // permanently un-undoable. That is precisely the bug pagination was added for.
  const db = createSupabaseQueryMock();
  authAs(db);
  queueOwnedJob(db);
  const item = (id: string) => ({ table_name: "clientes", row_id: id, source_row_key: id, ordinal: 0, merged: false });
  db.queue(
    "import_job_items",
    "select",
    { data: [item("3")], error: null }, // short page, but NOT the end
    { data: [item("4")], error: null },
    { data: [], error: null }, // empty page is the only end-of-data signal
  );
  db.queue("clientes", "delete", { data: [{ id: 3 }, { id: 4 }], error: null });
  db.queue("import_jobs", "update", { data: null, error: null });
  db.queue("audit_log", "insert", { data: null, error: null });
  const res = await makeHandler(db)(post("undo", { jobId: 7 }));
  const body = await readJson(res);
  assertEquals(body.deleted, 2);
  const reads = callsFor(db, "import_job_items", "select");
  assertEquals(reads.length, 3);
  // the window advances by the rows ACTUALLY returned, not by PAGE_SIZE
  assertModifier(reads[0], "range", [0, 499]);
  assertModifier(reads[1], "range", [1, 500]);
  assertModifier(reads[2], "range", [2, 501]);
  assertModifier(oneCall(db, "clientes", "delete"), "in", ["id", [3, 4]]);
});

Deno.test("data-import: undo deletes an imported ideia by uuid, scoped to workspace_id", async () => {
  // ideias is the only UNDO_ORDER target with a different scope column
  // (workspace_id, not conta_id) and non-numeric uuid ids. Making the numeric-id
  // branch unconditional would send [NaN] and silently delete nothing.
  const db = createSupabaseQueryMock();
  authAs(db);
  queueOwnedJob(db);
  const ideiaId = "1f6d0b4e-1c3a-4f2b-9a77-0c5d8e2b4a91";
  db.queue("import_job_items", "select", {
    data: [{ table_name: "ideias", row_id: ideiaId, source_row_key: "i1", ordinal: 0, merged: false }],
    error: null,
  });
  db.queue("ideias", "delete", { data: [{ id: ideiaId }], error: null });
  db.queue("import_jobs", "update", { data: null, error: null });
  db.queue("audit_log", "insert", { data: null, error: null });
  const res = await makeHandler(db)(post("undo", { jobId: 7 }));
  const body = await readJson(res);
  assertEquals(body.deleted, 1);
  const del = oneCall(db, "ideias", "delete");
  // ideias.workspace_id, NOT conta_id — the wrong column aborts the delete
  assertModifier(del, "eq", ["workspace_id", "conta-1"]);
  // ids pass through un-numbered; `.map(Number)` here would send [null]/[NaN]
  assertModifier(del, "in", ["id", [ideiaId]]);
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
