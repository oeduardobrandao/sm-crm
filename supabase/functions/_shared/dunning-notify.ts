import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { selectDunningStage } from "./dunning-logic.ts";
import { sendDunningEmail } from "./dunning-email.ts";
import { appBaseUrl } from "./app-url.ts";

/**
 * Tell the owner their payment failed. Swallows everything: a throw here would 500 the handler,
 * Stripe would redeliver, and the customer would get the same mail again.
 *
 * The owner is the only role that can act — billing-checkout and billing-portal are owner-gated.
 */
export async function notifyOwnerOfFailure(
  svc: SupabaseClient,
  workspaceId: string,
  inputs: { attemptCount: number; nextPaymentAttempt: number | null },
  episode: { next_payment_attempt: string | null },
) {
  try {
    const { data: ws } = await svc
      .from("workspaces").select("name").eq("id", workspaceId).maybeSingle();

    // workspace_members, not profiles.conta_id: profiles has no email column, and conta_id is the
    // legacy single-workspace field. This is the path platform-admin already uses.
    const { data: ownerMember } = await svc
      .from("workspace_members").select("user_id")
      .eq("workspace_id", workspaceId).eq("role", "owner").limit(1).maybeSingle();
    if (!ownerMember?.user_id) return;

    const { data: ownerUser } = await svc.auth.admin.getUserById(ownerMember.user_id as string);
    const to = ownerUser?.user?.email;
    if (!to) return;

    await sendDunningEmail({
      to,
      stage: selectDunningStage(inputs.attemptCount, inputs.nextPaymentAttempt),
      workspaceName: (ws?.name as string | undefined) ?? "seu workspace",
      nextAttemptLabel: formatAttemptLabel(episode.next_payment_attempt),
      billingUrl: `${appBaseUrl()}/configuracao/cobranca`,
    });
  } catch (e) {
    // Internal log only — CLAUDE.md's "generic message" rule governs client responses, not
    // server logs. Without the workspace id and reason, a dead Resend key looks exactly like a
    // one-off blip, and nobody can tell which owner was never warned before losing access.
    console.error(
      `[stripe-webhook] dunning notification failed for workspace ${workspaceId}:`,
      e instanceof Error ? e.message : String(e),
    );
  }
}

/** "2026-07-24T10:00:00.000Z" -> "24 de julho". Null when Stripe will not retry again. */
function formatAttemptLabel(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "long" });
}
