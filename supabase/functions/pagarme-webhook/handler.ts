// Event handler for pagarme-webhook. The serve shell (index.ts) owns auth, dedup and HTTP;
// this module owns event semantics. Every DB call is bounded (house rule). Throws propagate
// to the shell → 5xx → Pagar.me redelivers (up to 3 attempts, dashboard-configured).

import { getDefaultPlanId } from "../_shared/billing-logic.ts";
import {
  buildChargeDunningKey,
  canWebhookWrite,
  resolvePagarmePlanTarget,
  shouldAdvanceDunning,
} from "../_shared/pagarme-logic.ts";
import { buildFailureEpisode, type DunningStage } from "../_shared/dunning-logic.ts";
import {
  buildReconcileColumns,
  extractChargeAttempt,
  extractChargeSubscriptionId,
  isTerminalRemoteStatus,
  selectPagarmeDunningStage,
  shouldSendTerminalDunningEmail,
  type ReconcileSource,
  type WebhookEnvelope,
} from "./logic.ts";
import type { RemoteSubscription, WebhookGateway } from "./gateway.ts";

const DB_TIMEOUT_MS = 10_000;

const ROW_COLUMNS =
  "workspace_id, plan_id, provider, stripe_subscription_id, pagarme_subscription_id, status, cancel_at_period_end, current_period_end, past_due_since, failed_payment_count, pagarme_dunning_key";

interface SubscriptionRow {
  workspace_id: string;
  plan_id: string | null;
  provider: string | null;
  stripe_subscription_id: string | null;
  pagarme_subscription_id: string | null;
  status: string | null;
  cancel_at_period_end: boolean | null;
  current_period_end: string | null;
  past_due_since: string | null;
  failed_payment_count: number | null;
  pagarme_dunning_key: string | null;
}

// deno-lint-ignore no-explicit-any
type WebhookDb = any;

export interface PagarmeWebhookDeps {
  db: WebhookDb;
  gateway: WebhookGateway;
  /** Wired to notifyOwnerOfFailure in index.ts; injected so tests capture e-mails. */
  notify: (workspaceId: string, stage: DunningStage) => Promise<void>;
  now?: () => Date;
}

export function createPagarmeWebhookHandler(deps: PagarmeWebhookDeps) {
  const now = deps.now ?? (() => new Date());

  async function loadRow(subId: string): Promise<SubscriptionRow | null> {
    const { data, error } = await deps.db
      .from("workspace_subscriptions")
      .select(ROW_COLUMNS)
      .eq("pagarme_subscription_id", subId)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .maybeSingle();
    if (error) throw new Error(`row read failed for ${subId}: ${error.message}`);
    return (data as SubscriptionRow | null) ?? null;
  }

  /** Null when the write must not happen (ownership/metadata); throws to request redelivery. */
  async function authorize(subId: string): Promise<
    { row: SubscriptionRow; remote: RemoteSubscription } | null
  > {
    const row = await loadRow(subId);
    if (row === null) {
      // Checkout-bind race (resolved by a redelivery) or a subscription this account does not
      // track (dies after Pagar.me's 3-attempt budget). Either way: 5xx, never ack.
      throw new Error(`no local row for subscription ${subId}`);
    }
    const allowed = canWebhookWrite(
      row,
      { provider: "pagarme", subscriptionId: subId, isAuthorizedBind: false },
      now(),
    );
    if (!allowed) {
      console.warn(
        `[pagarme-webhook] write denied for subscription ${subId} on workspace ${row.workspace_id}: row not owned by this pagarme subscription`,
      );
      return null;
    }
    const remote = await deps.gateway.fetchSubscription(subId);
    const metaWs = remote.metadata?.workspace_id;
    if (metaWs && metaWs !== row.workspace_id) {
      console.error(
        `[pagarme-webhook] metadata divergence for subscription ${subId}: remote workspace ${metaWs} != local ${row.workspace_id}; acking without write`,
      );
      return null;
    }
    return { row, remote };
  }

  /**
   * Optional pins (spec-review P1): pinning the observed status serializes concurrent duplicate
   * deliveries on the terminal path (exactly one transitions the row and e-mails); pinning the
   * observed dunning key does the same for stage advances. `.eq(col, null)` matches nothing in
   * PostgREST — null pins MUST use `.is()` (same trap as the Fase 3 CAS).
   */
  async function casWrite(
    row: SubscriptionRow,
    subId: string,
    columns: Record<string, unknown>,
    pins?: { observedStatus?: string | null; observedDunningKey?: string | null },
  ): Promise<void> {
    let update = deps.db
      .from("workspace_subscriptions")
      .update(columns)
      .eq("workspace_id", row.workspace_id)
      .eq("provider", "pagarme")
      .eq("pagarme_subscription_id", subId);
    if (pins && "observedStatus" in pins) {
      update = pins.observedStatus == null
        ? update.is("status", null)
        : update.eq("status", pins.observedStatus);
    }
    if (pins && "observedDunningKey" in pins) {
      update = pins.observedDunningKey == null
        ? update.is("pagarme_dunning_key", null)
        : update.eq("pagarme_dunning_key", pins.observedDunningKey);
    }
    const { data: updated, error } = await update
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .select("workspace_id");
    if (error) {
      throw new Error(`subscription write failed for workspace ${row.workspace_id}: ${error.message}`);
    }
    if (!updated?.length) {
      throw new Error(`concurrent ownership change on workspace ${row.workspace_id}, retrying via redelivery`);
    }
  }

  async function grantPlan(
    row: SubscriptionRow,
    subId: string,
    status: "trialing" | "active" | "canceled",
    columns: Record<string, unknown>,
  ): Promise<void> {
    if (!row.plan_id) {
      // A pagarme row is always born with plan_id at checkout; a null here is corrupted state.
      // Granting default would be a stealth downgrade — log loudly and leave the plan alone.
      console.error(
        `[pagarme-webhook] CRITICAL: pagarme row for workspace ${row.workspace_id} has no plan_id; skipping plan write`,
      );
      return;
    }
    const defaultPlanId = await getDefaultPlanId(deps.db);
    const target = resolvePagarmePlanTarget(
      status,
      row.plan_id,
      defaultPlanId,
      {
        cancel_at_period_end: columns.cancel_at_period_end as boolean,
        current_period_end: (columns.current_period_end as string | null) ?? null,
      },
      now(),
    );
    if (target === null) return;
    // Atomic, state-guarded write (grant_pagarme_plan migration): the status CAS above does NOT
    // cover this separate workspaces.plan_id write. An out-of-order delivery (a concurrent cancel,
    // or a cross-provider Stripe reclaim) could otherwise let this stale handler restore a paid
    // plan for a subscription it no longer owns — and a canceled sub gets no further event to
    // self-heal it. The RPC writes only while the row is still THIS pagarme subscription in the
    // reconciled status (and preserves manual comps); 0 rows = a concurrent transition took
    // ownership, a legitimate no-op. A DB error still throws → 5xx → redelivery.
    const { data: written, error } = await deps.db
      .rpc("grant_pagarme_plan", {
        p_workspace: row.workspace_id,
        p_plan: target,
        p_sub: subId,
        p_status: status,
      })
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
    if (error) {
      throw new Error(`pagarme plan write failed for ${row.workspace_id}: ${error.message}`);
    }
    if (written === 0) {
      console.warn(
        `[pagarme-webhook] plan grant skipped for workspace ${row.workspace_id}: subscription ${subId} guard did not match reconciled status ${status} (concurrent transition or manual comp)`,
      );
    }
  }

  async function reconcile(subId: string, source: ReconcileSource): Promise<string> {
    const auth = await authorize(subId);
    if (auth === null) return "ignored:ownership";
    const { row, remote } = auth;
    const result = buildReconcileColumns(
      remote,
      { status: row.status, current_period_end: row.current_period_end },
      source,
      now(),
    );
    if (result === null) {
      console.warn(
        `[pagarme-webhook] unknown remote status "${remote.status}" for subscription ${subId}; acking without write`,
      );
      return "ignored:unknown-status";
    }
    // Pin the observed status (spec-review Important): subscription.* is NOT authoritative for
    // payment state — charge.* is. Without this pin, a subscription.updated that sampled the row
    // before a concurrent charge.payment_failed committed would overwrite the just-established
    // past_due episode with a stale "active" (buildReconcileColumns' holdDunning guard reads the
    // same stale snapshot). The pin makes the racing write miss the CAS -> 5xx -> redelivery
    // re-reads fresh state and holdDunning then applies. Mirrors the terminal/dunning-advance pins.
    await casWrite(row, subId, result.columns, { observedStatus: row.status });
    if (result.planEligible) {
      await grantPlan(row, subId, result.status, result.columns);
      return source === "charge_paid" ? "reconciled:recovered" : "reconciled";
    }
    return "reconciled:dunning-held";
  }

  async function handleChargeFailed(
    subId: string,
    data: Record<string, unknown>,
  ): Promise<string> {
    const auth = await authorize(subId);
    if (auth === null) return "ignored:ownership";
    const { row, remote } = auth;

    if (isTerminalRemoteStatus(remote.status)) {
      // Terminal outcome confirmed on the re-fetched object: the ONLY path that may send
      // "final". Write first (status-pinned: of two concurrent duplicates exactly one
      // transitions the row), e-mail last, and only when the gate says the cancellation
      // really closed a failing episode (a voluntary cancel racing a late failure event
      // must not e-mail — spec-review P1).
      const result = buildReconcileColumns(
        remote,
        { status: row.status, current_period_end: row.current_period_end },
        "subscription",
        now(),
      );
      if (result === null) return "ignored:unknown-status";
      await casWrite(row, subId, result.columns, { observedStatus: row.status });
      await grantPlan(row, subId, result.status, result.columns);
      if (shouldSendTerminalDunningEmail(remote.status, row)) {
        await deps.notify(row.workspace_id, "final");
        return "dunning:final";
      }
      return "reconciled:terminal";
    }

    const chargeId = typeof data.id === "string" && data.id.length > 0 ? data.id : null;
    if (!chargeId) return "ignored:no-charge-id";
    const key = buildChargeDunningKey(chargeId, extractChargeAttempt(data));
    if (!shouldAdvanceDunning(row.pagarme_dunning_key, key)) {
      return "ignored:duplicate-failure";
    }
    const episode = buildFailureEpisode(
      row.past_due_since,
      (row.failed_payment_count ?? 0) + 1,
      null,
      now(),
    );
    // Pin the observed status too, so a failure write that fetched an active sub cannot commit
    // stale after a concurrent charge.paid recovery or terminal cancel changed the row (delayed
    // delivery misses the CAS -> 5xx -> redelivery re-reads current state).
    await casWrite(row, subId, {
      status: "past_due",
      ...episode,
      pagarme_dunning_key: key,
      updated_at: now().toISOString(),
    }, { observedStatus: row.status, observedDunningKey: row.pagarme_dunning_key });
    // past_due keeps the plan (grace, like statusToPlanId) — no plan write here.
    const stage = selectPagarmeDunningStage(episode.failed_payment_count);
    await deps.notify(row.workspace_id, stage);
    return `dunning:${stage}`;
  }

  return async function handleEvent(envelope: WebhookEnvelope): Promise<string> {
    switch (envelope.type) {
      case "subscription.created":
      case "subscription.updated":
      case "subscription.canceled": {
        const id = envelope.data.id;
        const subId = typeof id === "string" && id.startsWith("sub_") ? id : null;
        if (!subId) return "ignored:no-subscription-id";
        return await reconcile(subId, "subscription");
      }
      case "charge.paid": {
        const subId = extractChargeSubscriptionId(envelope.data);
        if (!subId) return "ignored:no-subscription-id";
        return await reconcile(subId, "charge_paid");
      }
      case "charge.payment_failed": {
        const subId = extractChargeSubscriptionId(envelope.data);
        if (!subId) return "ignored:no-subscription-id";
        return await handleChargeFailed(subId, envelope.data);
      }
      case "charge.refunded": {
        const subId = extractChargeSubscriptionId(envelope.data);
        if (!subId) return "ignored:no-subscription-id";
        // A refund does not prove cancellation — the subscription may keep renewing. Reflect
        // whatever the re-fetched status really is and leave a trail for manual follow-up.
        console.warn(
          `[pagarme-webhook] charge.refunded for subscription ${subId}; reconciling real status, manual follow-up may be needed`,
        );
        return await reconcile(subId, "subscription");
      }
      default:
        // invoice.* (data-only family), charge.created/pending, and anything unknown: ack.
        return "ignored:unhandled-type";
    }
  };
}
