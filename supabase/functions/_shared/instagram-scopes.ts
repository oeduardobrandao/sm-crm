// Fonte ÚNICA da string de escopos (antes triplicada em instagram-integration
// e instagram-connect-link). Os opcionais NUNCA entram no check
// MISSING_PERMISSIONS nem no fallback otimista de permissions[] (fail-closed:
// só são registrados quando a Meta os devolve explicitamente).
export const IG_BASE_SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_insights",
  "instagram_business_content_publish",
] as const;

export const IG_OPTIONAL_SCOPES = ["instagram_business_manage_comments"] as const;

export const IG_ALL_SCOPES: readonly string[] = [...IG_BASE_SCOPES, ...IG_OPTIONAL_SCOPES];

/** Os opcionais só entram na URL de OAuth quando IG_AUTOMATION_SCOPES_LIVE
 * estiver ligada (Advanced Access aprovado, ou staging para teste com conta
 * com papel no app): pedir escopo sem Advanced Access para usuário sem papel
 * pode quebrar o dialog de login da Meta. */
export function buildScopeParam(includeOptional: boolean): string {
  return (includeOptional ? IG_ALL_SCOPES : IG_BASE_SCOPES).join(",");
}
