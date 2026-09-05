// deno-lint-ignore-file no-explicit-any
import { z } from "npm:zod@3";
import { insertAuditLog } from "../_shared/audit.ts";
import { McpInputError, McpScopeError } from "../_shared/mcp-token.ts";
import { requireAdminScope } from "../_shared/mcp-admin-auth.ts";
import { KB_CATEGORIES } from "../_shared/admin-kb.ts";
import type { Deps } from "./deps.ts";
import {
  createBanner, createKbArticle, createPopup, getBanner, getDashboard, getKbArticle, getPopup, getWorkspace,
  listBanners, listKbArticles, listPlans, listPopups, listWorkspaces, updateBanner, updateKbArticle, updatePopup,
} from "./queries.ts";
import { uploadKbImage, uploadPopupImage } from "./images.ts";

function jsonResult(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data) }] };
}

function errorResult(e: unknown) {
  const message = e instanceof McpScopeError
    ? `Permission denied: missing scope '${e.scope}'.`
    : e instanceof McpInputError
    ? e.message
    : "Internal error.";
  if (!(e instanceof McpScopeError) && !(e instanceof McpInputError)) console.error("[mcp-admin] tool error:", e);
  return { content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }], isError: true };
}

const ID_KEYS = ["banner_id", "popup_id", "article_id", "workspace_id"];

/** Audit sem payload: ids/filtros dos args + id do resultado (create). */
function auditArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of [...ID_KEYS, "slug", "status", "category", "search", "plan_id", "limit", "offset", "filename", "mime_type", "article_slug"]) {
    if (args[k] !== undefined) out[k] = args[k];
  }
  return out;
}

async function audit(deps: Deps, name: string, args: Record<string, unknown>, result: unknown) {
  const fromArgs = ID_KEYS.map((k) => args[k]).find((v) => typeof v === "string") as string | undefined;
  const fromResult = result && typeof result === "object" ? (result as { id?: unknown }).id : undefined;
  await insertAuditLog(deps.db, {
    actor_user_id: deps.ctx.user_id,
    action: `mcp_admin.${name}`,
    resource_type: "mcp_admin",
    resource_id: fromArgs ?? (typeof fromResult === "string" ? fromResult : ""),
    metadata: { key_id: deps.ctx.key_id, tool: name, args: auditArgs(args) },
  });
}

function register(
  server: any, deps: Deps, name: string, scope: string, description: string, shape: z.ZodRawShape,
  run: (args: any) => Promise<unknown>,
) {
  server.tool(name, description, shape, async (args: any) => {
    try {
      requireAdminScope(deps.ctx, scope);
      const data = await run(args ?? {});
      await audit(deps, name, args ?? {}, data);
      return jsonResult(data);
    } catch (e) {
      return errorResult(e);
    }
  });
}

const STATUS3 = z.enum(["draft", "active", "archived"]);
const TARGET = z.enum(["all", "plan", "workspace"]);
const ISO = z.string().describe("timestamp ISO 8601 (ex.: 2026-09-10T12:00:00Z)");
const MIME = z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const BANNER_FIELDS = {
  type: z.enum(["info", "warning", "critical"]).optional(),
  content: z.string().max(500).optional().describe("Texto do banner (1 a 500 chars)"),
  link: z.string().nullable().optional().describe("https://… ou caminho /… ; null remove"),
  custom_color: z.string().nullable().optional().describe("#rrggbb; null usa a cor do tipo"),
  target_mode: TARGET.optional(),
  target_plan_ids: z.array(z.string()).nullable().optional(),
  target_workspace_ids: z.array(z.string().uuid()).nullable().optional(),
  dismissible: z.boolean().optional(),
  starts_at: ISO.nullable().optional(),
  ends_at: ISO.nullable().optional(),
  status: STATUS3.optional(),
};

const POPUP_PAGE = z.object({
  title: z.string().max(120),
  eyebrow: z.string().max(60).nullable().optional(),
  body: z.string().max(2000),
  image_key: z.string().nullable().optional().describe("image_key devolvida por upload_popup_image, ou uma já persistida neste popup"),
  cta_label: z.string().max(40).nullable().optional().describe("sobrescreve o CTA do popup nesta página; precisa vir acompanhado de cta_url"),
  cta_url: z.string().nullable().optional().describe("sobrescreve o CTA do popup nesta página; precisa vir acompanhado de cta_label"),
});
const POPUP_FIELDS = {
  pages: z.array(POPUP_PAGE).min(1).max(6).optional(),
  cta_label: z.string().max(40).nullable().optional(),
  cta_url: z.string().nullable().optional(),
  cta_style: z.enum(["ink", "brand"]).optional(),
  secondary_label: z.string().max(40).nullable().optional(),
  frequency: z.enum(["once", "until_cta"]).optional(),
  require_ack: z.boolean().optional(),
  target_mode: TARGET.optional(),
  target_plan_ids: z.array(z.string()).nullable().optional(),
  target_workspace_ids: z.array(z.string().uuid()).nullable().optional(),
  starts_at: ISO.nullable().optional(),
  ends_at: ISO.nullable().optional(),
  status: STATUS3.optional(),
};

const KB_FIELDS = {
  title: z.string().max(200).optional(),
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).optional(),
  category: z.enum(KB_CATEGORIES as [string, ...string[]]).optional(),
  excerpt: z.string().max(300).nullable().optional(),
  tags: z.array(z.string().max(40)).optional(),
  status: z.enum(["draft", "published"]).optional(),
  display_order: z.number().int().min(0).optional(),
  cover_image_url: z.string().nullable().optional().describe("public_url de upload_kb_image; null remove a capa"),
  content_markdown: z.string().optional().describe(
    "Corpo em Markdown: ## e ### (títulos), **negrito**, *itálico*, ~~risco~~, `código`, [texto](https://…), listas - e 1., > citação, ``` bloco de código, ---, ![alt](https://…) em linha própria (imagem), URL do YouTube em linha própria (embed), :::callout emoji=💡 color=blue … ::: (destaque; cores brown|gray|orange|yellow|green|blue|purple|pink). Blocos <!--tiptap:…--> devolvidos por get_kb_article são trechos sem equivalente Markdown: mantenha-os intactos.",
  ),
};

export function registerTools(server: any, deps: Deps) {
  // Banners
  register(server, deps, "list_banners", "banners:read", "Lista banners globais do CRM (todos os status por padrão) com contagem de dispensas.",
    { status: STATUS3.optional() }, (a) => listBanners(deps, a));
  register(server, deps, "get_banner", "banners:read", "Detalhe de um banner global.",
    { banner_id: z.string().uuid() }, (a) => getBanner(deps, a));
  register(server, deps, "create_banner", "banners:write", "Cria um banner global (status draft por padrão). type, content e target_mode são obrigatórios.",
    { ...BANNER_FIELDS, type: z.enum(["info", "warning", "critical"]), content: z.string().max(500), target_mode: TARGET }, (a) => createBanner(deps, a));
  register(server, deps, "update_banner", "banners:write", "Edita campos de um banner. Para arquivar use status: archived.",
    { banner_id: z.string().uuid(), ...BANNER_FIELDS }, (a) => updateBanner(deps, a));

  // Popups
  register(server, deps, "list_popups", "popups:read", "Lista popups globais com contadores de interação (seen, closed, cta, ack).",
    { status: STATUS3.optional() }, (a) => listPopups(deps, a));
  register(server, deps, "get_popup", "popups:read", "Detalhe de um popup global, incluindo pages.",
    { popup_id: z.string().uuid() }, (a) => getPopup(deps, a));
  register(server, deps, "create_popup", "popups:write", "Cria um popup global (draft por padrão). pages (1 a 6) e target_mode são obrigatórios. Imagens: use upload_popup_image e passe image_key na página.",
    { ...POPUP_FIELDS, pages: z.array(POPUP_PAGE).min(1).max(6), target_mode: TARGET }, (a) => createPopup(deps, a));
  register(server, deps, "update_popup", "popups:write", "Edita um popup. pages substitui o array inteiro: repita as páginas que devem continuar (com suas image_key).",
    { popup_id: z.string().uuid(), ...POPUP_FIELDS }, (a) => updatePopup(deps, a));
  register(server, deps, "upload_popup_image", "popups:write",
    "Sobe uma imagem para usar em páginas de popup. Com source_url o servidor baixa a imagem (https, até 10 MB) e devolve image_key. Sem source_url, informe size_bytes e receba upload_url para um PUT com o binário e o Content-Type; a image_key só passa a valer depois do PUT.",
    { filename: z.string().max(120), mime_type: MIME, size_bytes: z.number().int().positive().optional(), source_url: z.string().url().optional() },
    (a) => uploadPopupImage(deps, a));

  // Artigos
  register(server, deps, "list_kb_articles", "kb:read", "Lista artigos da central de ajuda (sem o corpo). Categorias: " + KB_CATEGORIES.join(", ") + ".",
    { status: z.enum(["draft", "published"]).optional(), category: z.string().optional() }, (a) => listKbArticles(deps, a));
  register(server, deps, "get_kb_article", "kb:read", "Um artigo com o corpo em content_markdown. opaque_blocks conta trechos <!--tiptap:…--> que devem ser preservados ao editar. article_id prevalece sobre slug.",
    { article_id: z.string().uuid().optional(), slug: z.string().optional() }, (a) => getKbArticle(deps, a));
  register(server, deps, "create_kb_article", "kb:write", "Cria um artigo (draft por padrão). title, slug, category e content_markdown são obrigatórios. Para imagens, use upload_kb_image e referencie public_url no Markdown ou em cover_image_url.",
    { ...KB_FIELDS, title: z.string().max(200), slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/), category: z.enum(KB_CATEGORIES as [string, ...string[]]), content_markdown: z.string() },
    (a) => createKbArticle(deps, a));
  register(server, deps, "update_kb_article", "kb:write", "Edita um artigo. content_markdown, se enviado, substitui o corpo inteiro (leia antes com get_kb_article). Para publicar use status: published.",
    { article_id: z.string().uuid(), ...KB_FIELDS }, (a) => updateKbArticle(deps, a));
  register(server, deps, "upload_kb_image", "kb:write",
    "Sobe uma imagem pública para artigos. Com source_url o servidor baixa (https, até 10 MB) e devolve public_url + dimensões. Sem source_url devolve upload_url para um PUT com o binário e o Content-Type. Use public_url em ![alt](public_url) ou em cover_image_url.",
    { filename: z.string().max(120), mime_type: MIME, source_url: z.string().url().optional(), article_slug: z.string().optional().describe("pasta no bucket; default uploads") },
    (a) => uploadKbImage(deps, a));

  // Plataforma
  register(server, deps, "list_workspaces", "platform:read", "Lista workspaces da plataforma com plano, dono (nome/e-mail), contagens e última atividade. limit até 100.",
    { search: z.string().optional(), plan_id: z.string().optional(), offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(100).optional() },
    (a) => listWorkspaces(deps, a));
  register(server, deps, "get_workspace", "platform:read", "Detalhe de um workspace: membros, plano resolvido, overrides, assinatura e uso.",
    { workspace_id: z.string().uuid() }, (a) => getWorkspace(deps, a));
  register(server, deps, "list_plans", "platform:read", "Planos da plataforma com limites, features e quantidade de workspaces.", {}, () => listPlans(deps));
  register(server, deps, "get_dashboard", "platform:read", "Agregados do dashboard do Admin: totais, MRR e trials.", {}, () => getDashboard(deps));
}
