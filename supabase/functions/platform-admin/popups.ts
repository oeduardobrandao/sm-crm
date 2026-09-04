// Popups globais (spec 2026-09-04): validação e handlers. Único caminho de
// escrita em global_popups, então os limites de formato vivem aqui, não no banco.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export const POPUP_COLUMNS = [
  "pages", "cta_label", "cta_url", "cta_style", "secondary_label", "frequency",
  "require_ack", "target_mode", "target_plan_ids", "target_workspace_ids",
  "starts_at", "ends_at", "status",
] as const;

export interface PopupPage {
  title: string;
  eyebrow: string | null;
  body: string;
  image_key: string | null;
}

const MAX_PAGES = 6;
const PAGE_KEYS = new Set(["title", "eyebrow", "body", "image_key"]);
const IMAGE_KEY_RE = /^contas\/[0-9a-f-]{36}\/files\/[^/]+$/;
const CTA_URL_RE = /^(\/(?!\/)|https?:\/\/)/;

function optionalText(value: unknown, max: number): { ok: true; value: string | null } | { ok: false } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== "string") return { ok: false };
  const t = value.trim();
  if (t.length === 0) return { ok: true, value: null };
  if (t.length > max) return { ok: false };
  return { ok: true, value: t };
}

function requiredText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (t.length === 0 || t.length > max) return null;
  return t;
}

export function validatePages(
  input: unknown,
  allowedContaId?: string,
): { ok: true; pages: PopupPage[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: "pages must be an array" };
  if (input.length < 1 || input.length > MAX_PAGES) {
    return { ok: false, error: `pages must have 1 to ${MAX_PAGES} items` };
  }
  const pages: PopupPage[] = [];
  for (let i = 0; i < input.length; i++) {
    const raw = input[i];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return { ok: false, error: `page ${i} must be an object` };
    }
    for (const k of Object.keys(raw)) {
      if (!PAGE_KEYS.has(k)) return { ok: false, error: `page ${i}: unknown key ${k}` };
    }
    const r = raw as Record<string, unknown>;
    const title = requiredText(r.title, 120);
    if (!title) return { ok: false, error: `page ${i}: title required (max 120)` };
    const body = requiredText(r.body, 2000);
    if (!body) return { ok: false, error: `page ${i}: body required (max 2000)` };
    const eyebrow = optionalText(r.eyebrow, 60);
    if (!eyebrow.ok) return { ok: false, error: `page ${i}: eyebrow max 60` };
    const image = optionalText(r.image_key, 512);
    if (!image.ok) return { ok: false, error: `page ${i}: image_key invalid` };
    if (image.value !== null && !IMAGE_KEY_RE.test(image.value)) {
      return { ok: false, error: `page ${i}: image_key must be an R2 key` };
    }
    if (
      image.value !== null &&
      allowedContaId !== undefined &&
      !image.value.startsWith(`contas/${allowedContaId}/files/`)
    ) {
      return { ok: false, error: `page ${i}: image_key belongs to another workspace` };
    }
    pages.push({ title, eyebrow: eyebrow.value, body, image_key: image.value });
  }
  return { ok: true, pages };
}

/** Regras cruzadas do popup inteiro. Recebe a linha já mesclada (create: body; update: atual + body). */
export function validatePopupFields(row: Record<string, unknown>): string | null {
  const ctaLabel = optionalText(row.cta_label, 40);
  if (!ctaLabel.ok) return "cta_label max 40";
  const ctaUrl = optionalText(row.cta_url, 2048);
  if (!ctaUrl.ok) return "cta_url max 2048";
  if ((ctaLabel.value === null) !== (ctaUrl.value === null)) return "cta_label and cta_url go together";
  if (ctaUrl.value !== null && !CTA_URL_RE.test(ctaUrl.value)) {
    return "cta_url must start with / or http(s)://";
  }
  const secondary = optionalText(row.secondary_label, 40);
  if (!secondary.ok) return "secondary_label max 40";

  const frequency = row.frequency ?? "once";
  if (frequency !== "once" && frequency !== "until_cta") return "invalid frequency";
  if (frequency === "until_cta" && ctaUrl.value === null) return "until_cta requires a CTA";
  const requireAck = row.require_ack === true;
  if (requireAck && frequency === "until_cta") return "require_ack implies once";

  const style = row.cta_style ?? "ink";
  if (style !== "ink" && style !== "brand") return "invalid cta_style";

  // Targeting: array_length('{}') é NULL no Postgres, então o CHECK do banco só
  // barra NULL. Array vazio precisa ser barrado aqui, senão o popup nasce
  // invisível para todo mundo.
  const mode = row.target_mode;
  if (mode !== "all" && mode !== "plan" && mode !== "workspace") return "invalid target_mode";
  if (mode === "plan" && !(Array.isArray(row.target_plan_ids) && row.target_plan_ids.length > 0)) {
    return "plan targeting needs at least one plan";
  }
  if (
    mode === "workspace" &&
    !(Array.isArray(row.target_workspace_ids) && row.target_workspace_ids.length > 0)
  ) {
    return "workspace targeting needs at least one workspace";
  }

  // O banco tem o CHECK (ends_at > starts_at); barrar aqui vira 400 em vez de 500.
  // Cada timestamp, se presente como string, precisa parsear sozinho -- um único
  // starts_at/ends_at malformado (sem o outro lado) não pode cair direto no CHECK e virar 500.
  const start = typeof row.starts_at === "string" ? Date.parse(row.starts_at) : null;
  if (start !== null && Number.isNaN(start)) return "invalid schedule timestamps";
  const end = typeof row.ends_at === "string" ? Date.parse(row.ends_at) : null;
  if (end !== null && Number.isNaN(end)) return "invalid schedule timestamps";
  if (start !== null && end !== null && end <= start) return "ends_at must be after starts_at";
  return null;
}

type Svc = SupabaseClient;
type Headers = Record<string, string>;

const ACTIONS = ["seen", "closed", "cta", "ack"] as const;
type Counts = Record<(typeof ACTIONS)[number], number>;

function json(body: unknown, status: number, headers: Headers): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

function pickColumns(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of POPUP_COLUMNS) {
    if (body[col] !== undefined) out[col] = body[col];
  }
  return out;
}

const TEXT_COLUMNS = ["cta_label", "cta_url", "secondary_label"] as const;

/** Trim + "" → null nas colunas de texto opcionais, para que o que persiste seja o
 * mesmo que validatePopupFields avaliou (senão "   " passa na validação e cai no CHECK). */
function normalizePopupText(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  for (const col of TEXT_COLUMNS) {
    if (typeof out[col] === "string") {
      const t = (out[col] as string).trim();
      out[col] = t.length > 0 ? t : null;
    }
  }
  return out;
}

/** conta_id do admin chamador (profiles.id = auth uid). As imagens sobem via file-upload-url
 * sob contas/<conta>/files/, então uma image_key legítima sempre tem este prefixo. */
async function adminContaId(svc: Svc, userId: string): Promise<string | null> {
  const { data, error } = await svc.from("profiles").select("conta_id").eq("id", userId).maybeSingle();
  if (error) throw error;
  return (data?.conta_id as string | undefined) ?? null;
}

function pagesHaveImages(pages: unknown): boolean {
  return (
    Array.isArray(pages) &&
    pages.some(
      (p) =>
        p && typeof p === "object" && typeof (p as Record<string, unknown>).image_key === "string" &&
        (p as Record<string, unknown>).image_key !== "",
    )
  );
}

export async function handleListPopups(svc: Svc, body: { status?: string }, headers: Headers) {
  let query = svc.from("global_popups").select("*").order("created_at", { ascending: false });
  if (body.status) query = query.eq("status", body.status);
  const { data: popups, error } = await query;
  if (error) throw error;

  const rows = (popups ?? []) as Array<Record<string, unknown> & { id: string }>;
  const counts = new Map<string, Counts>();
  for (const p of rows) counts.set(p.id, { seen: 0, closed: 0, cta: 0, ack: 0 });

  if (rows.length > 0) {
    const { data: agg, error: aggErr } = await svc
      .from("popup_interaction_counts")
      .select("popup_id, action, users")
      .in("popup_id", rows.map((p) => p.id));
    if (aggErr) throw aggErr;
    for (const r of (agg ?? []) as Array<{ popup_id: string; action: string; users: number }>) {
      const c = counts.get(r.popup_id);
      if (c && (ACTIONS as readonly string[]).includes(r.action)) c[r.action as keyof Counts] = r.users;
    }
  }

  return json({ popups: rows.map((p) => ({ ...p, counts: counts.get(p.id) })) }, 200, headers);
}

export async function handleCreatePopup(
  svc: Svc,
  body: Record<string, unknown>,
  actor: { adminId: string; userId: string },
  headers: Headers,
) {
  if (body.pages === undefined || !body.target_mode) {
    console.error("[popups] create rejected: pages and target_mode are required");
    return json({ error: "Invalid popup" }, 400, headers);
  }
  let contaId: string | undefined;
  if (pagesHaveImages(body.pages)) {
    const found = await adminContaId(svc, actor.userId);
    if (found === null) {
      console.error("[popups] create rejected: admin has no conta_id");
      return json({ error: "Invalid popup" }, 400, headers);
    }
    contaId = found;
  }
  const pages = validatePages(body.pages, contaId);
  if (!pages.ok) {
    console.error("[popups] create rejected:", pages.error);
    return json({ error: "Invalid popup" }, 400, headers);
  }
  const insert = normalizePopupText({ ...pickColumns(body), pages: pages.pages, created_by: actor.adminId });
  const fieldError = validatePopupFields(insert);
  if (fieldError) {
    console.error("[popups] create rejected:", fieldError);
    return json({ error: "Invalid popup" }, 400, headers);
  }

  const { data, error } = await svc.from("global_popups").insert(insert).select().single();
  if (error) throw error;
  return json({ popup: data }, 201, headers);
}

export async function handleUpdatePopup(
  svc: Svc,
  body: Record<string, unknown>,
  actor: { userId: string },
  headers: Headers,
) {
  const popupId = body.popup_id;
  if (typeof popupId !== "string" || !popupId) return json({ error: "popup_id is required" }, 400, headers);

  const update = normalizePopupText(pickColumns(body));
  if (Object.keys(update).length === 0) return json({ error: "No fields to update" }, 400, headers);

  if (update.pages !== undefined) {
    let contaId: string | undefined;
    if (pagesHaveImages(update.pages)) {
      const found = await adminContaId(svc, actor.userId);
      if (found === null) {
        console.error("[popups] update rejected: admin has no conta_id");
        return json({ error: "Invalid popup" }, 400, headers);
      }
      contaId = found;
    }
    const pages = validatePages(update.pages, contaId);
    if (!pages.ok) {
      console.error("[popups] update rejected:", pages.error);
      return json({ error: "Invalid popup" }, 400, headers);
    }
    update.pages = pages.pages;
  }

  // Regras cruzadas valem sobre a linha resultante, não só sobre o patch.
  const { data: current, error: readErr } = await svc
    .from("global_popups").select("*").eq("id", popupId).maybeSingle();
  if (readErr) throw readErr;
  if (!current) return json({ error: "Popup not found" }, 404, headers);

  const fieldError = validatePopupFields({ ...(current as Record<string, unknown>), ...update });
  if (fieldError) {
    console.error("[popups] update rejected:", fieldError);
    return json({ error: "Invalid popup" }, 400, headers);
  }

  const { data, error } = await svc
    .from("global_popups").update(update).eq("id", popupId).select().single();
  if (error) throw error;
  return json({ popup: data }, 200, headers);
}

export async function handleDeletePopup(svc: Svc, body: { popup_id?: string }, headers: Headers) {
  const { popup_id } = body;
  if (!popup_id) return json({ error: "popup_id is required" }, 400, headers);

  // Falha fechada: sem linha é 404, erro de leitura sobe. Nunca cair no DELETE
  // com a guarda de draft pulada.
  const { data: popup, error: readErr } = await svc
    .from("global_popups").select("status").eq("id", popup_id).maybeSingle();
  if (readErr) throw readErr;
  if (!popup) return json({ error: "Popup not found" }, 404, headers);
  if (popup.status !== "draft") {
    return json({ error: "Only draft popups can be deleted" }, 400, headers);
  }

  const { error } = await svc.from("global_popups").delete().eq("id", popup_id);
  if (error) throw error;
  return json({ message: "Popup deleted" }, 200, headers);
}
