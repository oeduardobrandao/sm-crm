// Orchestration of the 12x checkout. Deps are injected ({db, gateway, now}) so the whole
// flow is unit-testable without network or env — the serve shell in index.ts provides the
// real ones. Auth/CORS/rate-limit live in index.ts; everything after "the caller is the
// owner of workspaceId and the body parsed" lives here.

import { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { hasEverSubscribed } from "../_shared/billing-logic.ts";
import { resolveTrialDays } from "../_shared/trial.ts";
import {
  isDefinitiveGatewayReject,
  mapPagarmeTemporalFields,
  normalizePagarmeStatus,
} from "../_shared/pagarme-logic.ts";
import { PagarmeApiError } from "../_shared/pagarme.ts";
import { writeWorkspacePlan } from "../_shared/plan-writer.ts";
import {
  buildAttemptIdempotencyKey,
  buildPagarmeSubscriptionColumns,
  installmentAmountCents,
  mapGatewayFailure,
  PagarmeCheckoutRequest,
  pagarmeCheckoutBlocked,
  resolveStartAt,
} from "./logic.ts";
import { PagarmeGateway, PagarmeSubscriptionResponse } from "./gateway.ts";

const STALE_ATTEMPT_MINUTES = 15;

// Every DB call is bounded so a PostgREST hang surfaces as a catchable error inside the
// compensation paths instead of running the isolate into an Edge kill mid-flow (house rule;
// billing-checkout's checkout_attempts insert set the precedent).
const DB_TIMEOUT_MS = 10_000;

export interface CheckoutContext {
  workspaceId: string;
  userEmail: string;
  userName: string | null;
}

export interface CheckoutResult {
  status: number;
  body: unknown;
}

export function createPagarmeCheckoutHandler(deps: {
  db: SupabaseClient;
  gateway: PagarmeGateway;
  now: () => Date;
}) {
  return async function handle(
    ctx: CheckoutContext,
    reqData: PagarmeCheckoutRequest,
  ): Promise<CheckoutResult> {
    const { db, gateway } = deps;
    const now = deps.now();
    const nowIso = now.toISOString();

    // (1) Plan + server-side gate re-check: the column is the rollout switch, and the
    // frontend gate is advisory. Off means a generic 403 with no detail.
    const { data: plan, error: planErr } = await db
      .from("plans")
      .select("id, price_brl_annual, pagarme_12x_enabled, pagarme_plan_id_annual")
      .eq("id", reqData.planId)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .single();
    if (planErr) throw new Error(`plan read failed: ${planErr.message}`);
    if (!plan?.pagarme_12x_enabled) {
      return { status: 403, body: { error: "Indisponível." } };
    }
    if (!plan.pagarme_plan_id_annual || plan.price_brl_annual == null) {
      return {
        status: 400,
        body: {
          error: "Plano não configurado para parcelamento. Fale com o suporte.",
          code: "plan_not_configured",
        },
      };
    }

    // (2) Existing row. A read ERROR must deny, not fall through as "no row": that would
    // skip the 409 and duplicate a live subscription.
    const { data: row, error: rowErr } = await db
      .from("workspace_subscriptions")
      .select(
        "provider, stripe_subscription_id, pagarme_customer_id, pagarme_subscription_id, status, cancel_at_period_end, current_period_end, ever_subscribed_at",
      )
      .eq("workspace_id", ctx.workspaceId)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .maybeSingle();
    if (rowErr) throw new Error(`subscription read failed: ${rowErr.message}`);
    if (pagarmeCheckoutBlocked(row, now)) {
      return { status: 409, body: { error: "Este workspace já tem uma assinatura vigente." } };
    }

    // (3) Self-heal stale reservations, then reserve atomically. A crash between reserving
    // and finishing must not lock the workspace out forever: any pending attempt older than
    // 15 minutes is resolved inline. Resolution is NOT a blind release — an attempt that
    // RECORDED a remote subscription id (create succeeded, bind or compensating cancel
    // failed) is canceled at the gateway FIRST; we never knowingly release a reservation
    // while a known remote subscription may be live. This is a deliberate exception to the
    // "no remote call before the reservation" rule: the stale pending row blocks the
    // reservation insert (partial unique index), it fires only on this rare recovery path,
    // and it involves no card data. Attempts with NO recorded id have nothing to check
    // locally; the Fase 5 remote-side sweep owns that residual.
    const staleBefore = new Date(now.getTime() - STALE_ATTEMPT_MINUTES * 60_000).toISOString();
    const { data: stalePending, error: staleReadErr } = await db
      .from("pagarme_checkout_attempts")
      .select("id, pagarme_subscription_id")
      .eq("workspace_id", ctx.workspaceId)
      .eq("state", "pending")
      .lt("created_at", staleBefore)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
    if (staleReadErr) throw new Error(`stale attempt read failed: ${staleReadErr.message}`);
    for (
      const stale of (stalePending ?? []) as Array<
        { id: string; pagarme_subscription_id: string | null }
      >
    ) {
      if (stale.pagarme_subscription_id) {
        try {
          await gateway.cancelSubscription(stale.pagarme_subscription_id);
        } catch (e) {
          // 4xx from the DELETE means the subscription is not in a cancellable state
          // (already canceled or gone) — safe to release — EXCEPT 401/403 (our credentials)
          // and 429 (throttled), which say nothing about the subscription's state. Same
          // split as mapGatewayFailure. Anything else (network, 5xx) means it MAY still be
          // live: keep the reservation blocking instead of expiring.
          const settled = isDefinitiveGatewayReject(e);
          if (!settled) {
            console.error(
              `[pagarme-checkout] stale attempt ${stale.id} holds subscription ${stale.pagarme_subscription_id} and cancel failed; keeping the reservation:`,
              e instanceof Error ? e.message : String(e),
            );
            return {
              status: 409,
              body: {
                error:
                  "Outra tentativa de pagamento está em andamento. Aguarde alguns instantes e tente de novo.",
              },
            };
          }
        }
      }
      // Pinned to state='pending': the row is only expired if untouched since the SELECT (TOCTOU guard).
      const { error: expireErr } = await db
        .from("pagarme_checkout_attempts")
        .update({ state: "expired", updated_at: nowIso })
        .eq("id", stale.id)
        .eq("state", "pending")
        .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
      if (expireErr) throw new Error(`attempt expiry failed: ${expireErr.message}`);
    }

    const { data: attempt, error: reserveErr } = await db
      .from("pagarme_checkout_attempts")
      .insert({ workspace_id: ctx.workspaceId })
      .select("id")
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .single();
    if (reserveErr) {
      if (reserveErr.code === "23505") {
        return {
          status: 409,
          body: {
            error: "Outra tentativa de pagamento está em andamento. Aguarde alguns instantes e tente de novo.",
          },
        };
      }
      throw new Error(`attempt reservation failed: ${reserveErr.message}`);
    }
    const attemptId = (attempt as { id: string }).id;

    // Best-effort terminal state for the attempt: a failure to record it only costs an
    // earlier-than-necessary 409 for 15 minutes (the expiry sweep clears it), never money.
    // Structurally best-effort: postgrest-js resolves fetch failures (incl. the abort) as
    // { error } today, but this helper must stay non-throwing even if that convention or
    // the client ever changes — a post-bind throw here would fail a checkout that succeeded.
    const finishAttempt = async (
      state: "succeeded" | "failed",
      pagarmeSubscriptionId?: string,
    ) => {
      try {
        const { error } = await db
          .from("pagarme_checkout_attempts")
          .update({
            state,
            updated_at: new Date().toISOString(),
            ...(pagarmeSubscriptionId ? { pagarme_subscription_id: pagarmeSubscriptionId } : {}),
          })
          .eq("id", attemptId)
          .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
        if (error) console.error("[pagarme-checkout] attempt update failed:", error.message);
      } catch (e) {
        console.error(
          "[pagarme-checkout] attempt update threw:",
          e instanceof Error ? e.message : String(e),
        );
      }
    };

    const GENERIC_500 = {
      error: "Erro ao processar o pagamento. Tente novamente.",
      code: "gateway_error",
    };
    const ROW_CONFLICT_409 = { error: "Este workspace já tem uma assinatura vigente." };

    let stage: "customer" | "card" | "subscription" = "customer";
    try {
      // (4) Trial: permanent per-workspace eligibility, provider-agnostic. start_at in the
      // future means the card is NOT authorized at creation (spike): a bad card surfaces on
      // day 30 and dunning covers it.
      const trialDays = resolveTrialDays(hasEverSubscribed(row));
      const startAt = resolveStartAt(trialDays, now);

      // (5) Customer upsert: email is unique at Pagar.me, so this is find-or-create. The
      // customer may be shared across this owner's workspaces (1:N by design, never a
      // tenant authority); last-write-wins on the shared profile is accepted.
      const customer = await gateway.upsertCustomer({
        name: ctx.userName?.trim() || ctx.userEmail,
        email: ctx.userEmail,
        document: reqData.document,
        document_type: reqData.documentType,
        type: reqData.customerType,
        phones: {
          mobile_phone: {
            country_code: "55",
            area_code: reqData.phone.ddd,
            number: reqData.phone.number,
          },
        },
      });

      // (6) Card attach WITH billing_address; always use the card id from THIS response,
      // never list/reuse the customer's saved cards (no card crosses workspaces).
      stage = "card";
      const card = await gateway.attachCard(customer.id, reqData.cardToken, reqData.billingAddress);

      // (7) Subscription with the attempt-derived Idempotency-Key: a retry of the same
      // reservation converges on the same remote subscription instead of a duplicate.
      stage = "subscription";
      const subInput = {
        plan_id: plan.pagarme_plan_id_annual as string,
        customer_id: customer.id,
        card_id: card.id,
        installments: 12 as const,
        ...(startAt ? { start_at: startAt } : {}),
        metadata: { workspace_id: ctx.workspaceId, plan_id: reqData.planId },
      };
      const idemKey = buildAttemptIdempotencyKey(attemptId);
      let sub: PagarmeSubscriptionResponse;
      try {
        sub = await gateway.createSubscription(subInput, idemKey);
      } catch (err) {
        const definitiveRejection = err instanceof PagarmeApiError &&
          err.status >= 400 && err.status < 500;
        if (definitiveRejection) throw err; // nothing was created; outer catch maps the decline
        // Ambiguous outcome (timeout / network error / gateway 5xx): the create may have
        // COMMITTED remotely without handing us the id. Marking the attempt failed here would
        // let a retry (new attempt = new Idempotency-Key) mint a second live subscription.
        // Re-POST once with the SAME key: the gateway honors Idempotency-Key (spike criterion
        // 5), so a committed first request returns the same subscription instead of a
        // duplicate, and a lost first request makes this an ordinary create. A second
        // consecutive ambiguous failure falls to the outer catch; that residual window is
        // what the Fase 5 remote-side reconciliation sweep exists for.
        console.error(
          "[pagarme-checkout] ambiguous subscription outcome, retrying with the same key:",
          err instanceof Error ? err.message : String(err),
        );
        sub = await gateway.createSubscription(subInput, idemKey);
      }

      // ── Commit phase. The remote subscription now EXISTS. Every failure path below,
      // up to a committed bind, resolves by CANCELING it (compensation): leaving it alive
      // would let a user retry mint a SECOND subscription, because the idempotency key is
      // per attempt. With the 30-day trial nothing was charged; without it, one charge may
      // need a manual refund — still strictly better than a paid subscription bound to
      // nothing. After a committed bind, failures never cancel. DB failures here RETURN
      // (after compensating) instead of throwing, so the outer catch stays a pure
      // gateway-stage mapper. ──
      const failCompensating = async (status: number, body: unknown): Promise<CheckoutResult> => {
        let cancelled = false;
        try {
          await gateway.cancelSubscription(sub.id);
          cancelled = true;
        } catch (e) {
          console.error(
            "[pagarme-checkout] compensating cancel failed:",
            e instanceof Error ? e.message : String(e),
          );
        }
        if (cancelled) {
          await finishAttempt("failed", sub.id);
        } else {
          // The remote subscription may still be live and we could not kill it. Keep the
          // reservation PENDING: releasing it would allow an immediate retry with a new
          // idempotency key against a possibly-live subscription. The 15-minute expiry
          // re-opens checkout; the recorded orphan pointer (and the Fase 5 remote sweep)
          // resolves the remote side.
          console.error(
            `[pagarme-checkout] attempt ${attemptId} left pending: remote subscription ${sub.id} may be live and uncancelled`,
          );
        }
        return { status, body };
      };

      // (8)-(10) Commit window: orphan pointer write, non-live-status check, and the CAS
      // bind. The remote subscription already exists at this point, so EVERY failure in
      // here — checked error or thrown exception — must compensate. postgrest-js currently
      // resolves DB failures as { data, error } instead of rejecting, so the inner catch is
      // a structural guarantee (against .throwOnError(), a client swap, or a library
      // upgrade) rather than a live path today.
      let liveStatus: "trialing" | "active";
      let currentPeriodEnd: string | null;
      try {
        // (8) Orphan pointer — MANDATORY: it is what reconciliation depends on. If it cannot
        // be committed, the only safe outcome is to cancel the remote sub and fail.
        const { error: ptrErr } = await db
          .from("pagarme_checkout_attempts")
          .update({ pagarme_subscription_id: sub.id, updated_at: new Date().toISOString() })
          .eq("id", attemptId)
          .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
        if (ptrErr) {
          console.error("[pagarme-checkout] attempt sub-id write failed:", ptrErr.message);
          return await failCompensating(500, GENERIC_500);
        }

        // (9) "failed" is the undocumented fourth status: the first charge was refused, no
        // plan was ever granted, so there is nothing to preserve. Any other non-live status
        // at creation (canceled / unknown) gets the same treatment: nothing was granted.
        const normalized = normalizePagarmeStatus(sub.status);
        if (normalized !== "trialing" && normalized !== "active") {
          console.error(`[pagarme-checkout] subscription born non-live (status=${sub.status})`);
          return await failCompensating(400, {
            error: "Cartão recusado. Confira os dados ou tente outro cartão.",
            code: "invalid_card",
          });
        }

        // (10) CAS bind, single statement: provider flip + full amount mirror together
        // (master-plan INVARIANTE; the admin reads the mirror for pagarme rows and never
        // live-fetches). The write is pinned to the ownership coordinates observed at
        // gate-read time — provider plus that provider's registered subscription id —
        // mirroring the Fase 2 stripe-webhook CAS. If a concurrent writer (e.g. a Stripe
        // checkout.session.completed bind) changed the row in between, zero rows match: we
        // compensate and 409 instead of silently clobbering a freshly bound subscription.
        // With no row observed, a plain INSERT (never upsert) makes the concurrent-create
        // case surface as a 23505 instead of an overwrite.
        const temporal = mapPagarmeTemporalFields(sub);
        const columns = buildPagarmeSubscriptionColumns({
          customerId: customer.id,
          subscriptionId: sub.id,
          status: normalized,
          planId: reqData.planId,
          annualPriceCents: Number(plan.price_brl_annual),
          currentPeriodEnd: temporal.current_period_end,
          everSubscribedAt: (row?.ever_subscribed_at as string | null) ?? nowIso,
          nowIso,
        });
        if (row) {
          const observedProvider = (row.provider as string | null) ?? "stripe";
          const observedIdColumn = observedProvider === "pagarme"
            ? "pagarme_subscription_id"
            : "stripe_subscription_id";
          const observedId = (row as Record<string, unknown>)[observedIdColumn] ?? null;
          let bind = db
            .from("workspace_subscriptions")
            .update(columns)
            .eq("workspace_id", ctx.workspaceId)
            .eq("provider", observedProvider);
          bind = observedId == null
            ? bind.is(observedIdColumn, null)
            : bind.eq(observedIdColumn, observedId);
          const { data: bound, error: bindErr } = await bind
            .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
            .select("workspace_id");
          if (bindErr) {
            console.error("[pagarme-checkout] bind update failed:", bindErr.message);
            return await failCompensating(500, GENERIC_500);
          }
          if (!bound?.length) {
            console.error(
              `[pagarme-checkout] ownership changed under checkout for workspace ${ctx.workspaceId}`,
            );
            return await failCompensating(409, ROW_CONFLICT_409);
          }
        } else {
          const { error: insErr } = await db
            .from("workspace_subscriptions")
            .insert({ workspace_id: ctx.workspaceId, ...columns })
            .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
          if (insErr) {
            if (insErr.code === "23505") {
              console.error(
                `[pagarme-checkout] concurrent row create under checkout for workspace ${ctx.workspaceId}`,
              );
              return await failCompensating(409, ROW_CONFLICT_409);
            }
            console.error("[pagarme-checkout] bind insert failed:", insErr.message);
            return await failCompensating(500, GENERIC_500);
          }
        }

        liveStatus = normalized;
        currentPeriodEnd = temporal.current_period_end;
      } catch (err) {
        // A THROWN exception inside the commit window must compensate exactly like a checked
        // error: the remote subscription already exists. postgrest-js currently resolves DB
        // failures as { error } instead of throwing, so this catch is a structural guarantee
        // (against .throwOnError(), a client swap, or a library upgrade), not a live path.
        console.error(
          "[pagarme-checkout] commit window threw:",
          err instanceof Error ? err.message : String(err),
        );
        return await failCompensating(500, GENERIC_500);
      }

      // (11) Effective plan (respects admin comps via plan_source='manual'). POST-BIND: the
      // subscription is live and bound, so a failure here must NOT cancel it, and failing
      // the request would tell the user to retry a checkout that can only 409 now. Log
      // CRITICAL and answer 200; recovery is support/admin (and the Fase 4 webhook).
      try {
        await writeWorkspacePlan(db, ctx.workspaceId, reqData.planId, "pagarme");
      } catch (e) {
        console.error(
          `[pagarme-checkout] CRITICAL: plan grant failed for workspace ${ctx.workspaceId}:`,
          e instanceof Error ? e.message : String(e),
        );
      }
      await finishAttempt("succeeded", sub.id);

      return {
        status: 200,
        body: {
          status: liveStatus,
          trial_ends_at: liveStatus === "trialing" ? currentPeriodEnd : null,
          next_charge_at: currentPeriodEnd,
          installment_amount_cents: installmentAmountCents(Number(plan.price_brl_annual)),
        },
      };
    } catch (err) {
      // Ambiguous subscription-stage outcomes (timeout/network/5xx even after the same-key
      // retry) may have a live remote subscription with no recorded id. Releasing the
      // reservation would let an immediate retry (new attempt = new idempotency key) mint a
      // duplicate: leave the attempt PENDING so the partial unique index keeps blocking
      // checkouts (409) until the 15-minute self-heal expiry. The Fase 5 remote-side sweep
      // is the durable resolver. Customer/card-stage failures and definitive 4xx rejections
      // created nothing remotely and release normally.
      const ambiguousCreate = stage === "subscription" &&
        !(err instanceof PagarmeApiError && err.status >= 400 && err.status < 500);
      if (!ambiguousCreate) await finishAttempt("failed");
      // Stage name + message only — NEVER the request body (card/document/address).
      console.error(
        `[pagarme-checkout] ${stage} stage failed:`,
        err instanceof Error ? err.message : String(err),
      );
      return mapGatewayFailure(stage, err);
    }
  };
}
