import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { effectivePlanFeature } from "./entitlements-rpc.ts";
import { McpKeyContext, MCP_TOKEN_PREFIX, resolveMcpKey } from "./mcp-token.ts";

/**
 * Reads a claim from a JWT payload WITHOUT verifying the signature — the caller validates the
 * token separately (via auth.getUser). Used only to extract the OAuth client_id for grant lookup.
 */
export function decodeJwtClaim(token: string, claim: string): string | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(b64)) as Record<string, unknown>;
    const v = payload[claim];
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

/** Pure gate: grant exists, not revoked, the workspace's plan enables MCP, and the user is
 * STILL a member of that workspace. Membership is revalidated on every request so that removing
 * a user from the workspace immediately cuts MCP access, even if the grant wasn't revoked. */
export function grantActive(
  grant: { revoked_at: string | null } | null,
  featureEnabled: boolean,
  isMember: boolean,
): boolean {
  return (
    grant !== null && grant.revoked_at === null && featureEnabled === true && isMember === true
  );
}

/** True if the user currently holds a workspace_members row for the workspace. */
export async function isWorkspaceMember(
  db: SupabaseClient,
  userId: string,
  contaId: string,
): Promise<boolean> {
  const { data } = await db
    .from("workspace_members")
    .select("user_id")
    .eq("user_id", userId)
    .eq("workspace_id", contaId)
    .maybeSingle();
  return data !== null;
}

/**
 * Resolves a Supabase OAuth access token (JWT) to its workspace context: validate the token via
 * auth.getUser, extract the OAuth client_id, look up the consent grant → conta_id + scopes.
 * Returns null if the token is invalid/expired, there is no grant, it's revoked, or feature_mcp
 * is off for the workspace. (client_id + grant = the trust boundary; tokens aren't resource-bound.)
 */
export async function resolveOAuthCtx(
  db: SupabaseClient,
  token: string,
  _now: string,
): Promise<McpKeyContext | null> {
  const { data: { user }, error } = await db.auth.getUser(token);
  if (error || !user) return null;

  const clientId = decodeJwtClaim(token, "client_id") ?? decodeJwtClaim(token, "azp");
  if (!clientId) return null;

  const { data: grant } = await db
    .from("mcp_oauth_grants")
    .select("conta_id, scopes, revoked_at")
    .eq("user_id", user.id)
    .eq("client_id", clientId)
    .maybeSingle();
  if (!grant) return null;

  const contaId = grant.conta_id as string;
  const featureOn = await effectivePlanFeature(db, contaId, "feature_mcp");
  const isMember = await isWorkspaceMember(db, user.id, contaId);
  if (!grantActive(grant as { revoked_at: string | null }, featureOn, isMember)) return null;

  return {
    conta_id: grant.conta_id as string,
    scopes: (grant.scopes as string[]) ?? [],
    key_id: `oauth:${clientId}`,
    created_by: user.id as string,
  };
}

/**
 * Unified resolver: a static `mesaas_sk_` key OR a Supabase OAuth JWT. Returns the same
 * McpKeyContext the tools consume, so the tool layer stays auth-method agnostic.
 */
export async function resolveCtx(
  db: SupabaseClient,
  rawToken: string,
  now: string,
): Promise<McpKeyContext | null> {
  if (!rawToken) return null;
  if (rawToken.startsWith(MCP_TOKEN_PREFIX)) return resolveMcpKey(db, rawToken, now);
  return resolveOAuthCtx(db, rawToken, now);
}
