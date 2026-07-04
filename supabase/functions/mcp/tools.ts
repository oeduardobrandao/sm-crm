// deno-lint-ignore-file no-explicit-any
import { z } from "npm:zod@3";
import { insertAuditLog } from "../_shared/audit.ts";
import { McpInputError, McpScopeError, requireScope } from "../_shared/mcp-token.ts";
import {
  createPost,
  createWorkflow,
  createWorkflowTemplate,
  setPostProperty,
  updatePost,
  Deps,
  getBrandProfile,
  getClient,
  getPerformanceBaseline,
  getPost,
  listClients,
  listIdeas,
  listPages,
  listPostFeedback,
  listPosts,
  listWorkflowTemplates,
  listWorkflows,
} from "./queries.ts";
import { createDesign, getDesign, McpStructuredError, updateDesign } from "./design.ts";
import { generateImage } from "./imageGen.ts";
import { getDesignCapabilities, previewDesign } from "./capabilities.ts";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";

function jsonResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

/** §9 registrar note: jsonResult wraps everything as a text block, so preview_design needs
 * this sibling returning a raw MCP IMAGE content block (Claude is multimodal — seeing the
 * render collapses blind iterations). */
function imageResult(bytes: Uint8Array, mimeType: string) {
  return { content: [{ type: "image" as const, data: encodeBase64(bytes), mimeType }] };
}

function errorResult(e: unknown) {
  // Structured errors (design §2.4 self-correction contract) return their JSON payload
  // verbatim — issues[]/current_rev/etc. are the agent's retry instructions.
  if (e instanceof McpStructuredError) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify(e.payload) }],
      isError: true,
    };
  }
  const message = e instanceof McpScopeError
    ? `Permission denied: missing scope '${e.scope}'.`
    : e instanceof McpInputError
    ? e.message
    : "Internal error.";
  // Never leak raw error details (logged internally instead).
  if (!(e instanceof McpScopeError) && !(e instanceof McpInputError)) {
    console.error("[mcp] tool error:", e);
  }
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }], isError: true };
}

async function audit(deps: Deps, name: string, args: Record<string, unknown>) {
  await insertAuditLog(deps.db as any, {
    conta_id: deps.ctx.conta_id,
    actor_user_id: deps.ctx.created_by,
    action: `mcp.${name}`,
    resource_type: "mcp",
    resource_id: String((args.post_id ?? args.client_id ?? args.workflow_id ?? "") || ""),
    metadata: { key_id: deps.ctx.key_id, tool: name, args }, // args = ids/filters only, no payload
  });
}

/** Register one tool with scope-gating + audit. `auditArgs` also receives the RESULT (design
 * §9 — write audits carry result metadata like rev/file_id without ever carrying payloads);
 * existing single-param callbacks are unaffected. */
function register(
  server: any,
  deps: Deps,
  name: string,
  scope: string,
  description: string,
  shape: z.ZodRawShape,
  run: (args: any) => Promise<unknown>,
  auditArgs?: (args: any, result: any) => Record<string, unknown>,
  wrapResult: (data: any) => unknown = jsonResult,
) {
  server.tool(name, description, shape, async (args: any) => {
    try {
      requireScope(deps.ctx, scope);
      const data = await run(args ?? {});
      await audit(deps, name, (auditArgs ?? ((a: any) => a))(args ?? {}, data));
      return wrapResult(data);
    } catch (e) {
      return errorResult(e);
    }
  });
}

const STATUS_CLIENTE = z.enum(["ativo", "pausado", "encerrado"]);
const FORMATO = z.enum(["feed", "reels", "stories", "carrossel"]);
const METRIC = z.enum([
  "reach", "saved", "shares", "comments", "likes",
  "share_rate", "like_rate", "save_rate", "comment_rate", "ig_score",
]);
const PROPERTY_TYPE = z.enum([
  "text", "url", "email", "phone", "number", "date", "checkbox", "select", "status", "multiselect",
]);

export function registerTools(server: any, deps: Deps): void {
  register(server, deps, "list_clients", "clientes:read",
    "Lista os clientes do workspace (campos não sensíveis).",
    { status: STATUS_CLIENTE.optional() },
    (a) => listClients(deps, a));

  register(server, deps, "get_client", "clientes:read",
    "Retorna um cliente (campos não sensíveis).",
    { client_id: z.number().int() },
    (a) => getClient(deps, a));

  register(server, deps, "get_brand_profile", "clientes:read",
    "Perfil de marca do cliente: especialidade, cores/fontes (hub_brand) e respostas de briefing.",
    { client_id: z.number().int() },
    (a) => getBrandProfile(deps, a));

  register(server, deps, "list_posts", "posts:read",
    "Lista posts (pipeline) com modo, anotação, formato, métricas, taxas (share_rate/like_rate/save_rate/comment_rate) e ig_score quando disponíveis. Ordenação por métricas brutas ou taxas; ig_score exige client_id.",
    {
      client_id: z.number().int().optional(),
      formato: FORMATO.optional(),
      modo: z.string().optional(),
      published_since: z.string().optional(),
      sort_by_metric: METRIC.optional(),
      limit: z.number().int().optional(),
    },
    (a) => listPosts(deps, a));

  register(server, deps, "get_post", "posts:read",
    "Detalhe completo de um post, com mídia assinada (1h), métricas, taxas (share_rate/like_rate/save_rate/comment_rate), ig_score e tiers de desempenho (top_quartile/above_median/below_median/bottom_quartile) quando publicado.",
    { post_id: z.number().int() },
    (a) => getPost(deps, a));

  register(server, deps, "get_performance_baseline", "posts:read",
    "Quartis de desempenho (por métrica e por formato) para o cliente, a partir do histórico do Instagram.",
    { client_id: z.number().int() },
    (a) => getPerformanceBaseline(deps, a));

  register(server, deps, "list_workflows", "workflows:read",
    "Lista os workflows (fluxos de produção) do workspace.",
    { client_id: z.number().int().optional(), status: z.enum(["ativo", "concluido", "arquivado"]).optional() },
    (a) => listWorkflows(deps, a));

  register(server, deps, "list_ideas", "ideias:read",
    "Lista o backlog de pautas (ideias) do workspace.",
    { client_id: z.number().int().optional(), status: z.enum(["nova", "em_analise", "aprovada", "descartada"]).optional() },
    (a) => listIdeas(deps, a));

  register(server, deps, "list_post_feedback", "posts:read",
    "Lista o feedback dos clientes nos posts (aprovações, correções, mensagens) com a linha do tempo de status.",
    {
      post_id: z.number().int().optional(),
      client_id: z.number().int().optional(),
      action: z.enum(["aprovado", "correcao", "mensagem"]).optional(),
      since: z.string().optional(),
      limit: z.number().int().optional(),
    },
    (a) => listPostFeedback(deps, a));

  register(server, deps, "list_pages", "clientes:read",
    "Lista as páginas de conteúdo (estratégia, materiais) dos clientes do workspace.",
    { client_id: z.number().int().optional() },
    (a) => listPages(deps, a));

  register(server, deps, "list_workflow_templates", "workflows:read",
    "Lista os modelos de fluxo (workflow templates) do workspace: etapas e o esquema de propriedades personalizadas de cada um.",
    {},
    () => listWorkflowTemplates(deps, {}));

  register(server, deps, "create_workflow", "posts:write",
    "Cria um fluxo de produção (necessário para criar posts). Opcionalmente instancia um modelo (template) com suas etapas. Retorna o fluxo criado.",
    {
      client_id: z.number().int().positive(),
      titulo: z.string().trim().min(1).max(200),
      template_id: z.number().int().positive().optional(),
    },
    (a) => createWorkflow(deps, a),
    (a) => ({ client_id: a.client_id, titulo: a.titulo, template_id: a.template_id }));

  register(server, deps, "create_post", "posts:write",
    "Cria um post em rascunho dentro de um fluxo ativo. O agente nunca publica nem envia ao cliente.",
    {
      workflow_id: z.number().int().positive(),
      titulo: z.string().trim().min(1).max(200),
      tipo: z.enum(["feed", "reels", "stories", "carrossel"]).optional(),
      body: z.string().max(10000).optional(),
      ig_caption: z.string().max(2200).optional(),
    },
    (a) => createPost(deps, a),
    (a) => ({
      workflow_id: a.workflow_id, tipo: a.tipo, titulo: a.titulo,
      has_body: !!a.body, body_len: a.body?.length ?? 0,
      has_ig_caption: !!a.ig_caption, ig_caption_len: a.ig_caption?.length ?? 0,
    }));

  register(server, deps, "update_post", "posts:write",
    "Edita um post existente (título, formato, corpo, legenda) e pode avançar o status apenas para rascunho ou revisão interna. O agente nunca envia ao cliente nem publica.",
    {
      post_id: z.number().int().positive(),
      titulo: z.string().trim().min(1).max(200).optional(),
      tipo: z.enum(["feed", "reels", "stories", "carrossel"]).optional(),
      body: z.string().max(10000).optional(),
      ig_caption: z.string().max(2200).optional(),
      status: z.enum(["rascunho", "revisao_interna"]).optional(),
    },
    (a) => updatePost(deps, a),
    (a) => ({
      post_id: a.post_id,
      has_titulo: Object.hasOwn(a, "titulo"),
      tipo: a.tipo,
      status: a.status,
      has_body: Object.hasOwn(a, "body"),
      body_len: a.body?.length ?? 0,
      has_ig_caption: Object.hasOwn(a, "ig_caption"),
      ig_caption_len: a.ig_caption?.length ?? 0,
    }));

  register(server, deps, "set_post_property", "posts:write",
    "Define o valor de uma propriedade personalizada de um post (ex.: modo, anotação). A propriedade deve pertencer ao modelo do fluxo do post; status, mídia e publicação não são afetados.",
    {
      post_id: z.number().int().positive(),
      property_id: z.number().int().positive(),
      value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]),
    },
    (a) => setPostProperty(deps, a),
    (a) => {
      const v = a.value;
      return {
        post_id: a.post_id,
        property_id: a.property_id,
        value_kind: v === null ? "null" : Array.isArray(v) ? "array" : typeof v,
        value_len: typeof v === "string" ? v.length : undefined,
        value_count: Array.isArray(v) ? v.length : undefined,
      };
    });

  register(server, deps, "create_workflow_template", "templates:write",
    "Cria um modelo de fluxo (template): etapas e, opcionalmente, o esquema de propriedades personalizadas. Retorna o modelo criado.",
    {
      nome: z.string().trim().min(1).max(120),
      modo_prazo: z.enum(["padrao", "data_fixa", "data_entrega"]).optional(),
      etapas: z.array(z.object({
        nome: z.string().trim().min(1).max(120),
        prazo_dias: z.number().int().min(0).optional(),
        tipo_prazo: z.enum(["uteis", "corridos"]).optional(),
        tipo: z.enum(["padrao", "aprovacao_cliente"]).optional(),
      })).min(1).max(50),
      properties: z.array(z.object({
        name: z.string().trim().min(1).max(120),
        type: PROPERTY_TYPE,
        portal_visible: z.boolean().optional(),
        options: z.array(z.string().trim().min(1).max(120)).min(1).max(50).optional(),
      })).max(50).optional(),
    },
    (a) => createWorkflowTemplate(deps, a),
    (a) => ({ nome: a.nome, etapa_count: a.etapas?.length ?? 0, property_count: a.properties?.length ?? 0 }));

  // ── Estúdio design tools (design §9) ─────────────────────────────────────────────
  // The design payload is zod3 `record(unknown)` here; the shared zod4 pipeline (§2.4)
  // validates inside the handler and returns aggregated issues[] on failure. Audit metadata is
  // doc STATS only — never doc contents (client copy lives in text layers).

  register(server, deps, "get_design", "posts:read",
    "Lê o design (arte do Estúdio) de um post: documento normalizado, rev e estado da renderização com URLs de preview. Post sem design retorna design:null com uma dica — não é erro.",
    { post_id: z.number().int().positive() },
    (a) => getDesign(deps, a));

  register(server, deps, "create_design", "designs:write",
    "Cria o design de um post (documento completo). Valide o formato contra o tipo do post (get_design_capabilities lista formatos, fontes e limites). Se o post já tiver design, use update_design. A renderização é disparada automaticamente.",
    {
      post_id: z.number().int().positive(),
      design: z.record(z.unknown()),
    },
    (a) => createDesign(deps, a),
    (a, r) => ({ post_id: a.post_id, ...designAudit(r) }));

  register(server, deps, "update_design", "designs:write",
    "Substitui o design de um post pelo documento completo enviado (sem patches parciais). Passe expected_rev (de get_design) para detectar edições concorrentes; omitido, a última escrita vence. A renderização é disparada automaticamente.",
    {
      post_id: z.number().int().positive(),
      design: z.record(z.unknown()),
      expected_rev: z.number().int().positive().optional(),
    },
    (a) => updateDesign(deps, a),
    (a, r) => ({ post_id: a.post_id, expected_rev: a.expected_rev, ...designAudit(r) }));

  register(server, deps, "generate_image", "images:generate",
    "Gera uma imagem com IA (custo por imagem, quota mensal do plano). placement 'background' gera em 2K para fundos full-bleed; 'element' em 1K. Com client_id, cores e segmento da marca entram como contexto; use_brand_logo anexa o logo como referência. A imagem vira um arquivo do workspace (file_id) para usar em designs — nunca é anexada a posts. Passe idempotency_key para retries seguros.",
    {
      prompt: z.string().trim().min(1).max(2000),
      aspect_ratio: z.enum(["1:1", "4:5", "9:16", "16:9"]),
      placement: z.enum(["background", "element"]).optional(),
      quality: z.enum(["1K", "2K"]).optional(),
      client_id: z.number().int().positive().optional(),
      post_id: z.number().int().positive().optional(),
      reference_file_ids: z.array(z.number().int().positive()).max(4).optional(),
      use_brand_logo: z.boolean().optional(),
      idempotency_key: z.string().trim().min(8).max(80).optional(),
    },
    (a) => generateImage(deps, a),
    // Spend audit (§8): model/AR/cost/file_id — NEVER the prompt (ledger-only, RLS-scoped).
    (a, r) => ({
      client_id: a.client_id,
      post_id: a.post_id,
      aspect_ratio: a.aspect_ratio,
      placement: a.placement,
      quality: a.quality,
      prompt_len: a.prompt?.length ?? 0,
      reference_count: (a.reference_file_ids?.length ?? 0) + (a.use_brand_logo ? 1 : 0),
      file_id: r?.file_id,
      model: r?.model,
      cost_usd_estimate: r?.cost_usd_estimate,
      replayed: r?.replayed ?? false,
    }));

  register(server, deps, "preview_design", "posts:read",
    "Renderiza UMA página do design de um post e retorna a imagem (JPEG) — use para VER o resultado antes/depois de editar. page_id escolhe a página (padrão: a primeira); width padrão 512 (128–1080; o layout roda sempre no tamanho nativo do canvas, o width só escala a saída). Custa CPU: uma página por chamada.",
    {
      post_id: z.number().int().positive(),
      page_id: z.string().trim().min(1).max(40).optional(),
      width: z.number().int().min(128).max(1080).optional(),
    },
    (a) => previewDesign(deps, a),
    (a, r) => ({ post_id: a.post_id, page_id: r?.page_id, width: r?.width, height: r?.height }),
    (r: any) => imageResult(r.jpegBytes, "image/jpeg"));

  register(server, deps, "get_design_capabilities", "posts:read",
    "Descobre o que o Estúdio aceita ANTES de criar designs: formatos e canvases por tipo de post, catálogo completo de fontes (keys/pesos/estilos/grupos), limites do documento, features do plano, quota de geração de imagens e — com client_id — o kit de marca do cliente (cores, logo_file_id quando já materializado, fontes resolvidas para o catálogo). Leitura pura: nunca materializa o logo.",
    { client_id: z.number().int().positive().optional() },
    (a) => getDesignCapabilities(deps, a));
}

/** Audit stats from a design write RESULT (never args — the doc itself must not be audited). */
function designAudit(result: any): Record<string, unknown> {
  const doc = result?.design;
  if (!doc || !Array.isArray(doc.pages)) return {};
  return {
    format: doc.format,
    page_count: doc.pages.length,
    layer_count: doc.pages.reduce((sum: number, p: any) => sum + (p.layers?.length ?? 0), 0),
    doc_bytes: JSON.stringify(doc).length,
    rev: result.rev,
  };
}
