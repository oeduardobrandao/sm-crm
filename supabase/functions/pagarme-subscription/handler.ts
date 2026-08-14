// Orchestration for pagarme-subscription (cancel / update_card). Deps are injected
// ({db, gateway, now}) so the whole flow is unit-testable without network or env — the serve
// shell in index.ts provides the real ones. Auth/CORS/rate-limit live in index.ts; everything
// after "the caller is the owner of workspaceId and the body parsed" lives here.

import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { getDefaultPlanId } from "../_shared/billing-logic.ts";
import { isDefinitiveGatewayReject, isInForce } from "../_shared/pagarme-logic.ts";
import { buildCancelColumns, SubscriptionAction } from "./logic.ts";
import { PagarmeSubscriptionGateway } from "./gateway.ts";

const DB_TIMEOUT_MS = 10_000;

export interface SubscriptionContext {
  workspaceId: string;
}

export interface SubscriptionResult {
  status: number;
  body: Record<string, unknown>;
}

export interface PagarmeSubscriptionDeps {
  db: SupabaseClient;
  gateway: PagarmeSubscriptionGateway;
  now?: () => Date;
}

const NOT_FOUND = {
  status: 404,
  body: { error: "Nenhuma assinatura parcelada encontrada para este workspace." },
} as const;

export function handleSubscriptionAction(
  deps: PagarmeSubscriptionDeps,
  ctx: SubscriptionContext,
  action: SubscriptionAction,
): Promise<SubscriptionResult> {
  const now = deps.now ?? (() => new Date());
  return run(deps, ctx, action, now);
}

async function run(
  deps: PagarmeSubscriptionDeps,
  ctx: SubscriptionContext,
  action: SubscriptionAction,
  now: () => Date,
): Promise<SubscriptionResult> {
  const { db, gateway } = deps;

  const { data: row, error: rowErr } = await db
    .from("workspace_subscriptions")
    .select(
      "provider, pagarme_customer_id, pagarme_subscription_id, status, cancel_at_period_end, current_period_end, switched_from_stripe_subscription_id, switched_from_plan_id",
    )
    .eq("workspace_id", ctx.workspaceId)
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
    .maybeSingle();
  if (rowErr) throw new Error(`subscription read failed: ${rowErr.message}`);

  // Decisao 9 do spec (idempotencia do undo, amplitude DELIBERADA): um retry do undo apos
  // resposta perdida encontra a linha ja flipada para stripe sem pagarme_subscription_id.
  // Uma assinatura Stripe comum que nunca fez switch tambem cai aqui e recebe o mesmo
  // no-op 200 (antes: 404). Inofensivo e pinado em teste de regressao.
  if (
    action.action === "cancel" &&
    row && ((row.provider as string | null) ?? "stripe") === "stripe" &&
    isInForce(row.status as string | null | undefined) &&
    !row.pagarme_subscription_id
  ) {
    return {
      status: 200,
      body: {
        status: "reverted",
        access_until: (row.current_period_end as string | null) ?? null,
      },
    };
  }

  if (!row || row.provider !== "pagarme" || !row.pagarme_subscription_id) {
    return { ...NOT_FOUND };
  }
  if (!isInForce(row.status as string | null | undefined)) {
    return { status: 409, body: { error: "Esta assinatura já está cancelada." } };
  }

  const subId = row.pagarme_subscription_id as string;

  if (action.action === "cancel") {
    // Janela de switch (marker + trialing): o cancel E o undo (decisao 1 do spec) e nunca
    // pode chegar em buildCancelColumns, que derrubaria o plano na hora.
    if (row.switched_from_stripe_subscription_id && row.status === "trialing") {
      return await handleUndoSwitch(deps, ctx, row, subId, now);
    }
    return await handleCancel(deps, ctx, row, subId, now);
  }
  return await handleUpdateCard(gateway, row, subId, action);
}

async function handleUndoSwitch(
  _deps: PagarmeSubscriptionDeps,
  _ctx: SubscriptionContext,
  _row: Record<string, unknown>,
  _subId: string,
  _now: () => Date,
): Promise<SubscriptionResult> {
  return { status: 501, body: { error: "switch undo not implemented" } };
}

async function handleCancel(
  deps: PagarmeSubscriptionDeps,
  ctx: SubscriptionContext,
  row: Record<string, unknown>,
  subId: string,
  now: () => Date,
  extraColumns: Record<string, unknown> = {},
): Promise<SubscriptionResult> {
  const { db, gateway } = deps;
  const nowIso = now().toISOString();

  let remotePeriodEnd: string | null = null;
  try {
    const remote = await gateway.cancelSubscription(subId);
    remotePeriodEnd = remote?.current_cycle?.end_at ?? null;
  } catch (e) {
    if (!isDefinitiveGatewayReject(e)) {
      console.error(
        "[pagarme-subscription] remote cancel failed:",
        e instanceof Error ? e.message : String(e),
      );
      return {
        status: 500,
        body: { error: "Erro ao cancelar a assinatura. Tente novamente.", code: "gateway_error" },
      };
    }
    // Definitive 4xx: already canceled/gone remotely. Proceed to reconcile locally
    // (remotePeriodEnd stays null; the stored value, if any, still governs paid-through).
  }

  const observedStatus = row.status as string;
  const { columns, immediateDowngrade, accessUntil } = buildCancelColumns({
    observedStatus,
    storedPeriodEnd: (row.current_period_end as string | null) ?? null,
    remotePeriodEnd,
    nowIso,
  });

  const { data: casRows, error: casErr } = await db
    .from("workspace_subscriptions")
    .update({ ...columns, ...extraColumns })
    .eq("workspace_id", ctx.workspaceId)
    .eq("provider", "pagarme")
    .eq("pagarme_subscription_id", subId)
    .eq("status", observedStatus)
    .select("workspace_id")
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
  if (casErr) throw new Error(`cancel write failed: ${casErr.message}`);

  if (!casRows?.length) {
    // The remote cancel SUCCEEDED and a concurrent writer (the webhook's subscription.canceled
    // reconcile) already moved the row. Tolerated: the remote state is what the user asked for.
    console.warn(
      `[pagarme-subscription] cancel CAS matched zero rows for workspace ${ctx.workspaceId}, subscription ${subId}: concurrent transition already applied`,
    );
    return { status: 200, body: { status: "canceled", access_until: accessUntil } };
  }

  if (immediateDowngrade) {
    const target = await getDefaultPlanId(db);
    const { data: written, error } = await db
      .rpc("grant_pagarme_plan", {
        p_workspace: ctx.workspaceId,
        p_plan: target,
        p_sub: subId,
        p_status: "canceled",
      })
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
    if (error) {
      throw new Error(`pagarme plan write failed for ${ctx.workspaceId}: ${error.message}`);
    }
    if (written === 0) {
      console.warn(
        `[pagarme-subscription] plan grant skipped for workspace ${ctx.workspaceId}: subscription ${subId} guard did not match reconciled status canceled (concurrent transition or manual comp)`,
      );
    }
  }

  return { status: 200, body: { status: "canceled", access_until: accessUntil } };
}

async function handleUpdateCard(
  gateway: PagarmeSubscriptionGateway,
  row: Record<string, unknown>,
  subId: string,
  action: Extract<SubscriptionAction, { action: "update_card" }>,
): Promise<SubscriptionResult> {
  if (!row.pagarme_customer_id) {
    return { ...NOT_FOUND };
  }
  const customerId = row.pagarme_customer_id as string;

  let cardId: string;
  try {
    const card = await gateway.attachCard(customerId, action.cardToken, action.billingAddress);
    cardId = card.id;
  } catch (e) {
    console.error(
      "[pagarme-subscription] card attach failed:",
      e instanceof Error ? e.message : String(e),
    );
    if (isDefinitiveGatewayReject(e)) {
      return {
        status: 400,
        body: { error: "Cartão recusado. Confira os dados ou tente outro cartão.", code: "invalid_card" },
      };
    }
    return {
      status: 500,
      body: { error: "Erro ao atualizar o cartão. Tente novamente.", code: "gateway_error" },
    };
  }

  try {
    await gateway.updateSubscriptionCard(subId, cardId);
  } catch (e) {
    // A 4xx here is NOT the card's fault: the card_id was attached one call ago. It is a
    // subscription-state/gateway problem — generic error, details in the log. The attached
    // card left behind is benign: it hangs off the customer unused, and a retry attaches a
    // fresh one (same residual as pagarme-checkout's attach-then-fail path).
    console.error(
      "[pagarme-subscription] card swap failed:",
      e instanceof Error ? e.message : String(e),
    );
    return {
      status: 500,
      body: { error: "Erro ao atualizar o cartão. Tente novamente.", code: "gateway_error" },
    };
  }

  return { status: 200, body: { ok: true } };
}
