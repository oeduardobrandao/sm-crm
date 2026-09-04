// Queries do mcp-admin. Recursos globais: nenhuma tabela tem conta_id. Toda escrita passa
// pelos validadores de _shared/ (os mesmos do platform-admin) e por allowlist de colunas.
import { McpInputError } from "../_shared/mcp-token.ts";
import { normalizeBanner, pickBannerColumns, validateBanner } from "../_shared/admin-banners.ts";
import {
  adminContaId, newImageKeys, normalizePopupText, pagesHaveImages, persistedImageKeys,
  pickPopupColumns, validatePages, validatePopupFields,
} from "../_shared/admin-popups.ts";
import { coverNeedsOwnership, isUniqueViolation, normalizeKb, pickKbColumns, validateKbArticle } from "../_shared/admin-kb.ts";
import { finalizePopupImages, fillImageDims } from "./images.ts";
import { markdownToTiptap, tiptapToMarkdown, tiptapToPlain } from "./markdown.ts";
import type { Deps } from "./deps.ts";
import { handleListWorkspaces } from "../platform-admin/list-workspaces.ts";
import { handleGetMrr, handleGetTrials } from "../platform-admin/mrr.ts";
import { handleGetWorkspace } from "../platform-admin/workspace-detail.ts";
import { handleListPlans } from "../platform-admin/plans.ts";

export type { Deps };

export function notFound(what: string): McpInputError {
  return new McpInputError(`${what} não encontrado.`);
}

function requireId(v: unknown, name: string): string {
  if (typeof v !== "string" || !v.trim()) throw new McpInputError(`${name} é obrigatório.`);
  return v.trim();
}

// ---------------------------------------------------------------------------
// Banners
// ---------------------------------------------------------------------------

async function dismissalCounts(d: Deps, ids: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>(ids.map((id) => [id, 0]));
  if (ids.length === 0) return counts;
  const { data, error } = await d.db.from("banner_dismissals").select("banner_id").in("banner_id", ids);
  if (error) throw error;
  for (const r of (data ?? []) as Array<{ banner_id: string }>) counts.set(r.banner_id, (counts.get(r.banner_id) ?? 0) + 1);
  return counts;
}

export async function listBanners(d: Deps, args: { status?: string }) {
  let q = d.db.from("global_banners").select("*").order("created_at", { ascending: false });
  if (args.status) q = q.eq("status", args.status);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as Array<Record<string, unknown> & { id: string }>;
  const counts = await dismissalCounts(d, rows.map((r) => r.id));
  return { banners: rows.map((r) => ({ ...r, dismissal_count: counts.get(r.id) ?? 0 })) };
}

export async function getBanner(d: Deps, args: { banner_id: string }) {
  const id = requireId(args.banner_id, "banner_id");
  const { data, error } = await d.db.from("global_banners").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw notFound("Banner");
  const counts = await dismissalCounts(d, [id]);
  return { banner: { ...(data as Record<string, unknown>), dismissal_count: counts.get(id) ?? 0 } };
}

export async function createBanner(d: Deps, args: Record<string, unknown>) {
  const insert = normalizeBanner({ ...pickBannerColumns(args), created_by: d.ctx.admin_id });
  const err = validateBanner(insert);
  if (err) throw new McpInputError(err);
  const { data, error } = await d.db.from("global_banners").insert(insert).select("id, status").single();
  if (error) throw error;
  return { id: data.id as string, status: data.status as string };
}

export async function updateBanner(d: Deps, args: Record<string, unknown>) {
  const id = requireId(args.banner_id, "banner_id");
  const update = normalizeBanner(pickBannerColumns(args));
  if (Object.keys(update).length === 0) throw new McpInputError("Nada para atualizar.");
  const { data: current, error: readErr } = await d.db.from("global_banners").select("*").eq("id", id).maybeSingle();
  if (readErr) throw readErr;
  if (!current) throw notFound("Banner");
  // Linha atual normalizada antes de mesclar: banners legados podem ter link/custom_color "".
  const err = validateBanner({ ...normalizeBanner(current as Record<string, unknown>), ...update });
  if (err) throw new McpInputError(err);
  const { data, error } = await d.db.from("global_banners").update(update).eq("id", id).select("id, status").single();
  if (error) throw error;
  return { id: data.id as string, status: data.status as string };
}

// ---------------------------------------------------------------------------
// Popups
// ---------------------------------------------------------------------------

const ACTIONS = ["seen", "closed", "cta", "ack"] as const;
type Counts = Record<(typeof ACTIONS)[number], number>;

async function popupCounts(d: Deps, ids: string[]): Promise<Map<string, Counts>> {
  const counts = new Map<string, Counts>(ids.map((id) => [id, { seen: 0, closed: 0, cta: 0, ack: 0 }]));
  if (ids.length === 0) return counts;
  const { data, error } = await d.db.from("popup_interaction_counts").select("popup_id, action, users").in("popup_id", ids);
  if (error) throw error;
  for (const r of (data ?? []) as Array<{ popup_id: string; action: string; users: number }>) {
    const c = counts.get(r.popup_id);
    if (c && (ACTIONS as readonly string[]).includes(r.action)) c[r.action as keyof Counts] = r.users;
  }
  return counts;
}

export async function listPopups(d: Deps, args: { status?: string }) {
  let q = d.db.from("global_popups").select("*").order("created_at", { ascending: false });
  if (args.status) q = q.eq("status", args.status);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as Array<Record<string, unknown> & { id: string }>;
  const counts = await popupCounts(d, rows.map((r) => r.id));
  return { popups: rows.map((r) => ({ ...r, counts: counts.get(r.id) })) };
}

export async function getPopup(d: Deps, args: { popup_id: string }) {
  const id = requireId(args.popup_id, "popup_id");
  const { data, error } = await d.db.from("global_popups").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw notFound("Popup");
  const counts = await popupCounts(d, [id]);
  return { popup: { ...(data as Record<string, unknown>), counts: counts.get(id) } };
}

/** Valida `pages` e finaliza image_keys novas. `persisted` = chaves já na linha (update). */
async function preparePages(d: Deps, pages: unknown, persisted: Set<string>) {
  const fresh = newImageKeys(pages, persisted);
  let contaId: string | undefined;
  if (fresh.length > 0 || (pagesHaveImages(pages) && persisted.size === 0)) {
    const found = await adminContaId(d.db, d.ctx.user_id);
    if (found === null) throw new McpInputError("Seu usuário não tem workspace no CRM; imagens de popup ficam no seu workspace pessoal.");
    contaId = found;
  }
  const v = validatePages(pages, contaId, persisted);
  if (!v.ok) throw new McpInputError(v.error);
  if (fresh.length > 0) await finalizePopupImages(d, fresh, contaId!);
  return v.pages;
}

export async function createPopup(d: Deps, args: Record<string, unknown>) {
  if (args.pages === undefined) throw new McpInputError("pages é obrigatório.");
  const pages = await preparePages(d, args.pages, new Set());
  const insert = normalizePopupText({ ...pickPopupColumns(args), pages, created_by: d.ctx.admin_id });
  const err = validatePopupFields(insert);
  if (err) throw new McpInputError(err);
  const { data, error } = await d.db.from("global_popups").insert(insert).select("id, status").single();
  if (error) throw error;
  return { id: data.id as string, status: data.status as string };
}

export async function updatePopup(d: Deps, args: Record<string, unknown>) {
  const id = requireId(args.popup_id, "popup_id");
  const update = normalizePopupText(pickPopupColumns(args));
  if (Object.keys(update).length === 0) throw new McpInputError("Nada para atualizar.");
  const { data: current, error: readErr } = await d.db.from("global_popups").select("*").eq("id", id).maybeSingle();
  if (readErr) throw readErr;
  if (!current) throw notFound("Popup");
  if (update.pages !== undefined) {
    update.pages = await preparePages(d, update.pages, persistedImageKeys((current as Record<string, unknown>).pages));
  }
  const err = validatePopupFields({ ...(current as Record<string, unknown>), ...update });
  if (err) throw new McpInputError(err);
  const { data, error } = await d.db.from("global_popups").update(update).eq("id", id).select("id, status").single();
  if (error) throw error;
  return { id: data.id as string, status: data.status as string };
}

// ---------------------------------------------------------------------------
// Artigos (kb_articles)
// ---------------------------------------------------------------------------

const KB_LIST_COLUMNS = "id, title, slug, excerpt, category, tags, status, display_order, cover_image_url, updated_at";
const KB_LIST_COLUMN_LIST = KB_LIST_COLUMNS.split(", ");

export async function listKbArticles(d: Deps, args: { status?: string; category?: string }) {
  let q = d.db.from("kb_articles").select(KB_LIST_COLUMNS).order("display_order", { ascending: true });
  if (args.status) q = q.eq("status", args.status);
  if (args.category) q = q.eq("category", args.category);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  // select() já restringe as colunas no Postgres real; a projeção abaixo é defensiva (mantém
  // a resposta estável mesmo se o client devolver campos extras).
  return { articles: rows.map((row) => Object.fromEntries(KB_LIST_COLUMN_LIST.map((c) => [c, row[c]]))) };
}

export async function getKbArticle(d: Deps, args: { article_id?: string; slug?: string }) {
  const byId = typeof args.article_id === "string" && args.article_id.trim();
  const bySlug = typeof args.slug === "string" && args.slug.trim();
  if (!byId && !bySlug) throw new McpInputError("Informe article_id ou slug.");
  let q = d.db.from("kb_articles").select("*");
  q = byId ? q.eq("id", byId) : q.eq("slug", bySlug);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  if (!data) throw notFound("Artigo");
  const { content, content_plain: _plain, ...meta } = data as Record<string, unknown>;
  const { markdown, opaque_blocks } = tiptapToMarkdown(content);
  return { article: { ...meta, content_markdown: markdown, opaque_blocks } };
}

/** Converte content_markdown (se presente) em content + content_plain, sempre juntos. */
async function bodyFromMarkdown(d: Deps, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (args.content !== undefined || args.content_plain !== undefined) {
    throw new McpInputError("Envie o corpo em content_markdown; content/content_plain são derivados pelo servidor.");
  }
  if (args.content_markdown === undefined) return {};
  if (typeof args.content_markdown !== "string") throw new McpInputError("content_markdown deve ser texto.");
  const doc = await fillImageDims(d, markdownToTiptap(args.content_markdown));
  return { content: doc, content_plain: tiptapToPlain(doc) };
}

function mapKbWriteError(error: unknown): never {
  if (isUniqueViolation(error)) throw new McpInputError("Já existe um artigo com esse slug.");
  throw error;
}

export async function createKbArticle(d: Deps, args: Record<string, unknown>) {
  if (args.content_markdown === undefined) throw new McpInputError("content_markdown é obrigatório.");
  const body = await bodyFromMarkdown(d, args);
  const insert = normalizeKb({ ...pickKbColumns(args), ...body, author_id: d.ctx.admin_id });

  // Uma chave R2 nova só pode virar capa se pertencer ao workspace do admin chamador -- senão
  // qualquer kb:write publicaria (e sign-r2-urls assinaria) um arquivo privado de outro
  // workspace para todo mundo que ler o artigo.
  let contaId: string | undefined;
  if (coverNeedsOwnership(insert.cover_image_url, null)) {
    const found = await adminContaId(d.db, d.ctx.user_id);
    if (found === null) throw new McpInputError("cover_image_url: use a public_url de upload_kb_image (https).");
    contaId = found;
  }

  const err = validateKbArticle(insert, { allowedContaId: contaId });
  if (err) throw new McpInputError(err);
  const { data, error } = await d.db.from("kb_articles").insert(insert).select("id, slug, status").single();
  if (error) mapKbWriteError(error);
  return { id: data.id as string, slug: data.slug as string, status: data.status as string };
}

export async function updateKbArticle(d: Deps, args: Record<string, unknown>) {
  const id = requireId(args.article_id, "article_id");
  const body = await bodyFromMarkdown(d, args);
  const update = normalizeKb({ ...pickKbColumns(args), ...body });
  if (Object.keys(update).length === 0) throw new McpInputError("Nada para atualizar.");
  const { data: current, error: readErr } = await d.db.from("kb_articles").select("*").eq("id", id).maybeSingle();
  if (readErr) throw readErr;
  if (!current) throw notFound("Artigo");

  const persistedCover = ((current as Record<string, unknown>).cover_image_url as string | null | undefined) ?? null;
  let contaId: string | undefined;
  if (coverNeedsOwnership(update.cover_image_url, persistedCover)) {
    const found = await adminContaId(d.db, d.ctx.user_id);
    if (found === null) throw new McpInputError("cover_image_url: use a public_url de upload_kb_image (https).");
    contaId = found;
  }

  const err = validateKbArticle(
    { ...normalizeKb(current as Record<string, unknown>), ...update },
    { allowedContaId: contaId, persistedCover },
  );
  if (err) throw new McpInputError(err);
  const { data, error } = await d.db.from("kb_articles").update(update).eq("id", id).select("id, slug, status").single();
  if (error) mapKbWriteError(error);
  return { id: data.id as string, slug: data.slug as string, status: data.status as string };
}

// ---------------------------------------------------------------------------
// Plataforma (somente leitura; reaproveita os handlers do platform-admin)
// ---------------------------------------------------------------------------

const NO_HEADERS: Record<string, string> = {};
const PII_KEYS = ["telefone", "marketing_opt_in", "owner_telefone", "owner_marketing_opt_in"];

/** Remove chaves de PII do nível informado, e recorre em carriers aninhados conhecidos
 *  (`owner` objeto, `members` array) -- o RPC admin_list_workspaces devolve o dono como
 *  objeto aninhado (owner.telefone/marketing_opt_in), não como chaves owner_* no topo. */
function stripPii<T extends Record<string, unknown>>(row: T): T {
  const out = { ...row } as Record<string, unknown>;
  for (const k of PII_KEYS) delete out[k];
  const owner = out.owner;
  if (owner && typeof owner === "object") out.owner = stripPii(owner as Record<string, unknown>);
  const members = out.members;
  if (Array.isArray(members)) {
    out.members = members.map((m) => (m && typeof m === "object" ? stripPii(m as Record<string, unknown>) : m));
  }
  return out as T;
}

/** Lê o JSON de um handler do platform-admin; 4xx vira McpInputError, 5xx propaga. */
async function handlerJson(res: Response, notFoundLabel: string): Promise<Record<string, unknown>> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 404) throw notFound(notFoundLabel);
  if (res.status >= 400 && res.status < 500) throw new McpInputError(String(body.error ?? "Requisição inválida."));
  if (!res.ok) throw new Error(`platform-admin handler failed: ${res.status}`);
  return body;
}

export async function listWorkspaces(d: Deps, args: { search?: string; plan_id?: string; offset?: number; limit?: number }) {
  const limit = Math.min(Math.max(1, Math.trunc(args.limit ?? 20)), 100);
  const offset = Math.max(0, Math.trunc(args.offset ?? 0));
  const res = await handleListWorkspaces(d.db, { search: args.search, plan_id: args.plan_id, offset, limit }, NO_HEADERS);
  const body = await handlerJson(res, "Workspace");
  return { ...body, workspaces: ((body.workspaces ?? []) as Array<Record<string, unknown>>).map(stripPii) } as {
    workspaces: Array<Record<string, unknown>>; total: number; total_members: number; total_clients: number; total_with_overrides: number;
  };
}

export async function getWorkspace(d: Deps, args: { workspace_id: string }) {
  const id = requireId(args.workspace_id, "workspace_id");
  const res = await handleGetWorkspace(d.db, { workspace_id: id }, NO_HEADERS);
  const body = await handlerJson(res, "Workspace") as {
    owner: Record<string, unknown> | null; members: Array<Record<string, unknown>>; [k: string]: unknown;
  };
  return { ...body, owner: body.owner ? stripPii(body.owner) : null, members: (body.members ?? []).map(stripPii) };
}

export async function listPlans(d: Deps) {
  const res = await handleListPlans(d.db, NO_HEADERS);
  return (await handlerJson(res, "Plano")) as { plans: Array<Record<string, unknown>> };
}

export async function getDashboard(d: Deps) {
  const [wsRes, plansRes, mrrRes, trialsRes] = await Promise.all([
    handleListWorkspaces(d.db, { limit: 1 }, NO_HEADERS),
    handleListPlans(d.db, NO_HEADERS),
    handleGetMrr(d.db, NO_HEADERS),
    handleGetTrials(d.db, NO_HEADERS),
  ]);
  const ws = await handlerJson(wsRes, "Workspace");
  const plans = await handlerJson(plansRes, "Plano");
  const mrr = await handlerJson(mrrRes, "MRR");
  const trials = await handlerJson(trialsRes, "Trials");
  // Só agregados: os arrays workspaces/trials trazem contato dos donos e ficam de fora.
  return {
    totals: {
      workspaces: Number(ws.total ?? 0),
      members: Number(ws.total_members ?? 0),
      clients: Number(ws.total_clients ?? 0),
      with_overrides: Number(ws.total_with_overrides ?? 0),
      active_plans: ((plans.plans ?? []) as unknown[]).length,
    },
    mrr: { mrr_cents: Number(mrr.mrr_cents ?? 0), paying_count: Number(mrr.paying_count ?? 0) },
    trials: { trial_mrr_cents: Number(trials.trial_mrr_cents ?? 0), trial_count: Number(trials.trial_count ?? 0) },
  };
}
