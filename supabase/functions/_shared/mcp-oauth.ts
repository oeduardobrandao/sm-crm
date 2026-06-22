import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { effectivePlanFeature } from "./entitlements-rpc.ts";
import {
  MCP_ALLOWED_SCOPES,
  McpKeyContext,
  MCP_TOKEN_PREFIX,
  resolveMcpKey,
  validateScopes,
} from "./mcp-token.ts";

/**
 * The public origin to advertise in OAuth discovery URLs. `req.url` carries Supabase's internal
 * `http` scheme behind the proxy, so we trust `x-forwarded-proto` when present, else assume `https`
 * for a public host (localhost stays `http` for `functions serve`). Discovery URLs MUST be https —
 * Claude rejects/mishandles an http authorization server or resource identifier.
 */
export function publicOrigin(reqUrl: string, forwardedProto: string | null): string {
  const u = new URL(reqUrl);
  const isLocal = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  const proto = forwardedProto ?? (isLocal ? "http" : "https");
  return `${proto}://${u.host}`;
}

export interface ConsentPayload {
  authorization_id: string;
  conta_id: string;
  scopes: string[];
}

/**
 * Pure validation of the consent edge function's `approve` body. The OAuth client_id is NOT taken
 * from the body — the function derives it server-side from the verified authorization_id (so the
 * browser can't bind a grant to an arbitrary client). conta_id is the chosen workspace; scopes is
 * the user's non-empty subset of the MCP allowlist (further bounded server-side by the request).
 */
export function validateConsentPayload(
  body: Record<string, unknown>,
): { ok: true; value: ConsentPayload } | { ok: false; error: string } {
  const authorization_id = typeof body.authorization_id === "string"
    ? body.authorization_id.trim()
    : "";
  const conta_id = typeof body.conta_id === "string" ? body.conta_id.trim() : "";
  if (!authorization_id) return { ok: false, error: "authorization_id required" };
  if (!conta_id) return { ok: false, error: "conta_id required" };
  if (!validateScopes(body.scopes)) return { ok: false, error: "invalid scopes" };
  return { ok: true, value: { authorization_id, conta_id, scopes: body.scopes as string[] } };
}

/**
 * Decodes a JWT payload WITHOUT verifying the signature — the caller validates the token separately
 * (via auth.getUser). Used to read non-sensitive claims (client_id, granted scope).
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    return JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))) as Record<
      string,
      unknown
    >;
  } catch {
    return null;
  }
}

/** Reads a single string claim from a JWT payload (null if missing/non-string/malformed). */
export function decodeJwtClaim(token: string, claim: string): string | null {
  const v = decodeJwtPayload(token)?.[claim];
  return typeof v === "string" ? v : null;
}

/**
 * Extracts the MCP-domain scopes (allowlist only) from an OAuth `scope` claim, which may be a
 * space-delimited string ("scope") or a string array ("scopes"). Non-MCP/OIDC scopes are dropped.
 */
export function mcpScopesFromClaim(claim: unknown): string[] {
  let parts: string[] = [];
  if (typeof claim === "string") parts = claim.split(/\s+/).filter(Boolean);
  else if (Array.isArray(claim)) parts = claim.filter((s): s is string => typeof s === "string");
  const allowed = MCP_ALLOWED_SCOPES as readonly string[];
  return parts.filter((s) => allowed.includes(s));
}

/**
 * Bounds the user-approved scopes by what the OAuth request actually named. If the request named
 * MCP scopes, the grant can't exceed them (intersection). If it named none — the generic-OAuth case
 * where the client doesn't forward our resource scopes — the user's explicit consent stands.
 */
export function boundGrantScopes(approved: string[], requestedMcp: string[]): string[] {
  if (requestedMcp.length === 0) return approved;
  return approved.filter((s) => requestedMcp.includes(s));
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

  // Enforce the token's granted scopes: when the JWT carries MCP-domain scopes (the client
  // forwarded our advertised scopes), the effective scopes are grant ∩ token. When it carries none
  // (generic OAuth), the grant — the user's explicit consent — stands. (Token scope propagation is
  // to be re-confirmed empirically once Supabase's OAuth server is enabled.)
  const payload = decodeJwtPayload(token);
  const tokenMcp = mcpScopesFromClaim(payload?.scope ?? payload?.scopes ?? null);
  const scopes = boundGrantScopes((grant.scopes as string[]) ?? [], tokenMcp);

  return {
    conta_id: contaId,
    scopes,
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
