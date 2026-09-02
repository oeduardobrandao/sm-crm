import { assertEquals } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createEquipeChatMediaHandler } from "../equipe-chat-media/handler.ts";

const buildCorsHeaders = () => ({ "Access-Control-Allow-Origin": "https://app.mesaas.com" });

// deno-lint-ignore no-explicit-any
function makeHandler(db: any, opts?: {
  headObject?: (key: string) => Promise<{ contentLength: number; contentType: string | null } | null>;
  copies?: Array<{ from: string; to: string }>;
  trashed?: string[];
}) {
  return createEquipeChatMediaHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    signPutUrl: async (key: string) => `https://put.example.com/${key}`,
    signGetUrl: async (key: string) => `https://get.example.com/${key}`,
    headObject: opts?.headObject ?? (async () => ({ contentLength: 5000, contentType: "image/jpeg" })),
    copyObject: async (from: string, to: string) => { opts?.copies?.push({ from, to }); },
    trashObject: async (key: string) => { opts?.trashed?.push(key); },
    randomUUID: () => "fixed-uuid",
  });
}

function req(route: string, body: unknown, token = "valid-jwt") {
  return new Request(`https://example.test/equipe-chat-media/${route}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// deno-lint-ignore no-explicit-any
function setupAuth(db: any, opts?: { participante?: boolean; featureEnabled?: boolean }) {
  const participante = opts?.participante ?? true;
  const featureEnabled = opts?.featureEnabled ?? true;
  db.withAuth({ id: "user-1" });
  db.queue("profiles", "select", { data: { active_workspace_id: "conta-1" }, error: null });
  db.queue("workspace_members", "select", { data: { user_id: "user-1", role: "admin" }, error: null });
  // resolveEntitlements: workspaces -> overrides -> plans.
  db.queue("workspaces", "select", { data: { plan_id: "plan-1" }, error: null });
  db.queue("workspace_plan_overrides", "select", { data: null, error: null });
  db.queue("plans", "select", {
    data: { name: "Max", feature_team_chat: featureEnabled },
    error: null,
  });
  // Conversa do tenant + participacao do caller.
  db.queue("equipe_conversas", "select", { data: { conta_id: "conta-1" }, error: null });
  db.queue("equipe_conversa_participantes", "select",
    { data: participante ? { id: 1 } : null, error: null });
}

Deno.test("presign: key no prefixo tmp do tenant", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const res = await makeHandler(db)(req("presign", {
    conversa_id: 7, mime_type: "image/jpeg", size_bytes: 5000,
  }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.key, "equipe-chat-tmp/conta-1/fixed-uuid.jpg");
  assertEquals(body.upload_url, "https://put.example.com/equipe-chat-tmp/conta-1/fixed-uuid.jpg");
});

Deno.test("presign: mime fora da allowlist da 415", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const res = await makeHandler(db)(req("presign", {
    conversa_id: 7, mime_type: "application/x-msdownload", size_bytes: 5000,
  }));
  assertEquals(res.status, 415);
});

Deno.test("presign: acima de 25MB da 400", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const res = await makeHandler(db)(req("presign", {
    conversa_id: 7, mime_type: "image/png", size_bytes: 26 * 1024 * 1024,
  }));
  assertEquals(res.status, 400);
});

Deno.test("presign: nao-participante da 403", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db, { participante: false });
  const res = await makeHandler(db)(req("presign", {
    conversa_id: 7, mime_type: "image/jpeg", size_bytes: 5000,
  }));
  assertEquals(res.status, 403);
});

Deno.test("presign: feature off da 403", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db, { featureEnabled: false });
  const res = await makeHandler(db)(req("presign", {
    conversa_id: 7, mime_type: "image/jpeg", size_bytes: 5000,
  }));
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body, { error: "feature_disabled", feature: "feature_team_chat" });
});

Deno.test("presign: sem plano resolvido (resolveEntitlements null) da 403 fail-closed", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "user-1" });
  db.queue("profiles", "select", { data: { active_workspace_id: "conta-1" }, error: null });
  db.queue("workspace_members", "select", { data: { user_id: "user-1", role: "admin" }, error: null });
  // resolveEntitlements: workspace aponta pra um plan_id, mas a linha do
  // plano nao existe mais (deletado/renomeado) -> resolveEntitlements
  // retorna null. O gate ANTIGO (`ent && ent.features[...] !== true`) tratava
  // ent nulo como "nada pra checar" e deixava passar -- fail-open. Com
  // assertPlanFeature (`!ent || ...`), isto agora bloqueia.
  db.queue("workspaces", "select", { data: { plan_id: "plan-deletado" }, error: null });
  db.queue("workspace_plan_overrides", "select", { data: null, error: null });
  db.queue("plans", "select", { data: null, error: null });
  const res = await makeHandler(db)(req("presign", {
    conversa_id: 7, mime_type: "image/jpeg", size_bytes: 5000,
  }));
  assertEquals(res.status, 403);
  const body = await res.json();
  assertEquals(body, { error: "feature_disabled", feature: "feature_team_chat" });
});

Deno.test("finalize: HEAD na tmp, copia p/ final, RPC, trash da tmp", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queueRpc("equipe_chat_anexo_finalize", {
    data: { anexo_id: 8, r2_key: "equipe-chat/conta-1/fixed-uuid.jpg",
            file_name: "foto.jpg", mime_type: "image/jpeg", size_bytes: 5000 },
    error: null,
  });
  const copies: Array<{ from: string; to: string }> = [];
  const trashed: string[] = [];
  const res = await makeHandler(db, { copies, trashed })(req("finalize", {
    conversa_id: 7, key: "equipe-chat-tmp/conta-1/fixed-uuid.jpg",
    file_name: "foto.jpg", mime_type: "image/jpeg", size_bytes: 5000,
  }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.anexo.id, 8);
  assertEquals(copies, [{
    from: "equipe-chat-tmp/conta-1/fixed-uuid.jpg",
    to: "equipe-chat/conta-1/fixed-uuid.jpg",
  }]);
  assertEquals(trashed, ["equipe-chat-tmp/conta-1/fixed-uuid.jpg"]);
});

Deno.test("finalize: key fora do prefixo tmp do tenant da 400", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const res = await makeHandler(db)(req("finalize", {
    conversa_id: 7, key: "equipe-chat-tmp/conta-OUTRA/x.jpg",
    file_name: "x.jpg", mime_type: "image/jpeg", size_bytes: 5000,
  }));
  assertEquals(res.status, 400);
});

Deno.test("finalize: objeto tmp ausente da 400", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const res = await makeHandler(db, { headObject: async () => null })(req("finalize", {
    conversa_id: 7, key: "equipe-chat-tmp/conta-1/fixed-uuid.jpg",
    file_name: "x.jpg", mime_type: "image/jpeg", size_bytes: 5000,
  }));
  assertEquals(res.status, 400);
});

Deno.test("finalize: size divergente da 400", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const res = await makeHandler(db, {
    headObject: async () => ({ contentLength: 999, contentType: "image/jpeg" }),
  })(req("finalize", {
    conversa_id: 7, key: "equipe-chat-tmp/conta-1/fixed-uuid.jpg",
    file_name: "x.jpg", mime_type: "image/jpeg", size_bytes: 5000,
  }));
  assertEquals(res.status, 400);
});

Deno.test("finalize: quota_exceeded da RPC vira 413", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  db.queueRpc("equipe_chat_anexo_finalize", {
    data: null, error: { message: "quota_exceeded" },
  });
  const res = await makeHandler(db, { copies: [], trashed: [] })(req("finalize", {
    conversa_id: 7, key: "equipe-chat-tmp/conta-1/fixed-uuid.jpg",
    file_name: "x.jpg", mime_type: "image/jpeg", size_bytes: 5000,
  }));
  assertEquals(res.status, 413);
});

Deno.test("finalize: size_bytes acima de 25MB da 400 (mesmo com headObject batendo)", async () => {
  const db = createSupabaseQueryMock();
  setupAuth(db);
  const oversized = 26 * 1024 * 1024;
  const res = await makeHandler(db, {
    headObject: async () => ({ contentLength: oversized, contentType: "image/jpeg" }),
  })(req("finalize", {
    conversa_id: 7, key: "equipe-chat-tmp/conta-1/fixed-uuid.jpg",
    file_name: "x.jpg", mime_type: "image/jpeg", size_bytes: oversized,
  }));
  assertEquals(res.status, 400);
});

Deno.test("anexo-url: participante recebe GET assinado", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "user-1" });
  db.queue("profiles", "select", { data: { active_workspace_id: "conta-1" }, error: null });
  db.queue("workspace_members", "select", { data: { user_id: "user-1", role: "agent" }, error: null });
  db.queue("workspaces", "select", { data: { plan_id: "plan-1" }, error: null });
  db.queue("workspace_plan_overrides", "select", { data: null, error: null });
  db.queue("plans", "select", { data: { name: "Max", feature_team_chat: true }, error: null });
  // Anexo do tenant com a conversa, JA ENVIADO (mensagem_id preenchido) por
  // OUTRO usuario; depois a participacao do caller.
  db.queue("equipe_mensagem_anexos", "select", {
    data: { id: 8, conta_id: "conta-1", conversa_id: 7, mensagem_id: 55,
            r2_key: "equipe-chat/conta-1/fixed-uuid.jpg", created_by: "user-2" },
    error: null,
  });
  db.queue("equipe_conversa_participantes", "select", { data: { id: 1 }, error: null });
  const res = await makeHandler(db)(req("anexo-url", { anexo_id: 8 }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.url, "https://get.example.com/equipe-chat/conta-1/fixed-uuid.jpg");
});

Deno.test("anexo-url: staged (nao enviado) visivel ao autor", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "user-1" });
  db.queue("profiles", "select", { data: { active_workspace_id: "conta-1" }, error: null });
  db.queue("workspace_members", "select", { data: { user_id: "user-1", role: "agent" }, error: null });
  db.queue("workspaces", "select", { data: { plan_id: "plan-1" }, error: null });
  db.queue("workspace_plan_overrides", "select", { data: null, error: null });
  db.queue("plans", "select", { data: { name: "Max", feature_team_chat: true }, error: null });
  // Staged: mensagem_id NULL, criado pelo proprio caller.
  db.queue("equipe_mensagem_anexos", "select", {
    data: { id: 8, conta_id: "conta-1", conversa_id: 7, mensagem_id: null,
            r2_key: "equipe-chat/conta-1/fixed-uuid.jpg", created_by: "user-1" },
    error: null,
  });
  db.queue("equipe_conversa_participantes", "select", { data: { id: 1 }, error: null });
  const res = await makeHandler(db)(req("anexo-url", { anexo_id: 8 }));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.url, "https://get.example.com/equipe-chat/conta-1/fixed-uuid.jpg");
});

Deno.test("anexo-url: staged (nao enviado) de OUTRO participante da 404", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "user-1" });
  db.queue("profiles", "select", { data: { active_workspace_id: "conta-1" }, error: null });
  db.queue("workspace_members", "select", { data: { user_id: "user-1", role: "agent" }, error: null });
  db.queue("workspaces", "select", { data: { plan_id: "plan-1" }, error: null });
  db.queue("workspace_plan_overrides", "select", { data: null, error: null });
  db.queue("plans", "select", { data: { name: "Max", feature_team_chat: true }, error: null });
  // Staged: mensagem_id NULL, criado por OUTRO participante da mesma conversa.
  db.queue("equipe_mensagem_anexos", "select", {
    data: { id: 8, conta_id: "conta-1", conversa_id: 7, mensagem_id: null,
            r2_key: "equipe-chat/conta-1/fixed-uuid.jpg", created_by: "user-2" },
    error: null,
  });
  db.queue("equipe_conversa_participantes", "select", { data: { id: 1 }, error: null });
  const res = await makeHandler(db)(req("anexo-url", { anexo_id: 8 }));
  assertEquals(res.status, 404);
});

Deno.test("anexo-url: anexo do tenant mas caller nao participa da 404 (nao 403 -- nao confirma existencia)", async () => {
  const db = createSupabaseQueryMock();
  db.withAuth({ id: "user-1" });
  db.queue("profiles", "select", { data: { active_workspace_id: "conta-1" }, error: null });
  db.queue("workspace_members", "select", { data: { user_id: "user-1", role: "agent" }, error: null });
  db.queue("workspaces", "select", { data: { plan_id: "plan-1" }, error: null });
  db.queue("workspace_plan_overrides", "select", { data: null, error: null });
  db.queue("plans", "select", { data: { name: "Max", feature_team_chat: true }, error: null });
  db.queue("equipe_mensagem_anexos", "select", {
    data: { id: 8, conta_id: "conta-1", conversa_id: 7,
            r2_key: "equipe-chat/conta-1/fixed-uuid.jpg" },
    error: null,
  });
  db.queue("equipe_conversa_participantes", "select", { data: null, error: null });
  const res = await makeHandler(db)(req("anexo-url", { anexo_id: 8 }));
  assertEquals(res.status, 404);
});

Deno.test("sem Authorization da 401", async () => {
  const db = createSupabaseQueryMock();
  const r = new Request("https://example.test/equipe-chat-media/presign", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  const res = await makeHandler(db)(r);
  assertEquals(res.status, 401);
});
