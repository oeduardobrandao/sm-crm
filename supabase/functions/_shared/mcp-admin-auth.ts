// Auth do MCP do Admin da plataforma. Só OAuth (JWT do Supabase): não há chave estática.
// Ctx = platform_admins.id + auth uid + scopes do grant em admin_mcp_oauth_grants.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { boundGrantScopes, decodeJwtClaim, decodeJwtPayload } from "./mcp-oauth.ts";
import { McpScopeError } from "./mcp-token.ts";
import { adminScopesFromClaim } from "./mcp-admin-scopes.ts";

export interface AdminMcpContext {
  /** platform_admins.id: vai em created_by / author_id. */
  admin_id: string;
  /** auth.users.id: actor do audit e dono das imagens (files.uploaded_by). */
  user_id: string;
  scopes: string[];
  /** `oauth:<client_id>`: chave do rate limit e do audit. */
  key_id: string;
}

/** Gate puro: grant existe, não foi revogado e o usuário AINDA é platform_admin. */
export function adminGrantActive(
  grant: { revoked_at: string | null } | null,
  isAdmin: boolean,
): boolean {
  return grant !== null && grant.revoked_at === null && isAdmin === true;
}

/**
 * Resolve um access token OAuth do Supabase para o contexto do admin. platform_admins é
 * consultada a cada request: remover o admin corta o acesso sem depender de revogar o grant.
 * Null para token inválido, sem client_id, usuário não-admin, grant ausente ou revogado.
 */
export async function resolveAdminCtx(
  db: SupabaseClient,
  token: string,
): Promise<AdminMcpContext | null> {
  if (!token) return null;
  const { data: { user }, error } = await db.auth.getUser(token);
  if (error || !user) return null;

  const clientId = decodeJwtClaim(token, "client_id") ?? decodeJwtClaim(token, "azp");
  if (!clientId) return null;

  const { data: admin } = await db
    .from("platform_admins")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!admin) return null;

  const { data: grant } = await db
    .from("admin_mcp_oauth_grants")
    .select("scopes, revoked_at")
    .eq("user_id", user.id)
    .eq("client_id", clientId)
    .maybeSingle();
  if (!adminGrantActive(grant as { revoked_at: string | null } | null, true)) return null;

  // grant ∩ token quando o token nomeia escopos do admin; só o grant quando não nomeia
  // (o AS do Supabase só conhece escopos OIDC, então hoje é sempre o segundo caso).
  const payload = decodeJwtPayload(token);
  const tokenScopes = adminScopesFromClaim(payload?.scope ?? payload?.scopes ?? null);
  const scopes = boundGrantScopes(((grant as { scopes?: string[] }).scopes ?? []), tokenScopes);

  return {
    admin_id: (admin as { id: string }).id,
    user_id: user.id as string,
    scopes,
    key_id: `oauth:${clientId}`,
  };
}

/** Lança McpScopeError se `ctx` não tem `scope`. */
export function requireAdminScope(ctx: AdminMcpContext, scope: string): void {
  if (!ctx.scopes.includes(scope)) throw new McpScopeError(scope);
}
