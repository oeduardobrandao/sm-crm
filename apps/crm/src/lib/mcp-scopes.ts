// MCP permission scopes shown in the CRM — single source of truth for both the API-key page
// (/configuracao/mcp) and the OAuth consent page (/oauth/consent). Mirror of MCP_ALLOWED_SCOPES
// in supabase/functions/_shared/mcp-token.ts (can't import across the Deno/Vite boundary).
export const SCOPE_OPTIONS = [
  { value: 'clientes:read', label: 'Clientes (leitura)' },
  { value: 'posts:read', label: 'Posts (leitura)' },
  { value: 'workflows:read', label: 'Fluxos (leitura)' },
  { value: 'ideias:read', label: 'Ideias/Pautas (leitura)' },
] as const;

/** Least-privilege preset for a content-writing agent — every read scope. */
export const AGENT_PRESET: string[] = SCOPE_OPTIONS.map((s) => s.value);
