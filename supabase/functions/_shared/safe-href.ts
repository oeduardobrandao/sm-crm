// Guarda de href para links que o CRM renderiza para todos os workspaces (banners, popups,
// artigos da KB). Aceita caminho relativo (/…) ou URL absoluta; rejeita qualquer caractere de
// controle ou espaço em branco em QUALQUER posição: o parser de URL do browser remove tab/CR/LF
// antes de interpretar, então "/\t\\evil.com" viraria "/\\evil.com" → https://evil.com.
// Também rejeita // e /\ logo após a barra inicial (authority = host externo).

const CONTROL_OR_SPACE = /[\x00-\x20\x7F]/;
const RELATIVE_RE = /^\/(?![\/\\])/;

/** True se `value` é um href seguro. `allowHttp` libera http:// além de https://. */
export function isSafeHref(value: string, opts: { allowHttp?: boolean } = {}): boolean {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return false;
  if (CONTROL_OR_SPACE.test(value)) return false;
  if (RELATIVE_RE.test(value)) return true;
  if (value.startsWith("https://")) return true;
  return opts.allowHttp === true && value.startsWith("http://");
}
