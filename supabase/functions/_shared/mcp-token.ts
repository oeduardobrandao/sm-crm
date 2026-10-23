import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { effectivePlanFeature } from "./entitlements-rpc.ts";

export const MCP_TOKEN_PREFIX = "mesaas_sk_";

// Scopes that map to a backing tool. Read scopes + the write scopes for posts/templates/tarefas/clientes/membros.
// The retired Estúdio scopes (designs:write, images:generate) are deliberately absent: existing
// keys/grants may still carry those strings, and dropping them here is what makes them inert —
// validateScopes rejects them on creation and the OAuth resolver filters them out of a grant.
export const MCP_ALLOWED_SCOPES = [
  "clientes:read", "posts:read", "workflows:read", "ideias:read", "tarefas:read", "membros:read",
  "posts:write", "templates:write", "tarefas:write", "clientes:write", "membros:write",
  // Owner-only (OWNER_ONLY_SCOPES): never in MCP_AGENT_PRESET.
  "financeiro:read", "financeiro:write",
] as const;
export type McpScope = (typeof MCP_ALLOWED_SCOPES)[number];

/** Least-privilege preset for a content-writing agent (read-only). */
export const MCP_AGENT_PRESET: McpScope[] = [
  "clientes:read", "posts:read", "workflows:read", "ideias:read", "tarefas:read", "membros:read",
];

/** True if `scopes` is a non-empty array of allowlisted scope strings. */
export function validateScopes(scopes: unknown): scopes is string[] {
  return Array.isArray(scopes) && scopes.length > 0 &&
    scopes.every((s) => (MCP_ALLOWED_SCOPES as readonly string[]).includes(s as string));
}

export interface McpKeyRow {
  id: string;
  conta_id: string;
  created_by: string;
  scopes: string[];
  expires_at: string | null;
  revoked_at: string | null;
}

export interface McpKeyContext {
  conta_id: string;
  scopes: string[];
  key_id: string;
  created_by: string;
  /** Papel do principal (`created_by`) em workspace_members do `conta_id`, lido a cada requisição.
   * Ausente ou null conta como não-dono. Opcional para os contextos montados à mão nos testes. */
  role?: string | null;
}

/** SHA-256 hex digest of the raw token. Deterministic — safe to store/compare. */
export async function hashToken(rawToken: string): Promise<string> {
  const bytes = new TextEncoder().encode(rawToken);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Generates a new API key. Returns the raw token (shown to the user ONCE), its hash
 * (stored), and the 4-char suffix (stored, for masked display). Used by the create-key
 * edge function in PR 2.
 */
export async function generateApiKey(): Promise<{ raw: string; hash: string; suffix: string }> {
  const rand = crypto.getRandomValues(new Uint8Array(32));
  const body = Array.from(rand).map((b) => b.toString(16).padStart(2, "0")).join("");
  const raw = `${MCP_TOKEN_PREFIX}${body}`;
  return { raw, hash: await hashToken(raw), suffix: raw.slice(-4) };
}

/** Pure gate: not revoked, not expired, and the workspace's plan enables MCP. */
export function mcpKeyActive(
  row: { revoked_at: string | null; expires_at: string | null },
  featureEnabled: boolean,
  now: string,
): boolean {
  if (!featureEnabled) return false;
  if (row.revoked_at !== null) return false;
  if (row.expires_at !== null && row.expires_at <= now) return false;
  return true;
}

/** Pure scope check. Scopes look like `posts:read`, `clientes:read`. */
export function hasScope(scopes: string[], required: string): boolean {
  return scopes.includes(required);
}

export class McpScopeError extends Error {
  constructor(public scope: string) {
    super(`scope_required:${scope}`);
  }
}

/**
 * A safe, caller-facing validation error. Its message IS returned to the client
 * (it only describes the caller's own workspace) — unlike internal errors, which
 * stay generic.
 */
export class McpInputError extends Error {}

/** Refusal for a non-owner calling an owner-only (Financeiro) tool. */
export class McpOwnerError extends Error {
  constructor() {
    super("owner_only");
  }
}

/** Scopes that only the workspace owner may hold (checked at issue time and on every call). */
export const OWNER_ONLY_SCOPES = ["financeiro:read", "financeiro:write"] as const;

/** True if `scopes` carries an owner-only scope and `role` is not 'owner'. */
export function ownerOnlyScopeViolation(scopes: string[], role?: string | null): boolean {
  if (role === "owner") return false;
  return scopes.some((s) => (OWNER_ONLY_SCOPES as readonly string[]).includes(s));
}

/** Throws McpOwnerError unless the principal is the workspace owner. */
export function requireOwner(ctx: McpKeyContext): void {
  if (ctx.role !== "owner") throw new McpOwnerError();
}

/** The user's role in the workspace (workspace_members.role), or null when not a member.
 * A failed read throws (fail loud): it must never be mistaken for "not a member" or open a gate. */
export async function memberRole(
  db: SupabaseClient,
  userId: string,
  contaId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from("workspace_members")
    .select("role")
    .eq("user_id", userId)
    .eq("workspace_id", contaId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const role = (data as { role?: unknown }).role;
  return typeof role === "string" ? role : null;
}

/** Throws McpScopeError if `ctx` lacks `scope`. */
export function requireScope(ctx: McpKeyContext, scope: string): void {
  if (!hasScope(ctx.scopes, scope)) throw new McpScopeError(scope);
}

/**
 * Resolves a raw API key to its workspace context, enforcing feature_mcp, revocation and expiry.
 * Returns null for any invalid/inactive/feature-disabled key. Bumps last_used_at (best-effort).
 */
export async function resolveMcpKey(
  db: SupabaseClient,
  rawToken: string,
  now: string,
): Promise<McpKeyContext | null> {
  if (!rawToken || !rawToken.startsWith(MCP_TOKEN_PREFIX)) return null;
  const tokenHash = await hashToken(rawToken);
  const { data } = await db
    .from("mcp_api_keys")
    .select("id, conta_id, created_by, scopes, expires_at, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (!data) return null;

  const featureOn = await effectivePlanFeature(db, data.conta_id as string, "feature_mcp");
  if (!mcpKeyActive(data as McpKeyRow, featureOn, now)) return null;

  // Best-effort usage timestamp; never block resolution on it.
  try {
    await db.from("mcp_api_keys").update({ last_used_at: now }).eq("id", data.id);
  } catch (_e) {
    // ignore
  }

  // Role is read on every request: a creator demoted from owner loses Financeiro access at once.
  const role = await memberRole(db, data.created_by as string, data.conta_id as string);

  return {
    conta_id: data.conta_id as string,
    scopes: (data.scopes as string[]) ?? [],
    key_id: data.id as string,
    created_by: data.created_by as string,
    role,
  };
}
