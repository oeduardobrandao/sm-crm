import { DEFAULT_BRAND_COLOR } from "./tokens.ts";

// deno-lint-ignore no-control-regex
const URL_SEGURA = /^https?:\/\/[^\s\x00-\x1f\x7f]+$/i;

/** Edge-function counterpart of the CRM's sanitizeUrl(): http(s) only, trimmed; null otherwise. */
export function linkSeguro(u: string | null | undefined): string | null {
  const t = u?.trim();
  return t && URL_SEGURA.test(t) ? t : null;
}

/** `#rrggbb` passes through; anything else (it lands inside style="") becomes the default. */
export function corSegura(c: string | null | undefined): string {
  return c && /^#[0-9a-fA-F]{6}$/.test(c) ? c : DEFAULT_BRAND_COLOR;
}
