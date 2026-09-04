// Validação de banners globais. Compartilhado por platform-admin e mcp-admin. Avalia a linha
// MESCLADA (create: body; update: atual + patch), como admin-popups.ts.

export const BANNER_COLUMNS = [
  "type", "content", "link", "custom_color", "target_mode",
  "target_plan_ids", "target_workspace_ids", "dismissible",
  "starts_at", "ends_at", "status",
] as const;

const TYPES = ["info", "warning", "critical"];
const STATUSES = ["draft", "active", "archived"];
const MODES = ["all", "plan", "workspace"];
const LINK_RE = /^(\/(?!\/)|https:\/\/)/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const TEXT_COLUMNS = ["link", "custom_color"] as const;

export function pickBannerColumns(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of BANNER_COLUMNS) if (body[col] !== undefined) out[col] = body[col];
  return out;
}

/** Trim em content; trim + "" → null em link/custom_color, para persistir o que foi validado. */
export function normalizeBanner(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row };
  if (typeof out.content === "string") out.content = out.content.trim();
  for (const col of TEXT_COLUMNS) {
    if (typeof out[col] === "string") {
      const t = (out[col] as string).trim();
      out[col] = t.length > 0 ? t : null;
    }
  }
  return out;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string" && x.length > 0);
}

export function validateBanner(row: Record<string, unknown>): string | null {
  if (!TYPES.includes(row.type as string)) return "invalid type";
  const content = typeof row.content === "string" ? row.content.trim() : "";
  if (content.length === 0 || content.length > 500) return "content required (max 500)";

  const link = row.link ?? null;
  if (link !== null && (typeof link !== "string" || !LINK_RE.test(link.trim()) || link.length > 2048)) {
    return "link must start with / or https://";
  }
  const color = row.custom_color ?? null;
  if (color !== null && (typeof color !== "string" || !COLOR_RE.test(color.trim()))) {
    return "custom_color must be #rrggbb";
  }
  if (row.dismissible !== undefined && typeof row.dismissible !== "boolean") return "dismissible must be boolean";

  const status = row.status ?? "draft";
  if (!STATUSES.includes(status as string)) return "invalid status";

  const mode = row.target_mode;
  if (!MODES.includes(mode as string)) return "invalid target_mode";
  if (mode === "plan" && !isStringArray(row.target_plan_ids)) return "plan targeting needs at least one plan";
  if (mode === "workspace" && !isStringArray(row.target_workspace_ids)) {
    return "workspace targeting needs at least one workspace";
  }

  const start = typeof row.starts_at === "string" ? Date.parse(row.starts_at) : null;
  if (start !== null && Number.isNaN(start)) return "invalid schedule timestamps";
  const end = typeof row.ends_at === "string" ? Date.parse(row.ends_at) : null;
  if (end !== null && Number.isNaN(end)) return "invalid schedule timestamps";
  if (start !== null && end !== null && end <= start) return "ends_at must be after starts_at";
  return null;
}
