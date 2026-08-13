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
// As queries PostgREST abaixo usam abortSignal. Já o getUserById (GoTrue, sem API de abort) e o
// fetch do Resend (limitado dentro de sendDunningEmail) são limitados por timeout explícito:
// uma promise travada nunca rejeita sozinha, então sem o timeout o catch best-effort logo
// abaixo nunca roda, e um travamento aqui prenderia o isolate depois do commit do estado
// durável — suprimindo a notificação quando a redelivery encontrar o dedup gate já marcado.
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

    const { data: ownerUser } = await withTimeout(
      svc.auth.admin.getUserById(ownerMember.user_id as string),
      DB_TIMEOUT_MS,
      "getUserById",
    );
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

/** Bounds a promise that has no native abort (GoTrue getUserById): a hung promise never rejects,
 * so without this the best-effort catch below never runs and the isolate hangs post-commit. */
async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
