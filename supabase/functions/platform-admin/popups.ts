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
const CTA_URL_RE = /^(\/|https?:\/\/)/;

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
  return null;
}

// Usado só para o tipo; os handlers entram na Task 3.
export type Svc = SupabaseClient;
