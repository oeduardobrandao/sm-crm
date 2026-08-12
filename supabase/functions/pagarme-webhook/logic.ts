// Pure helpers for pagarme-webhook. No network/env/Supabase dependencies — unit-testable in
// isolation, mirroring pagarme-checkout/logic.ts.

import { buildRecoveryEpisode, type DunningStage } from "../_shared/dunning-logic.ts";
import { mapPagarmeTemporalFields, normalizePagarmeStatus } from "../_shared/pagarme-logic.ts";

/** Envelope real capturado no spike: { id: "hook_...", account, type, created_at, data }. */
export interface WebhookEnvelope {
  id: string;
  type: string;
  data: Record<string, unknown>;
}

/** Null for anything that is not an object carrying non-empty string id/type and an object data. */
export function parseWebhookEnvelope(raw: unknown): WebhookEnvelope | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || r.id.length === 0) return null;
  if (typeof r.type !== "string" || r.type.length === 0) return null;
  if (typeof r.data !== "object" || r.data === null || Array.isArray(r.data)) return null;
  return { id: r.id, type: r.type, data: r.data as Record<string, unknown> };
}

/**
 * Resolves the subscription id carried by a charge event. The spike proved charge payloads embed
 * the invoice (with its subscription pointer) but the exact key casing was not capturable in
 * sandbox, so every plausible path is tried. The sub_ prefix requirement keeps a wrong pick from
 * ever resolving: an unrecognized shape returns null and the event is acked as unhandleable
 * (subscription.* events for the same burst still converge the state).
 */
export function extractChargeSubscriptionId(data: Record<string, unknown>): string | null {
  const candidates: unknown[] = [];
  const invoice = data.invoice;
  if (typeof invoice === "object" && invoice !== null && !Array.isArray(invoice)) {
    const inv = invoice as Record<string, unknown>;
    candidates.push(inv.subscription_id, inv.subscriptionId);
  }
  const subscription = data.subscription;
  if (typeof subscription === "object" && subscription !== null && !Array.isArray(subscription)) {
    candidates.push((subscription as Record<string, unknown>).id);
  }
  candidates.push(data.subscription_id);
  for (const c of candidates) {
    if (typeof c === "string" && c.startsWith("sub_")) return c;
  }
  return null;
}

/** Attempt-count fields are undocumented (support question 5 pending); probe defensively. */
export function extractChargeAttempt(data: Record<string, unknown>): number | null {
  const lastTx = data.last_transaction;
  const candidates: unknown[] = [
    typeof lastTx === "object" && lastTx !== null && !Array.isArray(lastTx)
      ? (lastTx as Record<string, unknown>).attempt_count
      : undefined,
    data.attempt_count,
    data.attempt,
  ];
  for (const c of candidates) {
    if (typeof c === "number" && Number.isFinite(c)) return c;
  }
  return null;
}

/** `failed` nasce quando a cobrança falha terminalmente (achado 3 do spike). */
export function isTerminalRemoteStatus(status: string): boolean {
  return status === "canceled" || status === "failed";
}

/**
 * Pagar.me does not expose a next-retry field (unlike Stripe, whose null next_payment_attempt IS
 * the final signal), so stages degrade to first/retry only. "final" is never selected from
 * counts: it is reserved for a terminal re-fetched subscription status inside the
 * charge.payment_failed handler.
 */
export function selectPagarmeDunningStage(failedCount: number): DunningStage {
  return failedCount <= 1 ? "first" : "retry";
}

export type ReconcileSource = "subscription" | "charge_paid";

export interface RemoteSubscriptionFields {
  status: string;
  start_at?: string | null;
  next_billing_at?: string | null;
  current_cycle?: { end_at?: string | null; status?: string | null } | null;
}

export interface StoredRowSnapshot {
  status: string | null;
  current_period_end: string | null;
}

export interface ReconcileResult {
  status: "trialing" | "active" | "canceled";
  /** True when the caller should also resolve and write the effective plan. */
  planEligible: boolean;
  columns: Record<string, unknown>;
}

/**
 * Columns to CAS-write for a re-fetched subscription. Three rules the tests pin down:
 *
 * 1. A canceled subscription NEVER clobbers the stored current_period_end (isPaidThrough depends
 *    on it), and cancel_at_period_end doubles as our paid-through marker: true only when the
 *    canceled sub's current_cycle.status is "billed" (the year was paid — out/15/20 show the
 *    cycle is retained on cancel). A trial cancel has no cycle → false → immediate downgrade.
 * 2. Payment truth lives in charge.*: a subscription.* event observing remote "active" while the
 *    row is in a dunning episode (status past_due) must NOT reset the episode nor the status —
 *    only charge.paid (source "charge_paid") or a terminal outcome closes an episode.
 * 3. An in-force write resets the dunning episode AND pagarme_dunning_key in the same statement.
 */
export function buildReconcileColumns(
  remote: RemoteSubscriptionFields,
  stored: StoredRowSnapshot,
  source: ReconcileSource,
  now: Date,
): ReconcileResult | null {
  const normalized = normalizePagarmeStatus(remote.status);
  if (normalized === null) return null;

  const mapped = mapPagarmeTemporalFields(remote);
  const current_period_end = mapped.current_period_end ?? stored.current_period_end;
  const cancel_at_period_end = normalized === "canceled"
    ? remote.current_cycle?.status === "billed"
    : false;

  const holdDunning = source === "subscription" &&
    stored.status === "past_due" &&
    normalized === "active";
  if (holdDunning) {
    return {
      status: normalized,
      planEligible: false,
      columns: {
        current_period_end,
        cancel_at_period_end,
        updated_at: now.toISOString(),
      },
    };
  }

  const inForce = normalized === "active" || normalized === "trialing";
  return {
    status: normalized,
    planEligible: true,
    columns: {
      status: normalized,
      current_period_end,
      cancel_at_period_end,
      ...(inForce ? { ...buildRecoveryEpisode(), pagarme_dunning_key: null } : {}),
      updated_at: now.toISOString(),
    },
  };
}
