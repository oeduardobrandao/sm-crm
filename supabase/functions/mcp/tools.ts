// deno-lint-ignore-file no-explicit-any
import { z } from "npm:zod@3";
import { insertAuditLog } from "../_shared/audit.ts";
import { McpScopeError, requireScope } from "../_shared/mcp-token.ts";
import {
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
  listWorkflows,
} from "./queries.ts";

function jsonResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

function errorResult(e: unknown) {
  const message = e instanceof McpScopeError
    ? `Permission denied: missing scope '${e.scope}'.`
    : "Internal error.";
  // Never leak raw error details to the client (logged internally instead).
  if (!(e instanceof McpScopeError)) console.error("[mcp] tool error:", e);
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }], isError: true };
}

async function audit(deps: Deps, name: string, args: Record<string, unknown>) {
  await insertAuditLog(deps.db as any, {
    conta_id: deps.ctx.conta_id,
    actor_user_id: deps.ctx.created_by,
    action: `mcp.${name}`,
    resource_type: "mcp",
    resource_id: String((args.post_id ?? args.client_id ?? "") || ""),
    metadata: { key_id: deps.ctx.key_id, tool: name, args }, // args = ids/filters only, no payload
  });
}

/** Register one tool with scope-gating + audit. */
function register(
  server: any,
  deps: Deps,
  name: string,
  scope: string,
  description: string,
  shape: z.ZodRawShape,
  run: (args: any) => Promise<unknown>,
) {
  server.tool(name, description, shape, async (args: any) => {
    try {
      requireScope(deps.ctx, scope);
      const data = await run(args ?? {});
      await audit(deps, name, args ?? {});
      return jsonResult(data);
    } catch (e) {
      return errorResult(e);
    }
  });
}

const STATUS_CLIENTE = z.enum(["ativo", "pausado", "encerrado"]);
const FORMATO = z.enum(["feed", "reels", "stories", "carrossel"]);
const METRIC = z.enum(["reach", "saved", "shares", "comments", "likes"]);

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
    "Lista posts (pipeline) com modo, anotação, formato e métricas publicadas quando disponíveis.",
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
    "Detalhe completo de um post, com mídia assinada (1h) e métricas quando publicado.",
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
}
