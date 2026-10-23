// deno-lint-ignore-file no-explicit-any
import { z } from "npm:zod@3";
import { insertAuditLog } from "../_shared/audit.ts";
import { McpInputError, McpScopeError } from "../_shared/mcp-token.ts";
import { requireAdminScope } from "../_shared/mcp-admin-auth.ts";
import { KB_CATEGORIES } from "../_shared/admin-kb.ts";
import { MAX_TRIGGER_DAYS, POPUP_TRIGGERS } from "../_shared/admin-popups.ts";
import type { Deps } from "./deps.ts";
import {
  createBanner, createKbArticle, createPopup, getBanner, getDashboard, getKbArticle, getPopup, getWorkspace,
  listBanners, listKbArticles, listPlans, listPopups, listWorkspaces, updateBanner, updateKbArticle, updatePopup,
} from "./queries.ts";
import { uploadBlogImage, uploadKbImage, uploadPopupImage } from "./images.ts";
import { createBlogDraft, getBlogPost, listBlogPosts, updateBlogDraft } from "./blog.ts";
import { BLOG_CATEGORIES, BLOG_FEATURE_SLUGS, BLOG_LIMITS, BLOG_STATUSES } from "../_shared/blog-rules.ts";
import { BLOG_DRAFT_LIMITS } from "../_shared/blog-validate.ts";

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

const ID_KEYS = ["banner_id", "popup_id", "article_id", "workspace_id", "post_id"];

/** Audit sem payload: ids/filtros dos args + id do resultado (create). */
function auditArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of [...ID_KEYS, "slug", "status", "category", "search", "plan_id", "limit", "offset", "filename", "mime_type", "article_slug", "since_days", "feature_slug"]) {
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

const POPUP_TRIGGER = z.enum(POPUP_TRIGGERS);

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
  frequency: z.enum(["once", "until_cta", "daily"]).optional()
    .describe("once = some após fechar; until_cta = volta toda sessão até o CTA; daily = no máximo uma vez por dia enquanto elegível"),
  trigger: POPUP_TRIGGER.nullable().optional()
    .describe("Gatilho por situação de cobrança: só o dono do workspace vê, e só enquanto a condição valer. payment_pending = assinatura em past_due; trial_ending = teste terminando em trigger_days dias; plan_downgraded = assinatura unpaid (plano voltou ao padrão). null remove"),
  trigger_days: z.number().int().min(1).max(MAX_TRIGGER_DAYS).nullable().optional()
    .describe("Dias antes do fim do teste. Obrigatório com trial_ending, nulo nos demais"),
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

// Shapes soltos de propósito: o SDK valida o shape ANTES do callback e responde com o erro
// genérico do zod. Os limites ficam em validateBlogDraft, que devolve uma linha por campo.
const BLOG_IMAGE = z.object({
  key: z.string().describe("referenciada no corpo como ![alt](img:<key>); 1 a 40 caracteres a-z, 0-9 e hífen"),
  url: z.string().describe("url devolvida por upload_blog_image"),
  alt: z.string().describe("1 a 200 caracteres"),
  credit: z.string().describe("autor / fonte, 1 a 200 caracteres, obrigatório"),
  license: z.string().describe("licença de uso, 1 a 120 caracteres, obrigatória"),
  source_url: z.string().describe("página http(s) de onde a imagem veio"),
}).passthrough();
const BLOG_COVER = z.object({
  url: z.string(), alt: z.string(), credit: z.string(), license: z.string(), source_url: z.string(),
}).passthrough();
const BLOG_SOURCE = z.object({
  title: z.string().describe("1 a 200 caracteres"),
  publisher: z.string().describe("1 a 120 caracteres"),
  url: z.string().describe("http(s)"),
  published_at: z.string().optional().describe("AAAA-MM-DD"),
}).passthrough();
const [TITLE_MIN, TITLE_MAX] = BLOG_LIMITS.title;
const [H1_MIN, H1_MAX] = BLOG_LIMITS.h1;
const [DESC_MIN, DESC_MAX] = BLOG_LIMITS.description;
const BLOG_FIELDS = {
  slug: z.string().describe(`único, letras minúsculas sem acento, números e hífens, ${BLOG_DRAFT_LIMITS.slug[0]} a ${BLOG_DRAFT_LIMITS.slug[1]} caracteres; não pode repetir post do banco nem file_posts`),
  category: z.string().describe(`uma de: ${BLOG_CATEGORIES.join(", ")}`),
  title: z.string().describe(`título SEO, ${TITLE_MIN} a ${TITLE_MAX} caracteres`),
  h1: z.string().describe(`${H1_MIN} a ${H1_MAX} caracteres`),
  description: z.string().describe(`meta description, ${DESC_MIN} a ${DESC_MAX} caracteres`),
  lede: z.string().describe(`linha fina abaixo do H1, ${BLOG_DRAFT_LIMITS.lede[0]} a ${BLOG_DRAFT_LIMITS.lede[1]} caracteres`),
  body_md: z.string().describe(
    "Corpo em Markdown, até 50000 caracteres. Sem HTML. Links só http(s), /caminho ou #âncora. Imagens só ![alt](img:<key>) com key de images. " +
      "Infográfico: bloco ```infografico com JSON (tipo barras, numeros ou etapas; fonte = índice em sources). Não escreva a seção Fontes: ela vem de sources.",
  ),
  cover_image: BLOG_COVER.nullable().optional().describe("capa {url, alt, credit, license, source_url}; url de upload_blog_image; null = sem imagem"),
  images: z.array(BLOG_IMAGE).optional().describe(`imagens do corpo, até ${BLOG_DRAFT_LIMITS.images[1]}, cada uma com credit e license`),
  sources: z.array(BLOG_SOURCE).describe(`fontes do post, de ${BLOG_DRAFT_LIMITS.sources[0]} a ${BLOG_DRAFT_LIMITS.sources[1]}`),
  feature_slug: z.string().nullable().optional().describe(`só no post semanal de funcionalidade: ${BLOG_FEATURE_SLUGS.join(", ")}`),
  topic_reason: z.string().describe(`por que este tema (mostrado no Admin), ${BLOG_DRAFT_LIMITS.topic_reason[0]} a ${BLOG_DRAFT_LIMITS.topic_reason[1]} caracteres`),
};
const BLOG_FIELDS_OPTIONAL = Object.fromEntries(
  Object.entries(BLOG_FIELDS).map(([k, v]) => [k, (v as z.ZodTypeAny).optional()]),
) as z.ZodRawShape;

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
    "Sobe uma imagem para usar em páginas de popup. Com source_url o servidor baixa a imagem (https, até 10 MB) e devolve image_key. Sem source_url, informe size_bytes e receba upload_url para um PUT com o binário e o Content-Type; o corpo do PUT precisa ter exatamente size_bytes bytes (outro tamanho dá 403 SignatureDoesNotMatch); a image_key só passa a valer depois do PUT.",
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

  // Blog (rotina diária). Nenhuma tool aprova, publica ou apaga: isso é só no Admin.
  register(server, deps, "list_blog_posts", "blog:read",
    "Lista posts do blog no banco (sem o corpo), mais recentes primeiro, até 200. Devolve também file_posts (posts em arquivo: slug e título, não repita) e feature_slugs (valores aceitos em feature_slug). since_days de 1 a 365.",
    { status: z.enum(BLOG_STATUSES).optional(), since_days: z.number().int().min(1).max(365).optional() },
    (a) => listBlogPosts(deps, a));
  register(server, deps, "get_blog_post", "blog:read", "Post completo do blog (corpo, imagens, fontes, checks, revision_note), para reescrever.",
    { post_id: z.string().uuid() }, (a) => getBlogPost(deps, a));
  register(server, deps, "create_blog_draft", "blog:write",
    `Cria um rascunho do blog (status rascunho, autor Equipe Mesaas). Limites: title ${TITLE_MIN} a ${TITLE_MAX} caracteres, h1 ${H1_MIN} a ${H1_MAX}, description ${DESC_MIN} a ${DESC_MAX}, lede ${BLOG_DRAFT_LIMITS.lede[0]} a ${BLOG_DRAFT_LIMITS.lede[1]}, ao menos 1 fonte, toda imagem com credit e license, imagens só do upload_blog_image. ` +
      "Erro de validação volta com uma linha por campo e o limite; corrija e tente de novo. Devolve id e os checks automáticos (links, licenças, capa, travessão, títulos parecidos), que não bloqueiam o rascunho.",
    BLOG_FIELDS, (a) => createBlogDraft(deps, a));
  register(server, deps, "update_blog_draft", "blog:write",
    "Edita um rascunho (status rascunho ou ajuste_solicitado). Campos enviados substituem os atuais; images e sources substituem a lista inteira. Mesmos limites de create_blog_draft, checados no post resultante. " +
      "Depois de uma nota (ajuste_solicitado) o post volta para rascunho marcado como reescrito. Devolve id, status, revision e checks.",
    { post_id: z.string().uuid(), ...BLOG_FIELDS_OPTIONAL }, (a) => updateBlogDraft(deps, a));
  register(server, deps, "upload_blog_image", "blog:write",
    "Baixa no servidor uma imagem (source_url https, até 10 MB, PNG/JPEG/WebP/GIF) e grava no bucket do blog. Só imagens com licença que permita uso: alt (até 200), credit (até 200) e license (até 120) são obrigatórios; page_url é a página da imagem. " +
      "Devolve url, width e height; use url em cover_image ou em images (com page_url como source_url).",
    {
      source_url: z.string().url(), filename: z.string().max(120), mime_type: MIME,
      alt: z.string(), credit: z.string(), license: z.string(), page_url: z.string(),
    },
    (a) => uploadBlogImage(deps, a));
}
