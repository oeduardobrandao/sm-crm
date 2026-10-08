import { assert, assertEquals, readJson } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createHubPostReferencesHandler } from "../hub-post-references/handler.ts";

type Db = ReturnType<typeof createSupabaseQueryMock>;
type Head = { contentLength: number; contentType: string | null } | null;

const UUID = "0b5f6c1e-3d2a-4f7b-9c1d-2e3f4a5b6c7d";
const KEY = `contas/conta-1/files/${UUID}.png`;
const THUMB = `contas/conta-1/files/${UUID}.thumb.webp`;
const WRITE_KEY = "hub-write:hub-post-references:conta-1:14";
const READ_KEY = "hub-read:conta-1:14";

interface Opts {
  rateKeys?: string[];
  limited?: boolean;
  head?: (key: string) => Promise<Head>;
}

function makeHandler(db: Db, opts: Opts = {}) {
  return createHubPostReferencesHandler({
    buildCorsHeaders: () => ({ "Access-Control-Allow-Origin": "https://hub.mesaas.com" }),
    createDb: () => db as never,
    now: () => "2026-10-08T12:00:00.000Z",
    signPutUrl: async (key: string) => `https://put.example.com/${key}`,
    signGetUrl: async (key: string, _exp?: number, name?: string) =>
      `https://get.example.com/${key}${name ? `?dl=${name}` : ""}`,
    headObject: opts.head ??
      (async (key: string) => ({ contentLength: key.endsWith(".thumb.webp") ? 2000 : 5000, contentType: null })),
    rateLimit: async (_db: unknown, key: string) => {
      opts.rateKeys?.push(key);
      return !opts.limited;
    },
    randomUUID: () => UUID,
  });
}

function setupToken(db: Db) {
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
}

function queuePost(db: Db, fields: Record<string, unknown> = {}) {
  db.queue("workflow_posts", "select", {
    data: { id: 99, status: "enviado_cliente", cliente_id: 14, conta_id: "conta-1", ...fields },
    error: null,
  });
}

function fileRow(fields: Record<string, unknown> = {}) {
  return {
    id: 7, kind: "file", file_id: 70, url: null, link_title: null, note: "Use esta foto",
    post_approval_id: null, created_at: "2026-10-08T11:00:00.000Z", can_remove: true,
    name: "foto.png", mime_type: "image/png", file_kind: "image", size_bytes: 5000,
    width: 1080, height: 1350, duration_seconds: null, r2_key: KEY, thumbnail_r2_key: THUMB,
    blur_data_url: null, ...fields,
  };
}

function linkRow(fields: Record<string, unknown> = {}) {
  return {
    id: 8, kind: "link", file_id: null, url: "https://www.exemplo.com/post", link_title: "Inspiração",
    note: null, post_approval_id: null, created_at: "2026-10-08T11:05:00.000Z", can_remove: false,
    name: null, mime_type: null, file_kind: null, size_bytes: null, width: null, height: null,
    duration_seconds: null, r2_key: null, thumbnail_r2_key: null, blur_data_url: null, ...fields,
  };
}

function insertedRow(fields: Record<string, unknown> = {}) {
  return {
    id: 7, post_id: 99, conta_id: "conta-1", kind: "file", file_id: 70, url: null, link_title: null,
    note: null, post_approval_id: null, created_at: "2026-10-08T12:00:00.000Z",
    updated_at: "2026-10-08T12:00:00.000Z", ...fields,
  };
}

function jsonReq(method: string, path: string, body: Record<string, unknown> = {}) {
  return new Request(`https://x.test/hub-post-references${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: "t", ...body }),
  });
}

function getReq(path: string, method = "GET") {
  return new Request(`https://x.test/hub-post-references${path}`, { method });
}

function rpcCall(db: Db, name: string) {
  return db.calls.find((c) => c.table === `rpc:${name}`);
}

const IMAGE_UPLOAD = {
  post_id: 99, filename: "foto.png", mime_type: "image/png", size_bytes: 5000,
  thumbnail: { mime_type: "image/webp", size_bytes: 2000 },
};

const IMAGE_FINALIZE = {
  post_id: 99, r2_key: KEY, thumbnail_r2_key: THUMB, mime_type: "image/png", size_bytes: 5000,
  thumbnail_bytes: 2000, name: "foto.png", width: 1080, height: 1350, note: "  Use esta foto  ",
};

// ── Token / routing ─────────────────────────────────────────────

Deno.test("hub-post-references: unknown token is 404 and debits only the bad-token limiter", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: null, error: null });
  const rateKeys: string[] = [];
  const res = await makeHandler(db, { rateKeys })(getReq("?token=nope&post_id=99"));
  assertEquals(res.status, 404);
  assertEquals((await readJson(res)).error, "Link inválido.");
  assertEquals(rateKeys.length, 1);
  assert(rateKeys[0].startsWith("hub-badtoken:"));
});

Deno.test("hub-post-references: unknown route is 404 not_found before any DB call", async () => {
  const db = createSupabaseQueryMock();
  const res = await makeHandler(db)(jsonReq("POST", "/whatever"));
  assertEquals(res.status, 404);
  assertEquals((await readJson(res)).error, "not_found");
  assertEquals(db.calls.length, 0);
});

// ── GET ─────────────────────────────────────────────────────────

Deno.test("hub-post-references: GET lists signed items and debits only hub-read", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  queuePost(db);
  db.queueRpc("post_reference_list", { data: [fileRow(), linkRow()], error: null });
  const rateKeys: string[] = [];
  const res = await makeHandler(db, { rateKeys })(getReq("?token=t&post_id=99"));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(rateKeys, [READ_KEY]);
  assertEquals(body.can_add, true);
  assertEquals(body.items.length, 2);
  assertEquals(body.items[0].url, `https://get.example.com/${KEY}`);
  assertEquals(body.items[0].thumbnail_url, `https://get.example.com/${THUMB}`);
  assertEquals(body.items[0].download_url, null);
  assertEquals(body.items[1].link_url, "https://www.exemplo.com/post");
  assertEquals(body.items[1].link_domain, "exemplo.com");
  assertEquals(body.items[1].can_remove, false);
  assertEquals(rpcCall(db, "post_reference_list")?.payload, { p_post_id: 99, p_conta: "conta-1" });
});

Deno.test("hub-post-references: GET on another client's post is 404 and never lists", async () => {
  for (const fields of [{ cliente_id: 15 }, { conta_id: "conta-2" }]) {
    const db = createSupabaseQueryMock();
    setupToken(db);
    queuePost(db, fields);
    const res = await makeHandler(db)(getReq("?token=t&post_id=99"));
    assertEquals(res.status, 404);
    assertEquals((await readJson(res)).error, "not_found");
    assertEquals(rpcCall(db, "post_reference_list"), undefined);
  }
});

Deno.test("hub-post-references: GET is ownership-only (internal 'em produção' and postado read-only)", async () => {
  for (const status of ["rascunho", "em_producao", "postado", "correcao_cliente"]) {
    const db = createSupabaseQueryMock();
    setupToken(db);
    queuePost(db, { status });
    db.queueRpc("post_reference_list", { data: [fileRow({ can_remove: false })], error: null });
    const res = await makeHandler(db)(getReq("?token=t&post_id=99"));
    assertEquals(res.status, 200, status);
    const body = await readJson(res);
    assertEquals(body.can_add, false, status);
    assertEquals(body.items.length, 1, status);
  }
});

Deno.test("hub-post-references: GET can_add is false at 10 references", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  queuePost(db);
  db.queueRpc("post_reference_list", {
    data: Array.from({ length: 10 }, (_, i) => linkRow({ id: i + 1 })),
    error: null,
  });
  const res = await makeHandler(db)(getReq("?token=t&post_id=99"));
  assertEquals((await readJson(res)).can_add, false);
});

Deno.test("hub-post-references: GET without a valid post_id is 404", async () => {
  for (const q of ["?token=t", "?token=t&post_id=abc", "?token=t&post_id=0"]) {
    const db = createSupabaseQueryMock();
    setupToken(db);
    const res = await makeHandler(db)(getReq(q));
    assertEquals(res.status, 404, q);
  }
});

// ── POST /upload-url ────────────────────────────────────────────

Deno.test("hub-post-references: presign image returns both PUT URLs and debits only the write key", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  queuePost(db);
  db.queue("post_references", "select", { data: null, error: null, count: 3 });
  db.queueRpc("effective_plan_limit", { data: null, error: null });
  const rateKeys: string[] = [];
  const res = await makeHandler(db, { rateKeys })(jsonReq("POST", "/upload-url", IMAGE_UPLOAD));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(rateKeys, [WRITE_KEY]);
  assertEquals(body.r2_key, KEY);
  assertEquals(body.thumbnail_r2_key, THUMB);
  assertEquals(body.upload_url, `https://put.example.com/${KEY}`);
  assertEquals(body.thumbnail_upload_url, `https://put.example.com/${THUMB}`);
});

Deno.test("hub-post-references: presign PDF has no thumbnail; a PDF thumbnail is rejected", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  queuePost(db);
  db.queueRpc("effective_plan_limit", { data: null, error: null });
  const res = await makeHandler(db)(jsonReq("POST", "/upload-url", {
    post_id: 99, filename: "numeros.pdf", mime_type: "application/pdf", size_bytes: 5000,
  }));
  assertEquals(res.status, 200);
  const body = await readJson(res);
  assertEquals(body.r2_key, `contas/conta-1/files/${UUID}.pdf`);
  assertEquals(body.thumbnail_r2_key, null);
  assertEquals(body.thumbnail_upload_url, null);

  const db2 = createSupabaseQueryMock();
  setupToken(db2);
  queuePost(db2);
  const res2 = await makeHandler(db2)(jsonReq("POST", "/upload-url", {
    post_id: 99, mime_type: "application/pdf", size_bytes: 5000,
    thumbnail: { mime_type: "image/webp", size_bytes: 100 },
  }));
  assertEquals(res2.status, 400);
  assertEquals((await readJson(res2)).error, "thumbnail_invalid");
});

Deno.test("hub-post-references: presign rejects type, size and thumbnail violations", async () => {
  const webp = { mime_type: "image/webp", size_bytes: 2000 };
  const cases: Array<[Record<string, unknown>, number, string]> = [
    [{ mime_type: "image/svg+xml", size_bytes: 10, thumbnail: webp }, 415, "unsupported_type"],
    [{ mime_type: "video/mp4", size_bytes: 200 * 1024 * 1024 + 1, thumbnail: webp }, 413, "too_large"],
    [{ mime_type: "image/png", size_bytes: 25 * 1024 * 1024 + 1, thumbnail: webp }, 413, "too_large"],
    [{ mime_type: "application/pdf", size_bytes: 25 * 1024 * 1024 + 1 }, 413, "too_large"],
    [{ mime_type: "image/png", size_bytes: 0, thumbnail: webp }, 400, "upload_mismatch"],
    [{ mime_type: "image/png", size_bytes: 5000 }, 400, "thumbnail_invalid"],
    [{ mime_type: "video/webm", size_bytes: 5000 }, 400, "thumbnail_invalid"],
    [{ mime_type: "image/png", size_bytes: 5000, thumbnail: { mime_type: "image/png", size_bytes: 10 } }, 400, "thumbnail_invalid"],
    [{ mime_type: "image/png", size_bytes: 5000, thumbnail: { mime_type: "image/webp", size_bytes: 512 * 1024 + 1 } }, 400, "thumbnail_invalid"],
  ];
  for (const [fields, status, code] of cases) {
    const db = createSupabaseQueryMock();
    setupToken(db);
    queuePost(db);
    const res = await makeHandler(db)(jsonReq("POST", "/upload-url", { post_id: 99, ...fields }));
    assertEquals(res.status, status, JSON.stringify(fields));
    assertEquals((await readJson(res)).error, code, JSON.stringify(fields));
  }
});

Deno.test("hub-post-references: presign outside enviado_cliente is 409 post_not_pending", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  queuePost(db, { status: "correcao_cliente" });
  const res = await makeHandler(db)(jsonReq("POST", "/upload-url", IMAGE_UPLOAD));
  assertEquals(res.status, 409);
  assertEquals((await readJson(res)).error, "post_not_pending");
});

Deno.test("hub-post-references: presign at 10 references is 409 reference_limit", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  queuePost(db);
  db.queue("post_references", "select", { data: null, error: null, count: 10 });
  const res = await makeHandler(db)(jsonReq("POST", "/upload-url", IMAGE_UPLOAD));
  assertEquals(res.status, 409);
  assertEquals((await readJson(res)).error, "reference_limit");
});

Deno.test("hub-post-references: presign over quota is 413 quota_exceeded", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  queuePost(db);
  db.queue("post_references", "select", { data: null, error: null, count: 0 });
  db.queue("workspaces", "select", { data: { storage_used_bytes: 999 }, error: null });
  db.queueRpc("effective_plan_limit", { data: 1000, error: null });
  const res = await makeHandler(db)(jsonReq("POST", "/upload-url", IMAGE_UPLOAD));
  assertEquals(res.status, 413);
  assertEquals((await readJson(res)).error, "quota_exceeded");
});

// ── POST /files ─────────────────────────────────────────────────

Deno.test("hub-post-references: finalize image inserts via RPC, notifies, returns the item", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  queuePost(db);
  db.queueRpc("post_reference_file_insert", { data: insertedRow({ note: "Use esta foto" }), error: null });
  const rateKeys: string[] = [];
  const res = await makeHandler(db, { rateKeys })(jsonReq("POST", "/files", IMAGE_FINALIZE));
  assertEquals(res.status, 201);
  const { item } = await readJson(res);
  assertEquals(item.id, 7);
  assertEquals(item.kind, "file");
  assertEquals(item.file_kind, "image");
  assertEquals(item.note, "Use esta foto");
  assertEquals(item.can_remove, true);
  assertEquals(item.url, `https://get.example.com/${KEY}`);
  assertEquals(item.download_url, null);
  assertEquals(rateKeys, [WRITE_KEY]);

  const p = (rpcCall(db, "post_reference_file_insert")?.payload as { p: Record<string, unknown> }).p;
  assertEquals(p.post_id, 99);
  assertEquals(p.conta_id, "conta-1");
  assertEquals(p.cliente_id, 14);
  assertEquals(p.r2_key, KEY);
  assertEquals(p.thumbnail_r2_key, THUMB);
  assertEquals(p.file_kind, "image");
  assertEquals(p.mime_type, "image/png");
  assertEquals(p.size_bytes, 5000);
  assertEquals(p.width, 1080);
  assertEquals(p.duration_seconds, null);
  assertEquals(p.note, "Use esta foto");
  assertEquals(rpcCall(db, "create_post_reference_notification")?.payload, { p_post_id: 99 });
});

Deno.test("hub-post-references: finalize PDF sends thumbnail_r2_key '' and no dimensions", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  queuePost(db);
  db.queueRpc("post_reference_file_insert", { data: insertedRow(), error: null });
  const pdfKey = `contas/conta-1/files/${UUID}.pdf`;
  const res = await makeHandler(db)(jsonReq("POST", "/files", {
    post_id: 99, r2_key: pdfKey, mime_type: "application/pdf", size_bytes: 5000,
    name: "numeros.pdf", width: 10, height: 10,
  }));
  assertEquals(res.status, 201);
  const p = (rpcCall(db, "post_reference_file_insert")?.payload as { p: Record<string, unknown> }).p;
  assertEquals(p.thumbnail_r2_key, "");
  assertEquals(p.file_kind, "document");
  assertEquals(p.width, null);
  assertEquals((await readJson(res)).item.thumbnail_url, null);
});

Deno.test("hub-post-references: finalize video rounds duration and keeps the thumbnail", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  queuePost(db);
  db.queueRpc("post_reference_file_insert", { data: insertedRow(), error: null });
  const res = await makeHandler(db)(jsonReq("POST", "/files", {
    ...IMAGE_FINALIZE, r2_key: `contas/conta-1/files/${UUID}.mp4`, mime_type: "video/mp4",
    duration_seconds: 12.6,
  }));
  assertEquals(res.status, 201);
  const p = (rpcCall(db, "post_reference_file_insert")?.payload as { p: Record<string, unknown> }).p;
  assertEquals(p.file_kind, "video");
  assertEquals(p.duration_seconds, 13);
  assertEquals(p.thumbnail_r2_key, THUMB);
});

Deno.test("hub-post-references: finalize rejects HEAD mismatches before the RPC", async () => {
  const heads: Array<(key: string) => Promise<Head>> = [
    async () => null,
    async (k) => ({ contentLength: k.endsWith(".thumb.webp") ? 2000 : 4999, contentType: null }),
    async (k) => ({ contentLength: k.endsWith(".thumb.webp") ? 2000 : 5000, contentType: k.endsWith(".thumb.webp") ? null : "image/jpeg" }),
    async (k) => (k.endsWith(".thumb.webp") ? null : { contentLength: 5000, contentType: null }),
    async (k) => ({ contentLength: k.endsWith(".thumb.webp") ? 1999 : 5000, contentType: null }),
  ];
  for (const head of heads) {
    const db = createSupabaseQueryMock();
    setupToken(db);
    queuePost(db);
    const res = await makeHandler(db, { head })(jsonReq("POST", "/files", IMAGE_FINALIZE));
    assertEquals(res.status, 400);
    assertEquals((await readJson(res)).error, "upload_mismatch");
    assertEquals(rpcCall(db, "post_reference_file_insert"), undefined);
  }
});

Deno.test("hub-post-references: finalize rejects keys that /upload-url did not mint", async () => {
  const other = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
  const cases: Array<Record<string, unknown>> = [
    { r2_key: `contas/conta-2/files/${UUID}.png`, thumbnail_r2_key: `contas/conta-2/files/${UUID}.thumb.webp` },
    { r2_key: `contas/conta-1/files/${UUID}.jpg` },
    { r2_key: `contas/conta-1/files/../files/${UUID}.png` },
    { thumbnail_r2_key: `contas/conta-1/files/${other}.thumb.webp` },
  ];
  for (const fields of cases) {
    const db = createSupabaseQueryMock();
    setupToken(db);
    queuePost(db);
    const res = await makeHandler(db)(jsonReq("POST", "/files", { ...IMAGE_FINALIZE, ...fields }));
    assertEquals(res.status, 400, JSON.stringify(fields));
    assertEquals((await readJson(res)).error, "upload_mismatch", JSON.stringify(fields));
  }
});

Deno.test("hub-post-references: finalize refuses a key another files row already owns", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  queuePost(db);
  db.queue("files", "select", { data: [{ id: 555 }], error: null });
  const res = await makeHandler(db)(jsonReq("POST", "/files", IMAGE_FINALIZE));
  assertEquals(res.status, 400);
  assertEquals((await readJson(res)).error, "upload_mismatch");
  assertEquals(rpcCall(db, "post_reference_file_insert"), undefined);
});

Deno.test("hub-post-references: finalize thumbnail rules (missing for image, present for PDF)", async () => {
  const pdfKey = `contas/conta-1/files/${UUID}.pdf`;
  const cases: Array<Record<string, unknown>> = [
    { thumbnail_r2_key: undefined, thumbnail_bytes: undefined },
    { thumbnail_bytes: 512 * 1024 + 1 },
    { r2_key: pdfKey, mime_type: "application/pdf" },
  ];
  for (const fields of cases) {
    const db = createSupabaseQueryMock();
    setupToken(db);
    queuePost(db);
    const res = await makeHandler(db)(jsonReq("POST", "/files", { ...IMAGE_FINALIZE, ...fields }));
    assertEquals(res.status, 400, JSON.stringify(fields));
    assertEquals((await readJson(res)).error, "thumbnail_invalid", JSON.stringify(fields));
  }
});

Deno.test("hub-post-references: finalize maps RPC codes and hides raw DB errors", async () => {
  const cases: Array<[string, number, string]> = [
    ["post_not_pending", 409, "post_not_pending"],
    ["reference_limit", 409, "reference_limit"],
    ["quota_exceeded", 413, "quota_exceeded"],
    ["post_not_found", 404, "not_found"],
    ['duplicate key value violates unique constraint "post_references_file_uq"', 500, "internal"],
  ];
  for (const [message, status, code] of cases) {
    const db = createSupabaseQueryMock();
    setupToken(db);
    queuePost(db);
    db.queueRpc("post_reference_file_insert", { data: null, error: { message } });
    const res = await makeHandler(db)(jsonReq("POST", "/files", IMAGE_FINALIZE));
    assertEquals(res.status, status, message);
    assertEquals(await readJson(res), { error: code });
    assertEquals(rpcCall(db, "create_post_reference_notification"), undefined);
  }
});

Deno.test("hub-post-references: a failed notification does not fail the upload", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  queuePost(db);
  db.queueRpc("post_reference_file_insert", { data: insertedRow(), error: null });
  db.queueRpc("create_post_reference_notification", { data: null, error: { message: "boom" } });
  const res = await makeHandler(db)(jsonReq("POST", "/files", IMAGE_FINALIZE));
  assertEquals(res.status, 201);
});

// ── POST /links ─────────────────────────────────────────────────

Deno.test("hub-post-references: link is normalised, inserted, notified", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  queuePost(db);
  db.queueRpc("post_reference_link_insert", {
    data: insertedRow({ id: 8, kind: "link", file_id: null, url: "https://exemplo.com/post", link_title: "Referência" }),
    error: null,
  });
  const res = await makeHandler(db)(jsonReq("POST", "/links", {
    post_id: 99, url: "  exemplo.com/post ", title: " Referência ", note: "",
  }));
  assertEquals(res.status, 201);
  const { item } = await readJson(res);
  assertEquals(item.kind, "link");
  assertEquals(item.link_url, "https://exemplo.com/post");
  assertEquals(item.link_domain, "exemplo.com");
  assertEquals(item.download_url, null);
  assertEquals(rpcCall(db, "post_reference_link_insert")?.payload, {
    p: { post_id: 99, conta_id: "conta-1", cliente_id: 14, url: "https://exemplo.com/post", link_title: "Referência", note: null },
  });
  assertEquals(rpcCall(db, "create_post_reference_notification")?.payload, { p_post_id: 99 });
});

Deno.test("hub-post-references: link rejects unsafe URLs and long titles without calling the RPC", async () => {
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ url: "javascript:alert(1)" }, "invalid_url"],
    [{ url: "https://user:pw@exemplo.com" }, "invalid_url"],
    [{ url: "ftp://exemplo.com" }, "invalid_url"],
    [{ url: "https://exem plo.com" }, "invalid_url"],
    [{ url: "" }, "invalid_url"],
    [{ url: 12 }, "invalid_url"],
    [{ url: "exemplo.com", title: "a".repeat(121) }, "invalid_note"],
    [{ url: "exemplo.com", note: "a".repeat(501) }, "invalid_note"],
  ];
  for (const [fields, code] of cases) {
    const db = createSupabaseQueryMock();
    setupToken(db);
    queuePost(db);
    const res = await makeHandler(db)(jsonReq("POST", "/links", { post_id: 99, ...fields }));
    assertEquals(res.status, 400, JSON.stringify(fields));
    assertEquals((await readJson(res)).error, code, JSON.stringify(fields));
    assertEquals(rpcCall(db, "post_reference_link_insert"), undefined);
  }
});

Deno.test("hub-post-references: link on a post outside enviado_cliente is 409", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  queuePost(db, { status: "aprovado_cliente" });
  const res = await makeHandler(db)(jsonReq("POST", "/links", { post_id: 99, url: "exemplo.com" }));
  assertEquals(res.status, 409);
  assertEquals((await readJson(res)).error, "post_not_pending");
});

// ── PATCH /:id ──────────────────────────────────────────────────

Deno.test("hub-post-references: PATCH saves the note through the RPC and returns the item", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queueRpc("post_reference_client_update", { data: "ok", error: null });
  db.queue("post_references", "select", { data: { post_id: 99 }, error: null });
  db.queueRpc("post_reference_list", { data: [linkRow({ note: "nova nota", can_remove: true }), fileRow()], error: null });
  const rateKeys: string[] = [];
  const res = await makeHandler(db, { rateKeys })(jsonReq("PATCH", "/8", { note: "  nova nota " }));
  assertEquals(res.status, 200);
  assertEquals((await readJson(res)).item.note, "nova nota");
  assertEquals(rateKeys, [WRITE_KEY]);
  assertEquals(rpcCall(db, "post_reference_client_update")?.payload, {
    p_id: 8, p_conta: "conta-1", p_cliente: 14, p_note: "nova nota",
  });
});

Deno.test("hub-post-references: PATCH maps locked to 409 and not_found to 404", async () => {
  for (const [outcome, status] of [["locked", 409], ["not_found", 404]] as const) {
    const db = createSupabaseQueryMock();
    setupToken(db);
    db.queueRpc("post_reference_client_update", { data: outcome, error: null });
    const res = await makeHandler(db)(jsonReq("PATCH", "/8", { note: "x" }));
    assertEquals(res.status, status);
    assertEquals((await readJson(res)).error, outcome);
  }
});

Deno.test("hub-post-references: PATCH rejects a note over 500 chars before the RPC", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  const res = await makeHandler(db)(jsonReq("PATCH", "/8", { note: "a".repeat(501) }));
  assertEquals(res.status, 400);
  assertEquals((await readJson(res)).error, "invalid_note");
  assertEquals(rpcCall(db, "post_reference_client_update"), undefined);
});

// ── DELETE /:id ─────────────────────────────────────────────────

Deno.test("hub-post-references: DELETE removes through the RPC scoped to the token", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  db.queueRpc("post_reference_client_delete", { data: "ok", error: null });
  const rateKeys: string[] = [];
  const res = await makeHandler(db, { rateKeys })(getReq("/7?token=t", "DELETE"));
  assertEquals(res.status, 200);
  assertEquals(await readJson(res), { ok: true });
  assertEquals(rateKeys, [WRITE_KEY]);
  assertEquals(rpcCall(db, "post_reference_client_delete")?.payload, { p_id: 7, p_conta: "conta-1", p_cliente: 14 });
});

Deno.test("hub-post-references: DELETE maps locked to 409, not_found to 404, RPC error to 500", async () => {
  const cases: Array<[Record<string, unknown>, number, string]> = [
    [{ data: "locked", error: null }, 409, "locked"],
    [{ data: "not_found", error: null }, 404, "not_found"],
    [{ data: null, error: { message: "deadlock detected" } }, 500, "internal"],
  ];
  for (const [rpc, status, code] of cases) {
    const db = createSupabaseQueryMock();
    setupToken(db);
    db.queueRpc("post_reference_client_delete", rpc);
    const res = await makeHandler(db)(getReq("/7?token=t", "DELETE"));
    assertEquals(res.status, status);
    assertEquals(await readJson(res), { error: code });
  }
});

Deno.test("hub-post-references: an exhausted write budget is 429 rate_limited with no work", async () => {
  const db = createSupabaseQueryMock();
  setupToken(db);
  const res = await makeHandler(db, { limited: true })(getReq("/7?token=t", "DELETE"));
  assertEquals(res.status, 429);
  assertEquals((await readJson(res)).error, "rate_limited");
  assertEquals(rpcCall(db, "post_reference_client_delete"), undefined);
});
