// Comissões do programa de afiliados (spec: docs/superpowers/specs/2026-10-10-programa-de-afiliados-design.md).
//
// Chamado pelo stripe-webhook. Só pagamentos Stripe geram comissão; o Pagar.me não chama
// nada daqui. Sem import de ../_shared/stripe.ts de propósito: aquele módulo exige
// STRIPE_SECRET_KEY no load, e o webhook passa o que precisa do SDK por parâmetro.
//
// Erros de banco lançam: o webhook responde 5xx e o Stripe reentrega. Toda escrita é
// idempotente (uma comissão por stripe_invoice_id; estorno grava o acumulado, não um delta).

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/** Carência entre o pagamento e a comissão ficar disponível para repasse. */
export const COMMISSION_HOLD_DAYS = 30;

const DB_TIMEOUT_MS = 10_000;

/** Comissão em centavos, arredondada para baixo. rateBps 2000 = 20%. */
export function computeCommissionCents(amountCents: number, rateBps: number): number {
  if (!Number.isFinite(amountCents) || !Number.isFinite(rateBps)) return 0;
  if (amountCents <= 0 || rateBps <= 0) return 0;
  return Math.floor((amountCents * rateBps) / 10_000);
}

export function commissionAvailableAt(paidAt: Date, holdDays = COMMISSION_HOLD_DAYS): Date {
  return new Date(paidAt.getTime() + holdDays * 24 * 60 * 60 * 1000);
}

/** Campos da fatura que importam aqui (iguais em acacia e basil). */
export interface CommissionInvoice {
  id: string;
  customer: string | { id: string } | null;
  amount_paid: number;
  currency: string;
  status_transitions?: { paid_at?: number | null } | null;
}

export type CommissionOutcome =
  | "recorded"
  | "skipped:zero_amount"
  | "skipped:no_workspace"
  | "skipped:no_referral"
  | "skipped:affiliate_inactive";

/**
 * invoice.paid → comissão. Fatura de valor zero (trial) não gera nada. O workspace vem do
 * stripe_customer_id, que o billing-checkout grava antes de abrir a sessão.
 */
export async function recordInvoiceCommission(
  db: SupabaseClient,
  invoice: CommissionInvoice,
  eventCreatedUnix: number,
): Promise<CommissionOutcome> {
  if (!(invoice.amount_paid > 0)) return "skipped:zero_amount";

  const customerId = typeof invoice.customer === "string"
    ? invoice.customer
    : invoice.customer?.id ?? null;
  if (!customerId) return "skipped:no_workspace";

  const { data: sub, error: subErr } = await db
    .from("workspace_subscriptions")
    .select("workspace_id")
    .eq("stripe_customer_id", customerId)
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
    .maybeSingle();
  if (subErr) throw new Error(`affiliate: workspace read failed: ${subErr.message}`);
  const workspaceId = (sub?.workspace_id as string | undefined) ?? null;
  if (!workspaceId) return "skipped:no_workspace";

  const { data: referral, error: refErr } = await db
    .from("affiliate_referrals")
    .select("affiliate_id")
    .eq("workspace_id", workspaceId)
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
    .maybeSingle();
  if (refErr) throw new Error(`affiliate: referral read failed: ${refErr.message}`);
  if (!referral?.affiliate_id) return "skipped:no_referral";

  const { data: affiliate, error: affErr } = await db
    .from("affiliates")
    .select("id, status, commission_rate_bps")
    .eq("id", referral.affiliate_id)
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
    .maybeSingle();
  if (affErr) throw new Error(`affiliate: affiliate read failed: ${affErr.message}`);
  if (!affiliate || affiliate.status !== "active") return "skipped:affiliate_inactive";

  const rateBps = Number(affiliate.commission_rate_bps);
  const paidAtUnix = invoice.status_transitions?.paid_at ?? eventCreatedUnix;
  const paidAt = new Date(paidAtUnix * 1000);

  const { error: insErr } = await db
    .from("affiliate_commissions")
    .upsert(
      {
        affiliate_id: affiliate.id,
        workspace_id: workspaceId,
        stripe_invoice_id: invoice.id,
        currency: (invoice.currency || "brl").toLowerCase(),
        invoice_amount_cents: invoice.amount_paid,
        rate_bps: rateBps,
        commission_cents: computeCommissionCents(invoice.amount_paid, rateBps),
        paid_at: paidAt.toISOString(),
        available_at: commissionAvailableAt(paidAt).toISOString(),
      },
      { onConflict: "stripe_invoice_id", ignoreDuplicates: true },
    )
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
  if (insErr) throw new Error(`affiliate: commission insert failed: ${insErr.message}`);
  return "recorded";
}

/** Ajuste vindo de uma cobrança: estorno (acumulado) e/ou contestação. */
export interface CommissionAdjustment {
  refundedAmountCents?: number;
  disputed?: boolean;
}

/**
 * Aplica estorno/contestação à comissão da fatura. Sem comissão para a fatura (workspace
 * não indicado, fatura antiga) é no-op. Retorna se alguma linha foi alterada.
 */
export async function applyCommissionAdjustment(
  db: SupabaseClient,
  stripeInvoiceId: string,
  adj: CommissionAdjustment,
): Promise<boolean> {
  const patch: Record<string, unknown> = {};
  if (adj.refundedAmountCents != null) {
    patch.refunded_amount_cents = Math.max(0, Math.floor(adj.refundedAmountCents));
  }
  if (adj.disputed != null) patch.disputed = adj.disputed;
  if (Object.keys(patch).length === 0) return false;
  patch.updated_at = new Date().toISOString();

  const { data, error } = await db
    .from("affiliate_commissions")
    .update(patch)
    .eq("stripe_invoice_id", stripeInvoiceId)
    .select("id")
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
  if (error) throw new Error(`affiliate: commission adjustment failed: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/** Uma contestação só zera a comissão em definitivo quando o Stripe a dá como perdida. */
export function disputeClosedIsLoss(status: string | null | undefined): boolean {
  return status === "lost";
}

/**
 * Id da fatura de uma cobrança. `charge.invoice` existe nas versões de API anteriores à
 * basil; sem o campo no payload, a cobrança é relida pelo SDK (cuja versão fixada traz o
 * campo). Retorna null para cobranças avulsas.
 */
export async function resolveChargeInvoiceId(
  charge: { id: string; invoice?: string | { id: string } | null },
  retrieveCharge: (id: string) => Promise<{ invoice?: string | { id: string } | null }>,
): Promise<string | null> {
  const fromPayload = pickInvoiceId(charge.invoice);
  if (fromPayload) return fromPayload;
  if ("invoice" in charge && charge.invoice === null) return null;
  const fresh = await retrieveCharge(charge.id);
  return pickInvoiceId(fresh.invoice);
}

function pickInvoiceId(v: string | { id: string } | null | undefined): string | null {
  if (!v) return null;
  return typeof v === "string" ? v : v.id ?? null;
}
