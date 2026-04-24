import { assertEquals, readJson } from "./assert.ts";
import { createSupabaseQueryMock } from "../../../test/shared/supabaseMock.ts";
import { createHubApproveHandler } from "../hub-approve/handler.ts";
import { createHubBootstrapHandler } from "../hub-bootstrap/handler.ts";
import { createHubBrandHandler } from "../hub-brand/handler.ts";
import { createHubBriefingHandler } from "../hub-briefing/handler.ts";
import { createHubIdeiasHandler } from "../hub-ideias/handler.ts";
import { createHubPagesHandler } from "../hub-pages/handler.ts";
import { createHubPostsHandler } from "../hub-posts/handler.ts";
import { createHubInstagramFeedHandler } from "../hub-instagram-feed/handler.ts";

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
  db.queue("post_file_links", "select", {
    data: [
      {
        id: 1,
        post_id: 99,
        is_cover: true,
        sort_order: 0,
        files: {
          id: 10,
          kind: "image",
          mime_type: "image/png",
          r2_key: "contas/1/post.png",
          thumbnail_r2_key: null,
          width: 1080,
          height: 1350,
          duration_seconds: null,
          blur_data_url: null,
        },
      },
    ],
    error: null,
  });
  db.queue("instagram_accounts", "select", {
    data: { username: "studio_marca", profile_picture_url: "https://cdn.ig/pic.jpg" },
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

// ---------------------------------------------------------------------------
// Error-path coverage (Tier 3)
// ---------------------------------------------------------------------------

Deno.test("hub-bootstrap handles CORS preflight with 200", async () => {
  const handler = createHubBootstrapHandler({
    buildCorsHeaders,
    createDb: () => createSupabaseQueryMock() as never,
    now,
  });
  const response = await handler(new Request("https://example.test/hub-bootstrap", { method: "OPTIONS" }));
  assertEquals(response.status, 200);
});

Deno.test("hub-bootstrap rejects non-GET methods with 405", async () => {
  const handler = createHubBootstrapHandler({
    buildCorsHeaders,
    createDb: () => createSupabaseQueryMock() as never,
    now,
  });
  const response = await handler(new Request("https://example.test/hub-bootstrap?workspace=x&token=y", { method: "POST" }));
  assertEquals(response.status, 405);
});

Deno.test("hub-bootstrap returns 404 when the workspace slug is unknown", async () => {
  const db = createSupabaseQueryMock();
  db.queue("workspaces", "select", { data: null, error: null });

  const handler = createHubBootstrapHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });
  const response = await handler(new Request("https://example.test/hub-bootstrap?workspace=nope&token=hub-123"));
  assertEquals(response.status, 404);
});

Deno.test("hub-bootstrap returns 403 when the workspace has the hub disabled", async () => {
  const db = createSupabaseQueryMock();
  db.queue("workspaces", "select", {
    data: { id: "conta-1", name: "Mesaas", logo_url: null, brand_color: null, hub_enabled: false },
    error: null,
  });

  const handler = createHubBootstrapHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });
  const response = await handler(new Request("https://example.test/hub-bootstrap?workspace=mesaas&token=hub-123"));
  assertEquals(response.status, 403);
});

Deno.test("hub-bootstrap returns 404 when the hub token is missing or inactive", async () => {
  const db = createSupabaseQueryMock();
  db.queue("workspaces", "select", {
    data: { id: "conta-1", name: "Mesaas", logo_url: null, brand_color: null, hub_enabled: true },
    error: null,
  });
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, is_active: false },
    error: null,
  });

  const handler = createHubBootstrapHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });
  const response = await handler(new Request("https://example.test/hub-bootstrap?workspace=mesaas&token=hub-123"));
  assertEquals(response.status, 404);
});

Deno.test("hub-approve rejects non-POST methods with 405", async () => {
  const handler = createHubApproveHandler({
    buildCorsHeaders,
    createDb: () => createSupabaseQueryMock() as never,
    now,
  });
  const response = await handler(new Request("https://example.test/hub-approve", { method: "GET" }));
  assertEquals(response.status, 405);
});

Deno.test("hub-approve rejects missing required fields with 400", async () => {
  const handler = createHubApproveHandler({
    buildCorsHeaders,
    createDb: () => createSupabaseQueryMock() as never,
    now,
  });
  const response = await handler(new Request("https://example.test/hub-approve", {
    method: "POST",
    body: JSON.stringify({ token: "hub-123" }),
  }));
  assertEquals(response.status, 400);
});

Deno.test("hub-approve returns 404 when the post cannot be found", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: { cliente_id: 14, is_active: true }, error: null });
  db.queue("workflow_posts", "select", { data: null, error: null });

  const handler = createHubApproveHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });
  const response = await handler(new Request("https://example.test/hub-approve", {
    method: "POST",
    body: JSON.stringify({ token: "hub-123", post_id: 99, action: "aprovado" }),
  }));
  assertEquals(response.status, 404);
});

Deno.test("hub-approve returns 403 when the post belongs to a different client", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: { cliente_id: 14, is_active: true }, error: null });
  db.queue("workflow_posts", "select", { data: { id: 99, workflow_id: 7, status: "enviado_cliente" }, error: null });
  db.queue("workflows", "select", { data: { cliente_id: 999 }, error: null });

  const handler = createHubApproveHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });
  const response = await handler(new Request("https://example.test/hub-approve", {
    method: "POST",
    body: JSON.stringify({ token: "hub-123", post_id: 99, action: "aprovado" }),
  }));
  assertEquals(response.status, 403);
});

Deno.test("hub-approve returns 500 when the approval insert fails", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: { cliente_id: 14, is_active: true }, error: null });
  db.queue("workflow_posts", "select", { data: { id: 99, workflow_id: 7, status: "enviado_cliente" }, error: null });
  db.queue("workflows", "select", { data: { cliente_id: 14 }, error: null });
  db.queue("post_approvals", "insert", { data: null, error: { message: "constraint violation" } });

  const handler = createHubApproveHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });
  const response = await handler(new Request("https://example.test/hub-approve", {
    method: "POST",
    body: JSON.stringify({ token: "hub-123", post_id: 99, action: "aprovado" }),
  }));
  assertEquals(response.status, 500);
});

Deno.test("hub-posts rejects non-GET methods with 405", async () => {
  const handler = createHubPostsHandler({
    buildCorsHeaders,
    createDb: () => createSupabaseQueryMock() as never,
    now,
    signGetUrl: async () => "https://signed.example",
  });
  const response = await handler(new Request("https://example.test/hub-posts?token=hub-123", { method: "POST" }));
  assertEquals(response.status, 405);
});

Deno.test("hub-posts returns 404 when the hub token is invalid", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: null, error: null });

  const handler = createHubPostsHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
    signGetUrl: async () => "https://signed.example",
  });
  const response = await handler(new Request("https://example.test/hub-posts?token=expired"));
  assertEquals(response.status, 404);
});

Deno.test("hub-posts returns empty collections when the client has no workflows", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queue("workflows", "select", { data: [], error: null });
  db.queue("instagram_accounts", "select", { data: null, error: null });

  const handler = createHubPostsHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
    signGetUrl: async () => "https://signed.example",
  });
  const response = await handler(new Request("https://example.test/hub-posts?token=hub-123"));
  const body = await readJson(response);
  assertEquals(response.status, 200);
  assertEquals(body.posts, []);
  assertEquals(body.postApprovals, []);
  assertEquals(body.instagramProfile, null);
});

Deno.test("hub-posts includes instagramProfile when the client has a linked account", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queue("workflows", "select", { data: [], error: null });
  db.queue("instagram_accounts", "select", {
    data: { username: "studio_marca", profile_picture_url: "https://cdn.ig/pic.jpg" },
    error: null,
  });

  const handler = createHubPostsHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
    signGetUrl: async () => "https://signed.example",
  });
  const response = await handler(new Request("https://example.test/hub-posts?token=hub-123"));
  const body = await readJson(response);

  assertEquals(response.status, 200);
  assertEquals(body.instagramProfile.username, "studio_marca");
  assertEquals(body.instagramProfile.profilePictureUrl, "https://cdn.ig/pic.jpg");
  assertEquals(body.propertyValues, []);
  assertEquals(body.workflowSelectOptions, []);
});

Deno.test("hub-posts returns instagramProfile as null when no account is linked", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queue("workflows", "select", { data: [], error: null });
  db.queue("instagram_accounts", "select", {
    data: null,
    error: null,
  });

  const handler = createHubPostsHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
    signGetUrl: async () => "https://signed.example",
  });
  const response = await handler(new Request("https://example.test/hub-posts?token=hub-123"));
  const body = await readJson(response);

  assertEquals(response.status, 200);
  assertEquals(body.instagramProfile, null);
});

Deno.test("hub-brand rejects missing tokens with 400", async () => {
  const handler = createHubBrandHandler({
    buildCorsHeaders,
    createDb: () => createSupabaseQueryMock() as never,
    now,
  });
  const response = await handler(new Request("https://example.test/hub-brand"));
  assertEquals(response.status, 400);
});

Deno.test("hub-brand returns 404 for an invalid hub token", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: null, error: null });

  const handler = createHubBrandHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });
  const response = await handler(new Request("https://example.test/hub-brand?token=expired"));
  assertEquals(response.status, 404);
});

Deno.test("hub-pages rejects non-GET methods with 405", async () => {
  const handler = createHubPagesHandler({
    buildCorsHeaders,
    createDb: () => createSupabaseQueryMock() as never,
    now,
  });
  const response = await handler(new Request("https://example.test/hub-pages?token=hub-123", { method: "POST" }));
  assertEquals(response.status, 405);
});

Deno.test("hub-pages rejects missing tokens with 400", async () => {
  const handler = createHubPagesHandler({
    buildCorsHeaders,
    createDb: () => createSupabaseQueryMock() as never,
    now,
  });
  const response = await handler(new Request("https://example.test/hub-pages"));
  assertEquals(response.status, 400);
});

Deno.test("hub-pages returns 404 when the client does not belong to the workspace", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queue("clientes", "select", { data: null, error: null });

  const handler = createHubPagesHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });
  const response = await handler(new Request("https://example.test/hub-pages?token=hub-123"));
  assertEquals(response.status, 404);
});

Deno.test("hub-briefing rejects malformed JSON on POST with 400", async () => {
  const handler = createHubBriefingHandler({
    buildCorsHeaders,
    createDb: () => createSupabaseQueryMock() as never,
    now,
  });
  const response = await handler(new Request("https://example.test/hub-briefing", {
    method: "POST",
    body: "{not-json",
  }));
  assertEquals(response.status, 400);
});

Deno.test("hub-briefing rejects unknown HTTP methods with 405", async () => {
  const handler = createHubBriefingHandler({
    buildCorsHeaders,
    createDb: () => createSupabaseQueryMock() as never,
    now,
  });
  const response = await handler(new Request("https://example.test/hub-briefing", { method: "DELETE" }));
  assertEquals(response.status, 405);
});

Deno.test("hub-briefing returns 404 when the target question is missing", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, is_active: true, clientes: { conta_id: "conta-1" } },
    error: null,
  });
  db.queue("hub_briefing_questions", "select", { data: null, error: null });

  const handler = createHubBriefingHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });
  const response = await handler(new Request("https://example.test/hub-briefing", {
    method: "POST",
    body: JSON.stringify({ token: "hub-123", question_id: "q-missing", answer: "resposta" }),
  }));
  assertEquals(response.status, 404);
});

Deno.test("hub-ideias rejects missing tokens with 400", async () => {
  const handler = createHubIdeiasHandler({
    buildCorsHeaders,
    createDb: () => createSupabaseQueryMock() as never,
    now,
  });
  const response = await handler(new Request("https://example.test/hub-ideias", {
    method: "POST",
    body: JSON.stringify({ titulo: "x" }),
  }));
  assertEquals(response.status, 400);
});

Deno.test("hub-ideias returns 404 for expired or inactive hub tokens", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: null, error: null });

  const handler = createHubIdeiasHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });
  const response = await handler(new Request("https://example.test/hub-ideias?token=expired"));
  assertEquals(response.status, 404);
});

Deno.test("hub-ideias rejects POSTs missing titulo with 400", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, is_active: true, clientes: { conta_id: "conta-1" } },
    error: null,
  });

  const handler = createHubIdeiasHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });
  const response = await handler(new Request("https://example.test/hub-ideias", {
    method: "POST",
    body: JSON.stringify({ token: "hub-123", descricao: "só a descrição" }),
  }));
  assertEquals(response.status, 400);
});

Deno.test("hub-ideias rejects POSTs missing descricao with 400", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, is_active: true, clientes: { conta_id: "conta-1" } },
    error: null,
  });

  const handler = createHubIdeiasHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });
  const response = await handler(new Request("https://example.test/hub-ideias", {
    method: "POST",
    body: JSON.stringify({ token: "hub-123", titulo: "só o título" }),
  }));
  assertEquals(response.status, 400);
});

Deno.test("hub-ideias returns 500 when the insert reports an error", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, is_active: true, clientes: { conta_id: "conta-1" } },
    error: null,
  });
  db.queue("ideias", "insert", { data: null, error: { message: "db offline" } });

  const handler = createHubIdeiasHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });
  const response = await handler(new Request("https://example.test/hub-ideias", {
    method: "POST",
    body: JSON.stringify({ token: "hub-123", titulo: "Ideia", descricao: "descrição" }),
  }));
  assertEquals(response.status, 500);
});

Deno.test("hub-ideias returns 404 when PATCH targets a non-existent idea", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, is_active: true, clientes: { conta_id: "conta-1" } },
    error: null,
  });
  db.queue("ideias", "select", { data: null, error: null });

  const handler = createHubIdeiasHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });
  const response = await handler(new Request("https://example.test/hub-ideias/34a7c1ef-9a2e-4707-a833-cb8f871a0df8?token=hub-123", {
    method: "PATCH",
    body: JSON.stringify({ titulo: "Novo" }),
  }));
  assertEquals(response.status, 404);
});

Deno.test("hub-ideias returns 404 for unsupported routes", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, is_active: true, clientes: { conta_id: "conta-1" } },
    error: null,
  });

  const handler = createHubIdeiasHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });
  const response = await handler(new Request("https://example.test/hub-ideias?token=hub-123", { method: "PUT" }));
  assertEquals(response.status, 404);
});

Deno.test("hub-instagram-feed returns profile and recent posts for a valid token", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queue("instagram_accounts", "select", {
    data: {
      id: "ig-acc-1",
      username: "studio_marca",
      profile_picture_url: "https://cdn.ig/pic.jpg",
      follower_count: 15300,
      following_count: 892,
      media_count: 42,
    },
    error: null,
  });
  db.queue("instagram_posts", "select", {
    data: [
      {
        instagram_post_id: "ig-post-1",
        thumbnail_url: "https://cdn.ig/thumb1.jpg",
        media_type: "IMAGE",
        permalink: "https://instagram.com/p/abc",
        posted_at: "2026-04-20T10:00:00.000Z",
        impressions: 5292,
      },
      {
        instagram_post_id: "ig-post-2",
        thumbnail_url: null,
        media_type: "CAROUSEL_ALBUM",
        permalink: "https://instagram.com/p/def",
        posted_at: "2026-04-18T14:00:00.000Z",
        impressions: 4555,
      },
    ],
    error: null,
  });

  const handler = createHubInstagramFeedHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });

  const response = await handler(new Request("https://example.test/hub-instagram-feed?token=hub-123"));
  const body = await readJson(response);

  assertEquals(response.status, 200);
  assertEquals(body.profile.username, "studio_marca");
  assertEquals(body.profile.followerCount, 15300);
  assertEquals(body.recentPosts.length, 2);
  assertEquals(body.recentPosts[0].id, "ig-post-1");
  assertEquals(body.recentPosts[1].thumbnailUrl, null);
});

Deno.test("hub-instagram-feed returns 404 when no Instagram account is linked", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", {
    data: { cliente_id: 14, conta_id: "conta-1", is_active: true },
    error: null,
  });
  db.queue("instagram_accounts", "select", {
    data: null,
    error: null,
  });

  const handler = createHubInstagramFeedHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });

  const response = await handler(new Request("https://example.test/hub-instagram-feed?token=hub-123"));
  assertEquals(response.status, 404);
});

Deno.test("hub-instagram-feed rejects missing tokens with 400", async () => {
  const handler = createHubInstagramFeedHandler({
    buildCorsHeaders,
    createDb: () => createSupabaseQueryMock() as never,
    now,
  });

  const response = await handler(new Request("https://example.test/hub-instagram-feed"));
  assertEquals(response.status, 400);
});

Deno.test("hub-instagram-feed returns 404 for invalid tokens", async () => {
  const db = createSupabaseQueryMock();
  db.queue("client_hub_tokens", "select", { data: null, error: null });

  const handler = createHubInstagramFeedHandler({
    buildCorsHeaders,
    createDb: () => db as never,
    now,
  });

  const response = await handler(new Request("https://example.test/hub-instagram-feed?token=expired"));
  assertEquals(response.status, 404);
});
