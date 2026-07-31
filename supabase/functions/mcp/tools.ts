// deno-lint-ignore-file no-explicit-any
import { z } from "npm:zod@3";
import { insertAuditLog } from "../_shared/audit.ts";
import { McpInputError, McpScopeError, requireScope } from "../_shared/mcp-token.ts";
import {
  createPost,
  createTask,
  createWorkflow,
  createWorkflowTemplate,
  setPostProperty,
  updatePost,
  updateTask,
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
  listTasks,
  listWorkflowTemplates,
  listWorkflows,
} from "./queries.ts";
import { createMediaUpload, setPostMedia } from "./media.ts";

function jsonResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

function errorResult(e: unknown) {
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

/** Register one tool with scope-gating + audit. `auditArgs` also receives the RESULT, so write
 * audits can carry result metadata (ids, counts) without ever carrying payloads; existing
 * single-param callbacks are unaffected. */
function register(
  server: any,
  deps: Deps,
  name: string,
  scope: string,
  description: string,
  shape: z.ZodRawShape,
  run: (args: any) => Promise<unknown>,
  auditArgs?: (args: any, result: any) => Record<string, unknown>,
) {
  server.tool(name, description, shape, async (args: any) => {
    try {
      requireScope(deps.ctx, scope);
      const data = await run(args ?? {});
      await audit(deps, name, (auditArgs ?? ((a: any) => a))(args ?? {}, data));
      return jsonResult(data);
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
const TASK_STATUS = z.enum(["pendente", "em_andamento", "concluida"]);
const DATE_ONLY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use o formato YYYY-MM-DD");

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
    "Lista o backlog de ideias e solicitações dos clientes. Solicitações convertidas apontam a tarefa via tarefa_id.",
    {
      client_id: z.number().int().optional(),
      status: z.enum(["nova", "em_analise", "aprovada", "descartada", "convertida", "concluida"]).optional(),
      tipo: z.enum(["ideia", "solicitacao"]).optional(),
    },
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

  register(server, deps, "create_media_upload", "posts:write",
    "Gera URL(s) de upload presigned (PUT) para subir imagens JPG/PNG prontas ao workspace (cota checada antes de assinar). Depois use set_post_media com os r2_key retornados para colocá-las como mídia de um post. Máx 10 arquivos, ≤ 8MB cada.",
    { files: z.array(z.object({
        filename: z.string().trim().min(1).max(200),
        mime_type: z.enum(["image/jpeg", "image/png"]),
        size_bytes: z.number().int().positive().max(8 * 1024 * 1024),
      })).min(1).max(10) },
    (a) => createMediaUpload(deps, a),
    (a) => ({ file_count: a.files.length, total_bytes: a.files.reduce((s: number, f: any) => s + f.size_bytes, 0),
              mime_types: [...new Set(a.files.map((f: any) => f.mime_type))] }));

  register(server, deps, "set_post_media", "posts:write",
    "Define a mídia de um post (feed/carrossel) a partir de imagens já enviadas (r2_key de create_media_upload). SUBSTITUI toda a mídia atual, na ordem dada (capa = 1º item), sincroniza o tipo (feed/carrossel) e devolve o post atualizado. Rejeita posts com design (edite o design). Máx 10 itens.",
    { post_id: z.number().int().positive(),
      items: z.array(z.object({
        r2_key: z.string(), size_bytes: z.number().int().positive(),
        mime_type: z.enum(["image/jpeg", "image/png"]),
        width: z.number().int().positive().optional(), height: z.number().int().positive().optional(),
        filename: z.string().max(200).optional(),
      })).min(1).max(10) },
    (a) => setPostMedia(deps, a),
    (a) => ({ post_id: a.post_id, item_count: a.items.length,
              total_bytes: a.items.reduce((s: number, i: any) => s + i.size_bytes, 0) }));

  register(server, deps, "list_tasks", "tarefas:read",
    "Lista as tarefas da equipe (rastreador interno): status, responsável, cliente, prazo, tags e progresso de subtarefas. Ordena por prazo.",
    {
      status: TASK_STATUS.optional(),
      responsavel_id: z.number().int().optional(),
      cliente_id: z.number().int().optional(),
      limit: z.number().int().optional(),
    },
    (a) => listTasks(deps, a));

  register(server, deps, "create_task", "tarefas:write",
    "Cria uma tarefa da equipe (status inicial: pendente). Atribuir responsável notifica o membro.",
    {
      titulo: z.string().trim().min(1).max(200),
      descricao: z.string().max(10000).optional(),
      responsavel_id: z.number().int().positive().optional(),
      cliente_id: z.number().int().positive().optional(),
      data_limite: DATE_ONLY.optional(),
    },
    (a) => createTask(deps, a),
    (a, r) => ({
      task_id: (r as { id?: number })?.id,
      cliente_id: a.cliente_id,
      responsavel_id: a.responsavel_id,
      has_descricao: !!a.descricao,
      has_data_limite: !!a.data_limite,
    }));

  register(server, deps, "update_task", "tarefas:write",
    "Edita uma tarefa: título, descrição, status, responsável, prazo. Passe null em descricao/responsavel_id/data_limite para limpar o campo; campos omitidos não mudam.",
    {
      task_id: z.number().int().positive(),
      titulo: z.string().trim().min(1).max(200).optional(),
      descricao: z.string().max(10000).nullable().optional(),
      status: TASK_STATUS.optional(),
      responsavel_id: z.number().int().positive().nullable().optional(),
      data_limite: DATE_ONLY.nullable().optional(),
    },
    (a) => updateTask(deps, a),
    (a) => ({
      task_id: a.task_id,
      status: a.status,
      responsavel_id: a.responsavel_id,
      has_titulo: Object.hasOwn(a, "titulo"),
      has_descricao: Object.hasOwn(a, "descricao"),
      has_data_limite: Object.hasOwn(a, "data_limite"),
    }));
}
