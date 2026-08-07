// MCP permission scopes shown in the CRM — single source of truth for both the API-key page
// (/configuracao/mcp) and the OAuth consent page (/oauth/consent). Mirror of MCP_ALLOWED_SCOPES
// in supabase/functions/_shared/mcp-token.ts (can't import across the Deno/Vite boundary).
export const SCOPE_OPTIONS = [
  { value: 'clientes:read', label: 'Clientes (leitura)' },
  { value: 'posts:read', label: 'Posts (leitura)' },
  { value: 'workflows:read', label: 'Fluxos (leitura)' },
  { value: 'ideias:read', label: 'Ideias/Pautas (leitura)' },
  { value: 'tarefas:read', label: 'Tarefas (leitura)' },
  { value: 'membros:read', label: 'Equipe (leitura)' },
  { value: 'posts:write', label: 'Posts (escrita)' },
  { value: 'templates:write', label: 'Modelos (escrita)' },
  { value: 'tarefas:write', label: 'Tarefas (escrita)' },
  { value: 'clientes:write', label: 'Clientes (escrita)' },
  { value: 'membros:write', label: 'Equipe (escrita)' },
] as const;

/** Least-privilege preset for a content agent — read scopes only. Write is opt-in. */
export const AGENT_PRESET: string[] = [
  'clientes:read',
  'posts:read',
  'workflows:read',
  'ideias:read',
  'tarefas:read',
  'membros:read',
];
