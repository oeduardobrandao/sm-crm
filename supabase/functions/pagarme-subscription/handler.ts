// Orchestration for pagarme-subscription (cancel / update_card). Deps are injected
// ({db, gateway, now}) so the whole flow is unit-testable without network or env — the serve
// shell in index.ts provides the real ones. Auth/CORS/rate-limit live in index.ts; everything
// after "the caller is the owner of workspaceId and the body parsed" lives here.

import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { getDefaultPlanId, PlanPriceRow, resolvePlanFromPriceId } from "../_shared/billing-logic.ts";
import { buildRestoreStripeColumns, isDefinitiveGatewayReject, isInForce } from "../_shared/pagarme-logic.ts";
import {
  assessStripeSourceSub,
  isStripeNotFoundError,
  readStripeSubSnapshot,
  StripeSwitchGateway,
} from "../_shared/stripe-switch.ts";
import { buildAmountColumns, clearedAmountColumns } from "../_shared/stripe-amount.ts";
import { writeWorkspacePlan } from "../_shared/plan-writer.ts";
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
  /** Porta Stripe do undo do switch. null/ausente = ambiente dark: undo 500a. */
  stripeSwitch?: StripeSwitchGateway | null;
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

const UNDO_500 = {
  status: 500,
  body: { error: "Erro ao desfazer a troca. Tente novamente.", code: "gateway_error" },
} as const;

async function handleUndoSwitch(
  deps: PagarmeSubscriptionDeps,
  ctx: SubscriptionContext,
  row: Record<string, unknown>,
  subId: string,
  now: () => Date,
): Promise<SubscriptionResult> {
  const { db, gateway } = deps;
  const stripeSwitch = deps.stripeSwitch ?? null;
  const nowIso = now().toISOString();
  const marker = row.switched_from_stripe_subscription_id as string;
  if (!stripeSwitch) {
    console.error("[pagarme-subscription] undo requested but no Stripe gateway configured");
    return { ...UNDO_500 };
  }
  // Compensacao dos exits pos-mutacao (spec, review rodada 2): o cap_end=false pode ter
  // landado num timeout ambiguo, entao TODO exit entre a mutacao e o flip confirmado
  // rearma true imediatamente; so se o rearme tambem falhar o leg D vira backstop.
  const rearm = async () => {
    try {
      await stripeSwitch.setCancelAtPeriodEnd(marker, true);
    } catch (e) {
      console.error(
        "[pagarme-subscription] CRITICAL: undo rearm failed; leg D must re-enforce the stripe cancel:",
        e instanceof Error ? e.message : String(e),
      );
    }
  };

  // ── (1) LEITURAS primeiro: nada remoto e mutado ate tudo estar em maos. ──
  let remote: unknown;
  try {
    remote = await stripeSwitch.retrieveSubscription(marker);
  } catch (e) {
    if (isStripeNotFoundError(e)) {
      // Stripe morta remotamente (decisao 4): nao ha para onde voltar. Cancel comum
      // limpando os DOIS markers no mesmo CAS.
      return await handleCancel(deps, ctx, row, subId, now, {
        switched_from_stripe_subscription_id: null,
        switched_from_plan_id: null,
      });
    }
    console.error(
      "[pagarme-subscription] undo retrieve failed:",
      e instanceof Error ? e.message : String(e),
    );
    return { ...UNDO_500 };
  }
  const assessed = assessStripeSourceSub(remote, now());
  if (!assessed.ok) {
    // review rodada 2, achado IMPORTANTE 1: assessed.code "not_in_force" cobre QUALQUER status
    // fora de active/trialing -- past_due/unpaid/incomplete/paused NAO sao terminais, o mensal
    // so nao esta em force AGORA. Cair no fallback (decisao 4) para um desses derrubaria o
    // plano e apagaria o 12x com o mensal Stripe ainda vivo (e ainda a caminho de morrer na
    // fronteira via o cap_end=true do bind original). So um status remoto EXPLICITAMENTE
    // terminal justifica o fallback; le o status cru (nao o assess, que so distingue
    // in-force/not-in-force) para decidir.
    const rawStatus = readStripeSubSnapshot(remote).status;
    if (rawStatus === "canceled" || rawStatus === "incomplete_expired") {
      // Stripe terminal remoto (decisao 4): nao ha para onde voltar. Cancel comum
      // limpando os DOIS markers no mesmo CAS.
      return await handleCancel(deps, ctx, row, subId, now, {
        switched_from_stripe_subscription_id: null,
        switched_from_plan_id: null,
      });
    }
    // past_due/unpaid/incomplete/paused (not_in_force nao-terminal), not_monthly, malformed,
    // boundary_elapsed: transiente ou estado inesperado; nada mudou remotamente ainda.
    console.error(
      `[pagarme-subscription] undo assess failed: ${assessed.code} (remote status ${rawStatus ?? "unknown"})`,
    );
    return { ...UNDO_500 };
  }

  let amountColumns: Record<string, unknown>;
  try {
    amountColumns = buildAmountColumns(await stripeSwitch.fetchAmount(marker));
  } catch (e) {
    // Cleared se auto-cura na leitura do admin (precedente stripe-webhook).
    console.warn(
      "[pagarme-subscription] undo amount fetch failed, clearing mirror:",
      e instanceof Error ? e.message : String(e),
    );
    amountColumns = clearedAmountColumns();
  }

  let sourcePlanId = (row.switched_from_plan_id as string | null) ?? null;
  if (!sourcePlanId && assessed.priceId) {
    const { data: planRows, error: planErr } = await db
      .from("plans")
      .select("id, stripe_price_id, stripe_price_id_annual")
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
    if (planErr) {
      console.error("[pagarme-subscription] undo plan rows read failed:", planErr.message);
    } else {
      sourcePlanId =
        resolvePlanFromPriceId(assessed.priceId, (planRows ?? []) as PlanPriceRow[])?.plan_id ??
          null;
    }
  }
  if (!sourcePlanId) {
    console.error(
      `[pagarme-subscription] CRITICAL: undo has no restorable source plan for workspace ${ctx.workspaceId}; plan grant will be skipped`,
    );
  }

  // ── (2) Mutacao remota: reativa o mensal. Falha -> rearme imediato + 500. ──
  try {
    await stripeSwitch.setCancelAtPeriodEnd(marker, false);
  } catch (e) {
    console.error(
      "[pagarme-subscription] undo reactivation failed:",
      e instanceof Error ? e.message : String(e),
    );
    await rearm();
    return { ...UNDO_500 };
  }

  // ── (3) CAS flip-back num statement. ──
  const columns = buildRestoreStripeColumns({
    status: assessed.status,
    cancelAtPeriodEnd: false, // o undo ACABOU de reativar
    periodEndIso: assessed.periodEnd.toISOString(),
    sourcePlanId,
    amountColumns,
    nowIso,
  });
  const runCas = (statusPin: string) =>
    db
      .from("workspace_subscriptions")
      .update(columns)
      .eq("workspace_id", ctx.workspaceId)
      .eq("provider", "pagarme")
      .eq("pagarme_subscription_id", subId)
      .eq("status", statusPin)
      .select("workspace_id")
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
  const reReadCurrent = () =>
    db
      .from("workspace_subscriptions")
      .select("provider, status, pagarme_subscription_id")
      .eq("workspace_id", ctx.workspaceId)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .maybeSingle();
  const { data: casRows, error: casErr } = await runCas("trialing");
  if (casErr) {
    // review rodada 2, achado IMPORTANTE 2: o erro e AMBIGUO -- o UPDATE pode ter COMMITADO
    // antes do timeout que virou esse erro. Se ja commitou, a linha esta stripe-owned com os
    // markers limpos: rearmar as cegas re-cancelaria o mensal que o usuario acabou de
    // recuperar, com o leg D cego (markers null) e o retry da decisao-9 curto-circuitando
    // antes de chegar aqui de novo. Um re-read decide antes de rearmar.
    console.error("[pagarme-subscription] undo CAS failed:", casErr.message);
    const { data: current, error: reErr } = await reReadCurrent();
    const flipCommitted = !reErr && !!current &&
      ((current.provider as string | null) ?? "stripe") === "stripe";
    if (!flipCommitted) {
      await rearm();
      return { ...UNDO_500 };
    }
    console.warn(
      `[pagarme-subscription] undo CAS reported an error but the re-read shows the flip already committed for workspace ${ctx.workspaceId}; skipping rearm`,
    );
    // segue para os passos pos-CAS (plano-fonte + DELETE) como se o CAS tivesse achado a linha.
  } else if (!casRows?.length) {
    // Fronteira/transicao cruzou o undo em voo: re-read e branch (decisao 8).
    const { data: current, error: reErr } = await reReadCurrent();
    if (reErr) {
      console.error("[pagarme-subscription] undo re-read failed:", reErr.message);
      await rearm();
      return { ...UNDO_500 };
    }
    const st = current?.status as string | undefined;
    if (((current?.provider as string | null) ?? "stripe") === "stripe") {
      return {
        status: 200,
        body: { status: "reverted", access_until: assessed.periodEnd.toISOString() },
      };
    }
    if (st === "active" || st === "past_due") {
      // A 1a parcela disparou (ou falhou) durante o undo; a Stripe ja morreu na fronteira
      // e o cap_end=false do passo 2 pode te-la renovado: consolida cancelando JA.
      console.error(
        `[pagarme-subscription] CRITICAL: switch boundary crossed mid-undo for workspace ${ctx.workspaceId}; consolidating (stripe cancelNow)`,
      );
      try {
        await stripeSwitch.cancelNow(marker);
      } catch (e) {
        console.error(
          "[pagarme-subscription] CRITICAL: consolidation cancelNow failed; leg D repeats it:",
          e instanceof Error ? e.message : String(e),
        );
      }
      return {
        status: 409,
        body: {
          error: st === "past_due"
            ? "A troca já foi concluída e a primeira cobrança está pendente. Atualize o cartão ou cancele a assinatura."
            : "A troca já foi concluída e a primeira parcela foi cobrada.",
        },
      };
    }
    if (st === "canceled") {
      // 12x morreu em voo; o undo continua correto (restaurar a Stripe). Um retry pinado.
      const { data: retryRows, error: retryErr } = await runCas("canceled");
      if (retryErr || !retryRows?.length) {
        // Residual documentado no spec: dead-end raro (12x morto em voo + retry falhou);
        // suporte resolve via CRITICAL. NAO rearma: a Stripe reativada e o que o usuario quer.
        console.error(
          `[pagarme-subscription] CRITICAL: undo retry CAS failed for workspace ${ctx.workspaceId}; manual repair needed${retryErr ? `: ${retryErr.message}` : ""}`,
        );
        return { ...UNDO_500 };
      }
    } else {
      await rearm();
      return { ...UNDO_500 };
    }
  }

  // ── (4) Plano-fonte de volta (plan-writer respeita comp manual). ──
  if (sourcePlanId) {
    try {
      await writeWorkspacePlan(db, ctx.workspaceId, sourcePlanId, "stripe");
    } catch (e) {
      console.error(
        `[pagarme-subscription] CRITICAL: undo plan re-grant failed for workspace ${ctx.workspaceId}:`,
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  // ── (5) DELETE best-effort da future sub (nada cobrado; leg C e o backstop, ja que o
  // CAS limpou pagarme_subscription_id e o skip_linked desligou). ──
  try {
    await gateway.cancelSubscription(subId);
  } catch (e) {
    console.error(
      "[pagarme-subscription] CRITICAL: undo pagarme delete failed (leg C sweeps the orphan):",
      e instanceof Error ? e.message : String(e),
    );
  }

  return {
    status: 200,
    body: { status: "reverted", access_until: assessed.periodEnd.toISOString() },
  };
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
