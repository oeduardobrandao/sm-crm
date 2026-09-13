// Escopos do MCP do Admin da plataforma, para a página Integrations. Espelho manual de
// ADMIN_MCP_ALLOWED_SCOPES em supabase/functions/_shared/mcp-admin-scopes.ts (mesma lista já
// espelhada em apps/crm/src/lib/mcp-scopes.ts para a tela de consentimento OAuth do CRM — essa
// cópia tem um teste de guarda de sincronia em
// supabase/functions/__tests__/mcp-admin-auth_test.ts; esta, no Admin, não).
export const ADMIN_SCOPES = [
  { value: 'banners:read', label: 'Banners (leitura)' },
  { value: 'banners:write', label: 'Banners (escrita)' },
  { value: 'popups:read', label: 'Popups (leitura)' },
  { value: 'popups:write', label: 'Popups (escrita)' },
  { value: 'kb:read', label: 'Artigos de suporte (leitura)' },
  { value: 'kb:write', label: 'Artigos de suporte (escrita)' },
  { value: 'platform:read', label: 'Plataforma: workspaces, planos e dashboard (leitura)' },
] as const;
