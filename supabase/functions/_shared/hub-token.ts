import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { effectivePlanFeature } from "./entitlements-rpc.ts";
import { getClientIP } from "./rate-limit.ts";

export interface HubToken { cliente_id: number; conta_id: string; is_active: boolean; }

/** Pure gate: active token AND feature enabled. */
export function hubTokenActive(tok: { is_active: boolean }, featureEnabled: boolean): boolean {
  return tok.is_active === true && featureEnabled === true;
}

export type HubTokenResult =
  | { ok: true; token: HubToken }
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "paused"; agencyName: string | null };

/**
 * true only when hub_workspace_paused answers exactly `true` (reverse trial
 * ended at least 7 days ago and the workspace is still on Free). An RPC error
 * reads as "not paused" (logged): the pause is commercial enforcement, and a
 * broken RPC must never take every agency's portal down with it.
 * Shared with resolveHubUrl, so an email never links to a paused portal.
 */
export async function hubWorkspacePaused(db: SupabaseClient, contaId: string): Promise<boolean> {
  try {
    const { data, error } = await db.rpc("hub_workspace_paused", { p_conta: contaId });
    if (error) {
      const code = (error as { code?: unknown }).code;
      console.error("[hub-token] hub_workspace_paused failed", typeof code === "string" ? code : "unknown");
      return false;
    }
    return data === true;
  } catch {
    console.error("[hub-token] hub_workspace_paused threw");
    return false;
  }
}

async function agencyNameOf(db: SupabaseClient, contaId: string): Promise<string | null> {
  try {
    const { data } = await db.from("workspaces").select("name").eq("id", contaId).maybeSingle();
    const name = (data as { name?: unknown } | null)?.name;
    return typeof name === "string" && name.trim() ? name : null;
  } catch {
    return null;
  }
}

/**
 * Resolves a hub token to its workspace, in this order:
 *   missing, expired or inactive token -> invalid
 *   workspace paused (reverse trial ended, hub_workspace_paused) -> paused + agency name
 *   feature_hub_portal off -> invalid
 * The pause comes before the feature gate on purpose: a paused workspace is on
 * Free, which may lack the feature, and must still get the paused page. An
 * inactive link stays "invalid": the paused page promises the same link works
 * again later.
 * Pass expectedContaId when the caller already resolved the workspace
 * (hub-bootstrap resolves by slug) to preserve the slug<->token binding, and
 * knownAgencyName when it already holds workspaces.name (saves a lookup).
 */
export async function resolveHubToken(
  db: SupabaseClient,
  token: string,
  now: string,
  expectedContaId?: string,
  knownAgencyName?: string | null,
): Promise<HubTokenResult> {
  let q = db.from("client_hub_tokens")
    .select("cliente_id, conta_id, is_active")
    .eq("token", token).gt("expires_at", now);
  if (expectedContaId) q = q.eq("conta_id", expectedContaId);
  const { data } = await q.maybeSingle();
  if (!data || data.is_active !== true) return { ok: false, reason: "invalid" };
  const contaId = data.conta_id as string;
  if (await hubWorkspacePaused(db, contaId)) {
    const agencyName = knownAgencyName !== undefined ? knownAgencyName : await agencyNameOf(db, contaId);
    return { ok: false, reason: "paused", agencyName };
  }
  const featureOn = await effectivePlanFeature(db, contaId, "feature_hub_portal");
  if (!hubTokenActive(data, featureOn)) return { ok: false, reason: "invalid" };
  return { ok: true, token: data as HubToken };
}

export const HUB_SESSION_HEADER = "x-hub-session";
const MAX_SESSION_LENGTH = 200;

export interface HubPerson { id: string; nome: string; email: string }

export type HubAccess =
  | { ok: true; token: HubToken; person: HubPerson | null; requireLogin: boolean }
  | { ok: false; reason: "invalid" | "login_required" | "error" }
  | { ok: false; reason: "paused"; agencyName: string | null };

export type HubAccessDeniedReason = "invalid" | "login_required" | "error" | "paused";

// Hand-off of a paused workspace's agency name from resolveHubAccess to
// hubAccessDenied. Every hub-* handler calls
// hubAccessDenied(access.reason, { req, ... }) with the same Request object it
// gave resolveHubAccess, so the name rides on the request with no handler change.
const pausedAgencyByRequest = new WeakMap<Request, string | null>();

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
  db: SupabaseClient,
  req: Request,
  token: string,
  now: string,
  expectedContaId?: string,
  knownAgencyName?: string | null,
): Promise<HubAccess> {
  try {
    const resolved = await resolveHubToken(db, token, now, expectedContaId, knownAgencyName);
    if (!resolved.ok) {
      if (resolved.reason === "paused") {
        pausedAgencyByRequest.set(req, resolved.agencyName);
        return { ok: false, reason: "paused", agencyName: resolved.agencyName };
      }
      return { ok: false, reason: "invalid" };
    }
    const hubToken = resolved.token;

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

/** Body of the paused answer. It never carries a session-clearing signal. */
export function hubPausedBody(agencyName: string | null) {
  return { error: "Portal pausado.", code: "hub_paused" as const, agency_name: agencyName };
}

/**
 * Response for a failed access. `invalid` keeps the pre-login behaviour.
 * `paused` answers 403 hub_paused without touching the bad-token rate limit;
 * the agency name is `agencyName` when given, else the one resolveHubAccess
 * found for the same `req`.
 */
export async function hubAccessDenied(
  reason: HubAccessDeniedReason,
  ctx: {
    db: unknown; req: Request;
    json: (body: unknown, status?: number) => Response;
    // deno-lint-ignore no-explicit-any
    rateLimit: (db: any, key: string, max: number, windowSeconds: number) => Promise<boolean>;
  },
  agencyName?: string | null,
): Promise<Response> {
  if (reason === "paused") {
    const name = agencyName !== undefined ? agencyName : (pausedAgencyByRequest.get(ctx.req) ?? null);
    return ctx.json(hubPausedBody(name), 403);
  }
  if (reason === "login_required") {
    return ctx.json({ error: "Login necessário.", code: "login_required" }, 401);
  }
  if (reason === "error") return ctx.json({ error: "Erro interno." }, 500);
  const ok = await ctx.rateLimit(ctx.db, `hub-badtoken:${getClientIP(ctx.req)}`, 30, 600);
  if (!ok) return ctx.json({ error: "Muitas tentativas. Aguarde alguns minutos." }, 429);
  return ctx.json({ error: "Link inválido." }, 404);
}
