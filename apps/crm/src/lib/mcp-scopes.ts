import { i18n } from '@mesaas/i18n';

// MCP permission scopes shown in the CRM — single source of truth for both the API-key page
// (/configuracao/mcp) and the OAuth consent page (/oauth/consent). Mirror of MCP_ALLOWED_SCOPES
// in supabase/functions/_shared/mcp-token.ts (can't import across the Deno/Vite boundary).
// `ownerOnly` mirrors OWNER_ONLY_SCOPES there: the pickers disable those for non-owners and the
// edge functions (mcp-keys, mcp-oauth-consent, mcp) enforce it.
export const SCOPE_OPTIONS = [
  { value: 'clientes:read', label: 'Clientes (leitura)', ownerOnly: false },
  { value: 'posts:read', label: 'Posts (leitura)', ownerOnly: false },
  { value: 'workflows:read', label: 'Fluxos (leitura)', ownerOnly: false },
  { value: 'ideias:read', label: 'Ideias/Pautas (leitura)', ownerOnly: false },
  { value: 'tarefas:read', label: 'Tarefas (leitura)', ownerOnly: false },
  { value: 'membros:read', label: 'Equipe (leitura)', ownerOnly: false },
  { value: 'posts:write', label: 'Posts (escrita)', ownerOnly: false },
  { value: 'templates:write', label: 'Modelos (escrita)', ownerOnly: false },
  { value: 'tarefas:write', label: 'Tarefas (escrita)', ownerOnly: false },
  { value: 'clientes:write', label: 'Clientes (escrita)', ownerOnly: false },
  { value: 'membros:write', label: 'Equipe (escrita)', ownerOnly: false },
  { value: 'financeiro:read', label: 'Financeiro (leitura, só donos)', ownerOnly: true },
  { value: 'financeiro:write', label: 'Financeiro (escrita, só donos)', ownerOnly: true },
] as const;

/** Helper text shown under an owner-only scope the current user cannot tick. */
export const OWNER_ONLY_HELP = 'Somente o dono do workspace';

/** Copy for the `owner_only_scope` error from mcp-keys and mcp-oauth-consent (one string, both pages). */
export const OWNER_ONLY_SCOPE_ERROR =
  'As permissões do Financeiro são somente do dono do workspace.';

/** Whether `scope` (a `SCOPE_OPTIONS` value) is reserved for the workspace owner. */
export function isOwnerOnlyScope(scope: string): boolean {
  return SCOPE_OPTIONS.some((s) => s.value === scope && s.ownerOnly);
}

/** Least-privilege preset for a content agent — read scopes only. Write is opt-in. */
export const AGENT_PRESET: string[] = [
  'clientes:read',
  'posts:read',
  'workflows:read',
  'ideias:read',
  'tarefas:read',
  'membros:read',
];

// Escopos do MCP do Admin da plataforma. Espelho de ADMIN_MCP_ALLOWED_SCOPES em
// supabase/functions/_shared/mcp-admin-scopes.ts.
export const ADMIN_SCOPE_OPTIONS = [
  { value: 'banners:read', label: 'Banners (leitura)' },
  { value: 'banners:write', label: 'Banners (escrita)' },
  { value: 'popups:read', label: 'Popups (leitura)' },
  { value: 'popups:write', label: 'Popups (escrita)' },
  { value: 'kb:read', label: 'Artigos de suporte (leitura)' },
  { value: 'kb:write', label: 'Artigos de suporte (escrita)' },
  { value: 'platform:read', label: 'Plataforma: workspaces, planos e dashboard (leitura)' },
  { value: 'blog:read', label: 'Blog (leitura)' },
  { value: 'blog:write', label: 'Blog (escrita)' },
] as const;

export const ADMIN_READ_PRESET: string[] = [
  'banners:read',
  'popups:read',
  'kb:read',
  'platform:read',
  'blog:read',
];

/**
 * `SCOPE_OPTIONS` label / owner-only copy in the current UI language, for the translated settings
 * pages. Read at call time; falls back to the Portuguese constant while the `mcp` bundle loads.
 * The consent page (not translated yet) keeps reading the constants.
 */
export function scopeLabel(scope: string): string {
  const pt = SCOPE_OPTIONS.find((s) => s.value === scope)?.label ?? scope;
  return i18n.t(`mcp:scopes.${scope.replace(':', '_')}`, { defaultValue: pt });
}

export function ownerOnlyHelp(): string {
  return i18n.t('mcp:scopes.ownerOnlyHelp', { defaultValue: OWNER_ONLY_HELP });
}

export function ownerOnlyScopeError(): string {
  return i18n.t('mcp:scopes.ownerOnlyError', { defaultValue: OWNER_ONLY_SCOPE_ERROR });
}
