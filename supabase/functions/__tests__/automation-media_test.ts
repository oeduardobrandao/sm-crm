import { assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createAutomationMediaHandler } from "../automation-media/handler.ts";

const buildCorsHeaders = () => ({ "Access-Control-Allow-Origin": "https://app.mesaas.com" });

// deno-lint-ignore no-explicit-any
function makeHandler(db: any, opts?: {
  headObject?: (key: string) => Promise<{ contentLength: number; contentType: string | null } | null>;
  trashed?: string[];
  copies?: Array<{ from: string; to: string }>;
}) {
  return createAutomationMediaHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    signPutUrl: async (key: string) => `https://put.example.com/${key}`,
    signGetUrl: async (key: string) => `https://get.example.com/${key}`,
    headObject: opts?.headObject ?? (async () => ({ contentLength: 5000, contentType: "image/jpeg" })),
    trashObject: async (key: string) => { opts?.trashed?.push(key); },
    copyObject: async (from: string, to: string) => { opts?.copies?.push({ from, to }); },
    randomUUID: () => "fixed-uuid",
  });
}

function req(path: string, body: unknown, token = "valid-jwt") {
  return new Request(`https://example.test/automation-media/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// deno-lint-ignore no-explicit-any
function setupAuth(db: any, contaId = "conta-1", role = "owner", featureEnabled = true) {
  db.withAuth({ id: "user-1" });
  db.queue("profiles", "select", { data: { active_workspace_id: contaId }, error: null });
  db.queue("workspace_members", "select", { data: { user_id: "user-1", role }, error: null });
  // presign/finalize checam feature_instagram_automation via resolveEntitlements
  // (workspaces -> plans).
  db.queue("workspaces", "select", { data: { plan_id: "plan-1" }, error: null });
  db.queue("workspace_plan_overrides", "select", { data: null, error: null });
  db.queue("plans", "select", {
    data: { name: featureEnabled ? "Max" : "Free", feature_instagram_automation: featureEnabled },
    error: null,
  });
}

Deno.test("presign: gera key no prefixo TMP do tenant e devolve upload_url", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const res = await makeHandler(db)(req("presign", { mime_type: "image/jpeg", size_bytes: 5000 }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.key, "automation-media-tmp/conta-1/fixed-uuid.jpg");
  assertEquals(body.upload_url, "https://put.example.com/automation-media-tmp/conta-1/fixed-uuid.jpg");
});

Deno.test("presign: mime fora da allowlist -> 415; acima de 8MB -> 400; sem auth -> 401", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  assertEquals((await makeHandler(db)(req("presign", { mime_type: "image/webp", size_bytes: 10 }))).status, 415);
  const db2 = createSupabaseQueryMock();
  setupAuth(db2);
  assertEquals(
    (await makeHandler(db2)(req("presign", { mime_type: "image/png", size_bytes: 8388609 }))).status,
    400,
  );
  const db3 = createSupabaseQueryMock();
  db3.withAuth(null, { message: "bad token" });
  assertEquals((await makeHandler(db3)(req("presign", { mime_type: "image/png", size_bytes: 10 }))).status, 401);
});

Deno.test("finalize: copia tmp -> final, HEAD confere a FINAL, finaliza com quota e devolve dm_media com a key final", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("automation_media_objects", "select", { data: null, error: null });
  db.queueRpc("automation_media_finalize", { data: true, error: null });
  const copies: Array<{ from: string; to: string }> = [];
  const trashed: string[] = [];
  const res = await makeHandler(db, { copies, trashed })(req("finalize", {
    key: "automation-media-tmp/conta-1/fixed-uuid.jpg",
    mime_type: "image/jpeg",
    size_bytes: 5000,
    width: 1080,
    height: 1350,
  }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.dm_media, {
    key: "automation-media/conta-1/fixed-uuid.jpg",
    content_type: "image/jpeg",
    size_bytes: 5000,
    width: 1080,
    height: 1350,
  });
  assertEquals(copies, [{
    from: "automation-media-tmp/conta-1/fixed-uuid.jpg",
    to: "automation-media/conta-1/fixed-uuid.jpg",
  }]);
  // A tmp é trasheada após a cópia (best-effort).
  assertEquals(trashed, ["automation-media-tmp/conta-1/fixed-uuid.jpg"]);
  const rpcs = db.calls.filter((c: { table: string }) => c.table === "rpc:automation_media_finalize");
  assertEquals(rpcs[0].payload, {
    p_conta_id: "conta-1",
    p_key: "automation-media/conta-1/fixed-uuid.jpg",
    p_bytes: 5000,
    p_content_type: "image/jpeg",
  });
});

Deno.test("finalize: retry com resposta perdida devolve o canônico do registro sem recopiar", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("automation_media_objects", "select", {
    data: { key: "automation-media/conta-1/fixed-uuid.jpg", content_type: "image/jpeg", size_bytes: 5000 },
    error: null,
  });
  const copies: Array<{ from: string; to: string }> = [];
  const res = await makeHandler(db, { copies })(req("finalize", {
    key: "automation-media-tmp/conta-1/fixed-uuid.jpg",
    mime_type: "image/jpeg",
    size_bytes: 5000,
  }));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).dm_media.key, "automation-media/conta-1/fixed-uuid.jpg");
  assertEquals(copies, []);
});

Deno.test("finalize: key tmp de outro tenant -> 400; size divergente do HEAD -> 400; quota -> 413 e trasheia a final", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  assertEquals(
    (await makeHandler(db)(req("finalize", { key: "automation-media-tmp/OUTRA/x.jpg", mime_type: "image/jpeg", size_bytes: 5000 }))).status,
    400,
  );
  const db2 = createSupabaseQueryMock();
  setupAuth(db2);
  db2.queue("automation_media_objects", "select", { data: null, error: null });
  const copies2: Array<{ from: string; to: string }> = [];
  assertEquals(
    (await makeHandler(db2, { copies: copies2, headObject: async () => ({ contentLength: 999, contentType: "image/jpeg" }) })(
      req("finalize", { key: "automation-media-tmp/conta-1/x.jpg", mime_type: "image/jpeg", size_bytes: 5000 }),
    )).status,
    400,
  );
  // Mismatch detectado no HEAD da TMP: nada foi copiado ao prefixo permanente.
  assertEquals(copies2, []);
  const db3 = createSupabaseQueryMock();
  setupAuth(db3);
  db3.queueRpc("automation_media_finalize", { data: null, error: { message: "quota_exceeded" } });
  const trashed3: string[] = [];
  assertEquals(
    (await makeHandler(db3, { trashed: trashed3 })(req("finalize", { key: "automation-media-tmp/conta-1/x.jpg", mime_type: "image/jpeg", size_bytes: 5000 }))).status,
    413,
  );
  // Upload rejeitado por quota não fica retido: a cópia FINAL vai para o trash
  // (a tmp vira órfã aceita).
  assertEquals(trashed3.includes("automation-media/conta-1/x.jpg"), true);
});

Deno.test("delete: trasheia (nunca hard delete) e libera pelo registro do servidor; prefixo de outro tenant -> 400", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("instagram_comment_automations", "select", { data: [], error: null });
  db.queueRpc("automation_media_release", { data: 5000, error: null });
  const trashed: string[] = [];
  const res = await makeHandler(db, { trashed })(req("delete", {
    key: "automation-media/conta-1/x.jpg",
  }));
  assertEquals(res.status, 200);
  assertEquals(trashed, ["automation-media/conta-1/x.jpg"]);
  const rpcs = db.calls.filter((c: { table: string }) => c.table === "rpc:automation_media_release");
  assertEquals(rpcs[0].payload, {
    p_conta_id: "conta-1",
    p_key: "automation-media/conta-1/x.jpg",
  });

  const db2 = createSupabaseQueryMock();
  setupAuth(db2);
  assertEquals(
    (await makeHandler(db2)(req("delete", { key: "automation-media/OUTRA/x.jpg" }))).status,
    400,
  );
});

Deno.test("delete: key ainda referenciada por automação -> 409 e nada é trasheado", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queue("instagram_comment_automations", "select", { data: [{ id: "auto-1" }], error: null });
  const trashed: string[] = [];
  const res = await makeHandler(db, { trashed })(req("delete", { key: "automation-media/conta-1/x.jpg" }));
  assertEquals(res.status, 409);
  assertEquals(trashed, []);
});

// Task 11: o gate mutante trocou de isWorkspaceEditor(member.role) para
// has_permission_for(user, conta, 'automacoes', 'editar') -- a MESMA permissão
// que a RLS de instagram_comment_automations exige para escrever (ica_insert/
// update/delete, migração 20260904000002). Migração B também mudou o preset de
// agent para 'automacoes':'editar' (era só 'ver'), então agent legado agora
// PASSA aqui -- mudança de comportamento deliberada, não uma regressão de
// isolamento (ver correções do brief da Task 11).
Deno.test("presign/finalize/delete: agent legado (preset automacoes:'editar' da Migração B) agora passa", async () => {
  const dbPresign = createSupabaseQueryMock();
  setupAuth(dbPresign, "conta-1", "agent");
  const resPresign = await makeHandler(dbPresign)(req("presign", { mime_type: "image/jpeg", size_bytes: 5000 }));
  assertEquals(resPresign.status, 200);
  const presignRpc = dbPresign.calls.find((c: { table: string }) => c.table === "rpc:has_permission_for");
  assertEquals(presignRpc?.payload, {
    p_user: "user-1", p_workspace: "conta-1", p_module: "automacoes", p_action: "editar",
  });

  const dbFinalize = createSupabaseQueryMock();
  setupAuth(dbFinalize, "conta-1", "agent");
  dbFinalize.queue("automation_media_objects", "select", { data: null, error: null });
  dbFinalize.queueRpc("automation_media_finalize", { data: true, error: null });
  const resFinalize = await makeHandler(dbFinalize)(req("finalize", {
    key: "automation-media-tmp/conta-1/x.jpg", mime_type: "image/jpeg", size_bytes: 5000,
  }));
  assertEquals(resFinalize.status, 200);

  const dbDelete = createSupabaseQueryMock();
  setupAuth(dbDelete, "conta-1", "agent");
  dbDelete.queue("instagram_comment_automations", "select", { data: [], error: null });
  dbDelete.queueRpc("automation_media_release", { data: 5000, error: null });
  const resDelete = await makeHandler(dbDelete)(req("delete", { key: "automation-media/conta-1/x.jpg" }));
  assertEquals(resDelete.status, 200);
});

Deno.test("presign/finalize/delete: papel custom (chassi agent) sem 'automacoes':'editar' -> 403", async () => {
  const dbPresign = createSupabaseQueryMock();
  setupAuth(dbPresign, "conta-1", "agent");
  dbPresign.queueRpc("has_permission_for", { data: false, error: null });
  assertEquals(
    (await makeHandler(dbPresign)(req("presign", { mime_type: "image/jpeg", size_bytes: 5000 }))).status,
    403,
  );

  const dbFinalize = createSupabaseQueryMock();
  setupAuth(dbFinalize, "conta-1", "agent");
  dbFinalize.queueRpc("has_permission_for", { data: false, error: null });
  assertEquals(
    (await makeHandler(dbFinalize)(req("finalize", {
      key: "automation-media-tmp/conta-1/x.jpg", mime_type: "image/jpeg", size_bytes: 5000,
    }))).status,
    403,
  );

  const dbDelete = createSupabaseQueryMock();
  setupAuth(dbDelete, "conta-1", "agent");
  dbDelete.queueRpc("has_permission_for", { data: false, error: null });
  assertEquals(
    (await makeHandler(dbDelete)(req("delete", { key: "automation-media/conta-1/x.jpg" }))).status,
    403,
  );
});

Deno.test("presign: papel custom (chassi agent) COM 'automacoes':'editar' -> passa", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db, "conta-1", "agent");
  db.queueRpc("has_permission_for", { data: true, error: null });
  const res = await makeHandler(db)(req("presign", { mime_type: "image/jpeg", size_bytes: 5000 }));
  assertEquals(res.status, 200);
});

Deno.test("sign-view: agent (só leitura) continua permitido, como ica_select", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db, "conta-1", "agent");
  db.queueRpc("has_permission_for", { data: true, error: null });
  const res = await makeHandler(db)(req("sign-view", { key: "automation-media/conta-1/x.jpg" }));
  assertEquals(res.status, 200);
  const call = db.calls.find((c: { table: string }) => c.table === "rpc:has_permission_for");
  assertEquals(call?.payload, {
    p_user: "user-1", p_workspace: "conta-1", p_module: "automacoes", p_action: "ver",
  });
});

// Sem o gate de leitura, qualquer membro do workspace (inclusive um papel
// custom SEM 'automacoes' nenhum) podia mintar URLs assinadas do R2 por key
// -- sign-view era o único route ainda aberto a "qualquer membro". Fixed
// alongside the invite-user owner-invite trava (external review round).
Deno.test("sign-view: papel custom (chassi agent) sem 'automacoes' nenhum -> 403", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db, "conta-1", "agent");
  db.queueRpc("has_permission_for", { data: false, error: null });
  const res = await makeHandler(db)(req("sign-view", { key: "automation-media/conta-1/x.jpg" }));
  assertEquals(res.status, 403);
});

Deno.test("sign-view: papel custom (chassi agent) COM 'automacoes':'ver' -> passa", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db, "conta-1", "agent");
  db.queueRpc("has_permission_for", { data: true, error: null });
  const res = await makeHandler(db)(req("sign-view", { key: "automation-media/conta-1/x.jpg" }));
  assertEquals(res.status, 200);
});

Deno.test("presign/finalize: workspace sem feature_instagram_automation -> 403 feature_disabled", async () => {
  const dbPresign = createSupabaseQueryMock();
  setupAuth(dbPresign, "conta-1", "owner", false);
  const resPresign = await makeHandler(dbPresign)(req("presign", { mime_type: "image/jpeg", size_bytes: 5000 }));
  assertEquals(resPresign.status, 403);
  assertEquals((await resPresign.json()).error, "feature_disabled");

  const dbFinalize = createSupabaseQueryMock();
  setupAuth(dbFinalize, "conta-1", "owner", false);
  const resFinalize = await makeHandler(dbFinalize)(req("finalize", {
    key: "automation-media-tmp/conta-1/x.jpg", mime_type: "image/jpeg", size_bytes: 5000,
  }));
  assertEquals(resFinalize.status, 403);
  assertEquals((await resFinalize.json()).error, "feature_disabled");
});

Deno.test("delete: workspace sem feature_instagram_automation ainda pode apagar mídia existente (downgrade não trava limpeza)", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db, "conta-1", "owner", false);
  db.queue("instagram_comment_automations", "select", { data: [], error: null });
  db.queueRpc("automation_media_release", { data: 5000, error: null });
  const trashed: string[] = [];
  const res = await makeHandler(db, { trashed })(req("delete", { key: "automation-media/conta-1/x.jpg" }));
  assertEquals(res.status, 200);
  assertEquals(trashed, ["automation-media/conta-1/x.jpg"]);
});

Deno.test("sign-view: devolve GET assinado só para key do tenant", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const res = await makeHandler(db)(req("sign-view", { key: "automation-media/conta-1/x.jpg" }));
  assertEquals((await res.json()).url, "https://get.example.com/automation-media/conta-1/x.jpg");
  const db2 = createSupabaseQueryMock();
  setupAuth(db2);
  assertEquals(
    (await makeHandler(db2)(req("sign-view", { key: "automation-media/OUTRA/x.jpg" }))).status,
    400,
  );
});
