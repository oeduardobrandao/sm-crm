import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import type { DunningStage } from "./dunning-logic.ts";
import { sendDunningEmail } from "./dunning-email.ts";
import { appBaseUrl } from "./app-url.ts";

/**
 * Tell the owner their payment failed. Swallows everything: a throw here would 500 the handler,
 * the gateway would redeliver, and the customer would get the same mail again.
 *
 * The owner is the only role that can act — billing-checkout and billing-portal are owner-gated.
 * The caller picks the stage: Stripe derives it from attempt_count/next_payment_attempt,
 * Pagar.me from its own failed-count rule (selectPagarmeDunningStage).
 */
// Review de spec (Codex): este arquivo é reescrito nesta fase, então as queries PostgREST
// entram na regra da casa de DB bounded. auth.admin.getUserById é GoTrue (sem API de abort);
// o try/catch envolvente já engole um hang eventual sem derrubar o handler.
const DB_TIMEOUT_MS = 10_000;

export async function notifyOwnerOfFailure(
  svc: SupabaseClient,
  workspaceId: string,
  notice: { stage: DunningStage; nextPaymentAttemptIso: string | null },
  opts?: { logPrefix?: string },
) {
  const logPrefix = opts?.logPrefix ?? "[dunning-notify]";
  try {
    const { data: ws } = await svc
      .from("workspaces").select("name").eq("id", workspaceId)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)).maybeSingle();

    // workspace_members, not profiles.conta_id: profiles has no email column, and conta_id is the
    // legacy single-workspace field. This is the path platform-admin already uses.
    const { data: ownerMember } = await svc
      .from("workspace_members").select("user_id")
      .eq("workspace_id", workspaceId).eq("role", "owner").limit(1)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)).maybeSingle();
    if (!ownerMember?.user_id) return;

    const { data: ownerUser } = await svc.auth.admin.getUserById(ownerMember.user_id as string);
    const to = ownerUser?.user?.email;
    if (!to) return;

    await sendDunningEmail({
      to,
      stage: notice.stage,
      workspaceName: (ws?.name as string | undefined) ?? "seu workspace",
      nextAttemptLabel: formatAttemptLabel(notice.nextPaymentAttemptIso),
      billingUrl: `${appBaseUrl()}/configuracao/cobranca`,
    });
  } catch (e) {
    // Internal log only — CLAUDE.md's "generic message" rule governs client responses, not
    // server logs. Without the workspace id and reason, a dead Resend key looks exactly like a
    // one-off blip, and nobody can tell which owner was never warned before losing access.
    console.error(
      `${logPrefix} dunning notification failed for workspace ${workspaceId}:`,
      e instanceof Error ? e.message : String(e),
    );
  }
}

/** "2026-07-24T10:00:00.000Z" -> "24 de julho". Null when the gateway will not retry again. */
function formatAttemptLabel(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "long" });
}
