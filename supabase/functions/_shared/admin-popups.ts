// Validação e normalização de popups globais. Compartilhado por platform-admin (UI do Admin)
// e mcp-admin (agente): único lugar onde os limites de formato vivem, o banco só garante
// "array de 1..6". Puro, exceto adminContaId.

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
  alreadyAllowedKeys?: ReadonlySet<string>,
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
      !alreadyAllowedKeys?.has(image.value) &&
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

  const status = row.status ?? "draft";
  if (status !== "draft" && status !== "active" && status !== "archived") return "invalid status";

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

export function pickPopupColumns(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of POPUP_COLUMNS) {
    if (body[col] !== undefined) out[col] = body[col];
  }
  return out;
}

const TEXT_COLUMNS = ["cta_label", "cta_url", "secondary_label"] as const;

/** Trim + "" → null nas colunas de texto opcionais, para que o que persiste seja o
 * mesmo que validatePopupFields avaliou (senão "   " passa na validação e cai no CHECK). */
export function normalizePopupText(row: Record<string, unknown>): Record<string, unknown> {
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
// deno-lint-ignore no-explicit-any
export async function adminContaId(svc: { from: (table: string) => any }, userId: string): Promise<string | null> {
  const { data, error } = await svc.from("profiles").select("conta_id").eq("id", userId).maybeSingle();
  if (error) throw error;
  return (data?.conta_id as string | undefined) ?? null;
}

export function pagesHaveImages(pages: unknown): boolean {
  return (
    Array.isArray(pages) &&
    pages.some(
      (p) =>
        p && typeof p === "object" && typeof (p as Record<string, unknown>).image_key === "string" &&
        (p as Record<string, unknown>).image_key !== "",
    )
  );
}

/** image_key já persistidas na linha: podem ter sido enviadas por outro admin e continuam válidas. */
export function persistedImageKeys(pages: unknown): Set<string> {
  const keys = new Set<string>();
  if (!Array.isArray(pages)) return keys;
  for (const p of pages as Array<{ image_key?: unknown }>) {
    if (typeof p?.image_key === "string" && p.image_key) keys.add(p.image_key);
  }
  return keys;
}

export { IMAGE_KEY_RE };

/** image_key presentes em `pages` que ainda não estão em `persisted` (candidatas a finalize). */
export function newImageKeys(pages: unknown, persisted: ReadonlySet<string>): string[] {
  const out: string[] = [];
  if (!Array.isArray(pages)) return out;
  for (const p of pages as Array<{ image_key?: unknown }>) {
    const k = p?.image_key;
    if (typeof k === "string" && k !== "" && !persisted.has(k) && !out.includes(k)) out.push(k);
  }
  return out;
}
