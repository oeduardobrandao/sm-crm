// Admin Depósitos panel: live read of Stripe payouts/balance and Pagar.me payables/balance. The
// gateways are the only network code and are injected so the handler is testable with fakes
// (same pattern as pagarme-detail.ts). Each provider is settled independently: one failing must
// never hide the other. Nothing here is persisted.
//
// NOT imported by mcp-admin on purpose (it has no Stripe loader and the panel is admin-UI only).
//
// Spec: docs/superpowers/specs/2026-09-24-admin-depositos-design.md §1.

import { pagarmeFetch } from "../_shared/pagarme.ts";
import { loadStripe } from "../_shared/stripe-loader.ts";
import { STRIPE_TIMEOUT_MS } from "../_shared/stripe-amount.ts";
import { withTimeout } from "./pricing.ts";
import {
  buildPagarmeDeposits,
  buildStripeDeposits,
  notConfigured,
  summarize,
  unavailable,
  type DepositsSummary,
  type PagarmeRaw,
  type ProviderDeposits,
  type StripeRaw,
  type StripeSchedule,
} from "./deposits-logic.ts";

export interface StripeDepositsGateway {
  fetchRaw(): Promise<StripeRaw>;
}

export interface PagarmeDepositsGateway {
  fetchRaw(recipientId: string): Promise<PagarmeRaw>;
}

export interface DepositsGateways {
  /** null = no Stripe loader registered / STRIPE_SECRET_KEY missing → configured:false. */
  stripe: StripeDepositsGateway | null;
  pagarme: PagarmeDepositsGateway;
  /** PAGARME_RECIPIENT_ID; null → Pagar.me configured:false and the gateway is never called. */
  recipientId: string | null;
  /** PAGARME_SECRET_KEY present. pagarmeFetch only fails at call time when it is missing, which
   *  would read as "indisponível"; checking up front makes it "não configurado" instead. */
  pagarmeSecretPresent: boolean;
  /** YYYY-MM-DD; defaults to today (UTC). Injected so tests are deterministic. */
  today?: string;
}

export interface DepositsResponse {
  generated_at: string;
  /** Every amount in the payload is BRL centavos; Stripe sources are filtered to brl. */
  currency: "brl";
  summary: DepositsSummary;
  stripe: ProviderDeposits;
  pagarme: ProviderDeposits;
}

// ─── Stripe gateway ─────────────────────────────────────────────────────────

/** The slice of the Stripe SDK this module touches (the shared StripeClient type only knows
 *  subscriptions.retrieve). The real client satisfies this structurally. */
export type StripeDepositsClient = {
  balance: { retrieve: (params?: undefined, opts?: { timeout?: number }) => Promise<StripeRaw["balance"]> };
  payouts: {
    list: (
      params: { limit: number },
      opts?: { timeout?: number },
    ) => Promise<{ data: StripeRaw["payouts"] }>;
  };
  balanceTransactions: {
    list: (
      params: Record<string, unknown>,
      opts?: { timeout?: number },
    ) => Promise<{ data: StripeRaw["pendingTransactions"]; has_more: boolean }>;
  };
  accounts: {
    retrieve: (
      params?: undefined,
      opts?: { timeout?: number },
    ) => Promise<{ settings?: { payouts?: { schedule?: StripeSchedule } } }>;
  };
};

const STRIPE_PAGE = 100;
const STRIPE_MAX_PAGES = 5;
const OPTS = { timeout: STRIPE_TIMEOUT_MS };

/** Pending balance transactions. Prefers the `available_on` range filter; if Stripe rejects it
 *  (400), falls back to `created >= now-40d` (Brazil cards settle at T+30) and filters status
 *  client-side. Bounded to STRIPE_MAX_PAGES pages of 100; `truncated` when the cap is hit with
 *  more pages left. `nowSec` is injectable so tests get deterministic filter params. */
export async function listPendingTransactions(
  stripe: StripeDepositsClient,
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<{ rows: StripeRaw["pendingTransactions"]; truncated: boolean }> {
  const attempts: Record<string, unknown>[] = [
    { available_on: { gte: nowSec }, limit: STRIPE_PAGE },
    { created: { gte: nowSec - 40 * 24 * 3600 }, limit: STRIPE_PAGE },
  ];
  let lastErr: unknown = null;
  for (const base of attempts) {
    try {
      // Rows accumulated by a discarded attempt (a 400 mid-pagination) are dropped on purpose:
      // this attempt's filter was rejected, so its partial results aren't trustworthy, and the
      // next attempt starts clean with its own `rows`/`starting_after`/`truncated`.
      const rows: StripeRaw["pendingTransactions"] = [];
      let starting_after: string | undefined;
      let truncated = false;
      for (let page = 0; page < STRIPE_MAX_PAGES; page++) {
        const params = starting_after ? { ...base, starting_after } : base;
        const res = await withTimeout(stripe.balanceTransactions.list(params, OPTS), STRIPE_TIMEOUT_MS, "stripe.balanceTransactions.list");
        for (const t of res.data) if (t.status === "pending") rows.push(t);
        if (!res.has_more || res.data.length === 0) break;
        starting_after = res.data[res.data.length - 1].id;
        if (page === STRIPE_MAX_PAGES - 1) truncated = true;
      }
      return { rows, truncated };
    } catch (err) {
      lastErr = err;
      const status = (err as { statusCode?: number; status?: number }).statusCode ?? (err as { status?: number }).status;
      if (status !== 400) throw err; // only a rejected filter falls through to the next attempt
    }
  }
  throw lastErr;
}

export async function createStripeDepositsGateway(): Promise<StripeDepositsGateway | null> {
  const client = await loadStripe();
  if (!client) return null;
  const stripe = client as unknown as StripeDepositsClient;
  return {
    async fetchRaw() {
      const [balance, payouts, pending, account] = await Promise.all([
        withTimeout(stripe.balance.retrieve(undefined, OPTS), STRIPE_TIMEOUT_MS, "stripe.balance.retrieve"),
        withTimeout(stripe.payouts.list({ limit: 25 }, OPTS), STRIPE_TIMEOUT_MS, "stripe.payouts.list"),
        listPendingTransactions(stripe),
        withTimeout(stripe.accounts.retrieve(undefined, OPTS), STRIPE_TIMEOUT_MS, "stripe.accounts.retrieve").catch(
          (err) => {
            // The schedule is display-only; a restricted key must not take the whole card down.
            console.error("[deposits] stripe.accounts.retrieve failed:", (err as Error).message);
            return null;
          },
        ),
      ]);
      return {
        balance,
        payouts: payouts.data,
        pendingTransactions: pending.rows,
        schedule: account?.settings?.payouts?.schedule ?? null,
        truncated: pending.truncated,
      };
    },
  };
}

// ─── Pagar.me gateway ───────────────────────────────────────────────────────

// Each pagarmeFetch has a 5s timeout and the whole handler must fit the edge runtime budget, so the
// sweep is capped: 5 pages × 100 = 500 waiting payables (12 per 12x subscription → ~40 subscriptions).
// Hitting the cap sets `truncated` and the UI says the list is partial instead of silently under-counting.
const PAGARME_PAGE = 100;
const PAGARME_MAX_PAGES = 5;

interface PagarmePayablesPage {
  data: PagarmeRaw["payables"];
  paging?: { next?: string | null; cursors?: { next?: string | null } | null } | null;
}

interface PagarmeTransfersPage {
  data: PagarmeRaw["transfers"];
  paging?: { next?: string | null } | null;
}

/** Pagar.me returns the next cursor either bare (`paging.cursors.next`) or as a full URL in
 *  `paging.next` (`…/payables?forward_cursor=abc&size=100`). Accept both. */
export function nextCursor(paging: PagarmePayablesPage["paging"]): string | null {
  const raw = paging?.cursors?.next ?? paging?.next ?? null;
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) {
    try {
      return new URL(raw).searchParams.get("forward_cursor");
    } catch {
      return null;
    }
  }
  return raw;
}

export async function listWaitingPayables(
  recipientId: string,
  fetchPage: (path: string) => Promise<PagarmePayablesPage | null> = (path) =>
    pagarmeFetch<PagarmePayablesPage>("GET", path),
): Promise<{ rows: PagarmeRaw["payables"]; truncated: boolean }> {
  const rows: PagarmeRaw["payables"] = [];
  let cursor: string | null = null;
  let truncated = false;
  for (let page = 0; page < PAGARME_MAX_PAGES; page++) {
    const qs = new URLSearchParams({ recipient_id: recipientId, status: "waiting_funds", size: String(PAGARME_PAGE) });
    if (cursor) qs.set("forward_cursor", cursor);
    const res = await fetchPage(`/payables?${qs.toString()}`);
    rows.push(...(res?.data ?? []));
    cursor = nextCursor(res?.paging);
    if (!cursor || (res?.data ?? []).length === 0) break;
    if (page === PAGARME_MAX_PAGES - 1) truncated = true;
  }
  return { rows, truncated };
}

export function createPagarmeDepositsGateway(): PagarmeDepositsGateway {
  return {
    async fetchRaw(recipientId) {
      const id = encodeURIComponent(recipientId);
      const [balance, payablesPage, recipient, transfers] = await Promise.all([
        pagarmeFetch<unknown>("GET", `/recipients/${id}/balance`),
        listWaitingPayables(recipientId),
        pagarmeFetch<PagarmeRaw["recipient"]>("GET", `/recipients/${id}`),
        pagarmeFetch<PagarmeTransfersPage>(
          "GET",
          `/transfers?${new URLSearchParams({ recipient_id: recipientId, status: "pending_transfer,processing", count: "50" }).toString()}`,
        ).then((r) => r?.data ?? []).catch((err) => {
          // In-flight transfers are a nice-to-have; the endpoint is newer and its filter grammar
          // is the least documented. Degrade to an empty list rather than fail the card.
          console.error("[deposits] pagarme transfers failed:", (err as Error).message);
          return [] as PagarmeRaw["transfers"];
        }),
      ]);
      return { balance, payables: payablesPage.rows, recipient, transfers, truncated: payablesPage.truncated };
    },
  };
}

// ─── handler ────────────────────────────────────────────────────────────────

async function settleProvider(label: string, run: (() => Promise<ProviderDeposits>) | null): Promise<ProviderDeposits> {
  if (!run) return notConfigured();
  try {
    return await run();
  } catch (err) {
    console.error(`[deposits] ${label} failed:`, (err as Error).message);
    return unavailable();
  }
}

export async function buildDepositsResponse(g: DepositsGateways): Promise<DepositsResponse> {
  const today = g.today ?? new Date().toISOString().slice(0, 10);
  const pagarmeConfigured = !!g.recipientId && g.pagarmeSecretPresent;
  const [stripe, pagarme] = await Promise.all([
    settleProvider("stripe", g.stripe ? () => g.stripe!.fetchRaw().then((raw) => buildStripeDeposits(raw, today)) : null),
    settleProvider(
      "pagarme",
      pagarmeConfigured ? () => g.pagarme.fetchRaw(g.recipientId!).then((raw) => buildPagarmeDeposits(raw, today)) : null,
    ),
  ]);
  return {
    generated_at: new Date().toISOString(),
    currency: "brl",
    summary: summarize({ stripe, pagarme }),
    stripe,
    pagarme,
  };
}

async function defaultGateways(): Promise<DepositsGateways> {
  return {
    stripe: await createStripeDepositsGateway(),
    pagarme: createPagarmeDepositsGateway(),
    recipientId: Deno.env.get("PAGARME_RECIPIENT_ID")?.trim() || null,
    pagarmeSecretPresent: !!Deno.env.get("PAGARME_SECRET_KEY"),
  };
}

export async function handleGetDeposits(
  headers: Record<string, string>,
  gateways?: DepositsGateways,
): Promise<Response> {
  const body = await buildDepositsResponse(gateways ?? (await defaultGateways()));
  return new Response(JSON.stringify(body), { status: 200, headers });
}
