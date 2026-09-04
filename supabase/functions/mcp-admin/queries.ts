// Queries do mcp-admin. Recursos globais: nenhuma tabela tem conta_id. Toda escrita passa
// pelos validadores de _shared/ (os mesmos do platform-admin) e por allowlist de colunas.
import { McpInputError } from "../_shared/mcp-token.ts";
import { normalizeBanner, pickBannerColumns, validateBanner } from "../_shared/admin-banners.ts";
import {
  adminContaId, newImageKeys, normalizePopupText, pagesHaveImages, persistedImageKeys,
  pickPopupColumns, validatePages, validatePopupFields,
} from "../_shared/admin-popups.ts";
import { finalizePopupImages } from "./images.ts";
import type { Deps } from "./deps.ts";

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
