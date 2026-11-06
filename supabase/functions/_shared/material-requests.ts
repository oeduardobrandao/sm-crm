// Pedido de material do post (spec docs/superpowers/specs/2026-11-06-posts-aguardando-material-design.md).
// Compartilhado por post-references (CRM) e hub-post-references (Hub). A autoridade é o banco
// (post_material_request_save etc.); aqui só normalizamos a entrada, para devolver códigos
// estáveis, e lemos as formas JSON dos RPCs.
import { mapReferenceRpcError, type ReferenceResult, type ReferencesDb } from "./post-references.ts";

export const MAX_MATERIAL_ITEMS = 10;
export const MAX_MATERIAL_LABEL = 120;
export const MAX_MATERIAL_DETAIL = 300;

export interface MaterialItemDTO {
  id: number;
  label: string;
  detail: string | null;
  position: number;
  done: boolean;
  file_count: number;
}

export interface MaterialRequestDTO {
  id: number;
  post_id: number;
  status: "aberto" | "concluido" | "cancelado";
  closed_by: "auto" | "client" | "team" | "system" | null;
  closed_at: string | null;
  opened_by: string | null;
  opened_at: string;
  items: MaterialItemDTO[];
}

export type MaterialItemInput = { id?: number; label: string; detail: string | null };

/** Mesmo aparo do banco: regexp_replace(x, '^\s+|\s+$', '', 'g') (tab/quebra de linha incluídos). */
function trimAll(s: string): string {
  return s.replace(/^\s+|\s+$/g, "");
}

export function normalizeMaterialItems(
  raw: unknown,
): { ok: true; items: MaterialItemInput[] } | { ok: false; code: "invalid_item" | "too_many_items" } {
  if (!Array.isArray(raw)) return { ok: false, code: "invalid_item" };
  if (raw.length > MAX_MATERIAL_ITEMS) return { ok: false, code: "too_many_items" };
  const items: MaterialItemInput[] = [];
  const seen = new Set<number>();
  for (const el of raw) {
    if (typeof el !== "object" || el === null || Array.isArray(el)) return { ok: false, code: "invalid_item" };
    const e = el as Record<string, unknown>;
    if (typeof e.label !== "string") return { ok: false, code: "invalid_item" };
    const label = trimAll(e.label);
    if (label.length < 1 || label.length > MAX_MATERIAL_LABEL) return { ok: false, code: "invalid_item" };
    let detail: string | null = null;
    if (e.detail !== undefined && e.detail !== null) {
      if (typeof e.detail !== "string") return { ok: false, code: "invalid_item" };
      const d = trimAll(e.detail);
      if (d.length > MAX_MATERIAL_DETAIL) return { ok: false, code: "invalid_item" };
      detail = d === "" ? null : d;
    }
    const out: MaterialItemInput = { label, detail };
    if (e.id !== undefined && e.id !== null) {
      const id = e.id;
      if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0 || seen.has(id)) {
        return { ok: false, code: "invalid_item" };
      }
      seen.add(id);
      out.id = id;
    }
    items.push(out);
  }
  return { ok: true, items };
}

export type SaveMaterialOutcome =
  | { ok: true; request: MaterialRequestDTO | null }
  | { ok: false; result: ReferenceResult };

/** p_open=false sem pedido existente devolve NULL no banco: request null. */
export async function saveMaterialRequest(
  db: ReferencesDb,
  a: { conta_id: string; post_id: number; user_id: string; open: boolean; items: MaterialItemInput[] },
): Promise<SaveMaterialOutcome> {
  const { data, error } = await db.rpc("post_material_request_save", {
    p_conta: a.conta_id,
    p_post: a.post_id,
    p_user: a.user_id,
    p_open: a.open,
    p_items: a.items,
  });
  if (error) return { ok: false, result: mapReferenceRpcError(error, "material-requests:save") };
  if (data === null || data === undefined) return { ok: true, request: null };
  return { ok: true, request: data as MaterialRequestDTO };
}

/** Pedidos abertos dos posts do cliente, por post_id. Falha de leitura propaga (o chamador responde 500). */
export async function loadOpenRequestsForClient(
  db: ReferencesDb,
  conta_id: string,
  cliente_id: number,
): Promise<Map<number, MaterialRequestDTO>> {
  const { data, error } = await db.rpc("post_material_requests_for", { p_conta: conta_id, p_cliente: cliente_id });
  if (error) throw error;
  const map = new Map<number, MaterialRequestDTO>();
  for (const row of Array.isArray(data) ? data : []) {
    const r = row as { post_id: number | string; request: MaterialRequestDTO };
    map.set(Number(r.post_id), r.request);
  }
  return map;
}

export async function loadMaterialSummary(
  db: ReferencesDb,
  conta_id: string,
  post_ids: number[],
): Promise<{ post_id: number; status: string; done: number; total: number }[]> {
  if (post_ids.length === 0) return [];
  const { data, error } = await db.rpc("post_material_summary", { p_conta: conta_id, p_post_ids: post_ids });
  if (error) throw error;
  return (Array.isArray(data) ? data : []).map((r: Record<string, unknown>) => ({
    post_id: Number(r.post_id),
    status: String(r.status),
    done: Number(r.done),
    total: Number(r.total),
  }));
}

/**
 * O pedido do post em qualquer status (aberto, concluido, cancelado), para a leitura do CRM.
 * Lê as tabelas com o service role; file_count/done vêm de post_references.material_item_id.
 * Falha de leitura propaga (o chamador responde 500).
 */
export async function loadMaterialRequestForPost(
  db: ReferencesDb,
  conta_id: string,
  post_id: number,
): Promise<MaterialRequestDTO | null> {
  const { data: q, error } = await db.from("post_material_requests")
    .select("id, post_id, status, closed_by, closed_at, opened_by, opened_at")
    .eq("conta_id", conta_id).eq("post_id", post_id).maybeSingle();
  if (error) throw error;
  if (!q) return null;
  const { data: itemRows, error: itemsErr } = await db.from("post_material_items")
    .select("id, label, detail, position")
    .eq("conta_id", conta_id).eq("request_id", q.id)
    .order("position", { ascending: true }).order("id", { ascending: true });
  if (itemsErr) throw itemsErr;
  const rows = (Array.isArray(itemRows) ? itemRows : []) as {
    id: number; label: string; detail: string | null; position: number;
  }[];
  const counts = new Map<number, number>();
  if (rows.length > 0) {
    const { data: refs, error: refsErr } = await db.from("post_references")
      .select("material_item_id")
      .eq("conta_id", conta_id).in("material_item_id", rows.map((r) => r.id));
    if (refsErr) throw refsErr;
    for (const r of Array.isArray(refs) ? refs : []) {
      const k = Number((r as { material_item_id: number }).material_item_id);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return {
    id: Number(q.id),
    post_id: Number(q.post_id),
    status: q.status,
    closed_by: q.closed_by ?? null,
    closed_at: q.closed_at ?? null,
    opened_by: q.opened_by ?? null,
    opened_at: q.opened_at,
    items: rows.map((i) => {
      const n = counts.get(Number(i.id)) ?? 0;
      return { id: Number(i.id), label: i.label, detail: i.detail ?? null, position: Number(i.position), done: n > 0, file_count: n };
    }),
  };
}
