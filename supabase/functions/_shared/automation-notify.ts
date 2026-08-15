// Notificação de falha da automação de comentário -> DM. Dedupe de 24h por
// (workspace, cliente): evita inundar owner/admin com um aviso por evento
// quando uma conta fica sem token/assinatura ou quando duas workspaces
// disputam a mesma conta Instagram. NUNCA lança: uma falha aqui não pode
// derrubar o processamento do envio que a chamou.

// deno-lint-ignore no-explicit-any
type DbClient = { from: (table: string) => any; rpc: (name: string, params: Record<string, unknown>) => any };

export type AutomationFailureReason =
  | "token_expired"
  | "subscription_lost"
  | "duplicate_account_conflict";

const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function notifyAutomationFailure(
  svc: DbClient,
  args: { contaId: string; clientId: number; reason: AutomationFailureReason },
): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString();
    const { data: existing, error: existErr } = await svc
      .from("notifications")
      .select("id")
      .eq("type", "instagram_automation_failed")
      .eq("workspace_id", args.contaId)
      .eq("metadata->>client_id", String(args.clientId))
      .gt("created_at", cutoff)
      .limit(1);
    if (existErr) throw existErr;
    if (existing && existing.length > 0) return; // já notificado nas últimas 24h

    const { data: targets, error: targetsErr } = await svc.rpc("resolve_notification_targets", {
      p_workspace_id: args.contaId,
      p_responsavel_id: null,
      p_roles_filter: ["owner", "admin"],
    });
    if (targetsErr) throw targetsErr;

    const userIds = (targets ?? []) as string[];
    if (userIds.length === 0) return;

    const { error: insertErr } = await svc.rpc("insert_notification_batch", {
      p_workspace_id: args.contaId,
      p_user_ids: userIds,
      p_type: "instagram_automation_failed",
      p_link: "/automacoes",
      p_metadata: { client_id: args.clientId, reason: args.reason },
    });
    if (insertErr) throw insertErr;
  } catch (err) {
    console.error(
      "[automation-notify] falha ao notificar falha de automação:",
      err instanceof Error ? err.message : String(err),
    );
  }
}
