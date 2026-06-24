// MCP permission scopes shown in the CRM — single source of truth for both the API-key page
// (/configuracao/mcp) and the OAuth consent page (/oauth/consent). Mirror of MCP_ALLOWED_SCOPES
// in supabase/functions/_shared/mcp-token.ts (can't import across the Deno/Vite boundary).
export const SCOPE_OPTIONS = [
  { value: 'clientes:read', label: 'Clientes (leitura)' },
  { value: 'posts:read', label: 'Posts (leitura)' },
  { value: 'workflows:read', label: 'Fluxos (leitura)' },
  { value: 'ideias:read', label: 'Ideias/Pautas (leitura)' },
  { value: 'posts:write', label: 'Posts (escrita)' },
] as const;

/** Least-privilege preset for a content agent — read scopes only. Write is opt-in. */
export const AGENT_PRESET: string[] = [
  'clientes:read', 'posts:read', 'workflows:read', 'ideias:read',
];
