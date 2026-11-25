import { SupabaseClient } from "npm:@supabase/supabase-js@2";

// Both queries are bounded so a PostgREST hang surfaces as a thrown error in the caller
// (pagarme-checkout: CRITICAL log + 200; stripe-webhook: 5xx -> redelivery) instead of
// running the isolate into an Edge kill mid-billing-flow (house rule).
const DB_TIMEOUT_MS = 10_000;

/**
 * Effective-plan write, guarded so admin comps (plan_source='manual') are never overridden.
 * A demo (plan_source='demo') is ended by a "subscribed" write but kept by a "fallback" write
 * (default plan written because a subscription ended or its price is unknown).
 * Read and write errors THROW (they were silently discarded before): in stripe-webhook a
 * throw becomes a 5xx → Stripe redelivery → retried write (the Fase 2 "a failed write must
 * not ack" rule); in pagarme-checkout the caller decides (post-bind failures log CRITICAL
 * without failing the checkout).
 *
 * Teste reverso (spec 2026-11-24-reverse-trial-design.md, Part 4): the read-then-update below
 * has no lock, so every transition that involves the trial goes through a locked SQL function:
 *   - "subscribed" on a running trial (plan_source='trial') or on a workspace the sweep already
 *     downgraded → convert_reverse_trial. 'not_trial' on a running trial writes nothing (the
 *     function refused the plan); on a downgraded one it is a win-back and the normal write runs.
 *   - "fallback" on a running trial: no-op (like a demo).
 *   - "fallback" on a converted trial that never paid (reverse_trial_first_paid_at null):
 *     before the original reverse_trial_ends_at → revert_reverse_trial_conversion (back to the
 *     trial, cancelling never costs trial days); on or after it → default plan written, then
 *     mark_reverse_trial_unpaid (the full downgrade experience applies).
 */
export async function writeWorkspacePlan(
  svc: SupabaseClient,
  workspaceId: string,
  planId: string,
  planSource: "stripe" | "pagarme",
  // "subscribed": a real paid plan write (ends a demo). "fallback": the default/free plan
  // written because a subscription ended or its price is unknown (never ends a demo).
  kind: "subscribed" | "fallback" = "subscribed",
  now: Date = new Date(),
) {
  const { data: ws, error: readErr } = await svc
    .from("workspaces")
    .select(
      "plan_source, reverse_trial_outcome, reverse_trial_ends_at, reverse_trial_first_paid_at",
    )
    .eq("id", workspaceId)
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)).single();
  if (readErr) {
    throw new Error(`workspace read failed for ${workspaceId}: ${readErr.message}`);
  }
  if (ws?.plan_source === "manual") return;
  if (ws?.plan_source === "demo" && kind === "fallback") return;

  if (kind === "subscribed") {
    if (ws?.plan_source === "trial" || ws?.reverse_trial_outcome === "downgraded") {
      const result = await callRpc(svc, "convert_reverse_trial", {
        p_workspace: workspaceId,
        p_plan: planId,
        p_source: planSource,
      });
      if (result === "converted" || result === "rewritten_late") return;
      if (ws?.plan_source === "trial") {
        console.error(
          `[plan-writer] convert_reverse_trial refused plan ${planId} for trial workspace ${workspaceId}; plan left unchanged`,
        );
        return;
      }
    }
  } else {
    if (ws?.plan_source === "trial") return;
    if (ws?.reverse_trial_outcome === "converted" && !ws?.reverse_trial_first_paid_at) {
      const endsAt = ws?.reverse_trial_ends_at ? new Date(ws.reverse_trial_ends_at) : null;
      if (endsAt && now < endsAt) {
        const reverted = await callRpc(svc, "revert_reverse_trial_conversion", {
          p_workspace: workspaceId,
        });
        if (reverted === true) return;
      }
      await updatePlan(svc, workspaceId, planId, planSource);
      await callRpc(svc, "mark_reverse_trial_unpaid", { p_workspace: workspaceId });
      return;
    }
  }

  await updatePlan(svc, workspaceId, planId, planSource);
}

/**
 * First charge FAILED on a subscription bound during a reverse trial (Stripe past_due before
 * any payment). statusToPlanId leaves the plan alone on past_due (dunning grace), so without
 * this the never-paid conversion would keep Pro until the provider finally cancels. Spec Part 4:
 * a conversion that never paid is a downgraded trial once the original end has passed. Acts
 * only on outcome 'converted' with reverse_trial_first_paid_at null and now >= the original
 * reverse_trial_ends_at (never on a comp); returns whether it downgraded. Throws on error.
 */
export async function downgradeUnpaidReverseTrialConversion(
  svc: SupabaseClient,
  workspaceId: string,
  defaultPlanId: string,
  planSource: "stripe" | "pagarme",
  now: Date = new Date(),
): Promise<boolean> {
  const { data: ws, error: readErr } = await svc
    .from("workspaces")
    .select(
      "plan_source, reverse_trial_outcome, reverse_trial_ends_at, reverse_trial_first_paid_at",
    )
    .eq("id", workspaceId)
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)).single();
  if (readErr) {
    throw new Error(`workspace read failed for ${workspaceId}: ${readErr.message}`);
  }
  if (
    ws?.plan_source === "manual" || ws?.reverse_trial_outcome !== "converted" ||
    ws?.reverse_trial_first_paid_at || !ws?.reverse_trial_ends_at ||
    now < new Date(ws.reverse_trial_ends_at)
  ) {
    return false;
  }
  await updatePlan(svc, workspaceId, defaultPlanId, planSource);
  await callRpc(svc, "mark_reverse_trial_unpaid", { p_workspace: workspaceId });
  return true;
}

/**
 * First successful payment of a subscription bound during a reverse trial (Stripe invoice.paid
 * with amount > 0, Pagar.me first paid charge). The SQL function only stamps a workspace that
 * has reverse_trial_card_added_at and no first payment yet, so calling it for any workspace is
 * a safe no-op. Throws on error (the webhook redelivers).
 */
export async function markReverseTrialFirstPaid(svc: SupabaseClient, workspaceId: string) {
  await callRpc(svc, "mark_reverse_trial_first_paid", { p_workspace: workspaceId });
}

async function updatePlan(
  svc: SupabaseClient,
  workspaceId: string,
  planId: string,
  planSource: "stripe" | "pagarme",
) {
  const { error: writeErr } = await svc.from("workspaces")
    .update({ plan_id: planId, plan_source: planSource }).eq("id", workspaceId)
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
  if (writeErr) {
    throw new Error(`plan write failed for ${workspaceId}: ${writeErr.message}`);
  }
}

async function callRpc(
  svc: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await svc.rpc(name, args)
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
  if (error) {
    throw new Error(`${name} failed for ${String(args.p_workspace)}: ${error.message}`);
  }
  return data;
}
