import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { effectivePlanFeature } from "./entitlements-rpc.ts";
import { getClientIP } from "./rate-limit.ts";

export interface HubToken { cliente_id: number; conta_id: string; is_active: boolean; }

/** Pure gate: active token AND feature enabled. */
export function hubTokenActive(tok: { is_active: boolean }, featureEnabled: boolean): boolean {
  return tok.is_active === true && featureEnabled === true;
}

/**
 * Resolves a hub token to its workspace and enforces feature_hub_portal.
 * Returns the token row, or null if missing/inactive/feature-disabled.
 * Pass expectedContaId when the caller already resolved the workspace
 * (hub-bootstrap resolves by slug) to preserve the slug<->token binding.
 */
export async function resolveHubToken(
  db: SupabaseClient, token: string, now: string, expectedContaId?: string,
): Promise<HubToken | null> {
  let q = db.from("client_hub_tokens")
    .select("cliente_id, conta_id, is_active")
    .eq("token", token).gt("expires_at", now);
  if (expectedContaId) q = q.eq("conta_id", expectedContaId);
  const { data } = await q.maybeSingle();
  if (!data) return null;
  const featureOn = await effectivePlanFeature(db, data.conta_id as string, "feature_hub_portal");
  if (!hubTokenActive(data, featureOn)) return null;
  return data as HubToken;
}

export const HUB_SESSION_HEADER = "x-hub-session";
const MAX_SESSION_LENGTH = 200;

export interface HubPerson { id: string; nome: string; email: string }

export type HubAccess =
  | { ok: true; token: HubToken; person: HubPerson | null; requireLogin: boolean }
  | { ok: false; reason: "invalid" | "login_required" | "error" };

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function parseHubPerson(v: unknown): HubPerson | null | undefined {
  if (v === null) return null;
  if (typeof v !== "object" || Array.isArray(v)) return undefined;
  const p = v as Record<string, unknown>;
  if (typeof p.id !== "string" || typeof p.nome !== "string" || typeof p.email !== "string") return undefined;
  return { id: p.id, nome: p.nome, email: p.email };
}

/**
 * Resolves the hub token (unchanged rules) and then the client login state via
 * hub_access_context. Fails closed: any unexpected RPC outcome is "error".
 * The session token and its hash are never logged.
 */
export async function resolveHubAccess(
  db: SupabaseClient, req: Request, token: string, now: string, expectedContaId?: string,
): Promise<HubAccess> {
  try {
    const hubToken = await resolveHubToken(db, token, now, expectedContaId);
    if (!hubToken) return { ok: false, reason: "invalid" };

    const raw = req.headers.get(HUB_SESSION_HEADER);
    const session = raw && raw.length <= MAX_SESSION_LENGTH ? raw : null;
    const sessionHash = session ? await sha256Hex(session) : null;

    const { data, error } = await db.rpc("hub_access_context", {
      p_cliente_id: hubToken.cliente_id,
      p_session_hash: sessionHash,
    });
    if (error) {
      console.error("[hub-access] hub_access_context failed", error);
      return { ok: false, reason: "error" };
    }
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      console.error("[hub-access] hub_access_context returned unexpected data");
      return { ok: false, reason: "error" };
    }
    const d = data as Record<string, unknown>;
    const person = parseHubPerson(d.person);
    if (typeof d.require_login !== "boolean" || person === undefined) {
      console.error("[hub-access] hub_access_context returned malformed data");
      return { ok: false, reason: "error" };
    }
    if (d.require_login && !person) return { ok: false, reason: "login_required" };
    return { ok: true, token: hubToken, person, requireLogin: d.require_login };
  } catch (err) {
    console.error("[hub-access] unexpected failure", err);
    return { ok: false, reason: "error" };
  }
}

/** Response for a failed access. `invalid` keeps the pre-login behaviour. */
export async function hubAccessDenied(
  reason: "invalid" | "login_required" | "error",
  ctx: {
    db: unknown; req: Request;
    json: (body: unknown, status?: number) => Response;
    // deno-lint-ignore no-explicit-any
    rateLimit: (db: any, key: string, max: number, windowSeconds: number) => Promise<boolean>;
  },
): Promise<Response> {
  if (reason === "login_required") {
    return ctx.json({ error: "Login necessário.", code: "login_required" }, 401);
  }
  if (reason === "error") return ctx.json({ error: "Erro interno." }, 500);
  const ok = await ctx.rateLimit(ctx.db, `hub-badtoken:${getClientIP(ctx.req)}`, 30, 600);
  if (!ok) return ctx.json({ error: "Muitas tentativas. Aguarde alguns minutos." }, 429);
  return ctx.json({ error: "Link inválido." }, 404);
}
