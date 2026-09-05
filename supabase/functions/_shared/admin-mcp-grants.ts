// Grants OAuth do MCP do Admin da plataforma (admin_mcp_oauth_grants) -- lógica compartilhada
// entre mcp-oauth-consent (list-admin-grants/revoke-admin-grant, usado pela página /oauth de
// qualquer platform admin sobre os grants de TODOS os admins) e platform-admin
// (list-admin-mcp-grants/revoke-admin-mcp-grant, usado pela página Integrations do Admin).
// Ambos os call sites já checam isPlatformAdmin/o gate de admin antes de chamar estas funções --
// elas mesmas não fazem autorização.
// deno-lint-ignore-file no-explicit-any
import { insertAuditLog } from "./audit.ts";

export interface AdminMcpGrantRow {
  id: string;
  user_id: string;
  email: string | null;
  client_id: string;
  scopes: string[];
  created_at: string;
  revoked_at: string | null;
}

/** Lista todos os grants OAuth do MCP do Admin, mais recentes primeiro, com o e-mail do admin. */
export async function listAdminMcpGrants(svc: any): Promise<AdminMcpGrantRow[]> {
  const { data: grants } = await svc
    .from("admin_mcp_oauth_grants")
    .select("id, user_id, client_id, scopes, created_at, revoked_at")
    .order("created_at", { ascending: false });
  const rows = (grants ?? []) as Array<{
    id: string;
    user_id: string;
    client_id: string;
    scopes: string[];
    created_at: string;
    revoked_at: string | null;
  }>;
  const userIds = [...new Set(rows.map((g) => g.user_id))];
  const adminsResult = userIds.length
    ? await svc.from("platform_admins").select("user_id, email").in("user_id", userIds)
    : { data: [] as Array<{ user_id: string; email: string }> };
  const admins = (adminsResult.data ?? []) as Array<{ user_id: string; email: string }>;
  const emailByUser = new Map<string, string>(admins.map((a): [string, string] => [a.user_id, a.email]));
  return rows.map((g) => ({
    id: g.id,
    user_id: g.user_id,
    email: emailByUser.get(g.user_id) ?? null,
    client_id: g.client_id,
    scopes: g.scopes,
    created_at: g.created_at,
    revoked_at: g.revoked_at,
  }));
}

/**
 * Revoga um grant OAuth do MCP do Admin ainda ativo. Retorna `not_found` sem escrever audit se o
 * id não existir ou já estiver revogado (a checagem `.is("revoked_at", null)` garante isso na
 * própria query -- `.select().maybeSingle()` só devolve linha quando o UPDATE realmente aplicou).
 */
export async function revokeAdminMcpGrant(
  svc: any,
  grantId: string,
  actorUserId: string,
): Promise<{ ok: true } | { ok: false; reason: "not_found" }> {
  const { data, error } = await svc
    .from("admin_mcp_oauth_grants")
    .update({ revoked_at: new Date().toISOString(), revoked_by: actorUserId })
    .eq("id", grantId)
    .is("revoked_at", null)
    .select("id, client_id, user_id")
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, reason: "not_found" };
  await insertAuditLog(svc, {
    actor_user_id: actorUserId,
    action: "mcp_admin.oauth.revoke",
    resource_type: "admin_mcp_oauth_grant",
    resource_id: data.client_id as string,
    metadata: { grant_user_id: data.user_id },
  });
  return { ok: true };
}
