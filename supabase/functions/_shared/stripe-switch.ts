// Porta Stripe injetavel do switch seamless (mensal Stripe -> 12x Pagar.me) e do leg D do
// cron. Modulo dedicado em vez de _shared/stripe.ts porque aquele LANCA no import quando
// STRIPE_SECRET_KEY nao existe: importa-lo de uma function que precisa bootar em ambiente
// dark (billing-downgrade-cron) derrubaria a function inteira. Aqui a factory recebe a key
// como argumento; cada index.ts constroi o gateway atras de Deno.env.get e passa null
// quando dark (mesmo padrao do gateway Pagar.me nulo em billing-downgrade-cron/index.ts).

import Stripe from "npm:stripe@17";
import { fetchStripeAmount, StripeAmount } from "./stripe-amount.ts";

// Toda chamada é bounded para que um stall vire erro capturavel, nunca Edge kill
// (precedente: STRIPE_CANCEL_TIMEOUT_MS no stripe-webhook).
export const STRIPE_SWITCH_TIMEOUT_MS = 10_000;

export type StripeSourceAssessment =
  | {
    ok: true;
    status: "active" | "trialing";
    periodEnd: Date;
    cancelAtPeriodEnd: boolean;
    priceId: string | null;
  }
  | { ok: false; code: "not_in_force" | "not_monthly" | "boundary_elapsed" | "malformed" };

/**
 * Elegibilidade REMOTA da assinatura Stripe de origem do switch. O billing_interval local
 * nao e confiavel (null para price legado), entao o remoto e a autoridade: status
 * active|trialing, interval do price do primeiro item === "month" e period end ainda no
 * futuro. O period end e dual-read (root, depois item) para sobreviver a diferenca de
 * shape acacia/basil, igual ao stripe-webhook.
 */
export function assessStripeSourceSub(sub: unknown, now: Date): StripeSourceAssessment {
  if (typeof sub !== "object" || sub === null) return { ok: false, code: "malformed" };
  const s = sub as {
    status?: unknown;
    cancel_at_period_end?: unknown;
    current_period_end?: unknown;
    items?: {
      data?: Array<
        {
          current_period_end?: unknown;
          price?: { id?: unknown; recurring?: { interval?: unknown } | null } | null;
        } | undefined
      > | null;
    } | null;
  };
  const status = typeof s.status === "string" ? s.status : null;
  if (status !== "active" && status !== "trialing") return { ok: false, code: "not_in_force" };
  const item = s.items?.data?.[0];
  if (item?.price?.recurring?.interval !== "month") return { ok: false, code: "not_monthly" };
  const rawEnd = typeof s.current_period_end === "number"
    ? s.current_period_end
    : typeof item?.current_period_end === "number"
    ? item.current_period_end
    : null;
  if (rawEnd === null || !Number.isFinite(rawEnd)) return { ok: false, code: "malformed" };
  const periodEnd = new Date(rawEnd * 1000); // timestamps Stripe sao unix SEGUNDOS
  if (periodEnd.getTime() <= now.getTime()) return { ok: false, code: "boundary_elapsed" };
  return {
    ok: true,
    status,
    periodEnd,
    cancelAtPeriodEnd: s.cancel_at_period_end === true,
    priceId: typeof item?.price?.id === "string" ? item.price.id : null,
  };
}

/** Snapshot minimo do estado remoto para as decisoes de enforcement do leg D. */
export function readStripeSubSnapshot(
  sub: unknown,
): { status: string | null; cancelAtPeriodEnd: boolean; periodEndMs: number | null } {
  if (typeof sub !== "object" || sub === null) {
    return { status: null, cancelAtPeriodEnd: false, periodEndMs: null };
  }
  const s = sub as {
    status?: unknown;
    cancel_at_period_end?: unknown;
    current_period_end?: unknown;
    items?: { data?: Array<{ current_period_end?: unknown } | undefined> | null } | null;
  };
  const item = s.items?.data?.[0];
  const rawEnd = typeof s.current_period_end === "number"
    ? s.current_period_end
    : typeof item?.current_period_end === "number"
    ? item.current_period_end
    : null;
  return {
    status: typeof s.status === "string" ? s.status : null,
    cancelAtPeriodEnd: s.cancel_at_period_end === true,
    periodEndMs: rawEnd === null ? null : rawEnd * 1000,
  };
}

/** True para "assinatura nao existe" da Stripe (404 / resource_missing). */
export function isStripeNotFoundError(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const err = e as { statusCode?: unknown; code?: unknown };
  return err.statusCode === 404 || err.code === "resource_missing";
}

export interface StripeSwitchGateway {
  /** GET subscription com items.data.price expandido (input do assessStripeSourceSub). */
  retrieveSubscription(id: string): Promise<unknown>;
  /** Update de cancel_at_period_end apenas. Idempotente por valor. */
  setCancelAtPeriodEnd(id: string, value: boolean): Promise<void>;
  /** Cancel imediato (leg D: renovacao escapou / consolidacao do undo). */
  cancelNow(id: string): Promise<void>;
  /** Valor vivo para restaurar o mirror no undo (fetchStripeAmount, interval month). */
  fetchAmount(id: string): Promise<StripeAmount>;
}

export function createStripeSwitchGateway(secretKey: string): StripeSwitchGateway {
  const stripe = new Stripe(secretKey, { httpClient: Stripe.createFetchHttpClient() });
  return {
    retrieveSubscription: (id) =>
      stripe.subscriptions.retrieve(
        id,
        { expand: ["items.data.price"] },
        { timeout: STRIPE_SWITCH_TIMEOUT_MS },
      ),
    setCancelAtPeriodEnd: async (id, value) => {
      await stripe.subscriptions.update(
        id,
        { cancel_at_period_end: value },
        { timeout: STRIPE_SWITCH_TIMEOUT_MS },
      );
    },
    cancelNow: async (id) => {
      await stripe.subscriptions.cancel(id, undefined, { timeout: STRIPE_SWITCH_TIMEOUT_MS });
    },
    fetchAmount: (id) =>
      fetchStripeAmount(
        stripe as unknown as Parameters<typeof fetchStripeAmount>[0],
        id,
        "month",
      ),
  };
}
