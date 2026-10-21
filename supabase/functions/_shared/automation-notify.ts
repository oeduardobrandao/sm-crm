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
  | "duplicate_account_conflict"
  | "target_never_published";

const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function notifyAutomationFailure(
  svc: DbClient,
  args: {
    contaId: string;
    clientId: number;
    reason: AutomationFailureReason;
    extraMetadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString();
    // `reason` entra no dedupe: motivos diferentes tem remedios diferentes
    // (ex.: token_expired manda reconectar, target_never_published manda
    // escolher o post publicado), entao colapsar os dois no mesmo dedupe de
    // 24h esconde a orientacao certa do usuario. Efeito colateral aceitavel:
    // os tres motivos antigos (que compartilhavam o mesmo remedio) passam a
    // deduplicar separadamente entre si.
    const { data: existing, error: existErr } = await svc
      .from("notifications")
      .select("id")
      .eq("type", "instagram_automation_failed")
      .eq("workspace_id", args.contaId)
      .eq("metadata->>client_id", String(args.clientId))
      .eq("metadata->>reason", args.reason)
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
      // Campos canonicos por ULTIMO: um `extraMetadata` que carregue `reason`
      // ou `client_id` nao pode sobrescreve-los em silencio -- o dedupe acima
      // agora depende do `reason` gravado aqui ser o de verdade.
      p_metadata: { ...args.extraMetadata, client_id: args.clientId, reason: args.reason },
    });
    if (insertErr) throw insertErr;
  } catch (err) {
    console.error(
      "[automation-notify] falha ao notificar falha de automação:",
      err instanceof Error ? err.message : String(err),
    );
  }
}
