// Pure, side-effect-free helpers for shaping post content for the agent.
// Kept separate from DB access so they can be unit-tested without Supabase.

export interface MediaLite {
  kind: string;
  duration_seconds?: number | null;
}

/**
 * Derive slide count / video duration from the post format + its media, rather than parsing the
 * (app-defined, undocumented) ProseMirror `conteudo` JSON:
 *  - carrossel → num_slides = number of image attachments
 *  - reels/stories → duration_seconds = first video's duration
 *  - feed → num_slides = image count (usually 1)
 */
export function deriveFormatMeta(
  tipo: string,
  media: MediaLite[],
): { num_slides: number | null; duration_seconds: number | null } {
  const images = media.filter((m) => m.kind === "image").length;
  const firstVideo = media.find((m) => m.kind === "video");
  if (tipo === "carrossel") return { num_slides: images || null, duration_seconds: null };
  if (tipo === "reels" || tipo === "stories") {
    return { num_slides: null, duration_seconds: firstVideo?.duration_seconds ?? null };
  }
  return { num_slides: images > 0 ? images : null, duration_seconds: null };
}

/** First non-empty line of the plain-text body — a cheap proxy for "slide 1 text". */
export function firstLine(plain: string | null | undefined): string | null {
  if (!plain) return null;
  const line = plain.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0);
  return line ?? null;
}

export interface Quartiles {
  p25: number;
  p50: number;
  p75: number;
}

/** Linear-interpolated quartiles. Returns null for an empty sample. */
export function quartiles(values: number[]): Quartiles | null {
  const xs = values
    .filter((v) => typeof v === "number" && !Number.isNaN(v))
    .sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const at = (p: number): number => {
    const idx = (xs.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return xs[lo];
    return xs[lo] + (xs[hi] - xs[lo]) * (idx - lo);
  };
  return { p25: at(0.25), p50: at(0.5), p75: at(0.75) };
}

export type PerformanceTier =
  | "top_quartile"
  | "above_median"
  | "below_median"
  | "bottom_quartile";

/** Bucket a metric value against a quartile baseline. Null when value or baseline is missing. */
export function performanceTier(
  value: number | null | undefined,
  q: Quartiles | null,
): PerformanceTier | null {
  if (q === null || value === null || value === undefined || Number.isNaN(value)) return null;
  if (value >= q.p75) return "top_quartile";
  if (value >= q.p50) return "above_median";
  if (value >= q.p25) return "below_median";
  return "bottom_quartile";
}

// Field allowlist for get_client / list_clients — sensitive columns are excluded by default
// (LGPD/CFM sensitivity; a content agent does not need contact/financial data).
export const CLIENT_PUBLIC_FIELDS = [
  "id", "nome", "sigla", "especialidade", "cor", "status",
] as const;
export const CLIENT_SENSITIVE_FIELDS = [
  "email", "telefone", "valor_mensal", "data_pagamento", "notion_page_url", "user_id", "conta_id",
] as const;

export function allowlistClient(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of CLIENT_PUBLIC_FIELDS) {
    if (f in row) out[f] = row[f];
  }
  return out;
}

/**
 * Flatten the JSONB `hub_pages.content` block array into a single markdown string
 * for agent consumption. Boundary-safe: `content` is JSONB (`unknown`), so this
 * trusts neither the top-level value nor the shape of any block, and fails closed
 * (returns "") on anything malformed. Unknown block types fall back to rendering
 * their text as a paragraph, mirroring the Hub page renderer's default case
 * (apps/hub/src/pages/PaginaPage.tsx).
 */
export function pageContentToMarkdown(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (typeof block !== "object" || block === null) continue;
    const b = block as Record<string, unknown>;
    const type = typeof b.type === "string" ? b.type : "";
    const text = typeof b.content === "string" ? b.content : "";
    const href = typeof b.href === "string" ? b.href : "";
    switch (type) {
      case "markdown":
      case "paragraph":
        if (text) parts.push(text);
        break;
      case "heading": {
        if (!text) break;
        const lvl = Math.min(3, Math.max(1, Math.trunc(Number(b.level)) || 1));
        parts.push(`${"#".repeat(lvl)} ${text}`);
        break;
      }
      case "link":
        if (text) parts.push(href ? `[${text}](${href})` : text);
        break;
      case "image":
        if (text) parts.push(`![](${text})`);
        break;
      default:
        // Unknown type → render text as a paragraph (mirror Hub fallback).
        if (text) parts.push(text);
        break;
    }
  }
  return parts.join("\n\n").trim();
}

// ---- post feedback (list_post_feedback) -------------------------------------

/** Normalized feedback row (one post_approvals row joined to its post). */
export interface FeedbackRow {
  post_id: number;
  titulo: string;
  status: string;
  cliente_id: number;
  action: string;
  comentario: string | null;
  is_workspace_user: boolean;
  created_at: string;
}

/** Normalized status-transition row (one post_status_events row). */
export interface StatusEventRow {
  post_id: number;
  from_status: string | null;
  to_status: string;
  source: string;
  actor_name: string | null;
  created_at: string;
}

export interface PostFeedbackItem {
  post_id: number;
  titulo: string;
  cliente_id: number;
  status: string;
  latest_feedback_at: string;
  feedback: {
    action: string;
    comentario: string | null;
    author: "client" | "workspace";
    created_at: string;
  }[];
  timeline: {
    from_status: string | null;
    to_status: string;
    source: string;
    actor_name: string | null;
    created_at: string;
  }[];
}

/**
 * Distinct post_ids in first-seen order, capped at `limit`. Input is expected in
 * the desired order (newest-first). Duplicate post_ids do NOT consume a slot, so
 * one chatty post cannot crowd out other posts within the in-memory list.
 */
export function topDistinctPostIds(rows: { post_id: number }[], limit: number): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const r of rows) {
    if (seen.has(r.post_id)) continue;
    seen.add(r.post_id);
    out.push(r.post_id);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Group feedback rows by post into PostFeedbackItem[]: feedback newest-first,
 * timeline oldest->newest, `author` derived from is_workspace_user, and posts
 * ordered by latest_feedback_at desc. ISO-8601 timestamps compare lexicographically.
 */
export function buildPostFeedback(
  feedbackRows: FeedbackRow[],
  statusEvents: StatusEventRow[],
): PostFeedbackItem[] {
  const eventsByPost = new Map<number, StatusEventRow[]>();
  for (const e of statusEvents) {
    const arr = eventsByPost.get(e.post_id) ?? [];
    arr.push(e);
    eventsByPost.set(e.post_id, arr);
  }

  const byPost = new Map<number, { meta: FeedbackRow; rows: FeedbackRow[] }>();
  for (const r of feedbackRows) {
    const g = byPost.get(r.post_id);
    if (g) g.rows.push(r);
    else byPost.set(r.post_id, { meta: r, rows: [r] });
  }

  const items: PostFeedbackItem[] = [];
  for (const { meta, rows } of byPost.values()) {
    const feedback = rows
      .slice()
      .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
      .map((r) => ({
        action: r.action,
        comentario: r.comentario,
        author: (r.is_workspace_user ? "workspace" : "client") as "client" | "workspace",
        created_at: r.created_at,
      }));
    const timeline = (eventsByPost.get(meta.post_id) ?? [])
      .slice()
      .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0))
      .map((e) => ({
        from_status: e.from_status,
        to_status: e.to_status,
        source: e.source,
        actor_name: e.actor_name,
        created_at: e.created_at,
      }));
    items.push({
      post_id: meta.post_id,
      titulo: meta.titulo,
      cliente_id: meta.cliente_id,
      status: meta.status,
      latest_feedback_at: feedback[0]?.created_at ?? meta.created_at,
      feedback,
      timeline,
    });
  }

  items.sort((a, b) =>
    a.latest_feedback_at < b.latest_feedback_at ? 1 : a.latest_feedback_at > b.latest_feedback_at ? -1 : 0
  );
  return items;
}

// ---- post body (create_post) ------------------------------------------------

/**
 * Build a minimal TipTap/ProseMirror doc from plain text for `workflow_posts.conteudo`.
 * Uses ONLY core doc/paragraph/text nodes — a missing node/mark type silently blanks
 * the whole post body in the Hub. One paragraph per line; a blank line becomes an
 * empty paragraph; empty/undefined input becomes a doc with one empty paragraph.
 * `body` is plain text (markdown syntax would appear literally).
 */
export function buildTiptapDoc(
  plain: string | undefined | null,
): { type: "doc"; content: ({ type: "paragraph"; content?: { type: "text"; text: string }[] })[] } {
  const text = typeof plain === "string" ? plain : "";
  const content = text.split("\n").map((line) =>
    line.length > 0
      ? { type: "paragraph" as const, content: [{ type: "text" as const, text: line }] }
      : { type: "paragraph" as const }
  );
  return { type: "doc", content };
}

/** Pull the string `id`s out of a select/status/multiselect definition's `config.options`.
 *  Fully defensive: config / options / element / id may be malformed. */
export function extractTemplateOptionIds(config: unknown): string[] {
  if (!config || typeof config !== "object" || Array.isArray(config)) return [];
  const options = (config as Record<string, unknown>).options;
  if (!Array.isArray(options)) return [];
  const ids: string[] = [];
  for (const opt of options) {
    if (opt && typeof opt === "object" && !Array.isArray(opt)) {
      const id = (opt as Record<string, unknown>).id;
      if (typeof id === "string") ids.push(id);
    }
  }
  return ids;
}

const SETTABLE_PROPERTY_TYPES = new Set([
  "text", "url", "email", "phone", "number", "date", "checkbox", "select", "status", "multiselect",
]);

/** Validate a property value against its definition type. Returns a caller-safe
 *  error message, or null if valid. `null` clears any settable type. */
export function validatePropertyValue(
  type: string,
  value: unknown,
  allowedOptionIds: Set<string>,
): string | null {
  if (!SETTABLE_PROPERTY_TYPES.has(type)) {
    return `Tipo de propriedade '${type}' não pode ser definido pelo agente.`;
  }
  if (value === null) return null; // clear
  switch (type) {
    case "text":
    case "url":
    case "email":
    case "phone":
      return typeof value === "string" ? null : "O valor deve ser um texto.";
    case "number":
      return typeof value === "number" ? null : "O valor deve ser um número.";
    case "checkbox":
      return typeof value === "boolean" ? null : "O valor deve ser booleano (true/false).";
    case "date":
      return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? null
        : "O valor deve ser uma data no formato AAAA-MM-DD.";
    case "select":
    case "status":
      return typeof value === "string" && allowedOptionIds.has(value)
        ? null
        : "Opção inválida para esta propriedade.";
    case "multiselect":
      return Array.isArray(value) && value.every((v) => typeof v === "string" && allowedOptionIds.has(v))
        ? null
        : "Uma ou mais opções são inválidas para esta propriedade.";
    default:
      return `Tipo de propriedade '${type}' não pode ser definido pelo agente.`;
  }
}

/** Instantiate a workflow template's `etapas` JSONB into workflow_etapa rows
 *  (WITHOUT workflow_id — the caller attaches it). Fail-closed on malformed JSONB,
 *  skips non-object elements (contiguous ordem), keeps responsavel_id, and uses
 *  Number.isInteger for the integer/bigint columns. First step is ativo+iniciado_em. */
export function instantiateTemplateEtapas(
  rawEtapas: unknown,
  now: string,
): {
  ordem: number; nome: string; prazo_dias: number; tipo_prazo: "uteis" | "corridos";
  tipo: "padrao" | "aprovacao_cliente"; responsavel_id: number | null;
  status: "ativo" | "pendente"; iniciado_em: string | null;
  concluido_em: null; data_limite: null;
}[] {
  if (!Array.isArray(rawEtapas)) return [];
  const objs = rawEtapas.filter(
    (e) => e && typeof e === "object" && !Array.isArray(e),
  ) as Record<string, unknown>[];
  return objs.map((o, i) => ({
    ordem: i,
    nome: typeof o.nome === "string" ? o.nome : "",
    prazo_dias: Number.isInteger(o.prazo_dias) ? (o.prazo_dias as number) : 0,
    tipo_prazo: o.tipo_prazo === "uteis" ? "uteis" : "corridos",
    tipo: o.tipo === "aprovacao_cliente" ? "aprovacao_cliente" : "padrao",
    responsavel_id: Number.isInteger(o.responsavel_id) ? (o.responsavel_id as number) : null,
    status: i === 0 ? "ativo" : "pendente",
    iniciado_em: i === 0 ? now : null,
    concluido_em: null,
    data_limite: null,
  }));
}

/** Normalize agent-supplied template etapas into the template etapas JSONB shape
 *  (no ordem, no responsavel_id). Fail-closed; integer-guarded prazo_dias. */
export function normalizeTemplateEtapas(
  etapas: unknown,
): { nome: string; prazo_dias: number; tipo_prazo: "uteis" | "corridos"; tipo: "padrao" | "aprovacao_cliente" }[] {
  if (!Array.isArray(etapas)) return [];
  const out: { nome: string; prazo_dias: number; tipo_prazo: "uteis" | "corridos"; tipo: "padrao" | "aprovacao_cliente" }[] = [];
  for (const e of etapas) {
    if (!e || typeof e !== "object" || Array.isArray(e)) continue;
    const o = e as Record<string, unknown>;
    out.push({
      nome: typeof o.nome === "string" ? o.nome : "",
      prazo_dias: Number.isInteger(o.prazo_dias) ? (o.prazo_dias as number) : 0,
      tipo_prazo: o.tipo_prazo === "uteis" ? "uteis" : "corridos",
      tipo: o.tipo === "aprovacao_cliente" ? "aprovacao_cliente" : "padrao",
    });
  }
  return out;
}

const OPTION_PROPERTY_TYPES = ["select", "status", "multiselect"];

/** Build template_property_definitions rows (without template_id/conta_id) from
 *  agent input. Generates {id,label,color} option configs; rejects dup names,
 *  dup option labels, and options-vs-type mismatches. Returns {error} or {defs}. */
export function buildPropertyDefinitions(
  properties: Array<{ name: string; type: string; portal_visible?: boolean; options?: string[] }>,
  genId: () => string,
):
  | { error: string }
  | { defs: { name: string; type: string; config: Record<string, unknown>; portal_visible: boolean; display_order: number }[] } {
  const seenNames = new Set<string>();
  const defs: { name: string; type: string; config: Record<string, unknown>; portal_visible: boolean; display_order: number }[] = [];
  for (let i = 0; i < properties.length; i++) {
    const p = properties[i];
    const name = p.name.trim();
    if (seenNames.has(name)) return { error: `Nomes de propriedade duplicados: '${name}'.` };
    seenNames.add(name);

    let config: Record<string, unknown> = {};
    if (OPTION_PROPERTY_TYPES.includes(p.type)) {
      const opts = p.options ?? [];
      if (opts.length === 0) return { error: `A propriedade '${name}' (${p.type}) exige 'options'.` };
      const seenOpt = new Set<string>();
      const options: { id: string; label: string; color: string }[] = [];
      for (const raw of opts) {
        const label = raw.trim();
        if (seenOpt.has(label)) return { error: `Opções duplicadas na propriedade '${name}'.` };
        seenOpt.add(label);
        options.push({ id: genId(), label, color: "#94a3b8" });
      }
      config = { options };
    } else if (p.options && p.options.length > 0) {
      return { error: `A propriedade '${name}' (${p.type}) não aceita 'options'.` };
    }
    defs.push({ name, type: p.type, config, portal_visible: p.portal_visible ?? false, display_order: i });
  }
  return { defs };
}

/** True if a DB error is the plan-count trigger raising for THIS limit key. */
export function isPlanLimitExceeded(error: unknown, limitKey: string): boolean {
  const msg = (error as { message?: unknown } | null)?.message;
  return typeof msg === "string" && msg.includes("plan_limit_exceeded:" + limitKey);
}

/**
 * Project a workflow template's `etapas` JSONB array into the agent-facing shape.
 * Fails closed on malformed JSONB, skips non-object elements, drops the internal
 * `responsavel_id`, and applies the system defaults for tipo_prazo/tipo.
 */
export function projectTemplateEtapas(
  raw: unknown,
): { nome: string; prazo_dias: number; tipo_prazo: "uteis" | "corridos"; tipo: "padrao" | "aprovacao_cliente" }[] {
  if (!Array.isArray(raw)) return [];
  const out: { nome: string; prazo_dias: number; tipo_prazo: "uteis" | "corridos"; tipo: "padrao" | "aprovacao_cliente" }[] = [];
  for (const e of raw) {
    if (!e || typeof e !== "object" || Array.isArray(e)) continue;
    const o = e as Record<string, unknown>;
    out.push({
      nome: typeof o.nome === "string" ? o.nome : "",
      prazo_dias: typeof o.prazo_dias === "number" ? o.prazo_dias : 0,
      tipo_prazo: o.tipo_prazo === "uteis" ? "uteis" : "corridos",
      tipo: o.tipo === "aprovacao_cliente" ? "aprovacao_cliente" : "padrao",
    });
  }
  return out;
}
