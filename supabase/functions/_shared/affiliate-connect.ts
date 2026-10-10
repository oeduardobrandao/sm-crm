// Stripe Connect do programa de afiliados: conta Express do afiliado (onboarding e painel do
// Stripe) e os transfers do repasse. Usado por affiliate-public e affiliate-payout-cron.
// Spec: docs/superpowers/specs/2026-10-10-programa-de-afiliados-design.md
//
// O cliente Stripe entra por parâmetro (sem import de ./stripe.ts, que exige
// STRIPE_SECRET_KEY no load) para os handlers serem testáveis com um gateway falso.

import type Stripe from "npm:stripe@17";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const STRIPE_TIMEOUT_MS = 10_000;
const DB_TIMEOUT_MS = 10_000;

export interface ConnectAccountStatus {
  detailsSubmitted: boolean;
  /** Só com a capability `transfers` ativa o Stripe aceita transfer para a conta. */
  transfersActive: boolean;
}

/**
 * Falha do Stripe classificada para o repasse:
 *  - "rejected": o Stripe recusou (4xx) e nada foi movido; o repasse pode virar 'failed';
 *  - "unknown": rede, timeout, 5xx ou 429; o transfer PODE ter acontecido, então o repasse
 *    fica 'pending' e a próxima execução reconcilia pelo transfer_group.
 */
export class ConnectError extends Error {
  constructor(
    readonly kind: "rejected" | "unknown",
    readonly code: string,
    // Mensagem crua do Stripe, só para log interno (nunca devolver ao cliente).
    readonly detail?: string,
  ) {
    super(`stripe connect ${kind}: ${code}`);
    this.name = "ConnectError";
  }
}

export interface AffiliateConnectGateway {
  createExpressAccount(p: { email: string; affiliateId: string }): Promise<string>;
  createOnboardingLink(p: { accountId: string; refreshUrl: string; returnUrl: string }): Promise<string>;
  createDashboardLink(accountId: string): Promise<string>;
  retrieveAccountStatus(accountId: string): Promise<ConnectAccountStatus>;
  findTransferByGroup(transferGroup: string): Promise<string | null>;
  createTransfer(p: {
    amountCents: number;
    accountId: string;
    transferGroup: string;
    idempotencyKey: string;
    metadata: Record<string, string>;
  }): Promise<string>;
}

export function accountStatusFrom(account: {
  details_submitted?: boolean | null;
  capabilities?: { transfers?: string | null } | null;
}): ConnectAccountStatus {
  return {
    detailsSubmitted: account.details_submitted === true,
    transfersActive: account.capabilities?.transfers === "active",
  };
}

export function classifyStripeError(err: unknown): ConnectError {
  if (err instanceof ConnectError) return err;
  const e = err as { statusCode?: number; code?: string; type?: string; message?: string } | null;
  const status = e?.statusCode;
  const code = String(e?.code ?? e?.type ?? "unknown").slice(0, 100);
  const detail = typeof e?.message === "string" ? e.message.slice(0, 300) : undefined;
  if (typeof status === "number" && status >= 400 && status < 500 && status !== 429) {
    return new ConnectError("rejected", code, detail);
  }
  return new ConnectError("unknown", code, detail);
}

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw classifyStripeError(err);
  }
}

async function shortHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest).slice(0, 6), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function createAffiliateConnectGateway(stripe: Stripe): AffiliateConnectGateway {
  const opts = { timeout: STRIPE_TIMEOUT_MS };
  return {
    createExpressAccount: ({ email, affiliateId }) =>
      call(async () => {
        const params: Stripe.AccountCreateParams = {
          type: "express",
          country: "BR",
          email,
          // No Brasil o Stripe recusa `transfers` sem `card_payments` ("You cannot request
          // the transfers capability without the card_payments capability for accounts in BR").
          // O afiliado não cobra ninguém; card_payments só destrava a conta para receber repasses.
          capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
          metadata: { affiliate_id: affiliateId },
        };
        // Dois cliques em sequência devolvem a mesma conta. A chave vale só pela hora corrente
        // (o Stripe guarda também respostas de erro por 24h, e uma chave fixa repetiria o erro
        // antigo mesmo depois de corrigida a causa) e leva uma impressão digital dos parâmetros
        // (o Stripe rejeita reusar uma chave com parâmetros diferentes).
        const fingerprint = await shortHash(JSON.stringify(params));
        const hour = Math.floor(Date.now() / 3_600_000);
        const account = await stripe.accounts.create(params, {
          ...opts,
          idempotencyKey: `affiliate-connect:${affiliateId}:${hour}:${fingerprint}`,
        });
        return account.id;
      }),
    createOnboardingLink: ({ accountId, refreshUrl, returnUrl }) =>
      call(async () => {
        const link = await stripe.accountLinks.create(
          { account: accountId, refresh_url: refreshUrl, return_url: returnUrl, type: "account_onboarding" },
          opts,
        );
        return link.url;
      }),
    createDashboardLink: (accountId) =>
      call(async () => (await stripe.accounts.createLoginLink(accountId, undefined, opts)).url),
    retrieveAccountStatus: (accountId) =>
      call(async () => accountStatusFrom(await stripe.accounts.retrieve(accountId, undefined, opts))),
    findTransferByGroup: (transferGroup) =>
      call(async () => {
        const list = await stripe.transfers.list({ transfer_group: transferGroup, limit: 1 }, opts);
        return list.data[0]?.id ?? null;
      }),
    createTransfer: ({ amountCents, accountId, transferGroup, idempotencyKey, metadata }) =>
      call(async () => {
        const transfer = await stripe.transfers.create(
          {
            amount: amountCents,
            currency: "brl",
            destination: accountId,
            transfer_group: transferGroup,
            metadata,
          },
          { ...opts, idempotencyKey },
        );
        return transfer.id;
      }),
  };
}

/** Relê a conta no Stripe e grava os flags no afiliado. Retorna o status atual. */
export async function refreshAffiliateStripeStatus(
  db: SupabaseClient,
  gateway: AffiliateConnectGateway,
  affiliate: { id: string; stripe_account_id: string },
  now: Date,
): Promise<ConnectAccountStatus> {
  const status = await gateway.retrieveAccountStatus(affiliate.stripe_account_id);
  const { error } = await db
    .from("affiliates")
    .update({
      stripe_details_submitted: status.detailsSubmitted,
      stripe_transfers_active: status.transfersActive,
      stripe_status_checked_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("id", affiliate.id)
    .eq("stripe_account_id", affiliate.stripe_account_id)
    .abortSignal(AbortSignal.timeout(DB_TIMEOUT_MS));
  if (error) throw new Error(`affiliate stripe status write failed: ${error.message}`);
  return status;
}
