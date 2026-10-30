// deno-lint-ignore-file no-explicit-any
// Cards (MCP Apps): rollout switch, the ui:// resource and the _meta helpers shared by the card
// tools. Spec: docs/superpowers/specs/2026-10-29-mcp-apps-cards-design.md §3 and §4.2.
import type { Deps } from "./queries.ts";
import { CARDS_HTML } from "./ui/generated/cards.ts";

/** Hosts (ChatGPT above all) cache the card HTML by this URI, so a widget change only reaches
 * them under a new one: bump the version with every change to apps/mcp-widgets and move the
 * previous URI to LEGACY_CARDS_URIS. */
export const CARDS_URI = "ui://mesaas/cards-v3.html";
/** Earlier URIs, still served (with the current HTML) for hosts holding an old tool listing. */
export const LEGACY_CARDS_URIS = ["ui://mesaas/cards-v2.html", "ui://mesaas/cards-v1.html"];
export const CARDS_MIME = "text/html;profile=mcp-app";

/** `MCP_APPS`: `on` = every workspace, `pilot` = only the ids in `MCP_APPS_PILOT_CONTAS`
 * (comma-separated). Anything else, including a typo or different casing, is off. */
export function appsEnabledFor(
  contaId: string,
  env: { MCP_APPS?: string; MCP_APPS_PILOT_CONTAS?: string },
): boolean {
  if (env.MCP_APPS === "on") return true;
  if (env.MCP_APPS !== "pilot" || !contaId) return false;
  const pilot = (env.MCP_APPS_PILOT_CONTAS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return pilot.includes(contaId);
}

/** Origin `signGetUrl` signs against (_shared/r2.ts), the one host the card may load images from. */
export function r2OriginFrom(accountId: string | undefined): string | null {
  return accountId ? `https://${accountId}.r2.cloudflarestorage.com` : null;
}

/** `MCP_IMAGE_HOSTS` (the chat file hosts attach_image_to_post downloads from) as https origins: the
 * attach card shows the chat images before they reach the Mesaas, so the card's CSP lets it load them. */
export function imageHostOrigins(list: string | undefined): string[] {
  return (list ?? "").split(",").map((h) => h.trim().toLowerCase()).filter((h) => /^[a-z0-9.-]+$/.test(h))
    .map((h) => `https://${h}`);
}

/** Tools only the card itself calls (`visibility: ["app"]`) need OAuth: API-key connections have no widget host. */
export function widgetOnly(deps: Deps): boolean {
  return deps.apps?.enabled === true && deps.apps.oauth === true;
}

/** Tool `_meta` of a model-visible card tool. */
export function cardToolMeta() {
  return { ui: { resourceUri: CARDS_URI } };
}

/** Tool `_meta` of a tool only the widget calls. */
export function appOnlyToolMeta() {
  return { ui: { resourceUri: CARDS_URI, visibility: ["app"] } };
}

export function registerCardsResource(server: any, r2Origin: string | null): void {
  // No `ui.domain`: Claude and ChatGPT want incompatible values and the stateless server cannot tell
  // them apart (spec §4.2); only ChatGPT's `openai/widgetDomain` is set.
  const _meta = {
    ui: {
      prefersBorder: false,
      csp: {
        resourceDomains: [...(r2Origin ? [r2Origin] : []), ...imageHostOrigins(Deno.env.get("MCP_IMAGE_HOSTS"))],
        connectDomains: [],
      },
    },
    "openai/widgetDomain": "https://www.mesaas.com.br",
  };
  const register = (name: string, uri: string) =>
    server.registerResource(
      name,
      uri,
      { mimeType: CARDS_MIME, _meta },
      async () => ({ contents: [{ uri, mimeType: CARDS_MIME, text: CARDS_HTML, _meta }] }),
    );
  register("mesaas-cards", CARDS_URI);
  for (const uri of LEGACY_CARDS_URIS) register(`mesaas-cards-${uri.match(/cards-(v\d+)/)![1]}`, uri);
}
