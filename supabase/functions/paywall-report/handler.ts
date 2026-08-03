import { buildCorsHeaders } from "../_shared/cors.ts";
import { createJsonResponder } from "../_shared/http.ts";
import { FEATURE_COLUMNS } from "../_shared/entitlements.ts";

/**
 * Allowlist of features a hit may name. Derived from FEATURE_COLUMNS, the single
 * source of truth for entitlement flags -- do NOT hand-copy the list here, a copy
 * drifts the moment a flag is added and silently starts rejecting real denials.
 */
const KNOWN_FEATURES: ReadonlySet<string> = new Set<string>(FEATURE_COLUMNS);

export interface PaywallReportDeps {
  getUser: (token: string) => Promise<{ id: string } | null>;
  isMember: (userId: string, workspaceId: string) => Promise<boolean>;
  insertHit: (row: {
    workspace_id: string;
    user_id: string;
    feature: string;
    clicked_upgrade: boolean;
  }) => Promise<void>;
}

/**
 * Records a paywall denial.
 *
 * `supabase/config.toml` sets `verify_jwt = false` for this function even
 * though it is called with a real user JWT. That is deliberate, not an
 * oversight: this endpoint is invoked cross-origin from the browser with an
 * `Authorization: Bearer <user JWT>` header, which makes the browser send an
 * UNAUTHENTICATED `OPTIONS` preflight first. With the gateway's JWT check
 * enabled, Supabase rejects that preflight before this handler ever runs, the
 * CORS response below never reaches the browser, and the POST is never sent
 * -- silently, with nothing in this function's logs to explain it. Disabling
 * the gateway check is what lets the preflight (and then the real request)
 * reach this code at all.
 *
 * That means the checks below are the ONLY authorization boundary for this
 * function -- there is no gateway-level check backing them up. Do not weaken
 * either one:
 *
 * SECURITY BOUNDARY: authorisation is a workspace_members lookup for the
 * AUTHENTICATED user id against the workspace_id in the body. It is deliberately
 * NOT a profiles.conta_id check — conta_id tracks the ACTIVE workspace
 * (get_my_conta_id returns active_workspace_id, 20260317_multi_workspace.sql),
 * so in a multi-workspace account it routinely diverges from the target. Using
 * it would turn this into a cross-tenant write path.
 *
 * The body is attacker-controlled and is trusted for nothing except being the
 * subject of that membership check.
 */
export function createPaywallReportHandler(deps: PaywallReportDeps) {
  return async (req: Request): Promise<Response> => {
    const cors = buildCorsHeaders(req);
    const json = createJsonResponder(cors);

    if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!token) return json({ error: "Unauthorized" }, 401);

    try {
      const user = await deps.getUser(token);
      if (!user) return json({ error: "Unauthorized" }, 401);

      const body = await req.json().catch(() => null) as
        | { workspace_id?: unknown; feature?: unknown; clicked_upgrade?: unknown }
        | null;
      const workspaceId = typeof body?.workspace_id === "string" ? body.workspace_id : "";
      const feature = typeof body?.feature === "string" ? body.feature : "";
      // `feature` must name a REAL entitlement flag, not merely be non-empty.
      // A fabricated string is persisted as a paywall_hit, and for a free,
      // opted-in workspace get_paywall_hit_candidates later selects it and mails
      // the owner a marketing email naming a feature that does not exist, with
      // no gated action having occurred. It also poisons feature attribution in
      // the analytics. Same generic 400 as a missing field, and the rejected
      // value is deliberately NOT echoed back.
      if (!workspaceId || !feature || !KNOWN_FEATURES.has(feature)) {
        return json({ error: "Invalid request" }, 400);
      }

      if (!(await deps.isMember(user.id, workspaceId))) {
        return json({ error: "Forbidden" }, 403);
      }

      await deps.insertHit({
        workspace_id: workspaceId,
        user_id: user.id,
        feature,
        clicked_upgrade: body?.clicked_upgrade === true,
      });
      return json({ success: true }, 200);
    } catch (e) {
      // Never leak detail: log internally, return generic.
      console.error("[paywall-report] error:", e instanceof Error ? e.message : String(e));
      return json({ error: "Internal server error" }, 500);
    }
  };
}
