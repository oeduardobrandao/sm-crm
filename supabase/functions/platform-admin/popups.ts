// Popups globais (spec 2026-09-04): handlers HTTP. Validação e normalização vivem em
// _shared/admin-popups.ts, compartilhado com mcp-admin.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  adminContaId, normalizePopupText, pagesHaveImages, persistedImageKeys, pickPopupColumns,
  validatePages, validatePopupFields,
} from "../_shared/admin-popups.ts";
export { validatePages, validatePopupFields } from "../_shared/admin-popups.ts";

type Svc = SupabaseClient;
type Headers = Record<string, string>;

const ACTIONS = ["seen", "closed", "cta", "ack"] as const;
type Counts = Record<(typeof ACTIONS)[number], number>;

function json(body: unknown, status: number, headers: Headers): Response {
  return new Response(JSON.stringify(body), { status, headers });
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
  const insert = normalizePopupText({ ...pickPopupColumns(body), pages: pages.pages, created_by: actor.adminId });
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

  const update = normalizePopupText(pickPopupColumns(body));
  if (Object.keys(update).length === 0) return json({ error: "No fields to update" }, 400, headers);

  // Regras cruzadas valem sobre a linha resultante, não só sobre o patch.
  const { data: current, error: readErr } = await svc
    .from("global_popups").select("*").eq("id", popupId).maybeSingle();
  if (readErr) throw readErr;
  if (!current) return json({ error: "Popup not found" }, 404, headers);

  if (update.pages !== undefined) {
    const persisted = persistedImageKeys((current as Record<string, unknown>).pages);
    const hasNewKey = Array.isArray(update.pages) && (update.pages as Array<Record<string, unknown>>).some(
      (p) => typeof p?.image_key === "string" && p.image_key !== "" && !persisted.has(p.image_key),
    );
    let contaId: string | undefined;
    if (hasNewKey) {
      const found = await adminContaId(svc, actor.userId);
      if (found === null) {
        console.error("[popups] update rejected: admin has no conta_id");
        return json({ error: "Invalid popup" }, 400, headers);
      }
      contaId = found;
    }
    const pages = validatePages(update.pages, contaId ?? undefined, persisted);
    if (!pages.ok) {
      console.error("[popups] update rejected:", pages.error);
      return json({ error: "Invalid popup" }, 400, headers);
    }
    update.pages = pages.pages;
  }

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
