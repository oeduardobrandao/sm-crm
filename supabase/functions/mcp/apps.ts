// deno-lint-ignore-file no-explicit-any
// Cards (MCP Apps): rollout switch, the ui:// resource and the _meta helpers shared by the card
// tools. Spec: docs/superpowers/specs/2026-10-29-mcp-apps-cards-design.md §3 and §4.2.
import type { Deps } from "./queries.ts";
import { CARDS_V1_HTML } from "./ui/generated/cards-v1.ts";

export const CARDS_URI = "ui://mesaas/cards-v1.html";
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
      csp: { resourceDomains: r2Origin ? [r2Origin] : [], connectDomains: [] },
    },
    "openai/widgetDomain": "https://www.mesaas.com.br",
  };
  server.registerResource(
    "mesaas-cards",
    CARDS_URI,
    { mimeType: CARDS_MIME, _meta },
    async () => ({ contents: [{ uri: CARDS_URI, mimeType: CARDS_MIME, text: CARDS_V1_HTML, _meta }] }),
  );
}
