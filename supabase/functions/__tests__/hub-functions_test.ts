import { assertEquals, readJson } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createHubApproveHandler } from "../hub-approve/handler.ts";
import { createHubBootstrapHandler } from "../hub-bootstrap/handler.ts";
import { createHubBrandHandler } from "../hub-brand/handler.ts";
import { createHubBriefingHandler } from "../hub-briefing/handler.ts";
import { createHubIdeiasHandler } from "../hub-ideias/handler.ts";
import { createHubPagesHandler } from "../hub-pages/handler.ts";
import { createHubPostsHandler } from "../hub-posts/handler.ts";

const now = () => "2026-04-17T12:00:00.000Z";
const buildCorsHeaders = () => ({ "Access-Control-Allow-Origin": "https://hub.mesaas.com" });

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

  const handler = createHubBootstrapHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });

  const response = await handler(new Request("https://example.test/hub-bootstrap?workspace=mesaas&token=hub-123"));
  const body = await readJson(response);

  assertEquals(response.status, 200);
  assertEquals(body.cliente_nome, "Clínica Aurora");
  assertEquals(body.workspace.brand_color, "#1a1a2e");
});

Deno.test("hub-bootstrap rejects missing query params", async () => {
  const handler = createHubBootstrapHandler({
    buildCorsHeaders,
    createDb: () => createSupabaseQueryMock() as never,
    now,
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
        workflow_id: 7,
        workflows: { titulo: "Calendário Abril" },
      },
    ],
    error: null,
  });
  db.queue("post_approvals", "select", { data: [], error: null });
  db.queue("post_property_values", "select", { data: [], error: null });
  db.queue("workflow_select_options", "select", { data: [], error: null });
  db.queue("post_media", "select", {
    data: [
      {
        id: 1,
        post_id: 99,
        kind: "image",
        mime_type: "image/png",
        r2_key: "contas/1/post.png",
        thumbnail_r2_key: null,
        width: 1080,
        height: 1350,
        duration_seconds: null,
        is_cover: true,
        sort_order: 0,
      },
    ],
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
  db.queue("hub_briefing_questions", "select", {
    data: [{ id: "q1", question: "Qual o objetivo principal?" }],
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
  assertEquals(body.questions.length, 1);
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
