// Pure decisions for pagarme-subscription. No network/env/Supabase access.

export type SubscriptionAction =
  | { action: "cancel" }
  | {
    action: "update_card";
    cardToken: string;
    billingAddress: { cep: string; line1: string; city: string; state: string };
  };

export type ParseFailure = { ok: false; status: 400; error: string; code: "invalid_request" };
export type ParseResult = { ok: true; value: SubscriptionAction } | ParseFailure;

function digits(v: unknown): string {
  return typeof v === "string" ? v.replace(/\D/g, "") : "";
}

function fail(error: string): ParseFailure {
  return { ok: false, status: 400, error, code: "invalid_request" };
}

/** Same defensive shape as pagarme-checkout's parseCheckoutBody: req.json() may resolve to anything. */
export function parseSubscriptionBody(raw: unknown): ParseResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return fail("Requisição inválida.");
  }
  const body = raw as Record<string, unknown>;
  if (body.action === "cancel") return { ok: true, value: { action: "cancel" } };
  if (body.action !== "update_card") return fail("Ação inválida.");

  const cardToken = typeof body.card_token === "string" ? body.card_token.trim() : "";
  if (!cardToken) return fail("Dados do cartão inválidos.");
  const addr = (body.billing_address ?? {}) as Record<string, unknown>;
  const cep = digits(addr.cep);
  const line1 = typeof addr.line_1 === "string" ? addr.line_1.trim() : "";
  const city = typeof addr.city === "string" ? addr.city.trim() : "";
  const state = typeof addr.state === "string" ? addr.state.trim().toUpperCase() : "";
  if (cep.length !== 8 || !line1 || !city || !/^[A-Z]{2}$/.test(state)) {
    return fail("Endereço de cobrança inválido.");
  }
  return {
    ok: true,
    value: { action: "update_card", cardToken, billingAddress: { cep, line1, city, state } },
  };
}

/**
 * Local columns for a user-initiated cancel, decided by the OBSERVED status:
 * - active WITH a provable period end (stored locally, or recovered from the DELETE
 *   response's current_cycle.end_at — the spike showed the cancel response carries the full
 *   subscription): the year is already charged (12 installments in flight). Paid-through:
 *   cancel_at_period_end=true, access until the boundary, billing-downgrade-cron downgrades
 *   after it. The STORED value wins; the remote one only FILLS a null (same direction as the
 *   webhook rule: canceled never clobbers a stored period end).
 * - active WITHOUT any provable period end: an open-ended paid-through would never match the
 *   cron's `.lte(current_period_end, now)` query — indefinite paid access on missing
 *   evidence. Immediate downgrade instead.
 * - trialing / past_due: nothing was collected. Immediate downgrade.
 */
export function buildCancelColumns(args: {
  observedStatus: string;
  storedPeriodEnd: string | null;
  remotePeriodEnd: string | null;
  nowIso: string;
}): { columns: Record<string, unknown>; immediateDowngrade: boolean; accessUntil: string | null } {
  const accessUntil = args.storedPeriodEnd ?? args.remotePeriodEnd;
  const paidThrough = args.observedStatus === "active" && accessUntil !== null;
  return {
    columns: {
      status: "canceled",
      cancel_at_period_end: paidThrough,
      updated_at: args.nowIso,
      // Fill-only: current_period_end is written ONLY when the stored value was null and
      // the DELETE response knew the cycle boundary. A stored value is never overwritten.
      ...(paidThrough && args.storedPeriodEnd === null
        ? { current_period_end: args.remotePeriodEnd }
        : {}),
    },
    immediateDowngrade: !paidThrough,
    accessUntil: paidThrough ? accessUntil : null,
  };
}
