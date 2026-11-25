// Billing currency of a workspace, edited by the Admin (spec 2026-11-25-usd-billing-design).
// Only the billing_currency_set RPC writes the column: it refuses once the currency is locked
// (first checkout / paid subscription), which surfaces here as 409 `currency_locked`.
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { insertAuditLog } from "../_shared/audit.ts";

type Headers = Record<string, string>;

const json = (body: unknown, status: number, headers: Headers) =>
  new Response(JSON.stringify(body), { status, headers });

export async function handleSetWorkspaceCurrency(
  svc: SupabaseClient,
  body: { workspace_id?: unknown; currency?: unknown },
  actorUserId: string,
  headers: Headers,
) {
  const workspaceId = typeof body?.workspace_id === "string" ? body.workspace_id.trim() : "";
  const currency = body?.currency;
  if (!workspaceId || (currency !== "brl" && currency !== "usd")) {
    return json({ error: "workspace_id e currency (brl | usd) são obrigatórios." }, 400, headers);
  }

  try {
    const { data: ws, error: wsErr } = await svc
      .from("workspaces").select("id, billing_currency").eq("id", workspaceId).maybeSingle();
    if (wsErr) throw wsErr;
    if (!ws) return json({ error: "Workspace não encontrado." }, 404, headers);

    const { data: updated, error } = await svc.rpc("billing_currency_set", {
      p_workspace_id: workspaceId,
      p_currency: currency,
    });
    if (error) throw error;
    if (updated !== true) return json({ error: "currency_locked" }, 409, headers);

    await insertAuditLog(svc, {
      conta_id: workspaceId,
      actor_user_id: actorUserId,
      action: "admin-set-workspace-currency",
      resource_type: "workspace",
      resource_id: workspaceId,
      metadata: {
        old_currency: (ws as { billing_currency?: string }).billing_currency ?? null,
        new_currency: currency,
      },
    });
    return json({ ok: true }, 200, headers);
  } catch (e) {
    console.error("[platform-admin:set-workspace-currency] failed", { workspaceId, error: e });
    return json({ error: "Não foi possível alterar a moeda." }, 500, headers);
  }
}
