// Allowlist de escopos do MCP do Admin da plataforma (spec 2026-09-04-mcp-admin §3.2).
// Sem imports de propósito: é importado por mcp-oauth.ts (consent) e mcp-admin-auth.ts
// (resource server) e não pode participar de ciclo.
//
// Bundlado em mcp-admin E mcp-oauth-consent: mudar um escopo exige redeploy dos dois
// mais o CRM (apps/crm/src/lib/mcp-scopes.ts espelha esta lista; não há import entre
// Deno e Vite).
export const ADMIN_MCP_ALLOWED_SCOPES = [
  "banners:read", "banners:write",
  "popups:read", "popups:write",
  "kb:read", "kb:write",
  "platform:read",
] as const;
export type AdminMcpScope = (typeof ADMIN_MCP_ALLOWED_SCOPES)[number];

/** Preset de menor privilégio: só leitura. */
export const ADMIN_MCP_READ_PRESET: AdminMcpScope[] = [
  "banners:read", "popups:read", "kb:read", "platform:read",
];

/** True se `scopes` é um array não vazio só com escopos da allowlist do admin. */
export function validateAdminScopes(scopes: unknown): scopes is string[] {
  return Array.isArray(scopes) && scopes.length > 0 &&
    scopes.every((s) => (ADMIN_MCP_ALLOWED_SCOPES as readonly string[]).includes(s as string));
}

/** Escopos do admin presentes num claim `scope` (string separada por espaço) ou `scopes` (array). */
export function adminScopesFromClaim(claim: unknown): string[] {
  let parts: string[] = [];
  if (typeof claim === "string") parts = claim.split(/\s+/).filter(Boolean);
  else if (Array.isArray(claim)) parts = claim.filter((s): s is string => typeof s === "string");
  const allowed = ADMIN_MCP_ALLOWED_SCOPES as readonly string[];
  return parts.filter((s) => allowed.includes(s));
}
