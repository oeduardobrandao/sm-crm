/**
 * affiliate-payout-cron: repasse mensal do programa de afiliados por Stripe Connect.
 * Autentica pelo x-cron-secret (pg_cron, migration 20261013000002).
 *
 * Duas fases, nesta ordem:
 *   1. reconciliar repasses 'pending' de execuções interrompidas: procura o transfer pelo
 *      transfer_group; achou → 'paid'; não achou → tenta de novo com a mesma chave de
 *      idempotência;
 *   2. para cada afiliado ativo com conta Express e saldo disponível ≥ mínimo: relê a conta
 *      no Stripe; com `transfers` ativa, grava o repasse 'pending' ANTES do transfer (o saldo
 *      reservado não sai duas vezes) e transfere o saldo inteiro.
 *
 * Falha recusada pelo Stripe (4xx) → 'failed', e o valor volta ao saldo do mês seguinte.
 * Falha de resultado desconhecido (rede, timeout, 5xx) → continua 'pending' para a fase 1 da
 * próxima execução, que nunca transfere sem antes procurar pelo transfer_group.
 *
 * Spec: docs/superpowers/specs/2026-10-10-programa-de-afiliados-design.md
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  type AffiliateConnectGateway,
  classifyStripeError,
  refreshAffiliateStripeStatus,
} from "../_shared/affiliate-connect.ts";

const DB_TIMEOUT_MS = 10_000;
const MAX_PENDING_PER_RUN = 100;
const MAX_AFFILIATES_PER_RUN = 500;

export interface PayoutCronDeps {
  db: SupabaseClient;
  connect: AffiliateConnectGateway;
  now: () => Date;
  minPayoutCents: number;
}

export interface PayoutCronResult {
  reconciled: number;
  paid: number;
  failed: number;
  leftPending: number;
  skippedNotReady: number;
  errors: string[];
}

export function transferGroupFor(payoutId: string): string {
  return `affiliate_payout_${payoutId}`;
}

function num(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0;
  return Number.isFinite(n) ? n : 0;
}

interface PayoutRow {
  id: string;
  affiliate_id: string;
  amount_cents: number;
  stripe_account_id: string;
}

export async function runAffiliatePayouts(deps: PayoutCronDeps): Promise<PayoutCronResult> {
  const { db, connect } = deps;
  const result: PayoutCronResult = {
    reconciled: 0,
    paid: 0,
    failed: 0,
    leftPending: 0,
    skippedNotReady: 0,
    errors: [],
  };

  async function markPaid(id: string, transferId: string) {
    const now = deps.now().toISOString();
    const { error } = await db
      .from("affiliate_payouts")
      .update({ status: "paid", stripe_transfer_id: transferId, paid_at: now, updated_at: now, failure_code: null })
      .eq("id", id)
      .eq("status", "pending")
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
    // O transfer já existe: uma falha aqui deixa a linha 'pending', e a fase 1 da próxima
    // execução a encontra pelo transfer_group. Nunca vira 'failed'.
    if (error) throw new Error(`payout ${id} paid write failed: ${error.message}`);
  }

  async function markFailed(id: string, code: string) {
    const { error } = await db
      .from("affiliate_payouts")
      .update({ status: "failed", failure_code: code, updated_at: deps.now().toISOString() })
      .eq("id", id)
      .eq("status", "pending")
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
    if (error) throw new Error(`payout ${id} failed write failed: ${error.message}`);
  }

  /** Transfere (ou acha o transfer já feito) e grava o desfecho. */
  async function settle(row: PayoutRow, phase: "reconcile" | "new") {
    const group = transferGroupFor(row.id);
    let transferId: string;
    try {
      transferId = (await connect.findTransferByGroup(group)) ?? await connect.createTransfer({
        amountCents: row.amount_cents,
        accountId: row.stripe_account_id,
        transferGroup: group,
        idempotencyKey: `affiliate-payout:${row.id}`,
        metadata: { affiliate_id: row.affiliate_id, payout_id: row.id },
      });
    } catch (err) {
      const e = classifyStripeError(err);
      if (e.kind === "unknown") {
        result.leftPending++;
        result.errors.push(`payout ${row.id} unknown outcome, kept pending: ${e.code}`);
        return;
      }
      try {
        await markFailed(row.id, e.code);
        result.failed++;
        result.errors.push(`payout ${row.id} rejected by stripe: ${e.code}`);
      } catch (dbErr) {
        result.leftPending++;
        result.errors.push(`payout ${row.id}: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`);
      }
      return;
    }
    try {
      await markPaid(row.id, transferId);
      if (phase === "reconcile") result.reconciled++;
      else result.paid++;
    } catch (dbErr) {
      result.leftPending++;
      result.errors.push(`payout ${row.id}: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`);
    }
  }

  // ── Fase 1: reconciliar 'pending' ────────────────────────────────────────────────────
  const { data: pending, error: pendingErr } = await db
    .from("affiliate_payouts")
    .select("id, affiliate_id, amount_cents, stripe_account_id")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(MAX_PENDING_PER_RUN)
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
  if (pendingErr) throw new Error(`pending payouts read failed: ${pendingErr.message}`);
  const pendingAffiliates = new Set<string>();
  for (const row of (pending ?? []) as PayoutRow[]) {
    await settle(row, "reconcile");
    pendingAffiliates.add(row.affiliate_id);
  }

  // ── Fase 2: novos repasses ───────────────────────────────────────────────────────────
  const [{ data: affiliates, error: affErr }, { data: summaries, error: sumErr }] = await Promise.all([
    db.from("affiliates")
      .select("id, stripe_account_id, stripe_transfers_active")
      .eq("status", "active")
      .not("stripe_account_id", "is", null)
      .limit(MAX_AFFILIATES_PER_RUN)
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS)),
    db.rpc("affiliate_summaries", { p_affiliate_id: null }),
  ]);
  if (affErr) throw new Error(`affiliates read failed: ${affErr.message}`);
  if (sumErr) throw new Error(`summaries read failed: ${sumErr.message}`);

  const available = new Map<string, number>();
  for (const s of (summaries ?? []) as Array<Record<string, unknown>>) {
    available.set(String(s.affiliate_id), num(s.available_cents));
  }

  for (const a of (affiliates ?? []) as Array<{ id: string; stripe_account_id: string }>) {
    // Um repasse desta execução ainda pendente: o saldo dele já está reservado, mas esperar
    // a reconciliação antes de abrir outro evita dois transfers em voo para a mesma conta.
    if (pendingAffiliates.has(a.id)) continue;
    const amount = available.get(a.id) ?? 0;
    if (amount < deps.minPayoutCents) continue;

    try {
      const status = await refreshAffiliateStripeStatus(db, connect, a, deps.now());
      if (!status.transfersActive) {
        result.skippedNotReady++;
        continue;
      }
    } catch (err) {
      result.errors.push(`affiliate ${a.id} status: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    const { data: row, error: insErr } = await db
      .from("affiliate_payouts")
      .insert({
        affiliate_id: a.id,
        amount_cents: amount,
        status: "pending",
        stripe_account_id: a.stripe_account_id,
      })
      .select("id, affiliate_id, amount_cents, stripe_account_id")
      .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS))
      .single();
    if (insErr || !row) {
      result.errors.push(`affiliate ${a.id} payout insert: ${insErr?.message ?? "no row"}`);
      continue;
    }
    await settle(row as PayoutRow, "new");
  }

  return result;
}

export function createAffiliatePayoutCronHandler(deps: {
  cronSecret: string;
  timingSafeEqual: (a: string, b: string) => boolean;
  run: (req: Request) => Promise<Response>;
}) {
  return async (req: Request): Promise<Response> => {
    if (!deps.timingSafeEqual(req.headers.get("x-cron-secret") ?? "", deps.cronSecret)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    return deps.run(req);
  };
}
