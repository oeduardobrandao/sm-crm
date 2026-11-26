import { createJsonResponder, type JsonResponder } from "../_shared/http.ts";
import { HUB_SESSION_HEADER, hubAccessDenied, resolveHubToken, sha256Hex } from "../_shared/hub-token.ts";
import { getClientIP } from "../_shared/rate-limit.ts";
import { CODE_RE, normalizeEmail } from "./logic.ts";
import { type Lang, resolveLang } from "../_shared/i18n/lang.ts";
import { hubLoginText } from "../_shared/i18n/catalogs/hub-login.ts";

type DbClient = {
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any;
  rpc: (fn: string, params: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
};

export interface HubAuthDeps {
  buildCorsHeaders: (req: Request) => Record<string, string>;
  createDb: () => DbClient;
  now: () => string;
  rateLimit: (db: DbClient, key: string, max: number, windowSeconds: number) => Promise<boolean>;
  /** 6 digits, CSPRNG, rejection sampling (no modulo bias). */
  generateCode: () => string;
  /** base64Url of 32 random bytes. */
  generateSessionToken: () => string;
  sendCodeEmail: (input: {
    to: string;
    code: string;
    workspaceName: string;
    brandColor: string | null;
    logoUrl: string | null;
    lang: Lang;
  }) => Promise<void>;
  /** EdgeRuntime.waitUntil in index.ts; awaits nothing. */
  defer: (work: Promise<unknown>) => void;
}

const MAX_SESSION_LENGTH = 200;
// Human text follows the workspace language once the link is resolved; before that (and on
// any failure) it is pt. Error codes and statuses never change with language.
const tooMany = (lang: Lang) => ({ error: hubLoginText(lang).tooMany });
const invalidCode = (lang: Lang) => ({ error: hubLoginText(lang).invalidCode, code: "invalid_code" });
const badRequest = (lang: Lang) => ({ error: hubLoginText(lang).badRequest });
const internal = (lang: Lang) => ({ error: hubLoginText(lang).internal });

// Logs carry only a fixed message and the PostgREST/Postgres error code: an
// error message or detail can echo parameters (the code, the session hash).
function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "unknown";
}

type Workspace = {
  id: string;
  name: string;
  logo_url: string | null;
  brand_color: string | null;
  language?: unknown;
};

type LinkResult =
  | { ok: true; workspace: Workspace; clienteId: number; lang: Lang }
  | { ok: false; response: Response };

/** Same link resolution as hub-bootstrap: slug, hub_enabled, then the token bound to the workspace. */
async function resolveLink(
  deps: HubAuthDeps, db: DbClient, req: Request, json: JsonResponder,
  workspaceSlug: string, token: string,
): Promise<LinkResult> {
  const { data: conta } = await db
    .from("workspaces")
    .select("id, name, logo_url, brand_color, hub_enabled, language")
    .eq("slug", workspaceSlug)
    .maybeSingle();
  if (!conta) return { ok: false, response: json({ error: hubLoginText("pt").workspaceNotFound }, 404) };
  const lang = resolveLang(conta.language);
  if (!conta.hub_enabled) return { ok: false, response: json({ error: hubLoginText(lang).hubDisabled }, 403) };

  let resolved;
  try {
    // deno-lint-ignore no-explicit-any
    resolved = await resolveHubToken(db as any, token, deps.now(), conta.id, conta.name ?? null);
  } catch (err) {
    console.error("[hub-auth] token resolution failed", errorCode(err));
    return { ok: false, response: json(internal(lang), 500) };
  }
  if (!resolved.ok) {
    // Paused (reverse trial ended): same 403 hub_paused body as every hub-*
    // function, answered before any code is issued or any limit is debited.
    const agencyName = resolved.reason === "paused" ? resolved.agencyName : undefined;
    return {
      ok: false,
      response: await hubAccessDenied(resolved.reason, { db, req, json, rateLimit: deps.rateLimit }, agencyName),
    };
  }
  return { ok: true, workspace: conta as Workspace, clienteId: resolved.token.cliente_id, lang };
}

export function createHubAuthHandler(deps: HubAuthDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = deps.buildCorsHeaders(req);
    const json = createJsonResponder(cors);

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    let body: Record<string, unknown>;
    try {
      const parsed = await req.json();
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return json(badRequest("pt"), 400);
      body = parsed as Record<string, unknown>;
    } catch {
      return json(badRequest("pt"), 400);
    }

    const action = body.action;
    if (action !== "request_code" && action !== "verify_code" && action !== "logout") {
      return json(badRequest("pt"), 400);
    }

    const db = deps.createDb();

    if (action === "logout") {
      const raw = req.headers.get(HUB_SESSION_HEADER);
      if (raw && raw.length <= MAX_SESSION_LENGTH) {
        try {
          const { error } = await db.rpc("hub_session_delete", { p_session_hash: await sha256Hex(raw) });
          if (error) console.error("[hub-auth] hub_session_delete failed", errorCode(error));
        } catch (err) {
          console.error("[hub-auth] hub_session_delete threw", errorCode(err));
        }
      }
      return json({ ok: true });
    }

    const { workspace: workspaceSlug, token } = body;
    if (typeof workspaceSlug !== "string" || !workspaceSlug || typeof token !== "string" || !token) {
      return json(badRequest("pt"), 400);
    }

    const link = await resolveLink(deps, db, req, json, workspaceSlug, token);
    if (!link.ok) return link.response;
    const { workspace, clienteId, lang } = link;
    const ip = getClientIP(req);

    if (action === "request_code") {
      // Enumeration safety: every outcome past the limits (listed, unlisted,
      // malformed, RPC failure, send failure) answers these same bytes, and
      // both limits are debited before anything that depends on the list.
      if (!(await deps.rateLimit(db, `hub-auth-req:ip:${ip}`, 20, 3600))) return json(tooMany(lang), 429);
      const email = normalizeEmail(body.email);
      if (!email) return json({ ok: true });
      if (!(await deps.rateLimit(db, `hub-auth-req:email:${clienteId}:${email}`, 5, 3600))) {
        return json(tooMany(lang), 429);
      }

      // Issue and send both run off the response path: hub_login_issue writes
      // only for listed emails, so awaiting it would leak through timing.
      // This promise never rejects.
      deps.defer((async () => {
        try {
          const code = deps.generateCode();
          const { data, error } = await db.rpc("hub_login_issue", {
            p_cliente_id: clienteId,
            p_email: email,
            p_code: code,
          });
          if (error) {
            console.error("[hub-auth] hub_login_issue failed", errorCode(error));
            return;
          }
          if (data !== true) return;
          try {
            await deps.sendCodeEmail({
              to: email,
              code,
              workspaceName: workspace.name,
              brandColor: workspace.brand_color ?? null,
              logoUrl: workspace.logo_url ?? null,
              lang,
            });
          } catch {
            console.error("[hub-auth] login code email failed");
          }
        } catch (err) {
          console.error("[hub-auth] request_code background work threw", errorCode(err));
        }
      })());
      return json({ ok: true });
    }

    // verify_code
    if (!(await deps.rateLimit(db, `hub-auth-verify:ip:${ip}`, 10, 600))) return json(tooMany(lang), 429);
    const email = normalizeEmail(body.email);
    const code = body.code;
    if (!email || typeof code !== "string" || !CODE_RE.test(code)) return json(invalidCode(lang), 400);

    const sessionToken = deps.generateSessionToken();
    try {
      const { data, error } = await db.rpc("hub_login_verify", {
        p_cliente_id: clienteId,
        p_email: email,
        p_code: code,
        p_session_hash: await sha256Hex(sessionToken),
      });
      if (error) {
        console.error("[hub-auth] hub_login_verify failed", errorCode(error));
        return json(internal(lang), 500);
      }
      const ok = typeof data === "object" && data !== null && (data as { ok?: unknown }).ok === true;
      if (!ok) return json(invalidCode(lang), 400);
      return json({ session_token: sessionToken });
    } catch (err) {
      console.error("[hub-auth] hub_login_verify threw", errorCode(err));
      return json(internal(lang), 500);
    }
  };
}
