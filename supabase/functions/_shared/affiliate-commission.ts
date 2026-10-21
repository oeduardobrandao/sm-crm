// Comissões do programa de afiliados (spec: docs/superpowers/specs/2026-10-10-programa-de-afiliados-design.md).
//
// Chamado pelo stripe-webhook. Só pagamentos Stripe geram comissão; o Pagar.me não chama
// nada daqui. Sem import de ../_shared/stripe.ts de propósito: aquele módulo exige
// STRIPE_SECRET_KEY no load, e o webhook passa o que precisa do SDK por parâmetro.
//
// Percentual e janela vêm de affiliate_commission_rules, por plano (ex.: Start 30% nos 3
// primeiros meses pagos). A janela conta meses pagos por workspace: fatura mensal consome 1,
// anual à vista consome 12 (e só a fração dentro da janela comissiona), proration de troca de
// plano consome 0 e comissiona inteira enquanto a janela estiver aberta.
//
// Erros de banco lançam: o webhook responde 5xx e o Stripe reentrega. Toda escrita é
// idempotente (uma comissão por stripe_invoice_id; estorno grava o acumulado, não um delta).

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { type PlanPriceRow, resolvePlanFromPriceId } from "./billing-logic.ts";

/** Carência entre o pagamento e a comissão ficar disponível para repasse. */
export const COMMISSION_HOLD_DAYS = 30;

const DB_TIMEOUT_MS = 10_000;

/** Repasse mínimo padrão: R$ 50,00. Abaixo disso o saldo acumula para o mês seguinte. */
export const DEFAULT_MIN_PAYOUT_CENTS = 5_000;

/** AFFILIATE_MIN_PAYOUT_CENTS → centavos (inteiro ≥ 100), senão o padrão. */
export function resolveMinPayoutCents(raw: string | undefined | null): number {
  const n = raw ? Number(raw) : NaN;
  return Number.isInteger(n) && n >= 100 ? n : DEFAULT_MIN_PAYOUT_CENTS;
}

/** Comissão em centavos, arredondada para baixo. rateBps 3000 = 30%. */
export function computeCommissionCents(amountCents: number, rateBps: number): number {
  if (!Number.isFinite(amountCents) || !Number.isFinite(rateBps)) return 0;
  if (amountCents <= 0 || rateBps <= 0) return 0;
  return Math.floor((amountCents * rateBps) / 10_000);
}

export function commissionAvailableAt(paidAt: Date, holdDays = COMMISSION_HOLD_DAYS): Date {
  return new Date(paidAt.getTime() + holdDays * 24 * 60 * 60 * 1000);
}

/** Uma linha de fatura: o preço fica em `price` (acacia) ou `pricing.price_details` (basil). */
export interface CommissionInvoiceLine {
  amount?: number | null;
  price?: { id: string } | string | null;
  pricing?: { price_details?: { price?: string | null } | null } | null;
  plan?: { id: string } | null;
}

/** Campos da fatura que importam aqui. */
export interface CommissionInvoice {
  id: string;
  customer: string | { id: string } | null;
  amount_paid: number;
  currency: string;
  billing_reason?: string | null;
  status_transitions?: { paid_at?: number | null } | null;
  lines?: { data?: CommissionInvoiceLine[] | null } | null;
}

function linePriceId(line: CommissionInvoiceLine): string | null {
  if (typeof line.price === "string") return line.price;
  return line.price?.id ?? line.pricing?.price_details?.price ?? line.plan?.id ?? null;
}

/**
 * Preço da fatura: o da linha de maior valor com preço. Numa proration de troca de plano a
 * linha positiva é o plano novo e a negativa o crédito do antigo.
 */
export function invoicePriceId(invoice: Pick<CommissionInvoice, "lines">): string | null {
  let best: { amount: number; price: string } | null = null;
  for (const line of invoice.lines?.data ?? []) {
    const price = linePriceId(line);
    if (!price) continue;
    const amount = typeof line.amount === "number" ? line.amount : 0;
    if (!best || amount > best.amount) best = { amount, price };
  }
  return best?.price ?? null;
}

/**
 * Quanto da fatura comissiona dentro da janela do plano. null = janela já fechada.
 *  - proration (subscription_update): consome 0 mês, comissiona a fatura inteira;
 *  - demais: consome os meses do intervalo (mensal 1, anual 12) até o que resta da janela,
 *    e comissiona a fração proporcional (anual com 3 meses restantes = 3/12 do valor).
 */
export function commissionWindowShare(params: {
  amountCents: number;
  interval: "month" | "year";
  billingReason: string | null | undefined;
  monthsUsed: number;
  windowMonths: number;
}): { commissionableCents: number; coveredMonths: number } | null {
  const remaining = params.windowMonths - Math.max(0, params.monthsUsed);
  if (remaining <= 0 || params.amountCents <= 0) return null;
  if (params.billingReason === "subscription_update") {
    return { commissionableCents: params.amountCents, coveredMonths: 0 };
  }
  const intervalMonths = params.interval === "year" ? 12 : 1;
  const covered = Math.min(intervalMonths, remaining);
  return {
    commissionableCents: Math.floor((params.amountCents * covered) / intervalMonths),
    coveredMonths: covered,
  };
}

export type CommissionOutcome =
  | "recorded"
  | "skipped:zero_amount"
  | "skipped:no_workspace"
  | "skipped:no_referral"
  | "skipped:affiliate_inactive"
  | "skipped:unknown_plan"
  | "skipped:no_rule"
  | "skipped:window_closed";

export interface RecordCommissionDeps {
  /** Relê a fatura pelo SDK quando o payload não traz o preço das linhas. */
  retrieveInvoicePriceId: (invoiceId: string) => Promise<string | null>;
}

/**
 * invoice.paid → comissão. Fatura de valor zero (trial) não gera nada. O workspace vem do
 * stripe_customer_id, que o billing-checkout grava antes de abrir a sessão; o plano vem do
 * preço da fatura (não do espelho da assinatura, que pode chegar depois deste evento).
 */
export async function recordInvoiceCommission(
  db: SupabaseClient,
  invoice: CommissionInvoice,
  eventCreatedUnix: number,
  deps: RecordCommissionDeps,
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
    .select("id, status")
    .eq("id", referral.affiliate_id)
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
    .maybeSingle();
  if (affErr) throw new Error(`affiliate: affiliate read failed: ${affErr.message}`);
  if (!affiliate || affiliate.status !== "active") return "skipped:affiliate_inactive";

  const priceId = invoicePriceId(invoice) ?? await deps.retrieveInvoicePriceId(invoice.id);
  const { data: plans, error: plansErr } = await db
    .from("plans")
    .select("id, stripe_price_id, stripe_price_id_annual")
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
  if (plansErr) throw new Error(`affiliate: plans read failed: ${plansErr.message}`);
  const resolved = priceId ? resolvePlanFromPriceId(priceId, (plans ?? []) as PlanPriceRow[]) : null;
  if (!resolved) return "skipped:unknown_plan";

  const { data: rule, error: ruleErr } = await db
    .from("affiliate_commission_rules")
    .select("rate_bps, months")
    .eq("plan_id", resolved.plan_id)
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
    .maybeSingle();
  if (ruleErr) throw new Error(`affiliate: rule read failed: ${ruleErr.message}`);
  if (!rule) return "skipped:no_rule";

  // Meses da janela já consumidos por este workspace. A própria fatura fica de fora para uma
  // reentrega recalcular igual (o upsert abaixo ignora a duplicata de qualquer forma).
  const { data: prior, error: priorErr } = await db
    .from("affiliate_commissions")
    .select("covered_months")
    .eq("workspace_id", workspaceId)
    .neq("stripe_invoice_id", invoice.id)
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
  if (priorErr) throw new Error(`affiliate: window read failed: ${priorErr.message}`);
  const monthsUsed = ((prior ?? []) as Array<{ covered_months: number }>)
    .reduce((sum, c) => sum + (Number(c.covered_months) || 0), 0);

  const share = commissionWindowShare({
    amountCents: invoice.amount_paid,
    interval: resolved.interval,
    billingReason: invoice.billing_reason,
    monthsUsed,
    windowMonths: Number(rule.months),
  });
  if (!share) return "skipped:window_closed";

  const rateBps = Number(rule.rate_bps);
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
        plan_id: resolved.plan_id,
        billing_reason: invoice.billing_reason ?? null,
        commissionable_cents: share.commissionableCents,
        covered_months: share.coveredMonths,
        rate_bps: rateBps,
        commission_cents: computeCommissionCents(share.commissionableCents, rateBps),
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
